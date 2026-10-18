# Blind variable-store and planner bank

330 adapter-only items: 30 in each family, six in each family/tier, 66 in each tier (1–5).
The author never read the store or planner code, their tests, or PR diffs 706, 719, 753, 756, 757 or 758.
All names, statements, source files, conversation counts and hashes are fictional. There are no word lists,
private inputs, model calls, network calls or production imports in the bank.

## Frozen sources

- `docs/variables.md` from `origin/feat/planner-v2`, commit `76b33bc4aed76483293f4bd8fa3d080cd9c42bf1`.
- `docs/validators.md` from main, commit `346a8249d460fb0a73c1deb6cdfdc6fd10e0e6ec`, read in full.
- Existing map/statistics banks supply only the item/level format.
- Owner clarification: a shared axis occurs in at least two multi-variable rules.

The variable document at that commit describes store validation, quote checking and `planV2`.
It marks feed/interview readers as not built. The owner states that their open PRs exist; a separate seat
wires this adapter after the relevant code merges. No undocumented feed/interview API or output schema is invented.
This is a bank delivery, not a claim that the live component passes or the hardness gate holds.

## Adapter wiring contract

Implement `VariablesAdapter.execute(Request)` from `bank/types.ts` in a separate integration file.
Only requests cross the port. Do not pass item IDs, family, cause, tier, fixtures' truth or a check callback.

| Operation | Documented function | Adapter responsibility |
|---|---|---|
| `validate` | `validateVariableStore(value)` | Return its acceptance, preserved store, warnings/errors with code/path; retain NaN/Infinity inputs without a JSON round trip. |
| `quotes` | `verifyVariableQuotes(store, root)` | Materialize the request's fictional `files` beneath a disposable root; verify actual quotes; normalize issues to `{errors: [{code,path}]}`; missing files must stay missing. |
| `plan` | `planV2(store, options)` and `renderPlanV2(plan)` | Return `{plan,text}`; normalize only layer containers and warning-code containers to the interface. Preserve renderer bytes, row order, IDs, counters and numeric precision. Normalize JSON minus infinity to null. |

The format PR is 706, interview 753, estate feed 756, conversation feed 757, planner 758.
These references identify integration dependencies, not inspected implementations.
The bank does not call `loadVariableStore` or `parseVariableStoreText`: filesystem/YAML parsing belongs to
future explicitly specified items. It does not invent interval-fitting rules: weights here are normalized
relative shares, checked through exact analytic log weights within the documented nine-decimal rounding tolerance.

`items` exports the descriptors; `runItem(item, seed, adapter)` returns a verdict and diagnostic.
`measure(seed, adapter, allLevels)` walks five levels with threshold 1 and stops at the first failure by default.
`allLevels: true` measures all 330 items while preserving the first-failure level. A partial run exposes
`evaluatedScore`; its bank `score` is null until all items have run.
Registration and floor changes are intentionally left to integration, after the real baseline and pilot.
An adapter must not fill omitted results from the bank's oracle. In adversarial audits isolate the component
in another process: an in-process port cannot stop malicious code reading the bank's exports.

## Planted truth and item coverage

| Family | Items | Main planted guarantees |
|---|---:|---|
| sources | 30 | Counts, privacy-only fields, hash form, real calendar date, ledger form; accepted/rejected paired stores. |
| quotes | 30 | Whitespace, typographic quotes, Unicode composition, markdown escapes; exact case/punctuation; missing source diagnostics. |
| values | 30 | Unique IDs, cross-axis ambiguity, kind uniqueness, when/unless references, approval overrides. |
| boundaries | 30 | All four comparisons, inclusive/strict edges, distinct sides, existing edge value; negative/zero limits. |
| impossible-pairs | 30 | Unary/pair/triple exclusions, indirect unreachability, details, approval filtering. |
| weights | 30 | Complete/nonzero/nonnegative/finite weights, normalization, scale-equivalent shares, zero support. |
| strength | 30 | Own triples/quartets, shared pairs, detail exclusion, conditional membership, ledger grouping. |
| seed-rows | 30 | Partial/full sessions, duplicates, forbidden sessions, unknown-entry removal, budgets below seed count. |
| budget-order | 30 | Zero/one/interior/ample cuts, descending weight, seed prefix and exact unlimited-plan prefix. |
| counter | 30 | Exact target/seeded/covered/uncovered/infeasible counts, overlapping groups, empty and complete coverage. |
| scale | 30 | 1×/10×/100× width, unequal/zero weights, details, wide seeds, 100k-character source files. |

