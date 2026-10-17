# Judges v3 provisional delivery bar

**Provisional, scoped to the opt-in labeller version only.** Version 2 and the
frozen global hardness contract retain their existing bars.

The owner authorizes a normal PR when real capabilities have been added and the
measured pilot still misses the original hardness gate. This exception permits
review; it is not an assertion that the original gate passes.

## Lower bar and measured reason

| Measure | Original gate | Provisional bar |
|---|---|---|
| Post-pilot bank score | At most 0.4 | At most 1.0 |
| Forecast to full bank | At least 100 iterations | Unavailable when no genuine fixes exist |
| Distinct failing causes | At least 100 | 0; no failures manufactured |
| Cause-review agreement | At least 0.8 on 30 failures | Unmeasured when the failure population is empty |

The measured baseline and end score are 300/300 (1.0). Both pilots make zero
fixes. Their rate is zero items per iteration; the forecast is undefined, not
infinite. There are zero failing causes. Ten honest shared cause groups describe
the bank; its 300 item identifiers are not 300 independent causes.

These limits arise because the default candidate is a complete scripted
recording. The bank measures scoring, transforms, identity and replay mechanics;
it does not establish a live model's semantic accuracy or a 100-iteration
learning curve. Repeated unchanged runs are labelled repeatability probes, not
executor fixes. See [audit.md](audit.md), [pilot.json](pilot.json) and the journal.

## Retained delivery checks

- 300 deterministic paired items, 30 per family and 60 per tier.
- Raw agreement and Cohen kappa bars remain those in [README.md](README.md).
- Empty, constant-label, always-abstain and first-label cheats pass zero items.
- The independent cheat audit's position-cycle shortcut is reproduced first,
  then removed by seeded shuffling that preserves class counts.
- All 20 activated scoring/cache/replay mutations lose actual bank items.

`--hardness` deliberately remains a failing original-contract measurement.
The existing parser cannot represent an endpoint score of 1 or a zero cause
bar, and this change does not relax shared code to turn that failure green.
The independent blind-pilot verdict remains fail and cause review remains
pending. A fresh semantic candidate with genuine failures is needed before
those measurements can be completed under the original contract.

No billed model run is authorized or performed. Version 3's measured level is
5; its global floor is not ratified because version 2 remains the registered
default and its floor of 20 stays active.
