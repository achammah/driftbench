# driftbench docs

![driftbench, an agent evaluation framework by Nexus: every exchange is a unit test, every number carries an interval, drift and recovery measured block by block.](../.github/readme/hero-light.webp)

driftbench evaluates AI agents block by block. A block is one exchange with a conversational agent, or one step of a task done by a code-interpreter agent. Each block is a unit test with a Given, a When and a Then, and a spec is a succession of blocks. Both kinds of block share one model: the same runner, checks, judges and statistics.

Every page says what exists today and what is not built yet, with the phase that delivers it when one is assigned.

## Concepts

* [Block](concepts/block.md): the unit of evaluation, the four runtime concepts (tools, skills, guards, stages), one conversation spec and one task spec.
* [Given, When, Then](concepts/given-when-then.md): the initial conditions, the stimulus and the expected result of a block.
* [Run modes](concepts/run-modes.md): teacher-forced, free-running and perturbed runs of the same spec.
* [Blast radius](concepts/blast-radius.md): which blocks a change to the agent can affect, so a fix reruns its radius and not the whole suite.
* [Drift](concepts/drift.md): the five drift classes, and the metrics across a succession of blocks.
* [Recovery](concepts/recovery.md): the twelve deviation classes, and how fast the agent comes back.
* [Script](concepts/script.md): writing a conversation spec in code, with the steps `user`, `agent`, `judge` and `injection`, and the steps that have no spec form.
* [Judges](concepts/judges.md): judged criteria, the judge council and calibration.
* [Statistics](concepts/statistics.md): repeats, intervals, paired tests and the parity verdict.

## Running

* [Retries](retries.md): the one retry policy of every model call (408, 429, 5xx and network errors, backoff with jitter, Retry-After), how to set it in a spec and on the command line, and where each retry is recorded.
* [Running](running.md): `runSpec`, campaigns in modes T, F and P (`campaign plan`, `campaign run`, `campaign status`, `campaign resume`), the determinism smoke test, the cache, the budget and the run record.
* [Simulated user](simulated-user.md): a persona played through the model port or a recording, `driftbench simulate` and `campaign run --driver simulated`.
* [CLI plugins](plugins.md): load your own adapters, checks and judges into the command line, from `driftbench.yaml` or `--plugin`.
* [Red-team plugins](redteam-plugins.md): 40 attack plugins, each with a generation template and a grader rubric.
* [Adaptive attacker](attack.md): red-team attacks picked from the agent's last replies, scored by the recovery record, `driftbench attack`.
* [Multi-turn red-team user](redteam-agent.md): an attacker with one objective over many turns, Crescendo or GOAT, scored each turn, stopping when the agent gives in.
* [Generating tests](generating.md): the map of situations and its relations, `extract` and its approval, `generate`, the validity gate and its funnel, task families, the variance pilot and intake.
* [Testing an estate](estate.md): how driftbench tests a code-interpreter agent as a whole estate (instructions, skills, subagents, guards, tools, settings): atoms, the estate graph, the plan, generated tests, replay over recorded sessions, maintenance.
* [Datasets and prompts](datasets.md): `import` specs from a CSV file or a spreadsheet through a mapping, and the registry of immutable dataset and prompt versions (`dataset`, `prompt`) that a campaign records.
* [Python](python.md): run specs from Python, typed results, a pytest plugin (`pytest --driftbench specs/`), and a Python function as the agent.
* [vitest](vitest.md): `describeSpec(path, target)`, one vitest test per block.
* [Campaign-level criteria](aggregates.md): one threshold over every run of a campaign, for example a pass rate; a library API, no command flag yet.
* [Production traces](traces.md): `driftbench import traces` drafts specs from OpenTelemetry, Nexus or Claude Code traces; `driftbench monitor --source traces` watches production for drift in time windows, with the measured delay and false alarms.
* [Releasing](releasing.md): the 0.1.0 packages, the release check and the tag-only release workflow.
* [Validators](validators.md): code that proves driftbench works: seven ladders (blocks, map, generator, judges, system, estate, statistics) and the executor loop that drives each to 100 percent.
* [Benchmark floors](benchmarks.md): the shipped default judge on immutable fictional slices, recorded responses, free replay, and regression floors in CI.

## Reference

