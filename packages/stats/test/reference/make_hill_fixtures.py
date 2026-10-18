"""Hill-number fixtures at large q, from exact rational arithmetic.

Run with Python plus mpmath (1.4.1 when generated). The sum of p^q over the class shares p = c / n is formed
exactly with fractions.Fraction (q integer) or to 80 digits (q fractional), so no cancellation is possible; the
order-q Hill number is that sum raised to 1 / (1 - q), taken at 80 digits and rounded once to a double.
"""

import json
from fractions import Fraction
from pathlib import Path

import mpmath
from mpmath import mp, mpf

mp.dps = 80

CASES = [
    ("three heavy classes, three light", [100, 90, 80, 10, 5, 1]),
    ("two heavy, four light", [40, 30, 20, 5, 3, 2]),
    ("one dominant class", [1, 1, 1, 1, 1, 1, 1, 1, 50]),
    ("uniform", [7, 7, 7, 7]),
    ("single class", [12]),
    ("zero count skipped", [30, 0, 20, 10]),
    ("many near-equal classes", list(range(90, 110))),
]
QS = [20, 50, 100, 400, 2000, 2.5, 8.25]

results = []
for name, counts in CASES:
    n = sum(counts)
    for q in QS:
        if float(q).is_integer():
            total = sum(Fraction(c, n) ** int(q) for c in counts if c > 0)
            s = mpf(total.numerator) / mpf(total.denominator)
        else:
            s = sum((mpf(c) / n) ** mpf(q) for c in counts if c > 0)
        expected = float(s ** (1 / (1 - mpf(q))))
        results.append(dict(name=name, counts=counts, q=q, expected=expected))

artifact = dict(
    method="exact rational sum of p^q (integer q) or 80-digit sum (fractional q), raised to 1 / (1 - q)",
    dependencies=dict(mpmath=mpmath.__version__),
    cases=results,
)
out = Path(__file__).with_name("hill.json")
out.write_text(json.dumps(artifact, indent=2, allow_nan=False) + "\n")
print(f"wrote {out}")
