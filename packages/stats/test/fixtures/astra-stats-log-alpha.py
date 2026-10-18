"""Independent Decimal (100-digit) normal tails and documented interval/power equations.

Normal upper tails use the alternating Mills expansion with an omitted term below
1e-100 relative at these z > 37 inputs. The central normal CDF uses its convergent
Taylor integral. No driftbench implementation or binary64 tail probability is used.
"""
import json
from decimal import Decimal as D, ROUND_CEILING, getcontext
from pathlib import Path

getcontext().prec = 110

def atan(x):
    return sum(((-1) ** k * x ** (2 * k + 1) / (2 * k + 1) for k in range(200)), D(0))

PI = 16 * atan(D(1) / 5) - 4 * atan(D(1) / 239)
SQRT2PI = (2 * PI).sqrt()

def sf(z):
    term = D(1)
    total = term
    for k in range(1, 180):
        term *= -D(2 * k - 1) / z**2
        total += term
        if abs(term) < D('1e-105'):
            break
    return (-z*z/2).exp() * total / (z * SQRT2PI)

def central_cdf(z):
    term = z
    total = term
    for k in range(150):
        term *= -z*z * (2*k+1) / (2*(k+1)*(2*k+3))
        total += term
    return D('.5') + total / SQRT2PI

def bisect(predicate, lo, hi):
    for _ in range(370):
        mid = (lo + hi) / 2
        if predicate(mid):
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2

ZPOWER = bisect(lambda z: central_cdf(z) < D('.8'), D(0), D(2))

def wilson(k, n, z):
    p = D(k) / n
    denom = 1 + z*z/n
    centre = (p + z*z/(2*n))/denom
    half = z*(p*(1-p)/n + z*z/(4*n*n)).sqrt()/denom
    return centre-half, centre+half

def power_term(effect, z):
    p1 = D('.73')
    p2 = p1-effect
    pm = (p1+p2)/2
    return z*(2*pm*(1-pm)).sqrt() + ZPOWER*(p1*(1-p1)+p2*(1-p2)).sqrt()

def row(alpha):
    z = bisect(lambda t: sf(t) > alpha/2, D(30), D(50))
    size = int(((power_term(D('.2'),z)/D('.2'))**2).to_integral_value(rounding=ROUND_CEILING))
    effect = bisect(lambda d: power_term(d,z) > d*D(18010).sqrt(), D(0), D('.73'))
    lower, upper = wilson(9, D(15), z)
    a,b,c,d = map(D,[40,2,8,50])
    n = a+b+c+d
    p1,p2=(a+b)/n,(a+c)/n
    l1,u1=wilson(a+b,n,z)
    l2,u2=wilson(a+c,n,z)
    phi=(a*d-b*c-n/2)/((a+b)*(c+d)*(a+c)*(b+d)).sqrt()
    dl1,du1,dl2,du2=p1-l1,u1-p1,p2-l2,u2-p2
    paired_lo=p1-p2-(dl1*dl1-2*phi*dl1*du2+du2*du2).sqrt()
    paired_hi=p1-p2+(du1*du1-2*phi*du1*dl2+dl2*dl2).sqrt()
    # 2x2 table [[4000,1000],[500,4500]]: po=.85, pe=.5, kappa=.7.
    se=(D('.85')*D('.15')/10000).sqrt()/D('.5')
    return dict(alpha=float(alpha), z=float(z), sampleSize=size, mde=float(effect),
      wilson=dict(lower=float(lower),upper=float(upper)),
      paired=dict(lower=float(paired_lo),upper=float(paired_hi)),
      kappa=dict(kappa=.7,se=float(se),lower=float(D('.7')-z*se),upper=float(D('.7')+z*se)))

rows=[row(D(2)**-1074),row(D.from_float(1e-300))]
assert rows[0]['sampleSize']==18010
out={'provenance':'Python Decimal 110-digit arithmetic; exact alpha 2^-1074 and binary64 1e-300; Mills tail, normal CDF Taylor integral, Wilson/Newcombe/kappa and two-proportion power equations', 'cases':rows}
Path(__file__).with_suffix('.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps(out,indent=2))
