"""Reference values for the aggregate intervals of @agent-nexus/driftbench-report.

Run from the repository root:  python3 packages/report/test/reference/make_aggregate_intervals.py
Writes packages/report/test/reference/aggregate_intervals.json, which aggregate.test.ts reads.

Written independently of the TypeScript, with numpy and scipy. For goldens of n_c runs with k_c successes:
- p = sum k / sum n, the pooled rate the aggregate reports.
- a rate of exactly 0 or 1 has no spread to measure: each golden counts once, with the normal-quantile Wilson
  interval on g goldens (the report's `wilson, clusters`).
- variance = g / (g - 1) * sum (k_c - p n_c)^2 / n^2, the cluster-robust ratio estimator with the small-cluster
  factor, and n_eff = p (1 - p) / variance kept within 1 to n.
- the Wilson score interval on n_eff with the Student t quantile on g - 1 degrees of freedom.
- `needed`: the smallest whole number of copies of the given goldens (2, 3, ...) whose interval lies wholly on one
  side of the threshold; the pass rate and the spread between goldens stay as they are, and the interval narrows
  with every copy.
"""

import json
from pathlib import Path

import numpy as np
from scipy import stats

ALPHA = 0.05


def interval(clusters):
    g = len(clusters)
    n = sum(c[0] for c in clusters)
    k = sum(c[1] for c in clusters)
    p = k / n
    if p in (0.0, 1.0):
        n_eff = float(g)
        t = stats.norm.ppf(1 - ALPHA / 2)
    else:
        ss = sum((ck - p * cn) ** 2 for cn, ck in clusters)
        var = g / (g - 1) * ss / n**2
        n_eff = n if var <= 0 else min(n, max(1.0, p * (1 - p) / var))
        t = stats.t.ppf(1 - ALPHA / 2, g - 1)
    z2 = t * t
    centre = (p + z2 / (2 * n_eff)) / (1 + z2 / n_eff)
    half = t * np.sqrt(p * (1 - p) / n_eff + z2 / (4 * n_eff**2)) / (1 + z2 / n_eff)
    return dict(
        n=n, k=k, goldens=g, estimate=p, lower=max(0.0, float(centre - half)), upper=min(1.0, float(centre + half)),
        effectiveRuns=float(n_eff), designEffect=float(n / n_eff),
    )


def needed(clusters, threshold):
    """Smallest number of copies of the goldens (2, 3, ...) whose interval is wholly on one side of the threshold."""
    for copies in range(2, 1001):
        got = interval(clusters * copies)
        if got["lower"] >= threshold or got["upper"] < threshold:
            return dict(goldens=len(clusters) * copies, runs=got["n"])
    return None


CASES = {
    # four goldens of 6, 6, 5 and 4 runs
    "spread": [(6, 5), (6, 2), (5, 4), (4, 1)],
    # ten goldens at the same rate with little spread between them
    "agree": [(5, 4)] * 10,
    # three goldens whose runs all pass
    "all_pass": [(4, 4), (3, 3), (5, 5)],
    # four goldens of ten runs: three clean and one at half
    "gate": [(10, 10), (10, 10), (10, 10), (10, 5)],
}

out = {name: dict(clusters=c, interval=interval(c)) for name, c in CASES.items()}
out["gate"]["needed"] = {str(t): needed(CASES["gate"], t) for t in (0.7, 0.8)}
Path(__file__).with_name("aggregate_intervals.json").write_text(json.dumps(out, indent=2) + "\n")
