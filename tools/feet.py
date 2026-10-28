#!/usr/bin/env python3
"""Handwriting fix for print fonts: in a closed box like 口 / 日 the font ends the right-hand
横折 flush with the bottom 横, while the left 竖 pokes out below it. In handwriting (and in the
textbook) the 横折's vertical also comes down to the same "foot". This pass finds those boxes and
extends the 横折 down to the left foot's level, outline and median.

Works on final data (unit frame, y up). Used by build-sans.py after the other post-steps;
can also be run alone:  tools/.venv/bin/python tools/feet.py [data/strokes.js]
"""
import json
import math
import pathlib
import re
import sys

from shapely.geometry import Polygon, box
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))


def _geom(path):
    import importlib.util
    spec = importlib.util.spec_from_file_location('bs', pathlib.Path(__file__).with_name('build-sans.py'))
    global _bs
    if '_bs' not in globals():
        _bs = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(_bs)
    return _bs.stroke_geom(path), _bs


def _dir(a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    n = math.hypot(dx, dy) or 1
    return dx / n, dy / n


def _end_dir(m, first):
    pts = m if first else m[::-1]
    a = pts[0]
    b = next((q for q in pts[1:] if math.hypot(q[0] - a[0], q[1] - a[1]) > 30), pts[-1])
    return _dir(a, b) if first else _dir(b, a)


def match_feet(res, log=None):
    meds = res['medians']
    gs = []
    for p in res['strokes']:
        g, bs = _geom(p)
        gs.append(g)
    changed = []
    for i, mi in enumerate(meds):
        if len(mi) < 3:
            continue
        sx, sy = _end_dir(mi, True)
        ex, ey = _end_dir(mi, False)
        if not (sx > 0.85 and ey < -0.85):          # 横折: starts going right, ends going down
            continue
        E = mi[-1]
        for j in range(i + 1, len(meds)):           # the closing bottom 横, written later
            mj = meds[j]
            jx, jy = _dir(mj[0], mj[-1])
            if not (jx > 0.9 and abs(E[0] - mj[-1][0]) < 70 and abs(E[1] - mj[-1][1]) < 60):
                continue
            for k in range(i):                      # the left 竖, written earlier
                mk = meds[k]
                kx, ky = _dir(mk[0], mk[-1])
                if not (ky < -0.9 and abs(mk[-1][0] - mj[0][0]) < 70 and mk[0][1] > mj[0][1] + 60):
                    continue
                # local vertical extents near each foot
                band_j_right = gs[j].intersection(box(E[0] - 60, -300, E[0] + 60, 1100))
                band_j_left = gs[j].intersection(box(mk[-1][0] - 60, -300, mk[-1][0] + 60, 1100))
                if band_j_right.is_empty or band_j_left.is_empty:
                    continue
                j_bot = band_j_right.bounds[1]
                kb = gs[k].intersection(box(mk[-1][0] - 60, -300, mk[-1][0] + 60, band_j_left.bounds[3]))
                ib = gs[i].intersection(box(E[0] - 80, -300, E[0] + 80, 1100))
                if kb.is_empty or ib.is_empty:
                    continue
                k_bot = kb.bounds[1]
                i_bot = ib.bounds[1]
                if not all(math.isfinite(v) for v in (k_bot, i_bot, j_bot)):
                    continue
                foot = j_bot - k_bot                # how far the left 竖 pokes out below the 横
                if foot < 12 or j_bot - i_bot > 0.4 * foot:
                    continue
                # x-extent of the 横折's vertical just above the bottom 横
                top_j = band_j_right.bounds[3]
                vert = gs[i].intersection(box(E[0] - 90, top_j + 4, E[0] + 90, top_j + 50))
                if vert.is_empty:
                    continue
                xa, _, xb, _ = vert.bounds
                if xb - xa < 15 or xb - xa > 140:
                    continue
                ext = box(xa, k_bot, xb, top_j + 6)
                gs[i] = unary_union([gs[i], ext])
                d = foot
                meds[i] = mi[:-1] + [[mi[-1][0], round(mi[-1][1] - d)]]
                changed.append((i + 1, round(foot)))
                break
            else:
                continue
            break
    if changed:
        for i, _ in changed:
            g = orient(gs[i - 1], -1.0) if gs[i - 1].geom_type == 'Polygon' else gs[i - 1]
            res['strokes'][i - 1] = ' '.join(_bs.geom_paths(g))
        if log is not None:
            log.extend(changed)
    return res


if __name__ == '__main__':
    p = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'data/strokes.js')
    d = json.loads(re.search(r'=\s*(\{.*\})\s*;', p.read_text(encoding='utf-8'), re.S).group(1))
    for ch, v in d.items():
        log = []
        match_feet(v, log)
        if log:
            print(ch, log)
    out = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else p
    out.write_text('window.HZ_STROKES = ' + json.dumps(d, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8')
