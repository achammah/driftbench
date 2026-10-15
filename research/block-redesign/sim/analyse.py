"""Analyses for H11, H10, H14. Usage: python analyse.py h11|h10|h14 RUNSDIR. Writes hXX/results.json."""
import json, math, os, random, statistics, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from collections import Counter, defaultdict
from lib import abcd, flips, metrics

which, runs = sys.argv[1], sys.argv[2]
HERE = os.path.dirname(os.path.abspath(__file__))


def load(name):
    rows = [json.loads(l) for l in open(os.path.join(runs, name))]
    return [r for r in rows if "error" not in r], [r for r in rows if "error" in r]


def user_turns(r):
    return [t["text"] for t in r["turns"] if t["role"] == "user" and t["text"].strip()]


if which == "h11":
    ok, errs = load("h11_runs.jsonl")
    trials = defaultdict(lambda: defaultdict(dict))
    for r in ok:
        trials[r["convo_id"]][r["family"]][r["trial"]] = r["passed"]
    T = {b: {f: [v[t] for t in sorted(v)] for f, v in fams.items()} for b, fams in trials.items()}
    complete = {b: fams for b, fams in T.items() if all(len(fams.get(f, [])) == 8 for f in "OG")}
    X, W = flips.flip_shares(complete)
    blocks = sorted(complete)
    def xw(bs):
        x, w = flips.flip_shares({f"{b}#{i}": complete[b] for i, b in enumerate(bs)})
        return x - w
    lo, hi = metrics.bootstrap(xw, [blocks], B=2000, seed=1101)
    per = []
    for b in blocks:
        o, g = complete[b]["O"], complete[b]["G"]
        per.append({"block": b, "flow": next(r["flow"] for r in ok if r["convo_id"] == b),
                    "subflow": next(r["subflow"] for r in ok if r["convo_id"] == b),
                    "O": o, "G": g, "passhat4_O": metrics.pass_hat_k(8, sum(o), 4), "passhat4_G": metrics.pass_hat_k(8, sum(g), 4),
                    "verdicts": {f"{f}{bi}": v for (f, bi), v in flips.verdicts({b: complete[b]})[b].items()},
                    "majority": {f: flips.majority(complete[b][f][:4]) + "/" + flips.majority(complete[b][f][4:]) for f in "OG"}})
    diffs = [sum(p["O"]) / 8 - sum(p["G"]) / 8 for p in per]
    dlo, dhi = metrics.bootstrap(lambda d: statistics.mean(d), [diffs], B=2000, seed=1102)
    # secondary: majority-verdict flips (tie is its own value)
    maj = lambda b, f, s: flips.majority(complete[b][f][s])
    Xm = statistics.mean(statistics.mean(maj(b, "O", sa) != maj(b, "G", sb) for b in blocks)
                         for sa in (slice(0, 4), slice(4, 8)) for sb in (slice(0, 4), slice(4, 8)))
    Wm = statistics.mean(statistics.mean(maj(b, f, slice(0, 4)) != maj(b, f, slice(4, 8)) for b in blocks) for f in "OG")
    missing = defaultdict(lambda: defaultdict(int))
    for r in ok:
        for m in r["missing"]:
            missing[r["family"]][m] += 1
    res = {
        "n_blocks": len(blocks), "n_conversations": len(ok), "n_errors": len(errs),
        "X_cross_family_flip_share": X, "W_within_family_flip_share": W, "X_minus_W": X - W,
        "X_minus_W_bootstrap95": [lo, hi],
        "verdict": "SUPPORTED" if X > W else "FALSIFIED",
        "passhat4_mean": {f: statistics.mean(p[f"passhat4_{f}"] for p in per) for f in "OG"},
        "pass_rate_per_trial": {f: statistics.mean(sum(p[f]) / 8 for p in per) for f in "OG"},
        "paired_pass_rate_diff_O_minus_G": statistics.mean(diffs), "paired_diff_bootstrap95": [dlo, dhi],
        "secondary_majority_flip": {"X": Xm, "W": Wm},
        "missing_buttons_by_family": {f: dict(sorted(v.items(), key=lambda x: -x[1])) for f, v in missing.items()},
        "stop_reasons": {f: dict(Counter(r["stop"] for r in ok if r["family"] == f)) for f in "OG"},
        "user_turns_mean": {f: statistics.mean(r["user_turns"] for r in ok if r["family"] == f) for f in "OG"},
        "per_block": per,
    }
    json.dump(res, open(os.path.join(HERE, "h11", "results.json"), "w"), indent=1)
    print(json.dumps({k: v for k, v in res.items() if k != "per_block"}, indent=1))
    for p in per:
        print(p["block"], p["subflow"], "O", "".join("1" if x else "0" for x in p["O"]), "G", "".join("1" if x else "0" for x in p["G"]), p["verdicts"])

