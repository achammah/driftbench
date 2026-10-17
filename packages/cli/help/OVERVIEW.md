driftbench: test an AI agent the way you unit test code

driftbench evaluates AI agents, chat assistants and code agents, one exchange at a time.
A test, the spec, is a YAML file: a target agent and a list of blocks.
A block is one exchange: a Given (the state before), a When (the user turn), a Then (what must hold).
driftbench runs specs on the agent, checks every block, and keeps every run in a store, a SQLite file.
Results compare across agent versions with statistics, so a change ships only when it does no harm.

The mental model, in the order you work

1. Map      what situations the agent can face: behaviours, flows, deviations, channels
2. Tests    specs that cover the map, written by hand, imported, or generated and gated
3. Run      campaigns: every spec on a target, in a run mode (T teacher-forced, F free-running,
            P perturbed), with repeats
4. Checks   machine checks on every block (tools, text, stages, end state), and judges for what
   Judges   needs judgement (criteria scored by a council of models, calibrated on hand labels)
5. Results  scorecards, comparison with a baseline, a CI gate, drift monitoring, a local viewer

Commands by task

Map the agent
  driftbench extract     propose the map of situations from a prompt and an inventory
  driftbench space       the approved map, and coverage counted on it
  driftbench estate      read an agent estate (prompts, skills, tools) into atoms and a map
  driftbench intake      the reference set of real user turns: from logs or an interview

Write and grow the tests
  driftbench spec        validate, lint and measure coverage of spec files
  driftbench import      specs from a CSV file, a spreadsheet, or recorded traces
  driftbench generate    specs from the approved map, by code
  driftbench gate        keep only candidate blocks that pass the nine-stage validity gate
  driftbench select      choose the golden set: the fewest conversations covering the map
  driftbench holdout     seal a share of the gated specs, score it once
  driftbench family      code-agent task families built from a seed
  driftbench dataset     version spec sets in the store
  driftbench prompt      version prompts in the store

Run the agent
  driftbench campaign    plan, run, resume, inspect and export campaigns
  driftbench smoke       run one spec several times: is the agent deterministic?
  driftbench replay      re-run checks on recorded sessions; no agent call, a judge only with --judge
  driftbench perturb     run one spec with one deviation injected, and print the recovery
  driftbench simulate    run one spec with a simulated user playing a persona
  driftbench attack      attack one spec adaptively, deviation by deviation
  driftbench redteam     multi-turn attackers (Crescendo, GOAT); red-team plugins: generate, grade
  driftbench pilot       measure where results vary, and set the noise floor

Judge
  driftbench judge       run, check and calibrate judged criteria
  driftbench queue       the review queue of blocks for people to label

Read and gate the results
  driftbench report      the scorecard of a campaign, as HTML and JUnit XML
  driftbench compare     a candidate campaign against a baseline: non-inferior or not
  driftbench ci          run, compare and gate in one step, for CI
  driftbench monitor     watch a metric across campaigns for drift
  driftbench radius      the blocks a change can affect: rerun only those
  driftbench view        a local viewer of a store, with hand labels

Prove driftbench itself works
  driftbench validate    run a validator ladder

Start here

  driftbench help core-getting-started   install, then run the Acme example: no model, no key
  driftbench help recipes                each goal end to end: pick yours from the recipes area below
  driftbench help core-reading-help      how every topic is laid out, and how to find one
  driftbench help redteam-overview       red-team an agent: which command, every option, a CI example
