"""Failing-by-construction cases for the defects the differential sweep found (validators/stats/NEEDS.md, batch 10).

Run from the repository root:  python3 packages/validators/fixtures/stats/make_exact_defects.py
Then format the output:        npx biome format --write packages/validators/fixtures/stats/exact-defects.json

Every expected value is computed here, never by the TypeScript: scipy, the standard library, 80-digit decimals or
exact rational arithmetic. The cases were chosen where the statistics package, at the commit the sweep ran on,
returned a value off by more than 1e-9 relative (or NaN, Infinity, or no value in time); the sweep is a random
differential test of about 12,000 cases and its seed is in this file.
"""

import json
import math
import os
from decimal import ROUND_CEILING, Decimal, getcontext
from fractions import Fraction
from math import comb

import numpy as np
from exact_ref import Z95, newcombe, wilson_effective_ref, mde_ref
from scipy import special, stats

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "exact-defects.json")
getcontext().prec = 80
out = {}
prov = {}


def put(name, source, cases):
    assert cases, name
    out[name] = cases
    prov[name] = source


def f(x):
    return float(x)


INF = "Infinity"

# 1. hillNumber at large q: the sum of p^q is far below 1 and 1 + sum p (p^(q-1) - 1) cancels.
hill = []
for counts in [[100, 60, 30, 10, 5, 2, 1], [5, 3, 2, 1, 1], [40, 12, 7, 3, 3, 2, 2, 1, 1, 1], [9, 1, 1, 1, 1, 1, 1, 1]]:
    tot = sum(counts)
    for q in [20, 30, 50, 100, 300, 1000]:
        s = sum((Decimal(x) / Decimal(tot)) ** q for x in counts)
        hill.append({"counts": counts, "q": q, "expected": f(s ** (Decimal(1) / Decimal(1 - q)))})
put("hillNumber.large-q", "80-digit decimals: (sum p^q)^(1 / (1 - q))", hill)

# 2. alpha below 2.2e-16: 1 - alpha / 2 rounds to 1, so a quantile taken at 1 - alpha / 2 is Infinity.
alphas = [1e-10, 1e-12, 1e-14, 1e-15, 1e-16, 1e-20, 1e-50, 1e-100]
put("zFor.tiny-alpha", "scipy.stats.norm.isf(alpha / 2)", [{"alpha": a, "expected": f(stats.norm.isf(a / 2))} for a in alphas])
put(
    "wilsonEffective.tiny-alpha",
    "wilson_effective_ref with the normal quantile from scipy.stats.norm.isf",
    [{"clusters": [{"n": 5, "k": 2}, {"n": 5, "k": 4}, {"n": 5, "k": 3}], "alpha": a, "quantile": "z", "expected": wilson_effective_ref([(5, 2), (5, 4), (5, 3)], a, "z")} for a in [1e-12, 1e-16, 1e-20, 1e-50]],
)
put(
    "pairedRateDifference.tiny-alpha",
    "Newcombe's method 10 restated with scipy.stats.norm.isf",
    [{"table": {"bothPass": 40, "regressed": 2, "improved": 8, "bothFail": 50}, "alpha": a, "expected": newcombe(40, 2, 8, 50, a)} for a in [1e-12, 1e-16, 1e-20]],
)
cp = []
for k, n, a in [(5, 100, 1e-20), (5, 100, 1e-16), (0, 50, 1e-18), (50, 50, 1e-18), (30, 200, 1e-20)]:
    lo = 0.0 if k == 0 else f(stats.beta.ppf(a / 2, k, n - k + 1))
    hi = 1.0 if k == n else f(stats.beta.isf(a / 2, k + 1, n - k))
    cp.append({"k": k, "n": n, "alpha": a, "expected": {"estimate": k / n, "lower": lo, "upper": hi}})
put("clopperPearson.tiny-alpha", "scipy.stats.beta.ppf and isf (the Clopper-Pearson limits)", cp)
put(
    "mde.tiny-alpha",
    "mde_ref with the two-sided z from scipy.stats.norm.isf",
    [{"n": 5000.0, "baselineRate": 0.5, "alpha": a, "expected": {"effect": mde_ref(5000.0, 0.5, 0.8, a)}} for a in [1e-12, 1e-16, 1e-20]],
)

# 3. normalQuantile below about 1e-308: the refinement overflows exp(x * x / 2).
put("normalQuantile.subnormal-p", "scipy.stats.norm.ppf", [{"p": p, "expected": f(stats.norm.ppf(p))} for p in [1e-300, 1e-305, 1e-308, 1e-310, 2.9817e-320, 1e-323, 5e-324]])

# 4. betaQuantile in the far tail: bisection stops after 200 halvings (about 6e-61).
bq = []
for p, a, b in [(1e-10, 0.019514986012453522, 0.32391101835279595), (1e-12, 0.02, 0.3), (1e-8, 0.05, 0.1), (1e-6, 0.01, 0.5), (1e-9, 0.03, 0.2), (0.5, 0.01, 0.01)]:
    bq.append({"p": p, "a": a, "b": b, "expected": f(special.betaincinv(a, b, p))})