elif which == "h10":
    ok, errs = load("h10_runs.jsonl")
    test = [c for c in abcd.load()["test"] if abcd.action_flow(c)]
    rng = random.Random(10)
    E = abcd.stratified_sample(test, 100, rng)
    rest = sorted([c for c in test if c["convo_id"] not in {e["convo_id"] for e in E}], key=lambda c: c["convo_id"])
    ceil = rng.sample(rest, 200)
    H = [abcd.customer_turns(c) for c in E]
    arms = {a: [user_turns(r) for r in sorted([r for r in ok if r["arm"] == a], key=lambda r: r["item"])] for a in ("free", "findings", "engine")}
    rates = {a: metrics.rates(d) for a, d in arms.items()}
    rates["human"] = metrics.rates(H)
    dice = {a: metrics.dice_all(d, H) for a, d in arms.items()}
    better = {m: dice["engine"][m] > dice["findings"][m] for m in metrics.SIX}
    n_better = sum(better.values())
    cis = {}
    for m in metrics.SIX:
        f = lambda eng, fin, hum, m=m: metrics.dice(metrics.rates(eng)[m], metrics.rates(hum)[m]) - metrics.dice(metrics.rates(fin)[m], metrics.rates(hum)[m])
        cis[m] = metrics.bootstrap(f, [arms["engine"], arms["findings"], H], B=2000, seed=1001)
    ceiling = metrics.dice_all([abcd.customer_turns(c) for c in ceil[:100]], [abcd.customer_turns(c) for c in ceil[100:]])
    # M2.3 metric check: free arm with "please" added to every turn
    please = [[t + " please" for t in d] for d in arms["free"]]
    m23 = {"Polite_dice_free": dice["free"]["Polite%"], "Polite_dice_free_forced_please": metrics.dice_all(please, H)["Polite%"]}
    m23["metric_ok"] = m23["Polite_dice_free_forced_please"] < m23["Polite_dice_free"]
    sec = {a: metrics.secondary(d) for a, d in arms.items()}
    sec["human"] = metrics.secondary(H)
    sec_dice = {a: {k: metrics.dice(sec[a][k], sec["human"][k]) for k in sec["human"]} for a in arms}
    cvm = {a: metrics.cvm([len(d) for d in H], [len(x) for x in arms[a]]) for a in arms}
    pass_rate = {a: statistics.mean(r["passed"] for r in ok if r["arm"] == a) for a in arms}
    stops = {a: dict(Counter(r["stop"] for r in ok if r["arm"] == a)) for a in arms}
    # engine ledger checks
    leaks = leaks_no_overlap = halluc = rec_ok = rec_n = premature = 0
    for r in ok:
        if r["arm"] != "engine":
            continue
        conv = abcd.by_id("test")[r["convo_id"]]
        facts = abcd.facts(conv)
        vals = {k: v.lower() for k, v in facts.items() if k not in ("items_in_order", "product_concerned", "packaging", "payment_method", "shipping_status", "member_level") and len(v) >= 4}
        last_tool_turn = max([i for i, t in enumerate(r["turns"]) if t.get("tools")], default=-1)
        for i, t in enumerate(r["turns"]):
            e = t.get("engine")
            if not e:
                continue
            planned = {a["slot"] for a in e["planned_acts"] if a["act"] == "answer"}
            present = {k for k, v in vals.items() if v in t["text"].lower()}
            leaks += len(present - planned)
            pv = [vals[k] for k in planned if k in vals] + [facts[k].lower() for k in planned if k in facts]
            leaks_no_overlap += len({k for k in present - planned if not any(vals[k] in v for v in pv)})
            ids_in_text = metrics.n_ids(t["text"])
            unknown_planned = [a for a in e["planned_acts"] if a["act"] == "dont_know"]
            if unknown_planned and ids_in_text > len(present):
                halluc += 1
            checkable = {k for k in planned if k in vals}
            if checkable:
                rec_n += 1
                rec_ok += int(checkable <= present)
            if any(a["act"] == "goodbye" for a in e["planned_acts"]) and i < last_tool_turn:
                premature += 1
    res = {
        "n_conversations": {a: len(arms[a]) for a in arms}, "n_errors": len(errs), "n_human": len(H),
        "rates": rates, "dice_vs_human": dice, "engine_better_than_findings": better, "n_better": n_better,
        "verdict": "SUPPORTED" if n_better >= 4 else "FALSIFIED",
        "dice_diff_engine_minus_findings_bootstrap95": cis, "ceiling_split_half": ceiling,
        "m23_metric_check": m23, "secondary": sec, "secondary_dice": sec_dice, "cvm_turns_per_dialogue": cvm,
        "agent_pass_rate": pass_rate, "stop_reasons": stops,
        "engine_checks": {"unplanned_fact_disclosures": leaks, "unplanned_fact_disclosures_excluding_substring_overlap": leaks_no_overlap, "turns_with_dont_know_and_unmatched_id": halluc,
                          "act_recovery": f"{rec_ok}/{rec_n}", "goodbye_before_last_agent_tool_call": premature},
    }
    json.dump(res, open(os.path.join(HERE, "h10", "results.json"), "w"), indent=1)
    print(json.dumps(res, indent=1))

