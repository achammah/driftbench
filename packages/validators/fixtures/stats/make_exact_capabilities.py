"""Cases for the four planned statistics of docs/concepts/statistics.md ("Planned: four statistics ...").

Run from the repository root:  python3 packages/validators/fixtures/stats/make_exact_capabilities.py
Then format the output:        npx biome format --write packages/validators/fixtures/stats/exact-capabilities.json

Each function is defined in the docs page; every answer here is computed from that definition in exact rational
arithmetic or with scipy, never by the TypeScript. The functions do not exist yet, so the items built from this
file fail until they are written (validators/stats/NEEDS.md, batch 11).
"""

import json
import math
import os
from fractions import Fraction
from math import comb

import numpy as np
from scipy import stats

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "exact-capabilities.json")
out = {}
prov = {}


def put(name, source, cases):
    assert cases, name
    out[name] = cases
    prov[name] = source


def f(x):
    return float(x)


# --- holm -------------------------------------------------------------------------------------------------
def holm_ref(p, alpha=0.05):
    m = len(p)
    order = sorted(range(m), key=lambda i: (p[i], i))
    adj = [0.0] * m
    run = 0.0
    for rank, i in enumerate(order):
        run = max(run, min(1.0, (m - rank) * p[i]))
        adj[i] = run
    return {"adjusted": adj, "rejected": [a <= alpha for a in adj], "alpha": alpha}


def holm_case(p, alpha=0.05):
    return {"pvalues": p, "alpha": alpha, "expected": holm_ref(p, alpha)}


put("holm.textbook", "Holm 1979: adjusted = running maximum of min(1, (m - j + 1) p(j)) over the sorted p-values", [holm_case([0.01, 0.04, 0.03, 0.005]), holm_case([0.001, 0.02, 0.2, 0.5, 0.04]), holm_case([0.012, 0.011, 0.013]), holm_case([0.9, 0.8, 0.7])])
put("holm.order", "the adjusted values come back in the input order, not the sorted order", [holm_case([0.04, 0.001, 0.03, 0.2]), holm_case([0.3, 0.2, 0.1, 0.001, 0.002])])
put("holm.ties", "tied p-values get the same adjusted value", [holm_case([0.02, 0.02, 0.02, 0.5]), holm_case([0.01, 0.01, 0.04, 0.04])])
put("holm.monotone", "the running maximum keeps the adjusted values non-decreasing in rank", [holm_case([0.001, 0.03, 0.0301, 0.9]), holm_case([0.2, 0.0004, 0.0006, 0.5, 0.0005])])
put("holm.cap-at-one", "an adjusted value above 1 is 1", [holm_case([0.6, 0.7, 0.8, 0.9]), holm_case([0.34, 0.5])])
put("holm.alpha", "alpha 0.01, 0.05, 0.2 and the boundary p(j) (m - j + 1) = alpha is rejected", [holm_case([0.004, 0.012, 0.03], a) for a in [0.01, 0.05, 0.2]] + [holm_case([0.0125, 0.5, 0.9, 0.6], 0.05), holm_case([0.025, 0.5], 0.05)])
put("holm.single-and-empty", "one hypothesis is its own p-value; none gives empty lists", [holm_case([0.03]), holm_case([0.7]), holm_case([]), holm_case([0.0], 0.05), holm_case([1.0], 0.05)])
put(
    "holm.stricter-than-bh",
    "Holm never rejects more than Benjamini-Hochberg (scipy.stats.false_discovery_control gives the BH adjusted values to compare with)",
    [{"pvalues": p, "alpha": 0.05, "expected": {**holm_ref(p), "bhAdjusted": [f(v) for v in stats.false_discovery_control(p, method="bh")]}} for p in ([0.01, 0.015, 0.02, 0.03, 0.04], [0.001, 0.008, 0.039, 0.041, 0.042, 0.06])],
)

# --- sampleSizeForEffect ----------------------------------------------------------------------------------
def n_for(effect, p1, power=0.8, alpha=0.05, repeats=1, rho=0.0):
    za = stats.norm.isf(alpha / 2)
    zb = stats.norm.ppf(power)
    p2 = p1 - effect
    pbar = (p1 + p2) / 2
    neff = ((za * math.sqrt(2 * pbar * (1 - pbar)) + zb * math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) / effect) ** 2
    de = 1 + (repeats - 1) * rho
    n = neff * de / repeats
    r = math.ceil(n - 1e-9)
    # confirm it is the smallest n whose effective units reach neff
    assert r * repeats / de >= neff - 1e-9 and (r - 1) * repeats / de < neff + 1e-9
    return {"n": max(1, r), "effectiveN": max(1, r) * repeats / de, "designEffect": de}


