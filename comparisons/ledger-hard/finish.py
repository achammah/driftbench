"""Wait for the owned driver, verify all results, write the dossier, and push."""
import fcntl, subprocess, time, traceback
from common import *

def call(argv):
    result=subprocess.run(argv,cwd=ROOT,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    print(result.stdout,flush=True)
    if result.returncode:raise RuntimeError(f'Command failed ({result.returncode}): {argv}')
    return result.stdout

def main():
    while True:
        running=False
        for directory in (HERE,HERE/'dialect'):
            with (directory/'runner.lock').open('a') as lock:
                try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
                except BlockingIOError:running=True
        if not running:
            state=json.loads((HERE/'recovery-state.json').read_text())
            if state.get('stop_reason')!='drain requested':break
        time.sleep(30)
    state=json.loads((HERE/'recovery-state.json').read_text())
    billing_pending=state['stop_reason']=='provider billing pending; owner top-up required'
    quota_pending=state['stop_reason']=='Gemini daily quota pending; 262 requests not run'
    pending=billing_pending or quota_pending
    assert state['inflight']==0,state
    if pending:
        assert all(n==0 or 'gemini-3.8-flash' in key for key,n in state['remaining'].items()),state
    else:assert sum(state['remaining'].values())==0 and state['stop_reason'] is None,state
    dump(HERE/'finish-state.json',{'stamp':stamp(),'status':'verifying'})
    tsx=str(ROOT/'node_modules/.bin/tsx')
    call(['python3','comparisons/ledger-hard/check-audit.py'])
    tests=call(['python3','-m','unittest','discover','-s','comparisons/ledger-hard','-p','test_*.py'])
    (HERE/'test-output.txt').write_text(tests)
    call([tsx,'comparisons/ledger-hard/peer-decoder-parity.mts'])
    call([tsx,'comparisons/ledger-hard/peer-decoder-parity.mts','--dialect'])
    call([tsx,'comparisons/ledger-hard/trajectory-parity.mts'])
    call(['python3','comparisons/ledger-hard/verify-final.py','--require-available' if pending else '--require-complete'])
    call(['python3','comparisons/ledger-hard/score.py'])
    call(['python3','comparisons/ledger-hard/dialect-score.py'])
    call(['python3','comparisons/ledger-hard/assemble-report.py']+(['--allow-pending-gemini'] if pending else []))
    proof=json.loads((HERE/'verification-final.json').read_text())
    for experiment,detail in proof['experiments'].items():
        directory=HERE if experiment=='primary' else HERE/'dialect'
        dump(directory/'run-state.json',{'stamp':stamp(),'complete':detail['complete'],'completed_calls':detail['recorded_unique'],
             'selected_unique':detail['planned_unique'],'measured_usd':detail['measured_usd'],'stop_reason':('Gemini daily quota pending' if quota_pending else 'Gemini billing pending') if pending and not detail['complete'] else None,
             'authoritative_verification':'comparisons/ledger-hard/verification-final.json'})
    assert call(['git','branch','--show-current']).strip()=='research/ledger-hard'
    call(['git','status','--short'])
    call(['git','add','comparisons/ledger-hard'])
    call(['git','diff','--cached','--check'])
    call(['git','commit','-m','research: report completed Haiku and Luna hard rows with Gemini daily quota pending' if quota_pending else 'research: report completed Haiku and Luna hard rows with Gemini billing pending' if billing_pending else 'research: report full sealed hard-row primary and dialect measurements'])
    call(['git','push','origin','research/ledger-hard'])
    head=call(['git','rev-parse','HEAD']).strip()
    remote=call(['git','ls-remote','origin','refs/heads/research/ledger-hard']).split()[0]
    assert head==remote
    assert call(['git','status','--porcelain']).strip()==''
    dump(HERE/'finish-state.json',{'stamp':stamp(),'status':'waiting_for_quota' if quota_pending else 'waiting_for_topup' if billing_pending else 'complete','commit':head,
         'dossier_sha256':json.loads((HERE/'delivery.json').read_text())['dossier_sha256']})

if __name__=='__main__':
    try:main()
    except Exception:
        dump(HERE/'finish-state.json',{'stamp':stamp(),'status':'needs_attention','error':traceback.format_exc()})
        raise
