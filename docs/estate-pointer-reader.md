# Estate pointer reader

Status: revision 5. The normative review corrections below supersede the corresponding revision-4 rules and prototype observations. The implementation and historical measurements described below are not a claim that the corrections are implemented.

Revision-4 status: Layers A and B are built behind `driftbench estate scan --pointer` (section 14, pull request 692); links (layer C), the gold-set study and the removal of the word-list finder are not. The owner ruling of 17 October is in: the labelers are named by the class the judges use, the default is a stack of a system 1 and a system 2 labeler, and a user labeler goes through the same port. It follows the research report "Pointing to exact text spans" and replaces the word-list rule finder (`candidates.ts`, `clause-rule.ts`) and the quoting model pass (`prose.ts`).

## The shape: three layers with three owners

| Layer | Owner | Job |
|---|---|---|
| A. Units, fingerprints, ledger | Code, deterministic | Cut each file into units, fingerprint them, give each a persistent id, track ids across edits. |
| B. Labels | A labeler (a model), recorded | Say which label from a user-declared label set applies to each unit. Returns names and unit numbers only. |
| C. Links | People and tests | A test or block links to a span by ledger id plus the fingerprint it was reviewed against. |

Three rules hold the layers apart:

- The labeler never writes text and never decides whether a span changed. Code copies every byte of text from the file.
- Code never decides whether a sentence is a rule. No word list, phrase pattern or grammar tagger is used anywhere.
- Change detection never depends on the labeler. A model that stops selecting a unit on a re-record produces a `label_flip` diagnostic, never a false `deleted`.

The core is generic. It knows units, labels, fingerprints, ledgers, cassettes and links. It contains no estate, agent or Nexus word. Estates are one label set that ships as data (section 1).

## 1. Label sets are user configuration

"Rule, gate, example" is one way of labelling prose. A label set is a named list of labels the user declares and describes. Labels are data, not code.

```text
# driftbench.estate.yaml (or a file named by `labels: path` in it)
labels:
  - set: agent-rules            # shipped as the default set for agent estates
    description: What an instruction file asks of the agent.
    labels:
      - name: rule
        description: A unit that tells the reader what to do.
        atom: { kind: instruction, polarity: obligation }
      - name: prohibition
        description: A unit that tells the reader what never to do.
        atom: { kind: instruction, polarity: prohibition }
      - name: gate
        description: A unit that sets an order, one act before another.
        target: required        # the labeler also names the unit that holds the other end
        atom: { kind: gate }
      - name: example
        description: A unit that shows a case and is not itself an instruction.
      - name: description
        description: A unit that states how something is, with no instruction.

  - set: house-voice            # a user's own set, on the same units
    description: How a style guide for a bakery's customer emails is written.
    labels:
      - name: voice-rule
        description: A unit that fixes a tone or a word choice for customer emails.
        examples:
          - "Write as if you were speaking over the counter."
          - "Say 'loaf', never 'unit'."
      - name: claim-needs-source
        description: A unit that states a fact about an ingredient, a price or an allergen.
      - name: legal-line
        description: A unit that must appear word for word in a message.
        examples:
          - "Allergen details are on the label."
```

Fields:

| Field | Meaning |
|---|---|
| `set` | The set's name. Unique in the file. |
| `labels[].name` | Lower-case identifier the labeler may return. `none` is reserved and always allowed. |
| `labels[].description` | One or two sentences. Becomes part of the labeler's prompt. |
| `labels[].examples` | Optional. Up to three short strings shown to the labeler. They are user text, not repo text. |
| `labels[].target` | Optional: `required` when the label links two units (a gate). Default: none. |
| `labels[].atom` | Optional. If present, a unit with this label becomes an estate atom of this kind (and polarity). A label without `atom` is stored in the ledger and can be linked to tests, but builds no atom. |

Rules:

- The labeler's prompt is generated from the set name, its description, and the label names, descriptions and examples. Its answer is limited to the names in the set plus `none`.
- Several sets may label the same units. Each set is labelled in its own request and stored apart in the ledger (section 4).
- Each set has a **set hash**: the hash of its canonical form (names, descriptions, examples, targets, atom mappings). The set hash is part of the cassette key. Editing one label of one set changes only that set's hash, so only that set is re-labelled; other sets and the units' ids are untouched.
- The default `agent-rules` set above is data in a shipped file, loaded the same way as a user set. No label name is known to the core.

## 2. Layer A: cutting

Code reads each prose file (standing instructions, memory, skill bodies and files, helper bodies, and any file the user names for a set) and cuts it into units.

Parser and offsets:

