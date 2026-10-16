---
title: Evidence names
summary: "Named facts about one failing verdict, such as where a value came from and what the agent did next, read by blame and placement rules."
commands: []
see_also:
  - authoring-blocks
  - judging-machine-checks
  - recipes-find-why-a-test-failed
---

## What it is

A failing verdict says that a block failed. Evidence says what surrounded the failure. Each piece of evidence is a
name with a value, such as `source: user` or `next_action: asked_user`.

driftbench ships 46 evidence names. Each name has one provider: a function that computes the value from records
that already exist. Those records are the stored run of the block, the estate map, the value check's record, and
the record of any confirm run. A provider never calls a model and never runs the agent.

Each name has a cost class:

| Cost class | Where the value comes from |
|---|---|
| `static` | the stored run and the estate map only |
| `judge` | a stored answer of a judge, replayed; `task_flagged` is the only one |
| `run` | a confirm run that already stored its counts; nothing here starts that run |

A name whose value cannot be known from the records is left out. A rule condition on a missing name never holds.
This keeps a rule from firing on a guess.

Evidence changes no verdict, no spec hash, no cache key and no recorded result. It has no spec key and no
command. It is a library of the core package: `evidence.computeEvidence` in `@agent-nexus/driftbench-core`.
The blame and placement rule files read these names in their `when` conditions.

## When to use it

* To see what driftbench knows about one failing verdict before you read any blame or placement rule.
* To write the `when` condition of your own blame or placement item: a condition names evidence, never raw records.
* To check a plugin's own evidence name against the shipped ones.

Do not use it:

* As a pass or fail. Evidence describes a failure; the machine verdict stays final.
* On a passing verdict. The providers read the failing step and what came after it.
* To start a confirm run. The `run` names are read only once a confirm run has stored them.

## Commands and every option

There is no command. Call the library from a script. Every call below is in the `evidence` namespace:
`import { evidence } from '@agent-nexus/driftbench-core'`.

| Call | What it does | Defaults |
|---|---|---|
| `computeEvidence(input, names?, registry?)` | Returns a map of name to value for one failing verdict. A name with no known value is left out | `names`: every registered name. `registry`: `evidenceRegistry` |
| `new EvidenceRegistry(providers?)` | A registry of providers. A name registered twice is refused | `providers`: `EVIDENCE_PROVIDERS`, the 46 shipped ones |
| `registry.register(provider)` | Adds one provider: `{ name, cost, values, from, compute }`. Returns the registry | none |
| `registry.get(name)`, `registry.names()`, `registry.providers()` | Reads one provider, every name, every provider, in order | none |
| `evidenceRegistry` | The registry every blame and placement step reads unless given another | the shipped providers |
| `EVIDENCE_PROVIDERS` | The shipped providers, in their order: static names first, then `task_flagged`, then the `run` names | none |
| `homeOf(input)` | The home of a failure for recurrence: the block's first routed skill, else the rule's skill, else `none` | none |
| `verdictSubject(id)` | What a verdict id is about: `tool`, `field` and `part` (`count`, `input` or `order`) | none |
| `subjectTool(input)` | The tool the failing verdict is about: the value record first, then the verdict id | none |
| `skillOfPath(path)` | The skill a path sits in: `.claude/skills/<name>/...` or `skills/<name>/...` | none |
| `skillLoaded(input, name)` | Whether a skill loaded in the block: the runtime skill list, a `Skill` call, or a `Read` of its `SKILL.md` | none |
| `readAmount(input, path)` | How much of a file the agent read: `none`, `partial` or `full` | none |
| `homeOfAtom(atom)` | Where an estate atom's rule lives, from its kind and file | none |

A provider's `compute` receives the same input as `computeEvidence` and returns a value or `undefined`.

## Inputs

`computeEvidence` reads one `EvidenceInput`. Only `block` and `verdict` are required.

