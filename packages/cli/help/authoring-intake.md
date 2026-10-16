---
title: Intake, the reference set of user turns
summary: 'Build the reference set of real user turns that generated and simulated turns are compared with. Build it from past conversations (`intake logs`, anonymised into a private folder) or from an owner interview (`intake interview`, `intake from-interview`). Then approve it (`intake approve`) and measure how close generated turns are (`intake fidelity`).'
commands:
  - intake logs
  - intake interview
  - intake from-interview
  - intake fidelity
  - intake approve
see_also:
  - authoring-map
  - authoring-extract
  - authoring-personas
  - authoring-users
  - authoring-import
next:
  - authoring-map
---

## What it is

The reference set is a list of user turns, each placed on a cell of the approved map (stage, intent, persona, language, channel). It says how real users write. Generated phrasings and simulated users are compared with it, so tests do not drift into turns no real user writes.

There are two ways to build it:

- **From past conversations** (`intake logs`): a JSON Lines file of conversations is anonymised by two privacy passes. The first pass uses rules and checksums. The second pass is independent and uses rules, a model, or both. Near-duplicates are dropped. Openings are clustered into intents (the map's intent values first). A spot-check sample is drawn for a person to read. Conversations flagged as failures go first. Everything is written to a private folder, which is refused inside a git work tree, so personal data never lands in a repository.
- **From an interview** (`intake interview` then `intake from-interview`): driftbench writes a questionnaire from the approved map. The owner answers it in place (personas, the share of each intent, example messages per stage, what users never say, languages, channels). Then driftbench enumerates the cells and weights them by the shares. It asks a model (or a recording) for more turns per cell, checking each one. The owner's own examples count too.

Nothing counts until a person approves it: `approval.yaml` holds one entry per turn with `approved: false`. `intake fidelity` then compares generated turns with the approved reference turns: cells, length, questions, vocabulary, copies. It measures; it never gates.

## When to use it

- Before relying on generated or simulated user turns: build the reference set once per agent.
- When you have past conversations: `intake logs`. When you have none: the interview.
- After changing the phrase bank or a persona: `intake fidelity` shows whether the new turns still look like real ones.

## Commands and every option

### driftbench intake logs

```
driftbench intake logs <file> --out <dir> [--map <file>] [--intent-dimension <id>] [--second-pass rules|model|both] [--provider <name>] [--spot-check <n>] [--seed <n>] [--dedup <cosine>] [--intent-threshold <cosine>] [--cluster-threshold <cosine>] [--force]
```

| Option | Meaning | Default |
|---|---|---|
| `<file>` (required) | The conversations, JSON Lines, one conversation per line. | none |
| `--out <dir>` (required) | The private folder for the set. Refused inside a git work tree. | none |
| `--map <file>` | The approved map: its intent values cluster the conversations. | none: intents are clustered from the openings alone |
| `--intent-dimension <id>` | The map dimension that names intents. | `flow`, then `intent` |
| `--second-pass <kind>` | The second privacy pass: `rules`, `model` (paid) or `both` (paid). | `rules` |
| `--provider <name>` | `anthropic` or `openai`, for `--second-pass model` or `both`. | the first whose key is set |
| `--spot-check <n>` | Conversations in the spot-check sample. | 20 |
| `--seed <n>` | Seed of the spot-check sample. | 1 |
| `--dedup <cosine>` | Near-duplicate threshold on the user text. | 0.95 |
| `--intent-threshold <cosine>` | How close an opening must be to take a map intent. | 0.1 |
| `--cluster-threshold <cosine>` | How close two other openings must be to share a new intent. | 0.3 |
| `--force` | Write into a folder that already holds files. | off |

Exit 0 when the set is written. Exit 1 when it is written but the model check failed on a conversation. Exit 2 on a usage or input error, or an output folder inside a git work tree (nothing written).

### driftbench intake interview

```
driftbench intake interview --map <file> --out <file> [--force]
```

| Option | Meaning | Default |
|---|---|---|
| `--map <file>` (required) | The approved map (a proposal or a space map). | none |
| `--out <file>` (required) | Where to write the questionnaire, YAML. | none |
| `--force` | Replace an existing file; the answers in it are lost. | off |

Exit 0 when written; 2 on a usage or input error.

### driftbench intake from-interview

```
driftbench intake from-interview <answers> --out <dir> [--map <file>] [--replay <file>] [--provider <name>] [--turns <n>] [--min-per-cell <n>] [--max-cells <n>] [--dry-run] [--force]
```

| Option | Meaning | Default |
|---|---|---|
| `<answers>` (required) | The answered questionnaire, YAML. | none |
| `--out <dir>` (required) | The folder for `reference.yaml` and `approval.yaml`. | none |
| `--map <file>` | The approved map. | the answers' `map` field |
| `--replay <file>` | Replay recorded answers instead of calling a model. Free. | none: a model is called (paid) |
| `--provider <name>` | `anthropic` or `openai`. | the first whose key is set |
| `--turns <n>` | Model-written turns, allocated over the cells by weight. | 40 |
| `--min-per-cell <n>` | The fewest model-written turns per cell. | 1 |
| `--max-cells <n>` | Refuse a plan with more cells than this. | 200 |
| `--dry-run` | Print the cells, their weights and the turns to request; call no model. | off |
| `--force` | Replace an existing set; its approvals are lost. | off |

Exit 0 when the set is written and every cell got its turns. Exit 1 when written but a cell failed or fell short (listed). Exit 2 on a usage or input error (nothing written).

### driftbench intake fidelity

```
driftbench intake fidelity --reference <set> --candidate <turns> [--dims <list>] [--threshold <cosine>] [--include-unapproved] [--json]
```

| Option | Meaning | Default |
|---|---|---|
| `--reference <set>` (required) | The reference set: a folder, its `reference.yaml`, or a turns file. | none |
| `--candidate <turns>` (required) | The generated turns: JSON Lines, or a YAML or JSON list, of `{ text, cell }` (`cell`: dimension to value). | none |
| `--dims <list>` | The cell dimensions to compare on, comma separated. | the dimensions both sides share |
| `--threshold <cosine>` | The near-duplicate threshold. | 0.9 |
| `--include-unapproved` | Count reference turns no person has approved, marked in the output. | off: approved turns only |
| `--json` | Print one JSON document. | off |

Exit 0 when the comparison is printed; 2 on a usage or input error.

### driftbench intake approve

```
driftbench intake approve <approval> [--all]
```

| Option | Meaning | Default |
|---|---|---|
| `<approval>` (required) | The approval file, `approval.yaml`. | none |
| `--all` | Approve every turn and print the count. | off: list the turns not approved |

Exit 0 after listing or approving; 1 when the approval file is invalid; 2 when the file is not found. A person can also set `approved: true` on single turns in the file.

## Inputs

### A conversation line (`intake logs`)

`{"id": "c-001", "turns": [{"role": "user", "text": "..."}, {"role": "agent", "text": "..."}], "flags": ["complaint"], "channel": "chat", "lang": "en"}`

| Key | Type | Required | Meaning |
|---|---|---|---|
| `turns` | list of `{ role, text }`, at least 1 | yes | `role` is `user`, `agent` or `assistant` (read as agent). |
| `id` | string | no | The conversation id; a repeated id is replaced by `line-<n>`. |
| `flags` | list of strings | no | `negative_feedback`, `incident`, `error`, `escalation` or `complaint` mark a failure, read first. |
| `channel`, `lang` | string | no | The channel and language. |

### The questionnaire (`intake interview`, answered for `from-interview`)

| Key | Required | Meaning |
|---|---|---|
| `version` (`1`), `agent`, `map` | yes | The format, the agent, the map path relative to the file. |
| `personas` | yes | Each `id`, `description`, `share`, `languages`, `channels`, and optional `map` (persona dimension values) and `tone`. |
| `intents` | yes | Each `value` (an intent of the map), `share`, optional `personas`. |
| `examples` | yes | Each `stage`, `intent`, `persona`, optional `lang` and `channel`, and `turns`: what this user writes next at this stage. |
| `never` | no | Each `text`, and optional `match`: words a generated turn must never hold. |
| `tone` | no | How users write in general. |
| `languages` | yes | Each `lang` and `share`, optional `map`. |
| `channels` | yes | Each `value` (a channel of the map) and `share`. |

A `share` written `null` is an unanswered question. The Acme answers are `examples/acme/reference/answers.yaml`, and `examples/acme/reference/recorded.yaml` holds recorded model answers for `--replay`.

## Outputs and how to read them

- `intake logs` writes `conversations.jsonl` (the anonymised conversations), `reference-turns.jsonl` (the user turns with their cells), `spot-check.yaml` (read each one and set `clean`) and `intake-report.json`. It prints the counts of each privacy pass (what was redacted, and how many values were reserved fictional data). It prints the residual flags (what the second pass found that the first missed: read those). It prints the intents seen and new, and how complete the sample is (the chance the next conversation shows a new intent).
- `intake interview` writes the questionnaire and prints the next command.
- `intake from-interview` writes `reference.yaml` (cells with weights, requested and accepted turns, and each turn with its origin) and `approval.yaml`. `--dry-run` prints each cell with its weight and the turns to request.
- `intake approve` lists each unapproved turn (id, origin `interview` or `model`, cell, text), or prints the approved count.
- `intake fidelity` prints the total variation between the two cell distributions and the cells that differ most. It prints length in words and the question rate, each with a two-sample KS test. It prints vocabulary overlap, and the share of candidate turns that copy a reference turn. Under 30 turns on a side every number is rough.

## Worked example

Write four fictional past conversations and three generated turns to compare. Build a private set from the logs, then write the questionnaire. Build the Acme reference set from the recorded interview answers (no model call). Approve it, and compare the candidate turns with it:

```jsonl file=out/logs.jsonl
{"id": "c-001", "turns": [{"role": "user", "text": "Hi, I keep running out of data on my phone, can I get a bigger plan?"}, {"role": "agent", "text": "Sure. What is the email on your account?"}, {"role": "user", "text": "it's jo.doe@example.com"}], "channel": "chat"}
{"id": "c-002", "turns": [{"role": "user", "text": "Do you have fiber at 12 Elm Street, Acmeville?"}, {"role": "agent", "text": "Let me check that address."}], "channel": "chat"}
{"id": "c-003", "turns": [{"role": "user", "text": "Hi, I keep running out of data on my phone, can I get a bigger plan?"}], "channel": "whatsapp"}
{"id": "c-004", "turns": [{"role": "user", "text": "I want to switch to Acme and keep my number +1 202 555 0147"}, {"role": "agent", "text": "I can check that."}], "flags": ["complaint"], "channel": "chat"}
```

```yaml file=out/candidate.yaml
- text: my data always runs out, any bigger plan?
  cell: { stage: needs, flow: upgrade, channel: chat }
- text: Do you cover 88 Summit Avenue?
  cell: { stage: address, flow: new-home, channel: chat }
- text: can I keep my old number
  cell: { stage: needs, flow: porting, channel: chat }
```

```sh
driftbench intake logs out/logs.jsonl --out out/private --map examples/acme/map/approved.yaml --spot-check 2
driftbench intake interview --map examples/acme/map/approved.yaml --out out/questions.yaml
driftbench intake from-interview examples/acme/reference/answers.yaml --map examples/acme/map/approved.yaml --out out/reference --dry-run --turns 30
driftbench intake from-interview examples/acme/reference/answers.yaml --map examples/acme/map/approved.yaml --out out/reference --replay examples/acme/reference/recorded.yaml --turns 30
driftbench intake approve out/reference/approval.yaml
driftbench intake approve out/reference/approval.yaml --all
driftbench intake fidelity --reference out/reference --candidate out/candidate.yaml --dims stage,flow,channel
```

```text
$ driftbench intake logs out/logs.jsonl --out out/private --map examples/acme/map/approved.yaml --spot-check 2
Wrote the private set to out/private: conversations.jsonl, reference-turns.jsonl, spot-check.yaml, intake-report.json.
  Conversations: 4 read, 0 near-duplicates dropped, 4 kept, 1 flagged as failures.
  Pass 1 (rules and checksums): 3 redacted: address 1, email 1, phone 1; 2 of them reserved fictional data.
  Pass 2 (independent rules): 0 more redacted: none.
  Residual flags: 0 conversations where the second pass found what pass 1 missed.
  Intents on flow: 3 seen, 3 from the map and 0 new.
  Discovery (Good-Turing f1 / n): f1 = 2, f2 = 1, n = 4. The chance that the next conversation shows an intent not seen yet is about 50 percent; sample coverage (Chao) about 63 percent.
  Spot check: 2 conversations drawn with seed 1; read spot-check.yaml and set clean on each.
(exit 0)
$ driftbench intake interview --map examples/acme/map/approved.yaml --out out/questions.yaml
Wrote out/questions.yaml: the interview for acme. Answer every question in place, then run driftbench intake from-interview out/questions.yaml --map examples/acme/map/approved.yaml --out <folder>.
(exit 0)
$ driftbench intake from-interview examples/acme/reference/answers.yaml --map examples/acme/map/approved.yaml --out out/reference --dry-run --turns 30
Cells: 20, 34 model turns to request, 0 cells dropped by the map.
  stage=needs flow=upgrade persona=upgrader first_message=step-by-step plan_choice=names-one user_type=existing-customer language=english channel=chat lang=en  weight 0.0875  turns 3
  stage=needs flow=upgrade persona=upgrader first_message=step-by-step plan_choice=names-one user_type=existing-customer language=english channel=whatsapp lang=en  weight 0.0375  turns 1
  stage=identify flow=upgrade persona=upgrader first_message=step-by-step plan_choice=names-one user_type=existing-customer language=english channel=chat lang=en  weight 0.0875  turns 3
  stage=identify flow=upgrade persona=upgrader first_message=step-by-step plan_choice=names-one user_type=existing-customer language=english channel=whatsapp lang=en  weight 0.0375  turns 1
  stage=offer flow=upgrade persona=upgrader first_message=step-by-step plan_choice=names-one user_type=existing-customer language=english channel=chat lang=en  weight 0.0875  turns 3
  stage=offer flow=upgrade persona=upgrader first_message=step-by-step plan_choice=names-one user_type=existing-customer language=english channel=whatsapp lang=en  weight 0.0375  turns 1
  stage=recap flow=upgrade persona=upgrader first_message=step-by-step plan_choice=names-one user_type=existing-customer language=english channel=chat lang=en  weight 0.0875  turns 3
  stage=recap flow=upgrade persona=upgrader first_message=step-by-step plan_choice=names-one user_type=existing-customer language=english channel=whatsapp lang=en  weight 0.0375  turns 1
  stage=needs flow=new-home persona=home-mover first_message=says-everything plan_choice=names-one user_type=new-customer language=english channel=chat lang=en  weight 0.0712  turns 2
  stage=needs flow=new-home persona=home-mover first_message=says-everything plan_choice=names-one user_type=new-customer language=other-language channel=chat lang=nl  weight 0.0037  turns 1
  stage=address flow=new-home persona=home-mover first_message=says-everything plan_choice=names-one user_type=new-customer language=english channel=chat lang=en  weight 0.0712  turns 2
  stage=address flow=new-home persona=home-mover first_message=says-everything plan_choice=names-one user_type=new-customer language=other-language channel=chat lang=nl  weight 0.0037  turns 1
  stage=offer flow=new-home persona=home-mover first_message=says-everything plan_choice=names-one user_type=new-customer language=english channel=chat lang=en  weight 0.0712  turns 2
  stage=offer flow=new-home persona=home-mover first_message=says-everything plan_choice=names-one user_type=new-customer language=other-language channel=chat lang=nl  weight 0.0037  turns 1
  stage=details flow=new-home persona=home-mover first_message=says-everything plan_choice=names-one user_type=new-customer language=english channel=chat lang=en  weight 0.0712  turns 2
  stage=details flow=new-home persona=home-mover first_message=says-everything plan_choice=names-one user_type=new-customer language=other-language channel=chat lang=nl  weight 0.0037  turns 1
  stage=needs flow=porting persona=switcher first_message=step-by-step plan_choice=asks-for-callback user_type=new-customer language=english channel=chat lang=en  weight 0.0500  turns 2
  stage=port_number flow=porting persona=switcher first_message=step-by-step plan_choice=asks-for-callback user_type=new-customer language=english channel=chat lang=en  weight 0.0500  turns 2
  stage=offer flow=porting persona=switcher first_message=step-by-step plan_choice=asks-for-callback user_type=new-customer language=english channel=chat lang=en  weight 0.0500  turns 1
  stage=details flow=porting persona=switcher first_message=step-by-step plan_choice=asks-for-callback user_type=new-customer language=english channel=chat lang=en  weight 0.0500  turns 1
(exit 0)
$ driftbench intake from-interview examples/acme/reference/answers.yaml --map examples/acme/map/approved.yaml --out out/reference --replay examples/acme/reference/recorded.yaml --turns 30
Wrote out/reference/reference.yaml and out/reference/approval.yaml: 53 turns (19 from the owner's examples, 34 from lane claude-opus-5-5 as the intake lane, by hand) in 20 cells, none approved.
  Model calls: 20. Turns refused by the checks: 0.
Next: read approval.yaml and set approved: true on the turns you accept, or run driftbench intake approve out/reference/approval.yaml --all.
(exit 0)
$ driftbench intake approve out/reference/approval.yaml
out/reference/approval.yaml: 53 of 53 turns are not approved yet.
  t-0001  interview  stage=needs flow=upgrade persona=upgrader first_message=step-by-step plan_choice=names-one user_type=existing-customer language=english channel=chat lang=en
      "i need more data"
  t-0002  interview  stage=needs flow=upgrade persona=upgrader first_message=step-by-step plan_choice=names-one user_type=existing-customer language=english channel=chat lang=en
      "can i upgrade my plan? always run out by the 20th"
  t-0003  model  stage=needs flow=upgrade persona=upgrader first_message=step-by-step plan_choice=names-one user_type=existing-customer language=english channel=chat lang=en
      "hey, my data runs out every month, what can you do?"
  t-0004  model  stage=needs flow=upgrade persona=upgrader first_message=step-by-step plan_choice=names-one user_type=existing-customer language=english channel=chat lang=en
      "want a plan with more gb"
  (95 more lines)
      "Robin Vale, robin.vale@example.com"
  t-0053  model  stage=details flow=porting persona=switcher first_message=step-by-step plan_choice=asks-for-callback user_type=new-customer language=english channel=chat lang=en
      "Taylor Brooks, taylor.brooks@example.com"
Set approved: true on each turn you accept, or approve every turn with --all.
(exit 0)
$ driftbench intake approve out/reference/approval.yaml --all
Approved 53 turns in out/reference/approval.yaml; 0 were already approved.
(exit 0)
$ driftbench intake fidelity --reference out/reference --candidate out/candidate.yaml --dims stage,flow,channel
Reference out/reference: 53 turns, approved only (0 not approved, left out). Candidate out/candidate.yaml: 3 turns.
  Cells on stage, flow, channel: total variation 0.755; 16 cells in the reference, 3 in the candidate, 0 of them never in the reference.
    stage=needs flow=porting channel=chat  reference 5.7 percent, candidate 33.3 percent
    stage=address flow=new-home channel=chat  reference 9.4 percent, candidate 33.3 percent
    stage=needs flow=upgrade channel=chat  reference 9.4 percent, candidate 33.3 percent
    stage=identify flow=upgrade channel=chat  reference 9.4 percent, candidate 0.0 percent
    stage=needs flow=new-home channel=chat  reference 9.4 percent, candidate 0.0 percent
  Length in words: KS 0.396 against 0.806 (n = 53, m = 3): no difference shown at the 5 percent level. Medians 6 and 6.
  Question rate: KS 0.403 against 0.806: no difference shown at the 5 percent level. Rates 26.4 percent and 66.7 percent.
  Vocabulary: Jaccard 0.094 over 168 and 19 word types; 85.0 percent of candidate words appear in the reference.
  Near-duplicates (character n-gram TF-IDF cosine at least 0.9): 0.0 percent of candidate turns copy a reference turn; 0.0 percent repeat another candidate turn, against 3.8 percent within the reference.
  Small samples: under 30 turns on a side, every number above is rough.
(exit 0)
```

The logs run found three personal values (an address, an email, a phone), two of them reserved fictional data; the complaint went first. Approving every turn at once is for the demo: on a real set, read each turn.

## Common errors

These three were run as shown (the first inside a clone of the repository, the others in a folder holding the candidate file above):

```text
$ driftbench intake logs examples/acme/reference/answers.yaml --out out/private
Refused: out/private is inside the git work tree <repo>. Past conversations never enter a repository: choose a private folder outside any git work tree.
(exit 2)
$ driftbench intake from-interview examples/acme/reference/answers.yaml --out out/ref2
no model key: set ANTHROPIC_API_KEY, or OPENAI_API_KEY with OPENAI_MODEL. Pass --replay <file> to replay recorded answers.
(exit 2)
$ driftbench intake fidelity --reference examples/acme/reference --candidate out/candidate.yaml
The reference examples/acme/reference has no approved turn (53 wait for approval).
(exit 2)
```

| Message or symptom | Cause | Fix |
|---|---|---|
| `intake logs` refuses the output folder | `--out` is inside a git work tree | choose a private folder outside any repository |
| a line of the log file is refused | the line is not JSON, or misses `turns` | one conversation per line, with `turns` |
| `no model key` with `from-interview` | neither `ANTHROPIC_API_KEY` nor `OPENAI_API_KEY` with `OPENAI_MODEL` | pass `--replay <file>` or `--dry-run`, or set a key |
| a cell `fell short` and exit 1 | the model (or the recording) gave fewer accepted turns than requested | read the refused turns in `reference.yaml`; add a recording answer, or more examples |
| a plan over `--max-cells` | too many personas, languages or channels combined | answer with fewer, or raise `--max-cells` |
| `has no approved turn` from `fidelity` | no turn of the reference is approved | run `intake approve`, or pass `--include-unapproved` |
| an existing file or set | earlier output | `--force` (its answers or approvals are lost) |
