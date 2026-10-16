---
title: Blame and placement rules
summary: "The two shipped rule files that read a failing verdict's evidence: who made the mistake (policy/blame) and where one change stops it recurring (policy/placement)."
commands: []
see_also:
  - authoring-evidence-names
  - authoring-blocks
  - recipes-find-why-a-test-failed
---

## What it is

A failing verdict says that a block failed. Two rule files answer what to do about it:

* `policy/blame:default` says who made the mistake (`fault`), how the failure counts for the agent
  (`disposition`) and what kind of fix it needs (`fix_action`). It holds 32 items in 8 groups.
* `policy/placement:default` says where the fix goes (`fix_location`, `fix_target`), in which form (`fix_forms`),
  and which local copies a shared fix replaces (`remove_copies`). It holds 13 items.

Both are TypeScript data in `packages/checks/src/blame/shipped.ts`. The checks package registers them as shipped
objects. A reviewed YAML copy of each is in `packages/checks/objects/policy/` for reading; the published package does
not include that folder. A project file extends a shipped policy by its id. Each item has an `id`, a `title`, a `when`
condition, an `effect` and an `impl`, the code that writes the result. Some items also have typed `params`.

How blame decides: the items are tried in order. The first enabled item whose `when` holds writes the attribution.
The last item, `unassigned`, holds always.

How placement decides: the items not marked additive are tried in order. The first that holds places the fix. Then
every additive item that holds adds to it.

A `when` condition reads evidence names (see `authoring-evidence-names`), never raw records:

| Written as | Holds when |
|---|---|
| `name: value` | the evidence equals the value |
| `name: [a, b]` | the evidence is one of the values |
| `name: { lt: n }`, `lte`, `gt`, `gte` | the evidence is a number and the comparison holds |
| `name: { not: <condition> }` | the condition does not hold |
| `name: present` | the evidence is set, and is not `none`, `false` or an empty list |
| `any: [ {..}, {..} ]` | one of the listed conditions holds |
| a bare word such as `bar` | the value of the param of that name, on the item first, then on the object |

A name with no value never holds, except under `not`. Every key of a `when` must hold.

A diagnosis never changes the machine pass of a block, nor any verdict. Loading the checks package registers both
files and their implementations with the object registry, so a project file can extend them. No command runs blame
or placement yet: call them from a script, through the `blame` and `placement` namespaces of
`@agent-nexus/driftbench-checks`.

## When to use it

* A block failed, and you need to know what to change. It may be the test, the environment, a tool, a skill,
  the core prompt or the model.
* Your team counts some failures differently. For example, a guard that caught a mistake counts as working.
  Write a project file that extends the default.
* You want to check a proposed fix text before you add it. The escape test flags a skill name, a file name or
  a value in it.

Do not use it:

* To decide pass or fail. The machine verdict stays final; blame only explains it.
* As a ranking of fixes over a whole campaign. One call explains one block; the campaign view is the
  `fix-plan` diagnostic.
* By editing the shipped files. A shipped object is immutable; write one that extends it.

## Commands and every option

There is no command. These are the library calls, from `@agent-nexus/driftbench-checks` unless marked core.

| Call | What it does | Defaults |
|---|---|---|
| `blame.shippedPolicy(kind, registry?)` | The resolved shipped object, `policy/blame` or `policy/placement` | `registry`: the global object registry |
| `new ObjectStore(registry?)` (core) | Every object visible from one place, the shipped ones included | the global object registry |
| `store.addFile(path, layer)` (core) | Reads one object file at a layer: `project`, `suite`, `spec`, `block` or `cli` | none |
| `store.resolve(kind, id)` (core) | The object with its `extends` chain applied: `items` in order, `params`, `ref` (`kind:id@hash8`), `chain` | none |
| `blame.attribute(policy, facts)` | The attribution of the first item that holds over a map of evidence | none |
| `blame.diagnoseBlock(options)` | Chain, evidence, attribute and place, for every failing gating verdict of one block | see below |
| `blame.agentOutcome(diagnoses)` | How a block counts for the agent: `fail` if any diagnosis is `agent` or `shared`, else `unassigned` if any is, else `pass` | none |
| `blame.factsOf(input, policy)` | Every evidence name of one failing verdict, plus `atom_line` and `tool` | none |
| `blame.registerBlameImpl(name, impl)` | Adds a `plugin:<name>` implementation a project item can name | none |
| `placement.applyPlacement(policy, place)` | Places one attribution: `{ attribution, input, facts, history?, fixText? }` | none |
| `placement.lintFixText(text, skills?)` | The escape test: every skill name, file name and literal value in a fix text | `skills`: none |
| `placement.CLASS_RULE_BY_ACT` | A class wording per act, such as `read_reference`, that passes the escape test | none |

