#!/usr/bin/env python3
"""Build print-style (sans, like PingFang / TrainChinese) stroke data for the app.

Make Me a Hanzi (MMAH) only ships stroke shapes cut from a brush (kaiti) font. Every character here is
re-cut from Noto Sans SC (SIL Open Font License), keeping MMAH's stroke count and stroke order.

The variable build of Noto Sans SC keeps overlapping contours; nearly every contour is one stroke, but a
contour can hold several strokes (e.g. a ring = 竖+横折+横) and a stroke can be split over several
contours (hooks, 横撇, 撇点). So:
  1. instance the variable font at Regular (400), overlaps kept; group contours + holes into pieces
  2. skeletonise every piece (spurs pruned) -> skeleton points with local directions
  3. register the MMAH medians onto the skeleton: global fit (bbox + shift), then a TPS-RPM style
     non-rigid registration (soft one-to-one correspondences by distance x direction, thin-plate
     refit, temperature annealed, both directions), then per-stroke translation ICP
  4. label every skeleton point by the nearest direction-compatible median; isolated leak clusters are
     re-labelled; a piece's strokes = labels with real support; every stroke must be placed
  5. a piece with one stroke keeps its exact font contour; a piece with several is split by a skeleton-graph
     PATH PARTITION (partition_piece): skeleton graph (spurs pruned; nodes = ends, junctions, corners > 40 deg;
     close junctions merged), every stroke takes one simple path of 1..6 edges matching its registered median
     in writing direction (shape + segment-direction + end cost; the reference of a stroke that also lives in
     other pieces is clipped to this piece and may skip it), chosen jointly so that every long edge is covered
     and no edge is shared. Region = discs (1.15 x local half-width) along the path, leftovers to the nearest
     path; part = exact contour (shapely) intersected with the region; outers clockwise, holes counter-clockwise
  6. median = the stroke's path (or the skeleton of its clean core when it spans several pieces), oriented
     like the reference, bent skeleton ends at corners / slanted tips trimmed and extended straight to ~20
     units from the stroke edge, RDP 2.5 units. Stored simplified (the app densifies at load); svg numbers
     are integers
  7. tools/sans-overrides.json fixes what the automatic assignment gets wrong:
       {"char": {"pieces": {"<pieceIndex>": [strokeNumbers 1-based]}}}   forces the strokes of a piece
       {"char": {"pieces": {"<pieceIndex>": {"lines": {"<stroke>": [[x, y], ...]}}}}}   cuts it along
                                                       explicit centre lines (unit frame, y up)
       {"char": {"brush": true}}                                      keep the MMAH brush data
     (piece indices: run with --debug and look at /tmp/hzwk/dbg-<codepoint>.png)

Input:  tools/cache/mmah-strokes.json (MMAH data, written by build-data.mjs)
Output: data/strokes.js (window.HZ_STROKES) and tools/cache/verify-*.png (left MMAH brush, right new print,
        same colour per stroke number, stroke number at each median start, medians as white lines)

Run:  tools/.venv/bin/python tools/build-sans.py [chars]   no args: all chars + write data/strokes.js;
      with chars: preview only (verify-preview-*.png, tools/cache/sans-preview.json, no data written)
"""
import os
os.environ.setdefault('OMP_NUM_THREADS', '1')
os.environ.setdefault('OPENBLAS_NUM_THREADS', '1')
os.environ.setdefault('MKL_NUM_THREADS', '1')
import json
import multiprocessing as mp
import math
import pathlib
import re
import sys
import time
import urllib.request
from collections import deque

import cv2
import numpy as np
from fontTools.pens.basePen import BasePen
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from scipy import ndimage
from scipy.interpolate import RBFInterpolator
from scipy.optimize import linprog, minimize
from scipy.sparse import csr_matrix, coo_matrix
from scipy.sparse.csgraph import connected_components, dijkstra
from scipy.spatial import cKDTree
from shapely.geometry import Polygon
from shapely.geometry.polygon import orient as shp_orient
from shapely.ops import unary_union
from skimage.morphology import skeletonize

ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / 'tools' / 'cache'
SRC = CACHE / 'mmah-strokes.json'
VF_URL = 'https://github.com/google/fonts/raw/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf'
VF = CACHE / 'NotoSansSC-VF.ttf'
WEIGHT = 400
K = 2                      # raster pixels per unit
N = 1024 * K

# font units (upm 1000, em box y -120..880) -> hanzi-writer frame (x 0..1024, y -124..900, y up)
FS = 1.024
FY = -124 + 120 * FS


def font_to_unit(x, y):
    return x * FS, y * FS + FY


def unit_to_px(x, y):
    return x * K, (900 - y) * K


def px_to_unit(X, Y):
    return X / K, 900 - Y / K


# ---------------------------------------------------------------- svg path flattening
def flatten_path(d):
    """Absolute-command SVG path (M L H V Q C Z, implicit repeats) -> list of point lists (unit frame)."""
    toks = re.findall(r'[MLHVQCZmlhvqcz]|-?\d*\.?\d+(?:e-?\d+)?', d)
    polys, cur = [], []
    i, cmd, x, y = 0, None, 0.0, 0.0

    def num():
        nonlocal i
        v = float(toks[i])
        i += 1
        return v
    while i < len(toks):
        t = toks[i]
        if t.isalpha():
            cmd = t.upper()
            i += 1
            if cmd == 'Z':
                if cur:
                    polys.append(cur)
                cur = []
            continue
        if cmd == 'M':
            if cur:
                polys.append(cur)
            x, y = num(), num()
            cur = [(x, y)]
            cmd = 'L'
        elif cmd == 'L':
            x, y = num(), num()
            cur.append((x, y))
        elif cmd == 'H':
            x = num()
            cur.append((x, y))
        elif cmd == 'V':
            y = num()
            cur.append((x, y))
        elif cmd == 'Q':
            cx, cy, ex, ey = num(), num(), num(), num()
            for k in range(1, 9):
                s = k / 8
                u = 1 - s
                cur.append((u * u * x + 2 * u * s * cx + s * s * ex, u * u * y + 2 * u * s * cy + s * s * ey))
            x, y = ex, ey
        elif cmd == 'C':
            c1x, c1y, c2x, c2y, ex, ey = num(), num(), num(), num(), num(), num()
            for k in range(1, 11):
                s = k / 10
                u = 1 - s
                cur.append((u ** 3 * x + 3 * u * u * s * c1x + 3 * u * s * s * c2x + s ** 3 * ex,
                            u ** 3 * y + 3 * u * u * s * c1y + 3 * u * s * s * c2y + s ** 3 * ey))
            x, y = ex, ey
        else:
            i += 1
    if cur:
        polys.append(cur)
    return [p for p in polys if len(p) > 2]


def to_px(poly):
    return np.array([unit_to_px(x, y) for x, y in poly], float)


def fill(polys_px, shape=(N, N), scale=1.0):
    m = np.zeros(shape, np.uint8)
    if polys_px:
        cv2.fillPoly(m, [np.round(p * scale * 8).astype(np.int32) for p in polys_px], 1, lineType=cv2.LINE_8, shift=3)
    return m.astype(bool)


# ---------------------------------------------------------------- font
def load_font(chars):
    CACHE.mkdir(parents=True, exist_ok=True)
    if not VF.exists() or VF.stat().st_size < 1_000_000:
        urllib.request.urlretrieve(VF_URL, VF)
    inst = CACHE / f'NotoSansSC-{WEIGHT}.ttf'
    if inst.exists():
        f = TTFont(inst)
        if all(ord(c) in f.getBestCmap() for c in chars):
            return f
    from fontTools import subset
    f = TTFont(VF)
    opts = subset.Options()
    opts.layout_features = []
    opts.notdef_outline = True
    sub = subset.Subsetter(opts)
    sub.populate(text=''.join(chars))
    sub.subset(f)
    f = instancer.instantiateVariableFont(f, {'wght': WEIGHT}, overlap=instancer.OverlapMode.KEEP_AND_SET_FLAGS)
    f.save(inst)
    return TTFont(inst)


def signed_area(poly):
    a = np.asarray(poly, float)
    return 0.5 * float(np.sum(a[:, 0] * np.roll(a[:, 1], -1) - np.roll(a[:, 0], -1) * a[:, 1]))


