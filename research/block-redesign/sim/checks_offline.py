"""Offline sanity checks (no model calls): M2.5 estimator and stub flip share, M2.1 determinism,
and the human reference rates. Run: ABCD_DIR=... python -m checks_offline (from this folder's parent)."""
import itertools, json, os, random, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import metrics, flips, abcd, simulators, agent, convo

out = {}

# M2.5 check 1: estimator equals brute force for every n <= 8.
ok = True
for n in range(1, 9):
    for c in range(n + 1):
        for k in range(1, n + 1):
            outcomes = [True] * c + [False] * (n - c)
            if abs(metrics.pass_hat_k(n, c, k) - metrics.pass_hat_k_brute(outcomes, k)) > 1e-12:
                ok = False
out["m25_estimator_equals_bruteforce"] = ok

# M2.5 check 2: trivially passable stub agent + scripted stub simulator -> flip share 0.
class StubAgent:
    def __init__(self, conv):
        self.conv, self.tool_calls = conv, []
    def respond(self, text):
        names = [s["name"] for s in agent.tool_specs()]
        self.tool_calls += [(n, {}) for n in names]
        return "Done. Anything else?"

class StubUser:
    def __init__(self, fam):
        self.n = 0
    def reply(self, text):
        self.n += 1
        return ("I need help", None, {}) if self.n == 1 else ("", "###STOP###", {})

dev = [c for c in abcd.load()["dev"] if abcd.action_flow(c)]
blocks = abcd.flow_balanced_sample(dev, 20, random.Random(11))
trials = {}
for b in blocks:
    trials[b["convo_id"]] = {f: [convo.run(b, StubUser(f), StubAgent(b))["passed"] for _ in range(8)] for f in "OG"}
X, W = flips.flip_shares(trials)
out["m25_stub_flip_share"] = {"X": X, "W": W}

# M2.1 check 1: same seed + same agent acts -> identical planned acts across 10 runs.
conv = blocks[0]
script = [
    {"requested_slots": ["customer_name"], "asks_problem_detail": False, "asks_confirmation": False,
     "asks_to_try_something": False, "says_cannot_do": False, "says_resolved": False, "asks_anything_else": False},
    {"requested_slots": ["username", "email", "order_id"], "asks_problem_detail": True, "asks_confirmation": False,
     "asks_to_try_something": False, "says_cannot_do": False, "says_resolved": False, "asks_anything_else": False},
    {"requested_slots": [], "asks_problem_detail": False, "asks_confirmation": False,
     "asks_to_try_something": False, "says_cannot_do": True, "says_resolved": False, "asks_anything_else": False},
    {"requested_slots": [], "asks_problem_detail": False, "asks_confirmation": False,
     "asks_to_try_something": False, "says_cannot_do": False, "says_resolved": True, "asks_anything_else": True},
]
seqs = []
for _ in range(10):
    e = simulators.Engine(conv, seed=12345)
    seq = [e.plan()[0]]
    for c in script:
        e.observe(c)
        acts, style, stop = e.plan()
        seq.append((acts, style, stop))
    seqs.append(json.dumps(seq, sort_keys=True, default=str))
out["m21_determinism_identical_10_runs"] = len(set(seqs)) == 1
out["m21_example_plan"] = json.loads(seqs[0])

# Human reference rates on ABCD (pre-registered sets), no model calls.
test = [c for c in abcd.load()["test"] if abcd.action_flow(c)]
rng = random.Random(10)
E = abcd.stratified_sample(test, 100, rng)
rest = sorted([c for c in test if c["convo_id"] not in {e["convo_id"] for e in E}], key=lambda c: c["convo_id"])
ceil = rng.sample(rest, 200)
H = [abcd.customer_turns(c) for c in E]
H1 = [abcd.customer_turns(c) for c in ceil[:100]]
H2 = [abcd.customer_turns(c) for c in ceil[100:]]
out["human_E_rates"] = metrics.rates(H)
out["human_E_secondary"] = metrics.secondary(H)
out["ceiling_split_half_dice"] = metrics.dice_all(H1, H2)
out["n_test_action_pool"] = len(test)
print(json.dumps(out, indent=1, default=str))
