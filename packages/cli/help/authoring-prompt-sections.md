---
title: Prompt sections and block links
summary: 'Stable ids for the sections of a prompt, found again in each new version. Links from blocks to the sections they test. Advisory selection. Ranking the sections behind failures.'
commands:
  - radius sections init
  - radius sections check
  - radius sections reanchor
  - radius localize
see_also:
  - authoring-blast-radius
  - authoring-spec-check
  - authoring-spec-format
  - results-radius
next:
  - authoring-blast-radius
---

## What it is

A system prompt is made of sections: a persona, a language rule, a refund rule, a closing rule. A **section registry** gives each section a stable id and records where it sits in one version of the prompt. It is a YAML file beside the prompt, by convention `prompts/<prompt-id>.sections.yaml`. The Acme example keeps one at `examples/acme/prompts/acme-sales.sections.yaml`, for the 30-section prompt `examples/acme/prompts/acme-sales.md`.

Each section has:

- an `id`, never reused for other text;
- a `scope`: `global` when the section can reach every block (persona, language, tone), `local` when it reaches only the blocks linked to it;
- a `span` and the `sha256` of its text;
- an `anchor`: a quote inside the section, unique in the prompt, with the text just before and after it;
- optional `references` (sections it refers to), `overrides` (sections it narrows or extends) and `duplicates` (sections that state the same rule).

Offsets are UTF-16 code units after NFC and CRLF or CR to LF, end exclusive: the same unit as the anchors of `radius auto`. A model never writes an offset: a link names a section by id.

A **block link** says what a block tests. Links live in the spec's `metadata.links`:

```yaml
metadata:
  links:
    - block: hello                 # a block id, or an index; absent: every block
      to: {kind: prompt_section, prompt: acme-sales, section: language}
      relation: verifies           # verifies | exercises | derived_from | observed_in
      status: declared             # declared | attributed | verified | refuted | stale
      created_by: author           # generator | author | attribution | citation | ir | mutation
      at_version: v1
```

A target is a `prompt_section`, a `spec_clause` (`spec`, `clause`, optional `sha256`) or a `source_turn` (`conversation`, `turn`, optional `cluster` and `redacted`). The status says how much the link is trusted:

- `declared`: an author or a generator wrote it;
- `verified`: a mutant of the section flipped the block;
- `refuted`: a mutant of the section did not flip it;
- `stale`: the section changed, or was not found again.

`metadata.links` and `metadata.provenance` stay out of the spec hash. A link added, promoted or refuted never changes the hash, a run id, a cache key, a carry or a rejudge. A spec without them hashes exactly as before.

**Re-anchoring** finds each section again in the next version of the prompt. In order: the same text found once (`same_hash`). Else the anchor quote found once, with the old text at the same distance from it (`quote`). Else the prefix, quote and suffix window found once, the same way (`window`). Else the section is `stale`. A section is only ever placed where its text hashes as before. An edit inside a section makes it stale. It is never anchored to the wrong text. Text that changed outside every section, whitespace aside, is reported, because it can reach any block.

**Advisory section selection.** `radius sections reanchor --change-out` writes a change manifest. It holds one `prompt_section` change (`<prompt-id>#<section-id>`) per stale or reordered section, and one global `prompt` change when text changed outside every section. `radius <specs> --change <manifest> --sections <registries>` then prints which blocks selection by section links would run:

- every block linked to a changed section by a link that is not `refuted`. A section that references, overrides or duplicates a changed one counts too, transitively;
- every block with no link to the changed prompt;
- every block with a stale link: a stale status, a section the registry lacks, or a stale section;
- every later block of the same conversation, the same spec;
- once parents exist, the blocks of every spec whose first block starts from a selected parent block (`given.parent: <spec>#<block>`);
- every block, when a changed section is `global`, is in no registry, or its prompt has no registry.

It is a report, never a filter. A `prompt_section` change makes the radius the whole suite, so `campaign run --change`, `ci --change` and block reruns run every block. The H7 mutation suite has 30 sections, 37 blocks and 9,690 runs. There, declared links alone missed a block a mutant flipped in 3 of 90 single-section mutants (Wilson 95% upper bound 9.3%). They missed one in 9 of 110 two-section mutants. The forward closure brings that to 2 of 90 and 4 of 110, at a selection ratio of 0.23. Selection may skip blocks only after links verified by mutation pass that gate below 5%, two-section mutants included.

