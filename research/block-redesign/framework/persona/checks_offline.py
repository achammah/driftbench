"""Offline checks run before any paid call (no model call). Usage: ABCD_DIR=... python checks_offline.py OUT.json"""
import json, os, random, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from itertools import combinations
from lib import abcd, grid, lang, personas, routing, simulators

out = {}
# 1. pass^k estimator equals brute-force enumeration of k-subsets
ok = True
for n in range(1, 9):
    for c in range(n + 1):
        outs = [True] * c + [False] * (n - c)
        for k in range(1, n + 1):
            subs = list(combinations(range(n), k))
            brute = sum(all(outs[i] for i in s) for s in subs) / len(subs)
            ok &= abs(brute - grid.pass_hat_k(n, c, k)) < 1e-12
out["pass_hat_k_equals_brute_force"] = ok
# 2. exact test reproduces the values in simuser_model.md 4.3
out["fisher_7of8_vs_2of8"] = round(grid.exact_equal_rates([7, 2], 8), 4)
out["fisher_8of8_vs_4of8"] = round(grid.exact_equal_rates([8, 4], 8), 4)
out["fisher_16of16_vs_10of16"] = round(grid.exact_equal_rates([16, 10], 16), 4)
# 3. the flag never fires on identical cells, and fires on 8/8 vs 0/8
same = {"a": [True, False] * 4, "b": [True, False] * 4}
out["flag_on_identical_cells"] = grid.block_flag(same)["flag"]
out["flag_on_8_vs_0"] = grid.block_flag({"a": [True] * 8, "b": [False] * 8})["flag"]
# 4. engine determinism with persona parameters: same seed and recorded agent acts give the same plan, 10 runs
conv = abcd.by_id("dev")[5440]
acts = [{"requested_slots": ["customer_name"], "asks_problem_detail": False, "asks_confirmation": False,
         "asks_to_try_something": False, "says_cannot_do": False, "says_resolved": False, "asks_anything_else": False},
        {"requested_slots": [], "asks_problem_detail": False, "asks_confirmation": False, "asks_to_try_something": False,
         "says_cannot_do": True, "says_resolved": False, "asks_anything_else": False},
        {"requested_slots": [], "asks_problem_detail": False, "asks_confirmation": False, "asks_to_try_something": False,
         "says_cannot_do": False, "says_resolved": True, "asks_anything_else": True}]
det = {}
for pid in ["terse-regular", "chatty-newcomer", "persistent-skeptic"]:
    params = personas.engine_params(personas.load(pid))
    seqs = []
    for _ in range(10):
        e = simulators.Engine(conv, personas.cell_seed(5440, pid, 0), params)
        seq = [e.plan()[0]]
        for a in acts:
            e.observe(a)
            seq.append(e.plan()[0])
        seqs.append(json.dumps(seq))
    det[pid] = len(set(seqs)) == 1
out["engine_determinism"] = det
# 5. personas reach the engine: the applied parameters equal the persona file's parameters
out["persona_params_applied"] = all(
    personas.config_hash(simulators.EngineUser(conv, 1, params=personas.engine_params(personas.load(p)),
                                               classifier=lambda t: {}).engine.p)
    == personas.config_hash(personas.engine_params(personas.load(p)))
    for p in ["terse-regular", "chatty-newcomer", "persistent-skeptic", "terse-regular-aa", "terse-regular-fr"])
# 6. routing: the language rule selects exactly the non-English persona cells
links = routing.load(os.path.join(os.path.dirname(os.path.abspath(__file__)), "hf11", "links.json"))
cells = [(b, personas.load(p)) for b in (1, 2) for p in ("terse-regular", "terse-regular-fr")]
sel = routing.select(links, "agent.system#language-rule", cells)
out["routing_selected"] = sorted(map(list, sel))
out["routing_unknown_unit_selects_all"] = len(routing.select(links, "agent.system#other", cells)) == 4
# 7. language detector on real English agent turns (ABCD test, 500 turns of at least 4 words, seed 7)
turns = [t for c in abcd.load()["test"] for spk, t in c["original"] if spk == "agent" and len(t.split()) >= 4]
sample = random.Random(7).sample(turns, 500)
det_l = [lang.detect(t) for t in sample]
out["lang_detect_abcd_agent_en"] = {"n": 500, "en": det_l.count("en"), "fr": det_l.count("fr"), "none": det_l.count(None)}
json.dump(out, open(sys.argv[1], "w"), indent=1)
print(json.dumps(out, indent=1))
