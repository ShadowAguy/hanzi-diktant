#!/usr/bin/env node
/**
 * Offline data pipeline for hanzi-diktant.
 * Run from repo root: node tools/build-data.mjs [--no-audio]
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { Converter } from 'opencc-js';

const __filename = fileURLToPath(import.meta.url);
const TOOLS = path.dirname(__filename);
const ROOT = path.resolve(TOOLS, '..');
const CACHE = path.join(TOOLS, 'cache');
const require = createRequire(import.meta.url);
const HZText = require(path.join(ROOT, 'js/text.js'));

const NO_AUDIO = process.argv.includes('--no-audio');
const HAN_RE = /\p{Script=Han}/gu;
const STROKE_BASE = 'https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1';
const DICT_URL = 'https://raw.githubusercontent.com/skishore/makemeahanzi/master/dictionary.txt';
const toTrad = Converter({ from: 'cn', to: 't' });

function log(...args) { console.log(...args); }
function fail(msg) { console.error(msg); process.exit(1); }

function mkdirp(dir) { fs.mkdirSync(dir, { recursive: true }); }

function writeWindow(file, name, obj) {
  mkdirp(path.dirname(file));
  fs.writeFileSync(file, `window.${name} = ${JSON.stringify(obj)};\n`, 'utf8');
}

function countKeys(file) {
  const src = fs.readFileSync(file, 'utf8');
  const m = src.match(/^window\.\w+\s*=\s*/);
  if (!m) return 0;
  return Object.keys(JSON.parse(src.slice(m[0].length).replace(/;\s*$/, ''))).length;
}

async function fetchCached(url, cachePath) {
  if (fs.existsSync(cachePath) && fs.statSync(cachePath).size > 0) {
    return fs.readFileSync(cachePath);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirp(path.dirname(cachePath));
  fs.writeFileSync(cachePath, buf);
  return buf;
}

async function mapPool(items, n, fn) {
  const ret = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      ret[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, () => worker()));
  return ret;
}

function addHan(str, set) {
  const s = String(str || '');
  const re = new RegExp(HAN_RE.source, HAN_RE.flags);
  let m;
  while ((m = re.exec(s))) set.add(m[0]);
}

function loadLessons() {
  const src = fs.readFileSync(path.join(ROOT, 'data/lessons.js'), 'utf8');
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(src, context, { filename: 'lessons.js' });
  const lessons = context.window.HZ_LESSONS;
  const words = context.window.HZ_WORDS;
  if (!Array.isArray(lessons) || !words || typeof words !== 'object') {
    fail('Failed to load HZ_LESSONS / HZ_WORDS from data/lessons.js');
  }
  return { lessons, words };
}

function collectChars(lessons, words) {
  const chars = new Set();
  const tradSources = new Set();
  for (const lesson of lessons) {
    for (const item of lesson.items || []) {
      const tokens = HZText.parse(item.s);
      for (const t of tokens) {
        if (t.t === 'w') {
          addHan(t.h, chars);
          tradSources.add(t.h);
        }
      }
      tradSources.add(HZText.hanziOf(tokens));
      for (const e of item.ex || []) {
        const w = String(e).split('|')[0];
        addHan(w, chars);
        tradSources.add(w);
      }
    }
  }
  for (const key of Object.keys(words)) {
    addHan(key, chars);
    tradSources.add(key);
  }
  return { chars: [...chars].sort(), tradSources: [...tradSources].filter(Boolean) };
}

function collectAudioTexts(lessons, words) {
  const set = new Set();
  for (const lesson of lessons) {
    for (const item of lesson.items || []) {
      for (const t of HZText.audioTexts(item)) {
        if (t) set.add(t);
      }
    }
  }
  for (const key of Object.keys(words)) {
    if (key) set.add(key);
  }
  return [...set];
}

function audioRel(text) {
  const h = createHash('sha1').update(text, 'utf8').digest('hex').slice(0, 12);
  return `audio/${h}.mp3`;
}

function loadUmd(code, filename) {
  const ctx = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    performance: globalThis.performance,
  };
  ctx.globalThis = ctx;
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.global = ctx;
  vm.createContext(ctx);
  vm.runInContext(code, ctx, { filename });
  return ctx;
}

