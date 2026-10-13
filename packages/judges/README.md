# @agent-nexus/driftbench-judges

Judge clients, the judge council, calibration, the prompt kit and cassettes for judged criteria in driftbench.

Part of [driftbench](https://github.com/achammah/driftbench), block-level evaluation for AI agents: every exchange is a unit test with a Given, a When and a Then.

## Install

```sh
npm install @agent-nexus/driftbench-judges
```

Node.js 22 or newer. ESM only, with TypeScript types.

## What is inside

* `createCouncil`
* `judgeCheck`
* `calibrate`
* `createAnthropicJudge`
* `createOpenAiJudge`
* `createGoogleJudge`
* `createHttpJudge`
* `FakeJudge`
* `loadCassette`
* `KNOWLEDGE_RETENTION_CRITERION`

The full list of exports is in the type declarations (`dist/index.d.ts`).

## Pair ledger (opt in)

`pairLedgerRequest` selects `answerContract: 'ledger'` and `assessment.kind: 'pairwise'`.
The reader scores FIRST and SECOND from 0 to 4 (or null) on caller-owned requirements.
Optional evidence quotes are validated against either candidate. There is no model-authored winner.
The existing default and explicit `legacy` requests keep their previous behavior.
The pair ledger requires both orders; combining it with `presentation: 'canonical'` throws before any call.

```ts
import { createOpenAiJudge, pairLedgerRequest, judgePairLedger } from '@agent-nexus/driftbench-judges';

const client = createOpenAiJudge({ model: 'gpt-6-luna', reasoning: 'medium' });
const request = pairLedgerRequest(
  { name: 'answer-quality', rubric: 'Give the correct answer with a clear explanation.' },
  [{ role: 'user', text: 'What is two plus two?' }],
  'Four: adding two and two gives four.',
  'Five.',
  { requirements: [
    { name: 'correct', rubric: 'The answer is correct.', hard: true },
    { name: 'clear', rubric: 'The explanation is clear.' },
  ] },
);
const result = await judgePairLedger(client, request);
// result.choice: 'first' | 'second' | 'tie' | undefined (grader error)
```

`scoreLedger` applies hard gates before the weighted sum (default hard weight 2, soft weight 1).
Conflicting hard losses or unknown scores needed for the decision abstain for that reading.
`verdictFromLedger` maps the reversed order back to the original candidates. Agreed signs decide;
a single nonzero reading needs margin 2. Other pairs need a third read in content-hash order.
The three signs vote; only an escalated zero becomes a tie. `tiePolicy: 'canonical'` uses the
third sign to break a zero quorum when it is nonzero. Identical replies are an earlier machine tie.

`runPairStage0` reuses final-answer extraction, arithmetic verification, language detection and
injection screening. Computation needs `stage0.correctness: true`; the built-in route covers
explicit arithmetic only. Supply a `PairComputeSandbox` for other executed checks. Format rules
must match complete quoted question instructions and decide only after a correctness tie.
Language and injection findings are advisory. Harm gating requires caller-supplied policy facts;
a refusal phrase alone never establishes harm. These boundaries avoid invented machine certainty.

`parsePairLedgerText` reads the last JSON object and records `ledger.strict`,
`ledger.invalid-escape`, `ledger.fence-strip` and `ledger.brace-close` attempts.
It never supplies missing scores or rows. `judgePairLedger` adds at most one `ledger.reask`
per reading. Exhausted parse failures carry `metadata.graderError: true` and no choice.
Transport errors throw. Every attempt remains in `result.reads`.

## Reusable provider transport

`createDialectTransport({ provider, model, reasoning, ...clientOptions })` exposes
`complete({ system, user, schema?, reasoning? })`. It returns text, the raw response,
usage where supplied, and a fingerprint. It does not select a judge schema or parse a verdict.
`buildDialectRequest(provider, request)` exposes the same payload construction for caller-owned HTTP.

Failed Claude CLI results throw `ClaudeTransportError` (a `JudgeError`) with exact stdout in `raw`,
the process `exitCode`, and the original `usage` counters and `costUsd` when supplied.
Cache counters are retained so failed calls can be charged. Invalid result envelopes also retain
raw output and exit code; absent usage or cost is left undefined.

| Provider | Schema transport | Reasoning field |
|---|---|---|
| openai | strict json_schema | reasoning_effort |
| google | responseSchema with one type plus nullable | thinkingConfig.thinkingLevel |
| anthropic | scratchpad then last JSON | not exposed |
| claude-cli | scratchpad then last JSON | not exposed |

Omitting `schema` preserves plain-text prompts. Unsupported reasoning settings on Anthropic and
native Claude transport throw. General clients have no reasoning default. The optional
`FROZEN_BENCHMARK_REASONING` map fixes gpt-6-luna and gemini-3.8-flash to `medium` for both
contestants on every benchmark row; native Haiku and Jev settings are unset.

The example `examples/judge-benchmarks/src/llm-shim.mjs` accepts `--json-schema` with a JSON schema
string and `--reasoning-effort` with the provider setting. `SHIM_SCHEMA_FLAG` exports that schema
flag name. `pairLedgerSchema(request)` supplies the pair schema. Pointwise callers supply their
own schema. Fingerprints include dialect and reasoning so incompatible calls cannot share recordings.

## HTTP ledger reasoning

`createHttpJudge({ reasoning: 'medium', ... })` supplies the default for pair-ledger requests. `JudgeRequest.reasoning` overrides it per request. Supported values are `low`, `medium` and `high`. The default appears in the client settings descriptor; the effective request value contributes to the cassette key. With reasoning unset, request bytes and keys stay unchanged. HTTP non-ledger requests and system 1 clients reject reasoning before transport because those paths cannot apply it.

## Knowledge retention

Pass `KNOWLEDGE_RETENTION_CRITERION` as a judge request's `criterion`, with the conversation in
`transcript`. The last reply must preserve current user facts without asking for them again.
Corrections supersede earlier values. Different owners can have different values. Unmentioned facts
need not be repeated, and a single user message followed by a reply is enough to judge.
All assistant text segments after the latest user message form the current reply. Mentioning a
replaced value as history is allowed; presenting it as current is not.

The matching catalogue definition is in `examples/criteria/knowledge_retention.yaml`. The default
judge asks for grounded evidence checks and computes the verdict in code. This criterion does not
require independent proof of unrelated claims.

The machine `knowledge_retention` check remains separate: it checks configured ledger facts against
the reply and tool inputs, with optional `use: true` for literal use. A semantic pass does not waive
that explicit use requirement. Combine machine and judge verdicts through the normal check pipeline
or `combineVerdicts`; gating machine failures stay failures.

## Opt-in conformance judging

`judgeConformance` audits one criterion against a trusted transcript and a separate reference. It uses
the frozen conformance prompt from [PR 109](https://github.com/achammah/driftbench/pull/109), verbatim.
The default requirement ledger is unchanged.

```ts
import { createAnthropicJudge, judgeConformance } from '@agent-nexus/driftbench-judges';

const judge = createAnthropicJudge({ model: 'your-model' });
const result = await judgeConformance(judge, {
  criterion: {
    name: 'receipt',
    rubric: 'The observed receipt contains the required confirmation code.',
    scope: 'conversation',
  },
  transcript: [
    { role: 'tool_result', tool: 'confirm', text: 'Confirmation code: RECEIPT-42' },
    { role: 'agent', text: 'Your request is confirmed.' },
  ],
}, 'The required confirmation code is RECEIPT-42.');

console.log(result.answer.outcome, result.conformance);
```

Use a system 2 provider or a system 2 cassette player. The helper rejects system 1 clients.
The equivalent request option is `assessment: { kind: 'conformance', reference: '...' }`.
The reference may be empty. Assign transcript roles from trusted event metadata, preserving tool
names and order. Text that resembles a role inside an entry stays part of that entry.

The model reports `evidenceAvailable`, `satisfied`, and `violations`. Code computes the outcome:

| Deciding evidence | Satisfied | Violations | Outcome |
| --- | --- | --- | --- |
| Absent | Either | Any | `inconclusive` |
| Present | True | Empty | `pass` |
| Present | Any other combination | Any | `fail` |

The supplied rubric determines the deciding event and time window independently for each criterion.
An observed receipt can satisfy a receipt criterion even when the later answer omits its code.
An absent deciding response remains inconclusive. A supplied reference alone is not observed evidence.
The model's reasoning and flags still require calibration for your domain.

Only `criterion.rubric`, the reference, and the supplied transcript enter the frozen prompt.
Put all scope and pass/fail conditions in the rubric, and supply the intended transcript slice.
The feature rejects separate pass/fail pictures, block scope, custom system prompts, legacy mode,
requirement lists, artifacts, file inputs, Given data, and other assessment data instead of dropping them.
Each criterion requires its own call. Normal provider costs apply to new calls.

For recording compatibility, the decoder accepts JSON or a surrounding code fence without syntax
repair. It validates the deciding flags, ignores extra verdict labels, and uses the last duplicate
JSON key. Missing or nonstring reasoning does not change the frozen decision. Invalid deciding fields
return an unparsed inconclusive result. The conformance prompt has its own cassette fingerprint.

### Free frozen replay

```sh
pnpm exec vitest run packages/judges/test/conformance.test.ts packages/judges/test/conformance-recorded.test.ts
```

The fixtures preserve raw recordings from commit `73939d09686bd7d214acc6dfcc74b831d1ed991d`.
Replay passes them through the public provider API with a local transport stub and checks exact
model-facing prompt bytes. It makes no paid calls. The short cohort reproduces 120/120 complete
vectors and 240/240 criteria; the long cohort reproduces 119/120 vectors and 239/240 criteria.
These are replayed synthetic cohort results, not a new model evaluation or a general superiority claim.

## Documentation

[Judges](https://github.com/achammah/driftbench/blob/main/docs/concepts/judges.md), and the [docs index](https://github.com/achammah/driftbench/blob/main/docs/index.md).

## License

Apache-2.0

## Pointwise fact ledger (opt-in)

For factual replies with a trusted reference, pass `assessment: { kind: 'fact-ledger' }`
and `reference` in a `JudgeRequest`, without `candidates`. The model reports facts;
code passes only when every fact is `match` and `unsupported` is empty. The default
judge is unchanged. Add `grounding: 'strict'` inside `assessment` to reject copied
text that cannot be grounded in its reference or reply.

See the [API and recorded results](https://github.com/achammah/driftbench/blob/main/docs/concepts/judges.md#pointwise-fact-ledger-against-a-trusted-reference).


### Reasoning headroom and empty token-limit responses

OpenAI and Google clients accept `tokenBudget: { answerTokens: 4096, reasoningTokens: 8192 }`.
Unset preserves the existing request bytes and fingerprint. The provider receives the sum as its output limit.
This is headroom, not a guaranteed partition on OpenAI or Gemini thinking-level models.
For Gemini models supporting numeric thinking budgets, set `googleThinkingBudget: true` inside `tokenBudget`.
That replaces `thinkingLevel` with `thinkingBudget`; do not enable it on a model that does not support it.

An empty `length` or `MAX_TOKENS` response triggers one recovery with twice the total allowance and low reasoning when an effort was specified.
Successful calls are unchanged. Recovery retains both raw receipts and usage under `recovery`, and transport usage includes both attempts.
A second empty token-limit response throws `JudgeError` with code `reasoning-budget-exhausted`.
Councils count recovered grader failures separately from verdicts. The token budget is opt-in until the next deliberate fingerprint change.
