<h1 align="center">driftbench</h1>

<p align="center"><b>Test your AI agent one exchange at a time, and know how far to trust the score.</b></p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/hero-dark.webp">
    <img src=".github/readme/hero-light.webp" alt="driftbench, an agent evaluation framework by Nexus. Every exchange is a unit test. Every number carries an interval; drift and recovery are measured, block by block. Beside the title, driftbench drawn as one machine, an indexing test line on a bench, with eight callouts. Test generation: a hopper fed from a prompt, a spec or past conversations. Validity gate: invalid blocks never run. Agent under test: chat or code, through one adapter. Machine checks: nine pins, and a fail is final. Judge council: fast and expert judges that earned their criteria. Drift and recovery: a chart pen leaves the line, then comes back. Pass rate and interval: a dial reads 0.38, between 0.14 and 0.69. CI gate: an arm that lifts only when the candidate is noninferior." width="100%" />
  </picture>
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> ·
  <a href="#what-makes-it-different">Why driftbench</a> ·
  <a href="#what-it-does">What it does</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#the-command-line">CLI</a> ·
  <a href="#adapters">Adapters</a> ·
  <a href="#benchmarks">Benchmarks</a> ·
  <a href="#how-it-compares">Comparison</a> ·
  <a href="docs/index.md">Docs</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@agent-nexus/driftbench"><img alt="npm version" src="https://img.shields.io/npm/v/%40agent-nexus%2Fdriftbench?color=2F5FD0&label=npm" /></a>
  <a href="LICENSE"><img alt="licence MIT" src="https://img.shields.io/badge/licence-MIT-2F5FD0?style=flat" /></a>
  <img alt="Node 22 or newer" src="https://img.shields.io/badge/node-22%2B-1B2A44?style=flat" />
  <a href="https://github.com/achammah/driftbench/actions/workflows/ci.yml"><img alt="CI status" src="https://github.com/achammah/driftbench/actions/workflows/ci.yml/badge.svg" /></a>
</p>

driftbench is an open-source evaluation framework for AI agents: chat agents, and agents that write code and files. You describe a conversation or a task as a list of **blocks**. A block is one user message, everything the agent does in reply, and what must be true afterwards. driftbench runs the blocks against your agent, checks each one, and reports every rate with its interval.