def glyph_pieces(font, ch):
    """Glyph contours grouped into pieces: one outer contour plus the holes inside it.
    Returns [{svg, mask, outer, holes}] (svg/outer/holes in the unit frame, mask in px)."""
    name = font.getBestCmap().get(ord(ch))
    if not name:
        return None
    rec = RecordingPen()
    font.getGlyphSet()[name].draw(rec)
    groups, cur = [], []
    for op, args in rec.value:
        cur.append((op, args))
        if op in ('closePath', 'endPath'):
            groups.append(cur)
            cur = []
    cons = []
    for g in groups:
        svg = SVGPathPen(None, ntos=lambda v: str(int(round(v))))
        tp = TransformPen(svg, (FS, 0, 0, FS, 0, FY))
        for op, args in g:
            getattr(tp, op)(*args)
        dpath = svg.getCommands()
        polys = flatten_path(dpath)
        if polys:
            cons.append({'d': dpath, 'unit': polys[0], 'px': to_px(polys[0]), 'area': signed_area(polys[0])})
    # a contour inside a bigger contour of opposite winding is a hole of the smallest such container
    for i, c in enumerate(cons):
        c['parent'] = None
        samp = c['px'][:: max(1, len(c['px']) // 12)]
        best = None
        for j, o in enumerate(cons):
            if i == j or abs(o['area']) <= abs(c['area']) or np.sign(o['area']) == np.sign(c['area']):
                continue
            cnt = np.round(o['px']).astype(np.float32).reshape(-1, 1, 2)
            if all(cv2.pointPolygonTest(cnt, (float(x), float(y)), False) >= 0 for x, y in samp):
                if best is None or abs(o['area']) < abs(cons[best]['area']):
                    best = j
        c['parent'] = best
    pieces = []
    for i, c in enumerate(cons):
        if c['parent'] is not None and cons[c['parent']]['parent'] is None:
            continue                                  # a hole: drawn with its outer contour
        holes = [h for h in cons if h['parent'] == i]
        m = fill([c['px']])
        if holes:
            m &= ~fill([h['px'] for h in holes])
        pieces.append({'svg': ' '.join([c['d']] + [h['d'] for h in holes]), 'mask': m, 'outer': c['unit'], 'holes': [h['unit'] for h in holes]})
    return pieces


# ---------------------------------------------------------------- skeletons, directions, matching
def samples(m, step):
    """resample a polyline (px) every `step`; returns points and unit tangents"""
    out = [m[0]]
    for a, b in zip(m[:-1], m[1:]):
        n = max(1, int(np.linalg.norm(b - a) // step))
        out += [a + (b - a) * t / n for t in range(1, n + 1)]
    pts = np.array(out)
    if len(pts) < 2:
        return pts, np.array([[1.0, 0.0]])
    tg = np.gradient(pts, axis=0)
    tg /= np.linalg.norm(tg, axis=1, keepdims=True).clip(1e-9)
    return pts, tg


def prune_spurs(sk, edt, rounds=2):
    """delete skeleton branches that run from an end to a junction and are shorter than the local
    half-width (the little forks the skeleton throws into square stroke ends)"""
    sk = sk.copy()
    H, W = sk.shape
    nb8 = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]

    def nbrs(y, x):
        return [(y + dy, x + dx) for dy, dx in nb8 if 0 <= y + dy < H and 0 <= x + dx < W and sk[y + dy, x + dx]]
    for _ in range(rounds):
        ends = [tuple(e) for e in np.argwhere(sk) if len(nbrs(*e)) == 1]
        for e in ends:
            if not sk[e]:
                continue
            path, prev, cur = [e], None, e
            while True:
                nx = [q for q in nbrs(*cur) if q != prev and q not in path]
                if len(nx) != 1:
                    break
                prev, cur = cur, nx[0]
                path.append(cur)
                if len(nbrs(*cur)) >= 3:
                    break
            if len(nbrs(*cur)) >= 3 and len(path) - 1 < 1.1 * edt[cur] + 2 * K:
                for q in path[:-1]:
                    sk[q] = False
    return sk


def piece_skeleton(mask):
    """skeleton points (px, x/y) of one piece and the local (unsigned) direction at each"""
    yy, xx = np.nonzero(mask)
    y0, x0 = max(0, yy.min() - 3), max(0, xx.min() - 3)
    crop = mask[y0:yy.max() + 4, x0:xx.max() + 4]
    sk = prune_spurs(skeletonize(crop), ndimage.distance_transform_edt(crop))
    pts = np.column_stack(np.nonzero(sk)[::-1]).astype(float) + (x0, y0)
    if len(pts) < 3:
        c = np.array([xx.mean(), yy.mean()])
        return np.array([c - (2, 0), c, c + (2, 0)]), np.tile([1.0, 0.0], (3, 1))
    tree = cKDTree(pts)
    dirs = np.zeros_like(pts)
    for i, nb in enumerate(tree.query_ball_point(pts, 11 * K)):
        if len(nb) < 4:
            dirs[i] = (1.0, 0.0)
            continue
        q = pts[nb] - pts[nb].mean(0)
        _, v = np.linalg.eigh(q.T @ q)
        dirs[i] = v[:, 1]
    return pts, dirs


def compat(Q, Qd, tree, T, Td, R, cos):
    """for each query point: nearest tree point within R whose direction is similar (|cos| > cos).
    Returns (index into T, distance); distance is inf when there is none."""
    k = min(12, len(T))
    dist, idx = tree.query(Q, k=k, distance_upper_bound=R)
    dist, idx = dist.reshape(len(Q), -1), idx.reshape(len(Q), -1)
    ok = np.isfinite(dist)
    idx2 = np.where(ok, idx, 0)
    dots = np.abs(np.einsum('ij,ikj->ik', Qd, Td[idx2]))
    dist = np.where(ok & (dots > cos), dist, np.inf)
    j = dist.argmin(1)
    r = np.arange(len(Q))
    return idx2[r, j], dist[r, j]


def eff(dv, t):
    along = (dv * t).sum(1, keepdims=True) * t
    return dv - along + 0.25 * along


def align(meds0, P, D, cent, sched=(62, 50, 40, 34)):
    """ICP-like: per-stroke translation moving each median onto the skeleton points it explains"""
    ns = len(meds0)
    T = np.zeros((ns, 2))
    for Ru in sched:
        R = Ru * K
        S = [samples(meds0[s] + T[s], 4 * K) for s in range(ns)]
        cd = np.full((ns, len(P)), np.inf)
        nn = np.zeros((ns, len(P)), int)
        for s in range(ns):
            nn[s], cd[s] = compat(P, D, cKDTree(S[s][0]), S[s][0], S[s][1], R, 0.7)
        lab, valid = cd.argmin(0), np.isfinite(cd.min(0))
        raw, n = np.zeros((ns, 2)), np.zeros(ns)
        for s in range(ns):
            idx = np.where(valid & (lab == s))[0]
            ds = []
            if len(idx):
                ds.append(eff(P[idx] - S[s][0][nn[s][idx]], S[s][1][nn[s][idx]]))
            if len(idx) >= 2:
                j, dd = compat(S[s][0], S[s][1], cKDTree(P[idx]), P[idx], D[idx], R, 0.7)
                ok = np.isfinite(dd)
                if ok.any():
                    ds.append(eff(P[idx][j[ok]] - S[s][0][ok], S[s][1][ok]))
            if ds:
                ds = np.vstack(ds)
                raw[s] = np.median(ds, axis=0)
                n[s] = len(ds)
        have = n > 0
        step = np.zeros((ns, 2))
        gm = raw[have].mean(0) if have.any() else np.zeros(2)
        for s in range(ns):
            w = np.exp(-(((cent - cent[s]) ** 2).sum(1)) / (2 * (130 * K) ** 2)) * n
            w[s] = 0
            nb = (w[:, None] * raw).sum(0) / w.sum() if w.sum() > 0 else gm
            step[s] = (n[s] * raw[s] + 4 * nb) / (n[s] + 4) if n[s] > 0 else nb
        T += 0.9 * np.clip(step, -30 * K, 30 * K)
    return T


WARP = {'sched': (120, 90, 68, 52, 40, 30, 24, 18), 'lam0': 2e5, 'cosp': 3, 'lamfloor': 0.0, 'sym': True, 'lp': False}


def warp_align(meds0, P, D, sched=None, lam0=None):
    """TPS-RPM style non-rigid registration of the brush medians onto the glyph skeleton: soft one-to-one
    correspondences (distance x direction), thin-plate-spline refit, temperature annealed. Returns the
    warped medians as dense polylines (px)."""
    sched = sched or WARP['sched']
    lam0 = lam0 or WARP['lam0']
    ns = len(meds0)
    Xs, Xid = [], []
    for s, m in enumerate(meds0):
        pts, _ = samples(m, 11 * K)
        Xs.append(pts)
        Xid += [s] * len(pts)
    X, Xid = np.vstack(Xs), np.array(Xid)
    cells = np.floor(P / (8 * K)).astype(int)
    _, first = np.unique(cells, axis=0, return_index=True)
    Y, Yd = P[first], D[first]
    cur = X.copy()
    for Tu in sched:
        T = Tu * K
        tg = np.zeros_like(cur)
        for s in range(ns):
            ix = np.where(Xid == s)[0]
            tg[ix] = samples_tangent(cur[ix])
        d2 = ((cur[:, None, :] - Y[None, :, :]) ** 2).sum(-1)
        cosd = np.abs(tg @ Yd.T)
        W = np.exp(-d2 / (2 * T * T)) * cosd ** WARP['cosp']
        s0 = np.exp(-(2.5 ** 2) / 2)
        for _ in range(8):
            W = W / (W.sum(1, keepdims=True) + s0)
            W = W / (W.sum(0, keepdims=True) + s0)
        rs = W.sum(1)
        ok = rs > 0.15
        if ok.sum() < 6:
            continue
        tgt = (W[ok] @ Y) / rs[ok, None]
        dom, rng, wgt = X[ok], tgt, np.clip(rs[ok], 0.15, 1.0)
        if WARP['sym']:
            cs = W.sum(0)
            okc = cs > 0.15
            if okc.sum() >= 3:
                xb = (W[:, okc].T @ X) / cs[okc, None]
                dom = np.vstack([dom, xb])
                rng = np.vstack([rng, Y[okc]])
                wgt = np.concatenate([wgt, np.clip(cs[okc], 0.15, 1.0)])
        lam = max(lam0 * (Tu / sched[0]) ** 2, WARP['lamfloor']) * K * K
        sm = lam / wgt
        try:
            f = RBFInterpolator(dom, rng, kernel='thin_plate_spline', smoothing=sm, degree=1)
            cur = f(X)
        except Exception:
            break
    return [cur[Xid == s] for s in range(ns)]


def samples_tangent(pts):
    if len(pts) < 2:
        return np.array([[1.0, 0.0]] * len(pts))
    tg = np.gradient(pts, axis=0)
    return tg / np.linalg.norm(tg, axis=1, keepdims=True).clip(1e-9)


# ---------------------------------------------------------------- median of a finished stroke shape
def stroke_median(mask, ref, bdir):
    """Centre line of a stroke shape (px): shortest skeleton path between the skeleton ends nearest to
    the reference median's two ends, oriented like it, ends set ~22 units from the stroke tips."""
    ys, xs = np.nonzero(mask)
    y0, x0 = max(0, ys.min() - 6), max(0, xs.min() - 6)
    raw = mask[y0:ys.max() + 7, x0:xs.max() + 7]
    crop = ndimage.binary_closing(raw, iterations=2)
    edt = ndimage.distance_transform_edt(crop)
    pts = np.column_stack(np.nonzero(skeletonize(crop))[::-1]).astype(float)
    ref = ref - (x0, y0)
    if len(pts) < 6:
        c = np.array([xs.mean() - x0, ys.mean() - y0])
        d = ref[-1] - ref[0]
        d = d / (np.linalg.norm(d) or 1) * 10 * K
        return np.array([c - d, c + d]) + (x0, y0)
    n = len(pts)
    tree = cKDTree(pts)
    rows, cols, wts = [], [], []
    for i, j in tree.query_pairs(1.5):
        rows += [i, j]
        cols += [j, i]
        w = float(np.linalg.norm(pts[i] - pts[j]))
        wts += [w, w]
    g = csr_matrix((wts, (rows, cols)), shape=(n, n))
    while True:
        nc, comp = connected_components(g, directed=False)
        if nc == 1:
            break
        A = np.where(comp == comp[0])[0]
        B = np.where(comp != comp[0])[0]
        dd, jj = cKDTree(pts[B]).query(pts[A])
        i = int(np.argmin(dd))
        a, b = A[i], B[jj[i]]
        g = g + csr_matrix(([dd[i], dd[i]], ([a, b], [b, a])), shape=(n, n))
    deg = np.diff(g.indptr)
    ends = np.where(deg == 1)[0]
    cand = ends if len(ends) >= 2 else np.arange(n)
    # ends = the two ends of the longest skeleton path (diameter): robust against a misplaced reference
    d0 = dijkstra(g, indices=cand[np.argmin(np.linalg.norm(pts[cand] - ref[0], axis=1))])
    d0 = np.where(np.isfinite(d0), d0, -1)
    a = cand[np.argmax(d0[cand])]
    da = dijkstra(g, indices=a)
    da = np.where(np.isfinite(da), da, -1)
    b = cand[np.argmax(da[cand])]
    if a == b:
        b = cand[np.argmax(np.linalg.norm(pts[cand] - pts[a], axis=1))]
    _, pred = dijkstra(g, indices=a, return_predecessors=True)
    path = [b]
    while path[-1] != a and pred[path[-1]] >= 0:
        path.append(pred[path[-1]])
    path = pts[path[::-1]]
    if np.dot(path[-1] - path[0], bdir) < 0:
        path = path[::-1]
    # smooth the staircase of the skeleton a little
    if len(path) > 7:
        k = np.ones(5) / 5
        sm = np.column_stack([np.convolve(np.pad(path[:, c], 2, mode='edge'), k, mode='valid') for c in (0, 1)])
        sm[0], sm[-1] = path[0], path[-1]
        path = sm
    w = 2 * float(np.median(edt[np.clip(np.round(path[:, 1]).astype(int), 0, edt.shape[0] - 1),
                                    np.clip(np.round(path[:, 0]).astype(int), 0, edt.shape[1] - 1)]))
    path = set_ends(path, raw, (0.5 * w, 0.5 * w), w)
    return rdp(path, 2.5 * K) + (x0, y0)


def densify(pts, step=40):
    """hanzi-writer scores a finger stroke by its distance to the nearest median POINT (not segment),
    so long straight runs need points every ~step units; otherwise a correct stroke along the middle
    of a long horizontal is rejected."""
    out = [pts[0]]
    for (x1, y1), (x2, y2) in zip(pts[:-1], pts[1:]):
        n = max(1, int(math.ceil(math.hypot(x2 - x1, y2 - y1) / step)))
        for k in range(1, n + 1):
            out.append([int(round(x1 + (x2 - x1) * k / n)), int(round(y1 + (y2 - y1) * k / n))])
    return [q for i, q in enumerate(out) if i == 0 or q != out[i - 1]]


def rdp(pts, eps):
    if len(pts) < 3:
        return pts
    a, b = pts[0], pts[-1]
    ab = b - a
    L = np.linalg.norm(ab) or 1.0
    q = pts - a
    d = np.abs(ab[0] * q[:, 1] - ab[1] * q[:, 0]) / L
    i = int(np.argmax(d))
    if d[i] > eps:
        return np.vstack([rdp(pts[:i + 1], eps)[:-1], rdp(pts[i:], eps)])
    return np.array([a, b])


# ---------------------------------------------------------------- skeleton-graph path partition
NB8 = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def rdp_idx(pts, eps, lo=0, hi=None):
    """indices of the RDP-simplified vertices of a polyline"""
    if hi is None:
        hi = len(pts) - 1
    if hi - lo < 2:
        return [lo, hi] if hi > lo else [lo]
    a, b = pts[lo], pts[hi]
    ab = b - a
    L = np.linalg.norm(ab)
    q = pts[lo + 1:hi] - a
    d = np.abs(ab[0] * q[:, 1] - ab[1] * q[:, 0]) / L if L > 0 else np.linalg.norm(q, axis=1)
    i = int(np.argmax(d))
    if d[i] > eps:
        m = lo + 1 + i
        return rdp_idx(pts, eps, lo, m)[:-1] + rdp_idx(pts, eps, m, hi)
    return [lo, hi]


def plen(p):
    return float(np.linalg.norm(np.diff(p, axis=0), axis=1).sum()) if len(p) > 1 else 0.0


def resample(p, n):
    cum = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(p, axis=0), axis=1))])
    if cum[-1] <= 0:
        return np.repeat(p[:1], n, axis=0)
    t = np.linspace(0, cum[-1], n)
    return np.column_stack([np.interp(t, cum, p[:, 0]), np.interp(t, cum, p[:, 1])])


