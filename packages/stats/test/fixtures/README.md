# Independent statistics references

`planned-capabilities.json` and `numerical-defects.json` are copied byte for byte from the statistics validator bank at commit `f5817536281581e462f00aac2c106686e853e739`:

- `packages/validators/fixtures/stats/exact-capabilities.json`
- `packages/validators/fixtures/stats/exact-defects.json`

Their embedded provenance names the independent generators and references: exact rational arithmetic, 80-digit decimal arithmetic, NumPy and SciPy. The source generators live with the validator fixtures on that branch. These product regression tests consume the frozen values; they do not derive expected answers from the product implementation.

The fixture copies let the product fix land before the validator branch. No validator item, tolerance, cause or floor changes here.
