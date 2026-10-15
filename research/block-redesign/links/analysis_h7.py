"""H7 and H5 (real suite) analysis, exactly as pre-registered in H7/PREREG.md and H5/PREREG.md.

python analysis_h7.py   -> analysis/h7.json, analysis/h5_real.json, results.json (raw per item)
Every verdict is re-scored from the stored tool calls and reply text with the current suite checks.
"""

from __future__ import annotations

import json
import math
import random
from collections import defaultdict
from pathlib import Path

from acme_live.runner import check_block, load_suite
from ochiai import localise
from select_rts import load_registry, selected

HERE = Path(__file__).parent
RUNS = HERE / "data" / "runs"
SUITE = load_suite()
REG = load_registry()
BLOCKS = {b["id"]: (c["id"], b) for c in SUITE["conversations"] for b in c["blocks"]}
ORDER = [b["id"] for c in SUITE["conversations"] for b in c["blocks"]]
PARENT = {}
for c in SUITE["conversations"]:
    prev = None
    for b in c["blocks"]:
        PARENT[b["id"]] = prev
        prev = b["id"]
SCOPE = {s["id"]: s["scope"] for s in REG["sections"]}
LOCAL = [s for s in SCOPE if SCOPE[s] == "local"]


def manifest():
    return json.loads((HERE / "mutants" / "manifest.json").read_text())


def load(variant: str, tag: str) -> dict:
    """rep -> {block: failed_bool}. Re-scored from stored calls and text."""
    out = defaultdict(dict)
    p = RUNS / f"{variant}.jsonl"
    if not p.exists():
        return out
    for line in p.open():
        r = json.loads(line)
        if "error" in r or r.get("tag") != tag:
            continue
        for blk in r["blocks"]:
            failed = check_block(BLOCKS[blk["block"]][1]["checks"], blk["calls"], blk["text"])
            out[r["rep"]][blk["block"]] = bool(failed)
    return out


def null_model():
    base = load("baseline", "baseline")
    v0, p0, flaky = {}, {}, set()
    controls = [v["id"] for v in manifest()["variants"] if v.get("control") and v["status"] == "ok"]
    ctl_runs = [run for c in controls for run in load(c, "stage1").values()]
    for b in ORDER:
        fails = sum(run[b] for run in base.values() if b in run)
        n = sum(1 for run in base.values() if b in run)
        if n == 0 or fails * 2 == n:
            v0[b] = None
            flaky.add(b)
            continue
        v0[b] = fails * 2 > n  # True = baseline verdict is fail
        runs = [run for run in base.values() if b in run] + [run for run in ctl_runs if b in run]
        dis = sum(run[b] != v0[b] for run in runs)
        p0[b] = dis / len(runs)
        if p0[b] > 0.2:
            flaky.add(b)
    return v0, p0, flaky, len(base), len(ctl_runs)


def flips(runs: dict, b: str, v0b) -> tuple[int, int]:
    xs = [run[b] for run in runs.values() if b in run]
    return sum(x != v0b for x in xs), len(xs)


def stage1_candidates():
    v0, _p0, _fl, _nb, _nc = null_model()
    out = []
    for v in manifest()["variants"]:
        if v["status"] != "ok" or v.get("control"):
            continue
        runs = load(v["id"], "stage1")
        for b in ORDER:
            if v0[b] is None:
                continue
            f, n = flips(runs, b, v0[b])
            if f >= 2:
                out.append((v["id"], b, BLOCKS[b][0]))
    return out


def wilson(k, n, z=1.96):
    if n == 0:
        return (None, None)
    p = k / n
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return ((c - h) / d, (c + h) / d)


