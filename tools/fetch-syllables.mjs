#!/usr/bin/env node
/*
 * Download single-syllable recordings (exact tone) for every syllable used in data/lessons.js.
 * Source: github.com/davinfifield/mp3-chinese-pinyin-sound (Unlicense / public domain),
 * file names like wo3.mp3, yi2.mp3; ü is written "uu" (luu3 = lǚ). Few neutral-tone files exist,
 * the app falls back to the whole word for those.
 * Output: audio/syl/<key>.mp3 and data/syl.js  (window.HZ_SYL = {key: path}).
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const T = require(path.join(ROOT, 'js/text.js'));
const BASE = 'https://raw.githubusercontent.com/davinfifield/mp3-chinese-pinyin-sound/master/mp3/';

export function sylKey(syl, tone) {
  const b = T.bare(syl).toLowerCase().replace(/ü/g, 'uu').replace(/[^a-z]/g, '');
  return b ? `${b}${tone}` : null;
}

const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'data/lessons.js'), 'utf8'), ctx);
const keys = new Set();
for (const l of ctx.window.HZ_LESSONS) {
  for (const it of l.items) {
    for (const c of T.charList(T.parse(it.s))) {
      if (c.syl === 'r') continue;
      const k = sylKey(c.syl, c.tone);
      if (k) keys.add(k);
      // characters with tone sandhi also get their base tone (一 yī, 不 bù)
      if (c.ch === '一') keys.add('yi1');
      if (c.ch === '不') keys.add('bu4');
    }
  }
}

const outDir = path.join(ROOT, 'audio/syl');
fs.mkdirSync(outDir, { recursive: true });
const map = {}; const missing = [];
await Promise.all([...keys].sort().map(async (k) => {
  const file = path.join(outDir, `${k}.mp3`);
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) {
    const res = await fetch(BASE + k + '.mp3');
    if (!res.ok) { missing.push(k); return; }
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  map[k] = `audio/syl/${k}.mp3`;
}));
const sorted = Object.fromEntries(Object.entries(map).sort());
fs.writeFileSync(path.join(ROOT, 'data/syl.js'), `window.HZ_SYL = ${JSON.stringify(sorted)};\n`);
console.log(`syllables: ${keys.size}, downloaded/kept: ${Object.keys(map).length}, missing (word audio fallback): ${missing.sort().join(' ') || 'none'}`);
