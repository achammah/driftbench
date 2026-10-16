---
title: Reach your agent by URL, endpoint or Nexus
summary: The http, litellm and nexus targets the command line reaches from a spec's target.options and environment variables alone. It covers every setting, the environment variables, the credential refusals, redirects and redaction.
commands:
  - campaign run
  - campaign plan
  - smoke
see_also:
  - running-targets
  - running-sdk-adapters
  - running-plugins
  - running-retries
  - running-store
next:
  - running-process-and-sandboxes
---

## What it is

Beside the Acme examples, the command line reaches three kinds of real agent with no code and no plugin. The settings are the `options:` of the spec's `target:`, in snake case. Where a spec gives none (as with `--target http:my-bot`), environment variables give the address.

* `http:<agent>`: an agent behind your own HTTP endpoint. Each block is one POST of JSON. The body holds `session`, `turn`, `model` (the agent name) and `messages`. The `messages` are the history so far in the OpenAI chat shape, ending with the block's user messages. The body also holds `stimulus`, `world`, `vars` and `target`. The endpoint answers with driftbench's Observed record or with an OpenAI-compatible chat completion. Tool calls it asks for are answered from the spec's world, up to `max_tool_rounds` rounds.
* `litellm:<model>`: a model behind a LiteLLM proxy or any OpenAI-compatible endpoint. Each request goes to `<base_url>/chat/completions`.
* `nexus:<agent id>`: an agent on the Nexus platform, reached through one of its deployments.

A key is never written in a spec: an option names the environment variable that holds it.

## When to use it

* Your agent runs as a web service: wrap it in an endpoint that speaks the http adapter's JSON, or answers chat completions.
* You test a bare model or a proxy: `litellm`.
* Your agent is deployed on Nexus: `nexus`.
* Your agent is a program you run: use a `process` target instead (topic running-process-and-sandboxes). Your agent is a Python or TypeScript object or an SDK agent: use a plugin or code (topics running-plugins and running-sdk-adapters).

## Commands and every option

These are spec settings, read by every command that runs a target (`campaign run`, `campaign plan`, `campaign resume`, `smoke`, `simulate`, `perturb`, `attack`, `ci`).

`http:<agent>`:

| `target.options` key | Default | Effect |
|---|---|---|
| `url` | `DRIFTBENCH_HTTP_URL` | the endpoint that answers one block. Required, from the spec or the environment. |
| `headers` | none | headers sent with every request, as plain strings. A header whose name looks like a credential (`authorization`, `cookie`, `api-key`, `token`, `secret`) is refused. |
| `headers_env` | none | a mapping of header name to the environment variable that holds its value, such as `{ authorization: MY_BOT_TOKEN }`. The variable must be set. Its value is treated as a secret. |
| `end_state_url` | none | where the end state of a session is read (enables `end_state` checks). A 404 there reads as nothing recorded. |
| `close_url` | none | told when a session closes. |
| `timeout_ms` | `120000` | the most milliseconds one request may take. |
| `max_tool_rounds` | `8` | the most rounds of tool calls a chat completion may ask for in one block. |
| `redirects` | refuse | `same-origin` follows a 307 or 308 to the same origin, at most 5 hops. Any other redirect fails the block. |
| `variants`, `tool_stubs`, `deterministic` | `false` | booleans: what the endpoint honours. `deterministic: true` makes `smoke` hold it to identical transcripts. |
| `debug_error_body` | `false` | unsafe: let the upstream error body into output and storage. Use only with test data. |

`litellm:<model>`:

| `target.options` key | Default | Effect |
|---|---|---|
| `base_url` | `LITELLM_BASE_URL`, then `OPENAI_BASE_URL` | the endpoint; requests go to `<base_url>/chat/completions`. Required. |
| `model` | the agent part of the target | the model name sent. |
| `api_key_env` | `LITELLM_API_KEY`, then `OPENAI_API_KEY` | the environment variable holding the key, sent as `authorization: Bearer <key>`. When named, it must be set. With the defaults, no key is sent when neither is set. |
| `system` | none | the system prompt. `campaign run --prompt` replaces it with the stored prompt text. |
| `max_tokens` | none | the `max_tokens` sent with each request. |
| `max_steps` | `8` | the most model calls (tool rounds) in one block. |
| `timeout_ms` | `120000` | per request. |
| `deterministic` | `false` | the endpoint claims identical answers to identical requests. |
| `debug_error_body` | `false` | unsafe, as above. |

`nexus:<agent id>`:

| Setting | Default | Effect |
|---|---|---|
| `target.deployment` | none | a deployment id of that agent. Required, in the spec, so a nexus target cannot come from `--target` alone. |
| `NEXUS_API_KEY` (environment) | none | the key. Required. |
| `NEXUS_BASE_URL` (environment) | `https://api.nexusgpt.io` | the API address. |
| `timeout_ms`, `generate_timeout_ms` | adapter defaults | per request, and for a generation. |
| `keep_conversations` | `false` | keep the conversations on the platform after the run. |
| `debug_error_body` | `false` | unsafe, as above. |

