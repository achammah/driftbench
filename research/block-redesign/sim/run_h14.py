"""H14 pipeline. Usage: python run_h14.py STAGE OUTDIR [--pilot]
Stages: suite | facets | cluster | blocks. Scratch outputs go to OUTDIR; small derived files to h14/."""
import json, os, random, re, sys, traceback
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from concurrent.futures import ThreadPoolExecutor
from lib import abcd, agent, convo, llm, simulators

stage, out_dir = sys.argv[1], sys.argv[2]
pilot = "--pilot" in sys.argv
HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "h14")
P = lambda name: os.path.join(out_dir, ("pilot_" if pilot else "") + name)

train = sorted([c for c in abcd.load()["train"] if abcd.action_flow(c)], key=lambda c: c["convo_id"])
PROD = random.Random(14).sample(train, 1000)
BYID = {c["convo_id"]: c for c in PROD}

SUITE_PROMPT = ("Below is the system prompt of a customer support agent. Write 15 distinct test scenarios a QA "
                "engineer would write for this agent. Each scenario is one line: the customer's goal, in one "
                "sentence. Return JSON: {\"scenarios\": [\"...\", ...]}.\n\n")

FACET_SYSTEM = ("You summarise customer service chats. In one sentence, say what the customer wanted. Do not "
                "include any names, usernames, ids, order numbers, addresses, e-mails, phone numbers, dates or "
                "amounts. Output only the sentence.")

NAME_SYSTEM = "You name a group of customer requests. Given example summaries, output a short name (at most 8 words) for the group."

PRIV = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+|\(?\d{3}\)?[ -.]?\d{3}[ -.]?\d{4}|\b\w*\d\w*\b")


def dialogue_text(c):
    return "\n".join(f"{s}: {t}" for s, t in c["original"])


if stage == "suite":
    sysp = agent.SYSTEM_HEAD + agent.render_guidelines()
    raw = llm.chat("O", "You write software test scenarios.", [{"role": "user", "content": SUITE_PROMPT + sysp}],
                   "h14-suite", json_mode=True, max_tokens=4000)
    suite = json.loads(raw)["scenarios"][:15]
    json.dump({"model": llm.OPENAI_SMALL, "prompt": SUITE_PROMPT, "scenarios": suite}, open(os.path.join(HERE, "suite.json"), "w"), indent=1)
    print(json.dumps(suite, indent=1))

elif stage == "facets":
    items = PROD[:5] if pilot else PROD
    path = P("facets.jsonl")
    done = {json.loads(l)["convo_id"] for l in open(path)} if os.path.exists(path) else set()

    def one(c):
        s = llm.chat("O", FACET_SYSTEM, [{"role": "user", "content": dialogue_text(c)}], "h14-facet").strip()
        with open(path, "a") as fh:
            fh.write(json.dumps({"convo_id": c["convo_id"], "summary": s}) + "\n")
        return s
    with ThreadPoolExecutor(12) as ex:
        for s in ex.map(one, [c for c in items if c["convo_id"] not in done]):
            pass
    print(sum(1 for _ in open(path)), "facets")