def skel_graph(pm, edt):
    """skeleton graph of a piece mask (crop px). Returns nodes (xy), node degree, edges [(u, v, chain xy)], width."""
    sk = skeletonize(pm)
    sk = prune_spurs(sk, edt * 1.25, rounds=3)
    w = 2 * float(np.median(edt[sk])) if sk.any() else 20.0
    H, W = sk.shape
    ys, xs = np.nonzero(sk)
    idx = -np.ones(sk.shape, int)
    idx[ys, xs] = np.arange(len(ys))
    nb = []
    for y, x in zip(ys, xs):
        nb.append([idx[y + dy, x + dx] for dy, dx in NB8 if 0 <= y + dy < H and 0 <= x + dx < W and idx[y + dy, x + dx] >= 0])
    deg = np.array([len(n) for n in nb])
    isnode = deg != 2
    comp, nc = ndimage.label(sk, structure=np.ones((3, 3)))
    for c in range(1, nc + 1):                      # pure cycles: make the top pixel a node
        ii = idx[comp == c]
        if not isnode[ii].any():
            isnode[ii[np.argmin(ys[ii])]] = True
    nm = np.zeros(sk.shape, bool)
    nm[ys[isnode], xs[isnode]] = True
    cl, ncl = ndimage.label(nm, structure=np.ones((3, 3)))
    clus = cl[ys, xs] - 1                          # cluster id per pixel (-1 = chain pixel)
    pxy = np.column_stack([xs, ys]).astype(float)
    nodes = np.array([pxy[clus == c].mean(0) for c in range(ncl)]).reshape(-1, 2)
    seen = set()
    edges = []
    for p in np.where(isnode)[0]:
        for q in nb[p]:
            if isnode[q]:
                if clus[q] != clus[p] and p < q:
                    edges.append([clus[p], clus[q], pxy[[p, q]]])
                continue
            if (p, q) in seen:
                continue
            chain, prev, cur = [p, q], p, q
            while not isnode[cur]:
                nx = [r for r in nb[cur] if r != prev and r not in chain[-3:]]
                if not nx:
                    break
                prev, cur = cur, nx[0]
                chain.append(cur)
            seen.add((p, q))
            seen.add((chain[-1], chain[-2]))
            if isnode[cur]:
                edges.append([clus[p], clus[cur], pxy[chain]])
    # corners: split chains where the RDP-simplified line turns by > 40 deg
    ncount = len(nodes)
    nodes = list(nodes)
    out = []
    for u, v, ch in edges:
        vi = rdp_idx(ch, max(2.5 * K, 0.12 * w))
        cuts = []
        for a, b, c in zip(vi[:-2], vi[1:-1], vi[2:]):
            d1, d2 = ch[b] - ch[a], ch[c] - ch[b]
            cs = np.dot(d1, d2) / (np.linalg.norm(d1) * np.linalg.norm(d2) + 1e-9)
            if cs < math.cos(math.radians(40)):
                cuts.append(b)
        last, lu = 0, u
        for b in cuts:
            nodes.append(ch[b].copy())
            out.append([lu, len(nodes) - 1, ch[last:b + 1]])
            last, lu = b, len(nodes) - 1
        out.append([lu, v, ch[last:]])
    nodes = np.array(nodes).reshape(-1, 2)
    # merge nodes joined by a short edge (crossings give two junctions close together); endpoints stay
    dg = np.zeros(len(nodes), int)
    for u, v, _ in out:
        dg[u] += 1
        dg[v] += 1
    par = list(range(len(nodes)))

    def find(a):
        while par[a] != a:
            par[a] = par[par[a]]
            a = par[a]
        return a
    for u, v, ch in out:
        if u != v and dg[u] >= 2 and dg[v] >= 2 and plen(ch) < 0.6 * w:
            par[find(u)] = find(v)
    roots = sorted({find(i) for i in range(len(nodes))})
    rid = {r: i for i, r in enumerate(roots)}
    nn = np.array([nodes[[i for i in range(len(nodes)) if find(i) == r]].mean(0) for r in roots]).reshape(-1, 2)
    E = []
    for u, v, ch in out:
        a, b = rid[find(u)], rid[find(v)]
        if a == b and (u != v or plen(ch) < 2 * w):
            if u != v or plen(ch) < 2 * w:
                continue
        E.append((a, b, np.vstack([nn[a], ch[1:-1], nn[b]]) if len(ch) > 2 else np.vstack([nn[a], nn[b]])))
    ndeg = np.zeros(len(nn), int)
    for a, b, _ in E:
        ndeg[a] += 1
        ndeg[b] += 1
    return nn, ndeg, E, w


