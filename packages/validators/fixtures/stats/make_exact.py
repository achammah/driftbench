"""Exact reference values for the statistics bank (packages/validators/src/ladders/stats/bank/exact.ts).

Run from the repository root:  python3 packages/validators/fixtures/stats/make_exact.py
Then format the output:        npx biome format --write packages/validators/fixtures/stats/exact.json

Every value below is computed here, in Python, without reading or calling the TypeScript package:
- from a closed form written out from the textbook formula, in exact rational arithmetic where the answer is
  rational (fractions.Fraction), or
- from the standard library (math.erfc, math.lgamma), or
- from scipy and numpy, a second implementation.
The provenance object records the versions and, per function, which of the three produced its numbers.
The cases are fictional numbers; no estate data enters the file.
"""

import json
import math
import os
from collections import Counter
from fractions import Fraction

import numpy as np
import scipy
from scipy import special, stats

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "exact.json")
M32 = 0xFFFFFFFF
Z95 = float(stats.norm.ppf(0.975))

out = {}
prov = {}


def put(name, source, cases):
    out[name] = cases
    prov[name] = source


# --- special functions ------------------------------------------------------------------------------------

xs = [0.0, 1e-8, 0.1, 0.5, 1.0, 1.5, 2.0, 3.0, 5.0, 8.0, 12.0, 20.0, -0.5, -1.0, -2.5]
put("erfc", "math.erfc (standard library)", [{"x": x, "expected": math.erfc(x)} for x in xs])

zs = [0.0, 1e-6, 0.25, 1.0, 1.96, 2.5, 4.0, 6.0, 9.0, -0.25, -1.0, -3.0, -6.0, -9.0]
put(
    "normalCdf",
    "scipy.stats.norm.cdf",
    [{"z": z, "expected": float(stats.norm.cdf(z))} for z in zs],
)
put(
    "normalSf",
    "scipy.stats.norm.sf",
    [{"z": z, "expected": float(stats.norm.sf(z))} for z in zs],
)
ps = [1e-12, 1e-8, 1e-5, 0.001, 0.02, 0.025, 0.1, 0.3, 0.5, 0.7, 0.9, 0.975, 0.999, 1 - 1e-8]
put(
    "normalQuantile",
    "scipy.stats.norm.ppf",
    [{"p": p, "expected": float(stats.norm.ppf(p))} for p in ps],
)
alphas = [0.5, 0.2, 0.1, 0.05, 0.01, 0.001, 1e-6]
put("zFor", "scipy.stats.norm.isf(alpha / 2)", [{"alpha": a, "expected": float(stats.norm.isf(a / 2))} for a in alphas])

gx = [0.5, 1.0, 1.5, 2.0, 3.0, 4.5, 10.0, 25.5, 100.0, 1000.5, 1e-3, 0.1]
put("logGamma", "math.lgamma (standard library)", [{"x": x, "expected": math.lgamma(x)} for x in gx])
# Integer arguments have the exact value ln((x - 1)!), from exact integer arithmetic.
put(
    "logGammaIntegers",
    "ln of math.factorial(x - 1), exact integer arithmetic",
    [{"x": x, "expected": math.log(math.factorial(x - 1))} for x in [1, 2, 3, 5, 8, 13, 21, 34]],
)
bq = [(0.025, 2, 5), (0.5, 1, 1), (0.1, 0.5, 0.5), (0.975, 10, 3), (0.001, 30, 30), (0.5, 0.5, 4), (0.05, 3.5, 0.5), (0.9, 100, 2)]
put(
    "betaQuantile",
    "scipy.special.betaincinv",
    [{"p": p, "a": a, "b": b, "expected": float(special.betaincinv(a, b, p))} for p, a, b in bq],
)
cs = [(0.5, 1), (3.84, 1), (5.99, 2), (9.49, 4), (18.3, 10), (50.0, 30), (0.1, 5), (120.0, 100), (200.0, 100)]
put(
    "chiSquareSf",
    "scipy.stats.chi2.sf",
    [{"x": x, "df": d, "expected": float(stats.chi2.sf(x, d))} for x, d in cs],
)
ks = [0.2, 0.4, 0.6, 0.8, 1.0, 1.18, 1.2, 1.5, 2.0, 2.5, 3.0]
put("kolmogorovSf", "scipy.special.kolmogorov", [{"x": x, "expected": float(special.kolmogorov(x))} for x in ks])


# --- mulberry32, ported from the published algorithm (Tommy Ettinger's mulberry32) in integer arithmetic ---


def imul(a, b):
    return (a * b) & M32


def mulberry32(seed):
    state = [seed & M32]

    def nxt():
        state[0] = (state[0] + 0x6D2B79F5) & M32
        t = state[0]
        t = imul(t ^ (t >> 15), t | 1)
        t ^= (t + imul(t ^ (t >> 7), t | 61)) & M32
        return ((t ^ (t >> 14)) & M32) / 4294967296

    return nxt


put(
    "mulberry32",
    "integer-arithmetic port of mulberry32 written here",
    [{"seed": s, "expected": (lambda g: [g() for _ in range(8)])(mulberry32(s))} for s in [0, 1, 42, 2026, 4294967295, 856524023]],
)

