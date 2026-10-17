"""Merge the independent Flash Lite cell after both offline reports pass; no scoring changes."""
import datetime,hashlib,json,os,subprocess,sys
from pathlib import Path
BASE=Path(__file__).resolve().parent
ROOT=BASE.parents[1]
LITE=BASE/'lite'
DOSSIER=Path(os.environ['LEDGER_VERIFY_DOSSIER'])
def read(p):return json.loads(p.read_text())
for b in [BASE,LITE]:assert read(b/'evidence/finalizer-state.json')['status']=='offline evidence ready for review'
original=read(BASE/'evidence/cells.json');extra=read(LITE/'evidence/cells.json')
assert extra['fees']['maximumAccountedUsd']<=24
assert not extra['outputLimitErrors']['unmappedLimits']
assert len(extra['cells'])==1 and extra['cells'][0]['model']=='gemini-3.5-flash-lite'
assert read(LITE/f"gemini-3.5-flash-lite.progress.json")['status']=='complete', 'No partial handoff before authorized cap is reached'
for phase,n in [('pilot',20),('validity',48),('noise-0',30),('noise-1',30),('noise-2',30),('results',221)]:
 r=read(LITE/phase/'gemini-3.5-flash-lite.json');assert r['items']==n and not r.get('stopped')
 assert all(len(c['decisions'])==n for c in r['contestants'])
oldreport=(BASE/'REPORT.md').read_text();marker='## Execution recovery and validity disclosure'
supplement='\n'+marker+oldreport.split(marker,1)[1] if marker in oldreport else ''
original['cells']=[c for c in original['cells'] if c['model']!='gemini-3.5-flash-lite']+extra['cells']
original['noiseFloor'].update(extra['noiseFloor'])
original['outputLimitErrors']['counts'].update(extra['outputLimitErrors']['counts'])
for key in ['limits','unmappedLimits','unclassifiedHistoricalNativeErrors']:
 original['outputLimitErrors'][key]=[x for x in original['outputLimitErrors'][key] if x.get('model')!='gemini-3.5-flash-lite']+extra['outputLimitErrors'][key]
original['additionalCellFees']=extra['fees'];original['additionalCellEvidence']='lite/evidence/cells.json'
original['overallAccountedMaximumUsd']=original['fees']['maximumAccountedUsd']+extra['fees']['maximumAccountedUsd']
original['originalBudgetCapUsd']=40;original['additionalCellCapUsd']=24
original['at']=datetime.datetime.now(datetime.timezone.utc).isoformat()
for name in ['model-amendment.json','cap12-amendment.json','cap24-amendment.json','runtime-freeze.json','reporting-freeze.json','reasoning-applied.json','network-recovery-amendment.json','network-recovery-execution.json','replay-reconstruction-amendment.json','network-diagnostics-amendment.json','first-final-preservation.json','first-final-replay-amendment.json','test-recovery-amendment.json','test-network-hold-release.json']:
 path=LITE/'evidence'/name;original['freeze']['hashes']['lite/evidence/'+name]=hashlib.sha256(path.read_bytes()).hexdigest()
