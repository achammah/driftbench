"""Builds h3-runs.json, the 182 H3 exact-match failures as evidence inputs, from the fw-value research data.

Run from the research folder of branch research/block-framework-value (commit 6786a4f05):
  python3 build_h3.py <research/block-redesign/framework/value> <out.json>
No model call: the reply reading is the recorded gpt-6-luna classifier answer (data/hf8_classifier.jsonl) and the
value facts are the recorded ladder record of results.json (per_run_HF5_HF6, L_fields).
The written file is then formatted with `biome check --write`; h3.ts pins the sha256 of the formatted file.
"""

import json
import re
import sys
from pathlib import Path

import yaml

root = Path(sys.argv[1])
out = Path(sys.argv[2])

BLOCK_SPECS = {
    "B1": ("new-customer-coverage", 1), "B2": ("new-customer-coverage", 3), "B3": ("number-porting", 1),
    "B4": ("plan-upgrade", 1), "B5": ("order-loose-confirmation", 0), "B6": ("off-topic-return", 0),
    "B7": ("tool-failure", 1), "B8": ("gen-twise-023", 1), "B9": ("gen-twise-066", 1), "B10": ("gen-twise-018", 2),
}
SLOTS = {
    "B1": ("coverage.check", "address", [], "88 Summit Avenue, Acmeville"),
    "B2": ("notify_sales", "customer", ["phone"], "+12025550131"),
    "B3": ("port.check", "number", [], "+12025550150"),
    "B4": ("catalog.search", "customer_email", [], "sam.rivera@example.com"),
    "B5": ("coverage.check", "address", [], "14 Harbor Road, Acmeville"),
    "B6": ("coverage.check", "address", [], "3 Orchard Way, Acmeville"),
    "B7": ("notify_sales", "customer", ["phone"], "+12025550188"),
    "B8": ("coverage.check", "address", [], "7 Quarry Lane, Acmeville"),
    "B9": ("port.check", "number", [], "+12025550160"),
    "B10": ("catalog.search", "customer_email", [], "morgan.diaz@example.com"),
}
# The prompt line that states each step, read by hand from acme/prompt/acme-sales.md.
HOME = {"B1", "B5", "B6", "B8"}
PORT = {"B3", "B9"}
UPGRADE = {"B4", "B10"}


def step_line(block, label):
    if label == "coverage.check":
        return 38
    if label == "port.check":
        return 53
    if label == "catalog.search":
        return 44 if block in HOME else 62 if block in PORT else 26
    if label == "notify_sales":
        return 80
    if label == "order.create":
        return 35 if block in UPGRADE else 71
    return None


def is_zero(count):
    return count == 0 or (isinstance(count, dict) and count.get("max") == 0)


blocks = {}
for bid, (spec, idx) in BLOCK_SPECS.items():
    doc = yaml.safe_load((root / "inputs" / "specs" / f"{spec}.yaml").read_text())
    expect = doc["blocks"][idx]["expect"]
    labels = [t["label"] for t in (expect.get("tools") or []) if not is_zero(t.get("count"))]
    links = []
    for label in labels:
        line = step_line(bid, label)
        links.append({"verdict": f"tools.{label}.count", "home": "core", "act": "step",
                      "file": "prompts/acme-sales.md", "line": line})
    if len(labels) > 1:
        links.append({"verdict": "tools.order", "home": "core", "act": "step", "file": "prompts/acme-sales.md",
                      "line": step_line(bid, labels[1])})
    tool, field, path, gold = SLOTS[bid]
    stated = []
    if tool == "coverage.check":
        stated.append({"tool": "coverage.check", "field": "address", "where": "prompt",
                       "asks": ["street_number", "street_name", "town"], "toolNeeds": ["street_number", "street_name"],
                       "recovery": "asked_user", "file": "prompts/acme-sales.md", "line": 41})
    blocks[bid] = {"spec": spec, "index": idx, "tools": labels, "toolOrder": expect.get("tool_order"),
                   "slot": {"tool": tool, "field": field, "path": path, "gold": gold}, "links": links, "stated": stated}

hand = {}
for line in (root / "inputs" / "hand_classification_h3_runs.md").read_text().splitlines():
    if not re.match(r"^\| B\d+#", line):
        continue
    cells = [c.strip() for c in line.strip().strip("|").split("|")]
    hand[cells[0]] = {"class": cells[1], "prov": cells[4], "result": cells[5], "next": cells[6], "fault": cells[7]}

reading = {r["id"]: r for r in map(json.loads, (root / "data" / "hf8_classifier.jsonl").read_text().splitlines())}
results = json.loads((root / "results.json").read_text())
ladder = {r["id"]: r for r in results["per_run_HF5_HF6"]}

runs = []
for raw in (root / "inputs" / "runs-class.jsonl").read_text().splitlines():
    r = json.loads(raw)
    if r.get("exact") is not False:
        continue
    facts = []
    for f in ladder[r["id"]].get("L_fields") or []:
        tool, field, path, gold = SLOTS[r["block"]]
        fact = {"tool": f["tool"], "field": f["field"], "path": path, "call": f.get("call", 0), "value": f["value"],
                "gold": gold, "rung": f["rung"], "settles": f["settles"]}
        if "outcome" in f:
            fact["outcome"] = f["outcome"]
        facts.append(fact)
    c = reading[r["id"]]
    runs.append({"id": r["id"], "block": r["block"], "hand": hand[r["id"]], "user": r["text"],
                 "calls": [{k: v for k, v in call.items() if k in ("label", "input", "output", "error")} for call in r["calls"]],
                 "reply": r["reply"], "failing": r["exactFailed"], "values": facts,
                 "reading": {"next_action": c["next_action"], "asked_for": c["asked_for"], "by": "gpt-6-luna (recorded)"}})

assert len(runs) == 182, len(runs)
out.write_text(json.dumps({
    "source": "research/block-framework-value 6786a4f05: inputs/runs-class.jsonl (exact failures), "
              "inputs/hand_classification_h3_runs.md, data/hf8_classifier.jsonl, results.json per_run_HF5_HF6",
    "prompt": "acme/prompt/acme-sales.md, stored here as prompts/acme-sales.md",
    "blocks": blocks, "runs": runs}, indent=1, ensure_ascii=False) + "\n")
print(len(runs), "runs written")
