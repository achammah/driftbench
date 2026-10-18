---
title: Check block links
summary: 'Write `metadata.links` from a block to the prompt sections it tests, and check them with `spec validate` and `spec lint --sections`; the links never change the spec hash.'
commands:
  - spec validate
  - spec lint
see_also:
  - authoring-prompt-sections
  - authoring-spec-check
  - authoring-spec-format
next:
  - authoring-prompt-sections
---

## What it is

A spec can say which parts of a prompt each block tests. It lists them in `metadata.links`. Each link names a block and a target: a prompt section, a clause of a written spec, or a past conversation turn. A prompt section is named by its prompt id and its section id in a section registry (topic authoring-prompt-sections).

Two commands check links:

* `spec validate` checks the shape of each link and the block it names.
* `spec lint --sections <registries...>` also checks each `prompt_section` link against the registry of its prompt.

Links stay out of the spec hash. Adding, changing or removing a link never changes a run id, a cache key, a carry or a rejudge.

## When to use it

* You write or generate specs for a prompt that has a section registry, and want each block to say what it tests.
* The prompt changed and you re-anchored its registry: lint the specs against the new registry to find the links that went stale.
* In CI: `spec lint --sections <registry> --strict` fails when a link names a section that is missing or stale.

## Commands and every option

```
driftbench spec validate [--json] <paths...>
driftbench spec lint [--json] [--strict] [--sections <registries...>] <paths...>
```

| Option | Commands | Default | Meaning |
|---|---|---|---|
| `<paths...>` (required) | both | none | spec files or folders |
| `--json` | both | off | print one JSON document |
| `--strict` | `spec lint` | off | treat warnings as failures: a warning exits 1 |
| `--sections <registries...>` | `spec lint` | off: links are checked for shape and block only | section registries, YAML or JSON. Each `prompt_section` link is checked against the registry of its prompt |

Exit codes:

| Exit | `spec validate` | `spec lint` |
|---|---|---|
| 0 | every spec is valid | every spec is valid; warnings are printed. With `--strict`, no warning either |
| 1 | a spec is invalid | a spec is invalid, or a warning under `--strict` |
| 2 | usage error | usage error, a `--sections` file that is not a valid registry, or two registries for one prompt |

## Inputs

A spec with `metadata.links`. One link:

```text
metadata:
  links:
    - block: ask-address          # the block id, or its index; absent: every block
      to: { kind: prompt_section, prompt: acme-sales, section: home_address_first }
      relation: verifies          # optional: verifies (default), exercises, derived_from, observed_in
      status: declared            # declared, attributed, verified, refuted or stale
      created_by: author          # optional: generator, author, attribution, citation, ir, mutation
      at_version: v1              # optional: the prompt version the link was made at
```

Other targets are `{ kind: spec_clause, spec, clause, sha256? }` and `{ kind: source_turn, conversation, turn, cluster?, redacted? }`. `spec lint --sections` checks only `prompt_section` links.

For `--sections`: the section registry of each prompt, such as `examples/acme/prompts/acme-sales.sections.yaml`.

## Outputs and how to read them

One line per spec: `✓ <path>  <id> · <n> blocks · hash <hash>`, or `✗ <path>` with one line per problem. Each problem line holds its path in the spec, its code and a sentence. Warnings print under a valid spec, starting with `!`. The last line counts the specs: `Checked <n> specs: <v> valid, <i> invalid, <w> warnings.`

| Code | Level | Command | Means |
|---|---|---|---|
| `LINK_BLOCK_UNKNOWN` | error | both | the link names a block id the spec does not have, or an index past its last block |
| `LINK_TARGET_UNKNOWN` | error | `spec lint --sections` | the registry of the prompt has no such section |
| `LINK_TARGET_UNKNOWN` | warning | `spec lint --sections` | no registry was given for the link's prompt |
| `LINK_STALE` | warning | `spec lint --sections` | the link's status is `stale`, or its section is stale in the registry's version |

## Worked example

A spec links its one block to two sections of the Acme prompt. The second file is the same spec without links. A setup step makes two copies with one mistake each: a section id with a typo, and a block id the spec does not have. A last setup step edits the language rule of the prompt and re-anchors the registry on it, so the section `language` goes stale. No model is called.

```yaml file=links/linked.yaml
# Fictional data only: Acme Telecom, Acmeville.
id: acme-linked-coverage
target: { adapter: function, agent: acme-sales }
stages: [address, offer, callback, handover, closing]
ledger_seed: { customer: new }
metadata:
  links:
    - block: ask-address
      to: { kind: prompt_section, prompt: acme-sales, section: home_address_first }
      status: declared
      created_by: author
      at_version: v1
    - block: ask-address
      to: { kind: prompt_section, prompt: acme-sales, section: language }
      relation: exercises
      status: declared
      created_by: author
      at_version: v1
blocks:
  - id: ask-address
    user: Hi, I want home internet at 7 Quarry Lane, Acmeville.
    expect:
      stage: offer
```