The options of `blame.diagnoseBlock`:

| Option | Meaning | Default |
|---|---|---|
| `verdicts` | the block's verdicts, in the order the checks wrote them | required |
| `evidenceFor(verdict)` | returns the evidence input of one failing verdict (see `authoring-evidence-names`) | required |
| `blame`, `placement` | the resolved blame and placement objects | required |
| `tools` | the tools the block expects, in order: a failed tool's later tools inherit its diagnosis | none |
| `history` | earlier diagnoses of the same agent version, `{ item, act, home, target }`, for recurrence | none: every diagnosis is `provisional` |
| `fixText` | a proposed fix wording, linted by the escape test | none |
| `diagnostic` | the name written on each diagnosis | `diagnostic/code-agent-liability` |

The params of the shipped files, each with its shipped value. No param has a code default: an override must set a
value of the right type.

| Object and item | Param | Shipped value | Meaning |
|---|---|---|---|
| `policy/blame` | `bar` | `2` | confirm runs out of `confirm_runs` that count as passing |
| `policy/blame` | `confirm_runs` | `3` | runs per confirm question |
| `policy/blame` | `chain_by` | `[artifact_path, tool_output]` | what makes a later verdict inherit an earlier one |
| `policy/blame` | `faults`, `fix_locations`, `dispositions` | the lists below | the words an item may write |
| `policy/blame#R3` | `recovery_ok` | `[asked_user, retried_canonical, recovered]` | next actions that clear the agent |
| `policy/blame#R3` | `max_retries` | `3` | the same call this many times is a loop |
| `policy/blame#R3`, `#tool_silent_success`, `#tool_output_contradicts_rule` | `disposition_by_next_action` | a map, such as `asked_user: setup`, `continued: shared` | the agent's share of a tool fault, by what it did next |
| `policy/blame#R3` | `flag_test_when` | `accepts_single_path` | flags a test that accepts one exact value |
| `policy/blame#tool_output_contradicts_rule` | `shared_only_if_rule_read` | `true` | the agent shares the fault only if it had read the rule |
| `policy/blame#R2` | `altered_kinds` | `[unit_converted, reformatted, altered]` | changes that count as altering a given value |
| `policy/blame#env_failure` | `require_reference` | `false` | `true` fires only once a reference run is stored |
| `policy/blame#core_rule_caught` | `counts_against_agent` | `true` | `false` credits the agent when a guard caught the mistake |
| `policy/placement` | `core_sections` | `{ skill_use: Skill use, behaviour: Rules, integrity: Rules }` | the core prompt section a core fix targets |
| `policy/placement#cross_cutting` | `min_homes`, `class_min_homes` | `2`, `3` | homes a mistake must recur in to move to the core prompt |
| `policy/placement#cross_cutting` | `min_runs_per_home` | `2` | runs before a home counts; one run may be a flake |
| `policy/placement#cross_cutting` | `count_no_skill_home`, `window` | `true`, `campaign` | count blocks with no skill as a home; count over the campaign or the store |
| `policy/placement#shared_rule` | `core_share` | `0.5` | share of situations that moves a shared rule to the core prompt |
| `policy/placement#situational` | `body_max_lines` | `500` | a skill body longer than this sends a rule to a reference |

## Inputs

### The blame items, in order

