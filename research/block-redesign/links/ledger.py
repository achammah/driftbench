"""Sums usage per run file into a ledger row: python ledger.py <runs.jsonl> <batch> <note> <cumulative_before>."""
import json, sys
p, batch, note, cum = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4])
t = {"in": 0, "out": 0, "cw": 0, "cr": 0, "calls": 0}; usd = 0.0; errs = 0
for line in open(p):
    r = json.loads(line)
    if "error" in r:
        errs += 1; continue
    usd += r["usd"]
    for k in t: t[k] += r["usage"][k]
print(f"| 2026-10-14 | {batch} | claude-haiku-5-5 | {t['calls']} | {t['in']} / {t['cw']} / {t['cr']} / {t['out']} | {usd:.4f} | {cum+usd:.4f} | {note}{'; errors '+str(errs) if errs else ''} |")
