# Pre-registration: framework persona experiments HF10, HF11, HF12

Written 2026-10-15 before any paid call of this lane. The commit sha that first adds this file is the
pre-registration. Any later change goes under "Amendments" with its reason, before the data it affects.
Protocol: `codex/block-experiments/PROTOCOL.md` and `framework/HYPOTHESES.md` (Group C), owner go of
2026-10-15. Design under test: `simuser_model.md` (sections 2 to 4, 7) and `config_framework.md` 2.4 and 2.5.

## Hypotheses (HYPOTHESES.md Group C, verbatim)

- **HF10 The persona grid finds real persona effects and no fake ones.** 20 ABCD blocks × 3 personas (terse-regular measured, chatty-newcomer and persistent-skeptic declared) × 8 trials, plus an A/A control (the same persona twice under two ids). The persona-sensitivity flag (cross-persona spread beats within-cell rerun noise, or a per-block Fisher test, p below 0.05) raises at least one block, and raises 0 blocks in the A/A control. Falsifier: A/A flags any block, or the real grid flags none (then reported as no persona effect on this agent, as H10 allowed).
- **HF11 Global units route a prompt change to the right persona cells.** The prompt's language rule is linked as a global unit to the persona field `language`. Mutating that rule (negate, drop) and running blocks with an English and a non-English persona: flips concentrate in the cells the mapping selects (non-English persona), with unselected-cell flips at most 5%. Falsifier: unselected flips above 5%, or selected cells show no more flips than unselected.
- **HF12 Ownership refusal catches real conflicts.** On 30 planted persona/scenario/block conflicts (field owned by another file, slot redefined, contradictory belief, persona switch in a chain, unmet `requires`), the loader refuses 30 of 30 at load or as `not_run` with the right reason, and refuses 0 of 30 clean combinations. Offline. Falsifier: any miss or any false refusal.

## Shared setup (HF10, HF11)

- **Data.** ABCD v1.1 (Chen et al., NAACL 2021), MIT licence, sha256 of `abcd_v1.1.json.gz`
  `2bdf53ac359543dcdc38d55bc6513e78df120363f8f44870716e909f4606de15` (the H10 and H11 file). Raw file
  outside the repository.
- **Blocks.** The 20 H11 blocks: ABCD dev split, 8 action flows, flow-balanced sample with
  `random.Random(11)` (`lib/runner.py h11_blocks`, ids 1539 2062 2463 2929 3079 3630 5440 5795 6275 6771
  6798 7077 7279 7321 7666 7860 8032 8115 8196 10341). Block contract (H11): a trial passes if the set of
  action buttons the human agent clicked is a subset of the tools the agent called.
