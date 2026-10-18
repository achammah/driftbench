import type { VariablesImpl } from '../../src/ladders/variables/interface';

/** The independent review's cheat, also imported unchanged by the child process. */
export const variablesImpl: VariablesImpl = {
  buildStore: () => ({ variables: [], impossible: [], rules: [], refused: [] }),
  plan: () => ({ rows: [] }),
  coverage: () => ({ allowed: 0, covered: 0, uncovered: [] }),
  weightInterval: () => [0, 1],
};