def h7():
    v0, p0, flaky, nbase, nctl = null_model()
    man = manifest()
    rows = []
    for v in man["variants"]:
        if v["status"] != "ok":
            continue
        secs = v.get("sections") or [v["section"]]
        s1 = load(v["id"], "stage1")
        conf = load(v["id"], "confirm")
        T_all = selected(set(secs), REG, SUITE)
        E1, E, E_keep_flaky = set(), set(), set()
        for b in ORDER:
            if v0[b] is None:
                continue
            f, n = flips(s1, b, v0[b])
            if f >= 2:
                E1.add(b)
                cf, cn = flips(conf, b, v0[b])
                if cn and cf >= 2:
                    E_keep_flaky.add(b)
                    if b not in flaky:
                        E.add(b)
        E1_nf = E1 - flaky
        T = T_all - flaky
        stable = [b for b in ORDER if b not in flaky]

        def metr(Ex, Tx, n):
            u = Ex | Tx
            return {"sv": len(Ex - Tx) / len(u) if u else 0.0, "pv": len(Tx - Ex) / len(u) if u else 0.0,
                    "sr": len(Tx) / n, "missed": sorted(Ex - Tx)}

        rows.append({
            "variant": v["id"], "sections": secs, "op": v["op"], "control": bool(v.get("control")),
            "global": any(SCOPE[s] == "global" for s in secs), "pair": v["op"] == "pair_negate",
            "reps": len(s1), "E": sorted(E), "E_stage1": sorted(E1_nf), "T_size": len(T),
            **metr(E, T, len(stable)),
            "stage1_only": metr(E1_nf, T, len(stable)),
            "keep_flaky": metr(E_keep_flaky, T_all, len(ORDER)),
        })

    def summary(sel):
        n = len(sel)
        k = sum(r["sv"] > 0 for r in sel)
        return {"mutants": n, "with_E": sum(bool(r["E"]) for r in sel), "sv_gt0": k,
                "share_sv_gt0": k / n if n else None, "wilson95": wilson(k, n),
                "mean_sr": sum(r["sr"] for r in sel) / n if n else None,
                "mean_pv": sum(r["pv"] for r in sel) / n if n else None,
                "mean_sr_local_only": (lambda xs: sum(xs) / len(xs) if xs else None)([r["sr"] for r in sel if not r["global"]]),
                "stage1_only_share_sv_gt0": sum(r["stage1_only"]["sv"] > 0 for r in sel) / n if n else None,
                "keep_flaky_share_sv_gt0": sum(r["keep_flaky"]["sv"] > 0 for r in sel) / n if n else None,
                "keep_flaky_mean_sr": sum(r["keep_flaky"]["sr"] for r in sel) / n if n else None}

    def boot(sel, seed=20261014, B=10000):
        by = defaultdict(list)
        for r in sel:
            by[r["sections"][0]].append(r)
        keys = sorted(by)
        rng = random.Random(seed)
        sh, sr = [], []
        for _ in range(B):
            pick = [r for _k in keys for r in by[rng.choice(keys)]]
            sh.append(sum(r["sv"] > 0 for r in pick) / len(pick))
            sr.append(sum(r["sr"] for r in pick) / len(pick))
        sh.sort(); sr.sort()
        return {"share_sv_gt0_95": [sh[int(0.025 * B)], sh[int(0.975 * B)]], "mean_sr_95": [sr[int(0.025 * B)], sr[int(0.975 * B)]]}

    single = [r for r in rows if not r["control"] and not r["pair"]]
    pairs = [r for r in rows if r["pair"]]
    ctl = [r for r in rows if r["control"]]

    def verdict(s):
        if s["mutants"] == 0:
            return "INCONCLUSIVE (no data)"
        if s["share_sv_gt0"] > 0.05 or s["mean_sr"] > 0.8:
            return "FALSIFIED"
        if s["with_E"] < 10:
            return "INCONCLUSIVE (fewer than 10 mutants with a non-empty E)"
        return "SUPPORTED"

    out = {
        "null": {"baseline_runs": nbase, "control_runs": nctl, "flaky": sorted(flaky),
                 "p0": {b: round(p0[b], 3) for b in p0}, "v0_fail": sorted(b for b in v0 if v0[b])},
        "single": {**summary(single), "bootstrap": boot(single) if single else None},
        "all_110": {**summary(single + pairs)},
        "pairs": summary(pairs),
        "controls": {**summary(ctl), "stage1_E_nonempty": sum(bool(r["E_stage1"]) for r in ctl),
                     "stage1_E_blocks": sum(len(r["E_stage1"]) for r in ctl)},
        "rows": rows,
    }
    out["verdict_registered_90"] = verdict(out["single"])
    out["verdict_all_110"] = verdict(out["all_110"])
    return out, v0


