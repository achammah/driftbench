"""HF8: blame rules as data (blame_rules.yaml) applied to (1) hand-coded evidence and (2) evidence computed
automatically from the stored runs.

python blame.py hand            # part 1, offline
python blame.py classify        # the reply classifier for part 2 (gpt-6-luna, one call per exact failure)
python blame.py auto            # part 2, offline once the classifier answers exist
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

import yaml

from common import DATA, HERE, INPUTS, append_jsonl, model_json, read_jsonl
from oracle import SLOTS, exact_oracle, get_value, load_runs, rung1, rung2

RULES = yaml.safe_load((HERE / "blame_rules.yaml").read_text())

# What the prompt states about a slot field, read by hand once from acme/prompt/acme-sales.md:
# line 41 states the recovery after coverage_check found false ("ask for the street number, street name and
# town") and so the parts the prompt asks for; the tool (tools.py coverage_check) needs only the street part
# (prefix match on "<number> <street name> <street type>"), so the town is asked by the prompt only.
PROMPT_CONTRACT = {
    ("coverage.check", "address"): {"recovery_on_failed": "asked_user", "line": 41,
                                    "prompt_parts": ["street_number", "street_name", "town"],
                                    "prompt_only_parts": ["town"]},
}

FAULT_OF = {"R1": "agent", "R2": "agent", "R2b": "agent", "R4": "agent", "R3": "tool_definition", "R3b": "agent",
            "R6": "prompt", "R7": "agent", "R5b": "prompt", "R5": "pass_test_flagged"}


def apply_rules(ev: dict) -> str:
    for item in RULES["items"]:
        if item.get("enabled") is False:
            continue
        ok = True
        for k, want in item["when"].items():
            have = ev.get(k)
            if isinstance(want, list):
                ok = have in want
            else:
                ok = have == want
            if not ok:
                break
        if ok:
            return item["id"]
    return "unclassified"


# ---------- part 1: hand-coded evidence from the per-run table ----------

def hand_rows() -> list[dict]:
    rows = []
    for line in (INPUTS / "hand_classification_h3_runs.md").read_text().splitlines():
        if not re.match(r"^\| B\d+#", line):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        run, cls, _user, _sent, prov, result, nxt, fault = cells[:8]
        rows.append({"id": run, "class": cls, "prov": prov, "result": result, "next": nxt, "fault": fault})
    return rows


def hand_evidence(r: dict) -> dict:
    ev = {"contract": "none"}
    p = r["prov"]
    if p == "no call":
        ev.update(slot_called=False, source=None, change=None, outcome=None)
    else:
        ev["slot_called"] = True
        if p == "verbatim":
            ev.update(source="user", change="verbatim")
        elif p == "case only":
            ev.update(source="user", change="case_only")
        elif p.startswith("agent-derived"):
            ev.update(source="agent_derived", change="derived")
        else:
            ev.update(source="user", change="altered")
        res = r["result"]
        ev["outcome"] = ("failed" if res == "NOT FOUND" else "stored" if res == "lead queued"
                         else "accepted_as_gold")
    n = r["next"]
    ev["next_action"] = "asked_user" if n == "asked user again" else None
    ev["asked_prompt_only_part"] = n == "asked for town"
    ev["steps_skipped"] = (not ev["slot_called"]) or n.startswith("asked user instead of") or n == "asked to confirm address"
    if ev.get("outcome") == "failed":
        ev["prompt_recovery_stated"] = True
        ev["prompt_recovery_followed"] = ev["next_action"] == "asked_user"
    return ev


def part1() -> dict:
    rows = hand_rows()
    per = []
    for r in rows:
        rule = apply_rules(hand_evidence(r))
        per.append({"id": r["id"], "hand_class": r["class"], "rule": rule, "fault": FAULT_OF.get(rule, "unclassified")})
    counts = Counter(p["fault"] for p in per)
    target = {"agent": 45, "tool_definition": 28, "prompt": 3, "pass_test_flagged": 106}
    return {"rows": len(rows), "counts": dict(counts), "target": target,
            "exact_match": dict(counts) == target and len(rows) == 182,
            "rule_vs_hand_class_agree": sum(p["rule"] == p["hand_class"] for p in per), "per_run": per}


# ---------- part 2: automatic evidence ----------

CLS_SYSTEM = """You read one turn of a customer-service agent: the customer's message, the tool calls the agent made with their results, and the agent's reply. Report what the agent did at the end of the turn.

next_action, one of:
- asked_user: the reply asks the customer for information or a confirmation (a question to the customer).
- retried_canonical: after a tool returned an error or found nothing, the agent called the same tool again with a corrected value.
- gave_up: the agent stopped without asking anything and without an answer to the request.
- wrong_fact: the reply states a fact that the tool results do not support (for example that a service is unavailable when a tool only failed to find the address).
- continued: the agent went on with the request (more tool calls or an answer) without asking the customer anything.

