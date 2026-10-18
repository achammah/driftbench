# Blind pointer bank

This bank is authored from `docs/estate-pointer-reader.md` at design commit
`517e63aaeea25e668dac4f9b28abc8019d906c06` and `docs/validators.md` at main commit
`346a8249d460fb0a73c1deb6cdfdc6fd10e0e6ec`. The authors never read the pointer
reader implementation, its tests, or PR 692's code diff. Existing ladder banks
were read only for their item and ladder conventions. All data is fictional.

`pointerBank()` returns 340 items: 40 labels items and 30 in every other required family. Each has an id,
family, tier, level, component, cause, design citation, and seeded generator.
`pointerLadder(adapter)` wraps them in five levels with threshold 1. The existing
ladder runner owns first-failure stopping and all-level reporting. This factory is
deliberately not registered globally: there is no real-reader adapter in this PR.
An implementation owner must wire that adapter without modifying the oracles.

## Integration boundary

`PointerAdapter.execute({ operation, input }, io)` is the only reader call. Input and
output shapes are bank-owned transport vocabulary, not claimed reader exports.
The adapter must translate calls to the actual reader and return observations.
It must not implement missing reader capabilities, import the bank, inspect the
current item, or fabricate observation fields. An unsupported operation fails.
JSON is deliberately broad enough to carry malformed answer fixtures.

Every call is isolated. Histories are explicit inputs; prerecorded responses are
planted inputs or harness-owned transport fixtures.
Requests are deep-cloned before invocation. Expected outputs, projections, item
ids, causes, representative samples, and transport fixture setup never reach the
adapter. The optional second argument supplies frozen harness-owned IO callbacks. Raw results are
projected only where the design omits serialization details. Exact deep equality
judges the resulting observation, including missing and extra values.

| Operation | Input and returned observation |
|---|---|
| `cut` | `{file,source}` → `{units:[{container,text,span:[start,end],path,yamlPath?}]}`. Ordered UTF-16 spans, verbatim source slices, no overlap. Container vocabulary: sentence, heading, list_item, table_cell, blockquote, frontmatter, fence, comment. YAML paths use dot notation. |
| `fingerprint` | `{units:[{text,container},...]}` → raw fingerprint strings. The oracle checks equality relations; hash bytes remain opaque. |
| `ledger` | `{scans,independent}` → ordered snapshots `{entries:[{id,path,status,quote}]}`. Independent scans start with empty ledgers; other scans carry the prior ledger. All units supplied here are already cut and explicitly labelled. IDs are compared as equivalence classes across the full history; duplicate entries are grouped by path, quote and status. Every ledger item also follows a unique unit through change, move and deletion beside identical-text duplicates. |
| `reanchor` | `{before,after,settings,selectIds}` → selected entries `{id,path,quote,status,lineage:[{event}],candidates:[{path,quote}]}`. Ambiguous observations retain the original pointer and all candidates. `observation:'lineage-edges'` instead returns `{event,sourceIds,targetTexts}[]`, without prescribing child-id assignment. |
| `group` | `action:windows` → `{windows:[{selectable,contextOnly}]}`. `carry` → `{carried:[{n,set,label}],dirty:[{n,set}]}`. `questions` → `{batches:[{keys}]}` in unit/label order. `dense` → `{accepted,labels:[{n,label}],unlabeled}`. Full input fixtures document the respective units, prior fingerprints, sets and answers. |
| `labels` | `action:decide` supplies set, numbered window, probabilities, system2 answer, mode and bounds → `{labels:[{n,label,target?}]}`. `validate-answer` supplies units, labelSet and sequential provider responses → `{accepted,attempts,failedWindow,labels:[{unit,label}],unlabeled}`. No natural-language classifier is provided or needed. |
| `replay` | `{mode:'ci',entries:[{request,answer}],request}` → `{status:'hit',answer,networkCalls:0}` or `{status:'miss',differingField,networkCalls:0}`. Cut mismatch additionally reports `versionsRequired:['node','icu']`, normalized from an actual diagnostic naming both versions. |
| `privacy` | Private source, request and record/CI mode → `{labels,status}` through the recorder seam. The IO fixture supplies the fictional key and provider/cache answer. Trusted traces measure key access, fetches, cache consultation, cassette writes, logs and plans. Exact labels, stored answer metadata and counts are checked; no adapter-returned counters are trusted. |
| `links` | `action:classify` supplies entries and links → `{links:[{test,span,state}]}` in link input order. `clear` supplies explicit acceptance → `{span,fp,reason}` from the new recorded review. |
| `radius` | `impact` → sorted unique `{suspectTests,advisoryTests}`; `coverage` → sorted `{uncovered}`; `claim` → `{verifiedSpans}`. Precise and section-level links are supplied separately. |

