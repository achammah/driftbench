"""Incomplete beta, chi-square and binomial references at large shape, from 50-digit sums of integer identities.

Run with Python plus mpmath and scipy (mpmath 1.4.1 and scipy 1.18.1 when generated). Every reference is a direct
sum of probability masses at 50 digits, walking outward from the mode with the exact term ratio, so it shares no
code, no log-gamma and no continued fraction with the TypeScript functions:

  - binomial cdf    P(X <= k), X ~ Bin(n, p): the sum of the masses;
  - incomplete beta I_x(a, b) for integer a and b: P(Bin(a + b - 1, x) >= a);
  - chi-square sf   Q(df / 2, x / 2) for even df: P(Poisson(x / 2) <= df / 2 - 1).

p and x are the exact doubles. scipy (Boost) is a cross-check only: it differs from the sums by up to 2e-9 at
n or df of 1e7, so it is held to 1e-8 here and the sums are the reference. The chi-square sums are also checked
against mpmath's own regularized gammainc to 1e-25.
"""

import json
from pathlib import Path

import mpmath
import scipy
from mpmath import exp, loggamma, log, mp, mpf
from scipy import special, stats

mp.dps = 50
STOP = mpf(10) ** -48


def _binomial_pmf(j, n, p, q):
    return exp(loggamma(n + 1) - loggamma(j + 1) - loggamma(n - j + 1) + j * log(p) + (n - j) * log(q))


def binom_cdf(k, n, p):
    """P(X <= k)."""
    p = mpf(p)
    q = 1 - p
    if k >= n:
        return mpf(1)
    mode = min(n, max(0, int((n + 1) * p)))
    start = min(k, mode)
    first = _binomial_pmf(start, n, p, q)
    total, term, j = mpf(0), first, start
    while True:  # downward from `start`
        total += term
        if j == 0:
            break
        term = term * j / (n - j + 1) * q / p
        j -= 1
        if term < total * STOP and j < start - 5:
            break
    if k > mode:  # upward from the mode to k
        term, j = first, start
        while j < k:
            term = term * (n - j) / (j + 1) * p / q
            j += 1
            total += term
            if term < total * STOP and j > start + 5:
                break
    return total


def binom_upper(k, n, p):
    """P(X > k), summed upward from k + 1 when that is in the upper half, so a tiny tail keeps its digits."""
    p = mpf(p)
    q = 1 - p
    mode = min(n, max(0, int((n + 1) * p)))
    if k + 1 <= mode:
        return 1 - binom_cdf(k, n, p)
    term, j, total = _binomial_pmf(k + 1, n, p, q), k + 1, mpf(0)
    while True:
        total += term
        if j == n:
            break
        term = term * (n - j) / (j + 1) * p / q
        j += 1
        if term < total * STOP and j > k + 6:
            break
    return total


def poisson_cdf(k, lam):
    """P(Poisson(lam) <= k)."""
    lam = mpf(lam)
    mode = int(lam)
    start = min(k, mode)
    first = exp(start * log(lam) - lam - loggamma(start + 1))
    total, term, j = mpf(0), first, start
    while True:
        total += term
        if j == 0:
            break
        term = term * j / lam
        j -= 1
        if term < total * STOP and j < start - 5:
            break
    if k > mode:
        term, j = first, start
        while j < k:
            term = term * lam / (j + 1)
            j += 1
            total += term
            if term < total * STOP and j > start + 5:
                break
    return total


def check(name, exact, other, tolerance=1e-8):
    if exact > 1e-250 and abs(float(exact) - other) > tolerance * float(exact):
        raise AssertionError(f"{name}: exact {float(exact)!r} against scipy {other!r}")