Tier contexts compose each capability with: basic axes (1), a detail (2), heterogeneous cardinality (3),
an unapproved decoy (4), and reordered coordinates plus instruction-bearing Unicode data (5).
Scale additionally expands 12 coordinates to 120 and 1,200. Every seed changes fictional identifiers and
selected numeric inputs; the test suite uses visible seeds 1–20, the review regression seed 820020691,
and the documented commit-derived hidden seed (deduplicated when equal).

The small-space oracle enumerates all valid full assignments, then constructs the feasible target sets
from planted rule groups. It checks actual rows against those sets and recomputes every counter.
Constraint-free scale cases use independent singleton targets, avoiding exponential reference work.
It does not duplicate the greedy algorithm, demand minimality, prescribe an undocumented tie hash,
or require a different seed to produce different rows. Repeated identical inputs must return identical bytes.
Budget cases compare the exact prefix of a separately obtained unlimited result.

Scale cases enforce 5,000 ms and 256 MiB retained-heap growth per adapter call. These are bank acceptance
budgets, not measured production performance. The in-process timer detects slow completed calls; it cannot
preempt synchronous hangs. Retained-heap growth is not peak RSS. Integration must also impose a worker
deadline and external peak-memory cap before claiming the full section-12 scale audit.

## Harness tests and limitations

Run from the repository root with installed workspace tooling:

```sh
pnpm exec vitest run --root packages/validators/src/ladders/variables/bank \
  --config vitest.config.mts --maxWorkers=2
```

The test-only adapter precomputes canned replies and exhaustive covers. Its green result proves the
harness accepts matching replies; it does not validate a production implementation. Analytic checks
separately pin target counts and log normalization. Twenty response mutations exercise checker failures;
they are not the twenty real-component planted bugs required by the independent audit.

Every item must reject empty, constant and echo adapters on every visible seed and the hidden seed.
The call-index cheat family tries every period from 1 through 8 and every offset, both with a counter
carried across items and with a counter reset for each item. These cheats receive otherwise-correct canned
payloads for validation, quote and planner replies; only their answer class follows the call index.
The review's original quote-only reproducer is also retained on seeds 1, 20 and 820020691.
Additional tests reject always-invalid and always-empty quote-success responses. Valid/invalid paired
cases prevent an item from passing merely because an adapter always rejects or always accepts.

### Case scheduling

Item order is shuffled within each tier with an `item-order` seed domain. Answer positions use a separate
`case-order` domain keyed by the seed, stable item ID and retry number; traversal position does not enter it.
Each item retains every original case and repeats its smallest contrasting cases to at least 17 calls.
Every proposed permutation must contain incompatible answer classes in at least one residue for **each**
period 1–8. A residue contradiction rules out every motif and offset of that period, not just the tested
three-way quote pattern. Generation throws if bounded rejection sampling cannot produce such a schedule.

Classes use required acceptance/diagnostic fields, or the planner's required agent/version/seed identity.
Labels, truth and schedule state never cross the adapter port. The schedule is deterministic and seed-varying;
it is not a cryptographic secret and does not defend an implementation that reads oracle exports.
Budget-prefix and repeat-byte comparisons run independently of case execution order.
The scheduling tests also verify residue contradictions independently and compare positional patterns after
removing seed-dependent names, so renamed fixtures cannot masquerade as order variation.

There are 66 declared cause labels, reused across tier variants. This is deliberately below the section-12
requirement of 100 independently reviewed *failing* causes: renaming variants would not create new fixes.
Real failing causes, pilot progress, forecast, and all independent verdicts remain unmeasured.
See `validators/variables/audit.md`; the PR must not be interpreted as passing the merge-hardness gate.
