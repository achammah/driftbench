"""Run one additional cell after existing work finishes, with a five-request cost gate."""
import collections,datetime,json,os,subprocess,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];PARENT=ROOT/'examples/ledger-verify'
MODEL=sys.argv[1];assert MODEL in ['claude-sonnet-5-5','gpt-6.1-sol']
BASE=PARENT/('sol61' if MODEL=='gpt-6.1-sol' else 'sonnet')
def read(p):return json.loads(p.read_text())
def emit(**s):
 s.update(at=datetime.datetime.now(datetime.timezone.utc).isoformat(),model=MODEL,pid=os.getpid());(BASE/f'{MODEL}.progress.json').write_text(json.dumps(s,indent=2)+'\n');print(json.dumps(s),flush=True)
def old_ready():
 try:
  return all(read(PARENT/p)['status']=='offline evidence ready for review' for p in ['evidence/finalizer-state.json','lite/evidence/finalizer-state.json']) and read(PARENT/'evidence/haiku-test-timeout-recovery.json')['status']=='complete'
 except (FileNotFoundError,json.JSONDecodeError):return False
emit(phase='cost-sample',status='waiting for Haiku, its authorized recovery and Flash Lite')
while not old_ready():time.sleep(15)
runtime=read(BASE/'evidence/runtime-freeze.json');env=dict(os.environ,TMPDIR=str(ROOT/'.tmp'))
for k in ['OPENAI_API_KEY','GEMINI_API_KEY','ANTHROPIC_API_KEY','VERIFY_GEMINI_KEY_FILE']:env.pop(k,None)
env['VERIFY_CORE_DOSSIER']='<scratchpad>/codex/dossier-ledger-core.md'
env['VERIFY_PHASE']='pilot'
tsx=[str(ROOT/'node_modules/.bin/tsx'),'--tsconfig','examples/ledger-verify/tsconfig.json']
remeasure=BASE/'evidence/cache-off-cost-sample.json'
if MODEL=='claude-sonnet-5-5' and remeasure.exists():
 gate=read(remeasure);assert gate['proceed'] and runtime['capUsd']==45, 'Sonnet owner budget gate stays closed'