asked_for: the list of things the reply asks the customer for, each from: street_number, street_name, town, full_address, address_confirmation, phone, email, name, need, plan_choice, confirmation, other. Empty if the reply asks nothing.

Answer JSON only: {"next_action": "...", "asked_for": [...]}"""


def cls_user(run: dict) -> str:
    calls = "\n".join(f"- {c['label']} input={json.dumps(c['input'])} -> " + (f"returned {json.dumps(c['output'])}" if "output" in c else f"error: {c.get('error')}") for c in run["calls"]) or "(no tool call)"
    return f"Customer: {run['text']}\n\nTool calls:\n{calls}\n\nAgent reply: {run['reply']}"


def classify() -> None:
    runs = [r for r in load_runs() if not r["exact"]]
    out = DATA / "hf8_classifier.jsonl"
    done = {r["id"] for r in read_jsonl(out)}
    todo = [r for r in runs if r["id"] not in done]
    print(f"{len(todo)} to classify", flush=True)

    def go(r):
        try:
            v = model_json("hf8-classifier", "gpt-6-luna", CLS_SYSTEM, cls_user(r), 8008)
            append_jsonl(out, {"id": r["id"], **v})
        except Exception as e:  # noqa: BLE001
            append_jsonl(DATA / "hf8_classifier.errors.jsonl", {"id": r["id"], "error": str(e)})

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(go, todo))


def _norm_ws(s: str) -> str:
    return " ".join(s.split())


def auto_evidence(run: dict, cls: dict) -> dict:
    block = run["block"]
    label, field, path, gold = SLOTS[block][0]
    own = [c for c in run["calls"] if c["label"] == label and isinstance(c.get("input"), dict)]
    ev: dict = {}
    failed = exact_oracle(block, run["calls"])
    slot_ids = {f"tools.{lab}.input.{f}" for lab, f, _p, _g in SLOTS[block]}
    ev["steps_skipped"] = (not own) or any(f not in slot_ids for f in failed)
    ev["next_action"] = cls.get("next_action")
    contract = PROMPT_CONTRACT.get((label, field), {})
    asked = set(cls.get("asked_for") or [])
    if not own:
        ev.update(slot_called=False, source=None, change=None, outcome=None, contract="none",
                  asked_prompt_only_part=bool(asked & set(contract.get("prompt_only_parts", []))))
        return ev
    ev["slot_called"] = True
    ev["asked_prompt_only_part"] = False
    value = get_value(own[0]["input"], field, path)
    text = _norm_ws(run["text"])
    v = _norm_ws(str(value))
    if v in text:
        ev.update(source="user", change="verbatim")
    elif v.lower() in text.lower():
        ev.update(source="user", change="case_only")
    else:
        digits = re.sub(r"\D", "", v)
        if digits and re.sub(r"\D", "", text).find(digits[-10:]) >= 0:
            ev.update(source="agent_derived", change="derived")
        else:
            ev.update(source="user", change="altered")
    r2 = rung2(label, field, path, value)
    ev["contract"] = r2["contract"]
    ev["contract_broken"] = r2["settles"] == "fail"
    r1 = rung1(block, label, field, path, own[0]["input"], gold)
    if r1["outcome"] is None:
        ok = "output" in own[0]
        ev["outcome"] = "stored" if ok else "failed"
    else:
        ev["outcome"] = r1["outcome"]
    if ev["outcome"] == "failed" and contract:
        ev["prompt_recovery_stated"] = True
        ev["prompt_recovery_followed"] = ev["next_action"] == contract["recovery_on_failed"]
        if len(own) > 1:
            ev["next_action"] = "retried_canonical"
    return ev


def part2() -> dict:
    hand = {r["id"]: r for r in hand_rows()}
    cls = {r["id"]: r for r in read_jsonl(DATA / "hf8_classifier.jsonl")}
    per = []
    for run in load_runs():
        if run["exact"]:
            continue
        c = cls.get(run["id"])
        if c is None:
            per.append({"id": run["id"], "missing_classifier": True})
            continue
        ev = auto_evidence(run, c)
        rule = apply_rules(ev)
        h = hand[run["id"]]["class"]
        per.append({"id": run["id"], "hand_class": h, "rule": rule, "agree": rule == h,
                    "fault": FAULT_OF.get(rule, "unclassified"), "evidence": ev, "classifier": c})
    scored = [p for p in per if "agree" in p]
    agree = sum(p["agree"] for p in scored)
    return {"runs": len(per), "scored": len(scored), "missing": len(per) - len(scored), "agree": agree,
            "agreement": agree / len(scored) if scored else None, "counts": dict(Counter(p["fault"] for p in scored)),
            "confusion": dict(Counter(f"{p['hand_class']}->{p['rule']}" for p in scored)), "per_run": per}


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "hand":
        r = part1()
        print(json.dumps({k: v for k, v in r.items() if k != "per_run"}, indent=1))
    elif cmd == "classify":
        classify()
    elif cmd == "auto":
        r = part2()
        print(json.dumps({k: v for k, v in r.items() if k != "per_run"}, indent=1))
