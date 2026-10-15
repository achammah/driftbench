# H9 results: the Given verifier finds real hidden Given errors

**Verdict: FALSIFIED** by the pre-registered rule: 2 clean specs were flagged. The verifier caught every planted defect (48 of 48, right check and layer), but it flagged 2 of 12 clean recorded specs, and only 12 of the planned 20 clean specs were eligible. The flag is the duplicate tool id rule, and the wire checks show it is over-strict (below).

Pre-registration: `PREREG.md` (0f8116d22; amendment 1, before data, at 58b91b2b5). Offline: deterministic Acme agent and the sandbox seeding code; one wire check (M4.2, paid, under H6's pre-registration) decides the reading of the flag. Run once (run 1); no re-run.

## Part A: seeded defects

| | Result |
|---|---|
| Pool (Acme conversation specs) | 581 |
| Eligible clean specs | 12 (pre-registered 20; shortfall 8) |
| Planted defects detected with the right check and layer | 48 of 48 |
| Clean specs flagged | 2 of 12 |

- Why only 12: 396 pool specs carry no ledger fact said in a user message (the generated and gated specs have no ledger), 120 have no recorded tool call with a result, 38 change their world between blocks (excluded by amendment 1), 15 have one block. The 12 are 6 distinct conversations, each present in 2 copies (`specs/`, `golden/` or `gated/control-handwritten/`).
- Per defect, 12 of 12 each: dropped tool result (`tool_history_paired`), fact not in its message (`value_in_message`), flipped world row (`history_matches_world`), unknown tool (`tool_known`).
- The 2 flags: both copies of `tool-failure.yaml`, check `tool_history_paired`, "id call-1 repeats at prefix[3] notify_sales". The Acme agent numbers its calls per turn (`call-1` in every turn), and the recorder keeps those ids.
- Reading of the flag, per the pre-registered wire check 3: a two-turn history with `call-1` twice gets 200 on Anthropic (`claude-haiku-5-5`), OpenAI Responses and OpenAI Chat Completions (`gpt-6-luna`) (`m42/wire-results*.json`). So the id-uniqueness rule is over-strict for these wires: an over-strict check, not a hidden Given error. The verdict stays FALSIFIED because the pre-registered falsifier is "any clean spec flagged".
- A weakness the planted defects did not probe: `value_in_message` uses a substring match, and it grounded `lang: EN` in 7 of the 12 clean specs through unrelated words. The rule needs token boundaries or a per-fact pattern. It is over-permissive, which a planted "value absent" defect cannot reveal.

## Part B: `requires: auto` over every example spec
- Population: 2,448 files, 2,351 load as specs (the other 97 are criteria, inventories and other YAML), all 2,351 pass lint today.
- `not_run` on specs that pass today: **0**. No capability gap (every layer a spec uses is supported by its run target's adapter), no unknown tool, no unknown session state or event, no unresolvable `workspace.from`, no seeded workspace that reads back different (1,156 specs with `workspace.files`, every distinct workspace seeded and read back), no ledger contradiction.
- So the silent drop the adapter docs describe (`world.tools` on an adapter without `toolStubs`, `prefix` without `seedPrefix`) does not occur in the shipped examples: no spec pairs an unsupported layer with its own target. It stays possible the moment a spec runs on another target; the `capability` check is the guard.
- New-key column (`summary_present`, not in the headline): 1,074 specs. 1,037 claude-code estate specs name a session state (`resumed`, `long`, `after_compaction`, `after_restart`, `helpers_running`) with no visible summary; 37 specs read `workspace.from` folders (36 price-sheet task seeds, 1 session fixture) with no summary. These are Mystery Guests by Meszaros' definition and over-strict only in the sense that the key does not exist yet.

## The hidden Given error the verifier found: teacher-forced history
- Core `canonicalGiven` (mode T) writes 2,698 tool calls over the example specs; 2,688 have no result (421 Acme specs, plus 4 calls in 2 claude-code specs). `canonicalReply` leaves a result out when the world does not force one, and leaves `input` empty when the spec asserts no exact value (`canonical-gap.json`).
- On the Acme function agent this is by design: the agent re-reads its store. On the repo's anthropic adapter it is not: `toAnthropicMessages` sends such a call as `tool_use` with `input: {}` and a `tool_result` whose content is the text `null` (`outputText(undefined)`, `packages/adapters/src/anthropic/common.ts:368`). The wire accepts it (M4.2 run 1: 200 on all wires), so nothing fails. A model replayed in mode T through an SDK adapter is told that each past call took no input and returned nothing. That is a Given the spec never wrote, applied silently: a real hidden Given error, latent until mode T runs on an SDK adapter. The verifier reports it as a warning for `origin: canonical`, as pre-registered.
- H6 shows the representation of a past call changes behaviour, so this is not cosmetic.

## Checks of the instrument
- Detection 48 of 48 with the planted layer; every planted copy also differs from its clean original only in that layer.
- The duplicate-id reading rests on 3 wire calls (one per wire); the unpaired history control on the same wires gets the documented 400 (`m42/wire-results-run2.json`), so the wires do validate pairing.

## Consequences for the design
- Keep `tool_history_paired`, but scope id uniqueness to one assistant turn, or make the recorder re-key ids (the M4.2 compiler's `rekey` policy). Re-test the clean set after that change before calling the verifier ready.
- `value_in_message` needs a boundary-aware match.
- The canonical gap needs a decision: either `canonicalReply` must carry a result (forced, or recorded from a reference run), or an adapter must refuse a call without a result (`unsupported` / `given_unmet`), never send `null`.

Raw data: `results.json` (Part A per spec and per defect with every finding; Part B rows with any finding), `canonical-gap.json`, `run.ts`, `../verifier/`.
