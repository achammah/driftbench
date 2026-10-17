"""Journaled sealed calls, one answer per unique request; no silent paid retry."""
import argparse, concurrent.futures, fcntl, os, subprocess, threading, time, urllib.request, urllib.error
from common import *

LEDGER = Path('<scratchpad>/spend-ledger.md')

def append(path, value):
    with path.open('a') as f:
        f.write(json.dumps(value, ensure_ascii=False) + '\n'); f.flush(); os.fsync(f.fileno())

def ledger(note, n, measured, unknown=0):
    with LEDGER.open('a') as f:
        f.write(f'\n| {stamp()} | ledger-hard {note} | {n} calls | {measured:.8f} measured USD | 10 USD cap; Luna token pricing corrected by owner 2026-10-13 |\n')

def priced(record):
    if record['model'] != 'gpt-6-luna':
        return record['measured_usd']
    usage = record.get('usage')
    if not usage:
        return None
    prompt_tokens = usage['prompt_tokens']
    cached = min(prompt_tokens, (usage.get('prompt_tokens_details') or {}).get('cached_tokens', 0))
    return ((prompt_tokens-cached)*0.10 + cached*0.01 + usage['completion_tokens']*0.50)/1e6

def verify_seal():
    seal = json.loads((HERE / 'seal.json').read_text())
    amendment = json.loads((HERE / 'accounting-amendment.json').read_text())
    head_amendment = subprocess.check_output(['git', 'show', 'HEAD:comparisons/ledger-hard/accounting-amendment.json'], cwd=ROOT)
    assert head_amendment == (HERE / 'accounting-amendment.json').read_bytes(), 'Accounting amendment must be committed'
    transport = json.loads((HERE / 'transport-amendment.json').read_text())
    head_transport = subprocess.check_output(['git', 'show', 'HEAD:comparisons/ledger-hard/transport-amendment.json'], cwd=ROOT)
    assert head_transport == (HERE / 'transport-amendment.json').read_bytes(), 'Transport amendment must be committed'
    for path, expected in (seal['sha256'] | amendment['sha256'] | transport['sha256']).items():
        assert digest(ROOT / path) == expected, f'Frozen file changed: {path}'
    assert native.procedure_fingerprint() == seal['candidate_procedure_sha256']
    head_seal = subprocess.check_output(['git', 'show', 'HEAD:comparisons/ledger-hard/seal.json'], cwd=ROOT)
    assert head_seal == (HERE / 'seal.json').read_bytes(), 'Seal must be committed before any call'
    return seal

def call_once(request):
    model, p = request['model'], request['prompt']
    started = stamp()
    result = {'request_sha256': request['request_sha256'], 'model': model,
              'row': request['row'], 'side': request['side'], 'id': request['id'], 'started': started}
    try:
        if model == 'haiku':
            env = dict(os.environ); env.pop('CLAUDECODE', None)
            ran = subprocess.run(['claude', *native.FLAGS, '--system-prompt', p['system'], '--max-budget-usd', '0.02'],
                                 input=p['user'], text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                 env=env, cwd=HERE, timeout=150)
            # CLI diagnostics, when any, remain intact and do not get parsed as success.
            raw = ran.stdout
            obj = json.loads(raw)
            cost = obj.get('total_cost_usd')
            known = isinstance(cost, (float, int)) and not isinstance(cost, bool) and cost >= 0
            success = ran.returncode == 0 and obj.get('type') == 'result' and not obj.get('is_error') and obj.get('subtype') == 'success'
            result.update(success=success, text=str(obj.get('result', '')), measured_usd=float(cost) if known else None,
                          cap_accounted_usd=float(cost) if known else .02, usage=obj.get('usage'), modelUsage=obj.get('modelUsage'),
                          resolved_model=sorted(obj.get('modelUsage', {})), exit_code=ran.returncode,
                          provider_response=obj)
        else:
            # Secret is read inside this worker only, never added to recorded requests.
            secret = (Path.home() / '.nexus-secrets/openai.key').read_text().strip()
            body = {'model': 'gpt-6-luna', 'messages': [{'role': 'system', 'content': p['system']}, {'role': 'user', 'content': p['user']}], 'max_completion_tokens': 4096}
            req = urllib.request.Request('https://api.openai.com/v1/chat/completions', data=json.dumps(body).encode(),
                                         headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + secret})
            with urllib.request.urlopen(req, timeout=150) as response:
                obj = json.loads(response.read())
            choice = obj.get('choices', [{}])[0]
            result.update(success=bool(choice.get('message')) and choice.get('finish_reason') == 'stop',
                          text=choice.get('message', {}).get('content') or '', measured_usd=None, cap_accounted_usd=0,
                          price_note='USD/1M tokens: input 0.10, cached input 0.01, output 0.50; https://developers.openai.com/api/docs/models/gpt-6-luna verified 2026-10-13 by owner', usage=obj.get('usage'), resolved_model=obj.get('model'), provider_response=obj)
            result['measured_usd'] = priced(result)
            result['cap_accounted_usd'] = result['measured_usd'] if result['measured_usd'] is not None else .02
    except urllib.error.HTTPError as error:
        result.update(success=False, text='', measured_usd=None, cap_accounted_usd=0,
                      error={'status': error.code, 'body': error.read().decode(errors='replace')})
    except Exception as error:
        result.update(success=False, text='', measured_usd=None, cap_accounted_usd=.02 if model == 'haiku' else 0,
                      error={'type': type(error).__name__, 'message': str(error)})
    result['finished'] = stamp()
    return result