function copyVendor() {
  const vendorDir = path.join(ROOT, 'vendor');
  mkdirp(vendorDir);
  const nm = path.join(TOOLS, 'node_modules');
  const copies = [
    ['hanzi-writer/dist/hanzi-writer.min.js', 'hanzi-writer.min.js'],
    ['pinyin-pro/dist/index.js', 'pinyin-pro.js'],
  ];
  for (const [srcRel, destName] of copies) {
    const src = path.join(nm, srcRel);
    if (!fs.existsSync(src)) fail(`Missing vendor source: ${src}`);
    fs.copyFileSync(src, path.join(vendorDir, destName));
    log(`  vendor/${destName}  (${fs.statSync(path.join(vendorDir, destName)).size} bytes)`);
  }
  return vendorDir;
}

function verifyVendor(vendorDir) {
  const report = {};

  const hw = loadUmd(fs.readFileSync(path.join(vendorDir, 'hanzi-writer.min.js'), 'utf8'), 'hanzi-writer.min.js');
  report.HanziWriter = typeof hw.HanziWriter;

  const pyCode = fs.readFileSync(path.join(vendorDir, 'pinyin-pro.js'), 'utf8');
  const py = loadUmd(pyCode, 'pinyin-pro.js');
  const g = py.pinyinPro;
  if (!g) fail('pinyin-pro.js did not define global pinyinPro');
  const fns = Object.keys(g).sort();
  report.pinyinPro = { global: 'pinyinPro', functions: fns };
  const sample = '我去邮局买邮票';
  report.pinyinPro.pinyinArray = g.pinyin(sample, { type: 'array' });
  if (typeof g.segment === 'function') {
    const OF = g.OutputFormat;
    report.pinyinPro.segment = {
      default: g.segment(sample),
      ZhSegment: OF ? g.segment(sample, { format: OF.ZhSegment }) : undefined,
      AllSegment: OF ? g.segment(sample, { format: OF.AllSegment }) : undefined,
      OutputFormat: OF || null,
    };
  }

  return report;
}

async function fetchStrokes(chars) {
  const dir = path.join(CACHE, 'strokes');
  mkdirp(dir);
  const failed = [];
  const strokes = {};
  await mapPool(chars, 8, async (ch) => {
    const cachePath = path.join(dir, `${encodeURIComponent(ch)}.json`);
    const url = `${STROKE_BASE}/${encodeURIComponent(ch)}.json`;
    try {
      const buf = await fetchCached(url, cachePath);
      strokes[ch] = JSON.parse(buf.toString('utf8'));
    } catch (e) {
      failed.push({ ch, error: String(e.message || e) });
    }
  });
  return { strokes, failed };
}

async function fetchDictionary() {
  const cachePath = path.join(CACHE, 'dictionary.txt');
  const buf = await fetchCached(DICT_URL, cachePath);
  const map = new Map();
  for (const line of buf.toString('utf8').split(/\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      const row = JSON.parse(t);
      if (row && row.character) map.set(row.character, row);
    } catch {
      /* skip bad line */
    }
  }
  return map;
}

function loadCharsRu() {
  const p = path.join(ROOT, 'data/chars-ru.json');
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function buildChars(chars, strokes, dict, ru) {
  const out = {};
  for (const c of chars) {
    const row = dict.get(c) || {};
    const st = strokes[c];
    const etym = row.etymology && typeof row.etymology === 'object' ? row.etymology : null;
    out[c] = {
      readings: Array.isArray(row.pinyin) ? row.pinyin : [],
      en: row.definition || '',
      radical: row.radical || '',
      decomposition: row.decomposition || '',
      etymology: etym,
      strokes: st.strokes.length,
      trad: toTrad(c),
      ru: ru[c] || '',
    };
  }
  return out;
}

function buildTrad(tradSources) {
  const out = {};
  for (const s of tradSources) {
    const t = toTrad(s);
    if (t !== s) out[s] = t;
  }
  return out;
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], ...opts });
    let stdout = '';
    let stderr = '';
    if (opts.input != null) {
      child.stdin.write(opts.input);
      child.stdin.end();
    }
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function ensureVenv() {
  const venv = path.join(TOOLS, '.venv');
  const py = path.join(venv, 'bin', 'python');
  const pip = path.join(venv, 'bin', 'pip');
  if (!fs.existsSync(py)) {
    log('Creating tools/.venv …');
    const r = spawnSync('python3', ['-m', 'venv', venv], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`python3 -m venv failed: ${r.stderr || r.stdout}`);
  }
  log('Installing edge-tts in venv …');
  const r = spawnSync(pip, ['install', '--disable-pip-version-check', '-q', 'edge-tts'], {
    encoding: 'utf8',
    timeout: 180000,
  });
  if (r.status !== 0) throw new Error(`pip install edge-tts failed: ${r.stderr || r.stdout}`);
  return py;
}

