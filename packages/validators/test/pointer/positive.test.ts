import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { pointerBank } from '../../src/ladders/pointer/bank';
import { clearSeedFreeCache, runItem } from '../../src/ladders/pointer/bank/run';
import { constant } from '../../src/ladders/pointer/kit/labellers';
import type { PointerSut, ScanResult } from '../../src/ladders/pointer/sut/port';
import empty from './empty';
import emptyLedger from './empty-ledger';
import failedEmpty from './failed-empty';
import { referenceSut } from './reference';

const reference = referenceSut();
const scanMutant = (change: (result: ScanResult) => ScanResult): PointerSut => ({
  ...reference,
  name: 'positive-check-mutant',
  scan: async (request) => change(await reference.scan(request)),
});
const noAtoms = scanMutant((result) => ({ ...result, atoms: [] }));
const noCassette = scanMutant((result) => ({ ...result, cassette: '' }));
const fabricatedQuotes = scanMutant((result) => ({
  ...result,
  ledger: result.ledger && {
    ...result.ledger,
    entries: result.ledger.entries.map((entry) => ({ ...entry, quote: 'invented source text' })),
  },
}));
const noTransport: PointerSut = {
  ...reference,
  name: 'no-transport',
  scan: (request) =>
    reference.scan({
      ...request,
      labelsYaml: request.labelsYaml?.replace(/^.*Example (four|five) is here\..*\n/gm, ''),
      model: undefined,
      labeler: constant('voice'),
    }),
};

// Each mutation preserves the old empty equality/absence/order predicate.
// The reference must pass first, then the newly added positive check must reject the mutation.
const cases: Array<[string, PointerSut]> = [
  ['cutting.empty-and-blank-files', { ...reference, cut: empty.cut }],
  ['cutting.digest-same-text', { ...reference, cut: empty.cut }],
  ['cutting.digest-cosmetic', { ...reference, cut: empty.cut }],
  ['cutting.cut-pure', { ...reference, cut: empty.cut }],
  ['ids.id-deterministic', emptyLedger],
  ['ids.id-format', fabricatedQuotes],
  ['grouping.atom-evidence-prose-pointer', noAtoms],
  ['grouping.atom-no-labeler-text', noAtoms],
  ['grouping.atom-order-deterministic', noAtoms],
  ['labels.none-labeller', emptyLedger],
  ['labels.carry-forward-unchanged-no-calls', emptyLedger],
  ['labels.prompt-examples-max-three', noTransport],
  ['replay.cassette-readable-fields', noCassette],
  ['replay.cassette-stored-answer', noCassette],
  ['replay.cassette-no-file-text', noCassette],
  ['replay.miss-fails-without-network', failedEmpty],
  ['privacy.fingerprints-are-hashes', emptyLedger],
  ['privacy.estate-files-unchanged', emptyLedger],
  ['adversarial.label-named-like-prototype', emptyLedger],
];

describe('positive witnesses reject vacuous mutations', () => {
  for (const [id, mutant] of cases) {
    it(id, async () => {
      const item = pointerBank().find((candidate) => candidate.id === id);
      if (!item) throw new Error(`missing item ${id}`);
      clearSeedFreeCache();
      expect(await runItem(item, 1, reference)).toMatchObject({ pass: true });
      clearSeedFreeCache();
      const outcome = await runItem(item, 1, mutant);
      expect(outcome, id).toMatchObject({ pass: false });
      expect(outcome.detail).toContain('positive witness');
    }, 60_000);
  }

  for (const [id, mutant, module] of [
    ['privacy.secret-not-in-cassette', emptyLedger, './empty-ledger.ts'],
    ['privacy.error-messages-quote-no-unit-text', failedEmpty, './failed-empty.ts'],
    ['privacy.crash-leaves-no-secret', failedEmpty, './failed-empty.ts'],
  ] as const) {
    it(`requires successful source evidence in a child: ${id}`, async () => {
      const item = pointerBank().find((candidate) => candidate.id === id);
      if (!item) throw new Error('missing privacy item');
      const before = process.env.DRIFTBENCH_POINTER_SUT;
      try {
        process.env.DRIFTBENCH_POINTER_SUT = fileURLToPath(new URL('./reference/index.ts', import.meta.url));
        expect(await runItem(item, 1, reference)).toMatchObject({ pass: true });
        process.env.DRIFTBENCH_POINTER_SUT = fileURLToPath(new URL(module, import.meta.url));
        const outcome = await runItem(item, 1, mutant);
        expect(outcome).toMatchObject({ pass: false });
        expect(outcome.detail).toContain('positive witness');
      } finally {
        if (before === undefined) delete process.env.DRIFTBENCH_POINTER_SUT;
        else process.env.DRIFTBENCH_POINTER_SUT = before;
        clearSeedFreeCache();
      }
    }, 60_000);
  }
});