def path_cost(poly, ref, n=28):
    """shape distance (units) between a candidate skeleton path and the reference median, both in writing order"""
    P, R = resample(poly, n), resample(ref, n)
    dpt = np.linalg.norm(P - R, axis=1).mean() / K
    tp, tr = np.diff(P, axis=0), np.diff(R, axis=0)
    tp /= np.linalg.norm(tp, axis=1, keepdims=True).clip(1e-9)
    tr /= np.linalg.norm(tr, axis=1, keepdims=True).clip(1e-9)
    dirc = float((1 - (tp * tr).sum(1)).mean())
    ends = (np.linalg.norm(P[0] - R[0]) + np.linalg.norm(P[-1] - R[-1])) / K
    return dpt + 120 * dirc + 0.4 * ends


def path_candidates(nodes, E, ref, w, maxe=6, top=8):
    adj = [[] for _ in nodes]
    for ei, (a, b, _) in enumerate(E):
        adj[a].append((ei, b, False))
        adj[b].append((ei, a, True))
    Lr = plen(ref)
    cap = 1.6 * Lr + 1.5 * w
    d0 = np.linalg.norm(nodes - ref[0], axis=1)
    starts = set(np.where(d0 < max(110 * K, 0.5 * Lr))[0]) | set(np.argsort(d0)[:3])
    best = {}
    for s0 in starts:
        stack = [(s0, [s0], [], [nodes[s0][None]], 0.0)]
        while stack:
            nd, nseq, eseq, polys, L = stack.pop()
            for ei, nb, rev in adj[nd]:
                if nb in nseq or ei in eseq:
                    continue
                ch = E[ei][2][::-1] if rev else E[ei][2]
                L2 = L + plen(ch)
                if L2 > cap and eseq:
                    continue
                pol2 = polys + [ch[1:]]
                es2 = eseq + [ei]
                poly = np.vstack(pol2)
                c = path_cost(poly, ref)
                key = frozenset(es2)
                if key not in best or best[key][0] > c:
                    best[key] = (c, es2, nseq + [nb], poly)
                if len(es2) < maxe:
                    stack.append((nb, nseq + [nb], es2, pol2, L2))
    return sorted(best.values(), key=lambda t: t[0])[:top]


SKIPC = 400.0


