"""Builds hf9-r6.json from the fw-value HF9 (b) recorded runs (the town-less realisations of B5 and B6, base1 and
the prompt fix): per run, whether it failed the exact oracle, whether it called coverage_check, and whether its
reply names the town. No model call: the runs are the recorded ones, scored by the research port of the oracle.

Run from research/block-redesign/framework/value/src on branch research/block-framework-value (6786a4f05):
  python3 build_hf9_r6.py <out.json>
The written file is then formatted with `biome check --write`.
"""

import json
import sys

from common import DATA, read_jsonl
from hf9 import LABELS
from oracle import exact_oracle

out = {}
for arm in ("base1", "prompt"):
    rows = []
    for r in sorted(read_jsonl(DATA / "hf9" / f"results-target_b-{arm}.jsonl"), key=lambda x: x["id"]):
        calls = [{"label": LABELS.get(c["name"], c["name"]), "input": c["input"],
                  **({"output": c["output"]} if c["ok"] else {"error": c.get("error")})} for c in r["calls"]]
        failed = bool(exact_oracle(r["block"], calls))
        called = any(c["label"] == "coverage.check" for c in calls)
        rows.append({"id": r["id"], "block": r["block"], "failed": failed, "slot_called": called,
                     "reply_names_town": "town" in r["text"].lower()})
    out[arm] = rows
open(sys.argv[1], "w").write(json.dumps(out, indent=1) + "\n")
