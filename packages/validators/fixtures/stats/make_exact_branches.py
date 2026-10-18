"""Branch-level exact values for the statistics bank (packages/validators/src/ladders/stats/bank/exact-branches.ts).

Run from the repository root:  python3 packages/validators/fixtures/stats/make_exact_branches.py
Then format the output:        npx biome format --write packages/validators/fixtures/stats/exact-branches.json

make_exact.py gives each function one or two groups of cases. A bug on one branch of a function (a tie rule, an
edge of the domain, an option) can slip past a group that never reaches that branch. This script gives the
functions the audit found weakest one group per branch, so a fault on a branch fails an item of its own.

Every number is computed here from a documented formula in exact rational arithmetic, from the standard library,
from numpy or from scipy (through exact_ref.py); no line reads the TypeScript. The cases are fictional numbers.
"""

import itertools
import json
import math
import os
from fractions import Fraction

import numpy as np
from exact_ref import (
    Z95,
    hier_ref,
    mde_ref,
    newcombe,
    ph_ref,
    wilson_effective_ref,
)
from scipy import special, stats

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "exact-branches.json")
g = np.random.RandomState(20261018)
out = {}
prov = {}


def put(name, source, cases):
    assert cases, name
    out[name] = cases
    prov[name] = source


def f(x):
    return float(x)



def wilson_dec_pair(k, n, z):
    from decimal import Decimal, getcontext

    getcontext().prec = 60
    kk, nn, zz = Decimal(k), Decimal(n), Decimal(repr(z))
    p = kk / nn
    z2 = zz * zz
    den = 1 + z2 / nn
    centre = (p + z2 / (2 * nn)) / den
    half = zz * (p * (1 - p) / nn + z2 / (4 * nn * nn)).sqrt() / den
    return float(max(Decimal(0), centre - half)), float(min(Decimal(1), centre + half))


# --- zFor -------------------------------------------------------------------------------------------------
levels = [0.9, 0.5, 0.3, 0.2, 0.1, 0.05, 0.02, 0.01, 0.005, 0.001, 2e-4, 1e-4]
put("zFor.levels", "scipy.stats.norm.isf(alpha / 2)", [{"alpha": a, "expected": f(stats.norm.isf(a / 2))} for a in levels])
put(
    "zFor.far-tail",
    "scipy.stats.norm.isf(alpha / 2)",
    [{"alpha": a, "expected": f(stats.norm.isf(a / 2))} for a in [1e-5, 1e-6, 1e-7, 1e-8, 1e-9]],
)
put(
    "zFor.monotone",
    "scipy.stats.norm.isf(alpha / 2); the property compares neighbours of the list",
    [{"alphas": levels, "expected": [f(stats.norm.isf(a / 2)) for a in levels]}],
)

# --- quantile, quantileSorted, unreliability --------------------------------------------------------------


def q7(values, p):
    return f(np.quantile(np.array(values, dtype=float), p, method="linear"))


def q7_exact(values, p):
    """Type 7 in exact rational arithmetic: sorted[lo] + (h - lo) (sorted[hi] - sorted[lo]), h = (n - 1) p."""
    s = sorted(Fraction(v) for v in values)
    n = len(s)
    h = (n - 1) * Fraction(p)
    lo = int(math.floor(h))
    hi = min(lo + 1, n - 1)
    return f(s[lo] + (h - lo) * (s[hi] - s[lo]))


def rand_values(n, scale=10.0, decimals=3):
    return [round(float(x), decimals) for x in g.uniform(-scale, scale, n)]


q_order = []
for n in range(2, 10):
    vals = rand_values(n)
    sv = sorted(vals)
    for i in range(n):
        q_order.append({"values": vals, "p": f(Fraction(i, n - 1)), "expected": sv[i]})
put("quantile.order-statistics", "the i-th order statistic at p = i / (n - 1), by sorting", q_order)

q_mid = []
for n in [2, 3, 4, 5, 7, 10, 11]:
    vals = rand_values(n)
    for num, den in [(1, 4), (1, 2), (3, 4), (1, 3), (2, 3), (1, 10), (9, 10), (1, 8)]:
        p = Fraction(num, den)
        q_mid.append({"values": vals, "p": f(p), "expected": q7_exact(vals, p)})
put("quantile.interpolation", "type 7 in exact rational arithmetic (fractions.Fraction) at rational p", q_mid)

q_one = [{"values": [v], "p": p, "expected": v} for v in [-3.5, 0.0, 7.25] for p in [0.0, 0.3, 0.5, 1.0]]
q_two = [{"values": [a, b], "p": p, "expected": q7_exact([a, b], p)} for a, b in [(1.0, 2.0), (5.0, -5.0), (0.0, 0.0)] for p in [0.0, 0.25, 0.5, 1.0]]
put("quantile.small-samples", "n = 1 returns the value, n = 2 interpolates linearly (exact rationals)", q_one + q_two)

q_ties = []
for vals in [[2, 2, 2, 2], [1, 1, 2, 2, 3, 3], [0, 0, 0, 1, 1, 1, 1], [-1, -1, 5], [4, 4, 4, 9, 9]]:
    for p in [0.0, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0]:
        q_ties.append({"values": [float(v) for v in vals], "p": p, "expected": q7(vals, p)})
put("quantile.ties", "numpy.quantile(method='linear') on samples with repeated values", q_ties)

q_unsorted = []
for _ in range(12):
    n = int(g.randint(3, 25))
    vals = rand_values(n)
    for p in [0.05, 0.37, 0.5, 0.9]:
        q_unsorted.append({"values": vals, "p": p, "expected": q7(vals, p)})
put("quantile.unsorted", "numpy.quantile(method='linear') on samples in random order", q_unsorted)

unrel = []
for vals in [[3.0], [1.0, 1.0, 1.0], [0.0, 1.0], [0.1, 0.9], [0, 1, 0, 1, 1, 0, 1, 1, 1, 0]] + [rand_values(int(g.randint(5, 40))) for _ in range(8)]:
    v = np.array(vals, dtype=float)
    unrel.append({"samples": [f(x) for x in vals], "expected": f(np.quantile(v, 0.9) - np.quantile(v, 0.1))})
