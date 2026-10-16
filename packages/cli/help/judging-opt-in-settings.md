---
title: Opt-in judge settings
summary: "Optional judging settings and explicit historical versions, how to turn it on and what it changes: response relevance, the reader-first pair judge (it prefers the longer complete reply), conformance, answer audit, the pointwise fact ledger, verification, reference consensus, rubric items, historical prompt and decoder versions, canonical presentation, repeated and turn-by-turn judging, prompt budgets and rubric lint."
commands: []
see_also:
  - judging-default-judge
  - judging-pairwise
  - judging-evidence
  - judging-mixture-of-judges
  - judging-criteria
  - judging-long-structured
next:
  - judging-long-structured
---

## What it is

The default judge (see `judging-default-judge`) is what every command uses. The settings below change the question, the contract or the procedure, and explicit historical versions preserve earlier behavior. Prompt version 2 and decoder version 3 are already the defaults. Each one that changes what the model reads has its own prompt fingerprint, so its recordings never replay under the default prompt, and opting in never invalidates default cassettes.

These settings are fields of a judge request (`JudgeRequest`) or wrappers in `@agent-nexus/driftbench-judges`. Criteria in specs and criteria files expose settings including `prompt_version` and `decoder_version`; prompt version 2 is the default, and unset `decoder_version` uses decoder 3. See `judging-default-judge` and the spec reference.

## When to use it

* When the default criterion question does not fit the job. For "did the reply address every part of the ask", use response relevance. For "does the answer match a trusted reference", use fact ledger, answer audit or conformance. For "which of two replies reads better for a reader", use reader-first.
* When a judge needs help that code can give: arithmetic checks (verification), an agreed reference answer (reference consensus).
* Measure any of them with `judge calibrate` (or `calibrateCascade`) on your own labels before relying on it.

## Commands and every option

