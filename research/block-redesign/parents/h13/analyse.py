"""Applies the verdict rule of PREREG.md to results/arms-scored.jsonl. Writes results.json."""
import json, math, random
from collections import defaultdict
from pathlib import Path

H = Path(__file__).parent
plan = {i['id']: i for i in json.loads((H / 'plan.json').read_text())['items']}
arms = defaultdict(dict)
usage = defaultdict(float)
for line in (H / 'results/arms-scored.jsonl').read_text().splitlines():
    a = json.loads(line)
    arms[a['item']][a['arm']] = a
    for k in ('input', 'output', 'cache_write', 'cache_read', 'calls'):
        usage[k] += a['usage'][k]
    usage['usd'] += a['usd']
    usage['turns'] += len(a['turns'])
pilot_usd = 0.0
pilot_usage = defaultdict(float)
pf = H / 'results/pilot-arms.jsonl'
if pf.exists():
    for line in pf.read_text().splitlines():
        a = json.loads(line)
        pilot_usd += a['usd']
        for k in ('input', 'output', 'cache_write', 'cache_read', 'calls'):
            pilot_usage[k] += a['usage'][k]


def wilson(k, n, z=1.959964):
    if n == 0:
        return [None, None]
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [round(c - h, 3), round(c + h, 3)]


def vec(arm):
    return [b['pass'] for b in arm['child_score']]


rows = []
for iid, a in arms.items():
    if 'FULL1' not in a or 'ISO' not in a:
        continue
    it = plan[iid]
    f1, iso = a['FULL1'], a['ISO']
    eligible = all(b['pass'] for b in f1['stem_score'])
    row = {
        'item': iid, 'type': it['type'], 'stratum': it['stratum'], 'stemNode': it.get('stemNode'), 'eligible': eligible,
        'full1': vec(f1), 'iso': vec(iso),
        'manifest': vec(f1) != vec(iso),
        'verdict_change': all(vec(f1)) != all(vec(iso)),
        'has_full2': 'FULL2' in a,
        'flake': ('FULL2' in a) and vec(f1) != vec(a['FULL2']),
        'stem_fail_full2': ('FULL2' in a) and not all(b['pass'] for b in a['FULL2']['stem_score']),
        'iso_reasons': [r for b in iso['child_score'] for r in b['reasons']],
        'full1_reasons': [r for b in f1['child_score'] for r in b['reasons']],
    }
    # static cross-check: expected tool input values that appear in no child user turn
    texts = ' '.join(b['user'] for b in it['child']).lower()
    reads = False
    def vals(x):
        if isinstance(x, dict):
            for v in x.values():
                yield from vals(v)
        elif isinstance(x, str):
            yield x
    for b in it['child']:
        for t in b['expect']['tools']:
            if t.get('count', 0) > 0 and t.get('input'):
                for v in vals(t['input']):
                    if v.lower() not in texts:
                        reads = True
    row['static_reads_parent'] = reads
    rows.append(row)

nat = [r for r in rows if r['type'] == 'natural']
pos = [r for r in rows if r['type'] == 'plant_pos']
neg = [r for r in rows if r['type'] == 'plant_neg']
el = lambda xs: [r for r in xs if r['eligible']]
res = {'counts': {'natural_run': len(nat), 'natural_eligible': len(el(nat)), 'pos_run': len(pos), 'pos_eligible': len(el(pos)),
                  'neg_run': len(neg), 'neg_eligible': len(el(neg))}}
ep, en, enat = el(pos), el(neg), el(nat)
res['planted_positives_caught'] = {'k': sum(r['manifest'] for r in ep), 'n': len(ep), 'wilson': wilson(sum(r['manifest'] for r in ep), len(ep))}
res['planted_negatives_flagged'] = {'k': sum(r['manifest'] for r in en), 'n': len(en), 'wilson': wilson(sum(r['manifest'] for r in en), len(en))}