# --- basics -----------------------------------------------------------------------------------------------

samples = [
    [3.0],
    [1.0, 2.0],
    [5.0, 1.0, 3.0],
    [0.1, 0.4, 0.35, 0.8, 0.72, 0.05, 0.9],
    [10, 10, 10, 10],
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    [-3.5, 2.25, 0.0, 8.125, -1.75, 4.5, 4.5, 0.375],
]
ps_q = [0.0, 0.1, 0.25, 0.5, 0.9, 0.95, 1.0]
put(
    "quantile",
    "numpy.quantile(method='linear'), Hyndman and Fan type 7",
    [
        {"values": s, "p": p, "expected": float(np.quantile(np.array(s, dtype=float), p, method="linear"))}
        for s in samples
        for p in ps_q
    ],
)
put(
    "unreliability",
    "numpy.quantile(0.9) - numpy.quantile(0.1)",
    [
        {
            "samples": s,
            "expected": float(np.quantile(np.array(s, dtype=float), 0.9) - np.quantile(np.array(s, dtype=float), 0.1)),
        }
        for s in samples
    ],
)
wm = [
    ([1.0, 2.0, 3.0], [1.0, 1.0, 1.0]),
    ([1.0, 2.0, 3.0], [3.0, 2.0, 1.0]),
    ([0.2, 0.9], [0.0, 5.0]),
    ([10.0, -4.0, 6.5, 0.25], [0.5, 0.25, 0.125, 0.125]),
    ([7.0], [3.0]),
]
put(
    "weightedMean",
    "exact rational arithmetic (fractions.Fraction) of sum(w x) / sum(w)",
    [
        {
            "values": v,
            "weights": w,
            "expected": float(sum(Fraction(a) * Fraction(b) for a, b in zip(v, w)) / sum(Fraction(b) for b in w)),
        }
        for v, w in wm
    ],
)
var_samples = [s for s in samples if len(s) >= 2] + [[1e9 + 4, 1e9 + 7, 1e9 + 13, 1e9 + 16]]
put(
    "sampleVariance",
    "exact rational arithmetic (fractions.Fraction), n - 1 denominator",
    [
        {
            "values": s,
            "expected": float(
                sum((Fraction(x) - sum(Fraction(y) for y in s) / len(s)) ** 2 for x in s) / (len(s) - 1)
            ),
        }
        for s in var_samples
    ],
)
labels = [
    ["a", "b", "a", "c", "a", "b"],
    [1, 1, 1, 1],
    ["x"],
    [],
    ["p", "q", "r", "s"],
    [3, 1, 3, 2, 1, 3, 3],
]
put(
    "abundances",
    "collections.Counter, first-seen order",
    [{"labels": lab, "expected": list(Counter(lab).values())} for lab in labels],
)

# repeat reducers: the documented rules, as a table written out by hand and checked against a direct
# re-statement of the rules below
reducer_cases = []


def reduce_ref(values, kind, k=None):
    scored = [v for v in values if v is not None]
    if kind == "mode":
        if len(scored) * 2 <= len(values):
            return None
        counts = {}
        for v in scored:
            counts[v] = counts.get(v, 0) + 1
        best, best_count = None, -1
        for v, c in counts.items():
            if c > best_count:
                best, best_count = v, c
        return 1 if best == 1 else 0
    if kind == "median":
        if not scored:
            return None
        m = float(np.median(np.array(scored, dtype=float)))
        return 1 if m > 0.5 else 0 if m < 0.5 else None
    passes = sum(1 for v in scored if v == 1)
    unscored = len(values) - len(scored)
    if passes >= k:
        return 1
    if passes + unscored < k:
        return 0
    return None


for vals in [
    [1, 1, 0],
    [1, 0, 0],
    [1, 0],
    [1, None, None],
    [1, 1, None],
    [0, 0, None, None, 1],
    [None, None],
    [],
    [1],
    [0],
    [1, 0, 1, 0],
    [0, 1, 1, 0, 1],
]:
    for spelling, kind, k in [("mode", "mode", None), ("median", "median", None), ("at_least:1", "at_least", 1), ("at_least:2", "at_least", 2), ("at_least:3", "at_least", 3)]:
        reducer_cases.append({"values": vals, "reducer": spelling, "expected": reduce_ref(vals, kind, k)})
put("reduceRepeats", "the documented rules of repeat-reducers.ts, restated here with numpy.median", reducer_cases)

# --- intervals --------------------------------------------------------------------------------------------

