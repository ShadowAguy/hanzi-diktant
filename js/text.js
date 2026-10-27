/*
 * Shared text helpers (browser global `HZText`, Node CommonJS export).
 *
 * Sentence DSL (field `s` of every item):
 *   tokens separated by single spaces;
 *   word token  = hanzi|pinyin, syllables joined by "." (no space in display) or "_" (space in display);
 *                 syllable count must equal hanzi count ("儿" is the syllable "r");
 *   punctuation = token without "|": ， 。 ？ ！ ： ； 、 —— （ ） …
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HZText = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MARKS = {
    'ā': 1, 'á': 2, 'ǎ': 3, 'à': 4,
    'ē': 1, 'é': 2, 'ě': 3, 'è': 4,
    'ī': 1, 'í': 2, 'ǐ': 3, 'ì': 4,
    'ō': 1, 'ó': 2, 'ǒ': 3, 'ò': 4,
    'ū': 1, 'ú': 2, 'ǔ': 3, 'ù': 4,
    'ǖ': 1, 'ǘ': 2, 'ǚ': 3, 'ǜ': 4,
    'ń': 2, 'ň': 3, 'ǹ': 4, 'ḿ': 2,
  };

  // Punctuation that closes an audio/dictation segment (kept in the segment text).
  const SEG_END = new Set(['，', '。', '？', '！', '：', '；', '、', '…']);
  // Punctuation after which a new sentence starts (pinyin gets a capital letter).
  const SENT_END = new Set(['。', '？', '！', '——']);
  const PUNCT_LATIN = {
    '，': ',', '。': '.', '？': '?', '！': '!', '：': ':', '；': ';', '、': ',',
    '——': '—', '（': '(', '）': ')', '…': '…', '“': '“', '”': '”',
  };

  const HAN_RE = /\p{Script=Han}/u;

  function isHan(ch) { return HAN_RE.test(ch); }

  function toneOf(syl) {
    const s = String(syl || '').normalize('NFC').toLowerCase();
    if (s === 'r') return 5;
    for (const ch of s) if (MARKS[ch]) return MARKS[ch];
    return 5;
  }

  // Strip tone marks: "zhōng" -> "zhong"
  function bare(syl) {
    return String(syl || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC')
      .replace(/ü/g, 'ü');
  }

  // Put tone `tone` (1-5) on a toneless syllable, e.g. ("hao", 3) -> "hǎo"
  function withTone(syl, tone) {
    const s = bare(syl);
    if (!tone || tone === 5) return s;
    const combining = ['', '\u0304', '\u0301', '\u030C', '\u0300'][tone];
    const lower = s.toLowerCase();
    let idx = -1;
    if (lower.includes('a')) idx = lower.indexOf('a');
    else if (lower.includes('e')) idx = lower.indexOf('e');
    else if (lower.includes('ou')) idx = lower.indexOf('o');
    else {
      for (let i = lower.length - 1; i >= 0; i--) {
        if ('aeiouü'.includes(lower[i])) { idx = i; break; }
      }
    }
    if (idx < 0) return s;
    return (s.slice(0, idx + 1) + combining + s.slice(idx + 1)).normalize('NFC');
  }

  function parse(s) {
    const tokens = [];
    const raw = String(s || '').trim().split(/\s+/).filter(Boolean);
    for (const tok of raw) {
      const bar = tok.indexOf('|');
      if (bar < 0) { tokens.push({ t: 'p', h: tok }); continue; }
      const h = tok.slice(0, bar);
      const p = tok.slice(bar + 1);
      const chars = Array.from(h);
      const syl = [];
      const joins = [];
      let cur = '';
      for (const c of p) {
        if (c === '.' || c === '_') { syl.push(cur); joins.push(c === '_' ? ' ' : ''); cur = ''; }
        else cur += c;
      }
      syl.push(cur);
      if (syl.length !== chars.length) {
        throw new Error(`Syllable count mismatch in token "${tok}": ${chars.length} hanzi vs ${syl.length} syllables`);
      }
      tokens.push({
        t: 'w', h, chars, syl, joins,
        tones: syl.map(toneOf),
        p: syl.reduce((acc, x, i) => acc + (i ? joins[i - 1] : '') + x, ''),
      });
    }
    return tokens;
  }

  function hanziOf(tokens) {
    return tokens.map((t) => t.h).join('');
  }

  // Pinyin apostrophe before a/o/e-initial syllables inside a word: nǚ'ér, Xī'ān
  function needsApos(syl) { return /^[aoeāáǎàōóǒòēéěè]/i.test(String(syl || '').normalize('NFC')); }

  function capFirst(str) {
    if (!str) return str;
    const first = str.charAt(0);
    return first.toUpperCase() + str.slice(1);
  }

  /**
   * Pinyin rendering of a token list.
   * Returns an array of pieces: {kind:'w', text, ti, si} (one per syllable, with spacing info)
   * and {kind:'p', text}. `capitalize` capitalises the first syllable of every sentence.
   */
  function pinyinPieces(tokens, capitalize) {
    const out = [];
    let sentenceStart = true;
    tokens.forEach((t, ti) => {
      if (t.t === 'p') {
        out.push({ kind: 'p', text: PUNCT_LATIN[t.h] || t.h, h: t.h, ti });
        if (SENT_END.has(t.h)) sentenceStart = true;
        return;
      }
      t.syl.forEach((syl, si) => {
        let text = syl;
        if (si === 0 && capitalize && sentenceStart) text = capFirst(text);
        if (si > 0 && t.joins[si - 1] === '' && needsApos(syl)) text = "'" + text;
        out.push({
          kind: 'w', text, ti, si,
          tone: t.tones[si],
          // space before this syllable?
          gap: si === 0 ? 'word' : (t.joins[si - 1] === ' ' ? 'space' : 'none'),
        });
      });
      sentenceStart = false;
    });
    return out;
  }

  function pinyinOf(tokens, capitalize) {
    let s = '';
    const pieces = pinyinPieces(tokens, capitalize);
    pieces.forEach((pc, i) => {
      if (pc.kind === 'p') {
        if (pc.h === '——') s += ' — ';
        else if (pc.h === '（') s += ' (';
        else s += pc.text + ' ';
        return;
      }
      if (pc.gap === 'word' || pc.gap === 'space') {
        if (s && !/[\s(]$/.test(s)) s += ' ';
      }
      s += pc.text;
    });
    return s.replace(/\s+/g, ' ').replace(/ ([,.?!:;)])/g, '$1').trim();
  }

  /**
   * Segments for audio and dictation: runs of tokens closed by SEG_END punctuation
   * (punctuation included). "——" splits but is not part of any segment.
   * Each segment: {from, to (exclusive token indices), text}
   */
  function segments(tokens) {
    const segs = [];
    let from = -1;
    const close = (to) => {
      if (from < 0) return;
      const slice = tokens.slice(from, to);
      const text = hanziOf(slice);
      if (slice.some((t) => t.t === 'w')) segs.push({ from, to, text });
      from = -1;
    };
    tokens.forEach((t, i) => {
      if (t.t === 'p' && t.h === '——') { close(i); return; }
      if (from < 0) {
        if (t.t === 'p') return;
        from = i;
      }
      if (t.t === 'p' && SEG_END.has(t.h)) close(i + 1);
    });
    close(tokens.length);
    return segs;
  }

  /** Flat list of writable characters: {ti, ci, ch, syl, tone} */
  function charList(tokens) {
    const list = [];
    tokens.forEach((t, ti) => {
      if (t.t !== 'w') return;
      t.chars.forEach((ch, ci) => {
        if (!isHan(ch)) return;
        list.push({ ti, ci, ch, syl: t.syl[ci], tone: t.tones[ci] });
      });
    });
    return list;
  }

  /** Texts that should have audio for an item (full text, segments, words). */
  function audioTexts(item) {
    const tokens = parse(item.s);
    const set = new Set();
    set.add(hanziOf(tokens));
    segments(tokens).forEach((s) => set.add(s.text));
    tokens.forEach((t) => { if (t.t === 'w') set.add(t.h); });
    (item.ex || []).forEach((e) => set.add(String(e).split('|')[0]));
    return Array.from(set);
  }

  return {
    MARKS, SEG_END, SENT_END, PUNCT_LATIN,
    isHan, toneOf, bare, withTone, needsApos, parse, hanziOf, pinyinPieces, pinyinOf, segments, charList, audioTexts,
  };
});
