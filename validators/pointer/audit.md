# Pointer bank audit status

This handoff preserves the independent cheater failure. No helper has certified
a passing section 12.7 check. The failure and pending markers keep the merge gate
closed; only independent auditors can replace them with passing findings.

| Check | Verdict | Note |
|---|---|---|
| blind pilot | pending | No real-reader adapter or executor pilot is included. An independent executor must run iteration 0 and ten pilot iterations. |
| cheater | fail | Re-review at 6cda2a598, [comment 6243324694](https://github.com/achammah/driftbench/pull/759#issuecomment-6243324694), confirms the earlier four attacks score zero but a positional ledger passes all ten ledger items. Position regressions are added; an independent rerun remains required. |
| cause review | pending | Shared cause names are retained. No independent sample of 30 failing items or agreement measurement exists yet. |
| planted bugs | pending | Harness corruption checks do not establish detection of 20 independently planted reader bugs. |

## Authorship and evidence scope

The author and family helpers never read the reader implementation, its tests,
or PR 692's code diff. The sole reader contract is the design document on
`feat/estate-pointer-reader-design`, commit
`517e63aaeea25e668dac4f9b28abc8019d906c06`. The validator format and merge gates
come from `docs/validators.md` on main at
`346a8249d460fb0a73c1deb6cdfdc6fd10e0e6ec`.

The bank contains 340 items: cutting, ids, re-anchoring, grouping, labels, replay,
privacy, links, radius, scale, and adversarial each have 30, except labels, which has 40. All five difficulty
tiers are represented. Every item contains a seeded plant, exact observable
truth, cause, design citation, and contrasting probes.

The scripted positive adapter is a harness stub, not a reader implementation.
Its green result must never be used as iteration 0, a reader score, a floor,
a pilot, or hardness evidence. The factory is not globally registered until a
separate implementation owner supplies and verifies the real adapter.

## Required independent follow-up

1. Wire the bank-owned adapter to the reader without importing oracle code or
   implementing missing reader behavior in the adapter. Keep missing Layer C
   capabilities failing. Review the design ambiguities in `CONTRACT.md`.
2. Measure the actual reader on seeds 1–20 and its commit-derived hidden seed;
   record real baseline and pilot rows. Do not fabricate a journal or floor
   from stub results. Apply section 12.4's score, forecast and distinct-cause gate.
3. Run the four independent section 12.7 audits with fresh auditors. Their own
   verdicts, reviewed causes and blind pilot rows replace the current failure and pending scaffold.

Known bounded coverage: deterministic unit cuts, fingerprint relations, id
persistence, move/change/delete/ambiguity/split/merge transitions, label stack
bounds, dense-answer validation, request-key perturbations, private serialized
surfaces, link classification and radius/coverage. No live model correctness,
private estate, or unspecified scoring/tie/overflow behavior is claimed.

## Review correction

The independent review was reproduced on `a7672c4433d92f44fc6b1d7d20493f844f2d7be4`
with visible seeds 1–20 and hidden seed 809556612. Stable passes across those seeds
were 8 for first-unit selection, 13 for raw-text hashing, 45 for response copying,
and 42 for split-text leaking (including 27 privacy items). Per-seed leak totals
were 43 or 44. These measurements describe the rejected bank.

The revision keeps all 340 items and their family/tier/cause assignments. It
strengthens their witnesses and retains all four review attacks alongside the
original three cheats. Label decisions contrast policy outcomes; identity checks
retain quotes/status and compare duplicate identities over history. Privacy
answers live in a separate transport fixture, effects are captured by the harness,
and a single private marker character is sufficient to reject a result.

The first correction's regression suite requires zero passes for each of seven cheats on
every seed, not merely zero items passing their intersection. Effectful leak
mutants also preserve the honest trace except for an emitted fragment. These
checks close the reported regressions; they do not certify the independent
cheater audit, the reader, or the hardness forecast. The last independent verdict
therefore remains **fail** until its author or another independent auditor reruns it.

## Positional identity correction

[Independent re-review 6243324694](https://github.com/achammah/driftbench/pull/759#issuecomment-6243324694)
reports that estate/path/ordinal minting with ordinal reuse passes all ten ledger
items at `6cda2a598b3130351ae8dd130e530f8f8b0a26d3` on seeds 1–20 and hidden
827237017. The histories leave surviving units at fixed positions, so that
shortcut cannot be distinguished from persisted identity by those witnesses.
The builder reproduces all ten passes on those same seeds against a frozen copy
of the pre-edit bank, using the reviewer's original adapter.

Every ledger item now retains its earlier witnesses and adds real insertion and
removal before surviving units, unique-unit and file-order permutations, and
layout changes. Fictional source and input-only UTF-16 offsets and one-based lines
make the coordinate changes inspectable. The output oracle still compares IDs
by unit identity, path, quote and status; it does not fail an adapter merely for
omitting coordinate fields. Independent fresh scans also change fingerprints
while holding estate, path and positions fixed, requiring different minted IDs.

The index-based review cheat is retained with its original behavior. Separate
line-based and offset-based cheats reuse IDs by their respective coordinates.
Each must score zero on every seed, alongside the previous seven cheats. Direct
counterexamples also prove these adapters return valid snapshots while ignoring
fingerprints and transferring IDs incorrectly on reorder. Shared witnesses do
not add items or distinct causes: the bank remains 340 items with the same tiers
and declared causes. The independent cheater verdict remains **fail** pending
re-review; no reader pilot or hardness pass is claimed.