put("betaQuantile.far-tail", "scipy.special.betaincinv in the region where the quantile is below 1e-60", bq)

# 5-7. the log-gamma prefactor at shapes of 1e4 and more, the chi-square survival function at df ~ 1e6, binomialCdf at n >= 1e6.
sweep = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sweep-seed.txt")
g = np.random.RandomState(20261017)
ib = []
for _ in range(400):
    a = f(10 ** g.uniform(4, 6.5)); b = f(10 ** g.uniform(-2, 0.5))
    mean = a / (a + b); sd = math.sqrt(a * b / ((a + b) ** 2 * (a + b + 1)))
    x = f(min(max(mean + g.uniform(-8, 2) * sd, 1e-300), 1 - 1e-12))
    v = f(special.betainc(a, b, x))
    if 1e-200 < v < 1 - 1e-6:
        ib.append({"x": x, "a": a, "b": b, "expected": v})
put("incompleteBeta.large-shape", "scipy.special.betainc, shapes from 1e4 to 3e6 near the mean", ib[:8])
cs = []
for _ in range(400):
    df = f(10 ** g.uniform(5, 6.5)); x = df + g.uniform(-3, 12) * math.sqrt(2 * df)
    v = f(stats.chi2.sf(x, df))
    if 1e-250 < v < 1 - 1e-6:
        cs.append({"x": f(x), "df": df, "expected": v})
put("chiSquareSf.large-df", "scipy.stats.chi2.sf, df from 1e5 to 3e6 around the mean", cs[:8])
bc = []
for _ in range(400):
    n = int(10 ** g.uniform(6, 7.5)); p = f(10 ** g.uniform(-4, -1))
    mu = n * p; sd = math.sqrt(n * p * (1 - p)); k = int(max(0, round(mu + g.uniform(-6, 3) * sd)))
    v = f(stats.binom.cdf(k, n, p))
    if 1e-250 < v < 1 - 1e-6:
        bc.append({"k": k, "n": n, "p": p, "expected": v})
put("binomialCdf.large-n", "scipy.stats.binom.cdf, n from 1e6 to 3e7", bc[:8])
put(
    "binomialCdf.huge-n-time",
    "scipy.stats.binom.cdf at n = 1e9 and 2e9 (the answer must come in a few seconds, not after a loop over k)",
    [{"k": k, "n": n, "p": p, "expected": f(stats.binom.cdf(k, n, p))} for k, n, p in [(500_000_000, 1_000_000_000, 0.5), (999_000_000, 2_000_000_000, 0.5), (20_000_000, 1_000_000_000, 0.02)]],
)

# 8. ksTest exact: the two samples completely separated give p = 2 / C(m + n, m) exactly.
ks = []
for m, n in [(10, 10), (15, 20), (20, 30), (38, 76), (40, 40), (25, 60)]:
    a = [float(i) for i in range(m)]
    b = [float(m + i) for i in range(n)]
    ks.append({"a": a, "b": b, "expected": {"statistic": 1.0, "pValue": f(Fraction(2, comb(m + n, m)))}})
put("ksTest.separated-samples", "separated samples: D = 1 and p = 2 / C(m + n, m), in exact rational arithmetic", ks)
ks2 = []
for m, n in [(30, 40), (45, 55)]:
    a = [float(2 * i) for i in range(m)]
    b = [float(2 * i + 1) + 2 * (m - 12) for i in range(n)]
    # exact: count of lattice paths staying inside the band, by direct dynamic programming in rationals
    import bisect
    sa, sb = sorted(a), sorted(b)
    allv = sorted(set(a) | set(b))
    gap = 0
    for v in allv:
        i = bisect.bisect_right(sa, v); j = bisect.bisect_right(sb, v)
        gap = max(gap, abs(i * n - j * m))
    cnt = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(m + 1):
        for j in range(n + 1):
            if abs(i * n - j * m) >= gap:
                continue
            if i == 0 and j == 0:
                cnt[i][j] = 1
            else:
                cnt[i][j] = (cnt[i - 1][j] if i > 0 else 0) + (cnt[i][j - 1] if j > 0 else 0)
    p = 1 - Fraction(cnt[m][n], comb(m + n, m))
    ks2.append({"a": a, "b": b, "expected": {"statistic": gap / (m * n), "pValue": f(p)}})
put("ksTest.tail-lattice", "the number of lattice paths inside the band, by dynamic programming in exact rationals (Hodges 1957)", ks2)

doc = {"provenance": {"script": "packages/validators/fixtures/stats/make_exact_defects.py", "numpy": np.__version__, "sources": prov}, **out}
with open(OUT, "w") as fh:
    json.dump(doc, fh, indent=1, allow_nan=False)
print("wrote", OUT, {k: len(v) for k, v in out.items()})
