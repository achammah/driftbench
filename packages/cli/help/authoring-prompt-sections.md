---
title: Prompt sections and block links
summary: 'Give the sections of a prompt stable ids in a section registry, find them again in the next prompt version, and link blocks to the sections they test, without changing any spec hash.'
commands:
  - radius sections init
  - radius sections check
  - radius sections reanchor
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

A target is a `prompt_section`, a `spec_clause` (`spec`, `clause`, optional `sha256`) or a `source_turn` (`conversation`, `turn`, optional `cluster` and `redacted`). The status says how much the link is trusted: `declared` is what an author or a generator wrote, `verified` means a mutant of the section flipped the block, `refuted` means it did not, `stale` means the section changed or was not found again.

`metadata.links` and `metadata.provenance` stay out of the spec hash. A link added, promoted or refuted never changes the hash, a run id, a cache key, a carry or a rejudge. A spec without them hashes exactly as before.

**Re-anchoring** finds each section again in the next version of the prompt. In order: the same text found once (`same_hash`); else the anchor quote found once, with the old text at the same distance from it (`quote`); else the prefix, quote and suffix window found once, the same way (`window`); else the section is `stale`. A section is only ever placed where its text hashes as before, so an edit inside a section makes it stale: it is never anchored to the wrong text. Text that changed outside every section, whitespace aside, is reported, because it can reach any block.

**Anthropic Citations** count `start_char_index` and `end_char_index` in code points, not UTF-16 units: on a text with two emoji before the cited sentence the API gave 23 where UTF-16 gives 25. Any citation pointer is converted before it is compared with a span (`codePointToUtf16`, `citationSpan` and `sectionOfCitation` in `@agent-nexus/driftbench-core`). A prompt sent as a custom-content document with one block per section (`sectionDocument`) needs no offset: the citation's block index names the section.

## When to use it

- Before linking blocks to prompt sections: write the registry once per prompt, then keep it with each new prompt version.
- After editing the prompt: re-anchor, to learn which sections changed and which links went stale.
- In CI: `radius sections check` fails when the registry no longer describes the prompt, and `spec lint --sections` fails when a link names a section that does not exist.

## Commands and every option

### driftbench radius sections init

```
driftbench radius sections init <prompt> --id <prompt-id> --prompt-version <version> [--level <n>] [--out <file>]
```

Writes a first registry: one section per markdown heading of level 1 to `--level`, from the heading to the next one, trailing whitespace left out; text before the first heading is the section `preamble`. Ids are the slugged titles, with `_2`, `_3` for repeats. Every section starts `global`, the safe reading; mark local the sections that reach only the blocks linked to them, and add `references`, `overrides` and `duplicates` by hand.

| Option | Meaning | Default |
|---|---|---|
| `<prompt>` (required) | The prompt file. | none |
| `--id <prompt-id>` (required) | The prompt id links name as `to.prompt`. | none |
| `--prompt-version <version>` (required) | The version of the prompt the registry describes. | none |
| `--level <n>` | The deepest heading level that starts a section, 1 to 6. | `2` |
| `--out <file>` | Write the registry here. | print the YAML |

Exit 0 when written; 2 when the prompt cannot be read, `--level` is not 1 to 6, or a section has no quote unique in the prompt.

### driftbench radius sections check

```
driftbench radius sections check <registry> --prompt <file> [--json]
```

Checks that the registry describes the prompt: the whole-text hash, each section's span and hash, each anchor found once and inside its section, no two sections overlapping. Stale sections are listed, not checked.

| Option | Meaning | Default |
|---|---|---|
| `<registry>` (required) | The registry, YAML or JSON. | none |
| `--prompt <file>` (required) | The prompt file. | none |
| `--json` | Print `{prompt, version, problems, stale}`. | off |

Exit 0 when the registry matches, 1 when it does not, 2 when a file cannot be read or the registry is invalid (a schema error, an id used twice, a reference to an unknown section).

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
| `--json` | Print `{sections, outside, reordered}`. | off |

Exit 0 when every section was found again in order and nothing changed outside them; 1 when a section is stale, a change lies outside every section, or sections changed order; 2 on bad input, or when the registry does not describe the old prompt.

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

`radius sections init` prints the registry as YAML, or writes it, and says how many sections it found on stderr.

`radius sections check` prints `<prompt> <version>: <n> sections match the prompt.`, with `; <k> stale: <ids>` when some are stale, or one line per problem.

`radius sections reanchor` prints `<prompt> <old version> to <new version>: <k> kept, <m> moved, <s> stale.`, then one line per stale section with its reason, one line per change outside every section (`changed outside every section, between <a> and <b>: can reach any block`) and the sections that changed order. A stale reason is either `the anchor is found but the section text changed: edited inside` or `neither the text nor the anchor is found once: edited or removed`.

## Worked example

Write a registry from the headings of the Acme prompt, check the registry the example keeps, then re-anchor it on a version where one rule changed:

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

## Common errors

- `text_sha256: the registry does not describe this prompt text`: the prompt changed since the registry was written. Re-anchor from the version the registry describes.
- `the registry does not describe the old prompt text (text_sha256 differs)` from `reanchor`: the first `--prompt` file is not the version of the registry.
- `<id>: no quote inside the section is unique in the prompt` from `init`: two sections hold the same text. Make one differ, or write that entry by hand.
- A section that stays stale after every re-anchoring: declare its span again (`span`, `sha256`, `anchor`) and remove `stale`.
- `LINK_BLOCK_UNKNOWN` from `spec validate`: a link names a block id the spec does not have.
