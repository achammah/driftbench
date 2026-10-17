"""Wait for full execution, then build the offline evidence bundle. No provider calls."""
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
MODELS = ['haiku', 'gpt-6-luna', 'gemini-3.8-flash']
PHASES = {'pilot': 20, 'validity': 48, 'noise-0': 30, 'noise-1': 30, 'noise-2': 30, 'results': 221}
DOSSIER = Path(os.environ['LEDGER_VERIFY_DOSSIER'])
ALLOW_QUOTA_PAUSE = '--allow-daily-quota' in sys.argv
REQUIRED_MODELS = MODELS[:2] if ALLOW_QUOTA_PAUSE else MODELS

def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def ready():
    test_amendment = BASE / 'evidence/haiku-test-timeouts.json'
    if test_amendment.exists():
        try:
            test_recovery = json.loads((BASE / 'evidence/haiku-test-timeout-recovery.json').read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            return False
        if test_recovery.get('status') != 'complete':
            return False
    outage = BASE / 'evidence/haiku-outage-amendment.json'
    if outage.exists():
        try:
            recovered = json.loads((BASE / 'evidence/haiku-outage-recovery.json').read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            return False
        if recovered.get('status') != 'complete':
            return False
    for model in REQUIRED_MODELS:
        try:
            state = json.loads((BASE / f'{model}.progress.json').read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            # A supervisor can be replacing this small status file at this instant.
            return False
        if state.get('phase') != 'all' or state.get('status') != 'complete':
            return False
    return True

if '--wait' in sys.argv:
    (BASE / 'evidence/finalizer-state.json').write_text(json.dumps({'pid': os.getpid(), 'at': now(), 'status': 'waiting', 'target': REQUIRED_MODELS, 'stop': 'offline verification finishes or fails'}, indent=2) + '\n')
    while not ready():
        time.sleep(30)
assert ready(), 'The complete sealed runs must finish first'
if ALLOW_QUOTA_PAUSE:
    amendment = json.loads((BASE / 'evidence/gemini-daily-quota-amendment.json').read_text())
    gemini = json.loads((BASE / 'gemini-3.8-flash.progress.json').read_text())
    assert gemini['status'] == 'not run: daily quota'
    assert not (BASE / 'results/gemini-3.8-flash.json').exists()
    assert not (BASE / 'noise-2/gemini-3.8-flash.active.json').exists()
for model in REQUIRED_MODELS:
    for phase, count in PHASES.items():
        report = json.loads((BASE / phase / f'{model}.json').read_text())
        assert report['items'] == count and not report.get('stopped'), (model, phase)
        assert len(report['contestants']) == 2
        assert all(len(c['decisions']) == count for c in report['contestants'])

env = dict(os.environ)
for key in ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'VERIFY_OPENAI_KEY_FILE', 'VERIFY_GEMINI_KEY_FILE']:
    env.pop(key, None)
env['TMPDIR'] = str(ROOT / '.tmp')
commands = [
    ['python3', 'examples/ledger-verify/validate-replay-artifacts.py'],
    ['python3', 'examples/ledger-verify/output_limits.py'],
    ['python3', 'examples/ledger-verify/summarize.py'],
]
try:
    for index, command in enumerate(commands):
        with (BASE / 'logs' / f'finalize-{index}.log').open('w') as log:
            subprocess.run(command, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
    limits = json.loads((BASE / 'evidence/output-limit-errors.json').read_text())
    assert not limits['unmappedLimits']
    replay = json.loads((BASE / 'evidence/phase-replay-checks.json').read_text())
    expected_phases = 16 if ALLOW_QUOTA_PAUSE else 18
    assert len(replay['phases']) == expected_phases and all(p['identicalDecisions'] and p['newCalls'] == 0 for p in replay['phases'])
    cells = json.loads((BASE / 'evidence/cells.json').read_text())
    assert cells['fees']['maximumAccountedUsd'] <= 40
    cells['cheaterGateAuditFile'] = 'evidence/cheater-gate-audit.json'
    cells['predeclaredCheaterMarginEstablished'] = False
    fee_path = BASE / 'evidence/luna-cache-write-reconciliation.json'
    if fee_path.exists():
        cells['lunaFeeReconciliation'] = json.loads(fee_path.read_text())
        cells['freeze']['hashes']['evidence/luna-cache-write-reconciliation.json'] = hashlib.sha256(fee_path.read_bytes()).hexdigest()
    for cell in cells['cells']:
        cell['validityPassedScope'] = 'Planted mutation checks only; predeclared cheater margin not established'
    quota_path = BASE / 'evidence/gemini-daily-quota-amendment.json'
    if quota_path.exists():
        cells['runtimeAmendments'] = ['evidence/gemini-daily-quota-amendment.json']
        cells['freeze']['hashes']['evidence/gemini-daily-quota-amendment.json'] = hashlib.sha256(quota_path.read_bytes()).hexdigest()
    outage_path = BASE / 'evidence/haiku-outage-amendment.json'
    if outage_path.exists():
        cells.setdefault('runtimeAmendments', []).append('evidence/haiku-outage-amendment.json')
        cells['freeze']['hashes']['evidence/haiku-outage-amendment.json'] = hashlib.sha256(outage_path.read_bytes()).hexdigest()
        cells['outageRecovery'] = json.loads((BASE / 'evidence/haiku-outage-recovery.json').read_text())
    pacing_path = BASE / 'evidence/haiku-pacing-amendment.json'
    test_recovery_path = BASE / 'evidence/haiku-test-timeout-recovery.json'
    if test_recovery_path.exists():
        test_recovery = json.loads(test_recovery_path.read_text())
        targets = {r['fingerprint'] for r in test_recovery['requests']}
        original_ids = {r['id'] for r in json.loads((BASE / 'evidence/haiku-test-timeouts.json').read_text())['calls']}
        physical = [r for r in map(json.loads, (BASE / 'receipts/calls.jsonl').read_text().splitlines()) if r.get('model') == 'haiku' and r.get('phase') == 'test' and r.get('fingerprint') in targets and r['id'] not in original_ids]
        test_recovery['newReceiptIds'] = [r['id'] for r in physical]
        test_recovery['newSettledUsd'] = sum(r['costUsd'] for r in physical)
        test_recovery['feeAttributionPolicy'] = 'All physical recovery receipts, including responses reused after a scheduler restart'
        test_recovery_path.write_text(json.dumps(test_recovery, indent=2) + '\n')
        cells['haikuTestTimeoutRecovery'] = test_recovery
        for name in ['haiku-test-timeouts.json', 'haiku-test-timeout-execution.json', 'haiku-test-timeout-recovery.json']:
            rel = 'evidence/' + name
            cells.setdefault('runtimeAmendments', []).append(rel)
            cells['freeze']['hashes'][rel] = hashlib.sha256((BASE / rel).read_bytes()).hexdigest()
    if pacing_path.exists():
        cells.setdefault('runtimeAmendments', []).append('evidence/haiku-pacing-amendment.json')
        cells['freeze']['hashes']['evidence/haiku-pacing-amendment.json'] = hashlib.sha256(pacing_path.read_bytes()).hexdigest()
        cells['haikuPacing'] = json.loads(pacing_path.read_text())['rules']
    if ALLOW_QUOTA_PAUSE:
        cell = next(c for c in cells['cells'] if c['model'] == 'gemini-3.8-flash')
        cell['status'] = 'not run: daily quota'
        cell['pendingTestItemsPerContestant'] = 221
        cell['phaseCoverage']['results'] = dict(status='not run: daily quota', pendingItemsPerContestant=221)
        cell['pendingNoise2PerContestant'] = {k: len(v) for k, v in amendment['pendingNoise2Ids'].items()}
        # Quota is an execution pause. It cannot become a judge error or an observed noise flip.
        cell['validation']['noise'] = {}
        cell['validation']['noiseStatus'] = 'pending: daily quota; incomplete repeat excluded'
        cells['noiseFloor']['gemini-3.8-flash'] = {}
        (BASE / 'evidence/validation-gemini-3.8-flash.json').write_text(json.dumps(cell['validation'], indent=2) + '\n')
    (BASE / 'evidence/cells.json').write_text(json.dumps(cells, indent=2) + '\n')
    subprocess.run(['python3', 'examples/ledger-verify/render_report.py', str(DOSSIER)],
                   cwd=ROOT, env=env, check=True)
    freeze = json.loads((BASE / 'evidence/scoring-freeze.json').read_text())
    for path, expected in {**freeze['sourceHashes'], **freeze['implementationHashes']}.items():
        assert hashlib.sha256((ROOT / path).read_bytes()).hexdigest() == expected, path
    supplement = '\n## Execution recovery and validity disclosure\n\n'
    supplement += '- The owner confirms the Gemini top-up. One missing request probe returns an answer for 0.00151125 USD, then missing-only recovery continues at two calls.\n'
    supplement += '- The probe answer is reused without another paid call. Original reports and cassettes are archived; returned answers remain cached.\n'
    supplement += '- Five network no-answer entries and twenty proven billing rejections are eligible for recovery. Unknown network-charge holds remain.\n'
    supplement += '- Gemini recovery keeps medium reasoning, 300-second attempts, quota waits of 60/120/240 seconds and the HTTP 402 circuit break.\n'
    supplement += '- Recovery evidence: evidence/gemini-topup-resume.json and evidence/gemini-topup-recovery-check.json.\n'
    supplement += '- The predeclared ten-point cheater margin is not established. On the same twenty DEV pilot items, constant-fail scores 18/20.\n'
    supplement += '- Product-final cascade scores are Haiku 18/20, Luna 17/20 and Gemini 18/20. These do not clear that pilot baseline by ten points.\n'
    supplement += '- The full 95-item DEV cheater gate is not freshly measured. The validityPassed field in cells.json covers planted mutation checks only.\n'
    supplement += '- This documentation audit occurs after TEST starts. TEST predictions, endpoints and statistical code remain unchanged; no blanket validity or confirmatory superiority claim follows.\n'
    supplement += '- Cheater disclosure source: evidence/cheater-gate-audit.json.\n'
    if fee_path.exists():
        fee = cells['lunaFeeReconciliation']
        supplement += '\n## Luna cache-write fee reconciliation\n\n'
        supplement += '- The native usage records '+str(fee['cacheWriteTokens'])+' cache-write tokens. Published pricing adds '+str(fee['feeAdjustmentUsd'])+' USD to the original recorded fee calculation.\n'
        supplement += '- One fee-only ledger row accounts for the difference inside the original 40 USD cap. All original receipts and model answers remain unchanged; no provider call is made.\n'
        supplement += '- Historical unique-key cost-per-100 metrics retain the frozen calculation. The reconciled settled fee total includes this separate premium.\n'
        supplement += '- Sources: evidence/luna-cache-write-reconciliation.json and https://developers.openai.com/api/docs/pricing.\n'
    if outage_path.exists():
        supplement += '\n## Haiku host-outage runtime amendment\n\n'
        supplement += '- The owner identifies a host DNS outage near 11:28 to 11:33 UTC and authorizes one retry of four ENOTFOUND calls and one 300-second timeout.\n'
        supplement += '- Only those five fingerprints are eligible. Atomic claims prevent another paid retry; original errors and all returned answers remain archived.\n'
        supplement += '- The unknown timeout hold remains reserved. These five retries use the then-current Haiku concurrency two, 300-second attempts and the 40 USD cap.\n'
        supplement += '- Sources: evidence/haiku-outage-amendment.json, evidence/haiku-outage-recovery.json and noise-2/haiku.pre-outage-recovery.partial.json.\n'
    if pacing_path.exists():
        supplement += '\n## Haiku adaptive pacing runtime amendment\n\n'
        supplement += '- The owner raises Haiku to four workers. Admission falls to two only when one-minute host load exceeds 60 or two no-answer transport failures occur within 600 seconds.\n'
        supplement += '- Parse errors and output-limit completions do not lower pacing. Already-started calls finish normally; admission checks refresh within five seconds.\n'
        supplement += '- The transition archives the partial TEST report and preserves all 33 returned responses. Only missing requests resume.\n'
        supplement += '- Eight offline pacing and budget checks pass. The sealed order, cap, model contract and statistical scoring stay unchanged.\n'
        supplement += '- Sources: evidence/haiku-pacing-amendment.json, receipts/budget.json, test_pacing.py and test_budget.py.\n'
    if test_recovery_path.exists():
        supplement += '\n## Haiku TEST timeout recovery\n\n'
        supplement += '- The network amendment replaces the earlier retry ceiling. Zero-token, no-output transport requests recover missing-only without an attempt limit; answers are never resubmitted.\n'
        supplement += '- Ten healthy provider probes spaced 30 seconds apart precede recovery of '+str(len(test_recovery['requests']))+' missing requests, at two calls and one model cell at a time. Original holds total '+str(test_recovery['unknownHoldsRetainedUsd'])+' USD and remain reserved.\n'
        supplement += '- Recovery preserves '+str(test_recovery['initialDecisionsPreserved'])+' answered finals and replaces only '+str(test_recovery['primaryResultsReplaced'])+' transport-missing finals. Initial reports and cassettes remain archived; intermediate recoveries remain supplemental.\n'
        supplement += '- The recovery settles '+str(test_recovery['newSettledUsd'])+' USD. Returned answers, including output-limit errors, are never resubmitted.\n'
        supplement += '- Sources: evidence/haiku-test-timeouts.json, evidence/haiku-test-timeout-execution.json and evidence/haiku-test-timeout-recovery.json.\n'
    if quota_path.exists():
        supplement += '\n## Daily quota runtime amendment\n\n'
        supplement += '- The owner identifies the Gemini daily request quota and permits missing-only completion after the reset near 14 October 00:00 UTC, through 12:00 UTC.\n'
        supplement += '- Two proven quota holds settle at zero. Returned answers stay cached; unknown-charge holds remain.\n'
        supplement += '- Source and runtime amendment hash: evidence/gemini-daily-quota-amendment.json. Medium, 300-second attempts, two Gemini calls and the 40 USD cap remain unchanged.\n'
        if ALLOW_QUOTA_PAUSE:
            supplement += '- Gemini TEST: not run: daily quota, 0/221 items per contestant. Noise 2 retains 30/30 cascade and 20/30 promptfoo verdicts; ten peer verdicts remain pending.\n'
            supplement += '- Pending quota requests count as no answer, never a judge failure. Gemini noise is pending until its third repeat finishes.\n'
            supplement += '- The reset driver is disarmed. Gemini 3.8 resumes only on owner instruction; the prior timed restart permission is superseded by evidence/gemini-owner-hold.json.\n'
    for path in [BASE / 'REPORT.md', DOSSIER]:
        text = path.read_text()
        if pacing_path.exists():
            text = text.replace('- The pacing amendment replaces the earlier global four-call limit: gpt-6-luna permits eight HTTP calls, Gemini two, and native Haiku two.',
                '- Current pacing: gpt-6-luna permits eight HTTP calls, Gemini two, and Haiku four with the owner-defined load and transport fallback to two.')
        if ALLOW_QUOTA_PAUSE:
            text = text.replace('| gemini-3.8-flash | pending | pending | pending | pending | pending | pending | pending | TEST pending |',
                '| gemini-3.8-flash | not run: daily quota (0/221) | not run: daily quota (0/221) | 0 / 0 (not run) | pending | pending | pending | pending | not run: daily quota |')
            text = text.replace('| gemini-3.8-flash | 20 items; missing 0/0 | 48 items; missing 0/0 | 30 items; missing 0/0 | 30 items; missing 0/0 | 30 items; missing 0/10; stopped | pending |',
                '| gemini-3.8-flash | 20 items; missing 0/0 | 48 items; missing 0/0 | 30 items; missing 0/0 | 30 items; missing 0/0 | 30/30 cascade, 20/30 promptfoo; 10 quota pending | not run: daily quota, 0/221 each |')
        path.write_text(text + supplement)
    result = {'at': now(), 'status': 'offline evidence ready for review', 'phases': expected_phases, 'completedModels': REQUIRED_MODELS, 'evaluationUnitsPerCompletedModel': 379, 'replayNewCalls': 0, 'unmappedLimits': 0, 'fees': cells['fees']}
    (BASE / 'evidence/finalizer-state.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({key: value for key, value in result.items() if key != 'fees'}), flush=True)
except Exception as error:
    (BASE / 'evidence/finalizer-state.json').write_text(json.dumps({'at': now(), 'status': 'offline verification failed', 'error': str(error)}, indent=2) + '\n')
    raise
