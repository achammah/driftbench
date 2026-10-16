"""Writes the batch table of LEDGER.md from data/usage.jsonl (provider usage fields times the prices in common.py).

python ledger.py   prints the table; LEDGER.md keeps it between the markers.
"""

from __future__ import annotations

from collections import OrderedDict

from common import CAP, ROOT, STOP_AT, USAGE, read_jsonl

START, END = "<!-- table -->", "<!-- /table -->"


def table() -> str:
    rows: OrderedDict = OrderedDict()
    for r in read_jsonl(USAGE):
        k = (r["batch"], r["model"])
        a = rows.setdefault(k, {"calls": 0, "in": 0, "cached": 0, "out": 0, "usd": 0.0})
        a["calls"] += 1
        a["in"] += r["input"]
        a["cached"] += r["cachedInput"]
        a["out"] += r["output"]
        a["usd"] += r["usd"]
    lines = ["| Batch | Model | Calls | Input tokens | Cached input | Output tokens | USD | Cumulative USD |", "|---|---|---|---|---|---|---|---|"]
    cum = 0.0
    for (b, m), a in rows.items():
        cum += a["usd"]
        lines.append(f"| {b} | {m} | {a['calls']} | {a['in']} | {a['cached']} | {a['out']} | {a['usd']:.4f} | {cum:.4f} |")
    lines.append("")
    lines.append(f"Total: {cum:.4f} USD of {CAP:.0f} (stop line {STOP_AT}).")
    return "\n".join(lines)


if __name__ == "__main__":
    p = ROOT / "LEDGER.md"
    t = table()
    text = p.read_text()
    head, rest = text.split(START, 1)
    _, tail = rest.split(END, 1)
    p.write_text(f"{head}{START}\n{t}\n{END}{tail}")
    print(t)
