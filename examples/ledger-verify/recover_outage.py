"""One owner-authorized retry of five proven Haiku no-answer requests, then missing-only replay."""
import concurrent.futures
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

BASE = Path(__file__).resolve().parent
ROOT = BASE.parents[1]
EVIDENCE = BASE / 'evidence/haiku-outage-recovery.json'


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def save(**state):
    EVIDENCE.write_text(json.dumps(dict(at=now(), pid=os.getpid(), **state), indent=2) + '\n')
    print(json.dumps({k:v for k,v in state.items() if k != 'requests'}), flush=True)


def main():
    amendment = json.loads((BASE / 'evidence/haiku-outage-amendment.json').read_text())
    runtime = json.loads((BASE / 'evidence/runtime-freeze.json').read_text())
    report = BASE / 'noise-2/haiku.json'
    save(status='waiting for current noise-2 runner to finish')
    while not report.exists() or (BASE / 'noise-2/haiku.active.json').exists():
        time.sleep(5)
    original_report = report.read_bytes()
    archive = BASE / 'noise-2/haiku.pre-outage-recovery.partial.json'
    if archive.exists():
        assert archive.read_bytes() == original_report
    else:
        archive.write_bytes(original_report)
    cassette = BASE / 'recordings' / runtime['recordingsId'] / 'noise-2/longjudge-verify/haiku.jsonl'
    original_cassette = cassette.read_bytes()
    cassette_archive = cassette.with_name('haiku.pre-outage-recovery.partial.jsonl')
    if cassette_archive.exists():
        assert cassette_archive.read_bytes() == original_cassette
    else:
        cassette_archive.write_bytes(original_cassette)
    env = dict(os.environ)
    for key in ['OPENAI_API_KEY','GEMINI_API_KEY','ANTHROPIC_API_KEY']:
        env.pop(key, None)
    env['TMPDIR'] = str(ROOT / '.tmp')
    env['VERIFY_PHASE'] = 'noise-2'
    env['VERIFY_CORE_DOSSIER'] = os.environ['VERIFY_CORE_DOSSIER']
    tsx = [str(ROOT / 'node_modules/.bin/tsx'),'--tsconfig','examples/ledger-verify/tsconfig.json']
    subprocess.run(tsx + ['examples/ledger-verify/prepare-outage.ts'], cwd=ROOT, env=env, check=True)
    requests = json.loads((BASE / 'cache/outage/requests.json').read_text())
    assert {r['fingerprint'] for r in requests} == {r['fingerprint'] for r in amendment['calls']}
    # Same provider implementation, plus a five-fingerprint allowlist and an atomic once-only claim.
    source = (BASE / 'transport.ts').read_text()
    def replace_once(old, new):
        nonlocal source
        assert source.count(old) == 1, old
        source = source.replace(old, new)
    replace_once("import { appendFile, mkdir, readFile }", "import { appendFile, mkdir, readFile, writeFile }")
    replace_once('  callFingerprint=fingerprint(freeze.coreSha);', '''  callFingerprint=fingerprint(freeze.coreSha);
  const outage=JSON.parse(await readFile(resolve(base,'evidence/haiku-outage-amendment.json'),'utf8'));
  if(model!=='haiku'||process.env.VERIFY_PHASE!=='noise-2'||!outage.calls.some((r:any)=>r.fingerprint===callFingerprint))throw new Error('Outside authorized outage recovery');
  const excludedIds=new Set(outage.calls.map((r:any)=>r.id));''')
    replace_once('.find(r=>!', '.find(r=>!excludedIds.has(r.id)&&!')
    replace_once('  await acquire();\n  budget(\'reserve\'', '''  await writeFile(resolve(base,'cache/outage',callFingerprint+'.claim.json'),JSON.stringify({id,at:new Date().toISOString(),fingerprint:callFingerprint}),{flag:'wx'});
  await acquire();
  budget('reserve' ''')
    # Whitespace after the string is harmless, but verify the generated code before paid requests.
    generated = BASE / 'outage-transport.generated.ts'
    generated.write_text(source)
    save(status='retrying only five authorized no-answer requests', requests=[dict(key=r['key'],fingerprint=r['fingerprint']) for r in requests],
         transportSourceSha256=hashlib.sha256(source.encode()).hexdigest(), originalCassetteSha256=hashlib.sha256(original_cassette).hexdigest())
    if '--prepare-only' in sys.argv:
        save(status='prepared offline; no provider calls', authorizedRequests=len(requests),
             transportSourceSha256=hashlib.sha256(source.encode()).hexdigest())
        return
    def retry(request):
        path = BASE / 'cache/outage' / (request['fingerprint'] + '.response.json')
        if path.exists():
            value = json.loads(path.read_text())
        else:
            result = subprocess.run(tsx + [str(generated),'--model','haiku','--system-prompt',request['prompt']['system']],
                                    input=request['prompt']['user'],text=True,capture_output=True,cwd=ROOT,env=env,check=True)
            if result.stderr:
                with (BASE / 'logs/outage-recovery.stderr.log').open('a') as log:log.write(result.stderr)
            value = json.loads(result.stdout)
            path.write_text(json.dumps(value) + '\n')
        assert not str(value.get('result','')).startswith('Transport limit:'), value.get('result')
        return request, value
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        recovered = list(pool.map(retry, requests))
    assert cassette.read_bytes() == original_cassette, 'A concurrent writer changed noise-2'
    replacements = {r['key']:value for r,value in recovered}
    rows = [json.loads(line) for line in original_cassette.splitlines()]
    unchanged_answers = {r['key']:r for r in rows if 'failure' not in r}
    for row in rows:
        if row['key'] not in replacements:
            continue
        assert 'failure' in row
        value = replacements[row['key']]
        if value.get('is_error'):
            row.update(failure=value['result'], text='', costUsd=0)
        else:
            row.pop('failure')
            row.update(text=value['result'], costUsd=value['total_cost_usd'])
    assert all(r == unchanged_answers[r['key']] for r in rows if r['key'] in unchanged_answers)
    cassette.write_text(''.join(json.dumps(r,separators=(',',':'))+'\n' for r in rows))
    report.unlink()  # The immutable original report above is retained.
    with (BASE / 'logs/haiku-outage-noise-replay.log').open('w') as log:
        subprocess.run(tsx + ['examples/ledger-verify/run.ts','haiku','--noise','2','--resume-interrupted'],
                       cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,check=True)
    final = json.loads(report.read_text())
    assert not final.get('stopped'), final.get('stopped')
    save(status='complete', requests=[dict(key=r['key'],fingerprint=r['fingerprint'],isError=v.get('is_error',False)) for r,v in recovered],
         authorizedRetries=5,returnedAnswersPreserved=len(unchanged_answers),unknownTimeoutHold='retained',
         missing={c['contestant']:c['summary']['missing'] for c in final['contestants']},
         transportSourceSha256=hashlib.sha256(source.encode()).hexdigest(), originalCassetteSha256=hashlib.sha256(original_cassette).hexdigest())


if __name__ == '__main__':
    main()
