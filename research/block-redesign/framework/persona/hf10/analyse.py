"""HF10 analysis. Usage: python hf10/analyse.py RUNS.jsonl OUT.json"""
import json, os, random, sys
from collections import Counter, defaultdict
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from lib import grid, metrics, personas

REAL = ["terse-regular", "chatty-newcomer", "persistent-skeptic"]
AA = ["terse-regular", "terse-regular-aa"]
ALL = REAL + ["terse-regular-aa"]
N = 8

rows, errors = {}, []
for line in open(sys.argv[1]):
    r = json.loads(line)
    if "error" in r:
        errors.append({k: r[k] for k in ("convo_id", "persona", "trial", "error")})
        continue
    rows.setdefault((r["convo_id"], r["persona"], r["trial"]), r)
blocks = sorted({k[0] for k in rows})
cells = {b: {p: [rows[(b, p, t)]["passed"] for t in range(N)] for p in ALL} for b in blocks}
missing = [(b, p, t) for b in blocks for p in ALL for t in range(N) if (b, p, t) not in rows]
assert not missing, missing

real = {b: grid.block_flag({p: cells[b][p] for p in REAL}) for b in blocks}
aa = {b: grid.block_flag({p: cells[b][p] for p in AA}) for b in blocks}
n_real = sum(v["flag"] for v in real.values())
n_aa = sum(v["flag"] for v in aa.values())
verdict = "FALSIFIED" if (n_aa > 0 or n_real == 0) else "SUPPORTED"

# per cell
per_cell = {str(b): {p: {"c": sum(cells[b][p]), "n": N, "outcomes": "".join("1" if x else "0" for x in cells[b][p]),
                         "wilson95": [round(x, 3) for x in grid.wilson(sum(cells[b][p]), N)],
                         "pass_hat_4": round(grid.pass_hat_k(N, sum(cells[b][p]), 4), 3)} for p in ALL} for b in blocks}

# per persona column, block-cluster bootstrap; paired differences against terse-regular
cols = {}
for p in ALL:
    vals = [sum(cells[b][p]) / N for b in blocks]
    cols[p] = {"mean_pass_rate": round(sum(vals) / len(vals), 3),
               "bootstrap95": [round(x, 3) for x in grid.cluster_bootstrap_mean(vals)]}
    if p != "terse-regular":
        d = [sum(cells[b][p]) / N - sum(cells[b]["terse-regular"]) / N for b in blocks]
        cols[p]["diff_vs_terse"] = round(sum(d) / len(d), 3)
        cols[p]["diff_bootstrap95"] = [round(x, 3) for x in grid.cluster_bootstrap_mean(d)]

# permutation test of the real grid's flag count: persona labels shuffled within block over its 24 trials
rng = random.Random(1013)
perm_ge = 0
for _ in range(2000):
    k = 0
    for b in blocks:
        pool = [x for p in REAL for x in cells[b][p]]
        rng.shuffle(pool)
        k += grid.block_flag({p: pool[i * N:(i + 1) * N] for i, p in enumerate(REAL)})["flag"]
    perm_ge += k >= n_real
perm_p = perm_ge / 2000

# null false-flag rate on this run's pooled block rates
pooled_aa = [sum(sum(cells[b][p]) for p in AA) / (N * len(AA)) for b in blocks]
pooled_real = [sum(sum(cells[b][p]) for p in REAL) / (N * len(REAL)) for b in blocks]
null_aa = grid.null_flag_rate(pooled_aa, 2, n=N, sims=int(os.environ.get("NULL_SIMS", "10000")), seed=1012)
null_real = grid.null_flag_rate(pooled_real, 3, n=N, sims=int(os.environ.get("NULL_SIMS", "10000")), seed=1012)

# persona came through: user-turn rates per column against the persona's targets
came = {}
for p in ALL:
    convs = [rows[(b, p, t)] for b in blocks for t in range(N)]
    dialogues = [[t["text"] for t in r["turns"] if t["role"] == "user" and t["text"]] for r in convs]
    rt = metrics.rates(dialogues)
    sec = metrics.secondary(dialogues)
    beh = personas.load(p)["behaviour"]
    came[p] = {"Short%": round(rt["Short%"], 1), "target_short%": round(100 * beh["verbosity"]["short_turn_share"], 1),
               "words_per_turn": round(sec["words/turn"], 2), "target_words_per_turn": beh["verbosity"]["words_per_turn"],
               "Quest%": round(rt["Quest%"], 1), "target_quest%": round(100 * beh["tone"]["question_turn_share"], 1),
               "Polite%": round(rt["Polite%"], 1), "user_turns_mean": round(sec["turns/dialogue"], 2),
               "stops": dict(Counter(r["stop"] for r in convs)),
               "applied_hash_matches": sum(r["applied_hash"] == r["config_hash"] for r in convs), "n": len(convs)}

res = {
    "n_blocks": len(blocks), "n_conversations": len(rows), "n_errors": len(errors), "errors": errors,
    "verdict": verdict, "real_grid_flagged": n_real, "aa_flagged": n_aa,
    "real_flagged_blocks": [b for b in blocks if real[b]["flag"]], "aa_flagged_blocks": [b for b in blocks if aa[b]["flag"]],
    "real_flag_parts": {"noise_rule_only": sum(v["flag_noise"] for v in real.values()),
                        "exact_rule_only": sum(v["flag_exact"] for v in real.values())},
    "aa_flag_parts": {"noise_rule_only": sum(v["flag_noise"] for v in aa.values()),
                      "exact_rule_only": sum(v["flag_exact"] for v in aa.values())},
    "per_block_real": {str(b): {k: (round(v, 4) if isinstance(v, float) else v) for k, v in real[b].items()} for b in blocks},
    "per_block_aa": {str(b): {k: (round(v, 4) if isinstance(v, float) else v) for k, v in aa[b].items()} for b in blocks},
    "per_cell": per_cell, "columns": cols,
    "permutation_p_real_flag_count": perm_p,
    "null_aa_any_flag_prob_and_expected": [round(x, 4) for x in null_aa],
    "null_real_any_flag_prob_and_expected": [round(x, 4) for x in null_real],
    "persona_came_through": came,
}
json.dump(res, open(sys.argv[2], "w"), indent=1)
print(json.dumps({k: v for k, v in res.items() if k not in ("per_cell", "per_block_real", "per_block_aa")}, indent=1))
