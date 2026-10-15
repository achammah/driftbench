"""H10 runner. Usage: python run_h10.py OUTDIR [--pilot]. One JSON line per conversation; resumable."""
import json, os, random, sys, traceback
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from concurrent.futures import ThreadPoolExecutor
from lib import abcd, agent, convo, simulators

out_dir = sys.argv[1]
pilot = "--pilot" in sys.argv
path = os.path.join(out_dir, "h10_pilot.jsonl" if pilot else "h10_runs.jsonl")

test = [c for c in abcd.load()["test"] if abcd.action_flow(c)]
E = abcd.stratified_sample(test, 100, random.Random(10))
if pilot:
    E = E[:2]
done = set()
if os.path.exists(path):
    for line in open(path):
        r = json.loads(line)
        if "error" not in r:
            done.add((r["convo_id"], r["arm"]))
jobs = [(i, c, arm) for arm in ("free", "findings", "engine") for i, c in enumerate(E) if (c["convo_id"], arm) not in done]


def one(job):
    i, c, arm = job
    try:
        if arm == "engine":
            user = simulators.EngineUser(c, seed=10000 + i, family="O", tag="h10-engine")
        else:
            user = simulators.PromptUser(c, family="O", findings=(arm == "findings"), tag=f"h10-{arm}")
        r = convo.run(c, user, agent.Agent(c, tag=f"h10-agent-{arm}"))
        r.update(arm=arm, item=i)
    except Exception as e:
        r = {"convo_id": c["convo_id"], "arm": arm, "item": i, "error": repr(e), "tb": traceback.format_exc()[-800:]}
    with open(path, "a") as fh:
        fh.write(json.dumps(r) + "\n")
    return r


with ThreadPoolExecutor(int(os.environ.get("SIM_WORKERS", "8"))) as ex:
    for r in ex.map(one, jobs):
        print(r["convo_id"], r["arm"], r.get("passed"), r.get("stop"), r.get("user_turns"), r.get("error", "")[:200], flush=True)
