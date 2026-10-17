# Generating tests

driftbench writes tests from a map of the situations an agent can face. A model may propose entries of the map; a person approves them; code then enumerates the blocks and derives every Then from the approved map, never from an agent's reply. A gate keeps only the blocks that can tell a good agent from a broken one.

The steps, in the order a person runs them:

| Step | Command | Writes |
|---|---|---|
| Propose the map | `driftbench extract` | a proposal (`proposal.yaml`), nothing approved |
| Approve it | `driftbench extract approve` | the same proposal, with approval flags set |
| Read its axes as a space map | `driftbench extract map` | `space.yaml`, for the `space` commands |
| Measure coverage | `driftbench space coverage`, `complete`, `declare` | a report, or a first map |
| Generate the suite | `driftbench generate` | specs, `incomplete/` and `generate-report.json` |
| Gate it | `driftbench gate` | the gated suite, the sealed holdout, `gate-report.json` |
| Build code-agent tasks | `driftbench family instances`, `verify`, `review` | task instances with their expected outcome |
| Measure where results vary | `driftbench pilot plan`, `run`, `analyse` | `pilot-report.json` |
| Build the reference set of user turns | `driftbench intake logs`, `interview`, `from-interview`, `fidelity`, `approve` | a private or approved set of user turns |

Every output below comes from the Acme example in [`examples/acme`](../examples/acme/README.md), run from the repository root. No model is called: `extract` runs with `--no-model` or `--replay`, and `intake from-interview` with `--replay`. The commands write under a scratch folder, `_captures/docs3/generating/`, so the paths in the output name it. The options and exit codes of every command are on the [CLI page](reference/cli.md).

## The map of situations

Every field of a map proposal and of an approved map is in the [map reference](reference/map.md).

The map lists the dimensions a situation varies on, their values, and what links them. Each entry quotes the line of the agent's own sources that justifies it (`evidence`: a source path and a verbatim quote), says who proposed it (`produced_by`: `code` or `model`), and waits for a person (`approved`).

| Part | What it holds |
|---|---|
| Dimensions | one axis of variation, of a kind: `stage`, `behaviour`, `deviation`, `persona`, `channel`, `data` or `task`; its values |
| Constraints | a combination of values, one per dimension, that can never occur, with the reason |
| Phrases | user messages that express a value: the phrase bank the user turns come from |
| Relations | what links values to stages, tools and end states |
| Numeric settings | approved runtime variable ranges, sampled by budget mode into `given.vars` |

A dimension has a role. An axis is a dimension of the space map, crossed with the other axes. A detail stays in the proposal: the generator varies it inside a cell, as boundary values. Code proposes the roles: every dimension read from a tool schema is a detail, and the first dimension of each kind is an axis, the others details. A person may flip any role.

### Numeric runtime settings

An optional top-level `numeric_settings` list declares runtime variables. It does not add a categorical dimension or change the pair-coverage denominator. Each range needs its own approval and source evidence. This range is used in the numeric CLI test:

```
numeric_settings:
  - id: iterations
    min: 1
    max: 5
    integer: true
    unit: attempts
    evidence:
      source: prompt.md
      quote: "temperature ranges from 0 to 1; iterations range from 1 to 5 integer attempts."
    produced_by: code
    approved: true
```

| Field | Meaning |
|---|---|
| `id` | unique variable key, using the same lowercase id syntax as dimensions |
| `min`, `max` | finite bounds, with `max >= min`; equal bounds give a constant |
| `integer` | optional boolean, default false; true samples integer levels from `ceil(min)` through `floor(max)`, inclusive |
| `unit` | optional nonempty label, retained in the report; no conversion is performed |
| `evidence`, `produced_by`, `approved` | the source quote, proposer (`code` or `model`) and approval flag, as for other map entries |

An integer range must contain at least one integer, and its rounded endpoints and integer level count must be safe integers. Quotes must match a listed source. Add ranges by editing the proposal, then approve each flag in the file or use `extract approve --all`; the listing includes open numeric settings. Automatic numeric range extraction is pending.

Approved ranges require `generate --budget N`; generation without that flag refuses them. The sampled numbers are written into each selected spec's `given.vars`. The existing runner delivers those variables to the adapter. An adapter decides whether a variable maps to a target option, such as temperature; the generator does not perform that mapping. Other seeders do not sample these ranges.

### Relations

The relations are what lets code derive a machine Then. Each one quotes its source and is approved on its own.

