---
title: Retries of agent and model calls
summary: Which failures a run retries (408, 429, 5xx, network errors) and with what backoff. How to set attempts and waits in a spec's target.retry or with --retry-attempts, --retry-base-ms and --retry-max-ms. Where each retry is recorded.
commands:
  - campaign run
  - campaign resume
see_also:
  - running-campaign-run
  - running-outcomes
  - running-targets-from-settings
  - running-cells-and-repeats
  - running-campaign-config
next:
  - running-campaign-config
---

## What it is

Model APIs and agent endpoints fail for a moment: a rate limit, an overloaded provider, a dropped connection. The runner retries these failures under one shared policy around every adapter call (`open`, `send`, `trace`). The adapters that call a model themselves retry each model call under the same policy. A run never retries an answer it did not like, and every retry is recorded. When the attempts run out, the run ends `failed` with the error, and `campaign resume` can run the cell again later.

| Failure | Retried |
|---|---|
| HTTP 408, 429, and any 5xx (529 included) | yes |
| a network error: refused, reset, unreachable, timed out, aborted, `fetch failed` | yes |
| any other status (409 included) | no |
| an agent failure (the agent itself failed, or answered out of protocol) | no |
| a transport error the adapter already retried in full | no |

## When to use it

* Raise the attempts or the waits for a rate-limited provider or a slow endpoint.
* Lower them (`--retry-attempts 1`) to fail fast while wiring a new target.
* Combine with a lower `--concurrency` when a provider rate-limits (topic running-cells-and-repeats).

## Commands and every option

| Option | Commands | Default | Effect |
|---|---|---|---|
| `--retry-attempts <n>` | `campaign run`, `campaign resume` | `4` | attempts per call, the first included; a whole number of at least 1. |
| `--retry-base-ms <ms>` | `campaign run`, `campaign resume` | `500` | the wait before the first retry; each later retry doubles it. At least 0. |
| `--retry-max-ms <ms>` | `campaign run`, `campaign resume` | `30000` | the longest wait between two attempts. At least 0. |
| `retry:` | the `campaign:` config key | none | `max_attempts`, `base_delay_ms`, `max_delay_ms`, the same as the three flags. |
| `target.retry` | the spec | none | `max_attempts` (1 to 20), `base_delay_ms`, `max_delay_ms`, `jitter` (default `true`), `retry_after` (default `true`). |

The order: the defaults, then the spec target's `retry`, then the run's flags (or config). Each wait is drawn at random below the exponential backoff (full jitter) and capped at the maximum. It is never shorter than the server's `retry-after-ms` or `Retry-After` header (seconds or an HTTP date). A Retry-After longer than the maximum wait ends the retries at once. `smoke`, `simulate` and other commands use the defaults and the spec's `target.retry`; they take no retry flags.

## Inputs

The spec target's `retry`, the flags, and the failures the agent's transport returns.

## Outputs and how to read them

* A cell that ran out of attempts reads `! <cell>  failed  <call> failed after <n> attempts: <error>`, such as `send on block 0 failed after 4 attempts: AdapterTransportError: ...`. With one attempt the words `after <n> attempts` are absent.
* Each retry of a completed block is recorded in the block's observed record as `retries`. Each entry holds the call, the attempt that failed, the status and the reason. It also holds the wait (`delayMs`), the server's `retryAfterMs` when sent, and the time. They are kept in the store with the run. A block replayed from the cache reports none.
* Each retry is also a `retry` event of the run (topic running-campaign-resume).

## Worked example

The committed http example names `http://127.0.0.1:8787/turn`. With nothing listening there, its single block fails with a network error, retried once with no wait, then once with no retry. No model is called. (The example assumes no server runs on that port; `node examples/http-target/server.mjs` would start one and make it pass.)

```sh
driftbench campaign run examples/http-target/specs/hello.yaml --retry-attempts 2 --retry-base-ms 0  # exit 1
driftbench campaign run examples/http-target/specs/hello.yaml --retry-attempts 1  # exit 1
```

```text
! http-target-hello · http:echo · F · repeat 0  failed  send on block 0 failed after 2 attempts: AdapterTransportError: 127.0.0.1:8787 transport failed: request or response transport failed; body length unknown
1 cell: 0 pass, 0 fail, 1 failed. Spent $0.00.
```

```text
! http-target-hello · http:echo · F · repeat 0  failed  send on block 0 failed: AdapterTransportError: 127.0.0.1:8787 transport failed: request or response transport failed; body length unknown
1 cell: 0 pass, 0 fail, 1 failed. Spent $0.00.
```

A `failed` cell is an infrastructure failure, not an agent failure: fix the cause, then `campaign resume` runs only those cells.

## Common errors

Each of the first three exits 2.

* `--retry-attempts takes a whole number of at least 1, not "0".`
* `--retry-base-ms takes a whole number of at least 0, not "-1".`
* `--retry-max-ms takes a whole number of at least 0, not "x".`
* Many `failed` cells with status 429: the provider rate-limits. Lower `--concurrency`, raise `--retry-base-ms` and `--retry-max-ms`.
* A run that seems to hang: a large Retry-After or a long `--retry-max-ms` makes it wait. A Retry-After above the maximum ends the retries instead.
* `failed` with a status such as 400, 401 or 404: not retried. Fix the request, the URL or the key.
