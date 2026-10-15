"""H6 analysis per PREREG: Fisher per block, Holm over 15, block-cluster bootstrap of the pooled gap."""
import json, random
from scipy.stats import fisher_exact
runs = {json.loads(l)['run']: json.loads(l) for l in open('runs-full.jsonl')}
judged = {json.loads(l)['run']: json.loads(l) for l in open('judged-full.jsonl')}
blocks = []
for r in runs.values():
    if r['block'] not in blocks: blocks.append(r['block'])
order = ['cov-750','cov-450','cov-2500','cat-price','cat-data','cat-current','port-balance','port-pin','port-date','order-id','order-install','order-price','lead-ref','lead-window','lead-advisor']
def metric(r, name):
    if r['error']: return None
    if name == 'regex': return r['pass']
    if name == 'recall': return r['recall']
    j = judged.get(r['run'], {}).get('verdict')
    if j is None: return None
    return bool(r['pass'] and j)
def holm(ps):
    idx = sorted(range(len(ps)), key=lambda i: ps[i]); m = len(ps); adj = [0]*m; run = 0
    for k, i in enumerate(idx):
        run = max(run, min(1, (m-k)*ps[i])); adj[i] = run
    return adj
out = {}
for name in ['judged', 'regex', 'recall']:
    rows = []
    for b in order:
        c = {}
        for arm in ['record','prose']:
            v = [metric(r, name) for r in runs.values() if r['block']==b and r['arm']==arm]
            v = [x for x in v if x is not None]
            c[arm] = (sum(v), len(v))
        p = fisher_exact([[c['record'][0], c['record'][1]-c['record'][0]], [c['prose'][0], c['prose'][1]-c['prose'][0]]])[1]
        rows.append({'block': b, 'record': c['record'], 'prose': c['prose'], 'gap': c['record'][0]/c['record'][1] - c['prose'][0]/c['prose'][1], 'p': p})
    adj = holm([r['p'] for r in rows])
    for r, a in zip(rows, adj): r['p_holm'] = a
    gaps = [r['gap'] for r in rows]; rng = random.Random(6); boots = []
    for _ in range(10000):
        s = [gaps[rng.randrange(len(gaps))] for _ in gaps]; boots.append(sum(s)/len(s))
    boots.sort()
    out[name] = {'rows': rows, 'pooled_gap': sum(gaps)/len(gaps), 'ci95': [boots[249], boots[9749]], 'blocks_holm_sig': sum(1 for r in rows if r['p_holm'] < 0.05)}
missing = sum(1 for r in runs.values() if judged.get(r['run'],{}).get('verdict') is None)
out['judge_missing'] = missing
json.dump(out, open('analysis.json','w'), indent=1)
for name in ['judged','regex','recall']:
    o = out[name]; print(f"== {name}: pooled gap record-prose {o['pooled_gap']:+.3f} CI {o['ci95'][0]:+.3f}..{o['ci95'][1]:+.3f}; Holm-significant blocks {o['blocks_holm_sig']}")
    for r in o['rows']: print(f"  {r['block']:14} record {r['record'][0]:2}/{r['record'][1]}  prose {r['prose'][0]:2}/{r['prose'][1]}  p {r['p']:.4f}  holm {r['p_holm']:.4f}")
print('judge missing', missing)
