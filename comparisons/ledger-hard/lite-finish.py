"""Watch this cell only, verify full coverage, publish the report, then exit."""
import fcntl,subprocess,time,traceback
from common import *
r=load_module('finish_lite_runner',HERE/'lite-run.py')

def call(args):
    result=subprocess.run(args,cwd=ROOT,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    print(result.stdout,flush=True)
    if result.returncode:raise RuntimeError(f'Command failed: {args}')
    return result.stdout

def main():
    while True:
        with (r.DEST/'runner.lock').open('a') as lock:
            try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);running=False
            except BlockingIOError:running=True
        if not running:
            state=json.loads((r.DEST/'run-state.json').read_text())
            if state['stop_reason']!='drain requested':break
        time.sleep(30)
    assert state['completed']==6560 and state['inflight']==0 and state['stop_reason'] is None,state
    dump(r.DEST/'finish-state.json',{'stamp':stamp(),'status':'verifying'})
    seal=r.verify_seal()
    for path,value in seal['parked_journal_sha256'].items():assert digest(ROOT/path)==value,path
    assert r.prepared_requests()==json.loads((r.DEST/'requests.json').read_text())
    call(['python3',str(HERE/'check-audit.py')])
    tsx=str(ROOT/'node_modules/.bin/tsx')
    call([tsx,str(HERE/'lite-peer-parity.mts')]);call([tsx,str(HERE/'lite-peer-parity.mts'),'--dialect'])
    tests=call(['python3','-m','unittest','discover','-s','comparisons/ledger-hard','-p','test_*.py'])
    (r.DEST/'test-output.txt').write_text(tests)
    call(['python3',str(HERE/'lite-score.py'),'--require-complete'])
    call(['python3',str(HERE/'assemble-report.py'),'--allow-pending-gemini'])
    assert call(['git','branch','--show-current']).strip()=='research/ledger-hard'
    call(['git','status','--short']);call(['git','add','comparisons/ledger-hard'])
    call(['git','diff','--cached','--check'])
    call(['git','commit','-m','research: report complete separate Flash-Lite hard-row cells'])
    call(['git','push','origin','research/ledger-hard'])
    head=call(['git','rev-parse','HEAD']).strip();remote=call(['git','ls-remote','origin','refs/heads/research/ledger-hard']).split()[0]
    assert head==remote and not call(['git','status','--porcelain']).strip()
    dump(r.DEST/'finish-state.json',{'stamp':stamp(),'status':'complete','commit':head,'gemini_3_8_status':'owner-held; 262 missing','dossier_sha256':json.loads((HERE/'delivery.json').read_text())['dossier_sha256']})

if __name__=='__main__':
    try:main()
    except Exception:
        dump(r.DEST/'finish-state.json',{'stamp':stamp(),'status':'needs_attention','error':traceback.format_exc()})
        raise
