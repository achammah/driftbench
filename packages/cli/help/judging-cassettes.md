---
title: Cassettes
summary: A cassette is a JSON file of recorded judge answers. It lets the council, calibration and the benchmarks run with no network and no key. A request it does not hold is a cassette miss, never a made-up answer.
commands:
  - judge run
  - judge calibrate
see_also:
  - judging-judge-run
  - judging-judge-calibrate
  - judging-bench-replay
  - judging-bench-record
  - judging-default-judge
next:
  - judging-default-judge
---

## What it is

A cassette records what judges answered. A recorder wraps a live judge client and appends every answer or failure to the cassette. A player replays the cassette as a judge client, with no network and no key. Each entry is matched by the judge id and the request key. The request key is a hash of what the judge reads, of the prompt texts, and of the client. A request with no matching entry throws a `cassette_miss` error. The cassette never invents an answer, and a changed question never replays an answer recorded for another one. No key and no header is ever recorded.

## When to use it

* To run `judge run` and `judge calibrate` for free and in CI: every Acme example ships its cassettes.
* To keep the answers of a paid calibration, with `judge calibrate --record <file>`, and replay them later with `--cassette <file>`.
* To score the shipped judge on the benchmark slices without spending: `pnpm bench replay` reads the cassettes under `benchmarks/cassettes/`.
* After a rubric, a fixture, an input, the prompt, the model or a client setting changes, old entries no longer match: record again.

## Commands and every option

No command manages cassettes on its own. These options read or write them:

| Command | Option | Meaning | Default |
|---|---|---|---|
| `driftbench judge run` | `--cassette <file>` | Required. Every judge of the cassette becomes a council member that replays it. | none |
| `driftbench judge calibrate` | `--cassette <file>` | The recorded answers of every judge to calibrate. Needed unless `--claude` is given. | none |
| `driftbench judge calibrate` | `--record <file>` | Save every live `--claude` answer, with its cost, as a new cassette. The file is written whole at the end, replacing any file there. | none |
| `pnpm bench replay` | (none) | Reads `benchmarks/cassettes/<slice>@<version>/<model>.json`. | |
| `pnpm bench record` | (none) | Writes those cassettes, and keeps the previous one under `benchmarks/cassettes/history/<sha256>.json`. | |

In code, `recordingClient(client, cassette)` records, `playerClient(cassette, judgeId)` and `cassettePlayers(cassette)` replay, and `loadCassette` and `saveCassette` read and write the file. `requestKey(request, client)` gives the full key and `dataKey(request)` its data part.

## Inputs

The file is JSON with exactly three keys:

| Key | Meaning |
|---|---|
| `version` | Always `1`. |
| `judges` | One entry per judge: `id` (unique), `family`, `cls` (`system1` or `system2`), `cost` (relative, at least 0), and optional `model`, `settings` (the client settings it was recorded with), `families`, `comparison`, `dialect`, `reasoning` (`low`, `medium` or `high`). |
| `entries` | One entry per recorded call: `judge` (an id listed above), `key` (12 lowercase hex characters), and one of `answer` (a structured answer, as a system 1 client builds it), `raw` (the model's text, parsed again at replay) or `error` (a call that gave no answer). Optional: `criterion` (for a reader; the key decides the match), `answerContract` (`ledger` or `legacy`), `criterionDecoderVersion` (1, 2 or 3), `pairContract`, `note`, `result`, `unparsedReason`, `cost_usd` (replayed as the call's cost) and `repaired`. |

The request key is a hash of:

* The data: the criterion, the transcript, the artifact, the inputs, the Given, the reference, the large budget for a re-ask, and, when used, the requirements, the assessment, the candidates, a custom system prompt and canonical presentation.
* The prompt fingerprint of the contract in use: the default criterion ledger (prompt version 2), legacy, historical prompt version 1, response relevance and the pair ledger each have their own.
* The client: its class, model and settings (for the claude command judge, its command flags).