| Group | Items | Writes |
|---|---|---|
| 1 Integrity | `I1_protected_edit`, `I1b_tests_fail_reverted`, `I2_special_case`, `I3_false_claim`, `I4_impossible_passed` | the agent, always |
| 1 Integrity | `I4b_impossible_flagged` | credited: the task was impossible and the agent said so |
| 2 Validity | `R5` | credited: the result works, the check demanded a form nobody states |
| 2 Validity | `confirm_missing_rule`, `test_reference_fails`, `env_failure` | setup, or excluded: the test or the environment is at fault |
| 3 Confirmed limits | `confirm_model`, `confirm_forced_load_fails` | the model, or the rule as written; only once confirm runs stored their counts |
| 4 Tools | `tool_silent_success`, `tool_output_contradicts_rule`, `R3` | the tool; the agent shares it by what it did next |
| 5 Provenance | `R2` | the agent changed a value the user or a file gave |
| 6 Rule home | `R6`, `skill_reference_missing`, `rule_in_unrouted_skill`, `skill_not_loaded_uncovered`, `skill_not_loaded_covered`, `skill_not_loaded_undecided`, `skill_reference_unforced`, `skill_reference_forced_unread`, `R4`, `skill_rule_ignored`, `core_rule_caught`, `R7`, `R1`, `R5b` | where the rule lives and how the agent read it |
| 7 Derivation | `R2b` | a value the agent built itself differs from gold |
| 8 Fallback | `unassigned` | no item matched |

### The placement items, in order

| Item | Places the fix |
|---|---|
| `fixed` | where the blame item said |
| `always_core` | integrity and honesty: in the core prompt |
| `trigger_local` | a skill's description |
| `layout_local` | a forcing pointer in the skill's main file |
| `cross_cutting` | the same mistake in two or more homes: in the core prompt, local copies removed |
| `shared_rule` | a rule several homes need: in the core prompt, or one shared reference |
| `situational` | a rule for one situation, or a body over its size: in a reference |
| `skill_local` | in that skill |
| `tool_local` | in the tool contract |
| `core_local`, `core` | in the core prompt |
| `mechanical_guard` (additive) | adds a guard beside the prose when code can check the rule |
| `escape_test` (additive) | lints the fix text |

### A project file

A project file extends a shipped object and lists operations on its items. Put it at
`driftbench/<kind>/<id>.yaml`, such as `driftbench/policy/blame/acme.yaml`.

```yaml
kind: policy/blame
id: acme
extends: default
items:
  - id: core_rule_caught
    params: { counts_against_agent: false }
```

| Operation | Written as |
|---|---|
| Set params of an item | `- id: R3` with `params: { max_retries: 5 }`; maps merge, lists replace |
| Disable an item | `- id: I2_special_case` with `enabled: false`; it stays listed, and the next item is tried |
| Add an item | `add: true` with `title`, `when`, `effect` and `impl`; place it with `before: <id>` or `after: <id>` |
| Replace the implementation | `impl: plugin:<name>`, registered with `blame.registerBlameImpl` |
| Reorder | `order: [...]`, every enabled item once; a file uses `order` or `before`/`after`, not both |
| Append to or remove from a list param | `+fix_locations: [data.seed]`, `-fix_locations: [env]` |

The words items write:

* `fault`: agent, skill, tool, test, env, setup, none, unknown.
* `disposition`: agent, shared, setup, excluded, credited, unassigned.
* `fix_location`: test, env, tool.contract, tool.impl, skill.content, skill.trigger, skill.layout,
  agent.skill_reading, agent.cross_skill, agent.model, none, unassigned.

## Outputs and how to read them

`blame.diagnoseBlock` returns `{ diagnoses, recovered }`. `recovered` lists the failing verdicts the agent fixed
itself within the block, by a retry: they are recorded, never attributed. Each diagnosis holds:

| Field | How to read it |
|---|---|
| `verdict_ref` | the failing verdict it explains |
| `inherits` | set on a later verdict of the same chain: the root verdict whose diagnosis it copies |
| `item`, `rule` | the blame item that fired, and its full reference `policy/blame:<id>@<hash8>#<item>` |
| `fault` | who made the mistake at run time |
| `disposition` | read first. `agent` and `shared` count against the agent; `setup`, `excluded` and `credited` do not; `unassigned` is reported apart |
| `fix_action` | the kind of change, such as `state_contract` or `strengthen_rule` |
| `fix_location`, `fix_target` | where the change goes, such as `tool.contract` and `tool:coverage.check` |
| `fix_forms` | `prose`, plus `guard` when code can check the rule |
| `placement` | the placement item that decided, `policy/placement:<id>@<hash8>#<item>` |
| `remove_copies` | the local fixes a shared fix replaces, to remove: moved, never duplicated |
| `evidence` | the evidence names the blame item read, with their values |
| `confidence` | `static` from stored records; `undecided` until a confirm run decides; `confirmed` after one |
| `flags` | `provisional` (placed with no history), `test_accepts_single_path`, `run_liability_confirm`, `class_rule:<wording>`, `escape:<kind>:<text>` |
| `home`, `act` | the skill whose block shows the mistake (or `none`), and the act class, for recurrence |

