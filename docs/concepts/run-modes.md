# Run modes

One spec runs three ways, whether it describes a conversation or a task. Each mode answers a different question about the same blocks.

| Mode | What block k starts from | What it isolates | Status |
|---|---|---|---|
| T, teacher-forced | its canonical Given: the spec's own earlier blocks, as written | local competence: each block alone, with no earlier error carried in | built, phase 3 |
| F, free-running | the agent's own earlier output, with the user turns scripted | compounding: one wrong block can poison the blocks after it | built, phase 1 |
| P, perturbed | a free-running run with a deviation injected at a chosen block | recovery: whether the agent comes back, how fast, and at what cost | built, phase 3, with the perturbing driver and simulated user |

Run records carry the mode as `T`, `F` or `P`. `runSpec` runs all three, and a campaign plans and runs cells in any of them: `--mode T,F,P`. See [running](../running.md).

## Teacher-forced

Each block opens its own session from its canonical Given, never from what the agent said in the blocks before. Blocks become independent samples: a block run N times from its Given gets its own pass rate, free of the blocks before it. One exception keeps a task runnable: on an adapter with a sandbox, a block keeps the session of the block before, so it starts from the workspace that block left, and only its history is replaced by the canonical prefix. See [tasks](#tasks-run-in-the-same-three-modes).

The canonical Given of block k is built from the spec alone:

* Ledger, world and vars: the spec's `given`, then each block's own `given` up to and including block k, merged as in a free-running run. The ledger also holds the `ledger_add` facts of every earlier block.
* Prefix: the latest `given.prefix` that a block up to k writes (empty when none does), then, for each block from there to block k minus 1, its user message or messages and a canonical assistant message.
* Block 0, and any block with no earlier block in its prefix, has an empty prefix. It starts from its own user message only.
* The canonical assistant message has empty text: the spec format holds no reply text. It carries the tool calls the block expects (each as many times as its count asks, its `min` for a range, once with no count), with the input fields the spec pins to an exact value, and the result or error that the spec's world forces for that tool at that block.

The checks of a T block see no earlier block: their history is empty. The stage before a T block, for the [classifier of stages](drift.md#the-stage-classifier), is the last stage an earlier spec block expects. A driver that injects a block in mode T fails the run: teacher-forced mode runs the spec's own blocks only.

The end state of a T run is composed over the blocks. Each block's session is read after the block; a source keeps the last value a block's session recorded, and the source `*` (for `end_state: none`) joins the payload lists in block order. The last block's checks and the run compare that composed state.

An agent that reads its own earlier replies, such as a language model, sees blank assistant turns in a T prefix. A field for the canonical reply text is not in the spec format.

What the agent sees of a canonical call depends on the adapter:

* An adapter that hands the history to your code (`function`) passes each call as it is. A call whose tool the world does not force has no result; the Acme agent reads such a tool again from its store.
* An adapter that sends the history to a model (anthropic, google, http, litellm, langgraph, openai-agents, pydantic-ai, vercel-ai) sends a call with the result or error the world forces. For a call with no result it never sends `null`: it sends this text as the call's result, so the model reads that the result is unknown, not that the tool returned nothing:

  > Not recorded: this earlier call comes from a replayed conversation that states the call, with only the arguments it fixes, and not what it returned.

  To give the agent a real result instead, force the tool's result or error in the spec's `world.tools`.
  The same rule applies outside mode T to any history call with neither an output nor an error. An SDK adapter's own loop always records one of the two, so this happens only when an http endpoint answers with an Observed that holds a `tool_call` segment and no matching `tool_result`: the next request of that run carries the note.
* The call's arguments are only the input fields the spec pins to an exact value. A field pinned with a pattern (`regex`, `contains`) is left out, so such a call goes out with fewer arguments, or none.

## Free-running

One session runs the whole conversation. The user turns come from the spec; the agent's turns are its own, and each block inherits them. An early mistake stays in the context of every later block.

A failing block does not stop the run. The runner still sends, judges and records every later block. Only a block the target cannot set up stops the later blocks: they are `not_run`. See [outcomes](../running.md#outcomes).

## Perturbed

A free-running run with one deviation injected before a chosen block. Recovery metrics are on. See [recovery](recovery.md).

The driver that injects the deviation is the perturbing driver of `@agent-nexus/driftbench-users` (`createPerturbingDriver`). It wraps another driver (the scripted driver by default) and injects one deviation once, before block `inject_at`: a perturbation the spec declares, one written out, or one of the ten classes drawn from a red-team pack by class, position and seed (`driftbench perturb`). `campaign run` uses it for every P cell. `injectingDriver` of `@agent-nexus/driftbench-core` keeps the same rule for a spec's own perturbations, from code:

* A perturbation that writes `user` or `burst` is a block of its own, sent before block `inject_at`. The run has one block more than the spec.
* A perturbation that writes only a `world`, such as a tool forced to fail, runs under its own block: the injected block sends block `inject_at`'s own stimulus with the perturbation's world and expectations, and stands in for that block. The base driver resumes at the block after it, so the run has as many blocks as the spec.

The simulated user of `@agent-nexus/driftbench-users` (`createSimulatedUser`) writes the user turns with a model, from a persona and a goal. `driftbench simulate` runs one spec with a persona, and `campaign run --driver simulated` uses it across campaign cells.

In mode P the spec's end state describes the unperturbed run, so it is neither read nor compared.

## The compounding index

Run the same spec in T and in F mode. The compounding index is the T pass rate minus the F pass rate, over the spec blocks both modes ran. High T with low F means the agent is right block by block and fragile across the succession. Only F shows it.

`compoundingIndex(runs, { interval })` of `@agent-nexus/driftbench-core` computes it per spec and target:

* A block's pass rate in a mode is the share of the mode's runs, among those that reached the block, where the block passed. Blocks a driver injected are left out; runs in mode P are ignored.
* The index of a spec is the mean, over the shared blocks, of the T rate minus the F rate.
* The interval function is passed in. `campaign status --detail` passes the clustered bootstrap of `@agent-nexus/driftbench-stats`: the block is the resampling unit within a spec, and the spec is the unit across the campaign. A campaign with one spec gets no interval on its overall index: one spec is one cluster.

The Acme agent is deterministic and right in every block, so its index is 0 on every spec (see the output under [running](../running.md#campaign-status---detail)). The same command on a copy of the Acme agent that loses the thread once it has written three replies of its own, the agent of the CLI's own `--detail` test, prints this table for `acme-plan-upgrade` in T, F and P:

```
Compounding index: the T pass rate minus the F pass rate over the blocks both modes ran. 95% interval: clustered bootstrap (blocks within a spec, specs across).
  spec               target         blocks  runs T/F  T       F      index  interval
  acme-plan-upgrade  function:acme  5       1/1       100.0%  60.0%  +40.0  [0.0, +80.0]
  all specs                         5                 100.0%  60.0%  +40.0
```

T passes all five blocks: each starts from the canonical prefix, whose assistant turns are blank. F fails blocks 3 and 4, from the agent's own third reply on.

## Tasks run in the same three modes

* T: each step starts from the state the reference trajectory had at that step. Its history is the canonical prefix: the earlier steps as written, never the agent's own replies. Its workspace is the one the step before left, in the same sandbox; a step that writes its own `given.world.workspace` starts instead from a fresh workspace with exactly that. The first step starts from the spec's `workspace_seed`. The Acme price-sheet task writes no workspace on its second step, so the summary step finds the workbook the build step made and passes in all three modes:

  ```
  $ pnpm -s driftbench campaign run examples/acme/specs/tasks/price-sheet.yaml --mode T,F,P
  Campaign c-2764042aa240: 3 cells, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
  Not judged: 2 criteria in 3 blocks of 1 spec (sheet_matches_catalog, reports_what_it_did), 1 of them gating. This campaign loads no judge, so these criteria have no verdict and count in no pass or fail. See docs/concepts/judges.md.
  ✓ acme-price-sheet · process:acme-ops · T · repeat 0  pass  2 blocks
  ✓ acme-price-sheet · process:acme-ops · F · repeat 0  pass  2 blocks
  ✓ acme-price-sheet · process:acme-ops · P · repeat 0 · instruction-in-notes  pass  2 blocks
  3 cells: 3 pass, 0 fail, 0 failed. Spent $0.00.
  The runs are not kept: pass --store <file> to keep them.
  ```

  The workspace a step inherits in T is the one the agent made on the step before, so a wrong workbook carries into the next step, as in F. To pin the state a step starts from, write it into that step's `given.world.workspace`; `from` names a folder, which also holds binary files such as a workbook.
* F: each step starts from the workspace the agent itself left behind.
* P: a deviation is injected into the task. The perturbing driver runs any perturbation the spec writes, such as the workspace file above that carries an instruction (`instruction-in-notes`, a world-only perturbation that runs under its own step), and draws a deviation of a class from the red-team pack.

## Around the modes

These parts of the runner serve every mode. They are described on the [running](../running.md) page.

* Repeats: a campaign runs each spec several times. One run proves nothing; [statistics](statistics.md) turns repeats into claims.
* Cache: an observed block is reused when the spec's content hash, the repeat, the block's position, its whole resolved Given, its stimulus, the target and the adapter's version are the same. The spec's `version` is a free label and plays no part. A run replays only when every block and end-state read is in the cache. A run on an adapter that makes sandboxes is never cached.
* Budget: a hard stop on spend over a campaign; no cell starts once the spend reaches it. `runCampaign({ earlyStop: true })` stops a spec early: once repeats 0 and 1 of a spec in mode F both fail a gating machine check, its later F repeats are not run. They come back as `stopped` with `earlyStop: { after: 2 }`, and no run is stored for them. A spec that passes repeat 0 or 1 runs every repeat. The command line has no flag for it yet.
* Determinism: `driftbench smoke` runs a spec several times, three by default, with the cache off and reports whether the transcripts differ.
* Resume: `campaign resume` reuses the completed runs of a stored campaign and runs the rest.
* Retries: transport errors are retried with backoff. A run the agent fails is recorded as failed, never skipped.
