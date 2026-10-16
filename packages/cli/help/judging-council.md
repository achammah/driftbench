---
title: The judge council
summary: "How several judges vote on one criterion. It uses two classes, three seats per class, and a majority. A split gets a re-judge by the other class. If it is still split, a last round runs with a larger token budget. It has an optional cascade from the cheapest judge and optional vote weights. It produces the judge.<name> verdict."
commands:
  - judge run
see_also:
  - judging-judge-run
  - judging-calibration
  - judging-families
  - judging-default-judge
  - judging-mixture-of-judges
  - judging-machine-checks
next:
  - judging-families
---

## What it is

A council is a set of judge clients that decide a criterion together. Every judge has an `id`, a model `family`, a class `cls` and a relative `cost`.

* System 1 judges answer a fixed binary question. The answer is a probability that the criterion passes (from 0.6 a pass, up to 0.4 a fail, inconclusive between). They are cheap and low variance, for evidence inside the block.
* System 2 judges are chat models that reason, for criteria that read across blocks.

The council seats a row per criterion: three judges of one class (`judges`) and, in hybrid mode, three judges of the other class (`rejudge`). The verdict needs more than half of the seats to agree. An inconclusive vote never supports a verdict.

The rounds:

1. The seated judges vote. A majority decides.
2. No majority is a split. In hybrid mode, the three re-judges of the other class vote.
3. Still a split, or a mode with one class. The seated judges answer once more with the large token budget (4096 tokens instead of 1024 for a chat model). Their votes carry `@large`.
4. Still no majority: the verdict is inconclusive, never a pass or a fail.

Inside a round, an answer that does not parse is asked again once with the large budget. A judge that gives no answer at all votes inconclusive and is counted as an error.

## When to use it

* When one judge is not enough evidence: a council of judges from different families, chosen by calibration.
* On the command line, a council exists only in `judge run`, which replays one on fixture pairs from a cassette. `campaign run` loads no council yet; `replay` and `estate run` use a single judge (see `judging-run-judge`). In code, a council is built with `createCouncil` and passed to the checks as `defaultChecks({ judges: council })`.

## Commands and every option

`driftbench judge run` exposes these council settings (every option is in `judging-judge-run`):

| Option | Meaning | Default |
|---|---|---|
| `--mode <mode>` | `system1` (system 1 judges only), `hybrid` (both classes, re-judge on a split) or `llm` (system 2 only). Scores from different modes are not comparable. | `hybrid` |
| `--agent-family <family>` | The council is refused if a judge shares this family. | `none` |
| `--cascade` | Cascade from the cheapest judge with threshold 0.9. | off |
| `--assignments <file>` | Seat the rows calibration wrote. | none |

`createCouncil(config)` in code takes more:

| Field | Meaning | Default |
|---|---|---|
| `mode` | As above. Required. | none |
| `judges` | The judge clients. Required. | none |
| `agentFamily` | Required. `none` for an agent that is not a model. | none |
| `size` | Judges seated per class, a whole number from 1. | `3` |
| `weights` | A weight per judge id (at least 0). A side wins with more than half of the total weight of the votes cast, inconclusive votes included. | every judge 1 |
| `assignment` | Rows that override the default seating, such as calibration's. | none |
| `unassigned` | Criteria calibration left unassigned: judged, never gating. | none |
| `cascade` | `true` (threshold 0.9), or `{ threshold, thresholds }` with a threshold above 0.5 and at most 1, and per judge thresholds by id. | off |

Default seating, without a row: the class is the criterion's `judge_class`. `auto` or no class goes to system 1 until calibration earns it a class. `system1` and `llm` modes force their own class. The seats go to the cheapest judges of the class, by cost then id.