**Localisation.** `radius localize` ranks the local sections of a prompt by how likely they are to cause the failures of a stored campaign. It uses Ochiai suspiciousness (Abreu et al. 2007). A prompt has no execution trace, so a block covers the sections it links to. For each section, `failed` sums the failure rate of the blocks linked to it over the suite runs. `passed` sums their pass rate. The score is `failed / sqrt(total failure weight x (failed + passed))`, 0 when nothing linked failed. A block's failure is dropped when an earlier block of its conversation failed in the same run. Across a parent edge, the parent block or its ancestors count as earlier. Such a failure is inherited, not evidence. A block that passes after a failing one stays a row, because it clears the sections it links to. Global sections are listed apart and never ranked: a section that reaches every block scores the same whatever it says. Ties print as a rank range.

On the H7 mutation suite this rule ranked the planted section worse than counting every block flat on 3 of 98 faults. It ranked it better on 5. Dropping every block after a failing one ranked worse on 18 of 98. There, a block that fails in every baseline run removed the passing blocks that cleared the innocent sections. Ranking each block against its own baseline verdict, and mutation to verify links, come with the mutation runner.

**Anthropic Citations** count `start_char_index` and `end_char_index` in code points, not UTF-16 units. On a text with two emoji before the cited sentence, the API gave 23 where UTF-16 gives 25. Any citation pointer is converted before it is compared with a span (`codePointToUtf16`, `citationSpan` and `sectionOfCitation` in `@agent-nexus/driftbench-core`). A prompt sent as a custom-content document with one block per section (`sectionDocument`) needs no offset: the citation's block index names the section.

## When to use it

- Before linking blocks to prompt sections: write the registry once per prompt, then keep it with each new prompt version.
- After editing the prompt: re-anchor, to learn which sections changed and which links went stale.
- In CI: `radius sections check` fails when the registry no longer describes the prompt, and `spec lint --sections` fails when a link names a section that does not exist.

## Commands and every option

### driftbench radius sections init

```
driftbench radius sections init <prompt> --id <prompt-id> --prompt-version <version> [--level <n>] [--out <file>]
```

Writes a first registry: one section per markdown heading of level 1 to `--level`, from the heading to the next one. Trailing whitespace is left out. Text before the first heading is the section `preamble`. Ids are the slugged titles, with `_2`, `_3` for repeats. Every section starts `global`, the safe reading. Mark local the sections that reach only the blocks linked to them, and add `references`, `overrides` and `duplicates` by hand.

| Option | Meaning | Default |
|---|---|---|
| `<prompt>` (required) | The prompt file. | none |
| `--id <prompt-id>` (required) | The prompt id links name as `to.prompt`. | none |
| `--prompt-version <version>` (required) | The version of the prompt the registry describes. | none |
| `--level <n>` | The deepest heading level that starts a section, 1 to 6. | `2` |
| `--out <file>` | Write the registry here. | print the YAML |

Exit 0 when written. Exit 2 when the prompt cannot be read, `--level` is not 1 to 6, or a section has no quote unique in the prompt.

### driftbench radius sections check

```
driftbench radius sections check <registry> --prompt <file> [--json]
```

Checks that the registry describes the prompt. It checks the whole-text hash, each section's span and hash, each anchor found once and inside its section, no two sections overlapping. Stale sections are listed, not checked.

| Option | Meaning | Default |
|---|---|---|
| `<registry>` (required) | The registry, YAML or JSON. | none |
| `--prompt <file>` (required) | The prompt file. | none |
| `--json` | Print `{prompt, version, problems, stale}`. | off |

Exit 0 when the registry matches, 1 when it does not. Exit 2 when a file cannot be read or the registry is invalid. Invalid means a schema error, an id used twice, or a reference to an unknown section.

### driftbench radius sections reanchor

```
driftbench radius sections reanchor <registry> --prompt <old> <new> --to-version <version> [--out <file>] [--json]
```

Re-anchors the registry of the old prompt on the new one, by the rule in What it is.

| Option | Meaning | Default |
|---|---|---|
| `<registry>` (required) | The registry of the old prompt. Its `text_sha256` must match the old prompt. | none |
| `--prompt <old> <new>` (required) | The old and new prompt files, in that order. | none |
| `--to-version <version>` (required) | The version of the new prompt, written into the new registry. | none |
| `--out <file>` | Write the registry of the new prompt here: found sections at their new spans, stale sections kept with `stale: true` and their old span. | not written |
| `--change-out <file>` | Write the change manifest of the edit, from the registry's version to `--to-version`. It holds a `prompt_section` change per stale or reordered section, and a global `prompt` change per change outside every section. Give it to `radius --sections`. | not written |
| `--json` | Print `{sections, outside, reordered}`. | off |