async function synthAudio(texts) {
  const audioDir = path.join(ROOT, 'audio');
  mkdirp(audioDir);
  const jobs = texts.map((text) => ({
    text,
    path: path.join(ROOT, audioRel(text)),
  }));
  const pending = jobs.filter((j) => !(fs.existsSync(j.path) && fs.statSync(j.path).size > 0));
  log(`Audio: ${texts.length} texts, ${jobs.length - pending.length} cached, ${pending.length} to synthesize`);
  if (pending.length === 0) return { error: null, synthesized: 0, skipped: jobs.length, failed: 0 };

  let py;
  try {
    py = await ensureVenv();
  } catch (e) {
    return { error: String(e.message || e), synthesized: 0, skipped: jobs.length - pending.length, failed: pending.length };
  }

  const script = path.join(TOOLS, 'synth-audio.py');
  const r = await run(py, [script], { input: JSON.stringify(pending), cwd: ROOT });
  let parsed;
  try {
    parsed = JSON.parse(r.stdout || '{}');
  } catch {
    return {
      error: `edge-tts helper produced non-JSON (exit ${r.code}): ${r.stderr || r.stdout}`.trim(),
      synthesized: 0,
      skipped: jobs.length - pending.length,
      failed: pending.length,
    };
  }
  if (!parsed.ok) {
    return {
      error: parsed.error || r.stderr || `edge-tts failed (exit ${r.code})`,
      synthesized: 0,
      skipped: jobs.length - pending.length,
      failed: pending.length,
    };
  }
  const results = parsed.results || [];
  const ok = results.filter((x) => x.status === 'ok').length;
  const skip = results.filter((x) => x.status === 'skip').length;
  const errItems = results.filter((x) => x.status === 'err');
  const err = errItems.length
    ? `${errItems.length} failed: ${errItems.slice(0, 3).map((x) => `${x.text}: ${x.error}`).join('; ')}`
    : (r.stderr && r.stderr.trim()) || null;
  if (errItems.length && errItems.length === pending.length) {
    return { error: err, synthesized: ok, skipped: skip + (jobs.length - pending.length), failed: errItems.length };
  }
  return { error: errItems.length ? err : null, synthesized: ok, skipped: skip + (jobs.length - pending.length), failed: errItems.length };
}

function writeAudioJs(texts) {
  const map = {};
  for (const text of texts) {
    const rel = audioRel(text);
    const abs = path.join(ROOT, rel);
    if (fs.existsSync(abs) && fs.statSync(abs).size > 0) map[text] = rel;
  }
  writeWindow(path.join(ROOT, 'data/audio.js'), 'HZ_AUDIO', map);
  return Object.keys(map).length;
}

