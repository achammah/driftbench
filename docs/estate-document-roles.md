# Document authority and lint precision

The estate reader classifies document authority before reading declarations or splitting prose. Runtime file kinds and document roles are separate: a skill reference can be a live procedure, a template, or a historical record.

## Roles and evidence

| Role | Structural evidence |
|---|---|
| `normative` | Live content without whole-document navigation structure |
| `changelog` | A changelog or release-notes heading and dated entries |
| `history` | A history heading with dated entries or an append-only log; alternatively, a document consisting of repeated dated entries |
| `journal` | A journal, diary, work-log or session-log heading and dated entries |
| `template` | A template heading with placeholders, repeated placeholder value slots, or a template folder |
| `example` | An example heading or an examples, samples or demos folder |
| `fixture` | A fixtures folder |
| `archive` | An archive or attic folder |

A declared unit folder identifies that unit, so a skill named `demo` remains live; navigation folders below it keep their roles.

A single incidental date or a variable path in an operational instruction does not turn the document into a log or template. Names alone do not establish history. A mixed document keeps its live role; example and historical sections carry their own line spans. A section ends at the next heading of equal or lesser depth. Explicit `For example` and `e.g.` lines are local illustrative spans. Fenced examples remain excluded by the existing fence reader.

The map records each file's `path`, `role`, classification `reasons`, and any non-normative `sections` as optional `documents` metadata. Older maps without this metadata remain valid. The source text and quote offsets are retained.

Non-normative documents remain navigation targets. Their bodies supply no declarations, rules, gates, hazards or downstream file reads. A live instruction to read a template is still a real prerequisite. Lint does not turn navigation-only documents into orphan or unreachable defects.

## Missing, unresolved and illustrative targets

A path with a separator names a place, resolved relative to the live document that names it. If it does not exist, it is a `MISSING_REFERENCE` only when its extension names a document or script type (the same list the scan has always used); a pair such as `read/write`, a ratio, a version or a dotted name carries no evidence that a file was meant, and produces no reference. A filename with an extension that is quoted, backticked or linked designates a file beside its source: absent, it is a `MISSING_REFERENCE`. A name with no separator and no extension, or a loose word, that resolves to no file, skill or helper becomes informational `UNRESOLVED_REFERENCE`: the scan has not established where it belongs. A name explicitly designated by a read, open or load directive as a skill, helper, agent or identifier is retained for this check. An existing file of any extension still resolves. Ambiguous names retain `AMBIGUOUS_REFERENCE` with their candidates. Placeholders and illustrative examples do not establish missing files. A path excluded by an ignore rule is not a broken live dependency, even if no physical fixture currently exists at that path.

## Orphan and unreachable files

A changelog, history, journal, archive or fixture is a record or a store: nothing is expected to load it, so it is not an orphan or unreachable defect. A role never hides a live finding, though:

- A file inside the folder of a live skill is that skill's material. It stays a finding when nothing names it, whatever its role, and the skill's scripts keep their ownership atoms even in a folder such as `examples`.
- A template or an example exists to be read when a live document sends the reader to it. One that no live document names or reaches is still an orphan.
- A file the runtime loads by its place (standing instructions, memory, settings, a skill or helper definition, the check registry) is never exempt: its own text cannot hide it.
- A navigation document (a changelog, a history, an example) still documents the files it points at: such a file counts as named, not as an orphan. The link never makes the file reachable and creates no atom, rule or missing-file finding.

## Counter-examples, fill-in values and runtime products