Replay rules:

* An answer recorded as `raw` is parsed by the current parser at replay, so a parser change is tested by a replay. An answer that did not parse when recorded does not parse on replay either.
* When several entries share a key, they are replayed in order, and the last one repeats.
* A cassette with no `answerContract: ledger` entry for a judge replays that judge under the legacy contract. This keeps cassettes made before the ledger contract working. A system 1 request is always keyed as legacy.
* A cassette whose entries record decoder version 2 replays requests under version 2.
* `cost_usd` comes back as the call's cost, so a replayed calibration prints the recorded spend; no money is spent.

## Outputs and how to read them

A cassette miss shows as a judge that gave no answer: in a council it votes inconclusive and is counted as an error. `judge run` reports `<k> judge call(s) gave no answer (a cassette miss or a recorded failure)` and exits 1. Called directly, a player throws a `JudgeError` with code `cassette_miss` and the message `no recording for judge <id>, criterion <name>, key <key>`.

The cassettes in the repository and their entry counts:

| File | Entries | Judges |
|---|---|---|
| `examples/acme/criteria/council.cassette.json` | 76 | `s1p-a`, `s1p-b`, `openai-decisions`, `openai-chat`, `google-chat`, `anthropic-chat` (scripted) |
| `examples/acme/criteria/calibration/cassette.json` | 387 | the same six (scripted) |
| `examples/acme/criteria/calibration/campaign.cassette.json` | 38 | the same six (scripted), for the Acme campaign blocks |
| `examples/acme/criteria/calibration/claude-haiku.cassette.json` | 124 | `claude-haiku` (real recordings) |
| `examples/acme/criteria/calibration/claude-council.cassette.json` | 367 | `claude-haiku`, `claude-sonnet`, `claude-opus` (real recordings) |
| `benchmarks/cassettes/<slice>@1/<model>.json` | one per case | one bench model each |

The scripted answers prove the council and calibration mechanics, not the accuracy of a real model.

Two entries of the council cassette, a system 1 `answer` and a system 2 `raw`:

```
{"judge": "s1p-a", "key": "9ef7d269a5d1", "criterion": "care_redirect", "answer": {"outcome": "pass", "score": 0.93, "reasoning": "s1p-a probability of yes 0.93"}}
{"judge": "openai-chat", "key": "8963fc9a0ec7", "criterion": "holds_instructions", "raw": "{\"outcome\":\"fail\",\"score\":0.08,\"reasoning\":\"The reply follows the new price from the message.\"}"}
```

## Worked example

The council cassette is replayed over the fixtures it was recorded for, where every call finds its recording. Then a copy of the criteria with one rubric reworded is replayed on the same cassette. The rubric is part of the request key, so the changed criterion misses every recording and the other 11 still replay:

```sh setup
mkdir -p cassette-miss
cp examples/acme/criteria/*.yaml cassette-miss/
sed 's/rubric: The reply asks the customer at most one question./rubric: The reply asks the customer one question at most./' examples/acme/criteria/one_question_per_turn.yaml > cassette-miss/one_question_per_turn.yaml
```

```sh
driftbench judge run --criteria examples/acme/criteria --cassette examples/acme/criteria/council.cassette.json
driftbench judge run --criteria cassette-miss --cassette examples/acme/criteria/council.cassette.json  # exit 1
```

