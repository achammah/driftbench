"""Applies the verdict rules of PREREG.md to results_a.json, results_b.json, results_hier.json. Writes results.json."""
import json
from pathlib import Path
import numpy as np

H = Path(__file__).parent
A = json.loads((H / 'results_a.json').read_text())
B = json.loads((H / 'results_b.json').read_text())
HI = json.loads((H / 'results_hier.json').read_text())
EX = json.loads((H / 'results_example.json').read_text())

out = {'example': EX}
# Part A
cells = A['cells']
prim = [c for c in cells if c['frame'] == 'U' and c['N'] == 3 and c['h'] == 1.0 and c['eps'] == 0.01][0]
h1 = [c for c in cells if c['h'] == 1.0]
better_all = all(c['grouped']['mae'] < c['flat_linked']['mae'] and c['grouped']['mae'] < c['flat_old']['mae'] for c in h1)
ci = prim['paired_grouped_minus_flat_linked']['ci95']
ci_old = prim['paired_grouped_minus_flat_old']['ci95']
if prim['grouped']['mae'] >= prim['flat_linked']['mae']:
    va = 'FALSIFIED'
elif better_all and ci[1] < 0 and ci_old[1] < 0:
    va = 'SUPPORTED'
else:
    va = 'INCONCLUSIVE'
out['A'] = {
    'verdict': va,
    'primary_cell': prim,
    'grouped_better_in_all_h1_cells': better_all,
    'h1_cells': len(h1),
    'table_h1_frameU': [
        {k: c[k] for k in ['N', 'eps']} | {m: round(c[m]['mae'], 2) for m in ['flat_old', 'flat_linked', 'grouped', 'grouped_rescue']}
        | {'exact_grouped': round(c['grouped']['share_exact'], 3), 'exact_rescue': round(c['grouped_rescue']['share_exact'], 3), 'exact_flat_linked': round(c['flat_linked']['share_exact'], 3)}
        for c in h1 if c['frame'] == 'U'
    ],
    'hidden_fault': A['hidden_fault'],
}
# Part B
clu = [c for c in B if c['size'] in ('m3', 'm8', 'real') and c['d'] <= 8]
ctrl = [c for c in B if c['size'] == 'm1' or c['d'] == 1000]
methods = ['naive_wald', 'naive_wilson', 'cl_wald', 'cl_wilson_neff', 'boot']
def gap(cs, m):
    return float(np.mean([abs(c['methods'][m]['coverage'] - 0.95) for c in cs]))
def mean_cov(cs, m):
    return float(np.mean([c['methods'][m]['coverage'] for c in cs]))
def share_below(cs, m, t=0.93):
    return float(np.mean([c['methods'][m]['coverage'] < t for c in cs]))
def share_within(cs, m, lo=0.93, hi=0.97):
    return float(np.mean([lo <= c['methods'][m]['coverage'] <= hi for c in cs]))
summ = {m: {'gap_clustering': gap(clu, m), 'mean_cov_clustering': mean_cov(clu, m), 'share_below_93_clustering': share_below(clu, m),
            'share_within_93_97_clustering': share_within(clu, m), 'gap_control': gap(ctrl, m), 'mean_cov_control': mean_cov(ctrl, m)} for m in methods}
best_cl = min(summ[m]['gap_clustering'] for m in ['cl_wald', 'cl_wilson_neff', 'boot'])
nv = summ['naive_wilson']
if nv['gap_clustering'] <= best_cl:
    vb = 'FALSIFIED'
elif nv['gap_clustering'] - best_cl > 0.02 and nv['share_below_93_clustering'] >= 0.75:
    vb = 'SUPPORTED'
else:
    vb = 'INCONCLUSIVE'
by_G = {}
for G in sorted({c['G'] for c in clu}):
    cs = [c for c in clu if c['G'] == G]
    by_G[G] = {m: round(mean_cov(cs, m), 3) for m in methods}
by_d = {}
for d in sorted({c['d'] for c in B}):
    cs = [c for c in B if c['d'] == d and c['size'] != 'm1']
    by_d[d] = {m: round(mean_cov(cs, m), 3) for m in methods}
out['B'] = {'verdict': vb, 'clustering_cells': len(clu), 'control_cells': len(ctrl), 'summary': summ, 'best_clustered_gap': best_cl,
            'mean_coverage_by_G_clustering': by_G, 'mean_coverage_by_d_nonM1': by_d}
# headline cell
head = [c for c in B if c['G'] == 25 and c['size'] == 'real' and c['theta'] == 0.9 and c['d'] == 2][0]
out['B']['headline_G25_real_theta0.9_d2'] = head['methods']
# hierarchical vs others on the same cells
cmp_ = []
for h in HI:
    b = [c for c in B if c['G'] == h['G'] and c['size'] == h['size'] and c['theta'] == h['theta'] and c['d'] == h['d']][0]
    cmp_.append({'G': h['G'], 'size': h['size'], 'theta': h['theta'], 'd': h['d'], 'hier': h['coverage'], 'hier_width': round(h['width'], 3),
                 'naive_wilson': b['methods']['naive_wilson']['coverage'], 'cl_wilson_neff': b['methods']['cl_wilson_neff']['coverage'], 'boot': b['methods']['boot']['coverage']})
out['hier_cells'] = cmp_
out['hier_summary'] = {'mean_cov': float(np.mean([h['coverage'] for h in HI])), 'gap': float(np.mean([abs(h['coverage'] - 0.95) for h in HI])),
                       'gap_same_cells': {m: float(np.mean([abs(c[m] - 0.95) for c in cmp_])) for m in ['naive_wilson', 'cl_wilson_neff', 'boot']}}
(H / 'results.json').write_text(json.dumps(out, indent=1))
print(json.dumps({'A': out['A']['verdict'], 'B': out['B']['verdict']}))
print(json.dumps(out['A']['primary_cell'], indent=0)[:900])
print(json.dumps(summ, indent=0))
print(json.dumps(by_G)); print(json.dumps(by_d)); print(json.dumps(head)); print(json.dumps(out['hier_summary']))
for r in out['A']['table_h1_frameU']: print(r)
