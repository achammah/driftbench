"""Normal quantiles for p from 1e-299 down to the smallest subnormal, at 80 digits.

Run with Python plus mpmath (1.4.1 when generated). The quantile x of the exact double p solves
log(erfc(-x / sqrt(2)) / 2) = log(p); mpmath's findroot runs at 80 digits from the asymptotic start, and the
root is rounded once to a double. Subnormal p are the exact doubles (float literals), not decimal strings.
"""

import json
from pathlib import Path

import mpmath
from mpmath import erfc, findroot, log, mp, mpf, sqrt

mp.dps = 80


def quantile(p):
    p = mpf(p)
    start = -sqrt(-2 * log(p))
    return findroot(lambda x: log(erfc(-x / sqrt(2)) / 2) - log(p), start, tol=mpf(10) ** -60)


PS = [
    1e-299, 1e-300, 1e-301, 1e-305, 1e-308, 2.2250738585072014e-308, 1e-309, 1e-310, 1e-311, 1e-312,
    1e-313, 1e-314, 1e-315, 1e-318, 1e-320, 1e-322, 1e-323, 2.5e-323, 5e-324,
]
cases = [dict(p=p, expected=float(quantile(p))) for p in PS]
artifact = dict(
    method="findroot on log(erfc(-x / sqrt(2)) / 2) = log(p) at 80 digits",
    dependencies=dict(mpmath=mpmath.__version__),
    cases=cases,
)
out = Path(__file__).with_name("normal-tail.json")
out.write_text(json.dumps(artifact, indent=2, allow_nan=False) + "\n")
print(f"wrote {out}")
