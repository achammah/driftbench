---
title: Mixture of Judges
summary: "Mixture of Judges (MoJ) routes each item to the judge that fits it. A cheap first judge settles what it is sure of. Only uncertain items go to costlier judges of other families. On main it is a research harness built on the package's opt-in createEscalation, with no CLI command."
commands: []
see_also:
  - judging-council
  - judging-families
  - judging-calibration
  - judging-pairwise
  - judging-opt-in-settings
next:
  - judging-run-judge
---

## What it is

Mixture of Judges (MoJ) is a routing design. A cheap, fast first judge answers every item. Only the items it leaves uncertain go to more costly judges, such as a reasoning model or a panel of models from other families. Sometimes this happens after a reference answer is solved once. The cost is spent where the cheap judge is unsure.

MoJ is the umbrella name; on main it is made of four package functions, each opt-in and each a library call:

* `createEscalation`: the router. A cheap first judge answers; only the signals you choose send the item to later judges of other families (details below).
* `weightedPanel(votes, weights, margin)`: the panel vote of the later judges, weighted by calibrated agreement (such as kappa). It abstains when the margin is thin (default margin 0.3). It is defined in `packages/judges/src/weighted-panel.ts` but not exported from the package index on main, so it cannot be imported yet. The council's own `weights` field is the public weighted vote (see `judging-council`).
* `withReferenceConsensus(client, { solve, samples, route: 'auto' })`: the reference expert. With `route: 'auto'` it first asks whether the question has one checkable answer (a number, an option, a fact, a proof result, code behaviour). Only then does a blind solver produce a reference the judge compares with. Creative and open questions skip the solve.
* `calibrateCascade`: the measurement. `{ judge, criteria, labels, repeats }` scores a deployable route on your labels; `{ first, escalateTo, ... }` is the label-aware form behind `judge calibrate --cascade`.

The research write-up and its frozen results are on main too:

* The research harness and its write-up. `research/moj/README.md`, `research/moj/RESULTS.md`, `research/moj/results/sealed/report.json` and `research/moj/sealed/freeze.json` are copies from the branch `research/system1-judge`, kept so that published numbers have a source in the repository. The harness code and its recordings are not copied.

No CLI command runs MoJ routing on main. `judge run`, `judge calibrate`, `replay` and `estate run` do not route through an escalation client. `judge calibrate --cascade` measures a cheap-first cascade but is not a deployed router.

## When to use it

* When a council of three costly judges on every item is too expensive, and a cheap judge is right on most items.
* When some items need a different kind of judge (a reference solve for a math or fact question, a reasoning model for a subtle rubric).
* To measure whether a routing pays off, use `calibrateCascade({ judge, criteria, labels, repeats })` with the escalation client as `judge`. It scores the deployable route on your labels. For a plain cheap-then-costly cascade measured from the command line, use `judge calibrate --cascade` (see `judging-calibration`).

## Commands and every option

There is no command. `createEscalation(config)` takes:

| Field | Meaning | Default |
|---|---|---|
| `first` | The judge that answers first, on every item. | required |
| `then` | The judges asked when a signal fires, at least one. | required |
| `agentFamily` | The agent's family. No judge of `first` or `then` may share it, and the pool must span at least two families. | required |
| `on` | The signals that trigger escalation: any of `order-split`, `inconclusive`, `reference-disagreement`, `low-confidence`. | required |
| `confidence` | For `low-confidence`: the probability of the chosen verdict under which it fires, from 0 to 1. | `0.5` |
| `decide` | `majority`: the later judges' majority decides, and a second split abstains. `first-stands`: a later majority decides, otherwise the first answer stands. | required |

The signals:

| Signal | Fires when |
|---|---|
| `order-split` | In a pairwise comparison, the first judge's two presentation orders disagree. Never fires pointwise or in canonical presentation. |
| `inconclusive` | A first answer is unparseable or inconclusive, or its ledger holds a null. A valid pairwise tie does not fire it. |
| `reference-disagreement` | A supplied reference disagrees with both marked final answers, a reference procedure reports disagreement, blind solves do not agree, or both candidates miss reference facts. |
| `low-confidence` | The probability of the chosen verdict is under `confidence`, or there is no score. Chat judges often leave the score out, so they escalate under this signal. |

There is one escalation round. Each later judge answers at most once; the first judge's vote does not join the later majority.

## Inputs

* Judge clients for `first` and `then`: provider clients, the claude command judge, cassette players or any client. A composite keeps its constituents' `families`, so an outer council or calibration sees every family inside it.
* A request: pointwise with `judge.judge(request)`, or pairwise with `judgePairwise(judge, criterion, transcript, first, second)`.

## Outputs and how to read them

