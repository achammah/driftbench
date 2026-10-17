"""Resume the named Gemini quota pause after the authorized UTC reset, once."""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

BASE = Path(__file__).resolve().parent
ROOT = BASE.parents[1]
MODEL = 'gemini-3.8-flash'
STATE = BASE / 'evidence/gemini-reset-watcher.json'


def stamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def timestamp(value):
    return datetime.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()


def write_state(status, **extra):
    value = dict(at=stamp(), pid=os.getpid(), target='Gemini noise-2 and sealed TEST missing-only',
                 status=status, stop='complete, first stopped phase, or 2026-10-14T12:00:00Z', **extra)
    STATE.write_text(json.dumps(value, indent=2) + '\n')
    print(json.dumps(value), flush=True)


def window(amendment, now):
    if now < timestamp(amendment['automaticResumeNotBefore']):
        return 'waiting for authorized reset'
    if now >= timestamp(amendment['completionDeadline']):
        return 'completion deadline reached'
    return 'eligible'


def prepare_phase(phase, amendment, runtime):
    """Archive stopped quota reports only. Never edit a cassette or a returned answer."""
    report_path = BASE / phase / f'{MODEL}.json'
    if report_path.exists():
        report = json.loads(report_path.read_text())
        if not report.get('stopped'):
            return None
        assert phase == 'noise-2' and 'Transport quota:' in report['stopped'], report.get('stopped')
        archive = BASE / amendment['stoppedReport']
        assert archive.read_bytes() == report_path.read_bytes()
        recording = BASE / 'recordings' / runtime['recordingsId'] / phase / 'longjudge-verify' / f'{MODEL}.jsonl'
        assert hashlib.sha256(recording.read_bytes()).hexdigest() == amendment['cassetteSha256']
        assert all('failure' not in json.loads(line) for line in recording.read_text().splitlines())
        # The immutable archive already exists. Removing this report enables only missing transport work.
        report_path.unlink()
    flags = ['--noise', '2'] if phase == 'noise-2' else []
    if (BASE / phase / f'{MODEL}.started.json').exists():
        flags.append('--resume-interrupted')
    return flags


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--wait', action='store_true', help='Wait locally for the authorized reset; no provider calls before it.')
    parser.add_argument('--check-only', action='store_true', help='Inspect the gate without waiting, changing reports or calling a provider.')
    args = parser.parse_args()
    hold = BASE / 'evidence/gemini-owner-hold.json'
    if hold.exists() and not json.loads(hold.read_text()).get('automaticResume', False):
        print(json.dumps(dict(at=stamp(), gate='disarmed: owner-only restart', providerCalls=0)))
        return
    amendment = json.loads((BASE / 'evidence/gemini-daily-quota-amendment.json').read_text())
    if args.check_only:
        print(json.dumps(dict(at=stamp(), gate=window(amendment, time.time()), providerCalls=0)))
        return
    with (ROOT / '.tmp/gemini-reset.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        write_state(window(amendment, time.time()), notBefore=amendment['automaticResumeNotBefore'],
                    deadline=amendment['completionDeadline'])
        while window(amendment, time.time()) == 'waiting for authorized reset':
            if not args.wait:
                raise RuntimeError('Owner authorization for an earlier restart is required')
            time.sleep(min(30, timestamp(amendment['automaticResumeNotBefore']) - time.time()))
        assert window(amendment, time.time()) == 'eligible', 'Completion deadline reached; no calls allowed'
        runtime_path = BASE / 'evidence/runtime-freeze.json'
        current_hash = hashlib.sha256(runtime_path.read_bytes()).hexdigest()
        if current_hash != amendment['runtimeSha256']:
            pacing = json.loads((BASE / 'evidence/haiku-pacing-amendment.json').read_text())
            assert pacing['priorRuntimeSha256'] == amendment['runtimeSha256']
            assert pacing['runtimeSha256'] == current_hash
        runtime = json.loads(runtime_path.read_text())
        assert runtime['modelConcurrency'][MODEL] == 2
        assert runtime['models'][MODEL]['reasoning'] == 'medium'
        assert runtime['models'][MODEL]['timeoutMs'] == 300000
        env = dict(os.environ)
        for name in ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY']:
            env.pop(name, None)
        env['TMPDIR'] = str(ROOT / '.tmp')
        env['VERIFY_GEMINI_KEY_FILE'] = str(Path.home() / '.nexus-secrets/gemini-driftbench.key')
        env['VERIFY_CORE_DOSSIER'] = os.environ['VERIFY_CORE_DOSSIER']
        for phase in ['noise-2', 'results']:
            assert window(amendment, time.time()) == 'eligible'
            flags = prepare_phase(phase, amendment, runtime)
            if flags is None:
                continue
            progress = dict(at=stamp(), model=MODEL, phase=phase, status='running', concurrency=2,
                            runtimeAmendment='evidence/gemini-daily-quota-amendment.json')
            (BASE / f'{MODEL}.progress.json').write_text(json.dumps(progress, indent=2) + '\n')
            command = [str(ROOT / 'node_modules/.bin/tsx'), '--tsconfig', 'examples/ledger-verify/tsconfig.json',
                       'examples/ledger-verify/run.ts', MODEL, *flags]
            with (BASE / 'logs' / f'gemini-reset-{phase}.log').open('a') as log:
                child = subprocess.Popen(command, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
                write_state('running', phase=phase, childPid=child.pid, processGroup=child.pid,
                            deadline=amendment['completionDeadline'])
                while child.poll() is None:
                    if window(amendment, time.time()) != 'eligible':
                        # This group contains only the runner and transports started immediately above.
                        os.killpg(child.pid, signal.SIGTERM)
                        try:
                            child.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            os.killpg(child.pid, signal.SIGKILL)
                            child.wait()
                        write_state('completion deadline reached', phase=phase, unknownChargeHolds='retained')
                        return
                    time.sleep(0.25)
            path = BASE / phase / f'{MODEL}.json'
            assert child.returncode == 0 and path.exists(), f'{phase} runner failed; inspect preserved logs'
            report = json.loads(path.read_text())
            if report.get('stopped'):
                progress.update(at=stamp(), status='stopped; requires inspection', reason=report['stopped'])
                (BASE / f'{MODEL}.progress.json').write_text(json.dumps(progress, indent=2) + '\n')
                write_state('stopped; no automatic restart', phase=phase, reason=report['stopped'])
                return
        (BASE / f'{MODEL}.progress.json').write_text(json.dumps(dict(at=stamp(), model=MODEL, phase='all', status='complete'), indent=2) + '\n')
        write_state('complete', providerCalls='only missing requests through frozen transport')
        with (BASE / 'logs/gemini-reset-finalize.log').open('w') as log:
            subprocess.run([sys.executable, str(BASE / 'finish.py'), '--wait'], cwd=ROOT, env=env,
                           stdout=log, stderr=subprocess.STDOUT, check=True)
        with (BASE / 'logs/gemini-reset-publish.log').open('w') as log:
            subprocess.run([sys.executable, str(BASE / 'publish_results.py')], cwd=ROOT, env=env,
                           stdout=log, stderr=subprocess.STDOUT, check=True)
        write_state('complete and branch publication verified')


if __name__ == '__main__':
    main()
