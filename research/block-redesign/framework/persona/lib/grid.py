"""The persona grid statistics (simuser_model.md 4.1): per cell c/n, Wilson, pass^k; per block worst persona,
spread, the within-cell flip rate from split halves (H11 method), the cross-persona flip rate, the exact
test of equal pass rates, and the persona-sensitivity flag."""
import math, random
from itertools import combinations, product


def wilson(c, n, z=1.96):
    if n == 0:
        return (float("nan"), float("nan"))
    p = c / n
    d = 1 + z * z / n
    m = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (m - h, m + h)


def pass_hat_k(n, c, k):
    return math.comb(c, k) / math.comb(n, k) if n >= k else float("nan")


def exact_equal_rates(counts, n):
    """Freeman-Halton exact test on an r x 2 table (r rows of n trials, counts = passes per row); for r = 2
    this is Fisher's two-sided exact test. p = total probability of tables with the same margins whose
    probability is at most the observed one."""
    r, T = len(counts), sum(counts)
    denom = math.comb(r * n, T)

    def prob(xs):
        return math.prod(math.comb(n, x) for x in xs) / denom

    p_obs = prob(counts)
    tot = 0.0
    for xs in product(range(n + 1), repeat=r - 1):
        last = T - sum(xs)
        if 0 <= last <= n:
            q = prob(list(xs) + [last])
            if q <= p_obs * (1 + 1e-9):
                tot += q
    return min(1.0, tot)


def half_verdicts(outs, k=4):
    """pass^4 verdict on each half of 8 trials (H11): 1 if all 4 passed."""
    return [int(all(outs[:k])), int(all(outs[k:2 * k]))]


def block_flag(cells, alpha=0.05):
    """cells: {persona_id: [bool]*8}. Returns the flag and its parts.
    w = within-cell flip rate: mean over personas of [V(p, A) != V(p, B)].
    x = cross-persona flip rate: mean over persona pairs and the 4 half pairings of [V(p, h) != V(q, h')].
    flag = x > w (spread beats re-run noise) or the exact test p < alpha."""
    ids = sorted(cells)
    V = {p: half_verdicts(cells[p]) for p in ids}
    w = sum(V[p][0] != V[p][1] for p in ids) / len(ids)
    pairs = list(combinations(ids, 2))
    x = sum(V[p][h] != V[q][g] for p, q in pairs for h in (0, 1) for g in (0, 1)) / (4 * len(pairs))
    n = len(cells[ids[0]])
    counts = [sum(cells[p]) for p in ids]
    pval = exact_equal_rates(counts, n)
    rates = {p: sum(cells[p]) / n for p in ids}
    return {"w_within": w, "x_cross": x, "flag_noise": x > w, "exact_p": pval, "flag_exact": pval < alpha,
            "flag": (x > w) or (pval < alpha), "counts": dict(zip(ids, counts)),
            "spread": max(rates.values()) - min(rates.values()),
            "worst": min(ids, key=lambda p: (pass_hat_k(n, sum(cells[p]), 4), p))}


def cluster_bootstrap_mean(per_block, B=2000, seed=1010):
    """per_block: list of per-block values; 95% interval of the mean, resampling blocks."""
    rng = random.Random(seed)
    m = len(per_block)
    vals = sorted(sum(per_block[rng.randrange(m)] for _ in range(m)) / m for _ in range(B))
    return vals[int(0.025 * B)], vals[int(0.975 * B) - 1]


def null_flag_rate(pooled_rates, n_personas, n=8, sims=10000, seed=1012):
    """Probability the flag raises at least one block when every persona shares the block's pooled rate.
    pooled_rates: one per-trial pass rate per block. Also returns the expected number of flagged blocks."""
    rng = random.Random(seed)
    any_flag, total = 0, 0
    for _ in range(sims):
        k = 0
        for p in pooled_rates:
            cells = {f"p{i}": [rng.random() < p for _ in range(n)] for i in range(n_personas)}
            k += block_flag(cells)["flag"]
        any_flag += k > 0
        total += k
    return any_flag / sims, total / sims
