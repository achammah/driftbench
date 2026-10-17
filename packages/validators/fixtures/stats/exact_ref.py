"""Reference functions for the exact items of the statistics bank, computed without the TypeScript package.

Imported by make_exact.py and make_exact_branches.py. Each function restates a documented formula (or calls scipy,
numpy or the standard library); none reads or calls any file of packages/stats.
"""

import math
from fractions import Fraction

import numpy as np
from scipy import optimize, special, stats

M32 = 0xFFFFFFFF
Z95 = float(stats.norm.ppf(0.975))


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


def hill_ref(c, q):
    p = np.array([x for x in c if x > 0], dtype=float)
    p = p / p.sum()
    if q == 0:
        return float(len(p))
    if q == 1:
        return float(np.exp(-(p * np.log(p)).sum()))
    return float(((p**q).sum()) ** (1 / (1 - q)))


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


def mde_ref(n_eff, p1, power=0.8, alpha=0.05):
    za = float(stats.norm.isf(alpha / 2))
    zb = float(stats.norm.ppf(power))

    def gap(delta):
        p2 = p1 - delta
        pbar = (p1 + p2) / 2
        return za * math.sqrt(2 * pbar * (1 - pbar)) + zb * math.sqrt(p1 * (1 - p1) + p2 * (1 - p2)) - delta * math.sqrt(n_eff)

    if p1 == 0 or gap(p1) > 0:
        return None
    # At a baseline of 1 the gap is exactly 0 at delta = 0 (a trivial root), so the bracket starts just above it.
    lo = 0.0 if gap(0.0) > 0 else 1e-12
    return float(optimize.brentq(gap, lo, p1, xtol=1e-15, rtol=1e-15))


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