- Parse with `unified`, `remark-parse`, `remark-gfm` and `remark-frontmatter`. Every node carries UTF-16 start and end offsets; a unit's text is always `source.slice(start, end)`, never a node's `value` (a blockquote's value drops the `> ` markers).
- A leading byte-order mark is stripped and its length recorded as a base offset, so every offset still points into the original file.

Units:

| Container | Rule |
|---|---|
| Sentence | Prose is masked (inline code, URLs and link destinations become same-length placeholders; newlines become spaces), segmented with `Intl.Segmenter`, and the indices are mapped back. When unsure the cutter merges: a wrong merge costs granularity, a wrong split costs a wrong quote. |
| List item | One unit per item and per nested item. A wrapped item is one unit. |
| Table cell | One unit per cell, spanning its text (not the pipes). The row's header cell is shown with it as display-only context. |
| Block quote | One unit per paragraph, offsets covering the text after the `>`. |
| Heading | One unit per heading. Headings also form the heading path of every unit under them. |
| HTML block | Blocks such as `<role>...</role>` are parsed inside: the markdown within is cut into units like any other prose. |
| Front matter | Each string value is a unit keyed by its YAML path (a skill's `description`, for example). Structure keys are not units. |
| Fence and comment | Opaque: one unit each, shown to the labeler as the fence kind and its first line only. A label cannot be pointed at it. |

Every prose character belongs to exactly one unit. Spans never overlap.

**Cut digest.** The cutter hashes the ordered list of unit fingerprints into a digest and stores it. Replay recomputes the cut and compares digests. A mismatch stops with an error that names the Node and ICU versions, so a cutter that varies between environments fails loudly instead of renumbering silently. Experiment 6 decides whether `Intl.Segmenter` may stay or a deterministic splitter must ship.

### Example

File `.claude/skills/shelf-audit/SKILL.md` (fictional):

```
# Shelf audit

**Keys.** A key opens one door. Return every key before you leave.

- Count the till twice
- Never leave the desk unattended

Read `references/closing.md` before you lock up.
```

Units as the cutter builds them (offsets illustrative):

```json
{
  "file": ".claude/skills/shelf-audit/SKILL.md",
  "cutDigest": "5d1c…a0",
  "units": [
    { "n": 1, "container": "heading", "span": [0, 13], "fp": "9f2e…", "path": [] },
    { "n": 2, "container": "sentence", "span": [15, 24], "fp": "1b77…", "path": ["Shelf audit"] },
    { "n": 3, "container": "sentence", "span": [25, 48], "fp": "c04a…", "path": ["Shelf audit"] },
    { "n": 4, "container": "sentence", "span": [49, 78], "fp": "77d3…", "path": ["Shelf audit"] },
    { "n": 5, "container": "list_item", "span": [82, 105], "fp": "e5b0…", "path": ["Shelf audit"] },
    { "n": 6, "container": "list_item", "span": [108, 140], "fp": "0a9c…", "path": ["Shelf audit"] },
    { "n": 7, "container": "sentence", "span": [142, 190], "fp": "4be8…", "path": ["Shelf audit"] }
  ]
}
```

The number `n` is a display handle inside one request. It is not an identity (section 4).

## 3. Layer B: the labeler port

A labeler is a port with one input and one output, the same for every implementation:

```
label(window, labelSet) -> { labels: [{ units, label, target? }], meta }
```

- Input: a window of numbered units (below) and a label set.
- Output: for every unit of the window, one label name from the set or `none`. Ranges (`5-6`) are allowed. Nothing else: no text, no ids that are not in the window.

### Window

A window is a heading-bounded run of units that stays under 100,000 tokens. A file is one window if it fits; otherwise it is split at headings. Units of neighbouring windows may appear as context-only lines (not labelable). The window prints each unit as `[n] text`, with the heading path as non-selectable lines.

```
SET house-voice
LABELS voice-rule | claim-needs-source | legal-line | none
WINDOW emails.md#2  path: Customer emails > Tone
[12] Write as if you were speaking over the counter.
[13] Say "loaf", never "unit".
[14] Allergen details are on the label.
[15] Our rye loaf uses stone-ground flour.
```

Answer (dense: every unit once, ranges allowed):

```json
{
  "window": "emails.md#2",
  "set": "house-voice",
  "labels": [
    { "units": "12-13", "label": "voice-rule" },
    { "units": "14", "label": "legal-line" },
    { "units": "15", "label": "claim-needs-source" }
  ]
}
```

For a label with `target: required` the entry carries `"target": <n>`.

Why dense: each unit is considered, a missing unit shows as a gap (`unlabeled`), and a file with no rule looks different from a file the model skipped. Cost stays small (a few tokens per unit).

### Implementations

The labelers are named by the class the judges use (`docs/concepts/judges.md`): a **system 1** labeler asks one yes or no question per unit and label and reads a probability of yes; a **system 2** labeler is a chat model that reads the numbered window and answers one label per unit. The clients that fill them:

| Class | Client | How it answers | Notes |
|---|---|---|---|
| system 2 | `anthropic` (default model `claude-haiku-5-5`) | One dense request per window and set; JSON with the labels of the set; response blocks read by type (thinking blocks may precede the text); hidden reasoning off. Temperature cannot be pinned, so determinism lives in the cassette. | Key from `ANTHROPIC_API_KEY`, never printed or put in a recording. |
| system 1 | `jev` (Nexus platform; `packages/judges/src/clients/system1.ts` for the judge) | One binary question per (unit, label). One request carries a window of up to 250 questions, split only when units times labels pass the cap. A unit takes the label with the highest probability at or above a threshold (0.4), else `none`. State is the numbered window with its heading path; `jev-unit` is the other state (one unit with all its labels, one request per unit, threshold 0.7). Questions are keyed `u<n>__<label>`. | The probabilities are kept in the cassette so the threshold can change without a re-record. Call shape, cap, window size and threshold are measured on one planted estate (section 10a). The endpoint reports its usage in tokens. |
| system 1 | `openai-decisions` | The public example of the class: the same questions as predicates to `POST /v1/decisions`. | The shapes follow the provider's public description; no live call has confirmed them here. |
| either | `http:<url>`, `module:<path>` | A user labeler: the request is `{ set, window, prompt }` (system 2) or `{ set, window, state, questions }` (system 1), the answer is `{ labels }` or `{ probabilities }`. | Recorded and replayed through the cassette like the others, with the id in every key: a hash of the address, or `module:<id>`. |
| any | replay | Reads a cassette; no network. | Used by CI and validators. |
| any | planted | Built by a validator from the labels it planted. | Tests the cutter, ledger and parser with no model. |

Every labeler gives an opinion per unit of its window; the scan, not the labeler, decides the label of a unit from the opinions.

### The default stack: margin and unanimous votes

This section states the product contract formerly described by the research `STACK-SPEC.md` at revision `fc48a38494d7bf1629c2efea1151a9d5c9f6cd03`. It supersedes the earlier pass-at/fail-at cascade. The measured calibration results in the research report do not become validator accuracy thresholds.

- System 1 supplies a probability per caller-declared label. Values are finite and in `[0,1]`; the total differs from one by at most `0.01`. Invalid vectors are rejected. The margin is the largest probability minus the second largest. The core does not hard-code label names.
- `marginCut` defaults to `0.65`. A unit at or above the cut takes its system-1 top label. A unit below the cut goes to system 2. A zero cut accepts every valid system-1 decision. Raising the cut only expands the routed set.
- System 2 supplies three independent runs on the same window. Below the cut, all three votes must be present, valid members of the label set, and equal. Their unanimous label is accepted even when it differs from system 1. Otherwise the unit is unsure and goes to a person. An empty or undeclared label is never accepted.
- `requireAgreement` defaults to false. When true, every accepted unit, including an above-cut unit, must also have three valid equal system-2 votes matching its system-1 label. Accepted units are therefore a subset of the ordinary accepted set.
- A missing or malformed system-2 run counts against unanimity. A system-1 call retries once; a second failure routes its units below the cut. Changing one unit's opinions changes only that unit's route or decision.
- Both classes can be replaced by user labelers. A system-1 replacement supplies probabilities; a system-2 replacement supplies three independent votes. These are product requirements, not behavior the validator adapter implements.

### Jev settings (measured, section 10a)

Measured on one fictional estate with gold written by the helper (395 units, 5 labels, `jev-1.13.0`). The numbers show a direction, not a calibrated default. Section 10a holds the tables.

- **Batched windows of 150 to 250 questions.** A call with 30 to 50 numbered units and all 5 label questions each scored 86.8 and 86.3 accuracy. A window of 20 units scored 84.9, one unit per call 77.8. The estate took 8 to 14 calls, against 395 for one unit per call. The Jev window is sized by question count, not by the 100,000 token bound above.
- **Cap of 1,300 questions per call with normal question text.** 1,300 answered and 1,350 was refused with HTTP 400 `max_tokens_exceeded`. A refused call returns no answer at all, and the refusal does not follow request bytes. Accuracy does not rise above 250 questions, so the port stays at 150 to 250 and halves the window on a 400.
- **Flat labels, not a tree.** A two-level tree took 41 calls against 20 for the flat form, scored 84.1 against 84.9, and agreed less between runs (kappa 0.927 against 0.959).
- **The label wording is the largest lever.** Two wordings of the same five definitions moved accuracy by 13 points (71.7 and 84.9). The exclusive wording, where each definition rules out the others, is the better one. Label descriptions are therefore the quality surface of a label set (section 1), and experiment 15 keeps the builder text generic around them.
- **Any short numeric tag works as the display handle.** `[12]` scored 84.9, `<s12>` 85.0, the ledger id 84.5. The bare number scored 80.8 and quoting the unit text in the question 81.9. No id was invalid or missing in any arm. Code maps the window number back to the ledger id.
- **The threshold is set per window shape.** For windows the best value is 0.4 (88.2 at 150 questions). For one unit per call it is 0.7. The port stores the probabilities and the threshold is a setting of the shape.
- **Label from the highest probability.** The rule "first label above the threshold in a fixed order" scored 81.9 against 84.9.
- **Linking is a separate pass.** Filter units by label (rule, prohibition or gate), then send one call per block asking for each kept unit, and accept a link at probability 0.8 (F1 85.8). Its links are proposals only: section 7 counts a link towards a claim once a mutation has verified it.

### Validation of an answer

Code refuses, with a listed reason:

1. An answer that is not the agreed JSON, is for another window or set, or stopped at `max_tokens` or a refusal.
2. A label name not in the set, a unit number not in the window, a range that leaves the window, or a `target` on a label without `target: required` (or missing on one with it).
3. A label on an opaque or context-only unit.
4. An overlap: a unit named twice.

A refused answer is retried once, then recorded as a failed window. A unit missing from an accepted answer is `unlabeled`, listed, and gets no atom.

## 4. Layer A: the ledger

Unit numbers change with every edit. The ledger gives each unit a stable identity and remembers what each set said about it.

- **Id.** One id per unit that is labelled or linked: the first ten base32 characters of the hash of (estate key, path, fingerprint, occurrence index), minted once and then persisted and never recomputed. Derivation keeps independent clones consistent; persistence keeps the id after edits.
- **Fingerprint.** NFC-normalised text, white space collapsed, container markers (bullets, `>`, pipes) stripped. Case and emphasis are kept, because prompts use capitals and bold for force. No NFKC.
- **Sidecar.** The ledger is a committed file beside the estate (for example `driftbench.ledger.json`), canonical sorted JSON with no timestamps. The estate's own files are never changed by the scan. `scan --update` writes it; `scan --check` fails in CI when files changed but the committed ledger did not, like a lockfile check.

Entry:

```json
{
  "id": "k7m2q9x4ab",
  "path": ".claude/skills/shelf-audit/SKILL.md",
  "sectionPath": ["Shelf audit"],
  "container": "list_item",
  "fp": "0a9c…",
  "ctxFp": "d3f1…",
  "quote": "- Never leave the desk unattended",
  "prefix": "- Count the till twice\n",
  "suffix": "\n\nRead `references/clo",
  "hint": { "start": 108, "end": 140 },
  "status": "live",
  "labels": {
    "agent-rules": { "label": "prohibition", "source": "cassette:3fa1…", "setHash": "c9e0…" }
  },
  "lineage": [{ "scan": 4, "event": "unchanged" }],
  "twinOf": null
}
```

`twinOf` marks identical boilerplate in another file so duplicates are not confused with moves.

### Re-anchoring on a changed file

Cheapest first, on units:

1. A histogram diff of the old and new unit sequences fixes the unchanged anchors (`unchanged`).
2. Exact text elsewhere in the file or estate, above a length floor: `moved`; several matches: `ambiguous` (all kept, as the W3C model says).
3. The residue is scored pairwise: 0.6 × normalised Levenshtein on text plus 0.4 × context similarity (prefix, suffix, heading path). A pair is accepted as `changed`, with its score, only when the score is above the threshold (starting value 0.45) **and** the text similarity alone is above a floor (starting value 0.4). Without the floor, context alone carries a fully rewritten unit over the threshold: the offline run mapped 47 of 50 large rewrites to the old unit (experiment 9 results).
4. A new unit whose neighbours' concatenation scores higher than either alone: `split`; the reverse: `merged`.
5. Nothing clears the threshold: `deleted`; the quote is kept and the link falls back to the section.

CRDT-style ids are not used: the files are rewritten by git, formatters and models, which produce no operations.

## 5. Cache and cassette

Determinism lives entirely in the cassette, because the models cannot be pinned to temperature zero.

- **Key.** SHA-256 of the canonical request (model, system, messages, output settings, `max_tokens`, thinking setting). The request already contains the label-set text, so the **label-set hash is in the key**. Editing a label re-labels only under that set.
- **Readable fields** beside the key, so a miss can name what differs from the nearest entry: file, window, prompt version, schema version, set name and hash, labeler id, **cut digest**.
- **Stored answer.** The labels, the returned model id, `stop_reason`, usage, and for Jev the per-question probabilities. No file text is stored.
- **Modes.** CI mode fails on a miss (no network). Record is explicit. Entries never expire. A returned-model mismatch on re-record warns.
- **Seam.** The model port's HTTP `fetch` is the single recording seam.
- **Where.** Fixture estates commit `examples/estates/<name>/cassette.jsonl`. Private estates keep theirs in an uncommitted `.cache/` folder.

### Windows and carry-forward

The cache entry is per window, not per file. After re-anchoring, a unit whose fingerprint and context fingerprint are unchanged keeps its recorded label for each set, with no call. Only dirty windows are sent, with their unchanged neighbours marked context-only so the labeler labels only new or changed units. A context change that should flip a label is the stale-label risk; the context fingerprint is meant to catch it (experiment 7 measures it).

## 6. From labels to atoms

For a label with an `atom` mapping, code builds the estate atom:

- `kind` and `polarity` from the mapping. `provenance`: file, line span, and the verbatim `source.slice` of the unit (for a gate: the text of both units in file order).
- `producedBy: model`, `approved: false`, `fields.extraction: pointer`, `fields.unit` (the ledger id), `fields.labelSet`, `fields.cassette` (the key).
- `evidence`: one `custom` predicate `prose_pointer` with `reviewRequired: true`. The labeler does not write evidence.
- A unit that a code reader already turned into an atom is shown to the labeler as `read` and cannot be labelled again.

A label without an `atom` mapping builds no atom. Its ledger entry exists so a test can link to the span.

## 7. Layer C: links and monitoring

A test or block links to a span with `{ span: <ledger id>, fp, relation, createdBy, accepted }`. `fp` is the span fingerprint at the last accept; offsets are never stored in a link. Each scan classifies every link:

| State | Meaning |
|---|---|
| `ok` | The span's fingerprint matches. |
| `suspect` | The span is changed, split, merged or deleted. |
| `advisory` | Only the context fingerprint or the heading path changed. |
| `ambiguous` | The span matches in several places. |

The **blast radius** of an edit is the set of tests with `suspect` links, plus a separately reported advisory set (tests linked to the same section) for references a precise link may hide ("except as described above"). Only links with `createdBy: verified` count towards a claim; a link becomes verified by mutation (deleting or negating the span flips the test). Clearing a suspect link records a reason (`cosmetic`, `semantic-still-covered`, `test-updated`). Coverage reports the inverse: spans labelled with an `atom` mapping and no verified link.

## 8. How the validators replay it

- Validators never call a model and never read a key. They run `estate scan --replay <cassette>` on committed fixture cassettes, and on planted estates for which the validator writes the labels itself (so the cutter, ledger and parser are tested without mirroring a model's mistakes).
- The cutter, ledger and parser are pure functions of files, previous ledger and cassette. The same inputs give the same ledger and map, byte for byte (experiment 12).
- A changed prompt, schema, set, model, cutter or fixture file changes the key. A stale cassette is refused and the field that differs is named. Re-recording is one reviewed commit whose diff is the label changes.
- No validator item depends on a cassette that the item itself produced.

## 9. What it replaces

| Today | With the pointer reader |
|---|---|
| `candidates.ts`, `clause-rule.ts` (grammar and word lists) | Removed. Structure cuts; a labeler labels. |
| `prose.ts` (the model quotes text and writes evidence) | Replaced. The labeler returns names and numbers; code copies and builds evidence. |
| `estate scan --no-model` code-found candidates | Structured atoms only, as before the candidate pass. Prose atoms need a cassette or a labeler. |
| Cache keyed on chunk text | Cassette keyed on the whole request; carry-forward by unit fingerprint. |
| Atom ids from a slug of the title | The existing id scheme for atoms; the ledger id in `fields.unit` for tracking. |

Structured readers (frontmatter, settings, registries, routing tables, fixed-form gates, references, hazards) are unchanged.

## 10. Experiments

All use one gold set: 40 prompt and agent files from several estates, with span-level labels by two annotators, **inter-annotator agreement reported before any model score**. A subset has at least 100 commits of edits labelled for span transitions. Thresholds are starting values set before any run. Offline experiments make no model call.

| # | Hypothesis | Experiment | Falsified if | Cost |
|---|---|---|---|---|
| 1 | Plain integer ids give fewer invalid ids than prefixed forms; dense beats sparse. | Gold set, 3 runs, arms `12`, `L12`, `[12]`, `<s12>`, dense. | Arms differ by under 2 F1 and invalid ids under 1%. | ~600 calls |
| 1 (Jev side) | Done for Jev on the planted estate (section 10a): `[12]`, `<s12>` and the ledger id are within 0.5 points, the bare number is 4 points lower. No invalid id in any arm. The Haiku side and the gold set are still open. | Planted estate, 3 runs per arm. | Not applicable (measured). | Spent |
| 2 | Id-only labelling is within 3 F1 of quote-then-locate and of Citations, at lower cost. | Three pipelines on the gold set. | Either alternative wins by over 3 F1 at under 3x the cost. | ~400 calls |
| 3 | 95% of gold boundaries coincide with unit boundaries; under 15% of rules span several units. | Offline: cut the gold files. | Alignment under 95%. | Offline |
| 4 | Under 5% of gold rules sit in regions kept opaque. | Offline: count by region. | Any region over 5%. | Offline |
| 5 | Masked `Intl.Segmenter` agrees with hand cuts on 95% of boundaries; wrong splits under 2%. | Offline: 200 paragraphs hand cut. | Wrong splits over 2%. | Offline |
| 6 | The cut digest is identical across Node and ICU builds. | Offline: Node 20, 22, 24, small-icu, 200 files. | Zero files differ (then a version stamp is enough). | Offline |
| 7 | One recorded pass is stable (Jaccard 0.9 across runs); window carry-forward keeps unrelated flips under 1%. | 10 live runs per file; 100 edits; file-keyed against window-keyed. | Agreement under 0.9 (then majority of 3). | ~1,500 calls |
| 8 | Large windows fail more; integer enums cut invalid ids. | Sweep window size and selection ratio. | Range check alone leaves under 0.5% invalid. | ~300 calls |
| 8 (Jev side) | Done for Jev on the planted estate (section 10a): accuracy peaks at 150 to 250 questions per call, a hard cap sits at 1,300, and no answer below the cap was invalid. The Haiku side is open. | Planted estate, 9 window sizes from 25 to 1,250 questions. | Not applicable (measured). | Spent |
| 9 | The ladder gets 90% of units in the right class, zero wrong anchors on unambiguous cases, 15 points over diff alone. | 50 synthetic edits per class plus the labelled history; threshold sweep 0.3 to 0.7. | Any wrong anchor on an unambiguous case. | Offline |
| 10 | The normaliser flags under 2% of cosmetic commits and never merges a semantic flip. | Offline over history; 200 minimal mutations. | A semantic miss, or cosmetic suspects over 2%. | Offline |
| 11 | Verified span links give blast-radius precision and recall of 0.8 against a full rerun. | 30 spans, 3 mutants each. | Recall under 0.8 and advisory links do not help. | ~90 suite runs |
| 12 | Cassette replay is byte-identical, and a one-field change misses and names the field. | Offline: replay twice, perturb each key field. | Any difference or silent hit. | Offline |
| 13 | **System 1 against system 2, and the two together**, on the same labelled set: accuracy, cost, speed and run-to-run agreement. **Status: the Jev side ran on the planted estate (section 10a). On the fictional fixture the arms ran once against a coarse reference (section 14); the gold-set comparison has not run.** | Same units and sets, arms: system 2 alone (Haiku, one dense request per window), system 1 alone with window state (one request per window and set), system 1 alone with unit state (one request per unit, all labels as questions, so the window state is measured against the unit state), and the stack; 3 runs each, with the probability bounds swept. Metrics: per-unit accuracy and F1 against gold, cost per file, wall time per file, pairwise agreement across runs. | Reported, not falsified: it decides which labelers are the default and whether system 1 needs a calibration step. | ~600 calls each |
| 14 | Editing one label re-labels only under its set. | Offline with a fake labeler: edit one label of one of two sets. | Any call under the unedited set, or any unit id change. | Offline |
| 15 | The labeler prompt generated from a set is generic: the same prompt text builds for an agent set and a bakery style set. | Offline: build prompts for both sets and check no estate word is in the template. | A fixed word in the template. | Offline |

Order: offline first (3, 4, 5, 6, 9, 10, 12, 14, 15), then the pointing experiments (1, 2, 7, 8, 13) before the schema is frozen, then 11. No paid run starts without approval.

## 10a. Offline results so far (prototype in `research/pointer-reader/`)

The table below ran on a throwaway prototype, with no model call. The Jev measurements after it are live recorded calls (subsection "Jev measurements"). Nothing here is the gold-set study: experiments 3 and 4 wait for the two-annotator gold set, and the gold in 5 and 9 is built by construction from hand-written sentences and synthetic edits, so the numbers show what the machinery can do on cases the author thought of.

| # | Result |
|---|---|
| 5 | 200 paragraphs, 629 gold sentence boundaries (half hard-wrapped at 50 columns). Raw `Intl.Segmenter`: recall 95.9%, precision 77.4% (176 wrong splits, 22.6%). Masked plus shape merge: recall 95.7%, precision 97.4%, wrong splits 16 (2.6%), all of them "Prof. Ito" (a four-letter title; a shape rule cannot tell it from an ordinary word before a full stop). The falsifier (wrong splits under 2%) is missed by that one case. Missed boundaries (4.3%) are sentences that start in lower case ("iOS ..."), which the merge rule joins to the previous sentence. |
| 6 | 108 markdown files, 25,195 units, cut under Node 24.18 (ICU 78.3, Unicode 17.0) and Node 22.18 (ICU 77.1, Unicode 16.0): 0 files differ in cut digest. Only these two builds exist on this machine; Node 20 and a small-icu build are untested. |
| 9 | 9 edit classes x 50 synthetic edits on 11 real files (450 edits). As written (0.6 text + 0.4 context, threshold 0.45): accuracy 89.6%, **47 wrong anchors**, all large rewrites mapped to the old unit by context. With a text-similarity floor of 0.4: accuracy 100%, 0 wrong anchors, 0 false deletes. Diff-only baseline (unchanged plus exact moves): 66.7%, 150 false deletes (small rewords, splits, merges). Threshold sweep with the floor: 0.3 and 0.6 give 100%; 0.7 gives 94.9% with 19 false deletes and 4 wrong anchors. Floor sweep at 0.45: 0.3 leaves 4 wrong anchors, 0.5 gives 100%. The small reword here is one or two words; a meaning-preserving rewrite with many changed words is not in the set. |
| 10 | 200 rules (sentences and list items holding must, never, always, should, only, before, after, every) x 5 cosmetic edits and 8 semantic edits. Fingerprint as designed (NFC, white space, container markers stripped, case and emphasis kept): 2 of 1,000 cosmetic edits flagged (both a CRLF rewrap that put "- " or "1. " at a line start, which marker stripping erases), 0 of 663 semantic edits missed. Case-folded: 0 flagged, **82 of 663 missed** (all capitalisation flips). Case-folded and emphasis stripped: 97 of 663 missed (82 capitalisation, 15 removed emphasis). Bullet swap and renumbering through the cutter: 0 of 200 flagged. |
| 12 | Recording the fixture (5 files, 2 sets, 20 windows) and replaying it twice in CI mode gives the same 43,303-byte ledger as the recording run; a second independent recording dumps a byte-identical cassette. Six perturbations (a label description, a renamed label, an added example, a changed unit, a new file, a tampered cut digest) all missed, and the miss named the differing field (`setHash`, `part.user`, `part.output`, `cutDigest`). |
| 14 | Editing one label of the `agent-rules` set: 10 labeler calls (one per `agent-rules` window), 0 for `house-voice`; every unit id and every `house-voice` label unchanged. |
| 15 | The system text and the user text outside set-derived lines are identical for the `agent-rules` and the `house-voice` set, and contain none of the words estate, agent, skill, nexus, claude, driftbench, helper, prompt, rule, gate, instruction, bakery, email. |

Findings that change the design:

- The ladder needs the text-similarity floor above (section 4).
- The cutter must stop recursing into HTML blocks: an `<role>` line that is not a tag-only line re-parses as the same HTML block. The prototype cuts nested HTML at depth 2 as opaque.
- The fingerprint's container-marker stripping erases a real "- " or "1. " that a hard wrap puts at a line start. It is rare (0.2%) and errs towards a suspect link, not a missed change.

### Jev measurements (research/jev-id-experiments, 5f985e100)

Full tables, run files and the recorded answers are in `research/pointer-reader/jev-experiments/RESULTS.md` on that branch. All numbers below come from that file.

**Caveats that bind every number here.**

- One fictional estate (a bakery, 13 files, 395 planted units, 20 test blocks with 37 true links), written by one person.
- The gold labels were written by the helper, then changed once after it saw Jev's errors (25 units relabelled, the question text unchanged). Against the first gold the three main arms score 2 points apart and no ranking changes.
- The label definitions were rewritten once after the first run. The 13-point wording effect below compares the first wording with the rewrite, so part of it is the author learning where Jev failed.
- The units are short imperative sentences. Real prose, several estates, units longer than a sentence and other label sets are not covered.
- Haiku was not run. There is no Jev against Haiku comparison (experiment 13).
- Measured use was 9,206,100 tokens in and 3,345,114 out over 2,405 answered requests. At the Jev price of section 11 (USD 0.042 per million input tokens, output free) that is USD 0.39.

**Window size (5 labels per unit, threshold 0.5, accuracy %, Macro F1 in brackets).**

| Questions per call | Calls for 395 units | Accuracy (F1) |
|---|---|---|
| 5 (one unit) | 395 | 77.8 (79.4) |
| 25 | 79 | 83.9 (82.8) |
| 100 | 20 | 84.9 (84.5) |
| 150 | 14 | 86.8 (87.2) |
| 250 | 8 | 86.3 (87.1) |
| 400 | 5 | 85.8 (86.8) |
| 1,250 | 2 | 83.4 (85.4) |

**Cap.** 1,300 questions per call answered with the normal question text, and 1,350 was refused (HTTP 400 `max_tokens_exceeded`, no partial answer). One-line questions went to 2,500 and were refused at 3,000. The refusal does not follow request size or output tokens, and the rule was not isolated. Below the cap, 0 answers were invalid or missing in every arm.

**Design choices.**

| Choice | Result |
|---|---|
| Label wording | First wording 71.7 accuracy, rewritten exclusive wording 84.9. |
| Flat labels against a two-level tree | 84.9 in 20 calls against 84.1 in 41 calls. |
| Id form (20-unit window) | `<s12>` 85.0, `[12]` 84.9, ledger id 84.5, quoted text 81.9, bare number 80.8. |
| Threshold | 20-unit window and 150-question window best at 0.4 (86.3 and 88.2). One unit per call best at 0.7 (81.0). |
| Decoding | Highest probability 84.9, fixed-order first-above-threshold 81.9. |
| Agreement between runs | 94 to 98% of units get the same label in two runs (kappa 0.93 to 0.97). Averaging 3 runs did not help the best arm (87.1 against 86.8). |

**Where it errs (150 questions per call, run 1).** Prohibition (F1 95.2) and example (93.3) are easy. A gate called a rule is the largest confusion (12 of 46 gates); gate recall is 71%. Descriptive table cells and headings fall between description and none (11 of 124 description units became none).

**Linking (20 blocks, 37 true links, one call per block, F1 at 0.8).**

| Pool sent for each block | Calls | F1 at 0.8 |
|---|---|---|
| All 395 units | 20 | 79.3 |
| All units, 100 per call | 80 | 81.3 |
| Units labelled rule, prohibition or gate by the labeler (155 to 159 kept) | 14 labelling + 20 linking | 85.8 |
| Units with the gold labels (upper bound only) | 20 | 90.1 (91.5 at 0.7) |

Sending the whole estate at 0.5 gives recall 95% and precision 35%, because Jev says yes to many neighbours. The probability threshold, 0.8, matters more than the pool.

**Run time.** 395 units took 22 to 23 s at one unit per call, 3.8 s at 150 questions per call (14 calls, one at a time) and 2.7 s at 250 (8 calls, one at a time).

Cost on the fixture (13 files that go to the model today): 8,384 characters of prose, 149 units (14 headings, 37 sentences, 40 list items, 30 table cells, 28 front-matter values), 18 windows, 22,450 request characters for one set. That is about 5,600 input tokens by the characters-divided-by-four rule, so about $0.0006 on the Haiku 5.5 input price the research report gives ($0.10 per million tokens, not re-checked). The provider's own token count replaces the estimate before any run.

## 11. Model, key and cost

- System 2: `anthropic`, default model `claude-haiku-5-5`, key from `ANTHROPIC_API_KEY`, never printed or put in a recording. Price: USD 0.10 per million input tokens and 0.50 per million output tokens, derived from the recorded receipts of the repository (three receipts fit to four digits).
- System 1: `jev` reads `JEV_API_KEY`, `JEV_URL` or `JEV_ROUTE` and `JEV_MODEL`; its answers carry `usage.input_tokens` and `usage.output_tokens`. Price: USD 0.042 per million input tokens, output free (source: the owner, 17 October 2026). The same source also says prices "drop to around 0.25 per million" on volume packs, which contradicts the first figure; this page uses 0.042.
- The cost of a run is the tokens each service reported times its price. A stack costs the sum of its two members, and its two single-class arms cost nothing more, because they replay the same cassette.
- Before any spend on an estate, the scan prints a plan: per labeler, the requests it needs, how many the cassette answers and the characters left to send. A token count is estimated by the characters per token measured on the fixture (3.1 for the dense request, 3.85 for the yes or no request) until a first run replaces it with the reported tokens. A private estate is sized by counts only.

## 12. Open questions

- Whether `Intl.Segmenter` is deterministic enough (experiment 6).
- Whether Jev's per-unit binary questions can match Haiku's single dense pass on accuracy, and at what cost (experiment 13).
- Whether a gate may target a unit in another file of the skill.
- How the reviewer sees `description`-like labels without an atom mapping.
- Whether the advisory (section-level) set is worth its noise (experiment 11).

## 13. Build order

1. Unit cutter, fingerprints, cut digest; experiments 3 to 6.
2. Ledger with the ladder and `scan --check`/`--update`; experiments 9, 10.
3. Cassette, replay seam, planted labeler; experiments 12, 14, 15.
4. Label sets, prompt builder, Haiku port, window carry-forward.
5. Links and blast radius.
6. Jev port; experiments 1, 2, 7, 8, 13.
7. Remove the word-list finder and its tests; move the corpora into labeler tests.

## 14. What is built

Behind an opt-in flag, `driftbench estate scan <root> --pointer --cassette <file> [--record] [--labeler <class>:<client>[:<model>]]... [--labels <file>] [--ledger <file> [--ledger-check]] [--labeler-threshold <p>] [--labeler-pass-at <p>] [--labeler-fail-at <p>] [--jobs <n>]`. Code is in `packages/estate/src/pointer/` (cutter, ledger, cassette, label sets, the labeler port with its dense, yes or no and user clients, the stack, scan, atoms) and `packages/cli/src/commands/estate-pointer.ts`. Without the flag the scan is as before.

| Part | State |
|---|---|
| Cutter, fingerprint, cut digest | Built. No word list: sentence breaks come from `Intl.Segmenter` over masked text, merged by shape only. |
| Ledger with the ladder (unchanged, moved, ambiguous, changed, split, merged, deleted) and `--ledger-check` | Built, with the text-similarity floor of section 4. A label carries the hash of the labelers and bounds that made it. |
| Cassette keyed by the whole request and the labeler id, readable fields, a miss that names the differing field | Built. One file holds the answers of every labeler of a run; each answer is appended as it arrives. |
| Label sets as data, the shipped `agent-rules` set loaded by the same parser | Built. |
| System 2 client (`anthropic`, default `claude-haiku-5-5`, hidden reasoning off) | Built. |
| System 1 clients (`jev` with window and unit state, `openai-decisions`) | Built. The probabilities are recorded, so a threshold is a replay setting. `openai-decisions` is unconfirmed by a live call. |
| The default stack with `pass at` and `fail at`, and each class alone | Built. |
| User labelers by HTTP endpoint or module, through the same port | Built. |
| Parallel requests (`--jobs`) with the same ledger and the same cassette bytes | Built. |
| Atoms from labels (quote and lines are `source.slice` of the file, one reviewed `prose_pointer` check) | Built. A gate takes the quote from its first to its second unit. |
| Window halving on a refused request | Built. The refusal is recorded, so a replay halves the same way. |
| Links and blast radius (layer C), `scan --update` | Not built. |
| Removal of `candidates.ts`, `clause-rule.ts`, `prose.ts` | Not done: the flag is opt-in, and flipping the default is the first work package after the fair test. |

### Fixture recording (fictional Northwind estate, one run per arm)

154 units in 14 files. One recording of the default stack holds the answers of both classes: 18 dense requests to system 2 and 19 window requests to system 1 (its cap is 250 questions). The unit-state arm of system 1 is a second recording of 154 requests.

| Arm | Requests | Tokens in / out | Cost (USD) |
|---|---|---|---|
| System 2, `claude-haiku-5-5`, dense window | 18 | 9,597 / 1,914 | 0.0019 |
| System 1, window state | 19 | 52,900 / 18,476 | 0.0022 |
| System 1, unit state | 154 | 93,319 / 18,788 | 0.0039 |

Costs follow section 11. An earlier recording of these arms stored 0 tokens for system 1, because the client did not read the `usage` the endpoint reports; the cassettes were re-recorded. Three earlier runs of system 2 while the request was fixed (hidden reasoning that used the whole output allowance, a window id the model did not echo) cost about 0.0067 more.

Reference for the next table: the 57 prose atoms of the fixture map that its author approved. It is coarse: a pointed atom counts as right when its lines overlap an approved atom, and an approved atom counts as found when a pointed atom overlaps it. It is not the gold set of section 10.

| Arm | Atoms built | Overlap an approved atom (precision) | Approved atoms found (recall) | Units decided |
|---|---|---|---|---|
| System 2 alone | 59 | 56 (94.9%) | 53 of 57 (93.0%) | system 2 154 |
| System 1 alone, window state, threshold 0.4 | 79 | 59 (74.7%) | 55 of 57 (96.5%) | system 1 154 |
| System 1 alone, window state, threshold 0.7 | 69 | 56 (81.2%) | 54 of 57 (94.7%) | system 1 154 |
| System 1 alone, unit state, threshold 0.7 | 79 | 56 (70.9%) | 52 of 57 (91.2%) | system 1 154 |
| Stack, pass at 0.9, fail at 0.1 (default) | 60 | 56 (93.3%) | 53 of 57 (93.0%) | system 1 29, system 2 125 |
| Stack, pass at 0.8, fail at 0.1 | 68 | 57 (83.8%) | 54 of 57 (94.7%) | system 1 67, system 2 87 |
| Stack, pass at 0.7, fail at 0.2 | 70 | 57 (81.4%) | 54 of 57 (94.7%) | system 1 78, system 2 76 |
| Stack, pass at 0.6, fail at 0.2 | 72 | 57 (79.2%) | 54 of 57 (94.7%) | system 1 109, system 2 45 |

Reading: on this one small fictional estate system 2 alone is the most precise at the same recall, system 1 alone finds one or two more approved atoms for 20 more atoms, and the stack falls between them, closer to system 2 the more extreme the bounds. The units that system 1 called with a probability from 0.6 to 0.9 and system 2 did not (10 units, 1 in the reference) show why the bounds are extreme. One estate, one run per arm and a reference built by overlap prove no ranking. They make experiment 13 on the gold set worth its cost. The bounds are not tuned on any private estate.

### Jev request size on the fixture

The window of 48 units with 6 labels (288 questions) was answered. Repeating its units to larger windows: 504 and 1,002 questions were answered, 1,500 and above were refused with HTTP 400 `max_tokens_exceeded`. The cap is a token budget, not a count, which matches the 1,300 and 1,350 of section 10a. The client defaults to 250 questions per request and halves a window that the endpoint refuses.

## 15. Normative review corrections

These rules are explicit product requirements added with the validator repair. They are distinct from historical prototype observations in section 10a.

### Sentence boundaries and generic templates

A clear sentence boundary returned by the masked segmenter is not erased solely because the next sentence starts with a lowercase character. `We bake rye daily. iOS bakers prefer wheat.` has two units. Merge-when-unsure still applies to actual ambiguity such as an abbreviated title; the observed lowercase merge is a defect.

The generated prompt depends on caller-declared set fields and units. Two equal-shape sets on the same units have identical system and user templates after substituting their names, descriptions, examples and other declared fields. No vocabulary blacklist defines genericity. Code does not classify prose using word lists.

### Re-anchoring context score

For the pairwise residue in section 4, text similarity is normalized Levenshtein similarity of the fingerprint-normalized quotes. Context consists of the preceding and following 24 UTF-16 code units in the source, clipped at file boundaries, and the heading path. Context similarity is the arithmetic mean of the prefix similarity, suffix similarity, and heading-path equality (one when equal, zero otherwise). Prefix and suffix use normalized Levenshtein similarity.

The defaults accept a pair only when text similarity is strictly above `0.4` and `0.6 × text similarity + 0.4 × context similarity` is strictly above `0.45`. Retention is not required to be monotone in text similarity when context differs. Each weighted-score probe must control both inputs; unrelated edits must not silently change the tested context.

### Label-set validation

Set names are unique. Label names within a set are unique lower-case identifiers without whitespace; `none` is reserved and cannot be declared. An explicitly supplied `target` can only be `required`. Each malformed field is rejected with the offending set or label named. These are separate validation rules. A combined malformed-set check is not evidence of one atomic implementation fix.

### Cassette integrity on a key hit

Every readable field stored beside a cassette key must equal the corresponding metadata of the current request, even when the key itself matches. A mismatch refuses replay and names the differing field. This includes model, output and thinking settings, file, window, prompt version, schema version, set, set hash, labeler id and cut digest. A validator can tamper exactly one readable field without corrupting an unrelated key. A changed canonical request derives a different SHA-256 key; no arbitrary key flip substitutes for that derivation.

Replay expectations come from committed fixtures or independently authored source boundaries and labels. Recording behavior can be tested, but a recording produced during an item never becomes that item's replay input or expected answer.

### Validator adapter observability contract

The validator adapter maps product exports. It does not infer per-id events from changed quotes, compare ledger bytes to implement check mode, reconstruct lineage or twin relationships, decide labels, or generate warnings. Product results pass through unchanged, including wrong results that the bank must reject.

The current API uses `buildLabelling` for configured model clients, `singleLabelling` for a planted labeler, `denseOpinions` for planted answer interpretation, and `pointerScan({labelling, ...})`. The bank's `haiku` arm selects the `system2:anthropic` client; `jev` and `jev-unit` select their `system1` clients. Every network call uses the supplied fake transport. The adapter forwards the product's call count.

Optional observation extensions have these shapes:

- `pointerScan` may expose `eventsById: Record<string, string>` and `warnings: string[]`. Its existing `events` remains the aggregate event-count map.
- Ledger entries may expose `lineage: Array<{scan: number, event: string}>` and `twinOf: string | null`.
- An exported `checkLedger(previousRaw: string | undefined, currentLedger)` may return `{ok: boolean, error?: string}`. Check mode delegates to that export. Without it, check mode reports an explicit unavailable capability; the adapter never recreates the CLI's check.
- `margin(probabilities)` is forwarded unchanged. Independent stack-vote validation uses an optional exported `stackDecision(request)` with the `StackRequest` and `StackDecision` types declared in the validator port. Without that export, independent-vote checks report an unavailable capability. The adapter does not combine votes or force a two-member stack to accept an independent-vote array.

Absent observations stay absent. An item that needs an observation must require it explicitly; missing per-id events never mean `unchanged`. A reported empty array, empty map, or null twin is distinct from an unavailable observation.

These extension names specify the validator interface, not existing product capabilities. At PR692 head `575e7d706c7aae52e945f12e5fd5e0c26680c7d2`, `pointerScan` exposes aggregate events but no per-id map or warnings; ledger entries expose neither lineage nor twinOf; check mode exists only inside the CLI `openPointer(...).finish(...)`; independent-vote stackDecision is not exported. The adapter must not hide these gaps.
