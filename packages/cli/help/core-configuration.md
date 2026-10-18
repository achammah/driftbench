---
title: Configuration and environment
summary: The project config driftbench.yaml and its five keys, and the environment variables that hold keys, read from files and never echoed.
commands: []
see_also:
  - core-global-options
  - core-project-layout
  - core-exit-codes
next:
  - core-project-layout
---

## What it is

driftbench takes its settings from three places, in this order of strength:

1. Flags on the command line. A flag always wins.
2. The project config: `driftbench.yaml` in the working folder, or the file `--config <file>` names.
3. Environment variables, for what must never be written in a file: API keys, and endpoints.

A spec never holds a key. A target names the environment variable that holds its key, and driftbench reads
the value at run time.

## When to use it

* To declare a campaign once and run it with a short command, in CI or on a laptop.
* To declare campaign-level criteria (`aggregates`) for `report` and `ci`.
* To give reviewers a score scale per criterion (`scales`) in `view`.
* To load your own code (`plugins`) in every command.
* To reach a real agent or a judge model: set its key in the environment.

## Commands and every option

The config is not a command: these commands read it.

| Command | Reads | Option |
|---|---|---|
| `campaign run`, `campaign resume` | `campaign` (run only), `prices`, `plugins` | `--config <file>`, default `driftbench.yaml`; `--prices <file>` replaces `prices` |
| `campaign plan` | `campaign` (targets, routes, modes, repeats, budget_usd, store), `plugins` | `--config <file>` |
| `ci` | `campaign` (routes, modes, repeats, concurrency, budget_usd, process_command, agent_version), `aggregates`, `plugins` | `--config <file>` |
| `report` | `aggregates`, `plugins` | `--config <file>` |
| `view` | `scales`, `plugins` | `--config <file>` |
| every other command | `plugins` | `--config <file>` when the command has it |

Without `--config`, `driftbench.yaml` is optional: a missing file means no settings. A `--config` file that
cannot be read is an error, exit 2.

The five top-level keys, all optional. Which command checks the rest of the file:

* `report` and `ci` read the whole file: any other top-level key is refused with its file and line, exit 2.
* `campaign run`, `campaign plan` and `view` read only their own key and pass over any other top-level key
  without a word, so a misspelled key such as `campagin:` is silently ignored there. Run `driftbench report`
  once on the file to have every top-level key checked.

* `campaign`: a map; each key is the flag of `campaign run` it stands for. `specs` (list of paths, used when
  the command line names no path and no `--dataset`), `dataset`, `prompts` (list), `targets` (list),
  `routes` (list of `tag=target`), `modes` (list of `T`, `F`, `P`), `repeats`, `agent_version`, `store`,
  `cache` (false is `--no-cache`), `cache_suite`, `concurrency`, `budget_usd`, `process_command`, `driver`
  (`scripted` or `simulated`), `personas`, `recordings`, `model` (true is a paid call), `agent_family`,
  `judge_families`, and `retry` with `max_attempts`, `base_delay_ms`, `max_delay_ms`. An unknown key or a
  value that does not fit exits 2 and names it, such as `driftbench.yaml: campaign.repeats`. A list flag
  such as `--target` replaces the whole list of the file. Paths are read from the working folder.
* `aggregates`: a list of `name:op threshold` strings, such as `pass-rate:>=0.8`. `--aggregate` with the same
  name replaces an entry; a new name adds one.
* `scales`: a map from criterion name to `{ min, max }`, numbers with min below max. Default scale 0 to 1.
* `plugins`: a list of module paths, relative to the config file, or package names.
* `prices`: a dated table of USD token prices by model, read by `campaign run` and `campaign resume` for
  `--budget-usd` when `--prices <file>` is not given. The format is in the running topics.

Environment variables driftbench reads:

