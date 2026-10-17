# Research: judges v3 labellers

## Contract and capability sources

Question: which judge-quality checks also apply to a fixed-set text labeller?

Sources read: `docs/validators.md` in full, the existing judges ladder's
`HANDOVER.md`, `GATE.md`, `NEEDS.md` and `research.md`, and
`origin/feat/estate-pointer-reader-design:docs/estate-pointer-reader.md` (PR 692).
The pointer-reader design motivates a common port for system-1, system-2 and
stacked classification. This change implements a generic port, not that reader.

The new bank adds explicit abstention accounting, an implicit `none` class,
exact near-miss label identity, changed label sets, ordering and length
transforms, untrusted label instructions, repeatability and cache identity.
Integer interval specifications generate fictional text and gold labels without
word lists. Six structural variants per family run across five complexity tiers.
Tier replication increases class count and batch size; it does not create a new
independent failure cause.

## Independent extensions before the final pilot

The independent scorer breaker exposes an empty label set accepted by hashing;
the implementation now rejects it. The independent cheater exposes a call-index
cycle that passes four interleaved replay items. A red regression records those
passes. The generator now shuffles its balanced or deliberately skewed category
schedule before rendering text. Pair identities and replay repetition remain
intact. Final audit results are in `audit.md`.

The mutation audit tests the actual bank with independently compiled source
copies. It includes raw-agreement substitution for kappa, wrong chance
marginals, abstention/invalid denominators, negative and degenerate kappa,
and omitted identity fields. No production defect is planted for the pilot.
