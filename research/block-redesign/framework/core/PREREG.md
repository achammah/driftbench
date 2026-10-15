# Framework core experiments HF1 to HF4: pre-registration

Written 2026-10-15, before any code that produces a result. The commit that adds this file is the pre-registration.

- Design under test: `research_notes/Driftbench block redesign/config_framework.md` (Cue workspace), sections 2 and 4: the object envelope, items, `extends`, six layers, `uses`, `Verdict.by`, the re-judge path.
- Hypotheses source: `codex/block-experiments/framework/HYPOTHESES.md`, Group A. Protocol: `codex/block-experiments/PROTOCOL.md`.
- Base: `origin/main` at `6a6f88ecd905aa9740c251254ad447ba9a109559`. Branch `research/block-framework`. No file under `packages/*` is changed; every stand-in lives in this folder.
- Spend: 0 USD. No model call, no network call. Lane cap: 0 USD.

## Hypotheses, metrics and falsifiers (verbatim from HYPOTHESES.md)

- **HF1 Backward compatibility.** A prototype loader with the new optional keys (`uses`, `links`, `diagnostics`, `simulated_user`, `parent`, `compare`) gives every example spec on origin/main the same content hash and the same block cache keys as main. Metric: specs with a changed hash. Falsifier: 1 or more.
- **HF2 Default parity.** Shipped default rule files that encode today's behaviour (exact compare, today's check set) re-score the stored H1 runs (259 runs) with the same verdicts as stored. Metric: changed verdicts. Falsifier: 1 or more.
- **HF3 Override precision and stamps.** A project file that overrides exactly one item changes only verdicts whose `by.item` is that item; every verdict carries `by`; an override naming an unknown item is refused with the parent's item list. Metric: untargeted verdict changes; verdicts without `by`; unknown-item overrides accepted. Falsifier: any of the three above 0.
- **HF4 Re-judge without the agent.** Changing a scoring-only file re-scores the 259 stored runs with 0 agent calls (counted at the adapter). Falsifier: more than 0.

## HF1 method

- Population: every file `findSpecFiles(['examples'])` of origin/main returns (`*.yaml`, `*.yml`, `*.spec.json` under `examples/`, skipping dot folders, `node_modules`, `dist`). An "example spec" is a file main's `loadSpecFile` loads with `ok: true`. Files main refuses are also run through the prototype; whether the prototype refuses the same files is reported, outside the verdict.
- Main's loader: `loadSpecFile` of `packages/core/src/spec/load.ts` at the base commit, unchanged.
- Prototype loader (`src/spec-ext.ts`): the same pipeline (block YAML parse, `normalizeSpec`, schema parse, `checkSemantics`, `lintSpec`, `contentHash`, the `./` workspace anchoring), with main's `Spec` schema replaced by a Zod extension that adds, all optional and without defaults: `uses` (spec and block), `links` (block), `diagnostics` (block), `simulated_user` (a fourth arm of the block stimulus union), `parent` (on the block `given`), `compare` and `reason` (on the `exact` and `one_of` arms of a tool-input assertion, plus an `equals` arm that takes `compare`). The extension is built from main's exported schemas with `.extend`; nothing in `packages/*` changes.
- Hash: `LoadResult.hash` of each loader. Changed hash = the two strings differ.
- Block cache keys: for each block index i of a spec loaded by both, `blockCacheKey` (`packages/core/src/runner/cache.ts`) with `specHash = contentHash(spec without version)` (as `runSpec` computes it), `repeat 0`, `position i`, `given = resolveGiven(canonicalGiven(spec, i))`, `stimulus = block.when`, `target = spec.target ?? { adapter: 'stand-in' }`, `adapter 'stand-in'`, `adapterVersion '0'`. This is the teacher-forced key: every input of the key that comes from the spec, with the agent-produced history replaced by the canonical prefix. A spec counts as changed when any of its block keys differs. Free-running keys also depend on agent output, which no loader touches.
- Verdict: SUPPORTED if 0 specs have a changed hash and 0 specs have a changed block cache key; FALSIFIED if 1 or more specs have a changed hash (the binding falsifier); a changed cache key with an unchanged hash is reported and also counts as FALSIFIED, since the hypothesis names both.
- Controls, outside the verdict, run to show the comparison can fail:
  - C1 new key present: every example spec with `uses: { value_check: default }` added at the top. Expected: the prototype loads it and its hash differs from main's hash of the plain spec, for every spec; main's loader refuses it with `unknown key`.
  - C2 broken extension: a mutant extension where `uses` defaults to `{}`. Expected: a changed hash on every example spec.
  - C3 a fixture spec using all six new keys loads under the prototype and is refused by main.

## HF2 method

