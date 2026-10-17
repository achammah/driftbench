"""Exact two-sample Kolmogorov-Smirnov p-values deep in the tail, from exact integer arithmetic.

Run with Python plus numpy and scipy (scipy 1.18.1 when generated). Each case is a pair of samples whose
merged order is fixed by construction. Its exact p-value is the number of lattice paths from (0, 0) to (m, n)
that touch the band |i n - j m| >= D m n, divided by C(m + n, m): the paths staying inside are counted with
integers (no rounding), and the quotient is a fraction rounded once to a double. scipy.stats.ks_2samp with
method="exact" must agree to 1e-12 relative, or the script stops.
"""

import json
from fractions import Fraction
from math import comb
from pathlib import Path

import scipy
from scipy import stats


def exact_p(m, n, gap):
    """P(a random lattice path leaves the band), with the band |i*n - j*m| < gap, as an exact fraction."""
    prev = [0] * (n + 1)
    for i in range(m + 1):
        cur = [0] * (n + 1)
        for j in range(n + 1):
            if abs(i * n - j * m) >= gap:
                cur[j] = 0
            elif i == 0 and j == 0:
                cur[j] = 1
            else:
                cur[j] = (prev[j] if i > 0 else 0) + (cur[j - 1] if j > 0 else 0)
        prev = cur
    total = comb(m + n, m)
    return Fraction(total - prev[n], total)


def samples(m, n, lead):
    """The first `lead` x values come before every y; the rest alternate, y first. Values are 0, 1, 2, ..."""
    order = ["x"] * lead
    i, j = lead, 0
    while i < m or j < n:
        if j < n:
            order.append("y")
            j += 1
        if i < m:
            order.append("x")
            i += 1
    a = [float(t) for t, c in enumerate(order) if c == "x"]
    b = [float(t) for t, c in enumerate(order) if c == "y"]
    return a, b


CASES = [
    (20, 20, 20),
    (30, 30, 24),
    (40, 40, 28),
    (60, 60, 40),
    (100, 100, 60),
    (25, 40, 22),
    (100, 100, 45),
    (150, 150, 70),
    (300, 200, 130),
    (40, 40, 14),
    (50, 50, 6),
]

results = []
for m, n, lead in CASES:
    a, b = samples(m, n, lead)
    ref = stats.ks_2samp(a, b, method="exact")
    gap = round(ref.statistic * m * n)
    p = exact_p(m, n, gap)
    assert abs(Fraction(ref.pvalue) - p) <= p * Fraction(1, 10**12), (m, n, lead, ref.pvalue, float(p))
    results.append(dict(m=m, n=n, a=a, b=b, statistic=ref.statistic, pValue=float(p)))

artifact = dict(
    method="lattice paths staying inside the band, counted in integers; p = 1 - inside / C(m + n, m) as a fraction",
    dependencies=dict(scipy=scipy.__version__),
    cases=results,
)
out = Path(__file__).with_name("ks-tail.json")
out.write_text(json.dumps(artifact, indent=2, allow_nan=False) + "\n")
print(f"wrote {out}")
