"""Measure the terse-regular persona's verbosity from real ABCD customers (offline, no paid call).

Procedure (fixed before any HF10 run): ABCD v1.1 train split, the 8 action flows, dialogues with at least 4
customer turns (consecutive customer messages merged into one turn, as in H10). Per dialogue: short-turn
share (turns of at most 3 words) and mean words per turn. Features standardised, k-means with k = 3
(Lloyd, k-means++ start, 10 starts from random.Random(7), lowest inertia kept). The terse cluster is the
one with the highest mean short-turn share. Its pooled short-turn share, pooled words per turn and its
share of dialogues (the population weight) become terse-regular's verbosity and weight.
Usage: ABCD_DIR=... python measure_terse.py OUT.json"""
import json, math, os, random, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from lib import abcd

rows = []
for c in abcd.load()["train"]:
    if not abcd.action_flow(c):
        continue
    ts = abcd.customer_turns(c)
    if len(ts) < 4:
        continue
    words = [len(t.split()) for t in ts]
    rows.append({"id": c["convo_id"], "n": len(ts), "short": sum(w <= 3 for w in words), "words": sum(words),
                 "q": sum("?" in t for t in ts)})
X = [(r["short"] / r["n"], r["words"] / r["n"]) for r in rows]
mu = [sum(x[i] for x in X) / len(X) for i in range(2)]
sd = [math.sqrt(sum((x[i] - mu[i]) ** 2 for x in X) / len(X)) for i in range(2)]
Z = [((x[0] - mu[0]) / sd[0], (x[1] - mu[1]) / sd[1]) for x in X]


def d2(a, b):
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2


def kmeans(Z, k, rng, iters=100):
    cents = [Z[rng.randrange(len(Z))]]
    while len(cents) < k:
        w = [min(d2(z, c) for c in cents) for z in Z]
        t, acc = rng.random() * sum(w), 0.0
        for z, wi in zip(Z, w):
            acc += wi
            if acc >= t:
                cents.append(z)
                break
    for _ in range(iters):
        lab = [min(range(k), key=lambda j: d2(z, cents[j])) for z in Z]
        new = []
        for j in range(k):
            m = [z for z, l in zip(Z, lab) if l == j]
            new.append((sum(z[0] for z in m) / len(m), sum(z[1] for z in m) / len(m)) if m else cents[j])
        if new == cents:
            break
        cents = new
    inertia = sum(d2(z, cents[l]) for z, l in zip(Z, lab))
    return lab, inertia


rng = random.Random(7)
best = min((kmeans(Z, 3, rng) for _ in range(10)), key=lambda r: r[1])
lab = best[0]
clusters = []
for j in range(3):
    m = [r for r, l in zip(rows, lab) if l == j]
    n = sum(r["n"] for r in m)
    clusters.append({"cluster": j, "dialogues": len(m), "weight": len(m) / len(rows),
                     "short_turn_share": sum(r["short"] for r in m) / n,
                     "words_per_turn": sum(r["words"] for r in m) / n,
                     "question_turn_share": sum(r["q"] for r in m) / n})
terse = max(clusters, key=lambda c: c["short_turn_share"])
out = {"source": "ABCD v1.1 train, action flows, >=4 customer turns", "dialogues": len(rows),
       "clusters": clusters, "terse": terse}
json.dump(out, open(sys.argv[1], "w"), indent=1)
print(json.dumps(out, indent=1))