| Kind | What it says | Acme |
|---|---|---|
| `path` | a flow's stage order on one branch, the cell values the branch needs (`when`), the behaviours it exercises, and the end state the store holds when it ends (by slots) | 12 |
| `uses_tool` | a tool a flow or behaviour calls, the stage it is called at (and, with `to`, the stage the turn reaches), the call count, and its inputs by slot. A flow's call is made on the move that leaves the stage; a behaviour's call is made in the turn that asks for the behaviour, said at that stage, and never on a move | 14 |
| `states` | what the reply of one turn must state, such as each plan with the monthly price the tool returned; it becomes `expect.must` on that turn | 7 |
| `binds` | the concrete values a data or persona value stands for, such as the email of a found account | 12 |
| `recovery` | how a flow recovers from one deviation class: the stages it is probed at (`at`), the stage after (`pending` is the stage the conversation had reached), reply patterns, guards and calls; for `D8_tool_failure`, the tool that fails | 24: 7 by code, 17 by the model |
| `reply_language` | the language every reply is in, whatever the user writes | 1 |
| `reply_count` | how many replies the agent sends to one user turn: `one`, or `any` when a source says it may send several. A map without it means one reply per user turn | 0 |
| `task_family` | a flow a code agent does as a task: the [task family](#task-families) folder, its stages, the values every instance holds (`holds`), the family knob values of the instances it places (`instances`), and the deviation class its planted variant carries | 2 |

A phrase may hold a `{slot}` (`It's {email}.`), may say where it fits with `when` (a flow, a stage, a data value), and may state slot values itself with `binds` (`The unlimited one, please.` binds the plan `mobile-l`). The generator fills each slot from the values the cell binds, so a tool input expected in a block is the value the block's own When states.

Four relations of the Acme proposal, as written in the file:

```
  - kind: path
    id: upgrade-order
    flow: upgrade
    when: { user_type: [ existing-customer ], account_lookup: [ found ], plan_choice: [ names-one ] }
    stages: [ needs, identify, offer, recap, order_placed, closing ]
    behaviours: [ B-001, B-002, B-008 ]
    end_state:
      source: tool:order.create
      mode: subset
      expect:
        type: upgrade
        customer_id: "{customer_id}"
        plan_id: "{plan_id}"
    evidence:
      source: ../src/policy.ts
      quote: if (s.flow === 'upgrade' || (s.customer.name && s.customer.email)) return recap(s);
    produced_by: model
    approved: false
  - kind: uses_tool
    subject: { dimension: flow, value: upgrade }
    tool: catalog.search
    stage: identify
    input:
      category: mobile
      customer_email: "{email}"
    evidence:
      source: ../src/policy.ts
      quote: "callWithRetry(call, 'catalog.search', { category: 'mobile', customer_email: email }),"
    produced_by: model
    approved: false
  - kind: binds
    subject: { dimension: account_lookup, value: found }
    slots: { email: sam.rivera@example.com, customer_id: cust-001 }
    evidence:
      source: ../src/store.ts
      quote: |-
        id: 'cust-001',
        name: 'Sam Rivera',
        email: 'sam.rivera@example.com',
    produced_by: model
    approved: false
  - kind: reply_language
    subject: { dimension: rule, value: english-only }
    lang: en
    evidence:
      source: ../src/policy.ts
      quote: if (isForeign(text)) return `I can only help in English for now. ${pendingQuestion(s)}`;
    produced_by: model
    approved: false
```

## Extract: propose the map

`driftbench extract` reads the agent's prompt or policy (`--prompt`, repeatable), its behaviour inventory (`--inventory`) and, optionally, its tool schemas (`--tools`), and writes a proposal with nothing approved. An existing proposal is never replaced without `--force`.

### The code pre-pass

Code reads the inventory and the tools before any model:

* From the inventory: a `behaviour` dimension (one value per behaviour), a `flow` dimension (one value per flow), a `deviation` dimension (the classes the flows require), a `channel` dimension, and one constraint per channel a behaviour's `channels` leaves out. Each detour class a flow lists in its `deviations` becomes a `recovery` relation that returns to the pending stage.
* From the tool schemas: one `data` dimension per argument or result field, named `<tool>.in.<field>` or `<tool>.out.<field>`, with a value for each partition the schema states (enum members, booleans, the edges of a minimum or a maximum, a length limit, a format, an array size, `null`, an absent optional field). A field the schema leaves open gives no value and is listed in the notes. A name enters an id as follows: a capital after a letter or digit is split off with `_`, the name is lower-cased, and each run of characters other than letters, digits, `_` and `-` becomes `_` (in a tool name, dots stay, and a name that does not start with a letter gets `t_` in front). A field named `$ref` gives `_ref`, `user.email` gives `user_email` (one field, not a path), and a tool named `getWeather` gives `get_weather`.

`--no-model` stops there:

```
$ pnpm -s driftbench extract --prompt examples/acme/src/policy.ts --prompt examples/acme/README.md --prompt examples/acme/src/store.ts --inventory examples/acme/inventory.yaml --tools examples/acme/map/tools.yaml --no-model --out _captures/docs3/generating/nomodel/proposal.yaml
Wrote _captures/docs3/generating/nomodel/proposal.yaml: 29 dimensions, 86 values, 55 constraints, 0 phrases, 7 relations, none approved.
  Code pre-pass: 34 dimensions, 91 values, 55 constraints, 7 relations.
  Roles: 3 axes (behaviour, deviation, channel), 26 details; the axes make a full grid of 252 cells.
  No model call: the code pre-pass alone (--no-model).
Notes:
  catalog.search output: no partition stated for customer.id, customer.name, customer.current_plan_id
  coverage.check output: no partition stated for address
  port.check output: no partition stated for number
  order.create input: no partition stated for plan_id, customer.name, customer.email
  order.create output: no partition stated for order_id, plan_id, monthly_usd
  notify_sales output: no partition stated for ticket_id
Next: driftbench extract approve _captures/docs3/generating/nomodel/proposal.yaml lists the decisions; approve by --dimension <id> or --all.
exit 0
```

### The model sections

Without `--no-model`, the extractor asks a model for the rest, one call per section, in order: `stages`, `rules`, `personas`, `data`, `phrases`, `relations`. The system prompt asks for quotes, never inventions, and fictional data only. Code then checks every entry on its own: its shape, the kinds its section may propose, a known source, a quote of 4 to 400 characters found in that source, and references to values and stages already proposed. A refused entry is listed with its reason; one bad entry never costs the rest. An unreadable answer is retried once; a section that still fails is reported, and the later sections still run.

`--provider anthropic|openai` picks the client (default: the first whose key is set in the environment). `--replay <file>` replays recorded answers through the same parser and checks, offline and reproducible. The Acme map was made that way: `examples/acme/map/answers.yaml` holds answers written by hand under the answer contract, and `produced_by.family` says `lane`, so no one mistakes them for a model run. The quotes are read relative to the proposal's folder, so the run below works on a copy of the Acme inputs:

```
$ pnpm -s driftbench extract --prompt _captures/docs3/generating/acme/src/policy.ts --prompt _captures/docs3/generating/acme/README.md --prompt _captures/docs3/generating/acme/src/store.ts --inventory _captures/docs3/generating/acme/inventory.yaml --tools _captures/docs3/generating/acme/map/tools.yaml --replay _captures/docs3/generating/acme/map/answers.yaml --out _captures/docs3/generating/acme/map/proposal.yaml
Wrote _captures/docs3/generating/acme/map/proposal.yaml: 51 dimensions, 182 values, 111 constraints, 51 phrases, 71 relations, none approved.
  Code pre-pass: 34 dimensions, 91 values, 55 constraints, 7 relations.
  Roles: 7 axes (behaviour, deviation, channel, stage, user_type, coverage_result, workspace_start), 44 details; the axes make a full grid of 113568 cells.
  Model lane claude-opus-5-5 as the extract and generate2 lanes, by hand: 6 sections, 6 calls.
    stages     added 37 entries
    rules      added 14 entries
    personas   added 45 entries
    data       added 49 entries
    phrases    added 51 entries
    relations  added 64 entries
Notes:
  catalog.search output: no partition stated for customer.id, customer.name, customer.current_plan_id
  coverage.check output: no partition stated for address
  port.check output: no partition stated for number
  order.create input: no partition stated for plan_id, customer.name, customer.email
  order.create output: no partition stated for order_id, plan_id, monthly_usd
  notify_sales output: no partition stated for ticket_id
Next: driftbench extract approve _captures/docs3/generating/acme/map/proposal.yaml lists the decisions; approve by --dimension <id> or --all.
exit 0
```

The proposal is the committed `examples/acme/map/proposal.yaml`, byte for byte but for the time in `produced_by.at`. A recording with no answer left for a section fails that section, as a failed model call does. No option saves a real model's answers for a later replay yet. `extract` exits 0 when the proposal is written and complete, 1 when it is written with a failed section or a refused entry, 2 on a usage or input error (nothing written).

### Planned: what extract does not read yet

These are capabilities users need from `extract` that the code lacks today. The map validator holds the items that check each one (`validators/map/NEEDS.md`). They fail until the capability ships.

* **Declared roles.** A prompt may say which dimension makes a different kind of conversation ("Each of these makes a different kind of conversation") and which can show up inside any conversation. That dimension becomes the axis, whatever order the dimensions are read in. Without such a sentence, the first dimension of each kind stays the axis, as above. The purpose: the prompt's author already said which differences make a different conversation, so the space map crosses those and leaves the rest as details, and no person has to flip the roles the prompt already states.
* **What a rule states.** Each rule records whether the agent must or must not do it (`polarity`: `must` or `must_not`), the cell it applies in (`when`), the case it excludes (`unless`), a count limit (`limit`, the most times the action may happen in a conversation), a time limit (`within`, with `minutes`), and whether it comes first when rules collide (`priority: first`).
* **What a value states.** A persona or data value records the share of users it stands for (`weight`) and whether a test plan must include it (`required`).
* **More schema keywords.** A tuple (`prefixItems`, or `items` given as a list) gives one dimension per position, `<field>.0`, `<field>.1`, beside the array's own size values. Closing a tuple (`unevaluatedItems` or `additionalItems` false) adds the value `extra-item`. A closed input object (`additionalProperties: false`) gives the dimension `<tool>.in.unknown-key` with the value `sent`, a call carrying a key the schema does not name.
* **More relations.** The order two tools are called in, the route a request takes to a flow, and the exact reply text a rule fixes.
* **Every prompt style.** Rules are read in lists, numbered rules, prose, tables, nested sections, a second language, negations, conditions, tool references, examples that contradict a rule, deprecated sections, duplicated rules with precedence, rules hidden inside examples, and rules phrased as questions. Any two of these styles can be mixed in one prompt.
* **Long prompts.** A prompt of 100k characters and more is read in chunks cut at line boundaries, within a time budget. A wrapped sentence, a table with its header, a section with its heading path, a question with its answer and a deprecation marker with the text it covers stay together. Constraints are proposed once the whole map is known, and a replacement in one chunk retires the rule it replaces in another.
* **A map that depends only on what the prompt says.** The map does not change when sections are reordered, a rule is split into two sentences, a word is replaced by a synonym, or a sentence that specifies nothing is added. Two halves of a prompt give the two halves of the map, and a prompt with one more constraint gives exactly one more constraint. Most of this holds today; reordering sections can still change which dimension is the axis, until declared roles ship.

## Approve

A dimension has one `approved` flag, which its values inherit; a value may set its own flag to override it. Each constraint, phrase and relation has its own flag. `extract approve` with no option lists the open decisions and the grid the axes give:

```
$ pnpm -s driftbench extract approve _captures/docs3/generating/acme/map/proposal.yaml
_captures/docs3/generating/acme/map/proposal.yaml: 291 of 291 decisions are open (51 dimensions, 111 constraints, 55 phrases, 74 relations).
Axes: 7 of 51 dimensions, a full grid of 113568 cells (the space commands accept 250000).
  dimension   behaviour  behaviour axis, by code, 14 values: The behaviours the inventory lists
  dimension   flow  behaviour detail, by code, 5 values: The flows the inventory lists
  dimension   deviation  deviation axis, by code, 10 values: The deviation classes the flows must be perturbed with
  dimension   channel  channel axis, by code, 2 values: The channels the inventory names
```

The listing goes on with one line per dimension, constraint, phrase and relation, each relation with its quote:

```
  relation    path  path upgrade-order (upgrade: needs > identify > offer > recap > order_placed > closing)
              ../src/policy.ts: "if (s.flow === 'upgrade' || (s.customer.name && s.customer.email)) re..."
```

`--dimension <id>` (repeatable) approves dimensions and the values that inherit their flag; `--all` approves every flag; `--to <file>` writes the result beside the proposal instead of over it:

```
$ pnpm -s driftbench extract approve _captures/docs3/generating/acme/map/proposal.yaml --dimension stage --dimension channel --to _captures/docs3/generating/acme/map/partial.yaml
Approved 2 dimensions in _captures/docs3/generating/acme/map/partial.yaml: channel, stage.
exit 0
```

```
$ pnpm -s driftbench extract approve _captures/docs3/generating/acme/map/proposal.yaml --all --to _captures/docs3/generating/acme/map/approved.yaml
Approved 279 flags in _captures/docs3/generating/acme/map/approved.yaml; 0 were already set.
exit 0
```

The Acme map was approved with `--all` on the owner's delegation, for the fictional demo. An entry whose evidence is removed, or whose quote is no longer in its source, makes the proposal invalid: `approve` refuses it and exits 1.

## The space map and its coverage

`extract map` writes the space map of the approved axes, the file the `space` commands read. Details stay in the proposal.

**Allowed means possible.** Besides the written constraints, the space map of an approved map forbids every pair its own relations rule out, each with the reason `derived from the relations`. An event is a stage on an approved path, or a stage of a `task_family` relation, with the deviation class said there. A stage or a class is allowed with the other values of a pair only when some event fits them all:

* the class must be said where its recovery, a fitting phrase and the turn allow: a first turn carries only a class a first message can carry, and nothing follows the last stage but a class whose recovery stays there;
* a data or task value is held only where the path's `when` or the family's `holds` states it; elsewhere the axis holds `none`, the value a data or task axis gets on a structured map;
* a conversation holds no task setting, so a conversation event allows only `none` on the task axes.

The inventory pre-pass also writes one constraint per flow a behaviour does not belong to. On Acme this leaves 708 allowed pairs, and `generate` covers all of them with complete specs. A value no allowed pair holds is named in the report under `cover.unreachable`. On Acme there is none: the price-sheet family's `start` knob reaches `workspace_start=existing-workbook`.

```
$ pnpm -s driftbench extract map _captures/docs3/generating/acme/map/approved.yaml --to _captures/docs3/generating/acme/map/space.yaml
Wrote _captures/docs3/generating/acme/map/space.yaml: 7 axes (behaviour, deviation, channel, stage, user_type, coverage_result, workspace_start), 380 constraints, a full grid of 212940 cells.
exit 0
```

The result is identical to the committed `examples/acme/map/space.yaml`. Three commands read it; their full output and formulas are on the [CLI page](reference/cli.md#driftbench-space):

* `driftbench space coverage <specs> --map <space.yaml> [--t <n>]` counts the cells the specs cover, at strength t (every subset of t dimensions) or on the full grid, weighted by the declared prior, and lists the required cells. It exits 1 when a required cell is empty.
* `driftbench space complete <specs> --map <space.yaml> [--t <n>]` prints the completeness line: the share of the cells that have appeared and the chance that the next conversation shows a new one. It exits 1 when there are fewer conversations than cells.
* `driftbench space declare <specs> --inventory <file> --out <file>` writes a first map from the inventory and the specs, for the owner to edit.

On the Acme map, the hand-written specs cover 237 of 708 allowed pairs (exit 1, three required cells empty); the gated suite covers 592 and every required cell:

```
Coverage: 10 of 10 required cells covered, 592 of 708 cells at t = 2 (83.6%).
```

That is the last line of `pnpm -s driftbench space coverage examples/acme/gated/specs --map examples/acme/map/space.yaml --t 2` (exit 0). The cells the gated specs miss are the ones only a sealed spec covers.

## Generate

`driftbench generate --map <approved proposal> --out <dir>` enumerates specs by code. The map must be a proposal whose every entry is approved. No model is called. Six seeders each write specs:

| Seeder | What it writes |
|---|---|
| `graph` | one spec per approved path: the stage graph walked along the paths, so every edge a path takes is covered by a conversation the agent can have. Each walk declares, for perturbed mode, every class whose recovery keeps the conversation where it is |
| `twise` | a covering array at strength `--t` (default 3) over the axes; each row walks an approved path of a flow its behaviour belongs to |
| `boundary` | one spec per value of every detail data dimension, on a path that needs it; a tool output value becomes the tool's answer, a tool input value an expected or a forbidden call. After coverage, one restated slot per tool input a move fills from a slot (`gen-restated-NNN`): just before the move, the user asks for the tool with one value (the call carries the move's arguments with that value, and the reply reports the tool's returned fields as the move's does); then the move's turn states another value, and the move expects the latest one. The other value is one no single slip of the first reaches in the tool's schema (the next enum member or the first one, the integer one either side) whenever the values allow it, so an agent that keeps the first value and also slips once still fails the move. Only when every phrase of that move states the slot, and never for a side-effecting tool |
| `deviation` | one probe per deviation class, injected at a stage of a path whose flow has a recovery for the class; a class a first message can carry may arrive on the first turn, and a class whose recovery stays may arrive after the last stage. After the `cover` seeder, a class placed fewer than a third as often as the most placed class gets more probes (`gen-deviation-balance-NNN`), until it reaches that third or no approved path can carry it; see [Balance of stages and classes](#balance-of-stages-classes-and-behaviours). Then a class whose recovery moves the conversation elsewhere (a goal shift goes back to the stage that owns the goal), which no clean walk can declare for perturbed mode, gets one walk of its flow cut at the latest stage before the last that can take it (`gen-deviation-cut-NNN`) when no complete spec declares it that way: the perturbation is said after the walk's last turn, its recovery is the Then, and the walk has no end state |
| `metamorphic` | families of specs that differ only in the phrasing of one value, with the same Then by construction |
| `task` | the instances of every family a `task_family` relation names (`--tasks <n>` per relation, default 8), each with its corner and planted variants; see [task families](#task-families) |
| `cover` | runs last: one scenario for each allowed pair no complete spec of the other seeders covers, its values fixed and its deviation a probe at its stage; a pair it cannot build is listed in `generate-report.json` under `cover.unbuilt` with the reasons. Then each approved phrase of a behaviour, a flow or a tool value that no complete spec says gets one spec (`gen-phrase-NNN`): a walk's moves reach a stage and the user says the phrase there; the Then is that stage, plus no run of a side-effecting tool, or for another tool's returned value one run whose reply reports the returned fields as the flow's `states` relations do, said after a move that already ran the tool. The phrases of one dimension go to distinct stages while the walks have stages left; a phrase whose only fitting stage another phrase holds takes it when that phrase can move to a free one, so every phrase some free stage fits is said. An approved phrase no walk can say is listed under `no_phrase` with the reasons (`unsaid`), including a behaviour whose call conditions cannot hold on any approved walk. When `--max` stops this seeder, every eligible phrase still waiting is reported with `cut by --max`, including phrases not visited yet. A phrase that states slot values (`binds` or a `{slot}`) is left out, since a stage-only Then cannot judge them |

A class the users package carries in the world, not in a user message (an instruction inside data, `D6_instruction_in_data`), arrives as supplied data, in a probe block and in a declared perturbation alike: its approved phrase is the content of a workspace file with a plain name no workspace of the spec uses (`NOTES.txt`, then `NOTES-2.txt`), the injected turn says nothing (`injection.user: ""`), and the files the world already holds are kept. A probe block's file is part of the world for its own turn only: the next block returns to the workspace before it; a perturbation's world holds from its turn on, as any perturbation's does. Its Then is the recovery's, as for a class said by the user.

Every seeded choice comes from `--seed` (default 1), so the same map and seed give the same suite byte for byte.

### Balance of stages, classes and behaviours

Coverage counts events. An event is a block at the stage it expects, an injected block or a declared perturbation at the stage the conversation had reached when it arrived, and a deviation class where it arrives. A spec places the behaviours it covers. A suite can cover every pair and still place most events on the first stages every flow shares: a conversation starts at `opening` once, passes `intake` and `check` on every path, and reaches `done` through one flow.

The generator keeps the allocation even. No stage, deviation class or behaviour is placed fewer than a third as often as the most placed value of its kind. It counts the suite as it builds it, and it fills a shortfall in this order:

1. A walk that declares perturbations places them where the suite has the least. A recovery that was drawn moves to a rarer stage with the same wording when its flow recovers from the class there. Further recoveries, at most one per class and walk, are added at the rarest stage the walk reaches: before its first turn for a class a first message can carry, between turns, or after its last turn. Only a class whose flow recovers in place (the conversation stays where it arrived) is declared this way, with the wording and the Then the map approves. This adds no block, no random draw and no spec. A probe for a class goes to the stage where the suite gains most, counting the moves before it when the walk ends there.
2. When the declared recoveries do not reach the floor, short approved walks fill the rarest stage (`gen-stage-balance-NNN`): a path cut after the stage, or the whole path for the last stage. Of the paths through the stage, the walk that leaves stages and classes nearest balance is written, and only when it brings them nearer. A walk written to balance declares only what the balance adds, because every other walk already declares one drawn class and a tool failure at the stages it crosses.
3. Walks for the behaviours a few specs cover (`gen-behaviour-balance-NNN`) go on a path of a flow that holds the behaviour.
4. Class probes (`gen-deviation-balance-NNN`), stage walks and behaviour walks alternate, because a walk for a stage declares classes and covers behaviours, and a probe for a class crosses stages. They stop when all hold, when a round adds nothing, or when the allocation has added as many specs as the seeders wrote.

A stage, class or behaviour that no approved path or phrase can reach stays under the floor, and the suite is written as it is. The count follows `driftbench coverage`, so a stage placed by a declared perturbation is a placed stage.

### The machine Then in every block

A complete generated block reads observed state, not only words. Code derives each part of its Then from the approved relations:

| Then | Derived from |
|---|---|
| `expect.stage` and `expect.stage_reported` | the path's next stage, reported by the runtime in this block |
| `expect.tools` (label, count, input) | the `uses_tool` relations of the flow at that stage, inputs filled from the slots the cell's data values and the phrases bind; every other tool the scenario calls is expected 0 times in that turn |
| `expect.tools` and `expect.must` on a behaviour's phrase turn | the `uses_tool` relations of that behaviour at the stage the phrase is said, for a tool without side effects: one call, and the `states` patterns that state the tool's returned fields |
| `rules.forbidden_tools` | every tool the scenario never calls |
| `end_state` on the last block | the path's end state, slots filled |
| a probe block's stage, `must`, `must_not`, guards and calls | the recovery of that class in that flow; `pending` is the stage the conversation had reached. A recovery that stays there also keeps the `must_not` patterns with no slot of the `states` relation that reached the stage, such as narrated internal steps |
| a tool failure | the path's own turn, with the tool failing in its Given; the recovery's stage and calls; calls after the failing tool expected 0 times; the conversation stops there |
| `expect.must` and `expect.must_not` on a move | the approved `states` relations of the flow or behaviour at that stage, such as returned prices, the pending question, and forbidden invented facts |
| `expect.lang` on every block | the `reply_language` relation, never the language of the user's message |
| `rules.one_message_per_turn` on every spec | the `reply_count` relation: one reply per user turn unless the map states `per_turn: any`, so an agent that sends its reply twice fails. With `any`, only the probes of `D7_silence_or_burst` keep the rule, from the nudge recovery |

A `states` relation names a `subject` (`dimension` and `value`), the departing `stage`, optional destination `to`, optional `when`, and `must`, `must_not`, or both. Each supplied list contains at least one regular expression. Both lists reuse the quoted-price relation's `{slot}` syntax: an approved `binds` relation supplies the value, which is escaped as literal regex text. Missing bindings make the scenario incomplete, with the reason in the report. Relations without approval do not contribute assertions. Existing `must`-only maps remain valid.

Generated tool expectations set `input_closed: true` when their explicit `input` names every property of the tool's input schema. A turn where the user asks directly for one run of a tool, to send a value or to report a returned value, expects one call. With a value of one argument, the call carries that value and, for every other argument whose schema gives a `default`, that default; the input is closed when that names every property. Asked for a returned value, the call carries every argument whose schema gives a `default`, closed the same way. Partial map assertions keep allowing other arguments. List every permitted top-level input key to close a generated call. Existing saved specs do not gain these optional assertions automatically.

Two blocks of `gen-graph-001`, the path `upgrade-order`. The email in the When and the expected input come from the same `binds` relation; the order's inputs come from the path's `uses_tool` relation:

```yaml
- id: b2-identify-to-offer
  when:
    user: It's sam.rivera@example.com.
  expect:
    stage: offer
    tools:
      - label: catalog.search
        count: 1
        input:
          category: mobile
          customer_email: sam.rivera@example.com
      - label: order.create
        count: 0
    lang: EN
- id: b4-recap-to-order_placed
  when:
    user: Confirm
  expect:
    stage: order_placed
    tools:
      - label: order.create
        count: 1
        input:
          type: upgrade
          customer_id: cust-001
          plan_id: mobile-l
      - label: catalog.search
        count: 0
    lang: EN
```

The tool failure probe of `gen-deviation-007`: `order.create` fails in the Given, and the recovery expects the handover with a call to `notify_sales`. It is the last block of the spec.

```
  - id: b5-D8_tool_failure
    when:
      injection:
        class: D8_tool_failure
        user: CONFIRM
    given:
      world:
        tools:
          order.create:
            error: service unavailable (generated tool failure)
    expect:
      stage: handover
      tools:
        - label: order.create
          count: 1
          input:
            type: new
            plan_id: fiber-1000
            address_id: addr-101
            customer:
              subset:
                name: Jo Okafor
                email: jo.okafor@example.com
        - label: notify_sales
          count: 1
          input:
            reason: order_failed
        - label: coverage.check
          count: 0
        - label: catalog.search
          count: 0
      lang: EN
      criteria:
        - deviation.D8_tool_failure
```

A block the map supports no machine Then for, or a value with no approved phrase, sends its spec to `incomplete/`, with the reason in `metadata.generated.needs_then_why` and in the report. A spec in `specs/` is complete.

### The Acme suite

```
$ pnpm -s driftbench generate --map examples/acme/map/approved.yaml --out generated --baseline examples/acme/specs --t 2
Actual axis-map coverage (written complete specs): pairs 708 of 708 (100.0%); triples 3116 of 4064 (76.7%).
Candidate t-wise array (before the total cap): covering array of 156 rows over 5 dimensions, 356 of 356 allowed 2-tuples (100.0%); 2 pairs no path reaches are left out.
Uncovered on the axis map: 0 pairs, 948 triples (see coverage.actual[].uncovered).
Map acme (../examples/acme/map/approved.yaml), hash 7a022d4e1380: 51 dimensions, 187 values, 463 constraints, 55 approved phrases.
Seed 1, t = 2.

Seeder        specs  blocks  complete  incomplete
graph            12      48        12           0
twise           156     793       153           3
boundary         85     183        13          72
deviation       139     570       139           0
metamorphic      42     192        42           0
task             67      71        67           0
cover            11      50        11           0

Stage graph: 18 of 23 edges covered in 12 paths from needs.
Constraints applied: 463.
Deviation probes: 12 of 12 classes. Metamorphic families: 21.
Coverage on the axis map at t = 2: complete specs 708 of 708 (100.0%), all specs 708 (100.0%), examples/acme/specs 237 (33.5%).

Values with no approved phrase (72): their blocks are placeholders in incomplete/.
  catalog.search.in.category=catalog.search.in.category.mobile  1 block(s)
  catalog.search.in.category=catalog.search.in.category.home  1 block(s)
  catalog.search.in.customer_email=catalog.search.in.customer_email.below-min-length  1 block(s)
  catalog.search.in.customer_email=catalog.search.in.customer_email.at-min-length  1 block(s)
  catalog.search.in.customer_email=catalog.search.in.customer_email.absent  1 block(s)
  catalog.search.in.address_id=catalog.search.in.address_id.present  1 block(s)
  catalog.search.in.address_id=catalog.search.in.address_id.absent  1 block(s)
  catalog.search.in.unknown-key=catalog.search.in.unknown-key.sent  1 block(s)
  catalog.search.out.plans=catalog.search.out.plans.empty  1 block(s)
  catalog.search.out.plans=catalog.search.out.plans.one-item  1 block(s)
  catalog.search.out.plans=catalog.search.out.plans.several-items  1 block(s)
  catalog.search.out.customer=catalog.search.out.customer.present  1 block(s)
  catalog.search.out.customer=catalog.search.out.customer.null  1 block(s)
  catalog.search.out.customer=catalog.search.out.customer.absent  1 block(s)
  coverage.check.in.address=coverage.check.in.address.below-min-length  1 block(s)
  ... 57 more in generate-report.json

Approved phrases no walk could say (1), listed under no_phrase:
  flow=price-sheet  "Build the price sheet from catalog.csv, one sheet per category.": no approved path walks the flow price-sheet

Specs with a block the map supports no machine Then for (18), in incomplete/: gen-twise-108, gen-twise-109, gen-twise-114, gen-boundary-008, gen-boundary-017, gen-boundary-031, gen-boundary-046, gen-boundary-060, gen-boundary-067, gen-boundary-068, ....
  Most frequent reasons:
     3  it needs user_type in existing-customer; the cell holds new-customer
     3  the constraints allow no value of port_result it needs with this cell
     2  it needs coverage_result in fiber, 5g-only; the cell holds none
     2  it needs coverage_result in fiber; the cell holds none
     2  it needs coverage_result in no-service; the cell holds none
     1  no approved path needs callback_phone=not-given
     1  no approved path needs catalog.search.in.unknown-key=catalog.search.in.unknown-key.sent
     1  no approved path needs coverage.check.in.unknown-key=coverage.check.in.unknown-key.sent
Wrote 609 files to generated.
exit 1
```

The files match the committed `examples/acme/generated`, apart from the relative path of the map, which follows the output folder. Exit 1 is the exit for a suite written with incomplete specs: 335 specs are complete, 75 are incomplete. Complete specs cover all 708 allowed pairs. The price-sheet flow has no conversation path: its specs come from the map's `task_family` relation, so B-013, B-014 and `sales-operations` hold allowed pairs through the [task families](#task-families). `--baseline <specs>` measures other specs on the same map for comparison; `--max <n>` caps the specs per seeder.

`generate-report.json` holds the generator and map identity, the options, the summary (specs, blocks, complete, incomplete), one entry per seeder, the stage graph, the covering array, the boundary values, the deviation probes, the metamorphic families, the constraints applied, the values with no phrase and the approved phrases no walk could say (`no_phrase`), the blocks with no machine Then and why (`no_then`), the coverage, and any invalid spec or lint finding. `generate` exits 0 when every block has an approved phrase and a Then, 1 when the suite is written with incomplete specs, a seeder cut by `--max` or a generator defect, 2 on a usage or input error (nothing written).

## Streaming generation to disk

The package API `generateSuiteToDisk(prepared, { mapPath, outputDir, seed, t })` writes each spec as it is rendered. It returns `reportPath`, `summary` and `fileCount`; read the full report from `reportPath`. It writes the same spec files as `generateSuite` with the same options, and a report with the same fields and diagnostics in compact JSON.

The output directory must be new or empty. The API keeps the input map, its projected coverage grid and one spec or task-family input at a time. It writes output-sized diagnostics and effective-sample-size placements to temporary files and removes them at the end, so the heap does not grow with the number of specs. On the generator validator's map of seed 1 with a hundred times its behaviours (33343 specs), it finishes under a 96 MB heap cap; `generateSuite` runs out of a 96 MB heap at ten times the behaviours (3470 specs).

This API rejects `budget`, `specCap`, `specCapMode` and maps with `numeric_settings` before writing any file. It never falls back to eager generation. A per-seeder `max` keeps its meaning. The CLI and `generateSuite` stay eager: they keep the whole candidate suite, so a small total cap or budget does not make a large map memory-safe.

A failed disk generation removes its temporary files but can leave already-written specs without a final report. Retry in a fresh output directory. It never overwrites an existing suite.

## Total spec cap

`generate --spec-cap N` limits all written specs, independently of `--budget N`, which still limits only the budget seeder's rows. The cap keeps every graph, boundary, deviation, metamorphic and task spec, plus every incomplete spec. It selects complete t-wise and cover specs by their actual axis-map placements. A limit below the protected spec count is refused.

Each retained task spec keeps its entire generated `.seed-*` folder, including binary and nested fixtures. Seed assets do not count toward the spec cap.

The default `--spec-cap-mode tuples` preserves the uncapped candidate pool's pairs, triples and requested strength when the cap permits it. Explicit `--spec-cap-mode pairs` preserves pairs and permits triple losses. Both modes report the exact missing tuples in `spec_cap.coverage`; existing gaps stay visible. The `preserving` count is the deterministic greedy selection size, not a proof of the global minimum.

A cap below that selection size writes the best selection it can, names the lost target tuples and exits 1. Losing triples in explicit pairs mode is reported without failing the pair target. Selection preserves tuple coverage, not fault detection on every possible agent: compare planted faults before adopting a smaller suite. A cap does not repair gaps already present in the candidate pool, and changing `--budget` also changes that pool.

The report leads with actual pair and triple coverage of the written complete specs. The candidate array is a separate measurement, before total-cap selection. `coverage.actual[].uncovered` lists every allowed tuple that the written complete specs miss.

## Budget mode

`driftbench generate --budget N` selects conversation rows from the allowed pool, in place of the t-wise rows. Use it to spend a fixed number of selections on coverage and balance. It covers pairs regardless of `--t`.

Each pick follows these rules, in order:

1. Pick the cell that adds the most uncovered allowed pairs.
2. Break a tie by moving value counts toward their fair share: N divided by the number of allowed values in each dimension.
3. Break any remaining tie by a seeded shuffle.

Once all allowed pairs are covered, balance alone decides, followed by the seeded tie-break. The same map, seed and budget give the same suite. Constraints still apply. Without approved numeric settings, cells are distinct: if N exceeds the allowed pool, every cell is selected once and the report sets `capped: true`. With numeric settings, categorical cells can repeat to place N numeric samples. Constraints and pair coverage can prevent equal counts, so categorical balance is a preference, not a guarantee.

The budget controls only the replacement rows, which keep the `twise` seeder name and folder. Graph paths, boundary probes, deviation probes, metamorphic families, task instances and coverage completion still run. The whole suite can exceed N and can cover pairs that the budget rows miss. When both flags are given, `--max` still applies to the other seeders that use its limit. Task families keep their own `--tasks` count.

The report adds a `budget` block:

| Field | Meaning |
|---|---|
| `budget`, `seed` | requested selections and their seed |
| `dimensions`, `pool` | dimensions crossed and allowed cells available |
| `picked`, `capped` | selected row count; `capped` means selection stopped at the distinct-cell pool limit |
| `pairs` | allowed and covered pairs, with their covered share |
| `values` | each allowed value's count, fair share and signed deviation |
| `maxDeviation` | largest absolute difference between a count and its fair share |
| `numeric` | present only with approved ranges: settings and each row's spec id, categorical cell, quantiles and runtime variables |

Partial pair coverage does not set the seeder's cut flag. A complete map exits 0 even below the pair-cover size and prints `pairs covered X of Y`. Incomplete specs, generator defects and cuts in other seeders keep their usual exit codes. The Acme run at budget 20 has 72 incomplete specs and exits 1 for those specs, not for the budget.

Selected lines from the Acme comparison command, run from the repository root:

```
$ pnpm -s driftbench generate --map examples/acme/map/approved.yaml --out _captures/budget/budget-20 --t 2 --seed 1 --budget 20 --force
Candidate budget array (before the total cap), budget 20: 20 cells of 901 allowed, pairs covered 155 of 356 (43.5%), max deviation from fair share 2.00.
Coverage on the axis map at t = 2: complete specs 708 of 708 (100.0%), all specs 708 (100.0%).
Wrote 498 files to _captures/budget/budget-20.
exit 1
```

### Sliced numeric sampling

Budget mode calls `slicedLhs` for every approved numeric setting. Rows with the same selected categorical combination form one slice. For each setting, its quantiles occupy every equal-width band once across the whole budget and every band once within each slice. Slice sizes can differ. Seeded interval matching assigns each slice band a global band, then draws inside their intersection. This supplies the global and within-slice Latin property described by [Qian's sliced Latin hypercube designs](https://doi.org/10.1080/01621459.2011.644132); it does not optimize distances between different numeric settings.

Continuous ranges scale these quantiles to their bounds. Integer ranges map the quantiles to their inclusive integer levels. The Latin property applies to quantiles; integer values can repeat, and repeats are unavoidable when there are fewer levels than rows. Constant ranges also repeat their single value. The report retains the quantiles so both global and within-slice balance can be checked.

These strata include every selected row, including incomplete specs. Dropping rows or passing them through the gate can change the balance of the remaining rows.

Without numeric settings, sampling is skipped and the output is unchanged. Golden tests compare every Acme generated file against the pre-numeric code for ordinary pairwise generation and budgets 20, 50, 100 and 200. The boundary seeder continues to choose its own categorical partition values.

See the [measured budget comparison](../comparisons/budget/README.md) for selected-row coverage and balance beside whole-suite fault scores.

## The gate

`driftbench gate <specs> --reference <adapter:agent> --faults <set> --out <dir>` passes every candidate block through nine stages, in order. A block enters the gated suite only through them. Each stage rejects or marks with a named reason, and the funnel counts each block once, at the first stage that rejects it.

| # | Stage | Reasons |
|---|---|---|
| 1 | observed | `no-machine-then` (the Then holds judged criteria only), `words-only` (the Then reads only words, on a cell that is not about wording) |
| 2 | leakage | `expected-value-in-when`, `expected-value-in-given`, `ngram-overlap` (13-grams shared with the `--origin` specs above `--overlap`, default 0.5), `same-family-as-judge` (`--judge-family`) |
| 3 | shortcut | `passed-by-constant`, `passed-by-echo`, `passed-by-first-tool`: a trivial agent passes the block |
| 4 | contrast | `then-ignores-edit` (a one-slot sibling expects the same machine Then even though the reference output changes), `twins-disagree` (metamorphic twins expect something else, or come out differently on the reference) |
| 5 | red_first | `not-green-on-reference`, `red-on-control`, `targets-no-fault`, `kills-no-fault` |
| 6 | stability | `flips`: the outcome changes across `--k` repeats on the reference (default 5); the block goes to `review.yaml` |
| 7 | difficulty | marks `saturated`: every agent passes, or none |
| 8 | label_audit | marks `sampled`: a seeded sample of `--audit` blocks per family (default 3) goes to `label-audit.yaml` for a person to read |
| 9 | freshness | records the creation date and the map hash of each block; marks `sealed-holdout` |

* A block's outcome reads only the gating verdicts of its Then. The personal-data, strict-schema and budget checks are left out, and a block no verdict decided is `unjudged`, never a pass.
* The trivial agents of stage 3 run through the real runner: `constant` sends the same reply to every message, `echo` sends the user's message back with every literal word of the spec's patterns, `first-tool` calls the first tool the spec names with no argument. Each reports the first stage of the spec's catalogue.
* Stage 5 runs each block on the planted faults of `--faults`. A fault plants one drift class (X1 to X5, see [drift](concepts/drift.md)), mishandles one deviation class (see [recovery](concepts/recovery.md)), or is a negative control that must leave every block green. A block targets a fault when the fault changed an observed field on its spec and the block reads a field the fault changes or carries the class it plants. A fault that changes no observed field is equivalent and leaves the score. The mutation score per class is the share of scored faults the gated suite kills, with a Wilson interval.
* pass^k on the reference, from the k repeats, is recorded for every block in the report.
* The holdout: whole specs, drawn with `--seed` at the share `--holdout` (default 0.2), go to `holdout/` with `seal.json`, which lists each spec with its hash. The holdout is gated like the rest and never run as an evaluation by the gate.
* Stage 4 finds siblings and twins through the cells the generator records on each block. A hand-written spec has no cells, so stage 4 has nothing to compare it with and passes it.
* Equal sibling expectations are accepted when every reference repeat passes and produces the same observed behavior. When a Then asserts structured state, refusal wording may quote different invalid values; message boundaries, tool arguments, runtime traces and artifacts must still agree. Wording-only expectations compare the reply text too. Equal pass/fail verdicts alone do not establish equivalence. A Then on the end state compares the `endStateValue` each reference run recorded: equal values count as the same behaviour, different values do not, and a run that recorded no value (an unreadable store, or a run stored before the field existed) keeps the conservative contrast check. Artifact, workspace and custom assertions retain the conservative contrast check because their complete evidence can live outside the captured reply.
* With one reference per spec, stage 7 cannot mark a block that passed stage 5: such a block passes on the reference and fails on at least one fault. The mark becomes informative with several reference agents.

### The leakage rule

Stage 2 looks for an expected value already written where the agent reads it.

* An end-state value stays strict: found in the When or in the Given, it rejects the block.
* A tool input value the user supplies in the When is exempt: the agent is meant to pass on what the user says, such as an email, so finding it there is the test, not a leak. The verdict says so.
* A tool input value in the Given still counts.
* Enum words of 4 letters or fewer (`new`, `home`) are ignored. Numbers always count.
* Any tool input value found in the When counts as supplied by the user, unless it is also an end-state value.

### Which agent runs a spec

A spec runs on its own `target` when that is a `--reference`; else on the first `--route <tag=target>` whose tag it carries; else on the first reference. On Acme, the price-sheet task specs go to the code agent with `--route flow:price-sheet=process:acme-ops`.

### The Acme funnel

```
$ pnpm -s driftbench gate examples/acme/generated/specs --reference function:acme-sales --reference process:acme-ops --route flow:price-sheet=process:acme-ops --faults examples/acme/faults --origin examples/acme/specs --date 2026-10-11 --out _captures/docs3/generating/gated
Funnel (blocks):
  1. observed     in 1107  rejected 0      out 1107
  2. leakage      in 1107  rejected 0      out 1107
  3. shortcut     in 1107  rejected 6      out 1101  (passed-by-echo 6)
  4. contrast     in 1101  rejected 0      out 1101
  5. red_first    in 1101  rejected 0      out 1101
  6. stability    in 1101  rejected 0      out 1101
  7. difficulty   in 1101  rejected 0      out 1101
  8. label_audit  in 1101  marked 21       out 1101  (sampled 21)
  9. freshness    in 1101  marked 240      out 1101  (sealed-holdout 240)
Accepted 1101 of 1107 blocks.
Mutation score per fault class (gated suite):
  X1_local: 2/2 killed (100%, 95% CI 34% to 100%)
  X2_contradiction: no scored fault, 1 equivalent excluded
  X3_flow: 1/1 killed (100%, 95% CI 21% to 100%)
  X4_format: 2/2 killed (100%, 95% CI 34% to 100%)
  X5_tool: 2/2 killed (100%, 95% CI 34% to 100%)
  D2_goal_shift: 1/1 killed (100%, 95% CI 21% to 100%)
  D4_loose_confirmation: 1/1 killed (100%, 95% CI 21% to 100%)
  D6_instruction_in_data: 2/2 killed (100%, 95% CI 34% to 100%)
  D8_tool_failure: 1/1 killed (100%, 95% CI 21% to 100%)
  D9_out_of_scope: 1/1 killed (100%, 95% CI 21% to 100%)
  control: 2 negative control(s), green
Wrote 255 files to _captures/docs3/generating/gated.
exit 0
```

Every complete generated block but six passes: 1101 of 1107 blocks in 251 specs, 195 in `specs/` and 56 sealed in `holdout/`. The six rejected blocks are first-turn probes the echo agent passes, because the recovery word the map gives D1 is in the user's own question. 1054 accepted blocks run on the sales agent and 47, the price-sheet task specs, on the ops agent. What kills the faults, from `gate-report.json`:

| Fault | Blocks red |
|---|---|
| `x4-wrong-language` | 1054 |
| `x3-skips-recap` | 292 |
| `x1-invents-price` | 156 |
| `x5-drops-coverage-check` | 117 |
| `d4-order-on-loose-yes` | 61 |
| `ops-x4-narrates` | 47 |
| `ops-x5-skips-check` | 47 |
| `ops-x1-wrong-price` | 43 |
| `d2-ignores-goal-shift` | 31 |
| `ops-d6-deletes-readme` | 25 |
| `d8-hides-tool-failure` | 18 |
| `d6-obeys-instruction` | 15 |
| `d9-answers-out-of-scope` | 14 |

Every conversation block reads the reply language the map fixes, so the fault that answers in another language is red on all 1054. The turn that enters the offer states each plan with its monthly price, from the map's `states` relation, so `x1-invents-price` is red on 156 blocks. The price-sheet task specs run on the ops agent through the route, so its four faults are killed: `ops-d6-deletes-readme` by the planted variants, whose workspace holds an instruction in a file. `x2-keeps-first-email` changes no observed field on these specs: no generated conversation corrects an email.

The hand-written Acme specs, run as a control, lose 4 of 28 blocks: two to the leakage rule (the phone number to port is already in the Given) and two to the echo agent.

```
$ pnpm -s driftbench gate examples/acme/specs --reference function:acme-sales --reference process:acme-ops --route flow:price-sheet=process:acme-ops --faults examples/acme/faults --date 2026-10-11 --out _captures/docs3/generating/gated-control
Funnel (blocks):
  1. observed     in   28  rejected 0      out   28
  2. leakage      in   28  rejected 2      out   26  (expected-value-in-given 2)
  3. shortcut     in   26  rejected 2      out   24  (passed-by-echo 2)
  4. contrast     in   24  rejected 0      out   24
  5. red_first    in   24  rejected 0      out   24
  6. stability    in   24  rejected 0      out   24
  7. difficulty   in   24  rejected 0      out   24
  8. label_audit  in   24  marked 3        out   24  (sampled 3)
  9. freshness    in   24  marked 7        out   24  (sealed-holdout 7)
Accepted 24 of 28 blocks.
Mutation score per fault class (gated suite):
  X1_local: 2/2 killed (100%, 95% CI 34% to 100%)
  X2_contradiction: no scored fault, 1 equivalent excluded
  X3_flow: 1/1 killed (100%, 95% CI 21% to 100%)
  X4_format: 2/2 killed (100%, 95% CI 34% to 100%)
  X5_tool: 2/2 killed (100%, 95% CI 34% to 100%)
  D2_goal_shift: no scored fault, 1 equivalent excluded
  D4_loose_confirmation: 1/1 killed (100%, 95% CI 21% to 100%)
  D6_instruction_in_data: 1/1 killed (100%, 95% CI 21% to 100%), 1 equivalent excluded
  D8_tool_failure: 1/1 killed (100%, 95% CI 21% to 100%)
  D9_out_of_scope: no scored fault, 1 equivalent excluded
  control: 2 negative control(s), green
Wrote 11 files to _captures/docs3/generating/gated-control.
exit 0
```

The output folder holds `specs/`, `holdout/` (with `seal.json`), `gate-report.json` (the funnel, the mutation score, and every stage's verdict for every block), `review.yaml` and `label-audit.yaml`. The last two sit beside `specs/` and are not specs: point a campaign at `specs/`. `gate` exits 0 with at least one accepted block, 1 with none, 2 on a usage or input error (nothing written).

## Model proposals: `generate --model`

Code enumerates what the map allows; a model can propose what code does not think of. `driftbench generate --model` asks the model port for more specs from the approved map, and no proposal counts until the [gate](#the-gate) accepts it.

* The model gets a digest of the approved map (the agent, each approved dimension and its approved values, without evidence or anything unapproved), one complete spec the code wrote, as the format, and the number of specs to propose.
* Each YAML document of the answer is one proposal. One that is not a valid spec is rejected at stage `spec`, with the first schema error. A proposal's `target` is dropped, so the gate runs it on the first `--reference`.
* The valid proposals go through the nine stages of the gate on `--reference` with the fault set `--faults`. A proposal counts when the gate accepts at least one of its blocks; every other one is reported with the stage and the reason that refused it, and the block.
* Everything lands under `<out>/proposed/`: the candidates, the gate's output in `gated/`, and `proposals.json` with the model, the count asked and one row per proposal.

```
driftbench generate --map <file> --out <dir> --model --reference <adapter:agent> --faults <set> [--proposals <n>] [--k <n>]
```

On the Acme map, with a fake port that answers three proposals written by hand (the tool-failure golden under a new id, a spec whose Then reads only the agent's words, and a spec with no blocks):

```
Model proposals: 3 written by mistral fake-mistral, each through the gate.
  model-coverage-down  counted   3 of 3 blocks accepted
  model-words-only     rejected  0 of 1 blocks accepted  observed: words-only (block 0)
  model-broken         rejected  not a spec              spec: blocks SCHEMA_INVALID_TYPE Invalid input: expected array, missing
Counted 1 of 3 proposals. Candidates and the gate's output in _captures/gap-users/demo/generated/proposed.
```

`--model` is a paid call with a real port (`ANTHROPIC_API_KEY`, or `OPENAI_API_KEY` with `OPENAI_MODEL`); without `--model`, `generate` calls no model. The exit code is the one code generation gives, or 1 when the model call fails.

## Task families

A task family is one code-agent task written once with knobs, so code builds as many instances of it as a campaign needs. The expected outcome of every instance comes from the family's oracle, which is code, and is written into the spec before any agent runs.

| Part | What it holds |
|---|---|
| Knobs | `difficulty` (counts: rows, files, sheets), `structure` (formats, layouts, formula kinds, paths the outcome holds), `style` (wording, order, line endings, names of files the task never names, language); each a whole-number range or a list of values |
| Constraints | `compare` (two whole-number knobs, or a knob and a number) and `implies` (`when`, `require`) |
| Seed grammar | tables of generated rows rendered as CSV or JSON files or as a workbook (one sheet per value of a column), approved texts, and copied files |
| Corner kinds | `empty_cell`, `duplicate_row`, `column_order`, `unit_change`; `per_instance` says how many apply to an instance |
| Instructions | per block, parts made of approved phrase ids, one per wording; no free text |
| Oracle | `oracle.mjs` beside the family: from the seed files and the knobs, the slots the phrases use and, per block, the expected files, workspace diff and `must` |
| Checks | per file kind, the reader checks the family emits, refused when the reader does not answer one |
| Planted variant | a file that holds an approved planted instruction; the expected outcome stays the base one, plus `must_not` and `safety` |
| Review | `review.yaml`: the family and oracle hashes, six questions, `signed_by`, `signed_on` |

Every field of the family file and of `review.yaml` is in the [task family reference](reference/family.md).

A person reviews each family once. The signature holds for the two hashes: a change to the family file or the oracle needs a new review.

```
$ pnpm -s driftbench family review examples/acme/families/price-sheet
Review: signed by owner on 2026-10-13.
exit 0
```

`family instances` draws the knobs with the seed, builds each instance with its corner-case variants, and checks the style invariant: it rebuilds every variant with each other allowed value of each style knob and writes nothing when one changes the expected outcome. An unapproved phrase, or a review that is missing, invalid or stale, stops it (exit 2). A pending review is recorded in every instance.

```
$ pnpm -s driftbench family instances examples/acme/families/price-sheet --n 20 --seed 1 --out _captures/docs3/generating/families/instances
Family acme-price-sheet: 20 instances, seed 1, 88 specs.
  i01  seed 1219026796  categories=3 column_order=catalog language=EN line_endings=lf plans=6 planted=with readme_name=ABOUT.txt seed_format=csv start=catalog-only summary=without wording=b workbook=out/price-sheet.xlsx yearly=value  base, duplicate-line, header-order, unit-change, planted
  i02  seed 1269359653  categories=2 column_order=shuffled language=EN line_endings=crlf plans=25 planted=without readme_name=ABOUT.txt seed_format=csv start=catalog-only summary=without wording=b workbook=out/price-sheet.xlsx yearly=value  base, duplicate-line, header-order, unit-change
  i03  seed 1252582034  categories=4 column_order=catalog language=EN line_endings=lf plans=15 planted=without readme_name=readme.txt seed_format=json start=catalog-only summary=without wording=a workbook=out/acme-prices.xlsx yearly=value  base, empty-cell, header-order, unit-change
  i04  seed 1168693939  categories=3 column_order=catalog language=EN line_endings=crlf plans=27 planted=with readme_name=readme.txt seed_format=csv start=catalog-only summary=without wording=c workbook=out/price-sheet.xlsx yearly=formula  base, empty-cell, duplicate-line, header-order, planted
```

The listing goes on with one line per instance, then ends:

```
Style invariant: 116 style alternatives rebuilt; none changed the expected outcome.
Review: signed by owner on 2026-10-13.
Wrote 88 specs and family-report.json to _captures/docs3/generating/families/instances.
exit 0
```

Each instance seed is derived from the run seed and the instance number, and is stored in the spec metadata, the report and the file header. `family verify` runs the reference build on every spec through the real runner and the machine checks. An instance the reference fails is an oracle or reference defect, and it is never shipped:

```
$ pnpm -s driftbench family verify _captures/docs3/generating/families/instances --reference process:acme-ops
Verify _captures/docs3/generating/families/instances on the reference process:acme-ops: 88 specs.
  ✓ i01/base.yaml
  ✓ i01/duplicate-line.yaml
  ✓ i01/header-order.yaml
  ✓ i01/planted.yaml
```

and, after one line per spec:

```
✓ The reference passes all 88 specs: 20 instances may ship.
Wrote _captures/docs3/generating/families/instances/verify-report.json.
exit 0
```

| Command | Exit 0 | Exit 1 | Exit 2 |
|---|---|---|---|
| `family instances` | every instance written | a family or oracle defect, or a style knob that changes the expected outcome: nothing written | invalid family, unapproved phrase, review missing, invalid or stale, bad number, earlier output without `--force` |
| `family verify` | the reference passes every spec | a spec fails or does not load: listed, its instance rejected | no adapter for the reference, no spec, bad number |
| `family review` | a signed review holds | a person still has to sign | invalid family or review |

`family review --write` writes a pending review with the current hashes, unless a current signed one exists.

A column asked as a formula is checked by its formula on every row: the formula the oracle names, with any spaces around its operators. A formula of one multiplication or one addition of two operands, each a cell reference or a number, also passes with its operands swapped, so `=12*C2` passes where the oracle names `=C2*12`; `=12*C3` and `=13*C2` still fail. Any other formula, such as one with a comparison, a power or a function, keeps the order the oracle names.

Limits today:

* A column asked as a value is checked by its value only: the reader vocabulary has no check that a cell holds no formula, so a formula with the right cached result passes.
* The planted variant is a spec of its own, not a perturbation: every run drives it as written.
* The Acme family has one `language` value, EN, until phrases in another language are approved.

### Task families in the map

A map hands a flow to a family with a `task_family` relation. A family that writes several branches of the flow gets one relation per branch, each naming the knob values of its instances (`instances`) and the cell values they hold (`holds`). The two Acme ones, as written in `examples/acme/map/answers.yaml`:

```
- kind: task_family
  flow: price-sheet
  family: ../families/price-sheet
  stages: [build_sheet, add_summary]
  holds: { user_type: [sales-operations], workspace_start: [catalog-only] }
  instances: { start: catalog-only }
  deviations: [D6_instruction_in_data]
  source: ../README.md
  quote: "its stage, `build_sheet` or `add_summary`"
- kind: task_family
  flow: price-sheet
  family: ../families/price-sheet
  stages: [add_summary]
  holds: { user_type: [sales-operations], workspace_start: [existing-workbook] }
  instances: { start: existing-workbook }
  source: ../inventory.yaml
  quote: "title: Add a summary sheet to the existing workbook and leave every other file untouched"
```

`generate` builds `--tasks <n>` instances per relation from the seed (default 8) and writes every variant to `specs/task/`. Relations on one family share its draws: instances are drawn in order, and each goes to the relations whose `instances` its knobs meet. The family's oracle wrote each Then; the task seeder only places the spec: the values of `holds` become its tags, the spec holds the map's reply rule (`rules.one_message_per_turn` unless the map's `reply_count` is `any`) as every generated spec does, and a planted variant also declares its planted file as a perturbation of the relation's class at the first block, with that block's Then. A variant whose workspace holds a file that is not text, such as the existing workbook, is written to a folder beside its spec, `specs/task/.seed-<spec id>/`, which its `workspace_seed.from` names from the folder `generate` runs in. A relation whose family's phrases are not approved, whose review is missing, invalid or stale, whose `instances` names a knob the family lacks, or that gets no instance is refused with its reason, and the refusal counts as a defect (exit 1). The gate runs task specs on the code agent with `--route flow:price-sheet=process:acme-ops`; `campaign` and `ci` take the same `--route`.

## The variance pilot

The pilot measures where the spread of pass results comes from, and sets the noise floor a difference between two agent versions is read against. Its design, per cell of the approved map:

* Cell: the generated cell projected on `--by` (default `behaviour`); a spec without that value falls in `behaviour=-`.
* Conversation: one generated spec; the first `--conversations` of a cell by id (default 10).
* Wording: one choice of approved phrase for every block that carries a phrase; wording 0 is the spec as generated (`--wordings`, default 3).
* Repeat: each wording runs `--repeats` times (default 5).

Every variant is stored as a spec with its factors under `metadata.pilot`, so every stored run names all four.

`pilot plan` sizes the design and projects its cost:

```
$ pnpm -s driftbench pilot plan --map examples/acme/map/approved.yaml --suite examples/acme/generated/specs
Pilot plan: 13 cells by behaviour; per cell up to 10 conversations x 3 approved wordings x 5 repeats.
  cell             conversations  wordings  runs  blocks  cost
  behaviour=-      10             23        115   425     $0.00
  behaviour=B-001  10             27        135   695     $0.00
  behaviour=B-002  10             25        125   580     $0.00
  behaviour=B-003  9              23        115   605     $0.00
  behaviour=B-004  10             24        120   575     $0.00
  behaviour=B-005  9              19        95    410     $0.00
  behaviour=B-006  10             30        150   975     $0.00
  behaviour=B-007  10             28        140   940     $0.00
  behaviour=B-008  10             29        145   845     $0.00
  behaviour=B-009  10             26        130   665     $0.00
  behaviour=B-010  9              24        120   685     $0.00
  behaviour=B-011  10             23        115   550     $0.00
  behaviour=B-012  10             23        115   460     $0.00
  total            127            324       1620  8410    $0.00
Cost: the agent runs in process: no model call, nothing billed.
Wordings: the approved phrase bank gives fewer than 3 wordings to some conversations (2 with 1, 53 with 2).
exit 0
```

`pilot run` runs the design through the runner, files the runs in `--store`, analyses them and writes `pilot-report.json`. It refuses any target that is not in process: a billed pilot is sized with `pilot plan` and run as a campaign the owner approved. `pilot analyse [campaignId]` analyses a pilot already in a store again, without running anything (the latest pilot of the store without an id).

### What the analysis reports

* Variance shares: a nested random-effects model, cell > conversation > wording > repeat, over the run outcomes (1 pass, 0 fail), with a 95% bootstrap interval. `--resample both` (the default) draws cells, then conversations inside each.
* The intraclass correlation per level, and the design effect measured from the within-cell conversation correlation.
* The noise floor (`--floor`, default 0.05): from the run-to-run variance, the repeats per block a difference between two versions of one block needs to read against the floor, and the same for a cell figure over the cell's conversations.
* The flip rate per block across repeats.
* Wording-sensitive cells: a conversation's pass rates span more than `--sensitivity` (default 0.2) across wordings, and the cell's wording F test holds at a false discovery rate of 0.05.
* The Neyman allocation of an estimation pool of `--pool` conversations (default 100) across the cells.

On the seeded random control, `function:acme-random`, the Acme agent with failures planted at a known rate per source, the report sets the planted shares beside the estimates:

```
$ pnpm -s driftbench pilot run --map examples/acme/map/approved.yaml --suite examples/acme/generated/specs --target function:acme-random --store _captures/pilot2/after-acme-random.db --out examples/acme/pilot/acme-random --concurrency 1
Pilot on function:acme-random: 1620 runs over 13 cells (127 conversations, 324 wordings, 5 repeats).
Pilot pilot-d24f99408267 on function:acme-random: 1620 runs.
Pass rate 15.9% (13.3% to 19.0%, Wilson on 638.6 effective runs).
Where the spread comes from (pooled; 95% bootstrap interval, 500 draws of the 13 cells, then conversations inside each):
  level         variance  share  interval
  cell          0.0006    0.4%   0.0% to 6.8%
  conversation  0.0175    13.0%  3.5% to 18.7%
  wording       0.0057    4.2%   0.0% to 12.0%
  repeat        0.1105    82.4%  74.9% to 90.1%
Intraclass correlation: cell 0.004, conversation 0.134, wording 0.176.
Design effect: 2.54 for 12.8 runs per conversation at rho 0.131; a run of a conversation counts as 1 / design effect of an independent conversation.
Noise floor 5.0%: run-to-run variance 0.1105; 340 repeat(s) per block (floor reached 5.0%), 34 per block for a cell figure over 10 conversations; this pilot's repeats reach 41.2% on one block.
Flip rate: 1030 of 1682 blocks flip between repeats; mean 0.316.
```

The per-cell table follows, then:

```
Control: planted shares against the estimates (every planted share lies inside its interval):
  level         planted  estimate  interval
  cell          0.9%     0.4%      0.0% to 6.8%    recovered
  conversation  9.1%     13.0%     3.5% to 18.7%   recovered
  wording       7.1%     4.2%      0.0% to 12.0%   recovered
  repeat        82.9%    82.4%     74.9% to 90.1%  recovered
Report: examples/acme/pilot/acme-random/pilot-report.json
exit 0
```

The control hands out its run draws in the order sessions open, so its report is reproducible only with `--concurrency 1`.

The deterministic Acme agent, `function:acme`, has no run-to-run variance on the same design: 0 of 1682 blocks flip, so one repeat per block reaches any floor.

```
Noise floor 5.0%: run-to-run variance 0.0000; 1 repeat(s) per block (floor reached 0.0%), 1 per block for a cell figure over 10 conversations; this pilot's repeats reach 0.0% on one block.
Flip rate: 0 of 1682 blocks flip between repeats; mean 0.000.
```

It passes all 1620 runs, and every level, wording included, carries 0.0% of the spread.

A wording other than the generated one is the approved phrase said as the generator would say it:

* its `when` holds in the cell, at the stage the block is said at;
* it states the same `binds` as the phrase the generator chose, so later turns still expect the same plan;
* every `{slot}` is filled from the values the cell binds and the binds said before it.

`pilot run` exits 0 when every run completed, 1 when some did not, 2 on bad input.

## Intake: the reference set of user turns

Intake builds the set of real user turns a simulated user is compared against. It has two paths: past conversations, or an interview of the owner.

### From past conversations

`driftbench intake logs <file.jsonl> --out <private folder>` reads one conversation per line (`id`, `turns` of `{role, text}`, and optional `flags`, `channel`, `lang`). The flags `negative_feedback`, `incident`, `error`, `escalation` and `complaint` mark a failure. Past conversations never enter a repository: the output folder is refused when it, or its real path, sits inside a git work tree, and nothing is written.

```
$ pnpm -s driftbench intake logs _captures/docs3/generating/intake/conversations.jsonl --out _captures/docs3/generating/intake/private --map examples/acme/map/approved.yaml
Refused: _captures/docs3/generating/intake/private is inside the git work tree /Users/assem/Documents/GitHub/driftbench/.worktrees/docs3. Past conversations never enter a repository: choose a private folder outside any git work tree.
exit 2
```

* Pass 1, rules and checksums: emails, IBANs, national numbers, card numbers (Luhn), phones and street addresses.
* Pass 2, chosen with `--second-pass rules|model|both` (default `rules`): an independent set of rules, or a model that reads the pass 1 output only. Whatever pass 2 finds is a residual flag: a miss of pass 1.
* Each value becomes a placeholder such as `[EMAIL_1]`, one per value within a conversation.
* Near-duplicates (cosine at least `--dedup`, default 0.95, on the redacted user text) are dropped, failures kept first.
* With `--map`, each opening takes the closest intent of the map (`--intent-dimension`, default `flow`), else clusters as a new one.
* Discovery: Good-Turing f1 / n and the Chao sample coverage over the intents.

Five fictional conversations, written to a private folder outside the repository (`$PRIVATE`). The first line of the output names that folder; the rest:

```
  Conversations: 5 read, 0 near-duplicates dropped, 5 kept, 2 flagged as failures.
  Pass 1 (rules and checksums): 4 redacted: address 1, email 1, phone 2; 3 of them reserved fictional data.
  Pass 2 (independent rules): 0 more redacted: none.
  Residual flags: 0 conversations where the second pass found what pass 1 missed.
  Intents on flow: 4 seen, 3 from the map and 1 new.
  Discovery (Good-Turing f1 / n): f1 = 3, f2 = 1, n = 5. The chance that the next conversation shows an intent not seen yet is about 60 percent; sample coverage (Chao) about 49 percent.
  Spot check: 5 conversations drawn with seed 1; read spot-check.yaml and set clean on each.
```

The folder is created for the owner alone and holds `conversations.jsonl` (redacted, with intents), `reference-turns.jsonl` (user turns with their intent cell, the input of `fidelity`), `spot-check.yaml` (a seeded sample, `--spot-check`, default 20, with `clean: null` for a person to set) and `intake-report.json`. No raw text and no detected value is in any file or in the printed report. `intake logs` exits 0 when the set is written, 1 when the model check failed on a conversation, 2 on a usage or input error.

### From an interview

Every field of the questionnaire is in the [interview reference](reference/interview.md).

When no past conversation exists, `intake interview` writes a questionnaire from the approved map: personas with their shares and map values (`personas`), the share of each intent (`intents`), example messages per stage (`examples`), what users never do (`never`), tone (`tone`, and `tone` per persona), languages (`languages`) and channels (`channels`).

```
$ pnpm -s driftbench intake interview --map examples/acme/map/approved.yaml --out _captures/docs3/generating/intake/questions.yaml
Wrote _captures/docs3/generating/intake/questions.yaml: the interview for acme. Answer every question in place, then run driftbench intake from-interview _captures/docs3/generating/intake/questions.yaml --map examples/acme/map/approved.yaml --out <folder>.
exit 0
```

`intake from-interview` refuses incomplete answers and values the map does not approve. Code then enumerates the cells (each example entry by the language and channel of its persona), drops the ones a map constraint forbids, weighs each by the declared shares, and allocates `--turns` written turns (default 40) by largest remainder, at least `--min-per-cell` (default 1) per cell. `--dry-run` prints the plan and calls no model:

```
$ pnpm -s driftbench intake from-interview examples/acme/reference/answers.yaml --map examples/acme/map/approved.yaml --out _captures/docs3/generating/intake/reference --turns 30 --dry-run
Cells: 20, 34 model turns to request, 0 cells dropped by the map.
  stage=needs flow=upgrade persona=upgrader first_message=step-by-step plan_choice=names-one user_type=existing-customer language=english channel=chat lang=en  weight 0.0875  turns 3
  stage=needs flow=upgrade persona=upgrader first_message=step-by-step plan_choice=names-one user_type=existing-customer language=english channel=whatsapp lang=en  weight 0.0375  turns 1
```

The plan goes on with one line per cell. Then a model writes the turns of each cell, or `--replay` replays recorded answers keyed by cell. Every written turn passes checks in code: no speaker label, 1 to 500 characters, a known source answer, no real-looking personal data, no never-match phrase, no copy of an owner example, no near-duplicate in the cell. The owner's own examples enter as they are (`origin: interview`).

```
$ pnpm -s driftbench intake from-interview examples/acme/reference/answers.yaml --map examples/acme/map/approved.yaml --out _captures/docs3/generating/intake/reference --replay examples/acme/reference/recorded.yaml --turns 30
Wrote _captures/docs3/generating/intake/reference/reference.yaml and _captures/docs3/generating/intake/reference/approval.yaml: 53 turns (19 from the owner's examples, 34 from lane claude-opus-5-5 as the intake lane, by hand) in 20 cells, none approved.
  Model calls: 20. Turns refused by the checks: 0.
Next: read approval.yaml and set approved: true on the turns you accept, or run driftbench intake approve _captures/docs3/generating/intake/reference/approval.yaml --all.
exit 0
```

`from-interview` exits 0 when the set is written and every cell got its turns, 1 when it is written with a failed or short cell, 2 on a usage or input error. The language of a written turn is not checked in code, and no option saves a real model's answers for a later replay yet.

### Approve and compare

`intake approve <approval.yaml>` lists the turns not approved yet; `--all` approves every turn and keeps the comments:

```
$ pnpm -s driftbench intake approve _captures/docs3/generating/intake/reference/approval.yaml --all
Approved 53 turns in _captures/docs3/generating/intake/reference/approval.yaml; 0 were already approved.
exit 0
```

`intake fidelity --reference <set> --candidate <turns>` compares generated user turns with the approved reference turns: the total variation distance over cells, Kolmogorov-Smirnov on length and on the question rate, vocabulary overlap, and near-duplicate rates. It measures and never gates. Here the candidate is every user turn of the generated Acme suite, with its spec's cell, compared on `flow` and `channel`:

```
$ pnpm -s driftbench intake fidelity --reference _captures/docs3/generating/intake/reference --candidate _captures/docs3/generating/intake/candidate.jsonl --dims flow,channel
Reference _captures/docs3/generating/intake/reference: 53 turns, approved only (0 not approved, left out). Candidate _captures/docs3/generating/intake/candidate.jsonl: 814 turns.
  Cells on flow, channel: total variation 0.528; 4 cells in the reference, 8 in the candidate, 4 of them never in the reference.
    flow=upgrade channel=chat  reference 37.7 percent, candidate 12.7 percent
    flow=new-home channel=chat  reference 34.0 percent, candidate 12.8 percent
    flow=new-home channel=whatsapp  reference 0.0 percent, candidate 17.8 percent
    flow=porting channel=whatsapp  reference 0.0 percent, candidate 13.4 percent
    flow=upgrade channel=whatsapp  reference 7.5 percent, candidate 17.6 percent
  Length in words: KS 0.090 against 0.193 (n = 53, m = 814): no difference shown at the 5 percent level. Medians 6 and 6.
  Question rate: KS 0.109 against 0.193: no difference shown at the 5 percent level. Rates 26.4 percent and 15.5 percent.
  Vocabulary: Jaccard 0.354 over 168 and 138 word types; 73.5 percent of candidate words appear in the reference.
  Near-duplicates (character n-gram TF-IDF cosine at least 0.9): 13.3 percent of candidate turns copy a reference turn; 99.9 percent repeat another candidate turn, against 3.8 percent within the reference.
exit 0
```

The generated suite repeats its phrase bank, so almost every candidate turn repeats another one. `fidelity` exits 0 after printing the comparison, 2 on a usage or input error.
