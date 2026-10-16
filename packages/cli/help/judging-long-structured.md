---
title: Long-structured and reader-first
summary: "Two opt-in pairwise settings that prefer the longer reply. long-structured (available from the next release, PR 378) picks the longer reply when it is structured. reader-first (on main) favours the longer complete reply unless measurements show a substantial reader-facing failure. Use them only when longer answers are what you want."
commands: []
see_also:
  - judging-pairwise
  - judging-opt-in-settings
  - judging-default-judge
  - judging-bench-replay
next:
  - judging-pairwise
---

## What it is

Both settings judge a pair of replies and both prefer the longer one. They are declared preferences of the caller, not measures of quality, and neither is ever applied by the default judge.

* `long-structured`: available from the next release. It is not on main today. It lives in PR 378 (branch `feat/writing-lead`, file `packages/judges/src/long-structured.ts`). After the pair ledger verdict, code decides in this order. First, an explicit request row (a hard requirement that decided a reading, such as a stated word limit or form) wins (`preference.hard-row`). Otherwise the longer reply wins when it is structured, or when the shorter reply is not structured either (`preference.long-structured`). Otherwise the ledger choice stands (`preference.ledger`), and equal lengths keep it too. A reply is structured when all three hold. The reader-first structure flag is clear (paragraphs, headings or lists rather than one long block). At most 8 percent of its sentences repeat. At most 15 percent of its four-grams repeat. Length is words in English and Han characters in Chinese. It makes no extra model call.
* `reader-first`: on main. `createReaderFirstJudge(client, { configuration: 'reader-first' })`, then `judgePair(request, first, second)`. It favours the longer complete reply. The exception is when machine features (length, structure, filler, hedges, repetition, jargon, readability and more) and both model presentations agree on a substantial reader-facing failure. Two model calls per pair. Thresholds `judgeMargin` 4, `featureMargin` 5, `minFailures` 1; changing them changes the configuration.

## When to use it

* Only when the people you serve prefer longer, structured answers: long-form writing, reports, explanations.
* Never as a quality score. Where humans prefer the shorter reply, a length preference is almost always wrong. PR 378 reports a result with Claude Haiku 5.5 on WritingPreferenceBench pairs. In that report, long-structured picks the longer reply in 96.5 percent of games on the recorded TEST pool. It is right 1.8 percent of the time when the human chose the shorter reply.
* For a neutral comparison, use the default pairwise judge (see `judging-pairwise`).

## Commands and every option

No command option and no spec field selects either setting; both are library calls.

| Setting | How to turn it on | Status |
|---|---|---|
| long-structured | `judgePairLedger(client, request, { preference: 'long-structured' })`. `PAIR_PREFERENCES` lists the accepted names; any other value throws `preference must be one of long-structured`. Helpers `applyLongStructured(first, second, verdict, language)` and `isStructured(features)`. | Available from the next release (PR 378). |
| reader-first | `createReaderFirstJudge(client, { configuration: 'reader-first', language })`, options `judgeMargin`, `featureMargin`, `minFailures`. | On main. |

## Inputs

* long-structured: a pair ledger request (see `judging-pairwise`) and the two reply texts.
* reader-first: a judge client, the request, and the two replies; optional `language` (`en` or `zh`) fixes the counting unit for both.

## Outputs and how to read them

* long-structured: the pair ledger result keeps its `verdict` and adds `preference`: `name`, `choice` (`first`, `second` or `tie`), `ruleId`, `lengths` (`first`, `second`) and `structured` (`first`, `second`). Results with the setting must be labelled as the long-structured setting, never as the default judge.
* reader-first: `choice`, `override`, `judgeValid`, `length` and `features` (the two ablations), `flags`, `failures`, `means`, `thresholds`, `ordered`, `swapped` and `costUsd`.

## Worked example

Neither setting has a command. The tested line prints the pairwise options of `compare`, the command that judges reply pairs today:

```sh
driftbench compare --help
```

```text
$ driftbench compare --help
Usage: driftbench compare [options]
(21 more lines)
  --pairwise <criterion.yaml>  also judge, reply by reply, which of the two
                               campaigns better meets this criterion, in both
                               orders; the blocks both ran
  --pairwise-judge <kind>      the judge of the pairwise calls: openai,
                               anthropic or google (default: "openai")
  --pairwise-reference <file>  judge which reply matches this reference answer
                               better, instead of which reply is better; the
                               file holds the text
  -h, --help                   display help for command
(exit 0)
```

Not run by the help test: it reads the PR 378 file with git. The long-structured rule runs with no model call from a checkout of main, with the PR 378 file copied beside a script. Once PR 378 lands, import `applyLongStructured` from `@agent-nexus/driftbench-judges` instead. The ledger verdict passed in says `first`; the rule overrides it with the longer reply:

```text
$ mkdir -p out/ls
$ git show origin/feat/writing-lead:packages/judges/src/long-structured.ts | sed "s#from './#from '../../packages/judges/src/#" > out/ls/long-structured.ts
$ cat > out/ls/demo.ts <<'EOF'
import { applyLongStructured } from './long-structured';

const short = 'Acme Fiber 300 costs 40 USD a month.';
const long = [
  'Acme Fiber 300 costs 40 USD a month.',
  '',
  'What you get:',
  '- 300 Mbps download',
  '- Free installation',
  '- No yearly contract',
].join('\n');
const block = 'Acme Fiber 300 costs 40 USD a month and gives 300 Mbps download with free installation and no yearly contract and you can cancel any month and the router is included and support is open every day of the week.';
for (const [name, first, second] of [
  ['short vs long structured', short, long],
  ['short vs long unstructured', short, block],
] as const) {
  const r = applyLongStructured(first, second, { choice: 'first', ruleId: 'ledger.weighted-sum', readings: [] } as never);
  console.log(`${name}: choice ${r.choice}, rule ${r.ruleId}, lengths ${r.lengths.first}/${r.lengths.second}, structured ${r.structured.first}/${r.structured.second}`);
}
EOF
$ pnpm -s exec tsx out/ls/demo.ts
short vs long structured: choice second, rule preference.long-structured, lengths 8/22, structured true/true
short vs long unstructured: choice second, rule preference.long-structured, lengths 8/40, structured true/true
(exit 0)
```

In both pairs the longer reply wins. The one-sentence block still reads as structured: a single short paragraph raises no structure flag. This is the length lean the setting declares.

## Common errors

* `preference must be one of long-structured` (RangeError). Only that preference name exists.
* `reader-first requires explicit configuration` (RangeError). Pass `{ configuration: 'reader-first' }`.
* `Cannot find ... long-structured` before PR 378 lands. The setting is not on main yet; it is available from the next release.
* Reporting a score made with either setting as the default judge's. Label it with the setting's name.
