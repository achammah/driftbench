# Validator constants

This file records the numbers the validators judge by that are not derived from a seed: what each number is, where it lives in the code, how it was derived and the runs behind it. Change a number here and in the code in the same commit, on a fix/ branch with an independent review (docs/validators.md section 12).

## Generator scale

The time items `scale.10x.time` and `scale.100x.time` (docs/validators.md section 3.1). The code is in `packages/validators/src/ladders/generator/scale.ts`.

| Constant | Value | What it is |
|---|---|---|
| `SCALE_REFERENCE_UNIT_MS` | 54.5 | the reference unit's CPU time, in ms, on the host class that judges: the CI runner (ubuntu-24.04) |
| `SCALE_BUDGET_UNITS[10]` | 550 | the 10 times budget in units: floor(30000 / 54.5) |
| `SCALE_BUDGET_UNITS[100]` | 1100 | the 100 times budget in units: floor(60000 / 54.5) |
| `SCALE_MIN_UNITS` | 10 | the fewest unit samples in the window that measure anything |
| `SCALE_UNIT_WARMUP` | 5 | the sampler's units that end before the window starts, while its code is compiled |
| `SCALE_BUDGET_MS` | 60000 at 10 times, 120000 at 100 times | unchanged: the wall-clock cap is 10 times this |

### How they were derived

* The second budgets, 30 s for the two runs at 10 times and 60 s at 100 times (half of `SCALE_BUDGET_MS`), are the earlier budgets. The unit budgets keep them on a runner whose unit takes 54.5 ms.
* 54.5 ms is the mean unit over the 9 clean 100 times windows of three separate jobs on the CI runner (39062643545, 39062649024, 39062655220), three windows each, with the product of main `5b7aecea9` and PR 726. That is the product the item judges once PR 726 lands. The runners differed: the jobs' CPU time at 100 times ranged from 39603 to 53281 ms, and their unit from 46.57 to 62.95 ms.
* The units held across those jobs: 823 to 850 at 100 times, a 3% spread, while the CPU time moved by a third. The pass condition was a spread under 15%. The six earlier jobs, on main `183abfd` (an older product with more specs), read 1097 to 1217 (11%); their mean unit was 51.3 ms.
* Both time items divide by the unit of the 100 times window of the same ladder run. In the same job, the unit read 2 to 32% dearer in a 10 times window than in a 100 times one. Alone on a Mac the sampler's unit is flat from its second unit on, so the excess most likely comes from the product starting up beside it, a larger share of a short window. Read in its own window, a 10 times run would count up to a quarter fewer units, and the 10 times budget would mean up to 39.6 s.
* The minimum is 10 samples. With the faster product, a 10 times window gave 11 to 14 samples and a 100 times window 127 to 134.
* The warm-up is 5 units. Before it, the unit cost 13 to 37% more in the 10 times windows than in the 100 times windows (jobs 39032147370 to 39032157025); after it, 0 to 33% more (jobs 39040741057 to 39040752461).

### The runs behind them

`validators/generator/evidence/scale-reference-unit-runner.jsonl` holds every row. The scale window at 10 and 100 times the behaviours of seed 1, beside the sampler, on the CI runner, dispatched separately (`jobs=generator-scale,plants`).

**The calibration, product main `5b7aecea9` with PR 726** (head `816b2dd03`). The plants ran under the budgets of the time, 584 and 1169; the verdicts below are at 550 and 1100.

| Job | Clean 100x CPU ms | 100x unit ms | Clean 100x units | Clean 10x units (100x unit) | Over 30 s at 10x | Twice as slow | Quadratic, 0.012 µs | Host three times slower |
|---|---|---|---|---|---|---|---|---|
| 39062643545 | 52965 to 53281 | 62.89 to 62.95 | 842 to 847 | 125 to 128 | 34227 ms, 549 | 1461 | 950 | 828 |
| 39062649024 | 39603 to 40602 | 46.57 to 48.15 | 831 to 850 | 125 to 140 | 33574 ms, 709 | 1499 | 974 | 856 |
| 39062655220 | 43502 to 44818 | 51.60 to 54.12 | 823 to 843 | 123 to 130 | 33459 ms, 664 | 1480 | 927 | 835 |

At 550 and 1100 units:
* **Clean passes** on every job (823 to 850 against 1100).
* **Twice as slow fails** (1461 to 1499 units).
* **The product over 30 s at 10 times fails on two jobs of three** (709 and 664 units). On the slowest runner (unit 62.3 ms, 14% slower than the reference), its 34.2 s is 549 units, which passes: 34.2 s there is 29.9 s of the reference runner's work. The item holds the earlier 30 s on a runner of the reference speed, and scales it with the runner's speed, as the 100 times item does.
* **The planted quadratic at 0.012 µs no longer fails** (927 to 974 units). Its cost grows with the square of the specs written, and this product writes about half the specs of the earlier one, so the same constant adds about a fifth of the time. `scale-run.ts` now plants 0.05 µs; its runs are in the pull request that set these numbers.
* **The planted slower host reads the clean units** (828 to 856). It cancels by construction: it checks the division, not a real slower host. The jobs above are that evidence.

