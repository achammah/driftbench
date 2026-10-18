# Simulated user

A simulated user plays a person with a persona and a goal, block by block, instead of the spec's scripted words. It runs on the model port, or replays a recording of answers written earlier, so a run can be repeated without a model.

* It reveals a fact (an email, an address, a number) only once the agent has asked for it. This is enforced in code: a fact reaches the model only after an agent reply matches one of the fact's ask patterns, the spec's words for the block are given to the model with every fact not yet asked replaced, and an answer that holds such a fact fails the run.
* It says its stop token, alone, when the goal is met or given up; the run then ends.
* It reads the agent's visible text only, never its tool calls.
* Its model must belong to another family than the agent's and the judges'. A port of the agent's family or of a judge's family is refused before anything runs.

## A persona

Every field of a persona and of a user recording is in the [personas and red-team reference](reference/users.md).

A persona file names the person, the goal, the facts and how the agent asks for each, the stop token, and the spec it plays (relative to the file). The Acme personas are in [`examples/acme/personas`](../examples/acme/personas/README.md), with one recording written by hand in `recordings/`.

```text
id: sam-upgrader
name: Sam Rivera
persona: >
  A busy Acme mobile customer in their thirties. Writes short, friendly messages with full sentences,
  answers what is asked and does not chat about anything else.
goal: >
  Move the current Acme phone plan to one with more data, ideally unlimited, place the change, and end the
  chat once it is done.
facts:
  email: sam.rivera@example.com
reveal_when_asked:
  email: ['e-?mail']
stop_token: '###STOP###'
spec: ../specs/conversations/plan-upgrade.yaml
```

A recording holds the family it stands for, the persona id, and one answer per turn: turn n gets answer n.

## `driftbench simulate`

```
driftbench simulate <spec> --persona <file> (--model | --recording <file>) [--target <adapter[:agent]>] [--turns <n>] [--agent-family <family>] [--judge-family <family>]... [--json]
```

Runs the spec once in mode F with the simulated user, and prints each turn: what the user said, what the agent answered, the stage it reached and whether the block passed. Then the facts the user gave and why the run ended.

| Option | Effect |
|---|---|
| `--persona <file>` | the persona the user plays; required |
| `--model` | speak through the model port the environment configures (`ANTHROPIC_API_KEY`, or `OPENAI_API_KEY` with `OPENAI_MODEL`); a paid call per turn |
| `--recording <file>` | replay the answers of a recording, by turn; repeat it for several personas |
| `--target <adapter[:agent]>` | the agent; without it, the spec's own target |
| `--turns <n>` | stop after this many user turns |
| `--agent-family <family>` | the model family of the agent; `none` for an agent that is not a model. The Acme agents are `none` by default; any other target needs it |
| `--judge-family <family>` | a model family of the judges that will grade the run; repeat it |
| `--json` | print one JSON document |

On the plan upgrade, with the hand-written recording:

```
$ pnpm -s driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona examples/acme/personas/sam-upgrader.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml
Simulate: acme-plan-upgrade on function:acme-sales, persona sam-upgrader (Sam Rivera), recording hand-written.
  0  user   Hello! I'm already an Acme customer and my phone keeps running out of data before the month ends.
  0  agent  Hi, I'm the Acme Telecom sales assistant. I can help you move to a plan with more data. What is the email address on your Acme account?
     identify  ✓
  1  user   Sure, it's sam.rivera@example.com
  1  agent  Thanks, Sam. You are on Acme Mobile S, 10 GB for $15 a month. Plans with more data: Acme Mobile M, 40 GB for $25 a month; Acme Mobile L, unlimited data for $35 a month. Which one would you like: Acme Mobile M or Acme Mobile L?
     offer  ✓
  2  user   I'll take the unlimited one, please.
  2  agent  Here is the change: Acme Mobile S to Acme Mobile L, unlimited data for $35 a month, from your next billing cycle. Reply CONFIRM to place the order.
     recap  ✓
  3  user   Confirm
  3  agent  Done. Your order ORD-7B883C is placed: Acme Mobile L starts on your next billing cycle. Is there anything else I can help with?
     order_placed  ✓
  4  user   No, that's all. Thanks a lot!
  4  agent  You're welcome, Sam. Have a good day.
     closing  ✓
Facts given, each once asked: email.
✓ 5 of 5 blocks pass. The run ended: the spec has no block 5.
```

