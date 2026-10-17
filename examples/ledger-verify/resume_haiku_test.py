"""Resume only missing sealed TEST requests after the owner-authorized Haiku pacing drain."""
import datetime
import json
import os
from pathlib import Path
import subprocess

BASE=Path(__file__).resolve().parent
ROOT=BASE.parents[1]


def emit(status, **extra):
    state=dict(at=datetime.datetime.now(datetime.timezone.utc).isoformat(),model='haiku',phase='results',status=status,**extra)
    (BASE/'haiku.progress.json').write_text(json.dumps(state,indent=2)+'\n')
    print(json.dumps(state),flush=True)


if __name__=='__main__':
    for phase in ['pilot','validity','noise-0','noise-1','noise-2']:
        report=json.loads((BASE/phase/'haiku.json').read_text());assert not report.get('stopped')
    assert not (BASE/'results/haiku.json').exists()
    assert json.loads((BASE/'evidence/haiku-outage-recovery.json').read_text())['status']=='complete'
    env=dict(os.environ)
    for key in ['OPENAI_API_KEY','GEMINI_API_KEY','ANTHROPIC_API_KEY']:env.pop(key,None)
    env['TMPDIR']=str(ROOT/'.tmp')
    env['VERIFY_CORE_DOSSIER']=os.environ['VERIFY_CORE_DOSSIER']
    emit('running',concurrency=4,fallback=2,amendment='evidence/haiku-pacing-amendment.json')
    with (BASE/'logs/haiku-test-four-workers.log').open('w') as log:
        child=subprocess.run([str(ROOT/'node_modules/.bin/tsx'),'--tsconfig','examples/ledger-verify/tsconfig.json',
                              'examples/ledger-verify/run.ts','haiku','--resume-interrupted'],cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT)
    assert child.returncode==0,child.returncode
    result=json.loads((BASE/'results/haiku.json').read_text())
    if result.get('stopped'):
        emit('stopped; requires inspection',reason=result['stopped'])
    else:
        state=dict(at=datetime.datetime.now(datetime.timezone.utc).isoformat(),model='haiku',phase='all',status='complete')
        (BASE/'haiku.progress.json').write_text(json.dumps(state,indent=2)+'\n')
        print(json.dumps(state),flush=True)
