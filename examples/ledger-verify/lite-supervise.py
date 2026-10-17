"""Sequential phase driver. Reads pilot completion, preserves failures, never tunes or retries."""
import datetime
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'examples/ledger-verify/lite'
sys.path.insert(0,str(BASE))
MODELS=['gemini-3.5-flash-lite']
model=sys.argv[1]
assert model in MODELS
runtime=json.loads((BASE/'evidence/runtime-freeze.json').read_text())
def emit(**state):
    state.update(at=datetime.datetime.now(datetime.timezone.utc).isoformat(),model=model)
    (BASE/f'{model}.progress.json').write_text(json.dumps(state,indent=2)+'\n')
    print(json.dumps(state),flush=True)
def load(phase):
    return json.loads((BASE/phase/f'{model}.json').read_text())
def valid_report(report):
    return not report.get('stopped') and all(c['summary']['missing']==0 for c in report['contestants'])
def at_cutoff():
    return runtime.get('deadlineAt') is not None and time.time()*1000>=runtime['deadlineAt']

env=dict(os.environ)
# Paths only. The provider wrapper reads each key inside its own command.
env['VERIFY_CORE_DOSSIER']='<scratchpad>/codex/dossier-ledger-core.md'
env['VERIFY_OPENAI_KEY_FILE']=str(Path.home()/'.nexus-secrets/openai.key')
env['VERIFY_GEMINI_KEY_FILE']=str(Path.home()/'.nexus-secrets/gemini-driftbench.key')
for key in ['OPENAI_API_KEY','GEMINI_API_KEY','ANTHROPIC_API_KEY']:env.pop(key,None)
env['TMPDIR']=str(ROOT/'.tmp');(ROOT/'.tmp').mkdir(exist_ok=True)
command=[str(ROOT/'node_modules/.bin/tsx'),'--tsconfig','examples/ledger-verify/tsconfig.json','examples/ledger-verify/lite-run.ts',model]
emit(phase='pilot',status='running',concurrency=8)
(BASE/'logs').mkdir(exist_ok=True)
if not (BASE/'pilot'/f'{model}.json').exists():
    with (BASE/'logs'/f'{model}-pilot.log').open('w') as log:
        ran=subprocess.run(command+['--pilot'],cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT)
    assert ran.returncode==0, 'Pilot runner failed; inspect log, never rerun blindly'
pilot=load('pilot')
receipts=[json.loads(line) for line in (BASE/'receipts/calls.jsonl').read_text().splitlines() if line]
answers=[r for r in receipts if not r.get('status')]
if answers:
    (BASE/'evidence/reasoning-applied.json').write_text(json.dumps(dict(at=datetime.datetime.now(datetime.timezone.utc).isoformat(),model=model,requested='medium',applied='medium',firstSuccessfulReceipt=answers[0]['id'],evidence='Successful core dialect request with thinkingLevel medium'),indent=2)+'\n')

if pilot.get('stopped'):
    emit(phase='pilot',status='stopped; requires inspection',reason=pilot.get('stopped'));sys.exit(1)
emit(phase='pilot',status='complete',items=pilot['items'],costUsd=sum(c['costUsd'] for c in pilot['contestants']),projectedAll379ItemsUsd=sum(c['costUsd'] for c in pilot['contestants'])*379/20)
for phase,args in [('validity',['--validity']),('noise-0',['--noise','0']),('noise-1',['--noise','1']),('noise-2',['--noise','2']),('results',[])]:
    if (BASE/phase/f'{model}.json').exists():
        emit(phase=phase,status='already recorded; no rerun');continue
    if at_cutoff():
        emit(phase=phase,status='last-call cutoff');sys.exit(1)
    if phase=='results':
        from validate import calculate
        validation=calculate(model)
        # The owner requires the full sealed run. Failed validity checks suppress claims, never select TEST items.
        emit(phase=phase,status='validation recorded before TEST',validation=validation)
    emit(phase=phase,status='running',concurrency=runtime['modelConcurrency'][model])
    (BASE/'logs').mkdir(exist_ok=True)
    with (BASE/'logs'/f'{model}-{phase}.log').open('w') as log:
        ran=subprocess.run(command+args,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT)
    if ran.returncode!=0 or not (BASE/phase/f'{model}.json').exists():
        emit(phase=phase,status='runner failed',exitCode=ran.returncode);sys.exit(1)
    report=load(phase)
    emit(phase=phase,status='stopped; requires inspection' if report.get('stopped') else 'all items attempted',items=report['items'],newCostUsd=report['newSpendUsd'],reason=report.get('stopped'),missing={c['contestant']:c['summary']['missing'] for c in report['contestants']})
    if report.get('stopped'):sys.exit(1)
emit(phase='all',status='complete')
