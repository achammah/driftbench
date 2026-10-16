---
title: "The local viewer"
summary: "Serve a store on 127.0.0.1 to browse campaigns, runs and comparisons, and save hand labels and queue work, with no script needed."
commands:
  - view
see_also:
  - results-scorecard
  - results-compare
  - results-report
next:
  - results-registry
---

## What it is

`driftbench view` serves one store as a local website on `127.0.0.1`. It shows every campaign, each
campaign's scorecard, every run block by block, and the comparison of two campaigns. Under every block a
form saves a pass or fail label per criterion, with a note, to the labels folder that
`driftbench judge calibrate --labels` reads. It also serves the review queue that `driftbench queue`
manages. It runs until stopped with Ctrl+C or a termination signal.

## When to use it

* To read runs in full without writing an HTML file per campaign.
* To label blocks by hand, so the judges can be calibrated against people.
* To work a review queue with other reviewers.
* To compare two campaigns at a chosen margin from a browser.

## Commands and every option

```
driftbench view [--store <file>] [--port <n>] [--labels <dir>] [--labelled-by <name>] [--config <file>]
```

| Option | Default | Meaning |
|---|---|---|
| `--store <file>` | `driftbench.db` | the store to read; a missing file is refused |
| `--port <n>` | `4317` | the port, 0 to 65535; `0` picks a free one |
| `--labels <dir>` | `labels` | the labels folder labels and `queue.json` are written to |
| `--labelled-by <name>` | `a reviewer, in driftbench view` | who labels: written as `labelled_by` in a new labels file, and the reviewer name on the queue |
| `--config <file>` | `driftbench.yaml` when it exists | the config whose `scales:` bound each criterion's score box (0 to 1 without one) |

Global: `--plugin <module>`. Exit 0 after a stop; 2 when the store is missing, the port is not a number in
range, the port cannot be opened, or the config does not parse.

## Inputs

A store written by `campaign run` or `ci`, and optionally a labels folder that already holds label files
or a queue (`driftbench queue create`).

## Outputs and how to read them

At start it prints the address and the folders:

```text
driftbench view at http://127.0.0.1:4317
Store /abs/path/driftbench.db, labels in /abs/path/labels. Stop with Ctrl+C.
```

| Address | Shows |
|---|---|
| `/` | every campaign of the store, newest first, with its modes, specs, runs and how many pass |
| `/campaign/<id>` | the campaign's scorecard (up to 400 runs in the Runs zone); each run links to its own page |
| `/campaign/<id>/run/<runId>` | one run: its timeline, then every block in full (user turn, reply, tool calls and results, verdicts with evidence and reasoning). A label form sits under each block |
| `/compare?baseline=<id>&candidate=<id>&margin=<points>` | two campaigns picked from the store; the paired comparison of `driftbench compare` with its verdict. The margin defaults to 2 points here, not auto |
| `/queue` | the review queue: items open, assigned or done. "Take" assigns, "Label it" opens the block, and saving the label marks the item done. The agreement line of `queue agreement` |
| `/keys` | the keyboard cheatsheet, plain HTML |

Labels. A label is one entry in `<labels>/<criterion>.yaml`, id `<runId>.b<block>`, with the label, the
note and the transcript of the block. Labelling the same block and criterion again replaces that entry
only. The form offers an anchor (a transcript line, a tool call, a field `field:<tool>:<path>`, a span
`span:<guard|skill>:<name>` or `span:<span id>`) and a score box bounded by the criterion's scale. An
anchor the block does not have, or a score out of range, is refused with HTTP 400 and nothing is saved.
A queue item held by another reviewer is refused with HTTP 409.

Keyboard. On a block page: `1` checks pass, `2` checks fail (not while typing in the note), Cmd or
Ctrl+Enter saves, ArrowDown and ArrowUp move between blocks. On `/queue`: `j` and `k` move focus, Enter
opens or takes the focused item. `?` opens `/keys`. Every action also works with script off: each one is a
link or a form.

Security policy. The viewer listens on `127.0.0.1` only.

* A request whose Host header is not exactly the printed `127.0.0.1:<port>` gets HTTP 403 (DNS rebinding).
* A write needs the viewer's own Origin, or a same-origin Referer when Origin is absent, and a hidden form
  token: 32 random bytes made at each start, never written to disk. An old page's token is refused after a
  restart; reload the page. Refusals are HTTP 403 and write nothing.
* Writes are POST to `/labels` and `/queue/assign` only. Other methods on those paths get HTTP 405; GET
  on them gets 404. Any method but GET elsewhere gets 405.
* The Content-Security-Policy is `default-src 'none'; style-src 'unsafe-inline'; form-action 'self';
  base-uri 'none'`, plus, on the queue and block pages only, a `script-src` naming the hash of the one
  keyboard script of that page. No other script runs; no external asset loads.

## Worked example

The viewer runs until stopped, so the runnable part prepares a store and checks the refusals; start the
viewer yourself afterwards.

```sh
driftbench campaign run examples/acme/specs/conversations --mode T,F --store acme.db --campaign c-acme
driftbench view --store missing.db # exit 2
driftbench view --store acme.db --port 70000 # exit 2
```

```text
$ driftbench view --store missing.db
No store at /abs/path/missing.db. Give one with --store <file>.
(exit 2)
$ driftbench view --store acme.db --port 70000
--port takes a whole number from 0 to 65535, not "70000".
(exit 2)
```

Then, by hand, in the same folder (it blocks until Ctrl+C):

```text
$ driftbench view --store acme.db --port 0 --labels labels --labelled-by reviewer-a
driftbench view at http://127.0.0.1:64455
Store /abs/path/acme.db, labels in /abs/path/labels. Stop with Ctrl+C.
```

Probed with curl while it ran, on a store holding Acme campaigns:

```text
GET  /                      200
GET  /  with Host: localhost 403  Forbidden: untrusted Host.
POST /labels  (no Origin)    403  Forbidden: untrusted origin.
DELETE /labels (no Origin)   403  Forbidden: untrusted origin.
GET  /compare?baseline=c-base&candidate=c-next  200
GET  /keys                   200
GET  /queue  content-security-policy: default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-HPxNq8iEf6CJirB7EU15G0NnwbcXeDnyblKhnAAcLls='; form-action 'self'; base-uri 'none'
```

## Common errors

| Message | Cause and fix |
|---|---|
| `No store at <path>. Give one with --store <file>.` (exit 2) | the default is `driftbench.db` in the working folder; name your store |
| `--port takes a whole number from 0 to 65535` (exit 2) | fix the port |
| `Cannot serve the viewer: ...` (exit 2) | the port is taken; pass another, or `--port 0` |
| a page shows `Forbidden: untrusted Host.` | open the exact `127.0.0.1:<port>` address printed, not `localhost` |
| `Forbidden: invalid form token.` after a save | the viewer restarted; reload the page and save again |
| `judge calibrate` says a criterion lacks labels | it needs at least one pass and one fail label per criterion |
