"""Free paired analysis from sealed requests and immutable recorded answers."""
import collections, fractions, math, random, subprocess
from common import *
from run import requests, priced

DOSSIER = Path('<scratchpad>/codex/dossier-ledger-hard.md')

def wilson(k, n):
    if not n: return None
    z = 1.959963984540054; p = k/n; d = 1+z*z/n
    center = (p+z*z/(2*n))/d; half = z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d
    return [max(0,center-half), min(1,center+half)]

def exact(w, l):
    n = w+l
    one = fractions.Fraction(sum(math.comb(n,k) for k in range(w,n+1)),2**n) if n else fractions.Fraction(1)
    two = min(fractions.Fraction(1),fractions.Fraction(2*sum(math.comb(n,k) for k in range(min(w,l)+1)),2**n)) if n else fractions.Fraction(1)
    return {'one_sided_p':float(one),'one_sided_exact':str(one),'two_sided_p':float(two),'two_sided_exact':str(two)}

def bootstrap(units, draws=20000):
    if not units:return None
    # Pool remains stratified by row; the same family cluster carries both generations.
    groups = collections.defaultdict(lambda: collections.defaultdict(list))
    for u in units:groups[u['row']][u['family']].append((u['ours_right'],u['peer_right']))
    strata = [[(len(v),sum(a for a,b in v),sum(b for a,b in v)) for v in families.values()] for families in groups.values()]
    rng=random.Random(2619092984); samples=[[],[],[]]
    for _ in range(draws):
        n=a=b=0
        for families in strata:
            for __ in families:
                size,x,y=rng.choice(families); n+=size; a+=x; b+=y
        for arr,value in zip(samples,(a/n,b/n,(a-b)/n)):arr.append(value)
    def interval(arr):
        arr.sort()
        return [arr[int(.025*(draws-1))],arr[int(.975*(draws-1))]]
    return dict(zip(('ours','peer','difference'),map(interval,samples)))

def summary(units, denominator):
    n=len(units); a=sum(u['ours_right'] for u in units); b=sum(u['peer_right'] for u in units)
    w=sum(u['ours_right'] and not u['peer_right'] for u in units)
    l=sum(u['peer_right'] and not u['ours_right'] for u in units)
    return {'n':n,'sealed_n':denominator,'complete':n==denominator,'ours':a,'peer':b,'wins':w,'losses':l,
            'both_correct':sum(u['ours_right'] and u['peer_right'] for u in units),
            'both_wrong':sum(not u['ours_right'] and not u['peer_right'] for u in units),
            'ours_wilson95':wilson(a,n),'peer_wilson95':wilson(b,n),'family_bootstrap95':bootstrap(units),
            'ours_inconclusive':sum(u['ours']=='inconclusive' for u in units),
            'peer_inconclusive':sum(u['peer']=='inconclusive' for u in units), **exact(w,l)}

def holm(values, total=None):
    total=total or len(values); out={}; previous=0
    for i,(key,p) in enumerate(sorted(values.items(),key=lambda x:x[1])):
        previous=max(previous,min(1,p*(total-i))); out[key]=previous
    return out

