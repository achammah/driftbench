"""HF11 analysis. Usage: python hf11/analyse.py HF10_RUNS.jsonl HF11_RUNS.jsonl OUT.json
The en base cells are HF10's terse-regular trials 0 to 4."""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from lib import lang, personas, routing
import ast

HERE = os.path.dirname(os.path.abspath(__file__))
# the block list and trial count are read from run.py (one home), without executing the runner
_consts = {n.targets[0].id: ast.literal_eval(n.value) for n in ast.parse(open(os.path.join(HERE, "run.py")).read()).body
           if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name) and n.targets[0].id in ("HF11_BLOCKS", "TRIALS")}
HF11_BLOCKS, TRIALS = _consts["HF11_BLOCKS"], _consts["TRIALS"]
PERSONAS = ["terse-regular", "terse-regular-fr"]
MUTATIONS = ["negate", "drop"]


def read(path, keep):
    out = {}
    for line in open(path):
        r = json.loads(line)
        if "error" in r or not keep(r):
            continue
        out.setdefault((r["convo_id"], r["persona"], r["rule"], r["trial"]), r)
    return out


rows = read(sys.argv[1], lambda r: r["persona"] == "terse-regular" and r["trial"] < TRIALS and r["convo_id"] in HF11_BLOCKS)
rows.update(read(sys.argv[2], lambda r: r["convo_id"] in HF11_BLOCKS))
errors = sum(1 for line in open(sys.argv[2]) if "error" in json.loads(line))
blocks = sorted({k[0] for k in rows if k[2] != "base" or k[1] == "terse-regular-fr"}, key=HF11_BLOCKS.index)


def trial(r):
    agent_texts = [t["text"] for t in r["turns"][1:] if t["role"] == "agent"]
    ok_lang, labels = lang.check(agent_texts, r["language"])
    return {"gold": r["passed"], "lang": ok_lang, "both": r["passed"] and ok_lang, "labels": labels}


T = {}
for b in blocks:
    for p in PERSONAS:
        for rule in ["base"] + MUTATIONS:
            ks = [(b, p, rule, t) for t in range(TRIALS)]
            missing = [k for k in ks if k not in rows]
            assert not missing, missing
            T[(b, p, rule)] = [trial(rows[k]) for k in ks]


def cell_verdict(ts, key):
    return sum(t[key] for t in ts) >= 3


links = routing.load(os.path.join(HERE, "links.json"))
cells = [(b, personas.load(p)) for b in blocks for p in PERSONAS]
selected = routing.select(links, "agent.system#language-rule", cells)


def shares(key):
    out = {"selected": [0, 0], "unselected": [0, 0], "by_mutation": {}}
    for m in MUTATIONS:
        bm = {"selected": [0, 0], "unselected": [0, 0]}
        for b in blocks:
            for p in PERSONAS:
                g = "selected" if (b, p) in selected else "unselected"
                flip = cell_verdict(T[(b, p, m)], key) != cell_verdict(T[(b, p, "base")], key)
                for d in (out[g], bm[g]):
                    d[0] += flip
                    d[1] += 1
        out["by_mutation"][m] = {g: {"flips": v[0], "cells": v[1], "share": round(v[0] / v[1], 3)} for g, v in bm.items()}
    for g in ("selected", "unselected"):
        f, n = out[g]
        out[g] = {"flips": f, "cells": n, "share": round(f / n, 4)}
    return out


def trial_level(key):
    out = {}
    for g in ("selected", "unselected"):
        f = n = 0
        for m in MUTATIONS:
            for b in blocks:
                for p in PERSONAS:
                    if ((b, p) in selected) != (g == "selected"):
                        continue
                    for t in range(TRIALS):
                        f += T[(b, p, m)][t][key] != T[(b, p, "base")][t][key]
                        n += 1
        out[g] = {"flips": f, "pairs": n, "share": round(f / n, 4)}
    return out


primary = shares("both")
S, U = primary["selected"]["share"], primary["unselected"]["share"]
verdict = "FALSIFIED" if (U > 0.05 or S <= U) else "SUPPORTED"
pass_rates = {f"{p}/{rule}": {k: round(sum(t[k] for b in blocks for t in T[(b, p, rule)]) / (len(blocks) * TRIALS), 3)
                              for k in ("gold", "lang", "both")} for p in PERSONAS for rule in ["base"] + MUTATIONS}
# the detector on the French persona's own turns (they should read as French)
fr_user = [t["text"] for k, r in rows.items() if k[1] == "terse-regular-fr" for t in r["turns"] if t["role"] == "user" and t["text"]]
det = [lang.detect(x) for x in fr_user]
res = {
    "blocks": blocks, "n_blocks": len(blocks), "trials": TRIALS, "n_errors_hf11": errors,
    "selected_cells": sorted(map(list, selected)), "verdict": verdict,
    "primary_cell_flips": primary, "S": S, "U": U,
    "secondary_language_check_only": shares("lang"), "secondary_block_contract_only": shares("gold"),
    "secondary_trial_level_both": trial_level("both"),
    "pass_rates": pass_rates,
    "per_cell": {f"{b}/{p}/{rule}": "".join("1" if t["both"] else "0" for t in T[(b, p, rule)]) + " lang " + "".join("1" if t["lang"] else "0" for t in T[(b, p, rule)])
                 for b in blocks for p in PERSONAS for rule in ["base"] + MUTATIONS},
    "detector_on_fr_user_turns": {"n": len(det), "fr": det.count("fr"), "en": det.count("en"), "none": det.count(None)},
}
json.dump(res, open(sys.argv[3], "w"), indent=1)
print(json.dumps({k: v for k, v in res.items() if k != "per_cell"}, indent=1))
