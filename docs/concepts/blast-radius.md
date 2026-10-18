# Blast radius

A change to one part of an agent has a blast radius: the blocks that part can affect. When you fix something related to a block, you do not need to run every test again, only the radius. driftbench computes it from what each block already says it reads.

What is built today: the agent version of a run, the dependencies of a block, the radius of a change, the read-only command `driftbench radius`, and `campaign run --change`, which runs the radius and carries the stored results of the other cells. See [what comes next](#what-comes-next) for the parts that are not built yet.

## A change

Every field of a change manifest is in the [change manifest reference](../reference/change.md).

A change manifest names the agent version before and after, and every change made between the two.

```
from: acme-v1
to: acme-v2
changes:
  - kind: stage
    id: recap
  - kind: tool
    id: coverage.check
    part: input
```

| Kind | Id | Blocks it selects |
|---|---|---|
| `stage` | a stage of the catalogue | blocks that expect the stage, and blocks whose cell or stage transition names it |
| `tool` | a tool label, with an optional `part` | see the table below |
| `rule` | `states@<stage>` | blocks at that stage that assert on the reply text |
| `rule` | `recovery:<class>` or `recovery:<class>@<flow>` | the probes of that deviation class, in that flow when one is named |
| `rule` | `uses_tool:<tool>` | the same blocks as a tool change with no part |
| `rule` | `path:<id>` | every block of the specs that walk that path of the map |
| `rule` | a spec rule: `lang_stable`, `max_calls`, `forbidden_tools`, `one_message_per_turn`, `match_case`, `custom.<name>` | every block of a spec whose `rules` carry it |
| `rule` | `reply_language` | the whole suite: the rule holds on every block |
| `deviation` | a deviation class, `D2` or `D2_goal_shift` | the blocks that carry the class |
| `prompt` | an estate atom id | the blocks of the specs whose `metadata.estate.atoms` name it, and every block that names no atoms |
| `map` | `dimension=value` | blocks whose cell holds the value, or whose user turn was phrased from it |
| `fixture` | a fixture name, a workspace file, `family:<id>`, or a literal value such as an email | blocks whose Given names it, task specs of that family, and blocks whose When, expected inputs or end state hold the value |
| `criterion` | a judged criterion | blocks whose `expect.criteria` name it |
| `model`, `agent` | none | the whole suite |

A tool change says which part of the tool changed, because a block that must not call a tool still reads the tool: a new description can make the agent start calling it.

| `part` | Blocks |
|---|---|
| `input` | blocks that expect one call or more, or assert on its input; specs whose `rules.max_calls` cap it |
| `result` | blocks that expect one call or more; blocks whose Given forces the tool's result or error; the last block of a spec whose end state reads `tool:<label>` |
| `description`, `presence`, or none | every block that lists the tool, count 0 included; specs that forbid or cap it; blocks that check it is offered |

`global: true` on any change declares that it applies everywhere: the whole suite.

## What a block depends on

Nothing new is written in a spec. `blockDependencies(spec, index)` of `@agent-nexus/driftbench-core` reads what the block already carries, whether it is a conversation exchange or a task step:

* Its Then: the tools it lists with their count, its stage, its `must` and `must_not`, its language, its criteria, its guards, skills, artifacts, workspace and execution checks, the spec rules, and the end state on the last block. These are the fields the [gate](../generating.md#the-gate) reads.
* Its Given: the tools it forces, the store keys, the fixtures and the workspace files, the spec's own and every block's up to it.
* The map, for a generated block: the cell and the phrase the generator recorded (`metadata.generated`), the path it walks, the deviation class it injects.
* The prompt, for an estate test: `metadata.estate.atoms`.
* For a task spec: its family, as the fixture `family:<id>`.

A hand-written spec has no cell and no atoms. It can declare what it depends on:

```
metadata:
  depends:
    tools: [order.create]
    stages: [recap]
    rules: [confirmation]
    atoms: [a-12]
    fixtures: [cust-001]
```

## The radius

1. Direct: every block whose dependencies name a change of the manifest.
2. Forward closure: a block whose Given was produced by a block in the radius is in the radius too. In mode F and P a block inherits the agent's own earlier replies, so every block after a direct block of the same run is in. In mode T a block starts from its canonical Given, written by the spec, so nothing follows. One exception: a task step in a sandbox keeps the workspace the step before left, until a step writes its own `given.world.workspace`. See [run modes](run-modes.md).

The unit that reruns is the cell: one spec on one target in one mode for one repeat. A cell is in the radius when one of its blocks is, and it reruns whole, from its first block. The blocks of that run before the first direct block are run again and are not counted in the radius.

## Unknown means in

The radius is conservative by default.

* A block whose dependencies are unknown is in every radius: a hand-written spec with no generator record, no estate atoms and no `metadata.depends`.
* A change the radius cannot map is the whole suite: a kind it does not know, `model`, `agent`, `global: true`, the reply language rule, a change with no id.
* A change no block declares is the whole suite: a new tool or a stage no spec names can reach any block, and nothing says which.
* A `map` or `path` change puts in every block that records no cell; a `prompt` change puts in every block that names no atoms.
* A tool change with no `part` counts every block that lists the tool, count 0 included.
* A manifest with no change between two different versions is the whole suite, unless its estate prompt no-op evidence is revalidated as described below.

## The agent version

A carried result must say which agent produced it. `agentVersionOf(run)` reads the version from the target a run already records: the hash of the prompt `campaign run --prompt` pinned, else the target's `variant`. `campaign run --agent-version <label>` writes the variant of every target that names none. The target is part of the cell id and of the cache key, so a run under `v2` never reuses a run or a cached block of `v1`.

## The command

`driftbench radius <specs> --change <manifest>` runs nothing and writes nothing. It exits 0 when the radius is smaller than the suite, 1 when it is the whole suite, 2 on bad input. `--mode` takes the modes to plan for, `--json` prints every block with its state and its reasons.

```
$ pnpm -s driftbench radius examples/acme/gated/specs --change examples/acme/radius/stage-recap.yaml --mode F,T
Blast radius of acme-v1 to acme-v2 (manifest edeee14e9937): stage:recap.
195 specs, 861 blocks scored (6 more run with their spec and are not scored: a gate rejected them).
Mode F, free-running: 298 of 861 blocks in the radius (233 direct, 65 forward), 563 out. 102 of 195 cells.
  A cell reruns whole: 601 of 861 blocks sent, 30.2% saved; 93 of 195 cells left to carry.
Mode T, teacher-forced: 233 of 861 blocks in the radius (233 direct, 0 forward), 628 out. 102 of 195 cells.
  A block runs alone in this mode: a rerun of the radius sends 233 of 861 blocks, 72.9% saved.
In the radius, mode F:
  spec                   blocks in  from                 why
  gen-boundary-063       3 of 5     b3-offer-to-recap    stage:recap
  (101 more rows)
exit 0
$ pnpm -s driftbench radius examples/acme/gated/specs --change examples/acme/radius/reply-language.yaml
Blast radius of acme-v1 to acme-v2 (manifest 0bf51ed76989): rule:reply_language.
195 specs, 861 blocks scored (6 more run with their spec and are not scored: a gate rejected them).
The radius is the whole suite: rule:reply_language: the reply language rule holds on every block. Nothing can be carried.
exit 1
```

## Fresh and carried

`campaign run --change <manifest> --from <campaign>` plans the campaign as usual, then splits its cells. The cells in the radius run. For every other cell, the run the `--from` campaign stored is copied into the new campaign, under the new campaign's own cell id and target, and stamped:

```
carried:
  fromCampaign: c-base
  fromRun: 3f0c9a51d2e84b77
  agentVersion: acme-v1
  age: { campaigns: 1, days: 0.4 }
```

`fromCampaign` is the campaign that ran the cell fresh, however many campaigns carried it since. `agentVersion` is the version that produced the result. A carried run costs nothing against the budget and gives no cost sample.

A cell is carried only when everything says the copy is a valid sample of the new agent. Any doubt runs it fresh:

* Nothing is carried when the radius is the whole suite, when the campaign names no agent version (pass `--agent-version` or `--prompt`), when that version is not the manifest's `to`, or when the `--from` campaign holds no run of the manifest's `from`. The campaign then runs whole, and the first lines say why.
* A cell outside the radius runs fresh when the `--from` campaign holds no run of it, when that run did not complete, or when it names another agent version.

The cell lines and `campaign status` mark each carried cell. `campaign resume` reruns nothing that is carried: the copy is a completed run.

```
$ driftbench campaign run examples/acme/gated/specs --target function:acme-sales --route flow:price-sheet=process:acme-ops \
    --agent-version acme-v2 --store runs.db --change examples/acme/radius/stage-recap.yaml --from c-base
Blast radius of acme-v1 to acme-v2 (manifest edeee14e9937): stage:recap.
102 of 195 cells in the radius. 102 cells run fresh, 93 carried from c-base.
✓ gen-boundary-063 · function:acme-sales · F · repeat 0  pass  5 blocks
✓ gen-boundary-064 · function:acme-sales · F · repeat 0  pass (carried from c-base, age 1 campaign)  2 blocks
(193 more cells)
195 cells: 195 pass, 0 fail, 0 failed, 93 carried. Spent $0.00.
Fresh: 102 cells, 606 blocks sent to the agent. Carried from c-base: 93 cells, 261 blocks not sent (agent version acme-v1; this campaign runs acme-v2).
Saved: 261 of 867 blocks, 30.1%. The pass and fail counts above merge fresh and carried results.
```

The 867 blocks are every block the 195 conversations and tasks send, the 6 a gate does not score included.

### The audit sample

The radius is sound when the manifest lists every change. The audit checks that claim on the run itself. `--audit <n>` draws n of the cells about to be carried, with a seed (`--audit-seed <n>`, default 1: the same seed draws the same cells), runs them fresh before anything is carried, and compares each fresh run with the stored run it would have copied: the status, every gating verdict of every block, each block's pass, the end state. Wording, latency and cost are not compared.

* One cell that differs is a radius miss: the change reaches a block the manifest left out. The gate fails closed. Nothing is carried, every cell runs, the output names the cell and what differed, and the command exits 1. `ci` gives the verdict `radius-miss`.
* No miss in n audits bounds the share of carried cells the new agent would not reproduce, at 95% confidence, by `1 - 0.05^(1/n)`: under 13.9% for 20 audits, under 5% for 59.
* The audited cells are fresh runs of the campaign: they are kept, paired in `compare`, and listed as outside the radius and run fresh, `drawn for the audit`.

On the Acme sales conversations (171 cells), with no model call (`packages/cli/test/radius-audit.test.ts`):

```
Blast radius of acme-v1 to acme-v2 (manifest 346ce00f59e4): deviation:D4.
Audit: 20 cells drawn from the 157 outside the radius (seed 1) and run fresh: 1 miss.
  gen-twise-058: block 4 forbidden.order.create: pass then fail; block 4 must.0: pass then fail; (5 more)
RADIUS MISS: the change reaches cells the manifest left out of the radius. The gate fails closed.
Nothing is carried, every cell runs: the audit found 1 of 20 carried results the new agent does not reproduce.
```

That agent orders on a loose yes at the recap, and its manifest names the D4 handler alone. With the same agent unchanged and 59 audits, the output reads `0 misses. At 95% confidence, under 5.0% of the carried cells would disagree.`

An audit is a sample. The fault above changes 11 of the 157 cells outside its radius, so 20 audits find it about four times in five (0.79); seed 1 does. A full run on a schedule is what finds the rest.

### Staleness

A carried result is one old draw of the agent. Two limits bring it back into the run:

* `--max-carry <n>`, default 5: the most campaigns in a row a result is carried. A result carried again keeps the campaign that measured it and the version it was measured on, and its age counts from there.
* `--max-age <days>`, default 7: the most days since the result was measured.

A campaign with no `--change` carries nothing. Run the whole suite on a schedule, nightly for instance: every result is then fresh again, and every age starts from 0.

### In the statistics and the report

A carried result is the baseline result copied. Paired with the baseline it would agree by construction, and narrow the interval with no evidence. So:

* `compare` and `ci --change` pair a candidate unit with a baseline unit only when the candidate side is fresh. A carried unit is listed under `unpaired`, with the campaign and the agent version it comes from and its age. McNemar, the Wilcoxon test, the criteria and the parity verdict read the fresh pairs only.
* A rate over the campaign itself (the scorecard, `campaign status`) describes the agent, so it counts both, and says so: `Fresh and carried results are merged: 102 runs fresh, 93 runs carried.` When the carried results were measured on another agent version, the line names it: `93 runs carried from c-base, measured on another agent version, acme-v1 (this campaign runs acme-v2)`.
* In the scorecard, each carried run says where it comes from in its own row.

A radius that touches few goldens cannot show parity: the planning numbers of `compare` are over the fresh pairs, and say when they are too few.

### End to end on Acme

`packages/cli/test/radius-carry.test.ts` runs the whole chain with no model call. A baseline campaign runs the real agents as `acme-v1`: 195 cells pass. The sales assistant then suffers the planted fault that skips the recap and runs as `acme-v2`. The radius campaign of the recap change sends 606 of 867 blocks and carries 93 cells. A full campaign of the same faulty agent fails on 102 cells: the same 102 the radius campaign fails on, none of them carried.

## Measured on Acme

The Acme gated suite holds 195 specs and 861 scored blocks: 171 conversations on the sales assistant and 24 tasks on the ops agent. The manifests are in [`examples/acme/radius`](../../examples/acme/radius/README.md). Mode F; the saving is the share of blocks a rerun of the radius does not send.

| Change | Manifest | Direct | With forward closure | Cells | Blocks sent, cell unit | Saved |
|---|---|---|---|---|---|---|
| the recap stage | `stage-recap` | 233 | 298 | 102 of 195 | 601 | 30.2% |
| the input of `coverage.check` | `tool-coverage-check-input` | 86 | 316 | 86 | 413 | 52.0% |
| `coverage.check`, no part | `tool-coverage-check` | 810 | 810 | 168 | 810 | 5.9% |
| what the offer states (prices) | `states-offer` | 141 | 555 | 125 | 692 | 19.6% |
| the D2 handler | `deviation-goal-shift` | 9 | 22 | 9 | 55 | 93.6% |
| the D6 handler | `deviation-instruction-in-data` | 13 | 44 | 13 | 68 | 92.1% |
| the D8 handler | `deviation-tool-failure` | 15 | 15 | 15 | 44 | 94.9% |
| the D9 handler | `deviation-out-of-scope` | 11 | 38 | 13 | 70 | 91.9% |
| the price sheet task family | `price-sheet-family` | 35 | 35 | 24 | 35 | 95.9% |
| the reply language rule | `reply-language` | 861 | 861 | 195 | 861 | 0% |
| a tool no block names | `new-tool` | 861 | 861 | 195 | 861 | 0% |

These are counts of blocks, not seconds: the deterministic Acme agents answer in milliseconds, so a wall time would say nothing about a real agent. The share of blocks not sent is the share of agent calls, and of their cost, a rerun saves.

**No false safe.** Each scored Acme fault is a change the agent suffered. The committed gate report holds a full run of every fault on every block. `examples/acme/test/radius/contained.test.ts` takes the manifest of each change and asserts that every block the full suite turns red lies inside its radius.

| Fault | Manifest | Red blocks in the full suite | Outside the radius |
|---|---|---|---|
| `x3-skips-recap` | `stage-recap` | 237 | 0 (4 are in through the forward closure) |
| `x5-drops-coverage-check` | `tool-coverage-check-input` | 86 | 0 |
| `x1-invents-price` | `states-offer` | 125 | 0 |
| `x4-wrong-language` | `reply-language` | 826 | 0 (the whole suite) |
| `d4-order-on-loose-yes` | `confirmation-rule` | 54 | 0 (4 through the closure) |
| `d2-ignores-goal-shift` | `deviation-goal-shift` | 22 | 0 (13 through the closure) |
| `d6-obeys-instruction` | `deviation-instruction-in-data` | 13 | 0 |
| `d8-hides-tool-failure` | `deviation-tool-failure` | 15 | 0 |
| `d9-answers-out-of-scope` | `deviation-out-of-scope` | 11 | 0 |
| `ops-x1-wrong-price` | `price-sheet-family` | 33 | 0 |
| `ops-x4-narrates` | `price-sheet-family` | 35 | 0 |
| `ops-x5-skips-check` | `price-sheet-family` | 35 | 0 |
| `ops-d6-deletes-readme` | `price-sheet-family` | 16 | 0 |

The test can fail. A manifest that declares the loose confirmation fault as a change to the D4 handler alone, leaving out the recap, misses red blocks, and the test asserts that it does. Without the forward closure the recap change would miss 4 red blocks and the D2 change 13.

## When it is sound

The radius is sound for the declared change under two assumptions: a block's outcome depends only on its declared dependencies and its run history, and the manifest lists every change. It is not a proof that the new agent equals the old one outside the radius. A full run on a schedule, with no manifest, is what checks that.

Mode F containment is measured from the gate report, which holds free-running fault runs. Mode T containment is measured by running the faulty agent: see [mode T block reruns](#mode-t-block-reruns).

## What comes next

Not built yet, in order:

* The learned dependency table and automatic estate-diff ingestion.

## Prompt quotes

`radius auto` compares two prompt files against the approved map's `evidence.quote` anchors. It writes a normal change manifest, so campaign carry, age limits and audits keep their existing checks. Successful manifest creation exits 0, including when the manifest selects the whole suite; invalid input exits 2. Run `radius <specs> --change <manifest>` to compute the radius and get exit 1 for a whole-suite result. The source path selects exactly one of the map's declared sources. Every other source is assumed unchanged; include its change separately if it changed too.

For Acme, use a quote map declaring just the approved offer anchor, then change its price expression.
The full Acme map contains repeated and overlapping evidence; it conservatively selects the whole suite.
The focused map below does not justify any other edit: text changed outside its one anchor still selects everything.

```sh
node -e 'const fs = require("node:fs"); const text = fs.readFileSync("examples/acme/src/policy.ts", "utf8"); fs.writeFileSync("/tmp/acme-price-next.ts", text.replace("plan.monthly_usd}", "plan.monthly_usd + 1}"));'
node --input-type=module -e 'import fs from "node:fs"; import { parse } from "yaml"; const map = parse(fs.readFileSync("examples/acme/map/approved.yaml", "utf8")); const offer = map.relations.find(r => r.kind === "states" && r.to === "offer"); fs.writeFileSync("/tmp/acme-price-quotes.json", JSON.stringify({ ...map, dimensions: [], constraints: [], phrases: [], relations: [offer] }));'
pnpm -s driftbench radius auto --prompt examples/acme/src/policy.ts /tmp/acme-price-next.ts --map /tmp/acme-price-quotes.json --source ../src/policy.ts --from-version acme-v1 --to-version acme-v2 --out /tmp/acme-price-change.yaml
pnpm -s driftbench radius examples/acme/gated/specs --change /tmp/acme-price-change.yaml --mode T --explain
```

The manifest records each changed region, its old and new offsets, the matched entry, source and quote, and the rule that selected blocks or forced a full run. `--explain` prints those anchors, then every block's dependency reasons and state. Mode F and P still close forward and rerun complete conversations. Without `--explain`, existing radius output is unchanged.

Supported anchors are dimension values, phrases, and `states`, `path`, `recovery`, `uses_tool` and
`reply_language` relations. Changed unsupported entries select the whole suite.

`--map` also accepts an estate map from `estate scan`. The full map must pass schema and hash
validation. `--source` names an atom's `provenance.file`, for example `CLAUDE.md`. Each quote must
still occur at its recorded line span and have one exact occurrence in the old prompt. Approved
atoms map to `kind: prompt`, with the atom id. Identical, nested or partially overlapping quote
spans form one union anchor carrying every atom id in that group. This can select extra tests,
but never extends an anchor to unquoted text on the same line. A changed group containing an
unapproved atom selects everything; stale or ambiguous evidence also selects everything.
Other source files are assumed unchanged. All carry compatibility and age checks still apply.

For estate maps, a whitespace-only edit uses the unit ledger's text identity: Unicode NFC,
whitespace runs collapsed to one space, and leading/trailing whitespace trimmed. Double spaces,
tabs, trailing spaces and line-ending changes therefore produce `changes: []`.
The empty manifest includes `promptProvenance`: the source, map and prompt file paths, full SHA-256
hashes, and both version labels. `radius` and `campaign run --change --from` reread those files,
check their hashes and version labels, validate the complete map and old quote spans, and repeat
the no-op comparison. Only that validated manifest may select no tests across different labels.
An unvalidated empty version transition still selects everything. Keep the evidence files available
and unchanged; absolute paths are emitted, and relative paths resolve from the manifest's directory.

Programmatic `parseChangeManifest` does not grant this trust. `loadChangeManifest` requires a trusted
`validatePromptMap` callback that validates the full map and its source quotes; without it the
whole-suite fallback remains. Serializing, reparsing or mutating a validated manifest loses its trust.

For semantic edits and proposal maps, the diff normalizes CRLF and CR to LF, and Unicode to NFC. Offsets count UTF-16 code units in that
normalized text. Every other whitespace character is retained and follows the same rule as other edits.
Evidence quotes may match source whitespace runs so an extracted quote can span indentation. A
proposal-map normalized no-change with different version labels selects everything; with identical labels it adds no change.

The mapper computes a character edit-distance alignment, with separate regions for separated edits.
Every region must lie strictly inside exactly one declared anchor in BOTH the old and new prompt.
It locates an edited anchor in the new text through the unchanged first and last characters of its old
occurrence in a unique alignment, then verifies that the resulting quote occurs exactly once in the new
prompt. Boundary edits and removed anchors therefore select everything. It counts overlapping quote
occurrences too. Repeated quotes, overlapping distinct anchors, missing anchors, ambiguous alignments,
unmapped changed anchors, or any region outside the anchors select everything. A matching price edit
cannot hide an inserted language instruction before or after its quote.

For bounded resource use, alignment admits at most 64 single-character edits and 8,000,000 band cells.
Exceeding either limit selects everything, with the reason in the manifest. `radius --explain` prints the
rule for each changed region, followed by block dependency reasons. No fuzzy match narrows the radius.

Always use the agent versions your campaigns record. Without explicit version flags, `auto` uses the text content hashes; these need not equal a prompt registry's hash. The learned dependency table and automatic estate-diff ingestion remain separate work. Existing estate atom manifests continue to work.

## Prompt sections and block links

A prompt can carry a section registry, `prompts/<prompt-id>.sections.yaml`, that names each of its sections by a stable id with its span (UTF-16 code units, the unit of the quotes above), the SHA-256 of its text, an anchor quote, a scope (`global` or `local`) and its `references`, `overrides` and `duplicates`. The Acme example keeps one for its 30-section prompt in `examples/acme/prompts/`. `radius sections init` writes a first registry from the headings (one section per CommonMark heading of level 1 to `--level`: `#` headings indented up to three spaces with their closing `#` sequence dropped, and titles underlined with `=` or `-`; a `#` line inside a fenced code block, including one opened on a list or quote line, is code; a leading YAML front matter block (`---` to `---`) is not read for headings and stays in the preamble; a heading whose section holds no quote that is unique in the prompt, such as an empty heading next to another, is folded into the section before it; an id is the slugged title, and a repeat takes the next free `_2`, `_3`, so two sections never share an id; HTML blocks and indented code are not parsed), `radius sections check` checks it against the prompt, and `radius sections reanchor` finds every section again in the next version: same text, then the unique quote, then the prefix and suffix window, else `stale`. A section is only placed where its text hashes as before, so an edit inside it makes it stale and it is never anchored to the wrong text; text that changed outside every section is reported.

A block names the sections it tests in the spec's `metadata.links`, each link with a status: `declared`, `attributed`, `verified`, `refuted` or `stale`. `metadata.links` and `metadata.provenance` stay out of the spec hash, so a link added or promoted never changes a run id or a cache key and never invalidates a carry or a rejudge. `spec lint --sections <registries>` checks that every link names a section its registry holds.

### The link

A link is one entry of the spec's `metadata.links`:

```yaml
metadata:
  links:
    - block: 0                      # a block id, or its index (whether or not blocks have ids); absent: every block
      to: { kind: prompt_section, prompt: support, section: refunds }
      relation: verifies            # default verifies
      status: declared
      created_by: author
      at_version: v1                # the prompt version the link was made at
```

* `to` has one of three kinds: `prompt_section` (`prompt`, `section`), `spec_clause` (`spec`, `clause`, optional `sha256`) or `source_turn` (`conversation`, `turn`, optional `cluster` and `redacted`).
* `relation` is `verifies`, `exercises`, `derived_from` or `observed_in`.
* `status` is `declared`, `attributed`, `verified`, `refuted` or `stale`, and is required.
* `created_by` is `generator`, `author`, `attribution`, `citation`, `ir` or `mutation`.
* `at_version` is the version of the target the link was made at.
* `evidence` is an optional map keyed by status, such as `verified: { mutant: m1, runs: 3, flips: 3 }`, that holds what supports the status; its values are free.
* A key outside `block`, `to`, `relation`, `status`, `created_by`, `at_version` and `evidence` is refused.

`spec validate` checks the links. A link with a value outside a list or a missing `status` or `to` is refused as `SCHEMA_CUSTOM` at `metadata.links.<index>.<field>`; an unknown key is refused as `SCHEMA_CUSTOM` at `metadata.links.<index>` (an unknown key inside `to`, at `metadata.links.<index>.to`); a `block` that names no block of the spec, or an index past the last block, is `LINK_BLOCK_UNKNOWN`. A spec with a refused link is invalid, exit 1.

A section registry is read the same way, before any command uses it: an id used twice, or a `references`, `overrides` or `duplicates` entry that names no section, makes it invalid.

### Re-anchoring a registry

`radius sections reanchor` compares the sections in the new text, not in the old: for each section it looks for the old text, by hash, in the new prompt. The result per section is one of three statuses.

| Status | Meaning |
|---|---|
| `kept` | the same text, found once, at the same offsets |
| `moved` | the same text, found once, at other offsets; the registry of the new version holds the new span |
| `stale` | the text was not found again once: the section was edited inside or removed; its entry keeps the span and hash of the last version where it was found, and every link to it reads as stale |

An edit that keeps the length leaves every other section `kept` at its own span: only the section that was edited turns `stale`. An edit that changes the length moves the sections after it, which become `moved`. A section already stale in the old registry stays stale. The method that found a section is `same_hash`, else `quote` (the anchor quote found once and the old text at the same distance from it), else `window` (the prefix, quote and suffix found once).

```text
# support v1 to v3: a section "Languages" was added between Tone and Refunds
sections:
  - { id: preamble,   status: kept,  method: same_hash }
  - { id: tone,       status: kept,  method: same_hash }
  - { id: refunds,    status: moved, method: same_hash }
  - { id: escalation, status: moved, method: same_hash }
outside: ["between tone and refunds"]   # text that is in no section, so it can reach any block
reordered: []
```

### Advisory section selection

A change manifest can name a section: `kind: prompt_section`, `id: <prompt-id>#<section-id>`. `radius sections reanchor --change-out <file>` writes one per stale or reordered section, and a global `prompt` change when text changed outside every section. A `prompt_section` change makes the radius the whole suite, with the reason `section selection is advisory until links are verified by mutation`. `radius <specs> --change <manifest> --sections <registries>` adds what selection by links would run:

* the blocks linked, by a link that is not `refuted`, to a changed section or to a section that references, overrides or duplicates one, transitively;
* the blocks with no link to the changed prompt, and those with a stale link (as Ekstazi, a test with no record always runs);
* every later block of the same conversation, and the blocks of a spec that starts from a selected parent block;
* every block, when a changed section is global or unknown.

Why it does not skip tests yet: on the H7 suite (the Acme stand-in prompt of 30 sections, 19 conversations, 37 blocks with declared links, 9,690 conversation runs on `claude-haiku-5-5`), declared links alone missed a block a mutant flipped in 3 of 90 single-section mutants, a share of 3.3% whose Wilson 95% interval reaches 9.3%, and in 9 of 110 mutants with the 20 two-section ones (8.2%). Two of the three misses were inherited failures in later blocks of a chain; the forward closure brings the share to 2 of 90 and 4 of 110 at a mean selection ratio of 0.23 (0.199 without it). The core test `packages/core/test/radius/select.test.ts` re-scores those stored runs with this rule and reproduces each number. The other miss is a link no author declared: negating the confirmation rule broke recap blocks linked only to `recap`. Selection may become a filter only when links verified by mutation keep the Wilson upper bound at or below 5%, two-section mutants included.

### Localisation over sections

`radius localize <specs> --store <file> --campaign <id> --sections <registries>` ranks the local sections of a prompt by Ochiai suspiciousness from a stored campaign: a block covers the sections it links to, `failed` and `passed` sum the failure and pass rates of the linked blocks over the suite runs, and the score is `failed / sqrt(total failure weight x (failed + passed))`. A failure is dropped when an earlier block of the same conversation (or a parent block) failed in the same run; a block that passes after a failing one stays a row. A link whose status is `refuted` adds nothing to the counts: a block covers only the sections its other links name, and a section reached only by refuted links has no covering block, so it is not ranked. A link to another prompt, to a global section or to a stale section adds nothing either. Global sections are not ranked; ties print as a rank range. On the stored H7 runs (`packages/core/test/radius/localize.test.ts`) this rule ranks the planted section worse than flat counting on 3 of 98 faults; dropping every block after a failing one ranks worse on 18 of 98, the registered H5 result. Ranking against each block's own baseline verdict comes with the mutation runner.

Anthropic Citations give `start_char_index` and `end_char_index` in code points. On a text with two emoji before the cited sentence the API gave 23 where UTF-16 gives 25, so an imported citation is converted (`codePointToUtf16`, `citationSpan`) before it is compared with a span.

## Execution provenance

New CLI campaigns store an optional execution stamp. Each block records SHA-256 hashes of the actual
stimulus sent, the check ledger, and artifact paths, plus its spec block index and the existing resolved
Given hash. File reads performed by checks are hashed as they happen; no extra reads or file contents
are added. A failed read has a null byte hash. The observations retain any contents already stored there.

Each run records hashes of its driver identity and declared seeds, adapter name and version, agent
version, and execution options. Every user-supplied identity is hashed, including seed keys and values;
no raw copy sits beside the hash. The scripted driver declares no random seeds. Other drivers must
declare seeds explicitly; an undeclared seed set is unknown, not proof of determinism. The campaign
records hashed identities for all routed targets, adapters and agent versions. Existing command output
does not print these stamps. Library `runSpec` and `runCampaign` callers opt in with
`recordProvenance: true`; standalone runs retain their previous serialized shape by default.

The adapter's optional `cacheIdentity` is hashed into its stamp and execution hash. For process adapters,
this identity covers the command and argument boundaries. A process stamp without it is legacy and
cannot authorize a carry. Changing a binary's contents at the same path still requires a new agent version.

Old stores without stamps still load. A campaign without a complete execution stamp is legacy: a
blast-radius campaign reruns it in full and reports the missing provenance. Empty adapter lists, missing
target coverage, incomplete run or block fields, and unknown seeds also force a full rerun. The public
`planRadiusCampaign` applies the same check; callers supply the baseline campaign's `provenance` beside
its runs. Legacy observations cannot establish compatibility for criterion re-judging; run a new full
campaign first. These stamps preserve execution evidence; they do not themselves authorize reuse.

A new baseline may mix P cells with F and T cells: the perturbing driver records the base driver's
known seeds and any pack draw seed. Eligible F and T cells can still carry. P cells themselves run
fresh because their injected block inputs cannot yet be reconstructed for carry. Older baselines
whose P drivers recorded unknown seeds still need a new full run.

A complete baseline is necessary but insufficient: the planner also needs the actual current run's
execution stamp (`CarryLimits.currentProvenance`). It compares every stamp field by default, including
new fields. Changed driver identity or seeds, adapter identity or configuration, target configuration,
mode, repeat, perturbation, retry settings or other execution options force a fresh run. Missing current
context also forces a fresh run. `ALLOWED_VERSION_TRANSITION_FIELDS` names the sole exception: the
manifest's verified `from` to `to` agent transition, including its target variant and prompt. No other
context difference is justified by a small radius. Carried records retain the original observation's
origin and age, and pin the current context whose compatibility was proved.

Each recorded run also stores `provenanceDigest`: SHA-256 of canonical JSON over the complete run
stamp and the ordered block entries (`index`, `blockId`, `injected`, `givenHash`, and the whole block
stamp). Canonical JSON sorts object keys at every depth and preserves array order. The planner checks
this digest before carrying anything. A missing or mismatched digest, an unknown stamp field, or a
partial stamp makes the baseline legacy and forces a full rerun. The digest detects accidental changes
and partial writes; it is not a signature against someone who can rewrite both the record and digest.

The planner additionally requires `CarryLimits.currentSpec`. From this current spec it recomputes each
block's index, resolved Given hash, and check ledger. Scripted and teacher-forced stimuli must match the
spec's stimulus hash. The Given comparison uses the target that actually produced the observation;
the verified manifest transition is the only permitted target difference. Generated stimuli rely on
the already-compared driver identity and seeds. Their text is not recovered from a fingerprint: a later
free-running block with an unreconstructable prefix forces a rerun, unless an explicit Given prefix
resets that history. Perturbed trajectories and a carried prompt whose original text is unavailable
also rerun when their block inputs cannot be reconstructed. A valid digest alone never proves these
inputs compatible. A legitimate carry seals its updated run stamp again and retains the original block
evidence, observation origin, and age.

Stamp hashes are deterministic equality fingerprints, not secrets. Low-entropy values such as short
identifiers or numeric seeds are guessable by enumeration. No per-store salt is used: fingerprints remain
comparable across stores, and this change adds no store metadata or salt lifecycle. Protect results stores
as you protect the observations they contain; hashes do not replace that protection.

## Re-judge a criterion

`campaign rejudge` calls only the judge on stored observations. The manifest contains only
`criterion` changes, and its `from` and `to` name the same agent version. Every new spec is
pinned beside its old full hash and an observation-compatibility hash. Blocks identify the
re-judged criterion ids; other results carry their source and age. Judge calls count in the
new run cost. Historical agent cost is not charged again. The scorecard labels both kinds.

The compatibility hash covers everything that can change what the agent receives or does:
givens, stimuli, tools, target, adapter, modes, perturbations, user driver, seeds, stages and
block order. An explicit exclusion list removes only criterion `rubric`, `pass`, `fail`,
`gating`, `scope`, `judge_class` and `repeat_reducer`. Those are the schema's judge-only text,
anchors and settings. New fields are included by default. Deterministic checks and expected
outputs remain in the hash: changing them requires a full agent rerun; this command does not
re-evaluate changed deterministic checks on old observations.

Re-judge validates the existing carry age and count limits, the same agent version, the complete
campaign stamp and integrity digest, and every resolved Given, ledger and stimulus hash before
making a judge call. Its agent execution context is the frozen recorded context: this command accepts
no new driver, seed, adapter or target configuration. Such changes require `campaign run`. It supports
complete scripted F and T conversation runs whose judge inputs can be reconstructed. Legacy,
partial, injected or adaptive runs, unknown seeds, task artifact reads, inconsistent stamps,
and missing judge input bytes are refused with a full-rerun instruction. A judge-only command
cannot silently turn that refusal into an agent call. Keep `campaign run` for those cases.
Re-judged observations remain unpaired agent measurements. When no fresh agent pairs exist,
`report` uses its default margin and says why; it does not estimate an automatic margin from
copied observations.

Run this offline Acme demonstration from the repository root with a fresh output directory.
The fake judge deliberately fails the added public-holiday rule; it makes no model call.

```sh
mkdir -p /tmp/acme-radius-rejudge
node --import tsx --input-type=module <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'yaml';
const spec = parse(readFileSync('examples/acme/specs/conversations/plan-upgrade.yaml', 'utf8'));
spec.criteria.find(c => c.name === 'no_invented_data').rubric += ' Never invent a public holiday.';
writeFileSync('/tmp/acme-radius-rejudge/updated.spec.json', JSON.stringify(spec));
writeFileSync('/tmp/acme-radius-rejudge/criterion.yaml', 'from: acme-v1\nto: acme-v1\nchanges:\n  - { kind: criterion, id: no_invented_data }\n');
JS
node --import tsx packages/cli/src/bin.ts campaign run examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme-sales --agent-version acme-v1 --campaign acme-before --store /tmp/acme-radius-rejudge/runs.db
node --import tsx packages/cli/src/bin.ts campaign rejudge /tmp/acme-radius-rejudge/updated.spec.json --from acme-before --campaign acme-rejudged --store /tmp/acme-radius-rejudge/runs.db --change /tmp/acme-radius-rejudge/criterion.yaml --judge claude:haiku --judge-command examples/estates/fixture/live/fake/judge.cjs
```

The final command exits 1 and prints:

```text
Campaign acme-rejudged: 2 blocks re-judged, 3 carried; 0 agent calls. Judge cost 0.0030 USD.
Runs: 0 pass, 1 fail.
```

A paid judge requires `--judge-budget <usd>`. The budget guard is the existing run-judge guard.
Exit 0 means the resulting campaign passes, 1 means a gating result fails or is inconclusive,
2 means the inputs or reuse proof were refused, and 3 means no run fails but a block was not run or
blocked (left as it was, named with its reason). `--json` emits the campaign ids, carried and
re-judged block counts, the blocks not run, the runs by verdict, zero agent calls and judge spend.

## Mode T block reruns

A mode T block starts from its canonical Given, so the blocks of one cell do not depend on each other's replies. A change that reaches 1 block of a 4 block cell needs only that block sent. `--block-reruns` does this: the cell runs, but only the blocks in the radius reach the agent, and the other blocks keep their stored result.

```sh
driftbench campaign run examples/acme/gated/specs --target function:acme-sales \
  --route flow:price-sheet=process:acme-ops --mode T --agent-version acme-v1 \
  --campaign base --store runs.db --record-end-state-snapshots
driftbench campaign run examples/acme/gated/specs --target function:acme-sales \
  --route flow:price-sheet=process:acme-ops --mode T --agent-version acme-v2 \
  --campaign next --store runs.db --change examples/acme/radius/tool-coverage-check-input.yaml \
  --from base --block-reruns
```

Tell driftbench what changed with a change manifest, or with `radius auto --prompt` for a prompt edit. The campaign prints what it sends and what it keeps:

```
86 of 195 cells in the radius. 86 cells run fresh, 109 carried from base.
Mode T block reruns: 86 cells send 86 blocks and keep 330 stored blocks from base.
Saved: 781 of 867 blocks, 90.1%.
```

On the Acme gated suite, a rerun of the coverage check input change sends 86 of 867 blocks. The same campaign without end-state snapshots sends 376 of 867. A full mode T campaign sends all 867.

### Which cells run in part

A cell runs in part only when every check below passes. Otherwise the whole cell runs, and the campaign prints the reason.

* The mode is T, the driver is the scripted driver and the adapter has no sandbox. A sandbox keeps the workspace of an earlier step, so a block cannot start alone.
* The stored baseline run completed, every block passed, and every block has execution provenance. A failing or partial baseline is rerun whole.
* The stored run passes the same proof as a whole-cell carry: complete stamps, an intact digest, an equal execution context, reconstructed block inputs, the full spec hash, and the `--max-carry` and `--max-age` limits. Each kept block counts one more campaign of age.
* The radius is a strict part of the cell. A cell with every block in the radius runs whole, as it did before.

The result is a normal run. Kept blocks carry the stamp of the campaign that measured them. The run records `blockRerun`: the blocks sent, the later blocks not rerun, and why the later blocks do not depend on the sent ones. The compounding rates read only the blocks that were sent. `compare` treats a partly rerun cell as a fresh run, so its pairs include the kept blocks of that cell.

### End state

A spec with `end_state` is judged on the whole cell, and the runner composes the end state across the blocks: for each source the last value that is not null, and the concatenated list for `*`. Skipped blocks still contribute to it, and a stored verdict cannot say what a skipped block contributed.

* By default, a baseline records no per block values. A cell with `end_state` then runs whole. On the Acme gated suite, 65 cells run whole for this reason.
* With `--record-end-state-snapshots` on the baseline campaign, each T block stores the raw values it read, and a value that was not read is stored as unavailable. A block rerun recomposes the end state from the stored values and the new ones, by the same rule, and re-evaluates the end state verdict of the last block. A block rerun campaign keeps recording snapshots when its baseline did, so a chain of reruns stays possible.

Snapshots hold raw values read from the agent's systems. They can hold personal or secret data. Treat them as observations: they follow the same handling as the stored replies of the run, and the flag is off unless you set it.

### Audit and misses

`--audit <n>` also draws cells that run in part. A drawn cell runs whole and fresh, and each kept block is compared with its stored result on the gating verdicts. The end state verdict is not compared, because it is recomposed. One difference is a radius miss: nothing is kept, every cell runs whole, and the exit code is 1.

On Acme, a full mode T run of the planted fault `x5-drops-coverage-check` fails 86 blocks. A block rerun with the right manifest fails the same 86 blocks, and every one was sent. With the recap manifest, which does not name this fault, the failing blocks stay unsent, so the check can fail. A fault planted in an offer price, outside the coverage check radius, is found by the audit. `packages/cli/test/radius-blocks-acme.test.ts` runs these cases with no model call.

A block rerun needs no new assumption about the agent beyond the one every radius makes, and one more: in mode T a block depends only on its Given, which the spec writes. [When it is sound](#when-it-is-sound) lists the rest.

## Parent blocks

A block that declares `parent` depends on that parent's recorded end state. A change that reaches a parent also reaches every descendant, in F, T and P, regardless of authored order. Explicit forest roots remain independent. Parent-linked specs conservatively run whole when partial block carry or input reconstruction would be needed. See [parent blocks](given-when-then.md#parent-blocks).