(BASE/'evidence/cells.json').write_text(json.dumps(original,indent=2)+'\n')
subprocess.run([sys.executable,str(BASE/'render_report.py'),str(DOSSIER)],cwd=ROOT,check=True)
text=(BASE/'REPORT.md').read_text()
text=text.replace('Settled fees:', 'Original three-model budget, settled fees:')
text=text.replace('Holm correction belongs to the prespecified 18-cell family and remains pending at this handoff. No local WIN or overall superiority claim is made.', 'The original three models belong to the prespecified 18-cell family. Flash Lite is an additional model cell, never a replacement for parked Gemini 3.8. Multiplicity adjustment remains pending with the collator. No local WIN or overall superiority claim is made.')
text=text.replace('- The pacing amendment replaces the earlier global four-call limit: gpt-6-luna permits eight HTTP calls, Gemini two, and native Haiku two.', '- Current original-model pacing: gpt-6-luna eight, parked Gemini 3.8 two, Haiku four with the owner-defined fallback to two.')
text=text.replace('| gemini-3.8-flash | pending | pending | pending | pending | pending | pending | pending | TEST pending |', '| gemini-3.8-flash | not run: daily quota (0/221) | not run: daily quota (0/221) | 0 / 0 (not run) | pending | pending | pending | pending | owner-only restart |')
text=text.replace('| gemini-3.8-flash | 20 items; missing 0/0 | 48 items; missing 0/0 | 30 items; missing 0/0 | 30 items; missing 0/0 | 30 items; missing 0/10; stopped | pending |', '| gemini-3.8-flash | 20 items; missing 0/0 | 48 items; missing 0/0 | 30 items; missing 0/0 | 30 items; missing 0/0 | 30 cascade, 20 peer; 10 quota pending | not run: daily quota, 0/221 each |')
f=extra['fees']
addition='\n## Separate Flash Lite cell\n\n'
addition+='- Owner adds gemini-3.5-flash-lite, then raises its separate cap from 6 USD to 12 USD, 18 USD, then 24 USD with unknown-charge holds retained. Original model budgets and answers remain separate.\n'
addition+='- Medium reasoning is accepted and applied to both contestants. Provider attempts have a 300-second timeout, initially eight workers and four for the TEST continuation, 429 waits of 20/60/180 seconds and an immediate HTTP 402 admission stop.\n'
addition+='- Published Standard price is 0.30 USD per million input tokens and 2.50 USD per million output tokens, including thinking. Source: https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-flash-lite. Medium support: https://ai.google.dev/gemini-api/docs/thinking. Read 13 October 2026.\n'
addition+='- The 20-item pilot costs 0.5183653 USD. Its linear projection is 9.823022435 USD across 379 units; actual fees below supersede that estimate.\n'
addition+=f"- Flash Lite actual settled fees: {f['settledUsd']:.8f} USD. Unknown-charge holds: {f['unresolvedMaximumUsd']:.8f} USD. Accounted maximum: {f['maximumAccountedUsd']:.8f} USD, cap 24 USD.\n"
addition+='- Host overload recovery keeps all 35 original uncertain-charge holds (10.50 USD). All 35 missing requests return on one additional submission each, costing 0.1725274 USD. Connectivity probes pass first.\n'
addition+='- Upstream recovery creates new downstream keys for six already completed noise items. Their first product-final verdicts stay primary; all continuation answers and charges remain archived. Two continuation verdicts differ and are excluded symmetrically by the first-answer rule. Offline replay reproduces the selected original chains.\n'
addition+='- A second TEST network wave has 24 fetch-stage connect timeouts and one interrupted HTTP-200 response. The owner authorizes release of 7.20 USD in proven pre-connection holds and missing-only recovery of all 25. The HTTP-200 hold and earlier 35 holds stay reserved.\n'
addition+='- TEST continuation preserves all 117 completed item outcomes, including five parse failures, before asking any remaining question. Original partial reports, exact answers, unused recovery answers and fees stay in the evidence.\n'
addition+='- Flash Lite files live under lite/: receipts, recordings, per-item strict and product-final decisions, request attribution, validation and exact replay evidence. The shared pool and audit map are symbolic links to the identical sealed originals.\n'
addition+='- Scoring algorithms match the original frozen functions exactly. lite/evidence/reporting-freeze.json records syntax hashes before TEST. The TEST contains 221 items per contestant; all six phases total 379 units.\n'
addition+='- Gemini 3.8 stays parked. Its disarmed driver cannot start on the clock; only a new owner instruction can release the hold. Its missing work has a 1472 judge-request upper bound, including at most 221 adaptive reviews, before extra rejected 429 attempts.\n'
addition+='- The additional cell does not establish the unmeasured full DEV cheater margin and does not alter the original multiplicity family silently.\n'
text+=supplement+addition
assert '\u2014' not in text and '\u2013' not in text
for p in [BASE/'REPORT.md',DOSSIER]:p.write_text(text)
state=read(BASE/'evidence/finalizer-state.json');state['additionalCompletedModels']=['gemini-3.5-flash-lite'];state['additionalPhases']=6;state['additionalCellCapUsd']=24
(BASE/'evidence/finalizer-state.json').write_text(json.dumps(state,indent=2)+'\n')
print(json.dumps(dict(models=[c['model'] for c in original['cells']],originalBudget=original['fees']['maximumAccountedUsd'],additionalBudget=f['maximumAccountedUsd'],providerCalls=0)))