Exit 0 when every section was found again in order and nothing changed outside them. Exit 1 when a section is stale, a change lies outside every section, or sections changed order. Exit 2 on bad input, or when the registry does not describe the old prompt.

### driftbench radius localize

```
driftbench radius localize <paths...> --store <file> --campaign <id> --sections <registries...> [--prompt <prompt-id>] [--mode <mode>] [--counting <rule>] [--top <n>] [--json]
```

Reads the campaign's runs and the specs' links, and prints the local sections of one prompt, most suspicious first.

| Option | Meaning | Default |
|---|---|---|
| `<paths...>` (required) | The spec files or folders the campaign ran. A run of a spec not given, or of another version of it (another spec hash), is skipped and named. | none |
| `--store <file>` (required) | The store that holds the campaign. | none |
| `--campaign <id>` (required) | The campaign to read. | none |
| `--sections <registries...>` (required) | Section registries. | none |
| `--prompt <prompt-id>` | The prompt to rank, when several registries are given. | the only registry |
| `--mode <mode>` | The run mode to read: `T`, `F` or `P`. In `T` a block starts from its canonical Given and inherits nothing; in `F` and `P` it inherits the earlier blocks of its conversation. | the only mode of the campaign |
| `--counting <rule>` | `grouped`: drop inherited failures only. `flat`: count every block, for comparison. | `grouped` |
| `--top <n>` | How many sections to print; `0` prints all. | `10` |
| `--json` | Print `{prompt, version, mode, localization, suiteRuns, skipped}`. | off |

The runs are pooled into suite runs, one per target, mode, repeat and perturbation. An injected block and a block with no pass or fail verdict are not rows. Exit 0 when a ranking is printed. Exit 1 when nothing failed outside inherited failures (every score 0). Exit 2 on bad input: no `--sections`, an unknown campaign or store, several modes without `--mode`, several registries without `--prompt`.

## Inputs

- A prompt file, read as UTF-8 and normalised (NFC, CRLF or CR to LF).
- A section registry:

```yaml
prompt_id: acme-sales
version: v1
normalisation: NFC; CRLF/CR->LF; offsets in UTF-16 code units; end exclusive   # optional, for the reader
text_sha256: cd17d54f...       # SHA-256 of the whole normalised prompt, 64 hex
sections:
  - id: explicit_confirm
    title: Confirmation        # optional
    kind: rule                 # optional: rule, persona, format, tool_guide, example, context
    scope: local               # local or global
    span: {start: 5332, end: 5604}
    sha256: 9b1f...            # SHA-256 of the section text, 64 hex
    anchor: {quote: "Place an order only after", prefix: "...", suffix: "..."}
    references: [recap]        # optional
    overrides: []              # optional
    duplicates: []             # optional
    stale: true                # optional, written by reanchor
```

- Specs with `metadata.links`, checked by `spec validate` (shape, and the block they name) and by `spec lint --sections` (the target section).

## Outputs and how to read them

`radius localize` prints a header: the prompt, the mode, the number of suite runs and the counting. Then it prints the block rows counted, the total failure weight and the inherited failures dropped. Then a table: `rank` (a range on ties), `section`, `ochiai`, `failed`, `passed`, and `blocks` (the linked blocks that were rows). Then it prints the failing roots (blocks that failed as a row; with `--counting flat`, every failing block). It also prints the global sections left out, and every skipped run with its reason. JSON: `localization.sections[]` holds `section`, `score`, `failed`, `passed`, `linked`, `best`, `worst`; `localization` also holds `global`, `failureWeight`, `rows`, `inherited`, `roots`, `counting`.

`radius --sections` adds, after the radius, `Advisory section selection (<changes>)`, the sections the closure adds, and `Would run <n> of <m> blocks (<d> by links, <f> forward) and would skip <k>`. It then adds one row per spec with a selected block: its count, its first selected block and the links that drove it. Links read `link:<prompt>#<section> (<status>)`, `no-links:<prompt>` or `stale-link:<prompt>#<section>`. A forward block reads `after <block>` or `via <spec>#<block>`. `Every block would run: <reason>` when a change is global or unknown. See authoring-blast-radius for `--explain` and `--json`.

`radius sections init` prints the registry as YAML, or writes it, and says how many sections it found on stderr.