de = [(1, 0.0), (1, 0.7), (2, 0.5), (3, 0.5), (5, 0.2), (10, 0.3), (25, 0.04), (4, -0.2), (100, 0.01), (7, 1.0)]
put(
    "designEffect",
    "closed form 1 + (m - 1) rho in exact rational arithmetic",
    [{"m": m, "rho": r, "expected": float(1 + (Fraction(m) - 1) * Fraction(r))} for m, r in de],
)
put(
    "effectiveSampleSize",
    "closed form n / (1 + (m - 1) rho) in exact rational arithmetic",
    [
        {"n": n, "m": m, "rho": r, "expected": float(Fraction(n) / (1 + (Fraction(m) - 1) * Fraction(r)))}
        for n, m, r in [(100, 5, 0.2), (60, 3, 0.5), (1000, 10, 0.1), (24, 1, 0.9), (50, 2, -0.25), (12, 12, 0.75)]
    ],
)
kw = [[1, 1, 1, 1], [1, 2, 3], [5.0], [0, 1, 1], [0.5, 0.25, 0.125, 0.125], [10, 1, 1, 1, 1, 1, 1], [3, 3, 3, 3, 3, 3]]
put(
    "kishEffectiveSize",
    "closed form (sum w)^2 / sum w^2 in exact rational arithmetic",
    [
        {
            "weights": w,
            "expected": float(sum(Fraction(x) for x in w) ** 2 / sum(Fraction(x) ** 2 for x in w)),
        }
        for w in kw
    ],
)


def student_t(alpha, df):
    return float(stats.t.isf(alpha / 2, df))


def wilson_ref(p, n_eff, z):
    z2 = z * z
    den = 1 + z2 / n_eff
    centre = (p + z2 / (2 * n_eff)) / den
    half = z * math.sqrt(p * (1 - p) / n_eff + z2 / (4 * n_eff * n_eff)) / den
    return max(0.0, centre - half), min(1.0, centre + half)


def wilson_effective_ref(clusters, alpha=0.05, quantile="t"):
    g = len(clusters)
    n = sum(c[0] for c in clusters)
    k = sum(c[1] for c in clusters)
    p = k / n
    degenerate = p == 0 or p == 1
    if degenerate:
        neff = float(g)
    elif g < 2:
        neff = float(n)
    else:
        ss = sum((c[1] - p * c[0]) ** 2 for c in clusters)
        var = (g / (g - 1)) * ss / (n * n)
        neff = min(float(n), max(1.0, p * (1 - p) / var)) if var > 0 else float(n)
    df = g - 1
    z = float(stats.norm.isf(alpha / 2)) if (quantile == "z" or df < 1) else student_t(alpha, df)
    lo, hi = wilson_ref(p, neff, z)
    return {"estimate": p, "lower": lo, "upper": hi, "n": n, "clusters": g, "designEffect": n / neff, "effectiveN": neff, "degenerate": degenerate}


we_cases = [
    [(6, 4), (6, 5), (6, 1), (6, 6), (6, 2)],
    [(5, 5), (5, 0), (5, 3), (5, 4)],
    [(10, 7), (3, 3), (8, 2), (1, 1), (12, 9), (4, 0)],
    [(4, 2), (4, 2)],
    [(30, 18)],
    [(5, 5), (5, 5), (5, 5)],
    [(5, 0), (5, 0)],
    [(2, 1), (2, 1), (2, 1), (2, 1), (2, 1), (2, 1), (2, 1), (2, 1)],
]
we = []
for cl in we_cases:
    for q in ["t", "z"]:
        for alpha in [0.05, 0.2]:
            ref = wilson_effective_ref(cl, alpha, q)
            we.append({"clusters": [{"n": a, "k": b} for a, b in cl], "alpha": alpha, "quantile": q, "expected": ref})
put("wilsonEffective", "formulas of effective.ts restated here, with scipy.stats.t.isf and scipy.stats.norm.isf", we)


# hierarchical Beta-Bernoulli: a fine numerical integration written here (2000 theta cells, 600 log-spaced d)
def hier_ref(trees, alpha=0.05, cells=2000, points=600):
    th = (np.arange(cells) + 0.5) / cells
    d = np.exp(np.linspace(math.log(0.02), math.log(60.0), points))
    A = th[:, None] * d[None, :]
    B = (1 - th)[:, None] * d[None, :]
    logw = np.log(d)[None, :] - d[None, :]  # d e^{-d}: the Gamma(1, 1) prior on a log grid
    logp = np.broadcast_to(logw, A.shape).copy()
    for n, k in trees:
        logp += (
            special.gammaln(k + A) - special.gammaln(A) + special.gammaln(n - k + B) - special.gammaln(B)
            - special.gammaln(n + d[None, :]) + special.gammaln(d[None, :])
        )
    logp -= logp.max()
    w = np.exp(logp).sum(axis=1)
    w /= w.sum()
    cdf = np.cumsum(w)

    def q(p):
        i = int(np.searchsorted(cdf, p))
        below = cdf[i - 1] if i > 0 else 0.0
        inside = (p - below) / w[i] if w[i] > 0 else 0.0
        return (i + min(1.0, max(0.0, inside))) / cells

    tree_mean = sum(k / n for n, k in trees) / len(trees)
    lo = min(q(alpha / 2), tree_mean)
    hi = max(q(1 - alpha / 2), tree_mean)
    return {"estimate": tree_mean, "lower": lo, "upper": hi, "posteriorMean": float((w * th).sum())}