| Field | What it holds |
|---|---|
| `block` | the block result: `observed` (reply `text`, `toolCalls` with `label`, `input`, `output`, `error`, and the runtime trace) and `verdicts` |
| `verdict` | the failing verdict the evidence is about, such as `tools.coverage.check.input.address` |
| `user` | the user turn the agent received |
| `expect` | block expectations: `skills` (routed skills), `tools` (expected order), `protected` (paths), `taskImpossible`, `downstream`, `situation` |
| `values` | the value check's record per value: `tool`, `field`, `value`, `gold`, `rung`, `settles`, `outcome`, `source`, `change`, `contract`, `contractBroken`, `changedInputsFail`, `demanded` |
| `ruleAtoms`, `atoms`, `edges` | the estate atoms the failing check enforces, and the estate map's atoms and edges |
| `links` | for a block with no estate atoms: the line a failing check enforces, `{ verdict, home, act, file, line, skill }`. A `verdict` ending in `*` matches by prefix |
| `stated` | rules stated about a tool field: `format`, `asks`, `toolNeeds`, `recovery`, `where` |
| `toolSchemas` | tool input schemas by tool label; an `enum` or a `pattern` is a contract the tool states |
| `promises` | what a tool's usage text promises: `prints`, or output that `matches` a pattern |
| `reply` | a stored reading of the reply: `next_action`, `asked_for`, `task_flagged` |
| `decisions` | the guard decision log, lines of `{ at, event, check, verdict }` |
| `testsFailReverted`, `confirm`, `history`, `planRows` | a stored re-execution, stored confirm counts, earlier diagnoses, plan rows |
| `maxRetries`, `bar`, `minRunsPerHome` | the retry streak that counts as a loop (default 3), confirm passes that count (default 2), runs per home (default 1) |

A minimal input: the Acme coverage tool failed on an address the user typed, and the agent asked again.

```text
verdict: { id: tools.coverage.check.input.address, kind: machine, name: tools, gating: true, outcome: fail }
user: Can I get fiber at 7 Quarry Ln, Acmeville?
block.observed.toolCalls: [ { label: coverage.check, input: { address: 7 Quarry Ln, Acmeville }, error: address not found } ]
block.observed.text: I could not find that address. What is the full street name?
values: [ { tool: coverage.check, field: address, value: 7 Quarry Ln, Acmeville, outcome: failed } ]
```

## Outputs and how to read them

`computeEvidence` returns a plain object. Each key is an evidence name; each value is a word, a number, a boolean
or a list. The names, grouped by what they describe:

| Group | Names and their values |
|---|---|
| The value | `source` (user, agent_derived, prompt, tool_output, skill_file, workspace_file). `change` (verbatim, case_only, unit_converted, reformatted, altered). `contract` (tool, prompt, none, downstream, instruction, skill, error_seen). `contract_broken`. `outcome` (accepted_as_gold, failed, resolved_differently). `declared_format`. `downstream_need` (declared, none). `changed_inputs_fail`. `tool_output_wrong`. `stricter_rule_obeyed` |
| What happened next | `next_action` (asked_user, retried_canonical, gave_up, wrong_fact, continued, looped, recovered) |
| The verdict | `verdict_check` (the check name). `verdict_kind` (machine, judge). `first_violation` (the id of the earliest failing gating verdict of the block, by the place of its act in the trace) |
| The rule | `rule_atom`; `rule_home` (core, skill_body, skill_reference, skill_script, helper, guard, tool_schema, instruction, none); `rule_skill`; `rule_act`; `act_signature`; `rule_situational`; `rule_mechanical`; `rule_needed_by` (a number) |
| Skills and references | `routed_skills`; `skill_loaded`; `skill_covers` (covered, not_covered, unknown); `rule_skill_routed` and `rule_in_context` (both derived from the other names);  `ref_exists`; `ref_forced`; `ref_depth` (a number); `ref_read` (none, partial, full) |
| The trace | `guard_caught`; `tool_failed`; `tool_silent`; `env_error` (network, sandbox, package, timeout, none); `protected_changed`; `tests_fail_reverted`; `claim_contradicted`; `task_impossible`; `task_flagged` (judge class) |
| Recurrence | `recurrence_homes`, `recurrence_class_homes` (numbers, known only once a blame item is attributed) |
| Confirm runs | `reference_pass`, `reference_loads`, `forced_load_pass`, `hint_pass` (run class: passes out of the confirm runs) |

How to read the names that decide most failures:

* `source` and `change` together say whether the agent copied a value or changed it. `source: user` with
  `change: verbatim` means the agent sent exactly what the user typed.
* `contract: none` means nothing the agent could see stated the format. A tool schema `enum` or `pattern`, a
  stated rule, or an error the agent read before its next call would each name a contract.
* `next_action` reads what came after the failing step. A retry of the same tool is `retried_canonical`. A
  question mark in the reply is `asked_user`. More calls are `continued`. An empty reply is `gave_up`.
* `skill_covers` reads the block's plan row first: `route_positive` is covered, `route_near_miss` is not covered.
* `tool_failed` is true when the call returned an error or its recorded run exited nonzero. A failed read reads nothing.
* A name missing from the output is unknown, not false.

`docs/reference/blame.md` lists every name with what it is computed from, generated from the code.

## Worked example

No command computes evidence in this release, so the example has two parts. First, the Acme spec whose `coverage.check` call the failing block imitates runs and passes on the Acme agent:

```sh
driftbench campaign run examples/acme/specs/conversations/new-customer-coverage.yaml --no-cache
```

