# Estate task generation audit

Owner rule, verbatim:

> make sure all the fixes are fixes that are TO THE FRAMEWORK in general and not just fixes that are overfitting to the problem to make the test pass

## Input and method

The baseline is commit `a91598b5e` from `feat/estate-reader-level1`.
The fictional input is `packages/generate/test/estate/scale-situations.ts`.
It contains 24 independently declared editorial skills and 576 gates:
288 distinct action/object/desk situations, each stated twice.
Descriptions deliberately share a broad desk-management purpose.
Prerequisites name policy files; asks must leave those files for the agent to discover.

The audit scans without a model, builds and approves the plan, then generates without a phrase bank.
Neither the input nor product code imports the validator's estate bank or private estate material.
The same input is used before and after. Completeness means a structurally runnable specification,
not demonstrated agent compliance. Many operation orders need a configured judge at execution time.
No model or paid API runs in this measurement.

Reproduce the measurement from the repository root:

```sh
node --import tsx packages/generate/test/estate/scale-audit.ts /absolute/output.json
```

The audit entry point works on both versions. When reproducing the baseline, copy only the audit
entry point and its fictional input into that checkout; keep product code at the baseline commit.

## Structural completeness and ask diversity

| Measurement | Before | After |
|---|---:|---:|
| Source plan rows | 9,866 | 9,866 |
| Emitted specifications, static included | 9,866 | 9,002 |
| Complete specifications | 1,802 | 9,002 |
| Incomplete specifications | 8,064 | 0 |
| Complete share | 18.26% | 100% |
| Complete specifications with an ask | 1,800 | 9,000 |
| Distinct first asks in complete specifications | 584 | 584 |
| Distinct asks per 100 complete asked tests | 32.44 | 6.49 |
| Primary gate tests | 576 | 288 |
| Distinct primary gate asks | 288 | 288 |
| Distinct asks per 100 primary gate tests | 50 | 100 |
| Exact duplicate tests represented by other tests | 0 | 864 |

The full-suite diversity rate decreases because previously incomplete event variations now have
a real task. Those variations deliberately repeat their source action across different session and
deviation cells. The distinct-ask count does not increase through cosmetic synonyms.
The primary gate comparison isolates the same rule population and removes duplicated statements.

A complete representative retains the source tests it replaces. The source-row count does not shrink.
Tests with different actions, prerequisites, workspaces, expectations, event cells or replay alignments
remain distinct. Generated criterion names are incidental; their full rubrics and flags must agree.

## Author's hand-judged sample

This is an author review, not an independent or blinded judgment.
The sample takes every thirty-first primary gate test from the baseline, up to twelve.
Each is matched after grouping through its source atom membership.

Rubric:

- Good: the principal request names the governed action and its object; it reveals no prerequisite or expected skill.
- Partial: the principal request is generic and only a secondary situation supplies the governed action.
- Meaningless: no governed task, a wrong task, or the ask states the expected prerequisite instead of requesting work.

Every baseline ask below begins “Please manage the editorial desk and its publication queue.”
Its second sentence is “This involves …” followed by the action in the table.
Every changed ask begins “Please …” followed directly by that action in imperative form.

| Governed action and object | Before | After |
|---|---|---|
| Edit the interview for desk 0 | Partial | Good |
| Translate the interview for desk 1 | Partial | Good |
| Publish the photo caption for desk 10 | Partial | Good |
| Archive the photo caption for desk 11 | Partial | Good |
| Review the interview for desk 13 | Partial | Good |
| Export the interview for desk 14 | Partial | Good |
| Translate the photo caption for desk 15 | Partial | Good |
| Edit the interview for desk 17 | Partial | Good |
| Archive the interview for desk 18 | Partial | Good |
| Publish the photo caption for desk 19 | Partial | Good |
| Export the photo caption for desk 2 | Partial | Good |
| Review the interview for desk 21 | Partial | Good |

Result: good 0 → 12; partial 12 → 0; meaningless 0 → 0.
This synthetic input reproduces generic principal requests and lost target-only context.
It does not claim to reproduce the private estate's reported meaningfulness distribution.

## Regression checks

Product tests cover independent editorial actions, standing and nested-reference ownership,
documented guard rule text and source spans, conservative refusals, multiple simultaneous missing
pieces, exact-equivalence membership, semantic counterexamples and focused mutation opportunities.
The statistics integration test generates one representative for four source cells and counts four;
striking one source row leaves three covered cells. An advisory `blocking: false` note preserves coverage.