else:
 sample=read(PARENT/'evidence/new-model-cost-sample.json')['requests'];outcomes=[]
 for i,r in enumerate(sample):
  p=BASE/'cache'/f'cost-sample-{i}.json'
  if p.exists():v=read(p)
  else:
   result=subprocess.run(['python3',str(PARENT/'transport-retry.py'),'--model',MODEL,'--system-prompt',r['prompt']['system']],input=r['prompt']['user'],text=True,capture_output=True,cwd=ROOT,env=env,check=True)
   if result.stderr:(BASE/'logs'/f'cost-sample-{i}.stderr.log').write_text(result.stderr)
   v=json.loads(result.stdout);p.write_text(json.dumps(v)+'\n')
  outcomes.append(dict(index=i,labels=r['labels'],costUsd=v['total_cost_usd'],isError=v.get('is_error',False)))
  emit(phase='cost-sample',status='running',requestsFinished=len(outcomes))
  if v.get('is_error'):
   emit(phase='cost-sample',status='stopped; cost sample needs inspection',outcomes=outcomes);sys.exit(1)
 receipts=[r for r in map(json.loads,(BASE/'receipts/calls.jsonl').read_text().splitlines()) if r.get('output',{}).get('verify_answered')]
 assert len(receipts)==5, 'Five-call gate must precede the full cell'
 if MODEL=='claude-sonnet-5-5':
  native=[read(Path(r['nativeReceipt'])) for r in receipts]
  assert all(any(k.startswith('claude-sonnet-5-5') for k in n.get('modelUsage',{})) for n in native), 'Alias must resolve to requested Sonnet model'
  (BASE/'evidence/native-cost-sample.json').write_text(json.dumps(dict(model=MODEL,receipts=[dict(id=r['id'],modelUsage=n.get('modelUsage'),usage=n.get('usage'),numTurns=n.get('num_turns'),costUsd=n.get('total_cost_usd')) for r,n in zip(receipts,native)]),indent=2)+'\n')
 else:
  assert all(read(Path(r['nativeReceipt'])).get('model','').startswith('gpt-6.1-sol') for r in receipts), 'Response must name requested model'
 counts=collections.Counter();original=read(PARENT/'evidence/runtime-freeze.json')
 for phase in ['pilot','validity','noise-0','noise-1','noise-2','test']:
  ns=original['pilotRecordingsId'] if phase=='pilot' else original['recordingsId']
  for line in (PARENT/'recordings'/ns/phase/'longjudge-verify/gpt-6-luna.jsonl').read_text().splitlines():
   r=json.loads(line);counts[(r['contestant'],r['order'])]+=1
 costs=collections.defaultdict(list)
 for r in outcomes:costs[(r['labels']['contestant'],r['labels']['order'])].append(r['costUsd'])
 mean=lambda x:sum(x)/len(x)
 candidate_max=max(r['costUsd'] for r in outcomes if r['labels']['contestant']!='promptfoo')
 components=[dict(contestant=c,order=o,referenceRequests=n,unitCostUsd=mean(costs[(c,o)]) if (c,o) in costs else candidate_max) for (c,o),n in sorted(counts.items())]
 projection=sum(r['referenceRequests']*r['unitCostUsd'] for r in components)
 gate=dict(at=datetime.datetime.now(datetime.timezone.utc).isoformat(),sampleRequests=5,costUsd=sum(r['costUsd'] for r in outcomes),outcomes=outcomes,components=components,projected379UnitsUsd=projection,capUsd=runtime['capUsd'],sourceModel='gpt-6-luna',method='Stage-weighted existing full-run request volumes; unsampled cascade stages use highest sampled cascade cost',proceed=projection<=runtime['capUsd'])
 (BASE/'evidence/cost-sample.json').write_text(json.dumps(gate,indent=2)+'\n')
 if projection>runtime['capUsd']:
  emit(phase='cost-sample',status='paused: cost projection exceeds 25 USD',projected379UnitsUsd=projection);sys.exit(2)
command=tsx+[str(PARENT/'new-cell-run.ts'),MODEL]
for phase,args in [('pilot',['--pilot']),('validity',['--validity']),('noise-0',['--noise','0']),('noise-1',['--noise','1']),('noise-2',['--noise','2']),('results',[])]:
 path=BASE/phase/f'{MODEL}.json'
 if not path.exists():
  if phase=='results':
   sys.path.insert(0,str(BASE));from validate import calculate
   validation=calculate(MODEL);emit(phase=phase,status='validation recorded before TEST',validation=validation)
  emit(phase=phase,status='running',concurrency=runtime['modelConcurrency'][MODEL])
  with (BASE/'logs'/f'{phase}.log').open('w') as log:ran=subprocess.run(command+args+(['--resume-interrupted'] if (BASE/phase/f'{MODEL}.started.json').exists() else []),cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT)
  if ran.returncode or not path.exists():emit(phase=phase,status='runner failed',exitCode=ran.returncode);sys.exit(1)
 report=read(path)
 if report.get('stopped'):emit(phase=phase,status='stopped; requires inspection',reason=report['stopped']);sys.exit(1)
 emit(phase=phase,status='all items attempted',items=report['items'])
 if phase=='pilot':
  fees=read(BASE/'receipts/budget.json');projected=sum(c['costUsd'] for c in report['contestants'])*379/20
  (BASE/'evidence/pilot-projection.json').write_text(json.dumps(dict(at=datetime.datetime.now(datetime.timezone.utc).isoformat(),pilotItems=20,projected379UnitsUsd=projected,capUsd=runtime['capUsd'],proceed=projected<=runtime['capUsd']),indent=2)+'\n')
  if projected>runtime['capUsd']:emit(phase=phase,status='owner budget decision',projected379UnitsUsd=projected);sys.exit(2)
emit(phase='all',status='complete')
with (BASE/'logs/finalizer.log').open('w') as log:subprocess.run(['python3',str(PARENT/'finish-new-cell.py'),MODEL],cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,check=True)