Replay entries are planted transport fixtures authored independently of the
reader. The adapter installs them through the recording seam; it must not call a
model or make a recording to obtain expected answers. Canonical object-key order
must not affect a hit. The differing field is a normalized path to the changed
input, not prescribed error-message prose. A changed set field may be diagnosed
by the actual reader as `setHash`; the adapter may expand that diagnostic using
the two input sets, but must not infer a cache miss when the reader returned a hit.
The source fixture uses `output` as its normalized output-settings field.

Privacy observations exercise the transport recorder and its public plan, before
semantic label validation. A canned answer about a fenced source is recorder
input, not a claim that the scanner should accept a label on an opaque unit.
Opaque-label refusal is checked separately by the adversarial family.

### Harness-owned privacy IO

The adapter installs these callbacks at the reader's key, HTTP, cache and public
output boundaries. It must route actual effects through them, not synthesize
callbacks from the requested mode. They perform no real network or key access.

- `readKey()` returns the planted fictional key and increments the private trace.
- `fetch(request)` returns the independently planted provider answer and counts
  the transport call. The request is private and is not a public output surface.
- `readCassette()` returns the pre-existing planted answer or a miss, and counts
  the lookup. A CI hit and miss must consult it; neither may fetch or read a key.
- `writeCassette(path, value, committed)` captures actual stored bytes as JSON.
  The normalized stored value is an array of answers, with labels, returned model,
  stop reason and usage. Private writes must be uncommitted under `.cache/`.
- `log(value)` and `plan(value)` capture public output. A single-fixture plan is
  normalized to `{characters: source.length}`. Normalization may remove display
  formatting, but must retain every free-text value for the leak check.

Only the harness closure can update the trace. Its snapshot is cloned and never
passed to the adapter. Merely returning correct counters or copied answers earns
no credit. Test-only `sampleEffects` scripts drive the positive stub through the
same callbacks, independently of the sample result.

Private markers use seeded BMP private-use characters; all legitimate public
fixture metadata is ASCII. Any single marker character in any serialized public
surface, object key or extra result field is a leak. This catches every nonempty
substring, including fragments separated across fields, without treating common
letters in legitimate labels as private text. Literal Unicode escapes are also
checked. This is a sentinel-fragment test, not a claim to detect arbitrary encodings,
hashes, timing channels or all possible exfiltration. The real adapter must expose
all sinks; hostile adapters bypassing callbacks need external process instrumentation.

Materialization adds two label actions. `materialize` supplies source, already-cut
units with ledger ids and UTF-16 spans, a label set, and planted labels. Its
observation is `{ledgerLabels:[{id,label}],atoms}`. Atoms project to kind, polarity
when present, provenance file/quote, producedBy, approved, pointer fields, and
one evidence predicate normalized as `{type:'custom',name:'prose_pointer',reviewRequired:true}`.
Other implementation atom fields are not part of this observation. `rerecord`
processes one explicitly selected set against an existing entry and returns
`{entries,diagnostics}`. The diagnostic is normalized to `{kind:'label_flip',id,set}`;
old ids and live status survive changed labels. Untouched sets retain their labels.

### Position-changing identity witnesses