```yaml file=links/unlinked.yaml
# Fictional data only: Acme Telecom, Acmeville.
id: acme-linked-coverage
target: { adapter: function, agent: acme-sales }
stages: [address, offer, callback, handover, closing]
ledger_seed: { customer: new }
blocks:
  - id: ask-address
    user: Hi, I want home internet at 7 Quarry Lane, Acmeville.
    expect:
      stage: offer
```

```sh setup
sed 's/section: language }/section: languages }/' links/linked.yaml > links/typo.yaml
sed 's/block: ask-address/block: ask-price/' links/linked.yaml > links/badblock.yaml
sed 's/Always reply in English/Always reply in plain English/' examples/acme/prompts/acme-sales.md > acme-sales-v2.md
driftbench radius sections reanchor examples/acme/prompts/acme-sales.sections.yaml --prompt examples/acme/prompts/acme-sales.md acme-sales-v2.md --to-version v2 --out acme-sales-v2.sections.yaml # exit 1
```

```sh
driftbench spec validate links/linked.yaml links/unlinked.yaml
driftbench spec lint links/linked.yaml --sections examples/acme/prompts/acme-sales.sections.yaml
driftbench spec lint links/typo.yaml --sections examples/acme/prompts/acme-sales.sections.yaml # exit 1
driftbench spec validate links/badblock.yaml # exit 1
driftbench spec lint links/linked.yaml --sections acme-sales-v2.sections.yaml
driftbench spec lint links/linked.yaml --sections acme-sales-v2.sections.yaml --strict # exit 1
driftbench spec lint links/linked.yaml --sections acme-sales-v2.md # exit 2
```

The re-anchor exits 1 because one section is stale (topic authoring-prompt-sections). Then:

```text
$ driftbench spec validate links/linked.yaml links/unlinked.yaml
✓ links/linked.yaml  acme-linked-coverage · 1 block · hash 324a37a7d5c6
✓ links/unlinked.yaml  acme-linked-coverage · 1 block · hash 324a37a7d5c6
Checked 2 specs: 2 valid, 0 invalid, 0 warnings.
$ driftbench spec lint links/linked.yaml --sections examples/acme/prompts/acme-sales.sections.yaml
✓ links/linked.yaml  acme-linked-coverage · 1 block · hash 324a37a7d5c6
Checked 1 spec: 1 valid, 0 invalid, 0 warnings.
$ driftbench spec lint links/typo.yaml --sections examples/acme/prompts/acme-sales.sections.yaml
✗ links/typo.yaml
    metadata.links.1.to  LINK_TARGET_UNKNOWN  the prompt acme-sales (version v1) has no section languages
Checked 1 spec: 0 valid, 1 invalid, 0 warnings.
(exit 1)
$ driftbench spec validate links/badblock.yaml
✗ links/badblock.yaml
    metadata.links.0.block  LINK_BLOCK_UNKNOWN  the link names block "ask-price", which the spec does not have
    metadata.links.1.block  LINK_BLOCK_UNKNOWN  the link names block "ask-price", which the spec does not have
Checked 1 spec: 0 valid, 1 invalid, 0 warnings.
(exit 1)
$ driftbench spec lint links/linked.yaml --sections acme-sales-v2.sections.yaml
✓ links/linked.yaml  acme-linked-coverage · 1 block · hash 324a37a7d5c6
  ! metadata.links.1.to  LINK_STALE  the section acme-sales#language could not be found again in version v2: declare its span again
Checked 1 spec: 1 valid, 0 invalid, 1 warning.
```

How to read it:

* Both files have the hash `324a37a7d5c6`: the links stay out of the spec hash.
* `spec validate` finds the unknown block. Only `spec lint --sections` finds the unknown section.
* Against the v2 registry, the link to `language` is a warning, so `spec lint` exits 0. With `--strict` it exits 1.
* The last command passes the prompt itself as a registry: `The section registry is invalid.`, exit 2.

## Common errors

| Message | Exit | Cause and fix |
|---|---|---|
| `LINK_BLOCK_UNKNOWN  the link names block "<id>", which the spec does not have` | 1 | the link's `block` is not a block id of the spec. Fix the id, or give the block an `id` |
| `LINK_TARGET_UNKNOWN  the prompt <prompt> (version <v>) has no section <id>` | 1 | the section id is wrong, or the registry is of another prompt version. Fix the id, or lint against the right registry |
| `LINK_STALE ... could not be found again in version <v>: declare its span again` | 0, or 1 with `--strict` | the prompt changed and the section was not found again. Declare the section's span again in the registry, or update the link |
| `two section registries describe the prompt <prompt>` | 2 | two `--sections` files are of the same prompt, such as two versions. Give one registry per prompt |
| `The section registry is invalid.` | 2 | a `--sections` file is not a registry, such as the prompt file itself |
| A link to a misspelled section passes `spec validate` | 0 | expected: `spec validate` never reads a registry. Run `spec lint --sections` |