def partition_piece(pm, refs, can_skip):
    """split a multi-stroke piece (crop mask) into strokes along skeleton paths.
    refs: reference medians (crop px) in writing order. Returns per stroke (region mask, core mask, path poly, free ends)
    or None for a stroke that takes no part of this piece."""
    closed = ndimage.binary_closing(pm, iterations=2) | pm
    edt = ndimage.distance_transform_edt(closed)
    nodes, ndeg, E, w = skel_graph(closed, edt)
    k = len(refs)
    if not E:
        return None
    # a stroke that also lives in other pieces: compare only the part of its reference lying on this piece
    dout = ndimage.distance_transform_edt(~closed)
    skipc = [SKIPC] * k
    for s in range(k):
        if not can_skip[s]:
            continue
        rr = resample(refs[s], max(2, int(plen(refs[s]) / (3 * K)) + 1))
        xi = np.round(rr[:, 0]).astype(int)
        yi = np.round(rr[:, 1]).astype(int)
        inb = (xi >= 0) & (yi >= 0) & (xi < pm.shape[1]) & (yi < pm.shape[0])
        dd = np.full(len(rr), 1e9)
        dd[inb] = dout[yi[inb], xi[inb]]
        ok = dd < 0.5 * w + 15 * K
        best, cur, bi = (0, 0, 0), 0, 0
        for i, v in enumerate(ok):
            cur = cur + 1 if v else 0
            if cur > best[0]:
                best = (cur, i - cur + 1, i + 1)
        # skipping is cheap for a stroke whose reference barely touches this piece (a registration leak)
        skipc[s] = 60.0 + 0.8 * plen(rr[best[1]:best[2]]) / K if best[0] >= 2 else 60.0
        if best[0] >= 4 and best[0] < len(rr):
            refs[s] = rr[best[1]:best[2]]
    elen = np.array([plen(e[2]) for e in E])
    cands = []
    for s in range(k):
        c = path_candidates(nodes, E, refs[s], w)
        # a stroke that also lives elsewhere must take a real part of this piece, not a tip spur
        opts = [(cc, set(es), ns, poly) for cc, es, ns, poly in c if not can_skip[s] or plen(poly) >= 0.8 * w]
        if can_skip[s] or not opts:
            opts.append((skipc[s] if opts else 0.0, set(), None, None))
        cands.append(opts)
    m = max(2, int(math.floor(30000 ** (1 / k))))
    cands = [o[:m] if len(o) <= m or o[-1][2] is not None else o[:m - 1] + [o[-1]] for o in cands]
    longe = [ei for ei in range(len(E)) if elen[ei] > 0.5 * w]
    import itertools
    bestc, bestsel = None, None
    for sel in itertools.product(*[range(len(o)) for o in cands]):
        tot = 0.0
        use = np.zeros(len(E), int)
        for s, i in enumerate(sel):
            c, es, _, _ = cands[s][i]
            tot += c
            for e in es:
                use[e] += 1
        for ei in longe:
            if use[ei] == 0:
                tot += 60 + 1.0 * elen[ei] / K
        for ei in np.where(use > 1)[0]:
            tot += (use[ei] - 1) * (60 + 1.0 * elen[ei] / K)
        if bestc is None or tot < bestc:
            bestc, bestsel = tot, sel
    # regions: discs along each path (radius ~1.15 x local half-width), leftovers to the nearest path
    H, W = pm.shape
    lab = np.full(pm.shape, -1, int)
    discs = []
    res = []
    for s, i in enumerate(bestsel):
        c, es, ns, poly = cands[s][i]
        if poly is None:
            discs.append(None)
            res.append(None)
            continue
        dense = resample(poly, max(2, int(plen(poly)) + 1))
        Pi = np.clip(np.round(dense).astype(int), 0, [W - 1, H - 1])
        ev = edt[Pi[:, 1], Pi[:, 0]]
        med = float(np.median(ev))
        rad = 1.15 * np.minimum(ev, 1.2 * med) + 1
        dm = np.zeros(pm.shape, np.uint8)
        for (x, y), r in zip(Pi, rad):
            cv2.circle(dm, (int(x), int(y)), int(round(r)), 1, -1)
        dm = dm.astype(bool) & pm
        cc, ncc = ndimage.label(dm, structure=np.ones((3, 3)))
        keep = np.unique(cc[Pi[:, 1], Pi[:, 0]])
        dm = np.isin(cc, keep[keep > 0])
        discs.append(dm)
        lab[Pi[:, 1], Pi[:, 0]] = s
        free = (bool(ndeg[ns[0]] == 1), bool(ndeg[ns[-1]] == 1))
        res.append([None, dm, poly, free, w])
    anyd = np.zeros(pm.shape, bool)
    for dm in discs:
        if dm is not None:
            anyd |= dm
    if (lab >= 0).any():
        _, (iy, ix) = ndimage.distance_transform_edt(lab < 0, return_indices=True)
        near = lab[iy, ix]
    else:
        near = lab
    left = pm & ~anyd
    for s in range(k):
        if res[s] is not None:
            res[s][0] = discs[s] | (left & (near == s))
    note = ' '.join(f'{s + 1}:' + ('-' if bestsel is None or cands[s][i][2] is None else '>'.join(str(n) for n in cands[s][i][2]))
                    for s, i in enumerate(bestsel))
    return res, note


def set_ends(path, reg, trims, w):
    """End handling shared by all medians: drop the last `trim` px at each end (the skeleton bends into the corners
    of a slanted tip, or into the corner of a 横折), then extend straight along the tangent of the next stretch
    until the end sits ~20 units from the edge of the stroke region."""
    path = resample(path, max(2, int(plen(path) / 2) + 1))
    for end in (0, -1):
        L = plen(path)
        cum = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(path, axis=0), axis=1))])
        if end == -1:
            cum = cum[-1] - cum
        trim = min(trims[end], max(0.0, (L - 12 * K) / 3))
        keep = cum >= trim
        if keep.sum() >= 2:
            path = path[keep]
            cum = cum[keep] - trim
        win = min(max(0.5 * w, 12 * K), max(4 * K, 0.35 * plen(path)))
        e = path[0] if end == 0 else path[-1]
        j = int(np.argmin(np.abs(cum - win)))
        t = e - path[j]
        t = t / (np.linalg.norm(t) or 1)
        dist = 0.0
        while dist < 90 * K:
            q = e + t * dist
            xi, yi = int(round(q[0])), int(round(q[1]))
            if not (0 <= yi < reg.shape[0] and 0 <= xi < reg.shape[1]) or not reg[yi, xi]:
                break
            dist += 0.5
        delta = float(np.clip(dist - 20 * K, -30 * K, 110 * K))
        if delta > 0:
            ne = e + t * delta
            path = np.vstack([ne, path]) if end == 0 else np.vstack([path, ne])
        elif delta < 0 and plen(path) > 2 * (-delta) + 8 * K:
            cum2 = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(path, axis=0), axis=1))])
            path = path[cum2 >= -delta] if end == 0 else path[cum2 <= cum2[-1] + delta]
    return path


def path_median(poly, reg, free=(True, True), w=0.0):
    """median of a stroke from its skeleton path (crop px, writing order); ends set ~20 units from the stroke tips.
    An end on a corner / junction first loses the bent last bit of the skeleton (the medial axis turns into the corner),
    then is extended straight."""
    path = poly
    if len(path) > 7:
        kk = np.ones(5) / 5
        sm = np.column_stack([np.convolve(np.pad(path[:, c], 2, mode='edge'), kk, mode='valid') for c in (0, 1)])
        sm[0], sm[-1] = path[0], path[-1]
        path = sm
    path = set_ends(path, reg, tuple(0.3 * w if f else 0.45 * w for f in free), w)
    return rdp(path, 2.5 * K)


# ---------------------------------------------------------------- geometry output
def geom_paths(geom, min_area=6.0):
    """shapely geometry (unit frame, y up) -> list of svg path strings, outers clockwise, holes counter-clockwise"""
    polys = []
    if geom.is_empty:
        return []
    for g in getattr(geom, 'geoms', [geom]):
        if g.geom_type == 'Polygon':
            polys.append(g)
        elif hasattr(g, 'geoms'):
            polys += [h for h in g.geoms if h.geom_type == 'Polygon']
    out = []
    for p in polys:
        if p.area < min_area:
            continue
        p = p.simplify(0.4)
        if p.geom_type == 'Polygon' and len(p.interiors):
            p = Polygon(p.exterior, [r for r in p.interiors if Polygon(r).area >= min_area])
        p = shp_orient(p, sign=-1.0)
        if p.is_empty or p.geom_type != 'Polygon' or p.area < min_area:
            continue
        rings = [p.exterior] + list(p.interiors)
        rs = []
        for r in rings:
            q = [(int(round(x)), int(round(y))) for x, y in list(r.coords)[:-1]]
            q = [pt for i, pt in enumerate(q) if pt != q[i - 1]]
            if len(q) >= 3:
                rs.append('M' + ' L'.join(f'{x} {y}' for x, y in q) + ' Z')
        if rs:
            out.append(' '.join(rs))
    return out