elif which == "h14":
    ok, errs = load("h14_runs.jsonl")
    meta = json.load(open(os.path.join(runs, "h14_blocks.json")))
    by = defaultdict(list)
    for r in ok:
        by[(r["arm"], r["convo_id"])].append(r["passed"])
    blocks = defaultdict(list)
    for (arm, i), outs in by.items():
        blocks[arm].append({"convo_id": i, "runs": outs, "fails": len(outs) - sum(outs), "fail": (len(outs) - sum(outs)) >= 2,
                            "subflow": next(r["subflow"] for r in ok if r["convo_id"] == i),
                            "cluster": next(r.get("cluster") for r in ok if r["convo_id"] == i)})
    from scipy.stats import fisher_exact
    u, rnd = blocks["uncovered"], blocks["random"]
    fu, fr = sum(b["fail"] for b in u), sum(b["fail"] for b in rnd)
    nu, nr = len(u), len(rnd)

    def wilson(x, n, z=1.959964):
        p = x / n
        d = 1 + z * z / n
        c = (p + z * z / (2 * n)) / d
        h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
        return c - h, c + h
    (l1, u1), (l2, u2) = wilson(fu, nu), wilson(fr, nr)
    p1, p2 = fu / nu, fr / nr
    d = p1 - p2
    newcombe = (d - math.sqrt((p1 - l1) ** 2 + (u2 - p2) ** 2), d + math.sqrt((u1 - p1) ** 2 + (p2 - l2) ** 2))
    _, pf = fisher_exact([[fu, nu - fu], [fr, nr - fr]], alternative="greater")
    runrate = lambda bs: sum(b["fails"] for b in bs) / sum(len(b["runs"]) for b in bs)
    rlo, rhi = metrics.bootstrap(lambda a, b: runrate(a) - runrate(b), [u, rnd], B=2000, seed=1401)
    res = {
        "M": meta["M"], "U": meta["U"], "n_runs": len(ok), "n_errors": len(errs),
        "block_fail_rate": {"uncovered": p1, "random": p2}, "fails": {"uncovered": f"{fu}/{nu}", "random": f"{fr}/{nr}"},
        "difference": d, "newcombe95": newcombe, "fisher_one_sided_p": pf,
        "run_fail_rate": {"uncovered": runrate(u), "random": runrate(rnd)}, "run_rate_diff_bootstrap95": [rlo, rhi],
        "reproduces_production_outcome_2of3": {"uncovered": sum(not b["fail"] for b in u) / nu, "random": sum(not b["fail"] for b in rnd) / nr},
        "stable_3of3": {"uncovered": sum(b["fails"] in (0, 3) for b in u) / nu, "random": sum(b["fails"] in (0, 3) for b in rnd) / nr},
        "verdict": "SUPPORTED" if p1 > p2 else "FALSIFIED",
        "blocks": blocks,
    }
    json.dump(res, open(os.path.join(HERE, "h14", "results.json"), "w"), indent=1)
    print(json.dumps({k: v for k, v in res.items() if k != "blocks"}, indent=1))