hier_cases = [
    [(6, 4), (6, 5), (6, 1), (6, 6), (6, 2)],
    [(5, 5), (5, 0), (5, 3), (5, 4), (5, 2), (5, 5)],
    [(10, 7), (3, 3), (8, 2), (1, 1), (12, 9), (4, 0), (7, 5)],
    [(4, 2), (4, 2), (4, 2), (4, 2)],
    [(30, 18), (30, 21), (30, 12)],
    [(5, 5), (5, 5), (5, 5), (5, 5)],
    [(5, 0), (5, 0), (5, 0)],
    [(3, 2)] * 12,
    [(90, 60), (70, 35), (100, 80)],
]
hh = []
for tr in hier_cases:
    for alpha in [0.05, 0.2]:
        hh.append({"trees": [{"n": a, "k": b} for a, b in tr], "alpha": alpha, "expected": hier_ref(tr, alpha)})
put("hierarchicalBetaBinomial", "a 2000 x 600 numerical integration of the model of hierarchical.ts written here with scipy.special.gammaln", hh)

# --- drift ------------------------------------------------------------------------------------------------

series_cases = [
    [0, 0, 0, 0, 0, 0, 5, 5, 5, 5, 5, 5],
    [10, 11, 9, 10, 12, 8, 10, 10, 14, 15, 16, 17, 18, 19, 18, 17],
    [3.0, 3.1, 2.9, 3.2, 2.8, 3.0, 1.0, 0.8, 0.9, 1.1, 0.7, 1.0, 0.9],
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
]


def cusum_ref(series, target=None, sd=None, k=0.5, h=5.0, warmup=None, reset=True):
    x = np.array(series, dtype=float)
    w = warmup if warmup is not None else min(20, len(x))
    head = x[:w]
    target = float(head.mean()) if target is None else target
    sd = float(head.std(ddof=1)) if sd is None else sd
    su = sl = 0.0
    up, lo, alarms = [], [], []
    for i, v in enumerate(x):
        z = (v - target) / sd
        su = max(0.0, su + z - k)
        sl = max(0.0, sl - z - k)
        up.append(su)
        lo.append(sl)
        if su > h:
            alarms.append({"index": i, "direction": "up"})
            if reset:
                su = 0.0
        if sl > h:
            alarms.append({"index": i, "direction": "down"})
            if reset:
                sl = 0.0
    return {"upper": up, "lower": lo, "alarms": alarms, "target": target, "sd": sd}


cs_cases = []
for s in series_cases:
    for opts in [{"target": 0.0, "sd": 1.0}, {"target": float(np.mean(s[:6])), "sd": 1.5, "k": 0.25, "h": 3.0}, {"target": 5.0, "sd": 2.0, "reset": False}]:
        ref = cusum_ref(s, **opts)
        cs_cases.append({"series": s, "options": opts, "expected": ref})
put("cusum", "the tabular CUSUM recursion of drift.ts restated here with numpy", cs_cases)


def ph_ref(series, delta=0.005, threshold=50.0, min_instances=30):
    count = 0
    mean_ = m_up = min_up = m_dn = max_dn = 0.0
    up, down, alarms = [], [], []
    for i, x in enumerate(series):
        count += 1
        mean_ += (x - mean_) / count
        m_up += x - mean_ - delta
        min_up = min(min_up, m_up)
        m_dn += x - mean_ + delta
        max_dn = max(max_dn, m_dn)
        u = m_up - min_up
        d = max_dn - m_dn
        up.append(u)
        down.append(d)
        if count >= min_instances and (u > threshold or d > threshold):
            alarms.append({"index": i, "direction": "up" if u > threshold else "down"})
            count = 0
            mean_ = m_up = min_up = m_dn = max_dn = 0.0
    return {"up": up, "down": down, "alarms": alarms}


rng = np.random.RandomState(7)
ph_series = [list(map(float, rng.normal(0, 1, 40))) + list(map(float, rng.normal(3, 1, 40))), list(map(float, rng.normal(2, 0.5, 60))), [1.0, 1.0, 1.0, 1.0, 9.0, 9.0, 9.0, 9.0]]
ph_cases = []
for s in ph_series:
    for opts in [{"delta": 0.005, "threshold": 10.0, "minInstances": 10}, {"delta": 0.5, "threshold": 4.0, "minInstances": 3}]:
        ref = ph_ref(s, opts["delta"], opts["threshold"], opts["minInstances"])
        ph_cases.append({"series": s, "options": opts, "expected": ref})
put("pageHinkley", "the Page-Hinkley recursion of drift.ts restated here", ph_cases)

# --- coverage ---------------------------------------------------------------------------------------------

count_cases = [[5, 3, 2, 1, 1], [1, 1, 1, 1], [4, 4, 4, 4], [10], [2, 2, 1, 1, 1, 6], [1, 2, 3, 4, 5, 6, 7, 8], [7, 0, 3, 0, 1]]
gt = []
for c in count_cases:
    n = sum(c)
    f1 = sum(1 for x in c if x == 1)
    f2 = sum(1 for x in c if x == 2)
    gt.append(
        {
            "counts": c,
            "expected": {"n": n, "observed": sum(1 for x in c if x > 0), "f1": f1, "f2": f2, "discoveryProbability": f1 / n, "coverage": 1 - f1 / n},
        }
    )
put("goodTuring", "closed form f1 / n", gt)