def h5_real(v0):
    links = {b: set(BLOCKS[b][1].get("links", [])) & set(LOCAL) for b in ORDER}
    items = []
    for v in manifest()["variants"]:
        if v["status"] != "ok" or v.get("control"):
            continue
        secs = v.get("sections") or [v["section"]]
        if any(SCOPE[s] == "global" for s in secs):
            items.append({"variant": v["id"], "sbfl_blind": True})
            continue
        runs = list(load(v["id"], "stage1").values())
        if not runs:
            continue
        res = localise(LOCAL, links, PARENT, runs, secs)
        keep = [b for b in ORDER if v0.get(b) is False]
        runs2 = [{b: r[b] for b in keep if b in r} for r in runs]
        par2 = {b: (PARENT[b] if PARENT[b] in keep else None) for b in keep}
        # secondary: baseline-failing blocks removed; a removed parent leaves its child a root
        res2 = localise(LOCAL, {b: links[b] for b in keep}, par2, runs2, secs)
        items.append({"variant": v["id"], "sections": secs, "pair": v["op"] == "pair_negate",
                      "flat": res["flat"]["metrics"], "grouped": res["grouped"]["metrics"],
                      "n_f_flat": res["flat"]["n_f"], "n_f_grouped": res["grouped"]["n_f"],
                      "secondary": {"flat": res2["flat"]["metrics"], "grouped": res2["grouped"]["metrics"],
                                    "n_f_flat": res2["flat"]["n_f"]}})
    from h5_sim import summarise
    scored = [x for x in items if not x.get("sbfl_blind")]
    sec = [{"flat": x["secondary"]["flat"], "grouped": x["secondary"]["grouped"], "n_f_flat": x["secondary"]["n_f_flat"]} for x in scored]
    out = {"sbfl_blind": sum(1 for x in items if x.get("sbfl_blind")),
           "all": summarise(scored) if scored else None,
           "single": summarise([x for x in scored if not x["pair"]]),
           "double": summarise([x for x in scored if x["pair"]]) if any(x["pair"] for x in scored) else None,
           "secondary_all": summarise(sec) if sec else None,
           "items": items}
    a = out["all"]
    if a is None or a["evaluable"] < 10:
        out["verdict_source"] = "simulation only"
    else:
        worse_ok = a["share_worse"] <= 0.10
        better = a["grouped"]["mean_exam"] < a["flat"]["mean_exam"]
        out["verdict"] = "FALSIFIED" if not worse_ok else ("SUPPORTED" if better else "INCONCLUSIVE (not falsified, no gain)")
    return out


def raw_results():
    rows = []
    for p in sorted(RUNS.glob("*.jsonl")):
        for line in p.open():
            r = json.loads(line)
            if "error" in r:
                rows.append({"variant": r["variant"], "rep": r["rep"], "conv": r["conv"], "error": r["error"]})
                continue
            for blk in r["blocks"]:
                failed = check_block(BLOCKS[blk["block"]][1]["checks"], blk["calls"], blk["text"])
                rows.append({"variant": r["variant"], "tag": r.get("tag"), "rep": r["rep"], "conv": r["conv"],
                             "block": blk["block"], "pass": not failed, "failed": failed,
                             "tools": [c["name"] for c in blk["calls"]]})
    return rows


if __name__ == "__main__":
    h7r, v0 = h7()
    h5r = h5_real(v0)
    Path("analysis").mkdir(exist_ok=True)
    Path("analysis/h7.json").write_text(json.dumps(h7r, indent=1))
    Path("analysis/h5_real.json").write_text(json.dumps(h5r, indent=1))
    Path("results.json").write_text(json.dumps({"h7_summary": {k: h7r[k] for k in ("single", "all_110", "pairs", "controls", "verdict_registered_90", "verdict_all_110")},
                                                 "h5_real_summary": {k: h5r.get(k) for k in ("all", "single", "double", "secondary_all", "verdict", "verdict_source", "sbfl_blind")},
                                                 "h5_offline": json.loads(Path("analysis/h5_offline.json").read_text()),
                                                 "per_block_runs": raw_results()}))
    print(json.dumps({k: h7r[k] for k in ("single", "all_110", "pairs", "verdict_registered_90", "verdict_all_110")}, indent=1, default=str))
    print(json.dumps({k: h5r.get(k) for k in ("all", "verdict", "verdict_source", "sbfl_blind")}, indent=1))
