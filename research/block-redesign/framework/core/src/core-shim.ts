// The core symbols packages/checks imports, re-exported from their own files. Core's index also pulls in
// the campaign runner and the stats package, which this sparse worktree does not hold; the symbols are the
// same functions, unchanged.
export { matchAssertion } from '../../../../../packages/core/src/runner/assertion.ts';
export { machineVerdict } from '../../../../../packages/core/src/contracts/check.ts';
export { isZero } from '../../../../../packages/core/src/spec/semantics.ts';