| Variable | Read by | Holds |
|---|---|---|
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_BASE_URL` | the model port: `generate`, `extract`, `intake`, `estate`, `attack`, and `simulate` or `campaign run --driver simulated` with `--model` | key; model, default `claude-opus-5-5`; base URL, default `https://api.anthropic.com` |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL`, `OPENAI_FAMILY` | the model port when no Anthropic key is set | key; model, required; base URL, default `https://api.openai.com/v1`; family, optional |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_JUDGE_MODEL`, `ANTHROPIC_BASE_URL` | Anthropic judges, such as `redteam grade --judge anthropic` | key; judge model, required, no default; base URL |
| `OPENAI_API_KEY`, `OPENAI_JUDGE_MODEL`, `OPENAI_BASE_URL` | OpenAI judges, such as `redteam grade --judge openai` | key; judge model, required, no default (`OPENAI_MODEL` does not set it); base URL |
| `GEMINI_API_KEY` or `GOOGLE_API_KEY`, `GOOGLE_JUDGE_MODEL`, `GOOGLE_BASE_URL` | Google judges, such as `redteam grade --judge google` | key; judge model, required, no default; base URL |
| `OPENAI_DECISIONS_MODEL` | the OpenAI system 1 judge | model |
| `CLAUDE_JUDGE_MODEL` | the Claude command line judge | model |
| `JEV_URL`, `JEV_API_KEY`, `JEV_MODEL`, `JEV_ROUTE` | the Jev system 1 judge | endpoint; key; model, default `jev-latest`; route, `gateway` or `typesafe` |
| `DRIFTBENCH_HTTP_URL` | `http:<agent>` targets with no `target.options.url` | the URL |
| `LITELLM_BASE_URL`, then `OPENAI_BASE_URL` | `litellm:<model>` targets with no `base_url` | the endpoint |
| `LITELLM_API_KEY`, then `OPENAI_API_KEY` | `litellm` targets with no `api_key_env` | the key |
| the variable `api_key_env` names | `litellm` targets | the key |
| each variable `headers_env` names | `http` targets | a header value, such as a bearer token |
| `NEXUS_API_KEY`, `NEXUS_BASE_URL` | `nexus:<agent id>` targets | key; server, default the public API |
| `DRIFTBENCH_MAP_CACHE` | the estate commands, which keep JSON copies of parsed maps | a folder, or `off`; default `driftbench/map-cache` under the system temporary folder |

driftbench sets `DRIFTBENCH_COMMANDS_FILE`, `DRIFTBENCH_RUNTIME_FILE`, `DRIFTBENCH_HISTORY_FILE`,
`DRIFTBENCH_STIMULUS_FILE` and `DRIFTBENCH_WORKSPACE` for a process target's agent: they are for the agent
to read and write, not for you to set.

## Inputs

Keys come from files, never from the command line and never from a spec:

* Keep each key in its own file outside the repository, readable only by you: `chmod 600`.
* Load it into the environment of the one command that needs it, inside that command:
  `ANTHROPIC_API_KEY="$(cat ~/.secrets/anthropic.key)" driftbench <command>`. The key never reaches your
  shell history, a log or a committed file.
* Never `echo` a key, never print the environment, never paste a key into a spec, a config or an issue.
  To check a key is set, test that it is non-empty: `[ -n "$ANTHROPIC_API_KEY" ] && echo set`.
* In CI, store the key as a secret of the CI system and map it to the variable.

## Outputs and how to read them

The config prints nothing by itself. Its effect shows in the command it feeds: `campaign run` with a
`campaign` key prints the same cells the equivalent flags would.

What driftbench does with keys:

* A key read from the environment is a secret. Adapters replace it with `[redacted]` in replies, tool
  payloads, errors, the store and the cache, in plain and common encoded forms. Redaction is best effort:
  use a test-scoped key and treat the store as sensitive.
* A target whose options contain a key, a credential header name or a URL with credentials is refused
  before anything is stored: `Credentials cannot be stored in target options: use headers_env or api_key_env
  for keys, and the URL environment variable for a credential-bearing URL.`

## Worked example

`examples/acme/ci/campaign.yaml` declares the Acme campaign: the conversation specs on `function:acme-sales`,
modes T and F, two repeats, concurrency 2, and one aggregate.

```text
campaign:
  specs: [examples/acme/specs/conversations]
  targets: [function:acme-sales]
  modes: [T, F]
  repeats: 2
  concurrency: 2
aggregates:
  - pass-rate:>=0.8
```

```sh
driftbench campaign run --config examples/acme/ci/campaign.yaml --store acme.db
driftbench campaign run --config examples/acme/ci/campaign.yaml --mode F --repeats 1
driftbench campaign run --config missing.yaml # exit 2
```

```text
24 cells: 24 pass, 0 fail, 0 failed. Spent $0.00.
6 cells: 6 pass, 0 fail, 0 failed. Spent $0.00.
The runs are not kept: pass --store <file> to keep them.
Cannot read the config .../missing.yaml: ENOENT: no such file or directory, ...
```

The second run shows flags winning over the file: `--mode F --repeats 1` gives 6 cells instead of 24, and
without `--store` on the line or in the file, nothing is kept.

## Common errors

* `Cannot read the config <path>` (exit 2): the `--config` path is wrong.
* `<path>: campaign.<key>: ...` (exit 2): an unknown campaign key or a value of the wrong type.
* An unknown top-level key, or a bad `aggregates` entry, exits 2 and names the line under `report` and
  `ci`; `campaign run` ignores an unknown top-level key.
* `no model key: set ANTHROPIC_API_KEY, or OPENAI_API_KEY with OPENAI_MODEL`: a command needs the model
  port and no key is in the environment.
* `OPENAI_MODEL is not set: name the model the server should run`: an OpenAI-compatible key without a model.
* `A nexus target reads its key from NEXUS_API_KEY, which is not set.` (exit 2).
* `An http target needs its URL: set target.options.url in the spec, or DRIFTBENCH_HTTP_URL.` (exit 2).
* `Credentials cannot be stored in target options`: move the key to an environment variable and name it in
  `api_key_env` or `headers_env`.
