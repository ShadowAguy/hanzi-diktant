# 汉字 · Иероглифический диктант

Static web app for practising the Lesson 13 character dictation («Начальный курс китайского языка»):
study cards with tone colours, pinyin and RU/EN translations, stroke-order animation, tracing,
handwriting dictation (on screen or on paper), tone marking, and your own texts.

- Content: `data/lessons.js` (sentence format documented in `js/text.js`)
- Rebuild stroke data / glosses / audio: `cd tools && npm install && node build-data.mjs`
  (needs a Python venv in `tools/.venv` with numpy, scipy, scikit-image, opencv-python-headless, fonttools)
- Stroke shapes are print style: `tools/build-sans.py` re-cuts every character from Noto Sans SC
  (SIL OFL) into strokes, using Make Me a Hanzi only for stroke order. Fixes go in `tools/sans-overrides.json`.
- Single-syllable audio: `node tools/fetch-syllables.mjs` (davinfifield/mp3-chinese-pinyin-sound, public domain)
- After any change: `python3 tools/release.py` (cache-busting + offline service worker)
