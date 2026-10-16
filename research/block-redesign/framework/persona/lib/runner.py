"""Run persona-grid cells: one conversation per (block, persona, trial, prompt rule). Resumable jsonl."""
import json, os, random, traceback
from concurrent.futures import ThreadPoolExecutor
from . import abcd, agent, convo, personas, simulators

SIMULATOR_FAMILY = "O"  # gpt-5.4-nano realiser and act classifier (H10 engine arm)


def h11_blocks():
    """The 20 H11 blocks: ABCD dev, action flows, flow-balanced sample with random.Random(11)."""
    dev = [c for c in abcd.load()["dev"] if abcd.action_flow(c)]
    return abcd.flow_balanced_sample(dev, 20, random.Random(11))


def one(block, persona_id, trial, rule, tag):
    p = personas.load(persona_id)
    params = personas.engine_params(p)
    seed = personas.cell_seed(block["convo_id"], persona_id, trial)
    user = simulators.EngineUser(block, seed=seed, family=SIMULATOR_FAMILY, tag=f"{tag}-sim", params=params)
    applied = personas.config_hash(user.engine.p)
    r = convo.run(block, user, agent.Agent(block, tag=f"{tag}-agent", rule=rule))
    r.update(persona=persona_id, language=p["language"], trial=trial, rule=rule, seed=seed,
             config_hash=personas.config_hash(params), applied_hash=applied)
    return r


def run(jobs, path, tag, workers=8):
    """jobs: list of (block conv, persona_id, trial, rule). Skips keys already in `path` without error."""
    done = set()
    if os.path.exists(path):
        for line in open(path):
            r = json.loads(line)
            if "error" not in r:
                done.add((r["convo_id"], r["persona"], r["trial"], r["rule"]))
    todo = [j for j in jobs if (j[0]["convo_id"], j[1], j[2], j[3]) not in done]

    def go(job):
        b, pid, t, rule = job
        try:
            r = one(b, pid, t, rule, tag)
        except Exception as e:
            r = {"convo_id": b["convo_id"], "persona": pid, "trial": t, "rule": rule, "error": repr(e),
                 "tb": traceback.format_exc()[-800:]}
        with open(path, "a") as fh:
            fh.write(json.dumps(r) + "\n")
        return r

    with ThreadPoolExecutor(workers) as ex:
        for r in ex.map(go, todo):
            print(r["convo_id"], r["persona"], r["trial"], r["rule"], r.get("passed"), r.get("stop"),
                  r.get("user_turns"), r.get("error", "")[:200], flush=True)