def hill_ref(c, q):
    p = np.array([x for x in c if x > 0], dtype=float)
    p = p / p.sum()
    if q == 0:
        return float(len(p))
    if q == 1:
        return float(np.exp(-(p * np.log(p)).sum()))
    return float(((p**q).sum()) ** (1 / (1 - q)))


hl = []
for c in count_cases:
    for q in [0, 0.5, 1, 2, 3, 5]:
        hl.append({"counts": c, "q": q, "expected": hill_ref(c, q)})
put("hillNumber", "numpy closed forms (sum p^q)^(1 / (1 - q)) and exp(Shannon)", hl)
put(
    "hillNumbers",
    "numpy closed forms at q = 0, 1, 2",
    [{"counts": c, "expected": {"q0": hill_ref(c, 0), "q1": hill_ref(c, 1), "q2": hill_ref(c, 2)}} for c in count_cases],
)

# --- variance ---------------------------------------------------------------------------------------------


def nested(a, b, c, r, seed, sd=(2.0, 1.0, 0.5, 0.25)):
    g = np.random.RandomState(seed)
    obs = []
    ya = g.normal(0, sd[0], a)
    for i in range(a):
        yb = g.normal(0, sd[1], b)
        for j in range(b):
            yc = g.normal(0, sd[2], c)
            for k in range(c):
                for m in range(r):
                    y = 10 + ya[i] + yb[j] + yc[k] + g.normal(0, sd[3])
                    obs.append({"value": float(y), "path": [f"cell{i}", f"conv{j}", f"word{k}"]})
    return obs


def vc_ref(obs, a, b, c, r):
    y = np.array([o["value"] for o in obs]).reshape(a, b, c, r)
    gm = y.mean()
    m_a = y.mean(axis=(1, 2, 3))
    m_b = y.mean(axis=(2, 3))
    m_c = y.mean(axis=3)
    ss_a = b * c * r * ((m_a - gm) ** 2).sum()
    ss_b = c * r * ((m_b - m_a[:, None]) ** 2).sum()
    ss_c = r * ((m_c - m_b[:, :, None]) ** 2).sum()
    ss_e = ((y - m_c[:, :, :, None]) ** 2).sum()
    df = [a - 1, a * (b - 1), a * b * (c - 1), a * b * c * (r - 1)]
    ss = [ss_a, ss_b, ss_c, ss_e]
    ms = [s / d if d > 0 else float("nan") for s, d in zip(ss, df)]
    est = [
        (ms[0] - ms[1]) / (b * c * r),
        (ms[1] - ms[2]) / (c * r),
        (ms[2] - ms[3]) / r,
        ms[3],
    ]
    var = [max(0.0, e) for e in est]
    total = sum(var)
    groups = [a, a * b, a * b * c, a * b * c * r]
    names = ["cell", "conversation", "wording", "repeat"]
    comps = [
        {"level": names[i], "groups": groups[i], "df": df[i], "sumSquares": float(ss[i]), "meanSquare": float(ms[i]), "estimate": float(est[i]), "variance": float(var[i]), "share": float(var[i] / total)}
        for i in range(4)
    ]
    return {"n": len(obs), "mean": float(gm), "total": float(total), "components": comps}


vc = []
for a, b, c, r, seed in [(4, 3, 3, 2, 11), (6, 2, 2, 3, 12), (3, 4, 2, 4, 13), (8, 3, 3, 2, 14), (5, 5, 2, 2, 15)]:
    obs = nested(a, b, c, r, seed)
    vc.append({"observations": obs, "design": [a, b, c, r], "expected": vc_ref(obs, a, b, c, r)})
put("varianceComponents", "balanced nested ANOVA mean-square estimators written here with numpy", vc)

# icc: from a hand-built varianceComponents result
icc_cases = []
for variances in [[4.0, 1.0, 0.25, 0.5], [0.0, 2.0, 2.0, 1.0], [1.0, 1.0, 1.0, 1.0], [3.0, 0.0, 0.0, 1.0], [0.0, 0.0, 0.0, 0.0]]:
    total = sum(variances)
    comps = [{"level": nm, "variance": v, "share": (v / total if total > 0 else 0.0)} for nm, v in zip(["cell", "conversation", "wording", "repeat"], variances)]
    cum = 0.0
    exp = []
    for comp in comps[:-1]:
        cum += comp["variance"]
        exp.append({"level": comp["level"], "icc": (cum / total if total > 0 else 0.0), "share": comp["share"]})
    icc_cases.append({"components": comps, "total": total, "expected": exp})
put("icc", "cumulative variance over total, restated here", icc_cases)

ny = []
for sizes, sds, total in [([100, 200, 300], [1.0, 2.0, 3.0], 60), ([50, 50], [0.5, 0.5], 10), ([10, 1000, 200, 30], [0.2, 0.1, 0.4, 0.9], 200), ([5, 5, 5], [0, 0, 0], 9), ([20, 80], [0.0, 1.0], 12)]:
    w = [Fraction(s) * Fraction(d) for s, d in zip(sizes, sds)]
    if all(x == 0 for x in w):
        w = [Fraction(s) for s in sizes]
    sw = sum(w)
    ny.append({"sizes": sizes, "sds": sds, "total": total, "expected": {"exact": [float(total * x / sw) for x in w]}})