LUNA_LIMIT = threading.Semaphore(2)
ATTEMPT_LOCK = threading.Lock()

def transport_retryable(record):
    error = record.get('error') or {}
    return (not record.get('success') and not record.get('provider_response') and
            error.get('type') in ('RemoteDisconnected', 'URLError', 'TimeoutError', 'ConnectionResetError', 'TimeoutExpired'))

def call(request):
    if request['model'] != 'gpt-6-luna':
        return call_once(request)
    with LUNA_LIMIT:
        prior_attempts = request.get('prior_transport_attempts', 0)
        for attempt in range(prior_attempts + 1, 4):
            delay = 10 if attempt == 2 else 30 if attempt == 3 else 0
            if delay:
                with ATTEMPT_LOCK:
                    append(HERE / 'transport-attempts.jsonl', {'event': 'backoff', 'request_sha256': request['request_sha256'], 'attempt': attempt, 'seconds': delay, 'stamp': stamp()})
                time.sleep(delay)
            with ATTEMPT_LOCK:
                append(HERE / 'transport-attempts.jsonl', {'event': 'start', 'request_sha256': request['request_sha256'], 'attempt': attempt, 'stamp': stamp()})
            answer = call_once(request)
            answer['attempt_count'] = attempt
            with ATTEMPT_LOCK:
                append(HERE / 'transport-attempts.jsonl', {'event': 'finish', 'request_sha256': request['request_sha256'], 'attempt': attempt, 'stamp': stamp(), 'success': answer['success'], 'error': answer.get('error'), 'usage': answer.get('usage')})
            if answer['success'] or not transport_retryable(answer):
                return answer
        return answer

