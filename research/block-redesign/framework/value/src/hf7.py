"""HF7: read-first judge against side-by-side on the item bank (data/hf7_items.json).

python hf7.py run <model> [--limit N]      both designs, both orders, 3 repeats
Judgments land in data/hf7_judgments.jsonl, one row per (model, design, item, order, repeat).
"""

from __future__ import annotations

import argparse
import json
from concurrent.futures import ThreadPoolExecutor

from common import DATA, append_jsonl, read_jsonl
from hf7_items import FIELDS
from judges import read_first, side_by_side

OUT = DATA / "hf7_judgments.jsonl"
REPEATS = 3


def run(model: str, limit: int | None, workers: int) -> None:
    items = json.loads((DATA / "hf7_items.json").read_text())
    if limit:
        items = items[:limit]
    done = {(r["model"], r["design"], r["item"], r["order"], r["repeat"]) for r in read_jsonl(OUT)}
    tasks = [(d, it, o, r) for it in items for r in range(REPEATS) for o in (1, 2) for d in ("sbs", "read_first")
             if (model, d, it["id"], o, r) not in done]
    print(f"{model}: {len(tasks)} judgments to run", flush=True)

    def go(t):
        d, it, o, r = t
        desc = FIELDS[it["field"]]
        try:
            if d == "sbs":
                same, extra = side_by_side(f"hf7-{model}", model, desc, it["gold"], it["candidate"], o, r), {}
            else:
                v = read_first(f"hf7-{model}", model, desc, it["gold"], it["candidate"], o, r)
                same, extra = v["same"], {"compared": v["compared"], "readings": [x.get("reading") for x in v["readings"]]}
            append_jsonl(OUT, {"model": model, "design": d, "item": it["id"], "order": o, "repeat": r, "same": same, **extra})
        except SystemExit:
            raise
        except Exception as e:  # noqa: BLE001
            append_jsonl(DATA / "hf7_judgments.errors.jsonl", {"model": model, "design": d, "item": it["id"], "order": o, "repeat": r, "error": str(e)})

    with ThreadPoolExecutor(max_workers=workers) as pool:
        list(pool.map(go, tasks))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd")
    ap.add_argument("model")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--workers", type=int, default=8)
    a = ap.parse_args()
    run(a.model, a.limit, a.workers)