| Setting | How to turn it on | What it changes |
|---|---|---|
| Response relevance | `assessment: { kind: 'response-relevance' }` on a request | The model lists each distinct requested part of the latest user entry, with a quote from it. It also lists whether the final agent reply addresses it, with a quote from the reply. Code: any part `met: false` fails, else any `null` is inconclusive, else pass. System 2 judges only. The request may not carry `system`, `requirements`, `factAudit`, `candidates`, `artifact`, `inputs`, `given` or `reference`, nor `answerContract: 'legacy'`. It needs a user entry and an agent reply after it. |
| Reader-first pair judge | `createReaderFirstJudge(client, { configuration: 'reader-first' })`, then `judgePair(request, first, second)` | A length-aware preference. It favours the longer complete reply unless machine measurements and both model presentations agree on a substantial reader-facing failure. The measurements are length, structure, filler, hedges, repetition, jargon, readability and more. Two model calls per pair. Thresholds `judgeMargin` 4, `featureMargin` 5, `minFailures` 1. It never replaces the default judge. It prefers longer replies by design: use it only when that matches your goal. |
| Long-structured preference | `judgePairLedger(client, request, { preference: 'long-structured' })`. Available from the next release (PR 378), see `judging-long-structured`. | After the pair ledger verdict, the longer reply wins when it is structured; an explicit request row wins first. It prefers longer replies by design. |
| Conformance audit | `assessment: { kind: 'conformance', reference }` | A frozen compliance audit prompt. The model returns `evidenceAvailable`, `satisfied` and `violations`; code: no evidence is inconclusive, satisfied with no violation is pass, else fail. |
| Answer audit | `assessment: { kind: 'answer-audit' }`, optional `reference` | The model lists the conditions the criterion sets and settles each with a quote (`satisfied`, `violated`, `missing`, `unknown`). Code checks the quotes: any violated or missing fails, else any unknown is inconclusive, else pass. |
| Pointwise fact ledger | `assessment: { kind: 'fact-ledger' }` with a nonempty `reference` and no `candidates` | Each requested fact is `match`, `wrong` or `missing` in the reply, plus unsupported extra claims. Code passes only when every fact matches and nothing unsupported is claimed. `grounding: 'strict'` also requires quotes of the reference and of an agent entry; a failed grounding is inconclusive. |
| Verification | `withVerification(client, { enabled: true, sandbox })`, with `arithmeticSandbox()` | A sandbox checks explicit arithmetic in the data first and adds its results as tool evidence. The built-in sandbox evaluates numeric equations with the four operations and parentheses, with no eval, file, process or network access. A failure or timeout is inconclusive. |
| Reference consensus | `withReferenceConsensus(client, { solve, samples, route })` | Blind solves of the user question (never the candidate, rubric or label). An answer agreed by at least 0.8 of `samples` (default 5) becomes the `reference`. `samples: 1` uses one solve, with no agreement check. `route: 'auto'` first asks whether the question has one checkable answer and skips solving otherwise. An explicit caller reference is kept. |
| Rubric items | `judgeRubric(client, request, items, { threshold })`, or `rubricItems` in pairwise | Per item scores 0 to 4 (or null) for caller-named requirements, with optional `weight` and `hard`. Code computes the weighted fraction; a hard failure cannot be offset; the default threshold is full fulfilment. |
| Historical prompt rules version 1 | `criterionPromptVersion: 1` (`prompt_version: 1` in a criterion) | Selects the earlier prompt and fingerprint. Version 2 is the default and adds exact identifiers, stated facts and named-record rules. Explicit version 2 is equivalent to leaving it unset. |
| Historical decoder versions | `criterionDecoderVersion: 1` or `2` (`decoder_version` in a criterion) | Version 1 rejects an ungrounded quote. Version 2 drops an ungrounded string and keeps `met`, but retains its historical span rules. Version 3 is the default; see `judging-evidence`. Parser only. |
| Canonical presentation | `presentation: 'canonical'` in `judgePairwise` | One pairwise call in a hash-sorted order instead of two orders; position bias is not measured. |
| Repeated judging | `judgeRepeated(client, request, k)` | Asks one judge the same request k times; consistent only when all k outcomes are equal and decisive. |
| Turn-by-turn judging | `judgeTurns(judge, request)` | One call per user turn on the prefix that ends there. It returns each turn's outcome, the first failing turn and the first later turn that passes again. |
| Prompt budget | `fitPrompt(request, maxChars)` | Drops the fewest oldest entries to fit the rendered prompt, replaced by `[k earlier entries omitted]`; the last block, artifact and Given are kept. |
| Rubric lint | `lintCriterion(criterion)` | Returns issue codes for rubric defects: `two-questions`, `subjective`, `vague-quantity`, `double-negative`, `no-observable`, `too-long`, `no-fail-picture`, `no-pass-picture`, `same-pictures`, `picture-contradicts-rubric`, `scope-mismatch`, `placeholder`, `unbalanced-quotes`, `empty-rubric`, `compound`, `hedged`, `instruction-to-judge`, `pictures-swapped`. |
| Escalation | `createEscalation(...)` | See `judging-mixture-of-judges`. |
| Repeat reducer | `repeat_reducer: mode`, `median` or `at_least:<k>` on a criterion | How verdicts across repeats of one spec become one verdict (see `judging-criteria`). |

## Inputs

A `JudgeRequest` (see `judging-default-judge`) plus the setting's own fields above. A judge client (a provider client, the claude command judge, a cassette player or a `FakeJudge`).

## Outputs and how to read them

Each setting adds its own field to the judge result beside the public `answer`: `responseRelevance`, `conformance`, `answerAudit`, `factLedger`, `rubric` or `referenceAgreement` (`routed`, `attempts`, `agreement`, `used`). For reader-first, the fields are `choice`, `override`, `judgeValid`, `length`, `features`, `flags`, `failures`, `means`, `thresholds`, `ordered` and `swapped`. In every setting the model reports evidence and code computes the outcome; an answer that breaks the setting's contract is inconclusive.

## Worked example