`blame.attribute` returns the same `item`, `rule`, `fault`, `disposition`, `fix_action`, `confidence` and `flags`.
It adds `verdict` (pass, fail or not_scored) and `place` (`fixed` or `auto`). It adds `fix_location` when the
item names it.

## Worked example

No command runs blame or placement in this release; `spec validate` checks the rule files a spec names. The project config comes first, so every command below sees the project:

```yaml file=driftbench.yaml
# The project config. The project rule files are read from driftbench/ beside it.
```

Then the Acme coverage spec, whose `coverage.check` call the failing block below imitates, runs and passes on the Acme agent:

```sh
driftbench campaign run examples/acme/specs/conversations/new-customer-coverage.yaml --no-cache
```

```text
$ driftbench campaign run examples/acme/specs/conversations/new-customer-coverage.yaml --no-cache
Campaign c-4bf80e6d1b5b: 1 cell, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, regex, exact, injection, length, markup, starts_with, finish_reason, json, tool_f1, refusal, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
Not judged: 2 criteria in 2 blocks of 1 spec (one_question_per_turn, coverage_before_offer), 1 of them gating. This campaign loads no judge, so these criteria have no verdict and count in no pass or fail. See docs/concepts/judges.md.
✓ acme-new-customer-coverage · function:acme-sales · F · repeat 0  pass  4 blocks
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
The runs are not kept: pass --store <file> to keep them.
(exit 0)
```

Then a project file for Acme, and a script that resolves it, explains a failing Acme block, and lints a fix text. It
runs the packages from source with `tsx`; this file tells `tsx` where they are:

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

```yaml file=driftbench/policy/blame/acme.yaml
# Fictional data only. Acme counts a guard that caught a mistake as working, and a broken seed as a test defect.
kind: policy/blame
id: acme
extends: default
description: Acme's blame rules.
params:
  +fix_locations: [data.seed]
items:
  - id: core_rule_caught
    params: { counts_against_agent: false }
  - id: I2_special_case
    enabled: false
  - id: seed_defect
    add: true
    before: R5
    title: The seed file breaks its own constraints
    when: { seed_lint_failed: true }
    effect: { verdict: not_scored, disposition: excluded, fault: [test], fix_location: data.seed, fix_action: fix_seed, place: fixed }
    impl: builtin:blame/reference-fails
```

The two files below are wrong on purpose, to show the refusals:

```yaml file=bad/unknown-item.yaml
kind: policy/blame
id: bad
extends: default
items:
  - id: R9
    enabled: false
```

```yaml file=bad/wrong-type.yaml
kind: policy/placement
id: bad
extends: default
items:
  - id: cross_cutting
    params: { min_homes: two }
```

