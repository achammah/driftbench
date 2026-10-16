# Block redesign: phrasing experiments (H1 to H4)

Research code. Nothing here changes `packages/*`. The hypotheses, metrics and falsifiers come from section 5 of the block redesign report; the mechanisms (M1.1 to M1.4) from section 2.1 and from `deep_1_phrasing.md`.

## Shared setup (binds every PREREG in this folder)

### The agent under test
The Acme sales assistant in `examples/acme/src` is deterministic and has no model. To run a block live, `src/agent.ts` builds a research stand-in: `claude-haiku-5-5` behind the repo's `anthropicAdapter` (`packages/adapters/src/anthropic`), with the five Acme tools from `examples/acme/src/tools.ts` on a fresh store per session, and a system prompt that states the deterministic agent's policy (`SYSTEM` in `src/agent.ts`). The adapter closes the tool loop itself (step cap 8, `max_tokens` 4096).

- Haiku 5.5 rejects non-default sampling values, so temperature is the provider default; it runs with its default adaptive thinking at effort `medium`. No seed exists for this API: run-to-run variance is real and is measured.
- Given: each block starts from a teacher-forced prefix. The earlier user turns of the spec are played by the deterministic Acme agent, and its replies and tool calls (with results) become the prefix (`src/prefix.ts`). The spec's `given.world` and every earlier block's `given.world` apply, as the runner applies them. Every realisation of a block starts from the identical prefix.

### Amendment 2, 2026-10-15, before any H1 or H2 agent run: the shared live Acme agent
On the lead's instruction every lane now tests one shared agent. It replaces the stand-in above for H1, H2 and H3.
- Source: branch `research/block-shared`, commit `be8bb2f8f`, merged into this branch unchanged: `research/block-redesign/shared/acme-live/`. Prompt `prompt/acme-sales.md`, 30 sections, sha256 `cd17d54f499f5b03a829f71bd1f66639f3e602335140818a66322b442757c544`, with its sections registry; tools ported to Python with underscore names; `AcmeLive.respond`, `claude-haiku-5-5`, effort `low`, `max_tokens` 2048, at most 6 model calls per turn, the system prompt cached. The links lane is its only writer.
- Harness (`src/jobs.mts`, `src/run_shared.py`, `src/score.mts`): each run calls `AcmeLive.respond(history, text, overrides)` once. `history` is the same teacher-forced prefix as before, written as Anthropic messages with the deterministic agent's tool_use and tool_result blocks (tool names with underscores). The block's forced tools become `overrides`. The shared tools have no store seed, so B3's seeded transfer record (`+12025550150` eligible) becomes a forced `port_check` result; the oracle still checks the number the agent sends. Tool names are mapped back to the Acme labels before scoring.
- Transport failures after the client's retries are logged in `results-*.errors.jsonl`, not counted, and the job is run again (the job file is resumable by id). A run that ends with the agent still asking for tools after 6 calls is the agent's result and is scored as it stands.
- The tiny sample on the old stand-in (`data/tiny-v3/runs-*.jsonl`) stays out of every analysis. A new tiny sample on the shared agent runs before scaling.

### The Then
Only the tool part of each block's `expect` is scored: `tools` (label, count, input assertions) and `tool_order`. `must`, `stage`, `criteria` and `guards` are left out: they assert the exact wording and stage names of the deterministic agent, which a model agent cannot reproduce, and they do not depend on slot values. A run with an agent error (the step cap) is a fail.

- Exact oracle: today's semantics, the repo's own `tools` check (`packages/checks/src/checks/tools.ts`, core `matchAssertion`), plus every tool expected 0 times must not be called. Gating verdicts only (`argument_accuracy` never gates).
- Normalised oracle (M1.3, `src/oracle.ts`): the same check after each slot field is compared by its normalise rule; a field whose normalised value equals the gold's is replaced by the gold. Rules: phone, digits with country code 1; email, trimmed and lower case; address, lower case, punctuation removed, rd/ln/ave/av/st/wy expanded, the town `acmeville` dropped; `contains` fields (a free-text summary) pass when the normalised text contains the normalised street. Raw and normalised values are recorded for every field.
- Offline sanity check (run before any paid call, `data/sanity-oracle.json`): on all 10 blocks the deterministic agent's own calls pass both oracles; every listed surface form passes the normalised oracle (44 of 44 checks); every minimal-pair value fails both (10 of 10).

### The ten blocks
Picked from the `examples/acme` specs: every block whose user turn carries a slot value that a tool input assertion checks. Seven come from the hand-written conversation specs, three from the gated golden set, which assert the slot by exact equality. Blocks whose Then has no slot assertion (greetings, `Confirm`, a plan choice with `order.create` count 0) were not picked; nor was `tool-failure` block 1, whose Then tests a retry count, not a slot.

