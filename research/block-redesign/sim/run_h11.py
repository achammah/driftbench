"""H11 runner. Usage: python run_h11.py OUTDIR [--pilot]. Appends one JSON line per conversation to
OUTDIR/h11_runs.jsonl and skips (block, family, trial) keys already present (resume after a crash)."""
import json, os, random, sys, traceback
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from concurrent.futures import ThreadPoolExecutor
from lib import abcd, agent, convo, simulators

out_dir = sys.argv[1]
pilot = "--pilot" in sys.argv
os.makedirs(out_dir, exist_ok=True)
path = os.path.join(out_dir, "h11_pilot.jsonl" if pilot else "h11_runs.jsonl")

dev = [c for c in abcd.load()["dev"] if abcd.action_flow(c)]
blocks = abcd.flow_balanced_sample(dev, 20, random.Random(11))
if pilot:
    blocks = blocks[:2]
trials = 1 if pilot else 8
done = set()
if os.path.exists(path):
    for line in open(path):
        r = json.loads(line)
        if "error" not in r:
            done.add((r["convo_id"], r["family"], r["trial"]))
jobs = [(b, f, t) for t in range(trials) for b in blocks for f in "OG" if (b["convo_id"], f, t) not in done]


def one(job):
    b, f, t = job
    try:
        user = simulators.PromptUser(b, family=f, tag=f"h11-sim-{f}")
        ag = agent.Agent(b, tag="h11-agent")
        r = convo.run(b, user, ag)
        r.update(family=f, trial=t)
    except Exception as e:
        r = {"convo_id": b["convo_id"], "family": f, "trial": t, "error": repr(e), "tb": traceback.format_exc()[-800:]}
    with open(path, "a") as fh:
        fh.write(json.dumps(r) + "\n")
    return r


with ThreadPoolExecutor(int(os.environ.get("SIM_WORKERS", "8"))) as ex:
    for r in ex.map(one, jobs):
        print(r["convo_id"], r["family"], r["trial"], r.get("passed"), r.get("stop"), r.get("missing"), r.get("error", "")[:200], flush=True)