- **Agent under test.** `claude-haiku-5-5`, effort low, the ABCD agent of `research/block-sim`
  (a460cdffa, `lib/agent.py`), with one stated language rule added as its global unit, since that prompt
  had none (lead's instruction for HF11). The same prompt is used in HF10 and in HF11's base arm. The
  three versions of the unit, inserted after "Keep each message short and conversational, as in a live chat.":
  - base: "Always reply in the language the customer writes in."
  - negate: "Always reply in English, even when the customer writes in another language."
  - drop: the sentence removed.
- **Simulated user.** The H10 agenda engine (M2.1) with its LLM realiser and act classifier, both
  `gpt-5.4-nano` (OpenAI, a different family from the agent), reasoning effort `none`, default
  temperature. Parameters come from the persona file (`lib/personas.py engine_params`): acts per turn,
  short, polite, uncertain and question turn shares, repeat after refusal, turn budget, engagement
  initial, decay and threshold, a non-short turn length target, language and persona lines. Volunteering:
  in the opening turn each of customer_name, order_id, account_id, username, email (if the block holds it)
  is volunteered with the persona's `volunteer_default`, at most 2. The engine, not the model, decides
  stop and abandon. Cell seed = first 8 hex digits of sha256("7|block|persona id|trial").
- **Personas** (`personas/*.json`, values from `simuser_model.md` 7.1):
  - terse-regular: verbosity measured on ABCD train (action flows, at least 4 customer turns, 6,216
    dialogues; k-means k = 3 on standardised short share and words per turn, seed 7; the terse cluster
    holds 36.5% of dialogues): short-turn share 0.570, words per turn 5.49, question share 0.050
    (`personas/measure_terse.py`, `terse_measured.json`). Other fields as in 7.1, declared or default.
  - chatty-newcomer and persistent-skeptic: declared, values of 7.1.
  - terse-regular-aa: a byte copy of terse-regular with another id (A/A control). Its seeds differ.
  - terse-regular-fr (HF11 only): terse-regular with `language: fr` and its one line in French.
- **Deviations from the note's model, written before data.** ABCD blocks hold the customer facts, so the
  personas hold no stable knowledge (no slot can collide); expertise concepts, misconceptions,
  cooperativeness and the front-loading cap are not drawn (ABCD blocks list no concepts; the H10 engine
  has no cooperativeness draw); prior failed contacts are 0 (ABCD has none). Persona files are JSON, not
  YAML. These limit what the grid can show; they do not touch the flag or routing rules under test.

## HF10 design and metric

- Cells: 20 blocks × {terse-regular, chatty-newcomer, persistent-skeptic, terse-regular-aa} × 8 trials =
  640 conversations, base prompt.
- **Flag** (`lib/grid.py block_flag`), per block over a persona set, trials split into halves 1 to 4 and
  5 to 8 as in H11, V = pass^4 verdict of a half (1 if all 4 passed):
  - within-cell flip rate w = mean over personas of [V(p, A) differs from V(p, B)];
  - cross-persona flip rate x = mean over persona pairs and the 4 half pairings of [V(p, h) differs from V(q, h')];
  - "spread beats re-run noise" = x > w;
  - exact test: Freeman-Halton exact test of equal pass rates on the personas × (pass, fail) table, two-sided
    (Fisher's exact test when there are 2 personas); reproduces simuser_model.md 4.3 (7/8 vs 2/8 p 0.041,
    8/8 vs 4/8 p 0.077, `offline_checks.json`);
  - flag = (x > w) or (p < 0.05).
- Real grid: persona set {terse-regular, chatty-newcomer, persistent-skeptic}. A/A control: persona set
  {terse-regular, terse-regular-aa}.
- **Verdict.** FALSIFIED if the A/A flags 1 or more blocks, or the real grid flags 0 blocks (then reported
  as no persona effect on this agent). SUPPORTED if the A/A flags 0 and the real grid flags at least 1.
- **Prediction stated before data.** A null simulation of the flag (every persona sharing the block's
  pass rate, rates taken from the H11 per-block pass counts, 4,000 simulations, seed 1012) gives a
  probability of 0.48 that a 2-persona A/A flags at least one of 20 blocks, and 1.37 expected false flags
  for 3 personas. So the flag as specified may fail the A/A from its own false-alarm rate; this is
  reported, not corrected.
- **Secondary (reported, not in the verdict).** Per cell c/8, Wilson interval, pass^4 = C(c,4)/C(8,4);
  per block worst persona and spread; per persona column mean pass rate with a block-cluster bootstrap
  (2,000, seed 1010) and paired differences against terse-regular; counts flagged by each half of the
  rule alone; a permutation test of the real grid's flag count (persona labels shuffled within block over
  its 24 trials, 2,000, seed 1013); the null false-flag rate recomputed on this run's pooled block rates
  (10,000, seed 1012); persona came through: per column Short%, words per turn and Quest% (H10 metric
  definitions) against the persona targets, and abandon counts; every conversation's applied engine
  config hash equals its persona's config hash.

## HF11 design and metric

- Link table `hf11/links.json`: unit `agent.system#language-rule`, scope global, persona field
  `language`, prompt default `en`. Selector `lib/routing.py`: a global unit linked to persona field F
  selects the cells whose persona's F differs from the prompt default. For this table it selects exactly
  the terse-regular-fr cells (`offline_checks.json` routing_selected).
- Blocks: the 11 H11 blocks with at least 13 of 16 H11 passes (5440 5795 6798 7279 7321 10341 8032 2062
  7860 8196 7077), chosen on independent H11 data so that a cell's verdict can move (a block failing
  every trial cannot flip).
- Cells: (block, persona) for persona in {terse-regular (en), terse-regular-fr (fr)}; arms base, negate,
  drop; 5 trials (trial indices 0 to 4, same seeds across arms). The en base cells are HF10's
  terse-regular trials 0 to 4 (same prompt, persona, seeds). New conversations: 11 × 5 arms × 5 = 275.
- Trial verdict: the block contract passes AND the language check passes. Language check
  (`lib/lang.py`): every agent message after the fixed greeting is labelled en, fr or undetermined by
  stopword counts; it passes if at least one message is labelled and every labelled message is in the
  persona's language. On 500 real ABCD agent turns the detector gives en 446, fr 0, undetermined 54.
- Cell verdict: pass if at least 3 of 5 trials pass. A flip: a cell's verdict under a mutation differs
  from its verdict under base.
- Selected flip share S = flipped selected cells / (selected cells × 2 mutations); unselected U likewise
  (22 unselected cells, so one flip is 4.5%).
- **Verdict.** FALSIFIED if U > 0.05 or S <= U; else SUPPORTED.
- **Secondary.** Per mutation; trial-level paired flips; flips of the language check alone and of the
  block contract alone; language-check pass rate per arm; detector share fr on the fr persona's own turns.

## HF12 design and metric

- Schema `hf12/SCHEMA.md` (written first, from simuser_model.md 3.2, 3.3, 3.5, 7.4 and
  config_framework.md 2.5). Fixtures `hf12/fixtures/cases.json`: 30 planted (6 per class) and 30 clean
  near-miss cases, written by a separate agent from SCHEMA.md alone, which never saw the loader. Loader
  `hf12/loader.py`, written from SCHEMA.md alone before the fixtures were read. Both are in this commit.
- Scoring (`hf12/run.py`): a planted case is caught when the set of refusals equals the expected set
  (load error with the right class, or the exact not_run cells with the right requirement); a clean case
  is a false refusal if anything is refused.
- **Verdict.** FALSIFIED on any planted case not caught or any clean case refused; else SUPPORTED. A
  fixture found wrong against SCHEMA.md after the run is reported as such, both scores kept.

## Models, keys, budget, stop rule

- Agent `claude-haiku-5-5` (key ~/.nexus-secrets/anthropic-driftbench.key); simulator realiser and
  act classifier `gpt-5.4-nano` (key ~/.nexus-secrets/openai.key). No judge model: the HF11 language check
  is offline. Keys loaded inside the command, never printed or stored.
- Lane cap 10 USD, stop at 9.0 USD cumulative (LEDGER.md, USD from each response's usage fields and the
  prices in the `research/block-sim` LEDGER header).
- Tiny sample first: HF10 2 blocks × 4 persona ids × 1 trial (8 conversations) and HF11 2 conversations
  (fr base and fr negate on block 5440). Not data. Measured USD per conversation and the projection go
  into LEDGER.md before scaling.
- If the projection of HF10 + HF11 + spent exceeds 9.0 USD: HF11 blocks drop from the end of its list to
  the largest number of at least 10 that fits; if 10 do not fit, HF11 is not run and is INCONCLUSIVE
  (budget). If HF10 alone does not fit, HF10 blocks drop from the end of the H11 sample order to the
  largest even number that fits, written here first.
- A conversation that errors is re-run once, both kept; an error never counts as a fail.
- Order: HF12 (offline) and the tiny sample, then HF10, then HF11.

## Amendments

1. 2026-10-15, after the tiny sample (10 conversations, not data), before any HF10 or HF11 data: the
   realiser's style lines named English polite words ("Include one polite word (please, thanks or
   sorry)") and an English example of an unsure turn, so the French persona wrote "Bonjour, please ...".
   For a French persona the lines now name French words ("s'il vous plaît, merci or pardon"; "je crois")
   and a non-polite French turn avoids both languages' words. English personas get the H10 text
   unchanged. No parameter, persona value, metric or threshold changed.
