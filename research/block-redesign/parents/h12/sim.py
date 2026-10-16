"""H12 simulation. Offline. See PREREG.md for the design; nothing here is tuned after seeing results.

Usage: python3 sim.py a|b|hier|example   (writes results_<part>.json next to this file)
"""
import itertools
import json
import math
import sys
from multiprocessing import Pool
from pathlib import Path

import numpy as np
from scipy.special import gammaln

HERE = Path(__file__).parent
SEED = 12
REPS = 5000
Z = 1.959963984540054


# ---------------------------------------------------------------- Part A
def load_forest():
    f = json.loads((HERE / 'forest.json').read_text())
    nodes = f['nodes']
    parent = np.array([n['parent'] for n in nodes])
    nspecs = np.array([len(n['specIds']) for n in nodes])
    return f, parent, nspecs


def descendants(parent):
    kids = {}
    for v, p in enumerate(parent):
        if p >= 0:
            kids.setdefault(int(p), []).append(v)
    return kids


def red_set(rng, planted, parent, rho_det, h, eps):
    reps, n = planted.shape
    own = (planted & (rng.random((reps, n)) < rho_det)) | (rng.random((reps, n)) < eps)
    inh = rng.random((reps, n)) < h
    red = np.zeros((reps, n), dtype=bool)
    for v in range(n):
        p = parent[v]
        red[:, v] = own[:, v] | ((red[:, p] & inh[:, v]) if p >= 0 else False)
    return red


def counters(rng, red, planted, parent, nspecs, rho_resc, eps):
    reps, n = red.shape
    parent_red = np.zeros_like(red)
    for v in range(n):
        if parent[v] >= 0:
            parent_red[:, v] = red[:, parent[v]]
    roots = red & ~parent_red
    under = red & parent_red
    resc_fail = (planted & (rng.random((reps, n)) < rho_resc)) | (~planted & (rng.random((reps, n)) < eps))
    return {
        'flat_old': (red * nspecs).sum(1),
        'flat_linked': red.sum(1),
        'grouped': roots.sum(1),
        'grouped_rescue': roots.sum(1) + (under & resc_fail).sum(1),
    }


def part_a():
    f, parent, nspecs = load_forest()
    n = len(parent)
    stem = np.where(nspecs >= 2)[0]
    out = {'cells': [], 'forest': f['summary']}
    cell_i = 0
    for frame, N, h, eps in itertools.product(['U', 'S'], [1, 2, 3, 5, 8], [1.0, 0.5], [0.0, 0.01]):
        rng = np.random.default_rng([SEED, 1, cell_i])
        cell_i += 1
        cand = np.arange(n) if frame == 'U' else stem
        r = rng.random((REPS, len(cand)))
        pick = np.argsort(r, axis=1)[:, :N]
        planted = np.zeros((REPS, n), dtype=bool)
        np.put_along_axis(planted, cand[pick], True, axis=1)
        red = red_set(rng, planted, parent, 0.9, h, eps)
        c = counters(rng, red, planted, parent, nspecs, 0.9, eps)
        cell = {'frame': frame, 'N': N, 'h': h, 'eps': eps, 'rho_det': 0.9, 'rho_resc': 0.9}
        err = {k: np.abs(v - N) for k, v in c.items()}
        for k, v in c.items():
            cell[k] = {'mean_count': float(v.mean()), 'mae': float(err[k].mean()), 'share_exact': float((v == N).mean())}
        # paired difference grouped - flat_linked in absolute error, bootstrap over repeats
        for other in ['flat_linked', 'flat_old']:
            d = err['grouped'] - err[other]
            bs = [d[rng.integers(0, REPS, REPS)].mean() for _ in range(1000)]
            cell[f'paired_grouped_minus_{other}'] = {
                'mean': float(d.mean()),
                'ci95': [float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5))],
            }
        out['cells'].append(cell)

    # hidden-fault cell: a pair (v, w), w a strict descendant of v
    kids = descendants(parent)
    desc = {}

    def collect(v):
        if v in desc:
            return desc[v]
        acc = []
        for k in kids.get(v, []):
            acc.append(k)
            acc.extend(collect(k))
        desc[v] = acc
        return acc

    for v in range(n):
        collect(v)
    inner = [v for v in range(n) if desc[v]]
    hidden = {}
    for rho_resc in [1.0, 0.9]:
        rng = np.random.default_rng([SEED, 2, int(rho_resc * 10)])
        walk1 = resc2 = 0
        for _ in range(REPS):
            v = inner[rng.integers(len(inner))]
            w = desc[v][rng.integers(len(desc[v]))]
            planted = np.zeros((1, n), dtype=bool)
            planted[0, [v, w]] = True
            red = red_set(rng, planted, parent, 1.0, 1.0, 0.0)
            c = counters(rng, red, planted, parent, nspecs, rho_resc, 0.0)
            walk1 += int(c['grouped'][0] == 1)
            resc2 += int(c['grouped_rescue'][0] == 2)
        hidden[str(rho_resc)] = {'repeats': REPS, 'walk_reports_1_root': walk1 / REPS, 'rescue_reports_2': resc2 / REPS}
    out['hidden_fault'] = hidden
    (HERE / 'results_a.json').write_text(json.dumps(out, indent=1))
    print('part A done', len(out['cells']), 'cells')


