"""The ten H1 blocks, a port of today's exact oracle, rung 1 tool replay and the value-check ladder.

Exact oracle: a Python port of the phrasing lane's `exactOracle` (src/oracle.ts on research/block-phrasing),
which is the repo's `tools` check (packages/checks/src/checks/tools.ts, core `matchAssertion`) plus every
tool expected 0 times must not be called. `validate_exact()` checks the port run by run against the stored
verdicts of all 259 H1 class runs (pass flag and the list of failing verdict ids).
"""

from __future__ import annotations

import copy
import json
import re
import sys
from pathlib import Path

import yaml

from common import INPUTS, ROOT, read_jsonl

sys.path.insert(0, str(ROOT / "acme"))
from acme_live import tools as acme_tools  # noqa: E402

# Block id -> (spec file, block index). Same as research/block-phrasing src/blocks.ts.
BLOCK_SPECS = {
    "B1": ("new-customer-coverage", 1), "B2": ("new-customer-coverage", 3), "B3": ("number-porting", 1),
    "B4": ("plan-upgrade", 1), "B5": ("order-loose-confirmation", 0), "B6": ("off-topic-return", 0),
    "B7": ("tool-failure", 1), "B8": ("gen-twise-023", 1), "B9": ("gen-twise-066", 1), "B10": ("gen-twise-018", 2),
}

# The slot fields (blocks.ts `fields`): where the user's value lands in a tool input, and its gold value.
# A field is (tool label, top-level input key, path inside that key's value, gold).
SLOTS = {
    "B1": [("coverage.check", "address", [], "88 Summit Avenue, Acmeville")],
    "B2": [("notify_sales", "customer", ["phone"], "+12025550131")],
    "B3": [("port.check", "number", [], "+12025550150")],
    "B4": [("catalog.search", "customer_email", [], "sam.rivera@example.com")],
    "B5": [("coverage.check", "address", [], "14 Harbor Road, Acmeville")],
    "B6": [("coverage.check", "address", [], "3 Orchard Way, Acmeville")],
    "B7": [("notify_sales", "customer", ["phone"], "+12025550188")],
    "B8": [("coverage.check", "address", [], "7 Quarry Lane, Acmeville")],
    "B9": [("port.check", "number", [], "+12025550160")],
    "B10": [("catalog.search", "customer_email", [], "morgan.diaz@example.com")],
}

LABEL_TO_WIRE = {"catalog.search": "catalog_search", "coverage.check": "coverage_check", "port.check": "port_check",
                 "order.create": "order_create", "notify_sales": "notify_sales"}

# Per tool, declared once (value_equivalence.md section 3, "What each block declares"): is the tool replayable
# for a value, and which output fields are its resolved result. notify_sales only stores what it is given:
# its ticket id hashes the whole input, so it resolves nothing and is not a rung 1 tool.
TOOL_DECL = {
    "coverage.check": {"replayable": True, "resolved": ["found", "address_id"]},
    "port.check": {"replayable": True, "resolved": ["number", "eligible"]},
    "catalog.search": {"replayable": True, "resolved": ["customer.id"]},
    "notify_sales": {"replayable": False, "resolved": []},
    "order.create": {"replayable": False, "resolved": []},
}


def load_expects() -> dict:
    out = {}
    for bid, (spec, idx) in BLOCK_SPECS.items():
        doc = yaml.safe_load((INPUTS / "specs" / f"{spec}.yaml").read_text())
        e = doc["blocks"][idx]["expect"]
        out[bid] = {"tools": e.get("tools") or [], "tool_order": e.get("tool_order")}
    return out


EXPECTS = load_expects()

_MISSING = object()


