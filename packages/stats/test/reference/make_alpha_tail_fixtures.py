"""Intervals at alpha far below 1e-3, at 80 digits.

Run with Python plus mpmath (1.4.1 when generated). z is the upper quantile of the normal at the exact double
alpha / 2, from findroot on log(erfc(z / sqrt(2)) / 2) = log(alpha / 2). The Wilson limits and Newcombe's hybrid
score interval for paired data (method 10, phi corrected by n / 2 when ad - bc is positive) are then evaluated at 80 digits and rounded
once. The Newcombe evaluation is checked here against test/reference/newcombe.json (statsmodels), case by case at the
alpha each case carries, to 1e-9; the script stops if it differs.
"""

import json
from pathlib import Path

import mpmath
from mpmath import erfc, findroot, log, mp, mpf, sqrt

mp.dps = 80


def z_for(alpha):
    half = mpf(alpha) / 2
    start = sqrt(-2 * log(half))
    return findroot(lambda z: log(erfc(z / sqrt(2)) / 2) - log(half), start, tol=mpf(10) ** -60)


def wilson(k, n, z):
    k, n = mpf(k), mpf(n)
    p = k / n
    z2 = z * z
    denom = 1 + z2 / n
    centre = (p + z2 / (2 * n)) / denom
    half = (z / denom) * sqrt(p * (1 - p) / n + z2 / (4 * n * n))
    return max(mpf(0), centre - half), min(mpf(1), centre + half)


def newcombe(a, b, c, d, alpha):
    a, b, c, d = map(mpf, (a, b, c, d))
    n = a + b + c + d
    z = z_for(alpha)
    p1, p2 = (a + b) / n, (a + c) / n
    l1, u1 = wilson(a + b, n, z)
    l2, u2 = wilson(a + c, n, z)
    product = (a + b) * (c + d) * (a + c) * (b + d)
    covariance = a * d - b * c
    corrected = max(mpf(0), covariance - n / 2) if covariance > 0 else covariance
    phi = mpf(0) if product == 0 else corrected / sqrt(product)
    dl1, du1, dl2, du2 = p1 - l1, u1 - p1, p2 - l2, u2 - p2
    delta = sqrt(max(mpf(0), dl1 * dl1 - 2 * phi * dl1 * du2 + du2 * du2))
    epsilon = sqrt(max(mpf(0), du1 * du1 - 2 * phi * du1 * dl2 + dl2 * dl2))
    estimate = p1 - p2
    return estimate, max(mpf(-1), estimate - delta), min(mpf(1), estimate + epsilon)


here = Path(__file__).parent

# The mp evaluation reproduces statsmodels on the committed Newcombe cases.
for case in json.loads((here / "newcombe.json").read_text())["cases"]:
    _, lower, upper = newcombe(case["bothPass"], case["regressed"], case["improved"], case["bothFail"], case["alpha"])
    assert abs(float(lower) - case["lower"]) < 1e-9 and abs(float(upper) - case["upper"]) < 1e-9, case["name"]

ALPHAS = [0.3, 0.05, 1e-3, 1e-8, 1e-10, 1e-12, 1e-14, 1e-16, 1e-17, 1e-20, 1e-50, 1e-100, 1e-300]
z_cases = [dict(alpha=a, expected=float(z_for(a))) for a in ALPHAS]

PAIRS = [(10, 5, 2, 20), (2, 5, 0, 23), (50, 0, 0, 10), (12, 2, 9, 1)]
paired_cases = []
for alpha in (1e-12, 1e-16, 1e-17, 1e-20, 1e-100):
    for a, b, c, d in PAIRS:
        estimate, lower, upper = newcombe(a, b, c, d, alpha)
        paired_cases.append(dict(bothPass=a, regressed=b, improved=c, bothFail=d, alpha=alpha,
                                 estimate=float(estimate), lower=float(lower), upper=float(upper)))

wilson_cases = []
for alpha in (1e-12, 1e-17, 1e-20, 1e-100):
    for k, n in ((7, 20), (13, 40), (1, 60)):
        lower, upper = wilson(k, n, z_for(alpha))
        wilson_cases.append(dict(k=k, n=n, alpha=alpha, lower=float(lower), upper=float(upper)))

def mde(n, p1, alpha, power):
    """The smallest detectable drop in a pass rate: the root of the power equation of stats.mde, at 60 digits."""
    za = z_for(alpha)
    zb = z_for(2 * (1 - mpf(power)))  # z_for halves its argument; the quantile at power is the upper quantile at 1 - power
    n, p1 = mpf(n), mpf(p1)

    def gap(delta):
        p2 = p1 - delta
        pbar = (p1 + p2) / 2
        return za * sqrt(2 * pbar * (1 - pbar)) + zb * sqrt(p1 * (1 - p1) + p2 * (1 - p2)) - delta * sqrt(n)

    lo, hi = mpf(0), p1
    for _ in range(200):
        mid = (lo + hi) / 2
        if gap(mid) > 0:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


mde_cases = [dict(n=5000, baselineRate=0.5, power=0.8, alpha=a, expected=float(mde(5000, 0.5, a, 0.8)))
             for a in (0.05, 1e-10, 1e-17, 1e-20, 1e-50)]

artifact = dict(
    method="normal quantile by findroot at 80 digits; Wilson and Newcombe method 10 evaluated at 80 digits",
    dependencies=dict(mpmath=mpmath.__version__),
    z=z_cases,
    paired=paired_cases,
    wilsonSingleCluster=wilson_cases,
    mde=mde_cases,
)
out = here / "alpha-tail.json"
out.write_text(json.dumps(artifact, indent=2, allow_nan=False) + "\n")
print(f"wrote {out}")