# ---------------------------------------------------------------- Part B
def real_sizes():
    f, parent, _ = load_forest()
    root = {}
    for v, p in enumerate(parent):
        root[v] = v if p < 0 else root[p]
    from collections import Counter

    return np.array(sorted(Counter(root.values()).values()))


def wilson(p, n):
    z2 = Z * Z
    denom = 1 + z2 / n
    centre = (p + z2 / (2 * n)) / denom
    half = Z * np.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / denom
    return centre - half, centre + half


def draw(rng, G, scheme, theta, d, reps, sizes_pool):
    if scheme == 'real':
        n_g = sizes_pool[rng.integers(0, len(sizes_pool), (reps, G))]
    else:
        n_g = np.full((reps, G), int(scheme[1:]))
    a, b = d * theta, d * (1 - theta)
    th = rng.beta(a, b, (reps, G))
    k_g = rng.binomial(n_g, th)
    return n_g, k_g


def intervals(rng, n_g, k_g):
    reps, G = n_g.shape
    n = n_g.sum(1)
    K = k_g.sum(1)
    p = K / n
    se_n = np.sqrt(p * (1 - p) / n)
    res = {}
    res['naive_wald'] = (p - Z * se_n, p + Z * se_n)
    res['naive_wilson'] = wilson(p, n)
    S = ((k_g - n_g * p[:, None]) ** 2).sum(1)
    se_cl = np.sqrt(S) / n * math.sqrt(G / (G - 1))
    res['cl_wald'] = (p - Z * se_cl, p + Z * se_cl)
    with np.errstate(divide='ignore', invalid='ignore'):
        deff = np.where(se_n > 0, (se_cl / se_n) ** 2, 1.0)
    deff = np.clip(deff, 1.0, n)
    res['cl_wilson_neff'] = wilson(p, n / deff)
    lo = np.empty(reps)
    hi = np.empty(reps)
    B = 400
    for s in range(0, reps, 100):
        sl = slice(s, min(s + 100, reps))
        nn, kk = n_g[sl], k_g[sl]
        idx = rng.integers(0, G, (nn.shape[0], B, G))
        nb = np.take_along_axis(nn[:, None, :].repeat(B, 1), idx, 2).sum(2)
        kb = np.take_along_axis(kk[:, None, :].repeat(B, 1), idx, 2).sum(2)
        pb = kb / nb
        lo[sl] = np.percentile(pb, 2.5, axis=1)
        hi[sl] = np.percentile(pb, 97.5, axis=1)
    res['boot'] = (lo, hi)
    return res


def run_cell_b(args):
    i, G, scheme, theta, d = args
    rng = np.random.default_rng([SEED, 3, i])
    pool = real_sizes()
    n_g, k_g = draw(rng, G, scheme, theta, d, REPS, pool)
    res = intervals(rng, n_g, k_g)
    out = {'G': G, 'size': scheme, 'theta': theta, 'd': d, 'methods': {}}
    for m, (lo, hi) in res.items():
        cover = (lo <= theta) & (theta <= hi)
        out['methods'][m] = {
            'coverage': float(cover.mean()),
            'width': float(np.mean(hi - lo)),
            'degenerate': float(np.mean((hi - lo) <= 1e-12)),
        }
    return out