The result carries `escalation`. It holds `triggers` (the signals that fired), `escalated`, `first` (the first results) and `then` (each later judge's result or error). It also holds `decision` (`first`, `majority`, `first-stands` or `inconclusive`) and `calls`. `costUsd` sums the reported provider costs. A transport error of the first judge is thrown; a later judge's error abstains.

Recording works as for any client: `recordingClient(judge, cassette)` and `playerClient(cassette, judge.id)` keep both-order comparisons and the routing record, and the key covers the escalation configuration. A missing entry fails; there is no live fallback.

Construction errors: `agent family is required`, `a judge shares the agent family: refused` and `escalation needs a cross-family pool`. More errors: `escalation needs at least one then judge`, `every judge family is required` and `duplicate judge ids in escalation`. Further errors: `unknown escalation trigger`, `unknown escalation decision` and `confidence must be from 0 to 1`.

## Worked example

The command line has the label-aware cascade, a measurement of cheap-first routing: haiku answers everything, sonnet and opus only where it is unsure or wrong. Replayed from real recordings, no model call:

```sh
driftbench judge calibrate --criteria examples/acme/criteria --labels examples/acme/labels --cassette examples/acme/criteria/calibration/claude-council.cassette.json --cascade --only plain_language --only ledger_intact --out cascade.json
```

Scripted judges (`FakeJudge`, no model call): a sure cheap judge decides alone in one call; an unsure one triggers the two experts. A pool that shares the agent's family is refused:

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

```ts file=escalate.mts
import { createEscalation, FakeJudge } from '@agent-nexus/driftbench-judges';

const request = {
  criterion: { name: 'quotes_the_price', rubric: 'Does the reply give the monthly price of Acme Fiber 300?' },
  transcript: [
    { role: 'user' as const, text: 'How much is Acme Fiber 300 a month?' },
    { role: 'agent' as const, text: 'Acme Fiber 300 costs 40 USD a month.' },
  ],
};
const unsure = new FakeJudge('cheap', [{ outcome: 'inconclusive', reasoning: 'Not sure.' }], { family: 'google', cost: 1 });
const sure = new FakeJudge('cheap', [{ outcome: 'pass', reasoning: 'The price is there.' }], { family: 'google', cost: 1 });
const expertA = new FakeJudge('expert-a', [{ outcome: 'pass', reasoning: 'The reply states 40 USD.' }], { family: 'meta', cost: 10 });
const expertB = new FakeJudge('expert-b', [{ outcome: 'pass', reasoning: 'The reply states 40 USD.' }], { family: 'mistral', cost: 10 });
for (const first of [sure, unsure]) {
  const judge = createEscalation({ first, then: [expertA, expertB], agentFamily: 'none', on: ['inconclusive'], decide: 'majority' });
  const result = await judge.judge(request);
  const e = result.escalation;
  console.log(`first ${first === sure ? 'sure' : 'unsure'}: ${result.answer.outcome}; escalated ${e?.escalated}, triggers [${e?.triggers.join(', ')}], decision ${e?.decision}, calls ${e?.calls}`);
}
try {
  createEscalation({ first: sure, then: [expertA], agentFamily: 'meta', on: ['inconclusive'], decide: 'majority' });
} catch (cause) {
  console.log(`refused: ${(cause as Error).message}`);
}
```

```sh setup
tsx escalate.mts
```

```text
$ driftbench judge calibrate --criteria examples/acme/criteria --labels examples/acme/labels --cassette examples/acme/criteria/calibration/claude-council.cassette.json --cascade --only plain_language --only ledger_intact --out cascade.json
Cascade: claude-haiku answers everything; claude-sonnet and claude-opus answer where it is unsure or disagrees with the label.
ledger_intact: separation 3/3, kappa 1.00 (3/3), 0.0020 USD; escalated: none
    unsure only: separation 3/3, kappa 1.00 (3/3), 0.0020 USD
plain_language: separation 3/3, kappa 1.00 (3/3), 0.0016 USD; escalated: none
    unsure only: separation 3/3, kappa 1.00 (3/3), 0.0016 USD

Spent 0.0036 USD. Wrote cascade.json.
(exit 0)
$ tsx escalate.mts
first sure: pass; escalated false, triggers [], decision first, calls 1
first unsure: pass; escalated true, triggers [inconclusive], decision majority, calls 3
refused: a judge shares the agent family: refused
(exit 0)
```

## Common errors

* `a judge shares the agent family: refused`. Model names are mapped to families (`gpt-...` is `openai`). Use judges of other families (see `judging-families`).
* `escalation needs a cross-family pool`. Every judge is of one family: add a judge of another.
* No escalation where you expect one. The signal is not in `on`, or it cannot fire in this mode (`order-split` needs both orders; `low-confidence` needs `on` to list it).
* Reading a label-aware cascade score as a deployed route's accuracy. Only `calibrateCascade({ judge, ... })` with a label-blind procedure measures what a run can do; the `{ first, escalateTo }` form escalates on disagreement with the label.