def requests(models, limit):
    entries = json.loads((HERE / 'prompts.json').read_text())
    lookup = {(e['id'], e['side']): e for e in entries}
    out = []
    for i in range(limit or 384):
        for row in ROWS:
            item = cases(row)[i]
            for side in sides(row):
                e = lookup[item['id'], side]
                for model in models:
                    r = dict(e, model=model, transport='frozen-original-v1',
                             settings={'flags': native.FLAGS, 'max_budget_usd': .02} if model == 'haiku' else {'reasoning': 'provider default', 'temperature': 'omitted', 'max_completion_tokens': 4096})
                    r['request_sha256'] = sha({'model': model, 'prompt': r['prompt'], 'transport': r['transport'], 'settings': r['settings']})
                    out.append(r)
    return out

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--models', nargs='+', choices=MODELS, default=list(MODELS))
    parser.add_argument('--limit', type=int)
    parser.add_argument('--workers', type=int, default=12)
    parser.add_argument('--execute', action='store_true')
    args = parser.parse_args()
    if args.limit is not None and not 1 <= args.limit <= 384:
        parser.error('limit must be in 1..384')
    seal = verify_seal()
    if not 1 <= args.workers <= seal['concurrency']:
        parser.error('workers exceeds frozen concurrency')
    with (HERE / 'runner.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        previous = records()
        old_starts = [json.loads(s) for s in (HERE / 'starts.jsonl').read_text().splitlines()] if (HERE / 'starts.jsonl').exists() else []
        completed = {r['request_sha256'] for r in previous}
        retryable = {r['request_sha256']: r for r in previous if r['model'] == 'gpt-6-luna' and transport_retryable(r) and r.get('attempt_count', 1) < 3}
        started = {r['request_sha256'] for r in old_starts}
        if started - completed:
            raise RuntimeError(f'{len(started-completed)} started calls lack a result; reconcile before any resume, never duplicate')
        unique = {}
        for r in requests(args.models, args.limit):
            unique.setdefault(r['request_sha256'], r)
        pending = [dict(r, prior_transport_attempts=retryable[key].get('attempt_count', 1), is_transport_retry=True) if key in retryable else r for key, r in unique.items() if key not in completed or key in retryable]
        measured = sum(priced(r) or 0 for r in previous)
        spent = sum(priced(r) if priced(r) is not None else r['cap_accounted_usd'] for r in previous)
        print(json.dumps({'selected_unique': len(unique), 'pending_unique': len(pending), 'measured_usd': measured, 'execute': args.execute}), flush=True)
        if not args.execute:
            return
        ledger('start ' + ','.join(args.models) + f' limit {args.limit or 384}', 0, measured)
        inflight, index, fresh, failures = {}, 0, 0, {}
        stop_reason = None
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
            while index < len(pending) or inflight:
                while not stop_reason and index < len(pending) and len(inflight) < args.workers:
                    r = pending[index]
                    now = datetime.datetime.now(datetime.timezone.utc)
                    if now >= datetime.datetime.fromisoformat(seal['last_call_cutoff']):
                        stop_reason = 'last-call cutoff'; break
                    reserve = .02 * len(inflight)
                    if spent + reserve + .02 > seal['cap_measured_usd']:
                        stop_reason = 'cap reserve'; break
                    if failures.get(r['model'], 0) >= 3:
                        stop_reason = f'three transport failures on {r["model"]}'; break
                    if not r.get('is_transport_retry'):
                        append(HERE / 'starts.jsonl', {k: v for k, v in r.items() if k != 'prompt'} | {'started': stamp()})
                    inflight[pool.submit(call, r)] = r
                    index += 1
                if not inflight:
                    break
                done, _ = concurrent.futures.wait(inflight, timeout=30, return_when=concurrent.futures.FIRST_COMPLETED)
                for future in done:
                    r = inflight.pop(future)
                    answer = future.result()
                    answer['outcome'] = native.outcome(answer['text'], r['side'], r['row']) if answer['success'] else 'inconclusive'
                    append(HERE / ('retry-results.jsonl' if r.get('is_transport_retry') else 'calls.jsonl'), answer)
                    spent += answer['cap_accounted_usd']; measured += answer['measured_usd'] or 0; fresh += 1
                    if not answer['success']:
                        failures[r['model']] = failures.get(r['model'], 0) + 1
                        print(json.dumps({'failure': r['request_sha256'], 'model': r['model'], 'error': answer.get('error'), 'success': False}), flush=True)
                    if fresh % 50 == 0:
                        print(json.dumps({'new_completed': fresh, 'selected_total': len(unique), 'measured_usd': measured, 'inflight': len(inflight)}), flush=True)
        current = records()
        ledger('finish ' + (stop_reason or 'selected requests completed'), fresh, measured, sum(c['model'] == 'gpt-6-luna' for c in current))
        dump(HERE / 'run-state.json', {'stamp': stamp(), 'stop_reason': stop_reason, 'completed_calls': len(current),
             'measured_usd': measured, 'cap_accounted_usd': spent, 'failures': failures, 'selected_unique': len(unique)})
        print(json.dumps({'completed_new': fresh, 'measured_usd': measured, 'stop_reason': stop_reason}), flush=True)

if __name__ == '__main__':
    main()
