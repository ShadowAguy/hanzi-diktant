#!/usr/bin/env python3
"""Synthesize mp3s with edge-tts. Reads JSON [{text, path}] from stdin."""
import asyncio
import json
import os
import sys

try:
    import edge_tts
except Exception as e:
    json.dump({"ok": False, "error": f"import edge_tts: {e}", "results": []}, sys.stdout, ensure_ascii=False)
    sys.exit(0)

VOICE = "zh-CN-XiaoxiaoNeural"
CONCURRENCY = 4


async def synth_one(sem, text, path):
    async with sem:
        if os.path.isfile(path) and os.path.getsize(path) > 0:
            return {"text": text, "path": path, "status": "skip"}
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        tmp = path + ".partial"
        try:
            communicate = edge_tts.Communicate(text, VOICE)
            await communicate.save(tmp)
            if not os.path.isfile(tmp) or os.path.getsize(tmp) == 0:
                return {"text": text, "path": path, "status": "err", "error": "empty output"}
            os.replace(tmp, path)
            return {"text": text, "path": path, "status": "ok"}
        except Exception as e:
            try:
                if os.path.exists(tmp):
                    os.remove(tmp)
            except OSError:
                pass
            return {"text": text, "path": path, "status": "err", "error": str(e)}


async def main():
    jobs = json.load(sys.stdin)
    sem = asyncio.Semaphore(CONCURRENCY)
    results = await asyncio.gather(*[synth_one(sem, j["text"], j["path"]) for j in jobs])
    json.dump({"ok": True, "results": results}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as e:
        json.dump({"ok": False, "error": str(e), "results": []}, sys.stdout, ensure_ascii=False)