| Exit code | When |
|---|---|
| 0 | the run completed and every block passes |
| 1 | a block fails, or the run failed |
| 2 | bad input, nothing ran: no source or both, a bad persona, a bad number, no adapter, a model of the agent's or a judge's family |

## `campaign run --driver simulated`

`campaign run` takes the same user on every cell of a spec a persona plays: `--driver simulated`, one `--persona` per spec (each persona plays the spec its file names), and `--model` or `--recording`. In mode P the simulated user is the base of the perturbing driver: it writes the turns, and the deviation goes in at its block. A spec no persona plays is refused, exit 2.

```
$ pnpm -s driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --driver simulated --persona examples/acme/personas/sam-upgrader.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml --mode F,P --repeats 1
Driver: simulated, persona sam-upgrader on acme-plan-upgrade, recording hand-written.
Campaign c-ee7ffda5c41f: 3 cells, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, exact, injection, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
Not judged: 2 criteria in 3 blocks of 1 spec (one_question_per_turn, no_invented_data), 1 of them gating. This campaign loads no judge, so these criteria have no verdict and count in no pass or fail. See docs/concepts/judges.md.
✓ acme-plan-upgrade · function:acme-sales · F · repeat 0  pass  5 blocks
✓ acme-plan-upgrade · function:acme-sales · P · repeat 0 · billing-aside  pass  6 blocks
✓ acme-plan-upgrade · function:acme-sales · P · repeat 0 · loose-ok  pass  6 blocks
3 cells: 3 pass, 0 fail, 0 failed. Spent $0.00.
The runs are not kept: pass --store <file> to keep them.
```

## Personas and scenarios on a block

Status: designed in the block redesign, not built yet. The persona file above, `simulate` and `--driver simulated` work as described and stay as they are; this section is the contract of the objects that will replace the one file, so a block can be played by several personas on one scenario. Names in code font are exact.

A person is split in three kinds of object and a block:

* a persona says who the person is, in every conversation: `language`, `lines` (at most 5 lines of at most 15 words, never a restated rate), `behaviour` (measured rates: verbosity, initiative, tone, cooperativeness, commitment, engagement, patience), `stable_knowledge`, `expertise` (a `level`, and the concepts it `always_known`), `misconceptions`;
* a scenario says what the person wants this time: `intent`, `goal` and `start_state`;
* a block owns the facts of this case, in `situational`: what the user `holds` (with a `reveal` rule), does not know (`unknown`), believes about the case (`case_beliefs`), the `concepts` the case needs and the `pin`s;
* the run profile owns the run settings (`model`, `seed`, `temperature`, `trials`, `mode`, `simulators`, `calibration_ref`). They never appear in a persona or a scenario.

```text
# personas/terse-regular.yaml
kind: persona
id: terse-regular
language: en
lines: ["I order from you most months."]
behaviour:
  verbosity: { short_turn_share: 0.55, words_per_turn: 5 }
  commitment: { strategy: single_minded, repeat_after_refusal: 1 }
  engagement: { initial: 0.8, decay_per_unhelpful_turn: 0.2, disengage_below: 0.3 }
stable_knowledge: { account_id: ACC-4471, email: sam.ortel@example.com, has_account: true }
expertise: { level: advanced, always_known: [where_order_id_is] }
misconceptions: [{ fact: "refunds are instant", true: false }]
---
# scenarios/refund-late-order.yaml
kind: scenario
id: refund-late-order
intent: get_refund_for_late_order
goal:
  constraints: [{ slot: refund_method, value: original_payment }]
  requests: [{ slot: refund_amount }]
  success_when: { must_be_told: [refund_amount] }
start_state: { prior_failed_contacts: 1 }
---
# a block of a spec
- id: b1
  simulated_user:
    scenario: refund-late-order
    personas: [terse-regular, chatty-newcomer]
    requires: { language: en, has_account: true }
    situational:
      holds:
        - { slot: order_id, value: W2378156, reveal: on_request }
        - { slot: email, ref: persona.email, reveal: on_request }
      unknown: [{ slot: tracking_number }]
      case_beliefs: [{ fact: "the order was delivered", true: false }]
      concepts: [{ id: where_order_id_is }]
```