```ts file=blame.mts
import { blame, placement } from '@agent-nexus/driftbench-checks';
import { ObjectStore } from '@agent-nexus/driftbench-core';

// 1. Resolve the shipped files and the project file.
const store = new ObjectStore();
store.addFile('driftbench/policy/blame/acme.yaml', 'project');
const shipped = store.resolve('policy/blame', 'default');
const acme = store.resolve('policy/blame', 'acme');
const place = store.resolve('policy/placement', 'default');
console.log(`${shipped.ref}: ${shipped.items.length} items`);
console.log(`${acme.ref}: ${acme.items.length} items, chain ${acme.chain.join(' then ')}`);
const ids = acme.items.map((item) => item.id);
console.log(`seed_defect sits at ${ids.indexOf('seed_defect')}, R5 at ${ids.indexOf('R5')}`);

// 2. The same evidence under both files: a guard caught the mistake.
const caught = { guard_caught: true };
console.log(`guard caught: default ${blame.attribute(shipped, caught).disposition}, acme ${blame.attribute(acme, caught).disposition}`);

// 3. A failing Acme block, built by hand: the coverage tool failed on the address the user typed,
//    and the order was then never placed.
const verdict = (id: string) => ({ id, kind: 'machine' as const, name: 'tools', gating: true, outcome: 'fail' as const, evidence: '' });
const address = verdict('tools.coverage.check.input.address');
const order = verdict('tools.order.create.count');
const block = (reply: string) => ({
  verdicts: [address, order],
  observed: {
    segments: [],
    text: reply,
    toolCalls: [{ label: 'coverage.check', input: { address: '7 Quarry Ln, Acmeville' }, error: 'address not found' }],
    cost: { usd: 0, inputTokens: 0, outputTokens: 0 },
    latencyMs: 0,
  },
});
const explain = (reply: string) =>
  blame.diagnoseBlock({
    verdicts: [address, order],
    evidenceFor: (one) => ({
      verdict: one,
      user: 'Can I get fiber at 7 Quarry Ln, Acmeville?',
      block: block(reply),
      values: [{ tool: 'coverage.check', field: 'address', value: '7 Quarry Ln, Acmeville', outcome: 'failed' as const }],
    }),
    tools: ['coverage.check', 'order.create'],
    blame: shipped,
    placement: place,
  }).diagnoses;

for (const reply of ['I could not find that address. What is the full street name?', 'Fiber is not available there.']) {
  const diagnoses = explain(reply);
  console.log(`reply: ${reply}`);
  for (const one of diagnoses) {
    console.log(
      `  ${one.verdict_ref}${one.inherits ? ` inherits ${one.inherits}` : ''}: ${one.item}, fault ${one.fault.join('+')}, ${one.disposition}, ${one.fix_action} at ${one.fix_location}, by ${one.placement.split('#')[1]}, flags ${one.flags.join(' ')}`,
    );
  }
  console.log(`  counts for the agent as: ${blame.agentOutcome(diagnoses)}`);
}

// 4. The escape test on two fix texts.
console.log(JSON.stringify(placement.lintFixText('In refunds, read references/limits.md before you refund over $50 to a card.', ['refunds'])));
console.log(JSON.stringify(placement.lintFixText(placement.CLASS_RULE_BY_ACT.read_reference ?? '', ['refunds'])));

// 5. The refusals: an unknown item, a param of the wrong type, a shipped id written again.
for (const [kind, file] of [['policy/blame', 'bad/unknown-item.yaml'], ['policy/placement', 'bad/wrong-type.yaml']] as const) {
  const other = new ObjectStore();
  other.addFile(file, 'project');
  try {
    other.resolve(kind, 'bad');
  } catch (error) {
    console.log((error as Error).message);
  }
}
try {
  new ObjectStore().add({ kind: 'policy/blame', id: 'default', items: [] }, 'project', { path: 'driftbench/policy/blame/default.yaml' });
} catch (error) {
  console.log((error as Error).message);
}
```

```sh setup
tsx blame.mts
```

```text
$ tsx blame.mts
policy/blame:default@47a04623: 32 items
policy/blame:acme@8ecbfff3: 33 items, chain policy/blame:acme then policy/blame:default
seed_defect sits at 6, R5 at 7
guard caught: default agent, acme credited
reply: I could not find that address. What is the full street name?
  tools.coverage.check.input.address: R3, fault tool, setup, state_contract at tool.contract, by fixed, flags test_accepts_single_path provisional
  tools.order.create.count inherits tools.coverage.check.input.address: R3, fault tool, setup, state_contract at tool.contract, by fixed, flags test_accepts_single_path provisional
  counts for the agent as: pass
reply: Fiber is not available there.
  tools.coverage.check.input.address: R3, fault tool+agent, shared, state_contract at tool.contract, by fixed, flags test_accepts_single_path provisional
  tools.order.create.count inherits tools.coverage.check.input.address: R3, fault tool+agent, shared, state_contract at tool.contract, by fixed, flags test_accepts_single_path provisional
  counts for the agent as: fail
[{"kind":"skill_name","text":"refunds"},{"kind":"file_name","text":"references/limits.md"},{"kind":"literal_value","text":"$50"}]
[]
unknown item R9 in policy/blame:bad (bad/unknown-item.yaml:5); the parent policy/blame:default holds I1_protected_edit, I1b_tests_fail_reverted, I2_special_case, I3_false_claim, I4b_impossible_flagged, I4_impossible_passed, R5, confirm_missing_rule, test_reference_fails, env_failure, confirm_model, confirm_forced_load_fails, tool_silent_success, tool_output_contradicts_rule, R3, R2, R6, skill_reference_missing, rule_in_unrouted_skill, skill_not_loaded_uncovered, skill_not_loaded_covered, skill_not_loaded_undecided, skill_reference_unforced, skill_reference_forced_unread, R4, skill_rule_ignored, core_rule_caught, R7, R1, R5b, R2b, unassigned. To add a new item write add: true with title, when, effect and impl
policy/placement:bad: item cross_cutting params: params.min_homes: Invalid input: expected number, received string (bad/wrong-type.yaml:5)
driftbench/policy/blame/default.yaml: policy/blame:default is shipped and immutable; write an object with another id that extends it
(exit 0)
```