def ss_case(effect, p1, **kw):
    args = {"effect": effect, "baselineRate": p1, **kw}
    return {**args, "expected": n_for(effect, p1, kw.get("power", 0.8), kw.get("alpha", 0.05), kw.get("repeats", 1), kw.get("rho", 0.0))}


put("sampleSizeForEffect.defaults", "the two-proportion power equation solved for n (scipy.stats.norm), defaults power 0.8 alpha 0.05", [ss_case(e, p) for e, p in [(0.1, 0.9), (0.05, 0.8), (0.2, 0.7), (0.15, 0.5), (0.3, 0.95)]])
put("sampleSizeForEffect.power", "power 0.5, 0.9, 0.95", [ss_case(0.1, 0.8, power=pw) for pw in [0.5, 0.9, 0.95]])
put("sampleSizeForEffect.alpha", "alpha 0.2, 0.01, 0.001", [ss_case(0.1, 0.8, alpha=a) for a in [0.2, 0.01, 0.001]])
put("sampleSizeForEffect.repeats", "repeats without correlation: n shrinks in proportion", [ss_case(0.1, 0.8, repeats=r) for r in [2, 5, 10]])
put("sampleSizeForEffect.rho", "repeats with a correlation: the design effect 1 + (repeats - 1) rho", [ss_case(0.1, 0.8, repeats=r, rho=ro) for r, ro in [(5, 0.3), (5, 0.9), (10, 0.5), (3, 0.0), (4, 1.0)]])
put("sampleSizeForEffect.whole-number", "n is a whole number, the smallest whose effective units reach the need", [ss_case(e, p) for e, p in [(0.07, 0.83), (0.12, 0.6), (0.33, 0.9)]])
put("sampleSizeForEffect.small-effect", "a small effect needs many specs", [ss_case(0.02, 0.5), ss_case(0.01, 0.9)])
put("sampleSizeForEffect.inverse-of-mde", "mde(n) at the returned n is at most the effect, and at n - 1 it is above it", [ss_case(e, p, repeats=r, rho=ro) for e, p, r, ro in [(0.1, 0.8, 1, 0.0), (0.15, 0.7, 4, 0.4), (0.08, 0.9, 6, 0.2)]])

# --- kappaInterval ----------------------------------------------------------------------------------------
def kappa_stats(a, b):
    cats = sorted(set(a) | set(b)); idx = {c: i for i, c in enumerate(cats)}; k = len(cats); n = len(a)
    t = [[0] * k for _ in range(k)]
    for x, y in zip(a, b):
        t[idx[x]][idx[y]] += 1
    po = Fraction(sum(t[i][i] for i in range(k)), n)
    r = [sum(row) for row in t]; c = [sum(t[i][j] for i in range(k)) for j in range(k)]
    pe = sum(Fraction(r[i] * c[i], n * n) for i in range(k))
    return n, po, pe


def kappa_case(a, b, alpha=0.05):
    n, po, pe = kappa_stats(a, b)
    if pe == 1:
        kap = 1.0 if po == 1 else 0.0
        return {"a": a, "b": b, "alpha": alpha, "expected": {"kappa": kap, "se": 0.0, "lower": kap, "upper": kap}}
    kap = f((po - pe) / (1 - pe))
    se = math.sqrt(f(po * (1 - po)) / (n * f((1 - pe) ** 2)))
    z = f(stats.norm.isf(alpha / 2))
    return {"a": a, "b": b, "alpha": alpha, "expected": {"kappa": kap, "se": se, "lower": max(-1.0, kap - z * se), "upper": min(1.0, kap + z * se)}}


def lab(g, n, k, agree):
    base = [int(x) for x in g.randint(0, k, n)]
    other = [x if g.rand() < agree else int(g.randint(0, k)) for x in base]
    return base, other


