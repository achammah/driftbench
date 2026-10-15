"""M3.2: Ochiai suspiciousness per local section, flat and grouped per root (research prototype).

Inputs are plain structures so the toy, the simulation and the real runs share one implementation:
  links:   {block: set(sections)}            declared links to LOCAL sections only
  parent:  {block: parent_block or None}      parent chains (one parent per block)
  runs:    list of {block: bool_failed}       one dict per run (k runs)
"""

from __future__ import annotations

import math


def ancestors(b, parent):
    out = []
    p = parent.get(b)
    while p is not None:
        out.append(p)
        p = parent.get(p)
    return out


def weights(blocks, parent, runs, grouped: bool) -> dict:
    """w_b = failure rate. Grouped: per run, a block with a failing ancestor is blocked (not a row)."""
    w = {}
    for b in blocks:
        n = f = 0
        for r in runs:
            if b not in r:
                continue
            if grouped and any(r.get(a, False) for a in ancestors(b, parent)):
                continue
            n += 1
            f += r[b]
        if n:
            w[b] = f / n
    return w


def scores(sections, links, w) -> dict:
    nf = sum(w.values())
    out = {}
    for s in sections:
        ncf = sum(wb for b, wb in w.items() if s in links.get(b, ()))
        ncs = sum(1 - wb for b, wb in w.items() if s in links.get(b, ()))
        out[s] = 0.0 if ncf == 0 or nf == 0 else ncf / math.sqrt(nf * (ncf + ncs))
    return out


def rank_metrics(sc: dict, faulty: list) -> dict:
    """Abreu tie-averaged tau for the first faulty section found (lowest tau), EXAM, q_d, best/worst ranks."""
    n = len(sc)
    best = None
    for d in faulty:
        if d not in sc:
            continue
        gt = sum(1 for v in sc.values() if v > sc[d])
        ge = sum(1 for v in sc.values() if v >= sc[d])
        tau = (gt + ge - 1) / 2
        cand = {"section": d, "tau": tau, "best_rank": gt + 1, "worst_rank": ge, "score": sc[d]}
        if best is None or tau < best["tau"]:
            best = cand
    if best is None:
        return None
    best["exam"] = (best["tau"] + 1) / n
    best["q_d"] = (1 - best["tau"] / (n - 1)) * 100
    best["top1_best"] = best["best_rank"] <= 1
    best["top1_worst"] = best["worst_rank"] <= 1
    best["top3_best"] = best["best_rank"] <= 3
    best["top3_worst"] = best["worst_rank"] <= 3
    return best


def localise(sections, links, parent, runs, faulty):
    blocks = list(parent)
    res = {}
    for mode in ("flat", "grouped"):
        w = weights(blocks, parent, runs, grouped=(mode == "grouped"))
        sc = scores(sections, links, w)
        res[mode] = {"scores": sc, "n_f": sum(w.values()), "metrics": rank_metrics(sc, faulty)}
    return res


def toy():
    """deep_5 section (c): seven blocks, faults in S4 and S5."""
    links = {"a1": {"S1", "S2"}, "a2": {"S1", "S3"}, "a3": {"S3", "S4"}, "a4": {"S3", "S5"},
             "a5": {"S3", "S4"}, "b1": {"S1", "S2"}, "b2": {"S2", "S5"}}
    parent = {"a1": None, "a2": "a1", "a3": "a2", "a4": "a3", "a5": "a3", "b1": None, "b2": None}
    run = {"a1": False, "a2": False, "a3": True, "a4": True, "a5": True, "b1": False, "b2": True}
    return localise(["S1", "S2", "S3", "S4", "S5"], links, parent, [run], ["S4", "S5"])


if __name__ == "__main__":
    import json
    r = toy()
    print(json.dumps({m: {k: round(v, 3) for k, v in r[m]["scores"].items()} for m in r}, indent=1))
