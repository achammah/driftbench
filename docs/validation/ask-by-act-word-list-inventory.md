# Estate lexical removal inventory

Baseline: `astra-askwords-base` (`9ad6ae952`). Line references below name that baseline unless marked current. Scope: validators estate path and generator estate path. Fixed rendering templates, schema/act/tool IDs, bank case IDs, and fixture output pools are not prose classifiers.

## Validator findings

| Location | Forbidden read | Structured replacement |
|---|---|---|
| `packages/validators/src/ladders/estate/bank/genquality.ts:50,58,75,76,92` | TASK_VERBS, SKIP, TEMPLATES, QUESTION, inline negation words judge an ask | Resolve carried map act ID; check trace against that act, and exact rendering from frame/shape IDs |
| `packages/validators/src/ladders/estate/bank/askfrom.ts:29,43,86` | suffix list, imported ASK_FRAME_WORDS and a bag of source words accept lexical overlap | Exact source spans/act IDs plus frame re-render equality; no stemming/word pool |
| `packages/validators/src/ladders/estate/bank/task-span.ts:25,82,85,86` | LEADING_OPERATORS and English clause derivation regexes | Parser sentence/list/quoted spans or carried source span coordinates; whole-clause equality |
| `packages/validators/src/ladders/estate/bank/task-check.ts:163` | Finds a TOOL_ACTS phrase by shape prefix | Shape/frame ID maps to structured act kind/name; exact re-render permitted |
| `packages/validators/src/ladders/estate/bank/loop.ts:445` | skill/agent/helper alternation classifies asks | Map reference/dispatch act ID and matching trace call |
| `packages/validators/src/ladders/estate/operation-witnesses.ts:26,27,28,29,31,46,91` | Derived read/destructive/order word sets and command regexes classify synthetic labels/commands | Preclassified complete witness records carrying expected operation class and provenance; preserve every harmful/benign ID |
| `packages/validators/fixtures/estate/operation-vocabulary.json:7,29,42,43,45` | toolWords, readWords, orderVerbs, orderNouns, commandRules read through witness helper | Replace recognizer fixture with complete classified witness records |
| `packages/validators/test/estate/operation-vocabulary.ts:165,194,230` | Derives recognizer vocabulary from product AST | Frozen complete witness records pinned to their source hash; no runtime prose classification |
| `packages/validators/src/ladders/estate/completion-contract.ts:45` | Exact approved phrase identity lookup | Allowed provenance/fixture lookup per clarified scope; retain to keep oracle independent of removable metadata |
| `packages/validators/src/ladders/estate/completion-contract.ts:192,196` | English re-read/this(file/document) regex infers rereads (machine file-extension grammar alone is allowed) | Map reference_read evidence or typed recovery.reread targets; no prose inference |

## Generator findings

| Location | Forbidden read | Structured replacement |
|---|---|---|
| `packages/generate/src/estate/asks.ts:469,667,669,672,692,705,758,762,769,775,895,926,933,939,950,954,956,959,961,1042,1048,1066,1070,1123,1188,1228,1399,1421` | COMMON, INTERROGATIVES, COPULAS, DIRECTIVE, MECHANICS, CONNECTIVE, STATEMENT_OPENERS, SUBORDINATORS, CLAUSE_WORDS, DETERMINERS, DANGLING, FUNCTION_WORDS, STATIVE, OPENING_DETERMINERS, LEAD_ADVERBS, IRREGULAR, NOUN_LINK, NOUN_ENDING, PREPOSITIONS, AUXILIARIES, LEAD_CONNECTIVE, SUBJECT_PRONOUN, RULE_WORDS, ASK_FRAME_WORDS, TRAILING_WORDS, HOOK_NOUNS, VERBS, KEEP | Delete lexical derivation; render carried typed acts from source spans and fixed frame/shape IDs; unknown act/source evidence produces a gap |
| `packages/generate/src/estate/asks.ts:394,398,433,434,435,436,437,532,534,538,541,613,629,699,719,732,864,867,868,869,879,1080,1092,1174,1217,1244,1257,1292,1312,1356,1359,1377,1454,1476` | Inline English read/negation/subject/condition/conjunction/exception/plural rules, abbreviation-aware sentence cutting | Parser boundaries and explicit act IDs/source spans; no words select cuts or acts |
| `packages/generate/src/estate/frames.ts:153,178` | ASKED_PATTERNS and pronounDerivation interpret English clauses | Rendering-only frame registry plus source parser spans |
| `packages/generate/src/estate/recovery.ts:13,15,31,35,37,57,62,67` | OBJECT_END, POINTER, recovery verbs, negation/modals/articles, this-file, and conjunctions infer recovery work | Typed recovery evidence (reread paths/rerun commands), fail closed for missing evidence |
| `packages/generate/src/estate/then.ts:524,736` | SAME_FILE_ACT edit/pronoun regex and file-extension alternatives infer target | act.target/reference evidence and structured recovery fields |
| `packages/generate/src/estate/unit.ts:130,159` | FORBIDS/OBLIGES English polarity patterns classify source examples | Explicit typed guard verdict/evidence and fixture example classification |

