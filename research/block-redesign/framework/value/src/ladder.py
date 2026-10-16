"""The value-check ladder (config_framework.md 3.1, policy/value-check:default) applied to one stored run.

Per slot field of the block, on every call of its tool:
  identical to the gold string -> pass, no call (identity cannot be a false pass);
  rung 1 outcome   if the tool is replayable: replay agent value and gold value on the same store, compare
                   the declared resolved fields -> pass | fail;
  rung 2 contract  else if the tool schema or a declared description/prompt format states one -> pass | fail;
  rung 3 judge     else: read-first judge, gpt-6-luna, both orders x 3 repeats; all 6 same -> pass,
                   all 6 different -> fail, else inconclusive (the run then fails: the exact verdict stands);
  rung 4 exact     only when a block declares it (no H1 block does).
A slot field whose tool was not called keeps its exact verdict (fail). Every other verdict is today's.
"""

from __future__ import annotations

import json

from oracle import SLOTS, TOOL_DECL, exact_oracle, get_value, rung1, rung2, schema_of, LABEL_TO_WIRE
import oracle

JUDGE_MODEL = "gpt-6-luna"


def field_description(label: str, field: str, path: list[str]) -> str:
    td = next(t for t in oracle.acme_tools.TOOL_DEFS if t["name"] == LABEL_TO_WIRE[label])
    name = ".".join([field, *path])
    return f"{name} of the tool {LABEL_TO_WIRE[label]}: {td['description']} The tool stores this value as given."


def rung3(label: str, field: str, path: list[str], gold: str, value: str, judge=None) -> dict:
    from judges import read_first
    desc = field_description(label, field, path)
    votes = []
    for repeat in range(3):
        for order in (1, 2):
            votes.append(read_first("hf5-rung3", JUDGE_MODEL, desc, gold, value, order, repeat)["same"])
    if all(votes):
        return {"settles": "pass", "votes": votes}
    if not any(votes):
        return {"settles": "fail", "votes": votes}
    return {"settles": "inconclusive", "votes": votes}


def ladder_field(block: str, label: str, field: str, path: list[str], gold: str, inp: dict, use_judge: bool = True) -> dict:
    value = get_value(inp, field, path)
    if isinstance(value, str) and value == gold:
        return {"rung": "identity", "settles": "pass", "value": value}
    r1 = rung1(block, label, field, path, inp, gold)
    if r1["settles"] is not None:
        return {"rung": "rung1", "value": value, **r1}
    r2 = rung2(label, field, path, value)
    if r2["settles"] is not None:
        return {"rung": "rung2", "value": value, **r2}
    if not isinstance(value, str):
        return {"rung": "none", "settles": "fail", "value": value}
    if not use_judge:
        return {"rung": "rung3", "settles": None, "value": value}
    return {"rung": "rung3", "value": value, **rung3(label, field, path, gold, value)}


def score(run: dict, rungs_allowed=("identity", "rung1", "rung2", "rung3"), use_judge: bool = True) -> dict:
    """Returns {pass, failed, fields: [...]} under the ladder (restricted to `rungs_allowed`)."""
    block = run["block"]
    slots = {(lab, f): (p, g) for lab, f, p, g in SLOTS[block]}
    fields = []

    def override(label, f, i, call):
        if (label, f) not in slots:
            return None
        p, g = slots[(label, f)]
        res = ladder_field(block, label, f, p, g, call["input"] if isinstance(call.get("input"), dict) else {}, use_judge)
        res.update({"tool": label, "field": f, "call": i})
        fields.append(res)
        if res["rung"] not in rungs_allowed or res["settles"] in (None, "inconclusive"):
            return None if res["rung"] not in rungs_allowed else False
        return res["settles"] == "pass"

    failed = exact_oracle(block, run["calls"], override)
    return {"pass": not failed, "failed": failed, "fields": fields}
