# Phrasing lane results: H1 to H4

Pre-registered at `ee620915c` before any paid call. Two amendments were made before the data they touch:
- Amendment 1 (`2b361f961`): gate fixes after three tiny samples.
- Amendment 2 (`e5036f22b`): the shared live Acme agent from `research/block-shared` at `be8bb2f8f`, merged unchanged.

Spend: 1.40 USD of the 40 USD cap (`LEDGER.md`).

| # | Claim | Verdict | The number |
|---|---|---|---|
| H4 | The gate keeps invalid realisations at or below 2%. | **FALSIFIED** (union rule) | Planted 20 of 20 caught. Audit, not human: me 0 of 50, `gpt-6.1-sol` 9 of 50, union 9 of 50 = 18% (Wilson 9.8% to 30.8%). 8 of the 9 are the class's own town-less address form; 1 is a real false accept. |
| H1 | The seed string overstates the block. | **FALSIFIED** (registered count) | Seed beats class in 6 of 10 blocks (threshold 7). The other 4 are ties at 0: the seed fails all 30 runs. In all 6 other blocks the gap is +0.15 to +0.74, CI excluding 0. Mean gap +0.30, paired SE 0.10. |
| H3 | The exact-match oracle, not the agent, causes most class failures. | **SUPPORTED** | 116 of 182 class failures become passes under the normalised oracle: 63.7% (cluster bootstrap 34.3% to 89.4%). All 116 checked by hand as formattings of the gold value. |
| H2 | Phrasing failures follow the 1 or 2 factor rule. | **SUPPORTED** (primary oracle) | The event "strength 3 finds a class strength 2 misses" occurs in 2 of 10 blocks (threshold 3). 122 of 124 consistently failing realisations are 1-way; the 2 level-3 cases are single idiosyncratic strings. On the exact oracle: 3 blocks. |

## What the lane learned
1. **The oracle is the first problem, not the phrasing.** Under today's exact Then, a reworded customer message fails mostly because the agent copies the customer's own formatting into a tool argument: `(202) 555-0131`, `Sam.Rivera@example.com`, `7 Quarry Ln, Acmeville`. Those are false failures. The normalised-slot oracle (M1.3) removes them and keeps every real failure (H3). The same effect hits seeds: the hand-written `+1 202 555 0131` fails 30 of 30 runs under the exact oracle.
2. **Real phrasing failures here are one factor.** On the shared agent, every axis-attributable failure is `slot_surface`. `Ave` and `Rd` defeat the Acme coverage tool, and the agent then offers nothing (B1, B5). The localiser finds it (H2). A strength-2 array would have caught it; no 2-way or shared 3-way failure appeared.
3. **The seed overstates the block wherever the seed passes** (6 of 6 such blocks under the exact oracle). The registered falsifier counted the 4 always-failing seeds as "seed does not beat class". Those 4 blocks fail on agent behaviour (no `catalog.search` after `port.check`) or on the oracle, whatever the wording.
4. **The class file needs its own audit.** The gate accepts what the class lists. A second labeller rejected the class's town-less address form, which the oracle and the Acme tool both accept. Surface forms are a semantic decision and need sign-off, like the realisations.
5. **Mechanism checks** (offline, before any paid call):
   - M1.3 oracle: 44 of 44 surface forms pass, 10 of 10 minimal pairs fail.
   - M1.2 localiser: a planted 2-way fault is found 50 of 50 times on strength-3 arrays, but only 34 of 50 alone on strength-2 arrays; there the pair often sits in one row, tied with that row's other pairs.
   - M1.4 envelope: interval coverage 94.7%; phrasing share estimate 0.196 against a planted 0.200.
   - The diversity threshold `min_vendi_ratio: 0.5` is not met by any block with a character n-gram kernel (0.10 to 0.24) and needs recalibration.

## Limits
- One agent, `claude-haiku-5-5` at effort low, on a 30-section research prompt; teacher-forced prefixes from the deterministic Acme agent; 10 blocks. B3's seeded transfer record is emulated by a forced tool result.
- The H4 audit was not a human audit.
- Realisations come from `gpt-6-luna` with retry feedback from the gate.

Files: `README.md` (setup, blocks and why each was picked, amendments), `h1/` to `h4/` (`PREREG.md`, `RESULTS.md`, `results.json`), `results.json` (lane summary), `LEDGER.md`, `src/`, `data/`.