`predicates.ts:34–36` writes secret-prefix and currency-code machine-format assertions. Owner explicitly permits machine formats (key prefixes, hex IDs, email, phone, IBAN, currencies with digits) and requires secret/privacy checks retained. These are allowed and must not be removed.

## False positives / allowed

- `bank/common.ts:13,31` NOUNS/VERBS and `bank/blind/util.ts:180–181` PLACES/THINGS only WRITE fictional fixture text. They interpret no source.
- `frames.ts:19,33,43,61,79` TOOL_ACTS/TRIGGER_VARIANTS/ASK_FRAMES/ACT_SHAPES/CONTEXT_SHAPES WRITE rendering templates; exact re-render comparison is explicitly permitted.
- `bank/causes.ts` regex groups read structured bank IDs, not English prose; preserve existing IDs and causes.
- `completion.ts:343` deny/block and `situations.ts:291` Edit/Write match verdict/tool IDs. Prefer exact typed identity checks to avoid misleading lexical appearance.
- Test-type, evidence-kind, tool-name, artifact-kind, schema-key enums are structured IDs, not verb lists.

## Outside estate: inventory only (not this edit scope)

- `src/ladders/judges/v2/rules.ts:11,13–21`: PRICE/HOME_PLAN/CONFIRM/BILLING/INSTRUCTION/failure/CONCEDED/DECLINED/PROMISED text classifiers.
- `src/ladders/judges/pool.ts:260,262`: HOME_PLAN/BILLING text classifiers.
- `src/ladders/generator/bank.ts:2191,2197`: phrase alternatives classify failure detail text.
- `src/ladders/map/levels.ts:158`: refusal-reason phrase alternatives.
- `src/ladders/map/bank/perfect.ts:129`: `or`-word split extracts relation IDs from prose.
- `src/ladders/map/render.ts:44`: SYNONYMS; `src/ladders/judges/transforms.ts:43,44,69,76`: PEOPLE/STREETS/INJECTIONS/LOOSE_YES; `src/ladders/map/bank/styled.ts:28,42,58,68,83`: VERBS/OBJECTS/QUALIFIERS/SEGMENTS/MOMENTS; `src/ladders/judges/v2/bank.ts:190`: FILLER_WORDS. Rendering/test output pools; inspect usages if scope later expands.
- `src/ladders/stats/bank/degenerate.ts:275`: ENGLISH_WORDS (`a`) filters generated hexadecimal statistical fixture symbols.
- `src/hardness.ts:257`: pass/fail/pending grammar for a report field; structured status enum.
- `src/ladders/system/bank/claims/breaker2.ts:1515,2303,2943,4550`, `robust.ts:3598`, `breaker.ts:1465`, `exits.ts:167`: message/ask/error text alternatives used by system-test assertions.

A final read-only sweep at `a18d19251` found no forbidden semantic English list or alternation regex in either estate source tree. The inventory alone claims no fixture gap count.

## Reply-act follow-up

At PR head `adc8ab9c2`, `packages/validators/src/ladders/estate/bank/task-check.ts:115,266,394–410,419` still used map `text.must`/`mustNot` substring predicates as a positive reply-act witness. That bridge is removed. Reply asks now require an optional typed `Atom.replyAct` declaration and an independently recorded `Observed.replyAct` bound to a nonblank text segment, with adapter/judge provenance. Original rule outcome predicates remain separate checks; a label cannot satisfy a failed content requirement.

# Estate test lexical audit after review

Baseline: dd692fb5568c0cc3299d47201d62fb1f573ca8d0.

Tests retain all case IDs and failure expectations. Targeted run results are recorded in the PR and fixture gap artifact.

## Removed readers

