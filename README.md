# 汉字 · Иероглифический диктант

Static web app for practising the Lesson 13 character dictation («Начальный курс китайского языка»):
study cards with tone colours, pinyin and RU/EN translations, stroke-order animation, tracing,
handwriting dictation (on screen or on paper), tone marking, and your own texts.

- Content: `data/lessons.js` (sentence format documented in `js/text.js`)
- Rebuild stroke data / glosses / audio: `cd tools && npm install && node build-data.mjs`
- After any change: `python3 tools/release.py` (cache-busting + offline service worker)