How to read it:

* The project file holds 33 items: the 32 shipped ones, one of them disabled, plus `seed_defect` just before `R5`.
* A guard that caught a mistake counts against the agent under the default, and is credited under `acme`.
* The address failure fires `R3`: the user's value was copied as typed, and nothing stated the format the tool
  wanted. The fix is `state_contract` at `tool.contract`.
* When the agent asked again, the disposition is `setup`: the agent did its part. When it answered without
  asking, the disposition is `shared` and `agent` joins the fault.
* The order verdict inherits the address diagnosis: the order could not happen once the coverage check failed.
* `seed_lint_failed` is not a shipped evidence name, so `seed_defect` never fires until a plugin provides it.
* The escape test finds the skill name, the file name and the amount; the class wording has none.

A spec names the rule files under `uses`. `spec validate` resolves them, the shipped defaults and the project file included:

```yaml file=specs/blamed.yaml
# Fictional data only.
id: blamed-coverage
target: { adapter: function, agent: acme-sales }
uses: { blame: acme, placement: default }
blocks:
  - user: Can I get fiber at 7 Quarry Ln, Acmeville?
    expect: { must: ['address'] }
```

```yaml file=specs/unknown/nope.yaml
id: blamed-unknown
uses: { blame: nope }
blocks:
  - user: Hi.
    expect: { must: ['Acme'] }
```

```sh
driftbench spec validate specs/blamed.yaml
driftbench spec validate specs/unknown # exit 1
```

```text
$ driftbench spec validate specs/blamed.yaml
✓ specs/blamed.yaml  blamed-coverage · 1 block · hash 14c568e3de05
Checked 1 spec: 1 valid, 0 invalid, 0 warnings.
(exit 0)
$ driftbench spec validate specs/unknown
✗ specs/unknown/nope.yaml
    uses.blame  OBJECT_UNKNOWN  spec blamed-unknown: uses.blame: unknown object policy/blame:nope; searched layers shipped, project, suite, spec, block, cli; known ids for policy/blame: acme, default
Checked 1 spec: 0 valid, 1 invalid, 0 warnings.
(exit 1)
```

## Common errors

* `uses.blame  OBJECT_UNKNOWN  spec <id>: uses.blame: unknown object policy/blame:<id>; searched layers shipped, project, suite, spec, block, cli; known ids for policy/blame: <ids>`
  from `spec validate`: a spec names a blame object no layer holds. Fix the id, or write the project file under
  `driftbench/policy/blame/` beside a `driftbench.yaml`.
* `unknown item <id> in policy/blame:<id> (<file>:<line>); the parent policy/blame:default holds <item list>. To add
  a new item write add: true with title, when, effect and impl`: an operation names an item the parent does not
  hold. Fix the id, or add `add: true` with the four fields.
* `policy/placement:<id>: item <item> params: params.<name>: <reason> (<file>:<line>)`: a param of the wrong type.
  Use the type of the shipped value, such as a number for `min_homes`.
* `<file>: policy/blame:default is shipped and immutable; write an object with another id that extends it`: a
  project file reuses a shipped id. Give it its own id and `extends: default`.
* `<file>: the new item <id> needs <fields> (add: true needs title, when, effect and impl)`: an added item lacks a
  field.
* `<file>: add on item <id>, which policy/blame:default already holds; drop add: true to change it`.
* `policy/blame:<id>: order must list every enabled item once; it leaves out <ids>`, or `the file sets order and
  also moves <ids> with before or after; use one or the other`.
* `policy/blame:<id>: item <id> names <impl>, which no builtin or plugin provides`: register the plugin
  implementation before the file is resolved.
* `the blame implementation <name> is already registered`: `registerBlameImpl` with a shipped or used name.
* Every diagnosis is `unassigned`: no item matched, often because the evidence input lacks what the items read.
  Pass the value check's record in `values`, and `links` or estate `atoms` for the rule the check enforces.
* An item you added never fires: its `when` names evidence no provider computes. Use a name from
  `authoring-evidence-names`, or register a provider for it.