| Id | Spec, block | Seed | Slot assertion | Why |
|---|---|---|---|---|
| B1 | conversations/new-customer-coverage, 2 | `88 Summit Avenue, Acmeville` | coverage.check address regex `^88 Summit Avenue` | the turn is only an address; the next tool depends on the id it returns |
| B2 | conversations/new-customer-coverage, 4 | `+1 202 555 0131` | notify_sales customer.phone `+12025550131`; summary contains `88 Summit Avenue` | a phone the agent must convert to E.164 |
| B3 | conversations/number-porting, 2 | `It's +1 202 555 0150` | port.check number `+12025550150` | number to port, exact E.164 |
| B4 | conversations/plan-upgrade, 2 | `It's sam.rivera@example.com` | catalog.search customer_email exact | email slot |
| B5 | conversations/order-loose-confirmation, 1 | `Hi, I'd like to order Acme Fiber 1000 for 14 Harbor Road, Acmeville.` | coverage.check address regex `14 Harbor Road` | two slots in one turn (plan, address) |
| B6 | conversations/off-topic-return, 1 | `Hi, do you have home internet at 3 Orchard Way, Acmeville?` | coverage.check address regex `^3 Orchard Way` | address inside a question |
| B7 | conversations/tool-failure, 2 | `+1 202 555 0188` | notify_sales phone `+12025550188`, reason tool_failure, summary contains `7 Quarry Lane` | phone after a tool failure |
| B8 | golden/twise/gen-twise-023, b2 | `The address is 7 Quarry Lane, Acmeville.` | coverage.check address equal to `7 Quarry Lane, Acmeville` | the strictest address oracle: whole-string equality |
| B9 | golden/twise/gen-twise-066, b2 | `My number is +1 202 555 0160.` | port.check number `+12025550160` | locked number, plans still offered |
| B10 | golden/twise/gen-twise-018, b3 | `It's morgan.diaz@example.com.` | catalog.search customer_email exact | customer already on the most data |

### Utterance class (M1.1, M1.2)
- Style axes, 3 values each (`src/planner.ts`, `src/gate.ts`): register (formal, neutral, casual), length (terse, one_sentence, multi_sentence), noise (clean, typos, no_punctuation), distractor (none, unrelated_aside, redundant_detail), lexical (seed_words, synonyms, restructured), slot_surface (canonical, variant_a, variant_b; the forms per block are in `src/blocks.ts`). Constraint, given to the planner: `length == terse -> distractor == none`. 567 valid cells.
- Planner: greedy covering arrays, best of 5 seeds. Strength 2 gives 15 rows (full pairwise coverage, 133 of 133 pairs); strength 3 gives 46 rows (516 of 516 triples). Random sets of 15 rows cover 81.0% of pairs on average.
- Offline sanity checks (`data/sanity-offline.json`): a fake agent failing with probability 0.9 only when register = casual and noise = typos is localised first (alone) in 34 of 50 strength-2 arrays (in the top tie in 43 of 50: the pair often sits in a single row, tied with the other pairs of that row) and in 50 of 50 strength-3 arrays. The envelope's 95% interval covers the true rate in 94.7% of 1000 simulated runs (n = 60, K = 4); the phrasing share estimate averages 0.196 against a planted 0.200.
- Realiser: `gpt-6-luna` (OpenAI's newest small model listed by the API on 2026-10-14; it rejects temperature 0, so the default 1 is used, with a per-call `seed`). One candidate per call.
- Gate, in order: slot_presence, slot_exclusivity (values the customer already gave earlier in the conversation are allowed), negation_parity, axis_slot_surface (the assigned surface form appears verbatim), near_duplicate (character 4-gram cosine to the seed or an accepted realisation of the same block above 0.8), axis_conformance (`gpt-6-luna` verifies each of the five style axes against the row, yes or no; all must be yes; the dictated values never count), equivalence_judge (`gpt-6-luna`; same request, same constraints, same values, told which spellings of each value are the same value; requires `same` and confidence at least 0.9). From the second candidate of a row on, the realiser sees the previous rejected candidate and the reason. These three points and the axis wording are Amendment 1 in `h4/PREREG.md`, made after the tiny samples and before any scaled data. The deterministic stages run first; model stages run only on candidates that passed them. Up to 6 candidates per row (3, then a second round of 3); a row with no accepted candidate is dropped and the post-gate coverage is reported.

### Models, keys, prices
- Agent: `claude-haiku-5-5`, 0.10 / 0.50 USD per million input / output tokens (Anthropic price table, prompts under 100K tokens). Key `~/.nexus-secrets/anthropic-driftbench.key`, loaded in process, never logged.
- Generation and gate judges: `gpt-6-luna`, 0.10 / 0.01 / 0.50 USD per million input / cached input / output tokens. Audit labeller (H4): `gpt-6.1-sol`, 2.00 / 0.10 / 10.00. Source: developers.openai.com/api/docs/pricing, read 2026-10-14.
- Every paid call appends its provider usage to `data/usage.jsonl`; `LEDGER.md` is computed from it.

### Budget and stop rule
Lane cap 40 USD. Code refuses any paid call once the lane total reaches 36 USD (90%), and the lane then reports. A re-run needs a written reason (crash, outage) and both results are kept.

## Files
- `h1/`, `h2/`, `h3/`, `h4/`: `PREREG.md` (committed and pushed before any paid call of that hypothesis), then `RESULTS.md` and `results.json`.
- `src/`: the prototypes (agent stand-in, blocks, prefix, oracle, planner and localiser, realiser and gate, envelope report) and the scripts.
- `data/`: frozen realisation sets with their sha256, every candidate with its gate stages, every run with its tool calls and both oracle verdicts, and the usage log.