put("unreliability.p90-p10", "numpy.quantile(0.9) - numpy.quantile(0.1)", unrel)
put(
    "unreliability.constant",
    "a constant sample has no spread: 0",
    [{"samples": [c] * n, "expected": 0.0} for c in [0.0, 1.0, -2.5, 1e9] for n in [1, 2, 7]],
)
put(
    "unreliability.pass-flags",
    "numpy.quantile on 0/1 flags: the share of fails between the deciles",
    [
        {"samples": [1.0] * a + [0.0] * (n - a), "expected": f(np.quantile(np.array([1.0] * a + [0.0] * (n - a)), 0.9) - np.quantile(np.array([1.0] * a + [0.0] * (n - a)), 0.1))}
        for n in [5, 10, 20] for a in range(0, n + 1, max(1, n // 5))
    ],
)

# --- sampleVariance ---------------------------------------------------------------------------------------


def var_exact(values):
    fr = [Fraction(v) for v in values]
    m = sum(fr) / len(fr)
    return f(sum((x - m) ** 2 for x in fr) / (len(fr) - 1))


put("sampleVariance.integers", "exact rational arithmetic, n - 1 denominator", [{"values": v, "expected": var_exact(v)} for v in [[1, 2, 3, 4], [2, 4, 4, 4, 5, 5, 7, 9], [0, 1], [10, 20, 30], [5, 5, 6]]])
put("sampleVariance.two-values", "(a - b)^2 / 2, exact", [{"values": [a, b], "expected": f((Fraction(a) - Fraction(b)) ** 2 / 2)} for a, b in [(0.0, 1.0), (3.5, -1.25), (7.0, 7.0), (1e6, 1e6 + 2)]])
put("sampleVariance.offset", "exact rational arithmetic on values with a large common offset", [{"values": [off + d for d in [0.0, 1.0, 3.0, 4.0, 8.0]], "expected": var_exact([off + d for d in [0.0, 1.0, 3.0, 4.0, 8.0]])} for off in [1e6, 1e9, 1e12, -1e9]])
put("sampleVariance.tiny-spread", "exact rational arithmetic on values that differ in the 12th digit", [{"values": [1.0 + k * 1e-12 for k in range(6)], "expected": var_exact([1.0 + k * 1e-12 for k in range(6)])}, {"values": [100.0 + k * 1e-10 for k in range(4)], "expected": var_exact([100.0 + k * 1e-10 for k in range(4)])}])
put("sampleVariance.mixed-scale", "exact rational arithmetic on values of both signs and mixed magnitude", [{"values": v, "expected": var_exact(v)} for v in [[-1e6, 1e6, 0.5, -0.5], [1e-6, -1e-6, 3e-6], [123456.789, -98765.4321, 0.001, 42.0, -7.5]]])
put("sampleVariance.constant", "a constant sample has variance exactly 0", [{"values": [c] * n, "expected": 0.0} for c in [0.1, 1e9, -3.3, 1e300] for n in [2, 5]])

# --- designEffect, effectiveSampleSize --------------------------------------------------------------------
de_none = [(1, r) for r in [0.0, 0.3, 0.99, -0.5]] + [(m, 0.0) for m in [2, 5, 40, 2.5]]
put("designEffect.no-clustering", "m = 1 or rho = 0 gives 1, in exact rationals", [{"m": m, "rho": r, "expected": f(1 + (Fraction(m) - 1) * Fraction(r))} for m, r in de_none])
put("designEffect.full-correlation", "rho = 1 gives m", [{"m": m, "rho": 1.0, "expected": f(m)} for m in [1, 2, 7, 33.5]])
put("designEffect.negative-rho", "1 + (m - 1) rho with -1 / (m - 1) < rho < 0, in exact rationals", [{"m": m, "rho": r, "expected": f(1 + (Fraction(m) - 1) * Fraction(r))} for m, r in [(2, -0.5), (3, -0.25), (5, -0.1), (11, -0.05), (101, -0.005)]])
put("designEffect.fractional-m", "1 + (m - 1) rho with a non-integer m, in exact rationals", [{"m": m, "rho": r, "expected": f(1 + (Fraction(m) - 1) * Fraction(r))} for m, r in [(2.5, 0.2), (7.25, 0.4), (1.5, 0.9), (12.75, 0.05)]])
put("effectiveSampleSize.no-clustering", "n unchanged when m = 1 or rho = 0", [{"n": n, "m": m, "rho": r, "expected": f(n)} for n, m, r in [(100, 1, 0.5), (60, 5, 0.0), (1, 1, 0.0), (1e6, 40, 0.0)]])
put("effectiveSampleSize.full-correlation", "n / m when rho = 1", [{"n": n, "m": m, "rho": 1.0, "expected": f(Fraction(n) / Fraction(m))} for n, m in [(100, 5), (60, 3), (7, 7), (1000, 2.5)]])
put("effectiveSampleSize.negative-rho", "n / (1 + (m - 1) rho), above n for a negative rho, in exact rationals", [{"n": n, "m": m, "rho": r, "expected": f(Fraction(n) / (1 + (Fraction(m) - 1) * Fraction(r)))} for n, m, r in [(100, 2, -0.5), (60, 3, -0.25), (90, 10, -0.05)]])
put("effectiveSampleSize.fractional", "n / (1 + (m - 1) rho) with a non-integer n or m, in exact rationals", [{"n": n, "m": m, "rho": r, "expected": f(Fraction(n) / (1 + (Fraction(m) - 1) * Fraction(r)))} for n, m, r in [(100.5, 2.5, 0.2), (33.3, 4, 0.1), (250, 7.5, 0.6)]])

# --- goodTuring, hillNumber(s) ----------------------------------------------------------------------------


def gt_ref(c):
    n = sum(c)
    f1 = sum(1 for x in c if x == 1)
    f2 = sum(1 for x in c if x == 2)
    return {"n": n, "observed": sum(1 for x in c if x > 0), "f1": f1, "f2": f2, "discoveryProbability": f1 / n, "coverage": 1 - f1 / n}


put("goodTuring.all-singletons", "f1 = n: coverage 0, discovery 1", [{"counts": [1] * k, "expected": gt_ref([1] * k)} for k in [1, 2, 5, 30]])
put("goodTuring.no-singletons", "f1 = 0: coverage 1, discovery 0", [{"counts": c, "expected": gt_ref(c)} for c in [[2, 2, 2], [5, 3, 9], [2, 7], [4]]])
put("goodTuring.mixed", "f1 / n in exact rationals", [{"counts": c, "expected": gt_ref(c)} for c in [[5, 3, 2, 1, 1], [1, 2, 3, 4, 1, 1], [10, 1, 2, 2, 1], [1, 1, 100]]])
put("goodTuring.zero-counts", "classes with count 0 are not observed", [{"counts": c, "expected": gt_ref(c)} for c in [[0, 3, 1, 0, 1], [0, 0, 5], [2, 0, 0, 2, 1]]])
put("goodTuring.fields", "n, observed, f1 and f2 by direct counting", [{"counts": c, "expected": gt_ref(c)} for c in [[1, 1, 2, 2, 2, 3, 0], [7, 7, 7], [1, 2, 2, 2, 1]]])


def hill_exact(c, q):
    tot = sum(c)
    ps = [Fraction(x, tot) for x in c if x > 0]
    if q == 0:
        return f(len(ps))
    if q == 1:
        return f(math.exp(-sum(float(p) * math.log(float(p)) for p in ps)))
    return f(float(sum(p ** Fraction(q) if float(q).is_integer() else Fraction(float(p) ** q) for p in ps)) ** (1 / (1 - q)))


put(
    "hillNumber.uniform",
    "k equally common classes have Hill number k at every order",
    [{"counts": [c] * k, "q": q, "expected": f(k)} for k in [1, 2, 5, 12] for c in [1, 7] for q in [0, 0.5, 1, 2, 5]],
)
put("hillNumber.single-class", "one class has Hill number 1 at every order", [{"counts": [c], "q": q, "expected": 1.0} for c in [1, 9, 1000] for q in [0, 0.5, 1, 2, 9]])
put(
    "hillNumber.richness-ignores-zeros",
    "order 0 counts the classes with a positive count",
    [{"counts": c, "q": 0, "expected": f(sum(1 for x in c if x > 0))} for c in [[0, 3, 0, 1], [0, 0, 5], [1, 1, 1, 0], [2, 0, 0, 0, 9]]],
)
put(
    "hillNumber.simpson",
    "order 2 is 1 / sum p^2, in exact rational arithmetic",
    [{"counts": c, "q": 2, "expected": f(1 / sum(Fraction(x, sum(c)) ** 2 for x in c if x > 0))} for c in [[5, 3, 2, 1, 1], [10, 1], [1, 1, 1, 1], [100, 50, 25, 12, 6, 3, 1], [7, 0, 3]]],
)
put(
    "hillNumber.shannon",
    "order 1 is exp(-sum p ln p), by math.log and math.exp",
    [{"counts": c, "q": 1, "expected": hill_exact(c, 1)} for c in [[5, 3, 2, 1, 1], [10, 1], [3, 3, 3], [100, 50, 25, 12, 6, 3, 1], [8, 0, 2]]],
)
put(
    "hillNumber.scale-free",
    "the Hill number depends on proportions only: counts times a constant give the same value",
    [{"counts": [x * s for x in c], "q": q, "expected": hill_exact(c, q) if q in (0, 1) else f(1 / sum(Fraction(x, sum(c)) ** 2 for x in c if x > 0))} for c in [[5, 3, 2, 1, 1], [10, 1, 1]] for s in [1, 10, 1000] for q in [0, 1, 2]],
)
put(
    "hillNumbers.orders",
    "the three orders 0, 1 and 2 by direct computation",
    [{"counts": c, "expected": {"q0": hill_exact(c, 0), "q1": hill_exact(c, 1), "q2": f(1 / sum(Fraction(x, sum(c)) ** 2 for x in c if x > 0))}} for c in [[5, 3, 2, 1, 1], [10, 1], [4, 4, 4, 4], [1], [9, 0, 1, 0, 1]]],
)
put(
    "hillNumbers.ordered",
    "q0 >= q1 >= q2 >= 1 for every sample (Hill numbers fall as the order rises)",
    [{"counts": c, "expected": {"q0": hill_exact(c, 0), "q1": hill_exact(c, 1), "q2": f(1 / sum(Fraction(x, sum(c)) ** 2 for x in c if x > 0))}} for c in [[50, 20, 10, 5, 2, 1, 1, 1], [3, 3, 2], [1000, 1, 1, 1]]],
)

# --- icc --------------------------------------------------------------------------------------------------


def icc_case(variances, names):
    total = sum(variances)
    comps = [{"level": nm, "variance": v, "share": (v / total if total > 0 else 0.0)} for nm, v in zip(names, variances)]
    cum = 0.0
    exp = []
    for comp in comps[:-1]:
        cum += comp["variance"]
        exp.append({"level": comp["level"], "icc": (cum / total if total > 0 else 0.0), "share": comp["share"]})
    return {"components": comps, "total": total, "expected": exp}


names4 = ["cell", "conversation", "wording", "repeat"]
put("icc.one-level", "variance at the single named level over the total", [icc_case(v, ["cell", "repeat"]) for v in [[2.0, 3.0], [0.0, 1.0], [5.0, 0.0], [1.0, 1.0]]])
put("icc.two-levels", "cumulative variance over the total, two named levels", [icc_case(v, ["cell", "conversation", "repeat"]) for v in [[2.0, 1.0, 1.0], [0.0, 3.0, 1.0], [1.5, 0.0, 0.5], [1.0, 1.0, 1.0]]])
put("icc.three-levels", "cumulative variance over the total, three named levels", [icc_case(v, names4) for v in [[4.0, 1.0, 0.25, 0.5], [0.0, 2.0, 2.0, 1.0], [1.0, 1.0, 1.0, 1.0], [0.1, 0.2, 0.3, 0.4], [8.0, 0.0, 0.0, 2.0]]])
put("icc.zero-total", "no variance anywhere: every correlation 0, no division by zero", [icc_case([0.0, 0.0, 0.0, 0.0], names4), icc_case([0.0, 0.0], ["cell", "repeat"])])
put("icc.last-level-reaches-share", "the correlation of the last named level is one minus the residual share", [icc_case(v, names4) for v in [[1.0, 2.0, 3.0, 4.0], [0.5, 0.5, 0.5, 8.5]]])

# --- neymanAllocation -------------------------------------------------------------------------------------


def ney_value(w, alloc):
    return sum(w[i] ** 2 / alloc[i] for i in range(len(w)) if alloc[i] > 0)


def ney_best(sizes, sds, total):
    w = [Fraction(s) * Fraction(d) for s, d in zip(sizes, sds)]
    H = len(w)
    best = [None]

    def rec(i, left, cur):
        if i == H - 1:
            alloc = cur + [left]
            if any(w[j] > 0 and alloc[j] == 0 for j in range(H)):
                return
            val = ney_value(w, alloc)
            if best[0] is None or val < best[0]:
                best[0] = val
            return
        for a in range(0, left + 1):
            rec(i + 1, left - a, cur + [a])

    rec(0, total, [])
    return f(best[0])


ny_opt = []
for _ in range(16):
    H = int(g.randint(2, 5))
    total = int(g.randint(H, 20))
    sizes = [int(g.randint(1, 400)) for _ in range(H)]
    sds = [round(float(g.uniform(0.05, 3.0)), 3) for _ in range(H)]
    ny_opt.append({"sizes": sizes, "sds": sds, "total": total, "expected": {"objective": ney_best(sizes, sds, total)}})
put("neymanAllocation.integer-optimum", "brute force over every integer allocation of the total (exact rational objective)", ny_opt)
put(
    "neymanAllocation.sums-to-total",
    "the allocation is a whole number per stratum and sums to the total",
    [{"sizes": s, "sds": d, "total": t, "expected": {"sum": t, "wholeNumbers": True}} for s, d, t in [([10, 20, 30], [1.0, 2.0, 3.0], 17), ([100, 100], [0.3, 0.3], 9), ([5, 500, 50], [2.0, 0.1, 1.0], 40), ([1, 1, 1, 1], [1, 1, 1, 1], 7), ([40, 60], [0.0, 1.5], 11), ([3, 4, 5], [0.0, 0.0, 0.0], 12)]],
)
put(
    "neymanAllocation.zero-spread",
    "when every spread is 0 the allocation is proportional to the sizes",
    [{"sizes": s, "sds": [0.0] * len(s), "total": t, "expected": {"exact": [f(Fraction(t) * Fraction(x) / sum(Fraction(y) for y in s)) for x in s]}} for s, t in [([10, 30], 8), ([1, 1, 1], 9), ([5, 15, 80], 20)]],
)
put(
    "neymanAllocation.every-stratum-sampled",
    "a stratum with spread gets at least one unit when the total allows it, since its variance is infinite otherwise",
    [{"sizes": s, "sds": d, "total": t, "expected": {"minimum": 1}} for s, d, t in [([1000, 1, 1], [1.0, 0.1, 0.1], 6), ([500, 5, 5, 5], [2.0, 0.01, 0.01, 0.01], 8), ([10, 10], [5.0, 0.001], 3)]],
)

# --- pageHinkley ------------------------------------------------------------------------------------------
rng7 = np.random.RandomState(11)
step_up = [f(x) for x in rng7.normal(0, 1, 30)] + [f(x) for x in rng7.normal(4, 1, 30)]
step_dn = [f(x) for x in rng7.normal(4, 1, 30)] + [f(x) for x in rng7.normal(0, 1, 30)]
calm = [f(x) for x in rng7.normal(0, 1, 40)]
two_steps = step_up + [f(x) for x in rng7.normal(8, 1, 30)]
ph_short = [1.0, 2.0, 1.5, 9.0, 9.5]


def ph_case(series, **opts):
    mi = opts.get("minInstances", 30)
    r = ph_ref(series, opts.get("delta", 0.005), opts.get("threshold", 50.0), mi)
    return {"series": series, "options": opts, "expected": r}


put("pageHinkley.before-minimum", "no alarm can fire before minInstances points; the statistics still accumulate", [ph_case(ph_short, threshold=1.0, minInstances=30), ph_case(calm[:10], threshold=0.5, minInstances=20)])
put("pageHinkley.alarm-up", "an increase of the mean raises the up statistic past the threshold", [ph_case(step_up, threshold=15.0, minInstances=10, delta=0.05), ph_case(step_up, threshold=8.0, minInstances=5, delta=0.1)])
put("pageHinkley.alarm-down", "a decrease of the mean raises the down statistic past the threshold", [ph_case(step_dn, threshold=15.0, minInstances=10, delta=0.05), ph_case(step_dn, threshold=8.0, minInstances=5, delta=0.1)])
put("pageHinkley.reset-after-alarm", "all state resets after an alarm, so a second change fires a second alarm", [ph_case(two_steps, threshold=15.0, minInstances=10, delta=0.05), ph_case(two_steps, threshold=10.0, minInstances=8, delta=0.2)])
put("pageHinkley.delta-tolerance", "a larger delta tolerates a larger drift before the statistic grows", [ph_case(step_up, threshold=15.0, minInstances=10, delta=d) for d in [0.0, 0.5, 1.5, 3.0]])
early_jump = [0.0, 0.0, 0.0] + [10.0] * 30
put(
    "pageHinkley.min-instances-boundary",
    "the statistic crosses the threshold early, but no alarm fires before minInstances points: the alarm sits on point minInstances exactly",
    [ph_case(early_jump, threshold=5.0, minInstances=12, delta=0.005), ph_case(early_jump, threshold=5.0, minInstances=20, delta=0.005), ph_case(early_jump, threshold=5.0, minInstances=1, delta=0.005)],
)
put("pageHinkley.quiet-series", "a series without change stays under the threshold: no alarm", [ph_case(calm, threshold=50.0, minInstances=10, delta=0.5), ph_case([2.0] * 50, threshold=5.0, minInstances=10, delta=0.005)])

# --- pairedRateDifference ---------------------------------------------------------------------------------


def prd(a, b, c, d, alpha=0.05):
    return {"table": {"bothPass": a, "regressed": b, "improved": c, "bothFail": d}, "alpha": alpha, "expected": newcombe(a, b, c, d, alpha)}


put("pairedRateDifference.positive-covariance", "bothPass * bothFail > regressed * improved: phi corrected by n / 2, floored at 0", [prd(*t) for t in [(40, 2, 8, 50), (20, 5, 5, 20), (30, 1, 1, 8), (100, 10, 12, 60), (6, 1, 2, 3)]])
put("pairedRateDifference.negative-covariance", "bothPass * bothFail < regressed * improved: phi not corrected", [prd(*t) for t in [(2, 20, 15, 3), (5, 12, 9, 1), (0, 10, 10, 0), (1, 30, 25, 2)]])
put("pairedRateDifference.zero-margin", "a zero margin makes phi 0 (the denominator would vanish)", [prd(*t) for t in [(0, 0, 5, 5), (10, 0, 0, 0), (0, 4, 0, 6), (7, 3, 0, 0), (0, 0, 0, 9)]])
put("pairedRateDifference.extreme-tables", "every pair regressed or every pair improved: the interval sits against the end of [-1, 1] (the Wilson limits there are exact)", [prd(*t) for t in [(0, 20, 0, 0), (0, 0, 20, 0), (0, 1, 0, 0), (0, 0, 1, 0), (1, 19, 0, 0)]])
put("pairedRateDifference.levels", "alpha 0.2, 0.1, 0.01 and 0.001", [prd(40, 2, 8, 50, a) for a in [0.2, 0.1, 0.01, 0.001]])
put("pairedRateDifference.sign", "the estimate is the baseline rate minus the candidate rate: positive when the candidate regressed", [prd(*t) for t in [(10, 8, 1, 3), (10, 1, 8, 3), (5, 5, 5, 5)]])
put(
    "pairedRateDifference.swap-mirrors",
    "swapping regressed and improved negates the estimate and mirrors the interval",
    [{"table": {"bothPass": a, "regressed": b, "improved": c, "bothFail": d}, "swapped": {"bothPass": a, "regressed": c, "improved": b, "bothFail": d}, "expected": {"estimate": newcombe(a, b, c, d)["estimate"], "lower": newcombe(a, b, c, d)["lower"], "upper": newcombe(a, b, c, d)["upper"]}} for a, b, c, d in [(40, 2, 8, 50), (10, 8, 1, 3), (30, 0, 6, 20)]],
)

# --- nonInferiority ---------------------------------------------------------------------------------------


def ni_case(base, cand, margin, flags=None, pairs=None, alpha=0.05):
    a = sum(1 for x, y in zip(base, cand) if x and y)
    b = sum(1 for x, y in zip(base, cand) if x and not y)
    c = sum(1 for x, y in zip(base, cand) if not x and y)
    d = sum(1 for x, y in zip(base, cand) if not x and not y)
    eff = newcombe(a, b, c, d, alpha)
    names = pairs or [str(i) for i in range(len(base))]
    new_flags = []
    if flags:
        new_flags = [names[i] for i, fired in enumerate(flags["candidate"]) if fired and not flags["baseline"][i]]
    within = eff["upper"] < margin
    inp = {"baseline": base, "candidate": cand, "margin": margin, "alpha": alpha}
    if flags:
        inp["gatingFlags"] = flags
    if pairs:
        inp["pairs"] = pairs
    regressed_names = [names[i] for i in range(len(base)) if base[i] and not cand[i]]
    return {**inp, "expected": {"nonInferior": within and not new_flags, "effect": eff, "regressed": b, "improved": c, "regressedPairs": regressed_names, "newFlags": new_flags}}


big_same = [True] * 60 + [False] * 15
put("nonInferiority.clear-parity", "identical results over many pairs: non-inferior at a 10 point margin", [ni_case(big_same, list(big_same), 0.1), ni_case([True] * 100, [True] * 100, 0.05)])
put("nonInferiority.clear-regression", "a large drop is not within the margin", [ni_case([True] * 40 + [False] * 10, [True] * 20 + [False] * 30, 0.1), ni_case([True] * 30, [False] * 30, 0.2)])

# the margin placed just under and just over the upper bound of the effect interval
bnd_base = [True] * 40 + [False] * 10
bnd_cand = [True] * 36 + [False] * 4 + [True] * 2 + [False] * 8
eff_b = newcombe(
    sum(1 for x, y in zip(bnd_base, bnd_cand) if x and y),
    sum(1 for x, y in zip(bnd_base, bnd_cand) if x and not y),
    sum(1 for x, y in zip(bnd_base, bnd_cand) if not x and y),
    sum(1 for x, y in zip(bnd_base, bnd_cand) if not x and not y),
)
put(
    "nonInferiority.margin-boundary",
    "the verdict flips when the margin crosses the upper bound of the effect interval (strict inequality)",
    [ni_case(bnd_base, bnd_cand, round(eff_b["upper"] + 0.002, 4)), ni_case(bnd_base, bnd_cand, round(eff_b["upper"] - 0.002, 4))],
)
fl_base = [True] * 50
fl_cand = list(fl_base)
put(
    "nonInferiority.gating-flag",
    "a gating flag firing for the candidate and not the baseline blocks parity even when the rates agree",
    [
        ni_case(fl_base, fl_cand, 0.2, flags={"baseline": [False] * 50, "candidate": [False] * 7 + [True] + [False] * 42}),
        ni_case(fl_base, fl_cand, 0.2, flags={"baseline": [False] * 7 + [True] + [False] * 42, "candidate": [False] * 7 + [True] + [False] * 42}),
        ni_case(fl_base, fl_cand, 0.2, flags={"baseline": [True] * 50, "candidate": [False] * 50}),
    ],
)
put(
    "nonInferiority.named-pairs",
    "the regressed and the newly flagged pairs are listed by name",
    [
        ni_case([True, True, False, True, False, True], [True, False, False, True, True, False], 0.9, flags={"baseline": [False] * 6, "candidate": [False, False, True, False, False, True]}, pairs=["a", "b", "c", "d", "e", "f"]),
        ni_case([True, False, True], [False, True, True], 0.9, pairs=["x", "y", "z"]),
    ],
)

# --- repeatsForFloor --------------------------------------------------------------------------------------


def rff(variance, floor, z=None, blocks=1, difference=True, flip=None):
    zz = Z95 if z is None else z
    fct = 2 if difference else 1
    var = flip * (1 - flip) if flip is not None else variance
    exact = Fraction(fct) * Fraction(zz) ** 2 * Fraction(var) / (Fraction(blocks) * Fraction(floor) ** 2)
    reps = max(1, int(math.ceil(exact - Fraction(1, 10**9))))
    inp = {"floor": floor, "blocks": blocks, "difference": difference}
    if flip is not None:
        inp["flipRate"] = flip
    else:
        inp["variance"] = variance
    if z is not None:
        inp["z"] = z
    return {**inp, "expected": {"repeats": reps, "floor": zz * math.sqrt(fct * var / (reps * blocks))}}


put("repeatsForFloor.difference", "a floor on a difference of two versions doubles the variance", [rff(v, fl, difference=True) for v, fl in [(0.25, 0.05), (0.09, 0.02), (0.21, 0.1)]])
put("repeatsForFloor.single-version", "a floor on one version does not double it", [rff(v, fl, difference=False) for v, fl in [(0.25, 0.05), (0.09, 0.02), (0.21, 0.1)]])
put("repeatsForFloor.blocks", "averaging more blocks lowers the repeats in proportion", [rff(0.25, 0.05, blocks=b) for b in [1, 2, 5, 20, 100]])
put("repeatsForFloor.custom-z", "the z of the floor is a parameter", [rff(0.25, 0.05, z=zz) for zz in [1.0, 1.645, 2.576, 3.0]])
put("repeatsForFloor.flip-rate", "a flip rate p gives the variance p (1 - p)", [rff(0, 0.05, flip=p) for p in [0.1, 0.25, 0.5, 0.9]])
put("repeatsForFloor.zero-variance", "no variance needs one repeat", [rff(0.0, 0.05), rff(0.0, 0.5, difference=False)])
put("repeatsForFloor.integer-ratio", "when the ratio is exactly an integer it is not rounded up", [rff(0.25, 0.25, z=2.0, difference=False), rff(0.5, 0.125, z=2.0, difference=False), rff(0.125, 0.0625, z=1.0, blocks=2, difference=False)])
put("repeatsForFloor.floor-reached", "the floor reported is the half-width that many repeats give", [rff(v, fl, blocks=b) for v, fl, b in [(0.25, 0.04, 1), (0.16, 0.03, 3), (0.1, 0.01, 10)]])

# --- binomialCdf ------------------------------------------------------------------------------------------
from math import comb  # noqa: E402


def binom_cdf_exact(k, n, p):
    q = 1 - p
    return f(sum(Fraction(comb(n, i)) * p**i * q ** (n - i) for i in range(0, k + 1)))


dy = [Fraction(1, 2), Fraction(1, 4), Fraction(3, 4), Fraction(1, 8), Fraction(15, 16), Fraction(1, 1024)]
bc_small = []
for n in [1, 2, 3, 5, 10, 20, 40]:
    for p in dy:
        for k in sorted({0, n // 2, max(0, n - 1), n // 3}):
            bc_small.append({"k": k, "n": n, "p": f(p), "expected": binom_cdf_exact(k, n, p)})
put("binomialCdf.exact-small", "exact rational arithmetic (fractions.Fraction) with dyadic p, so the float p is the exact p", bc_small)

bc_edges = [
    {"k": -1, "n": 5, "p": 0.3, "expected": 0.0},
    {"k": -3, "n": 5, "p": 0.3, "expected": 0.0},
    {"k": 5, "n": 5, "p": 0.3, "expected": 1.0},
    {"k": 9, "n": 5, "p": 0.3, "expected": 1.0},
    {"k": 0, "n": 5, "p": 0.0, "expected": 1.0},
    {"k": 3, "n": 5, "p": 0.0, "expected": 1.0},
    {"k": 4, "n": 5, "p": 1.0, "expected": 0.0},
    {"k": 0, "n": 5, "p": 1.0, "expected": 0.0},
    {"k": 5, "n": 5, "p": 1.0, "expected": 1.0},
    {"k": 0, "n": 0, "p": 0.5, "expected": 1.0},
    {"k": 0, "n": 1, "p": 0.0, "expected": 1.0},
    {"k": 0, "n": 1, "p": 1.0, "expected": 0.0},
]
put("binomialCdf.edges", "k below 0 is 0, k at or above n is 1, p = 0 and p = 1 are point masses", bc_edges)

bc_upper = []
for n, p in [(60, Fraction(1, 2)), (60, Fraction(3, 4)), (40, Fraction(15, 16)), (30, Fraction(1, 8))]:
    for k in [n - 1, n - 2, n - 5, n - 10]:
        bc_upper.append({"k": k, "n": n, "p": f(p), "expected": binom_cdf_exact(k, n, p)})
put("binomialCdf.upper-tail", "exact rational arithmetic near k = n, where the cdf is close to 1", bc_upper)

bc_lower = []
for n, p in [(200, Fraction(1, 2)), (150, Fraction(1, 2)), (120, Fraction(1, 4)), (300, Fraction(1, 1024) * 512)]:
    for k in [0, 1, 2, 5]:
        bc_lower.append({"k": k, "n": n, "p": f(p), "expected": binom_cdf_exact(k, n, p)})
put("binomialCdf.lower-tail-tiny", "exact rational arithmetic for probabilities down to about 1e-57: relative accuracy in the far tail", bc_lower)

bc_mid = []
for n in [200, 500, 1000, 2000]:
    for p in [0.1, 0.5, 0.77]:
        mu = n * p
        sd = math.sqrt(n * p * (1 - p))
        for z in [-3, -1, 0, 1, 3]:
            k = int(min(max(round(mu + z * sd), 0), n))
            bc_mid.append({"k": k, "n": n, "p": p, "expected": f(stats.binom.cdf(k, n, p))})
put("binomialCdf.moderate-n", "scipy.stats.binom.cdf for n from 200 to 2000", bc_mid)

# --- zeroFailureBound -------------------------------------------------------------------------------------
from decimal import ROUND_CEILING, Decimal, getcontext  # noqa: E402

getcontext().prec = 80


def zfb(p, alpha):
    """The smallest n with (1 - p)^n <= alpha for p and alpha as written in decimal (repr), by 80-digit decimals,
    then confirmed in exact rational arithmetic whenever n is small enough to raise a fraction to the n-th power."""
    big_p, big_a = Decimal(repr(p)), Decimal(repr(alpha))
    n = int((big_a.ln() / (1 - big_p).ln()).to_integral_value(rounding=ROUND_CEILING))
    if n <= 5000:
        q = 1 - Fraction(repr(p))
        a = Fraction(repr(alpha))
        k = max(1, n - 2)
        while q**k > a:
            k += 1
        while k > 1 and q ** (k - 1) <= a:
            k -= 1
        n = k
    return n


put("zeroFailureBound.table", "ceil(ln alpha / ln(1 - p)) in 80-digit decimal arithmetic on the exact doubles", [{"p": p, "alpha": a, "expected": zfb(p, a)} for p, a in [(0.05, 0.05), (0.01, 0.05), (0.1, 0.05), (0.5, 0.05), (0.2, 0.01), (0.001, 0.05), (0.3, 1e-6), (0.9, 0.05), (0.05, 0.2), (0.02, 0.5)]])
put(
    "zeroFailureBound.exact-integers",
    "p and alpha such that (1 - p)^n = alpha exactly for a whole n, as written in decimal (0.9 and 0.001 give 3) or in binary: the answer is n, not n + 1",
    [{"p": p, "alpha": a, "expected": zfb(p, a)} for p, a in [(0.9, 0.001), (0.9, 1e-5), (0.99, 1e-4), (0.99, 1e-6), (0.95, 0.05), (0.8, 0.04), (0.999, 1e-9), (0.5, 0.125), (0.5, 2.0**-10), (0.75, 4.0**-3), (0.875, 8.0**-2), (0.7, 0.09), (0.6, 0.064)]],
)
put("zeroFailureBound.tiny-p", "p below 1e-6: ln(1 - p) must be computed without losing digits (80-digit decimals)", [{"p": p, "alpha": 0.05, "expected": zfb(p, 0.05)} for p in [1e-7, 1e-9, 1e-11, 1e-13, 3.3e-10]])
put("zeroFailureBound.high-confidence", "alpha from 1e-3 down to 1e-12", [{"p": 0.05, "alpha": a, "expected": zfb(0.05, a)} for a in [1e-3, 1e-4, 1e-6, 1e-9, 1e-12]])
put("zeroFailureBound.large-p", "p close to 1: one or two units", [{"p": p, "alpha": 0.05, "expected": zfb(p, 0.05)} for p in [0.95, 0.99, 0.999, 0.9999999]])

# --- reduceRepeats, one group per reducer -----------------------------------------------------------------
from exact_ref import reduce_ref  # noqa: E402


def rr_cases(spellings, vals_list):
    out_ = []
    for vals in vals_list:
        for spelling in spellings:
            kind = spelling.split(":")[0]
            k = int(spelling.split(":")[1]) if ":" in spelling else None
            out_.append({"values": vals, "reducer": spelling, "expected": reduce_ref(vals, kind, k)})
    return out_


put(
    "reduceRepeats.mode",
    "mode: the most common scored value when more than half of the repeats are scored; a tie goes to the value seen first (the documented rule, restated)",
    rr_cases(["mode"], [[1, 1, 0], [1, 0, 0], [1, 0], [0, 1], [1, 0, 1, 0], [0, 1, 0, 1], [1, 1, None], [1, None, None], [0, 0, None, None, 1], [None, None], [], [1], [0], [0, 0, 1, 1, 1], [1, 1, 0, 0, None, None, None]]),
)
put("reduceRepeats.median", "median: above one half passes, below fails, exactly one half is undecided", rr_cases(["median"], [[1, 1, 0], [1, 0, 0], [1, 0], [0, 1], [1, 0, 1, 0], [1, None, 0, None], [1, None], [None], [], [1, 1, 1, 0], [0, 0, 0, 1]]))
put("reduceRepeats.at-least", "at_least k: passes at k passes, fails when the passes plus the unscored cannot reach k, else undecided", rr_cases(["at_least:1", "at_least:2", "at_least:3", "at_least:5"], [[1, 1, 0], [1, 0, 0], [1, None, None], [0, None, None, None], [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [1, 1, None, None, 0], [None, None, None], []]))
put("reduceRepeats.unscored-left-out", "an unscored repeat is left out of every reducer: the same verdicts with and without it where the rule allows", rr_cases(["mode", "median", "at_least:2"], [[1, 1, 1, None], [0, 0, 0, None], [1, 0, 1, None, None], [1, 1, 0, None]]))

# --- abundances and mulberry32 ----------------------------------------------------------------------------
from collections import Counter  # noqa: E402

lab_cases = [
    ["a", "b", "a", "c", "a", "b"],
    ["b", "a", "b"],
    [3, 1, 3, 2, 1, 3, 3],
    [1, "1", 1, "1", 1],
    [],
    ["only"],
    ["x"] * 50 + ["y"] * 3,
    [str(i % 7) for i in range(100)],
]
put("abundances.first-seen-order", "collections.Counter keeps first-seen order", [{"labels": lab, "expected": list(Counter(lab).values())} for lab in lab_cases])
put("abundances.number-and-string-differ", "the number 1 and the string '1' are two labels", [{"labels": lab, "expected": list(Counter(lab).values())} for lab in [[1, "1"], [1, "1", 1], ["1", 1, "1", 1, 1]]])
put("abundances.counts-sum", "the counts sum to the number of labels and there is one per distinct label", [{"labels": lab, "expected": list(Counter(lab).values())} for lab in [[i % 13 for i in range(500)], [f"l{i % 5}" for i in range(77)]]])

from exact_ref import mulberry32  # noqa: E402

put("mulberry32.seed-wrap", "the seed is taken modulo 2^32 (JavaScript ToUint32): negative seeds and seeds above 2^32 wrap", [{"seed": sd, "expected": (lambda gg: [gg() for _ in range(6)])(mulberry32(sd))} for sd in [-1, -2, -2147483648, 4294967296, 4294967296 + 7, 2**40 + 123, 2**53]])
long_stream = []
for sd in [1, 2026, 4294967295]:
    gg = mulberry32(sd)
    draws = [gg() for _ in range(2000)]
    long_stream.append({"seed": sd, "n": 2000, "expected": {"sum": f(sum(draws)), "min": min(draws), "max": max(draws), "last": draws[-1], "first": draws[0]}})
put("mulberry32.long-stream", "2000 draws of the integer port: sum, extremes and the last draw (a drifting state shows late)", long_stream)

# --- simulateCoverage: analytic expectation of the naive Wilson coverage for one tree ----------------------
# One tree of n blocks, its pass rate drawn Beta(d theta, d (1 - theta)): k is beta-binomial (scipy.stats.betabinom),
# or binomial when d is huge. The naive Wilson interval covers theta for exactly the k whose interval holds it, so
# the coverage the sampler should reproduce is a finite sum. This checks the gamma, beta and binomial draws of the
# sampler against an analytic truth, not against a port of itself.
sim_ctl = []
for n, theta, d in [(20, 0.3, 1e9), (40, 0.6, 3.0), (15, 0.85, 0.7)]:
    cov = 0.0
    for k in range(n + 1):
        pk = f(stats.binom.pmf(k, n, theta)) if d >= 1e8 else f(stats.betabinom.pmf(k, n, d * theta, d * (1 - theta)))
        p = k / n
        z2 = Z95 * Z95
        den = 1 + z2 / n
        centre = (p + z2 / (2 * n)) / den
        half = Z95 * math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / den
        if max(0.0, centre - half) <= theta <= min(1.0, centre + half):
            cov += pk
    sim_ctl.append({"cell": {"trees": 1, "sizes": n, "theta": theta, "d": d}, "reps": 4000, "seed": 3, "expected": {"coverage": {"naive wilson": cov}}})
put("simulateCoverage.analytic-control", "one tree of n blocks: the naive Wilson coverage is a finite sum over the binomial or beta-binomial distribution (scipy.stats)", sim_ctl)

# --- varianceComponents: Henderson method I, written here from the documented formulas --------------------


def vc_unbalanced(obs, L):
    """Nested random-effects variance components by method I (documented in variance.ts): sums of squares from group means,
    expected mean squares from the group sizes, solved from the innermost level out."""
    N = len(obs)
    ys = np.array([float(o["value"]) for o in obs])
    paths = [tuple(o["path"]) for o in obs]
    sizes = []
    sums = []
    for l in range(L + 1):
        sz, sm = {}, {}
        for p, y in zip(paths, ys):
            k = p[:l]
            sz[k] = sz.get(k, 0) + 1
            sm[k] = sm.get(k, 0.0) + y
        sizes.append(sz)
        sums.append(sm)
    G = [len(s) for s in sizes]
    between = [sum(sums[l][k] ** 2 / sizes[l][k] for k in sizes[l]) for l in range(L + 1)]
    sumsq = float((ys**2).sum())
    T = [[None] * (L + 1) for _ in range(L + 1)]
    for j in range(1, L + 1):
        for l in range(0, j + 1):
            acc = {}
            for k, nh in sizes[j].items():
                a = k[:l]
                acc[a] = acc.get(a, 0) + nh * nh
            T[l][j] = sum(sq / sizes[l][a] for a, sq in acc.items())
    df = [G[l] - G[l - 1] for l in range(1, L + 1)]
    ss = [between[l] - between[l - 1] for l in range(1, L + 1)]
    dfe = N - G[L]
    sse = sumsq - between[L]
    mse = sse / dfe if dfe > 0 else float("nan")
    sigma_e = mse if dfe > 0 else 0.0
    est = [0.0] * L
    estimable = [False] * L
    ms = [float("nan")] * L
    for l in range(L, 0, -1):
        d = df[l - 1]
        if d <= 0:
            continue
        ms[l - 1] = ss[l - 1] / d
        rest = ms[l - 1] - sigma_e
        for j in range(l + 1, L + 1):
            rest -= (T[l][j] - T[l - 1][j]) / d * est[j - 1]
        own = (T[l][l] - T[l - 1][l]) / d
        if own <= 0:
            continue
        est[l - 1] = rest / own
        estimable[l - 1] = True
    trunc = [max(0.0, e) for e in est]
    resid = max(0.0, sigma_e)
    total = sum(trunc) + resid
    names = ["cell", "conversation", "wording"][:L]
    comps = []
    for i in range(L):
        comps.append({"level": names[i], "groups": G[i + 1], "df": df[i], "estimate": est[i], "variance": trunc[i], "share": trunc[i] / total if total > 0 else 0.0, "estimable": estimable[i]})
    comps.append({"level": "repeat", "groups": N, "df": dfe, "estimate": sigma_e, "variance": resid, "share": resid / total if total > 0 else 0.0, "estimable": dfe > 0})
    return {"n": N, "total": total, "components": comps}


def make_obs(shape, seed, binary=False, sds=(1.5, 1.0, 0.5, 0.7)):
    """shape: list over cells of list over conversations of list over wordings of repeat counts (unbalanced)."""
    gg = np.random.RandomState(seed)
    obs = []
    for ci, cell in enumerate(shape):
        a = gg.normal(0, sds[0])
        for vi, conv in enumerate(cell):
            b = gg.normal(0, sds[1])
            for wi, reps in enumerate(conv):
                c = gg.normal(0, sds[2])
                for _ in range(reps):
                    y = 2.0 + a + b + c + gg.normal(0, sds[3])
                    v = (1.0 if y > 2.0 else 0.0) if binary else round(float(y), 6)
                    obs.append({"value": v if not binary else bool(v), "path": [f"c{ci}", f"v{vi}", f"w{wi}"]})
    return obs


unbal_shapes = [
    [[[2, 3], [1, 2, 2]], [[4]], [[1, 1], [3], [2, 2, 1]]],
    [[[1, 2], [3, 3]], [[2, 2, 2], [1]], [[5], [1, 1]], [[2], [2], [3]]],
    [[[3, 1, 2]], [[2], [4, 1]], [[1], [2], [3], [1]]],
]
put("varianceComponents.unbalanced", "Henderson's method I written here from the documented sums of squares and expected mean squares", [{"observations": make_obs(s, 40 + i), "levels": 3, "expected": vc_unbalanced(make_obs(s, 40 + i), 3)} for i, s in enumerate(unbal_shapes)])
put("varianceComponents.binary", "pass flags (true / false) are analysed as 1 / 0", [{"observations": make_obs(s, 70 + i, binary=True), "levels": 3, "expected": vc_unbalanced([{"value": 1.0 if o["value"] else 0.0, "path": o["path"]} for o in make_obs(s, 70 + i, binary=True)], 3)} for i, s in enumerate(unbal_shapes)])

# a dataset whose between-cell estimate is negative: groups differ less than chance
neg_obs = None
for sd in range(200, 400):
    gg = np.random.RandomState(sd)
    obs = []
    for ci in range(6):
        for vi in range(3):
            for wi in range(2):
                for _ in range(2):
                    obs.append({"value": round(float(gg.normal(0, 1.0)), 6), "path": [f"c{ci}", f"v{vi}", f"w{wi}"]})
    r = vc_unbalanced(obs, 3)
    if any(c["estimate"] < -0.01 for c in r["components"][:3]):
        neg_obs = (obs, r)
        break
assert neg_obs is not None
put("varianceComponents.negative-estimate", "a negative moment estimate is reported as solved and truncated at 0 for the variance and the shares", [{"observations": neg_obs[0], "levels": 3, "expected": neg_obs[1]}])

one_child = [{"value": v, "path": [f"c{i}", f"v{i}", f"w{i}"]} for i, v in enumerate([1.0, 2.0, 4.0, 3.0, 5.0, 2.5])]
# every cell holds one conversation, every conversation one wording, two repeats each: the inner levels have no degrees of freedom
one_child_obs = []
for i in range(5):
    for r in range(3):
        one_child_obs.append({"value": round(float(g.normal(i, 1.0)), 6), "path": [f"c{i}", "v0", "w0"]})
put("varianceComponents.not-estimable", "a level with one child per parent has no degrees of freedom: estimate 0, not estimable", [{"observations": one_child_obs, "levels": 3, "expected": vc_unbalanced(one_child_obs, 3)}])
put("varianceComponents.mean-and-n", "n and the grand mean of the values", [{"observations": make_obs(s, 90 + i), "levels": 3, "expected": {"n": len(make_obs(s, 90 + i)), "mean": f(sum(Fraction(o["value"]) for o in make_obs(s, 90 + i)) / len(make_obs(s, 90 + i)))}} for i, s in enumerate(unbal_shapes)])

# --- wilsonEffective --------------------------------------------------------------------------------------


def we_case(cl, alpha=0.05, q="t"):
    return {"clusters": [{"n": a, "k": b} for a, b in cl], "alpha": alpha, "quantile": q, "expected": wilson_effective_ref(cl, alpha, q)}


put("wilsonEffective.all-pass", "every block passed: each cluster counts once (n_eff = clusters)", [we_case(c, a, q) for c in [[(5, 5)] * 3, [(4, 4), (9, 9), (2, 2), (6, 6)]] for a in [0.05, 0.2] for q in ["t", "z"]])
put("wilsonEffective.all-fail", "no block passed: each cluster counts once", [we_case(c, a, q) for c in [[(5, 0)] * 3, [(4, 0), (9, 0), (2, 0)]] for a in [0.05, 0.2] for q in ["t", "z"]])
put("wilsonEffective.single-cluster", "one cluster: n_eff = n and the normal quantile (no degrees of freedom)", [we_case(c, a, q) for c in [[(30, 18)], [(10, 7)], [(100, 3)]] for a in [0.05, 0.2] for q in ["t", "z"]])
put("wilsonEffective.no-spread", "clusters with identical rates have no spread: n_eff = n", [we_case(c, a, q) for c in [[(10, 5)] * 4, [(6, 3), (6, 3), (6, 3)], [(4, 1)] * 8] for a in [0.05] for q in ["t", "z"]])
put(
    "wilsonEffective.capped-at-n",
    "clusters more balanced than a binomial draw would give (a negative intraclass correlation): n_eff would exceed n and is capped at n",
    [we_case(c, 0.05, q) for c in [[(2, 1), (2, 1), (2, 1), (2, 2)], [(4, 2), (4, 2), (4, 2), (4, 3)], [(6, 3), (6, 3), (6, 3), (6, 3), (6, 4)]] for q in ["t", "z"]],
)
put("wilsonEffective.levels", "alpha 0.2, 0.1, 0.01 with the two quantiles", [we_case([(6, 4), (6, 5), (6, 1), (6, 6), (6, 2)], a, q) for a in [0.2, 0.1, 0.01] for q in ["t", "z"]])
put("wilsonEffective.t-widens", "the Student t quantile gives a wider interval than the normal one for the same clusters", [we_case(c, 0.05, q) for c in [[(5, 4), (5, 1), (5, 3)], [(8, 6), (8, 2), (8, 7), (8, 3)]] for q in ["t", "z"]])

# --- hierarchicalBetaBinomial -----------------------------------------------------------------------------


def hb_case(trees, alpha=0.05):
    r = hier_ref(trees, alpha)
    return {"trees": [{"n": a, "k": b} for a, b in trees], "alpha": alpha, "expected": r}


put("hierarchicalBetaBinomial.large-trees", "trees of more than 64 blocks take the log-gamma path: a fine numerical integration agrees", [hb_case([(80, 60), (120, 90), (100, 40), (90, 70)]), hb_case([(200, 150), (75, 20), (130, 100)])])
put("hierarchicalBetaBinomial.all-pass", "every block passed: the interval still has width and holds the rate", [hb_case([(5, 5)] * 4), hb_case([(8, 8), (3, 3), (12, 12)])])
put("hierarchicalBetaBinomial.all-fail", "no block passed", [hb_case([(5, 0)] * 4), hb_case([(8, 0), (3, 0), (12, 0)])])
put("hierarchicalBetaBinomial.two-trees", "very few trees give a very wide interval", [hb_case([(6, 5), (6, 1)]), hb_case([(10, 10), (10, 0)]), hb_case([(4, 2), (4, 2)])])
put("hierarchicalBetaBinomial.levels", "alpha 0.2, 0.1 and 0.01", [hb_case([(6, 4), (6, 5), (6, 1), (6, 6), (6, 2)], a) for a in [0.2, 0.1, 0.01]])
put("hierarchicalBetaBinomial.single-block-trees", "trees of one block (the repeats of a golden run once): the mean of the flags and a wide interval", [hb_case([(1, 1)] * 5 + [(1, 0)] * 3), hb_case([(1, 1), (1, 0)] * 6)])
put("hierarchicalBetaBinomial.order-and-duplicates", "the same trees in another order, or a tree repeated as separate entries, give one interval", [hb_case([(6, 4), (6, 5), (6, 1), (6, 6), (6, 2), (6, 4), (6, 4)])])

# --- siblings of the calls a package could hard-code, and valid inputs that look odd ----------------------
# The cheater audit raised the bank by returning the stored answer of six named calls (normalCdf(Infinity),
# chiSquareSf(Infinity, 3), mean([1e308 x 3]), betaQuantile(1e-6, .5, .5), hillNumber near 1). Each now has
# siblings on other arguments of the same kind, so a lookup of those calls gains nothing.
INF = "Infinity"
NINF = "-Infinity"
put("sibling.normalSf-infinite", "scipy.stats.norm.sf at +-Infinity", [{"z": INF, "expected": 0.0}, {"z": NINF, "expected": 1.0}, {"z": 1e300, "expected": 0.0}, {"z": -1e300, "expected": 1.0}])
put("sibling.normalCdf-far", "scipy.stats.norm.cdf far out", [{"z": 1e300, "expected": 1.0}, {"z": -1e300, "expected": 0.0}, {"z": 40.0, "expected": 1.0}, {"z": -40.0, "expected": f(stats.norm.cdf(-40.0))}])
put("sibling.erfc-infinite", "math.erfc at +-Infinity and far out", [{"x": INF, "expected": 0.0}, {"x": NINF, "expected": 2.0}, {"x": 1e300, "expected": 0.0}, {"x": -1e300, "expected": 2.0}])
put("sibling.chiSquareSf-infinite", "scipy.stats.chi2.sf at Infinity for several degrees of freedom", [{"x": INF, "df": d, "expected": 0.0} for d in [1, 2, 5, 50.5, 1000]] + [{"x": 1e300, "df": 3, "expected": 0.0}])
put(
    "sibling.mean-no-overflow",
    "the mean of equal finite values is that value, and values that cancel give 0 (exact rational arithmetic)",
    [{"values": [x] * n, "expected": x} for x, n in [(1e308, 3), (-1e308, 3), (1.7e308, 2), (5e307, 7), (1.5e308, 4), (9e307, 5)]]
    + [{"values": [1e308, 1e308, -1e308, -1e308], "expected": 0.0}, {"values": [1.7e308, -1.7e308], "expected": 0.0}],
)
bq_sib = [(1e-4, 0.3, 0.3), (1e-8, 0.5, 0.5), (0.01, 0.2, 0.4), (0.5, 0.1, 0.1), (1e-3, 0.5, 0.25), (1e-5, 0.4, 0.4), (0.99, 0.3, 0.3)]
put("sibling.betaQuantile-u-shaped", "scipy.special.betaincinv with a shape below 1", [{"p": p, "a": a, "b": b, "expected": f(special.betaincinv(a, b, p))} for p, a, b in bq_sib])
hn = []
for c in [[40, 12, 7, 3, 3, 2, 2, 1, 1, 1], [100, 50, 25, 12, 6, 3], [5, 5, 5, 1], [9, 1, 1, 1, 1, 1, 1, 1]]:
    for d in [1e-12, -1e-12, 1e-9, -1e-9, 1e-6]:
        hn.append({"counts": c, "q": 1 + d, "expected": hill_exact(c, 1)})
put("sibling.hillNumber-near-one", "the Hill number is continuous in q: near q = 1 it is exp(Shannon entropy) (to 1e-5 relative for |q - 1| up to 1e-6)", hn)

put("valid-odd.normalCdf", "limits of the normal distribution", [{"z": INF, "expected": 1.0}, {"z": NINF, "expected": 0.0}])
put("valid-odd.normalQuantile", "scipy.stats.norm.ppf(0) and ppf(1)", [{"p": 0.0, "expected": NINF}, {"p": 1.0, "expected": INF}])
put("valid-odd.logGamma", "scipy.special.gammaln at the poles is +Infinity", [{"x": 0.0, "expected": INF}, {"x": -1.0, "expected": INF}, {"x": -2.0, "expected": INF}, {"x": -7.0, "expected": INF}])
put("valid-odd.kolmogorovSf", "the Kolmogorov survival function at and beyond the ends", [{"x": INF, "expected": 0.0}, {"x": 0.0, "expected": 1.0}, {"x": -1.0, "expected": 1.0}])
put("valid-odd.benjaminiHochberg", "no hypotheses: empty lists and no threshold (scipy.stats.false_discovery_control([]) is empty)", [{"pvalues": [], "q": 0.05, "expected": {"adjusted": [], "rejected": [], "threshold": None, "q": 0.05}}, {"pvalues": [], "q": 0.2, "expected": {"adjusted": [], "rejected": [], "threshold": None, "q": 0.2}}])
put("valid-odd.abundances", "no labels: no classes", [{"labels": [], "expected": []}])
put("valid-odd.betaQuantile", "the quantile at p = 0 and p = 1 is the end of the support", [{"p": 0.0, "a": 2.0, "b": 3.0, "expected": 0.0}, {"p": 1.0, "a": 2.0, "b": 3.0, "expected": 1.0}, {"p": 0.0, "a": 0.5, "b": 0.5, "expected": 0.0}])
put("valid-odd.incompleteBeta", "I_0 = 0 and I_1 = 1", [{"x": 0.0, "a": 2.0, "b": 3.0, "expected": 0.0}, {"x": 1.0, "a": 2.0, "b": 3.0, "expected": 1.0}])
put("valid-odd.binomialCdf", "scipy.stats.binom.cdf below 0 and at or above n", [{"k": -1, "n": 10, "p": 0.3, "expected": 0.0}, {"k": 10, "n": 10, "p": 0.3, "expected": 1.0}, {"k": 12, "n": 10, "p": 0.3, "expected": 1.0}])
put("valid-odd.mde", "a baseline of 0 has no detectable drop (effect null); a baseline of 1 does", [{"n": 50.0, "baselineRate": 0.0, "expected": {"effect": None}}, {"n": 50.0, "baselineRate": 1.0, "expected": {"effect": mde_ref(50.0, 1.0)}}])
put("valid-odd.hillNumber", "negative orders are defined: (sum 1 / p)^(1 / 2) at q = -1", [{"counts": [3, 2, 1], "q": -1.0, "expected": math.sqrt(11)}, {"counts": [4, 4], "q": -2.0, "expected": 2.0}])
put("valid-odd.wilson", "k = 0 and k = n are valid and give the closed form (exact decimals)", [{"k": 0, "n": 10, "z": Z95, "expected": list(wilson_dec_pair(0, 10, Z95))}, {"k": 10, "n": 10, "z": Z95, "expected": list(wilson_dec_pair(10, 10, Z95))}])

doc = {
    "provenance": {
        "script": "packages/validators/fixtures/stats/make_exact_branches.py",
        "reference_functions": "packages/validators/fixtures/stats/exact_ref.py",
        "numpy": np.__version__,
        "sources": prov,
    },
    **out,
}
with open(OUT, "w") as fh:
    json.dump(doc, fh, indent=1, allow_nan=False)
print("wrote", OUT, {k: len(v) for k, v in out.items()})