async function main() {
  mkdirp(CACHE);
  mkdirp(path.join(ROOT, 'data'));
  mkdirp(path.join(ROOT, 'vendor'));
  mkdirp(path.join(ROOT, 'audio'));

  const { lessons, words } = loadLessons();
  const { chars, tradSources } = collectChars(lessons, words);
  const audioTexts = collectAudioTexts(lessons, words);
  log(`Lessons: ${lessons.length}, words: ${Object.keys(words).length}, unique Han: ${chars.length}, trad phrases: ${tradSources.length}, audio texts: ${audioTexts.length}`);

  log('Fetching stroke data …');
  const { strokes, failed } = await fetchStrokes(chars);
  if (failed.length) {
    console.error('Stroke fetch failed for:');
    for (const f of failed) console.error(`  ${f.ch}  ${f.error}`);
    process.exitCode = 1;
    fail(`${failed.length} character(s) missing stroke data`);
  }
  // Make Me a Hanzi data is brush style (kaiti). It is only the source for stroke order:
  // tools/build-sans.py re-cuts every character from Noto Sans SC (print style) into data/strokes.js.
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(path.join(CACHE, 'mmah-strokes.json'), JSON.stringify(strokes), 'utf8');
  log(`Wrote tools/cache/mmah-strokes.json (${Object.keys(strokes).length} chars)`);
  const py = path.join(TOOLS, '.venv/bin/python');
  const sans = spawnSync(fs.existsSync(py) ? py : 'python3', [path.join(TOOLS, 'build-sans.py')], { stdio: 'inherit' });
  if (sans.status !== 0) fail('tools/build-sans.py failed (needs tools/.venv with numpy scipy scikit-image opencv-python-headless fonttools)');
  log('Wrote data/strokes.js (print style)');

  log('Fetching Make Me a Hanzi dictionary …');
  const dict = await fetchDictionary();
  const ru = loadCharsRu();
  const charsInfo = buildChars(chars, strokes, dict, ru);
  writeWindow(path.join(ROOT, 'data/chars.js'), 'HZ_CHARS', charsInfo);
  log(`Wrote data/chars.js (${Object.keys(charsInfo).length} chars)`);


  log('Vendoring browser libraries …');
  const vendorDir = copyVendor();
  const vendorReport = verifyVendor(vendorDir);
  log('Vendor verification:');
  log(JSON.stringify(vendorReport, null, 2));

  let audioResult = { error: null, synthesized: 0, skipped: 0, failed: 0 };
  if (NO_AUDIO) {
    log('--no-audio: skipping TTS');
  } else {
    log('Synthesizing audio …');
    audioResult = await synthAudio(audioTexts);
    if (audioResult.error) console.error('Audio error:', audioResult.error);
  }
  const audioCount = writeAudioJs(audioTexts);
  log(`Wrote data/audio.js (${audioCount} entries)`);

  // Spot-checks
  const checks = [];
  const sYou = strokes['邮']?.strokes?.length;
  const sShou = strokes['授']?.strokes?.length;
  checks.push(`HZ_STROKES['邮'].strokes.length = ${sYou} (expect 7)`);
  checks.push(`HZ_STROKES['授'].strokes.length = ${sShou} (expect 11)`);
  checks.push(`HZ_CHARS['的'].readings = ${JSON.stringify(charsInfo['的']?.readings)}`);
  if (sYou !== 7 || sShou !== 11) process.exitCode = 1;

  log('\n=== BUILD SUMMARY ===');
  log(`data/strokes.js  ${countKeys(path.join(ROOT, 'data/strokes.js'))}`);
  log(`data/chars.js    ${countKeys(path.join(ROOT, 'data/chars.js'))}`);
  log(`data/audio.js    ${countKeys(path.join(ROOT, 'data/audio.js'))}`);
  log(`vendor: HanziWriter, pinyinPro`);
  log(`pinyin-pro fns: ${vendorReport.pinyinPro.functions.join(', ')}`);
  log(`pinyin('我去邮局买邮票', {type:'array'}) => ${JSON.stringify(vendorReport.pinyinPro.pinyinArray)}`);
  if (vendorReport.pinyinPro.segment) {
    log(`segment ZhSegment => ${JSON.stringify(vendorReport.pinyinPro.segment.ZhSegment)}`);
    log(`segment AllSegment => ${JSON.stringify(vendorReport.pinyinPro.segment.AllSegment)}`);
  }
  log(`audio: synthesized=${audioResult.synthesized} skipped=${audioResult.skipped} failed=${audioResult.failed} mapped=${audioCount}`);
  if (audioResult.error) log(`audio error: ${audioResult.error}`);
  for (const c of checks) log(c);
  log('Re-run: node tools/build-data.mjs   (or --no-audio)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
