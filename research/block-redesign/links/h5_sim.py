"""H5 data sets 1 and 2 (offline): the deep_5 toy and 2,000 simulated suites, parameters as pre-registered."""

from __future__ import annotations

import json
import random
from pathlib import Path

from ochiai import localise, toy

SEED = 20261014
N_SECTIONS, N_CHAINS, K = 20, 12, 3
P_INHERIT, P_NOISE = 0.8, 0.03


def simulate(rng: random.Random, n_faults: int) -> dict:
    sections = [f"S{i}" for i in range(N_SECTIONS)]
    parent, links, order = {}, {}, []
    for c in range(N_CHAINS):
        prev = None
        for j in range(rng.randint(1, 5)):
            b = f"c{c}b{j}"
            parent[b] = prev
            links[b] = set(rng.sample(sections, rng.randint(1, 3)))
            order.append(b)
            prev = b
    faulty = rng.sample(sections, n_faults)
    p_detect = {f: rng.uniform(0.3, 1.0) for f in faulty}
    runs = []
    for _ in range(K):
        r = {}
        for b in order:  # parents come before children
            fail = any(f in links[b] and rng.random() < p_detect[f] for f in faulty)
            if parent[b] is not None and r[parent[b]] and rng.random() < P_INHERIT:
                fail = True
            if rng.random() < P_NOISE:
                fail = True
            r[b] = fail
        runs.append(r)
    res = localise(sections, links, parent, runs, faulty)
    return {"faulty": faulty, "flat": res["flat"]["metrics"], "grouped": res["grouped"]["metrics"],
            "n_f_flat": res["flat"]["n_f"], "n_f_grouped": res["grouped"]["n_f"]}


def summarise(items: list) -> dict:
    ev = [x for x in items if x["n_f_flat"] > 0 and x["flat"] and x["grouped"]]
    worse = sum(x["grouped"]["exam"] > x["flat"]["exam"] for x in ev)
    better = sum(x["grouped"]["exam"] < x["flat"]["exam"] for x in ev)
    out = {"faults": len(items), "evaluable": len(ev), "grouped_worse": worse, "grouped_better": better,
           "ties": len(ev) - worse - better, "share_worse": worse / len(ev) if ev else None}
    for m in ("flat", "grouped"):
        out[m] = {
            "mean_exam": sum(x[m]["exam"] for x in ev) / len(ev),
            "mean_q_d": sum(x[m]["q_d"] for x in ev) / len(ev),
            "top1_best": sum(x[m]["top1_best"] for x in ev) / len(ev),
            "top1_worst": sum(x[m]["top1_worst"] for x in ev) / len(ev),
            "top3_best": sum(x[m]["top3_best"] for x in ev) / len(ev),
            "top3_worst": sum(x[m]["top3_worst"] for x in ev) / len(ev),
        }
    return out


def main():
    t = toy()
    rng = random.Random(SEED)
    single = [simulate(rng, 1) for _ in range(1000)]
    double = [simulate(rng, 2) for _ in range(1000)]
    out = {
        "toy": {m: {s: round(v, 3) for s, v in t[m]["scores"].items()} for m in t},
        "sim_single": summarise(single),
        "sim_double": summarise(double),
        "sim_all": summarise(single + double),
    }
    Path("analysis").mkdir(exist_ok=True)
    Path("analysis/h5_offline.json").write_text(json.dumps(out, indent=1))
    Path("analysis/h5_sim_items.json").write_text(json.dumps({"single": single, "double": double}))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
