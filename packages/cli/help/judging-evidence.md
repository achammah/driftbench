---
title: Evidence quoting
summary: "How a judge's evidence quote is checked against the data it was given. It covers what counts as grounded, the source ids of evidence spans, the folding rules, ellipsis segments and empty containers. It also covers what a grounded quote proves and does not prove."
commands: []
see_also:
  - judging-default-judge
  - judging-pairwise
  - judging-opt-in-settings
  - judging-calibration
next:
  - judging-opt-in-settings
---

## What it is

A judge must show where its verdict comes from. The default judge returns, for each requirement, a list of evidence spans `{ source, quote }`. Code checks every quote against the data the judge received. A quote that is not in its named source is ungrounded, and under the default decoder (version 3) an ungrounded data span makes the whole answer unparseable, so the verdict is inconclusive. An invented data span cannot produce a pass; the older single-string form follows the separate rule below.

Grounding proves presence only: the quoted text appears in the data. It does not prove that the judge read it correctly, that `met` is right, or that the quote supports the verdict.

## When to use it

* To read an inconclusive verdict whose reasoning says `invalid criterion ledger: the evidence quote is not in the supplied data`.
* To write fixtures and labels: every place a judge may quote must be in the request (transcript, artifact, Given, inputs, reference).
* To check a judge answer from code, with `groundEvidence(request, answer)`.

## Commands and every option

No command option changes the grounding rules. Every command that judges applies them: `judge run`, `judge calibrate`, `replay --judge`, `estate run --judge`, `pnpm bench replay`, and `compare --pairwise-judge` (for the named-winner quote, see `judging-pairwise`). The decoder version is a library request field, `criterionDecoderVersion`, 3 by default. Specs and criteria files expose `decoder_version: 1` or `2`; unset uses version 3 (see `judging-default-judge`).

## Inputs

Evidence span sources:

| Source id | Where the quote must be |
|---|---|
| `transcript.<index>` | The `text` of that transcript entry, counted from 0. |
| `artifact` | The rendered produced files of a task block. |
| `given` | The Given, as JSON. |
| `input.<path>` | The text of that input file. |
| `reference` | The reference answer. |

A request may have exactly one input. Then a span may also ground in that one input when its source is that input's bare path, `reference`, `given` or `artifact`. The judge never guesses among several inputs.

The matching rules (`groundEvidence` and the span checker):

* Case, Unicode compatibility forms, typographic quotes and runs of white space are folded, so a quote survives the way a model copies it.
* One pair of quotes around the whole quote is stripped.
* The quote must be found on word boundaries: a fragment of a word does not ground.
* Parts split by `...` must each be found, in order, in one place.
* A quote of the rubric alone is not data evidence. Decoder 3 drops criterion-only spans; a `met: true` check still needs grounded evidence afterward. An empty quote or a role name alone never grounds. Decoder 3 accepts a tool event's supplied name and symbol-only quotes only in their named source; versions 1 and 2 reject those span forms.
* One exception: `{}` or `[]` grounds only in a place whose whole text is that same empty container. It is how a check cites an empty file.
* A quote may start with the entry's rendered role prefix, such as `[agent]`, but then the role must be that entry's real role.
* Separate quotations go in separate spans. A pipe-joined quotation is never split or guessed.

Without a span source (the older single string `evidence`), the quote is searched in the transcript entries in order. Then it is searched in the artifact, the Given, each input and the reference.

## Outputs and how to read them

`groundEvidence(request, answer)` returns `{ grounded, where }`, where `where` is the first place that holds the quote. In a judge result:

* Decoder version 1 (historical, selected explicitly): an ungrounded span makes the ledger invalid; the reasoning starts `invalid criterion ledger:` and the result is `unparsed`, so inconclusive.
* Decoder version 2 (historical, selected explicitly): an ungrounded string quote becomes `evidence: null` with `grounded: false` on its check; the check keeps its `met`; `evidenceUnverified` counts them. An ungrounded span list stays invalid under versions 1 and 2.
* Decoder version 3 (default): the same single-string rule as version 2, plus source-local symbol quotes, input source aliases such as `input/<path>`, tool-event names and the criterion-only span drop rule. Other ungrounded data spans remain invalid.
* The public `answer.evidence` is the first grounded quote, as a string.

## Worked example

Real haiku answers, replayed with no model call. They were recorded under the legacy contract, whose single `evidence` string is quoted from the rendered workbook. The script after it shows the ledger-era span rules:

```sh
driftbench judge calibrate --criteria examples/acme/criteria --labels examples/acme/labels --cassette examples/acme/criteria/calibration/claude-haiku.cassette.json --mode llm --assign cheapest --only sheet_matches_catalog --out haiku.yaml
```

Eight quotes checked against a two-entry transcript and one input file (no model call):

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

```ts file=ground.mts
import { groundEvidence } from '@agent-nexus/driftbench-judges';

const request = {
  criterion: { name: 'one_question', rubric: 'Does the reply ask at most one question?' },
  transcript: [
    { role: 'user' as const, text: 'Hi, my internet is too slow. What faster plans do you have?' },
    { role: 'agent' as const, text: 'We have Acme Fiber 300 and Acme Fiber 1000. Which address should I check? And what is your monthly budget?' },
  ],
  inputs: [{ path: 'catalog.csv', text: 'name,monthly_usd\nAcme Fiber 300,40\n' }],
};
const quotes = [
  'which ADDRESS should   I check?',
  '"And what is your monthly budget?"',
  'We have Acme Fiber 300 ... monthly budget',
  'monthly budget ... We have',
  'Acme Fiber 300,40',
  'Does the reply ask at most one question?',
  'Fib',
  '',
];
for (const evidence of quotes) {
  const result = groundEvidence(request, { outcome: 'fail', reasoning: '', evidence });
  console.log(`${JSON.stringify(evidence)} -> ${result.grounded ? `grounded in ${result.where}` : 'not grounded'}`);
}
```

```sh setup
tsx ground.mts
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
$ tsx ground.mts
"which ADDRESS should   I check?" -> grounded in transcript.1
"\"And what is your monthly budget?\"" -> grounded in transcript.1
"We have Acme Fiber 300 ... monthly budget" -> grounded in transcript.1
"monthly budget ... We have" -> not grounded
"Acme Fiber 300,40" -> grounded in input.catalog.csv
"Does the reply ask at most one question?" -> not grounded
"Fib" -> not grounded
"" -> not grounded
(exit 0)
```

Case, spacing and surrounding quotes are folded; ellipsis parts must keep their order; the rubric and a word fragment never ground.

## Common errors

* `invalid criterion ledger: the evidence quote is not in the supplied data`. The model paraphrased or invented a quote. The council re-asks once with the large budget; if it persists, the verdict stays inconclusive. A rubric that asks for something the data cannot show causes this often: add the missing source to the criterion's `inputs`.
* A judge that quotes a tool's input or a file the fixture does not carry. Only the request's own data counts: put the file in the fixture's `inputs` or `artifact`.
* Expecting a grounded quote to prove the verdict right. It proves only that the text is there; calibration against hand labels measures whether the verdicts are right.