* [Spec reference](reference/spec.md): every field of a spec, generated from the zod schemas.
* [Campaign configuration reference](reference/campaign.md): every field of the `campaign:` key in `driftbench.yaml`.
* [Task family reference](reference/family.md): every field of a task family file and its review file, generated from the zod schemas.
* [Map reference](reference/map.md): every field of a map proposal and of an approved map.
* [Interview reference](reference/interview.md): every field of the intake questionnaire.
* [Criteria and labels reference](reference/criteria.md): every field of a criterion file and of a label file.
* [Personas and red-team reference](reference/users.md): every field of a persona, a user recording, a red-team pack file and a red-team plugin.
* [Change manifest reference](reference/change.md): every field of a change manifest for `driftbench radius`.
* [Estate files reference](reference/estate-files.md): every field of an estate map, an estate plan, a phrase bank and a session index.
* [CLI](reference/cli.md): every `driftbench` command, its options, its output and its exit codes.
* [Public API](reference/api.md): what a package's public API is, the frozen list of its names, and how a name is added or removed.
* [Checks](reference/checks.md): every field of `expect`, the check that reads it, and its verdict ids.
* [Block contracts](reference/block-contracts.md): the contracts of the block redesign that are built on open pull requests and have no other reference yet.

## Adapters

* [Adapters](adapters/index.md): the contract between driftbench and the agent under test, and the suite every adapter passes.
* [function](adapters/function.md): an async function in the same process.
* [http](adapters/http.md): an endpoint that speaks JSON, answering with an Observed or an OpenAI-compatible chat completion.
* [nexus](adapters/nexus.md): an agent on the Nexus platform.
* [process](adapters/process.md): a code-interpreter agent run as a command in a sandbox.
* [openai-agents](adapters/openai-agents.md): an agent built with the OpenAI Agents SDK.
* [anthropic](adapters/anthropic.md): an agent loop on the Anthropic Messages API.
* [google](adapters/google.md): an agent on the Gemini API, through `@google/genai`.
* [langgraph](adapters/langgraph.md): a LangGraph graph.
* [crewai](adapters/crewai.md): a CrewAI crew, in a Python process or deployed on CrewAI AMP.
* [vercel-ai](adapters/vercel-ai.md): an agent run by the Vercel AI SDK's `generateText`.
* [pydantic-ai](adapters/pydantic-ai.md): a Pydantic AI agent in a Python process.
* [litellm](adapters/litellm.md): a model behind a LiteLLM proxy or any OpenAI-compatible endpoint.
* [Claude Code estates](adapters/claude-code.md): a Claude Code estate and its recorded sessions, read for the estate commands and `driftbench replay`.

## Example scorecards

* [Example scorecards](scorecards.md): the HTML scorecards `driftbench report` wrote from the Acme campaigns.
* [Viewer and hand labels](viewer.md): `driftbench view`, a local website over a store, where a person labels blocks for judge calibration.

## Comparison

* [Comparison](comparison.md): driftbench beside seven evaluation tools and six code-agent benchmarks, with a source and a read date for every cell.
* [Comparison pages](comparison/index.md): one page per evaluation tool, with the result, the basis and a reproduce line for every row.

## Research

* [Budget-bounded test generation for AI agent evaluation](research/budget-bounded-tests.md): a research draft describing the budget selector and its evaluation.

## What exists today

Phases 0, 1 and 2 are built, and most of phases 3 and G, with parts of phase 4 and the release:

* The spec format: zod schemas in `packages/core/src/schema`, with the TypeScript types inferred from them.
* The loader: YAML and JSON files, authoring shorthand, schema errors with their path, semantic checks, and lint advice.
* `driftbench spec validate`, `driftbench spec lint`, and `driftbench spec coverage` with the behaviour inventory it reads. See [CLI](reference/cli.md).
* The runner in modes T, F and P, with the scripted, perturbing and simulated drivers and the adaptive attacker, campaigns, a worker pool, a budget stop, the cache, resume, and the determinism smoke test, from code and from the command line. See [running](running.md) and [run modes](concepts/run-modes.md).
* Drift and recovery: the five drift classes, the ledger check, the stage classifier, the compounding index, and the recovery metrics of every perturbed run. See [drift](concepts/drift.md) and [recovery](concepts/recovery.md).
* The 23 machine checks, with their verdict ids, the judge check behind a council, and the artifact readers for workbooks, documents, decks, PDFs, CSV, JSON, text and code. See [checks](reference/checks.md).
* Judges in `@agent-nexus/driftbench-judges`: the judge clients, the council and its cascade, cassettes, calibration on fixture pairs and hand labels, and `driftbench judge`. See [judges](concepts/judges.md).
* The function, http, nexus and process adapters, the OpenAI Agents, Anthropic, Google and LangGraph adapters, the CrewAI, Vercel AI SDK, Pydantic AI and LiteLLM adapters, their contract suite, and the local and docker sandboxes. See [adapters](adapters/index.md).
* One retry policy for every model call, set in the spec target or on the command line, with every retry recorded. See [retries](retries.md).
* The SQLite store: campaigns, runs, the cache, cost units and a JSON export.
* The statistics library, `@agent-nexus/driftbench-stats`: intervals, the bootstrap, paired tests, false discovery control, power, the non-inferiority verdict, change detection, judge agreement, variance components and coverage estimators, each checked against Python reference values. See [statistics](concepts/statistics.md).
* Test generation: the map of situations with its relations, `driftbench extract` and its approval, the `space` commands, `driftbench generate`, the validity gate (`driftbench gate`), task families (`driftbench family`), the variance pilot (`driftbench pilot`) and intake (`driftbench intake`). See [generating tests](generating.md).
* Estates: `driftbench estate scan`, `lint`, `approve`, `map`, `plan`, `generate`, `diff` and `impact`, and `driftbench replay` over recorded sessions. See [testing an estate](estate.md).
* The validator frame, `driftbench validate`, with the judge and statistics ladders registered. See [validators](validators.md).
* A leak guard that refuses personal data in the repository, and CI.
* These docs, the generator of the spec reference, and a link checker.
* The Acme Telecom example in [`examples/acme`](../examples/acme/README.md): a deterministic agent with tools and no model, its conversation and task specs, a behaviour inventory, the map, the generated and gated suites, the criteria and labels, and a task family.

