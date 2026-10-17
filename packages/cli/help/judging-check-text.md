---
title: Checks on the reply text
summary: "The machine checks that read what the customer sees. They are must, must_not, regex, exact, starts_with, length, lang, refusal, injection, json, markup, finish_reason, rouge_l, bleu, similarity, relevancy, knowledge_retention, pii and cards. This topic gives their spec fields, verdict ids and evidence."
commands:
  - campaign run
  - replay
see_also:
  - judging-machine-checks
  - judging-check-tools
  - judging-check-runtime
  - judging-criteria
next:
  - judging-check-tools
---

## What it is

These checks read the customer-visible text of a block: the adapter's `observed.text`, or the text segments joined by a line break when it is empty. A field of the block's `expect` (or of the spec's `rules`) turns each one on. Each gives verdicts with ids that start with its name. All are deterministic and make no model call, except the opt-in `pii.personal_data`.

## When to use it

* Required or forbidden words, numbers or names in the reply: `must`, `must_not`, `regex`, `exact`, `starts_with`.
* Shape of the reply: `length`, `json`, `markup`, `finish_reason`, `cards` and `rules.one_message_per_turn`.
* Language: `lang`, `rules.lang_stable`.
* Safety and privacy: `refusal`, `injection`, `pii`.
* Closeness to a reference: `rouge_l`, `bleu`, `similarity`.
* Conversation quality floors: `relevancy` (the reply addresses the ask) and `knowledge_retention` (a known fact is not asked again).
* What words cannot decide (tone, a refusal phrased in other words, a paraphrase): a judged criterion (see `judging-criteria`).

## Commands and every option

Every run command applies these checks (see `judging-machine-checks`). One command option concerns them: `driftbench replay --owner <values...>` and `--owner-file <file>`. They list the owner's own email, phone, IBAN or national number, which the `pii` check leaves out. The file has one value per line, and `#` starts a comment. The judge for `pii_judge` comes from `--judge` on `replay` and `estate run`.

The spec fields:

| Field | Check | What passes | Verdict ids |
|---|---|---|---|
| `must: [pattern...]` | `must` | Each pattern (a regular expression) matches the visible text. | `must.<i>` |
| `must_not: [pattern...]` | `must_not` | No pattern matches. A pattern cannot sit in both lists. | `must_not.<i>` |
| `rules.match_case` | `must`, `must_not` | Default `false`: case is ignored and a trailing punctuation mark of the reply does not count. `true`: both count. | |
| `regex: [pattern...]` | `regex` | Each pattern matches; case-sensitive. | `regex.<i>` |
| `exact: text` | `exact` | The reply equals the text after normalising. Normalising trims the text, keeps only letters, digits and spaces, collapses spaces and makes it lower case. Numbers compare as numbers. `true` equals `1`. A dot or comma between digits counts. `exact_strict: true` compares byte for byte after trimming. | `exact.0` |
| `starts_with: text` | `starts_with` | The whole reply, leading space removed, starts with the text. | `starts_with.0` |
| `length: { words: { min, max }, chars: { min, max } }` | `length` | Word count (runs of non-space) and character count (code points) within bounds. | `length.words`, `length.chars` |
| `lang: EN` (or a tag such as `fr-BE`) | `lang` | Every text segment reads as that language (detector franc-min; names and links are ignored; under 30 letters is skipped). | `lang.expected` |
| `rules.lang_stable: true` | `lang` | Every segment stays in the language the run settled on. | `lang.stable` |
| `refusal: refuses` or `answers` | `refusal` | The reply is, or is not, a refusal, by refusal phrases in English, French, Dutch, German, Spanish, Italian and Portuguese. | `refusal.verdict` |
| `injection: true` | `injection` | The block's user message is an injection or jailbreak attempt. `injection.attack` passes when a rule recognises it, and is inconclusive otherwise. The reply does not obey it (`injection.resist`). | `injection.attack`, `injection.resist` |
| `json: { schema, paths, embedded }` | `json` | The reply is JSON. One Markdown fence of JSON is accepted, and `embedded: true` reads the first JSON object or array in prose. The reply matches a strict schema, and each `{ path, assert }` holds. | `json.valid`, `json.schema`, `json.path.<i>` |
| `markup: xml`, `html` or `sql` | `markup` | Well-formed tags, or SQL that SQLite's parser accepts. Structure only. | `markup.valid` |
| `finish_reason: stop` (or another reason) | `finish_reason` | The runtime's reported stop reason equals it. No reason reported: inconclusive, not gating. | `finish_reason.reason` |
| `rouge_l: { reference, min, profile }` | `rouge_l` | Word-level ROUGE-L F measure reaches `min` (0 to 1). `profile`: `driftbench` (default) or `ragas`. | `rouge_l.0` |
| `bleu: { reference, min, profile }` | `bleu` | BLEU (1- to 4-grams, brevity penalty) reaches `min`. | `bleu.0` |
| `similarity: [{ reference, min }]` | `similarity` | Embedding similarity reaches `min`. Default embedder `char-ngram-tfidf`, local, deterministic. | `similarity.<i>`, with the score |
| `relevancy: { min, terms }` | `relevancy` | The share of key terms of the ask found in the reply (stemmed, in the ask's language) reaches `min` (default 0.5). No term found fails and gates; some but too few is inconclusive, not gating. With the judged criterion `relevancy` on the block, advisory only. | `relevancy.terms`, with the share as score |
| `knowledge_retention: [{ fact, use, ask }]` | `knowledge_retention` | A fact in the ledger is not asked again. A question that matches `ask`, or names the key, fails unless it repeats the value. With `use: true`, its value appears in the reply or a tool input. | `knowledge_retention.<fact>.asked`, `knowledge_retention.<fact>.used` |
| (always on) | `pii` | No IBAN, Belgian national number, phone number or email address in the visible text. Fictional values (`example.com`, `.test`, the 555-0100 to 555-0199 range and others) pass. | `pii.iban`, `pii.national_number`, `pii.phone`, `pii.email` |
| `pii_judge: true` | `pii` | A judge finds no real person's name or personal address. Without a judge: gating inconclusive. | `pii.personal_data` |
| `cards: [{ name, count }]` | `cards` | Each card is sent the expected number of times (`count` exact or `{ min, max }`). | `cards.<name>` |
| `rules.one_message_per_turn: true` | `cards` | One text segment per block, or one card in its place. | `cards.one_message_per_turn` |

## Inputs

The inputs are the block's visible text and its user message (for `injection`, `relevancy`). They also include the ledger (for `knowledge_retention`), the cards and the runtime's finish reason. The adapter reports them. Patterns compile as JavaScript regular expressions with the `m` flag. In YAML, escape `$` and `.` as `\$` and `\.` when they mean themselves.

## Outputs and how to read them

The evidence quotes what decided. It shows the matched text with its offset (`/Acme Telecom/ matched "Acme Telecom" at offset 12: ...`). It shows the counted words (`27 words, within 0 to 60`), the key terms found and missing, and the detected language. A failing `must` on a literal names the closest span and how far it differs. The `pii` evidence masks each value. A failing `similarity` or `relevancy` gives drift class X1; a failing `knowledge_retention` gives X3.

## Worked example

A scratch spec: the first two blocks of the Acme plan upgrade, with extra text expectations, on the deterministic sales agent (no model call). `starts_with: Hello` fails (the reply starts with "Hi"), and `relevancy` fails on block 1, whose ask is an email address with no topic words. The run prints the failing ids; a small script then prints every verdict with its evidence from `--json`:

```yaml file=check-demo.yaml
# A scratch copy of the first two blocks of acme-plan-upgrade, with extra expectations. Fictional data.
id: check-demo
title: Machine checks on the first two blocks of the plan upgrade
lang: EN
target: { adapter: function, agent: acme-sales }
ledger_seed: { customer: existing, lang: EN }
stages: [identify, offer, recap, order_placed, callback, handover, closing]
rules:
  forbidden_tools: [order.create]
  lang_stable: true
blocks:
  - user: Hi, I'm already an Acme customer and I keep running out of data on my phone.
    expect:
      stage: identify
      tools:
        - { label: catalog.search, count: 0 }
      must: ['Acme Telecom', 'email address']
      must_not: ['Acme Fiber']
      regex: ['^Hi']
      starts_with: Hello
      length: { words: { max: 60 } }
      refusal: answers
  - user: It's sam.rivera@example.com
    expect:
      stage: offer
      tools:
        - label: catalog.search
          count: 1
          input:
            category: mobile
            customer_email: { regex: '@example\.com$' }
          input_closed: true
      tool_order: exact
      tool_f1: { min: 0.9 }
      must: ['Acme Mobile M', '\$35']
      relevancy: {}
```

```js file=show.mjs
// Prints every verdict of a `campaign run --json` document read on stdin: block, id, outcome, evidence.
// An optional argument lists id prefixes to leave out, comma-separated.
let text = '';
process.stdin.on('data', (chunk) => { text += chunk; });
process.stdin.on('end', () => {
  const skip = (process.argv[2] ?? '').split(',').filter(Boolean);
  for (const cell of JSON.parse(text).cells)
    cell.blocks.forEach((block, i) => {
      for (const v of block.verdicts)
        if (!skip.some((p) => v.id.startsWith(p)))
          console.log(`block ${i} ${v.id} ${v.outcome}${v.gating ? '' : ' (not gating)'}: ${v.evidence}`);
    });
});
```

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

```sh
driftbench campaign run check-demo.yaml --no-cache  # exit 1
```

```sh setup
tsx packages/cli/src/bin.ts campaign run check-demo.yaml --no-cache --json | node show.mjs
```

```text
$ driftbench campaign run check-demo.yaml --no-cache
Campaign c-a7930b101319: 1 cell, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, regex, exact, injection, length, markup, starts_with, finish_reason, json, tool_f1, refusal, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
✗ check-demo · function:acme-sales · F · repeat 0  fail  block 0 starts_with.0, block 1 relevancy.terms
1 cell: 0 pass, 1 fail, 0 failed. Spent $0.00.
The runs are not kept: pass --store <file> to keep them.
(exit 1)
$ tsx packages/cli/src/bin.ts campaign run check-demo.yaml --no-cache --json | node show.mjs
block 0 forbidden.order.create pass: order.create not called (forbidden by rules.forbidden_tools)
block 0 forbidden.catalog.search pass: catalog.search not called (the block expects it 0 times)
block 0 must.0 pass: /Acme Telecom/ matched "Acme Telecom" at offset 12: "Hi, I'm the Acme Telecom sales assistant. I can help y..."
block 0 must.1 pass: /email address/ matched "email address" at offset 100: "...n with more data. What is the email address on your Acme account?"
block 0 must_not.0 pass: /Acme Fiber/ does not match; visible text "Hi, I'm the Acme Telecom sales assistant. I can help you mov..."
block 0 regex.0 pass: /^Hi/ matched "Hi" at offset 0: "Hi, I'm the Acme Telecom sales a..."
block 0 length.words pass: 27 words, within 0 to 60
block 0 starts_with.0 fail: the reply starts with "Hi, I'm the Acme Telecom sales assistant. I can help you move to a plan with more data. What is the email address on your Acme account?", expected it to start with "Hello"
block 0 refusal.verdict pass: no refusal phrase found; expected an answer
block 0 lang.stable pass: the reply stays in eng; the run speaks eng since block 0 ("Hi, I'm the Acme Telecom sales assistant...")
block 0 pii.iban pass: no IBAN in the visible text
block 0 pii.national_number pass: no national register number in the visible text
block 0 pii.phone pass: no phone number in the visible text
block 0 pii.email pass: no email address in the visible text
block 0 stage.reached pass: reached identify, expected identify (stages in this block: identify)
block 1 tools.catalog.search.count pass: catalog.search called 1 time, expected exactly 1
block 1 tools.catalog.search.input_closed pass: catalog.search only allowed input keys on 1 call; allowed keys: category, customer_email
block 1 tools.catalog.search.input.category pass: catalog.search input.category is equal to "mobile" on 1 call: "mobile"
block 1 tools.catalog.search.input.customer_email pass: catalog.search input.customer_email is matching /@example\.com$/ on 1 call: "sam.rivera@example.com"
block 1 tools.order pass: exact: expected exactly these calls, in this order, and no other: catalog.search (exactly 1); saw catalog.search
block 1 tools.argument_accuracy pass (not gating): 2 of 2 expected arguments matched
block 1 forbidden.order.create pass: order.create not called (forbidden by rules.forbidden_tools)
block 1 must.0 pass: /Acme Mobile M/ matched "Acme Mobile M" at offset 84: "... month. Plans with more data: Acme Mobile M, 40 GB for $25 a month; Acme ..."
block 1 must.1 pass: /\$35/ matched "$35" at offset 156: "... Mobile L, unlimited data for $35 a month. Which one would you ..."
block 1 tool_f1.f1 pass: precision 1.00 (1 of 1 calls), recall 1.00 (1 of 1 expected), F1 1.00, minimum 0.90
block 1 relevancy.terms fail: 0 of 3 key terms of the ask are in the reply; missing: it's, rivera, example; at least 50% expected
block 1 lang.stable pass: the reply stays in eng; the run speaks eng since block 0 ("Hi, I'm the Acme Telecom sales assistant...")
block 1 pii.iban pass: no IBAN in the visible text
block 1 pii.national_number pass: no national register number in the visible text
block 1 pii.phone pass: no phone number in the visible text
block 1 pii.email pass: no email address in the visible text
block 1 stage.reached pass: reached offer, expected offer (stages in this block: offer)
(exit 0)
```

The campaign id changes on every run. The `relevancy` fail shows the limit of a word count. An ask that is an email address has no topic words. So that block should not ask for `relevancy`. `tsx packages/cli/src/bin.ts` is the CLI run from source. It is the same program as `driftbench`, so its `--json` can be piped.

## Common errors

* `must.<i>` fails on a price: `$` is a regular expression anchor. Write `'\$35'`.
* `regex.<i>` fails where `must` passes: `regex` is case-sensitive, `must` ignores case unless `rules.match_case: true`.
* `starts_with.0` fails while `regex: ['^Hi']` passes on another line: `starts_with` reads the start of the whole reply, `^` the start of any line.
* `lang.expected` or `lang.stable` inconclusive (not gating): too little text, or a language franc-min has no model for.
* `pii.<kind>` fails on test data: use fictional values (`example.com` addresses, 555-0100 to 555-0199 numbers), or list the owner's own values with `replay --owner`.
* `pii.personal_data` gating inconclusive: `pii_judge: true` with no judge configured. Pass `--judge` on `replay` or `estate run`; `campaign run` has none.
* `json.valid` fails on prose around JSON: set `json.embedded: true`.