- Data: `data/h1-runs-class.jsonl`, copied byte for byte from `research/block-phrasing` at `58669be07`, path `research/block-redesign/phrasing/data/h1/runs-class.jsonl`, SHA-256 `a5e752629b50c73cc0c6af000af1920ea24f7d1eac23851358c76d7477c5e6d3`. 259 runs, 10 blocks (B1 to B10), 0 agent errors, 77 stored exact passes.
- Stored verdicts: per run, `exact` (pass flag) and `exactFailed` (the ids of the failed gating verdicts), written by `exactOracle` of `src/oracle.ts` on that branch: the gating verdicts of today's `tools` check, plus `<label>.count0` for a tool expected 0 times that was called.
- Block expectations: each block's `expect` read from its spec on origin/main (the specs and `packages/checks` are identical between the phrasing branch's merge base `37cbeebd8` and origin/main; checked with `git diff --stat`, empty).
- Prototype: an object resolver (`src/objects.ts`) and a re-scorer (`src/rescore.ts`). Shipped default files: `objects/shipped/check-set/default.yaml` (items `tools.count`, `tools.input_closed`, `tools.order`, `tools.argument_accuracy`, `forbidden.count0`, in today's emission order) and `objects/shipped/policy/value-check/default.yaml` (items `rung1_outcome`, `rung2_contract`, `rung3_same_referent` shipped disabled, and `rung4_exact` enabled for every assertion, params `case_insensitive: false`, `strip_punctuation: false`). Input-assertion verdicts are emitted by the value-check rung that decides them; every other verdict by its check-set item. Item implementations are stand-ins copied from `packages/checks/src/checks/tools.ts` at the base commit (count, input-closed, order, argument accuracy) and call main's `checkAssertion`, `countAllows` and `isZero` unchanged.
- Metric: changed verdicts = the number of (run, verdict id) pairs among gating verdicts whose fail status differs between stored and re-scored (the symmetric difference of the failed-id multisets, summed over runs). Also reported: runs whose pass flag differs.
- Verdict: SUPPORTED if 0 changed verdicts; FALSIFIED if 1 or more.
- Reference, outside the verdict: main's own `tools` check (`packages/checks/src/checks/tools.ts`, unchanged) run on the same data through the same oracle shape, compared with the stored verdicts and with the prototype.

## HF3 method

- Overrides (pre-registered list, each a project-layer file that extends a shipped default and holds exactly one item operation, selected by a project-layer `uses`):
  - O1 `policy/value-check` `rung4_exact` params `{ case_insensitive: true }`
  - O2 `policy/value-check` `rung4_exact` params `{ strip_punctuation: true }`
  - O3 `check-set` `tools.order` `enabled: false`
  - O4 `check-set` `tools.count` `enabled: false`
  - O5 `check-set` `forbidden.count0` `enabled: false`
  - O6 `check-set` `tools.argument_accuracy` `enabled: false`
  - O7 `check-set` `tools.input_closed` `enabled: false`
- Metric (a) untargeted verdict changes: for each override, re-score the 259 runs; a (run, verdict id) pair is changed when it is present in one scoring and absent in the other, or its outcome or score differs. A change is untargeted when neither side's `by` names the overridden object kind and item. Summed over O1 to O7. Primary: every verdict the re-scorer emits, the non-gating `argument_accuracy` included. Secondary, outside the verdict: gating verdicts only. Also reported per override: targeted changes (an override that changes nothing tests nothing).
- Metric (b) verdicts without `by`: over the baseline and the seven override scorings, the count of verdicts whose `by` is missing or lacks `object`, `item`, `impl` or `layer`.
- Metric (c) unknown-item overrides accepted: 8 planted overrides, each naming an item the parent does not hold: U1 set params on `rung5_judge`; U2 `enabled: false` on `tools.ordr`; U3 replace impl on `R3`; U4 `order` listing an unknown id; U5 a case variant `Tools.order`; U6 `rung4_Exact` params; U7 a check-set op on a value-check item id (`rung4_exact` in a check-set file); U8 an unknown id with `params` and `when` but no `title` or `impl` (not a full add). Refused means the resolver raises a load error whose message names the unknown id and every item id of the parent. Anything else counts as accepted.
- Negative control, outside the verdict: the seven valid overrides O1 to O7 and one valid add (a new item with `title` and `impl`) must load.
- Prediction stated before data: `argument_accuracy` aggregates the input verdicts and is stamped by its check-set item, so O1 and O2 may change it while it does not name `rung4_exact`. If that happens it counts as untargeted under the primary metric.
- Verdict: FALSIFIED if any of (a), (b), (c) is above 0; SUPPORTED if all three are 0 and at least one override has 1 or more targeted changes; INCONCLUSIVE if all three are 0 and no override changes anything.

## HF4 method

- An instrumented adapter (stand-in of the adapter contract: `open`, `send`, `close`) counts every call and returns the stored observation of the run.
- Re-judge path (stand-in of `campaign rejudge`): each stored run carries the agent-facing key it was produced under, computed at baseline from main's `blockCacheKey` with `stimulus { user: run.text }` and the hashes of the resolved agent-facing objects (none at baseline: the key then equals main's). After a file change the key is recomputed; an equal key re-scores the stored observation, a different key calls the adapter.
- The scoring-only change: replace the project layer with O1 (a `policy/value-check` file). Metric: adapter calls during the re-score of the 259 runs. Also checked: the re-score actually ran (the verdicts are recomputed, and O1's targeted changes, if any, appear).
- Verdict: SUPPORTED if 0 adapter calls; FALSIFIED if 1 or more.
- Controls, outside the verdict: (P1) an agent-facing change (a project-layer `run-profile` object with another model id) must produce 259 adapter calls; (P2) the same scoring-only change written at the spec layer (`uses` on the spec) under main's cache-key rule (`contentHash(spec without version)`) is counted and reported as a design finding, with the variant that leaves `uses` out of the cache key.

## Sample, seeds, models, stop

- Samples: HF1 all example specs (count reported); HF2 to HF4 the 259 stored runs. No sampling, no seeds (every step is deterministic). No model. Stop rule: none needed at 0 USD; a crash is fixed and the run repeated with both outputs kept and the reason written.
- Report: `RESULTS.md` (plain English, counts, verdict per hypothesis), `results.json` (per-item data), `LEDGER.md` (0 USD).