The command line reaches the Acme example agents (`function:acme-sales`, `process:acme-ops`, and the pilot's control agent `function:acme-random`) and recorded sessions; the other adapters are used from code.

Every command `driftbench --help` lists is built. Not built yet: the runtime battery, and the other items the [CLI reference](reference/cli.md#not-built-yet) lists.

## Roadmap

Each row names a command that shows the phase working on the bundled examples, with no model call. Run it from the repository root.

| Phase | Delivers | Status | Proof |
|---|---|---|---|
| 0, foundations | spec format, loader, `spec validate`, `spec lint`, `spec coverage`, leak guard, CI, synthetic example agent, docs | built | `pnpm driftbench spec validate examples/acme/specs` |
| 1, runner | runner in free-running mode with a scripted user; machine checks for text, language, personal data, tools, skills, guards, cards, end state, budget, execution, artifacts, workspace and safety; store, cache and resume; cost and latency per segment; sandbox workspace; artifact readers; function, http, nexus and process adapters | built | `pnpm driftbench campaign run examples/acme/specs --store <db>` |
| 2, judges | judge clients, the council and its cascade, calibration on fixture pairs and hand labels, judges for task artifacts | built | `pnpm driftbench judge calibrate --criteria examples/acme/criteria --labels examples/acme/labels --cassette examples/acme/criteria/calibration/cassette.json --out <file>` |
| 3, perturbation, drift and recovery | simulated user, perturbing driver with the twelve deviation classes, stage classifier and ledger check, drift classes, recovery metrics, teacher-forced mode; the same deviations on code-agent tasks | built | `pnpm driftbench perturb examples/acme/specs/conversations/plan-upgrade.yaml --class D2_goal_shift --at 2` |
| 4, statistics and gates | statistics functions with reference fixtures, the parity verdict, scorecard, run diff, JUnit output, CI gate, drift monitor, viewer, runtime battery | built but the runtime battery, which is not built | `pnpm driftbench ci --specs examples/acme/specs/conversations --target fault:x3-skips-recap --faults examples/acme/faults --baseline <campaign> --store <db> --margin 50` |
| G, the space of situations | the map of situations, its coverage and completeness, the map extractor, generation, the gate, task families, the variance pilot, intake, selection and the holdout | built | `pnpm driftbench select --cover examples/acme/map/space.yaml --specs examples/acme/gated --out <dir> --k 10` |
| E, estates | estate scan, lint, approval and map; the plan; test generation; replay; maintenance; the live runner and estate mutants | built; the unit runner is not built | `pnpm driftbench estate mutate examples/estates/fixture/approved.yaml --atom gate.standing.read-a-file-before-editing-it --delete --to <dir>` |
| V, validators | the validator frame and seven ladders | in progress: the frame, the judge ladder and the statistics ladder are built | `pnpm driftbench validate stats` |
| Release | SDK agent adapters, docs site, version 0.1.0 on npm | in progress: eight SDK adapters and the docs site are built; version 0.1.0 is prepared ([release workflow and check](releasing.md)) and not published | `pnpm build && node tools/release/check.mjs` |

There is no separate phase for code agents. A task spec runs through each phase with the conversation specs.

## Working on the docs

* `pnpm docs:reference` writes [the spec reference](reference/spec.md) and the reference page of every other file people write (family, campaign configuration, map, interview, criteria and labels, personas and red-team, change manifest, estate files) from the zod schemas. `pnpm docs:reference --check` exits 1 when a committed page is stale.
* `pnpm docs:links` checks that every relative link in `docs/` resolves and that every page is reachable from this one.
* `pnpm test` runs the tests of both tools, and checks the pages: every YAML example loads, no page has an em dash or an en dash, every issue and warning code is on the CLI page, names that belong to one runtime appear only under `docs/adapters`, and every comparison cell has a source and a read date.
* Pages use present tense and short sentences. A claim about a part that is not built says "planned, phase N". A number has a source, or it is left out. Command output on a page is what the command printed.
