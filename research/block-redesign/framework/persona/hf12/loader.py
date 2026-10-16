"""Prototype loader for personas, scenarios and blocks: ownership, slot, belief and chain checks at load,
and `requires` as not_run cells. Written from hf12/SCHEMA.md only, before the fixtures were read.

load(case) returns {"load_error": {"class", "message"} | None, "not_run": [cell refusals], "cells": [...]}."""

PERSONA_OWNED = {"language", "lines", "behaviour", "stable_knowledge", "expertise", "misconceptions"}
# behaviour's own groups, refused when they appear at the top level of a scenario or a situational block
BEHAVIOUR_GROUPS = {"verbosity", "initiative", "tone", "cooperativeness", "commitment", "engagement", "patience"}
PERSONA_META = {"kind", "id", "name", "source", "weight", "schema_version"}
SCENARIO_OWNED = {"intent", "goal", "start_state"}
SCENARIO_META = {"kind", "id"}
RUN_SETTINGS = {"model", "seed", "temperature", "trials", "mode", "simulators", "calibration_ref"}
LEVELS = {"novice": 0, "intermediate": 1, "advanced": 2}


class LoadError(Exception):
    def __init__(self, cls, message):
        super().__init__(message)
        self.cls = cls


def _fact(s):
    return " ".join(str(s).lower().split())


def _check_ownership(personas, scenarios, blocks):
    for p in personas:
        bad = sorted(k for k in p if k in SCENARIO_OWNED | RUN_SETTINGS)
        if bad:
            raise LoadError("ownership_violation", f"persona {p.get('id')} sets {bad}, owned by the scenario or the run profile")
    for s in scenarios:
        bad = sorted(k for k in s if k in PERSONA_OWNED | BEHAVIOUR_GROUPS | RUN_SETTINGS)
        if bad:
            raise LoadError("ownership_violation", f"scenario {s.get('id')} sets {bad}, owned by the persona or the run profile")
    for b in blocks:
        su = b.get("simulated_user") or {}
        sit = su.get("situational") or {}
        bad = sorted(k for k in sit if k in PERSONA_OWNED | BEHAVIOUR_GROUPS | SCENARIO_OWNED | RUN_SETTINGS)
        if bad:
            raise LoadError("ownership_violation", f"block {b.get('id')} situational sets {bad}, owned by another file")


def _persona_sets(blocks):
    """Effective persona set per block (a child without `personas` inherits); refuses a switch in a chain."""
    by_id = {b["id"]: b for b in blocks}
    eff = {}

    def resolve(bid, seen=()):
        if bid in eff:
            return eff[bid]
        if bid in seen:
            raise LoadError("parent_cycle", f"parent cycle {list(seen) + [bid]}")
        b = by_id[bid]
        own = (b.get("simulated_user") or {}).get("personas")
        parent = b.get("parent")
        if parent:
            if parent not in by_id:
                raise LoadError("unknown_parent", f"block {bid} names unknown parent {parent}")
            pset = resolve(parent, seen + (bid,))
            if own is not None and set(own) != set(pset):
                raise LoadError("persona_switch_in_chain",
                                f"block {bid} uses personas {sorted(own)}, its parent {parent} uses {sorted(pset)}")
            eff[bid] = list(own) if own is not None else list(pset)
        else:
            eff[bid] = list(own or [])
        return eff[bid]

    for bid in by_id:
        resolve(bid)
    return eff


def _requires_fail(req, p):
    """First failing key of `req` (in the block's order) for persona p, or None."""
    for key, val in req.items():
        if key == "language":
            ok = p.get("language") == val
        elif key == "has_account":
            ok = bool((p.get("stable_knowledge") or {}).get("has_account", False)) == bool(val)
        elif key == "concepts":
            known = set((p.get("expertise") or {}).get("always_known") or [])
            ok = all(c in known for c in val)
        elif key == "min_expertise":
            lvl = (p.get("expertise") or {}).get("level")
            ok = lvl in LEVELS and LEVELS[lvl] >= LEVELS[val]
        else:
            ok = False  # an unknown requirement cannot be shown to hold
        if not ok:
            return key
    return None


def load(case):
    personas = case.get("personas", [])
    scenarios = case.get("scenarios", [])
    blocks = case.get("blocks", [])
    pmap = {p["id"]: p for p in personas}
    try:
        _check_ownership(personas, scenarios, blocks)
        eff = _persona_sets(blocks)
        for b in blocks:
            su = b.get("simulated_user") or {}
            sit = su.get("situational") or {}
            for pid in eff[b["id"]]:
                if pid not in pmap:
                    raise LoadError("unknown_persona", f"block {b['id']} names unknown persona {pid}")
                p = pmap[pid]
                sk = p.get("stable_knowledge") or {}
                for h in sit.get("holds") or []:
                    if "value" in h and "ref" not in h and h.get("slot") in sk:
                        raise LoadError("slot_collision",
                                        f"slot {h['slot']} defined by persona {pid} and block {b['id']}")
                mis = {_fact(m["fact"]): m.get("true") for m in p.get("misconceptions") or []}
                for cb in sit.get("case_beliefs") or []:
                    f = _fact(cb["fact"])
                    if f in mis and mis[f] != cb.get("true") and cb.get("override") is not True:
                        raise LoadError("contradictory_belief",
                                        f"belief '{f}': persona {pid} says {mis[f]}, block {b['id']} says {cb.get('true')}")
    except LoadError as e:
        return {"load_error": {"class": e.cls, "message": str(e)}, "not_run": [], "cells": []}
    not_run, cells = [], []
    for b in blocks:
        req = (b.get("simulated_user") or {}).get("requires") or {}
        for pid in eff[b["id"]]:
            key = _requires_fail(req, pmap[pid])
            if key:
                not_run.append({"type": "not_run", "block": b["id"], "persona": pid,
                                "kind": "persona_incompatible", "requirement": key})
            else:
                cells.append({"block": b["id"], "persona": pid})
    return {"load_error": None, "not_run": not_run, "cells": cells}