def main():
    seal=json.loads((HERE/'seal.json').read_text()); calls=records()
    for c in calls:
        c['measured_usd']=priced(c)
        if c['measured_usd'] is not None:c['cap_accounted_usd']=c['measured_usd']
    by_key={r['request_sha256']:r for r in calls}
    assert len(by_key)==len(calls), 'Duplicate recorded request'
    lookup={(r['model'],r['id'],r['side']):r for r in requests(MODELS,None)}
    all_units=[]; tables=[]
    for model in MODELS:
        for row in ROWS:
            for comparator in (('peer','peer-full-state') if row=='goal' else ('peer',)):
                units=[]
                for case in cases(row):
                    left=lookup[model,case['id'],'audit']; right=lookup[model,case['id'],comparator]
                    a=by_key.get(left['request_sha256']); b=by_key.get(right['request_sha256'])
                    if not a or not b:continue
                    ao=native.outcome(a['text'],'audit',row) if a['success'] else 'inconclusive'
                    bo=native.outcome(b['text'],comparator,row) if b['success'] else 'inconclusive'
                    truth='pass' if case['truth'] else 'fail'
                    u={'model':model,'row':row,'comparator':comparator,'id':case['id'],'generation':case['generation'],
                       'family':case['kind'],'truth':truth,'ours':ao,'peer':bo,'ours_right':ao==truth,'peer_right':bo==truth,
                       'ours_request':left['request_sha256'],'peer_request':right['request_sha256']}
                    units.append(u)
                all_units.extend(units)
                entry={'model':model,'row':row,'comparator':comparator,**summary(units,384)}
                for side,field in [('ours','ours_request'),('peer','peer_request')]:
                    used={u[field] for u in units}; selected=[by_key[k] for k in used]
                    entry[side+'_usage']={'unique_calls':len(used),'measured_usd':sum(c['measured_usd'] or 0 for c in selected),
                       'price_note':'Provider pricing verified by owner 2026-10-13' if model=='gpt-6-luna' else 'CLI-reported',
                       'prompt_tokens':sum((c.get('usage') or {}).get('prompt_tokens',(c.get('usage') or {}).get('input_tokens',0)) for c in selected),
                       'completion_tokens':sum((c.get('usage') or {}).get('completion_tokens',(c.get('usage') or {}).get('output_tokens',0)) for c in selected)}
                    entry[side+'_usage']['measured_usd_per_100']=entry[side+'_usage']['measured_usd']/len(units)*100 if units else None
                entry['discordant_ids']=[u['id'] for u in units if u['ours_right']!=u['peer_right']]
                tables.append(entry)
        for equal in (False,True):
            units=[u for u in all_units if u['model']==model and (u['comparator']==('peer-full-state' if equal else 'peer') if u['row']=='goal' else u['comparator']=='peer')]
            tables.append({'model':model,'row':'pooled-equal-evidence' if equal else 'pooled-default','comparator':'mixed',**summary(units,1536)})
    # A lane cannot compute the global 18-cell Holm table. Padding missing p-values
    # with 1 is conservative and explicitly distinguished from the final collator.
    primary={t['model']:t['two_sided_p'] if t['complete'] else 1 for t in tables if t['row']=='pooled-default'}
    adjusted=holm(primary,18)
    for t in tables:
        t['nominal_verdict']='PENDING' if not t['complete'] else 'LOSS' if t['losses']>t['wins'] and t['two_sided_p']<.05 else 'nominal lead' if t['wins']>t['losses'] and t['two_sided_p']<.05 else 'TIE (not equivalence)'
        if t['row']=='pooled-default':t['holm18_missing_as_one']=adjusted[t['model']]
    output={'generated':stamp(),'seal_sha256':digest(HERE/'seal.json'),'tables':tables,'unique_calls':len(calls),
            'measured_usd':sum(c['measured_usd'] or 0 for c in calls),'cap_accounted_usd':sum(c['cap_accounted_usd'] for c in calls),
            'failed_calls':sum(not c['success'] for c in calls),'luna_calls_token_priced':sum(c['model']=='gpt-6-luna' for c in calls),
            'gemini':'pending billing','dialect_variant':'pending core dossier',
            'resolved_models':sorted({m for c in calls for m in (c.get('resolved_model') if isinstance(c.get('resolved_model'),list) else [c.get('resolved_model')]) if m})}
    dump(HERE/'scores.json',output); dump(HERE/'decisions.json',all_units)
    lines=['# Promptfoo hard rows: fresh sealed cohort','',f'Generated {output["generated"]}. All results below derive from `comparisons/ledger-hard/scores.json`, `decisions.json` and `calls.jsonl` on `research/ledger-hard`.','',
           'Frozen criterion-ledger candidate, not a shipped-default claim. Synthetic cases retain the original construction families. Gemini is pending billing. The separate dialect variant is pending the core dossier.','',
           '## Sealed cases','', '| Row | Seeds | Cases | Pass/fail | Prior payload overlap | File SHA-256 |','|---|---|---:|---|---:|---|']
    for row,data in seal['rows'].items():lines.append(f'| {row} | {data["seeds"]} | 384 | 192/192 | 0 | `{data["sha256"]}` |')
    census=json.loads((HERE/'prior-census.json').read_text())
    lines+=['',f'Prior census: {len(census["sources"])} historical/worktree sources, {census["distinct_payloads"]} distinct earlier full payloads. `prior-census.json` carries every source and digest. Full payload means the exact criterion-ledger request, including final state for goal. The default trajectory peer intentionally shares requests between state-distinct cases.','',
            'The generator runs two generations of 192 per row. Every row has 12 families, 32 cases per family, with 16 passing and 16 failing. Phone area bindings differ across the two generations, retaining reserved 555-01xx numbers. Labels, prompts and analysis are sealed before the first call.','',
            '## Per-row and pooled exact comparisons','',
            '| Model | Row / evidence | Paired / sealed | Ours | Peer | W | L | Exact two-sided p | Exact one-sided p | Status |',
            '|---|---|---:|---:|---:|---:|---:|---|---|---|']
    for t in tables:lines.append(f'| {t["model"]} | {t["row"]} / {t["comparator"]} | {t["n"]}/{t["sealed_n"]} | {t["ours"]} | {t["peer"]} | {t["wins"]} | {t["losses"]} | {t["two_sided_exact"]} = {t["two_sided_p"]:.8g} | {t["one_sided_exact"]} = {t["one_sided_p"]:.8g} | {t["nominal_verdict"]} |')
    lines+=['| gemini-3.8-flash | All rows | 0/1536 | pending | pending | | | | | Pending billing |','',
            '## Uncertainty and usage','', '| Model | Row / evidence | Wilson ours | Wilson peer | Family bootstrap difference | Inconclusive ours/peer | USD/100 ours/peer |','|---|---|---|---|---|---|---|']
    def interval(v):return 'pending' if v is None else '['+', '.join(f'{100*x:.3f}%' for x in v)+']'
    for t in tables:
        cost='/'.join(f'{t[s+"_usage"]["measured_usd_per_100"]:.6f}' if t[s+'_usage']['measured_usd_per_100'] is not None else 'pending' for s in ('ours','peer')) if 'ours_usage' in t else 'see row costs'
        lines.append(f'| {t["model"]} | {t["row"]}/{t["comparator"]} | {interval(t["ours_wilson95"])} | {interval(t["peer_wilson95"])} | {interval(t["family_bootstrap95"]["difference"] if t["family_bootstrap95"] else None)} | {t["ours_inconclusive"]}/{t["peer_inconclusive"]} | {cost} |')
    lines+=['','## Method and limits','',
            '- Exact one-sided p = sum(C(W+L,k), k=W..W+L) / 2^(W+L). Two-sided McNemar doubles the smaller binomial tail, capped at one. Zero discordance gives one.',
            '- Case-level tests are nominal. Families are dependent. Bootstrap draws all paired cases within sampled families, 20,000 draws, seed 2619092984. Pool bootstrap is stratified by row.',
            '- The pooled conditional sign test conditions on discordance in each row and sums wins. Under the null, its distribution is Binomial(total discordance, 0.5). Exact rational p-values are retained.',
            '- Pooled-default includes the information-asymmetric goal comparison. Pooled-equal-evidence replaces that goal row with the final-state ablation. Neither pool counts goal twice.',
            '- Global Holm correction across 18 benchmark/model cells belongs to the final collator. `holm18_missing_as_one` is a conservative interim correction for pooled-default only. Per-row leads are nominal.',
            '- Constant-pass and constant-fail cheaters each score 192/384 by planted balance. Repeated-read noise floor and perturbation validity are not measured in this sealed primary run; no stability claim is made.',
            '- Original frozen prompts and decoding are unchanged. The goal peer uses pinned trajectory summary; its ablation adds the persisted final state without editing the pinned prompt.',
            '- gpt-6-luna uses provider-default reasoning and no temperature field for both sides. Tokens are recorded per call. Owner-verified pricing on 2026-10-13: USD 0.10 input, 0.01 cached input, 0.50 output per million tokens. Source: https://developers.openai.com/api/docs/models/gpt-6-luna. Accounting amendment is separate from the original seal.',
            '- The pilot is a transport and cost check on the first 20 sealed cases per row, retained once in final results. No labels or outcomes select continuation or change the procedure. No content retries. Owner-authorized unanswered transport retries use at most three attempts with 10/30-second backoff and at most two concurrent Luna calls. All failed attempts remain recorded.',
            '', '## Freeze and spend','',
            f'- Candidate procedure: `{seal["candidate_procedure_sha256"]}`.',
            f'- Seal SHA-256: `{digest(HERE/"seal.json")}`. The seal holds every frozen source, case and prompt hash.',
            f'- Current branch commit: `{subprocess.check_output(["git","rev-parse","HEAD"],cwd=ROOT,text=True).strip()}`.',
            f'- {len(calls)} unique completed attempts; {output["failed_calls"]} transport failures; measured spend USD {output["measured_usd"]:.8f} of USD 10.',
            f'- {output["luna_calls_token_priced"]} gpt-6-luna calls use recorded usage and the corrected provider prices. Earlier raw records remain unchanged; current totals reprice those records.',
            f'- Resolved models: {output["resolved_models"]}.',
            '- Artifacts: `comparisons/ledger-hard/{seal,seeds,prior-census,prompts,scores,decisions}.json`, row case JSON, `starts.jsonl`, `calls.jsonl`, and the source scripts.','']
    content='\n'.join(lines)
    assert '\u2014' not in content and '\u2013' not in content
    DOSSIER.write_text(content)
    (HERE/'REPORT.md').write_text(content)
    print(json.dumps({k:output[k] for k in ('unique_calls','measured_usd','failed_calls','gemini','dialect_variant')}))

if __name__=='__main__':main()
