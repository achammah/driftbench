# H14 pre-registration: uncovered production clusters yield more failing blocks than random samples

Written 2026-10-14 before any paid call for H14. The commit sha that first adds this file is the
pre-registration. Later changes go under "Amendments" with their reason, before the data they affect.

## Hypothesis (section 5, verbatim)

| # | Claim | Experiment | Metric | Falsified if | Cost |
|---|---|---|---|---|---|
| H14 | Uncovered production clusters yield more failing blocks than random samples. | One month of consented conversations, Clio-style; blocks from uncovered clusters against the same number from a random sample. | Failure rate and effect size; 2-of-3 reproduction rate. | Uncovered rate not higher. | Paid, clustering plus about 200 runs; needs data approval. |

## "Production" data

No consented production logs exist. Stand-in: ABCD (Chen et al., NAACL 2021, MIT licence), real human
customer service dialogues in the same domain as the agent under test. "Production" = 1,000 conversations
from the ABCD train split, 8 action flows (FAQ flows excluded, their answers are not released), drawn with
`random.Random(14)`. The dialogues were collected by crowd role-play, not from a live product; the
result says so.

## Existing suite (what "covered" is measured against)

15 blocks written by `gpt-5.4-nano` from the agent's system prompt alone, before it sees any conversation:
"Write 15 distinct test scenarios a QA engineer would write for this support agent", one line each (the
customer's goal). One call, generated and committed before any clustering. This mimics a suite authored
from the prompt; it is a stand-in for a real team's suite.

## Clio-style pipeline (M3.6, small)

1. Facet: `gpt-5.4-nano` writes a one-sentence summary of the customer's request per conversation, told to
   omit names, ids, addresses and any personal value (Clio's first privacy layer).
2. Embed: `text-embedding-3-small` on the summaries and on the 15 suite lines.
3. Cluster: k-means, k = 30, `n_init = 10`, `random_state = 14`, on L2-normalised embeddings.
4. Name: `gpt-5.4-nano` names each cluster from up to 10 member summaries (for the report only).
5. Coverage: Antoniol-style hybrid cut. For each suite block, rank clusters by cosine similarity of the
   block embedding to the cluster centroid; the block links the top min(7, 30) clusters whose similarity
   is at least 0.9 x that block's best similarity ("within 10% of the best match"). A cluster is covered
   if at least one block links it.
6. Privacy gate: summaries are checked by regex for e-mails, phone numbers and digit strings of 5 or more
   characters; a flagged summary is dropped from naming (counted in the report).

## Blocks drafted

- Uncovered arm: M = min(30, max(15, U)) conversations, where U is the number of uncovered clusters; taken
  round-robin over uncovered clusters, nearest to centroid first.
- Random arm: M conversations drawn uniformly from the 1,000 (`random.Random(1414)`), excluding those
  already drafted in the uncovered arm.
- If U = 0 the hypothesis cannot be tested and is INCONCLUSIVE.
- A block = the conversation's scenario (customer facts and the one-line subflow goal) + the gold button
  set clicked by the human agent; simulated user = the "free" simulator of H10 (`gpt-5.4-nano`, tau-bench
  rules); agent = the H11 agent (`claude-haiku-5-5`, effort low). Contract: gold set is a subset of the
  agent's tool calls.

## Metrics

- Each block runs r = 3 times. Block verdict: fail if it fails in at least 2 of 3 runs (DoVer rule).
- Failure rate per arm = failing blocks / M. Effect: difference in failure rate (uncovered minus random)
  with a Newcombe hybrid-score 95% interval, one-sided Fisher exact p, and the run-level failure rate with a
  block-cluster bootstrap interval (2,000 resamples, seed 1401).
- 2-of-3 reproduction rate: share of blocks that reproduce the observed production outcome (the human
  agent resolved the case, so: pass in at least 2 of 3 runs), per arm. Also the share of blocks whose 3
  runs agree (stability).

## Falsifier (section 5, verbatim)

Uncovered rate not higher: FALSIFIED if the uncovered arm's block failure rate is at or below the random
arm's; SUPPORTED if higher, with the interval reported (an interval including 0 is said to be not
significant).

## Deviations, written before data

- Real consented logs replaced by ABCD (above). The section's "one month" has no meaning here.
- Clio's k and thresholds are not published; k = 30 is chosen for 1,000 conversations (about 33 per
  cluster). The M3.6 synthetic-reconstruction check (hold out 20 suite blocks) is not run: the stand-in
  suite has 15 blocks and no conversations of its own.
- ddmin prefix minimisation and link verification of M3.6 are out of scope (no failing production
  prefix exists: every ABCD case was resolved by a human).

## Sample size, seeds, stop rule, budget

- 1,000 facet calls, 1,000 embeddings, 2M blocks x 3 runs (90 to 180 conversations). Seeds above.
- Tiny sample first: 5 facet calls and 2 blocks x 1 run end to end, USD per unit in LEDGER.md, projection
  before scaling.
- H14 sub-budget 6 USD within the 25 USD lane cap (stop at 22.5 USD cumulative). If the projection exceeds
  it, M drops (minimum 15 per arm), written here first.
- Errors: re-run once, both kept; never counted as a fail.

## Amendments

(none yet)
