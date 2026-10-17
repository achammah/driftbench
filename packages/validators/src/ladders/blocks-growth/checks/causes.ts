/**
 * The cause of every item of the growth lane "checks": the one change that turns green every item that names it,
 * and the doc section that defines the contract the change meets. A key stands for one sentence, so the bank can
 * count distinct causes by key. Each cause rests on a rule of docs/reference/checks.md that no earlier item tests.
 */

const D = 'docs/reference/checks.md';
const VERDICTS = `${D}#Verdicts`;
const RUNTIME = `${D}#Tools, skills, guards, references and subagents`;
const POLICY = `${D}#Rules on tools`;
const TEXT = `${D}#Text and language`;
const SCORES = `${D}#Similarity, relevancy and knowledge retention`;
const PII = `${D}#Personal data`;
const CARDS = `${D}#Cards`;
const STRICT = `${D}#Strict tool schemas`;
const CUSTOM = `${D}#Custom checks`;
const EXEC = `${D}#Execution`;
const ARTIFACTS = `${D}#Artifacts`;
const WORKSPACE = `${D}#Workspace`;
const SAFETY = `${D}#Safety`;
const OVERLAP = `${D}#Overlap and SQL`;
const VALUES = `${D}#Assertions on values`;
const TABLE = `${D}#Every check and its verdict ids`;