**Checks at 550 and 1100, after the re-derivation** (head `e3243af72`, not used to derive the numbers), and the product without PR 726:

| Job | Product | Clean 100x CPU ms | 100x unit ms | Clean 100x units | Over 30 s at 10x | Twice as slow | Quadratic, 0.05 µs | Host three times slower |
|---|---|---|---|---|---|---|---|---|
| 39064004364 | main `5b7aecea9` + PR 726 | 30539 to 32332 | 30.92 to 34.14 | 947 to 988, pass | 33304 ms, 1022, fail | 1764, fail | 1853, fail | 954, pass |
| 39064011410 | main `5b7aecea9` + PR 726 | 50824 to 51407 | 60.42 to 61.89 | 822 to 842, pass | 34038 ms, 550, pass | 1483, fail | 1220, fail | 831, pass |
| 39064071084 | main `5b7aecea9`, without PR 726 | 175195 to 178173 | 53.52 to 54.67 | 3221 to 3306, fail | not run | not run | not run | not run |

* Over the five jobs with PR 726, the clean units ran from 822 to 988: 20% apart, over the 15% the calibration's three jobs held (3%). The fastest runner, whose unit took 31 to 34 ms, read about 16% more units than the others: there the unit sped up more than the product did.
* The product over 30 s at 10 times passes on the slowest runner (550 units, exactly the budget): 34.0 s there is 30.0 s of the reference runner's work.
* PR 726 takes the clean 100x window on the runner from 175195 to 178173 ms (3221 to 3306 units, failing) to 30539 to 53281 ms (822 to 988 units, passing).

**The first calibration, product main `183abfd`**, six jobs, budgets 584 and 1169 at 51.3 ms:

| Job | Head | Clean 100x CPU ms | Unit ms | Clean 100x units | Clean 10x units | Twice as slow | Quadratic | Host three times slower |
|---|---|---|---|---|---|---|---|---|
| 39032147370 | `1b1c8c1b2` | 68540 to 69513 | 57.34 to 58.28 | 1181 to 1209 | 138 to 165 | 2005 | 1734 | 1177 |
| 39032152170 | `1b1c8c1b2` | 72952 to 73549 | 64.08 to 64.48 | 1137 to 1144 | 138 to 145 | 1879 | 1617 | 1147 |
| 39032157025 | `1b1c8c1b2` | 53395 to 53930 | 44.34 to 45.65 | 1174 to 1216 | 146 to 159 | 2095 | 1921 | 1188 |
| 39040741057 | `ea28036fa` | 72657 to 72844 | 64.29 to 66.21 | 1097 to 1133 | 144 to 150 | 1940 | 1652 | 1133 |
| 39040746597 | `ea28036fa` | 37450 to 37551 | 30.83 to 31.56 | 1187 to 1217 | 170 to 192 | 2123 | 2306 | 1260 |
| 39040752461 | `ea28036fa` | 53176 to 53422 | 44.27 to 45.25 | 1175 to 1204 | 143 to 169 | 2064 | 1918 | 1188 |

At the budgets above, on every job:
* **Twice as slow fails** (1879 to 2123 units). Each generation spends its own CPU time again.
* **Quadratic fails** (1617 to 2306 units). After each generation, it spends 0.012 µs times the specs squared.
* **The clean product sits at the budget** (1097 to 1217 against 1169), so its verdict depends on the runner. The product passes on some runners and fails on others: it is too slow for a margin, and that is a product finding.
* **The planted slower host gives the clean product's units** (1133 to 1260). It reads every CPU time in the child and the sampler as three times the real one, so it cancels by construction: it checks the division, not a real slower host. The runner jobs above are the evidence that a slower host keeps its units.

On a Mac with 12 cores, shared and at load 40 to 90, the same product read 266 to 313 units at 10 times and 1626 to 2430 at 100 times. The unit stayed at 26 to 27 ms while the product's CPU time moved from 42 to 63 s with the load. The unit corrects for the speed of a runner, not for contention on an oversubscribed host, so a Mac's units do not compare with a runner's.

### Earlier measures, kept for the record

* An absolute budget of 30 s and 60 s of CPU time: the same code took 47 to 98 s on that Mac.
* A file-based unit (200 small JSON files written, read and deleted): 21.5 to 22.1 ms on the runner against 38 to 40 ms on the Mac, while the product cost more on the runner. The same run read 2.1 times more units there.
* The growth from 10 to 100 times in one process: it does not catch a product twice as slow, since both sizes slow down alike (clean 6.5 to 11.1, twice as slow 7.5 to 9.1). The blocks scale family's slack of 4 times the multiple is 40, and a quadratic product grew only 14.8 to 18.0.