The cascade: the cheapest seated judge votes first. The council stops there only on a pass whose `score` is at least the threshold (that judge's own threshold if `thresholds` names it). A fail, an inconclusive, an unsure pass or an answer without a `score` brings in the other seated judges. A request whose data holds an instruction aimed at the judge never stops at the cheapest judge. The screen finds such an instruction as a sentence with a judge word and a verdict word. Most chat judges leave `score` out, so a criterion that such a judge leads always costs every seat.

A weighted panel with abstain, `weightedPanel(votes, weights, margin)`, exists in `packages/judges/src/weighted-panel.ts`. It has a default margin of 0.3. The package index on main does not export it, so callers cannot import it. The council's own `weights` field is the public way to weight votes.

## Inputs

* The judges: provider clients, cassette players (`cassettePlayers`), the claude command judge, or any object with the client shape.
* The criterion and the request: see `judging-default-judge`.
* An assignment table, optional: see `judging-calibration`.

## Outputs and how to read them

A council result has `criterion`, `outcome`, `cls`, `votes`, `rounds`, `split`, `cascaded`, `errors`, `cost`, `score` and `log`. `cls` is the class whose round decided. `votes` holds every vote of every round. `split` is the first round split. `score` is the mean score of the agreeing votes that carry one. `log` has one line per round:

```
system1: s1p-a pass, s1p-b inconclusive, openai-decisions fail; split
system2: google-chat fail, openai-chat fail, anthropic-chat fail; fail
system1 (large budget): s1p-a@large inconclusive, ...; split
system1: s1p-a pass; pass, the cheapest judge was sure
```

In a run, the council's check is the check named `judge`, placed after every machine check. Each criterion a block names gives one verdict `judge.<name>`. In `<name>`, a character other than a letter, digit, `_`, `.` or `-` becomes `_`. The verdict is of kind `judge`. It has the deciding class and every vote, the round log as evidence, and the reasoning of the first agreeing vote. It gates when the definition sets `gating: true` or the block writes `name@gating`, unless calibration left it unassigned. In that case, its evidence starts `unassigned by calibration, not gating:`. A criterion the spec does not define gives an inconclusive verdict. A judge verdict never replaces a machine verdict: a block passes only when every gating verdict passes. `combineVerdicts(machine, judged)` applies the same rule for a caller merging lists. It refuses a judge verdict of kind `machine` or one reusing a machine verdict id. A failing gating judge verdict carries drift class X1.

The council is checked when it is built, before any call. Its errors (`CouncilConfigError`):

| Message | Cause |
|---|---|
| `the agent family is not set: use none for an agent that is not a model` | Empty `agentFamily`. |
| `judge <id> is from the <family> family, the family of the agent under test: refused` | See `judging-families`. |
| `two judges are named <id>` | Duplicate ids. |
| `mode <mode> needs 3 <class> judges, <n> given` | Too few judges of a class the mode uses. |
| `size must be a whole number of at least 1, got <n>` | Bad `size`. |
| `the cascade threshold must be above 0.5 and at most 1, got <t>` | Bad threshold. |
| `criterion <name> has two assignment rows`, `criterion <name> is both assigned and unassigned`, `criterion <name> is unassigned twice` | Conflicting rows. |
| `assignment of <name>: class <cls> is not used in mode <mode>` | A row for a class the mode does not use. |
| `assignment of <name>: the assigned class needs 1 or 3 different judges`, `... the re-judge needs 3 different judges` | Wrong seat count, or a repeated judge. |
| `assignment of <name>: no judge is named <id>`, `... <id> is a system2 judge, not system1` | A row names an unknown judge, or one of the wrong class. |
| `assignment of <name>: mode <mode> has no other class to re-judge a split` | A re-judge row outside hybrid mode. |

## Worked example

The cascade on the Acme council cassette. The pass fixtures stop at the cheapest judge, whose scripted answers carry a score. The exception is `holds_instructions`. Its data holds an instruction aimed at the judge, so the screen never lets it stop early. Every seated judge votes:

```sh
driftbench judge run --criteria examples/acme/criteria --cassette examples/acme/criteria/council.cassette.json --cascade
```

Weights in code, with three scripted judges (`FakeJudge`, no model call). Two judges fail the reply and one passes it; giving the passing judge weight 3 makes it more than half of the total weight:

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

```ts file=weights.mts
import { createCouncil, FakeJudge } from '@agent-nexus/driftbench-judges';

const pass = { outcome: 'pass' as const, reasoning: 'One question.' };
const fail = { outcome: 'fail' as const, reasoning: 'Two questions.' };
const judges = [
  new FakeJudge('judge-a', [pass], { family: 'google', cost: 1 }),
  new FakeJudge('judge-b', [fail], { family: 'meta', cost: 2 }),
  new FakeJudge('judge-c', [fail], { family: 'mistral', cost: 3 }),
];
const request = {
  criterion: { name: 'one_question', rubric: 'Does the reply ask at most one question?' },
  transcript: [
    { role: 'user' as const, text: 'What plans do you have?' },
    { role: 'agent' as const, text: 'Which address? And what budget?' },
  ],
};
for (const weights of [undefined, { 'judge-a': 3 }]) {
  const council = createCouncil({ mode: 'system1', agentFamily: 'none', judges, ...(weights ? { weights } : {}) });
  const result = await council.judge(request);
  console.log(`weights ${JSON.stringify(weights ?? {})}: ${result.outcome}; ${result.log.join(' | ')}`);
}
```

```sh setup
tsx weights.mts
```

```text
$ driftbench judge run --criteria examples/acme/criteria --cassette examples/acme/criteria/council.cassette.json --cascade
separated  care_redirect [system1, gating]: pass fixture pass (cascade), fail fixture fail
separated  checks_before_promising [system1, gating]: pass fixture pass (cascade), fail fixture fail
separated  coverage_before_offer [system1, gating]: pass fixture pass (cascade), fail fixture fail
separated  explicit_confirmation [system1, gating]: pass fixture pass (cascade), fail fixture fail
separated  holds_instructions [system1, gating]: pass fixture pass, fail fixture fail (split, re-judged)
separated  honest_failure [system2, gating]: pass fixture pass (cascade), fail fixture fail
separated  ledger_intact [system2]: pass fixture pass (cascade), fail fixture fail
separated  no_invented_data [system2, gating]: pass fixture pass (cascade), fail fixture fail
separated  one_question_per_turn [system1]: pass fixture pass (cascade), fail fixture fail
separated  plain_language [system1]: pass fixture pass (cascade), fail fixture fail
separated  resumes_pending_step [system1, gating]: pass fixture pass (cascade), fail fixture fail
separated  sheet_matches_catalog [system1, gating]: pass fixture pass (cascade), fail fixture fail

12 of 12 criteria separated in mode hybrid.
(exit 0)
$ tsx weights.mts
weights {}: fail; system1: judge-a pass, judge-b fail, judge-c fail; fail
weights {"judge-a":3}: pass; system1: judge-a pass, judge-b fail, judge-c fail; pass
(exit 0)
```

## Common errors

* `judge run: mode llm needs 3 system2 judges, 2 given` (exit 2), for example. The cassette has too few judges of a class the mode uses. Add judges or change the mode.
* `judge run: judge <id> is from the <family> family, the family of the agent under test: refused` (exit 2). See `judging-families`.
* A criterion that is always `inconclusive (split, re-judged)`. Every round split: often a cassette miss (every vote inconclusive). Check the error count on the summary line.
* A cascade that never stops early. The cheapest judge leaves `score` out, its score is under the threshold, or the data holds an instruction aimed at the judge.
