/**
 * The doc section that defines the contract of each cause of the blocks bank (owner rule, 2026-10-17): a path
 * under docs/ with its heading after #, or, for a capability built only on an open pull request, its ref and path.
 * docs/reference/block-contracts.md holds the contracts no other reference defines yet.
 */
export const CONTRACTS: Readonly<Record<string, string>> = {
  'A block listing several personas is planned as one cell per persona.':
    'docs/reference/block-contracts.md#Personas',
  'A block whose dependencies are unknown is in every radius.':
    'docs/concepts/blast-radius.md#Unknown means in',
  'A change that reaches a parent block puts all its descendants in the radius, in every mode, wherever they are written.':
    'origin/feat/block-parents:docs/concepts/blast-radius.md#Parent blocks',
  'A change the radius cannot map (agent) makes the radius the whole suite.':
    'docs/concepts/blast-radius.md#Unknown means in',
  'A change the radius cannot map (global tool) makes the radius the whole suite.':
    'docs/concepts/blast-radius.md#Unknown means in',
  'A change the radius cannot map (model) makes the radius the whole suite.':
    'docs/concepts/blast-radius.md#Unknown means in',
  'A change the radius cannot map (no change listed) makes the radius the whole suite.':
    'docs/concepts/blast-radius.md#Unknown means in',
  'A change the radius cannot map (reply language) makes the radius the whole suite.':
    'docs/concepts/blast-radius.md#Unknown means in',
  'A change the radius cannot map (tool without id) makes the radius the whole suite.':
    'docs/concepts/blast-radius.md#Unknown means in',
  'A change the radius cannot map (undeclared stage) makes the radius the whole suite.':
    'docs/concepts/blast-radius.md#Unknown means in',
  'A change the radius cannot map (undeclared tool) makes the radius the whole suite.':
    'docs/concepts/blast-radius.md#Unknown means in',
  'A change the radius cannot map (unknown kind) makes the radius the whole suite.':
    'docs/concepts/blast-radius.md#Unknown means in',
  "A child whose adapter cannot seed its ancestors' turns is not_run before it is sent, whatever its parent did.":
    'origin/feat/block-parents:docs/concepts/given-when-then.md#Parent blocks',
  "A child's checks read the workspace it inherited: a file its parent wrote is there to judge.":
    'docs/reference/block-contracts.md#What a child starts from',
  "A child's history holds each ancestor's user turn once.":
    'docs/reference/block-contracts.md#What a child starts from',
  "A child's history holds its ancestors' replies, oldest first.":
    'docs/reference/block-contracts.md#What a child starts from',
  "A child's history holds its parent's tool calls with their recorded results and errors.":
    'origin/feat/block-parents:docs/concepts/given-when-then.md#Parent blocks',
  "A child's history leaves out every block that is not its ancestor, even one run before it.":
    'origin/feat/block-parents:docs/concepts/given-when-then.md#Parent blocks',
  "A child's own given.prefix replaces the conversation it would inherit from its ancestors.":
    'origin/feat/block-parents:docs/concepts/given-when-then.md#Parent blocks',
  "A child's own world.workspace replaces the inherited workspace whole: none of the parent's files carry.":
    'origin/feat/block-parents:docs/concepts/given-when-then.md#Parent blocks',
  "A child's workspace diff starts from the workspace it inherited: its ancestors' files are neither created nor changed by it.":
    'docs/reference/block-contracts.md#What a child starts from',
  "A code child inherits its ancestors' binary files byte for byte, never through a text decoder.":
    'origin/feat/block-parents:docs/concepts/given-when-then.md#Parent blocks',
  "A code child inherits its ancestors' text files with their byte-order mark.":
    'origin/feat/block-parents:docs/concepts/given-when-then.md#Parent blocks',
  "A code child starts from its parent's exported workspace: its ancestors' files, no sibling's.":
    'origin/feat/block-parents:docs/concepts/given-when-then.md#Parent blocks',
  'A deviation change selects the blocks whose class is that id, or that id followed by an underscore: D1 never selects D10.':
    'docs/concepts/blast-radius.md#A change',
  'A failed parent makes its descendants blocked, never sent, each by its own parent and rooted at the first failure.':
    'origin/feat/block-parents:docs/concepts/given-when-then.md#Parent blocks',
  'A failing block with no children blocks nothing: every other block keeps its own verdict.':
    'docs/reference/block-contracts.md#What a child starts from',
  'A failure in one tree of parent links leaves the other trees running and passing.':
    'origin/feat/block-parents:docs/concepts/given-when-then.md#Parent blocks',
  'A gating verdict that is inconclusive fails its block: a block passes only when every gating verdict passes.':
    'docs/reference/checks.md#Verdicts',
  "A later world's workspace replaces the earlier one whole; an earlier workspace never overrides it.":
    'docs/running.md#Given resolution and the hash',
  'A link that leaves the workspace fails the export: the child is not_run (setup_failed) and its descendants blocked.':
    'origin/feat/block-parents:docs/concepts/given-when-then.md#Parent blocks',
  'A parent that is not run blocks its children, rooted at itself.':
    'origin/feat/block-parents:docs/concepts/given-when-then.md#Parent blocks',
  'A passed parent runs once per run, however many children share it.':
    'origin/feat/block-parents:docs/concepts/given-when-then.md#Parent blocks',
  "A path is inside the workspace only below its root folder: a sibling folder whose name starts with the workspace's name is outside.":
    'docs/adapters/process.md#Workspace paths',
  'A persona failing several requires keys is refused naming the first failing key the block lists.':
    'origin/research/block-framework-persona:research/block-redesign/framework/persona/hf12/SCHEMA.md#The five refusal classes',
  'A persona failing the concepts requirement is a not_run cell (persona_incompatible) while the other personas run.':
    'origin/research/block-framework-persona:research/block-redesign/framework/persona/hf12/SCHEMA.md#The five refusal classes',
  'A persona failing the has_account requirement is a not_run cell (persona_incompatible) while the other personas run.':
    'origin/research/block-framework-persona:research/block-redesign/framework/persona/hf12/SCHEMA.md#The five refusal classes',
  'A persona failing the language requirement is a not_run cell (persona_incompatible) while the other personas run.':
    'origin/research/block-framework-persona:research/block-redesign/framework/persona/hf12/SCHEMA.md#The five refusal classes',
  'A persona failing the min_expertise requirement is a not_run cell (persona_incompatible) while the other personas run.':
    'origin/research/block-framework-persona:research/block-redesign/framework/persona/hf12/SCHEMA.md#The five refusal classes',
  'A rate leaves blocked runs out of its scored count: a run with a blocked block is neither a pass nor a failure.':
    'docs/running.md#Outcomes',
  'A rate leaves not_run runs out of its count and unscoredText names them.': 'docs/running.md#Outcomes',
  'A result carries for exactly --max-carry campaigns in a row: the last one allowed is carried, the next runs fresh.':
    'docs/reference/cli.md#Campaigns and smoke',
  'A run counts each planted failure once: blocked descendants add no failure and keep their own root.':
    'origin/feat/block-parents:docs/concepts/given-when-then.md#Parent blocks',
  'A section is placed only where its text hashes as before: an edit inside it makes it stale.':
    'docs/concepts/blast-radius.md#Prompt sections and block links',
  'A workspace past the export bound leaves the children not_run (setup_failed) and their descendants blocked.':
    'origin/feat/block-parents:docs/concepts/given-when-then.md#Parent blocks',
  'A workspace path that normalises to `..` leaves the workspace and is refused as such.':
    'docs/adapters/process.md#Workspace paths',
  "A workspace seed keeps a text file's byte-order mark: the bytes the agent reads are the bytes planted.":
    'docs/reference/block-contracts.md#workspace',
  'A workspace seed writes workspace.binary files byte for byte from their base64.':
    'docs/reference/block-contracts.md#workspace',
  "A world layer set on a block reaches its descendants and never a sibling's tree or another root.":
    'docs/reference/block-contracts.md#What a child starts from',
  'An adapter with a sandbox and no export hook leaves the children of a parent not_run (unsupported), never seeded from old files.':
    'origin/feat/block-parents:docs/concepts/given-when-then.md#Parent blocks',
  'Blame names I1_protected_edit, before any other item, when a gating verdict fails and the net diff changed or deleted a path of expect.protected.':
    'origin/feat/block-b4-report:docs/reference/blame.md#policy/blame:default',
  'Blame names I3_false_claim when the reply claims done while the artifact check fails, and leaves an honest failure unassigned.':
    'origin/feat/block-b4-report:docs/reference/blame.md#policy/blame:default',
  'Blame names core_rule_caught when an enforcing guard denied the act and later allowed it, the agent having complied.':
    'origin/feat/block-b4-report:docs/reference/blame.md#policy/blame:default',
  'Blame names skill_not_loaded_undecided when the skill a failing check is about never loaded and nothing says whether its description covers the ask; a skill loaded, fewer times than expected, is no load failure and stays unassigned.':
    'origin/feat/block-b4-report:docs/reference/blame.md#policy/blame:default',
  'Blame names env_failure before any skill item for a failed command with an environment error, and skill_not_loaded_undecided for a skill that never loaded.':
    'origin/feat/block-b4-report:docs/reference/blame.md#policy/blame:default',
  'Blame names I1_protected_edit before any skill item, and skill_not_loaded_undecided for a skill that never loaded with nothing else to blame.':
    'origin/feat/block-b4-report:docs/reference/blame.md#policy/blame:default',
  'Blame names env_failure for a command that failed with a network error, never the agent.':
    'origin/feat/block-b4-report:docs/reference/blame.md#policy/blame:default',
  'Blame names env_failure for a command that failed with a package error, never the agent.':
    'origin/feat/block-b4-report:docs/reference/blame.md#policy/blame:default',
  'Blame names env_failure for a command that failed with a sandbox error, never the agent.':
    'origin/feat/block-b4-report:docs/reference/blame.md#policy/blame:default',
  'Blame names env_failure for a command that failed with a timeout error, never the agent.':
    'origin/feat/block-b4-report:docs/reference/blame.md#policy/blame:default',
  "Blame reads the value's source and change, and the tool's contract, from the run's value facts: it separates altered (R2) from derived (R2b).":
    'docs/reference/block-contracts.md#attributionOf',
  "Blame reads the value's source and change, and the tool's contract, from the run's value facts: it separates altered (R2) from enum (R1).":
    'docs/reference/block-contracts.md#attributionOf',
  "Blame reads the value's source and change, and the tool's contract, from the run's value facts: it separates altered (R2) from verbatim (R3).":
    'docs/reference/block-contracts.md#attributionOf',
  "Blame reads the value's source and change, and the tool's contract, from the run's value facts: it separates derived (R2b) from verbatim (R3).":
    'docs/reference/block-contracts.md#attributionOf',
  "Blame reads the value's source and change, and the tool's contract, from the run's value facts: it separates enum (R1) from verbatim (R3).":
    'docs/reference/block-contracts.md#attributionOf',
  'Diagnostics run after the checks, write diagnoses on failing verdicts, and never change a verdict or pass.':
    'origin/feat/block-b4-report:docs/running.md#The run record',
  "Each code block starts with no runtime file: the runtime events of one block never appear in the next block's runtime.":
    'docs/adapters/process.md#What the agent reports',
  'Each root of a forest starts at the spec defaults: no turn of another tree reaches it.':
    'origin/feat/block-parents:docs/concepts/given-when-then.md#Parent blocks',
  'Every verdict names the object, item, implementation and layer that produced it (Verdict.by).':
    'origin/feat/block-b4-report:docs/running.md#The run record',
  'Every verdict of a code block names the check-set item and layer that produced it (Verdict.by).':
    'origin/feat/block-b4-report:docs/running.md#The run record',
  'GIVEN_ORIGIN_WITHOUT_PREFIX: origin needs a prefix on the same block': 'docs/reference/cli.md#Issue codes',
  "In a parent-linked spec a user driver reads the history of the block's own ancestors only, so a fact the agent asked for in another branch is not given.":
    'origin/feat/block-parents:docs/concepts/given-when-then.md#Parent blocks',
  'In mode T a direct task step that writes its own workspace still carries it forward to the steps after it, up to the next step that writes one.':
    'docs/concepts/blast-radius.md#The radius',
  'PARENT_MISSING and PARENT_CYCLE are spec errors; a forward reference to an existing block is valid':
    'origin/feat/block-parents:docs/concepts/given-when-then.md#Parent blocks',
  'The --set preflight resolves the object and refuses an item or object no layer defines.':
    'docs/reference/block-contracts.md#Command line layer',
  'The artifacts check opens a written csv file and judges its content against each declared check.':
    'docs/reference/checks.md#Artifacts',
  'The artifacts check opens a written docx file and judges its content against each declared check.':
    'docs/reference/checks.md#Artifacts',
  'The artifacts check opens a written json file and judges its content against each declared check.':
    'docs/reference/checks.md#Artifacts',
  'The artifacts check opens a written pdf file and judges its content against each declared check.':
    'docs/reference/checks.md#Artifacts',
  'The artifacts check opens a written txt file and judges its content against each declared check.':
    'docs/reference/checks.md#Artifacts',
  'The artifacts check opens a written xlsx file and judges its content against each declared check.':
    'docs/reference/checks.md#Artifacts',
  'The artifacts of a code block are the files it created and the files it changed.':
    'docs/adapters/process.md#How a block runs',
  'The as-given rung fails a value the agent changed from what the user or a file gave.':
    'docs/reference/block-contracts.md#Steps',
  'The as-given rung never passes a copy: a copied value goes on to the exact fallback.':
    'docs/reference/block-contracts.md#Steps',
  'The blocks a radius counts as sent are its cells in the radius times the scored blocks: a block a gate rejected is never counted.':
    'docs/concepts/blast-radius.md#The command',
  'The capability check refuses a written prefix the adapter cannot seed, from the block that writes it on.':
    'docs/adapters/index.md#Capabilities',
  'The contract rung fails a value outside the pattern, enum or const the tool definition states.':
    'docs/reference/block-contracts.md#Steps',
  'The contract rung passes nothing: a value inside the stated format goes on to the exact fallback.':
    'docs/reference/block-contracts.md#Steps',
  'The execution check counts the commands the agent ran against max_commands.':
    'docs/reference/checks.md#Execution',
  'The execution check reads ran_code from the commands the agent ran, never from its reply.':
    'docs/reference/checks.md#Execution',
  "The execution check reads the agent process's exit code when it is non-zero, else the last command's, never the reply.":
    'docs/reference/checks.md#Execution',
  'The executions of a code block list the commands the agent reported, in their order, then the agent process, always last.':
    'docs/adapters/process.md#How a block runs',
  'The exit code check and the command limit check of one block are judged apart: one failing never skips, fails or passes the other.':
    'docs/reference/checks.md#Verdicts',
  'The export a child starts from skips .git and node_modules and carries every other file.':
    'origin/feat/block-parents:docs/concepts/given-when-then.md#Parent blocks',
  'The export carries a link that points inside the workspace as a plain copy of its target.':
    'origin/feat/block-parents:docs/concepts/given-when-then.md#Parent blocks',
  'The file content check and the command limit check of one block are judged apart: one failing never skips, fails or passes the other.':
    'docs/reference/checks.md#Verdicts',
  'The file content check and the exit code check of one block are judged apart: one failing never skips, fails or passes the other.':
    'docs/reference/checks.md#Verdicts',
  'The file content check and the stray file check of one block are judged apart: one failing never skips, fails or passes the other.':
    'docs/reference/checks.md#Verdicts',
  'The forward closure adds every block after a direct block of the same run in mode F.':
    'docs/concepts/blast-radius.md#The radius',
  'The function adapter hands the prefix to the agent with its tool calls and outputs.':
    'docs/concepts/run-modes.md#Teacher-forced',
  'The headline interval accounts for the spread between goldens, so it covers the planted rate.':
    'docs/concepts/statistics.md#The suite headline',
  'The ladder fails a differing value that is not a string before any rung.':
    'docs/reference/block-contracts.md#Steps',
  'The ladder passes a value equal to the gold before any rung.': 'docs/reference/block-contracts.md#Steps',
  'The loader accepts a parent written after its child.':
    'origin/feat/block-parents:docs/concepts/given-when-then.md#Parent blocks',
  'The loader accepts blocks played by persona and scenario objects.':
    'origin/research/block-framework-persona:research/block-redesign/framework/persona/hf12/SCHEMA.md#Objects',
  'The loader reads workspace.binary as base64 and refuses an entry that is not.':
    'origin/feat/block-parents:docs/reference/spec.md#WorldState workspace',
  'The loader refuses a key no schema object defines, wherever it sits, and never keeps it in the spec.':
    'docs/reference/spec.md#Spec reference',
  'The loader refuses a workspace path that is in both files and binary (WORKSPACE_PATH_TWICE).':
    'origin/feat/block-parents:docs/reference/cli.md#Issue codes',
  'The loader refuses an origin on a block that writes no prefix (GIVEN_ORIGIN_WITHOUT_PREFIX).':
    'docs/reference/cli.md#Issue codes',
  'The loader refuses parent links that are long cycle with PARENT_CYCLE.':
    'origin/feat/block-parents:docs/reference/cli.md#Issue codes',
  'The loader refuses parent links that are missing with PARENT_MISSING.':
    'origin/feat/block-parents:docs/reference/cli.md#Issue codes',
  'The loader refuses parent links that are self with PARENT_CYCLE.':
    'origin/feat/block-parents:docs/reference/cli.md#Issue codes',
  'The loader refuses parent links that are two cycle with PARENT_CYCLE.':
    'origin/feat/block-parents:docs/reference/cli.md#Issue codes',
  'The loader resolves spec and block uses against the shipped objects.':
    'origin/feat/block-f3-object-commands:docs/reference/spec.md#Uses',
  "The loader's resolve pass refuses add existing with OBJECT_ITEM_EXISTS.":
    'origin/feat/block-f3-object-commands:docs/reference/cli.md#Issue codes',
  "The loader's resolve pass refuses add incomplete with OBJECT_ITEM_INCOMPLETE.":
    'origin/feat/block-f3-object-commands:docs/reference/cli.md#Issue codes',
  "The loader's resolve pass refuses order and move with OBJECT_ORDER_INVALID.":
    'origin/feat/block-f3-object-commands:docs/reference/cli.md#Issue codes',
  "The loader's resolve pass refuses order missing an item with OBJECT_ORDER_INVALID.":
    'origin/feat/block-f3-object-commands:docs/reference/cli.md#Issue codes',
  "The loader's resolve pass refuses unknown impl with OBJECT_IMPL_UNKNOWN.":
    'origin/feat/block-f3-object-commands:docs/reference/cli.md#Issue codes',
  "The loader's resolve pass refuses unknown item new with OBJECT_ITEM_UNKNOWN.":
    'origin/feat/block-f3-object-commands:docs/reference/cli.md#Issue codes',
  "The loader's resolve pass refuses unknown item typo with OBJECT_ITEM_UNKNOWN.":
    'origin/feat/block-f3-object-commands:docs/reference/cli.md#Issue codes',
  "The loader's resolve pass refuses unknown object with OBJECT_UNKNOWN.":
    'docs/reference/block-contracts.md#Unknown parent',
  "The loader's resolve pass refuses unknown parent with OBJECT_UNKNOWN.":
    'docs/reference/block-contracts.md#Unknown parent',
  'The origin, when present, enters the spec hash and the Given hash of every block it covers.':
    'docs/concepts/given-when-then.md#Tool history: records, not prose',
  'The outcome rung leaves a value it cannot decide (field only stored) to the exact fallback.':
    'docs/reference/block-contracts.md#Steps',
  'The outcome rung leaves a value it cannot decide (gold refused) to the exact fallback.':
    'docs/reference/block-contracts.md#Steps',
  'The outcome rung leaves a value it cannot decide (no distractors) to the exact fallback.':
    'docs/reference/block-contracts.md#Steps',
  'The outcome rung leaves a value it cannot decide (tool not declared) to the exact fallback.':
    'docs/reference/block-contracts.md#Steps',
  'The outcome rung replays the call with the value and with the gold and compares what the tool resolves.':
    'docs/reference/block-contracts.md#Steps',
  'The parent rules hold on any forest: many roots, several failures and unrun blocks, written in any order, in either mode.':
    'docs/reference/block-contracts.md#What a child starts from',
  'The pass rate criterion interval accounts for the spread between goldens, so it covers the planted rate.':
    'docs/aggregates.md#Interval and planning',
  'The persona loader refuses contradictory belief as a load error naming its class.':
    'origin/research/block-framework-persona:research/block-redesign/framework/persona/hf12/SCHEMA.md#The five refusal classes',
  'The persona loader refuses persona sets goal as a load error naming its class.':
    'origin/research/block-framework-persona:research/block-redesign/framework/persona/hf12/SCHEMA.md#The five refusal classes',
  'The persona loader refuses persona switch in chain as a load error naming its class.':
    'origin/research/block-framework-persona:research/block-redesign/framework/persona/hf12/SCHEMA.md#The five refusal classes',
  'The persona loader refuses scenario sets language as a load error naming its class.':
    'origin/research/block-framework-persona:research/block-redesign/framework/persona/hf12/SCHEMA.md#The five refusal classes',
  'The persona loader refuses scenario sets verbosity as a load error naming its class.':
    'origin/research/block-framework-persona:research/block-redesign/framework/persona/hf12/SCHEMA.md#The five refusal classes',
  'The persona loader refuses situational sets behaviour as a load error naming its class.':
    'origin/research/block-framework-persona:research/block-redesign/framework/persona/hf12/SCHEMA.md#The five refusal classes',
  'The persona loader refuses slot collision as a load error naming its class.':
    'origin/research/block-framework-persona:research/block-redesign/framework/persona/hf12/SCHEMA.md#The five refusal classes',
  'The pooled rate of the suite headline is the passing runs over the scored runs, never over every run.':
    'docs/running.md#Outcomes',
  'The process adapter diffs a workspace of 1,000 files exactly: created, changed and deleted.':
    'docs/adapters/process.md#How a block runs',
  'The process adapter snapshots only the workspace and records the sandbox isolation on every block.':
    'docs/adapters/process.md#Sandboxes',
  'The recompute rung runs the produced and the gold computation on the given and changed inputs (hard coded result).':
    'docs/reference/block-contracts.md#Recompute',
  'The recompute rung runs the produced and the gold computation on the given and changed inputs (off by one).':
    'docs/reference/block-contracts.md#Recompute',
  'The recompute rung runs the produced and the gold computation on the given and changed inputs (reordered formula).':
    'docs/reference/block-contracts.md#Recompute',
  'The recompute rung runs the produced and the gold computation on the given and changed inputs (rounded away).':
    'docs/reference/block-contracts.md#Recompute',
  'The recompute rung runs the produced and the gold computation on the given and changed inputs (same formula).':
    'docs/reference/block-contracts.md#Recompute',
  'The recompute rung runs the produced and the gold computation on the given and changed inputs (sum of range).':
    'docs/reference/block-contracts.md#Recompute',
  'The recompute rung runs the produced and the gold computation on the given and changed inputs (wrong operand).':
    'docs/reference/block-contracts.md#Recompute',
  'The reply check and the forbidden phrase check of one block are judged apart: one failing never skips, fails or passes the other.':
    'docs/reference/checks.md#Verdicts',
  'The reply check and the tool count check of one block are judged apart: one failing never skips, fails or passes the other.':
    'docs/reference/checks.md#Verdicts',
  'The root of a blocked block is the first failure, however deep the chain and wherever the failure sits.':
    'origin/feat/block-parents:docs/concepts/given-when-then.md#Parent blocks',
  'The run verdicts and the pass rate read exactly the turns a noisy agent broke.':
    'docs/running.md#Outcomes',
  'The runner hands a written prefix to the agent with its tool calls and outputs, in mode T.':
    'docs/running.md#The history',
  'The runner records a block as pass or fail from its gating verdicts alone, and a run fails on any failing block.':
    'docs/running.md#Outcomes',
  'The runner records not_run for a block its adapter cannot set up (a tool stub, a prefix): in mode T every other block still runs; in modes F and P the blocks after it are not_run too.':
    'docs/running.md#Outcomes',
  'The runner runs a spec with parent links as a forest, each child after its parent.':
    'origin/feat/block-parents:docs/concepts/given-when-then.md#Parent blocks',
  'The running Given merges world.tools by tool name from the block that sets them on.':
    'docs/running.md#Given resolution and the hash',
  "The same test played by another persona fails another block: each persona's run keeps its own failing block.":
    'docs/reference/block-contracts.md#Personas',
  "The simulated user plays a test from a persona's recorded answers, and the run reads the agent's verdict on each.":
    'docs/simulated-user.md#`driftbench simulate`',
  "The simulated user shows its model the conversation of the block's own ancestors in a parent-linked spec: their turns and the agent's replies, nothing of another branch.":
    'origin/feat/block-parents:docs/concepts/given-when-then.md#Parent blocks',
  'The state-diff rung compares the net workspace diff with the expected and allowed changes (allowed glob).':
    'docs/reference/block-contracts.md#Recompute',
  'The state-diff rung compares the net workspace diff with the expected and allowed changes (changed expected).':
    'docs/reference/block-contracts.md#Recompute',
  'The state-diff rung compares the net workspace diff with the expected and allowed changes (changed not created).':
    'docs/reference/block-contracts.md#Recompute',
  'The state-diff rung compares the net workspace diff with the expected and allowed changes (exact).':
    'docs/reference/block-contracts.md#Recompute',
  'The state-diff rung compares the net workspace diff with the expected and allowed changes (extra file).':
    'docs/reference/block-contracts.md#Recompute',
  'The state-diff rung compares the net workspace diff with the expected and allowed changes (many files one extra).':
    'docs/reference/block-contracts.md#Recompute',
  'The state-diff rung compares the net workspace diff with the expected and allowed changes (missing file).':
    'docs/reference/block-contracts.md#Recompute',
  'The stray file check and the command limit check of one block are judged apart: one failing never skips, fails or passes the other.':
    'docs/reference/checks.md#Verdicts',
  'The stray file check and the exit code check of one block are judged apart: one failing never skips, fails or passes the other.':
    'docs/reference/checks.md#Verdicts',
  'The suite headline groups runs by golden and reads n_eff from the spread of the golden rates.':
    'docs/concepts/statistics.md#A rate over goldens',
  'The suite headline matches the example of docs/concepts/statistics.md.':
    'docs/concepts/statistics.md#The suite headline',
  'The suite headline weighs every golden the same, whatever its repeats.':
    'docs/concepts/statistics.md#The suite headline',
  'The tool count check and the forbidden phrase check of one block are judged apart: one failing never skips, fails or passes the other.':
    'docs/reference/checks.md#Verdicts',
  'The wilson effective interval accounts for the spread between goldens, so it covers the planted rate.':
    'docs/concepts/statistics.md#The suite headline',
  'The workspace check fails exactly the expectation an unexpected, missing or deleted change breaks.':
    'docs/reference/checks.md#Workspace',
  'The workspace diff lists the net change: created, changed and deleted, and never a file rewritten with the same bytes.':
    'docs/reference/checks.md#Workspace',
  'Two artifact expectations on one path get their own verdict ids (path, then path#2) and are judged apart.':
    'docs/reference/checks.md#Verdicts',
  'Verdict.by names the block layer and the tailored object for an item that block uses changes.':
    'docs/reference/block-contracts.md#Verdict',
  'Verdict.by names the spec layer and the tailored object for an item that spec uses changes.':
    'docs/reference/block-contracts.md#Verdict',
  'Verdict.by of a code block names the block layer for an item that block uses changes.':
    'docs/reference/block-contracts.md#Verdict',
  'Verdict.by of a code block names the spec layer for an item that spec uses changes.':
    'docs/reference/block-contracts.md#Verdict',
  'a bare value in a tool input assertion means exact equality':
    'docs/reference/checks.md#Assertions on values',
  'a block passes only when every gating verdict on it passes': 'docs/running.md#One block',
  'a block that expects a stage fails when it reports another, and stage_reported: true fails a block that reports none even when an earlier block reported one':
    'docs/reference/checks.md#Stage and facts',
  'a block whose Given the adapter cannot apply is not_run, and in free-running mode the later blocks are not_run as well':
    'docs/running.md#Outcomes',
  'a block whose spec has no metadata.generated, no estate atoms and no metadata.depends is unknown and in every radius (reason unknown-deps)':
    'docs/concepts/blast-radius.md#Unknown means in',
  'a block with no id is shown as "block <index>" counting from 0':
    'docs/concepts/blast-radius.md#The command',
  'a block with nothing before it in mode T starts from its own user message only':
    'docs/concepts/run-modes.md#Teacher-forced',
  'a block with two stimuli, none, or a burst of one message is refused; a burst of two and a single user load':
    'docs/reference/cli.md#Issue codes',
  'a change no block declares makes the radius the whole suite, a criterion no block names included':
    'docs/concepts/blast-radius.md#Unknown means in',
  'a change the radius cannot map makes the radius the whole suite: whole is set and the exit is 1':
    'docs/concepts/blast-radius.md#The command',
  'a child prefix includes the parent actual reply and tool calls with the recorded results':
    'origin/feat/block-parents:docs/concepts/given-when-then.md#Parent blocks',
  'a compare mode outside the documented ones is refused by the loader; auto, a named mode and a mode by argument name load':
    'origin/feat/block-v1-value-ladder:docs/reference/spec.md#CompareMode',
  'a contains assertion on a tool input holds when the text appears anywhere in the value':
    'docs/reference/checks.md#Assertions on values',
  'a criterion change selects blocks whose expect.criteria name the criterion; the @gating suffix is not part of the name':
    'docs/concepts/blast-radius.md#A change',
  'a deviation change D1 selects the blocks that carry the class D1_<anything>, never D10, D11 or D12':
    'docs/concepts/blast-radius.md#A change',
  'a failing block does not stop later blocks from being run and judged in free-running mode':
    'docs/concepts/run-modes.md#Free-running',
  'a file under driftbench/ must sit at driftbench/<kind>/<id>.yaml':
    'origin/feat/block-f3-object-commands:docs/reference/cli.md#Issue codes',
  'a fixture change selects blocks whose When, expected tool inputs, Given or end state hold the literal text':
    'docs/concepts/blast-radius.md#A change',
  'a nonempty assertion on a tool input fails an empty string':
    'docs/reference/checks.md#Assertions on values',
  'a number, boolean, list, null or absent value that differs from the expected one fails: it has one writing':
    'docs/reference/block-contracts.md#Steps',
  'a one_of assertion on a tool input holds for any listed value and for no other':
    'docs/reference/checks.md#Assertions on values',
  'a passed parent runs once per run, however many children share it':
    'origin/feat/block-parents:docs/concepts/given-when-then.md#Parent blocks',
  'a perturbation that writes user is a block of its own, sent before block inject_at, so the run has one block more than the spec':
    'docs/concepts/recovery.md#Writing a perturbation',
  'a regex assertion on a tool input is a regular expression over the whole text, not a literal':
    'docs/reference/checks.md#Assertions on values',
  'a rule change with a spec rule name selects the blocks of the specs whose rules carry it':
    'docs/concepts/blast-radius.md#A change',
  'a stage change selects the blocks that expect the stage; in mode F every block after the first direct one is forward, in mode T none is':
    'docs/concepts/blast-radius.md#A change',
  'a subset assertion on a tool input holds when at least those keys carry those values':
    'docs/reference/checks.md#Assertions on values',
  'a tool change with part description selects the blocks the documentation lists for that part and no other':
    'docs/concepts/blast-radius.md#A change',
  'a tool change with part input selects the blocks the documentation lists for that part and no other':
    'docs/concepts/blast-radius.md#A change',
  'a tool change with part none selects the blocks the documentation lists for that part and no other':
    'docs/concepts/blast-radius.md#A change',
  'a tool change with part presence selects the blocks the documentation lists for that part and no other':
    'docs/concepts/blast-radius.md#A change',
  'a tool change with part result selects the blocks the documentation lists for that part and no other':
    'docs/concepts/blast-radius.md#A change',
  'a tool count of the form { min, max } passes from min to max calls inclusive and fails below min and above max':
    'docs/reference/checks.md#Tools',
  'a tool count { min } has no upper bound and a count { max } has no lower bound':
    'docs/reference/checks.md#Tools, skills, guards, references and subagents',
  'a tool expectation with a number count passes with exactly that many calls and fails with fewer or more':
    'docs/reference/checks.md#Tools, skills, guards, references and subagents',
  'a tool expectation with no count passes with one call or more and fails with none':
    'docs/reference/checks.md#Tools, skills, guards, references and subagents',
  'a tool expected 0 times fails the block when called, with a forbidden.<label> verdict and no tools.<label>.count verdict':
    'docs/reference/checks.md#Tools, skills, guards, references and subagents',
  'a value no ladder item settles is compared exactly; the evidence says exact_fallback and a non-gating tools.<label>.input.<field>.no_decider lint names what would settle it':
    'docs/reference/block-contracts.md#Steps',
  'a world-only perturbation sends block inject_at own stimulus with the perturbation world; the run has as many blocks as the spec':
    'docs/concepts/recovery.md#Writing a perturbation',
  'an absent assertion on a tool input holds only when the argument is not there':
    'docs/reference/checks.md#Assertions on values',
  'an enabled item needs an implementation from driftbench or a plugin; a disabled item needs none':
    'docs/reference/block-contracts.md#Items',
  'an exact assertion on a tool input equals the whole JSON value whatever the order of its keys':
    'docs/reference/checks.md#Assertions on values',
  'an extends cycle is refused; a chain of objects that ends in a root loads':
    'origin/feat/block-f3-object-commands:docs/reference/cli.md#Issue codes',
  'an input assertion of a tool expectation is checked on every call of that tool in the block':
    'docs/reference/checks.md#Tools, skills, guards, references and subagents',
  'an input assertion on a tool that was never called fails its verdict':
    'docs/reference/checks.md#Tools, skills, guards, references and subagents',
  'an object file uses order or item moves, and one item moves with before or after, not both':
    'docs/reference/block-contracts.md#Item moves',
  'an object that extends another refuses an operation on an item id the parent does not hold (validate exits 1, "unknown item"), and loads one on a held item':
    'docs/reference/block-contracts.md#Items',
  'an unknown key is an error in the spec, a block, an expect, a tool expectation and a given':
    'docs/reference/spec.md#Spec reference',
  'attributionOf counts runs with a block not run in neither rate.':
    'docs/reference/block-contracts.md#attributionOf',
  'attributionOf keeps the campaign fix plan in its ranked order.':
    'docs/reference/block-contracts.md#attributionOf',
  'attributionOf leaves a run whose failure no rule attributed out of the agent rate and counts it as unassigned.':
    'docs/reference/block-contracts.md#attributionOf',
  'attributionOf names every non-default object once, sorted, as kind:id@hash.':
    'docs/reference/block-contracts.md#attributionOf',
  'attributionOf passes a run for the agent when every failing verdict is set aside, and fails it on any agent failure.':
    'docs/reference/block-contracts.md#attributionOf',
  'block given.vars merge into the running variables by name, the later value winning':
    'docs/running.md#Given resolution and the hash',
  'blocked.by names the direct parent and blocked.root names the original failed or unrun cause':
    'origin/feat/block-parents:docs/concepts/given-when-then.md#Parent blocks',
  'buildScorecard counts each golden once when every end state agrees.':
    'docs/concepts/statistics.md#A rate over goldens',
  'buildScorecard rates the end states over goldens, the runs of one golden being repeats.':
    'docs/concepts/statistics.md#A rate over goldens',
  'campaign run exits 0 by the gate rule on its cells.': 'docs/running.md#Exit codes',
  'campaign run exits 1 by the gate rule on its cells.': 'docs/running.md#Exit codes',
  'campaign run exits 3 when no cell fails and a cell is not run.':
    'docs/reference/cli.md#Campaigns and smoke',
  'compare: { exact: <reason> } passes only on the exact value and the reason is printed in the evidence':
    'docs/reference/block-contracts.md#Exact by declaration',
  'countRuns tallies every run by runOutcome.': 'docs/running.md#Outcomes',
  'driftbench object diff exits as docs/reference/cli.md documents.':
    'origin/feat/block-f3-object-commands:docs/reference/cli.md#`driftbench object`',
  'driftbench object explain exits as docs/reference/cli.md documents.':
    'origin/feat/block-f3-object-commands:docs/reference/cli.md#`driftbench object`',
  'driftbench object graph exits as docs/reference/cli.md documents.':
    'origin/feat/block-f3-object-commands:docs/reference/cli.md#`driftbench object`',
  'driftbench object init exits as docs/reference/cli.md documents.':
    'origin/feat/block-f3-object-commands:docs/reference/cli.md#`driftbench object`',
  'driftbench object list exits as docs/reference/cli.md documents.':
    'origin/feat/block-f3-object-commands:docs/reference/cli.md#`driftbench object`',
  'driftbench object show exits as docs/reference/cli.md documents.':
    'origin/feat/block-f3-object-commands:docs/reference/cli.md#`driftbench object`',
  'driftbench object validate exits as docs/reference/cli.md documents.':
    'origin/feat/block-f3-object-commands:docs/reference/cli.md#`driftbench object`',
  'driftbench radius exits 0 on a radius smaller than the suite.':
    'docs/reference/cli.md#`driftbench radius`',
  'driftbench radius exits 1 on the whole suite.': 'docs/reference/cli.md#`driftbench radius`',
  'driftbench radius exits 2 on bad input.': 'docs/reference/cli.md#`driftbench radius`',
  'each block of a run carries its own verdict: a block passes when every gating verdict on it passes':
    'docs/running.md#One block',
  'each entry of expect.must gets its own verdict must.<index> and the block fails when any one fails':
    'docs/reference/checks.md#Every check and its verdict ids',
  'end_state expect fields take the assertion forms (regex, one_of, nonempty, absent) like a tool input':
    'docs/reference/checks.md#Assertions on values',
  'end_state mode subset compares only the listed fields and mode exact also refuses a field the spec does not list':
    'docs/reference/checks.md#End state',
  'end_state: none fails when a payload was recorded, and a mapping on a source that recorded nothing does not match':
    'docs/running.md#End state',
  'evaluateAggregates gives a rate criterion the Wilson interval on the effective runs over goldens.':
    'docs/aggregates.md#Interval and planning',
  'evaluateAggregates keeps the plain Wilson interval when the runs are independent evidence.':
    'docs/aggregates.md#Interval and planning',
  'exit_code reads the agent process whenever it exited non-zero, a negative code included.':
    'docs/reference/checks.md#Execution',
  'expect.exact ignores case, surrounding space and punctuation and needs the whole reply; exact_strict compares trimmed bytes':
    'docs/reference/checks.md#Text and language',
  'expect.json requires a valid JSON reply (embedded: true allows JSON among prose) and checks its dotted paths':
    'docs/reference/spec.md#JsonExpect',
  'expect.length counts characters as code points, and min and max are inclusive bounds':
    'docs/reference/checks.md#Text and language',
  'expect.must ignores case by default, rules.match_case makes it case-sensitive, and expect.regex is always case-sensitive':
    'docs/reference/checks.md#Rules for the whole spec',
  'expect.must patterns are regular expressions over the visible text':
    'docs/reference/checks.md#Text and language',
  'expect.must_not fails the block when the visible text matches the pattern':
    'docs/reference/checks.md#Text and language',
  'expect.stage and recovery.stage_after must name one of the spec stages':
    'docs/reference/cli.md#Issue codes',
  'expect.starts_with passes when the reply, without leading space, starts with the text, and not when it only contains it':
    'docs/reference/checks.md#Text and language',
  'for in_order, a tool with count n stands for at least n calls in its place of the order':
    'docs/reference/checks.md#Tools, skills, guards, references and subagents',
  'given.origin enters the Given hash only when present, so results with different origins are never pooled':
    'docs/concepts/given-when-then.md#Tool history: records, not prose',
  'given.world.tools sets a forced result or error from the block where it is set onwards, for any error text':
    'docs/concepts/given-when-then.md#Given',
  'hierarchicalBetaBinomial keeps its documented property: bounds hold the posterior mean.':
    'docs/concepts/statistics.md#The suite headline',
  'hierarchicalBetaBinomial keeps its documented property: deterministic and ordered.':
    'docs/concepts/statistics.md#The suite headline',
  'hierarchicalBetaBinomial keeps its documented property: disagreement widens.':
    'docs/concepts/statistics.md#The suite headline',
  'hierarchicalBetaBinomial keeps its documented property: equal weights.':
    'docs/concepts/statistics.md#The suite headline',
  'hierarchicalBetaBinomial keeps its documented property: tree mean.':
    'docs/concepts/statistics.md#The suite headline',
  'if a parent fails, the child is blocked: it receives no agent call and adds no failure; independent roots continue':
    'origin/feat/block-parents:docs/concepts/given-when-then.md#Parent blocks',
  'if a parent is not_run, the child is blocked and blocked.root names the unrun cause':
    'origin/feat/block-parents:docs/concepts/given-when-then.md#Parent blocks',
  'in a free-running run a block given.vars reach that block and every later block, and no earlier one':
    'docs/concepts/given-when-then.md#Given',
  'in mode F the history before a block holds the agent replies of the earlier blocks, each tool call with its input and output':
    'docs/running.md#The history',
  'in mode T the history is the canonical prefix, never the agent own replies; the canonical assistant text is empty':
    'docs/concepts/run-modes.md#Teacher-forced',
  'in the canonical prefix a call carries the result or error given.world.tools forces for that tool, and none otherwise':
    'docs/concepts/run-modes.md#Teacher-forced',
  'input_closed leaves nested values to their own assertion, and with no input assertion only an empty object passes':
    'docs/reference/checks.md#Tools, skills, guards, references and subagents',
  'input_closed: true requires each call input to hold only the top-level keys listed in input, and false or absent leaves other keys allowed':
    'docs/reference/checks.md#Tools, skills, guards, references and subagents',
  'metadata.links and metadata.provenance stay out of the spec hash: a link added, promoted or refuted never changes it':
    'docs/concepts/blast-radius.md#Prompt sections and block links',
  'metadata.links is checked by spec validate: the shape, the relation, the status and created_by lists, and the block they name':
    'docs/reference/block-contracts.md#Section registry and localize',
  'metadata.links stays out of the spec hash and the run identity.':
    'docs/concepts/blast-radius.md#Prompt sections and block links',
  'object diff exits 1 when the objects differ and 0 when they do not; object show exits 2 on an unknown object':
    'origin/feat/block-f3-object-commands:docs/reference/cli.md#`driftbench object`',
  'once a spec declares a parent link, each root starts at the spec defaults and a child inherits only its ancestors':
    'origin/feat/block-parents:docs/concepts/given-when-then.md#Parent blocks',
  'once a spec declares a parent link, its blocks form a forest in every mode, a child starting from its parent recorded conversation':
    'origin/feat/block-parents:docs/concepts/given-when-then.md#Parent blocks',
  'pass^k is C(c, k) / C(n, k), the probability that k runs drawn from the n all pass, and pass@k is 1 - C(n - c, k) / C(n, k)':
    'docs/concepts/statistics.md#Repeats',
  'radius localize drops a failure inherited from an earlier failing block of the same run (H5).':
    'docs/concepts/blast-radius.md#Localisation over sections',
  'radius localize exits 1 when nothing failed outside inherited failures.':
    'docs/reference/cli.md#Prompt change manifests',
  'radius localize leaves refuted links out of the Ochiai counts.':
    'docs/reference/block-contracts.md#Section registry and localize',
  'radius localize ranks local sections by Ochiai over the linked blocks of the stored runs.':
    'docs/concepts/blast-radius.md#Localisation over sections',
  'radius sections check exits 0 when the registry matches the prompt and 1 when a hash, span or anchor no longer matches':
    'docs/reference/cli.md#Prompt change manifests',
  'radius sections check exits 2 for an invalid registry: an id used twice, a reference to an unknown section':
    'docs/reference/block-contracts.md#Section registry and localize',
  'radius sections check keeps every section of an unchanged prompt.':
    'docs/reference/block-contracts.md#Section registry and localize',
  'radius sections check stays linear in the prompt size: 1500 ms of CPU at 200 sections.':
    'docs/validators.md#13.1 Scale budgets',
  'radius sections init finds a unique anchor quote in time linear in the section: a body that repeats one line costs no more than any other text.':
    'docs/reference/block-contracts.md#Headings and ids',
  'radius sections init gives every section an id no other section holds: a repeat suffix never takes the slug of another heading.':
    'docs/reference/block-contracts.md#Headings and ids',
  "radius sections init leaves an ATX heading's closing # sequence out of the section title.":
    'docs/reference/block-contracts.md#Headings and ids',
  'radius sections init makes one section per heading of level 1 to --level (default 2), the text before the first heading is the section preamble, ids are the slugged titles':
    'docs/reference/block-contracts.md#Section registry and localize',
  'radius sections init reads a line inside a fenced code block as code: it never starts a section.':
    'docs/reference/block-contracts.md#Headings and ids',
  'radius sections init reads a setext heading (a line of = or - under text) as a heading of level 1 or 2.':
    'docs/reference/block-contracts.md#Headings and ids',
  'radius sections init reads an ATX heading indented by one to three spaces as a heading; four spaces is code.':
    'docs/reference/block-contracts.md#Headings and ids',
  'radius sections init stays linear in the prompt size: 1500 ms of CPU at 200 sections.':
    'docs/validators.md#13.1 Scale budgets',
  'radius sections init writes one registry section per heading, and check accepts the prompt it came from.':
    'docs/reference/cli.md#Prompt change manifests',
  'radius sections reanchor keeps every section of an unchanged prompt.':
    'docs/reference/cli.md#Prompt change manifests',
  'radius sections reanchor reports sections that changed order.':
    'docs/reference/cli.md#Prompt change manifests',
  'radius sections reanchor reports text changed outside every section.':
    'docs/concepts/blast-radius.md#Prompt sections and block links',
  'radius sections reanchor stays linear in the prompt size: 3000 ms of CPU at 200 sections.':
    'docs/validators.md#13.1 Scale budgets',
  'radiusOf selects every block of a task spec whose seeded workspace holds the changed file.':
    'docs/concepts/blast-radius.md#A change',
  'radiusOf selects the code blocks that expect the changed criterion.':
    'docs/concepts/blast-radius.md#A change',
  'radiusOf selects the code blocks that expect the changed stage.': 'docs/concepts/blast-radius.md#A change',
  'radiusOf selects the direct blocks of a criterion change by the documented table.':
    'docs/concepts/blast-radius.md#A change',
  'radiusOf selects the direct blocks of a rule forbidden_tools change by the documented table.':
    'docs/concepts/blast-radius.md#A change',
  'radiusOf selects the direct blocks of a rule max_calls change by the documented table.':
    'docs/concepts/blast-radius.md#A change',
  'radiusOf selects the direct blocks of a stage change by the documented table.':
    'docs/concepts/blast-radius.md#A change',
  'radiusOf selects the direct blocks of a tool any part change by the documented table.':
    'docs/concepts/blast-radius.md#A change',
  'radiusOf selects the direct blocks of a tool description change by the documented table.':
    'docs/concepts/blast-radius.md#A change',
  'radiusOf selects the direct blocks of a tool input change by the documented table.':
    'docs/concepts/blast-radius.md#A change',
  'radiusOf selects the direct blocks of a tool result change by the documented table.':
    'docs/concepts/blast-radius.md#A change',
  'radiusOf stays exact and linear on 1000 blocks: 400 ms of CPU.': 'docs/validators.md#13.1 Scale budgets',
  'radiusOf stays exact and linear on 2500 blocks: 1000 ms of CPU.': 'docs/validators.md#13.1 Scale budgets',
  'radiusOf stays exact and linear on 5000 blocks: 2000 ms of CPU.': 'docs/validators.md#13.1 Scale budgets',
  'reanchor exits 2 when the registry does not describe the old prompt (text_sha256 differs)':
    'docs/reference/block-contracts.md#Section registry and localize',
  'reanchor: a section is only placed where its text hashes as before; an edit inside makes it stale; the others keep their ids, earlier ones kept, later ones moved':
    'docs/reference/block-contracts.md#Section registry and localize',
  'reanchor: exit 1 when sections changed order; a section found by the same hash is never stale':
    'docs/reference/cli.md#Prompt change manifests',
  'reanchor: spans are compared in the new text; an edit that keeps the length leaves every other section at its span (kept)':
    'docs/reference/block-contracts.md#Section registry and localize',
  'reanchor: the same text found once keeps its section; exit 0 when every section was found again in order':
    'docs/reference/block-contracts.md#Section registry and localize',
  'repeatsForFloor solves the half-width z sqrt(f variance / (r blocks)) for the repeats r, with f 2 for a difference between two versions (the default) and 1 otherwise':
    'docs/concepts/statistics.md#Where results vary',
  'rules.max_calls limits the calls of a tool across the whole run and rules.forbidden_tools lets none through':
    'docs/reference/checks.md#Rules on tools',
  'runOutcome reads a run with a block not run and a block blocked as not_run, the order its rule states.':
    'docs/running.md#Outcomes',
  'rung2_contract: a value that breaks the field pattern, enum or const in metadata.tool_schemas fails and the evidence names the item':
    'docs/reference/block-contracts.md#Steps',
  'rung2b_as_given: the expected writing appears as a whole token in what the user wrote and the agent wrote something else: fail':
    'docs/reference/block-contracts.md#Steps',
  'spec lint leaves out a fact that a recorded call holds, the user said, or no whole word states (inside-a-longer-word).':
    'docs/concepts/given-when-then.md#Tool history: records',
  'spec lint leaves out a fact that a recorded call holds, the user said, or no whole word states (recorded-before).':
    'docs/concepts/given-when-then.md#Tool history: records',
  'spec lint leaves out a fact that a recorded call holds, the user said, or no whole word states (recorded-same-message).':
    'docs/concepts/given-when-then.md#Tool history: records',
  'spec lint leaves out a fact that a recorded call holds, the user said, or no whole word states (user-said-before).':
    'docs/concepts/given-when-then.md#Tool history: records',
  'spec lint warns PREFIX_PROSE_HISTORY on an assistant message stating a ledger fact no recorded call holds and the user never said.':
    'docs/reference/cli.md#Issue codes',
  'spec validate refuses a link to a block the spec does not hold (LINK_BLOCK_UNKNOWN).':
    'docs/reference/cli.md#Issue codes',
  'the P forward rule starts the forward blocks after the first direct block (or at the inject_at of a perturbation the change reaches)':
    'docs/concepts/blast-radius.md#The radius',
  'the arguments of a canonical call are only the input fields the spec pins to an exact value; a regex or contains pin is left out':
    'docs/concepts/run-modes.md#Teacher-forced',
  'the assertion forms other than a bare value, exact and subset compare as written: no ladder, no lint':
    'docs/reference/block-contracts.md#Steps',
  'the cache key holds the spec hash, the whole resolved Given, the target and, when supplied, the agent version; any change is a miss and no change is a hit':
    'docs/running.md#The cache and replay',
  'the cache key is the content hash of the spec, never the free version label: a spec that differs only in version replays from the cache':
    'docs/running.md#The cache and replay',
  'the canonical Given of block k merges the spec given and each block given up to and including block k':
    'docs/concepts/run-modes.md#Teacher-forced',
  'the canonical assistant message of a teacher-forced prefix carries each expected call as many times as its count asks: its min for a range, once with no count, none for count 0':
    'docs/concepts/run-modes.md#Teacher-forced',
  'the canonical prefix of block k starts at the latest given.prefix written up to k, then the blocks from there to k-1':
    'docs/concepts/run-modes.md#Teacher-forced',
  'the change manifest is strict: an unknown key at any level, a bad part or a missing version is exit 2 and no radius':
    'docs/concepts/blast-radius.md#The command',
  'the child own given.prefix replaces the inherited conversation':
    'origin/feat/block-parents:docs/concepts/given-when-then.md#Parent blocks',
  'the cluster bootstrap with a fixed number of draws grows linearly in its values: CPU time at 10 and 100 times the base input stays within 4 x the multiple x the base time (docs/validators.md section 13.1).':
    'docs/validators.md#13.1 Scale budgets',
  'the design effect of clusters of size m is 1 + (m - 1) rho and the effective sample size is n divided by it':
    'docs/concepts/statistics.md#Where results vary',
  'the givenHash is the first 12 hex of the SHA-256 of the canonical JSON of the resolved Given: key order does not matter, content does':
    'docs/running.md#Given resolution and the hash',
  'the hash is the first 8 hex of the SHA-256 of the resolved content: same items and values, same hash whatever the id; a change moves it':
    'docs/reference/block-contracts.md#Content hash',
  'the hierarchical interval over trees grows linearly in its trees: CPU time at 10 and 100 times the base input stays within 4 x the multiple x the base time (docs/validators.md section 13.1).':
    'docs/validators.md#13.1 Scale budgets',
  'the history appends one user message for each message of a burst, in the order written':
    'docs/running.md#The history',
  'the loader on a conversation spec grows linearly in its blocks: CPU time at 10 and 100 times the base input stays within 4 x the multiple x the base time (docs/validators.md section 13.1).':
    'docs/validators.md#13.1 Scale budgets',
  'the loader on a task spec that seeds a workspace grows linearly in its blocks and workspace files: CPU time at 10 and 100 times the base input stays within 4 x the multiple x the base time (docs/validators.md section 13.1).':
    'docs/validators.md#13.1 Scale budgets',
  'the loader rewrites the shorthand forms before it validates: the resolved spec equals the long form':
    'docs/concepts/block.md#A spec is checked before it runs',
  'the pass rate over clusters with the design effect grows linearly in its clusters: CPU time at 10 and 100 times the base input stays within 4 x the multiple x the base time (docs/validators.md section 13.1).':
    'docs/validators.md#13.1 Scale budgets',
  'the personal-data scan of a reply with no address in it grows linearly in its characters: CPU time at 10 and 100 times the base input stays within 4 x the multiple x the base time (docs/validators.md section 13.1).':
    'docs/validators.md#13.1 Scale budgets',
  'the runner in mode F grows linearly in its blocks: CPU time at 10 and 100 times the base input stays within 4 x the multiple x the base time (docs/validators.md section 13.1).':
    'docs/validators.md#13.1 Scale budgets',
  'the runner in mode T grows linearly in its blocks: CPU time at 10 and 100 times the base input stays within 4 x the multiple x the base time (docs/validators.md section 13.1).':
    'docs/validators.md#13.1 Scale budgets',
  'the runner orders dependencies before children, including forward references':
    'origin/feat/block-parents:docs/concepts/given-when-then.md#Parent blocks',
  'the spec hash grows linearly in its blocks: CPU time at 10 and 100 times the base input stays within 4 x the multiple x the base time (docs/validators.md section 13.1).':
    'docs/validators.md#13.1 Scale budgets',
  'the suite headline grows linearly in its runs: CPU time at 10 and 100 times the base input stays within 4 x the multiple x the base time (docs/validators.md section 13.1).':
    'docs/validators.md#13.1 Scale budgets',
  'the workspace diff of two snapshots grows linearly in its files: CPU time at 10 and 100 times the base input stays within 4 x the multiple x the base time (docs/validators.md section 13.1).':
    'docs/validators.md#13.1 Scale budgets',
  'tool_order any_order follows its documented rule: the expected calls appear in any order':
    'docs/reference/checks.md#Tools, skills, guards, references and subagents',
  'tool_order exact follows its documented rule: the calls are the expected runs in order with none left over':
    'docs/reference/checks.md#Tools, skills, guards, references and subagents',
  'tool_order in_order follows its documented rule: the expected calls appear in order, other calls may sit between':
    'docs/reference/checks.md#Tools, skills, guards, references and subagents',
  'totals.<mode> reports in (direct plus forward), direct, forward, out, total, cells and sent consistently with the block states':
    'docs/concepts/blast-radius.md#The command',
  'uses is part of the spec hash and is left out of the block cache key.':
    'docs/reference/block-contracts.md#Uses and the hashes',
  'uses is resolved weakest first with a stronger layer winning: suite, spec, block, command line':
    'docs/reference/block-contracts.md#Content hash',
  'wilson(k, n, z) is the Wilson score interval for k successes in n with z the two-sided 95 percent value by default':
    'docs/concepts/statistics.md#Intervals',
  'wilsonEffective computes n_eff from the cluster-robust variance and the t quantile.':
    'docs/concepts/statistics.md#A rate over goldens',
  'wilsonEffective computes n_eff from the cluster-robust variance and the z quantile.':
    'docs/concepts/statistics.md#Intervals',
  'wilsonEffective counts each cluster once when every block agrees.':
    'docs/concepts/statistics.md#Intervals',
  'with from equal to to and no change the radius is empty; with different versions and no change it is the whole suite':
    'docs/concepts/blast-radius.md#Unknown means in',
  'world and variables are copied, so siblings cannot change each other start':
    'origin/feat/block-parents:docs/concepts/given-when-then.md#Parent blocks',
  'zeroFailureBound(p, alpha) is the number of failure-free runs needed to claim a failure rate below p at confidence 1 - alpha':
    'docs/concepts/statistics.md#Intervals',
};