`radius sections check` prints `<prompt> <version>: <n> sections match the prompt.`, with `; <k> stale: <ids>` when some are stale, or one line per problem.

`radius sections reanchor` prints `<prompt> <old version> to <new version>: <k> kept, <m> moved, <s> stale.` Then it prints one line per stale section with its reason, and the sections that changed order. It prints one line per change outside every section: `changed outside every section, between <a> and <b>: can reach any block`. A stale reason is either `the anchor is found but the section text changed: edited inside` or `neither the text nor the anchor is found once: edited or removed`.

## Worked example

Write a registry from the headings of the Acme prompt, and check the registry the example keeps. Then re-anchor it on a version where one rule changed:

```sh
driftbench radius sections init examples/acme/prompts/acme-sales.md --id acme-sales --prompt-version v1 --out acme-sales.sections.yaml
driftbench radius sections check examples/acme/prompts/acme-sales.sections.yaml --prompt examples/acme/prompts/acme-sales.md
```

```text
30 sections, all global. Mark local the sections that reach only the blocks linked to them, and add references and overrides.
acme-sales v1: 30 sections match the prompt.
```

```sh setup
sed 's/Always reply in English/Always reply in plain English/' examples/acme/prompts/acme-sales.md > acme-sales-v2.md
```

```sh
driftbench radius sections reanchor examples/acme/prompts/acme-sales.sections.yaml --prompt examples/acme/prompts/acme-sales.md acme-sales-v2.md --to-version v2 --out acme-sales-v2.sections.yaml # exit 1
driftbench radius sections check acme-sales-v2.sections.yaml --prompt acme-sales-v2.md
```

```text
acme-sales v1 to v2: 1 kept, 28 moved, 1 stale.
  stale language: neither the text nor the anchor is found once: edited or removed
Every link to a stale section reads as stale until its span is declared again.
acme-sales v2: 30 sections match the prompt; 1 stale: language.
```

The language rule was edited, so `language` is stale and every block linked to it reads its link as stale. The other sections moved by the six added characters and kept their ids.

Now loosen the confirmation rule and write the change manifest. Then ask what selection by section links would run on the three linked Acme specs of `examples/acme/prompts/linked`:

```sh setup
sed 's/A loose yes such as "sure", "ok" or "go ahead" is not enough/A loose yes such as "sure" or "ok" is enough/' examples/acme/prompts/acme-sales.md > acme-sales-v3.md
```

```sh
driftbench radius sections reanchor examples/acme/prompts/acme-sales.sections.yaml --prompt examples/acme/prompts/acme-sales.md acme-sales-v3.md --to-version v3 --change-out confirm.yaml # exit 1
driftbench spec lint examples/acme/prompts/linked --sections examples/acme/prompts/acme-sales.sections.yaml
driftbench radius examples/acme/prompts/linked --change confirm.yaml --sections examples/acme/prompts/acme-sales.sections.yaml # exit 1
```

```text
acme-sales v1 to v3: 23 kept, 6 moved, 1 stale.
  stale explicit_confirm: the anchor is found but the section text changed: edited inside
Every link to a stale section reads as stale until its span is declared again.
✓ examples/acme/prompts/linked/order-confirm.yaml  acme-linked-order-confirm · 4 blocks · hash de277b6a3f34
✓ examples/acme/prompts/linked/porting.yaml  acme-linked-porting · 2 blocks · hash f16b77f69d2e
✓ examples/acme/prompts/linked/store-hours.yaml  acme-linked-store-hours · 1 block · hash b716ddfaac6a
Checked 3 specs: 3 valid, 0 invalid, 0 warnings.
Blast radius of v1 to v3 (manifest 41cd2968d159): prompt_section:acme-sales#explicit_confirm.
3 specs, 7 blocks.
The radius is the whole suite: prompt_section:acme-sales#explicit_confirm: section selection is advisory until links are verified by mutation: the whole suite runs. Nothing can be carried.
Advisory section selection (acme-sales#explicit_confirm): nothing is skipped, the whole suite runs until links are verified by mutation.
  With references, overrides and duplicates: acme-sales#upgrade_order, acme-sales#order_failure.
  Would run 3 of 7 blocks (2 by links, 1 forward) and would skip 4: 57.1% of the suite.
  spec                       blocks  from       links that drove it
  acme-linked-order-confirm  3 of 4  loose-yes  link:acme-sales#explicit_confirm (declared)
```

Run the three linked specs on the Acme agent, twice, and rank the sections. The order and porting specs start mid-conversation, so the agent fails their first block, and the later blocks of the order spec fail after it:

```sh
driftbench campaign run examples/acme/prompts/linked --store acme.db --campaign linked --repeats 2 # exit 1
driftbench radius localize examples/acme/prompts/linked --store acme.db --campaign linked --sections examples/acme/prompts/acme-sales.sections.yaml --top 4
driftbench radius localize examples/acme/prompts/linked --store acme.db --campaign linked --sections examples/acme/prompts/acme-sales.sections.yaml --counting flat --top 4
```

```text
Campaign linked: 6 cells, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, regex, exact, injection, length, markup, starts_with, finish_reason, json, tool_f1, refusal, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
✗ acme-linked-order-confirm · function:acme-sales · F · repeat 0  fail  block 0 must.0, block 1 must.0, block 2 tools.order.create.count, block 3 must_not.0
✗ acme-linked-order-confirm · function:acme-sales · F · repeat 1  fail  block 0 must.0, block 1 must.0, block 2 tools.order.create.count, block 3 must_not.0
✗ acme-linked-porting · function:acme-sales · F · repeat 0  fail  block 0 tools.port.check.count
✗ acme-linked-porting · function:acme-sales · F · repeat 1  fail  block 0 tools.port.check.count
✓ acme-linked-store-hours · function:acme-sales · F · repeat 0  pass  1 block
✓ acme-linked-store-hours · function:acme-sales · F · repeat 1  pass  1 block
6 cells: 2 pass, 4 fail, 0 failed. Spent $0.00.
Sections of acme-sales v1 by Ochiai suspiciousness, mode F, 2 suite runs, grouped counting.
  8 block rows, failure weight 2.000, 6 inherited failures dropped (a passing block after a failing one stays a row).
  rank  section               ochiai  failed  passed  blocks
  1-3   porting_check_first   0.707   1.000   0.000   1
  1-3   new_customer_details  0.707   1.000   0.000   1
  1-3   recap                 0.707   1.000   0.000   1
  4-26  scope                 0.000   0.000   0.000   0
  22 more; --top 0 prints all.
  Failing roots: acme-linked-order-confirm#details, acme-linked-porting#keep-number.
  Not ranked, global: identity, language, style, facts_from_tools. A global section reaches every block; only mutation can blame it.
Sections of acme-sales v1 by Ochiai suspiciousness, mode F, 2 suite runs, flat counting.
  14 block rows, failure weight 5.000, 0 inherited failures dropped 
  rank  section               ochiai  failed  passed  blocks
  1     explicit_confirm      0.632   2.000   0.000   2
  2-5   porting_check_first   0.447   1.000   0.000   1
  2-5   new_customer_details  0.447   1.000   0.000   1
  2-5   recap                 0.447   1.000   0.000   1
  22 more; --top 0 prints all.
  Failing blocks: acme-linked-order-confirm#details, acme-linked-order-confirm#loose-yes, acme-linked-order-confirm#confirm, acme-linked-order-confirm#thanks, acme-linked-porting#keep-number.
  Not ranked, global: identity, language, style, facts_from_tools. A global section reaches every block; only mutation can blame it.
```

Counted per root, the sections of the two first failures tie at the top. `explicit_confirm` is not suspected: its blocks failed only after `details` failed. Counted flat, the inherited failures put `explicit_confirm` first.

`upgrade_order` and `order_failure` refer to the confirmation rule, so blocks linked to them would run too. `details` of the order spec is linked to `recap` and `new_customer_details` only. It comes before the changed block, so selection would skip it. `confirm` is linked to the changed section. `thanks` follows a selected block. The radius stays the whole suite.

## Common errors

- `text_sha256: the registry does not describe this prompt text`: the prompt changed since the registry was written. Re-anchor from the version the registry describes.
- `the registry does not describe the old prompt text (text_sha256 differs)` from `reanchor`: the first `--prompt` file is not the version of the registry.
- `<id>: no quote inside the section is unique in the prompt` from `init`: two sections hold the same text. Make one differ, or write that entry by hand.
- A section that stays stale after every re-anchoring: declare its span again (`span`, `sha256`, `anchor`) and remove `stale`.
- `radius localize needs --sections <registries...>`: give the registry of the prompt to rank.
- `The campaign holds runs in modes F, T: name one with --mode`: localisation reads one mode at a time.
- Every score is 0 and the exit is 1: nothing failed, or every failure was inherited.
- `LINK_BLOCK_UNKNOWN` from `spec validate`: a link names a block id the spec does not have.