The opt-in settings have no command option. The tested line replays real haiku answers through `judge calibrate`, the command that measures any judge procedure against the hand labels. A setting is measured the same way once its answers are recorded:

```sh
driftbench judge calibrate --criteria examples/acme/criteria --labels examples/acme/labels --cassette examples/acme/criteria/calibration/claude-haiku.cassette.json --mode llm --assign cheapest --only sheet_matches_catalog --out haiku.yaml
```

A response relevance answer parsed by code (no model call), and a rubric lint:

The scripts below run the package from its source with `tsx`; this file tells `tsx` where the packages are:

```json file=tsconfig.json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "paths": {
      "@agent-nexus/driftbench-example-acme": ["./examples/acme/src/package.ts"],
      "@agent-nexus/driftbench-adapters/contract": ["./packages/adapters/src/contract.ts"],
      "@agent-nexus/driftbench-*": ["./packages/*/src/index.ts"]
    }
  }
}
```

```ts file=relevance.mts
import { lintCriterion, parseJudgeText } from '@agent-nexus/driftbench-judges';

// response-relevance: the model lists the obligations of the latest ask; code computes the outcome.
const request = {
  criterion: { name: 'answers_the_ask', rubric: 'The final reply addresses the latest request.' },
  transcript: [
    { role: 'user' as const, text: 'What does Acme Fiber 300 cost, and when can it be installed?' },
    { role: 'agent' as const, text: 'Acme Fiber 300 costs 40 USD a month.' },
  ],
  assessment: { kind: 'response-relevance' as const },
};
const raw = JSON.stringify({
  checks: [
    { obligation: 'the price', requestQuote: 'What does Acme Fiber 300 cost', reasoning: 'The price is given.', answerQuote: 'costs 40 USD a month', met: true },
    { obligation: 'the install date', requestQuote: 'when can it be installed', reasoning: 'No date is given.', answerQuote: null, met: false },
  ],
});
const result = parseJudgeText(raw, request);
console.log(`response-relevance: ${result.answer.outcome}`);

// lintCriterion: defects that make a rubric hard to answer the same way twice.
const lint = lintCriterion({ name: 'tone', rubric: 'Is the reply polite and helpful, and does it maybe answer?', pass: 'Good.', fail: 'Good.' });
console.log(`lint: ${lint.issues.map((issue) => issue.code).join(', ')}`);
```

```sh setup
tsx relevance.mts
```

```text
$ driftbench judge calibrate --criteria examples/acme/criteria --labels examples/acme/labels --cassette examples/acme/criteria/calibration/claude-haiku.cassette.json --mode llm --assign cheapest --only sheet_matches_catalog --out haiku.yaml
sheet_matches_catalog [gating]: owned by claude-haiku alone (system2), 0.0003 USD per call
    claude-haiku       system2  separation 3/3  kappa  1.00  agreement 3/3 [0.44, 1.00]  at the bar
    alpha across judges n/a; bar: 3/3 separation and kappa 0.8
Kappa over every labelled block: claude-haiku 1.00 (3/3).

1 of 1 criteria assigned in mode llm (3 repeats, kappa at least 0.8). Spent 0.0026 USD.
Wrote haiku.yaml.
(exit 0)
$ tsx relevance.mts
response-relevance: fail
lint: subjective, same-pictures
(exit 0)
```

The reply gives the price but not the install date, so one obligation is unmet and code fails it. The lint finds the subjective words and the identical pictures.

## Common errors

* `response-relevance requires a system2 judge` (RangeError). A system 1 judge cannot answer this contract.
* `response-relevance is incompatible with answerContract legacy`, or a refusal naming a field such as `inputs`. Remove the field: response relevance reads only the transcript.
* `response-relevance needs an agent reply after the latest user entry`. The transcript must end with the reply to judge.
* `reader-first requires explicit configuration` (RangeError). Pass `{ configuration: 'reader-first' }`.
* `pair ledger requires both-orders presentation`. Do not combine the pair ledger with canonical presentation.
* A recording made with a setting that no longer replays. The setting is part of the request key: record again with the same setting.