g = np.random.RandomState(123)
put("kappaInterval.binary", "kappa and its large-sample interval from the 2 x 2 table, exact rationals for po and pe", [kappa_case(*lab(g, n, 2, ag)) for n, ag in [(40, 0.8), (100, 0.7), (25, 0.9), (60, 0.6)]])
put("kappaInterval.multi-class", "three to five categories", [kappa_case(*lab(g, n, k, ag)) for n, k, ag in [(80, 3, 0.75), (120, 4, 0.6), (200, 5, 0.8)]])
put("kappaInterval.alpha", "alpha 0.2, 0.1, 0.01", [kappa_case(*lab(np.random.RandomState(5), 60, 3, 0.7), a) for a in [0.2, 0.1, 0.01]])
put("kappaInterval.perfect", "perfect agreement with more than one category: kappa 1, se 0", [kappa_case([0, 1, 1, 0, 2, 2], [0, 1, 1, 0, 2, 2]), kappa_case([1, 1, 0, 0], [1, 1, 0, 0])])
put("kappaInterval.chance-level", "agreement at chance: kappa near 0", [kappa_case([0, 0, 1, 1], [0, 1, 0, 1]), kappa_case([0, 1, 0, 1, 0, 1, 0, 1], [0, 0, 1, 1, 0, 0, 1, 1])])
put("kappaInterval.constant-raters", "both raters give one label throughout: pe = 1, the interval is the point", [kappa_case(["a"] * 5, ["a"] * 5), kappa_case([1] * 8, [1] * 8)])
put("kappaInterval.clipped", "the interval is clipped to [-1, 1]", [kappa_case([0, 0, 0, 0, 0, 0, 0, 1], [0, 0, 0, 0, 0, 0, 1, 1]), kappa_case([0, 1, 1, 1, 1, 1, 1, 1, 1, 1], [0, 1, 1, 1, 1, 1, 1, 1, 1, 0])])
put("kappaInterval.disagreement", "systematic disagreement gives a negative kappa", [kappa_case([0, 0, 1, 1, 0, 1], [1, 1, 0, 0, 1, 0]), kappa_case([0, 1, 2, 0, 1, 2], [1, 2, 0, 1, 2, 0])])
put("kappaInterval.labels", "labels may be strings or booleans", [kappa_case(["pass", "fail", "pass", "pass", "fail"], ["pass", "fail", "fail", "pass", "fail"]), kappa_case([True, False, True, True], [True, False, False, True])])

# --- mcnemarMidP ------------------------------------------------------------------------------------------
def midp(b, c):
    n = b + c
    if n == 0:
        return 1.0
    k = min(b, c)
    lower = sum(Fraction(comb(n, i), 2**n) for i in range(k))
    at = Fraction(comb(n, k), 2**n)
    return f(min(Fraction(1), 2 * lower + at))


def mc_case(b, c):
    return {"b": b, "c": c, "expected": {"pValue": midp(b, c), "b": b, "c": c}}


put("mcnemarMidP.small", "exact rationals: 2 P(X < k) + P(X = k), X binomial(b + c, 0.5)", [mc_case(*t) for t in [(0, 5), (1, 6), (2, 8), (3, 3), (0, 1), (1, 1), (4, 9), (0, 10)]])
put("mcnemarMidP.symmetric", "the test does not care which side is larger", [mc_case(2, 9), mc_case(9, 2), mc_case(0, 7), mc_case(7, 0)])
put("mcnemarMidP.no-discordant", "no discordant pair: p = 1", [mc_case(0, 0)])
put("mcnemarMidP.tied-sides", "b = c: the mid-p is capped at 1", [mc_case(5, 5), mc_case(1, 1), mc_case(20, 20)])
put("mcnemarMidP.larger", "tens of discordant pairs", [mc_case(*t) for t in [(10, 30), (25, 40), (12, 12), (3, 40), (50, 80)]])
put("mcnemarMidP.large-count", "hundreds of discordant pairs: exact big-integer arithmetic keeps the value", [mc_case(*t) for t in [(100, 160), (200, 300), (400, 400)]])
put("mcnemarMidP.less-conservative", "the mid-p is below the exact two-sided p (scipy.stats.binomtest) whenever b != c", [{"b": b, "c": c, "expected": {"pValue": midp(b, c), "b": b, "c": c, "exactP": f(stats.binomtest(min(b, c), b + c, 0.5).pvalue)}} for b, c in [(0, 5), (2, 9), (3, 12), (10, 25)]])

doc = {"provenance": {"script": "packages/validators/fixtures/stats/make_exact_capabilities.py", "numpy": np.__version__, "sources": prov}, **out}
with open(OUT, "w") as fh:
    json.dump(doc, fh, indent=1, allow_nan=False)
print("wrote", OUT, {k: len(v) for k, v in out.items()})