def region_geom(mask_crop, x0, y0):
    """pixel region (boolean crop mask) -> shapely polygon in the unit frame, grown a hair to close seams"""
    m = mask_crop.astype(np.uint8)
    cnts, hier = cv2.findContours(m, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    if hier is None:
        return Polygon()
    cs = [np.array([px_to_unit(X + x0, Y + y0) for X, Y in c[:, 0, :]]) for c in cnts]
    polys = []
    for i, c in enumerate(cs):
        if hier[0][i][3] >= 0 or len(c) < 3:
            continue
        holes = [cs[j] for j in range(len(cs)) if hier[0][j][3] == i and len(cs[j]) >= 3]
        polys.append(Polygon(c, holes).buffer(0))
    return unary_union(polys).buffer(0.6, join_style=2) if polys else Polygon()


# ---------------------------------------------------------------- per character
def quota_labels(C, mlen, nP, w=30.0):
    """Global labelling of skeleton points with soft per-stroke length quotas (a stroke's labelled skeleton
    length should be about its median length, +-25%): min-cost assignment as an LP with slack. C: ns x nP cost
    in units. Returns label per point."""
    ns = C.shape[0]
    a = 1.15 / K
    q = np.maximum(mlen - 35, 15.0)
    q = q * (nP * a) / q.sum()
    nv = ns * nP + 2 * ns
    c = np.concatenate([C.ravel(), np.full(2 * ns, w)])
    # equality: each point exactly once
    r = np.tile(np.arange(nP), ns)
    cidx = np.arange(ns * nP)
    Aeq = coo_matrix((np.ones(ns * nP), (r, cidx)), shape=(nP, nv)).tocsr()
    beq = np.ones(nP)
    rows, cols, vals = [], [], []
    for s in range(ns):
        base = s * nP
        for sign, row in ((1, 2 * s), (-1, 2 * s + 1)):
            rows += [row] * nP
            cols += list(range(base, base + nP))
            vals += [sign * a] * nP
        rows += [2 * s, 2 * s + 1]
        cols += [ns * nP + s, ns * nP + ns + s]
        vals += [-1.0, -1.0]
    Aub = coo_matrix((vals, (rows, cols)), shape=(2 * ns, nv)).tocsr()
    bub = np.empty(2 * ns)
    bub[0::2] = 1.25 * q
    bub[1::2] = -0.75 * q
    res = linprog(c, A_ub=Aub, b_ub=bub, A_eq=Aeq, b_eq=beq, bounds=(0, None), method='highs')
    if res.status != 0:
        return C.argmin(0)
    return res.x[:ns * nP].reshape(ns, nP).argmax(0)


PCOS = 0.65


def build_char(font, ch, d, ov, dbg=None):
    if ov.get('brush'):
        return None, 'forced brush fallback'
    pieces = glyph_pieces(font, ch)
    if not pieces:
        return None, 'no glyph in font'
    pmask = [p['mask'] for p in pieces]
    glyph = np.zeros((N, N), bool)
    for m in pmask:
        glyph |= m
    ys, xs = np.nonzero(glyph)
    gx0, gx1, gy0, gy1 = xs.min(), xs.max(), ys.min(), ys.max()

    spolys = [[to_px(p) for p in flatten_path(s)] for s in d['strokes']]
    allp = np.vstack([q for p in spolys for q in p])
    X0, Y0 = allp.min(0)
    X1, Y1 = allp.max(0)
    sx, sy = (gx1 - gx0) / max(1, X1 - X0), (gy1 - gy0) / max(1, Y1 - Y0)

    def tf(a, dx=0.0, dy=0.0):
        return np.column_stack([gx0 + (a[:, 0] - X0) * sx + dx, gy0 + (a[:, 1] - Y0) * sy + dy])

    q = 4
    small = cv2.resize(glyph.astype(np.uint8), (N // q, N // q), interpolation=cv2.INTER_AREA) > 0

    def iou(dx, dy):
        m = fill([tf(p, dx, dy) for s in spolys for p in s], (N // q, N // q), 1 / q)
        return (m & small).sum() / ((m | small).sum() or 1)
    _, bx, by = max((iou(dx, dy), dx, dy) for dx in range(-48 * K, 48 * K + 1, 8 * K) for dy in range(-48 * K, 48 * K + 1, 8 * K))
    _, gdx, gdy = max((iou(dx, dy), dx, dy) for dx in range(bx - 6 * K, bx + 6 * K + 1, 2 * K) for dy in range(by - 6 * K, by + 6 * K + 1, 2 * K))

    meds0 = [tf(to_px(m), gdx, gdy) for m in d['medians']]
    ns, npc = len(meds0), len(pieces)
    cent = np.array([m.mean(0) for m in meds0])
    mlen = np.array([np.linalg.norm(np.diff(m, axis=0), axis=1).sum() / K for m in meds0])

    sk = [piece_skeleton(m) for m in pmask]
    P = np.vstack([s[0] for s in sk])
    D = np.vstack([s[1] for s in sk])
    pid = np.concatenate([[i] * len(s[0]) for i, s in enumerate(sk)])
    meds1 = warp_align(meds0, P, D)
    T = align(meds1, P, D, cent, (40, 34, 28))
    meds = [meds1[s] + T[s] for s in range(ns)]
    S = [samples(m, 4 * K) for m in meds]
    strees = [cKDTree(s[0]) for s in S]

    # label every skeleton point by the nearest direction-compatible aligned median
    Rl = 44 * K
    cd = np.full((ns, len(P)), np.inf)
    for s in range(ns):
        _, cd[s] = compat(P, D, strees[s], S[s][0], S[s][1], Rl, PCOS)
    lab = cd.argmin(0)
    valid = np.isfinite(cd.min(0))
    # relaxed cost for the leftovers and for re-labelling inside a piece: direction-free distance as a fallback
    C2 = np.full((ns, len(P)), np.inf)
    for s in range(ns):
        _, c1 = compat(P, D, strees[s], S[s][0], S[s][1], 100 * K, 0.5)
        C2[s] = np.where(np.isfinite(c1), c1, strees[s].query(P)[0] + 60 * K)
    lab = np.where(valid, lab, C2.argmin(0))
    if WARP['lp']:
        lab = quota_labels(np.minimum(C2 / K, 140.0), mlen, len(P))
        valid = np.ones(len(P), bool)
    # a stroke's labelled skeleton must form one connected body (plus parts touching it): isolated little
    # clusters far from the main body are leaks of a badly warped median -> give the points to the next best stroke
    for _ in range(2):
        for s in range(ns):
            idx = np.where(valid & (lab == s))[0]
            if len(idx) < 3:
                continue
            tr = cKDTree(P[idx])
            pr = np.array(sorted(tr.query_pairs(30 * K)))
            g = csr_matrix((np.ones(len(pr)), (pr[:, 0], pr[:, 1])), shape=(len(idx), len(idx))) if len(pr) else csr_matrix((len(idx), len(idx)))
            nc, comp = connected_components(g, directed=False)
            if nc < 2:
                continue
            sizes = np.bincount(comp, minlength=nc)
            main = int(sizes.argmax())
            dm, _ = cKDTree(P[idx[comp == main]]).query(P[idx])
            for c in range(nc):
                if c == main:
                    continue
                m = comp == c
                alt = np.delete(C2[:, idx[m]], s, axis=0).min(0).mean()
                if dm[m].min() > 35 * K and sizes[c] < 0.6 * sizes[main] and alt - C2[s, idx[m]].mean() < 40 * K:
                    for i in idx[m]:
                        cdi = cd[:, i].copy()
                        cdi[s] = np.inf
                        if np.isfinite(cdi.min()):
                            lab[i] = int(cdi.argmin())
                        else:
                            c2 = C2[:, i].copy()
                            c2[s] = np.inf
                            lab[i] = int(c2.argmin())
                            valid[i] = False
                    cd[s, idx[m]] = np.inf

    if WARP['lp']:
        valid[:] = True
    note = []
    allowed = []
    cnts = np.array([np.bincount(lab[pid == p][valid[pid == p]], minlength=ns) for p in range(npc)])
    tot = cnts.sum(0).clip(1)
    if os.environ.get('HZ_DBG'):
        print(ch, 'mlen', np.round(mlen).astype(int).tolist(), 'q-total', int(len(P) * 1.15 / K), '\n' + '\n'.join(f'  p{p}: ' + ' '.join(f'{s + 1}:{int(cnts[p][s] * 1.15 / K)}' for s in range(ns) if cnts[p][s]) for p in range(npc)))
    for p in range(npc):
        units = cnts[p] * 1.15 / K
        thr = np.clip(0.5 * mlen, 12, 24)
        o = [s for s in range(ns) if units[s] >= thr[s] and cnts[p][s] >= 0.1 * tot[s]]
        if not o:
            ix = np.where(pid == p)[0]
            o = [int(units.argmax())] if units.max() > 0 else [int(np.bincount(lab[ix], minlength=ns).argmax())]
        allowed.append(o)
    for key, v in ov.get('pieces', {}).items():
        # [strokes] or {"lines": {"stroke": [[x, y], ...]}}: explicit centre lines (unit frame) that cut the piece
        allowed[int(key)] = [int(s) - 1 for s in (v['lines'] if isinstance(v, dict) else v)]
        note.append(f'override p{key}')
    # every stroke must live somewhere
    for s in range(ns):
        if not any(s in o for o in allowed):
            dist = [strees[s].query(np.argwhere(pmask[p])[::7][:, ::-1].astype(float))[0].mean() for p in range(npc)]
            p = int(np.argmin(dist))
            allowed[p].append(s)
            note.append(f'ADDED {s + 1} to p{p}')

    stroke_mask = [np.zeros((N, N), bool) for _ in range(ns)]
    stroke_core = [np.zeros((N, N), bool) for _ in range(ns)]
    stroke_geoms = [[] for _ in range(ns)]       # svg strings
    stroke_src = [[] for _ in range(ns)]         # ('piece', p) or ('path', poly px full frame, region full mask)
    cuts = []
    for p in range(npc):
        o = sorted(allowed[p])
        if len(o) == 1:
            stroke_mask[o[0]] |= pmask[p]
            stroke_core[o[0]] |= pmask[p]
            stroke_geoms[o[0]].append(pieces[p]['svg'])
            stroke_src[o[0]].append(('piece', p))
            continue
        yy, xx = np.nonzero(pmask[p])
        y0, x0 = max(0, yy.min() - 12), max(0, xx.min() - 12)
        y1, x1 = yy.max() + 13, xx.max() + 13
        pm = pmask[p][y0:y1, x0:x1]
        pov = ov.get('pieces', {}).get(str(p))
        refs = []
        for s in o:
            if isinstance(pov, dict) and str(s + 1) in pov['lines']:
                refs.append(np.array([unit_to_px(x, y) for x, y in pov['lines'][str(s + 1)]], float) - (x0, y0))
            else:
                refs.append(meds[s] - (x0, y0))
        can_skip = [any(s in allowed[q] for q in range(npc) if q != p) for s in o]
        r = partition_piece(pm, refs, can_skip)
        if r is None:
            note.append(f'NOGRAPH p{p}')
            continue
        res_p, pnote = r
        cuts.append('+'.join(str(s + 1) for s in o) + f'@p{p}[{pnote}]')
        pg = Polygon(pieces[p]['outer'], pieces[p]['holes']).buffer(0)
        for kk, s in enumerate(o):
            if res_p[kk] is None:
                note.append(f'SKIP {s + 1}@p{p}')
                continue
            reg, core, poly, free, pw = res_p[kk]
            if not reg.any():
                note.append(f'EMPTY {s + 1}@p{p}')
                continue
            stroke_mask[s][y0:y1, x0:x1] |= reg
            stroke_core[s][y0:y1, x0:x1] |= core
            full = np.zeros((N, N), bool)
            full[y0:y1, x0:x1] = reg
            stroke_src[s].append(('path', poly + (x0, y0), full, free, pw))
            stroke_geoms[s] += geom_paths(pg.intersection(region_geom(reg, x0, y0)))

    if dbg:
        debug_tile(dbg, ch, pieces, P, lab, valid, pid, meds, allowed)
    issues = []
    out_strokes, out_meds = [], []
    for s in range(ns):
        if not stroke_mask[s].any() or not stroke_geoms[s]:
            return None, f'stroke {s + 1} got no shape; ' + '; '.join(note)
        cc, nc = ndimage.label(stroke_mask[s], structure=np.ones((3, 3)))
        mk = stroke_mask[s]
        if nc > 1:
            sz = np.bincount(cc.ravel())[1:]
            mk = np.isin(cc, [i + 1 for i in range(nc) if sz[i] >= max(150 * K * K, 0.25 * sz.max())])
        paths = [x for x in stroke_src[s] if x[0] == 'path']
        if len(stroke_src[s]) == 1 and paths:
            med = path_median(paths[0][1], paths[0][2], paths[0][3], paths[0][4])
        elif paths:
            # path part(s) plus whole pieces: skeleton of the clean core (path discs + pieces), not of the leftovers
            core = stroke_core[s]
            cc2, nc2 = ndimage.label(core, structure=np.ones((3, 3)))
            if nc2 > 1:
                sz = np.bincount(cc2.ravel())[1:]
                core = np.isin(cc2, [i + 1 for i in range(nc2) if sz[i] >= max(150 * K * K, 0.25 * sz.max())])
            med = stroke_median(core, meds[s], meds0[s][-1] - meds0[s][0])
        else:
            med = stroke_median(mk, meds[s], meds0[s][-1] - meds0[s][0])
        mu = [[int(round(x)), int(round(y))] for x, y in (px_to_unit(X, Y) for X, Y in med)]
        # drop consecutive duplicates
        mu = [pt for i, pt in enumerate(mu) if i == 0 or pt != mu[i - 1]]
        if len(mu) < 2:
            mu = [mu[0], [mu[0][0] + 2, mu[0][1]]]
        out_meds.append(mu)
        out_strokes.append(' '.join(stroke_geoms[s]))
        # does the new median follow the aligned brush median?
        mp = np.array([unit_to_px(x, y) for x, y in mu], float)
        a = samples(mp, 6 * K)[0]
        dm = strees[s].query(a)[0].mean() / K
        b = np.array(S[s][0])
        dm2 = cKDTree(a).query(b)[0].mean() / K
        if max(dm, dm2) > 24:
            issues.append(f'{s + 1}({max(dm, dm2):.0f})')
        # start must be nearer the brush start than the end
        if np.dot(mp[-1] - mp[0], meds0[s][-1] - meds0[s][0]) < 0:
            issues.append(f'{s + 1}REV')
    if npc != ns:
        note.append(f'{npc} pieces/{ns} strokes')
    if cuts:
        note.append('cut ' + ','.join(cuts))
    if issues:
        note.append('CHECK ' + ' '.join(issues))
    res = {'strokes': out_strokes, 'medians': out_meds}
    # 'human' reference strokes for the quiz acceptance test: the MMAH brush median of each stroke fitted to the FINAL
    # stroke shape (anisotropic scale + translation, start from the registration; cost = distance to the shape plus
    # the median's extent matching the shape's extent minus 20 units), i.e. what a person writing that stroke does
    hum = []
    for s in range(ns):
        mk2 = stroke_mask[s]
        dt = cv2.distanceTransform((~mk2).astype(np.uint8), cv2.DIST_L2, 5) / K
        yy, xx = np.nonzero(mk2)
        bb = np.array([xx.min(), yy.min(), xx.max(), yy.max()], float) / K
        bb += np.array([20, 20, -20, -20])
        pts0 = samples(meds0[s], 6 * K)[0] / K
        c0 = pts0.mean(0)
        ext0 = pts0.max(0) - pts0.min(0)

        def tr(prm, base=pts0):
            sx_, sy_, tx_, ty_ = prm
            return (base - c0) * (sx_ / 100.0, sy_ / 100.0) + c0 + (tx_, ty_)

        def cost(prm):
            q_ = tr(prm)
            xi = np.clip(np.round(q_[:, 0] * K).astype(int), 0, N - 1)
            yi = np.clip(np.round(q_[:, 1] * K).astype(int), 0, N - 1)
            c = dt[yi, xi].mean()
            for k in (0, 1):
                if ext0[k] > 60:
                    c += 0.4 * (abs(q_[:, k].min() - bb[k]) + abs(q_[:, k].max() - bb[k + 2]))
            return c + 0.2 * max(0.0, 50 - prm[0]) + 0.2 * max(0.0, 50 - prm[1])
        best = None
        for sx0 in (0.8, 1.0, 1.25):
            for sy0 in (0.8, 1.0, 1.25):
                x0_ = np.array([sx0 * 100, sy0 * 100, 0, 0], float)
                simp = np.vstack([x0_] + [x0_ + np.eye(4)[k] * st for k, st in enumerate((12, 12, 20, 20))])
                r = minimize(cost, x0_, method='Nelder-Mead', options={'initial_simplex': simp, 'xatol': 0.3, 'fatol': 0.02, 'maxiter': 800})
                if best is None or r.fun < best.fun:
                    best = r
        hum.append(tr(best.x) * K)
    res['_reg'] = [[[int(round(x)), int(round(y))] for x, y in (px_to_unit(X, Y) for X, Y in m)] for m in hum]
    if 'radStrokes' in d:
        res['radStrokes'] = d['radStrokes']
    return res, '; '.join(note)


# ---------------------------------------------------------------- debug + verification sheets
PAL = [(239, 97, 88), (246, 166, 35), (69, 196, 109), (59, 155, 242), (180, 120, 240), (240, 220, 80),
       (240, 240, 80), (160, 200, 90), (160, 160, 200), (120, 200, 90), (120, 160, 255), (255, 160, 120),
       (90, 200, 160), (200, 120, 200), (120, 150, 255)]    # RGB; used as is for BGR drawing below (order irrelevant)


def debug_tile(path, ch, pieces, P, lab, valid, pid, meds, allowed):
    t = np.full((N, N, 3), 245, np.uint8)
    for i, p in enumerate(pieces):
        col = np.array([160 + 18 * ((i * 7) % 5), 230 - 15 * ((i * 3) % 6), 170 + 14 * ((i * 5) % 5)], np.uint8)
        t[p['mask']] = col
    for i in range(len(P)):
        c = PAL[lab[i] % len(PAL)]
        cv2.circle(t, (int(P[i, 0]), int(P[i, 1])), 3 if valid[i] else 2, c if valid[i] else (0, 0, 0), -1)
    for s, m in enumerate(meds):
        cv2.polylines(t, [np.round(m).astype(np.int32)], False, (0, 0, 0), 2)
        cv2.putText(t, str(s + 1), tuple(np.round(m[0]).astype(int) + (6, -6)), cv2.FONT_HERSHEY_SIMPLEX, 1.6, PAL[s % len(PAL)], 5)
    for i, p in enumerate(pieces):
        yy, xx = np.nonzero(p['mask'])
        cv2.putText(t, f'p{i}:' + ','.join(str(s + 1) for s in sorted(allowed[i])), (int(xx.mean()) - 40, int(yy.mean())),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 0, 0), 3)
    cv2.imwrite(path, cv2.resize(t, (560, 560), interpolation=cv2.INTER_AREA))


def raster_nonzero(paths, M=N // 2):
    """svg paths (unit frame) -> boolean mask (M x M, nonzero rule) and the lowest winding number seen"""
    acc = np.zeros((M, M), np.int16)
    sc = M / N
    for dpath in paths:
        for poly in flatten_path(dpath):
            m = fill([to_px(poly)], (M, M), sc)
            acc += m.astype(np.int16) * (1 if signed_area(poly) < 0 else -1)
    return acc != 0, int(acc.min())


def tile_for(strokes, medians, cell):
    M = N // 2
    sc = M / N
    tile = np.full((M, M, 3), 26, np.uint8)
    worst = 0
    for si, p in enumerate(strokes):
        m, mn = raster_nonzero([p], M)
        worst = min(worst, mn)
        col = np.array(PAL[si % len(PAL)][::-1], np.uint8)
        tile[m] = (0.25 * tile[m] + 0.75 * col).astype(np.uint8)
    for si, m in enumerate(medians):
        pts = to_px(m) * sc
        cv2.polylines(tile, [np.round(pts).astype(np.int32)], False, (255, 255, 255), 3, cv2.LINE_AA)
        cv2.circle(tile, tuple(np.round(pts[0]).astype(int)), 8, (255, 255, 255), -1, cv2.LINE_AA)
        org = tuple(np.round(pts[0] + (11, -11)).astype(int))
        cv2.putText(tile, str(si + 1), org, cv2.FONT_HERSHEY_SIMPLEX, 1.7, (0, 0, 0), 11, cv2.LINE_AA)
        cv2.putText(tile, str(si + 1), org, cv2.FONT_HERSHEY_SIMPLEX, 1.7, (255, 255, 255), 4, cv2.LINE_AA)
    return cv2.resize(tile, (cell, cell), interpolation=cv2.INTER_AREA), worst


def verify_sheets(chars, src, out, prefix, per=12, cols=3, cell=280):
    files = []
    for si in range(0, len(chars), per):
        grp = chars[si:si + per]
        rows = math.ceil(len(grp) / cols)
        img = np.full((rows * cell, cols * 2 * cell, 3), 12, np.uint8)
        for i, ch in enumerate(grp):
            r, c = divmod(i, cols)
            a, _ = tile_for(src[ch]['strokes'], src[ch]['medians'], cell)
            b, worst = tile_for(out[ch]['strokes'], out[ch]['medians'], cell)
            if worst < 0:
                print(f'WARNING {ch}: negative winding {worst}')
            x = c * 2 * cell
            img[r * cell:(r + 1) * cell, x:x + cell] = a
            img[r * cell:(r + 1) * cell, x + cell:x + 2 * cell] = b
            cv2.rectangle(img, (x, r * cell), (x + 2 * cell - 1, (r + 1) * cell - 1), (90, 90, 90), 1)
            cv2.line(img, (x + cell, r * cell), (x + cell, (r + 1) * cell), (90, 90, 90), 1)
            cv2.putText(img, ch, (x + 4, r * cell + 18), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (160, 160, 160), 1)
        f = CACHE / f'{prefix}-{si // per + 1}.png'
        cv2.imwrite(str(f), img)
        files.append(f)
    return files


# ---------------------------------------------------------------- driver
_FONT = None
_SRC = None
_OV = None
_DBG = None


def _work(ch):
    global _FONT
    if _FONT is None:
        _FONT = load_font(list(_SRC))
    dbg = f'/tmp/hzwk/dbg-{ord(ch):x}.png' if _DBG else None
    t0 = time.time()
    res, note = build_char(_FONT, ch, _SRC[ch], _OV.get(ch, {}), dbg)
    return ch, res, note, time.time() - t0


def drop_detached(res):
    """Remove parts of a stroke's outline that are detached from the stroke body (never touched by
    its own median). They are copies of another stroke's tip and would flash as a loose blob."""
    from shapely.geometry import LineString
    for i, (path, med) in enumerate(zip(res['strokes'], res['medians'])):
        subs = re.findall(r'M[^M]*', path)
        if len(subs) < 2:
            continue
        polys = []
        for sp in subs:
            pts = flatten_path(sp)
            polys.append(Polygon(pts[0]).buffer(0) if pts and len(pts[0]) >= 3 else None)
        body = LineString(med if len(med) > 1 else med * 2).buffer(18)
        outer = [k for k, g in enumerate(polys) if g is not None and not g.is_empty]
        # connected groups of sub-shapes (touching or overlapping)
        groups, seen = [], set()
        for k in outer:
            if k in seen:
                continue
            grp, stack = [], [k]
            seen.add(k)
            while stack:
                a = stack.pop(); grp.append(a)
                for b in outer:
                    if b not in seen and polys[a].buffer(1).intersects(polys[b]):
                        seen.add(b); stack.append(b)
            groups.append(grp)
        if len(groups) < 2:
            continue
        geo = []
        for j, op in enumerate(res['strokes']):
            qs = [flatten_path(x) for x in re.findall(r'M[^M]*', op)]
            geo.append(unary_union([Polygon(q[0]).buffer(0) for q in qs if q and len(q[0]) >= 3]) if j != i else None)
        drop = set()
        for grp in groups:
            g = unary_union([polys[k] for k in grp])
            if g.intersects(body):
                continue
            # a detached copy of another stroke's tip: hand it to the stroke it overlaps most
            best = max(((gj.intersection(g).area, j) for j, gj in enumerate(geo) if gj is not None), default=(0, -1))
            if best[1] < 0 or best[0] < 0.5 * g.area:
                continue
            res['strokes'][best[1]] = res['strokes'][best[1]] + ' ' + ' '.join(subs[k].strip() for k in grp)
            drop.update(grp)
        if drop:
            res['strokes'][i] = ' '.join(sp.strip() for k, sp in enumerate(subs) if k not in drop)
    return res


def main():
    global _SRC, _OV, _DBG
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    _DBG = '--debug' in sys.argv
    preview = ''.join(args)
    _SRC = src = json.loads(SRC.read_text(encoding='utf-8'))
    ovf = ROOT / 'tools' / 'sans-overrides.json'
    _OV = json.loads(ovf.read_text(encoding='utf-8')) if ovf.exists() else {}
    chars = [c for c in src if not preview or c in preview]
    load_font(list(src))                    # make sure the instanced font exists before forking
    out, notes, reg = {}, {}, {}
    t0 = time.time()
    if _DBG:
        pathlib.Path('/tmp/hzwk').mkdir(exist_ok=True)
    with mp.get_context("fork").Pool(min(len(chars), max(1, (mp.cpu_count() or 4) - 2))) as pool:
        for ch, res, note, dt in pool.imap_unordered(_work, chars):
            if res is None:
                out[ch] = src[ch]
                notes[ch] = f'BRUSH FALLBACK ({note})'
            else:
                reg[ch] = res.pop('_reg')
                out[ch] = res
                if note:
                    notes[ch] = note
    print(f'built {len(chars)} chars in {time.time() - t0:.0f}s')
    hf = CACHE / 'human-strokes.json'
    hs = json.loads(hf.read_text(encoding='utf-8')) if hf.exists() else {}
    hs.update(reg)
    hf.write_text(json.dumps(hs, ensure_ascii=False), encoding='utf-8')
    if preview:
        (CACHE / 'sans-preview.json').write_text(json.dumps(out, ensure_ascii=False), encoding='utf-8')
    if not preview:
        target = ROOT / 'data' / 'strokes.js'
        for c in out:
            drop_detached(out[c])
        target.write_text('window.HZ_STROKES = ' + json.dumps({c: out[c] for c in src}, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8')
        print('wrote', target, target.stat().st_size, 'bytes')
    prefix = 'verify-preview' if preview else 'verify'
    for k in CACHE.glob(f'{prefix}-*.png'):
        k.unlink()
    files = verify_sheets(chars, src, out, prefix)
    for c in chars:
        if c in notes:
            print(f'{c}: {notes[c]}')
    print('\n'.join(str(f) for f in files))


if __name__ == '__main__':
    main()
