# Ledger hard-row dossier

Closed Haiku, Luna and Flash-Lite results retained; added models complete. Recording analysis generated 2026-10-14T03:20:48.745797+00:00. All case and result counts come from the linked files in `comparisons/ledger-hard/`.

- Gemini 3.8: dropped by the owner on 13 Oct 2026, partial data kept, not reported as a score. Flash Lite remains the Gemini result. Gemini 3.8 has zero pending requests and must not resume.
- 6560 primary and 9578 dialect unique recorded requests, including the goal equal-evidence ablation.
- Measured spend across all recorded cells, including archived Gemini 3.8: USD 63.35521020. Unreported-attempt reserve: USD 4.90000000. Combined: USD 68.25521020. Separate authorized allocations total USD 91; each model allocation is enforced independently.
- The construction audit passes. No pool is withdrawn. This is synthetic evidence on the original construction families.
- Primary and dialect results remain separate. The dialect run uses the same cases and is not an independent replication.

## Interpretation and coverage

The pooled default comparison includes a goal row where the candidate receives final state and the default peer does not. The pooled equal-evidence comparison supplies final state to both. It is the appropriate evidence-matched comparison. Per-row exact tests are nominal; family bootstrap intervals show construction-family uncertainty. A non-significant result does not establish equivalence. The global Holm decision belongs to the collator; the added Flash-Lite model expands the original 18-cell matrix.

Haiku has a nominal pooled equal-evidence lead in both experiments, with family bootstrap difference intervals above zero. Luna has no significant pooled equal-evidence lead at provider default; its primary rubric row has a nominal loss. The medium dialect has a nominal Luna pooled lead, but its family bootstrap interval includes zero. The closed Luna primary result retains its original counting rule, including six transport-only rows counted inconclusive. Any post-close recovery is a separately labelled addendum. These results do not establish superiority on every hard row.

| Experiment | Model | Cases in each row | Pooled default W/L | Pooled equal-evidence W/L | Equal-evidence exact two-sided p | Status |
|---|---|---:|---:|---:|---:|---|
| Primary | gpt-6-luna | 384/384 | 222/13 | 25/13 | 0.072951389 | TIE (not equivalence) |
| Primary | haiku | 384/384 | 230/9 | 71/11 | 6.813783e-12 | nominal lead |
| Dialect | gemini-3.8-flash | Dropped | Not reported | Not reported | Not reported | dropped by the owner on 13 Oct 2026, partial data kept, not reported as a score |
| Dialect | gpt-6-luna | 384/384 | 218/7 | 19/7 | 0.028959274 | nominal lead |
| Dialect | haiku | 384/384 | 236/2 | 82/2 | 3.6923275e-22 | nominal lead |
| Primary | gemini-3.5-flash-lite | 384/384 | 236/19 | 83/12 | 3.211394e-14 | nominal lead |
| Dialect | gemini-3.5-flash-lite | 384/384 | 227/14 | 74/12 | 4.6897605e-12 | nominal lead |

The separate Flash-Lite cell records 6560/6560 unique requests, at USD 8.18203290. Its amended USD 9 allocation raises the original work cap to USD 21. It uses medium reasoning as accepted by the API, with separate results and no reused Gemini 3.8 answers.

## Added Sonnet and GPT model cells

The owner requests claude-sonnet-5-5 and gpt-6.1-sol on the same sealed cases. Each model carries both experiments and the equal-state goal ablation, totaling 6560 unique requests. Seal commit `afbd8abf` precedes every added-model call. The first five calls are retained once; continuation is gated only on measured cost, model identity and transport integrity.

| Model | Recorded / planned | Cost USD | Reserved USD | Lost requests | Token-limited entries | Coverage |
|---|---:|---:|---:|---:|---:|---|
| claude-sonnet-5-5 | 6560/6560 | 33.72676500 | 1.00000000 | 60 | 0 | Complete |
| gpt-6.1-sol | 6560/6560 | 12.44696800 | 3.50000000 | 3 | 3 | Complete |

| Model | Experiment | Ours USD | Default peer USD | Equal-state peer USD |
|---|---|---:|---:|---:|
| claude-sonnet-5-5 | primary | 7.87851590 | 5.85831200 | 1.93785000 |
| claude-sonnet-5-5 | dialect | 10.29168400 | 5.82475910 | 1.93564400 |
| gpt-6.1-sol | primary | 3.33146000 | 1.98270400 | 0.66926200 |
| gpt-6.1-sol | dialect | 3.81344600 | 1.98087400 | 0.66922200 |

Contestant costs count unique recorded calls. Reserved costs remain separate. Unanswered transport requests stay pending and receive no judge score. Full per-row scores, discordant wins/losses, exact tests, intervals and lost keys appear below only for fully answered model cells.

The network amendment pauses both paid drivers, then permits automatic resumption only after ten consecutive unpaid provider reachability probes spaced thirty seconds apart. Only one model runs at a time, with two concurrent calls. Three consecutive connection failures cause a ten-minute pause and a fresh ten-probe gate. Recovery cycles are unlimited within the unchanged caps and cutoff; answered requests are never resent. Unknown charges keep their reserves. Gemini 3.8 is dropped; no calls will resume.

Sonnet receives an owner-approved USD 45 cap including holds. Its first five calls cost USD 0.028311; the next five with prompt caching disabled cost USD 0.025412. The cheaper no-cache route applies to both contestants. These disjoint pilot prefixes differ in request mix; their cost comparison is approximate. All ten model answers count once. One CLI transport envelope is archived verbatim, classified as no answer, and recovered on its second attempt.

The zero-token CLI API-error audit checks 6560 Haiku, 6560 Luna and 6560 Flash-Lite recorded requests. It finds zero matching envelopes in those earlier cells. Their answers remain unchanged. `api-error-envelope-audit.json` holds counts and journal hashes.


## Luna cache-write fee reconciliation

