"""H8 analysis per PREREG: Fisher size tests vs 2K, permutation chi-square position tests, Holm over 95."""
import json, random, statistics, math
from scipy.stats import fisher_exact, chi2_contingency
FULL = [json.loads(l) for l in open('runs-full.jsonl')]
RESUME = [json.loads(l) for l in open('runs-resume.jsonl')]
# Each job counts once: its successful row in runs-full, else its row from the outage resume.
R = [r for r in FULL if r['error'] is None] + RESUME
blocks = ['account','address','phone','budget','carrier']; sizes = [2000,4000,16000,64000]; depths = [0,0.25,0.5,0.75,1]
def cell(b, s, d):
    v = [r for r in R if r['block']==b and r['size']==s and r['depth']==d and r['error'] is None]
    return v
def rate(v): return (sum(1 for r in v if r['pass']), len(v))
def wilson(k, n, z=1.96):
    if n == 0: return (None, None)
    p = k/n; den = 1+z*z/n; c = (p+z*z/(2*n))/den; h = z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/den
    return (c-h, c+h)
tests = []
rng = random.Random(8)
def chi(table):
    tot = [sum(col) for col in zip(*table)]
    if 0 in tot or any(sum(row)==0 for row in table): return 0.0
    return chi2_contingency(table, correction=False)[0]
for b in blocks:
    for s in sizes[1:]:
        for d in depths:
            k1,n1 = rate(cell(b,s,d)); k0,n0 = rate(cell(b,2000,d))
            p = fisher_exact([[k1,n1-k1],[k0,n0-k0]])[1] if n1 and n0 else 1.0
            tests.append({'kind':'size','block':b,'size':s,'depth':d,'k':k1,'n':n1,'k2k':k0,'n2k':n0,'p':p})
    for s in sizes:
        outcomes = []
        for d in depths: outcomes += [(d, 1 if r['pass'] else 0) for r in cell(b,s,d)]
        table = [[sum(1 for dd,o in outcomes if dd==d and o==1) for d in depths],[sum(1 for dd,o in outcomes if dd==d and o==0) for d in depths]]
        obs = chi(table); ys = [o for _,o in outcomes]; ds = [d for d,_ in outcomes]; ge = 0
        for _ in range(10000):
            rng.shuffle(ys)
            t = [[sum(1 for dd,o in zip(ds,ys) if dd==d and o==1) for d in depths],[sum(1 for dd,o in zip(ds,ys) if dd==d and o==0) for d in depths]]
            ge += chi(t) >= obs - 1e-12
        tests.append({'kind':'position','block':b,'size':s,'rates':[rate(cell(b,s,d)) for d in depths],'p':(ge+1)/10001 if obs>0 else 1.0})
ps = [t['p'] for t in tests]; m = len(ps); idx = sorted(range(m), key=lambda i: ps[i]); run = 0
for k,i in enumerate(idx):
    run = max(run, min(1,(m-k)*ps[i])); tests[i]['p_holm'] = run
cells = []
for b in blocks:
    for s in sizes:
        for d in depths+['control']:
            v = cell(b,s,d); k,n = rate(v)
            meas = [r['measured_tokens'] for r in v if r['measured_tokens']]
            da = [r['depth_actual'] for r in v if r['depth_actual'] is not None]
            cells.append({'block':b,'size':s,'depth':d,'k':k,'n':n,'wilson':wilson(k,n),'median_tokens':statistics.median(meas) if meas else None,
                          'size_err':(statistics.median(meas)-s)/s if meas else None,'median_depth_actual':statistics.median(da) if da else None,'unclean':sum(1 for r in v if not r['clean'])})
# pooled over blocks: per (size, depth) mean of block rates, block bootstrap
pooled = []
for s in sizes:
    for d in depths+['control']:
        rs = [rate(cell(b,s,d)) for b in blocks]; rs = [k/n for k,n in rs if n]
        bs = sorted(sum(rs[rng.randrange(len(rs))] for _ in rs)/len(rs) for _ in range(10000))
        pooled.append({'size':s,'depth':d,'mean':sum(rs)/len(rs),'ci95':[bs[249],bs[9749]]})
controls = [c for c in cells if c['depth']=='control']
out = {'runs':len(R),'full_errors_resumed':sum(1 for r in FULL if r['error']),'errors':sum(1 for r in R if r['error']),'tests':tests,'holm_significant':sum(1 for t in tests if t['p_holm']<0.05),'cells':cells,'pooled':pooled,
       'controls_above_closed_book':sum(1 for c in controls if c['k']>3),'off_target_cells':sum(1 for c in cells if c['size_err'] is not None and abs(c['size_err'])>0.05),
       'depth_off_cells':sum(1 for c in cells if c['depth']!='control' and c['median_depth_actual'] is not None and abs(c['median_depth_actual']-c['depth'])>0.02)}
json.dump(out, open('analysis.json','w'), indent=1)
print({k:out[k] for k in ['runs','errors','holm_significant','controls_above_closed_book','off_target_cells','depth_off_cells']})
for t in sorted(tests, key=lambda t: t['p'])[:8]: print(t)
for p in pooled: print(p['size'], p['depth'], round(p['mean'],3), [round(x,3) for x in p['ci95']])