def deep_equal(a, b) -> bool:
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(deep_equal(x, y) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        ka = [k for k in a if a[k] is not _MISSING]
        kb = [k for k in b if b[k] is not _MISSING]
        return len(ka) == len(kb) and all(k in b and deep_equal(a[k], b[k]) for k in ka)
    if a is _MISSING or b is _MISSING:
        return a is b
    if isinstance(a, bool) or isinstance(b, bool):
        return type(a) is type(b) and a == b
    return a == b


def _holds(value, expected) -> bool:
    if isinstance(expected, dict):
        return isinstance(value, dict) and all(_holds(value.get(k, _MISSING), p) for k, p in expected.items())
    return deep_equal(value, expected)


def match_assertion(value, assertion) -> bool:
    if not isinstance(assertion, dict):
        return deep_equal(value, assertion)
    if "exact" in assertion:
        return deep_equal(value, assertion["exact"])
    if "regex" in assertion:
        return isinstance(value, str) and re.search(assertion["regex"], value, re.M) is not None
    if "contains" in assertion:
        if isinstance(value, str):
            return assertion["contains"] in value
        return isinstance(value, list) and any(deep_equal(i, assertion["contains"]) for i in value)
    if "one_of" in assertion:
        return any(deep_equal(value, o) for o in assertion["one_of"])
    if "nonempty" in assertion:
        return not (value is _MISSING or value is None or (isinstance(value, str) and value.strip() == "") or value in ([], {}))
    if "absent" in assertion:
        return value is _MISSING
    return isinstance(value, dict) and all(_holds(value.get(k, _MISSING), p) for k, p in assertion["subset"].items())


def _count_ok(count, n: int) -> bool:
    if count is None:
        return n >= 1
    if isinstance(count, int):
        return n == count
    lo, hi = count.get("min", 0), count.get("max")
    return n >= lo and (hi is None or n <= hi)


def _min_of(count) -> int:
    if count is None:
        return 1
    if isinstance(count, int):
        return count
    return count.get("min", 0)


def _is_zero(count) -> bool:
    return count == 0 or (isinstance(count, dict) and count.get("max") == 0)


def assertion_ids(block: str) -> list[tuple[str, str, str | None]]:
    """(verdict id, tool label, input field or None) for every gating verdict of the block's tools check."""
    out = []
    for t in EXPECTS[block]["tools"]:
        if _is_zero(t.get("count")):
            continue
        out.append((f"tools.{t['label']}.count", t["label"], None))
        for f in (t.get("input") or {}):
            out.append((f"tools.{t['label']}.input.{f}", t["label"], f))
    return out


def exact_oracle(block: str, calls: list[dict], field_override=None) -> list[str]:
    """Failing gating verdict ids. `field_override(label, field, call_index, value) -> bool | None` replaces
    the assertion of one input field when it returns a bool (the ladder's hook); None keeps the assertion."""
    exp = EXPECTS[block]
    failed = []
    expected = [t for t in exp["tools"] if not _is_zero(t.get("count"))]
    for t in expected:
        own = [c for c in calls if c["label"] == t["label"]]
        if not _count_ok(t.get("count"), len(own)):
            failed.append(f"tools.{t['label']}.count")
        for f, a in (t.get("input") or {}).items():
            vid = f"tools.{t['label']}.input.{f}"
            if not own:
                failed.append(vid)
                continue
            ok = True
            for i, c in enumerate(own):
                inp = c.get("input") if isinstance(c.get("input"), dict) else {}
                v = inp.get(f, _MISSING)
                over = field_override(t["label"], f, i, c) if field_override else None
                if over is None:
                    if not match_assertion(v, a):
                        ok = False
                elif not over:
                    ok = False
            if not ok:
                failed.append(vid)
    if exp["tool_order"] is not None:
        labels = [c["label"] for c in calls]
        want = [t["label"] for t in expected for _ in range(_min_of(t.get("count")))]
        mode = exp["tool_order"]
        if mode == "in_order":
            it = iter(labels)
            ok = all(any(x == w for x in it) for w in want)
        elif mode == "exact":
            ok = labels == want
        else:
            ok = all(labels.count(w) >= want.count(w) for w in set(want))
        if not ok:
            failed.append("tools.order")
    for t in exp["tools"]:
        if _is_zero(t.get("count")) and any(c["label"] == t["label"] for c in calls):
            failed.append(f"{t['label']}.count0")
    return failed


def validate_exact(runs: list[dict]) -> dict:
    bad = []
    for r in runs:
        got = exact_oracle(r["block"], r["calls"])
        if (len(got) == 0) != r["exact"] or sorted(got) != sorted(r["exactFailed"]):
            bad.append({"id": r["id"], "port": got, "stored": r["exactFailed"]})
    return {"runs": len(runs), "mismatches": len(bad), "examples": bad[:5]}


# ---------- rung 1: ask the tool ----------

def world_seed(block: str) -> dict:
    """The tool store the block runs against: the Acme seed, plus B3's seeded transfer record (a forced
    port_check result in the live runs; here a store row so the real tool resolves it)."""
    data = copy.deepcopy(acme_tools.SEED)
    if block == "B3":
        data["port_numbers"] = [{"number": "+12025550150", "eligible": True}] + data["port_numbers"]
    return data


def _get(obj, dotted: str):
    for k in dotted.split("."):
        if not isinstance(obj, dict):
            return None
        obj = obj.get(k)
    return obj


def replay(label: str, inp: dict, data: dict) -> dict:
    """Runs the real tool (never a forced result) on a copy of the store. {ok, output | error}."""
    fn = acme_tools.IMPL[LABEL_TO_WIRE[label]]
    try:
        return {"ok": True, "output": fn(copy.deepcopy(inp), copy.deepcopy(data))}
    except acme_tools.InvalidInput as e:
        return {"ok": False, "error": str(e)}


def set_path(inp: dict, field: str, path: list[str], value) -> dict:
    out = copy.deepcopy(inp)
    if not path:
        out[field] = value
        return out
    at = out.setdefault(field, {})
    for k in path[:-1]:
        at = at.setdefault(k, {})
    at[path[-1]] = value
    return out


def get_value(inp: dict, field: str, path: list[str]):
    v = inp.get(field) if isinstance(inp, dict) else None
    for k in path:
        v = v.get(k) if isinstance(v, dict) else None
    return v


def rung1(block: str, label: str, field: str, path: list[str], inp: dict, gold: str) -> dict:
    """Replays the agent's call and the same call with the slot set to the gold value on the same store.
    Returns {settles: pass|fail|None, outcome: accepted_as_gold|failed|resolved_differently|None, ...}."""
    decl = TOOL_DECL[label]
    if not decl["replayable"]:
        return {"settles": None, "outcome": None}
    data = world_seed(block)
    mine = replay(label, inp, data)
    ref = replay(label, set_path(inp, field, path, gold), data)
    if not ref["ok"]:
        return {"settles": None, "outcome": None, "note": "the gold call itself fails"}
    if not mine["ok"]:
        return {"settles": "fail", "outcome": "failed", "agent": mine, "gold": ref}
    a = {k: _get(mine["output"], k) for k in decl["resolved"]}
    g = {k: _get(ref["output"], k) for k in decl["resolved"]}
    if a == g:
        return {"settles": "pass", "outcome": "accepted_as_gold", "agent": a, "gold": g}
    if label == "coverage.check" and a.get("found") is False:
        return {"settles": "fail", "outcome": "failed", "agent": a, "gold": g}
    if label == "catalog.search" and a.get("customer.id") is None:
        return {"settles": "fail", "outcome": "failed", "agent": a, "gold": g}
    return {"settles": "fail", "outcome": "resolved_differently", "agent": a, "gold": g}


# ---------- rung 2: the contract the tool (or the prompt) states ----------

# Formats stated outside the JSON Schema: in a tool description or in the prompt. Read by hand from
# acme/acme_live/tools.py TOOL_DEFS and acme/prompt/acme-sales.md: none states a format for any slot field.
DECLARED_FORMATS: dict[str, dict] = {}


def schema_of(label: str, field: str, path: list[str]) -> dict:
    td = next(t for t in acme_tools.TOOL_DEFS if t["name"] == LABEL_TO_WIRE[label])
    s = td["input_schema"]["properties"].get(field, {})
    for k in path:
        s = (s.get("properties") or {}).get(k, {})
    return s


def rung2(label: str, field: str, path: list[str], value) -> dict:
    s = schema_of(label, field, path)
    key = f"{label}.{field}{'.' + '.'.join(path) if path else ''}"
    if "enum" in s:
        return {"contract": "tool", "settles": "pass" if value in s["enum"] else "fail"}
    if "pattern" in s:
        ok = isinstance(value, str) and re.search(s["pattern"], value) is not None
        return {"contract": "tool", "settles": "pass" if ok else "fail"}
    if key in DECLARED_FORMATS:
        d = DECLARED_FORMATS[key]
        ok = isinstance(value, str) and re.fullmatch(d["regex"], value) is not None
        return {"contract": d["where"], "settles": "pass" if ok else "fail"}
    return {"contract": "none", "settles": None}


def slot_fields(block: str):
    return SLOTS[block]


def load_runs() -> list[dict]:
    return read_jsonl(INPUTS / "runs-class.jsonl")


if __name__ == "__main__":
    print(json.dumps(validate_exact(load_runs()), indent=1))
