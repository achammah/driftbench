# Framework core experiments HF1 to HF4: results

Pre-registration: `PREREG.md`, commit `5c8cb667fbf5bd5136cfd0e3097e0a452af7c154`. Base: origin/main `6a6f88ecd`. Spend: 0 USD, no model call. Every step is deterministic and runs on the full population, so the counts below are exact; there is no sampling interval to report.

| Hypothesis | Verdict | The number that decides it |
|---|---|---|
| HF1 Backward compatibility | **SUPPORTED** | 0 of 2,351 example specs change hash; 0 of 4,453 block cache keys change |
| HF2 Default parity | **SUPPORTED** | 0 changed verdicts over 259 runs (1,223 gating verdicts re-scored, 403 stored failures, 77 stored passes) |
| HF3 Override precision and stamps | **FALSIFIED** | 36 untargeted verdict changes (all on the non-gating `tools.argument_accuracy`); 0 verdicts without `by`; 0 of 8 unknown-item overrides accepted |
| HF4 Re-judge without the agent | **SUPPORTED** | 0 adapter calls to re-score 259 runs after a scoring-only project file change |

## HF1 Backward compatibility: SUPPORTED

- Population: 2,448 files under `examples/` that main's `findSpecFiles` picks. Main loads 2,351; the prototype loads the same 2,351. The other 97 are refused by both (criteria files, fixtures, other YAML).
- Content hash: 0 of 2,351 specs differ.
- Block cache keys (teacher-forced, every spec-derived input of `blockCacheKey`): 4,453 blocks, 0 keys differ, 0 key errors.
- The comparison can fail, shown by the controls:
  - C1: with `uses: { value_check: default }` added, all 2,351 specs load in the prototype, all 2,351 hashes differ from main's, and main refuses all 2,351 with `unknown key: uses`.
  - C2: a mutant extension where `uses` defaults to `{}` changes the hash of all 2,351 specs.
  - C3: a fixture using all six new keys loads in the prototype; main refuses it on each of them.
  - C4: an unknown key is still refused by both loaders.
- Why it holds: every new key is optional with no default, so an absent key never reaches the canonical JSON. C2 shows the one way to break it: a schema default.

## HF2 Default parity: SUPPORTED

- Shipped files `objects/shipped/check-set/default.yaml` (5 items) and `objects/shipped/policy/value-check/default.yaml` (the 3 ladder rungs shipped disabled, `rung4_exact` enabled) re-score the 259 stored H1 runs.
- Changed verdicts: 0. Runs whose pass flag changed: 0. Re-scored passes 77, stored passes 77.
- Reference: main's own `tools` check, run unchanged on the same data, also differs from the stored verdicts by 0 and from the prototype by 0.
- What this does and does not show: the item implementations call main's assertion and count helpers and copy main's order logic, so the compare itself agrees by construction. What the test proves is the rest of the path: the resolver builds the defaults, the check-set order runs, input assertions route to the value-check rung, and the disabled rungs stay out.

## HF3 Override precision and stamps: FALSIFIED

| Override (one item op each) | Targeted changes | Untargeted | Untargeted, gating only |
|---|---|---|---|
| O1 value-check `rung4_exact` case_insensitive | 36 | **36** | 0 |
| O2 value-check `rung4_exact` strip_punctuation | 0 | 0 | 0 |
| O3 check-set `tools.order` disabled | 107 | 0 | 0 |
| O4 check-set `tools.count` disabled | 388 | 0 | 0 |
| O5 check-set `forbidden.count0` disabled | 48 | 0 | 0 |
| O6 check-set `tools.argument_accuracy` disabled | 259 | 0 | 0 |
| O7 check-set `tools.input_closed` disabled | 0 | 0 | 0 |
| **Total** | 838 | **36** | 0 |

- (a) Untargeted verdict changes: 36. All 36 are `tools.argument_accuracy` under O1: case-insensitive compare flipped 33 `catalog.search.input.customer_email` and 3 `coverage.check.input.address` verdicts from fail to pass, and each flip changed the argument-accuracy score of its run. That verdict is stamped by the check-set item that computes it, not by `rung4_exact`. This was predicted in PREREG before any data.
- (b) Verdicts without `by`: 0 of 11,054 (baseline plus seven overrides).
- (c) Unknown-item overrides accepted: 0 of 8. Each refusal names the unknown id and the parent's full item list, for example: `unknown item tools.ordr in check-set:u2 (unknown/U2.yaml); the parent check-set:default holds tools.count, tools.input_closed, tools.order, tools.argument_accuracy, forbidden.count0`.
- Negative control: the seven valid overrides and one full add all load.
- Secondary, outside the verdict: on gating verdicts only, untargeted changes are 0.
- The design gap: `Verdict.by` names one item, and one item cannot name a verdict that is computed from other verdicts. Two ways to close it, for the owner to pick:
  - add `by.reads: [<object#item>, ...]` on aggregate verdicts, and state the precision rule as "changes only verdicts whose `by.item` is that item, or whose `by.reads` names it";
  - or move such aggregates to a diagnostic (2.7), which never changes `pass`, so verdict precision holds by definition.

## HF4 Re-judge without the agent: SUPPORTED

| Change | Adapter calls (open + send + close) | Runs re-scored from storage | Gating verdicts changed |
|---|---|---|---|
| Scoring-only, project layer (O1 file): **the test** | **0** | 259 of 259 | 36 |
| P1 control: agent-facing `run-profile` model change | 777 (259 runs x 3) | 0 | 0 |
| P2 probe: the same O1 change as `uses` on the spec, main's cache-key rule | 777 | 0 | 36 |
| P2 probe: the same, cache key leaving `uses` out | 0 | 259 | 36 |
| No change | 0 | 259 | 0 |

- The re-score ran: 36 gating verdicts changed and 680 verdicts now carry `policy/value-check:o1` in `by`.
- P1 shows the counter counts: an agent-facing change reruns every run.
- Caveat: at the project layer the result holds by construction, since a project object never enters the spec. The P2 probe is the finding: a scoring-only change written as `uses` on a spec or block changes `contentHash(spec without version)`, which today's `runSpec` uses as the cache key, so all 259 runs would rerun. The framework must leave `uses` (and any other scoring-only key) out of the cache key, as `version` is today (`runner/run.ts` lines 138 to 139). With that one exclusion the spec-layer change also costs 0 agent calls. The rejudge `compatibilityHash` was not tested and may need the same rule.

## Files

- `PREREG.md`, `LEDGER.md` (0 USD), `results.json` (verdicts, HF2 per run, HF3 per change, HF4), `results-hf1.json` (HF1 per spec).
- Code: `src/spec-ext.ts` (extended schema and loader), `src/hf1.mts`, `src/objects.ts` (objects, extends, item ops, layers, refusal), `src/rescore.ts` (items, rungs, `by` stamps), `src/hf234.mts`, `src/core-shim.ts`.
- Objects: `objects/shipped/*`, `objects/overrides/O1..O7, ADD, P1`, `objects/unknown/U1..U8`.
- Data: `data/h1-runs-class.jsonl`, from `research/block-phrasing` at `58669be07`, SHA-256 `a5e75262...c5e6d3`.
- Reproduce from the worktree root: `tsx --tsconfig research/block-redesign/framework/core/tsconfig.json research/block-redesign/framework/core/src/hf1.mts`, then `.../src/hf234.mts`.