put("neymanAllocation", "exact rational arithmetic: total N_h S_h / sum(N_h S_h)", ny)

rf = []
for vari, floor, z, blocks, diff in [(0.25, 0.05, Z95, 1, True), (0.25, 0.05, Z95, 1, False), (0.1, 0.02, 1.645, 4, True), (0.09, 0.1, Z95, 10, False), (0.0, 0.1, Z95, 1, True), (0.5, 0.03, 2.576, 25, True)]:
    f = 2 if diff else 1
    exact = f * z * z * vari / (blocks * floor * floor)
    reps = max(1, int(math.ceil(exact - 1e-9)))
    rf.append({"variance": vari, "floor": floor, "z": z, "blocks": blocks, "difference": diff, "expected": {"repeats": reps, "floor": z * math.sqrt(f * vari / (reps * blocks))}})
put("repeatsForFloor", "closed form r = ceil(f z^2 variance / (blocks floor^2)) restated here", rf)

# --- paired -----------------------------------------------------------------------------------------------


def wilson_k(k, n, z):
    p = k / n
    return wilson_ref(p, n, z)


def newcombe(a, b, c, d, alpha=0.05):
    n = a + b + c + d
    z = float(stats.norm.isf(alpha / 2))
    p1 = (a + b) / n
    p2 = (a + c) / n
    l1, u1 = wilson_k(a + b, n, z)
    l2, u2 = wilson_k(a + c, n, z)
    prod = (a + b) * (c + d) * (a + c) * (b + d)
    cov = a * d - b * c
    corr = max(0.0, cov - n / 2) if cov > 0 else cov
    phi = 0.0 if prod == 0 else corr / math.sqrt(prod)
    dl1, du1, dl2, du2 = p1 - l1, u1 - p1, p2 - l2, u2 - p2
    delta = math.sqrt(max(0.0, dl1 * dl1 - 2 * phi * dl1 * du2 + du2 * du2))
    eps = math.sqrt(max(0.0, du1 * du1 - 2 * phi * du1 * dl2 + dl2 * dl2))
    est = p1 - p2
    return {"estimate": est, "lower": max(-1.0, est - delta), "upper": min(1.0, est + eps), "n": n}


tables = [(40, 2, 8, 50), (10, 0, 0, 10), (20, 10, 0, 20), (0, 5, 5, 0), (45, 5, 1, 9), (3, 1, 1, 3), (90, 3, 4, 3), (7, 2, 3, 8), (0, 0, 0, 12)]
pd = []
for t in tables:
    for alpha in [0.05, 0.1]:
        pd.append({"table": {"bothPass": t[0], "regressed": t[1], "improved": t[2], "bothFail": t[3]}, "alpha": alpha, "expected": newcombe(*t, alpha)})
put("pairedRateDifference", "Newcombe's method 10 restated here with scipy.stats.norm.isf", pd)

ni = []
for base, cand, margin in [
    ([True] * 18 + [False] * 2, [True] * 17 + [False] * 3, 0.2),
    ([True] * 30, [True] * 30, 0.05),
    ([True] * 40 + [False] * 10, [True] * 30 + [False] * 20, 0.1),
    ([True, False, True, True, False, True, True, True], [True, False, True, True, False, True, True, False], 0.5),
    ([False] * 6 + [True] * 14, [True] * 14 + [False] * 6, 0.3),
]:
    a = sum(1 for x, y in zip(base, cand) if x and y)
    b = sum(1 for x, y in zip(base, cand) if x and not y)
    c = sum(1 for x, y in zip(base, cand) if not x and y)
    d = sum(1 for x, y in zip(base, cand) if not x and not y)
    eff = newcombe(a, b, c, d)
    ni.append({"baseline": base, "candidate": cand, "margin": margin, "expected": {"nonInferior": eff["upper"] < margin, "effect": eff, "regressed": b, "improved": c}})
put("nonInferiority", "Newcombe's interval restated here; verdict upper < margin", ni)

# --- simulateCoverage: the seeded simulation replayed here ------------------------------------------------
# The sampler of simulate.ts (Box-Muller normals, Marsaglia-Tsang gammas, beta from two gammas, binomial by
# Bernoulli draws) is written out again here on the mulberry32 port above, with the same order of draws. The
# naive Wilson and Wilson-on-n_eff intervals then give the same counts; the hierarchical interval is read on a
# finer grid than the product's, so it is compared within a few suites.
def sim_normal(rng):
    u = 1 - rng()
    return math.sqrt(-2 * math.log(u)) * math.cos(2 * math.pi * rng())


def sim_gamma(rng, shape):
    if shape < 1:
        g = sim_gamma(rng, shape + 1)
        return g * (1 - rng()) ** (1 / shape)
    c = shape - 1 / 3
    sq = 1 / math.sqrt(9 * c)
    while True:
        x = sim_normal(rng)
        v = (1 + sq * x) ** 3
        if v <= 0:
            continue
        u = 1 - rng()
        if math.log(u) < 0.5 * x * x + c - c * v + c * math.log(v):
            return c * v