export const CAUSES = {
  // verdict machinery
  'name-before-dot': {
    text: "A verdict's check is the text of its id before the first dot, whatever dots the tool label, path or name holds.",
    contract: VERDICTS,
  },
  'custom-failure-fails-block': {
    text: 'A custom check that throws or returns something that is not a verdict gives a failed gating verdict that says so, and the run goes on.',
    contract: VERDICTS,
  },
  'runner-check-error': {
    text: 'A check that throws gives an inconclusive gating verdict `<check>.error` that names the problem; the run goes on.',
    contract: VERDICTS,
  },
  'runner-check-invalid': {
    text: 'A check that returns a verdict the schema refuses gives an inconclusive gating verdict `<check>.invalid` that names the problem.',
    contract: VERDICTS,
  },
  'checks-judged-apart': {
    text: 'The checks of one block are judged apart: a check that fails never changes the verdicts of another check.',
    contract: VERDICTS,
  },
  'suffix-other-names': {
    text: 'The second entry for a card, skill, guard, reference or helper name gets `#2` in its id, the third `#3`.',
    contract: VERDICTS,
  },
  'inconclusive-nongating': {
    text: 'A verdict the detector or the spec could not decide is inconclusive and does not gate: the block passes.',
    contract: VERDICTS,
  },
  'inconclusive-gating': {
    text: 'An expectation the adapter observed nothing for is inconclusive and gates: the block fails.',
    contract: VERDICTS,
  },
  'applies-pii': {
    text: 'The pii check gives verdicts only when the block has visible text.',
    contract: TABLE,
  },
  'applies-forbidden': {
    text: 'The forbidden check applies when a tool is in forbidden_tools, has max_calls, or is expected 0 times, and only then.',
    contract: TABLE,
  },
  'applies-schema-strict': {
    text: 'The schema_strict check applies only when metadata.tool_schemas is a mapping and the block made a tool call.',
    contract: TABLE,
  },
  'applies-stage': {
    text: 'The stage check applies when expect.stage is set and the runtime reported a stage, or when stage_reported is true.',
    contract: TABLE,
  },
  'applies-tools': {
    text: 'The tools check applies when a tool has a count other than 0 or tool_order is set; a tool expected 0 times is the forbidden check.',
    contract: TABLE,
  },
  'applies-rules': {
    text: 'lang_stable gives only lang.stable and one_message_per_turn only cards.one_message_per_turn: the other verdicts of the check need their own expectation.',
    contract: TABLE,
  },
  'index-from-zero': {
    text: 'The index in a verdict id counts the patterns, paths and references of an expectation from 0.',
    contract: TABLE,
  },
  // runtime lists
  'skills-by-name-count': {
    text: 'The skills check counts the skills the runtime reports loaded, by name and count, and does not check their order.',
    contract: RUNTIME,
  },
  'skills-absent-list-none': {
    text: 'A runtime trace without a skills list loaded no skill: the verdict is a plain fail, not inconclusive.',
    contract: RUNTIME,
  },
  'guards-narrow-by-verdict': {
    text: 'A guard entry counts the firings that gave its verdict; without a verdict it counts every firing of the guard.',
    contract: RUNTIME,
  },
  'guards-id-forms': {
    text: 'A guard verdict has the id guards.<name>.<verdict>, or guards.<name>.any for an entry without a verdict.',
    contract: RUNTIME,
  },
  'guards-count-zero': {
    text: 'A guard expected 0 times must not fire, or must not give the verdict the entry names.',
    contract: RUNTIME,
  },
  'guards-absent-list-fired-none': {
    text: 'A runtime trace without a guards list fired no guard: the verdict is a plain fail, not inconclusive.',
    contract: RUNTIME,
  },
  'references-glob-star': {
    text: 'A * in a reference glob matches within one folder.',
    contract: RUNTIME,
  },
  'references-glob-double-star': {
    text: 'A ** in a reference glob matches across folders.',
    contract: RUNTIME,
  },
  'references-glob-question': {
    text: 'A ? in a reference glob matches exactly one character.',
    contract: RUNTIME,
  },
  'references-count': {
    text: 'A reference without count needs at least one matching read, count 0 forbids the read, and a failing verdict names the path and lists the files read.',
    contract: RUNTIME,
  },
  'trace-lists-absent-not-checked': {
    text: 'A trace without a references list or a subagents list does not apply that check; an empty list does.',
    contract: RUNTIME,
  },
  'subagents-name-and-model': {
    text: 'A helper entry counts the dispatches by name, and by model when it gives one; a failing verdict lists the helpers with their models.',
    contract: RUNTIME,
  },
  'subagents-count-zero': {
    text: 'A helper expected 0 times must not be dispatched, on the model the entry names when it gives one.',
    contract: RUNTIME,
  },
  'offered-include-exclude': {
    text: 'tools_offered gives tools_offered.include.<tool> and tools_offered.exclude.<tool>, read from the offered list.',
    contract: RUNTIME,
  },
  'offered-calls-do-not-count': {
    text: 'tools_offered reads the offered list only: a call the agent made does not make a tool offered.',
    contract: RUNTIME,
  },
  'policy-first-match-decides': {
    text: 'The first rule of a tool policy that matches a call decides.',
    contract: POLICY,
  },
  'policy-unmatched-allowed': {
    text: 'A call that no rule of a tool policy matches is allowed.',
    contract: POLICY,
  },
  'policy-ask-is-a-denial': {
    text: 'An ask rule of a tool policy is a denial.',
    contract: POLICY,
  },
  'policy-glob-star': {
    text: 'A tool policy pattern is a glob over the tool name: a * stands for any run of characters and nothing else is special.',
    contract: POLICY,
  },
  'policy-one-verdict-per-tool': {
    text: 'The tool_policy check gives one verdict per denied tool, tool_policy.<label>, and exists only when a toolPolicy is given.',
    contract: POLICY,
  },
  'policy-run-marks-denied-calls': {
    text: 'runSpec with a toolPolicy marks each denied call in the recorded block with an error that names the rule.',
    contract: POLICY,
  },
  // reply text
  'finish-reason-compares': {
    text: 'finish_reason compares the reason the runtime reports with the expected one; no reported reason is inconclusive and does not gate.',
    contract: TEXT,
  },
  'json-fenced-reply': {
    text: 'A reply that is one Markdown code fence of JSON is read as that JSON, and prose around the fence is not.',
    contract: TEXT,
  },
  'json-schema-strict': {
    text: 'expect.json.schema is checked strictly: a key it does not declare fails, at any depth.',
    contract: TEXT,
  },
  'json-invalid-fails-paths': {
    text: 'A reply that is not JSON fails json.valid, and every path and the schema after it fail with a reason.',
    contract: TEXT,
  },
  'json-embedded': {
    text: 'With embedded on, the whole reply is read first, and otherwise the first JSON object or array in the text; off, prose around JSON fails.',
    contract: TEXT,
  },
  'json-paths-dotted': {
    text: 'A json path is dotted, a number indexes an array, and its assertion is the spec vocabulary.',
    contract: TEXT,
  },
  'markup-structure': {
    text: 'markup xml or html checks that each close matches the open element, and structure only, not attributes.',
    contract: TEXT,
  },
  'markup-sql-syntax': {
    text: 'markup sql parses each statement with SQLite, split on semicolons outside strings; only syntax errors fail.',
    contract: TEXT,
  },
  'regex-own-verdict': {
    text: 'regex gives each pattern its own verdict, is case-sensitive, and reads each pattern as a regular expression.',
    contract: TEXT,
  },
  'starts-with-whole-reply': {
    text: 'starts_with checks the start of the whole reply after removing its leading space, not the start of any line.',
    contract: TEXT,
  },
  'exact-normalising': {
    text: 'exact trims, drops every character that is not a letter, a digit or a space, collapses whitespace, lowers the case, and never equals an empty reply.',
    contract: TEXT,
  },
  'exact-strict-bytes': {
    text: 'exact_strict compares the reply byte for byte after trimming its ends.',
    contract: TEXT,
  },
  // language and intent
  'must-evidence-match': {
    text: 'The evidence of a must pattern gives the matched text and its offset; a pattern may span segments.',
    contract: TEXT,
  },
  'must-names-the-closest-span': {
    text: 'A failing literal must names the closest span of the reply and how far it differs: another case, or the number of characters that differ.',
    contract: TEXT,
  },
  'must-pattern-in-both-lists': {
    text: 'The same pattern cannot sit in both must and must_not of a block: the spec is refused.',
    contract: TEXT,
  },
  'lang-reads-the-reply': {
    text: 'lang reads every text segment of a reply as a language and compares it with the expected one, a tag included; a segment too short is skipped.',
    contract: TEXT,
  },
  'lang-stable-settles': {
    text: 'lang_stable settles on the language of the first reply the detector is sure of, in this block or an earlier one, and asks every segment to read as it.',
    contract: TEXT,
  },
  'injection-attack-recognised': {
    text: 'injection.attack passes when a rule recognises the message as an attempt and is inconclusive, never failed, when none does.',
    contract: TEXT,
  },
  'injection-resist-compliance': {
    text: 'injection.resist fails when the reply matches a compliance rule, such as an announced developer mode or a disclosed system prompt, and quotes the match.',
    contract: TEXT,
  },
  'json-missing-path-fails': {
    text: 'A json path that reads nothing counts as absent: it fails every assertion but absent, whatever the form of the assertion, and the check does not throw.',
    contract: VALUES,
  },
  'exact-true-is-one': {
    text: 'exact reads true as 1, in any case, and no other word as a number.',
    contract: TEXT,
  },
  // scores
  'similarity-cosine-of-embedder': {
    text: 'similarity scores a reply against a reference as the cosine of the vectors the embedder gives the two texts, and passes at min or above.',
    contract: SCORES,
  },
  'similarity-names-the-embedder': {
    text: 'A similarity verdict carries the score and names the embedder that gave it, the default char-ngram-tfidf or the one plugged in.',
    contract: SCORES,
  },
  'similarity-embedder-failure': {
    text: 'An embedder that fails gives an inconclusive similarity verdict that says why.',
    contract: SCORES,
  },
  'similarity-per-reference': {
    text: 'similarity gives each reference text its own verdict, similarity.<index>, with its own score and min.',
    contract: SCORES,
  },
  'similarity-default-local': {
    text: 'The default similarity embedder is local and deterministic: the same two texts always score the same, and more shared text scores higher.',
    contract: SCORES,
  },
  'relevancy-min-and-share': {
    text: 'relevancy passes when the share of key terms found reaches min, default 0.5, and carries the share as its score.',
    contract: SCORES,
  },
  'relevancy-no-term-found-fails': {
    text: 'Without a judge, a reply that holds no key term fails relevancy and gates.',
    contract: SCORES,
  },
  'relevancy-some-not-enough-inconclusive': {
    text: 'A reply that holds some key terms but not enough gives an inconclusive relevancy verdict that does not gate.',
    contract: SCORES,
  },
  'relevancy-stem-match': {
    text: 'relevancy matches a key term with a reply word of the same stem or the stem plus one letter, accents removed, by the stemmer of the language of the ask.',
    contract: SCORES,
  },
  'relevancy-terms-from-the-ask': {
    text: 'Without terms, the key terms of relevancy are the words of the ask of four letters or more; with terms, only those.',
    contract: SCORES,
  },
  'retention-asked-again': {
    text: 'knowledge_retention fails .asked when a question of the reply, a sentence ending with ?, names the words of the key of a fact the ledger holds.',
    contract: SCORES,
  },
  'retention-confirmation-is-not-asking': {
    text: 'A question that repeats the given value is a confirmation, not an ask for the fact again.',
    contract: SCORES,
  },
  'retention-ask-pattern': {
    text: 'An ask pattern replaces the words of the key as the mark of a question that asks for the fact again.',
    contract: SCORES,
  },
  'retention-use-the-value': {
    text: 'With use: true the value of the fact must appear in the reply or in a tool input, case and spacing aside, by its digits alone from six digits.',
    contract: SCORES,
  },
  'rouge-l-f-measure': {
    text: 'rouge_l is the F measure of the longest common word subsequence of the reply and the reference, and passes at min or above.',
    contract: OVERLAP,
  },
  'overlap-words-lowercased': {
    text: 'The driftbench profile reads words as runs of letters and digits in lower case with no stemming.',
    contract: OVERLAP,
  },
  'bleu-clipped-ngram-precision': {
    text: 'bleu is the geometric mean of the clipped 1- to 4-gram precisions of the reply with a brevity penalty.',
    contract: OVERLAP,
  },
  'bleu-zero-without-a-match': {
    text: 'bleu scores 0 when some n-gram size has no match.',
    contract: OVERLAP,
  },
  'overlap-profile-ragas-stems': {
    text: 'The ragas profile stems words, the driftbench profile does not, and the evidence quotes the score of the other profile.',
    contract: OVERLAP,
  },
  'sql-rows-multiset': {
    text: 'sql compares the rows of the agent query and of the golden query as a multiset.',
    contract: OVERLAP,
  },
  'sql-order-by-golden': {
    text: 'sql compares the rows in order only when the golden query has an ORDER BY.',
    contract: OVERLAP,
  },
  'sql-column-names-ignored': {
    text: 'sql does not compare the names of the columns.',
    contract: OVERLAP,
  },
  'sql-write-refused': {
    text: 'sql accepts one read statement only: a write, or a second statement, is refused before it runs and the database is unchanged.',
    contract: OVERLAP,
  },
  'sql-failing-queries': {
    text: 'A golden query that fails is inconclusive; an agent query that fails is a fail that quotes the database message; the query is read from the named tool.',
    contract: OVERLAP,
  },
  // data
  'pii-iban-checksum': {
    text: 'pii.iban finds an IBAN whose checksum holds, written plain or in groups, whatever its country, and leaves one with a broken checksum.',
    contract: PII,
  },
  'pii-national-number': {
    text: 'pii.national_number finds a Belgian national register number whose check holds, for a birth before and after 2000, and leaves one with a broken check.',
    contract: PII,
  },
  'pii-phone-forms': {
    text: 'pii.phone finds a phone number in international form or a Belgian mobile, and leaves the reserved North American range 555-0100 to 555-0199.',
    contract: PII,
  },
  'pii-reserved-addresses': {
    text: 'pii.email leaves addresses at example.com, example.org, example.net, localhost and under .example, .test, .invalid and .localhost, and finds the others.',
    contract: PII,
  },
  'pii-reserved-include': {
    text: 'createPiiCheck with reservedDomains include makes the reserved addresses findings too; the default stays exclude.',
    contract: PII,
  },
  'pii-email-evidence': {
    text: 'The evidence of a pii finding masks the value and gives its offset, one offset for each finding.',
    contract: PII,
  },
  'pii-owner-allowlist': {
    text: 'The owner allowlist leaves out a finding only when it equals an owner value (an address case-folded, anything else by its letters and digits), counts what it left out and never prints it.',
    contract: PII,
  },
  'cards-count': {
    text: 'cards gives cards.<name> with the count of that card in the block, a count working as for tools.',
    contract: CARDS,
  },
  'one-message-per-turn': {
    text: 'one_message_per_turn fails two text segments, a card sent twice, and a block with no text and no card; a card stands in for the text.',
    contract: CARDS,
  },
  'custom-name-rules': {
    text: 'A custom check name takes letters, digits, dots, underscores and hyphens, and is registered once.',
    contract: CUSTOM,
  },
  'custom-verdict-ids': {
    text: 'Every verdict of a custom check is filed under custom.<name>, one per entry of the list it returns, on every block of the spec.',
    contract: CUSTOM,
  },
  'custom-empty-list-says-nothing': {
    text: 'A custom check that returns an empty list says nothing about the block.',
    contract: CUSTOM,
  },
  'custom-receives-options': {
    text: 'The function of a custom check receives the context of the block and the options written for its name under rules.custom.',
    contract: CUSTOM,
  },
  'value-regex-m-flag': {
    text: 'A regex assertion compiles with the m flag: ^ and $ anchor at the start and end of any line.',
    contract: VALUES,
  },
  'value-contains-list-item': {
    text: 'contains holds for a string that contains the text and for a list that holds the text as an item.',
    contract: VALUES,
  },
  'value-json-equality': {
    text: 'Equality is JSON equality: lists compare item by item in order, mappings by their keys in any order.',
    contract: VALUES,
  },
  'value-nested-subset': {
    text: 'subset holds when the value has at least these keys with these values; nested mappings compare the same way and lists in order.',
    contract: VALUES,
  },
  'value-nonempty-null': {
    text: 'nonempty rejects null and a key that holds no value; absent holds for exactly the key that holds none.',
    contract: VALUES,
  },
  // strict schemas
  'strict-schema-forms': {
    text: 'schema_strict reads a schema written as a JSON Schema, as an OpenAI-style function with parameters, or as an Anthropic-style tool with input_schema.',
    contract: STRICT,
  },
  'strict-undeclared-key': {
    text: 'An object schema that declares properties refuses any other key, at any depth, in nested objects and in list items.',
    contract: STRICT,
  },
  'strict-additional-properties': {
    text: 'additionalProperties allows an undeclared key where it says so, and an object schema with no properties refuses none.',
    contract: STRICT,
  },
  'strict-required': {
    text: 'schema_strict fails a call that misses a required key, at any depth.',
    contract: STRICT,
  },
  'strict-type': {
    text: 'schema_strict checks the type of every value: string, number, integer, boolean, array and object refuse each other.',
    contract: STRICT,
  },
  'strict-enum-and-const': {
    text: 'schema_strict accepts an enum member or the const and refuses anything else, of the same JSON type only.',
    contract: STRICT,
  },
  'strict-bounds': {
    text: 'schema_strict applies the inclusive bounds on strings, numbers and lists.',
    contract: STRICT,
  },
  'strict-pattern': {
    text: 'schema_strict accepts a text that holds a match of the pattern anywhere and refuses the others.',
    contract: STRICT,
  },
  'strict-items': {
    text: 'schema_strict checks every item of a list against items.',
    contract: STRICT,
  },
  'strict-nullable': {
    text: 'schema_strict accepts null only where the schema says nullable.',
    contract: STRICT,
  },
  'strict-combinators': {
    text: 'schema_strict reads anyOf (at least one fits), oneOf (exactly one fits) and allOf (all fit).',
    contract: STRICT,
  },
  'strict-verdict-per-call': {
    text: 'schema_strict gives one verdict per call, schema_strict.<label>.<n>, the n counting the calls of one tool in the block from 1.',
    contract: STRICT,
  },
  'strict-unsupported-keyword-inconclusive': {
    text: 'A schema that reaches the check with an unsupported keyword gives an inconclusive gating verdict that names the keyword.',
    contract: STRICT,
  },
  'strict-names-and-values-are-data': {
    text: 'Property names, enum and const values, and the annotations title, description, default, examples, $schema, $id and $comment are not unsupported keywords.',
    contract: STRICT,
  },
  // code, files and workspace
  'execution-ran-code-false': {
    text: 'ran_code false forbids any command: it passes a block in which no command ran, and the agent process is no command.',
    contract: EXEC,
  },
  'execution-exit-code-evidence': {
    text: 'exit_code reads the last command, or the agent process when it exited non-zero or when no command ran, and its evidence names both when both exist.',
    contract: EXEC,
  },
  'workspace-empty-list-asserts-empty': {
    text: 'An empty list in the workspace expectation asserts that its set is empty.',
    contract: WORKSPACE,
  },
  'workspace-changed-by-hash-or-size': {
    text: 'A file is changed when its hash or its size differs; a file rewritten with the same bytes is not changed.',
    contract: WORKSPACE,
  },
  'workspace-net-change': {
    text: 'The workspace diff is the net change of the block: a file created and deleted inside it is in no set.',
    contract: WORKSPACE,
  },
  'workspace-others-only-by-flag': {
    text: 'A path in the diff that no list names fails only through others_untouched: true.',
    contract: WORKSPACE,
  },
  'artifacts-code-kind': {
    text: 'A code file is opened and each declared check is judged, a tests check always failing and saying that running a command is the job of execution.',
    contract: ARTIFACTS,
  },
  'artifacts-kind-from-extension': {
    text: 'When kind is absent the artifact is opened with the reader of its file extension.',
    contract: ARTIFACTS,
  },
  'artifacts-verdict-per-check': {
    text: 'One verdict says the file was read and opened, then one per declared check, artifacts.<path>.<index>.<check name>; a missing file is one failed verdict that names it; an unknown check name fails and lists the checks of the kind.',
    contract: ARTIFACTS,
  },
  'artifacts-reader-opens-the-file': {
    text: "The reader opens the file itself: a check never trusts the agent's description of it.",
    contract: ARTIFACTS,
  },
  'artifacts-adapter-without-workspace': {
    text: 'An adapter with no workspace gives one failed verdict per expected file, naming it.',
    contract: ARTIFACTS,
  },
  'safety-delete-counted-once': {
    text: 'A delete through a tool whose input names a path the workspace diff already lists counts once.',
    contract: SAFETY,
  },
} as const satisfies Record<string, { text: string; contract: string }>;

export type GrowthCause = keyof typeof CAUSES;

/** Contracts kept here so every file of the lane cites the same heading. */
export const HEADINGS = {
  VERDICTS,
  RUNTIME,
  POLICY,
  TEXT,
  SCORES,
  PII,
  CARDS,
  STRICT,
  CUSTOM,
  EXEC,
  ARTIFACTS,
  WORKSPACE,
  SAFETY,
  OVERLAP,
  VALUES,
  TABLE,
} as const;