Current plan and suite byte snapshots hash the complete rendered outputs.
The older example output tree stays as its historical capture.

Validator comparison: pending the paired all-level, all-required-seed measurements.

## Real-estate follow-up: folder ownership

The private measurement of `bb1444c09` does not reproduce the synthetic result:
complete share is 39.4%, and the owner's sample grades one meaningful, four partial and five meaningless.
Those figures are supplied by the owner; the private estate is unavailable to this implementation.
The synthetic result above establishes structural mechanics only, not general meaningfulness.

The cause is an ownership precedence error: direct reference links are navigation links, yet the first
linking skill was allowed to override the reference target's folder. A stale plan could also retain that
unrelated skill while generation appended the correct one. A broadly applicable skill then supplied
the ask for unrelated files.

The correction uses target-folder ownership for references, repairs stale row membership and metadata,
and extracts the governed action from the source clause before considering the owning skill's purpose.
Unowned shared references receive no borrowed task. Bare prerequisite titles do not become asks.
Incomplete specs remain separate and carry their reasons; equivalence grouping cannot conceal them.

The new independent regression input has 24 skills and 288 references, all deliberately linked from
an unrelated catalogue skill. It checks every reference's owner membership and all 288 distinct asks, not a sample. Additional
cases cover missing trigger fields, alternate clause forms, unowned references and stale plan metadata.
The previous synthetic input lacks this hostile cross-link pattern, which explains the missing coverage.

Approved trigger-phrase selection applies the same owner boundary. A phrase that pins a reference or declared
tool under an unrelated unit cannot supply its task. Declared tools can use their owning helper's own
approved situation when the bank omits the tool from that situation.

Private remeasurement of the correction is pending.

## Real-estate shapes: owning purpose, guard near misses, navigation documents

The private measurement of `350cba9de` shows fewer complete tests than before (5,289 against 6,015),
because the correction refused to borrow a task for atoms that have none. Four failure classes remain
visible in the counts: atoms with no task fall back to an estate-wide request; a guard's negative control
asks the same neutral question for every guard; a reference to an example file becomes a read test; and a
reference owned by a helper or a shared folder is asked as the task of an unrelated skill.

The fictional input is `packages/generate/test/estate/real-shape-estate.ts`: 26 skills with different purposes
and 8 gates each, a catalogue skill that cites every shared document, 6 helper agents, 10 shared documents
cited by several units, references that are only listed (a table row, a bullet with a label), numbered
example outputs and a blank form beside each skill, and 10 hook guards (8 with the rule in a docstring,
2 with only a tool matcher). It names no validator string, bank phrase or private estate text.

```sh
node --import tsx packages/generate/test/estate/real-shape-audit.ts /absolute/output.json [--no-documents]
```

The map records the example and template documents as navigation (as the scanner does once it classifies
document roles); `--no-documents` runs the same input with a map of the older format. No model runs.

| Measurement | Reader level 1 (`6c43ccdeb`) | Task-specific asks (`350cba9de`) | This change |
|---|---:|---:|---:|
| Emitted specifications | 5,797 | 5,717 | 5,576 |
| Complete specifications | 1,715 (29.6%) | 5,152 (90.1%) | 5,566 (99.8%) |
| Distinct first asks | 544 | 654 | 805 |
| Distinct asks per 100 complete asked tests | 31.7 | 12.7 | 14.5 |
| Most repeated ask, share of complete tests | 2.9% | 0.5% | 0.3% |
| `guard_negative` distinct asks per 100 | 10 | 10 | 100 |
| `read_when` specifications (complete) | 750 (63) | 750 (505) | 672 (672) |

The 78 `read_when` rows that disappear are the references to example outputs and the blank form: the plan
no longer lists them. The 10 specifications still incomplete are replay rows with no recorded session.
The per-100 rate stays low because event variations of one gate deliberately repeat the same task. With a map
of the older format (`--no-documents`) the same input gives 5,683 complete of 5,693 specifications, with 831
distinct asks: the example files then keep their read tests.

Author's hand-judged sample, not independent or blinded. It takes 28 rows evenly spaced over six test types
(8 `read_when`, 5 `guard_negative`, 5 `ordered_pair`, 3 `dispatch`, 4 `route_positive`, 3 `misroute`) and reads the same
row in the three versions. Good: the principal request names the governed action and its object and reveals
no prerequisite. Partial: grammatical but generic. Meaningless: unrelated to the rule under test. No test: the
row is incomplete.