def sim_beta(rng, a, b):
    x = sim_gamma(rng, a)
    y = sim_gamma(rng, b)
    return x / (x + y)


def sim_binomial(rng, n, p):
    k = 0
    for _ in range(n):
        if rng() < p:
            k += 1
    return k


def sim_cov(trees, sizes, theta, d, reps, seed):
    rng = mulberry32(seed)
    pool = [sizes] if isinstance(sizes, int) else sizes
    methods = ["naive wilson", "wilson effective z", "wilson effective t", "hierarchical"]
    held = {m: 0 for m in methods}
    width = {m: 0.0 for m in methods}

    def tally(m, lo, hi):
        if lo <= theta <= hi:
            held[m] += 1
        width[m] += hi - lo

    for _ in range(reps):
        cl = []
        n = k = 0
        for _g in range(trees):
            size = pool[int(math.floor(rng() * len(pool)))]
            rate = sim_beta(rng, d * theta, d * (1 - theta))
            passed = sim_binomial(rng, size, rate)
            cl.append((size, passed))
            n += size
            k += passed
        lo, hi = wilson_k(k, n, Z95)
        tally("naive wilson", lo, hi)
        zi = wilson_effective_ref(cl, 0.05, "z")
        tally("wilson effective z", zi["lower"], zi["upper"])
        ti = wilson_effective_ref(cl, 0.05, "t")
        tally("wilson effective t", ti["lower"], ti["upper"])
        h = hier_ref(cl, 0.05, 400, 120)
        tally("hierarchical", h["lower"], h["upper"])
    return {"coverage": {m: held[m] / reps for m in methods}, "width": {m: width[m] / reps for m in methods}}


sim = []
for trees, sizes, theta, d, reps, seed in [(12, 3, 0.6, 2.0, 120, 7), (8, [1, 2, 5, 9], 0.9, 0.5, 120, 21), (1, 20, 0.5, 1e9, 120, 3)]:
    sim.append({"cell": {"trees": trees, "sizes": sizes, "theta": theta, "d": d}, "reps": reps, "seed": seed, "expected": sim_cov(trees, sizes, theta, d, reps, seed)})
put("simulateCoverage", "the sampler of simulate.ts replayed on the mulberry32 port above; wilson_k, wilson_effective_ref and hier_ref as above", sim)

# --- accuracy over the whole domain: 60 points per special function at double-precision tolerance -----------
ga = np.random.RandomState(5)


def acc(name, source, rows):
    put("accuracy." + name, source, rows)


acc("erfc", "math.erfc", [{"x": float(x), "expected": math.erfc(x)} for x in np.concatenate([ga.uniform(0, 30, 45), ga.uniform(0, 1, 15)])])
zz = ga.uniform(-12, 12, 60)
acc("normalCdf", "scipy.stats.norm.cdf", [{"z": float(z), "expected": float(stats.norm.cdf(z))} for z in zz])
acc("normalSf", "scipy.stats.norm.sf", [{"z": float(z), "expected": float(stats.norm.sf(z))} for z in zz])
acc("normalQuantile.lower", "scipy.stats.norm.ppf, p below 0.01", [{"p": float(p), "expected": float(stats.norm.ppf(p))} for p in 10 ** ga.uniform(-300, -2, 60)])
acc("normalQuantile.central", "scipy.stats.norm.ppf, p from 0.01 to 0.99", [{"p": float(p), "expected": float(stats.norm.ppf(p))} for p in ga.uniform(0.01, 0.99, 60)])
acc("normalQuantile.upper", "scipy.stats.norm.ppf, p above 0.99 (1 - p is exact in double precision)", [{"p": float(p), "expected": float(stats.norm.ppf(p))} for p in 1 - 10 ** ga.uniform(-12, -2, 60)])
acc("logGamma", "math.lgamma", [{"x": float(x), "expected": math.lgamma(x)} for x in np.concatenate([ga.uniform(1e-3, 1, 20), ga.uniform(1, 100, 20), ga.uniform(100, 1e4, 20)])])
acc("betaQuantile", "scipy.special.betaincinv", [{"p": float(ga.uniform(0.001, 0.999)), "a": float(10 ** ga.uniform(-1, 2)), "b": float(10 ** ga.uniform(-1, 2))} for _ in range(60)])
for r in out["accuracy.betaQuantile"]:
    r["expected"] = float(special.betaincinv(r["a"], r["b"], r["p"]))
acc("chiSquareSf", "scipy.stats.chi2.sf", [{"x": float(10 ** ga.uniform(-2, 2.5)), "df": float(10 ** ga.uniform(-0.3, 2.3))} for _ in range(60)])
for r in out["accuracy.chiSquareSf"]:
    r["expected"] = float(stats.chi2.sf(r["x"], r["df"]))
acc("kolmogorovSf", "scipy.special.kolmogorov", [{"x": float(x), "expected": float(special.kolmogorov(x))} for x in ga.uniform(0.1, 4, 60)])

# --- the report's suite headline and clustered rate -------------------------------------------------------
from scipy import optimize


