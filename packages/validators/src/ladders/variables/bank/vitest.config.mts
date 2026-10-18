// Isolated harness: do not load workspace plugins or production implementation aliases.
export default { test: { include: ['bank.test.ts'], maxWorkers: 2, testTimeout: 120_000 } };
