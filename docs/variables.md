# The variable store

The variable store is one catalogue of the variables a situation varies on. The prompt-agent map ([generating tests](generating.md#the-map-of-situations)) and the estate map ([testing an estate](estate.md#3-variables-the-interaction-space-of-an-estate)) describe the same thing in two files: dimensions with values, constraints that rule out combinations, and a prior. The store holds both, and it keeps where each part comes from.

Three sources feed it:

| Source | What it gives | What the store keeps |
|---|---|---|
| The agent's own files | a condition names a variable; its values are the two sides of the condition and the value at its limit | a quote of the file, with the ledger id of the prose it belongs to when there is one |
| Past conversations | the values they show, and how often | counts and a hash of the private set, never a line of text |
| The owner | a value that is missing, a combination that cannot occur, a weight | the owner's words and the day they said them |

Status. Built: the format, a loader that checks it, the conversion from a space map and from a map proposal, the conversion back to a space map, and the check of every quote against its file. Also built: an interview that fills a store from the owner (below). Not built yet: the readers that fill a store from an estate and from past conversations; the ledger that gives the ids (the store checks only their shape); the planner and the generator reading a store; a command for the store. The `space` commands read a space map, and `variablesToSpaceMap` makes one from a store.

## The file

A store is a YAML or JSON file, usually `variables.yaml`. Keys are snake_case. An unknown key is an error.

```text
format: 1
agent: northwind
version: '1'
prior:
  kind: declared
variables:
  - id: shipment_days_late
    ...
constraints:
  - forbid: { session_state: fresh, estate_hazard: dead_helper }
    ...
```

| Field | Required | Holds |
|---|---|---|
| `format` | yes | the version of the file format, `1` |
| `agent` | yes | the agent the store describes |
| `version` | yes | a label for this version of the store |
| `inventory` | no | the behaviour inventory, as a path relative to the file; its required flow deviations become required cells, as in a space map |
| `prior` | no | how the weights were set: `kind` is `declared` (the owner wrote them) or `fitted` (fitted from consented conversations, which needs a `source` text); default `declared` |
| `variables` | yes | the variables, at least one |
| `constraints` | no | the impossible combinations; absent or empty means every combination can occur |

## Variables

A variable is one thing a situation varies on. A condition in the agent's files names it: "late by more than two days" names how late a shipment is.

| Field | Required | Holds |
|---|---|---|
| `id` | yes | a letter or digit, then letters, digits, dots, underscores and hyphens; unique in the store |
| `title` | yes | what the variable varies on |
| `kind` | yes | `stage`, `behaviour`, `deviation`, `persona`, `channel`, `data` or `task`: how a spec is placed on it, as for a space map |
| `role` | yes | `axis` or `detail` |
| `approved` | yes | true once a person approved the variable and the values that carry no flag of their own |
| `produced_by` | no | `code` (read from structure), `model` (read from prose) or `owner` |
| `provenance` | no | where the variable comes from; for a variable a condition names, the quote of the condition |
| `values` | yes | the values, at least one |
| `boundaries` | no | the edges of the conditions that name the variable |

The role is the one the map proposal uses. An axis is a dimension of the space map, crossed with the other axes. A detail stays out of the space map: the generator varies it inside a cell, as boundary values.

Three rules of the space map hold for the axes of a store, and a detail is exempt from them:

* At most one axis is of kind `stage`, one of kind `deviation` and one of kind `channel` (`VARIABLES_KIND_REPEATED`).
* A value id appears in one axis only among the axes of kind `behaviour`, `persona`, `data` or `task`, because a spec names such a value without its variable. The value `none` is exempt (`VARIABLES_AMBIGUOUS_VALUE`).
* An axis of kind `deviation` holds `none` and the twelve deviation classes of [recovery](concepts/recovery.md), and nothing else (`VARIABLES_UNKNOWN_DEVIATION`).

## Values

| Field | Required | Holds |
|---|---|---|
| `id` | yes | the value id, unique among the values of its variable |
| `title` | yes | what the value means, in plain words |
| `weight` | no | the share of users with the value, relative to the other values of the variable |
| `required` | no | true when a test plan must include the value |
| `approved` | no | overrides the flag of the variable for this value; absent means the value inherits it |
| `produced_by` | no | `code`, `model` or `owner` |
| `provenance` | no | where the value comes from |
| `polarity`, `when`, `unless`, `limit`, `within`, `priority` | no | what a rule states, as a map proposal writes it: whether the agent must or must not act (`polarity`), the cell the rule applies in (`when`), the cell it does not hold in (`unless`), the most times it may happen in a conversation (`limit`), the minutes it has to happen in (`within`), and `first` when it comes first when rules collide (`priority`) |

A weight is relative: `0.6`, `0.15` and `0.25` mean the same as `60`, `15` and `25`. Give a weight to every value of a variable or to none (`VARIABLES_WEIGHT_INCOMPLETE`), and not all zero (`VARIABLES_WEIGHT_ZERO`). Without weights every value of a variable weighs the same. A weight stands on the provenance of its value: the counts of conversations, or the owner's words.

## Boundaries

A boundary is the edge of a condition. The condition has two sides, and the limit between them is a case of its own: it is where a wrong comparison, such as "at least" written as "more than", shows. The boundary names the three values.

```text
    boundaries:
      - holds: more_than_two_days
        fails: under_two_days
        edge: exactly_two_days
        limit: 2
        comparison: gt
        unit: days
```

| Field | Required | Holds |
|---|---|---|
| `holds` | yes | a value on the side where the condition holds |
| `fails` | yes | a value on the side where it does not; not the value of `holds` |
| `edge` | yes | the value at the limit itself: a third value, or the value of the side the limit falls on |
| `limit` | no | the limit of the condition, a number; it is not the `limit` of a rule on a value, which counts actions |
| `comparison` | with `limit` | how the quantity is compared with the limit for the condition to hold: `lt`, `le`, `gt` or `ge` |
| `unit` | no | the unit of the limit; needs a `limit` |
| `provenance` | no | where the condition comes from |

The three ids are values of the variable (`VARIABLES_UNKNOWN_VALUE`), and `holds` and `fails` are two values (`VARIABLES_BOUNDARY`). A `limit` and a `comparison` go together, and a `unit` needs a `limit`. These words give these fields:

| The agent's words | `comparison` | `limit` | The limit itself |
|---|---|---|---|
| late by more than two days | `gt` | 2 | fails |
| a draft under 120 words | `lt` | 120 | fails |
| at most one question | `le` | 1 | holds |
| a tool that fails twice in a row | `ge` | 2 | holds |

A strict comparison (`gt`, `lt`) leaves the limit itself on the failing side, so `edge` is not the value of `holds`. An inclusive one (`le`, `ge`) puts it on the side where the condition holds, so `edge` is not the value of `fails` (`VARIABLES_BOUNDARY`). A third value for the edge fits both. A condition with no number leaves out `limit` and `comparison`: the edge is then the borderline case, such as "looks fine" between an explicit yes and a request for changes.

## Provenance

Every value, boundary and constraint may list where it comes from, in `provenance`. Each entry is one of three kinds, named by `kind`.

| Kind | Fields | Holds |
|---|---|---|
| `quote` | `path`, `quote`, `ledger` (optional) | text copied from a file of the agent |
| `conversations` | `count`, `total`, `set_hash` | how many of the conversations read show the value |
| `owner` | `words`, `date` | what the owner said, and the day |

A quote has a `path`, relative to the folder of the store file and written with forward slashes: no leading `/`, no `~`, no scheme or drive letter (`file:`, `C:`) and no backslash, so a path never names a folder outside the repository by its full name. It has a `quote` of 1 to 1,000 characters that is not blank. A `ledger` is the ledger id of the prose the quote belongs to, 10 characters from `a` to `z` and `2` to `7`. The store checks its shape. A quote is checked against its file as the evidence of a map proposal is: word for word, with runs of white space, typographic quote marks, accents written composed or decomposed, characters that print nothing and the backslash of markdown folded first; case and punctuation must match.

A `conversations` entry holds counts and a SHA-256 of the private set of conversations, 64 lowercase hexadecimal characters. `count` is a whole number from 0 to `total`, and `total` is at least 1. The entry has no other key: no text, no id and no person can enter a store through it.

An `owner` entry holds the `words`, at most 1,000 characters and not blank, and the `date` as `YYYY-MM-DD`.

A value that has a weight and a `conversations` entry should agree: the weight is the count over the total, up to the factor the weights share. The loader does not compare them.

A quote copies text of the agent's files. A store built from a private estate is private too: keep it outside the repository, as the conversations are.

Advice. The loader reports `VARIABLES_UNSOURCED` for each value, boundary and constraint that has no provenance. It never makes a store invalid: a store converted from a space map names no source at all.

## Impossible combinations

A constraint says that some values never occur together. `forbid` maps variable ids to value ids. Every cell that holds all of them is impossible. A pair is the usual case; one value, or three, work as well.

```text
constraints:
  - forbid: { channel: whatsapp, follow_up: callback_form }
    reason: the callback form is part of the web chat tab only
    approved: true
    produced_by: model
    provenance:
      - kind: quote
        path: tidewater-prompt.md
        quote: Offer the callback form after two replies that did not solve the question.
```

| Field | Required | Holds |
|---|---|---|
| `forbid` | yes | variable id to value id, at least one entry |
| `reason` | yes | why the values never occur together |
| `approved` | yes | false until a person approves the combination |
| `produced_by` | no | `code`, `model` or `owner` |
| `provenance` | no | the quote, or the owner's words, behind the reason |

Each variable and value in `forbid` exists (`VARIABLES_UNKNOWN_VARIABLE`, `VARIABLES_UNKNOWN_VALUE`), `forbid` is not empty (`VARIABLES_EMPTY_CONSTRAINT`), and no combination is written twice, whatever the order of its keys (`VARIABLES_DUPLICATE`). The constraints must leave at least one cell of the axes (`VARIABLES_GRID_EMPTY`). A constraint that names a detail stays in the store and is left out of the space map.

## Approval

Nothing counts until a person approves it. A variable has one `approved` flag, which its values inherit. A value may set its own flag. Each constraint has its own. The space map of a store keeps a value whose own flag, else the flag of its variable, is true; a variable left with no value is dropped, and so is a constraint that is not approved or that names a value no longer in the map. These are the rules the map proposal applies when it writes its space map.

## Loading, checking and converting

The package `@agent-nexus/driftbench-space` loads and converts a store. The package `@agent-nexus/driftbench-generate` checks the quotes and converts a proposal.

```ts
import { verifyVariableQuotes } from '@agent-nexus/driftbench-generate';
import { loadVariableStore, variablesToSpaceMap } from '@agent-nexus/driftbench-space';

const loaded = await loadVariableStore('examples/variables/tidewater.yaml');
if (!loaded.ok) throw new Error(loaded.errors.map((issue) => `${issue.code} ${issue.path}`).join('\n'));
const quotes = await verifyVariableQuotes(loaded.store, 'examples/variables');
const space = variablesToSpaceMap(loaded.store); // a result: ok with the map, or the errors
```

`loadVariableStore(path)` reads a file, `parseVariableStoreText(text, 'yaml' | 'json')` reads text, and `validateVariableStore(value)` checks a value that is already parsed. Each returns `{ ok: true, store, warnings }` or `{ ok: false, errors }`. An issue is `{ code, path, message }`, and the path is a dotted path into the store, such as `variables.2.boundaries.0.edge`. The loader never throws on a bad input.

| Code | The store is refused when | Reported at |
|---|---|---|
| `VARIABLES_PARSE` | the file cannot be read or is not valid YAML or JSON, or repeats a key | the whole file (empty path) |
| `VARIABLES_NOT_OBJECT` | the file holds something other than one mapping | the whole file |
| `VARIABLES_DUPLICATE` | a variable id, a value id in a variable, or a combination in the constraints is written twice | the second `variables.N.id`, `variables.N.values.M.id`, or `constraints.N` |
| `VARIABLES_KIND_REPEATED` | two axes are of kind `stage`, `deviation` or `channel` | `variables.N.kind` of the second axis |
| `VARIABLES_AMBIGUOUS_VALUE` | a value id is in two axes of one kind that a spec names by value | `variables.N.values.M.id` of the later one |
| `VARIABLES_UNKNOWN_DEVIATION` | an axis of kind `deviation` has a value that is neither `none` nor a deviation class | `variables.N.values.M.id` |
| `VARIABLES_EMPTY_CONSTRAINT` | a constraint forbids nothing | `constraints.N.forbid` |
| `VARIABLES_UNKNOWN_VARIABLE` | a constraint or a `when` or `unless` names a variable the store lacks | `constraints.N.forbid.NAME`, or `variables.N.values.M.when.NAME` (`unless` alike) |
| `VARIABLES_UNKNOWN_VALUE` | a constraint, a `when`, an `unless` or a boundary names a value its variable lacks | `constraints.N.forbid.NAME`, `variables.N.values.M.when.NAME.K`, or `variables.N.boundaries.B.holds`, `.fails` or `.edge` |
| `VARIABLES_WEIGHT_INCOMPLETE` | a variable weighs some of its values and not all | `variables.N.values.M.weight` of the first value with no weight |
| `VARIABLES_WEIGHT_ZERO` | every weight of a variable is 0 | `variables.N.values` |
| `VARIABLES_PRIOR_SOURCE` | the prior is `fitted` and has no `source` | `prior.source` |
| `VARIABLES_GRID_EMPTY` | the constraints forbid every cell of the axes | `constraints` |
| `VARIABLES_BOUNDARY` | the two sides of a boundary are one value, or the edge is on the wrong side of a strict or an inclusive comparison | `variables.N.boundaries.B.fails` (one value on both sides) or `.edge` (wrong side) |
| `VARIABLES_SOURCE_UNREADABLE` | `verifyVariableQuotes` cannot read the file a quote names; reported once per file | `PATH.path` of the first quote that names the file |
| `VARIABLES_QUOTE_NOT_FOUND` | `verifyVariableQuotes` does not find a quote in its file | `PATH.quote` of the quote |
| `VARIABLES_UNSOURCED` | advice only: a value, a boundary or a constraint has no provenance | `variables.N.values.M`, `variables.N.boundaries.B` or `constraints.N` |

In these paths N, M, B and K are positions counted from 0, NAME is a key, and PATH is the path of a provenance entry, such as `variables.0.values.1.provenance.0`. A provenance entry is reached through the `provenance` list of a variable, a value, a boundary or a constraint.

The checks run in this order. A schema error stops the load: the references are not checked. Otherwise every reference error is reported together, and `VARIABLES_GRID_EMPTY` is checked only when there is none. A schema error has the code `SCHEMA_` and one of these zod codes: `INVALID_TYPE` (a missing or mistyped field, or a non-whole count), `INVALID_VALUE` (a value outside a list, such as an unknown kind or `format`), `INVALID_FORMAT` (an id, a ledger id, a hash or a date in the wrong form), `TOO_SMALL` (an empty list, a negative number, a `total` below 1), `TOO_BIG` (a quote or an owner statement over 1,000 characters), `UNRECOGNIZED_KEYS` (an unknown key), `INVALID_UNION` (a provenance with an unknown `kind`) and `CUSTOM` (a rule of this page that the schema holds: a blank quote or statement, a path that is not relative, a `count` above `total`, a `limit` without a `comparison`).

Limits of each field, exactly:

* An id (variable or value) matches `^[A-Za-z0-9][A-Za-z0-9._-]*$`. A `title`, an `agent`, a `version`, a `reason`, a `unit` and an `inventory` are not empty.
* A `weight` is a finite number from 0 up. A value `limit` is a whole number above 0. `within.minutes` is a number above 0. `polarity` is `must` or `must_not`. `priority` is `first`.
* A boundary `limit` is a finite number, positive, zero or negative. `when` and `unless` map variable ids to lists of at least one value id.
* A blank text is one that is empty after trimming white space. A `set_hash` matches `^[0-9a-f]{64}$`. A `ledger` matches `^[a-z2-7]{10}$`; a mixed-case or capital id is refused. A `date` is a real day written `YYYY-MM-DD`, with no time.
* `forbid` keys and values are strings; they are checked against the store by the references, not by their form.

Three conversions connect the store to the two files it replaces.

* `spaceMapToVariables(map)` turns a space map into a store. Each dimension becomes an approved axis, each constraint an approved one, and no entry has provenance or an author, because a space map says neither. The weights of the prior move onto the values they weigh. The store keeps one weight per value, so the weight a value wrote itself, when the prior also weighs its dimension, is the one thing not kept; a space command never read it. Everything else a space command reads is kept: converting back gives the same map.
* `proposalToVariables(proposal)` turns the dimensions and constraints of a map proposal into a store. It keeps every field: the role, the flags, who proposed each entry (`produced_by`), the rule fields and the weight of each value, and the evidence of each entry as a `quote` with the path as the proposal wrote it, so write the store beside the proposal. The phrases, the relations and the numeric settings stay in the proposal. Rebuilding the dimensions and constraints from the store gives the proposal's own, for the approved Acme proposal and for the one nobody approved.
* `variablesToSpaceMap(store, options)` turns a store into a space map: its approved axes, their values, weights and required flags, and the constraints whose values are all in the map. It returns the result of `validateSpaceMap`, so a store with no approved axis gives the error `SCHEMA_TOO_SMALL` on `dimensions`. With `approvedOnly: false` it keeps what is not approved. It does not add the value `none` to a deviation axis; the generator adds it when it builds the cells, as it does for a proposal.

## Filling a store from an interview

`interviewVariables(store, ask, options)` in `@agent-nexus/driftbench-generate` asks the owner for what a store lacks and writes the answers into a copy of the store. It asks three kinds of question, in this order. Code checks each answer against the store being built. An answer that does not fit is asked again, with the reason, up to `maxAttempts` times (default 3). A question that is still wrong after that is given up, and the interview goes on without it.

| Question (key) | Asked | An answer | Asked again when |
|---|---|---|---|
| `values:VARIABLE` | once per variable | `{ none: true }`, or `{ values: [{ id, title, words }] }`: the values the store is missing | an id is not an id, is already a value of the variable (or twice in the answer), or has no title |
| `pair:N` | until the owner answers `{ done: true }` | `{ forbid: { VARIABLE: VALUE, ... }, reason, words }`: values that never occur together | a variable or a value is unknown, fewer than two variables are named, the reason is blank, the combination is already ruled impossible (in any key order, or contained in a constraint already there) or would leave no cell |
| `weights:VARIABLE` | once per variable | `{ skip: true }`, or `{ weights: { VALUE: number, ... }, words }` | a value is unknown or has no weight, a weight is negative, the weights do not add up to 1 (within 0.000001), or the variable already has weights and got a new value and the owner skips |

Every answer that carries `words` must carry the owner's words, not blank and at most 1,000 characters. An answer of another shape is asked again too, with the path of the problem.

What an accepted answer writes:

* A value: a value of the variable with `produced_by: owner`, `approved: true` and an `owner` provenance entry holding the words and the day.
* A pair: a constraint with `approved: true`, `produced_by: owner`, the reason, and an `owner` provenance entry.
* Weights: the `weight` of every value of the variable, and an `owner` provenance entry added to each value.

The day comes from `options.now` (default: the clock). The result is `{ ok: true, store, transcript, added }`, with a store that passes `validateVariableStore`, or `{ ok: false, reason, transcript }`. The transcript lists every ask with its outcome (`accepted`, `refused` with the reason, `gave-up` or `skipped`). The run fails when the asker throws, and when the store is invalid at the end, for instance because a variable that has weights got a new value and never got its weights.

The asker is a function. `replayAsker(recording)` gives the answers of a recording, in order, per question key, with no model and no person; a question with no recorded answer left fails the run, and `asker.unused()` names the answers never asked for. A recording is YAML: `version: 1` and `answers`, a list of `{ question, answer }`. A refused answer and its correction are two entries of one question. The folder [`examples/variables/interview`](../examples/variables/interview/start.yaml) holds an invented store (`start.yaml`) and the recording of an interview over it (`answers.yaml`) with five wrong answers, each followed by its correction.

## Worked examples

The folder [`examples/variables`](../examples/variables/README.md) holds three stores, one for each kind of agent. Every number, date and sentence of the owner in them is invented. Their quotes are copied from files of the repository, and the tests check each one.

| File | Agent | What it shows |
|---|---|---|
| [`acme.yaml`](../examples/variables/acme.yaml) | the Acme sales assistant, a prompt | entries that follow the Acme proposal (behaviours, channels, who talks, the coverage check), with weights from conversation counts and from the owner's words, and a boundary read from the prompt: a lookup that fails again is the second failure in a row |
| [`northwind.yaml`](../examples/variables/northwind.yaml) | the Northwind operations assistant, an estate | three variables a condition names, each with its boundary and ledger ids, beside the two fixed axes of every estate, which come from a space map and name no source |
| [`tidewater.yaml`](../examples/variables/tidewater.yaml) | the Tidewater Cycles booking assistant, a prompt with one tab per channel | the channel as an axis weighted by conversation counts, a value a model proposed that nobody approved, two boundaries, and impossible pairs that come from the tabs and from the owner |

The boundary of the Northwind store, as the file writes it:

```text
  - id: shipment_days_late
    title: How many days late a shipment is
    kind: data
    role: detail
    approved: true
    produced_by: model
    values:
      - id: under_two_days
        title: Not late, or late by one day
        weight: 0.6
        provenance:
          - kind: quote
            path: ../estates/fixture/CLAUDE.md
            quote: When a shipment is late by more than two days, tell the user and propose a supplier email.
            ledger: k4jd7xq2mf
          - kind: conversations
            count: 120
            total: 200
            set_hash: 660a833739237c697a631393e183b320b543c990a12933b5216941878505d74e
      - id: exactly_two_days
        ...
      - id: more_than_two_days
        ...
    boundaries:
      - holds: more_than_two_days
        fails: under_two_days
        edge: exactly_two_days
        limit: 2
        comparison: gt
        unit: days
```

The ledger id is made up: the ledger assigns the real ones. The 200 conversations do not exist; the `set_hash` is the SHA-256 of the text `northwind-example-conversations`.

The loader reports 12 `VARIABLES_UNSOURCED` entries for this store: the values of the two fixed axes. The Acme and Tidewater stores report none.

See also: [generating tests](generating.md), [testing an estate](estate.md), [recovery](concepts/recovery.md).
