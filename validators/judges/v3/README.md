# Judges version 3: labellers

This additive version evaluates a labeller that returns one declared label, `none`,
or an abstention for each fictional text unit. Version 2 remains the default of
`driftbench validate judges`; its bank, journal and floor are unchanged.

## Run

```sh
pnpm driftbench validate judges --ladder-version 3 --seeds 1..20 --hidden --items --json
pnpm driftbench validate judges --ladder-version 3 --hardness --json
pnpm driftbench validate judges --ladder-version 3 --brief --fresh
```

The ordinary exit code is the reached level, not a success/failure boolean.
Version 3 evidence lives in this directory. Explicit version 2 uses the legacy
evidence directory. `validate all` continues to run the default versions.

## What is measured

The production API in `packages/judges/src/labeller.ts` accepts a generic label
set, request text, optional context and labeller identity. It does not classify
prose with word lists. A system-1, system-2 or stacked labeller can implement
the same port; this bank calls only recorded or scripted implementations.

The bank contains paired batches across agreement, abstain, none, label-set
change, near-miss labels, order and position, length, adversarial label mentions,
replay determinism and cache identity. Every item tests classification as well
as its family's relation. A cache implementation alone cannot earn an item for
a constant or empty labeller.

Agreement is correct answers divided by **all** gold units. Cohen's kappa uses
the empirical gold and prediction marginals over those same units. `none` is
a real class. A null abstention is a separate prediction-only class and never
agrees, even with gold `none`. Invalid outputs are counted separately. Neither
abstentions nor invalid answers disappear from the denominator. Every item
reports its raw agreement, kappa, abstention and invalid counts.

| Tier | Minimum kappa | Minimum raw agreement |
|---|---|---|
| 1 | 0.80 | 0.90 |
| 2 | 0.85 | 0.92 |
| 3 | 0.90 | 0.94 |
| 4 | 0.92 | 0.95 |
| 5 | 0.94 | 0.96 |

Each level requires every item to pass. An all-abstaining labeller fails.
Single-class perfect agreement has kappa 1 by the scorer's explicit finite
convention; the bank's paired batches contain multiple gold classes, so this
convention cannot reward constant-label cheats.

## Cache and replay contract

The SHA-256 label-set hash includes the set name, ordered label names and their
definitions. The request key includes that hash, exact unit text, optional
context and labeller identity. Editing either a label's name or definition must
miss an existing recording. Replay never falls through to a live client.
Conflicting answers for the same key are rejected.

This is a generic labeller validator, not an integration claim about the pointer
reader of PR 692. That reader is absent from the main-branch baseline. Its
system-1/system-2 ports can be adapted separately to this contract.

## Hardness and independent audit

`docs/validators.md` section 12 governs the measurement. The pilot and audit
record measured scores, genuine fixes and shared causes; passing fixtures are
not broken deliberately to create a forecast. A perfect scripted recording
proves the validator's mechanics, not a real model's semantic accuracy.

The owner's task clarification permits a normal PR with a **provisional**
per-version lower bar when the measured bank does not meet the original gate.
The evidence and rationale belong in `GATE.md`; a provisional exception does
not turn an unmeasured check into a passing one.

## Bank inventory

Each row below contributes six structural variants in each of five tiers:
30 items per family, 60 per tier, 300 total. Higher tiers increase the number
of labels and batch size. The author declares ten shared cause groups; this
inventory does not claim 300 independent fixes.

| Family | Structural variants |
|---|---|
| agreement | direct, boundary, negation, correction, conjunction, skew |
| abstain | missing value, contradiction, truncation, unknown unit, missing context, erased value |
| none | below domain, above domain, excluded boundary, unrelated field, negated membership, missing predicate |
| label-set-change | rename, definition, add, remove, swap definitions, Unicode name |
| near-miss | prefix, suffix, case, Unicode, space, punctuation |
| order-bias | reverse labels, rotate labels, evidence first/last/middle, reverse units |
| length-bias | prefix/suffix/sandwich padding, unequal labels, long definition, repeated decoy |
| adversarial-label | imperative, quoted label, fake system, JSON answer, XML answer, repeated command |
| replay | same object, cloned object, interleaved, fifth repeat, reverse batch, context round trip |
| cache-key | text, context, label name, definition, label order, labeller identity |

The optional `JudgesV3Options.labellerFactory` receives only copied requests.
Neither fixture gold, pair identifiers, item identifiers nor the seed crosses
that boundary. Arbitrary JavaScript still shares the process and filesystem;
this is an evaluation interface, not a security sandbox. The built-in scripted
recording is trusted fixture machinery, not a claim of model understanding.