def mde_ref(n_eff, p1, power=0.8, alpha=0.05):
    za = float(stats.norm.isf(alpha / 2))
    zb = float(stats.norm.ppf(power))

    def gap(delta):
        p2 = p1 - delta
        pbar = (p1 + p2) / 2
        return za * math.sqrt(2 * pbar * (1 - pbar)) + zb * math.sqrt(p1 * (1 - p1) + p2 * (1 - p2)) - delta * math.sqrt(n_eff)

    if p1 == 0 or gap(p1) > 0:
        return None
    return float(optimize.brentq(gap, 0.0, p1, xtol=1e-15, rtol=1e-15))


def headline_ref(goldens):
    """goldens: list of (runs, passes) per golden (the tree of the headline: the repeats of one spec in one mode)."""
    g = len(goldens)
    runs = sum(n for n, _ in goldens)
    pooled = sum(k for _, k in goldens) / runs
    if g < 2:
        k = goldens[0][1]
        return {"trees": 1, "runs": runs, "estimate": k / goldens[0][0], "pooledRate": pooled, "method": "none", "lower": k / goldens[0][0], "upper": k / goldens[0][0], "designEffect": 1.0, "effectiveRuns": float(runs), "degenerate": False, "detectableDrop": None}
    rates = [k / n for n, k in goldens]
    p = sum(rates) / g
    h = hier_ref([(n, k) for n, k in goldens], 0.05)
    between = sum((r - p) ** 2 for r in rates) / (g - 1) / g
    within = sum(r * (1 - r) / n for r, (n, _) in zip(rates, goldens)) / (g * g)
    var = max(between, within)
    degenerate = (not var > 0) or p == 0 or p == 1
    neff = float(g) if degenerate else min(float(runs), max(1.0, p * (1 - p) / var))
    rate = min(max(p, 0.5 / runs), 1 - 0.5 / runs)
    return {"trees": g, "runs": runs, "estimate": p, "pooledRate": pooled, "method": "hierarchical", "lower": h["lower"], "upper": h["upper"], "designEffect": runs / neff, "effectiveRuns": neff, "degenerate": degenerate, "detectableDrop": mde_ref(neff, rate)}


golden_cases = [
    [(5, 5), (5, 3), (5, 0), (5, 4), (5, 2), (5, 5)],
    [(10, 9), (2, 1), (4, 4), (6, 2)],
    [(3, 3), (3, 3), (3, 3), (3, 3)],
    [(4, 0), (4, 0), (4, 0)],
    [(5, 4)],
    [(1, 1), (1, 0), (1, 1), (1, 1), (1, 0), (1, 1), (1, 1), (1, 1)],
    [(8, 6), (8, 7), (8, 1), (8, 8), (8, 5), (8, 2), (8, 6), (8, 7), (8, 3), (8, 8)],
    [(20, 18), (2, 0), (2, 1)],
]
put("suiteHeadline", "the headline of headline.ts restated here: hier_ref, the mean-of-means variance, scipy brentq for mde", [{"goldens": [{"n": n, "k": k} for n, k in gs], "expected": headline_ref(gs)} for gs in golden_cases])

cr = []
for gs in [
    [(6, 4), (6, 5), (6, 1), (6, 6), (6, 2)],
    [(5, 5), (5, 0), (5, 3), (5, 4)],
    [(10, 7), (3, 3), (8, 2), (1, 1), (12, 9), (4, 0)],
    [(4, 4), (4, 4), (4, 4)],
    [(4, 0), (4, 0)],
    [(1, 1), (1, 0), (1, 1)],
    [(7, 3)],
]:
    g = len(gs)
    runs = sum(n for n, _ in gs)
    passes = sum(k for _, k in gs)
    if g < 2 or all(n == 1 for n, _ in gs):
        cr.append({"counts": [{"n": n, "k": k} for n, k in gs], "expected": None})
    elif passes in (0, runs):
        value = 0 if passes == 0 else 1
        lo, hi = wilson_k(g if value == 1 else 0, g, Z95)
        cr.append({"counts": [{"n": n, "k": k} for n, k in gs], "expected": {"estimate": float(value), "lower": lo, "upper": hi, "method": "wilson, clusters", "n": runs, "clusters": g}})
    else:
        w = wilson_effective_ref(gs, 0.05, "t")
        cr.append({"counts": [{"n": n, "k": k} for n, k in gs], "expected": {"estimate": passes / runs, "lower": w["lower"], "upper": w["upper"], "method": "wilson, design effect", "n": runs, "clusters": g, "designEffect": w["designEffect"], "effectiveN": w["effectiveN"]}})
put("clusterRate", "estimate.ts clusterRate restated here with wilson_effective_ref and the all-agree and singleton rules", cr)

doc = {
    "provenance": {
        "script": "packages/validators/fixtures/stats/make_exact.py",
        "python": "3",
        "numpy": np.__version__,
        "scipy": scipy.__version__,
        "z95": Z95,
        "sources": prov,
    },
    **out,
}
with open(OUT, "w") as fh:
    json.dump(doc, fh, indent=1, allow_nan=False)
print("wrote", OUT, {k: len(v) for k, v in out.items()})
