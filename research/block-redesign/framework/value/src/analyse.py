"""Computes HF5 to HF9 from the data files and writes results.json.

python analyse.py [hf5|hf7|all]   (hf5 also gives HF6; hf5 runs the ladder, so rung 3 judge calls happen here)
"""

from __future__ import annotations

import json
import random
import sys
from collections import Counter

from common import DATA, ROOT, read_jsonl
from oracle import SLOTS, TOOL_DECL, load_runs
import ladder

LABELLERS = ["gpt-6.1-sol", "gemini-3.6-flash"]


def scotts_pi(a: list, b: list) -> float | None:
    n = len(a)
    if n == 0:
        return None
    po = sum(x == y for x, y in zip(a, b)) / n
    cats = Counter(a) + Counter(b)
    pe = sum((c / (2 * n)) ** 2 for c in cats.values())
    return (po - pe) / (1 - pe) if pe < 1 else None


def townless(run: dict) -> bool:
    """N-townless: PR 434's normaliser with the town-less surface forms unapproved. A flip whose address value
    has no town (B1 and B8 rows of the 11 town-less flips) fails there."""
    if run["exact"] or not run["norm"]:
        return run["norm"]
    for c in run["calls"]:
        if c["label"] == "coverage.check" and isinstance(c.get("input"), dict):
            if "acmeville" not in str(c["input"].get("address", "")).lower():
                return False
    return True


def hf5() -> dict:
    runs = load_runs()
    labels = {m: {r["id"]: r for r in read_jsonl(DATA / f"labels-{m}.jsonl")} for m in LABELLERS}
    missing = {m: [r["id"] for r in runs if r["id"] not in labels[m]] for m in LABELLERS}
    both = [r for r in runs if all(r["id"] in labels[m] for m in LABELLERS)]
    va = [labels[LABELLERS[0]][r["id"]]["verdict"] for r in both]
    vb = [labels[LABELLERS[1]][r["id"]]["verdict"] for r in both]
    la = [labels[LABELLERS[0]][r["id"]]["label"] for r in both]
    lb = [labels[LABELLERS[1]][r["id"]]["label"] for r in both]
    agree = {r["id"]: x for r, x, y in zip(both, va, vb) if x == y}
    disagree = [{"id": r["id"], "block": r["block"], LABELLERS[0]: x, LABELLERS[1]: y,
                 "labels": [labels[LABELLERS[0]][r["id"]]["label"], labels[LABELLERS[1]][r["id"]]["label"]]}
                for r, x, y in zip(both, va, vb) if x != y]
    pi = scotts_pi(va, vb)

    per = []
    for r in runs:
        lad = ladder.score(r)
        r1 = ladder.score(r, rungs_allowed=("identity", "rung1"), use_judge=False)
        per.append({"id": r["id"], "block": r["block"], "E": r["exact"], "N": r["norm"], "Nt": townless(r),
                    "L": lad["pass"], "L_failed": lad["failed"], "L_fields": lad["fields"],
                    "R1": r1["pass"], "R1_fields": r1["fields"],
                    "ref": agree.get(r["id"]), "labels": {m: labels[m].get(r["id"], {}).get("label") for m in LABELLERS}})

    def counts(rows, o):
        fp = [p["id"] for p in rows if p["ref"] == "fail" and p[o]]
        ff = [p["id"] for p in rows if p["ref"] == "pass" and not p[o]]
        return {"FP": len(fp), "FF": len(ff), "FP_ids": fp, "FF_ids": ff}

    def table(rows):
        return {o: counts(rows, o) for o in ("E", "N", "Nt", "L")}

    in_r = [p for p in per if p["ref"] is not None]
    res = {
        "labelled": {m: len(labels[m]) for m in LABELLERS}, "missing": missing,
        "agreement": {"n": len(both), "percent": sum(x == y for x, y in zip(va, vb)) / len(both) if both else None,
                      "scotts_pi_verdict": pi, "scotts_pi_label": scotts_pi(la, lb),
                      "label_counts": {LABELLERS[0]: dict(Counter(la)), LABELLERS[1]: dict(Counter(lb))}},
        "reference": {"n": len(in_r), "pass": sum(p["ref"] == "pass" for p in in_r), "fail": sum(p["ref"] == "fail" for p in in_r)},
        "disagreements": disagree,
        "all_259": table(in_r),
        "exact_failures_182": table([p for p in in_r if not p["E"]]),
        "rung3_inconclusive": [p["id"] for p in per if any(f.get("settles") == "inconclusive" for f in p["L_fields"])],
    }
    # sensitivity: disagreements all pass, then all fail
    for tag, v in (("disagreements_as_pass", "pass"), ("disagreements_as_fail", "fail")):
        rows = [{**p, "ref": p["ref"] if p["ref"] is not None else v} for p in per]
        res[tag] = {o: {k: x for k, x in c.items() if not k.endswith("_ids")} for o, c in table(rows).items()}
    fpL, fpN, ffL, ffE = (res["all_259"][o][k] for o, k in (("L", "FP"), ("N", "FP"), ("L", "FF"), ("E", "FF")))
    verdict = "FALSIFIED" if (fpL > 2 or fpL >= fpN or ffL >= ffE) else "SUPPORTED"
    if pi is None or pi < 0.60:
        verdict = f"INCONCLUSIVE (labeller pi {pi}; would be {verdict})"
    res["verdict"] = verdict
    res["prediction_FP_N_at_least_10"] = fpN >= 10

    # HF6: rung 1 on the 116 flips
    flips = [p for p in per if not p["E"] and p["N"]]
    settled = []
    for p in flips:
        run = next(r for r in runs if r["id"] == p["id"])
        failing = {f.split(".input.")[1] for f in run["exactFailed"] if ".input." in f}
        fields = [f for f in p["R1_fields"] if f["field"] in failing]
        ok = bool(fields) and all(f["rung"] in ("identity", "rung1") and f["settles"] in ("pass", "fail") for f in fields)
        non_slot = [f for f in run["exactFailed"] if not any(f == f"tools.{lab}.input.{fl}" for lab, fl, _p, _g in SLOTS[p["block"]])]
        if ok and not non_slot:
            v = "pass" if all(f["settles"] == "pass" for f in fields) else "fail"
            settled.append({"id": p["id"], "block": p["block"], "settled": v, "ref": p["ref"], "labels": p["labels"]})
    dis = [s for s in settled if s["ref"] is not None and s["ref"] != s["settled"]]
    no_ref = [s for s in settled if s["ref"] is None]
    share = len(settled) / len(flips) if flips else None
    v6 = "SUPPORTED" if (share is not None and share >= 0.5 and not dis) else "FALSIFIED"
    if pi is None or pi < 0.60:
        v6 = f"INCONCLUSIVE (labeller pi {pi}; would be {v6})"
    res6 = {"flips": len(flips), "settled": len(settled), "share": share,
            "settled_pass": sum(s["settled"] == "pass" for s in settled), "settled_fail": sum(s["settled"] == "fail" for s in settled),
            "per_block": dict(Counter(f"{s['block']}:{s['settled']}" for s in settled)),
            "disagreements": dis, "settled_without_reference": no_ref,
            "sensitivity_disagreements_if_no_reference_counted": len(dis) + sum(1 for s in no_ref),
            "verdict": v6}
    return {"hf5": res, "hf6": res6, "per_run": per}