def cluster_boot(rs, key, B=2000, seed=13):
    rnd = random.Random(seed)
    groups = defaultdict(list)
    for r in rs:
        groups[r['stemNode']].append(r)
    ks = list(groups)
    out = []
    for _ in range(B):
        k = n = 0
        for g in (ks[rnd.randrange(len(ks))] for _ in ks):
            for r in groups[g]:
                k += r[key]
                n += 1
        out.append(k / n)
    out.sort()
    return [round(out[int(0.025 * B)], 3), round(out[int(0.975 * B)], 3)]


def share(rs, key):
    k = sum(r[key] for r in rs)
    return {'k': k, 'n': len(rs), 'share': round(k / len(rs), 3) if rs else None, 'wilson': wilson(k, len(rs)),
            'cluster_bootstrap': cluster_boot(rs, key) if rs else None, 'stems': len({r['stemNode'] for r in rs})}


res['natural_manifest'] = share(enat, 'manifest')
res['natural_verdict_change'] = share(enat, 'verdict_change')
res['natural_by_stratum'] = {str(s): {'n': len([r for r in enat if r['stratum'] == s]), 'manifest': sum(r['manifest'] for r in enat if r['stratum'] == s),
                                      'verdict_change': sum(r['verdict_change'] for r in enat if r['stratum'] == s)} for s in sorted({r['stratum'] for r in enat})}
rep = [r for r in rows if r['has_full2']]
res['noise'] = {'edges_with_full2': len(rep), 'flake': sum(r['flake'] for r in rep), 'flake_share': round(sum(r['flake'] for r in rep) / len(rep), 3) if rep else None,
                'natural_with_full2': len([r for r in rep if r['type'] == 'natural']), 'natural_flake': sum(r['flake'] for r in rep if r['type'] == 'natural')}
stable = [r for r in enat if r['has_full2'] and not r['flake']]
res['natural_manifest_stable_subset'] = share(stable, 'manifest') if stable else None
res['static_cross_check'] = {
    'reads_parent_and_manifest': sum(1 for r in enat if r['static_reads_parent'] and r['manifest']),
    'reads_parent_not_manifest': sum(1 for r in enat if r['static_reads_parent'] and not r['manifest']),
    'no_read_manifest': sum(1 for r in enat if not r['static_reads_parent'] and r['manifest']),
    'no_read_not_manifest': sum(1 for r in enat if not r['static_reads_parent'] and not r['manifest']),
}
res['ineligible'] = {'natural': len(nat) - len(enat), 'pos': len(pos) - len(ep), 'neg': len(neg) - len(en)}
# verdict
c = res['counts']
pc, nf = res['planted_positives_caught'], res['planted_negatives_flagged']
flake_share = res['noise']['flake_share']
if pc['n'] and pc['k'] == 0 or (res['natural_manifest']['n'] and res['natural_manifest']['k'] == 0):
    verdict = 'FALSIFIED'
elif c['pos_eligible'] < 6 or c['neg_eligible'] < 6 or c['natural_eligible'] < 30 or (flake_share is not None and flake_share > 0.25):
    verdict = 'INCONCLUSIVE'
elif pc['k'] >= 0.8 * pc['n'] and nf['k'] <= 0.2 * nf['n'] and res['natural_manifest']['k'] >= 1:
    verdict = 'SUPPORTED'
else:
    verdict = 'INCONCLUSIVE'
res['verdict'] = verdict
res['ledger'] = {'main_usd_standin': round(usage['usd'], 4), 'pilot_usd_standin': round(pilot_usd, 4), 'total_usd_standin': round(usage['usd'] + pilot_usd, 4),
                 'main_tokens': {k: usage[k] for k in ('input', 'output', 'cache_write', 'cache_read', 'calls', 'turns')},
                 'pilot_tokens': dict(pilot_usage)}
res['rows'] = rows
(H / 'results.json').write_text(json.dumps(res, indent=1))
print(json.dumps({k: v for k, v in res.items() if k != 'rows'}, indent=1))