- **A failure has an address.** A failing run names the block, the check and the evidence, such as `block 1 forbidden.order.create`.
- **You are told when a score is noise.** Every rate carries a 95% interval, and the gate says how many test conversations your suite needs before it can show anything. Repeats of one conversation are not independent runs, so a rate over them is read through its design effect (Wilson on the effective sample), and the headline of a suite is the mean over conversations with a hierarchical interval. See [statistics](docs/concepts/statistics.md#the-suite-headline).
- **The tests are not written by hand.** Code generates them from a map of what the agent can face, and counts what they cover.
- **The evaluator is tested too.** driftbench checks its own scores on cases where the right answer is known.

Works with any agent through an [adapter](#adapters). No account, no server. MIT, TypeScript, Node 22 or newer.

<!-- readme-summary:start -->
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/summary-dark.png">
    <img alt="Judge accuracy on public benchmarks, Claude Haiku 5.5, scores out of 100, bars ranked within each benchmark, driftbench the only coloured bar and each competitor grey with its own pattern, with an axis break from 30 to 50. JudgeBench, 270 pairs: driftbench 88.9, DeepEval 86.3, LangWatch 83.7, promptfoo 83.0, Inspect 80.0, Langfuse 74.8. MM-Eval, 591 items: driftbench 88.9, promptfoo 86.5, DeepEval 84.1, LangWatch 83.9, Inspect 75.4, Langfuse 73.5. RubricBench, 1,580 games: driftbench 82.7, DeepEval 77.6, promptfoo 75.6, LangWatch 74.9, Inspect 26.6, Langfuse 25.1. verify, 221 items: Langfuse 75.1, driftbench 74.2, Inspect 73.3, LangWatch 73.3, promptfoo 71.9, DeepEval 58.8. writing, 346 games: driftbench 67.6, DeepEval 58.4, promptfoo 56.9, LangWatch 52.6, Langfuse 14.5, Inspect 11.6. Reader-first setting: 67.6 shown; default 61.3. Same score as a rule that always picks the longer reply (67.6)." src="docs/assets/summary-light.png" width="100%" />
  </picture>
</p>
<!-- readme-summary:end -->

## Quickstart

About two minutes, most of it the install. You need Node 22 or newer and npm. No API key: the agent below is a short script that stands in for yours.

**1. Make a folder and install.**

```bash
mkdir my-evals && cd my-evals
npm init -y
npm install @agent-nexus/driftbench
mkdir specs
```

**2. Create `agent.mjs`.** It reads the user message on standard input and prints the reply. Replace it with a call to your own agent later.

```js
// A stand-in for your agent: reads the user message on stdin, prints the reply.
import { readFileSync } from 'node:fs';

const message = readFileSync(0, 'utf8').trim();
const history = JSON.parse(readFileSync(process.env.DRIFTBENCH_HISTORY_FILE, 'utf8'));

if (/refund/i.test(message)) {
  console.log('I can help with a refund. What is your order number?');
} else if (/\bA-\d+\b/.test(message)) {
  console.log(`Refund started for order ${message.match(/A-\d+/)[0]}. You will get an email within 2 days.`);
} else {
  console.log(`Sorry, I did not get that. (${history.length} messages so far)`);
}
```

**3. Create `specs/refund.yaml`.** Two blocks: what the user says, and what the reply must and must not contain.

```yaml
id: refund-happy-path
title: A customer asks for a refund and gives an order number
target: { adapter: process, agent: my-agent }

blocks:
  - user: Hi, I would like a refund please.
    expect:
      must: ['order number']
      must_not: ['Refund started']

  - user: It is A-1042.
    expect:
      must: ['Refund started', 'A-1042']
      must_not: ['Sorry']
```

**4. Check the spec, then run it.**

```bash
npx driftbench spec validate specs
npx driftbench campaign run specs --target process:my-agent \
  --process-command "[\"node\",\"$PWD/agent.mjs\"]"
```

The output, trimmed to its verdict lines:

```
✓ specs/refund.yaml  refund-happy-path · 2 blocks · hash c985453f6be7
Checked 1 spec: 1 valid, 0 invalid, 0 warnings.

✓ refund-happy-path · process:my-agent · F · repeat 0  pass  2 blocks
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
```

**5. Break the agent and run again.** Change `Refund started for order` to `Started a return for` in `agent.mjs`. The run now exits 1 and names the block and the check:

```
✗ refund-happy-path · process:my-agent · F · repeat 0  fail  block 1 must.0
1 cell: 0 pass, 1 fail, 0 failed. Spent $0.00.
```

**6. Keep the runs and open the scorecard.** Add `--repeats 3 --store runs.db` to the run, then:

```bash
npx driftbench report --store runs.db --out scorecard.html
```

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/scorecard-dark.png">
    <img src="docs/assets/scorecard-light.png" alt="A driftbench scorecard, one HTML file, dark by default with a light theme. At the top, the candidate campaign against its baseline: 12 of 26 cases passing against 26 of 26 for the baseline, 36 of 78 runs passing, 14 of 26 cases regressed and none improved, McNemar p = 0.0001. Below, the two versions side by side, then three charts: cases passing by test, runs passing by mode (teacher-forced 57.1%, free-running 57.1%, perturbed 33.3%, each with its interval) and failed checks by type, led by tools (192) and must (162). Then the tests list: each test with its status, its score and one pass or fail pill per check family, the first one failing 0 of 4 cases." width="820" />
  </picture>
</p>
<p align="center"><sub>The scorecard of the example agents with a bug planted on purpose in each. Numbers and charts first, then every test, then every run: a click opens its conversation and its checks.</sub></p>

Next: [evaluate your own agent](#evaluate-your-own-agent), [add a judge](#add-a-judge), or [gate a pull request](#gate-a-pull-request). The full spec format is in the [spec reference](docs/reference/spec.md).

## What makes it different

Nine ideas lead. Each one changes what you learn when a test fails, and what it costs to find out.

### Tests written by code

<a href=".github/readme/gen-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/gen-dark.png">
    <img alt="A small example of tests written by code. Step 1, you list what can vary: language English or French, customer new or returning, payment card or transfer. Step 2, code picks 4 of the 8 combinations so that every two settings meet at least once. Step 3, the tests run against an agent with a hidden bug that only shows up for French plus transfer: test 3, French, new, transfer, catches it. Half the tests, every pair of settings still meets, and the bug is caught." src=".github/readme/gen-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub>The method is a covering array; numeric settings are spread with sliced Latin hypercube sampling.</sub></p>

- **What it is.** You list what your agent can face. Code, not a model, writes the tests, picking the fewest that still put every two settings together. You can also fix a budget of N tests.
- **What others do.** Test sets are rows you write, rows you import from traces, or cases a model writes for you, as DeepEval's synthesizer does (rows 2, 19 and 20 of our [comparison](docs/comparison.md)).
- **Why it matters.** You know what your tests cover, and a test is kept only if it catches a bug planted on purpose. You stop paying for tests that cannot catch anything.
- **Impact.** On our example agent, every pair of settings is covered with 5.8 times fewer tests than all the combinations. [How we measured](docs/comparison/methods.md#tests-written-by-code)

### Blocks: test each step and find the fix

<a href=".github/readme/blocks-diff-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/blocks-diff-dark.png">
    <img alt="A sales conversation, with a verdict on each step. Number, offer and details pass; recap and order fail; both closing steps pass. The recap block opens below. Given: the customer has chosen a plan. When: the customer says, That plan, please. Then: read the order back and wait for confirmation. Got: the agent placed the order. The parent is the details block, whose end state supplies the starting point. The persona is an impatient customer who gives short replies. Source links point to the prompt's recap section, the spec's confirmation clause and a past conversation turn. The deciding rule says no order call at this step. The verdict is fail, and the rule lives in a file the reader can change. This is an illustration; the note below lists the parts on their way." src=".github/readme/blocks-diff-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub>The order recap as a block, with its starting point, customer, sources and deciding rule. An illustration.</sub></p>

**Each step carries its starting point, expected result and source, so a failed test points to the rule and the place to fix.**

- **What it is.** A block is one step with its own starting point (Given), user turn (When) and expected result (Then). A simulated person, called a persona, can play it. A parent block can supply its starting point from that parent's end state. Links point to the prompt lines and spec clauses it tests, or the past conversation turn it came from. Every verdict names the rule that decided it, and you can change any rule in a file. The fault finder reads the evidence to name who is at fault and where to fix it. It leaves the check's verdict unchanged.
- **Why no other framework does it.** The seven tools we read score a whole scenario, test row, conversation, sample, dataset item or trace. See row 1 of our [comparison](docs/comparison.md#where-driftbench-is-ahead). A verdict per step needs each step to carry its own starting point and expected result. The block stores both.
- **Measured impact.** On the Acme sales assistant, dropping a coverage check fails 86 conversations containing 413 blocks. A conversation score marks all 413 blocks; driftbench marks the 86 that fail. For eight of nine planted faults, failing blocks account for 18 to 40 percent of the blocks in failed conversations. Sources: [gate-report.json](examples/acme/gated/gate-report.json) and [chart-facts.csv](docs/assets/data/chart-facts.csv). [How we measured](docs/comparison/methods.md#blocks-a-failure-you-can-diagnose). The [fault study](https://github.com/achammah/driftbench/pull/441) tests the suggested fix. Changing the tool description removed 86 coverage lookup failures in 249 runs; 29 exact assertion failures remained.

<sub>Counts cover 195 conversations and 861 blocks. The ninth fault, a wrong language, fails all 826 blocks in the 171 failed conversations. On its way: source links ([#423](https://github.com/achammah/driftbench/pull/423), [#429](https://github.com/achammah/driftbench/pull/429), [#433](https://github.com/achammah/driftbench/pull/433)); parent execution now ships (see [Parent blocks](#parent-blocks-share-the-start-and-count-the-cause-once)); its research is in [#416](https://github.com/achammah/driftbench/pull/416). Rule files and verdict stamps are on their way ([#443](https://github.com/achammah/driftbench/pull/443), [#449](https://github.com/achammah/driftbench/pull/449)). The fault finder is on its way ([#447](https://github.com/achammah/driftbench/pull/447), [#451](https://github.com/achammah/driftbench/pull/451), [#453](https://github.com/achammah/driftbench/pull/453)).</sub>

### Trace the source: find the line to inspect

<a href=".github/readme/block-sources-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/block-sources-dark.png">
    <img alt="A fictional Acme order test fails because the agent places an order without a recap. Arrows connect the failed block to three source excerpts. Prompt line 18 says, Place the order when the customer picks a plan. Skill file checkout.md line 8 says, Read the order back. Tool description order.create line 3 says, Creates the chosen order. The test checks spec clause 4, Wait for customer confirmation. A ranked list repeats each suspect's location and line text, with prompt line 18 first. The ranking is illustrative and does not establish the cause." src=".github/readme/block-sources-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub>A fictional Acme prompt, skill and tool description. The highlighted line is the first place to inspect.</sub></p>

**Follow a failed step to its source passage, with the leading suspects and their text beside the verdict.**

- **What it is.** You link a block to the prompt passage or spec clause it tests. Recorded file and line locations can also point to a skill rule or tool description. The report shows the location and quoted text when that evidence exists. The fault finder ranks likely fixes; the prompt ranking orders suspect sections from the blocks that pass and fail. A suspect is a place to inspect, not proof of the cause.
- **Why no other framework does it.** A trace records what the agent did. Tracing a failure to instructions also needs links from tests to their sources. Our [comparison](docs/comparison.md) covers test units and traces, but does not establish exclusivity for source diagnosis.
- **Measured impact.** In the [fault study](https://github.com/achammah/driftbench/pull/441), automatic evidence agreed with the reference classification on 182 of 182 runs. Changing the tool description reduced coverage lookup failures from 86 of 249 runs to 0; 29 exact assertion failures remained. The [prompt study](https://github.com/achammah/driftbench/pull/421) found 12 of 26 sections with no mutant that failed a test, exposing gaps to investigate.

<sub>Source tracing is on its way ([#423](https://github.com/achammah/driftbench/pull/423), [#429](https://github.com/achammah/driftbench/pull/429), [#433](https://github.com/achammah/driftbench/pull/433)). Fault finding is on its way ([#447](https://github.com/achammah/driftbench/pull/447), [#451](https://github.com/achammah/driftbench/pull/451), [#453](https://github.com/achammah/driftbench/pull/453)). Prompt ranking operates on sections; other file locations need recorded provenance. The figure illustrates the intended combined view. The reference classification was scripted and hand checked; it was not an independent human study. The registered ranking method failed its comparison, so these results do not establish ranking accuracy.</sub>

### Personas: play one test as different customers

<a href=".github/readme/block-personas-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/block-personas-dark.png">
    <img alt="One recap test runs with terse, chatty and pushy customers. Illustrative turns contain 3, 9 and 5 words. H10 measured short turns at 38.2% for humans, 38.0% for the engine and 2.0% for prompting. A persona without the required account receives not_run. The HF10 grid found no persona effect on the test agent." src=".github/readme/block-personas-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub>The test stays the same while the customer changes. Behaviour comes from numeric draws outside the language model.</sub></p>

**Run the same test with terse, chatty and pushy customers, and see whether the agent handles them differently.**

- **What it is.** A persona describes the customer; the test describes what they want and what must happen. Numbers control behaviours such as short replies and questions. The engine draws those behaviours, then the model writes the message. A persona that cannot play the test is refused with a reason. The grid compares results and reports when no effect appears.
- **Why no other framework does it.** [Simulated users appear in other tools](docs/comparison.md); they are not unique to driftbench. The separate persona and test let you change the customer while keeping the expected result fixed. The studies below test behaviour draws and conflicts, not superiority over peer frameworks.
- **Measured impact.** In the [human simulation study](https://github.com/achammah/driftbench/pull/418), the engine produced short turns 38.0 percent of the time. Human dialogues had 38.2 percent; prompting alone had 2.0 percent. In the [persona study](https://github.com/achammah/driftbench/pull/444), negating a language rule flipped 10 of 11 French cells and 0 of 11 English cells. The loader refused all 30 planted conflicts and none of 30 clean cases. The original grid flag failed its control. The exact test found no persona effect on the test agent, and the grid reports that result.

<sub>Persona integration is on its way ([#418](https://github.com/achammah/driftbench/pull/418), [#444](https://github.com/achammah/driftbench/pull/444)). Basic simulated users already ship. The human reference is crowd workers playing support scenarios. The grid study covers one agent and 20 blocks; different customer styles did not produce different pass rates.</sub>

### Parent blocks: share the start and count the cause once

<a href=".github/readme/block-parents-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/block-parents-dark.png">
    <img alt="The details block passes and supplies the recap block's starting state. The recap fails because the agent skips confirmation. Its order and receipt children are blocked. An independent opening hours test passes. The report counts one failure." src=".github/readme/block-parents-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub>A child starts where its parent ended. A failed parent blocks its children; an independent test keeps its result.</sub></p>

**Reuse an opening across tests and count an inherited failure once, instead of blaming every later step.**

- **What it is.** A parent block supplies its end state as a child's starting point. Several tests can share that opening. If the parent fails, its children show as blocked. They do not add copies of the same failure. Independent failures stay separate. The research isolation check tests whether a child needs state from its parent.
- **Why no other framework does it.** A list of conversation turns does not itself declare which test depends on which starting state. Parent links make that dependency explicit. Our [comparison](docs/comparison.md) does not establish exclusivity for parent state or inherited failure counts.
- **Measured impact.** In the [parent study](https://github.com/achammah/driftbench/pull/416), grouping inherited failures reduced root count error to 8.4, against 38.2 with flat linked counting. That result is a simulation on the Acme parent tree. On a live test agent, isolation checks caught 8 of 8 eligible planted dependencies and flagged 0 of 9 negative controls.

<details>
<summary>Parent blocks: one opening, two branches, one independent test</summary>

<br/>

The whole of [`checkout.yaml`](examples/acme/parents/checkout.yaml). `plans` is the parent; `recap` and `alternative` are its children, and `order` and `receipt` continue the `recap` branch. `hours` has no parent:

```yaml
id: acme-parent-checkout
title: Two checkout branches share one recorded opening
given:
  vars: { channel: web }
blocks:
  - id: plans
    user: Show Acme plans.
    expect:
      must: [Basic]
      tools: [{ label: catalog.search, count: 1 }]
      ledger_add: { plan: Basic }
  - id: recap
    parent: plans
    user: I choose Basic.
    expect:
      must: [CONFIRM]
      tools: [{ label: order.create, count: 0 }]
  - id: order
    parent: recap
    user: CONFIRM
    expect:
      must: [ACME-42]
      tools: [{ label: order.create, count: 1 }]
  - id: receipt
    parent: order
    user: My receipt, please.
    expect:
      must: [ACME-42]
  - id: alternative
    parent: plans
    given:
      vars: { channel: phone }
    user: Can I call Acme instead?
    expect:
      must: ['202 555 0142']
  - id: hours
    user: When is Acme open?
    expect:
      must: ['09:00']
```

Each child starts from its parent's recorded end state: the conversation, the `catalog.search` result, the facts and the variables. Its own Given then merges facts, variables and world by key, as the `phone` channel does on `alternative`; its own prefix or workspace replaces the inherited one whole. `plans` runs once for both branches. If `recap` fails, `order` and `receipt` are blocked and the report lists them under that one cause, while `alternative` and `hours` keep their own results. A missing parent or a cycle is a spec error. For a code agent the child's sandbox starts from the files its parent left. Run it with no key: `pnpm exec tsx examples/acme/parents/run.ts`. See [the reference](docs/reference/spec.md#block), [inheritance](docs/concepts/given-when-then.md#parent-blocks) and the [worked example](examples/acme/parents/README.md).

</details>

<sub>Parent execution and blocked children ship. Independent flaky failures can still inflate the root count. The research isolation study tests conversation history; the isolation checker is not integrated, and finer dependencies on stored facts or tool state remain untested.</sub>

### Value checks: ask the tool what the value means

<a href=".github/readme/block-values-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/block-values-dark.png">
    <img alt="Two phone formats, +1 202 555 0131 and +12025550131, enter an illustrative lookup tool. Matching records pass; unresolved values continue to another check. A note explains that storing a number cannot establish equality. Acme measurements show 59 of 116 format disputes settled by the tool." src=".github/readme/block-values-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub>A tool that resolves both values can settle the comparison. A tool that only stores them cannot.</sub></p>

**Accept equivalent values when the tool confirms them, and keep unresolved differences open for the next check.**

- **What it is.** The check tries the agent's value and the expected value with the tool. A lookup can show whether `+1 202 555 0131` and `+12025550131` reach the same record. Matching strings alone cannot answer that. If the tool only stores a value, the comparison moves to the next check. Acme's phone tool only stores values, so it does not settle those phone comparisons.
- **Why no other framework does it.** The [value study](https://github.com/achammah/driftbench/pull/441) compares this method with exact matching and a normaliser. It does not establish exclusivity across frameworks. The distinction is the evidence: a resolving tool can answer whether two spellings reach the same record.
- **Measured impact.** The tool settled 59 of 116 format disputes. It agreed on all 49 settled cases with reference labels; the other 10 had disputed labels. The full value check made 0 false passes and 0 false fails on 249 labelled runs. The simpler normaliser did too, so the study did not establish superiority over it. Source: [value study](https://github.com/achammah/driftbench/pull/441).

<sub>The value check is on its way ([#459](https://github.com/achammah/driftbench/pull/459)). Tool replay requires a configured replayer; unresolved values stay inconclusive. The phone lookup in the figure is fictional. The measured tool results concern the Acme tools; no resolving phone lookup ran in that study.</sub>

### Rule files: change the rule and score the run again

<a href=".github/readme/block-rules-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/block-rules-dark.png">
    <img alt="Default rules feed an editable project rule file. The order timing rule prohibits an order call at this step. The failed verdict names that rule and records the agent's order. Stored runs receive the changed scoring rule with zero agent calls. Default rules preserve every verdict across 259 recorded runs." src=".github/readme/block-rules-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub>Your rule file supplies the decision. The verdict names the rule and its configuration layer when a stored run is scored again.</sub></p>

**Change how a result is scored, inspect the rule behind each verdict, and reuse the recorded agent response.**

- **What it is.** Rules live in files with named items. Your file extends the defaults and changes the items you choose. Every verdict names its deciding rule and configuration layer. A scoring change can evaluate stored runs again without calling the agent. A change to what the agent receives requires another run.
- **Why no other framework does it.** Our [comparison](docs/comparison.md) covers checks, judges and cached calls. It does not compare editable rule files or verdict stamps. Here, the file that sets a rule and the verdict that applies it remain linked, so a score can be inspected.
- **Measured impact.** The [framework prototype](https://github.com/achammah/driftbench/pull/437) changed 0 of 2,351 existing spec hashes. Its default rules changed 0 verdicts across 259 stored runs. A project scoring rule change scored all 259 runs again with 0 agent calls. A model change required 777 adapter calls on those runs.

<sub>Rule files and verdict stamps are on their way ([#443](https://github.com/achammah/driftbench/pull/443), [#449](https://github.com/achammah/driftbench/pull/449)). The compatibility and scoring results come from a prototype. One override also changed 36 aggregate verdicts outside its target, so the study did not prove isolated rule changes.</sub>

### Blast radius: rerun only what a change touches

<a href=".github/readme/blast-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/blast-dark.png">
    <img alt="A fictional Acme prompt has one edited line, line 18: Read the order back and wait for confirmation. Lines 17 and 19 stay unchanged. Arrows connect the edited line to recap blocks in three test conversations. Those linked blocks glow blue. Steps that inherit their state are also selected. A fourth conversation has no linked block; its results are kept from the last run. A legend separates linked tests, inherited state and kept results. This is an illustration of the intended source selection; source links currently advise selection and do not skip tests." src=".github/readme/blast-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub>Edit one prompt line, follow its links to the tests, and keep the other results. Fictional Acme example.</sub></p>

**See which tests an edited prompt line can affect, then rerun the declared blast radius and keep the other results.**

- **What it is.** Every block says what it uses. A link from a prompt passage identifies tests to inspect when that passage changes. Source links advise selection; they do not yet skip tests. The running planner uses declared dependencies to rerun affected blocks and steps that inherit their state. It keeps the other results from the last run. When it cannot tell, it reruns everything. The nightly run still covers everything.
- **Why no other framework does it.** LangWatch Scenario and Inspect cache model calls; promptfoo and DeepEval document part of a cache. See row 22 of our [comparison](docs/comparison.md). A cache replays a call that has not changed. Choosing tests for an edited instruction needs each test to say what it reads, which blocks do.
- **Measured impact.** On Acme, a recap change sends 606 of 867 blocks and fails on the same 102 cells as a full run. That sends about 30 percent fewer blocks. For a tool input change, each block runs alone. The radius sends 86 of 867 blocks, 90.1 percent fewer; the same 86 blocks fail as in a full run. A change to the price sheet task family skips 95.9 percent. The reply language rule affects every block, so it skips none. A fault outside the declared change is caught by the audit, which then sends all 867 blocks. Sources: [blast-radius.md](docs/concepts/blast-radius.md), [radius-carry.test.ts](packages/cli/test/radius-carry.test.ts), [radius-blocks-acme.test.ts](packages/cli/test/radius-blocks-acme.test.ts), [contained.test.ts](examples/acme/test/radius/contained.test.ts). [How we measured](docs/comparison/methods.md#blast-radius-rerun-only-what-a-change-touches). Separately, the [prompt study](https://github.com/achammah/driftbench/pull/421) selected 19.9 percent of the suite on average, but missed failures for 3 of 90 mutants. Those are selection results, not shipped rerun savings.

<sub>The planner counts 861 scored blocks. A run also sends six unscored blocks, giving 867. Without end state snapshots, the tool input change sends 376 of 867. The declared change must cover everything that changed. The audit samples cells and can miss a fault. `driftbench radius` and `campaign run --change` are on main. Source selection is advisory: `driftbench radius --sections` prints the blocks the links would select, and `driftbench radius localize` ranks the prompt sections a failing block points to. Nothing is skipped by it. See [prompt sections](docs/concepts/blast-radius.md#prompt-sections-and-block-links). The prompt study missed failures for 8.2 percent of mutants when changes touching two sections were included.</sub>

### Mixture of Judges: the right judge for each answer

<a href=".github/readme/moj-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/moj-dark.png">
    <img alt="One answer to judge. First, a quick, cheap judge reads it and says how sure it is and what kind of answer this is. If it is sure, it decides at once. If not, the answer goes to the expert that fits: a fact or a sum to check is solved once and compared; anything else unclear goes to a careful reasoning judge; if still unclear, a panel of models votes. The verdict is pass or fail, with the reason. At least as accurate as promptfoo on three public benchmarks, with 3.5 to 19.4 times fewer costly calls." src=".github/readme/moj-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub>A cheap judge decides what it is sure of; the rest goes to the expert that fits.</sub></p>


**A cheap judge settles the answers it is sure of, and the expert sees only the rest: at least the accuracy of promptfoo's judge on three sealed sets, with 3.5 to 19.4 times fewer costly reasoning calls.**

- **What it is.** A quick judge reads every answer first. When it is sure, it decides. When it is not, the answer goes to the expert that fits it: a fact check, a careful reasoning judge, or a panel of models.
- **Why no other framework does it.** promptfoo, DeepEval, LangWatch and Langfuse let you pick one judge model, and their docs show ensembles only in part (row 11 of our [comparison](docs/comparison.md)). Inspect documents a [scorer cascade](https://inspect.aisi.org.uk/multiple-scorers.html) that stops at the first scorer that settles a sample. We found no documented routing of an answer by the first judge's confidence to an expert chosen for it.
- **Measured impact.** With GPT-6 Luna on sealed pairs, MoJ scored 85.0 against promptfoo's 84.0 on JudgeBench, 94.9 against 94.7 on MM-Eval and 65.2 against 57.0 on writing, using 57, 21 and 10.3 reasoning calls per 100 pairs where promptfoo used 200 ([RESULTS.md](research/moj/RESULTS.md), [report.json](research/moj/results/sealed/report.json)). On 1,212 sealed MM-Eval items, the first judge sent 48 to the panel; on those 48 the score rose from 51.0 to 85.4, and on the whole set from 89.49 to 91.54 ([mm-eval-sealed-test.json](docs/assets/data/mm-eval-sealed-test.json)). [How we measured](docs/comparison/methods.md#mixture-of-judges)

<sub>On JudgeBench and MM-Eval the differences are within the 95% intervals. On writing, a rule that picks the longer reply scores 69.7 on the sealed pairs. MoJ runs today from the research harness, on the package's opt-in escalation API (`createEscalation`).</sub>

### More that ships

<a href=".github/readme/innovations-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/innovations-dark.png">
    <img alt="Six more things driftbench does. A judge that shows its work, opt-in: it lists the evidence for each requirement and code decides pass or fail. Recovery: a surprise mid-conversation, and how many steps the agent needs to get back on track. Statistics: every rate has a range, and it says when you have too few tests. Code agents: it opens the spreadsheets and documents the agent leaves behind. Attacker: a user that pushes back, each move picked from the agent's last reply. Replay: a recorded run replays with no model call." src=".github/readme/innovations-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub>Six more, in one line each.</sub></p>

- **A judge that shows its work (opt-in).** It writes the evidence for each requirement, and code decides pass or fail. promptfoo's select-best prompt asks the model for the index of the text that best fits the criteria, as a single integer ([its grader](comparisons/promptfoo/hard/vendor/grading.ts.txt)). On RubricBench, a public benchmark, it scores 7 points above promptfoo with Claude Haiku 5.5. [How we measured](docs/comparison/methods.md#a-judge-that-shows-its-work)
- **Recovery.** Inject a surprise at any step and count the steps until the agent is back on track. No other tool in our comparison shows recovery metrics in full (row 15). → [recovery](docs/concepts/recovery.md)
- **Statistics you can trust.** Every rate has a range, two versions are compared on the same tests, and the gate says when you have too few tests to decide. No other tool in our comparison shows intervals with significance tests in full (row 17). → [statistics](docs/concepts/statistics.md)
- **Code agents.** The same steps check the files a code agent leaves behind: spreadsheet cells, documents, the workspace. None of the six code-agent benchmarks in our [comparison](docs/comparison.md#code-agent-benchmarks) grades office files in the pages read. → [code agents](docs/estate.md)
- **An attacker that adapts.** A simulated user picks each next move from the agent's last reply. → [attacker](docs/attack.md)
- **Replay for free.** A recorded run replays with no model call, so CI costs nothing. LangWatch and Inspect cache model calls (row 22); driftbench replays whole runs. → [replay](docs/estate.md#replay-built)

## What it does

<a href=".github/readme/areas-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/areas-dark.png">
    <img alt="Four things driftbench tests, on four cards. Test conversations: replay a real conversation, let a simulated user talk, or throw in a surprise at any step. Rules and judges: rules check what code can check, and a judge decides the rest once it has proved it can. Going off track: where the agent first went wrong, and how many steps it took to get back. Numbers you can trust: every rate with its range, and a yes or no your CI can act on." src=".github/readme/areas-light.png" width="100%">
  </picture>
</a>

**Write and generate tests**
- [Specs](docs/reference/spec.md): one conversation or task as blocks. Each carries a starting point (Given), a user turn (When) and an expected result (Then).
- [Generated tests](docs/generating.md): code writes the blocks from an approved map of situations, and reports the pairs of values they cover.
- [Tests from production](docs/traces.md): draft specs from OpenTelemetry, Nexus or Claude Code traces, or from [a spreadsheet](docs/datasets.md).

**Run agents**
- [13 adapters](docs/adapters/index.md): a function, an HTTP endpoint, a command, and the common agent SDKs.
- [Three run modes](docs/concepts/run-modes.md): each block alone, the whole conversation, or with a deviation injected.
- [Simulated users](docs/simulated-user.md) and an [adaptive attacker](docs/attack.md) that picks its next move from the agent's last replies.

**Check and judge**
- [37 machine checks](docs/reference/checks.md): tool calls and their arguments, text, language, personal data, end state, files, spreadsheets, cost.
- [Judges](docs/concepts/judges.md): a model judges what code cannot, must quote its evidence, and a panel votes when the first judge is unsure.
- [Hand labels](docs/viewer.md): label blocks in a local viewer and measure each judge against them.
- [Block rules and fault finding](#blocks-test-each-step-and-find-the-fix): trace a verdict to its rule file and a failure to its fix.

<sub>Rule files and fault finding are on their way ([#443](https://github.com/achammah/driftbench/pull/443), [#449](https://github.com/achammah/driftbench/pull/449), [#447](https://github.com/achammah/driftbench/pull/447), [#451](https://github.com/achammah/driftbench/pull/451), [#453](https://github.com/achammah/driftbench/pull/453)).</sub>

**Measure variance**
- [Intervals on every rate](docs/concepts/statistics.md), repeats, and the share of runs that pass every time.
- [Where results vary](docs/concepts/statistics.md#where-results-vary): how much of the spread comes from the agent, the wording, the persona or the judge.
- [Drift](docs/concepts/drift.md) and [recovery](docs/concepts/recovery.md): the first block that went wrong, and how many blocks the agent needs to come back.

**Compare runs**
- [Paired comparison](docs/concepts/statistics.md#comparing-a-baseline-and-a-candidate) of two versions on the same conversations.
- [A CI gate](docs/reference/cli.md#driftbench-ci) with an exit code: parity, regression, or not enough evidence.
- [Scorecards](docs/scorecards.md): one HTML file, JUnit XML, and a [monitor](docs/traces.md#monitoring-driftbench-monitor---source-traces) for production traces.

**Record and replay**
- [Replay recorded sessions](docs/estate.md#replay-built) offline, with no model call.
- [Cached blocks](docs/running.md#the-cache-and-replay) and recorded judge answers, so a rerun costs nothing.
- [Versioned datasets and prompts](docs/datasets.md#the-registry), restorable byte for byte.

**Validate the evaluator**
- [Planted-truth suites](docs/validators.md): code builds cases with a known answer and measures what driftbench reports.
- [A validity gate](docs/generating.md#the-gate) for tests: a test that a planted fault does not fail, or that a constant reply passes, is rejected.

**Only here, in full.** We read seven other evaluation tools against 30 capabilities. Six are found in full in none of them:

| Only here, in full | What you get | Proof |
|---|---|---|
| [Recovery metrics](docs/concepts/recovery.md) | Inject a deviation at a chosen block and count the blocks until the agent is back, the failures after it, and whether its actions stayed safe | [recovery.test.ts](packages/core/test/runner/recovery.test.ts) |
| [Drift across turns](docs/concepts/drift.md) | The first block that went wrong, and which of five kinds of drift it was | [drift.test.ts](packages/core/test/runner/drift.test.ts) |
| [Judge calibration](docs/concepts/judges.md#calibration-an-assignment-is-earned) | A judge owns a criterion only after it separates a pass from a fail 3 times out of 3 and agrees with your hand labels | [calibration.test.ts](packages/judges/test/calibration.test.ts) |
| [Intervals and significance tests](docs/concepts/statistics.md) | An interval on every rate, paired tests between two versions, and a correction across criteria | [intervals.test.ts](packages/stats/test/intervals.test.ts) |
| [End state assertions](docs/reference/checks.md#end-state) | Check what the agent actually left behind: the order placed, the file written, the cells of the workbook | [end_state.test.ts](packages/checks/test/end_state.test.ts) |
| [Multi-language handling](docs/reference/checks.md#text-and-language) | Check the language of a reply and that it stays stable through the conversation | [lang.test.ts](packages/checks/test/lang.test.ts) |

<a href=".github/readme/capability-matrix-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/capability-matrix-dark.png">
    <img alt="Of 30 evaluation capabilities: driftbench 30. In full, in part, not found: deepeval 12, 14, 4. langwatch 12, 11, 7. promptfoo 10, 15, 5. langfuse 10, 7, 13. inspect_ai 9, 14, 7. opik 9, 10, 11. braintrust 2, 11, 17." src=".github/readme/capability-matrix-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub>Every cell with its source: <a href="docs/comparison.md">comparison page</a>. <a href="docs/comparison/methods.md#the-capability-matrix">How we measured</a>.</sub></p>

## How it works

<a href=".github/readme/loop-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/loop-dark.png">
    <img alt="The loop a team runs, in six steps. 1 Generate: tests from a map you approve; code writes the blocks. 2 Run: your agent through one adapter, three modes, repeats. 3 Check and judge: a verdict per block, machine checks then the judges. 4 Gate: parity or regression, an exit code on every pull request. 5 Fix: the verdict names the block and the check. 6 Rerun the radius: only what the fix touches; the rest is carried from the last run. Then the gate decides again." src=".github/readme/loop-light.png" width="100%">
  </picture>
</a>

Six steps, numbered as in the figure, then the loop again. You can start at step 2 with specs you write by hand, as in the quickstart.

### Generating tests

You approve a map of what the agent can face, and code writes the blocks from it. A validity gate keeps only tests a planted fault fails.

<details>
<summary>Generate the tests of the example agent</summary>

driftbench writes tests from a map of the situations an agent can face. A person approves every entry of the map, and each entry quotes the source that justifies it. Code then writes the blocks and derives each expected outcome from the map, never from an agent's reply. A validity gate keeps a test only if a planted fault fails it, a reference agent passes it, and a constant reply cannot pass it. Then `select` picks the fewest conversations that cover the map. On the Acme example the gated suite covers 592 of the 708 allowed pairs of values and every required cell.

Generate the Acme suite from its approved map, from a clone. No model is called:

```bash
pnpm driftbench generate --map examples/acme/map/approved.yaml --out generated --t 2
```

The table of test writers, the coverage line and the last line:

```
Seeder        specs  blocks  complete  incomplete
graph            12      48        12           0
twise           156     793       153           3
boundary         85     146        13          72
deviation        21     111        21           0
metamorphic      42     192        42           0
task             67      71        67           0
cover            28     155        28           0

Coverage on the axis map at t = 2: complete specs 708 of 708 (100.0%), all specs 708 (100.0%).
Wrote 508 files to generated.
```

Complete specs go to `specs/`. A spec with no approved phrase or no machine-checkable outcome goes to `incomplete/`, and the command then exits 1: the map has a gap to fill, and the output names it.

**On a budget.** `driftbench generate --budget N` writes the N tests that cover the most pairs of settings. → [budget study](comparisons/budget/full-study.md)

</details>

### Running your agent

<a href=".github/readme/block-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/block-dark.png">
    <img alt="One step of a conversation in three parts. Before: where the step starts, after the greeting, with a current customer, in a phone shop, on chat. The user says their email address. After: what must be true: make an offer, search the plans once, name the two bigger plans, not mention home internet, learn the customer id, invent nothing. Below, every check passes and the step passes." src=".github/readme/block-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub>Before the step, what the user says, and what must be true after it.</sub></p>

A block holds everything the agent does between two user messages: text, cards, tool calls and tool results. The spec fixes what must be true after it. driftbench reads what happened, compares it field by field, and keeps the evidence behind every verdict. Because a block starts from its own Given, it can be run many times on its own and gets its own pass rate.

A Given can hold the conversation before the block, tool calls included. A past lookup goes in as a recorded call with its result, never as a sentence of the assistant: an agent that finds an earlier result only in its own prose tends to call the tool again ([why](docs/concepts/given-when-then.md#tool-history-records-not-prose)).

```yaml
- user: What is my callback reference?
  given:
    origin: recorded              # copied from a real run
    prefix:
      - { role: user, content: Can someone call me back about fiber? }
      - role: assistant
        content: Done, an advisor will call you today.
        tool_calls:
          - { id: call-1, label: notify_sales, input: { topic: fiber }, output: { ref: LD-4471 } }
  expect:
    must: [LD-4471]
    tools: [{ label: notify_sales, count: 0 }]   # it must not file the request twice
```

<a href=".github/readme/kinds-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/kinds-dark.png">
    <img alt="The same step model for two kinds of agent. Left, a chat agent at step 4: the user says Confirm, the agent places the order and gives its order number; right step, tool call, asked first, order id and order saved are checked. Right, an agent that writes files at step 1: it uses its spreadsheet skill, runs its own code with no error, creates price-sheet.xlsx and leaves the other files untouched; sheets and cells, the yearly formula, the other files and nothing deleted are checked." src=".github/readme/kinds-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub>One step model for a chat agent and for an agent that writes files.</sub></p>

The same block model covers a chat agent and an agent that writes code and files. For a code agent, a block is one task step in a sandbox, and the checks read what it left behind: workbook cells and formulas, the workspace diff, the commands run, the skills loaded.

<details>
<summary>A chat block and a code-agent block, side by side</summary>

<br/>

A chat block from the bundled Acme example, [`plan-upgrade.yaml`](examples/acme/specs/conversations/plan-upgrade.yaml):

```yaml
- user: It's sam.rivera@example.com
  expect:
    stage: offer
    ledger_add: { customer_id: cust-001, current_plan: mobile-s }
    tools:
      - label: catalog.search
        count: 1
        input:
          category: mobile
          customer_email: sam.rivera@example.com
          address_id: { absent: true }
    must: ['Acme Mobile M', 'Acme Mobile L', '\$25', '\$35']
    must_not: ['Fiber', 'Air 5G']
    criteria: [no_invented_data@gating, one_question_per_turn]
```

A task block for a code agent, the whole of [`price-sheet-build.yaml`](examples/estates/sessions/specs/price-sheet-build.yaml). It checks the skill loaded, the files read, the helper dispatched, the commands run, the workspace diff and the cells of the workbook:

```yaml
id: replay-price-sheet-build
kind: task
title: Build the Acme price sheet, reviewed by a helper
target: { adapter: claude-code }
workspace_seed: examples/estates/sessions/price-sheet-build/before
stages: [plan, build_sheet, report]
metadata:
  replay:
    session: price-sheet-build
    before: price-sheet-build/before
    after: price-sheet-build/after
rules:
  forbidden_tools: [WebFetch]
  custom:
    ordered:
      pairs:
        - { before: Read, after: Edit, key: file_path, reset: compaction }
blocks:
  - id: build
    user: >
      Build a price sheet from catalog.csv: one sheet per category, named Mobile and Home, with a yearly
      price by formula. Save it as out/acme-price-sheet.xlsx and have the sheet reviewer check it.
    expect:
      stage: build_sheet
      skills:
        - { name: xlsx, count: 1 }
      references:
        - { path: '**/skills/xlsx/SKILL.md', count: 1 }
        - { path: '**/skills/xlsx/reference/*.md' }
      subagents:
        - { name: sheet-reviewer, model: sonnet, count: 1 }
      guards:
        - { name: read-before-write, verdict: deny, count: 0 }
      execution: { ran_code: true, exit_code: 0, max_commands: 3 }
      workspace:
        created: [out/acme-price-sheet.xlsx]
        changed: [build_sheet.py]
        deleted: []
        others_untouched: true
      artifacts:
        - path: out/acme-price-sheet.xlsx
          kind: xlsx
          checks:
            - sheets: [Mobile, Home]
            - cells: { sheet: Mobile, column: C, from_row: 2, values: [15, 25, 35] }
            - formula: { sheet: Mobile, cell: D2, regex: '^=C2\s*\*\s*12$' }
      safety: { max_destructive_ops: 0, confirm_before: [delete] }
      must: ['acme-price-sheet\.xlsx']
```

</details>

<a href=".github/readme/modes-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/modes-dark.png">
    <img alt="One conversation, run three ways. Replay the real conversation: each step starts from the real past turns, so a miss stays local; it shows each step alone. Let the agent run: its own replies carry forward, so one miss leads to another; it shows errors that pile up. Throw in a surprise: the user changes course midway and the agent is back one step later; it shows recovery." src=".github/readme/modes-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub>Replay to test each step alone, let it run to see errors pile up, or throw in a surprise to see it recover.</sub></p>

An agent can pass every step on its own and still fail the whole conversation. Replaying the real conversation tests each step alone; letting the agent run shows the errors that pile up. The gap between the two is the **compounding index**. → [run modes](docs/concepts/run-modes.md)

### Checking and judging every block

<a href=".github/readme/council-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/council-dark.png">
    <img alt="How a verdict is reached. First, rules checked by code: tools, text, language, personal data, end state; a rule that fails is final. Then three fast judges, which answer one yes or no question, or three expert judges, models from different labs that reason it through. The majority of three wins; a split goes to the other kind of judge; an unsure answer is judged again and never counted. A judge earns its place by telling a bad example from a good one 3 times out of 3. It must agree with your labels. Ties go to the fast judge." src=".github/readme/council-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub>Rules first, then fast or expert judges, each one tested to earn its place.</sub></p>

- **Machine checks first.** Code checks everything code can check. A machine fail is final.
- **Earned on evidence.** A judge must separate a failing transcript from a clean one 3 times out of 3. It must also agree with hand labels at a kappa of 0.8 or more.
- **Strict verdicts.** Majority of three. A split goes to the other class of judge. An inconclusive answer is judged again and never counted. A judge never shares the agent's model family.
- **Rules you can inspect.** Every verdict names its deciding rule. You can change that rule in a file and score the stored run again.

<sub>Rule files and verdict stamps are on their way ([#443](https://github.com/achammah/driftbench/pull/443), [#449](https://github.com/achammah/driftbench/pull/449)).</sub>

→ [judges](docs/concepts/judges.md)

### Measuring, and gating the pull request

One run proves little. Every rate comes with its interval, comparisons are paired on the same conversations, and a difference smaller than the run-to-run spread is reported as noise. Before a campaign spends anything, driftbench prints the smallest effect it can detect. → [statistics](docs/concepts/statistics.md)

<a href=".github/readme/perturbed-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/perturbed-dark.png">
    <img alt="A surprise mid-conversation. Six steps of an order. At step 3 the user changes course: make it two lines. At step 3 the agent ignores the change, a wrong step. At step 4 it contradicts it. At step 5 it is back on track, and the order is saved. Back on track after 2 steps, with no damage after that." src=".github/readme/perturbed-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub>An illustration with a faulty agent: the user changes course at step 3, and the agent goes off track, then comes back two steps later.</sub></p>

Every failing block gets a drift class: a local error, a contradiction, flow drift, format drift or tool drift. Twelve kinds of deviation can be injected at any block. After an injection, driftbench reports the blocks to recover, the failures after recovery, and whether the agent's actions stayed safe.

On the correct Acme sales agent, a goal shift at block 2 is handled at once:

```bash
pnpm driftbench perturb examples/acme/specs/conversations/plan-upgrade.yaml --class D2_goal_shift --at 2
```

```
  pos  block                       stage         pass  failing
  2    injected d2-cheaper-plan@2  offer         ✓
✓ Recovery: immediate, 0 blocks to come back (the spec allows 1 block), collateral 0, safe action yes, asked first yes.
```

→ [drift](docs/concepts/drift.md), [recovery](docs/concepts/recovery.md)

The gate turns all of this into an exit code: parity, regression, or not enough evidence. See [gate a pull request](#gate-a-pull-request).

### Fixing the block that failed

The verdict names the block, the stage and the check, with the evidence. The fault finder reads that evidence and names who is at fault and where the fix belongs. A failed tool call can point to the tool description; a missing order recap can point to the prompt. The diagnosis never changes a failed check into a pass.

<sub>The fault finder is on its way ([#447](https://github.com/achammah/driftbench/pull/447), [#451](https://github.com/achammah/driftbench/pull/451), [#453](https://github.com/achammah/driftbench/pull/453)).</sub>

### Rerunning the blast radius

The fix maps to the blocks it can affect through their declared dependencies. driftbench reruns affected blocks and any steps that inherit their state. It carries the other results from the last run. When it cannot tell what the change touches, it reruns everything. The gate decides again, and the nightly run still covers everything. Source links advise which blocks to run; they do not skip tests. See [blast radius](#blast-radius-rerun-only-what-a-change-touches).

<sub>Source links are on their way ([#423](https://github.com/achammah/driftbench/pull/423), [#429](https://github.com/achammah/driftbench/pull/429)).</sub>

Concepts in the docs: [block](docs/concepts/block.md) · [Given, When, Then](docs/concepts/given-when-then.md) · [run modes](docs/concepts/run-modes.md) · [judges](docs/concepts/judges.md) · [statistics](docs/concepts/statistics.md)

## How to use it

Three short recipes. Each continues the `my-evals` folder of the quickstart.

### Evaluate your own agent

From the command line, any program that reads a message and prints a reply is an agent: pass it with `--process-command`, as in the quickstart. A Python script works the same way: `--process-command "[\"python3\",\"$PWD/agent.py\"]"`.

From code, wrap your agent in an adapter. Save this as `run.mjs` and run `node run.mjs`:

```js
import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import { blockStatus, loadSpecFile, runOutcome, runSpec } from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';

// Your agent: any async function from the conversation so far to a reply.
async function myAgent(messages) {
  const last = messages.at(-1).content;
  const order = last.match(/A-\d+/)?.[0];
  return order
    ? `Refund started for order ${order}. You will get an email within 2 days.`
    : 'I can help with a refund. What is your order number?';
}

// The adapter: wrap the reply in the shape driftbench observes.
const adapter = functionAdapter({
  respond: async (messages) => {
    const started = Date.now();
    const text = await myAgent(messages);
    return {
      segments: [{ type: 'text', text }],
      text,
      toolCalls: [],
      cost: { usd: 0 },
      latencyMs: Date.now() - started,
    };
  },
});

const loaded = await loadSpecFile('specs/refund.yaml');
if (!loaded.ok) throw new Error('the spec is invalid');

const run = await runSpec(loaded.spec, {
  adapter,
  driver: createScriptedDriver(),
  checks: defaultChecks(),
  mode: 'F',
  repeat: 0,
});
for (const block of run.blocks) console.log(`block ${block.index}: ${blockStatus(block)}`);
process.exit(runOutcome(run) === 'pass' ? 0 : 1);
```

```
block 0: pass
block 1: pass
```

Report the tool calls your agent made in `toolCalls` and the `tools` check reads them. Using an agent SDK? There is [an adapter for it](#adapters). Prefer your test runner? [`describeSpec`](docs/vitest.md) gives one vitest test per block, and a [pytest plugin](docs/python.md) one test per spec.

### Add a judge

Some rules cannot be checked by a pattern. Write the rule as a criterion, with one transcript that passes and one that fails. Save this as `criteria/asks_before_acting.yaml`:

```yaml
criterion:
  name: asks_before_acting
  rubric: >
    The agent starts a refund only after the customer has given an order number.
    A refund started with no order number in the conversation fails.
  pass: The refund starts in a turn after the customer gave an order number.
  fail: The refund starts before any order number appears.
  gating: true
  scope: conversation
  judge_class: system2
fixtures:
  pass:
    note: The agent asks first, then acts on the number it was given.
    transcript:
      - { role: user, text: "I would like a refund." }
      - { role: agent, text: "What is your order number?" }
      - { role: user, text: "A-1042" }
      - { role: agent, text: "Refund started for order A-1042." }
  fail:
    note: The agent starts a refund with no order number.
    transcript:
      - { role: user, text: "I would like a refund." }
      - { role: agent, text: "Refund started. You will get an email within 2 days." }
```

```bash
npx driftbench judge check criteria
```

```
ok  asks_before_acting [system2, gating]: pass fixture 4 line(s), fail fixture 2 line(s)

1 valid criteria, 0 issue(s).
```

A judge owns a criterion only after it tells the two transcripts apart 3 times out of 3 and agrees with your hand labels: `driftbench judge calibrate` measures that and writes which judge owns what. In a run, the judges come in through code, `defaultChecks({ judges: council })`, with a judge client for OpenAI, Anthropic, Google or any HTTP endpoint. `campaign run` on the command line applies the machine checks only; loading judges from the command line is not built yet. See [judges](docs/concepts/judges.md#the-judge-check-in-a-run).

To see a panel of judges at work with no key and no model call, clone the repository and replay recorded answers on the 12 Acme criteria:

```bash
pnpm driftbench judge run --criteria examples/acme/criteria --cassette examples/acme/criteria/council.cassette.json
```

```
separated  explicit_confirmation [system1, gating]: pass fixture pass, fail fixture fail
separated  holds_instructions [system1, gating]: pass fixture pass, fail fixture fail (split, re-judged)
separated  no_invented_data [system2, gating]: pass fixture pass, fail fixture fail

12 of 12 criteria separated in mode hybrid.
```

### Gate a pull request

Run the suite on the main branch and keep it as the baseline. Run it again on the pull request. `compare` pairs the two, conversation by conversation, and its exit code is the gate: 0 for parity, 1 for a regression or for a suite too small to tell.

```bash
AGENT="[\"node\",\"$PWD/agent.mjs\"]"
npx driftbench campaign run specs --target process:my-agent --process-command "$AGENT" \
  --repeats 3 --store runs.db --campaign baseline
# ...change the agent, then:
npx driftbench campaign run specs --target process:my-agent --process-command "$AGENT" \
  --repeats 3 --store runs.db --campaign candidate
npx driftbench compare --store runs.db --baseline baseline --candidate candidate
```

With the broken agent of quickstart step 5 as the candidate:

```
Warning: this suite cannot show parity under 15 points (the all-pass flag needs 79.3 points); about 22 goldens would.
  side       passing  rate    95% interval
  baseline   1 of 1   100.0%  [20.7%, 100.0%]
  candidate  0 of 1   0.0%    [0.0%, 79.3%]
Verdict: NOT SHOWN NON-INFERIOR.
```

A golden is one reference conversation. With one golden, driftbench will not call it parity and will not call it a proven regression either: it says the suite needs about 22. That is the point of the gate.

On the bundled Acme example, with ten goldens and a planted fault that skips the order recap, `driftbench ci` does the run and the comparison in one step:

```
  goldens paired                               10
  regressed                                    5
  all-pass regression effect                   +50.00 points
  95% interval                                 [+11.74, +76.34] points
  margin                                       28 points (auto)
Verdict: REGRESSION. Exit 1.
```

The same command on the unchanged agent prints `Verdict: PARITY. Exit 0.` A [GitHub Action](action/action.yml) wraps `driftbench ci`; a workflow that uses it is in [examples/acme/ci](examples/acme/ci/driftbench-ci.yml). Today `driftbench ci` and the Action reach the bundled example targets only. For your own agent, use the two runs and `compare` above.

## The command line

`driftbench <command> --help` prints every option. The examples below run from a clone (`git clone https://github.com/achammah/driftbench && cd driftbench && pnpm install`), on the fictional Acme Telecom agent, with no model call. Put `pnpm` in front of each example in a clone, or `npx` in your own project. `campaign run` writes the `ci.db` the later rows read.

Exit codes are verdicts: 0 when the thing holds, 1 for a failing cell or a finding, 2 for bad input.

**Write and check specs**

| Command | What it does | Example |
|---|---|---|
| `spec validate` | Parse and validate specs | `driftbench spec validate examples/acme/specs` |
| `spec lint` | Validate and print advice | `driftbench spec lint examples/acme/specs` |
| `import csv`, `import xlsx` | Turn rows of a table into specs | `driftbench import csv examples/acme/import/cases.csv --mapping examples/acme/import/mapping.yaml --out imported` |
| `import traces` | Draft specs from production traces | `driftbench import traces packages/adapters/test/traces/fixtures/otel-semconv.json --from otel --out drafts` |

**Run an agent**

| Command | What it does | Example |
|---|---|---|
| `campaign plan` | List the runs and print the smallest effect they can detect, before spending | `driftbench campaign plan examples/acme/specs/conversations --target function:acme --mode T,F --repeats 3` |
| `campaign run` | Run specs × targets × modes × repeats, and keep the runs | `driftbench campaign run examples/acme/golden/specs --target function:acme-sales --route flow:price-sheet=process:acme-ops --store ci.db --campaign baseline` |
| `campaign status` | Print the state of every run of a stored campaign | `driftbench campaign status baseline --store ci.db` |
| `smoke` | Run one spec several times and say whether the transcripts differ | `driftbench smoke examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme` |
| `perturb` | Inject one deviation and print the recovery | `driftbench perturb examples/acme/specs/conversations/plan-upgrade.yaml --class D2_goal_shift --at 2` |
| `simulate` | Let a simulated user play a persona | `driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona examples/acme/personas/sam-upgrader.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml --target function:acme` |
| `attack` | Attack adaptively, each move picked from the agent's last replies | `driftbench attack examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme --rounds 3 --seed 1` |
| `replay` | Run a spec suite over recorded sessions, offline | `driftbench replay examples/estates/sessions/price-sheet-build.jsonl --suite examples/estates/sessions/specs/price-sheet-build.yaml` |

**Judge**

| Command | What it does | Example |
|---|---|---|
| `judge check` | Validate criteria and their pass and fail transcripts | `driftbench judge check examples/acme/criteria` |
| `judge run` | Replay a panel of judges on recorded answers | `driftbench judge run --criteria examples/acme/criteria --cassette examples/acme/criteria/council.cassette.json` |
| `queue create` | Queue the blocks of a campaign for hand labels | `driftbench queue create --store ci.db --campaign baseline` |
| `view` | Serve a local viewer of a store, with hand labelling | `driftbench view --store ci.db` |

**Report and compare**

| Command | What it does | Example |
|---|---|---|
| `report` | Write the scorecard as one HTML file, and JUnit XML | `driftbench report --store ci.db --out scorecard.html` |
| `compare` | Compare a candidate campaign with a baseline | `driftbench compare --store ci.db --baseline baseline --candidate <campaign id>` (a template: put the id that `ci` printed) |
| `ci` | Run, compare and gate in one step | `driftbench ci --specs examples/acme/golden/specs --target function:acme-sales --route flow:price-sheet=process:acme-ops --baseline baseline --store ci.db` |
| `dataset push`, `dataset list` | Version a folder of specs, immutably | `driftbench dataset push acme-conversations examples/acme/specs/conversations --store reg.db` |

<details>
<summary>Generate tests, test code agents, and check driftbench itself: 12 more commands</summary>

<br/>

| Command | What it does | Example |
|---|---|---|
| `extract approve` | Review the proposed map of situations, entry by entry | `driftbench extract approve examples/acme/map/proposal.yaml` |
| `generate` | Write specs from an approved map, by code | `driftbench generate --map examples/acme/map/approved.yaml --out generated --t 2` |
| `gate` | Reject tests that cannot fail, leak their answer, or pass a constant reply | `driftbench gate examples/acme/specs --reference function:acme-sales --reference process:acme-ops --faults examples/acme/faults --date 2026-10-11 --out gated` |
| `select` | Pick the fewest gated conversations that cover the map | `driftbench select --cover examples/acme/map/space.yaml --specs examples/acme/gated/specs --out golden` |
| `space coverage` | Count the cells of the map the specs cover | `driftbench space coverage examples/acme/specs --map examples/acme/map/space.yaml --t 2` |
| `pilot plan` | Plan the measurement of where results vary | `driftbench pilot plan --map examples/acme/map/approved.yaml --suite examples/acme/generated/specs` |
| `intake interview` | Write the questionnaire that collects real user wordings | `driftbench intake interview --map examples/acme/map/approved.yaml --out questions.yaml` |
| `family instances`, `family verify` | Build variants of a code-agent task, and verify them on a reference build | `driftbench family instances examples/acme/families/price-sheet --n 3 --seed 1 --out family` |
| `estate scan` | Read a code agent's instructions, skills and settings into testable rules | `driftbench estate scan examples/estates/fixture --no-model --out estate-map.yaml` |
| `estate lint` | Find orphan files, unreachable agents and missing references | `driftbench estate lint examples/estates/fixture/approved.yaml` |
| `estate mutate` | Delete one rule, so the tests must notice | `driftbench estate mutate examples/estates/fixture/approved.yaml --atom gate.standing.read-a-file-before-editing-it --delete --to mutant` |
| `validate floors` | Print the level each self-test suite must hold in CI | `driftbench validate floors` |

`generate`, `space coverage` and `estate lint` exit 1 on the bundled example, by design: they report tests still incomplete, cells not yet covered, and six findings planted in the fixture. `monitor`, `holdout`, `prompt` and the other subcommands are in the [CLI reference](docs/reference/cli.md).

</details>

## Adapters

An adapter is the one piece of code between driftbench and your agent: it opens a session, sends a block, and returns what the agent did. Thirteen ship today in `@agent-nexus/driftbench-adapters`, and every one passes the same [contract suite](docs/adapters/index.md#the-contract-suite).

| Reach your agent as | Adapter |
|---|---|
| A function in your process | [function](docs/adapters/function.md) |
| An HTTP endpoint | [http](docs/adapters/http.md) |
| A command, in a sandbox with a workspace | [process](docs/adapters/process.md) |
| An SDK agent | [OpenAI Agents](docs/adapters/openai-agents.md) · [Anthropic](docs/adapters/anthropic.md) · [Google](docs/adapters/google.md) · [LangGraph](docs/adapters/langgraph.md) · [CrewAI](docs/adapters/crewai.md) · [Vercel AI SDK](docs/adapters/vercel-ai.md) · [Pydantic AI](docs/adapters/pydantic-ai.md) · [LiteLLM](docs/adapters/litellm.md) |
| A code agent, replayed or live | [Claude Code](docs/adapters/claude-code.md) |
| A hosted agent platform | [Nexus](docs/adapters/nexus.md) |

A minimal complete adapter is the `functionAdapter` of [Evaluate your own agent](#evaluate-your-own-agent): a dozen lines around your function. To write one from scratch, implement the [contract](docs/adapters/index.md#the-contract): `open`, `send` and `close`.

**The other extension points**

| You want to add | How | Where |
|---|---|---|
| A check | `registerCheck(name, fn)`: a function from the observed block to verdicts, switched on per spec under `rules.custom` | [custom checks](docs/reference/checks.md#custom-checks) |
| A judge | A client with one method that answers a judge request; clients for OpenAI, Anthropic, Google and HTTP ship | [judge clients](docs/concepts/judges.md#judge-clients) |
| A criterion | One YAML file: a rubric, a pass transcript, a fail transcript | [criteria folders](docs/concepts/judges.md#criteria-folders-and-fixture-pairs) |
| A similarity model | `denseEmbedder({ id, embed })`: one call from texts to vectors | [similarity](docs/reference/checks.md#similarity-relevancy-and-knowledge-retention) |
| A file reader for artifacts | A reader per file kind; spreadsheets, documents, decks and PDF ship | [artifacts](docs/reference/checks.md#code-files-and-workspace) |
| A map of situations | A YAML file of dimensions, values and constraints, proposed by `extract` or written by hand | [the map](docs/generating.md#the-map-of-situations) |
| A store or a report | Runs live in one SQLite file with a versioned JSON export; reports are HTML, JUnit XML and JSON | [the store](docs/running.md#the-store) · [scorecards](docs/scorecards.md) |

## Benchmarks

Every number comes from a result file in this repository. All scores are on one scale, 0 to 100.

### Public benchmarks

Five public benchmarks for judges, all on the same sealed items and the same model, Claude Haiku 5.5, with every tool running its default judge. Scores are out of 100. The other models and the charts that carry them are in the detail of each benchmark: [JudgeBench](docs/comparison/benchmarks/index.md#judgebench), [MM-Eval](docs/comparison/benchmarks/index.md#mm-eval), [RubricBench](docs/comparison/benchmarks/index.md#rubricbench), [verify and writing](docs/comparison/benchmarks/index.md#longjudgebench).

<!-- readme-charts:start -->
**JudgeBench.** driftbench picks the correct answer more often than DeepEval, LangWatch, promptfoo, Inspect and Langfuse on the same model: 88.9, against 86.3 for the next best, DeepEval.

<a href="docs/assets/bench-judgebench-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/bench-judgebench-dark.png">
    <img alt="JudgeBench: driftbench scores 88.9. Claude Haiku 5.5, 270 pairs, percent correct, highest to lowest: driftbench 88.9, DeepEval 86.3, LangWatch 83.7, promptfoo 83.0, Inspect 80.0, Langfuse 74.8." src="docs/assets/bench-judgebench-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub>Claude Haiku 5.5, 270 pairs. Each judge runs its default settings; driftbench runs its opt-in pair ledger. A refused item counts as wrong.</sub></p>

**MM-Eval.** driftbench picks the better answer more often than promptfoo, DeepEval, LangWatch, Inspect and Langfuse on the same model: 88.9, against 86.5 for the next best, promptfoo.

<a href="docs/assets/bench-mm-eval-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/bench-mm-eval-dark.png">
    <img alt="MM-Eval: driftbench scores 88.9. Claude Haiku 5.5, 591 items, percent correct, highest to lowest: driftbench 88.9, promptfoo 86.5, DeepEval 84.1, LangWatch 83.9, Inspect 75.4, Langfuse 73.5." src="docs/assets/bench-mm-eval-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub>Claude Haiku 5.5, 591 items. Each judge runs its default settings; driftbench runs its opt-in pair ledger. A refused item counts as wrong (refused: DeepEval 3, LangWatch 7, Inspect 7, Langfuse 6).</sub></p>

**RubricBench.** driftbench picks the reply that meets the grading criteria more often than DeepEval, promptfoo, LangWatch, Inspect and Langfuse on the same model: 82.7, against 77.6 for the next best, DeepEval.

<a href="docs/assets/bench-rubricbench-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/bench-rubricbench-dark.png">
    <img alt="RubricBench: driftbench scores 82.7. Claude Haiku 5.5, 1,580 games, percent correct, highest to lowest: driftbench 82.7, DeepEval 77.6, promptfoo 75.6, LangWatch 74.9, Inspect 26.6, Langfuse 25.1." src="docs/assets/bench-rubricbench-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub>Claude Haiku 5.5, 1,580 games. Each judge runs its default settings; driftbench runs its opt-in pair ledger. A refused item counts as wrong (refused: DeepEval 1, Langfuse 1).</sub></p>

**Verify.** driftbench decides whether the final answer is correct 74.2 times in 100, within 0.9 points of the top score (Langfuse, 75.1) and above Inspect (73.3), LangWatch (73.3), promptfoo (71.9) and DeepEval (58.8).

<a href="docs/assets/bench-verify-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/bench-verify-dark.png">
    <img alt="Verify: driftbench scores 74.2. Claude Haiku 5.5, 221 items, percent correct, highest to lowest: Langfuse 75.1, driftbench 74.2, Inspect 73.3, LangWatch 73.3, promptfoo 71.9, DeepEval 58.8." src="docs/assets/bench-verify-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub>Claude Haiku 5.5, 221 items. Each judge runs its default settings; driftbench runs its opt-in frozen verify cascade. A refused item counts as wrong.</sub></p>

**Writing.** driftbench picks the reply readers prefer more often than DeepEval, promptfoo, LangWatch, Langfuse and Inspect on the same model: 67.6, against 58.4 for the next best, DeepEval.

<a href="docs/assets/bench-writing-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/bench-writing-dark.png">
    <img alt="Writing: driftbench scores 67.6. Claude Haiku 5.5, 346 games, percent correct, highest to lowest: driftbench 67.6, DeepEval 58.4, promptfoo 56.9, LangWatch 52.6, Langfuse 14.5, Inspect 11.6." src="docs/assets/bench-writing-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub>Claude Haiku 5.5, 346 games. Each judge runs its default settings; driftbench runs its opt-in pair ledger. A refused item counts as wrong. The driftbench bar uses its opt-in reader-first setting (long-structured), which scores the same as a rule that always picks the longer reply, 67.6; the default setting scores 61.3.</sub></p>

<!-- readme-charts:end -->

<p align="center"><sub><a href="docs/comparison/methods.md#public-benchmarks-against-promptfoo">How we measured</a></sub></p>

### A panel, only when unsure

<a href=".github/readme/mm-eval-sealed-test-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/mm-eval-sealed-test-dark.png">
    <img alt="MM-Eval sealed test set, 1,212 items. The first judge alone against the first judge followed by a panel when unsure. All five subsets: 89.49 to 91.54, a gain of 2.05. Linguistics 90.56 to 94.44. Safety 89.74 to 92.31. Chat 72.83 to 75.00. Reasoning 95.37 to 96.59. Language mixing 98.95 to 99.36." src=".github/readme/mm-eval-sealed-test-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub><a href="docs/comparison/methods.md#mm-eval-a-panel-only-when-unsure">How we measured</a></sub></p>

A panel that sees only the unsure cases lifts the MM-Eval score from 89.49 to 91.54 on 1,212 sealed items, a gain of 2.05 points with a 95% interval of 1.02 to 3.29.

<sub>MM-Eval is a public benchmark for judges. Only 48 items went to the panel, and cost per 100 items rose from $0.2471 to $0.2646.</sub>

<!-- readme-v7:start -->
### The shipped judge against DeepEval

<a href=".github/readme/judge-leads-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/judge-leads-dark.png">
    <img alt="default-on-v7 against the recorded DeepEval default. Turn relevancy: 72 against 36 of 72, lead. Hallucination: 72 against 36 of 72, lead. Faithfulness: 72 against 36 of 72, lead. Completeness: 72 against 46 of 72, lead. Role adherence: 72 against 63 of 72, lead." src=".github/readme/judge-leads-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub><a href="docs/comparison/methods.md#the-judge-on-hard-cases">How we measured</a></sub></p>

On hallucination, faithfulness, turn relevancy, completeness and role adherence, default-on-v7 scores above DeepEval beyond the separate 95% intervals.

### Hard cases, framework by framework

The v7 run returns 2,700 items across 18 rows on Claude Haiku 5.5. Peers keep their recorded answers. Earlier driftbench rows used `claude -p` with old prompts (knowledge retention mostly used the Messages API); v7 uses `createDefaultJudge` over the Anthropic Messages API. The transport difference is part of this comparison.

<a href=".github/readme/hard-deepeval-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/hard-deepeval-dark.png">
    <img alt="default-on-v7 against the recorded deepeval default. Turn relevancy: 72 against 36 of 72, lead. Hallucination: 72 against 36 of 72, lead. Faithfulness: 72 against 36 of 72, lead. Completeness: 72 against 46 of 72, lead. Role adherence: 72 against 63 of 72, lead. DAG, one node: 72 against 65 of 72, close. G-Eval, strict: 479 against 451 of 480, lead. Task completion: 72 against 72 of 72, close. Knowledge retention: 1271 against 1272 of 1272, close." src=".github/readme/hard-deepeval-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub><a href="docs/comparison/methods.md#the-judge-on-hard-cases">How we measured</a></sub></p>

<a href=".github/readme/hard-promptfoo-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/hard-promptfoo-dark.png">
    <img alt="default-on-v7 against the recorded promptfoo default. LLM rubric: 72 against 69 of 72, close. Factuality: 72 against 70 of 72, close. Personal data: 72 against 71 of 72, close. Goal success: 72 against 71 of 72, close." src=".github/readme/hard-promptfoo-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub><a href="docs/comparison/methods.md#the-judge-on-hard-cases">How we measured</a></sub></p>

<a href=".github/readme/hard-langfuse-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/hard-langfuse-dark.png">
    <img alt="default-on-v7 against the recorded langfuse default. Reference correctness: 119 against 115 of 120, close." src=".github/readme/hard-langfuse-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub><a href="docs/comparison/methods.md#the-judge-on-hard-cases">How we measured</a></sub></p>

| Judge row | Cases | driftbench v7 correct | Recorded peer correct | Standing |
|---|---:|---:|---:|---|
| Turn relevancy | 72 | 72 | 36 | lead |
| DAG, one node | 72 | 72 | 65 | close |
| Role adherence | 72 | 72 | 63 | lead |
| Completeness | 72 | 72 | 46 | lead |
| Hallucination | 72 | 72 | 36 | lead |
| Faithfulness | 72 | 72 | 36 | lead |
| Task completion | 72 | 72 | 72 | close |
| G-Eval strict * | 480 | 479 | 451 | lead |
| Knowledge retention | 1,272 | 1,271 | 1,272 | close |
| LLM rubric | 72 | 72 | 69 | close |
| Factuality | 72 | 72 | 70 | close |
| Personal data | 72 | 72 | 71 | close |
| Goal success | 72 | 72 | 71 | close |
| Reference correctness | 120 | 119 | 115 | close |
| Model-graded QA | 60 | 58 | 57 | close |
| Model-graded fact | 60 | 58 | 59 | close |
| Grader panel | 60 | 54 | 59 | close |
| Panel, borderline | 60 | 60 | 60 | close |

* G-Eval strict retains the explicit `response-relevance` setting. G-Eval strict and knowledge retention use exact paired tests, Holm over those two rows. Other standings use separate Wilson 95% intervals. Close means no separation under that rule.

Inconclusive answers count wrong (Knowledge retention: 1; Reference correctness: 1; Grader panel: 4). They stay in the score denominator and leave the peer paired tests. Grader panel falls from 59 to 54 correct against the earlier driftbench answers; this is included in the secondary analysis.

[Results, analysis and reproduction](comparisons/default-on/readme-v7/RESULT.md). Historical public benchmark rows below retain their recorded judge versions and settings.
<!-- readme-v7:end -->

### The numbers

The table holds the numbers of the five charts. DeepEval, Inspect, Langfuse and LangWatch run their default judge; driftbench and promptfoo are the recorded cells. Each comparison is a paired exact test of driftbench against one tool, on the same items.

<!-- readme-table:start -->
| Benchmark | driftbench | promptfoo | DeepEval | Inspect | Langfuse | LangWatch |
|---|---:|---:|---:|---:|---:|---:|
| JudgeBench, 270 pairs | 88.9 | 83.0 | 86.3 | 80.0 | 74.8 | 83.7 |
| MM-Eval, 591 items | 88.9 | 86.5 | 84.1 | 75.4 | 73.5 | 83.9 |
| RubricBench, 1,580 games | 82.7 | 75.6 | 77.6 | 26.6 | 25.1 | 74.9 |
| LongJudgeBench verify, 221 items | 74.2 | 71.9 | 58.8 | 73.3 | 75.1 | 73.3 |
| LongJudgeBench writing, 346 games (footnote) | 67.6 | 56.9 | 58.4 | 11.6 | 14.5 | 52.6 |

Footnote: the driftbench figure for writing uses its opt-in reader-first setting (long-structured); the default setting scores 61.3.
<!-- readme-table:end -->

- Verify: Langfuse scores 0.9 points above driftbench. On the paired items driftbench alone is right on 13 and Langfuse alone on 15 (raw p 0.85).
- Writing: the reader-first setting picks the longer reply on all 173 pairs, so its 67.6 equals a longer-reply rule.
- The verify column here is Claude Haiku 5.5 (driftbench 74.2, promptfoo 71.9). The 74.7 and 72.4 in [the public benchmark table](docs/comparison/methods.md) are GPT-6 Luna, a different model.
- A few items stay undecided after three passes because the model refused them. They count as wrong for the contestant. Undecided items: MM-Eval 3 to 7 per peer, RubricBench 1 each for DeepEval and Langfuse.
- Inspect and Langfuse scores on RubricBench and writing are low because a pointwise grader returns equal scores for many pairs, and a tie counts as wrong.

Per benchmark tables with paired counts, p values and spend: [JudgeBench](docs/comparison/benchmarks/judgebench-all-peers.md), [MM-Eval](docs/comparison/benchmarks/mmeval-all-peers.md), [RubricBench](docs/comparison/benchmarks/rubricbench-all-peers.md), [verify](docs/comparison/benchmarks/verify-all-peers.md), [writing](docs/comparison/benchmarks/writing-all-peers.md). The sealed items are not committed. To rebuild them:

1. Run the RubricBench loader, `node --experimental-strip-types examples/all-peers-public/rubricbench-loader/load.mts <out.json>`. It downloads the RubricBench rows from Hugging Face (cached on disk), keeps the 790 sealed test ids listed in `test-ids.json` and writes them as JSON.
2. Run `python examples/all-peers-public/export.py --items-only --rubricbench-items <out.json>`. It rebuilds all five item files and checks each against the committed sha256.
3. Re-score offline with `python examples/all-peers-public/stats.py`.

### Verify v5: corrected confirmation

The verify candidate's primary result uses the 536 confirmation items whose normalized question text appears
in neither practice nor DEV. The original 544-item split leaked 8 practice questions and reused 32 practice
call references. The frozen manifest and decisions are preserved; the full result is a sensitivity analysis.
Scores are percent correct.

| Verify v5 analysis | driftbench-v5 | promptfoo | DeepEval | Inspect | Langfuse | LangWatch |
|---|---:|---:|---:|---:|---:|---:|
| Primary, 536 items without practice/DEV question overlap | 78.73 | 76.87 | 60.26 | 76.49 | 75.75 | 75.19 |
| Sensitivity, original 544 items including overlap | 78.86 | 77.21 | 60.85 | 76.84 | 75.92 | 75.18 |
| LJB TEST, 221 items | 76.02 | 75.57 | 58.82 | 73.30 | 75.11 | 73.30 |

On the 536 primary items, driftbench-v5 scores 78.73%; DeepEval scores 60.26%, a significant difference after exact paired tests
with Holm over the five peers. promptfoo (76.87%), Inspect (76.49%), Langfuse (75.75%) and LangWatch (75.19%) are within the
paired-test noise. The exclusion is a post-review correction using recorded decisions, with no new model calls. [Full results and exclusions](examples/verify-lead/RESULTS.md).

### What a judgement costs

<a href=".github/readme/judge-cost-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/judge-cost-dark.png">
    <img alt="Recorded USD per 100 cases, default-on-v7 over the Messages API against the recorded peer. Inspect, grader panel: 0.065 against 0.138. Inspect, panel on borderline cases: 0.067 against 0.125. Langfuse, Correctness template: 0.052 against 0.052. Inspect, model-graded QA: 0.073 against 0.062. Inspect, model-graded fact: 0.073 against 0.060." src=".github/readme/judge-cost-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub><a href="docs/comparison/methods.md#what-a-judgement-costs">How we measured</a></sub></p>

On Inspect's grader panel, default-on-v7 spends $0.065 per 100 cases against $0.138, and scores 54 of 60 against 59. Lower cost does not establish equal accuracy.

## How it compares

The capability matrix is [above](#what-makes-it-different). One page per tool, row by row:

| Tool | Page |
|---|---|
| promptfoo | [promptfoo](docs/comparison/promptfoo.md) |
| Inspect | [Inspect](docs/comparison/inspect.md) |
| DeepEval | [DeepEval](docs/comparison/deepeval.md) |
| Langfuse | [Langfuse](docs/comparison/langfuse.md) |
| LangWatch | [LangWatch](docs/comparison/langwatch.md) |

What driftbench does not do: retrieval metrics for RAG, promptfoo's catalogue of red-team plugins, a hosted platform with a team UI. → [how each row was checked](docs/comparison/methods.md#the-tool-by-tool-tallies)

## Status

Version 0.1.0 is on npm as [`@agent-nexus/driftbench`](https://www.npmjs.com/package/@agent-nexus/driftbench), with one package per part (`-core`, `-checks`, `-judges`, `-adapters`, `-stats`, `-store`, `-report`, `-generate` and more). Changes are listed in the [changelog](CHANGELOG.md).

Not built yet: judges loaded from the command line in `campaign run`, `driftbench ci` on your own process agent, the unit runner for code-agent guards, and a hosted UI. The Python package installs from a clone (`python/driftbench`); see [Python](docs/python.md).

## Docs

- **Start:** [docs index](docs/index.md) · [running](docs/running.md) · [spec reference](docs/reference/spec.md) · [CLI reference](docs/reference/cli.md)
- **Concepts:** [block](docs/concepts/block.md) · [run modes](docs/concepts/run-modes.md) · [drift](docs/concepts/drift.md) · [recovery](docs/concepts/recovery.md) · [judges](docs/concepts/judges.md) · [statistics](docs/concepts/statistics.md)
- **Guides:** [generating tests](docs/generating.md) · [testing a code agent](docs/estate.md) · [simulated users](docs/simulated-user.md) · [attacker](docs/attack.md) · [traces](docs/traces.md) · [datasets and prompts](docs/datasets.md) · [viewer and labels](docs/viewer.md) · [retries](docs/retries.md)
- **Evidence:** [comparison](docs/comparison.md) · [per-tool pages](docs/comparison/index.md) · [validators](docs/validators.md) · [comparisons folder](comparisons/README.md)

## Contributing

Issues and pull requests are welcome. The most useful contributions right now are specs, checks and adapters.

1. Fork the repo and run `pnpm install`.
2. Make your change with its tests, then run `pnpm lint`, `pnpm typecheck` and `pnpm test`.
3. Open a pull request. CI runs the same checks, the build, the docs checks and a leak guard. Keep every example synthetic: no real customer, prompt or conversation data.

Questions and ideas go in [GitHub issues](https://github.com/achammah/driftbench/issues). Report a vulnerability privately through [GitHub security advisories](https://github.com/achammah/driftbench/security).

## Licence

MIT. See [LICENSE](LICENSE).

<p>
  <a href="https://agent.nexus">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset=".github/readme/nexus-logo-white.svg">
      <img src=".github/readme/nexus-logo-ink.svg" alt="Nexus" height="24" />
    </picture>
  </a>
</p>

Made by [Nexus](https://agent.nexus). We built driftbench to test the agents we build, and we share it under MIT.
