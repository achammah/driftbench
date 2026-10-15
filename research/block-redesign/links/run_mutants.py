"""Drives the H7 mutant runs (3 reps per variant, resumable) and the confirmation runs, under the budget stop.

python run_mutants.py stage1          every ok variant in mutants/manifest.json, full suite x 3
python run_mutants.py confirm         confirmation runs for the stage-1 candidates (analysis.stage1_candidates)
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

from acme_live.runner import load_suite, run_variant

HERE = Path(__file__).parent
RUNS = HERE / "data" / "runs"
STOP_USD = 36.0


def spent() -> float:
    total = 0.0
    for p in RUNS.glob("*.jsonl"):
        for line in p.open():
            total += json.loads(line).get("usd", 0.0)
    man = HERE / "mutants" / "manifest.json"
    if man.exists():
        total += json.loads(man.read_text()).get("usage", {}).get("usd", 0.0)
    return total + 0.05  # attempt-1 generator spend, unmetered upper bound (LEDGER.md)


def done_jobs(variant: str, tag: str) -> Counter:
    c = Counter()
    p = RUNS / f"{variant}.jsonl"
    if p.exists():
        for line in p.open():
            r = json.loads(line)
            if "error" not in r and r.get("tag") == tag:
                c[(r["rep"], r["conv"])] += 1
    return c


def _one_variant(v, convs):
    if spent() >= STOP_USD:
        return f"{v['id']} skipped: budget"
    have = done_jobs(v["id"], "stage1")
    text = (HERE / "mutants" / f"{v['id']}.md").read_text()
    for rep in range(3):
        missing = [c for c in convs if (rep, c) not in have]
        if missing:
            run_variant(v["id"], text, 1, missing, 16, rep_offset=rep, tag="stage1")
    return f"{v['id']} cum ${spent():.3f}"


def stage1():
    from concurrent.futures import ThreadPoolExecutor
    man = json.loads((HERE / "mutants" / "manifest.json").read_text())
    convs = [c["id"] for c in load_suite()["conversations"]]
    todo = [v for v in man["variants"] if v["status"] == "ok"]
    with ThreadPoolExecutor(max_workers=3) as ex:
        for msg in ex.map(lambda v: _one_variant(v, convs), todo):
            print(msg, flush=True)


def confirm():
    from analysis_h7 import stage1_candidates
    cands = stage1_candidates()
    pairs = sorted({(m, conv) for m, _b, conv in cands})
    print(f"{len(cands)} candidate (mutant, block) pairs over {len(pairs)} (mutant, conversation) runs")
    from concurrent.futures import ThreadPoolExecutor

    def one(mc):
        m, conv = mc
        if spent() >= STOP_USD:
            return "skipped: budget"
        have = done_jobs(m, "confirm")
        text = (HERE / "mutants" / f"{m}.md").read_text()
        missing = [rep for rep in range(100, 103) if (rep, conv) not in have]
        for rep in missing:
            run_variant(m, text, 1, [conv], 1, rep_offset=rep, tag="confirm")
        return f"{m} {conv}"

    with ThreadPoolExecutor(max_workers=12) as ex:
        for msg in ex.map(one, pairs):
            print(msg, flush=True)
    print(f"cum ${spent():.3f}")


if __name__ == "__main__":
    {"stage1": stage1, "confirm": confirm}[sys.argv[1]]()