### Who owns what

A field has one owner. The owner's value is never overridden by another kind, and a value is never averaged: both values were written on purpose, so a conflict is refused.

| Field | Owner | May be overridden by |
|---|---|---|
| `behaviour` rates, commitment strategy, `language`, `stable_knowledge`, `expertise` | persona | nobody (defaults fill gaps only) |
| `misconceptions` | persona | a `case_beliefs` entry of the block on the same fact, marked `override: true` |
| disclosure default | persona | the `reveal` rule of a fact in the block |
| `intent`, `goal`, `start_state` | scenario | nobody |
| `situational` facts, `reveal` rules, `concepts` | block | nobody |
| `model`, `seed`, `trials`, `mode` | run profile | nobody |

A block that needs a fact of the person names it with `ref: persona.<slot>`; it never defines it again.

### Refusals

A block with several personas is planned as one cell per persona. Five refusals keep a cell from running. The first four are authoring errors: the suite fails to load, with an error that names the class and both sources. The fifth is a result: the case still loads, and only the cell of the failing persona is refused.

| Class | Refused when |
|---|---|
| `ownership_violation` (load error) | a scenario sets a persona-owned field (`language`, `lines`, `behaviour` or a part of it such as `verbosity`, `stable_knowledge`, `expertise`, `misconceptions`); a persona sets a scenario-owned field (`intent`, `goal`, `start_state`); either sets a run setting; or a block's `situational` sets a persona-owned field such as `situational.behaviour` |
| `slot_collision` (load error) | a slot is in `situational.holds` with a `value` and also in the `stable_knowledge` of one of the block's personas; equal values collide too, the block may only reference the slot |
| `contradictory_belief` (load error) | a block `case_beliefs` entry and a persona `misconceptions` entry state the same fact (same text after lower case and trimmed spaces) with opposite `true`, and the block entry has no `override: true`; the same fact with the same `true`, or with `override: true`, loads |
| `persona_switch_in_chain` (load error) | a block with a `parent` lists a different set of personas than its parent (sets, order does not matter), at any depth of the chain; a child that lists none inherits its parent's set; the scenario may change along the chain |
| `persona_incompatible` (a `not_run` cell) | the persona fails one `requires` key of the block |

The `requires` keys and their tests:

| Key | The persona passes when |
|---|---|
| `language` | its `language` equals the value |
| `has_account` | its `stable_knowledge.has_account` equals the value; absent counts as false |
| `concepts` | every listed concept id is in its `expertise.always_known` |
| `min_expertise` | its `expertise.level` is at least the value, in the order `novice`, `intermediate`, `advanced` |

A persona that lacks the field a key tests fails that key. When it fails several keys, the refusal names the first failing key in the order the block lists them. A refused cell has `status: not_run` and `kind: persona_incompatible`, with the failed key named: never a pass or a fail, and never counted in a rate. The other personas of the block run.

```text
# block b1 requires { language: fr, has_account: true }, played by terse-regular (en, has_account) and
# fr-guest (fr, no account)
- { block: b1, persona: terse-regular, status: not_run, kind: persona_incompatible, requirement: language }
- { block: b1, persona: fr-guest,      status: not_run, kind: persona_incompatible, requirement: has_account }
```

### The grid

Each cell is a block played by a persona, and a persona's run keeps its own verdicts: the same test played by another persona can fail another block, and each run reports the block where it failed. The result is a grid with the blocks as rows and the personas as columns; a refused cell is empty, not a failure. A block chain run on three personas is three separate trees.

## From code

`createSimulatedUser` of `@agent-nexus/driftbench-users` gives the driver; `loadPersona`, `personaOptions`, `loadUserRecording` and `userRecordingPort` read the files. Any object with a `family`, a `model` and `complete({ system, user })` is a port; `FakeModelPort` of `@agent-nexus/driftbench-generate` replays answers in tests.
