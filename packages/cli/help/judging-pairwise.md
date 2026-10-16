---
title: Pairwise judging
summary: "Judging which of two replies better meets a criterion, in both presentation orders so position bias shows. It covers the named-winner contract, canonical single-order presentation, and the pair ledger computed in code. It also covers the factual audit against a reference, itemized rubrics, rankings, and the compare --pairwise options."
commands:
  - compare
see_also:
  - judging-default-judge
  - judging-evidence
  - judging-opt-in-settings
  - judging-council
  - judging-mixture-of-judges
next:
  - judging-mixture-of-judges
---

## What it is

A pairwise judgement compares two replies to the same request against one criterion and names a winner. Judges prefer whichever reply they read first more often than they should. Because of this, `judgePairwise` asks twice by default: once in the given order and once swapped. Code maps the second answer back to the original replies:

* Both orders pick the same reply: that reply wins.
* The orders disagree: the verdict is a tie, `consistent: false`, and `positionBias: true` when the judge simply preferred the first position each time.

Chat judges answer with the named-winner contract: `{"reasoning": "...", "winnerQuote": "...", "winner": "A"}`, where `winner` is `A`, `B`, `tie` or `inconclusive`. `winnerQuote` must copy a passage that appears in the winning reply and not in the other one. It is null for a tie or missing data. A decisive answer without such a quote is unparseable. It is re-asked once with the large budget (an ambiguous quote's re-ask says `your quote matches both replies`), then inconclusive.

## When to use it

* To compare two versions of an agent reply by reply: `driftbench compare --pairwise <criterion.yaml>` on two stored campaigns.
* To judge "which is better" when no absolute pass or fail fits.
* To compare against a known right answer: `--pairwise-reference <file>`.
* For an absolute verdict on one reply, use the default judge (see `judging-default-judge`).

## Commands and every option

`driftbench compare` belongs to the results area; its pairwise options:

| Option | Meaning | Default |
|---|---|---|
| `--pairwise <criterion.yaml>` | Also judge, reply by reply, which of the two campaigns better meets this criterion, in both orders, on the blocks both ran. The file holds a criterion: `name`, `rubric`, optional `pass`, `fail`, `scope`. | none: no pairwise calls |
| `--pairwise-judge <kind>` | The judge of the pairwise calls: `openai`, `anthropic` or `google` (keys and model from the environment, see `judging-default-judge`), or a judge a plugin registers. Paid calls. | `openai` |
| `--pairwise-reference <file>` | Judge which reply matches the reference answer in this file better, instead of which reply is better. Turns on the factual audit. | none |

The compare command uses the named-winner contract in both orders. A judge that gives no answer stops the command with `pairwise judge gave no answer: <reason>` (exit 2); it is never counted as a tie.

The library adds, with no CLI option:

| Setting | Effect |
|---|---|
| `presentation: 'canonical'` | One call instead of two: the replies are ordered by the SHA-256 of their text, and the winner is mapped back. Identical replies tie. Position bias is not measured, so the verdict has no `consistent` or `positionBias`. |
| `answerContract: 'ledger'` (the pair ledger) | The model scores each requirement 0 to 4 for each reply (or null), never a winner; code computes the winner. Needs both orders. |
| `rubricItems` | Per item scores 0 to 4, each item with `name`, `rubric`, optional `weight` and `hard: true`. A reply meeting every hard item outranks one that fails a hard item; otherwise weighted fractions decide; a null score is inconclusive. |
| `reference` | The factual audit: requested facts are checked in both replies (values, units, entities, negation). Fewer wrong or missing facts wins; fewer unsupported extra claims breaks a tie. On a tie or disagreement, a fact ledger is asked in both orders and must agree. `audit: false` keeps the general comparison. |

The pair ledger rules, with the rule id the verdict carries:

* Stage 0 runs code checks first. The checks cover an instruction planted in a reply, a final answer, the language and explicit arithmetic. They also cover format rules from the question and harm policy facts the caller supplies. A decisive row ends the comparison.
* Per order: a hard requirement one reply loses decides (`ledger.hard-gate`), unless each loses one (`ledger.hard-conflict`, no winner). Otherwise the weighted sum of score differences decides (`ledger.weighted-sum`; weight 2 for a hard requirement, 1 otherwise). A null where it matters gives no winner (`ledger.unknown-score`).
* Across orders: both agree (`ledger.orders-agree`), or one wins by a margin of at least 2 and the other names none (`ledger.margin-two`). Otherwise a third read in canonical order votes (`ledger.escalated-quorum`, or `ledger.escalated-tie`).

Rankings: `bradleyTerry(wins)` ranks versions from a matrix of pairwise wins; `findCycles(wins)` names three-version preference cycles (A beats B, B beats C, C beats A).

## Inputs

* For `compare --pairwise`: two stored campaigns (see the compare topic), a criterion YAML file, and the provider key and model in the environment.
* For the library: `judgePairwise(client, criterion, transcript, first, second, options)`. The transcript is the request the replies answer.

## Outputs and how to read them

`compare` prints one more line, and adds `pairwise` to its JSON:

```
Pairwise: <n> pairs, baseline <b>, candidate <c>, tie <t>, inconsistent <i>, position bias <p>.
```

`baseline` and `candidate` count the pairs each campaign won in both orders. `inconsistent` counts pairs whose orders disagreed. `position bias` counts those where the judge followed the position.

A library verdict (both orders) has `choice` (`first`, `second` or `tie`), `ordered` and `swapped` (each order's outcome). It also has `consistent`, `positionBias`, `calls` (actual calls, repairs included) and `recovered` (a fact-ledger recovery). A canonical verdict has `presentation: 'canonical'`, `choice`, `outcome`, `aIsFirst` and `calls`. A pair ledger result has `status`, `choice`, `calls`, and every read with its parse steps. It also has the Stage 0 rows, the verdict with its rule id, and lint codes per requirement.

## Worked example

The pairwise options of `compare`, as the CLI prints them:

```sh
driftbench compare --help
```

Two scripted judges (`FakeJudge`, no model call) compare a reply that gives the price with one that does not. The fair judge picks the same reply in both orders; the biased judge always prefers what it reads first, so its orders disagree:

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

```ts file=orders.mts
import { FakeJudge, judgePairwise } from '@agent-nexus/driftbench-judges';

const criterion = { name: 'answers_the_ask', rubric: 'Which reply gives the monthly price of Acme Fiber 300?' };
const transcript = [{ role: 'user' as const, text: 'How much is Acme Fiber 300 a month?' }];
const good = 'Acme Fiber 300 costs 40 USD a month.';
const vague = 'Acme Fiber 300 is one of our plans.';
// A judge that reads the content: it picks the reply that holds the price, in either order.
const fair = new FakeJudge('fair', [
  (request) => ({
    outcome: request.candidates?.A.includes('40 USD') ? 'pass' : 'fail',
    reasoning: 'Picks the reply with the price.',
  }),
]);
// A judge that always prefers whatever it reads first.
const biased = new FakeJudge('biased', [{ outcome: 'pass', reasoning: 'A is better.' }]);
for (const judge of [fair, biased]) {
  const verdict = await judgePairwise(judge, criterion, transcript, good, vague);
  const both = verdict as { choice: string; consistent: boolean; positionBias: boolean; calls: number };
  console.log(`${judge.id}: choice ${both.choice}, consistent ${both.consistent}, position bias ${both.positionBias}, calls ${both.calls}`);
}
const canonical = await judgePairwise(fair, criterion, transcript, good, vague, { presentation: 'canonical' });
console.log(`fair, canonical: choice ${canonical.choice}, calls ${(canonical as { calls: number }).calls}`);
```

```sh setup
tsx orders.mts
```

```text
$ driftbench compare --help
Usage: driftbench compare [options]

Compare a candidate campaign with a baseline on the goldens both ran. Exit 0
non-inferior, 1 regressed or not shown non-inferior, 2 on bad input.

Options:
  --baseline <campaign>        the baseline campaign id
  --candidate <campaign>       the candidate campaign id
  --store <file>               the store that holds both campaigns
  --margin <points|auto>       the largest drop in pass rate tolerated, in
                               percentage points, such as 2; auto: the smallest
                               margin at which the baseline compared with itself
                               is non-inferior (default: "auto")
  --min-goldens <n>            a gating criterion decided on fewer goldens is
                               underpowered and left out of the parity test
                               (default: "30")
  --strict                     underpowered criteria gate too
  --mode <modes>               compare only these modes, such as F or T,F;
                               default every mode both ran
  --q <rate>                   false discovery rate of Benjamini-Hochberg across
                               criteria (default: "0.05")
  --json                       print one JSON document
  --pairwise <criterion.yaml>  also judge, reply by reply, which of the two
                               campaigns better meets this criterion, in both
                               orders; the blocks both ran
  --pairwise-judge <kind>      the judge of the pairwise calls: openai,
                               anthropic or google (default: "openai")
  --pairwise-reference <file>  judge which reply matches this reference answer
                               better, instead of which reply is better; the
                               file holds the text
  -h, --help                   display help for command

Help topics:
  driftbench help recipes-compare-two-versions  Run the same suite on two agent versions, decide with compare whether the new one is no worse, read the diff in a scorecard, and watch the versions over time with monitor.
  driftbench help judging-pairwise              Judging which of two replies better meets a criterion, in both presentation orders so position bias shows: the named-winner contract, canonical single-order presentation, the pair ledger computed in code, the factual audit against a reference, itemized rubrics, rankings, and the compare --pairwise options.
Every topic: driftbench help
(exit 0)
$ tsx orders.mts
fair: choice first, consistent true, position bias false, calls 2
biased: choice tie, consistent false, position bias true, calls 2
fair, canonical: choice first, calls 1
(exit 0)
```

A scripted binary judge maps `pass` to "A wins" and `fail` to "B wins"; built-in chat judges return a named winner with a quote instead. `compare --pairwise` itself calls a paid provider judge, so it is not run here.

## Common errors

* `unknown pairwise judge <kind>: use openai, anthropic or google` (exit 2). Use one of the three, or register a judge with a plugin.
* `<file> is not a criterion: <reason>` (exit 2). The `--pairwise` file needs at least `name` and `rubric`.
* `pairwise judge gave no answer: <reason>` (exit 2), such as `OPENAI_API_KEY is not set`. Set the provider key and the model variable.
* Many `inconsistent` pairs. The judge follows position more than content: the comparison says little. Sharpen the criterion, or use another judge.
* `pair ledger requires both-orders presentation` (from code). The pair ledger cannot run with `presentation: 'canonical'`.