def part_b():
    cells = [
        (i, G, s, th, d)
        for i, (G, s, th, d) in enumerate(
            itertools.product([6, 12, 25, 50, 143], ['m1', 'm3', 'm8', 'real'], [0.6, 0.9], [0.5, 2, 8, 1000])
        )
    ]
    with Pool(3) as p:
        out = p.map(run_cell_b, cells, chunksize=4)
    (HERE / 'results_b.json').write_text(json.dumps(out, indent=1))
    print('part B done', len(out), 'cells')


# ---------------------------------------------------------------- hierarchical
TH = (np.arange(100) + 0.5) / 100
DG = np.exp(np.linspace(math.log(0.02), math.log(60), 40))
AA = (DG[None, :] * TH[:, None]).ravel()  # d*theta
BB = (DG[None, :] * (1 - TH[:, None])).ravel()
DD = np.broadcast_to(DG[None, :], (100, 40)).ravel()
# prior over the grid: theta uniform; d ~ Gamma(1,1) = Exp(1) with log-grid weights d * pdf
LOGW = np.broadcast_to(np.log(DG) - DG, (100, 40)).ravel()  # log(d * exp(-d))
BASE = gammaln(DD) - gammaln(AA) - gammaln(BB)


def hier_interval(n_g, k_g):
    # log-likelihood of one rep: sum over trees of beta-binomial (the binomial coefficient does not depend on the grid)
    n = n_g[:, None].astype(float)
    k = k_g[:, None].astype(float)
    ll = (
        gammaln(k + AA[None, :]) + gammaln(n - k + BB[None, :]) - gammaln(n + DD[None, :]) + BASE[None, :]
    ).sum(0)
    lp = ll + LOGW
    w = np.exp(lp - lp.max()).reshape(100, 40).sum(1)
    c = np.cumsum(w) / w.sum()
    lo = TH[np.searchsorted(c, 0.025)]
    hi = TH[min(np.searchsorted(c, 0.975), 99)]
    return lo, hi


def run_cell_h(args):
    i, G, scheme, theta, d = args
    rng = np.random.default_rng([SEED, 4, i])
    pool = real_sizes()
    reps = 1000
    n_g, k_g = draw(rng, G, scheme, theta, d, reps, pool)
    cover = 0
    width = 0.0
    for r in range(reps):
        lo, hi = hier_interval(n_g[r], k_g[r])
        cover += int(lo <= theta <= hi)
        width += hi - lo
    return {'G': G, 'size': scheme, 'theta': theta, 'd': d, 'reps': reps, 'coverage': cover / reps, 'width': width / reps}


def part_hier():
    cells = [
        (i, G, s, th, d)
        for i, (G, s, th, d) in enumerate(itertools.product([12, 50], ['m3', 'real'], [0.6, 0.9], [0.5, 2, 8]))
    ]
    with Pool(3) as p:
        out = p.map(run_cell_h, cells, chunksize=1)
    (HERE / 'results_hier.json').write_text(json.dumps(out, indent=1))
    print('hier done', len(out), 'cells')


# ---------------------------------------------------------------- worked example
def part_example():
    target_p = 26 / 36
    hits = []
    for passes in itertools.combinations_with_replacement(range(7), 6):
        if sum(passes) != 26:
            continue
        s = sum((x - 6 * target_p) ** 2 for x in passes)
        se_cl = math.sqrt(s) / 36
        se_n = math.sqrt(target_p * (1 - target_p) / 36)
        deff = (se_cl / se_n) ** 2
        hits.append({'passes_per_tree': passes, 'se_naive': round(se_n, 4), 'se_cl': round(se_cl, 4), 'deff': round(deff, 3), 'n_eff': round(36 / deff, 2)})
    near = [h for h in hits if abs(h['se_cl'] - 0.1504) < 0.0006]
    (HERE / 'results_example.json').write_text(json.dumps({'matches': near, 'all_arrangements': len(hits)}, indent=1))
    print('example', near)


if __name__ == '__main__':
    {'a': part_a, 'b': part_b, 'hier': part_hier, 'example': part_example}[sys.argv[1]]()