| Version | Good | Partial | Meaningless | No test |
|---|---:|---:|---:|---:|
| Reader level 1 | 9 | 2 | 5 | 12 |
| Task-specific asks | 17 | 2 | 5 | 4 |
| This change | 25 | 3 | 0 | 0 |

The three partial rows in this change are two guards that document no rule (asked as a call of the tool they
watch) and one route whose request reads "help with building dock rosters". The two partial rows of the earlier
versions are a verb left in the third person ("compare two tariff tables and reports changed rates").

The synthetic sample shows the mechanics. It does not claim the private estate's distribution.

## Route and read-before asks as the work a user would say

`real-shape-estate.ts` gives every third description what real ones carry (a bracketed pointer to examples and a
purpose clause) and gives each table reference a moment cell ("Preparing ...", "Checking ...", "Closing out ...").
Measured with the same audit entry point on the head before this change (`551bb0888`) and after, same input:
complete 5,670 of 5,680 in both; distinct first asks 883 to 923 (15.6 to 16.3 per 100 complete asked tests).
The 186 changed asks are of two kinds. A description is asked as its work ("Please reconcile carrier invoices
against delivery receipts before a payment run.", not the same sentence with the pointer and the purpose clause
attached). A table reference is asked as the moment its row states ("Please check carrier invoice lines.") where
before all references of a skill shared the skill's one sentence.

## Guard rule texts that name a situation

The same estate gets six more guards whose rule text is a noun phrase (some with a condition, one a bare
condition). Same input on `5391ac0b9` and after this change: complete 5,693 to 5,715 of 5,753;
`guard_positive` 84 to 98 of 128, each other guard type 12 to 14 of 16 (the two guards left are the bare
condition and a phrase cut off after a participle: both stay incomplete with the reason).
The ask for a situation guard goes from the "no approved phrase" gap to "Please help me with a force push to the
shared release branch." and, for its negative control, to a request about what applies to that situation without
changing anything. A guard that named an act with a trailing condition ("send a price list to a carrier while the
contract is unsigned") now asks the act alone. The registry-trace gap of script-less guards is unchanged: a live
trace names the script, never the check inside it.

The real estate showed that a phrase cut from a hook text can read as a broken sentence. The synthetic estate
gains five such hook texts (a clause with a pronoun, a subordinate clause, a plural noun with a parenthesis, a
statement about the hook, a possessive phrase). On `89caebf58` each of them gave a complete guard test whose ask
was a fragment ("Please help me with the bytecode of the file it compiles."); after the change those 44 guard
rows stay incomplete with the reason, and no other row changes (complete 5,761 to 5,717 of 5,815).

The unit-run guard types (`guard_hostile`, `guard_speed`, `guard_register`) read no ask, so they carry a fixed
request that names the tool the guard watches. On the synthetic estate each of the three goes from 14 to 21
complete of 21; `guard_negative` (14) and `guard_positive` (98) are unchanged, because those two do read their ask.
A hook rule text of the form "before X, have the agent check Y" now asks X alone, and "refill a prescription"
passes the act floor: an article counts as a word of the act.

## Guards asked through the tool they watch

The real estate rejected the guard asks built from hook prose twice: hook texts describe mechanics, so a phrase cut
from them reads as a broken sentence. The guard ask is now the act of the tool the guard watches, with the strict
situation of the rule text as context, and prose replaces it only when it has the strict shape of an act or of a
situation (see the estate page). Synthetic estate, the 14 hook texts of fictional wording, same input before and
after: complete 5,738 to 5,794 of 5,815. Guard asks go from phrases cut out of the prose ("Please help me with
writes of shipping labels outside the labels folder.") to "Please change a file here." with the situation as context
when it is strict ("This involves a time window on every route stop."). The cost is variety: guard negative controls
that had a phrase of their own now share the tool act, which is why they are marked as a near miss of the tool.

## Fragments of a description

The real estate showed a heading with a count ("install workflow 6 steps") and a sentence about the unit ("plan
import is one atomic write") opening hundreds of read tests, because the description fallback took them as an act.
The synthetic estate gains two such descriptions (a heading with a count, a statement followed by a real request).
Same input before and after: a description is read sentence by sentence and only a request is kept, so the unit with
a statement first asks its real request, and the unit with only a heading stays without an ask (incomplete, with the
reason) instead of asking the heading. The 336960b81 asks that kept a bracketed pointer and a purpose clause in a
route request are cut to the work as well.
