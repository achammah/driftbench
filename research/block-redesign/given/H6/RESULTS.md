# H6 results: a recorded tool call and the same fact in prose give different behaviour

**Verdict: SUPPORTED.** 6 of 15 blocks differ beyond noise on the pre-registered primary metric (Holm-adjusted p < 0.05), and 2 of 15 still differ on the original regex-only metric. The falsifier ("arms agree within noise on all 15 blocks") did not hold.

Pre-registration: `PREREG.md` (commit 655f94e28; amendment 1, the judge, at c14f313cd, after the 4-run pilot and before any analysed run). Agent: the Acme live agent on `claude-haiku-5-5` through the repo's `anthropicAdapter`. Judge: OpenAI `gpt-6-luna`. 900 runs, 0 errors, 0 missing judge verdicts. Cost: 0.32 USD agent, 0.02 USD judge.

## Numbers

Primary, judged correct use (regex pass and judge YES), passes out of 30:

| Block | Record | Prose | Holm p |
|---|---|---|---|
| 3 coverage, 3 catalog, port-balance, port-date (7 blocks) | 30 each | 30 each | 1.0 |
| port-pin | 30 | 27 | 1.0 |
| order-id | 18 | 0 | < 0.0001 |
| order-install | 12 | 0 | 0.0014 |
| order-price | 18 | 0 | < 0.0001 |
| lead-ref | 30 | 14 | < 0.0001 |
| lead-window | 30 | 17 | 0.0006 |
| lead-advisor | 30 | 22 | 0.046 |

- Pooled gap, record minus prose, mean over blocks: +0.196, block-cluster bootstrap 95% interval +0.080 to +0.322.
- Secondary, regex only (the original metric): order-id 30 against 9 and order-install 30 against 9 differ (Holm p < 0.0001); order-price 30 against 23 (raw p 0.011, Holm 0.14); all other blocks 30 against 30. Pooled +0.109, interval 0.000 to +0.249.
- Secondary, re-call of the same tool in the final turn: record arm 0 of 450 runs; prose arm 332 of 450. 12 of 15 blocks differ (Holm p < 0.0001); pooled gap -0.738, interval -0.920 to -0.524. The three order blocks show no re-call in either arm (order.create needs CONFIRM).

## What the prose arm does
- It distrusts its own prose. 264 of 450 prose replies say the earlier message was wrong or not real ("I did not actually run the port check in this conversation, so I had no result to report. I'll run it now."); 90 of 450 record replies do.
- It repeats side effects. In all 90 prose runs of the three lead blocks the agent called `notify_sales` again: a second callback request for the same customer. In the record arm: 0 of 90.
- It disowns values it cannot re-check. In the order blocks the agent cannot call `order.create` again without CONFIRM, so it tells the customer the order number or date "is not a confirmed order. Please disregard it." (regex passes 9 of 30 on order-id because the reply still quotes the number; the judge counts 0.)
- It costs more: 789 model calls against 450 for the same 450 runs (0.22 against 0.11 USD), median latency 3.5 s against 1.4 s.

## What the record arm does
- It answers from the recorded result without a new call in 450 of 450 runs.
- In the order blocks it gives the value but often flags its own past action: "I placed that order without any details from you in this conversation." The judge counted some of these as NO (order record 18, 12, 18 of 30), the regex 30 of 30. The faked history is visible to the model as an action it never discussed with the customer.

## Checks
- Judge against a blinded hand reading of 40 replies (seed 66, 20 per arm, arm hidden while labelling): 37 of 40 agree, above the pre-registered bar of 36. The 3 disagreements are all judge NO where the reading is YES: two prose lead replies that disown, re-submit and then give the reference, and one record order reply that gives the number and flags the order. The judge is stricter than the reading on self-corrections, so the judged gaps on lead blocks are partly judge strictness; the regex metric shows no gap on lead blocks, the re-call metric shows a full one.
- M4.2 instrument checks (`m42/wire-results*.json`): the compiler's Anthropic rendering equals the adapter's on all 30 histories; round trip is the identity on 93 of 93; all 15 record histories get no 400 on Anthropic, OpenAI Responses and Chat Completions; a history with the `tool_result` block truly removed gets the documented 400 on all three wires.

## Protocol notes
- The 4 pilot runs are excluded from the analysis: they live in `runs-pilot.jsonl` and `judged-pilot.jsonl`, and none of the 900 counted runs (`runs-full.jsonl`) carries a pilot id.
- The judge amendment predates the first counted run: amendment commit c14f313cd at 2026-10-15 00:04:01 +0200; `runs-full.jsonl` was created at 00:04:12 by the run launched after that commit.
- Judge against regex on the 900 counted runs: they disagree on 123 (81 prose, 42 record). Every disagreement is a regex pass the judge calls NO (the reply quotes the value but disowns or doubts it); the judge never says YES where the regex fails.
- Agent: H6 ran on this lane's own live Acme agent (`agent/acme-live.ts`), built before the shared live Acme agent of `research/block-shared` was announced. It is not that shared agent; results do not transfer to it without a re-run.

## Limits
- One agent model and one prompt. The system prompt says facts must come from a tool result or the customer; a prompt without that rule may distrust prose less. The size of the gap is a property of this prompt, the direction is what H6 asked.
- Default sampling: the API rejects temperature 0 on this model (stated in PREREG).
- The prose template writes the result as "key value" sentences; a free paraphrase was not tested.

## Consequence for the design
A Given that seeds a fact as prose is a different test from one that seeds it as a recorded call: it changes whether the agent calls tools again, repeats side effects, and trusts its own history. `origin` and the layer-2 representation must be part of the Given hash and never pooled, which section 2.4 proposes. M4.2 also showed that today a call with no result is not dropped on the wire but answered with the text `null` (see H9 RESULTS), which is a third representation.

Raw data: `results.json` (900 items with text, tools, regex, judge), `analysis.json`, `handcheck.json`, `runs-full.jsonl`, `judged-full.jsonl`.