Each ledger item includes fresh independent scans that change fingerprints while
keeping estate, path and unit positions fixed. It also follows uniquely identifiable
units through a real prefix insertion/removal, unit reorder, file reorder, and
layout-only shifts. The same surviving unit must keep its ID when its index,
line or offset changes. Removed entries keep their tombstones.

Ledger file inputs may carry `source`; their already-cut units carry `hint.start`
and `hint.end` (UTF-16, end exclusive) and `line` (one based). These are bank-owned
input observations, calculated from that fictional source. They are not additional
required return fields and never replace identity checks. Independent minting
must depend on the fingerprint; persisted identity must not depend on the current
position. The hash tuple encoding remains unspecified.

## Oracle boundaries

- The design does not prescribe the hash algorithm or tuple encoding for ids.
  Tests require ten lowercase base32 characters, clone consistency, uniqueness,
  and persistence instead of inventing exact id bytes. Fixed ids in old ledgers
  are fictional starting state, not expectations about minted hash bytes.
- Cut projections allow unspecified surrounding whitespace and container
  markers while checking raw source-slice fidelity first. They preserve emphasis,
  case, internal whitespace, unit order, heading ancestry, and YAML value paths.
- Re-anchoring pins the configurable exact-match floor to 20. Split/merge plants
  use exact concatenation and threshold 0.99 to isolate that step from partial
  fuzzy matching. They do not prescribe which child inherits an id.
- Fitting files and question caps have exact grouping plants. Overflow token
  accounting, fuzzy context scores, hash collision resolution, cross-file gate
  targets, tie probabilities, and suspect/advisory overlap remain unspecified by
  the design and are not assigned invented truths.
- Tier labels describe diagnosis cost, not measured implementation hardness.
  Shared cause tags stay shared. Counts do not establish the 100-iteration gate.

## Harness evidence and limits

The bank's tests use a scripted adapter that checks each request and returns its
representative raw observation. This tests the harness, not the pointer reader.
Each item has contrasting expected observations. The constant cheat gets the
first correct raw answer of each item, a stronger test than one global canned
answer. Empty and input-echo adapters must also score zero on every tested seed.
The four independent review attacks (first-unit selection, raw-text hashing,
response copying and split-text leaking) are retained verbatim in behavior in
`cheats.ts`. Each must score zero individually on every seed. Additional effectful
mutants leak each private marker character and every split while preserving all
other privacy observations, so rejection cannot rely on missing IO alone.

Fingerprint items pair semantic distinctions with byte-different NFC/whitespace
equivalence. Ledger items include duplicate text within and across files, and
verify quotes, statuses and ID continuity. Label decisions use several selectable
handles with differing results, then replay identical opinions under system 1 at
two thresholds, system 2, and the stack. Copying a recorded opinion does not compute
these policy-dependent outputs. Shared companion witnesses do not create new
items or distinct causes, and are not independent hardness evidence.
The positional re-review adds three more zero-score adapters: the original
ordinal-reuse attack plus separate line- and UTF-16-offset-keyed attacks. Each
runs against the full bank on every seed. Counterexample tests verify the attacks
produce valid snapshots, so an exception or malformed return cannot explain their
zero scores.

Tests use visible seeds 1–20 and the documented commit-derived hidden seed.
The seed changes fictional text, ids, handles, or paths. No word list is used.
Scale plants exercise 1×/10×/100× sizes and a source exceeding 100k characters.
The per-item 10-second and 64-MiB serialized-response-and-trace budgets are validator
policy, not production promises. The timer detects late returns but cannot
preempt synchronous code or cancel arbitrary promises. Hostile real adapters
need process isolation for hard termination and RSS limits.

From the repository root:

```sh
pnpm exec vitest run --config packages/validators/src/ladders/pointer/vitest.config.ts --maxWorkers=2
pnpm exec tsc --ignoreConfig --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution Bundler --types node packages/validators/src/ladders/pointer/index.ts
pnpm exec biome check packages/validators/src/ladders/pointer
```

On constrained shared machines, run each command through the assigned slot
runner. Independent merge audits and the actual reader pilot remain pending in
`validators/pointer/audit.md`.
