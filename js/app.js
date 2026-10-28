/* 汉字 Диктант — study, trace, dictation and tone practice for textbook sentences. */
(() => {
  'use strict';

  const T = window.HZText;
  const SRC = window.HZ_LESSONS || [];
  const WORDS = window.HZ_WORDS || {};
  const STROKES = window.HZ_STROKES || (window.HZ_STROKES = {});
  const CHARS = window.HZ_CHARS || {};
  const AUDIO = window.HZ_AUDIO || {};
  const SYL = window.HZ_SYL || {};
  const app = document.getElementById('app');
  const sheetRoot = document.getElementById('sheets');

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const enc = encodeURIComponent;
  const debounce = (fn, ms) => { let h; return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); }; };

  /* ------------------------------------------------------------------ icons */
  const P = {
    back: '<path d="m15 18-6-6 6-6"/>',
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h5v-6h4v6h5V9.5"/>',
    left: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
    right: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    vol: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>',
    slow: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2"/><path d="M9 2h6"/>',
    pen: '<path d="M17 3a2.85 2.85 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
    ear: '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>',
    book: '<path d="M2 4h7a3 3 0 0 1 3 3v14a2 2 0 0 0-2-2H2z"/><path d="M22 4h-7a3 3 0 0 0-3 3v14a2 2 0 0 1 2-2h8z"/>',
    tone: '<path d="M3 6h4"/><path d="m10 9 4-4"/><path d="M3 14c1.5 3.5 5 3.5 6.5 0"/><path d="m14 13 6 6"/>',
    sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    play: '<path d="M7 4v16l13-8z" fill="currentColor" stroke="none"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/>',
    prev: '<path d="M19 20 9 12l10-8v16z"/><path d="M5 19V5"/>',
    next: '<path d="m5 4 10 8-10 8V4z"/><path d="M19 5v14"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    bulb: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>',
    redo: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>',
    paper: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h5"/>',
    tablet: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M11 18h2"/>',
    outline: '<path d="M4 4h16v16H4z" stroke-dasharray="3 3"/><path d="M8 12h8M12 8v8"/>',
  };
  const I = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${P[n] || ''}</svg>`;
  const MODE_ICON = { study: 'book', trace: 'pen', dict: 'ear', tones: 'tone' };

  /* ------------------------------------------------------------------ storage */
  const STORE_KEY = 'hz.v1';
  const DEFAULTS = {
    ui: /^ru\b/i.test(navigator.language || '') ? 'ru' : 'en',
    showRu: true, showEn: true, ruby: false,
    hintAfter: 3, leniency: 1, autoplay: true, slowRate: 0.7,
    prompt: 'pinyin', paper: false, toneSyl: false, showTr: false,
    reps: 3, toneQuiz: false,
  };
  const DB = (() => {
    try {
      const d = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
      return {
        settings: Object.assign({}, DEFAULTS, obj(d.settings)), chars: obj(d.chars), items: obj(d.items),
        custom: Array.isArray(d.custom) ? d.custom.filter((c) => c && typeof c.s === 'string') : [],
      };
    } catch (e) {
      return { settings: Object.assign({}, DEFAULTS), chars: {}, items: {}, custom: [] };
    }
  })();
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(DB)); } catch (e) { /* storage full or private mode */ } };
  const S = () => DB.settings;
  document.documentElement.lang = S().ui;

  /* ------------------------------------------------------------------ i18n */
  function plural(n, f) {
    const a = n % 10; const b = n % 100;
    if (a === 1 && b !== 11) return f[0];
    if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return f[1];
    return f[2];
  }
  const STR = {
    ru: {
      appTitle: 'Иероглифический диктант', appSub: 'Урок 13 · пропись, диктант, тоны',
      exercises: 'Задания', allChars: 'Все иероглифы', myTexts: 'Мои тексты', addText: 'Добавить свой текст',
      study: 'Учить', trace: 'Пропись', dict: 'Диктант', tones: 'Тоны',
      count: (kind, n) => `${n} ${plural(n, kind === 'chars' ? ['иероглиф', 'иероглифа', 'иероглифов'] : kind === 'phrases' ? ['словосочетание', 'словосочетания', 'словосочетаний'] : ['предложение', 'предложения', 'предложений'])}`,
      mastered: 'написано в диктанте ≥ 80%',
      strokes: (n) => `${n} ${plural(n, ['черта', 'черты', 'черт'])}`,
      listen: 'Слушать', slow: 'Медленно', phrase: 'Фраза', whole: 'Всё',
      pPinyin: 'Пиньинь', pTrans: 'Перевод', pAudio: 'Только звук', onScreen: 'На экране', onPaper: 'На бумаге',
      hint: 'Подсказка', show: 'Показать', again: 'Заново',
      retryMistakes: 'Повторить ошибки', retryAll: 'Ещё раз', next: 'Дальше', toList: 'К списку',
      clean: 'чисто', withErr: 'с ошибками', withHint: 'с подсказкой',
      segOf: (i, n) => `фраза ${i} из ${n}`, charOf: (i, n) => `иероглиф ${i} из ${n}`,
      traceTask: 'Обведите иероглиф по контуру, соблюдая порядок черт',
      dictTask: 'Напишите иероглиф по памяти',
      words: 'Слова', examples: 'Примеры', textbook: 'В учебнике',
      meaning: 'Значение', radical: 'Ключ', parts: 'Состав', etym: 'Этимология', readings: 'Чтения',
      noStroke: (c) => `Нет данных о порядке черт для «${c}» (нужен интернет)`,
      settings: 'Настройки', uiLang: 'Язык интерфейса', translations: 'Переводы',
      ruby: 'Пиньинь над иероглифами', autoplay: 'Автоозвучка в диктанте',
      hintAfter: 'Подсказка после ошибок в черте', never: 'никогда',
      strict: 'Проверка черт', strictV: ['строже', 'обычно', 'мягче'], slowRate: 'Скорость «медленно»',
      reset: 'Сбросить прогресс', resetQ: 'Удалить весь прогресс? Свои тексты останутся.',
      toneTask: 'Поставьте тон над каждым иероглифом', toneSyl: 'Слоги без тонов', neutral: 'лёгкий',
      toneNote: 'Тоны как в учебнике: 一 и 不 — с изменением тона (yíxià, bù), принимается и исходный тон.',
      paperTask: 'Слушайте фразу, пишите в тетради, затем откройте ответ и оцените себя.',
      reveal: 'Показать ответ', gotIt: 'Верно', almost: 'Почти', missed: 'Ошибся',
      addTitle: 'Свой текст', fTitle: 'Название (необязательно)', fHanzi: 'Текст иероглифами', fRu: 'Перевод на русский', fEn: 'Перевод на английский',
      saveB: 'Сохранить', cancel: 'Отмена', working: 'Готовлю пиньинь…',
      needHanzi: 'Введите хотя бы один иероглиф.', libFail: 'Не удалось загрузить библиотеку пиньиня.',
      autoNote: 'Пиньинь и деление на слова создаются автоматически.',
      deleteQ: 'Удалить этот текст?', weak: 'Работа над ошибками', weakSub: 'Иероглифы с ошибками в диктанте',
      allSub: 'Все иероглифы из упражнений', mySub: 'Добавленные тексты',
      legend: 'Цвета тонов', t1: '1-й', t2: '2-й', t3: '3-й', t4: '4-й', t5: 'лёгкий',
      tip: 'На iPad: Safari → «Поделиться» → «На экран Домой» — откроется во весь экран. Пишите пальцем или Apple Pencil.',
      saved: 'Сохранено', done: 'Готово', star: 'доп. лексика', writeIt: 'Написать', back: 'Назад',
      outlineOn: 'Контур', score: 'Результат',
      rep: 'повтор', skipped: 'пропущено',
      toneQ: (c) => `Тон для «${c}»?`, toneScore: (a, b) => `тоны: ${a} из ${b}`, sylListen: 'Слушать слог', repsBtn: (n) => `Повтор ×${n || '∞'}`,
      prevChar: 'Предыдущий иероглиф', nextChar: 'Следующий иероглиф', prevSeg: 'Предыдущая фраза', nextSeg: 'Следующая фраза',
      repsSet: 'Пропись: сколько раз писать каждый иероглиф',
      pos: { n: 'сущ.', v: 'гл.', adj: 'прил.', adv: 'нареч.', pron: 'мест.', part: 'част.', conj: 'союз', prep: 'предлог', interj: 'межд.', name: 'имя собств.', phr: 'выраж.' },
    },
    en: {
      appTitle: 'Character Dictation', appSub: 'Lesson 13 · tracing, dictation, tones',
      exercises: 'Exercises', allChars: 'All characters', myTexts: 'My texts', addText: 'Add your own text',
      study: 'Study', trace: 'Trace', dict: 'Dictation', tones: 'Tones',
      count: (kind, n) => `${n} ${kind === 'chars' ? (n === 1 ? 'character' : 'characters') : kind === 'phrases' ? (n === 1 ? 'phrase' : 'phrases') : (n === 1 ? 'sentence' : 'sentences')}`,
      mastered: 'dictation ≥ 80%',
      strokes: (n) => `${n} stroke${n === 1 ? '' : 's'}`,
      listen: 'Listen', slow: 'Slow', phrase: 'Phrase', whole: 'All',
      pPinyin: 'Pinyin', pTrans: 'Translation', pAudio: 'Audio only', onScreen: 'On screen', onPaper: 'On paper',
      hint: 'Hint', show: 'Show', again: 'Restart',
      retryMistakes: 'Retry mistakes', retryAll: 'Again', next: 'Next', toList: 'Back to list',
      clean: 'clean', withErr: 'with mistakes', withHint: 'with hints',
      segOf: (i, n) => `phrase ${i} of ${n}`, charOf: (i, n) => `character ${i} of ${n}`,
      traceTask: 'Trace the character in the correct stroke order',
      dictTask: 'Write the character from memory',
      words: 'Words', examples: 'Examples', textbook: 'Textbook',
      meaning: 'Meaning', radical: 'Radical', parts: 'Parts', etym: 'Etymology', readings: 'Readings',
      noStroke: (c) => `No stroke data for “${c}” (needs internet)`,
      settings: 'Settings', uiLang: 'Interface language', translations: 'Translations',
      ruby: 'Pinyin above characters', autoplay: 'Auto-play audio in dictation',
      hintAfter: 'Hint after mistakes on a stroke', never: 'never',
      strict: 'Stroke checking', strictV: ['stricter', 'normal', 'lenient'], slowRate: '“Slow” speed',
      reset: 'Reset progress', resetQ: 'Delete all progress? Your own texts stay.',
      toneTask: 'Mark the tone above each character', toneSyl: 'Toneless syllables', neutral: 'neutral',
      toneNote: 'Tones follow the textbook: 一 and 不 are marked with tone change (yíxià, bù); the base tone is accepted too.',
      paperTask: 'Listen to a phrase, write it in your notebook, then reveal the answer and grade yourself.',
      reveal: 'Reveal answer', gotIt: 'Correct', almost: 'Almost', missed: 'Missed',
      addTitle: 'Your text', fTitle: 'Title (optional)', fHanzi: 'Chinese text', fRu: 'Russian translation', fEn: 'English translation',
      saveB: 'Save', cancel: 'Cancel', working: 'Generating pinyin…',
      needHanzi: 'Enter at least one Chinese character.', libFail: 'Could not load the pinyin library.',
      autoNote: 'Pinyin and word splitting are generated automatically.',
      deleteQ: 'Delete this text?', weak: 'Mistakes review', weakSub: 'Characters you missed in dictation',
      allSub: 'Every character from the exercises', mySub: 'Texts you added',
      legend: 'Tone colours', t1: '1st', t2: '2nd', t3: '3rd', t4: '4th', t5: 'neutral',
      tip: 'On iPad: Safari → Share → Add to Home Screen opens it full-screen. Write with a finger or Apple Pencil.',
      saved: 'Saved', done: 'Done', star: 'extra vocabulary', writeIt: 'Write', back: 'Back',
      outlineOn: 'Outline', score: 'Score',
      rep: 'rep', skipped: 'skipped',
      toneQ: (c) => `Tone of “${c}”?`, toneScore: (a, b) => `tones: ${a} of ${b}`, sylListen: 'Listen to the syllable', repsBtn: (n) => `Repeat ×${n || '∞'}`,
      prevChar: 'Previous character', nextChar: 'Next character', prevSeg: 'Previous phrase', nextSeg: 'Next phrase',
      repsSet: 'Trace: times to write each character',
      pos: { n: 'n.', v: 'v.', adj: 'adj.', adv: 'adv.', pron: 'pron.', part: 'part.', conj: 'conj.', prep: 'prep.', interj: 'interj.', name: 'proper n.', phr: 'phr.' },
    },
  };
  const t = (k, ...a) => {
    const v = (STR[S().ui] || STR.en)[k];
    const w = v === undefined ? STR.en[k] : v;
    return typeof w === 'function' ? w(...a) : (w === undefined ? k : w);
  };
  const L = (o) => (o ? (o[S().ui] || o.en || o.ru || '') : '');

  /* ------------------------------------------------------------------ toast */
  const toastEl = document.getElementById('toast');
  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl.hidden = true; }, 1800);
  }

  /* ------------------------------------------------------------------ audio */
  const player = new Audio();
  player.preload = 'auto';
  player.addEventListener('loadedmetadata', () => { player.playbackRate = player.defaultPlaybackRate; });
  let unlocked = false;
  function silentWav() {
    const n = 400; const buf = new ArrayBuffer(44 + n * 2); const v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, n * 2, true);
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }
  function unlockAudio() {
    if (unlocked) return; unlocked = true;
    try { player.src = silentWav(); const p = player.play(); if (p) p.catch(() => {}); } catch (e) { /* ignore */ }
    try { if ('speechSynthesis' in window) speechSynthesis.speak(new SpeechSynthesisUtterance('')); } catch (e) { /* ignore */ }
  }
  document.addEventListener('touchend', unlockAudio, { capture: true, once: true });
  document.addEventListener('click', unlockAudio, { capture: true, once: true });

  let zhVoice = null;
  function pickVoice() {
    if (!('speechSynthesis' in window)) return null;
    const vs = speechSynthesis.getVoices();
    zhVoice = vs.find((v) => /zh[-_]CN/i.test(v.lang) && /xiaoxiao|tingting|ting-ting|meijia|yaoyao/i.test(v.name))
      || vs.find((v) => /zh[-_]CN/i.test(v.lang)) || vs.find((v) => /^zh/i.test(v.lang)) || null;
    return zhVoice;
  }
  if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }

  function stopAudio() {
    try { player.pause(); } catch (e) { /* ignore */ }
    try { if ('speechSynthesis' in window && (speechSynthesis.speaking || speechSynthesis.pending)) speechSynthesis.cancel(); } catch (e) { /* ignore */ }
  }
  function speakTTS(text, rate) {
    if (!('speechSynthesis' in window)) { toast('Audio unavailable'); return; }
    const u = new SpeechSynthesisUtterance(text.replace(/——/g, '，'));
    u.lang = 'zh-CN'; u.rate = 0.9 * rate;
    const v = zhVoice || pickVoice(); if (v) u.voice = v;
    // iOS drops a speak() issued in the same tick as cancel()
    if (speechSynthesis.speaking || speechSynthesis.pending) { speechSynthesis.cancel(); setTimeout(() => speechSynthesis.speak(u), 80); }
    else speechSynthesis.speak(u);
  }
  function playSrc(src, rate, onFail) {
    stopAudio();
    player.onerror = onFail ? () => { player.onerror = null; onFail(); } : null;
    player.src = src;
    player.defaultPlaybackRate = rate; player.playbackRate = rate;
    try { player.preservesPitch = true; player.webkitPreservesPitch = true; } catch (e) { /* ignore */ }
    const p = player.play();
    if (p) p.catch((err) => { if (err && err.name !== 'AbortError' && onFail) { player.onerror = null; onFail(); } });
  }
  function say(text, slow) {
    if (!text) return;
    const rate = slow ? S().slowRate : 1;
    const src = AUDIO[text];
    if (src) { playSrc(src, rate, () => speakTTS(text, rate)); return; }
    stopAudio();
    speakTTS(text, rate);
  }
  // One syllable in its exact tone (recordings from davinfifield/mp3-chinese-pinyin-sound, public domain).
  // Neutral tones have few recordings and only make sense inside the word, so those play the word.
  function sylKey(syl, tone) {
    const b = T.bare(syl).toLowerCase().replace(/ü/g, 'uu').replace(/[^a-z]/g, '');
    return b ? b + tone : null;
  }
  function saySyl(syl, tone, word) {
    const k = syl && syl !== 'r' ? sylKey(syl, tone) : null;
    if (!k) { say(word); return; }
    if (SYL[k]) { playSrc(SYL[k], 1, () => say(word)); return; }
    if (tone === 5 || navigator.onLine === false) { say(word); return; }
    playSrc(`https://cdn.jsdelivr.net/gh/davinfifield/mp3-chinese-pinyin-sound@master/mp3/${k}.mp3`, 1, () => say(word));
  }

  /* ------------------------------------------------------------------ stats */
  function recordChar(ch, grade) {
    const s = DB.chars[ch] || (DB.chars[ch] = { h: [], n: 0 });
    s.h.push(grade); if (s.h.length > 5) s.h.shift();
    s.n += 1; s.t = Date.now(); save();
  }
  function mastery(ch) {
    const s = DB.chars[ch];
    if (!s || !s.h.length) return null;
    return s.h.reduce((a, b) => a + b, 0) / (2 * s.h.length);
  }
  function level(ch) {
    const m = mastery(ch);
    if (m == null) return 0;
    const last = DB.chars[ch].h[DB.chars[ch].h.length - 1];
    if (m >= 0.8 && last === 2) return 3;
    if (m >= 0.45) return 2;
    return 1;
  }
  function recordItem(id, mode, score) {
    const s = DB.items[id] || (DB.items[id] = {});
    const m = s[mode] || (s[mode] = { best: 0 });
    m.best = Math.max(m.best || 0, score); m.last = score; m.t = Date.now(); save();
  }
  const best = (id, mode) => (DB.items[id] && DB.items[id][mode] ? DB.items[id][mode].best : null);

  /* ------------------------------------------------------------------ lessons */
  function prepItem(it, lesson, idx) {
    let tokens;
    try { tokens = T.parse(it.s); } catch (e) { tokens = [{ t: 'p', h: String(it.s) }]; }
    return Object.assign({}, it, { tokens, lesson, idx });
  }
  function prepLesson(l) {
    const lesson = Object.assign({}, l);
    lesson.items = l.items.map((it, i) => prepItem(it, lesson, i));
    return lesson;
  }
  function charItem(ch, ctxSyl) {
    const info = CHARS[ch] || {};
    let syl = (info.readings && info.readings[0]) || ctxSyl;
    if (!syl || syl === 'r' || /[\s|._]/.test(syl)) syl = ctxSyl && ctxSyl !== 'r' ? ctxSyl : 'ér';
    const w = WORDS[ch] || {};
    return { id: 'ch-' + ch, n: ch, ch, s: `${ch}|${syl}`, en: info.en || w.en || '', ru: info.ru || w.ru || '' };
  }
  let lessonCache = null;
  function lessons() {
    if (lessonCache) return lessonCache;
    const out = SRC.map(prepLesson);
    if (DB.custom.length) {
      out.push(prepLesson({
        id: 'custom', custom: true, kind: 'sentences',
        book: { ru: 'Свои тексты', en: 'Own texts' }, title: { ru: 'Мои тексты', en: 'My texts' },
        task: { ru: STR.ru.mySub, en: STR.en.mySub },
        items: DB.custom.map((c, i) => Object.assign({}, c, { n: String(i + 1) })),
      }));
    }
    const seen = new Map();
    for (const l of SRC) {
      for (const it of l.items) {
        try { T.charList(T.parse(it.s)).forEach((c) => { if (!seen.has(c.ch)) seen.set(c.ch, c.syl); }); } catch (e) { /* skip */ }
      }
    }
    const all = Array.from(seen, ([ch, syl]) => charItem(ch, syl));
    out.push(prepLesson({
      id: 'all', generated: true, kind: 'chars',
      book: { ru: 'Урок 13', en: 'Lesson 13' }, title: { ru: 'Все иероглифы', en: 'All characters' },
      task: { ru: STR.ru.allSub, en: STR.en.allSub }, items: all,
    }));
    const weak = all.filter((it) => { const lv = level(it.ch); return lv === 1 || lv === 2; });
    if (weak.length) {
      out.push(prepLesson({
        id: 'weak', generated: true, kind: 'chars',
        book: { ru: 'Повторение', en: 'Review' }, title: { ru: STR.ru.weak, en: STR.en.weak },
        task: { ru: STR.ru.weakSub, en: STR.en.weakSub }, items: weak,
      }));
    }
    lessonCache = out;
    return out;
  }
  const invalidate = () => { lessonCache = null; };
  const findLesson = (id) => lessons().find((l) => l.id === id);

  /* ------------------------------------------------------------------ glosses */
  function glossFor(h) {
    if (WORDS[h]) return WORDS[h];
    const chars = Array.from(h);
    if (chars.length === 1) {
      const c = CHARS[h] || {};
      return { pos: '', ru: c.ru || '', en: c.en || '' };
    }
    const first = (s) => String(s || '').split(/[;,]/)[0].trim();
    return {
      pos: '',
      ru: chars.map((c) => first(CHARS[c] && CHARS[c].ru)).filter(Boolean).join(' + '),
      en: chars.map((c) => first(CHARS[c] && CHARS[c].en)).filter(Boolean).join(' + '),
    };
  }
  const posLabel = (p) => (p ? ((STR[S().ui] || STR.en).pos[p] || p) : '');
  function langOrder() { return S().ui === 'ru' ? ['ru', 'en'] : ['en', 'ru']; }
  function transHTML(obj, cls = 'tr') {
    const set = S();
    return langOrder().filter((l) => (l === 'ru' ? set.showRu : set.showEn) && obj[l])
      .map((l) => `<p class="${cls}"><span class="lang">${l.toUpperCase()}</span><span>${esc(obj[l])}</span></p>`).join('');
  }
  function glossLine(g) {
    const parts = langOrder().filter((l) => (l === 'ru' ? S().showRu : S().showEn) && g[l]).map((l) => esc(g[l]));
    return parts.join(' · ');
  }

  /* ------------------------------------------------------------------ text rendering */
  function groupsOf(tokens) {
    const gs = [];
    tokens.forEach((tk, ti) => {
      if (tk.t === 'p' && gs.length && tk.h !== '（') gs[gs.length - 1].push(ti);
      else gs.push([ti]);
    });
    return gs;
  }
  const charTone = (tk, ci) => (tk.syl[ci] === 'r' && ci > 0 ? tk.tones[ci - 1] : tk.tones[ci]);

  function hanziHTML(item, o = {}) {
    return groupsOf(item.tokens).map((g) => '<span class="grp">' + g.map((ti) => {
      const tk = item.tokens[ti];
      if (tk.t === 'p') return `<span class="pu">${esc(tk.h)}</span>`;
      const chars = tk.chars;
      const inner = chars.map((c, ci) => {
        const tn = o.plain ? 5 : charTone(tk, ci);
        return o.ruby ? `<ruby class="t${tn}">${esc(c)}<rt>${esc(tk.syl[ci])}</rt></ruby>` : `<span class="t${tn}">${esc(c)}</span>`;
      }).join('');
      const sel = o.sel === ti ? ' sel' : '';
      return o.clickable ? `<button class="w${sel}" data-act="word" data-ti="${ti}">${inner}</button>` : `<span class="w">${inner}</span>`;
    }).join('') + '</span>').join('<wbr>');
  }

  function pinyinHTML(item, o = {}) {
    const pieces = T.pinyinPieces(item.tokens, !!o.cap);
    let html = '';
    for (const pc of pieces) {
      if (o.range && (pc.ti < o.range[0] || pc.ti >= o.range[1])) continue;
      if (pc.kind === 'p') {
        if (pc.h === '——') html += ' <span class="pu">—</span> ';
        else if (pc.h === '（') html += ' <span class="pu">(</span>';
        else html += `<span class="pu">${esc(pc.text)}</span> `;
        continue;
      }
      if (pc.gap !== 'none') html += ' ';
      const hi = o.hi && o.hi.ti === pc.ti && o.hi.si === pc.si ? ' hi' : '';
      const tone = o.bare ? 5 : (pc.text.toLowerCase() === 'r' && pc.si > 0 ? item.tokens[pc.ti].tones[pc.si - 1] : pc.tone);
      html += `<span class="t${tone}${hi}">${esc(o.bare ? T.bare(pc.text) : pc.text)}</span>`;
    }
    return html.trim();
  }

  function sylHTML(syl, tone) { return `<span class="t${tone}">${esc(syl)}</span>`; }
  function wordPinyinHTML(tk) {
    return tk.syl.map((s, i) => (i && tk.joins[i - 1] === ' ' ? ' ' : '') + sylHTML(i && tk.joins[i - 1] === '' && T.needsApos(s) ? "'" + s : s, charTone(tk, i))).join('');
  }
  function uniqueWords(item) {
    const seen = new Set(); const out = [];
    item.tokens.forEach((tk, ti) => { if (tk.t === 'w' && !seen.has(tk.h)) { seen.add(tk.h); out.push({ tk, ti }); } });
    return out;
  }
  const gridSVG = () => '<svg class="grid" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><rect x=".5" y=".5" width="99" height="99" rx="2"/><path d="M50 0V100M0 50H100"/><path d="M0 0L100 100M100 0L0 100"/></svg>';

  /* ------------------------------------------------------------------ stroke data */
  const pending = {};
  // hanzi-writer scores a finger stroke by its distance to the nearest median POINT, not segment,
  // so long straight runs need a point every ~40 units or a correct stroke along the middle fails.
  // The data files keep simplified medians; they are densified once here.
  function densify(m, step = 40) {
    const out = [m[0]];
    for (let i = 1; i < m.length; i++) {
      const [x1, y1] = m[i - 1]; const [x2, y2] = m[i];
      const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / step));
      for (let k = 1; k <= n; k++) out.push([Math.round(x1 + ((x2 - x1) * k) / n), Math.round(y1 + ((y2 - y1) * k) / n)]);
    }
    return out;
  }
  const prepared = {};
  const prep = (ch, d) => prepared[ch] || (prepared[ch] = Object.assign({}, d, { medians: d.medians.map((m) => densify(m)) }));
  function getStrokeData(ch) {
    if (STROKES[ch]) return Promise.resolve(prep(ch, STROKES[ch]));
    if (pending[ch]) return pending[ch];
    pending[ch] = fetch(`https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/${enc(ch)}.json`)
      .then((r) => { if (!r.ok) throw new Error('no data'); return r.json(); })
      .then((d) => { STROKES[ch] = d; return prep(ch, d); })
      .catch((e) => { delete pending[ch]; throw e; });
    return pending[ch];
  }

  /* ------------------------------------------------------------------ stroke viewer (own SVG renderer) */
  let svUid = 0;
  class StrokeViewer {
    constructor(host, ch, o = {}) {
      this.host = host; this.ch = ch; this.o = o; this.k = 0; this.n = 0;
      this.playing = false; this.once = false; this.anim = null; this.timer = null; this.dead = false;
      host.innerHTML = gridSVG() + '<div class="sverr"></div>';
      getStrokeData(ch).then((d) => {
        if (this.dead) return;
        this.d = d; this.n = d.strokes.length; this.build();
        this.k = o.autoplay ? 0 : this.n;
        this.render();
        if (o.autoplay) this.timer = setTimeout(() => this.play(), 250);
      }).catch(() => { if (!this.dead) host.querySelector('.sverr').textContent = t('noStroke', ch); this.emit(); });
    }
    build() {
      const id = 'sv' + (++svUid); const d = this.d;
      this.lens = d.medians.map((m) => m.reduce((a, pt, i) => (i ? a + Math.hypot(pt[0] - m[i - 1][0], pt[1] - m[i - 1][1]) : 0), 0) + 160);
      const clips = d.strokes.map((p, i) => `<clipPath id="${id}c${i}"><path d="${p}"/></clipPath>`).join('');
      const bg = d.strokes.map((p) => `<path class="sv-bg" d="${p}"/>`).join('');
      const fg = d.strokes.map((p) => `<path class="sv-fg" d="${p}"/>`).join('');
      // clip on a wrapping <g> (WebKit drops clip-path on the animated element itself)
      const an = d.medians.map((m, i) => `<g clip-path="url(#${id}c${i})"><path class="sv-an" d="M${m.map((p) => p.join(' ')).join(' L')}" stroke-dasharray="${this.lens[i]} ${this.lens[i]}" stroke-dashoffset="${this.lens[i]}"/></g>`).join('');
      this.host.innerHTML = gridSVG() + `<svg class="sv-svg" viewBox="0 0 1024 1024" aria-label="${esc(this.ch)}"><g transform="translate(0,900) scale(1,-1)"><defs>${clips}</defs>${bg}${fg}${an}</g></svg>`;
      this.fg = Array.from(this.host.querySelectorAll('.sv-fg'));
      this.an = Array.from(this.host.querySelectorAll('.sv-an'));
    }
    render() {
      if (this.fg) this.fg.forEach((p, i) => p.classList.toggle('on', i < this.k));
      this.emit();
    }
    emit() { if (this.o.onState) this.o.onState({ k: this.k, n: this.n, playing: this.playing }); }
    play() {
      if (!this.d || this.dead) return;
      if (this.playing && !this.once) return;
      this.stopAnim();
      if (this.k >= this.n) this.k = 0;
      this.playing = true; this.once = false; this.render(); this.step();
    }
    step() {
      if (!this.playing || this.dead) return;
      if (this.k >= this.n) {
        if (this.o.loop !== false && !this.once) {
          this.timer = setTimeout(() => {
            if (!this.playing) return;
            this.k = 0; this.render(); this.timer = setTimeout(() => this.step(), 380);
          }, 1400);
        } else { this.playing = false; this.once = false; this.render(); }
        return;
      }
      const i = this.k; const el = this.an[i]; const len = this.lens[i];
      const dur = 260 + len * 0.7;
      const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
      el.setAttribute('stroke-dashoffset', len);
      el.style.visibility = 'visible';
      const token = { i }; this.anim = token;
      const t0 = performance.now();
      const frame = (now) => {
        if (this.anim !== token) return;
        const x = Math.min(1, (now - t0) / dur);
        el.setAttribute('stroke-dashoffset', (len * (1 - ease(x))).toFixed(1));
        if (x < 1) { token.raf = requestAnimationFrame(frame); return; }
        this.anim = null; el.style.visibility = 'hidden'; el.setAttribute('stroke-dashoffset', len);
        this.k = i + 1;
        if (this.once) { this.playing = false; this.once = false; this.render(); return; }
        this.render(); this.timer = setTimeout(() => this.step(), 200);
      };
      token.raf = requestAnimationFrame(frame);
    }
    stopAnim() {
      clearTimeout(this.timer);
      if (this.anim) { cancelAnimationFrame(this.anim.raf); this.anim = null; }
      if (this.an) this.an.forEach((e) => { e.style.visibility = 'hidden'; });
    }
    // Pausing mid-stroke finishes that stroke instead of dropping it, so nothing jumps back.
    pause() {
      const mid = this.anim;
      this.stopAnim();
      if (mid) this.k = mid.i + 1;
      this.playing = false; this.once = false; this.render();
    }
    toggle() { if (this.playing && !this.once) this.pause(); else this.play(); }
    next() {
      if (!this.d) return;
      if (this.anim) { this.pause(); return; }
      this.pause();
      if (this.k >= this.n) { this.k = 0; this.render(); return; }
      this.playing = true; this.once = true; this.render(); this.step();
    }
    prev() { if (!this.d) return; this.pause(); if (this.k > 0) this.k -= 1; this.render(); }
    destroy() { this.dead = true; this.stopAnim(); }
  }

  /* ------------------------------------------------------------------ writing pad (hanzi-writer quiz) */
  const quiet = (p) => { if (p && typeof p.catch === 'function') p.catch(() => {}); return p; };
  class Pad {
    constructor(el, o) {
      this.el = el; this.o = o;
      el.innerHTML = gridSVG() + '<div class="hw"></div><div class="padmsg" hidden></div>';
      this.hw = el.querySelector('.hw'); this.msg = el.querySelector('.padmsg');
      this.writer = null; this.size = 0; this.token = 0;
      this.onResize = debounce(() => this.resize(), 160);
      window.addEventListener('resize', this.onResize);
    }
    measure() { return Math.max(180, Math.floor(this.el.getBoundingClientRect().width)); }
    dims(size) { return { width: size, height: size, padding: Math.round(size * 0.05) }; }
    create(ch) {
      const size = this.size = this.measure();
      this.hw.innerHTML = '';
      this.writer = HanziWriter.create(this.hw, ch, Object.assign(this.dims(size), {
        showCharacter: false, showOutline: !!this.o.outline,
        strokeColor: '#f6f6f8', outlineColor: '#3f3f47', drawingColor: '#ffffff',
        highlightColor: '#ef6158', highlightCompleteColor: '#45c46d', radicalColor: null,
        drawingWidth: Math.max(4, Math.round(size / 68)), strokeAnimationSpeed: 1.1, delayBetweenStrokes: 200,
        charDataLoader: (c, onLoad, onError) => {
          getStrokeData(c).then(onLoad, (err) => { onError(err); this.fail(c); });
        },
      }));
    }
    async start(ch) {
      const tok = ++this.token;
      Object.assign(this, { ch, mistakes: 0, usedHint: false, revealed: false, done: false, strokeNum: 0, total: 0, failed: false });
      this.msg.hidden = true;
      clearTimeout(this.hintTimer);
      if (!this.writer) this.create(ch);
      else {
        try { this.writer.cancelQuiz(); } catch (e) { /* ignore */ }
        try { await this.writer.setCharacter(ch); } catch (e) { this.fail(ch); return; }
      }
      if (tok !== this.token) return;
      quiet(this.o.outline ? this.writer.showOutline() : this.writer.hideOutline());
      this.quiz();
      getStrokeData(ch).then((d) => { if (tok === this.token) { this.total = d.strokes.length; this.progress(); } }).catch(() => {});
    }
    quiz() {
      const hintAfter = this.o.hintAfter;
      const tok = this.token;
      quiet(this.writer.quiz({
        leniency: this.o.leniency || 1,
        showHintAfterMisses: hintAfter || false,
        highlightOnComplete: true,
        onMistake: (d) => {
          if (tok !== this.token) return;
          this.mistakes = d.totalMistakes;
          if (hintAfter && d.mistakesOnStroke >= hintAfter) this.usedHint = true;
          this.progress();
        },
        onCorrectStroke: (d) => { if (tok !== this.token) return; this.mistakes = d.totalMistakes; this.strokeNum = d.strokeNum + 1; this.progress(); },
        onComplete: (d) => { if (tok !== this.token) return; this.mistakes = d.totalMistakes; this.complete(); },
      }));
    }
    progress() { if (this.o.onProgress) this.o.onProgress(this); }
    grade() { if (this.revealed || this.usedHint || this.failed) return 0; return this.mistakes > 0 ? 1 : 2; }
    complete() {
      if (this.done) return;
      this.done = true;
      const grade = this.grade();
      this.el.classList.add(grade === 0 ? 'flash-b' : 'flash-g');
      setTimeout(() => this.el.classList.remove('flash-b', 'flash-g'), 520);
      const tok = this.token;
      setTimeout(() => {
        if (tok !== this.token) return;
        this.o.onDone({ ch: this.ch, grade, mistakes: this.mistakes, hint: this.usedHint, revealed: this.revealed });
      }, this.revealed ? 650 : 480);
    }
    hint() {
      if (this.done || !this.writer) return;
      this.usedHint = true;
      if (typeof this.writer.highlightStroke === 'function') { try { this.writer.highlightStroke(this.strokeNum); } catch (e) { /* ignore */ } }
      if (!this.o.outline) {
        quiet(this.writer.showOutline());
        clearTimeout(this.hintTimer);
        this.hintTimer = setTimeout(() => { if (this.writer && !this.o.outline) quiet(this.writer.hideOutline()); }, 1500);
      }
      this.progress();
    }
    reveal() {
      if (this.done) return;
      if (this.failed || !this.writer) { this.revealed = true; this.complete(); return; }
      this.revealed = true;
      const tok = this.token;
      try { this.writer.cancelQuiz(); } catch (e) { /* ignore */ }
      quiet(this.writer.animateCharacter({ onComplete: (res) => { if (tok === this.token && !(res && res.canceled)) this.complete(); } }));
      this.progress();
    }
    restart() {
      if (this.done || !this.writer || this.failed) return;
      try { this.writer.cancelQuiz(); } catch (e) { /* ignore */ }
      this.strokeNum = 0;
      this.quiz();
      this.progress();
    }
    setOutline(on) {
      this.o.outline = on;
      if (this.writer) quiet(on ? this.writer.showOutline() : this.writer.hideOutline());
    }
    fail(ch) {
      this.failed = true;
      this.msg.hidden = false; this.msg.textContent = t('noStroke', ch);
      this.progress();
    }
    resize() {
      if (!this.writer || !this.el.isConnected) return;
      const size = this.measure();
      if (Math.abs(size - this.size) < 6) return;
      this.size = size;
      this.writer.updateDimensions(this.dims(size));
    }
    destroy() {
      this.token++;
      clearTimeout(this.hintTimer);
      window.removeEventListener('resize', this.onResize);
      try { if (this.writer) this.writer.cancelQuiz(); } catch (e) { /* ignore */ }
      this.writer = null; this.hw.innerHTML = '';
    }
  }

  /* ------------------------------------------------------------------ character panel (viewer + practice + info) */
  function mountCharPanel(host, ch, o = {}) {
    const info = CHARS[ch] || {};
    const readings = info.readings && info.readings.length ? info.readings : (o.syl ? [o.syl] : []);
    const kv = [];
    const meaning = glossLine({ ru: info.ru, en: info.en });
    if (meaning) kv.push([t('meaning'), meaning]);
    if (info.radical) kv.push([t('radical'), `<span class="hz">${esc(info.radical)}</span>`]);
    if (info.decomposition && !/[？?]/.test(info.decomposition)) kv.push([t('parts'), `<span class="hz">${esc(info.decomposition)}</span>`]);
    if (info.etymology && info.etymology.hint) kv.push([t('etym'), esc(info.etymology.hint)]);
    host.innerHTML = `
      <div class="svcount"><button class="rp sm" data-sv="syl" aria-label="${esc(t('sylListen'))}">${I('vol')}</button> <span>${readings.map((r) => sylHTML(r, T.toneOf(r))).join(', ')}</span> · <b class="cp-n"></b> <span class="cp-k"></span></div>
      <div class="cp-stage"><div class="sv"></div></div>
      <div class="svbar cp-view">
        <button class="pill" data-sv="prev" aria-label="previous stroke">${I('prev')}</button>
        <button class="pill" data-sv="play" aria-label="play">${I('pause')}</button>
        <button class="pill" data-sv="next" aria-label="next stroke">${I('next')}</button>
        <button class="pill" data-sv="write" aria-label="${esc(t('writeIt'))}">${I('pen')}</button>
      </div>
      <div class="svbar cp-write" hidden>
        <button class="pill" data-sv="restart" aria-label="${esc(t('again'))}">${I('redo')}</button>
        <button class="pill" data-sv="outline" aria-label="${esc(t('outlineOn'))}">${I('outline')}</button>
        <button class="pill" data-sv="hint" aria-label="${esc(t('hint'))}">${I('bulb')}</button>
        <button class="pill" data-sv="view" aria-label="${esc(t('back'))}">${I('play')}</button>
      </div>
      ${kv.length ? `<dl class="kv">${kv.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>` : ''}`;
    const stage = host.querySelector('.cp-stage');
    const nEl = host.querySelector('.cp-n'); const kEl = host.querySelector('.cp-k');
    const playBtn = host.querySelector('[data-sv="play"]');
    let viewer = null; let pad = null; let outline = true; let dead = false;
    function onState(st) {
      if (st.n) nEl.textContent = t('strokes', st.n);
      kEl.textContent = st.n && st.k < st.n ? `${st.k}/${st.n}` : '';
      playBtn.innerHTML = st.playing ? I('pause') : I('play');
    }
    function showViewer() {
      if (pad) { pad.destroy(); pad = null; }
      stage.innerHTML = '<div class="sv"></div>';
      viewer = new StrokeViewer(stage.firstChild, ch, { autoplay: o.autoplay !== false, loop: true, onState });
      host.querySelector('.cp-view').hidden = false; host.querySelector('.cp-write').hidden = true;
    }
    function showPad() {
      if (viewer) { viewer.destroy(); viewer = null; }
      stage.innerHTML = '<div class="pad"></div>';
      pad = new Pad(stage.firstChild, {
        outline, hintAfter: 2, leniency: S().leniency,
        onDone: (r) => {
          toast(r.grade === 2 ? '✓ ' + t('clean') : r.grade === 1 ? '~ ' + t('withErr') : '✗ ' + t('withHint'));
          setTimeout(() => { if (pad && !dead) pad.start(ch); }, 700);
        },
        onProgress: (p) => { if (p.total) { nEl.textContent = t('strokes', p.total); kEl.textContent = `${p.strokeNum}/${p.total}`; } },
      });
      pad.start(ch);
      host.querySelector('.cp-view').hidden = true; host.querySelector('.cp-write').hidden = false;
      host.querySelector('[data-sv="outline"]').classList.toggle('on', outline);
    }
    host.addEventListener('click', (e) => {
      const b = e.target.closest('[data-sv]'); if (!b) return;
      const a = b.dataset.sv;
      if (a === 'prev' && viewer) viewer.prev();
      else if (a === 'next' && viewer) viewer.next();
      else if (a === 'play' && viewer) viewer.toggle();
      else if (a === 'write') showPad();
      else if (a === 'syl') { const sy = o.syl || readings[0]; saySyl(sy, T.toneOf(sy), ch); }
      else if (a === 'view') showViewer();
      else if (a === 'restart' && pad) { if (pad.done) pad.start(ch); else pad.restart(); }
      else if (a === 'hint' && pad) pad.hint();
      else if (a === 'outline' && pad) { outline = !outline; pad.setOutline(outline); toast(`${t('outlineOn')}: ${outline ? 'on' : 'off'}`); }
    });
    if (o.write) showPad(); else showViewer();
    return { destroy() { dead = true; if (viewer) viewer.destroy(); if (pad) pad.destroy(); viewer = null; pad = null; } };
  }

  /* ------------------------------------------------------------------ sheets */
  const openSheets = [];
  function openSheet(inner, opts = {}) {
    const bg = document.createElement('div');
    bg.className = 'sheet-bg';
    bg.innerHTML = `<div class="sheet ${opts.cls || ''}" role="dialog" aria-modal="true">${inner}</div>`;
    sheetRoot.appendChild(bg);
    const api = {
      el: bg.firstElementChild, closed: false,
      close() {
        if (api.closed) return; api.closed = true;
        const i = openSheets.indexOf(api); if (i >= 0) openSheets.splice(i, 1);
        try { if (opts.onClose) opts.onClose(); } catch (e) { /* ignore */ }
        bg.remove();
      },
    };
    bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-close]')) api.close(); });
    openSheets.push(api);
    return api;
  }
  function closeSheets() { openSheets.slice().forEach((s) => s.close()); }

  function openWordSheet(tk, item) {
    closeSheets();
    const g = glossFor(tk.h);
    const han = tk.chars.map((c, i) => ({ c, i })).filter((x) => T.isHan(x.c));
    let panel = null;
    const sh = openSheet(`
      <div class="sh-h">
        <div>
          <div class="sh-title"><span class="hz">${tk.chars.map((c, i) => `<span class="t${charTone(tk, i)}">${esc(c)}</span>`).join('')}</span>${wordPinyinHTML(tk)}</div>
          <div class="sh-sub">${g.pos ? `<span class="pos">${esc(posLabel(g.pos))}</span>` : ''}</div>
        </div>
        <div class="rbtns-top"><button class="rbtn" data-act="say" aria-label="listen">${I('vol')}</button><button class="rbtn" data-close aria-label="close">${I('x')}</button></div>
      </div>
      <div class="trs">${transHTML(g)}</div>
      ${han.length > 1 ? `<div class="ctabs">${han.map((x, j) => `<button class="ctab ${j === 0 ? 'on' : ''}" data-ci="${x.i}">${esc(x.c)}</button>`).join('')}</div>` : '<div style="height:14px"></div>'}
      <div class="cphost"></div>`, { onClose: () => { if (panel) panel.destroy(); } });
    const host = sh.el.querySelector('.cphost');
    function show(ci) {
      if (panel) panel.destroy();
      const fresh = document.createElement('div'); host.replaceChildren(fresh);
      panel = mountCharPanel(fresh, tk.chars[ci], { syl: tk.syl[ci] });
      sh.el.querySelectorAll('.ctab').forEach((b) => b.classList.toggle('on', +b.dataset.ci === ci));
    }
    sh.el.addEventListener('click', (e) => {
      const tab = e.target.closest('.ctab'); if (tab) { show(+tab.dataset.ci); return; }
      if (e.target.closest('[data-act="say"]')) say(tk.h);
    });
    if (han.length) show(han[0].i);
    say(tk.h);
  }
  // horizontal swipe on an element (touch); ignores mostly-vertical moves
  function onSwipe(el, fn) {
    let x0 = null; let y0 = 0;
    el.addEventListener('touchstart', (e) => { if (e.touches.length !== 1) { x0 = null; return; } x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    el.addEventListener('touchend', (e) => {
      if (x0 == null) return;
      const t0 = e.changedTouches[0]; const dx = t0.clientX - x0; const dy = t0.clientY - y0; x0 = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > 1.6 * Math.abs(dy)) fn(dx < 0 ? 1 : -1);
    }, { passive: true });
  }
  // Stroke order, TrainChinese style. list = [{ch, syl, tone}]; ‹ › and swipe move between characters.
  function openStrokeSheet(list, start, onClose) {
    closeSheets();
    let viewer = null; let idx = start;
    const many = list.length > 1;
    const sh = openSheet(`
      <div class="sh-h so-h">
        <div class="so-py"></div>
        <div class="rbtns-top">
          ${many ? `<button class="rbtn so-nav" data-so="cprev" aria-label="${esc(t('prevChar'))}">${I('back')}</button><button class="rbtn so-nav fwd" data-so="cnext" aria-label="${esc(t('nextChar'))}">${I('back')}</button>` : ''}
          <button class="rbtn" data-close aria-label="close">${I('x')}</button>
        </div>
      </div>
      <div class="so-n"></div>
      <div class="so-stage"><div class="sv"></div></div>
      <div class="svbar">
        <button class="pill" data-so="prev" aria-label="previous stroke">${I('prev')}</button>
        <button class="pill" data-so="play" aria-label="play / pause">${I('pause')}</button>
        <button class="pill" data-so="next" aria-label="next stroke">${I('next')}</button>
      </div>`, { cls: 'so', onClose: () => { if (viewer) viewer.destroy(); viewer = null; if (onClose) onClose(idx); } });
    const nEl = sh.el.querySelector('.so-n'); const playBtn = sh.el.querySelector('[data-so="play"]');
    const py = sh.el.querySelector('.so-py'); const stage = sh.el.querySelector('.so-stage');
    function show(k) {
      idx = Math.max(0, Math.min(list.length - 1, k));
      const c = list[idx];
      py.innerHTML = (c.syl && c.syl !== 'r' ? sylHTML(c.syl, c.tone) : '') + `<span class="hz">${esc(c.ch)}</span>`;
      nEl.textContent = '';
      sh.el.querySelectorAll('.so-nav').forEach((b) => { b.disabled = b.dataset.so === 'cprev' ? idx === 0 : idx === list.length - 1; });
      if (viewer) viewer.destroy();
      stage.innerHTML = '<div class="sv"></div>';
      viewer = new StrokeViewer(stage.firstChild, c.ch, {
        autoplay: true, loop: true,
        onState(st) { if (st.n) nEl.textContent = t('strokes', st.n); playBtn.innerHTML = st.playing ? I('pause') : I('play'); },
      });
    }
    sh.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-so]'); if (!b) return;
      const a = b.dataset.so;
      if (a === 'cprev') show(idx - 1); else if (a === 'cnext') show(idx + 1);
      else if (!viewer) return;
      else if (a === 'prev') viewer.prev(); else if (a === 'next') viewer.next(); else if (a === 'play') viewer.toggle();
    });
    if (many) onSwipe(sh.el, (d) => { if (idx + d >= 0 && idx + d < list.length) show(idx + d); });
    show(start);
    return sh;
  }
  function charToken(ch) {
    const it = charItem(ch, null);
    return T.parse(it.s)[0];
  }

  /* ------------------------------------------------------------------ settings sheet */
  function openSettings() {
    closeSheets();
    const sh = openSheet('<div class="sh-h"><div class="sh-title">…</div></div>');
    const sw = (key, label) => `<div class="sw"><span>${esc(label)}</span><button class="tg ${S()[key] ? 'on' : ''}" data-tg="${key}" role="switch" aria-checked="${!!S()[key]}"></button></div>`;
    const seg = (key, opts) => `<div class="seg">${opts.map(([v, l]) => `<button class="${S()[key] === v ? 'on' : ''}" data-seg="${key}" data-v="${v}">${esc(l)}</button>`).join('')}</div>`;
    function draw() {
      sh.el.innerHTML = `
        <div class="sh-h"><div class="sh-title">${esc(t('settings'))}</div><button class="rbtn" data-close aria-label="close">${I('x')}</button></div>
        <div class="set">
          <div><h4>${esc(t('uiLang'))}</h4>${seg('ui', [['ru', 'Русский'], ['en', 'English']])}</div>
          <div><h4>${esc(t('translations'))}</h4>${sw('showRu', 'Русский (RU)')}${sw('showEn', 'English (EN)')}</div>
          <div>${sw('ruby', t('ruby'))}${sw('autoplay', t('autoplay'))}</div>
          <div><h4>${esc(t('repsSet'))}</h4>${seg('reps', [[1, '×1'], [3, '×3'], [5, '×5'], [0, '∞']])}</div>
          <div><h4>${esc(t('hintAfter'))}</h4>${seg('hintAfter', [[1, '1'], [2, '2'], [3, '3'], [5, '5'], [0, t('never')]])}</div>
          <div><h4>${esc(t('strict'))}</h4>${seg('leniency', [[0.75, t('strictV')[0]], [1, t('strictV')[1]], [1.35, t('strictV')[2]]])}</div>
          <div><h4>${esc(t('slowRate'))}</h4>${seg('slowRate', [[0.5, '0.5×'], [0.7, '0.7×'], [0.85, '0.85×']])}</div>
          <button class="danger" data-act="reset">${esc(t('reset'))}</button>
        </div>`;
    }
    draw();
    sh.el.addEventListener('click', (e) => {
      const tg = e.target.closest('[data-tg]');
      const sg = e.target.closest('[data-seg]');
      if (tg) { S()[tg.dataset.tg] = !S()[tg.dataset.tg]; }
      else if (sg) { const raw = sg.dataset.v; S()[sg.dataset.seg] = /^[\d.]+$/.test(raw) ? Number(raw) : raw; }
      else if (e.target.closest('[data-act="reset"]')) {
        if (!confirm(t('resetQ'))) return;
        DB.chars = {}; DB.items = {};
      } else return;
      save(); invalidate(); document.documentElement.lang = S().ui;
      draw(); render(true);
    });
  }

  /* ------------------------------------------------------------------ custom text sheet */
  const scriptLoads = {};
  function loadScript(src) {
    if (!scriptLoads[src]) {
      scriptLoads[src] = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = src; s.onload = () => res();
        s.onerror = () => { s.remove(); delete scriptLoads[src]; rej(new Error('load ' + src)); };
        document.head.appendChild(s);
      });
    }
    return scriptLoads[src];
  }
  function normPunct(s) {
    return s.replace(/\r/g, '')
      .replace(/[—–]+|-{2,}|－{2,}/g, '——')
      .replace(/,/g, '，').replace(/\?/g, '？').replace(/!/g, '！').replace(/:/g, '：').replace(/;/g, '；')
      .replace(/\.(?!\d)/g, '。');
  }
  const NOT_ERHUA = new Set(['女儿', '婴儿', '幼儿', '孤儿', '健儿', '胎儿', '男儿', '宠儿', '混血儿', '新生儿', '儿儿']);
  // ICU glues pronoun+verb, 不+verb and numeral+measure+noun; pinyin orthography writes those apart.
  const KEEP_SEG = new Set(['一下', '一起', '一样', '一定', '一点', '一点儿', '一些', '一般', '一共', '一直', '一会儿', '这儿', '那儿', '哪儿', '这里', '那里', '哪里', '这样', '那样', '这么', '那么', '怎么', '这个', '那个', '哪个', '不错', '不过', '不同', '不但', '不久', '不用', '没有', '没关系', '每天', '几个']);
  function splitSeg(w) {
    const c = Array.from(w);
    if (c.length < 2 || KEEP_SEG.has(w)) return [w];
    if ('我你他她它您'.includes(c[0]) && c[1] !== '们') return [c[0]].concat(splitSeg(c.slice(1).join('')));
    if ('不没别'.includes(c[0])) return [c[0]].concat(splitSeg(c.slice(1).join('')));
    if ('一二三四五六七八九十两几这那哪每'.includes(c[0])) return c;
    return [w];
  }
  async function buildCustom(text) {
    await loadScript('vendor/pinyin-pro.js');
    const PP = window.pinyinPro;
    if (!PP || typeof PP.pinyin !== 'function') throw new Error('pinyin-pro');
    const runs = normPunct(text).match(/\p{Script=Han}+|——|[^\p{Script=Han}\s]|\s+/gu) || [];
    const tokens = [];
    for (const run of runs) {
      if (/^\s+$/.test(run)) continue;
      if (!T.isHan(run[0])) { tokens.push(run.replace(/[|]/g, '')); continue; }
      const syls = PP.pinyin(run, { type: 'array', toneSandhi: true });
      let parts = null;
      if (typeof Intl !== 'undefined' && Intl.Segmenter) {
        try {
          const seg = Array.from(new Intl.Segmenter('zh', { granularity: 'word' }).segment(run), (x) => x.segment);
          if (seg.join('') === run) parts = seg.flatMap(splitSeg);
        } catch (e) { parts = null; }
      }
      if (!parts) parts = Array.from(run);
      let pos = 0;
      for (const w of parts) {
        const wc = Array.from(w);
        const len = wc.length;
        const sy = syls.slice(pos, pos + len).map((x, i) => {
          let s = String(x || '').replace(/[\s|._]/g, '');
          if (wc[i] === '儿' && i === len - 1 && i > 0 && !NOT_ERHUA.has(w) && !NOT_ERHUA.has(wc.slice(-2).join(''))) s = 'r';
          return s || '?';
        });
        pos += len;
        tokens.push(`${w}|${sy.join('.')}`);
      }
    }
    return { s: tokens.join(' ') };
  }
  function openAddText() {
    closeSheets();
    const sh = openSheet(`
      <div class="sh-h"><div class="sh-title">${esc(t('addTitle'))}</div><button class="rbtn" data-close aria-label="close">${I('x')}</button></div>
      <form class="set" autocomplete="off">
        <div class="field"><label>${esc(t('fHanzi'))}</label><textarea class="hz" name="hz" rows="3" placeholder="你好！我叫…" required></textarea></div>
        <div class="field"><label>${esc(t('fRu'))}</label><textarea name="ru" rows="2"></textarea></div>
        <div class="field"><label>${esc(t('fEn'))}</label><textarea name="en" rows="2"></textarea></div>
        <div class="field"><label>${esc(t('fTitle'))}</label><input name="title"></div>
        <p class="task">${esc(t('autoNote'))}</p>
        <p class="err" hidden></p>
        <div class="rbtns" style="margin-top:0;justify-content:flex-end">
          <button type="button" class="pbtn ghost" data-close>${esc(t('cancel'))}</button>
          <button type="submit" class="pbtn">${I('check')} ${esc(t('saveB'))}</button>
        </div>
      </form>`);
    const form = sh.el.querySelector('form'); const err = sh.el.querySelector('.err');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const hz = String(fd.get('hz') || '').trim();
      if (!/\p{Script=Han}/u.test(hz)) { err.hidden = false; err.textContent = t('needHanzi'); return; }
      const btn = form.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = t('working');
      try {
        const { s } = await buildCustom(hz);
        T.parse(s);
        DB.custom.push({
          id: 'c' + Date.now().toString(36), s,
          ru: String(fd.get('ru') || '').trim(), en: String(fd.get('en') || '').trim(), title: String(fd.get('title') || '').trim(),
        });
        save(); invalidate(); sh.close(); toast(t('saved'));
        location.hash = `#/study/custom/${DB.custom.length - 1}`;
      } catch (ex) {
        err.hidden = false; err.textContent = t('libFail') + ' ' + (ex && ex.message ? ex.message : '');
        btn.disabled = false; btn.innerHTML = `${I('check')} ${esc(t('saveB'))}`;
      }
    });
    setTimeout(() => form.querySelector('textarea').focus(), 50);
  }

  /* ------------------------------------------------------------------ view plumbing */
  let view = { destroy() {}, act() {}, key() {} };
  function setView(v) { view = Object.assign({ destroy() {}, act() {}, key() {} }, v); }
  function teardown(keepSheets) {
    try { view.destroy(); } catch (e) { /* ignore */ }
    view = { destroy() {}, act() {}, key() {} };
    stopAudio();
    if (!keepSheets) closeSheets();
  }

  app.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || !app.contains(el)) return;
    const act = el.dataset.act;
    if (act === 'settings') { openSettings(); return; }
    if (act === 'add') { openAddText(); return; }
    if (act === 'char') { openWordSheet(charToken(el.dataset.ch), null); return; }
    view.act(act, el, e);
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, textarea')) return;
    if (e.key === 'Escape' && openSheets.length) { openSheets[openSheets.length - 1].close(); return; }
    if (openSheets.length) return;
    view.key(e);
  });

  function topbar(o) {
    return `<header class="top">
      <div class="top-l"><a class="ib" href="${o.back}" aria-label="back">${I('back')}</a><a class="ib" href="#/" aria-label="home">${I('home')}</a></div>
      <div class="top-c">${o.nav
        ? `<a class="ib ${o.nav.prev ? '' : 'off'}" href="${o.nav.prev || '#'}" aria-label="previous">${I('left')}</a><span class="count">${o.nav.i}/${o.nav.n}</span><a class="ib ${o.nav.next ? '' : 'off'}" href="${o.nav.next || '#'}" aria-label="next">${I('right')}</a>`
        : `<span class="ttl">${esc(o.title || '')}</span>`}</div>
      <div class="top-r"><button class="ib" data-act="settings" aria-label="settings">${I('sliders')}</button></div>
    </header>`;
  }
  function itemTop(lesson, idx, mode) {
    const n = lesson.items.length;
    const href = (i) => `#/${mode}/${enc(lesson.id)}/${i}`;
    return topbar({ back: `#/l/${enc(lesson.id)}`, nav: { i: idx + 1, n, prev: idx > 0 ? href(idx - 1) : null, next: idx < n - 1 ? href(idx + 1) : null } })
      + `<nav class="tabs">${['study', 'trace', 'dict', 'tones'].map((m) => `<a class="${m === mode ? 'on' : ''}" href="#/${m}/${enc(lesson.id)}/${idx}">${I(MODE_ICON[m])}<span>${esc(t(m))}</span></a>`).join('')}</nav>`;
  }
  function navKeys(lesson, idx, mode, e) {
    if (e.key === 'ArrowLeft' && idx > 0) location.hash = `#/${mode}/${enc(lesson.id)}/${idx - 1}`;
    else if (e.key === 'ArrowRight' && idx < lesson.items.length - 1) location.hash = `#/${mode}/${enc(lesson.id)}/${idx + 1}`;
    else return false;
    return true;
  }
  function metaLine(lesson, item) {
    const bits = [esc(L(lesson.book))];
    if (lesson.kind !== 'chars') bits.push('№ ' + esc(item.n));
    if (item.title) bits.push(esc(item.title));
    return bits.join(' · ') + (item.star ? ` <span class="star" title="${esc(t('star'))}">★</span>` : '');
  }
  const scoreCls = (v) => (v == null ? '' : v >= 80 ? 'g' : v >= 50 ? 'f' : 'b');

  /* ------------------------------------------------------------------ home */
  function lessonCard(l) {
    const n = l.items.length;
    const done = l.items.filter((it) => (best(it.id, 'dict') || 0) >= 80).length;
    const first = l.items[0];
    const preview = l.kind === 'chars' ? l.items.slice(0, 14).map((it) => it.ch || T.hanziOf(it.tokens)).join(' ') : (first ? T.hanziOf(first.tokens) : '');
    return `<article class="lcard">
      <a class="lcard-main" href="#/l/${enc(l.id)}">
        <div class="book">${esc(L(l.book))}</div>
        <h3>${esc(L(l.title))}</h3>
        ${l.task ? `<p class="task">${esc(L(l.task))}</p>` : ''}
        <div class="preview">${esc(preview)}</div>
        <div class="lprog"><span>${esc(t('count', l.kind, n))}</span><div class="bar"><i style="width:${n ? Math.round(100 * done / n) : 0}%"></i></div><span title="${esc(t('mastered'))}">${done}/${n}</span></div>
      </a>
      <div class="modes">${['study', 'trace', 'dict', 'tones'].map((m) => `<a href="#/${m}/${enc(l.id)}/0">${I(MODE_ICON[m])}${esc(t(m))}</a>`).join('')}</div>
    </article>`;
  }
  function tilesHTML(items, hrefFn) {
    return items.map((it, i) => {
      const ch = it.ch || it.n;
      return hrefFn
        ? `<a class="tile hz m${level(ch)}" href="${hrefFn(i)}">${esc(ch)}</a>`
        : `<button class="tile hz m${level(ch)}" data-act="char" data-ch="${esc(ch)}">${esc(ch)}</button>`;
    }).join('');
  }
  function viewHome() {
    const ls = lessons();
    const main = ls.filter((l) => !l.generated && !l.custom);
    const custom = ls.find((l) => l.custom);
    const all = ls.find((l) => l.id === 'all');
    const weak = ls.find((l) => l.id === 'weak');
    app.innerHTML = `
      <header class="home-top">
        <div class="brand"><div class="logo">汉</div><div><h1>${esc(t('appTitle'))}</h1><p>${esc(t('appSub'))}</p></div></div>
        <button class="ib" data-act="settings" aria-label="settings">${I('sliders')}</button>
      </header>
      <div class="sec-h"><h2>${esc(t('exercises'))}</h2></div>
      ${main.map(lessonCard).join('')}
      ${weak ? lessonCard(weak) : ''}
      <div class="sec-h"><h2>${esc(t('allChars'))}</h2><span class="aside">${all.items.length}</span></div>
      <article class="lcard">
        <div class="lcard-main"><div class="chargrid">${tilesHTML(all.items)}</div></div>
        <div class="modes">${['study', 'trace', 'dict', 'tones'].map((m) => `<a href="#/${m}/all/0">${I(MODE_ICON[m])}${esc(t(m))}</a>`).join('')}</div>
      </article>
      <div class="sec-h"><h2>${esc(t('myTexts'))}</h2></div>
      ${custom ? lessonCard(custom) : ''}
      <button class="addbtn" data-act="add">${I('plus')} ${esc(t('addText'))}</button>
      <div class="foot">
        <p>${esc(t('legend'))}: <span class="t1">mā ${esc(t('t1'))}</span> · <span class="t2">má ${esc(t('t2'))}</span> · <span class="t3">mǎ ${esc(t('t3'))}</span> · <span class="t4">mà ${esc(t('t4'))}</span> · <span class="t5">ma ${esc(t('t5'))}</span></p>
        <p>${esc(t('tip'))}</p>
      </div>`;
  }

  /* ------------------------------------------------------------------ lesson page */
  function viewLesson(lesson) {
    const badge = (it, m) => { const v = best(it.id, m); return v == null ? '' : `<span class="badge ${scoreCls(v)}">${esc(t(m))} ${v}%</span>`; };
    const rows = lesson.kind === 'chars'
      ? `<div class="chargrid">${tilesHTML(lesson.items, (i) => `#/study/${enc(lesson.id)}/${i}`)}</div>`
      : lesson.items.map((it, i) => `
        <a class="irow" href="#/study/${enc(lesson.id)}/${i}">
          <div class="num">${esc(it.n)}${it.star ? '<span class="star">*</span>' : ''}</div>
          <div>
            <div class="ih">${hanziHTML(it, {})}</div>
            <div class="ip">${pinyinHTML(it, { cap: lesson.kind === 'sentences' })}</div>
            <div class="it">${esc(it[S().ui] || it.en || it.ru || '')}</div>
          </div>
          <div class="badges">${badge(it, 'trace')}${badge(it, 'dict')}${badge(it, 'tones')}${lesson.custom ? `<button class="rowdel" data-act="del" data-i="${i}" aria-label="delete">${I('trash')}</button>` : ''}</div>
        </a>`).join('');
    app.innerHTML = topbar({ back: '#/', title: L(lesson.title) }) + `
      <div class="lhead"><div class="book">${esc(L(lesson.book))} · ${esc(t('count', lesson.kind, lesson.items.length))}</div><h2>${esc(L(lesson.title))}</h2>${lesson.task ? `<p class="task">${esc(L(lesson.task))}</p>` : ''}</div>
      <div class="startrow">${['study', 'trace', 'dict', 'tones'].map((m) => `<a href="#/${m}/${enc(lesson.id)}/0">${I(MODE_ICON[m])}${esc(t(m))}</a>`).join('')}</div>
      ${rows}
      ${lesson.custom ? `<div style="margin-top:12px"><button class="addbtn" data-act="add">${I('plus')} ${esc(t('addText'))}</button></div>` : ''}`;
    setView({
      act(a, el, e) {
        if (a === 'del') {
          e.preventDefault();
          if (!confirm(t('deleteQ'))) return;
          const it = lesson.items[+el.dataset.i];
          DB.custom = DB.custom.filter((c) => c.id !== it.id); save(); invalidate();
          if (!DB.custom.length) location.hash = '#/'; else render();
        }
      },
    });
  }

  /* ------------------------------------------------------------------ study */
  function viewStudy(lesson, idx) {
    const item = lesson.items[idx];
    const set = S();
    const isChar = lesson.kind === 'chars';
    const big = lesson.kind !== 'sentences';
    const full = T.hanziOf(item.tokens);
    const words = uniqueWords(item);
    let panel = null;
    const exs = (item.ex || []).map((e) => { const [h, p, en, ru] = String(e).split('|'); return { h, p, en, ru }; });
    app.innerHTML = itemTop(lesson, idx, 'study') + `
      <section class="card">
        <div class="meta">${metaLine(lesson, item)}</div>
        ${item.prompt ? `<div class="meta" style="text-transform:none">${esc(t('textbook'))}: <span class="hz" style="font-size:15px">${esc(item.prompt)}</span></div>` : ''}
        <div class="hline ${big ? 'h-phrase' : 'h-sent'}">${hanziHTML(item, { clickable: !isChar, ruby: set.ruby && !isChar })}</div>
        ${set.ruby && !isChar ? '' : `<div class="pline">${pinyinHTML(item, { cap: lesson.kind === 'sentences' })}</div>`}
        <div class="trs">${transHTML(item)}</div>
        ${item.note ? `<div class="note">${esc(L(item.note))}</div>` : ''}
        <div class="acts labeled">
          <button class="cbtn" data-act="say" aria-label="${esc(t('listen'))}">${I('vol')}<small>${esc(t('listen'))}</small></button>
          <button class="cbtn" data-act="slow" aria-label="${esc(t('slow'))}">${I('slow')}<small>${esc(t('slow'))}</small></button>
          <a class="cbtn" href="#/trace/${enc(lesson.id)}/${idx}" aria-label="${esc(t('trace'))}">${I('pen')}<small>${esc(t('trace'))}</small></a>
          <a class="cbtn" href="#/dict/${enc(lesson.id)}/${idx}" aria-label="${esc(t('dict'))}">${I('ear')}<small>${esc(t('dict'))}</small></a>
        </div>
      </section>
      ${isChar ? '<section class="words panel" style="padding:16px 14px"><div class="cphost"></div></section>' : ''}
      ${exs.length ? `<section class="words panel"><div class="panel-h">${esc(t('examples'))}</div>${exs.map((x, i) => {
        const tk = T.parse(`${x.h}|${x.p}`)[0];
        return `<div class="wrow" data-act="ex" data-i="${i}" role="button" tabindex="0"><span class="wh hz">${tk.chars.map((c, ci) => `<span class="t${charTone(tk, ci)}">${esc(c)}</span>`).join('')}</span><span><div class="wp">${wordPinyinHTML(tk)}</div><div class="wg">${glossLine(x)}</div></span><button class="play" data-act="sayex" data-i="${i}" aria-label="listen">${I('vol')}</button></div>`;
      }).join('')}</section>` : ''}
      ${!isChar ? `<section class="words panel"><div class="panel-h">${esc(t('words'))}</div>${words.map(({ tk, ti }) => {
        const g = glossFor(tk.h);
        return `<div class="wrow" data-act="word" data-ti="${ti}" role="button" tabindex="0">
          <span class="wh hz">${tk.chars.map((c, ci) => `<span class="t${charTone(tk, ci)}">${esc(c)}</span>`).join('')}</span>
          <span><div class="wp">${wordPinyinHTML(tk)}</div><div class="wg">${g.pos ? `<b>${esc(posLabel(g.pos))}</b>` : ''}${glossLine(g)}</div></span>
          <button class="play" data-act="sayw" data-ti="${ti}" aria-label="listen">${I('vol')}</button>
        </div>`;
      }).join('')}</section>` : ''}`;
    if (isChar) panel = mountCharPanel(app.querySelector('.cphost'), item.ch || item.tokens[0].chars[0], { syl: item.tokens[0].syl[0] });
    setView({
      destroy() { if (panel) panel.destroy(); },
      act(a, el, e) {
        if (a === 'say') say(full);
        else if (a === 'slow') say(full, true);
        else if (a === 'sayw') { e.stopPropagation(); say(item.tokens[+el.dataset.ti].h); }
        else if (a === 'word') openWordSheet(item.tokens[+el.dataset.ti], item);
        else if (a === 'sayex') { e.stopPropagation(); say(exs[+el.dataset.i].h); }
        else if (a === 'ex') { const x = exs[+el.dataset.i]; openWordSheet(T.parse(`${x.h}|${x.p}`)[0], null); }
      },
      key(e) {
        if (navKeys(lesson, idx, 'study', e)) return;
        if (e.key === ' ') { e.preventDefault(); say(full); }
      },
    });
  }

  /* ------------------------------------------------------------------ trace + dictation */
  function promptChips() {
    const p = S().prompt;
    return `<div class="chips" style="justify-content:center;margin-bottom:12px">
      <button class="chip ${!S().paper ? 'on' : ''}" data-act="paper" data-v="0">${I('tablet')} ${esc(t('onScreen'))}</button>
      <button class="chip ${S().paper ? 'on' : ''}" data-act="paper" data-v="1">${I('paper')} ${esc(t('onPaper'))}</button>
      ${!S().paper ? `<button class="chip ${S().toneQuiz ? 'on' : ''}" data-act="dtones">${I('tone')} ${esc(t('tones'))}</button>` : ''}
      <span style="width:8px"></span>
      ${[['pinyin', 'pPinyin'], ['trans', 'pTrans'], ['audio', 'pAudio']].map(([v, k]) => `<button class="chip ${p === v ? 'on' : ''}" data-act="prompt" data-v="${v}">${esc(t(k))}</button>`).join('')}
    </div>`;
  }
  function chipActs(a, el) {
    if (a === 'prompt') { S().prompt = el.dataset.v; save(); render(); return true; }
    if (a === 'paper') { S().paper = el.dataset.v === '1'; save(); render(); return true; }
    if (a === 'dtones') { S().toneQuiz = !S().toneQuiz; save(); render(); return true; }
    return false;
  }

  function viewWrite(lesson, idx, mode) {
    const dict = mode === 'dict';
    if (dict && S().paper) { viewPaper(lesson, idx); return; }
    const item = lesson.items[idx];
    const set = S();
    const cap = lesson.kind === 'sentences';
    const chars = T.charList(item.tokens);
    const segs = T.segments(item.tokens);
    const full = T.hanziOf(item.tokens);
    const segIdx = (ti) => Math.max(0, segs.findIndex((s) => ti >= s.from && ti < s.to));
    let queue = chars.map((_, i) => i);
    let qpos = 0;
    const results = new Array(chars.length).fill(null);
    let lastSeg = -1;
    const prompt = dict ? set.prompt : 'pinyin';
    const toneStep = dict && !!set.toneQuiz;
    const toneRes = new Array(chars.length).fill(null);
    let awaiting = null; let toneBusy = false;
    if (!chars.length) { viewStudy(lesson, idx); return; }

    const trFixed = dict && prompt === 'trans';
    app.innerHTML = itemTop(lesson, idx, mode) + `
      <div class="wv split">
        <section class="prompt">
          ${dict ? promptChips() : ''}
          <div class="seghead">
            ${segs.length > 1 ? `<button class="segnav" data-act="segprev" aria-label="${esc(t('prevSeg'))}">${I('back')}</button><span id="segno"></span><button class="segnav fwd" data-act="segnext" aria-label="${esc(t('nextSeg'))}">${I('back')}</button>` : '<span id="segno"></span>'}
            <div class="bar"><i id="pbar"></i></div><span id="cno"></span>
          </div>
          <div class="segp" id="segp"></div>
          <div class="ans big" id="ans"></div>
          <div class="ptr" id="ptr"></div>
          <div class="abar">
            <button class="abtn" data-act="seg">${I('vol')} ${esc(segs.length > 1 ? t('phrase') : t('listen'))}</button>
            <button class="abtn" data-act="segslow" aria-label="${esc(t('slow'))}">${I('slow')}</button>
            ${trFixed ? '' : `<button class="abtn ghost ${set.showTr ? 'on' : ''}" data-act="trtoggle">${esc(t('pTrans'))}</button>`}
          </div>
        </section>
        <section class="padwrap" id="padzone">
          <div class="padnav">
            <button class="cnav" data-act="cprev" aria-label="${esc(t('prevChar'))}">${I('back')}</button>
            <div class="padlabel" id="plabel"></div>
            <button class="cnav fwd" data-act="cnext" aria-label="${esc(t('nextChar'))}">${I('back')}</button>
          </div>
          <div class="pad" id="pad"></div>
          <div class="tonepick" id="tonepick" hidden>
            <div class="tkeys sm">${[1, 2, 3, 4, 5].map((n) => `<button class="tkey" data-act="dtone" data-v="${n}">${toneIcon(n)}<span>${n === 5 ? esc(t('neutral')) : n}</span></button>`).join('')}</div>
          </div>
          <div class="ptools" id="ptools">
            <button class="tbtn" data-act="hint">${I('bulb')} ${esc(t('hint'))}</button>
            <button class="tbtn" data-act="reveal">${I('eye')} ${esc(t('show'))}</button>
            <button class="tbtn" data-act="restart">${I('redo')} ${esc(t('again'))}</button>
          </div>
        </section>
        <section class="result" id="result" hidden></section>
      </div>`;
    const $ = (id) => app.querySelector('#' + id);
    const segp = $('segp'); const ptr = $('ptr'); const ans = $('ans'); const plabel = $('plabel');
    const segno = $('segno'); const cno = $('cno'); const pbar = $('pbar');
    const drawTr = () => { ptr.innerHTML = (trFixed || set.showTr) ? transHTML(item) : ''; };

    const firstCi = [];
    { let n = 0; item.tokens.forEach((tk, ti) => { firstCi[ti] = n; if (tk.t === 'w') n += tk.chars.filter((c) => T.isHan(c)).length; }); }
    function slotsHTML(curIdx, finished, range) {
      const inR = (ti) => !range || (ti >= range[0] && ti < range[1]);
      return groupsOf(item.tokens).map((g) => g.filter(inR)).filter((g) => g.length).map((g) => '<span class="grp">' + g.map((ti) => {
        const tk = item.tokens[ti];
        if (tk.t === 'p') return `<span class="pu">${esc(tk.h)}</span>`;
        let ci = firstCi[ti];
        return tk.chars.map((c) => {
          if (!T.isHan(c)) return esc(c);
          const i = ci++; const r = results[i];
          const cls = ['slot'];
          let txt = esc(c);
          if (!finished && i === curIdx) { cls.push('cur'); if (dict && !r) { cls.push('blank'); txt = ''; } }
          else if (r) cls.push(r.grade === 2 ? 'g' : r.grade === 1 ? 'f' : 'b');
          else if (dict) { cls.push('blank'); txt = ''; }
          else cls.push('tr0');
          return finished ? `<span class="${cls.join(' ')}">${txt}</span>` : `<button class="${cls.join(' ')}" data-act="jump" data-i="${i}">${txt}</button>`;
        }).join('');
      }).join('') + '</span>').join('<wbr>');
    }

    function update() {
      const cur = queue[qpos]; const c = chars[cur];
      if (!c) return;
      const si = segIdx(c.ti); const seg = segs[si];
      const tk = item.tokens[c.ti];
      const g = glossFor(tk.h);
      const range = seg ? [seg.from, seg.to] : null;
      segno.textContent = segs.length > 1 ? t('segOf', si + 1, segs.length) : '';
      const doneN = results.filter(Boolean).length;
      cno.textContent = `${doneN}/${chars.length}`;
      pbar.style.width = `${Math.round(100 * doneN / chars.length)}%`;
      segp.innerHTML = prompt === 'pinyin' ? pinyinHTML(item, { cap, hi: { ti: c.ti, si: c.ci }, range, bare: toneStep }) : '';
      drawTr();
      ans.innerHTML = slotsHTML(cur, false, range);
      const pos = tk.chars.length > 1 ? ` <span class="sub">${tk.chars.filter((x) => T.isHan(x)).length > 1 ? `(${c.ci + 1}/${tk.chars.length})` : ''}</span>` : '';
      const rp = `<button class="rp" data-act="sylplay" aria-label="${esc(t('sylListen'))}">${I('vol')}</button>`;
      if (!dict) plabel.innerHTML = `${rp}${sylHTML(c.syl, c.tone)}<span class="sub">${esc(tk.h)} — ${glossLine(g)}</span>`;
      else if (prompt === 'pinyin') plabel.innerHTML = `${rp}${toneStep ? sylHTML(T.bare(c.syl), 5) : sylHTML(c.syl, c.tone)}<span class="sub">${glossLine(g)}</span>${pos}`;
      else if (prompt === 'trans') plabel.innerHTML = `${rp}<span class="sub">${glossLine(g)}</span>${pos}`;
      else plabel.innerHTML = `${rp}<span class="sub">${esc(t('charOf', cur + 1, chars.length))}</span>`;
      if (dict && set.autoplay && si !== lastSeg && seg) { say(seg.text); }
      lastSeg = si;
    }
    let repDone = 0;
    const repTarget = () => (dict ? 1 : set.reps);
    function progress() {
      const tgt = repTarget();
      const b = $('repbtn'); if (!b) return;
      b.innerHTML = `${I('redo')}<span>${tgt === 1 ? '×1' : `${repDone + 1}/${tgt || '∞'}`}</span>`;
    }
    const pad = new Pad($('pad'), {
      outline: !dict,
      hintAfter: dict ? set.hintAfter : 2,
      leniency: set.leniency,
      onProgress: progress,
      onDone(r) {
        const ci = queue[qpos];
        results[ci] = r;
        if (dict) recordChar(r.ch, r.grade);
        if (toneStep && chars[ci].syl !== 'r') { askTone(ci); return; }
        repDone += 1;
        const tgt = repTarget();
        if (!dict && !r.revealed && (tgt === 0 || repDone < tgt)) { update(); pad.start(chars[ci].ch); progress(); return; }
        goTo(qpos + 1);
      },
    });
    let fitReady = false;
    if (!dict) $('pad').insertAdjacentHTML('beforeend', `<button class="repbadge" data-act="reps" id="repbtn" aria-label="${esc(t('repsSet'))}"></button>`);
    function startCur() {
      hideTone(); update(); if (dict) pad.o.outline = false; progress();
      if (fitReady) fitPad(true);
      pad.start(chars[queue[qpos]].ch);
    }
    function hideTone() { awaiting = null; toneBusy = false; $('tonepick').hidden = true; $('ptools').hidden = false; }
    // "Show": stroke order in a sheet. In dictation it counts as a hint and leaves the outline on for this character.
    function showOrder() {
      const c = chars[queue[qpos]]; if (!c) return;
      if (pad.failed) { pad.reveal(); return; }
      if (dict) { pad.usedHint = true; }
      const cur = queue[qpos];
      // dictation: only the current character (browsing others would give answers away)
      const list = dict ? [c] : chars;
      openStrokeSheet(list, dict ? 0 : cur, (k) => {
        if (!app.contains(segp)) return;
        if (dict) { if (!pad.done && chars[queue[qpos]] === c) pad.setOutline(true); return; }
        if (k !== cur) jumpTo(k);
      });
    }
    function askTone(ci) {
      awaiting = ci;
      plabel.innerHTML = `<span class="tp-q">${esc(t('toneQ', chars[ci].ch))}</span>`;
      $('tonepick').querySelectorAll('.tkey').forEach((b) => b.classList.remove('ok', 'bad'));
      $('ptools').hidden = true; $('tonepick').hidden = false;
      const r = $('tonepick').getBoundingClientRect();
      if (r.bottom > innerHeight) window.scrollBy({ top: r.bottom - innerHeight + 8, behavior: 'smooth' });
    }
    function answerTone(n, btn) {
      if (awaiting == null || toneBusy) return;
      const ci = awaiting; const c = chars[ci];
      const base = c.ch === '一' ? 1 : c.ch === '不' ? 4 : null;
      const ok = n === c.tone || (base != null && n === base);
      toneRes[ci] = ok;
      toneBusy = true;
      if (btn) btn.classList.add(ok ? 'ok' : 'bad');
      if (!ok) { const right = $('tonepick').querySelector(`.tkey[data-v="${c.tone}"]`); if (right) right.classList.add('ok'); }
      plabel.innerHTML = `<span class="tp-q"><span class="hz">${esc(c.ch)}</span> ${sylHTML(c.syl, c.tone)} ${ok ? '<b style="color:var(--good)">✓</b>' : '<b style="color:var(--bad)">✗</b>'}</span>`;
      saySyl(c.syl, c.tone, item.tokens[c.ti].h);
      setTimeout(() => { if (!app.contains(segp) || awaiting !== ci) return; hideTone(); goTo(qpos + 1); }, ok ? 750 : 1500);
    }
    function jumpTo(i) {
      if (i === queue[qpos]) return;
      const k = queue.indexOf(i);
      if (k >= qpos) { goTo(k); return; }
      const rest = queue.slice(qpos).filter((x) => x !== i);
      results[i] = null;
      queue = [i].concat(rest); qpos = 0; repDone = 0;
      startCur();
    }
    function goTo(k) {
      repDone = 0;
      if (k >= queue.length) { finish(); return; }
      qpos = Math.max(0, k);
      startCur();
    }
    function goSeg(delta) {
      const c = chars[queue[qpos]]; if (!c) return;
      const target = segIdx(c.ti) + delta;
      if (target < 0 || target >= segs.length) return;
      const k = queue.findIndex((i) => segIdx(chars[i].ti) === target);
      if (k >= 0) goTo(k);
    }

    function finish() {
      const n = chars.length;
      const g = results.filter((r) => r && r.grade === 2).length;
      const f = results.filter((r) => r && r.grade === 1).length;
      const sk = results.filter((r) => !r).length;
      const b = n - g - f - sk;
      const score = n ? Math.round(100 * (g + 0.5 * f) / n) : 0;
      recordItem(item.id, mode, score);
      const tAsked = toneRes.filter((x) => x !== null).length;
      const tOk = toneRes.filter((x) => x === true).length;
      if (toneStep && tAsked) recordItem(item.id, 'tones', Math.round((100 * tOk) / tAsked));
      invalidate();
      $('padzone').hidden = true;
      plabel.innerHTML = ''; segp.innerHTML = pinyinHTML(item, { cap });
      segno.textContent = ''; cno.textContent = `${n}/${n}`; pbar.style.width = '100%';
      ptr.innerHTML = transHTML(item);
      ans.classList.remove('big');
      ans.innerHTML = slotsHTML(-1, true);
      const wrong = chars.map((c, i) => ({ c, i })).filter(({ i }) => !results[i] || results[i].grade < 2);
      const res = $('result');
      res.hidden = false;
      res.innerHTML = `
        <div class="score ${scoreCls(score)}">${score}%</div>
        <div class="rstats"><span><b style="color:var(--good)">${g}</b> ${esc(t('clean'))}</span><span><b style="color:var(--fair)">${f}</b> ${esc(t('withErr'))}</span><span><b style="color:var(--bad)">${b}</b> ${esc(t('withHint'))}</span>${sk ? `<span><b>${sk}</b> ${esc(t('skipped'))}</span>` : ''}</div>
        ${toneStep && tAsked ? `<div class="rstats" style="margin-top:6px"><span>${I('tone')} <b style="color:${tOk === tAsked ? 'var(--good)' : 'var(--fair)'}">${esc(t('toneScore', tOk, tAsked))}</b></span></div>` : ''}
        ${wrong.length ? `<div class="chargrid" style="margin-top:16px;grid-template-columns:repeat(auto-fill,minmax(50px,1fr))">${Array.from(new Set(wrong.map((w) => w.c.ch))).map((ch) => `<button class="tile hz m${level(ch)}" data-act="char" data-ch="${esc(ch)}">${esc(ch)}</button>`).join('')}</div>` : ''}
        <div class="rbtns">
          ${wrong.length ? `<button class="pbtn" data-act="retry">${I('redo')} ${esc(t('retryMistakes'))}</button>` : ''}
          <button class="pbtn ghost" data-act="again">${I('redo')} ${esc(t('retryAll'))}</button>
          ${idx < lesson.items.length - 1 ? `<a class="pbtn" href="#/${mode}/${enc(lesson.id)}/${idx + 1}">${esc(t('next'))} ${I('right')}</a>` : `<a class="pbtn" href="#/l/${enc(lesson.id)}">${esc(t('toList'))}</a>`}
        </div>`;
      res.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    function restartWith(list) {
      list.forEach((i) => { results[i] = null; toneRes[i] = null; });
      queue = list; qpos = 0; lastSeg = -1; repDone = 0;
      $('result').hidden = true; $('padzone').hidden = false; ans.classList.add('big');
      startCur();
    }

    // Size the writing grid so the phrase, the grid and its buttons fit on one screen
    // (iPhone, iPad split view, landscape); scroll only when the buttons would be cut off.
    function fitPad(scroll) {
      if (!app.contains(segp)) return;
      const padEl = $('pad');
      const split = getComputedStyle(app.querySelector('.wv')).gridTemplateColumns.split(' ').length > 1;
      if (split || !$('result').hidden) { if (padEl.style.width) { padEl.style.width = ''; pad.resize(); } return; }
      const topH = app.querySelector('.top').getBoundingClientRect().height;
      const head = app.querySelector('.seghead');
      const last = !$('tonepick').hidden ? $('tonepick') : $('ptools');
      const cur = padEl.getBoundingClientRect().width;
      const other = last.getBoundingClientRect().bottom - head.getBoundingClientRect().top - cur;
      const w = Math.floor(Math.max(240, Math.min(padEl.parentElement.clientWidth, innerHeight - topH - 18 - other)));
      if (Math.abs(w - cur) > 2) { padEl.style.width = w + 'px'; pad.resize(); }
      if (scroll && last.getBoundingClientRect().bottom > innerHeight - 4) {
        const target = head.getBoundingClientRect().top + window.scrollY - topH - 8;
        window.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
      }
    }
    onSwipe(app.querySelector('.prompt'), (d) => {
      if (awaiting != null || !$('result').hidden) return;
      if (d > 0) goTo(qpos + 1);
      else if (qpos > 0) { results[queue[qpos - 1]] = null; goTo(qpos - 1); }
    });
    const onFit = debounce(() => fitPad(false), 120);
    window.addEventListener('resize', onFit);
    startCur();
    requestAnimationFrame(() => { fitReady = true; fitPad(true); });
    setView({
      destroy() { pad.destroy(); window.removeEventListener('resize', onFit); },
      act(a, el) {
        if (chipActs(a, el)) return;
        const c = chars[queue[qpos]];
        if (a === 'seg' || a === 'segslow') { const s = c ? segs[segIdx(c.ti)] : segs[0]; if (s) say(s.text, a === 'segslow'); }
        else if (a === 'sylplay') { if (c) saySyl(c.syl, c.tone, item.tokens[c.ti].h); }
        else if (a === 'dtone') answerTone(+el.dataset.v, el);
        else if (a === 'say') say(full);
        else if (a === 'trtoggle') { set.showTr = !set.showTr; save(); el.classList.toggle('on', set.showTr); drawTr(); fitPad(false); }
        else if (a === 'cprev') { if (qpos > 0) { results[queue[qpos - 1]] = null; goTo(qpos - 1); } else { repDone = 0; startCur(); } }
        else if (a === 'cnext') goTo(qpos + 1);
        else if (a === 'segprev') goSeg(-1);
        else if (a === 'segnext') goSeg(1);
        else if (a === 'reps') {
          const order = [1, 3, 5, 0]; set.reps = order[(order.indexOf(set.reps) + 1) % order.length]; save();
          progress(); toast(t('repsBtn', set.reps));
        }
        else if (a === 'hint') pad.hint();
        else if (a === 'reveal') showOrder();
        else if (a === 'restart') pad.restart();
        else if (a === 'retry') restartWith(chars.map((_, i) => i).filter((i) => !results[i] || results[i].grade < 2));
        else if (a === 'again') restartWith(chars.map((_, i) => i));
        else if (a === 'jump') jumpTo(+el.dataset.i);
      },
      key(e) {
        if (awaiting != null) {
          const m = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 0: 5 }[e.key];
          if (m) { e.preventDefault(); answerTone(m, $('tonepick').querySelector(`.tkey[data-v="${m}"]`)); return; }
        }
        navKeys(lesson, idx, mode, e);
      },
    });
  }

  /* ------------------------------------------------------------------ paper dictation */
  function viewPaper(lesson, idx) {
    const item = lesson.items[idx];
    const set = S();
    const cap = lesson.kind === 'sentences';
    const segs = T.segments(item.tokens);
    const grades = new Array(segs.length).fill(null);
    let pos = 0; let shown = false;
    app.innerHTML = itemTop(lesson, idx, 'dict') + `
      <div class="wv">
        <section class="prompt">
          ${promptChips()}
          <p class="task" style="text-align:center">${esc(t('paperTask'))}</p>
          <div class="abar" style="justify-content:center;margin-top:12px"><div class="abtns">
            <button class="abtn" data-act="seg">${I('vol')} ${esc(segs.length > 1 ? t('phrase') : t('listen'))}</button>
            <button class="abtn" data-act="segslow" aria-label="${esc(t('slow'))}">${I('slow')}</button>
            ${segs.length > 1 ? `<button class="abtn" data-act="say">${I('vol')} ${esc(t('whole'))}</button>` : ''}
          </div></div>
          <div id="pbody"></div>
        </section>
        <section class="result" id="result" hidden></section>
      </div>`;
    const body = app.querySelector('#pbody');
    const segItem = (s) => Object.assign({}, item, { tokens: item.tokens.slice(s.from, s.to) });
    function draw() {
      const s = segs[pos];
      const label = segs.length > 1 ? `<span class="muted">${esc(t('segOf', pos + 1, segs.length))}</span>` : '';
      const promptHTML = set.prompt === 'pinyin' ? pinyinHTML(item, { cap, range: [s.from, s.to] }) : '';
      body.innerHTML = `
        <div class="segp">${label}${promptHTML}</div>
        ${set.prompt === 'trans' ? `<div class="ptr">${transHTML(item)}</div>` : ''}
        <div style="text-align:center;margin-top:18px">
          ${shown
            ? `<div class="hline h-phrase" style="font-size:clamp(34px,7vw,54px)">${hanziHTML(segItem(s), {})}</div>
               <div class="pline">${pinyinHTML(segItem(s), { cap })}</div>
               <div class="rbtns">
                 <button class="pbtn ghost" data-act="grade" data-v="0" style="border-color:var(--bad);color:var(--bad)">${I('x')} ${esc(t('missed'))}</button>
                 <button class="pbtn ghost" data-act="grade" data-v="1" style="border-color:var(--fair);color:var(--fair)">~ ${esc(t('almost'))}</button>
                 <button class="pbtn" data-act="grade" data-v="2" style="background:var(--good)">${I('check')} ${esc(t('gotIt'))}</button>
               </div>`
            : `<button class="pbtn" data-act="show">${I('eye')} ${esc(t('reveal'))}</button>`}
        </div>
        <div class="ans" style="margin-top:20px">${segs.map((sg, i) => `<span class="slot ${grades[i] == null ? (i === pos ? 'cur' : 'tr0') : grades[i] === 2 ? 'g' : grades[i] === 1 ? 'f' : 'b'}" style="padding:0 6px">${grades[i] == null && i !== pos ? '·'.repeat(Math.min(8, T.charList(item.tokens.slice(sg.from, sg.to)).length)) : esc(i === pos && !shown ? '…' : sg.text)}</span>`).join(' ')}</div>`;
      if (set.autoplay && !shown) say(s.text);
    }
    function finish() {
      const score = Math.round(100 * grades.reduce((a, g) => a + (g || 0), 0) / (2 * segs.length));
      recordItem(item.id, 'dict', score); invalidate();
      body.innerHTML = `<div class="hline h-sent" style="margin-top:16px;text-align:center">${hanziHTML(item, {})}</div><div class="pline" style="text-align:center">${pinyinHTML(item, { cap })}</div><div class="trs">${transHTML(item)}</div>`;
      const res = app.querySelector('#result');
      res.hidden = false;
      res.innerHTML = `<div class="score ${scoreCls(score)}">${score}%</div>
        <div class="rbtns">
          <button class="pbtn ghost" data-act="again">${I('redo')} ${esc(t('retryAll'))}</button>
          ${idx < lesson.items.length - 1 ? `<a class="pbtn" href="#/dict/${enc(lesson.id)}/${idx + 1}">${esc(t('next'))} ${I('right')}</a>` : `<a class="pbtn" href="#/l/${enc(lesson.id)}">${esc(t('toList'))}</a>`}
        </div>`;
    }
    draw();
    setView({
      act(a, el) {
        if (chipActs(a, el)) return;
        const s = segs[pos];
        if ((a === 'seg' || a === 'segslow') && s) say(s.text, a === 'segslow');
        else if (a === 'say') say(T.hanziOf(item.tokens));
        else if (a === 'show') { shown = true; draw(); }
        else if (a === 'grade') {
          grades[pos] = +el.dataset.v; shown = false; pos += 1;
          if (pos >= segs.length) finish(); else draw();
        } else if (a === 'again') { grades.fill(null); pos = 0; shown = false; app.querySelector('#result').hidden = true; draw(); }
      },
      key(e) {
        if (navKeys(lesson, idx, 'dict', e)) return;
        if (e.key === ' ') { e.preventDefault(); const s = segs[pos]; if (s) say(s.text); }
      },
    });
  }

  /* ------------------------------------------------------------------ tones */
  const TONE_MARK = { 1: 'ˉ', 2: 'ˊ', 3: 'ˇ', 4: 'ˋ', 5: '·' };
  const TONE_ICON = {
    1: '<path d="M6 8H34"/>', 2: '<path d="M8 20 32 5"/>', 3: '<path d="M6 6Q18 30 34 7"/>',
    4: '<path d="M8 5 32 20"/>', 5: '<circle cx="20" cy="13" r="4" fill="currentColor" stroke="none"/>',
  };
  const toneIcon = (n) => `<svg class="ti t${n}" viewBox="0 0 40 26" aria-hidden="true">${TONE_ICON[n]}</svg>`;
  function viewTones(lesson, idx) {
    const item = lesson.items[idx];
    const set = S();
    const chars = T.charList(item.tokens);
    const st = chars.map((c) => (c.syl === 'r' ? { auto: true } : null));
    let pos = st.findIndex((x) => !x); let tries = 0; let busy = false; let alive = true;
    const segs = T.segments(item.tokens);
    const segOfTi = (ti) => Math.max(0, segs.findIndex((g) => ti >= g.from && ti < g.to));
    app.innerHTML = itemTop(lesson, idx, 'tones') + `
      <section class="prompt">
        <p class="task" style="text-align:center;margin-bottom:10px">${esc(t('toneTask'))}</p>
        <div class="seghead"><span id="segno"></span><div class="bar"><i id="pbar"></i></div><span id="cno"></span></div>
        <div class="tline" id="tline"></div>
        <div class="ptr" id="ptr"></div>
        <div class="abar">
          <button class="abtn" data-act="seg">${I('vol')} ${esc(segs.length > 1 ? t('phrase') : t('listen'))}</button>
          <button class="abtn ghost ${set.toneSyl ? 'on' : ''}" data-act="tsyl">${esc(t('toneSyl'))}</button>
          <button class="abtn ghost ${set.showTr ? 'on' : ''}" data-act="trtoggle">${esc(t('pTrans'))}</button>
        </div>
      </section>
      <div class="tkeys" id="tkeys">
        ${[1, 2, 3, 4, 5].map((n) => `<button class="tkey" data-act="tone" data-v="${n}" aria-label="${n === 5 ? esc(t('neutral')) : n} ${TONE_MARK[n]}">${toneIcon(n)}<span>${n === 5 ? esc(t('neutral')) : n}</span></button>`).join('')}
      </div>
      <p class="rhint" style="text-align:center">${esc(t('toneNote'))}</p>
      <section class="result" id="result" hidden style="margin-top:12px"></section>`;
    const line = app.querySelector('#tline');
    const ptr = app.querySelector('#ptr');
    const drawTr = () => { ptr.innerHTML = set.showTr ? transHTML(item) : ''; };
    const firstCi = [];
    { let n = 0; item.tokens.forEach((tk, ti) => { firstCi[ti] = n; if (tk.t === 'w') n += tk.chars.filter((c) => T.isHan(c)).length; }); }
    const curSeg = () => (pos >= 0 && chars[pos] ? segs[segOfTi(chars[pos].ti)] : null);
    function draw(shakeIdx) {
      const sg = curSeg();
      const real = st.filter((x) => !x || !x.auto).length;
      const doneN = st.filter((x) => x && !x.auto).length;
      app.querySelector('#segno').textContent = sg && segs.length > 1 ? t('segOf', segs.indexOf(sg) + 1, segs.length) : '';
      app.querySelector('#cno').textContent = `${doneN}/${real}`;
      app.querySelector('#pbar').style.width = `${real ? Math.round(100 * doneN / real) : 100}%`;
      line.innerHTML = item.tokens.map((tk, ti) => {
        if (sg && (ti < sg.from || ti >= sg.to)) return '';
        if (tk.t === 'p') return `<span class="tcell pu"><span class="tm"></span><span class="tc">${esc(tk.h)}</span><span class="tb"></span></span>`;
        let ci = firstCi[ti];
        return tk.chars.map((c, k) => {
          if (!T.isHan(c)) return '';
          const i = ci++; const s = st[i]; const ch = chars[i];
          const cls = ['tcell'];
          let tm = '';
          if (s && s.auto) { cls.push('auto'); tm = sylHTML(ch.syl, charTone(tk, k)); }
          else if (s) { cls.push(s.ok ? 'ok' : 'bad'); tm = sylHTML(ch.syl, ch.tone); }
          else if (i === pos) { cls.push('cur'); tm = '?'; }
          if (i === shakeIdx) cls.push('shake');
          const tc = s ? `<span class="t${charTone(tk, k)}">${esc(c)}</span>` : esc(c);
          return `<span class="${cls.join(' ')}"><span class="tm">${tm}</span><span class="tc">${tc}</span><span class="tb">${set.toneSyl && !s ? esc(T.bare(ch.syl)) : ''}</span></span>`;
        }).join('');
      }).join('');
    }
    drawTr();
    function advance() {
      const c = chars[pos];
      const tk = item.tokens[c.ti];
      const last = chars.filter((x) => x.ti === c.ti).pop();
      if (set.autoplay && last === c) say(tk.h);
      tries = 0;
      pos = st.findIndex((x) => !x);
      draw();
      if (pos < 0) finish();
    }
    function answer(n) {
      if (pos < 0 || busy || !alive) return;
      const c = chars[pos];
      const base = c.ch === '一' ? 1 : c.ch === '不' ? 4 : null;
      if (n === c.tone || (base && n === base)) {
        st[pos] = { ok: tries === 0 };
        advance();
      } else {
        tries += 1;
        if (tries >= 2) { st[pos] = { ok: false }; draw(); busy = true; setTimeout(() => { busy = false; if (alive) advance(); }, 650); }
        else draw(pos);
      }
    }
    function finish() {
      const real = st.filter((x) => !x.auto);
      const score = real.length ? Math.round(100 * real.filter((x) => x.ok).length / real.length) : 100;
      recordItem(item.id, 'tones', score); invalidate();
      app.querySelector('#tkeys').hidden = true;
      const res = app.querySelector('#result');
      res.hidden = false;
      res.innerHTML = `<div class="score ${scoreCls(score)}">${score}%</div>
        <div class="pline">${pinyinHTML(item, { cap: lesson.kind === 'sentences' })}</div>
        <div class="rbtns">
          <button class="pbtn ghost" data-act="again">${I('redo')} ${esc(t('retryAll'))}</button>
          ${idx < lesson.items.length - 1 ? `<a class="pbtn" href="#/tones/${enc(lesson.id)}/${idx + 1}">${esc(t('next'))} ${I('right')}</a>` : `<a class="pbtn" href="#/l/${enc(lesson.id)}">${esc(t('toList'))}</a>`}
        </div>`;
    }
    draw();
    if (pos < 0) finish();
    setView({
      destroy() { alive = false; },
      act(a, el) {
        if (a === 'tone') answer(+el.dataset.v);
        else if (a === 'say') say(T.hanziOf(item.tokens));
        else if (a === 'seg') { const sg = curSeg() || segs[segs.length - 1]; if (sg) say(sg.text); }
        else if (a === 'trtoggle') { set.showTr = !set.showTr; save(); el.classList.toggle('on', set.showTr); drawTr(); }
        else if (a === 'tsyl') { S().toneSyl = !S().toneSyl; save(); el.classList.toggle('on', S().toneSyl); draw(); }
        else if (a === 'again') render();
      },
      key(e) {
        if (navKeys(lesson, idx, 'tones', e)) return;
        const m = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 0: 5 }[e.key];
        if (m) { e.preventDefault(); answer(m); }
      },
    });
  }

  /* ------------------------------------------------------------------ router */
  function render(keepSheets) {
    teardown(keepSheets);
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    const [v, lid, ix] = parts;
    window.scrollTo(0, 0);
    if (!v) { viewHome(); return; }
    const lesson = findLesson(lid);
    if (!lesson || !lesson.items.length) { location.replace('#/'); return; }
    if (v === 'l') { viewLesson(lesson); return; }
    let idx = parseInt(ix, 10); if (!(idx >= 0)) idx = 0;
    if (idx >= lesson.items.length) idx = lesson.items.length - 1;
    if (v === 'study') viewStudy(lesson, idx);
    else if (v === 'trace') viewWrite(lesson, idx, 'trace');
    else if (v === 'dict') viewWrite(lesson, idx, 'dict');
    else if (v === 'tones') viewTones(lesson, idx);
    else location.replace('#/');
  }
  window.addEventListener('hashchange', () => render());
  render();

  // Offline support (service workers need HTTPS; skipped on the plain-http LAN address)
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
