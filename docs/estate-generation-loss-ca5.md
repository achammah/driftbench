# Generation pass-to-fail comparison

Before product:29af30fd7 (baseline captured on journal-only0af860096). After:ca5a0656e.

| Seed | Item | Classification |
|---|---|---|
| 1 | unit.runner.allow-all-reply-length.py | Earlier false pass exposed |
| 1 | unit.runner.block-all-reply-length.py | Earlier false pass exposed |
| 1 | unit.runner.message-reply-length.py | Earlier false pass exposed |
| 2 | unit.runner.allow-all-reply-length.py | Earlier false pass exposed |
| 2 | unit.runner.block-all-reply-length.py | Earlier false pass exposed |
| 2 | unit.runner.message-reply-length.py | Earlier false pass exposed |
| 3 | unit.runner.allow-all-reply-length.py | Earlier false pass exposed |
| 3 | unit.runner.block-all-reply-length.py | Earlier false pass exposed |
| 3 | unit.runner.message-reply-length.py | Earlier false pass exposed |
| 700347197 | unit.runner.allow-all-reply-length.py | Earlier false pass exposed |
| 700347197 | unit.runner.block-all-reply-length.py | Earlier false pass exposed |
| 700347197 | unit.runner.message-reply-length.py | Earlier false pass exposed |

Each original Stop fixture already fails3/4 specs; the mutant bank credits any failing spec as a kill without first requiring the original to be green. The old count-any-run negative assertion supplied false credit. The corrected deny-only negative assertion removes it. No other pass-to-fail item exists across the complete270-item paired runs. Stop fixture PR534 and runner positive-verdict issues are assigned; no push occurred.


PR534 fixture correction d98ee3a99 is integrated at f38f4b7e6. Its17 targeted fixture/runtime tests pass; direct unit.runner remains26/41 on seeds1,2,3,395897494,4-8,1009. This does not restore the three earlier false passes. The runner owner holds the positive-verdict diagnosis; the maintainer holds the missing green-original prerequisite in the mutation bank. No validator threshold, item or oracle is weakened.

The unit.runner family is seed-free; per-seed entries reuse its identical family result within each process.
