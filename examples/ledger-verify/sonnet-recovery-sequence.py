"""Watch this cell's quota recovery, finish its missing noise work, then run its sealed TEST once."""
import datetime,json,os,subprocess,time
from pathlib import Path
BASE=Path(__file__).resolve().parent;ROOT=BASE.parents[1];CELL=BASE/'sonnet';MODEL='claude-sonnet-5-5'
def read(p):return json.loads(p.read_text())
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def main():
 state=CELL/'evidence/native-quota-recovery-state.json'
 deadline=time.time()+12*3600
 while time.time()<deadline:
  if state.exists():
   s=read(state)
   if s['status']=='complete':break
   if s['status'] not in ['probe answered']:
    print(json.dumps(s),flush=True);return
  time.sleep(15)
 else:raise RuntimeError('Recovery watcher deadline reached; no paid continuation')
 env=dict(os.environ,TMPDIR=str(ROOT/'.tmp'))
 for k in ['OPENAI_API_KEY','GEMINI_API_KEY','ANTHROPIC_API_KEY']:env.pop(k,None)
 env['VERIFY_CORE_DOSSIER']=os.environ['VERIFY_CORE_DOSSIER']
 commands=[['node_modules/.bin/tsx','--tsconfig','examples/ledger-verify/tsconfig.json',str(BASE/'continue-sonnet-quota.ts')],['python3',str(BASE/'new-cell-supervise.py'),MODEL]]
 for i,command in enumerate(commands):
  phase='quota continuation' if i==0 else 'remaining noise and TEST'
  (CELL/f'{MODEL}.progress.json').write_text(json.dumps(dict(at=now(),model=MODEL,status='running',phase=phase,pid=os.getpid()),indent=2)+'\n')
  with (CELL/'logs'/f'quota-sequence-{i}.log').open('w') as log:
   ran=subprocess.run(command,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT)
  print(json.dumps(dict(at=now(),phase=phase,exitCode=ran.returncode)),flush=True)
  if ran.returncode:return
if __name__=='__main__':main()