def boot(items: list[str], by_item: dict[str, list[bool]], seed: int = 7007, n: int = 2000) -> tuple[float, float]:
    rng = random.Random(seed)
    vals = []
    for _ in range(n):
        s = [rng.choice(items) for _ in items]
        tot = sum(len(by_item[i]) for i in s)
        vals.append(sum(sum(by_item[i]) for i in s) / tot if tot else 0)
    vals.sort()
    return vals[int(0.025 * n)], vals[int(0.975 * n) - 1]


def hf7() -> dict:
    items = {i["id"]: i for i in json.loads((DATA / "hf7_items.json").read_text())}
    rows = read_jsonl(DATA / "hf7_judgments.jsonl")
    out = {}
    for model in sorted({r["model"] for r in rows}):
        out[model] = {}
        for d in ("sbs", "read_first"):
            rs = [r for r in rows if r["model"] == model and r["design"] == d]
            expected = len(items) * 6
            pos = {}
            neg = {}
            for r in rs:
                it = items[r["item"]]
                (pos if it["truth"] == "same" else neg).setdefault(r["item"], []).append(bool(r["same"]))
            tp = sum(sum(v) for v in pos.values())
            npos = sum(len(v) for v in pos.values())
            fa = sum(sum(v) for v in neg.values())
            nneg = sum(len(v) for v in neg.values())
            sub = Counter()
            subn = Counter()
            for i, v in neg.items():
                sub[items[i]["subtype"]] += sum(v)
                subn[items[i]["subtype"]] += len(v)
            key = {(r["item"], r["order"], r["repeat"]): r["same"] for r in rs}
            order_flips = sum(1 for (i, o, rep), s in key.items() if o == 1 and (i, 2, rep) in key and key[(i, 2, rep)] != s)
            order_pairs = sum(1 for (i, o, rep) in key if o == 1 and (i, 2, rep) in key)
            rep_flips = 0
            rep_groups = 0
            for i in items:
                for o in (1, 2):
                    vs = [key[(i, o, rep)] for rep in range(3) if (i, o, rep) in key]
                    if len(vs) >= 2:
                        rep_groups += 1
                        rep_flips += len(set(vs)) > 1
            truth = [items[r["item"]]["truth"] == "same" for r in rs]
            said = [bool(r["same"]) for r in rs]
            out[model][d] = {
                "judgments": len(rs), "expected": expected, "missing": expected - len(rs),
                "TPR": tp / npos if npos else None, "TPR_ci": boot(list(pos), pos) if pos else None,
                "FAR": fa / nneg if nneg else None, "FAR_ci": boot(list(neg), neg) if neg else None,
                "false_accepts": fa, "negative_judgments": nneg, "true_accepts": tp, "positive_judgments": npos,
                "FAR_by_subtype": {k: f"{sub[k]}/{subn[k]}" for k in subn},
                "accepted_negative_items": sorted({i for i, v in neg.items() if any(v)}),
                "rejected_positive_items": sorted({i for i, v in pos.items() if not all(v)}),
                "order_flip_rate": order_flips / order_pairs if order_pairs else None,
                "repeat_flip_rate": rep_flips / rep_groups if rep_groups else None,
                "scotts_pi_vs_truth": scotts_pi(truth, said),
                "compare_calls_share": (sum(1 for r in rs if r.get("compared")) / len(rs)) if d == "read_first" and rs else None,
            }
        sbs, rf = out[model]["sbs"], out[model]["read_first"]
        conds = {"i_RF_FAR_le_SBS_FAR": rf["FAR"] <= sbs["FAR"], "ii_RF_FAR_le_0.02": rf["FAR"] <= 0.02, "iii_RF_TPR_ge_0.90": rf["TPR"] >= 0.90}
        incon = any(out[model][d]["missing"] > 0.05 * out[model][d]["expected"] for d in ("sbs", "read_first"))
        out[model]["conditions"] = conds
        out[model]["inconclusive"] = incon
    vs = [out[m] for m in out]
    if any(m["inconclusive"] for m in vs):
        v = "INCONCLUSIVE"
    elif all(all(m["conditions"].values()) for m in vs) and len(vs) == 2:
        v = "SUPPORTED"
    else:
        v = "FALSIFIED"
    out["verdict"] = v
    return out


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    path = ROOT / "results.json"
    res = json.loads(path.read_text()) if path.exists() else {}
    if what in ("hf5", "all"):
        r = hf5()
        res["HF5"] = r["hf5"]
        res["HF6"] = r["hf6"]
        res["per_run_HF5_HF6"] = r["per_run"]
    if what in ("hf7", "all"):
        res["HF7"] = hf7()
    if what in ("hf8", "all"):
        import blame
        p1, p2 = blame.part1(), blame.part2()
        res["HF8"] = {"part1": p1, "part2": p2,
                      "verdict": "SUPPORTED" if p1["exact_match"] and (p2["agreement"] or 0) >= 0.90 and not p2["missing"] else "FALSIFIED"}
    if what in ("hf9", "all"):
        import hf9
        s = hf9.score()
        a = s["a"]["desc"].get("removal")
        b = s["b"]["removal"]
        w = s["controls"]["worsening"]
        f = s["controls"]["rerun_flip_rate"]
        bad_controls = any(w[arm] > f for arm in ("desc", "prompt"))
        if a is None or a < 0.80 or bad_controls or (not s["b"]["inconclusive"] and (b is None or b < 0.80)):
            v = "FALSIFIED"
        else:
            v = "SUPPORTED" + (" (part b INCONCLUSIVE: fewer than 5 base R6 failures)" if s["b"]["inconclusive"] else "")
        s["verdict"] = v
        import hf9_secondary
        s.update(hf9_secondary.secondary())  # secondary, outside the verdict; see hf9_secondary.py
        res["HF9"] = s
    path.write_text(json.dumps(res, indent=1, default=str))
    print(json.dumps({k: (v.get("verdict") if isinstance(v, dict) else None) for k, v in res.items() if k.startswith("HF")}, indent=1))