## Inputs

A spec target such as:

```text
target:
  adapter: http
  agent: my-bot
  options:
    url: https://bot.example.com/turn
    headers_env: { authorization: MY_BOT_TOKEN }
```

and the environment variables it names. Specs and target settings are stored as run inputs. The CLI therefore refuses three things before anything is stored. The first is credential header names in `headers`. The second is URLs with a user name, a password or a credential query field (`token`, `key`, `password`, `signature` and the like). Those URLs are refused in `url`, `base_url`, `end_state_url` or `close_url`. The third is any setting that contains the resolved key. Use the URL environment variable for a URL that must carry a credential.

## Outputs and how to read them

* Runs on these targets print like any other (topic running-outcomes).
* Failures never show upstream bodies, headers or transport details. A failed block reads `<host> answered <status>: target request failed; upstream body and headers are not shown; body length <n>`. It can also read `<host> transport failed: request or response transport failed; body length unknown`. The retry policy still sees the status and any Retry-After (topic running-retries).
* Successful replies are content and are stored. Before checks, output, the store and the cache see them, the adapter replaces its keys and `headers_env` values with `[redacted]`. It does this for the literal values and for percent, base64, base64url and hex forms. It also does it for two-level compositions of those, including `Bearer <key>` forms. This is best effort: a key split across fields or encoded otherwise can remain. `observed.raw.redactions` counts the replacements. Use test-scoped keys and treat the store as sensitive.

## Worked example

`campaign plan` resolves the target of the committed http example from its spec (it names `url`), without sending anything. The same chat spec forced onto `http:echo` or `litellm:my-model` with no settings is refused. No model is called and no network request is made.

```sh
driftbench campaign plan examples/http-target/specs/hello.yaml
driftbench campaign plan examples/acme/specs/conversations/plan-upgrade.yaml --target http:echo  # exit 2
driftbench campaign plan examples/acme/specs/conversations/plan-upgrade.yaml --target litellm:my-model  # exit 2
```

```text
No adapter is set up for http:echo. An http target needs its URL: set target.options.url in the spec, or DRIFTBENCH_HTTP_URL. The CLI reaches function:acme-sales (or function:acme), the Acme sales assistant, and process:acme-ops, the Acme ops agent. It also reaches http, litellm and nexus targets from the target.options of a spec.
```

```text
No adapter is set up for litellm:my-model. A litellm target needs the endpoint: set target.options.base_url in the spec, or LITELLM_BASE_URL. The CLI reaches function:acme-sales (or function:acme), the Acme sales assistant, and process:acme-ops, the Acme ops agent. It also reaches http, litellm and nexus targets from the target.options of a spec.
```

To run the http example for real, start its stand-in agent in another terminal with `node examples/http-target/server.mjs` (it listens on `http://127.0.0.1:8787/turn` and repeats the user). Then `driftbench campaign run examples/http-target/specs/hello.yaml` prints `✓ http-target-hello · http:echo · F · repeat 0  pass  1 block`. With `DRIFTBENCH_HTTP_URL=http://127.0.0.1:8787/turn` set, any spec runs on it with `--target http:echo`.

## Common errors

* `No adapter is set up for http:echo, the target of <spec>. Credentials cannot be stored in target options: use headers_env or api_key_env for keys, and the URL environment variable for a credential-bearing URL. ...` (exit 2) A credential header in `headers`, or a URL with a user name, password or credential query field. Move it to `headers_env`, `api_key_env` or `DRIFTBENCH_HTTP_URL`.
* `No adapter is set up for http:echo, the target of <spec>. An http target reads the header x-team from TEAM_TOKEN, which is not set. ...` (exit 2) Export the variable.
* `A litellm target reads its key from <VAR>, which is not set.` (exit 2) Export the variable `api_key_env` names.
* `A nexus target needs the agent id and target.deployment, a deployment id of that agent, in the spec.` (exit 2)
* `A nexus target reads its key from NEXUS_API_KEY, which is not set.` (exit 2)
* `! <spec> · http:echo · F · repeat 0  failed  send on block 0 failed after 4 attempts: AdapterTransportError: 127.0.0.1:8799 transport failed: request or response transport failed; body length unknown` (exit 1) The endpoint is down or the URL is wrong. Network failures are retried 4 times by default.
* A block fails with `redirects are refused` or `redirects to another origin or credentials are refused`: the endpoint redirected. Give the final URL, or `redirects: same-origin` for a 307 or 308 on the same origin.
* A `must` check fails on text holding `[redacted]`: the reply echoed a key, and the adapter replaced it.
* Two specs naming the same `http:<agent>` with different options: one adapter is made per target name, with the options of the first spec. Give each endpoint its own agent name.