- A counter-example is shown so that it is not followed. A cross mark, or a wrong, bad, incorrect, anti-pattern or counter-example label with a colon, opens one only where a line, a list item or a table cell begins. The same words inside a sentence ("if the total is wrong: read `a.md` first") and a multiplication sign ("by 2 × 3") are ordinary text, and the rule stays live. A check mark or a right, good or correct label on the same line closes the counter-example; the span between is not read. A line holding only the marker makes the block that follows an example. An anti-pattern or wrong-example heading makes its section an example.
- A bracketed word, a doubled date or fill-in letter (`YYYY`, `XXX`), a format specifier and a `{name}` or `$NAME` binding stand for a value. They are not files whose absence is known.
- A path that a script writes or creates (an open for writing, a redirect, `touch`, `mkdir`, a copy or move to it, directly or through a constant assigned the path) is a file the runtime makes: a marker, a state file, a log. A sentence that names it does not describe a broken link. A script that only reads a path proves nothing about it, so a missing file it reads stays a finding, and a registry or settings literal counts as nothing. Separately, a file that a named script holds as a literal counts as named and reached with the script. A script nothing names legitimises nothing, and a lone file name matches only as a whole path.
- A sentence read as a path (a quoted run of words, or a segment longer than a file name can be) names no file.

## Write destinations and infrastructure scripts

- A path that does not exist is something the work makes, not a prerequisite, only when it is the destination of a write: it follows a write verb (write, save, create, generate, produce, export, upload, store, emit) directly, with determiners and at most two words of noun phrase between, or it follows to, into, onto, in, at, as, under, called or named after one. The clause is cut at a comma, semicolon, "and", "then", "but", "while" or "when". A write word that is a noun or a modifier (after a determiner, or before script, helper, step, config, template, policy, up) is not a verb. A path that follows a preposition of source or topic (of, for, by, from, with, via, per, about, using, following, according to, based on, matching, described in, defined by, listed in, conforming to), a participle, or a read, parse, analyze, ingest or look verb is a prerequisite and keeps its finding. File names and quoted text in the clause are not words. An existing path is a reference either way.
- A relative path in a helper agent whose first folder the estate holds nowhere (not at the root, not in `.claude`; a folder that exists on disk but that the reader never reads counts as not held) points into the project or a mounted workspace, not at a sibling of the helper. It is external information (`EXTERNAL`), never a missing file. Skills, standing instructions and memory keep their relative paths as concrete.
- A guard script is infrastructure, not a check, when its command hands it another estate script as an argument and the script is a launcher (the handed file is itself a guard script, or the script reads its arguments and executes things), when it runs other guard scripts, or when it is a long-lived process (one receiver both binds or accepts and listens, or it runs a server loop, or it runs an unbounded loop that nothing inside can leave, with no break, return, exit or raise, together with sleeping, signal handling or detaching from its parent). The check registry needs no row for it. A command that hands the script only data (a configuration or environment file) does not make it a launcher.

## Reproducible synthetic measurement

The hand-written estate in `packages/estate/test/scan/document-role-estate.ts` contains each navigation role, mixed example and operational sections, placeholder paths, an ignored fixture path, three concrete missing live references, and one real recovery hazard. It contains no private estate text or validator fixture strings.

Precision counts correct failing lint findings over all failing lint findings. Hazard precision counts the real recovery hazard over all hazard atoms. Informational findings do not count as failures. The role tests also check preservation of real read gates, map serialization, arbitrary log and form titles, and live procedures containing dates and variables.

The synthetic measurement measures these constructed inputs. It does not estimate precision on an unseen private estate.

Run the synthetic measurement from the repository root:

```sh
pnpm exec tsx packages/estate/test/scan/document-role-precision.ts
```

The runner prints the true-positive counts, reported counts and precision. It removes only its own temporary fictional estate.

Measured on the same synthetic input against base `a91598b5e153dc9c734188abc4027f47073eeae6` and the role-aware scanner:

| Metric | Before | After | Retained truth |
|---|---|---|---|
| Failing lint precision | 3/16 (18.75%) | 3/3 (100%) | All three concrete missing live references |
| Hazard precision | 1/8 (12.5%) | 1/1 (100%) | The live compaction recovery rule |

These are constructed-estate measurements, not a private-estate remeasurement.
