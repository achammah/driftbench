"""Recover only the authorized no-answer set, then continue the sealed phases."""
import concurrent.futures,datetime,fcntl,json,os,subprocess,sys
from pathlib import Path
BASE=Path(__file__).resolve().parent;ROOT=BASE.parents[1];LITE=BASE/'lite'
MODEL='gemini-3.5-flash-lite'
def load(p):return json.loads(p.read_text())
def stamp():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def probe():subprocess.run(['node',str(BASE/'lite-connectivity.mjs')],cwd=ROOT,check=True)
def receipts():return [json.loads(s) for s in (LITE/'receipts/calls.jsonl').read_text().splitlines() if s]
def hit(fp):return next((r for r in receipts() if r.get('fingerprint')==fp and r.get('phase')=='noise-0' and not r.get('status')),None)
def attempts(fp):
    p=LITE/'receipts/network-recovery-claims.json'
    if not p.exists():return 0
    with p.open() as f:
        fcntl.flock(f,fcntl.LOCK_SH)
        return len(json.load(f).get(fp,[]))
env=dict(os.environ,TMPDIR=str(ROOT/'.tmp'),VERIFY_PHASE='noise-0',VERIFY_LITE_NETWORK_RECOVERY='1',VERIFY_GEMINI_KEY_FILE=str(Path.home()/'.nexus-secrets/gemini-driftbench.key'))
for key in ['OPENAI_API_KEY','GEMINI_API_KEY','ANTHROPIC_API_KEY']:env.pop(key,None)
requests=load(LITE/'cache/network-recovery/requests.json')
assert len(requests)==35 and len({r['fingerprint'] for r in requests})==35
wave=load(LITE/'evidence/network-wave.json');assert {r['fingerprint'] for r in requests}=={r['fingerprint'] for r in wave['errors']}
statefile=LITE/'evidence/network-recovery-state.json'
def emit(**s):
    s.update(at=stamp(),pid=os.getpid());statefile.write_text(json.dumps(s,indent=2)+'\n');print(json.dumps(s),flush=True)
def one(request):
    fp=request['fingerprint']
    if hit(fp):return dict(fingerprint=fp,cached=True)
    if attempts(fp)>=2:return dict(fingerprint=fp,exhausted=True)
    ran=subprocess.run([str(BASE/'lite-transport.sh'),'--model',MODEL,'--system-prompt',request['system']],input=request['user'],text=True,capture_output=True,cwd=ROOT,env=env)
    output=LITE/'cache/network-recovery'/f'{fp}.output.json'
    output.write_text(json.dumps(dict(exitCode=ran.returncode,stdout=ran.stdout,stderr=ran.stderr),indent=2)+'\n')
    return dict(fingerprint=fp,answered=hit(fp) is not None,additionalSubmissions=attempts(fp),exitCode=ran.returncode)
for round in range(2):
    missing=[r for r in requests if not hit(r['fingerprint']) and attempts(r['fingerprint'])<2]
    if not missing:break
    probe();emit(status='recovering',round=round+1,missing=len(missing),workers=8)
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        for result in pool.map(one,missing):print(json.dumps(result),flush=True)
    if load(LITE/'receipts/budget.json').get('billingStopped'):raise RuntimeError('HTTP 402 circuit open; no continuation')
answered={r['fingerprint']:hit(r['fingerprint']) for r in requests}
emit(status='recovery finished',answered=sum(v is not None for v in answered.values()),missing=sum(v is None for v in answered.values()))
assert all(answered.values()), 'Authorized attempts exhausted; preserve unanswered requests and report'
cassette=LITE/'recordings/flash-lite-medium-20261013/noise-0/longjudge-verify'/f'{MODEL}.jsonl'
original=cassette.with_name(f'{MODEL}.pre-network-recovery.jsonl')
rows=[json.loads(s) for s in original.read_text().splitlines() if s]
bykey={r['key']:answered[r['fingerprint']] for r in requests}
assert sum('failure' in r for r in rows)==35
updated=[]
for r in rows:
    if 'failure' in r:
        answer=bykey[r['key']];r={k:v for k,v in r.items() if k!='failure'}
        r.update(text=answer['text'],costUsd=answer['costUsd'])
    updated.append(r)
assert [r for r in updated if r['key'] not in bykey]==[r for r in rows if 'failure' not in r]
cassette.write_text(''.join(json.dumps(r)+'\n' for r in updated))
report=LITE/'noise-0'/f'{MODEL}.json'
assert report.read_bytes()==report.with_name(f'{MODEL}.pre-network-recovery.json').read_bytes()
report.unlink()
env.pop('VERIFY_LITE_NETWORK_RECOVERY');env['VERIFY_CORE_DOSSIER']='<scratchpad>/codex/dossier-ledger-core.md'
progress=LITE/f'{MODEL}.progress.json';progress.write_text(json.dumps(dict(at=stamp(),phase='noise-0',status='running',model=MODEL,concurrency=8))+'\n')
command=[str(ROOT/'node_modules/.bin/tsx'),'--tsconfig','examples/ledger-verify/tsconfig.json','examples/ledger-verify/lite-run.ts',MODEL,'--noise','0','--resume-interrupted']
with (LITE/'logs/network-noise-resume.log').open('w') as log:subprocess.run(command,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,check=True)
assert not load(report).get('stopped'),'Noise recovery stopped; inspect before continuing'
emit(status='noise-0 completed; continuing remaining phases',answered=35)
subprocess.run([sys.executable,str(BASE/'lite-supervise.py'),MODEL],cwd=ROOT,env=env,check=True)