The published Standard cache-write price is USD 0.125 per million tokens versus USD 0.10 for ordinary input. The fee-only reconciliation adds USD 0.001804 for 72160 written tokens in the recorded Luna receipts. The original answers and frozen statistics are unchanged. Historical tables below retain their original cost fields; this additional fee is included in the current overall spend above. Source: `luna-cache-write-fees.json`, [OpenAI pricing](https://developers.openai.com/api/docs/pricing), checked 2026-10-13.


## Construction-cue audit

`audit-construction.py` reads only source, seeds, sealed cases and rendered prompts. `construction-cue-audit.json` SHA-256 is `e3fa7df6ce99c0596072bd808c4e37f5e0917728a6dc687ed65bb44dc5cd7026`. It checks all 3456 primary and 10368 dialect rendered inputs. No model outcomes inform this audit.

| Row | Cases | Trusted contexts paired across labels | Imbalanced trusted token values | Imbalanced identity suffix values |
|---|---:|---:|---:|---:|
| rubric | 384 | 192 | 0 | 0 |
| factuality | 384 | 192 | 0 | 0 |
| pii | 384 | 192 | 0 | 0 |
| goal | 384 | 192 | 0 | 0 |

Entity identifiers are assigned once per pair, before the true/false loop. Every trusted context appears once per label. Identity values, parity and last digits are balanced. Complete token contingency tables are retained, including semantic answer differences that correlate with truth. Case id, generation, family and truth metadata are excluded from model inputs. The audit rules out these construction cues; it does not establish absence of every semantic shortcut.

## Historical crash recovery and runtime amendments

The following operational history is superseded by the owner drop for Gemini 3.8. It does not authorize further Gemini 3.8 calls.

The plugin crash left 12 primary and 8 dialect calls without recorded answers. The owner authorized one re-ask of each key below. 20 keys now have exactly one final recorded answer and are counted once. The lost attempts retain USD 0.40 reserve. Sources: `crash-recovery.json`, `recovery-amendment.json`, both `starts.jsonl` files and both `recovery-attempts.jsonl` files.

| Experiment | Model | Case | Side | Crash-lost key | Recovery status |
|---|---|---|---|---|---|
| primary | gpt-6-luna | ledger-hard-factuality-g1-112 | audit | `438891e62de0816e44e06852f49aa8fd55883ec0b9e0f56149b61fcfba4a8b58` | Re-asked once after crash; one recorded answer |
| primary | haiku | ledger-hard-pii-g1-112 | audit | `ff8278c3970d750439ce77c9deab64e05c942d6af3fdc748bbfbfa45fded04b3` | Re-asked once after crash; one recorded answer |
| primary | gpt-6-luna | ledger-hard-pii-g1-112 | audit | `81c6bd280b0f428bf36192e31135e81c478d42458044c898f360035da5da0693` | Re-asked once after crash; one recorded answer |
| primary | haiku | ledger-hard-pii-g1-112 | peer | `2dba0ad036d7163a79a08c6b32f4b4d77c35a386d0b017ae9f402ba13e904f1e` | Re-asked once after crash; one recorded answer |
| primary | gpt-6-luna | ledger-hard-pii-g1-112 | peer | `aa13f4e629e4448c465e7921fe86b7489d9a429c920873a31fc29cf06ddaa99f` | Re-asked once after crash; one recorded answer |
| primary | haiku | ledger-hard-goal-g1-112 | audit | `62abfcf0dd651cf4c120d186cee8a289f8c440c389aecc68fcc8ee6038073f08` | Re-asked once after crash; one recorded answer |
| primary | gpt-6-luna | ledger-hard-goal-g1-112 | audit | `75054921e18feb825857c4dea247117ff1999f60b046ac8650984a98ef873e25` | Re-asked once after crash; one recorded answer |
| primary | haiku | ledger-hard-goal-g1-112 | peer | `a3645f888564e96f00e53dfec26037a923a8b50851da47f6c848c5019d4fd5e6` | Re-asked once after crash; one recorded answer |
| primary | gpt-6-luna | ledger-hard-goal-g1-112 | peer | `ac7ce0533b2f052c0c155ef390f41c57333b3459c22eb31f64978085bfe1de93` | Re-asked once after crash; one recorded answer |
| primary | haiku | ledger-hard-goal-g1-112 | peer-full-state | `c6431106dafa9f862565cc535f35887238b39c95449017c76954bc0964389297` | Re-asked once after crash; one recorded answer |
| primary | gpt-6-luna | ledger-hard-goal-g1-112 | peer-full-state | `c53d5d1fad72de2dd1bb38f0602b24ad612fdd1062cddeb9c520c7afaf921104` | Re-asked once after crash; one recorded answer |
| primary | haiku | ledger-hard-rubric-g1-113 | audit | `c02dc147ca5809e7d16346883fa26d56889a29093df65e83891cc04bf4b8930e` | Re-asked once after crash; one recorded answer |
| dialect | haiku | ledger-hard-goal-g1-014 | peer-full-state | `37f631f4ad747b19dcbe42f8e4f3ae06236afbb525ed534561878488bc18f085` | Re-asked once after crash; one recorded answer |
| dialect | haiku | ledger-hard-goal-g1-015 | audit | `5dc4c36604adbc654d484e2ff1c053c23283b05829d1b7f028a167eff08df3b3` | Re-asked once after crash; one recorded answer |
| dialect | haiku | ledger-hard-goal-g1-015 | peer | `cb346872a3a35a21bc33ffef789822982e53b3a75f565d6cf4a63d21d335d376` | Re-asked once after crash; one recorded answer |
| dialect | haiku | ledger-hard-goal-g1-015 | peer-full-state | `1dc46d5f271a5c72f1b76bee16db75c2414c40de984874d50ef2c7bf785bb52f` | Re-asked once after crash; one recorded answer |
| dialect | gemini-3.8-flash | ledger-hard-goal-g1-015 | audit | `88fceb4b04f16b79f0e4eb8603903c5c781c646d036ba0428ac58929b75407a9` | Re-asked once after crash; one recorded answer |
| dialect | haiku | ledger-hard-goal-g1-016 | audit | `1ca775b8e7c8d91d767399d8520b63c67d86a4ec8193a60d9c6660aa3b2e8c34` | Re-asked once after crash; one recorded answer |
| dialect | haiku | ledger-hard-goal-g1-016 | peer | `0eb042fc91a35341bf1859b8ef29a3a3516fe109ecc1d44e87318c3aa8e0292f` | Re-asked once after crash; one recorded answer |
| dialect | gemini-3.8-flash | ledger-hard-goal-g1-015 | peer | `a0891e0f464fb6828464d1a10fe960da10dbc0a83ca307c52a939f87f357fc8f` | Re-asked once after crash; one recorded answer |

Existing HTTP calls drain before runtime amendments. The later daily-quota instruction explicitly abandons two workers during backoff, after their HTTP responses return. The combined four-call cap and adaptive Luna four/two pacing applied until the later pacing boundary. `pacing-amendment.json` then replaces those concurrency limits with shared per-model limits across both experiments: gpt-6-luna eight, Gemini two, Haiku two. Luna uses plain HTTP. Independent rotating queues preserve each sealed request order and keep all three models running side by side. Sources, cap and answer contracts remain unchanged.

Historical Gemini 3.8 HTTP 429 policy used waits of 60, 120 and 240 seconds. Gemini 3.8 was dropped by the owner; exhausted quota retries are archival and unscored, with no pending continuation. Other unanswered transport failures use at most three attempts with 10/30-second waits. Every transport failure and backoff remains recorded; content is never retried. `quota-amendment.json` retains this retry policy under the later per-model pacing amendment. Unanswered attempts have no reported usage; measured cost excludes unreported charges.

Gemini prepaid credit depletion produces HTTP 402. The 532 empty rejections before the billing hold are preserved byte-for-byte in `dialect/billing-rejections.jsonl` and in the attempt journal. They carry no answer or reported usage, release only their proven-rejection holds, and never enter judge scores. No 402 receives an automatic retry. `billing-amendment.json` records the stop and the requirement for explicit owner top-up confirmation before missing-only resumption. The USD 0.40 crash reserve remains.

The owner subsequently confirms a Gemini top-up. `gemini-topup.json` names one missing request as the probe. It returns an answer, recorded once in the normal journal; `gemini-probe-result.json` records its cost and the hold release. Only requests without recorded answers resume, at two Gemini calls. The 429 waits and 402 circuit break remain active.

The owner raises the cap from USD 10 to USD 12 solely to finish the same sealed requests. `budget-amendment.json` records this runtime authorization. The case pool, request order, prompts, reasoning settings, answer contracts and statistics remain unchanged. The USD 0.40 lost-attempt reserve stays in the budget.

Primary Luna keeps provider-default reasoning for both contestants and omits temperature. The API does not report which reasoning setting that default resolves to. Dialect Luna and Gemini use medium for both contestants. Haiku exposes no reasoning control in this harness.

## Gemini 3.8 owner decision

dropped by the owner on 13 Oct 2026, partial data kept, not reported as a score. Flash Lite remains the Gemini result.

The 262 requests never completed under the earlier quota hold are removed from pending work. No resume, probe or replacement call is scheduled. Partial recordings and their hashes are retained in `gemini-3.8-owner-drop.json`. Historical raw score files remain archival only and are excluded from current reported tables and scoring inputs. Recorded spend remains charged; no model budget is increased.

## Native parity and verification

`verification-final.json` records coverage by model, unique scored keys, disjoint experiment keys, exact goal labels, original payload non-overlap, immutable source hashes, registered crash re-asks, resolved model IDs and the budget. `peer-decoder-parity.mts` replays every recorded successful peer answer through the pinned native verdict functions, including the native YAML fallback. `trajectory-parity.mts` checks all 384 goal summaries against the pinned helper.

| Experiment | Unique calls | Native peer answers checked | Final unsuccessful calls | Unscored billing rejections | Measured USD |
|---|---:|---:|---:|---:|---:|
| primary | 6560/6560 | 3488 | 0 | 0 | 1.83894069 |
| dialect | 9578/9840 | 5080 | 0 | 532 | 7.15869961 |

Focused protocol/recovery tests pass; `test-output.txt` retains the test result. Every raw response and usage record remains in the journals. Haiku cache creation and cache reads are separate from ordinary input tokens in `verification-final.json`; CLI-reported cost is authoritative. The peer native YAML dependency is the pinned js-yaml 5.4.2 bundle, with npm integrity and upstream provenance under `native-validation/`. No node_modules directory is copied.

## Freeze hashes

| Artifact | SHA-256 |
|---|---|
| `seal.json` | `5845e97e2651d2942134209e4abfa8f932409744930bd0d143ebbe03877b07a4` |
| `accounting-amendment.json` | `78c421dcc4f879f9baedb638dc4069ec63552513c0a7165e23fe442f0bdf8789` |
| `transport-amendment.json` | `2abc52d4c0879a8bcdb32e3f05667c7ae05916605912fae26bda2531a053cecf` |
| `dialect/seal.json` | `ebbc5876d5a9d482203382d33c7fa3c0ee640b6e1254bf821784004493cd85d9` |
| `recovery-amendment.json` | `19edca959d34feb34bd278ab86933578a39adb7cf59d2ea80e74c55603d1d567` |
| `concurrency-amendment.json` | `ddded416295abc477c4513e265686f850074d1903aec26614ecd2ee1afc4f699` |
| `quota-amendment.json` | `626fff9cb3b33387f9971f9ae8dc892c9df8f931b119ff9ffab8d8b45530291a` |
| `pacing-amendment.json` | `f2934ef948c4a1c6cd7d2231a879ea2fd7c792e12c5064f2671be9e6f241c8e4` |
| `billing-amendment.json` | `dbf4921ae5340fe1231e750141f1cd748857d71d6633e314a90c9348664fc94f` |
| `gemini-topup.json` | `52d9eb92d4d3d91f7bc753c1f33a5181f95e4ea0b24cc223d202648671490f83` |
| `topup-runtime-amendment.json` | `f98aaa1dca7a2a78a261053a7c844acbcf166451668399411763e0867b1efc50` |
| `gemini-probe-result.json` | `3ee1edc838607e69e304755ae9551b586669c0dd6c3ebba39c53a1e8e30e9391` |
| `budget-amendment.json` | `721f7a1b0871220ee61ef506a7b422d1e64cf1e60cb6de334d0908180b7128c4` |
| `daily-quota-amendment.json` | `67f64ff18c53e3527652ee7aadbcfaa35b83bedbc060fdd13baced18a49f4de6` |
| `owner-hold-amendment.json` | `1a5e4ef20548794adb0572ccb8a425953dea2f3aa89004d10ae9c0412532cfe4` |
| `crash-recovery.json` | `7a033003ca9a0813b34d752ed9360a8d8502274ea502f962aa05e8ac59178308` |
| `seeds.json` | `8aa6b101d2feaf60c27f36ee7521ff7e53d3c5c247817b29e98902d6ed6dc40d` |
| `prompts.json` | `9d8bfad218065453b74a13d3841164c9a3cdb454165ca703c76bde93c3bdae4c` |
| `dialect/prompts.json` | `2fe5c23508da1f5ee542d9c6ceb10313a96336e64f45182df74ae3d72a756bef` |
| `score.py` | `4cb7aca0df33899a1479105efae3535a8d635f1eab9c3e1d3ee455ca6243fecd` |
| `dialect-score.py` | `98092ff0d7d5876a829eaaa08af5eca68d078afda5926bfdbeadb0c0aa31e917` |
| `verification-final.json` | `12fcb081229caf60a2807ae5d00226862464886fb490de4f135aed31d8d0ea87` |
| `flash-lite/seal.json` | `52ff207f43756150597aa803a95ebcb67c85984f75117bb0ad82e6cf52862e44` |
| `flash-lite/budget-amendment.json` | `e7b37ecc70ea0528a2f70132f3ecd6e90c7cb9eb4987cf7d0e712ab77ec6a2e6` |
| `flash-lite/pricing.json` | `ac8269b65b41e8db47c60349987c796741118df14390a0ad1da364262bff34fa` |
| `flash-lite/reasoning-applied.json` | `d37718bb39d54c5a81cd64e4b8b6cac9c47d812ab45adb43301dfa7613b9d881` |
| `flash-lite/scores.json` | `eea4ebc7597465e1d53fcd5e5107f4043233da7be5d41f38510aab549212dbb8` |
| `extended-runtime-amendment.json` | `5258abc415390115d72df5f708c5c44d8a417763f058fcbbd27ef0ebce8fd88c` |
| `network-amendment.json` | `4b5b416c60a04c7f0c254886d56c3d8e90eaab86e8c3b4e901ddb49a287c1501` |
| `api-error-envelope-audit.json` | `81a065964e7f2d3d6b673f6fe09292bb0163e146f6a6bf1c3e70aa2d0ff3c862` |
| `luna-cache-write-fees.json` | `4526217a47a3b65bdfe8f6778c01293476001512d72f2bed598811219e608f2f` |
| `closed-cell-reporting-amendment.json` | `109b5e71886ab3b65a7395aaadfb022d281cc6bfa8483592fdadd7a6dceed33a` |
| `luna-transport-census.json` | `fcca3181f82d613f704e0d56ae2b9ecf9fa73b91a18f3d15a1337ebcb6451482` |
| `audit-network-runtime.py` | `c7c79a4d485b8132e5604f08c02018861daee09f4ef150d08413628600d1c6be` |
| `network-verification.json` | `e64f89de51c072485a009165315087ad13c5b0cd4010d87589e43448a6b5f05f` |
| `network-finish.py` | `af1807aa4dbae06eee44d9d1e6280847b72fbe9eaace9ef0d3c05ab94a8e5e50` |
| `gemini-3.8-owner-drop.json` | `56061b82b578dfd3814c6ccb7b1ccb3f510168fc96b26458ad2106f1ebf0903f` |
| `supervisor-amendment.json` | `3ad71b77206c9ce5c2d1aba6925be22f06b29372a115263756a96c0cf73422b8` |
| `gpt-6.1-sol/host-crash-recovery.json` | `503a6cc6738d1b39bfb4ef3a041c29541aa2d25f1f12ba52cf220eb3eac76ac1` |
| `sonnet-5-5/seal.json` | `ba83523dd663834077afdeae20cae22d361e53d8c6025cda75fb9379ac7d5e18` |
| `sonnet-5-5/pricing.json` | `00cfb936f27a78787e18a6de3d73f9cb3a34369f1fbb6685f5217fe56a409fd8` |
| `sonnet-5-5/pilot.json` | `787fabc4c202494523c00f3bc901cf68ac70f7207068bc778a158fdb8ee49490` |
| `sonnet-5-5/cache-pilot.json` | `aabb84a1a730cd069952093c835f83401bc1246773d37ccf87638c2dbcf03b0c` |
| `sonnet-5-5/cache-choice.json` | `5ee1e9ecd123dc231989356c8716efd82aa4b359124d2969b7ec41578812280a` |
| `sonnet-5-5/scores.json` | `1b16d2c048ba4f4a22e884cdd88516e5a23b5b04c67196f117d0e116bd6d5321` |
| `sonnet-5-5/verification.json` | `3aeb6c32c643335ef4c55c9aa03cb2370936dad4828aae735e15b406c58ee35d` |
| `sonnet-5-5/budget-amendment.json` | `25be91c20ee2ab813e3163e41b856a6feb2950caf6981255fd8ca4075af28a3e` |
| `sonnet-5-5/transport-reconciliation.json` | `7881758f88d38dade69aa27e1d640f7d6f8431e0c71cd44ddf789d6410c0ae81` |
| `gpt-6.1-sol/seal.json` | `ffb0d67a7d4582f3b358e5b8cb28e462f86aebd73edb1463d9d7adbdaeb349f4` |
| `gpt-6.1-sol/pricing.json` | `9e34faa1a5e372521d5789d0962ce059eb502889daab0abcd51cab466d874d97` |
| `gpt-6.1-sol/pilot.json` | `cc0331aab66dc66b6be33c2e1513839fda11cfe4dd96fa43bd7b935c6ab62c1f` |
| `gpt-6.1-sol/scores.json` | `4f3d2b697acea50155851bafa375cc9a0d73b75feb260611c0d2ab4a041a72f4` |
| `gpt-6.1-sol/verification.json` | `b6c256c1e935a63206f185e361bd171ff295490cbbe17f4e47f72a3fc3207ee5` |

Candidate procedure: `d7f5e226bf5afe7b955ee0f2247835cd19953001c196dcc7260d1f0c37922587`. Original seal commit: `eeb7875e`. Core dialect source: `2bb0a7a787ca4466ff69d204f2380a7ad19cc056`; dialect seal commit: `a7954b1b`. The per-file source hash maps remain inside the seals and operational amendments.

## Original primary tables

# Promptfoo hard rows: fresh sealed cohort

Generated 2026-10-13T11:20:31.272301+00:00. All results below derive from `comparisons/ledger-hard/scores.json`, `decisions.json` and `calls.jsonl` on `research/ledger-hard`.

Frozen criterion-ledger candidate, not a shipped-default claim. Synthetic cases retain the original construction families. Gemini was not run in this original two-model primary experiment. The separately frozen dialect variant below includes all three models.

## Sealed cases

| Row | Seeds | Cases | Pass/fail | Prior payload overlap | File SHA-256 |
|---|---|---:|---|---:|---|
| rubric | [61155780, 75192967] | 384 | 192/192 | 0 | `40db40f57eb9637567837eb4892621eb8938340d912fef6d6824588d54dbc534` |
| factuality | [37514137, 59241593] | 384 | 192/192 | 0 | `a911d58077aeabc9d57b49432c45fa766a4fb06406a484ac0f73b46e33cbc097` |
| pii | [75489315, 32827230] | 384 | 192/192 | 0 | `26bd69f53020c97f0dd9dc88f9c877d87b288cf925ee47d0510acab02bb718f1` |
| goal | [41332820, 84695301] | 384 | 192/192 | 0 | `f9053a77f34e175a3e7113a9749840f8d0652a2cebcb46d1f78d8fdd397d8a2a` |

Prior census: 317 historical/worktree sources, 1204 distinct earlier full payloads. `prior-census.json` carries every source and digest. Full payload means the exact criterion-ledger request, including final state for goal. The default trajectory peer intentionally shares requests between state-distinct cases.

The generator runs two generations of 192 per row. Every row has 12 families, 32 cases per family, with 16 passing and 16 failing. Phone area bindings differ across the two generations, retaining reserved 555-01xx numbers. Labels, prompts and analysis are sealed before the first call.

## Per-row and pooled exact comparisons

| Model | Row / evidence | Paired / sealed | Ours | Peer | W | L | Exact two-sided p | Exact one-sided p | Status |
|---|---|---:|---:|---:|---:|---:|---|---|---|
| haiku | rubric / peer | 384/384 | 373 | 370 | 7 | 4 | 281/512 = 0.54882812 | 281/1024 = 0.27441406 | TIE (not equivalence) |
| haiku | factuality / peer | 384/384 | 384 | 352 | 32 | 0 | 1/2147483648 = 4.6566129e-10 | 1/4294967296 = 2.3283064e-10 | nominal lead |
| haiku | pii / peer | 384/384 | 378 | 381 | 2 | 5 | 29/64 = 0.453125 | 15/16 = 0.9375 | TIE (not equivalence) |
| haiku | goal / peer | 384/384 | 381 | 192 | 189 | 0 | 1/392318858461667547739736838950479151006397215279002157056 = 2.5489471e-57 | 1/784637716923335095479473677900958302012794430558004314112 = 1.2744735e-57 | nominal lead |
| haiku | goal / peer-full-state | 384/384 | 381 | 353 | 30 | 2 | 529/2147483648 = 2.4633482e-07 | 529/4294967296 = 1.2316741e-07 | nominal lead |
| haiku | pooled-default / mixed | 1536/1536 | 1516 | 1295 | 230 | 9 | 391443940536313/27606985387162255149739023449108101809804435888681546220650096895197184 = 1.4179163e-56 | 391443940536313/55213970774324510299478046898216203619608871777363092441300193790394368 = 7.0895814e-57 | nominal lead |
| haiku | pooled-equal-evidence / mixed | 1536/1536 | 1516 | 1456 | 71 | 11 | 4118679106637/604462909807314587353088 = 6.813783e-12 | 4118679106637/1208925819614629174706176 = 3.4068915e-12 | nominal lead |
| gpt-6-luna | rubric / peer | 384/384 | 370 | 379 | 4 | 13 | 1607/32768 = 0.049041748 | 65119/65536 = 0.99363708 | LOSS |
| gpt-6-luna | factuality / peer | 384/384 | 384 | 383 | 1 | 0 | 1 = 1 | 1/2 = 0.5 | TIE (not equivalence) |
| gpt-6-luna | pii / peer | 384/384 | 384 | 369 | 15 | 0 | 1/16384 = 6.1035156e-05 | 1/32768 = 3.0517578e-05 | nominal lead |
| gpt-6-luna | goal / peer | 384/384 | 384 | 182 | 202 | 0 | 1/3213876088517980551083924184682325205044405987565585670602752 = 3.1115076e-61 | 1/6427752177035961102167848369364650410088811975131171341205504 = 1.5557538e-61 | nominal lead |
| gpt-6-luna | goal / peer-full-state | 384/384 | 384 | 379 | 5 | 0 | 1/16 = 0.0625 | 1/32 = 0.03125 | TIE (not equivalence) |
| gpt-6-luna | pooled-default / mixed | 1536/1536 | 1522 | 1313 | 222 | 13 | 12664829932210496241/431359146674410236714672241392314090778194310760649159697657763987456 = 2.9360291e-50 | 12664829932210496241/862718293348820473429344482784628181556388621521298319395315527974912 = 1.4680145e-50 | nominal lead |
| gpt-6-luna | pooled-equal-evidence / mixed | 1536/1536 | 1522 | 1510 | 25 | 13 | 2506590623/34359738368 = 0.072951389 | 2506590623/68719476736 = 0.036475694 | TIE (not equivalence) |
| gemini-3.8-flash | All rows | Not reported | Not reported | Not reported | Not reported | Not reported | Not reported | Not reported | dropped by the owner on 13 Oct 2026, partial data kept, not reported as a score |

## Uncertainty and usage

| Model | Row / evidence | Wilson ours | Wilson peer | Family bootstrap difference | Inconclusive ours/peer | USD/100 ours/peer |
|---|---|---|---|---|---|---|
| haiku | rubric/peer | [94.944%, 98.393%] | [93.974%, 97.816%] | [-2.344%, 5.208%] | 11/0 | 0.042626/0.030860 |
| haiku | factuality/peer | [99.010%, 100.000%] | [88.473%, 94.035%] | [0.000%, 19.531%] | 0/0 | 0.044178/0.035662 |
| haiku | pii/peer | [96.634%, 99.282%] | [97.729%, 99.734%] | [-3.906%, 1.562%] | 0/0 | 0.045940/0.035804 |
| haiku | goal/peer | [97.729%, 99.734%] | [45.024%, 54.976%] | [47.917%, 50.000%] | 0/0 | 0.050216/0.025509 |
| haiku | goal/peer-full-state | [97.729%, 99.734%] | [88.769%, 94.255%] | [-0.781%, 19.010%] | 0/0 | 0.050216/0.048895 |
| haiku | pooled-default/mixed | [97.997%, 99.156%] | [82.406%, 86.043%] | [11.979%, 17.318%] | 11/0 | see row costs |
| haiku | pooled-equal-evidence/mixed | [97.997%, 99.156%] | [93.565%, 95.795%] | [0.521%, 7.878%] | 11/0 | see row costs |
| gpt-6-luna | rubric/peer | [93.974%, 97.816%] | [96.989%, 99.443%] | [-7.031%, 1.302%] | 7/0 | 0.015106/0.007450 |
| gpt-6-luna | factuality/peer | [99.010%, 100.000%] | [98.540%, 99.954%] | [0.000%, 0.781%] | 0/1 | 0.014930/0.010429 |
| gpt-6-luna | pii/peer | [99.010%, 100.000%] | [93.656%, 97.619%] | [0.000%, 11.719%] | 0/0 | 0.019674/0.007636 |
| gpt-6-luna | goal/peer | [99.010%, 100.000%] | [42.452%, 52.391%] | [50.000%, 57.812%] | 0/0 | 0.016614/0.015814 |
| gpt-6-luna | goal/peer-full-state | [99.010%, 100.000%] | [96.989%, 99.443%] | [0.000%, 3.646%] | 0/0 | 0.016614/0.011548 |
| gpt-6-luna | pooled-default/mixed | [98.476%, 99.456%] | [83.631%, 87.155%] | [11.458%, 16.276%] | 7/1 | see row costs |
| gpt-6-luna | pooled-equal-evidence/mixed | [98.476%, 99.456%] | [97.531%, 98.842%] | [-1.107%, 3.190%] | 7/1 | see row costs |

## Method and limits

- Exact one-sided p = sum(C(W+L,k), k=W..W+L) / 2^(W+L). Two-sided McNemar doubles the smaller binomial tail, capped at one. Zero discordance gives one.
- Case-level tests are nominal. Families are dependent. Bootstrap draws all paired cases within sampled families, 20,000 draws, seed 2619092984. Pool bootstrap is stratified by row.
- The pooled conditional sign test conditions on discordance in each row and sums wins. Under the null, its distribution is Binomial(total discordance, 0.5). Exact rational p-values are retained.
- Pooled-default includes the information-asymmetric goal comparison. Pooled-equal-evidence replaces that goal row with the final-state ablation. Neither pool counts goal twice.
- Global Holm correction across 18 benchmark/model cells belongs to the final collator. `holm18_missing_as_one` is a conservative interim correction for pooled-default only. Per-row leads are nominal.
- Constant-pass and constant-fail cheaters each score 192/384 by planted balance. Repeated-read noise floor and perturbation validity are not measured in this sealed primary run; no stability claim is made.
- Original frozen prompts and decoding are unchanged. The goal peer uses pinned trajectory summary; its ablation adds the persisted final state without editing the pinned prompt.
- gpt-6-luna uses provider-default reasoning and no temperature field for both sides. Tokens are recorded per call. Owner-verified pricing on 2026-10-13: USD 0.10 input, 0.01 cached input, 0.50 output per million tokens. Source: https://developers.openai.com/api/docs/models/gpt-6-luna. Accounting amendment is separate from the original seal.
- The pilot is a transport and cost check on the first 20 sealed cases per row, retained once in final results. No labels or outcomes select continuation or change the procedure. No content retries. Unanswered transport retries follow the operational amendments above. All failed attempts remain recorded.

## Freeze and spend

- Candidate procedure: `d7f5e226bf5afe7b955ee0f2247835cd19953001c196dcc7260d1f0c37922587`.
- Seal SHA-256: `5845e97e2651d2942134209e4abfa8f932409744930bd0d143ebbe03877b07a4`. The seal holds every frozen source, case and prompt hash.
- Analysis source commit: `f06456a442877987a595216f94a575bef290d654`.
- 6560 unique completed attempts; 0 final unsuccessful responses; measured spend USD 1.83894069 of the amended USD 12 cap.
- 3280 gpt-6-luna calls use recorded usage and the corrected provider prices. Earlier raw records remain unchanged; current totals reprice those records.
- Resolved models: ['claude-haiku-5-5', 'gpt-6-luna'].
- Artifacts: `comparisons/ledger-hard/{seal,seeds,prior-census,prompts,scores,decisions}.json`, row case JSON, `starts.jsonl`, `calls.jsonl`, and the source scripts.

## Dialect tables

# Separate core-dialect variant

Generated 2026-10-13T11:20:33.488019+00:00. Source: `comparisons/ledger-hard/dialect/scores.json`, `decisions.json`, `attempts.jsonl` and `calls.jsonl`.

Core `2bb0a7a787ca4466ff69d204f2380a7ad19cc056`; variant seal SHA-256 `ebbc5876d5a9d482203382d33c7fa3c0ee640b6e1254bf821784004493cd85d9`. This is the same sealed case cohort under a separately frozen transport and reasoning setting, not new data. No primary request key or answer is reused.

Luna and Gemini use medium for both contestants. Candidate output uses the native core schema dialect; peer prompt bytes remain unchanged. Haiku uses the core scratchpad instruction and last-JSON candidate decoder.

| Model | Row / evidence | Paired / sealed | Ours | Peer | W | L | Exact two-sided p | Exact one-sided p | Status |
|---|---|---:|---:|---:|---:|---:|---|---|---|
| haiku | rubric/peer | 384/384 | 379 | 369 | 12 | 2 | 53/4096 = 0.012939453 | 53/8192 = 0.0064697266 | nominal lead |
| haiku | factuality/peer | 384/384 | 384 | 353 | 31 | 0 | 1/1073741824 = 9.3132257e-10 | 1/2147483648 = 4.6566129e-10 | nominal lead |
| haiku | pii/peer | 384/384 | 384 | 383 | 1 | 0 | 1 = 1 | 1/2 = 0.5 | TIE (not equivalence) |
| haiku | goal/peer | 384/384 | 384 | 192 | 192 | 0 | 1/3138550867693340381917894711603833208051177722232017256448 = 3.1861838e-58 | 1/6277101735386680763835789423207666416102355444464034512896 = 1.5930919e-58 | nominal lead |
| haiku | goal/peer-full-state | 384/384 | 384 | 346 | 38 | 0 | 1/137438953472 = 7.2759576e-12 | 1/274877906944 = 3.6379788e-12 | nominal lead |
| haiku | pooled-default/mixed | 1536/1536 | 1531 | 1297 | 236 | 2 | 14221/110427941548649020598956093796432407239217743554726184882600387580788736 = 1.2878081e-67 | 14221/220855883097298041197912187592864814478435487109452369765200775161577472 = 6.4390406e-68 | nominal lead |
| haiku | pooled-equal-evidence/mixed | 1536/1536 | 1531 | 1451 | 82 | 2 | 3571/9671406556917033397649408 = 3.6923275e-22 | 3571/19342813113834066795298816 = 1.8461637e-22 | nominal lead |
| gpt-6-luna | rubric/peer | 384/384 | 377 | 382 | 2 | 7 | 23/128 = 0.1796875 | 251/256 = 0.98046875 | TIE (not equivalence) |
| gpt-6-luna | factuality/peer | 384/384 | 384 | 384 | 0 | 0 | 1 = 1 | 1 = 1 | TIE (not equivalence) |
| gpt-6-luna | pii/peer | 384/384 | 384 | 373 | 11 | 0 | 1/1024 = 0.0009765625 | 1/2048 = 0.00048828125 | nominal lead |
| gpt-6-luna | goal/peer | 384/384 | 384 | 179 | 205 | 0 | 1/25711008708143844408671393477458601640355247900524685364822016 = 3.8893845e-62 | 1/51422017416287688817342786954917203280710495801049370729644032 = 1.9446923e-62 | nominal lead |
| gpt-6-luna | goal/peer-full-state | 384/384 | 384 | 378 | 6 | 0 | 1/32 = 0.03125 | 1/64 = 0.015625 | nominal lead |
| gpt-6-luna | pooled-default/mixed | 1536/1536 | 1529 | 1318 | 218 | 7 | 2722239847673/13479973333575319897333507543509815336818572211270286240551805124608 = 2.0194698e-55 | 2722239847673/26959946667150639794667015087019630673637144422540572481103610249216 = 1.0097349e-55 | nominal lead |
| gpt-6-luna | pooled-equal-evidence/mixed | 1536/1536 | 1529 | 1517 | 19 | 7 | 15183/524288 = 0.028959274 | 15183/1048576 = 0.014479637 | nominal lead |
| gemini-3.8-flash | All rows | Not reported | Not reported | Not reported | Not reported | Not reported | Not reported | Not reported | dropped by the owner on 13 Oct 2026, partial data kept, not reported as a score |

| Model | Row | Wilson ours | Wilson peer | Family bootstrap difference | Inconclusive ours/peer | USD/100 ours/peer |
|---|---|---|---|---|---|---|
| haiku | rubric/peer | [96.989%, 99.443%] | [93.656%, 97.619%] | [-0.781%, 8.594%] | 5/0 | 0.053253/0.029333 |
| haiku | factuality/peer | [99.010%, 100.000%] | [88.769%, 94.255%] | [0.000%, 19.010%] | 0/0 | 0.053960/0.034993 |
| haiku | pii/peer | [99.010%, 100.000%] | [98.540%, 99.954%] | [0.000%, 0.781%] | 0/0 | 0.053808/0.031549 |
| haiku | goal/peer | [99.010%, 100.000%] | [45.024%, 54.976%] | [50.000%, 50.000%] | 0/0 | 0.059453/0.024449 |
| haiku | goal/peer-full-state | [99.010%, 100.000%] | [86.709%, 92.705%] | [0.000%, 25.000%] | 0/0 | 0.059453/0.047762 |
| haiku | pooled-default/mixed | [99.240%, 99.861%] | [82.542%, 86.167%] | [12.695%, 18.164%] | 5/0 | see rows |
| haiku | pooled-equal-evidence/mixed | [99.240%, 99.861%] | [93.208%, 95.503%] | [1.432%, 9.831%] | 5/0 | see rows |
| gpt-6-luna | rubric/peer | [96.286%, 99.114%] | [98.121%, 99.857%] | [-4.427%, 1.042%] | 2/0 | 0.015249/0.007390 |
| gpt-6-luna | factuality/peer | [99.010%, 100.000%] | [99.010%, 100.000%] | [0.000%, 0.000%] | 0/0 | 0.015123/0.010463 |
| gpt-6-luna | pii/peer | [99.010%, 100.000%] | [94.944%, 98.393%] | [0.000%, 8.594%] | 0/0 | 0.014167/0.008002 |
| gpt-6-luna | goal/peer | [99.010%, 100.000%] | [41.683%, 51.613%] | [50.000%, 60.156%] | 0/0 | 0.016474/0.015902 |
| gpt-6-luna | goal/peer-full-state | [99.010%, 100.000%] | [96.634%, 99.282%] | [0.000%, 4.167%] | 0/0 | 0.016474/0.011549 |
| gpt-6-luna | pooled-default/mixed | [99.062%, 99.779%] | [83.973%, 87.463%] | [11.914%, 16.146%] | 2/0 | see rows |
| gpt-6-luna | pooled-equal-evidence/mixed | [99.062%, 99.779%] | [98.076%, 99.207%] | [-0.586%, 2.539%] | 2/0 | see rows |
| gemini-3.8-flash | All rows | Not reported | Not reported | Not reported | Not reported | dropped by the owner on 13 Oct 2026, partial data kept, not reported as a score |

9578 completed unique requests; 0 final unsuccessful responses. Variant spend USD 7.15869961. Primary plus variant measured spend USD 8.99764030 of the amended USD 12 cap.

Resolved model versions: ['claude-haiku-5-5', 'gemini-3.8-flash', 'gpt-6-luna'].

Exact tests and bootstrap use the original sealed statistics functions. Rows are descriptive secondary comparisons. The global 18-cell Holm table remains the collator's responsibility; conservative missing-as-one pooled adjustments are in scores.json.

All three model rows have explicit per-call raw usage. Luna pricing: USD 0.10 input, 0.01 cached input, 0.50 output per million. Gemini: USD 0.75 input and 3.75 output including thinking per million. Sources verified 2026-10-13: https://developers.openai.com/api/docs/models/gpt-6-luna and https://ai.google.dev/gemini-api/docs/pricing. Haiku uses CLI-reported cost.

The original adaptive four/two pacing is superseded by the per-model runtime amendment above. Every attempt and backoff is logged. Worker results are fsynced before the future returns. A drain file stops new dispatch and waits for owned requests.

## Limits on claims

- `FINAL.md`, `delivery.json` and `verification-final.json` carry final status. Frozen scorer outputs retain historical status text in some metadata; those fields do not describe final coverage.
- The planted cases reuse the original family templates with fresh bindings. Results do not demonstrate general superiority on arbitrary tasks.
- Constant pass and constant fail each score 50% by label balance. Repeated-read noise and perturbation validity are unmeasured; no stability claim is made.
- Information-asymmetric goal wins cannot establish a better judge on equal evidence. Both versions are disclosed.
- No global matrix verdict or global Holm win is claimed here. The per-row tables and exact rational p-values support independent collation.


## Added Flash-Lite runtime amendment

The owner adds gemini-3.5-flash-lite as a separate model cell on the same sealed cohort, for both experiments and both contestants. `flash-lite/seal.json` is committed before the first call. The first sealed request accepts medium reasoning; its answer remains recorded once. `flash-lite/reasoning-applied.json` freezes medium for all subsequent requests. Temperature is omitted.

The owner raises the Flash-Lite allocation from USD 4 to USD 8, then to USD 9 after a usage-only projection exceeds USD 8. The overall cap rises from USD 16 to USD 20, then USD 21, retaining USD 12 for the original work. `flash-lite/budget-amendment.json` preserves both authorizations and runtime source hashes before missing-only resumption. `flash-lite/cost-forecast-late.json` records the projection without reading outcomes. The cohort, sealed order, prompts, reasoning and statistical tests remain unchanged.

Flash Lite permits eight simultaneous HTTP calls, a 180-second timeout, and HTTP 429 waits of 20, 60 and 180 seconds. HTTP 402 stops dispatch immediately without retries. Rejections carry no judge verdict. Other unanswered transport failures permit three attempts with 10/30-second waits. Every attempt and backoff is durable; answered calls are never re-sent. Gemini 3.8 is dropped; no calls will resume.

## Added Flash-Lite measurements

# Separate Gemini 3.5 Flash-Lite cell

Generated 2026-10-13T12:52:46.172668+00:00. Sources: `flash-lite/seal.json`, `requests.json`, `attempts.jsonl`, both `calls.jsonl` journals and `scores.json`.

Model `gemini-3.5-flash-lite`, reasoning `medium` for both contestants and both experiments. This is the same sealed cohort, 384 cases per row. Results never mix with Gemini 3.8.

6560/6560 unique requests recorded. Model-cell measured spend USD 8.18203290, cap USD 9. Combined measured spend plus the USD 0.40 lost-attempt reserve is USD 17.57967320, cap USD 21.

Standard paid pricing, verified 2026-10-13: USD 0.30 ordinary input, USD 0.03 cached input, USD 2.50 output including thinking per million tokens. [Google pricing](https://ai.google.dev/gemini-api/docs/pricing). Raw usage and applied reasoning remain recorded per call.

## primary

| Row / evidence | Paired / sealed | Ours | Peer | W | L | Exact two-sided p | Exact one-sided p | Status |
|---|---:|---:|---:|---:|---:|---|---|---|
| rubric/peer | 384/384 | 382 | 365 | 19 | 2 | 29/131072 = 0.00022125244 | 29/262144 = 0.00011062622 | nominal lead |
| factuality/peer | 384/384 | 378 | 374 | 10 | 6 | 14893/32768 = 0.45449829 | 14893/65536 = 0.22724915 | TIE (not equivalence) |
| pii/peer | 384/384 | 384 | 371 | 13 | 0 | 1/4096 = 0.00024414062 | 1/8192 = 0.00012207031 | nominal lead |
| goal/peer | 384/384 | 367 | 184 | 194 | 11 | 271404659661838721/12855504354071922204335696738729300820177623950262342682411008 = 2.1111942e-44 | 271404659661838721/25711008708143844408671393477458601640355247900524685364822016 = 1.0555971e-44 | nominal lead |
| goal/peer-full-state | 384/384 | 367 | 330 | 41 | 4 | 164221/17592186044416 = 9.3348831e-09 | 164221/35184372088832 = 4.6674415e-09 | nominal lead |
| pooled-default/mixed | 1536/1536 | 1511 | 1294 | 236 | 19 | 23250562328866278834216643/28269553036454149273332760011886696253239742350009903329945699220681916416 = 8.224595e-49 | 23250562328866278834216643/56539106072908298546665520023773392506479484700019806659891398441363832832 = 4.1122975e-49 | nominal lead |
| pooled-equal-evidence/mixed | 1536/1536 | 1511 | 1440 | 83 | 12 | 636082112379301/19807040628566084398385987584 = 3.211394e-14 | 636082112379301/39614081257132168796771975168 = 1.605697e-14 | nominal lead |

| Row / evidence | Wilson ours | Wilson peer | Family bootstrap difference | Inconclusive ours/peer | USD/100 ours/peer |
|---|---|---|---|---|---|
| rubric/peer | [98.121%, 99.857%] | [92.402%, 96.810%] | [-1.042%, 13.281%] | 2/0 | 0.159166/0.104150 |
| factuality/peer | [96.634%, 99.282%] | [95.273%, 98.579%] | [-0.260%, 2.604%] | 1/3 | 0.118208/0.116997 |
| pii/peer | [99.010%, 100.000%] | [94.295%, 98.011%] | [0.000%, 10.156%] | 0/0 | 0.128492/0.095332 |
| goal/peer | [93.025%, 97.218%] | [42.965%, 52.909%] | [43.750%, 50.260%] | 4/0 | 0.181029/0.084282 |
| goal/peer-full-state | [93.025%, 97.218%] | [82.104%, 89.060%] | [1.562%, 18.490%] | 4/0 | 0.181029/0.116490 |
| pooled-default/mixed | [97.608%, 98.895%] | [82.338%, 85.981%] | [11.719%, 17.122%] | 7/3 | see rows |
| pooled-equal-evidence/mixed | [97.608%, 98.895%] | [92.427%, 94.855%] | [1.628%, 8.203%] | 7/3 | see rows |

## dialect

| Row / evidence | Paired / sealed | Ours | Peer | W | L | Exact two-sided p | Exact one-sided p | Status |
|---|---:|---:|---:|---:|---:|---|---|---|
| rubric/peer | 384/384 | 384 | 364 | 20 | 0 | 1/524288 = 1.9073486e-06 | 1/1048576 = 9.5367432e-07 | nominal lead |
| factuality/peer | 384/384 | 377 | 379 | 4 | 6 | 193/256 = 0.75390625 | 53/64 = 0.828125 | TIE (not equivalence) |
| pii/peer | 384/384 | 381 | 370 | 14 | 3 | 417/32768 = 0.01272583 | 417/65536 = 0.006362915 | nominal lead |
| goal/peer | 384/384 | 368 | 184 | 189 | 5 | 558115181/3138550867693340381917894711603833208051177722232017256448 = 1.7782576e-49 | 558115181/6277101735386680763835789423207666416102355444464034512896 = 8.8912878e-50 | nominal lead |
| goal/peer-full-state | 384/384 | 368 | 335 | 36 | 3 | 155/4294967296 = 3.608875e-08 | 155/8589934592 = 1.8044375e-08 | nominal lead |
| pooled-default/mixed | 1536/1536 | 1510 | 1297 | 227 | 14 | 9269263560109553790367/883423532389192164791648750371459257913741948437809479060803100646309888 = 1.0492435e-50 | 9269263560109553790367/1766847064778384329583297500742918515827483896875618958121606201292619776 = 5.2462173e-51 | nominal lead |
| pooled-equal-evidence/mixed | 1536/1536 | 1510 | 1448 | 74 | 12 | 90713160743749/19342813113834066795298816 = 4.6897605e-12 | 90713160743749/38685626227668133590597632 = 2.3448802e-12 | nominal lead |

| Row / evidence | Wilson ours | Wilson peer | Family bootstrap difference | Inconclusive ours/peer | USD/100 ours/peer |
|---|---|---|---|---|---|
| rubric/peer | [99.010%, 100.000%] | [92.093%, 96.603%] | [0.000%, 13.021%] | 0/0 | 0.130227/0.101380 |
| factuality/peer | [96.286%, 99.114%] | [96.989%, 99.443%] | [-2.865%, 1.562%] | 0/1 | 0.102442/0.114548 |
| pii/peer | [97.729%, 99.734%] | [93.974%, 97.816%] | [-2.344%, 10.938%] | 0/0 | 0.113746/0.096298 |
| goal/peer | [93.339%, 97.419%] | [42.965%, 52.909%] | [44.531%, 50.521%] | 2/0 | 0.164331/0.085868 |
| goal/peer-full-state | [93.339%, 97.419%] | [83.530%, 90.212%] | [1.302%, 16.927%] | 2/0 | 0.164331/0.117751 |
| pooled-default/mixed | [97.531%, 98.842%] | [82.542%, 86.167%] | [11.458%, 16.862%] | 2/1 | see rows |
| pooled-equal-evidence/mixed | [97.531%, 98.842%] | [92.994%, 95.326%] | [1.042%, 7.552%] | 2/1 | see rows |

## Interpretation and freeze

The nominal win rule is unchanged: higher accuracy and exact two-sided McNemar p below 0.05. Multiplicity-adjusted matrix wins remain the collator's decision. This added model expands the original matrix and cannot silently inherit an 18-cell correction. Family bootstrap intervals retain synthetic-family uncertainty.

Default goal inputs remain information-asymmetric. The pooled equal-evidence comparison replaces that goal row with final state supplied to both. No pool counts goal twice. This is a new model measurement on the same cohort, not an independent replication. No content is retried. Transport failures and provider limits remain separate from judge outcomes.

Seal SHA-256: `52ff207f43756150597aa803a95ebcb67c85984f75117bb0ad82e6cf52862e44`. Original case seal: `5845e97e2651d2942134209e4abfa8f932409744930bd0d143ebbe03877b07a4`. Reasoning application: `d37718bb39d54c5a81cd64e4b8b6cac9c47d812ab45adb43301dfa7613b9d881`. Statistics source: `4cb7aca0df33899a1479105efae3535a8d635f1eab9c3e1d3ee455ca6243fecd`. Per-file hashes are retained inside the committed seal.


## Added sonnet-5-5 measurements

# Additional model: claude-sonnet-5-5

Generated 2026-10-14T03:20:29.086117+00:00. Sources: `sonnet-5-5/seal.json`, `requests.json`, `attempts.jsonl`, both `calls.jsonl` files and `scores.json`.

6560/6560 unique requests recorded; 384 sealed cases per row in each experiment. Both contestants use medium reasoning. Each experiment remains separate.

Measured USD 33.72676500; unknown-attempt reserve USD 1.00000000; model-cell cap USD 45. First five sealed requests form the cost pilot and are retained once. `pilot.json` and `cost-forecast.json` record cost-only projections.

The total generated-token limit is 4096, including hidden reasoning. No answer is retried, including malformed or token-limited output. Token-limit and other lost items are listed in `lost-items.json`; they remain in the denominator and earn no credit.

Sonnet uses the Claude print-mode route, alias `sonnet`, an empty folder, explicit grading system text, disabled settings/tools/MCP/session persistence, and safe mode. `CLAUDE_CODE_MAX_OUTPUT_TOKENS=4096` bounds adaptive thinking plus visible output; a fixed thinking budget is not supported by Sonnet 5.5. CLI-reported `total_cost_usd` is authoritative. [Claude environment documentation](https://code.claude.com/docs/en/env-vars).

## primary

| Row / evidence | Paired / sealed | Ours | Promptfoo | W | L | Exact two-sided p | USD ours / peer | Lost ours / peer | Verdict |
|---|---:|---:|---:|---:|---:|---|---|---|---|
| rubric/peer | 384/384 | 337 | 371 | 3 | 37 | 10701/549755813888 = 1.9465006e-08 | 1.92050800 / 1.43627600 | 47/0 | LOSS |
| factuality/peer | 384/384 | 375 | 364 | 15 | 4 | 1259/65536 = 0.019210815 | 2.10311590 / 1.70480400 | 9/0 | nominal lead |
| pii/peer | 384/384 | 384 | 374 | 10 | 0 | 1/512 = 0.001953125 | 1.70792000 / 1.46071800 | 0/0 | nominal lead |
| goal/peer | 384/384 | 381 | 192 | 192 | 3 | 154497/3138550867693340381917894711603833208051177722232017256448 = 4.9225584e-53 | 2.14697200 / 1.25651400 | 3/0 | nominal lead |
| goal/peer-full-state | 384/384 | 381 | 356 | 25 | 0 | 1/16777216 = 5.9604645e-08 | 2.14697200 / 1.93785000 | 3/0 | nominal lead |
| pooled-default/mixed | 1536/1536 | 1477 | 1301 | 220 | 44 | 11668324187155147651728699777845132422026206013307/463168356949264781694283940034751631413079938662562256157830336031652518559744 = 2.5192404e-29 | 7.87851590 / 5.85831200 | 59/0 | nominal lead |
| pooled-equal-evidence/mixed | 1536/1536 | 1477 | 1465 | 53 | 41 | 1269841006050060543474866827/4951760157141521099596496896 = 0.25644235 | 7.87851590 / 6.53964800 | 59/0 | TIE (not equivalence) |

| Row / evidence | Wilson ours | Wilson peer | Family bootstrap difference |
|---|---|---|---|
| rubric/peer | [84.103%, 90.670%] | [94.295%, 98.011%] | [-18.750%, 0.000%] |
| factuality/peer | [95.606%, 98.762%] | [92.093%, 96.603%] | [-1.302%, 9.635%] |
| pii/peer | [99.010%, 100.000%] | [95.273%, 98.579%] | [0.000%, 7.812%] |
| goal/peer | [97.729%, 99.734%] | [45.024%, 54.976%] | [47.917%, 50.000%] |
| goal/peer-full-state | [97.729%, 99.734%] | [89.663%, 94.907%] | [0.000%, 15.104%] |
| pooled-default/mixed | [95.077%, 97.011%] | [82.814%, 86.414%] | [8.398%, 14.453%] |
| pooled-equal-evidence/mixed | [95.077%, 97.011%] | [94.210%, 96.319%] | [-2.734%, 4.427%] |

## dialect

| Row / evidence | Paired / sealed | Ours | Promptfoo | W | L | Exact two-sided p | USD ours / peer | Lost ours / peer | Verdict |
|---|---:|---:|---:|---:|---:|---|---|---|---|
| rubric/peer | 384/384 | 384 | 373 | 11 | 0 | 1/1024 = 0.0009765625 | 2.55895000 / 1.41448910 | 0/0 | nominal lead |
| factuality/peer | 384/384 | 383 | 362 | 22 | 1 | 3/524288 = 5.7220459e-06 | 2.67037600 / 1.71114600 | 1/0 | nominal lead |
| pii/peer | 384/384 | 384 | 372 | 12 | 0 | 1/2048 = 0.00048828125 | 2.32225800 / 1.44836800 | 0/0 | nominal lead |
| goal/peer | 384/384 | 384 | 192 | 192 | 0 | 1/3138550867693340381917894711603833208051177722232017256448 = 3.1861838e-58 | 2.74010000 / 1.25075600 | 0/0 | nominal lead |
| goal/peer-full-state | 384/384 | 384 | 357 | 27 | 0 | 1/67108864 = 1.4901161e-08 | 2.74010000 / 1.93564400 | 0/0 | nominal lead |
| pooled-default/mixed | 1536/1536 | 1535 | 1299 | 237 | 1 | 239/220855883097298041197912187592864814478435487109452369765200775161577472 = 1.0821536e-69 | 10.29168400 / 5.82475910 | 1/0 | nominal lead |
| pooled-equal-evidence/mixed | 1536/1536 | 1535 | 1464 | 72 | 1 | 37/2361183241434822606848 = 1.567011e-20 | 10.29168400 / 6.50964710 | 1/0 | nominal lead |

| Row / evidence | Wilson ours | Wilson peer | Family bootstrap difference |
|---|---|---|---|
| rubric/peer | [99.010%, 100.000%] | [94.944%, 98.393%] | [0.000%, 8.594%] |
| factuality/peer | [98.540%, 99.954%] | [91.478%, 96.186%] | [0.000%, 14.583%] |
| pii/peer | [99.010%, 100.000%] | [94.618%, 98.203%] | [0.000%, 9.375%] |
| goal/peer | [99.010%, 100.000%] | [45.024%, 54.976%] | [50.000%, 50.000%] |
| goal/peer-full-state | [99.010%, 100.000%] | [89.963%, 95.123%] | [0.000%, 16.406%] |
| pooled-default/mixed | [99.632%, 99.989%] | [82.678%, 86.290%] | [12.891%, 18.490%] |
| pooled-equal-evidence/mixed | [99.632%, 99.989%] | [94.138%, 96.261%] | [1.497%, 8.398%] |

## Losses and interpretation

60 case-side entries have no usable verdict, covering 60 unique requests. 0 entries reach the output/thinking cap. Full keys and causes remain in `lost-items.json`. No 65536-token request is configured.

Nominal tests use the unchanged exact two-sided McNemar calculation and 20000 family-bootstrap draws. Global multiplicity correction belongs to the collator. The same synthetic cohort is not independent replication. Default goal is information-asymmetric; pooled equal-evidence replaces it with final state supplied to both. Costs shown for overlapping rows and pools must not be summed as additional spend.

Seal SHA-256: `ba83523dd663834077afdeae20cae22d361e53d8c6025cda75fb9379ac7d5e18`. Original case seal: `5845e97e2651d2942134209e4abfa8f932409744930bd0d143ebbe03877b07a4`. Per-file hashes remain in the seal. Gemini 3.8 is dropped and its journals remain unchanged.


## Added gpt-6.1-sol measurements

# Additional model: gpt-6.1-sol

Generated 2026-10-13T22:02:13.883748+00:00. Sources: `gpt-6.1-sol/seal.json`, `requests.json`, `attempts.jsonl`, both `calls.jsonl` files and `scores.json`.

6560/6560 unique requests recorded; 384 sealed cases per row in each experiment. Both contestants use medium reasoning. Each experiment remains separate.

Measured USD 12.44696800; unknown-attempt reserve USD 3.50000000; model-cell cap USD 25. First five sealed requests form the cost pilot and are retained once. `pilot.json` and `cost-forecast.json` record cost-only projections.

The total generated-token limit is 4096, including hidden reasoning. No answer is retried, including malformed or token-limited output. Token-limit and other lost items are listed in `lost-items.json`; they remain in the denominator and earn no credit.

Standard short-context prices per million tokens, verified 2026-10-13: input USD 2, cached input USD 0.10, cache write USD 2.50, output including reasoning USD 10. [OpenAI pricing](https://developers.openai.com/api/docs/pricing). The route is the Responses API; temperature is omitted. Raw token counts and reported reasoning are retained per call.

## primary

| Row / evidence | Paired / sealed | Ours | Promptfoo | W | L | Exact two-sided p | USD ours / peer | Lost ours / peer | Verdict |
|---|---:|---:|---:|---:|---:|---|---|---|---|
| rubric/peer | 384/384 | 384 | 369 | 15 | 0 | 1/16384 = 6.1035156e-05 | 0.76909200 / 0.43080000 | 0/0 | nominal lead |
| factuality/peer | 384/384 | 384 | 384 | 0 | 0 | 1 = 1 | 0.86114800 / 0.63126600 | 0/0 | TIE (not equivalence) |
| pii/peer | 384/384 | 384 | 384 | 0 | 0 | 1 = 1 | 0.69587000 / 0.44034600 | 0/0 | TIE (not equivalence) |
| goal/peer | 384/384 | 384 | 192 | 192 | 0 | 1/3138550867693340381917894711603833208051177722232017256448 = 3.1861838e-58 | 1.00535000 / 0.48029200 | 0/0 | nominal lead |
| goal/peer-full-state | 384/384 | 384 | 384 | 0 | 0 | 1 = 1 | 1.00535000 / 0.66926200 | 0/0 | TIE (not equivalence) |
| pooled-default/mixed | 1536/1536 | 1536 | 1329 | 207 | 0 | 1/102844034832575377634685573909834406561420991602098741459288064 = 9.7234614e-63 | 3.33146000 / 1.98270400 | 0/0 | nominal lead |
| pooled-equal-evidence/mixed | 1536/1536 | 1536 | 1521 | 15 | 0 | 1/16384 = 6.1035156e-05 | 3.33146000 / 2.17167400 | 0/0 | nominal lead |

| Row / evidence | Wilson ours | Wilson peer | Family bootstrap difference |
|---|---|---|---|
| rubric/peer | [99.010%, 100.000%] | [93.656%, 97.619%] | [0.000%, 11.719%] |
| factuality/peer | [99.010%, 100.000%] | [99.010%, 100.000%] | [0.000%, 0.000%] |
| pii/peer | [99.010%, 100.000%] | [99.010%, 100.000%] | [0.000%, 0.000%] |
| goal/peer | [99.010%, 100.000%] | [45.024%, 54.976%] | [50.000%, 50.000%] |
| goal/peer-full-state | [99.010%, 100.000%] | [99.010%, 100.000%] | [0.000%, 0.000%] |
| pooled-default/mixed | [99.751%, 100.000%] | [84.724%, 88.140%] | [12.500%, 15.430%] |
| pooled-equal-evidence/mixed | [99.751%, 100.000%] | [98.395%, 99.407%] | [0.000%, 2.930%] |

## dialect

| Row / evidence | Paired / sealed | Ours | Promptfoo | W | L | Exact two-sided p | USD ours / peer | Lost ours / peer | Verdict |
|---|---:|---:|---:|---:|---:|---|---|---|---|
| rubric/peer | 384/384 | 384 | 368 | 16 | 0 | 1/32768 = 3.0517578e-05 | 0.86657800 / 0.42835000 | 0/0 | nominal lead |
| factuality/peer | 384/384 | 381 | 384 | 0 | 3 | 1/4 = 0.25 | 1.05419600 / 0.63279600 | 3/0 | TIE (not equivalence) |
| pii/peer | 384/384 | 384 | 384 | 0 | 0 | 1 = 1 | 0.78589600 / 0.44119600 | 0/0 | TIE (not equivalence) |
| goal/peer | 384/384 | 384 | 192 | 192 | 0 | 1/3138550867693340381917894711603833208051177722232017256448 = 3.1861838e-58 | 1.10677600 / 0.47853200 | 0/0 | nominal lead |
| goal/peer-full-state | 384/384 | 384 | 384 | 0 | 0 | 1 = 1 | 1.10677600 / 0.66922200 | 0/0 | TIE (not equivalence) |
| pooled-default/mixed | 1536/1536 | 1533 | 1328 | 208 | 3 | 195729/205688069665150755269371147819668813122841983204197482918576128 = 9.5158169e-58 | 3.81344600 / 1.98087400 | 3/0 | nominal lead |
| pooled-equal-evidence/mixed | 1536/1536 | 1533 | 1520 | 16 | 3 | 145/32768 = 0.0044250488 | 3.81344600 / 2.17156400 | 3/0 | nominal lead |

| Row / evidence | Wilson ours | Wilson peer | Family bootstrap difference |
|---|---|---|---|
| rubric/peer | [99.010%, 100.000%] | [93.339%, 97.419%] | [0.000%, 12.500%] |
| factuality/peer | [97.729%, 99.734%] | [99.010%, 100.000%] | [-1.562%, 0.000%] |
| pii/peer | [99.010%, 100.000%] | [99.010%, 100.000%] | [0.000%, 0.000%] |
| goal/peer | [99.010%, 100.000%] | [45.024%, 54.976%] | [50.000%, 50.000%] |
| goal/peer-full-state | [99.010%, 100.000%] | [99.010%, 100.000%] | [0.000%, 0.000%] |
| pooled-default/mixed | [99.427%, 99.934%] | [84.656%, 88.079%] | [12.174%, 15.495%] |
| pooled-equal-evidence/mixed | [99.427%, 99.934%] | [98.315%, 99.358%] | [-0.326%, 2.995%] |

## Losses and interpretation

3 case-side entries have no usable verdict, covering 3 unique requests. 3 entries reach the output/thinking cap. Full keys and causes remain in `lost-items.json`. No 65536-token request is configured.

Nominal tests use the unchanged exact two-sided McNemar calculation and 20000 family-bootstrap draws. Global multiplicity correction belongs to the collator. The same synthetic cohort is not independent replication. Default goal is information-asymmetric; pooled equal-evidence replaces it with final state supplied to both. Costs shown for overlapping rows and pools must not be summed as additional spend.

Seal SHA-256: `ffb0d67a7d4582f3b358e5b8cb28e462f86aebd73edb1463d9d7adbdaeb349f4`. Original case seal: `5845e97e2651d2942134209e4abfa8f932409744930bd0d143ebbe03877b07a4`. Per-file hashes remain in the seal. Gemini 3.8 is dropped and its journals remain unchanged.


## Authorized host-crash recovery

The owner confirms that two Sol requests received no answer before the host stopped. One replacement answer per key is authorized; the original USD 0.10 holds remain. Original starts and the explicit reconciliation records remain in the attempt journal. Neither key is counted twice.

| Request key | Original attempt | Recorded replacement answers | Recovery rule |
|---|---:|---:|---|
| `8760821a4b15dded2eba8a586b8c71c8a77baeeff4a448b04cb7866e595cd77f` | 1 | 1 | One replacement answer; keep original hold |
| `e70c18909dadc7037d60cfa6884318e86774581c23eba0119353c92e787b2b2e` | 1 | 1 | One replacement answer; keep original hold |