beta_cases = []
SHAPES = [(1e4, 1e4), (1e4, 3e4), (5e4, 5e4), (1e5, 1e5), (1e6, 1e6), (1e6, 3e6), (1e7, 1e7), (1, 1e6), (1e4, 2), (100, 100), (30, 70)]
for a, b in SHAPES:
    a, b = int(a), int(b)
    mean = a / (a + b)
    sd = (a * b / ((a + b) ** 2 * (a + b + 1))) ** 0.5
    for z in (-6, -3, -1, 0, 0.5, 2, 5):
        x = mean + z * sd
        if not 0 < x < 1:
            continue
        # I_x(a, b) = P(Bin(a + b - 1, x) >= a)
        exact = binom_upper(a - 1, a + b - 1, x)
        check(f"I({x}; {a}, {b})", exact, float(special.betainc(a, b, x)))
        beta_cases.append(dict(x=x, a=a, b=b, expected=float(exact)))

chi_cases = []
for df in (1000, 10000, 100000, 1000000, 10000000):
    for z in (-5, -2, 0, 1, 4, 8):
        x = df + z * (2 * df) ** 0.5
        exact = poisson_cdf(df // 2 - 1, mpf(x) / 2)
        check(f"chi2.sf({x}, {df})", exact, float(stats.chi2.sf(x, df)))
        reference = mpmath.gammainc(mpf(df // 2), mpf(x) / 2, mpf("inf"), regularized=True)
        assert abs(exact - reference) <= abs(exact) * mpf(10) ** -25, (x, df)
        chi_cases.append(dict(x=x, df=df, expected=float(exact)))

binom_cases = []
for n in (51, 60, 101, 200, 1000, 5000, 100000, 1000000, 10000000):
    for p in (0.5, 0.01, 0.3, 0.9):
        mean, sd = n * p, (n * p * (1 - p)) ** 0.5
        for z in (-8, -3, -1, 0, 2):
            k = int(mean + z * sd)
            if k < 0 or k >= n:
                continue
            exact = binom_cdf(k, n, p)
            check(f"binom.cdf({k}, {n}, {p})", exact, float(stats.binom.cdf(k, n, p)))
            binom_cases.append(dict(k=k, n=n, p=p, expected=float(exact)))
# n = 1e9: the old loop over k terms takes about a minute here
giant = []
for z in (-1, 0):
    k = int(5e8 + z * (1e9 * 0.25) ** 0.5)
    giant.append(dict(k=k, n=10**9, p=0.5, expected=float(binom_cdf(k, 10**9, 0.5))))
# deep lower tails: k = 0, 1, 2 at n = 1000 and p = 0.5 (about 1e-301 to 1e-298)
for k in (0, 1, 2):
    binom_cases.append(dict(k=k, n=1000, p=0.5, expected=float(binom_cdf(k, 1000, 0.5))))

# The deviance term bd0(x, np) = x log(x / np) + np - x at 60 digits, on both sides of the 10 percent window where
# the code switches from the direct form to a series. x and np are exact doubles.
mp.dps = 60
bd0_cases = []
for x in (1e8, 1e10):
    for ratio in (0.5, 0.8, 0.9, 0.95, 0.99, 1.0, 1.01, 1.05, 1.1, 1.15, 1.3, 2.0):
        np_ = x * ratio
        value = mpf(x) * log(mpf(x) / mpf(np_)) + mpf(np_) - mpf(x)
        bd0_cases.append(dict(x=x, np=np_, expected=float(value)))
mp.dps = 50

artifact = dict(
    method="50-digit sums of probability masses from the mode (binomial, Poisson); incomplete beta and chi-square sf through their integer identities",
    dependencies=dict(mpmath=mpmath.__version__, scipy=scipy.__version__),
    incompleteBeta=beta_cases,
    chiSquareSf=chi_cases,
    binomialCdf=binom_cases,
    binomialCdfGiant=giant,
    bd0=bd0_cases,
)
out = Path(__file__).with_name("prefactor.json")
out.write_text(json.dumps(artifact, allow_nan=False) + "\n")
print(f"wrote {out}: {len(beta_cases)} beta, {len(chi_cases)} chi-square, {len(binom_cases)} binomial")
