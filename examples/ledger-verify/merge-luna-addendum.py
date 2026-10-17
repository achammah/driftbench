"""Append recovered noise metrics beside the unchanged official Luna metrics."""
import copy,datetime,hashlib,json,os
from pathlib import Path
BASE=Path(__file__).resolve().parent;DEST=BASE/'luna-addendum'
DOSSIER=Path(os.environ['LEDGER_VERIFY_DOSSIER'])
def read(p):return json.loads(p.read_text())
def rows(p):return [json.loads(x) for x in p.read_text().splitlines() if x.strip()]
state=read(DEST/'state.json');assert state['status']=='complete'
amend=read(DEST/'freeze-amendment.json')
for path,h in amend['officialHashes'].items():assert hashlib.sha256((BASE/path).read_bytes()).hexdigest()==h,path
original=[read(BASE/f'noise-{i}/gpt-6-luna.json') for i in range(3)]
recovered=[read(DEST/'noise-0.with-recovered-items.json'),*original[1:]]
receipts=rows(BASE/'receipts/calls.jsonl');new=[r for r in receipts if r.get('phase')=='noise-0-addendum'];assert len(new)==6
limits=[r for r in new if (r.get('metadata') or {}).get('truncated') or (r.get('metadata') or {}).get('finishReason') in ['length','MAX_TOKENS','max_tokens']]
answers=[read(p) for p in (BASE/'cache/luna-noise-addendum').glob('*.answered.json')];owners={r['receipt']:r for r in answers}
strict=copy.deepcopy(recovered)
for r in limits:
 a=owners[r['id']]
 if a['labels']['order']!='single':continue
 c=next(c for c in strict[0]['contestants'] if c['contestant']==a['labels']['contestant']);d=next(d for d in c['decisions'] if d['id']==a['labels']['item']);d.pop('pass',None);d['missing']=1;d['error']='output_limit'
def noise(repeats):
 out=[]
 for ci,c in enumerate(repeats[0]['contestants']):
  maps=[{d['id']:d for d in r['contestants'][ci]['decisions']} for r in repeats];flips=missing=0
  for item in maps[0]:
   values=[m[item].get('pass') if m[item]['missing']==0 else None for m in maps];flips+=len(set(values))>1;missing+=None in values
  out.append(dict(contestant=c['contestant'],items=30,repeats=3,itemsWithAnyFlip=flips,itemsWithAnyMissing=missing))
 return out
metrics=dict(at=datetime.datetime.now(datetime.timezone.utc).isoformat(),official=noise(original),withRecoveredItems=noise(recovered),strictWithRecoveredItems=noise(strict),providerRequests=6,newSettledUsd=state['newSettledUsd'],returnedAnswersResent=0,officialFilesUnchanged=len(amend['officialHashes']),limits=[dict(id=r['id'],contestant=owners[r['id']]['labels']['contestant'],consumed=owners[r['id']]['labels']['order']=='single') for r in limits])
(DEST/'metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
cells=read(BASE/'evidence/cells.json');budget=read(BASE/'receipts/budget.json');old_fees=cells['fees'];held=sum(x['usd'] for x in budget['reservations'].values());assert budget['spentUsd']+held<=40
cells['fees']={**old_fees,'settledUsd':budget['spentUsd'],'unresolvedMaximumUsd':held,'maximumAccountedUsd':budget['spentUsd']+held,'providerReceipts':len(receipts),'byModel':{m:sum(r['costUsd'] for r in receipts if r['model']==m) for m in ['haiku','gpt-6-luna','gemini-3.8-flash']},'unknownCharges':budget['reservations']}
cells['lunaNoiseAddendum']=metrics
cells['overallAccountedMaximumUsd']=cells['fees']['maximumAccountedUsd']+cells.get('additionalCellFees',{}).get('maximumAccountedUsd',0)+sum(f['maximumAccountedUsd'] for f in cells.get('newModelFees',{}).values())
for name in ['freeze-amendment.json','execution-freeze.json','state.json','metrics.json']:
 cells['freeze']['hashes']['luna-addendum/'+name]=hashlib.sha256((DEST/name).read_bytes()).hexdigest()
(BASE/'evidence/cells.json').write_text(json.dumps(cells,indent=2)+'\n')

text='\n## Luna noise addendum: official result preserved\n\n'
text+='- The closed Luna cell remains official. Its 221-item TEST reports and recordings match every pre-recovery hash. No TEST call is repeated.\n'
text+='- The owner authorizes recovery of six noise-0 no-answer requests after Haiku. All six return once, at medium, 300-second timeouts and concurrency two after the provider health gate.\n'
text+='- Four recovered final requests fill the separate addendum. Its 56 earlier answered finals stay unchanged. Two intermediate responses remain supplemental; downstream final requests keep their original frozen inputs.\n'
text+='- Official noise flips include missing values under the frozen calculation. Recovered-item rows apply that identical rule. Strict remains the headline.\n\n'
text+='| Model and result | Score variant | Our items with noise flips / 30 | promptfoo items with noise flips / 30 | Items with any missing, ours / peer | New output-limit answers, ours / peer |\n|---|---|---|---|---|---|\n'
for label,variant,data in [('gpt-6-luna official','strict and product-final',metrics['official']),('gpt-6-luna with recovered items','strict',metrics['strictWithRecoveredItems']),('gpt-6-luna with recovered items','product-final',metrics['withRecoveredItems'])]:
 count=[sum(r['contestant']==c['contestant'] for r in metrics['limits']) for c in data] if 'recovered' in label else [0,0]
 text+=f"| {label} | {variant} | {data[0]['itemsWithAnyFlip']}/30 | {data[1]['itemsWithAnyFlip']}/30 | {data[0]['itemsWithAnyMissing']} / {data[1]['itemsWithAnyMissing']} | {count[0]} / {count[1]} |\n"
text+='\n| Addendum contestant | Settled recovery cost USD | Requests |\n|---|---|---|\n'
for c in original[0]['contestants']:
 matched=[r for r in new if owners[r['id']]['labels']['contestant']==c['contestant']]
 text+=f"| {c['contestant']} | {sum(r['costUsd'] for r in matched):.8f} | {len(matched)} |\n"
text+=f"\n- Addendum settled cost: {state['newSettledUsd']:.8f} USD inside the original 40 USD cap. Existing unknown-charge holds remain. Cache-write fees use the published 0.125 USD per million tokens.\n"
text+='- Sources: luna-addendum/freeze-amendment.json, execution-freeze.json, state.json, metrics.json and noise-0.with-recovered-items.json. The addendum never replaces the official cell table.\n'
for p in [BASE/'REPORT.md',DOSSIER]:
 old=p.read_text().split('\n## Luna noise addendum: official result preserved',1)[0]
 old=old.replace(f"settled fees: {old_fees['settledUsd']:.6f}",f"settled fees: {budget['spentUsd']:.6f}").replace(f"Total accounted maximum: {old_fees['maximumAccountedUsd']:.6f}",f"Total accounted maximum: {budget['spentUsd']+held:.6f}")
 old=old.replace('- Current original-model pacing: gpt-6-luna eight, parked Gemini 3.8 two, Haiku four with the owner-defined fallback to two.', '- Current admission: two calls and one model cell at a time, after ten healthy provider probes spaced 30 seconds apart. Gemini 3.8 remains parked.')
 p.write_text(old+text)
print(json.dumps(metrics))