```text
$ driftbench campaign run examples/acme/specs/conversations/new-customer-coverage.yaml --no-cache
Campaign c-3febe6cb743f: 1 cell, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, regex, exact, injection, length, markup, starts_with, finish_reason, json, tool_f1, refusal, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
Not judged: 2 criteria in 2 blocks of 1 spec (one_question_per_turn, coverage_before_offer), 1 of them gating. This campaign loads no judge, so these criteria have no verdict and count in no pass or fail. See docs/concepts/judges.md.
✓ acme-new-customer-coverage · function:acme-sales · F · repeat 0  pass  4 blocks
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
The runs are not kept: pass --store <file> to keep them.
(exit 0)
```

Then a script builds a failing block of that spec by hand, computes its evidence, and shows the two refusals. It runs the
package from source with `tsx`; this file tells `tsx` where the packages are:

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

```ts file=evidence.mts
import { evidence } from '@agent-nexus/driftbench-core';

// A failing Acme block, built by hand: the coverage tool failed on the address the user typed.
const verdict = {
  id: 'tools.coverage.check.input.address',
  kind: 'machine' as const,
  name: 'tools',
  gating: true,
  outcome: 'fail' as const,
  evidence: 'coverage.check returned an error for the address',
};
const input = {
  verdict,
  user: 'Can I get fiber at 7 Quarry Ln, Acmeville?',
  block: {
    verdicts: [verdict],
    observed: {
      segments: [],
      text: 'I could not find that address. What is the full street name?',
      toolCalls: [
        { label: 'coverage.check', input: { address: '7 Quarry Ln, Acmeville' }, error: 'address not found' },
      ],
      cost: { usd: 0, inputTokens: 0, outputTokens: 0 },
      latencyMs: 0,
    },
  },
  values: [{ tool: 'coverage.check', field: 'address', value: '7 Quarry Ln, Acmeville', outcome: 'failed' as const }],
};

const all = evidence.computeEvidence(input);
for (const name of ['source', 'change', 'contract', 'outcome', 'tool_failed', 'next_action', 'rule_home']) {
  console.log(`${name}: ${JSON.stringify(all[name])}`);
}
console.log(`names known: ${Object.keys(all).length} of ${evidence.evidenceRegistry.names().length}`);
console.log(`home: ${evidence.homeOf(input)}`);

// The same block, but the agent answered without asking: the next action changes.
const told = { ...input, block: { ...input.block, observed: { ...input.block.observed, text: 'Fiber is not available there.' } } };
console.log(`next_action when the agent did not ask: ${evidence.computeEvidence(told, ['next_action']).next_action}`);

// Refusals: an unknown name, and a name registered twice.
try {
  evidence.computeEvidence(input, ['sauce']);
} catch (error) {
  console.log((error as Error).message.split(';')[0]);
}
try {
  new evidence.EvidenceRegistry().register({ name: 'source', cost: 'static', values: [], from: 'a test', compute: () => undefined });
} catch (error) {
  console.log((error as Error).message);
}
```

```sh setup
tsx evidence.mts
```

```text
$ tsx evidence.mts
source: "user"
change: "verbatim"
contract: "none"
outcome: "failed"
tool_failed: true
next_action: "asked_user"
rule_home: "none"
names known: 25 of 46
home: none
next_action when the agent did not ask: continued
unknown evidence name sauce
the evidence name source is already registered
(exit 0)
```

Read it as follows. `source: "user"` with `change: "verbatim"` says the agent copied the user's address exactly.
`contract: "none"` says nothing stated the format the tool wanted. `tool_failed: true` and `next_action:
"asked_user"` say the tool refused the value and the agent asked the user again. Without the question mark the
next action reads `continued`. `names known: 25 of 46`: 25 names hold a value for this block; the others need inputs it does not carry, such as files or a decision log. A blame rule turns these facts into who is at fault.

## Common errors

* `unknown evidence name <name>; known names: <every name>`: `computeEvidence` was asked for a name no provider
  has. Check the spelling against the table above, or register the plugin provider first.
* `the evidence name <name> is already registered`: a provider reuses a shipped name, or registers twice. Give it
  another name; a shipped provider is never replaced.
* A name is missing from the output: its value is unknown from the records given. Add the record it reads, such as
  `values` for `outcome`, `links` or `atoms` for `rule_home`, or `decisions` for `guard_caught`.
* `outcome` is missing although the tool failed: the value record has no `outcome` and no `settles`. Pass the
  value check's record with `outcome`, or with `settles` and `rung`.
* `contract` reads `none` though the prompt states a format: the format is not in the input. Pass it in `stated`
  with `format`, or the tool schema in `toolSchemas`.