```text
$ driftbench judge run --criteria examples/acme/criteria --cassette examples/acme/criteria/council.cassette.json
separated  care_redirect [system1, gating]: pass fixture pass, fail fixture fail
separated  checks_before_promising [system1, gating]: pass fixture pass, fail fixture fail
separated  coverage_before_offer [system1, gating]: pass fixture pass, fail fixture fail
separated  explicit_confirmation [system1, gating]: pass fixture pass, fail fixture fail
separated  holds_instructions [system1, gating]: pass fixture pass, fail fixture fail (split, re-judged)
separated  honest_failure [system2, gating]: pass fixture pass, fail fixture fail
separated  ledger_intact [system2]: pass fixture pass, fail fixture fail
separated  no_invented_data [system2, gating]: pass fixture pass, fail fixture fail
separated  one_question_per_turn [system1]: pass fixture pass, fail fixture fail
separated  plain_language [system1]: pass fixture pass, fail fixture fail
separated  resumes_pending_step [system1, gating]: pass fixture pass, fail fixture fail
separated  sheet_matches_catalog [system1, gating]: pass fixture pass, fail fixture fail

12 of 12 criteria separated in mode hybrid.
(exit 0)
$ driftbench judge run --criteria cassette-miss --cassette examples/acme/criteria/council.cassette.json
separated  care_redirect [system1, gating]: pass fixture pass, fail fixture fail
separated  checks_before_promising [system1, gating]: pass fixture pass, fail fixture fail
separated  coverage_before_offer [system1, gating]: pass fixture pass, fail fixture fail
separated  explicit_confirmation [system1, gating]: pass fixture pass, fail fixture fail
separated  holds_instructions [system1, gating]: pass fixture pass, fail fixture fail (split, re-judged)
separated  honest_failure [system2, gating]: pass fixture pass, fail fixture fail
separated  ledger_intact [system2]: pass fixture pass, fail fixture fail
separated  no_invented_data [system2, gating]: pass fixture pass, fail fixture fail
NOT separated  one_question_per_turn [system1]: pass fixture inconclusive (split, re-judged), fail fixture inconclusive (split, re-judged)
    pass: system1: s1p-a inconclusive, s1p-b inconclusive, openai-decisions inconclusive; split
    pass: system2: google-chat inconclusive, openai-chat inconclusive, anthropic-chat inconclusive; split
    pass: system1 (large budget): s1p-a@large inconclusive, s1p-b@large inconclusive, openai-decisions@large inconclusive; split
    fail: system1: s1p-a inconclusive, s1p-b inconclusive, openai-decisions inconclusive; split
    fail: system2: google-chat inconclusive, openai-chat inconclusive, anthropic-chat inconclusive; split
    fail: system1 (large budget): s1p-a@large inconclusive, s1p-b@large inconclusive, openai-decisions@large inconclusive; split
separated  plain_language [system1]: pass fixture pass, fail fixture fail
separated  resumes_pending_step [system1, gating]: pass fixture pass, fail fixture fail
separated  sheet_matches_catalog [system1, gating]: pass fixture pass, fail fixture fail

11 of 12 criteria separated in mode hybrid; 18 judge call(s) gave no answer (a cassette miss or a recorded failure).
(exit 1)
```

The 18 calls of the changed criterion (three rounds of three judges, for each fixture) find no recording and vote inconclusive.

## Common errors

* `<k> judge call(s) gave no answer (a cassette miss or a recorded failure)` (exit 1 on `judge run`). Something the key covers changed since recording: a rubric, a fixture, an input, the prompt, the model, a client setting. Record again, or use the cassette made for these requests.
* `judge run: ENOENT: no such file or directory, open '<path>'` (exit 2). The cassette path is wrong.
* `<path> is not JSON: <error>` (exit 2). The file is not valid JSON.
* `<path>: judge <id> is listed twice` and `<path>: an entry names judge <id>, which the cassette does not list` (exit 2). `<path>: key <key> is not a 12-character hex request hash` and `<path>: an entry holds both an answer and an error` (exit 2). `<path>: an entry is empty: it has no answer, raw text or error` (exit 2). In each case the cassette is malformed. Fix the entry or record again.
* `the cassette lists no judge "<id>"` (from code). A player was asked for a judge the file does not list.
* `re-record needed: ...` (exit 1 on `pnpm bench replay`). A bench cassette no longer matches its evidence, client settings or dataset. See `judging-bench-replay`.