elif stage == "cluster":
    import numpy as np
    from sklearn.cluster import KMeans
    facets = {json.loads(l)["convo_id"]: json.loads(l)["summary"] for l in open(P("facets.jsonl"))}
    ids = [c["convo_id"] for c in PROD if c["convo_id"] in facets]
    suite = json.load(open(os.path.join(HERE, "suite.json")))["scenarios"]
    emb = np.array(llm.embed([facets[i] for i in ids] + suite, "h14-embed"))
    emb /= np.linalg.norm(emb, axis=1, keepdims=True)
    X, S = emb[: len(ids)], emb[len(ids):]
    km = KMeans(n_clusters=30, n_init=10, random_state=14).fit(X)
    cent = km.cluster_centers_ / np.linalg.norm(km.cluster_centers_, axis=1, keepdims=True)
    sims = S @ cent.T  # blocks x clusters
    links = {}
    for b in range(len(suite)):
        order = np.argsort(-sims[b])[:7]
        best = sims[b][order[0]]
        links[b] = [int(k) for k in order if sims[b][k] >= 0.9 * best]
    covered = sorted({k for v in links.values() for k in v})
    labels = km.labels_.tolist()
    members = {k: [ids[j] for j in range(len(ids)) if labels[j] == k] for k in range(30)}
    dist = {ids[j]: float(1 - X[j] @ cent[labels[j]]) for j in range(len(ids))}
    flagged = [i for i in ids if PRIV.search(facets[i])]
    names = {}
    for k in range(30):
        ex = [facets[i] for i in sorted(members[k], key=lambda i: dist[i]) if i not in flagged][:10]
        names[k] = llm.chat("O", NAME_SYSTEM, [{"role": "user", "content": "\n".join(ex)}], "h14-name").strip()
    out = {"k": 30, "covered": covered, "uncovered": [k for k in range(30) if k not in covered],
           "links": links, "names": names, "sizes": {k: len(members[k]) for k in range(30)},
           "privacy_flagged": len(flagged),
           "members": {k: sorted(members[k], key=lambda i: dist[i]) for k in range(30)},
           "subflows": {k: sorted({BYID[i]["scenario"]["subflow"] for i in members[k]}) for k in range(30)},
           "suite_best_sim": [float(sims[b].max()) for b in range(len(suite))]}
    json.dump(out, open(os.path.join(HERE, "clusters.json"), "w"), indent=1)
    print("uncovered", out["uncovered"], "flagged", len(flagged))

elif stage == "blocks":
    cl = json.load(open(os.path.join(HERE, "clusters.json")))
    unc = cl["uncovered"]
    if not unc:
        print("U = 0: INCONCLUSIVE"); sys.exit(0)
    M = min(30, max(15, len(unc)))
    queues = {k: list(cl["members"][str(k)]) for k in unc}
    picked = []
    while len(picked) < M and any(queues.values()):
        for k in unc:
            if queues[k] and len(picked) < M:
                picked.append(("uncovered", queues[k].pop(0), k))
    taken = {p[1] for p in picked}
    pool = [c["convo_id"] for c in PROD if c["convo_id"] not in taken]
    rnd = random.Random(1414).sample(pool, M)
    labels = {i: int(k) for k, v in cl["members"].items() for i in v}
    picked += [("random", i, labels.get(i)) for i in rnd]
    if pilot:
        picked = [picked[0], picked[M]]
    runs = 1 if pilot else 3
    json.dump({"M": M, "U": len(unc), "blocks": picked}, open(P("h14_blocks.json"), "w"))
    path = P("h14_runs.jsonl")
    done = set()
    if os.path.exists(path):
        for l in open(path):
            r = json.loads(l)
            if "error" not in r:
                done.add((r["arm"], r["convo_id"], r["run"]))
    jobs = [(arm, i, k, r) for r in range(runs) for arm, i, k in picked if (arm, i, r) not in done]

    def one(job):
        arm, i, k, run = job
        c = BYID[i]
        try:
            r = convo.run(c, simulators.PromptUser(c, family="O", tag="h14-sim"), agent.Agent(c, tag="h14-agent"))
            r.update(arm=arm, cluster=k, run=run)
        except Exception as e:
            r = {"arm": arm, "convo_id": i, "run": run, "error": repr(e), "tb": traceback.format_exc()[-800:]}
        with open(path, "a") as fh:
            fh.write(json.dumps(r) + "\n")
        return r
    with ThreadPoolExecutor(int(os.environ.get("SIM_WORKERS", "8"))) as ex:
        for r in ex.map(one, jobs):
            print(r["arm"], r["convo_id"], r["run"], r.get("passed"), r.get("missing"), r.get("error", "")[:200], flush=True)
