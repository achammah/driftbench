# Live runs of the Northwind fixture, on a fake runtime

Everything here is fictional and written by hand. Nothing calls a model and nothing costs money.

- `fake/claude.mjs` is a stand-in for the runtime's headless command. It reads the ask from
  `-p <ask>` (or from its input with `--input-format stream-json`). By default, `fake/agent.mjs`
  derives its actions from the estate in its working folder: standing instructions, skills,
  helpers, settings and steps. It implements a limited instruction syntax, not a complete
  runtime or model. Its first lines carry the stand-in marker, so
  `driftbench estate run` lets it run without `--allow-billed`.
- The default fake gives each rule kind of an estate a behaviour, so that deleting a rule or writing its
  opposite changes what the fake does. An agent with no rule takes the shortest path; each rule rules out
  one shortcut:
  - a helper that sorts messages into named folders files each message by the folder name it holds, sends one
    that fits none where its rule says (and nowhere without the rule), and clears the messages it has filed
    unless the helper forbids deleting;
  - a standing line that forbids going on before a check step has passed makes the fake run that check step;
    without the line the fake skips a step that can send the flow back;
  - "pass the <field> to <script>" makes the fake pass the field's value from the table row of the
    identifier in the ask; a prohibition or no line leaves it out;
  - an output rule ("End with one line per <entity>: ...", "Answer with one JSON object") shapes the reply,
    a reversed rule does not;
  - a unit that lists its tools offers no other: "use the <Tool> tool" is refused for a tool it does not list;
  - an ordering clause whose later part names the unit's own work holds vacuously; one that names nothing the
    unit does stops the fake as unresolved.
  A tool that ran and failed leaves the actions that wait on it undone; the others go on. A refused action
  ends the work. `fake/rule-judge.cjs` is the matching stand-in judge: it reads the rule of the criterion
  and the actions of the run, and answers inconclusive for a rule it cannot read.
- Set `FAKE_MANIFEST` to opt into recorded playback for protocol tests. `fake/manifest.json`
  maps asks to streams under `fake/streams/`; stream paths are relative to the manifest.
  Besides stream records, a stream holds directives the fake performs: a guard row, a step row,
  a file write or a file edit in the workspace.
- In playback mode, a manifest entry can name `unless` cases. When the estate copy no longer
  holds a quote, the case's stream plays instead. These cases require `FAKE_MANIFEST`;
  default execution derives the changed behaviour from the estate itself.
- `states/library.json` maps each session state and estate hazard of the space map to runner
  operations; `states/prefixes/` holds the recorded session prefixes they plant.

Two recorded streams are planted faults: the misroute ask loads `supplier-email` instead of
`shipment-tracker`, and the carrier page ask calls `WebFetch`, which the settings deny.

Run the recorded protocol proof from the repository root, opting into its manifest:

```
pnpm -s driftbench estate run <the 14 specs> --estate examples/estates/fixture \
  --runtime claude-code --command examples/estates/fixture/live/fake/claude.mjs \
  --set-env "FAKE_MANIFEST=$PWD/examples/estates/fixture/live/fake/manifest.json" \
  --store <db> --map examples/estates/fixture/approved.yaml \
  --states examples/estates/fixture/live/states/library.json
```

The 14 specs are listed in `packages/cli/test/estate-live.test.ts`, one complete live spec per
test type of the generated suite.

Omit `--set-env FAKE_MANIFEST=...` and leave `FAKE_MANIFEST` unset to use the default estate-derived
behaviour. The recorded faults and `unless` alternatives do not run in that mode.
