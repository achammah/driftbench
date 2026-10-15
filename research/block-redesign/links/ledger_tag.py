"""Ledger row for every run record with a given tag across data/runs: python ledger_tag.py <tag> <batch> <note> <cum_before>."""
import json, sys
from pathlib import Path
tag, batch, note, cum = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4])
t = {"in": 0, "out": 0, "cw": 0, "cr": 0, "calls": 0}; usd = 0.0; n = 0
for p in Path("data/runs").glob("*.jsonl"):
    for line in p.open():
        r = json.loads(line)
        if r.get("tag") != tag or "error" in r:
            continue
        n += 1; usd += r["usd"]
        for k in t: t[k] += r["usage"][k]
print(f"| 2026-10-15 | {batch} | claude-haiku-5-5 | {t['calls']} | {t['in']} / {t['cw']} / {t['cr']} / {t['out']} | {usd:.4f} | {cum+usd:.4f} | {note} ({n} conversation runs) |")
