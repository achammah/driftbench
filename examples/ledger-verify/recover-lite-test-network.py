"""Recover TEST no-answers and continue with first completed item results retained."""
import concurrent.futures,datetime,fcntl,json,os,subprocess,sys
from pathlib import Path
BASE=Path(__file__).resolve().parent;ROOT=BASE.parents[1];LITE=BASE/'lite'
MODEL='gemini-3.5-flash-lite'
def load(p):return json.loads(p.read_text())
def stamp():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def probe():subprocess.run(['node',str(BASE/'lite-connectivity.mjs')],cwd=ROOT,check=True)
def receipts():return [json.loads(s) for s in (LITE/'receipts/calls.jsonl').read_text().splitlines() if s]
def hit(fp):return next((r for r in receipts() if r.get('fingerprint')==fp and r.get('phase')=='test' and not r.get('status')),None)
def attempts(fp):
    p=LITE/'receipts/test-network-recovery-claims.json'
    if not p.exists():return 0
    with p.open() as f:
        fcntl.flock(f,fcntl.LOCK_SH)
        return len(json.load(f).get(fp,[]))
env=dict(os.environ,TMPDIR=str(ROOT/'.tmp'),VERIFY_PHASE='test',VERIFY_LITE_NETWORK_RECOVERY='1',VERIFY_LITE_RECOVERY_SET='test-network',VERIFY_GEMINI_KEY_FILE=str(Path.home()/'.nexus-secrets/gemini-driftbench.key'))
for key in ['OPENAI_API_KEY','GEMINI_API_KEY','ANTHROPIC_API_KEY']:env.pop(key,None)
requests=load(LITE/'cache/test-network-recovery/requests.json')
assert len(requests)==25 and len({r['fingerprint'] for r in requests})==25
wave=load(LITE/'evidence/test-network-wave.json');assert {r['fingerprint'] for r in requests}=={r['fingerprint'] for r in wave['errors']}
statefile=LITE/'evidence/test-network-recovery-state.json'
def emit(**s):
    s.update(at=stamp(),pid=os.getpid());statefile.write_text(json.dumps(s,indent=2)+'\n');print(json.dumps(s),flush=True)
def one(request):
    fp=request['fingerprint']
    if hit(fp):return dict(fingerprint=fp,cached=True)
    if attempts(fp)>=2:return dict(fingerprint=fp,exhausted=True)
    ran=subprocess.run([str(BASE/'lite-transport.sh'),'--model',MODEL,'--system-prompt',request['system']],input=request['user'],text=True,capture_output=True,cwd=ROOT,env=env)
    output=LITE/'cache/test-network-recovery'/f'{fp}.output.json'
    output.write_text(json.dumps(dict(exitCode=ran.returncode,stdout=ran.stdout,stderr=ran.stderr),indent=2)+'\n')
    return dict(fingerprint=fp,answered=hit(fp) is not None,additionalSubmissions=attempts(fp),exitCode=ran.returncode)
for round in range(2):
    missing=[r for r in requests if not hit(r['fingerprint']) and attempts(r['fingerprint'])<2]
    if not missing:break
    probe();emit(status='recovering',round=round+1,missing=len(missing),workers=4)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for result in pool.map(one,missing):print(json.dumps(result),flush=True)
    if load(LITE/'receipts/budget.json').get('billingStopped'):raise RuntimeError('HTTP 402 circuit open; no continuation')
answered={r['fingerprint']:hit(r['fingerprint']) for r in requests}
emit(status='recovery finished',answered=sum(v is not None for v in answered.values()),missing=sum(v is None for v in answered.values()))
assert all(answered.values()), 'Authorized attempts exhausted; preserve unanswered requests and report'
cassette=LITE/'recordings/flash-lite-medium-20261013/test/longjudge-verify'/f'{MODEL}.jsonl'
original=cassette.with_name(f'{MODEL}.pre-test-network-recovery.jsonl')
rows=[json.loads(s) for s in original.read_text().splitlines() if s]
report=LITE/'results'/f'{MODEL}.json'
prior=load(report.with_name(f'{MODEL}.pre-test-network-recovery.json'))
completed={(c['contestant'],d['id']) for c in prior['contestants'] for d in c['decisions'] if not d['missing']}
assert len(completed)==117
final_failed={(r['contestant'],r['item']) for r in rows if r.get('failure') and r['order']=='single'}
bykey={r['key']:answered[r['fingerprint']] for r in requests}
assert sum('failure' in r for r in rows)==25
updated=[];applied=[];unused=[]
for r in rows:
    if 'failure' in r:
        pair=(r['contestant'],r['item'])
        if pair not in completed and (pair not in final_failed or r['order']=='single'):
            answer=bykey[r['key']];r={k:v for k,v in r.items() if k!='failure'}
            r.update(text=answer['text'],costUsd=answer['costUsd']);applied.append(r['key'])
        else:unused.append(r['key'])
    updated.append(r)
assert all(r in updated for r in rows if 'failure' not in r)
cassette.write_text(''.join(json.dumps(r)+'\n' for r in updated))
assert report.read_bytes()==report.with_name(f'{MODEL}.pre-test-network-recovery.json').read_bytes()
report.unlink()
emit(status='continuing TEST',answered=25,firstCompletedResultsPreserved=117,recoveredAnswersApplied=len(applied),recoveredAnswersRetainedWithoutChangingPriorChain=len(unused),unusedKeys=unused)
env.pop('VERIFY_LITE_NETWORK_RECOVERY');env.pop('VERIFY_LITE_RECOVERY_SET');env['VERIFY_CORE_DOSSIER']='<scratchpad>/codex/dossier-ledger-core.md'
progress=LITE/f'{MODEL}.progress.json';progress.write_text(json.dumps(dict(at=stamp(),phase='results',status='running',model=MODEL,concurrency=4))+'\n')
command=[str(ROOT/'node_modules/.bin/tsx'),'--tsconfig','examples/ledger-verify/tsconfig.json','examples/ledger-verify/resume-lite-test.ts']
with (LITE/'logs/test-network-resume.log').open('w') as log:subprocess.run(command,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,check=True)
result=load(report)
if result.get('stopped'):
    progress.write_text(json.dumps(dict(at=stamp(),phase='results',status='stopped; requires inspection',model=MODEL,reason=result['stopped']))+'\n')
    raise RuntimeError('TEST continuation stopped; inspect evidence')
for c in prior['contestants']:
    actual=next(x for x in result['contestants'] if x['contestant']==c['contestant']);index={d['id']:d for d in actual['decisions']}
    assert all(d==index[d['id']] for d in c['decisions'] if not d['missing'])
progress.write_text(json.dumps(dict(at=stamp(),phase='all',status='complete',model=MODEL))+'\n')
emit(status='all phases complete',answered=25,firstCompletedResultsPreserved=117)
