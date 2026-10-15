"""Exploratory analyses, NOT pre-registered, run after the registered verdicts were computed.

X1 (H7): selection plus forward closure in the chain: T' = T plus every later block of a selected block's
   conversation (driftbench's radius already closes F mode forward).
X2 (H5): grouped counting that drops only FAILING blocked descendants and keeps passing ones as passing rows.
"""

import json
from pathlib import Path

import ochiai
from analysis_h7 import BLOCKS, LOCAL, ORDER, PARENT, REG, SCOPE, SUITE, load, manifest, null_model
from h5_sim import summarise
from select_rts import selected

CHILDREN = {}
for c in SUITE["conversations"]:
    ids = [b["id"] for b in c["blocks"]]
    for i, b in enumerate(ids):
        CHILDREN[b] = ids[i + 1:]


def x1():
    h = json.loads(Path("analysis/h7.json").read_text())
    flaky = set(h["null"]["flaky"])
    stable = [b for b in ORDER if b not in flaky]
    out = {}
    for name, sel in (("single_90", lambda r: not r["control"] and not r["pair"]), ("all_110", lambda r: not r["control"])):
        rows = [r for r in h["rows"] if sel(r)]
        sv = sr = 0
        for r in rows:
            T = selected(set(r["sections"]), REG, SUITE)
            T = (T | {d for b in T for d in CHILDREN[b]}) - flaky
            E = set(r["E"])
            u = E | T
            sv += bool(u) and len(E - T) > 0
            sr += len(T) / len(stable)
        out[name] = {"mutants": len(rows), "share_sv_gt0": sv / len(rows), "mean_sr": sr / len(rows)}
    return out


def weights_keep_passing(blocks, parent, runs):
    w = {}
    for b in blocks:
        n = f = 0
        for r in runs:
            if b not in r:
                continue
            blocked = any(r.get(a, False) for a in ochiai.ancestors(b, parent))
            if blocked and r[b]:
                continue  # inherited failure: not a row in this run
            n += 1
            f += r[b]
        if n:
            w[b] = f / n
    return w


def x2():
    links = {b: set(BLOCKS[b][1].get("links", [])) & set(LOCAL) for b in ORDER}
    items = []
    for v in manifest()["variants"]:
        if v["status"] != "ok" or v.get("control"):
            continue
        secs = v.get("sections") or [v["section"]]
        if any(SCOPE[s] == "global" for s in secs):
            continue
        runs = list(load(v["id"], "stage1").values())
        flat = ochiai.weights(ORDER, PARENT, runs, grouped=False)
        keep = weights_keep_passing(ORDER, PARENT, runs)
        mf = ochiai.rank_metrics(ochiai.scores(LOCAL, links, flat), secs)
        mk = ochiai.rank_metrics(ochiai.scores(LOCAL, links, keep), secs)
        items.append({"variant": v["id"], "flat": mf, "grouped": mk, "n_f_flat": sum(flat.values())})
    return summarise(items)


if __name__ == "__main__":
    res = {"x1_forward_closure": x1(), "x2_grouped_keep_passing_children": x2()}
    Path("analysis/exploratory.json").write_text(json.dumps(res, indent=1))
    print(json.dumps(res, indent=1))