- packages/generate/test/estate/absence.test.ts:219: `/Unknown estate evidence predicate.*command_forbidden/`
- packages/generate/test/estate/absence.test.ts:270: `/Unknown estate absence predicate/`
- packages/generate/test/estate/absence.test.ts:272: `/requires path/`
- packages/generate/test/estate/absence.test.ts:273: `/nonempty/`
- packages/generate/test/estate/generate.test.ts:293: `/^plan\.mapHash: the plan was made from map ffffffffffff/`
- packages/generate/test/estate/generate.test.ts:322: `/^phrases\.situations\.0\.atoms\.\d+: instruction\.nowhere is no atom of the map$/`
- packages/generate/test/estate/real-estate-asks.test.ts:357: `/navigation-only document/`
- packages/generate/test/estate/real-estate-asks.test.ts:633: `/involves discharge|involves you/`
- packages/generate/test/estate/reply-length-guard.test.ts:26: `/detail/i`
- packages/generate/test/estate/reply-length-guard.test.ts:27: `/every/i`
- packages/generate/test/estate/reply-length-guard.test.ts:29: `/\breply\b/i`
- packages/generate/test/estate/structured-evidence.test.ts:52: `/structured unit payload/`
- packages/generate/test/estate/structured-evidence.test.ts:132: `/declared/`
- packages/generate/test/estate/then.test.ts:175: `/"matching any line" is no tool label/`
- packages/generate/test/estate/then.test.ts:176: `/both ends are Bash/`
- packages/generate/test/estate/unit.test.ts:538: `/no helper with an agent file/`
- packages/generate/test/estate/unit.test.ts:539: `/no task/`
- packages/validators/test/estate/bank.test.ts:202: `/found reference .* at \.claude\/skills\/tally\/SKILL\.md:6, never planted/`
- packages/validators/test/estate/bank.test.ts:204: `/missed the dispatch edge skill to route/`
- packages/validators/test/estate/bank.test.ts:205: `/the planted check fails/`
- packages/validators/test/estate/bank.test.ts:263: `/missed route/`
- packages/validators/test/estate/bank.test.ts:344: `/found (skill|route) .* at \.claude\/skills\/.*never planted/`
- packages/validators/test/estate/dispatch-fixtures.test.ts:68: `/subprocess\.run/`
- packages/validators/test/estate/dispatch-fixtures.test.ts:69: `/Usage: run\.py/`
- packages/validators/test/estate/emission-mutations.test.ts:296: `/the driver asked for block \$\{step\.blockIndex\}/`
- packages/validators/test/estate/equivalent-mutants.test.ts:46: `/no atom of the class changes the follower's session on this seed \(1 of 1 not judged/`
- packages/validators/test/estate/equivalent-mutants.test.ts:63: `/no generated test names the atom/`
- packages/validators/test/estate/follower.test.ts:64: `/obviously|simply/`
- packages/validators/test/estate/gen-task-v2-garbage.test.ts:107: `/^Please /`
- packages/validators/test/estate/gen-task-v2.test.ts:300: `/row tests|fingerprint/`
- packages/validators/test/estate/generator.test.ts:101: `/\bBefore you [^,]+, read `/`
- packages/validators/test/estate/journey-route.test.ts:60: `/route edges in no journey/`
- packages/validators/test/estate/journey-route.test.ts:71: `/read only from a description start a journey/`
- packages/validators/test/estate/judged-criteria.test.ts:70: `/^1 specs judge an atom/`
- packages/validators/test/estate/kill-static-equivalent.test.ts:36: `/repeats its folder/`
- packages/validators/test/estate/kill-static-equivalent.test.ts:55: `/before the verify step has passed/`
- packages/validators/test/estate/ladder.test.ts:69: `/^\[scan\.standing, tier 3\] the reader reads a routing cell naming the skill without backticks/`
- packages/validators/test/estate/ladder.test.ts:96: `/^script \.claude\/skills\/.+ at .+SKILL\.md:\d+ was planted and not found: "\d\. Run `python3 scripts\//`
- packages/validators/test/estate/mutants.test.ts:59: `/wait for |complete tests ran on the follower/`
- packages/validators/test/estate/mutants.test.ts:64: `/no generated test names the atom|wait for |complete tests ran on the follower|records the same session/`
- packages/validators/test/estate/mutants.test.ts:102: `/read 0 times, expected at least 1/`
- packages/validators/test/estate/mutants.test.ts:127: `/tools_offered\.exclude\.WebFetch.*WebFetch was offered/`
- packages/validators/test/estate/mutants.test.ts:197: `/complete tests ran on the follower with the atom deleted and all passed; the evidence .*did not fire/`
- packages/validators/test/estate/mutants.test.ts:301: `/left the estate/`
- packages/validators/test/estate/oracles.test.ts:175: `/fails on the rule follower:.*custom\.some_call/`
- packages/validators/test/estate/prompt-hook.test.ts:58: `/missed guard check-the-reply at \.claude\/settings\.json:3/`
- packages/validators/test/estate/prompt-hook.test.ts:64: `/missed guard check-the-reply/`
- packages/validators/test/estate/prompt-hook.test.ts:71: `/found guard guard\.settings\.stop-guard-stop at \.claude\/settings\.json:3, never planted/`
- packages/validators/test/estate/prompt-hook.test.ts:81: `/never planted/`
- packages/validators/test/estate/rulings.test.ts:374: `/reread/`

## Replacements

- Semantic alternatives use exact expected diagnostics derived from atom IDs, map fields, and recorded verdicts.
- Whole reply and rendered comma clause checks use complete expected output from the authored fictional fixture.
- Approved reply-length asks use existing exact approved phrase identity; malformed gate asks require no generated text.
- Literal diagnostic regexes become equivalent literal substring assertions. No negated assertion is dropped without a stronger exact-output assertion.
- Planted no-order mutant still requires at least one passing complete test, non-equivalence, and the exact completed-replay diagnostic.
- Source census uses an exact source string; the Please-prefix mutation uses an exact rendering-template prefix.
