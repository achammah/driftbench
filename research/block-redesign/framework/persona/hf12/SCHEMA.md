# HF12 fixture schema: personas, scenarios, blocks, and the refusal rules

Written before the loader and before the fixtures. Source: `simuser_model.md` sections 3.2 (ownership
table), 3.3 (refusals), 3.5 (parent chains), 7.1 to 7.4 (YAML and composition rule) and
`config_framework.md` 2.5 (the reference graph, checked at load). Both the fixture author and the loader
author work from this file only; neither sees the other's work before the run.

## One case

A case is one JSON object in `fixtures/cases.json` (a JSON list):

```json
{
  "id": "c01-ownership-scenario-sets-verbosity",
  "planted": true,
  "class": "ownership_violation",
  "note": "one line: what is planted",
  "personas":  [ { persona object } ],
  "scenarios": [ { scenario object } ],
  "blocks":    [ { block object } ],
  "expect": [ { "type": "load_error", "class": "ownership_violation" } ]
}
```

`planted: false` cases are clean combinations and have `"class": "clean"` and `"expect": []`.

`expect` lists every refusal the loader must produce, with no extra refusal allowed:
- `{"type": "load_error", "class": <class>}` for an authoring error (the whole case fails to load).
- `{"type": "not_run", "block": <block id>, "persona": <persona id>, "kind": "persona_incompatible",
  "requirement": <requires key>}` for one refused cell.

## Objects

**Persona** (owned fields: `language`, `lines`, `behaviour`, `stable_knowledge`, `expertise`,
`misconceptions`, plus `kind`, `id`, `name`, `source`, `weight`, `schema_version`):

```json
{"kind": "persona", "id": "terse-regular", "language": "en",
 "lines": ["I order from you most months."],
 "behaviour": {"verbosity": {"short_turn_share": 0.55, "words_per_turn": 5},
               "initiative": {"acts_per_turn": {"1": 0.8, "2": 0.18, "3": 0.02}, "volunteer_default": 0.5},
               "tone": {"polite_turn_share": 0.21, "uncertainty_turn_share": 0.03, "question_turn_share": 0.05},
               "cooperativeness": {"answer_when_asked": 0.95},
               "commitment": {"strategy": "single_minded", "repeat_after_refusal": 1},
               "engagement": {"initial": 0.8, "decay_per_unhelpful_turn": 0.2, "disengage_below": 0.3},
               "patience": {"turn_budget": 10}},
 "stable_knowledge": {"account_id": "ACC-4471", "email": "sam.ortel@example.com", "has_account": true},
 "expertise": {"level": "advanced", "always_known": ["where_order_id_is"]},
 "misconceptions": [{"fact": "refunds are instant", "true": false}]}
```

**Scenario** (owned fields: `intent`, `goal`, `start_state`, plus `kind`, `id`):

```json
{"kind": "scenario", "id": "refund-late-order", "intent": "get_refund_for_late_order",
 "goal": {"constraints": [{"slot": "refund_method", "value": "original_payment"}],
          "requests": [{"slot": "refund_amount"}],
          "preferences": [], "success_when": {"must_be_told": ["refund_amount"]}, "drift": []},
 "start_state": {"prior_failed_contacts": 1}}
```

**Block** (owns its `situational` facts, concepts, pins and `requires`):

```json
{"id": "b1", "parent": null,
 "simulated_user": {
   "scenario": "refund-late-order",
   "personas": ["terse-regular"],
   "requires": {"language": "en", "has_account": true},
   "situational": {
     "holds": [{"slot": "order_id", "value": "W2378156", "reveal": "on_request"},
               {"slot": "email", "ref": "persona.email", "reveal": "on_request"}],
     "unknown": [{"slot": "tracking_number"}],
     "case_beliefs": [{"fact": "the order was delivered", "true": false}],
     "concepts": [{"id": "where_order_id_is"}],
     "pin": []}}}
```

Run settings (`model`, `seed`, `temperature`, `trials`, `mode`, `simulators`, `calibration_ref`) belong to
the run profile only; they never appear in a persona or a scenario.

## The five refusal classes

1. **`ownership_violation`** (load error). A scenario sets any persona-owned field (top level or any key
   that only a persona holds: `language`, `lines`, `behaviour` or any part of it such as `verbosity` or
   `commitment` at the top level of the scenario, `stable_knowledge`, `expertise`, `misconceptions`); or a
   persona sets a scenario-owned field (`intent`, `goal`, `start_state`); or either sets a run setting.
   Also: a block's `situational` sets a persona-owned field (for example `situational.behaviour`).
2. **`slot_collision`** (load error). A slot appears in `situational.holds` with a `value` (not a
   `ref`) and the same slot is in one of the block's personas' `stable_knowledge`. Equal values are still
   a collision: the persona owns the slot and the block may only reference it (`ref: persona.<slot>`).
3. **`contradictory_belief`** (load error). A block's `case_beliefs` entry and a persona's
   `misconceptions` entry name the same proposition (same `fact` text after lower-casing and trimming
   spaces) with opposite `true`, and the block entry does not carry `"override": true`. A block entry with
   `"override": true` is clean (specific over general). Same fact with the same `true` is clean.
4. **`persona_switch_in_chain`** (load error). A block with `parent` set must use the same persona set as
   its parent (compared as sets; order does not matter). A child that omits `personas` inherits the
   parent's set (clean). The rule applies along the whole chain (grandparent to child). The scenario may
   change along the chain (clean).
5. **`persona_incompatible`** (a `not_run` cell, the case still loads). A persona fails one of the
   block's `requires`. Keys and their test:
   - `language`: persona `language` equals the value.
   - `has_account`: persona `stable_knowledge.has_account` equals the value (absent counts as false).
   - `concepts`: every listed concept id is in persona `expertise.always_known`.
   - `min_expertise`: persona `expertise.level` is at least the value in the order
     novice < intermediate < advanced.
   A persona missing the field a key tests fails that key. A block with several personas refuses only the
   failing cells; the others run. When one persona fails several keys, the refusal names the first failing
   key in the order the block lists them.

Anything else in a case is clean, for example a block reading a persona slot by `ref`, a block concept
`pin`, `unknown` slots, a misconception with no matching case belief, a block whose `requires` all hold.
