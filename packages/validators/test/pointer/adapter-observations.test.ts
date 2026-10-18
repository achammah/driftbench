import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { pointerBank } from '../../src/ladders/pointer/bank';
import { clearSeedFreeCache, runItem } from '../../src/ladders/pointer/bank/run';
import type { PointerSut, ScanResult } from '../../src/ladders/pointer/sut/port';
import missingWarnings from './missing-warnings';
import { referenceSut } from './reference';

const reference = referenceSut();
const changed = (change: (result: ScanResult) => void): PointerSut => ({
  ...reference,
  name: 'missing-observation',
  async scan(request) {
    const result = await reference.scan(request);
    change(result);
    return result;
  },
});
const noEvents = changed((result) => {
  delete result.events;
});
const noNullTwins = changed((result) => {
  for (const entry of result.ledger?.entries ?? []) if (entry.twinOf === null) delete entry.twinOf;
});
const noLineage = changed((result) => {
  if (!result.ledger) return;
  const raw = JSON.parse(result.ledger.raw);
  for (const entry of raw.entries) delete entry.lineage;
  result.ledger.raw = JSON.stringify(raw);
});
const emptyRaw = changed((result) => {
  if (!result.ledger) return;
  result.ledger.raw = JSON.stringify({ ...JSON.parse(result.ledger.raw), entries: [] });
});

for (const [id, mutant] of [
  ['labels.label-flip-not-deleted', noEvents],
  ['labels.anchoring-independent-of-labeler', noEvents],
  ['ids.id-twin-boilerplate', noNullTwins],
  ['adversarial.identical-files-100', noNullTwins],
  ['ids.ledger-status-live', emptyRaw],
  ['ids.ledger-status-live', noLineage],
] as const) {
  it(`${id} requires its product observations (${mutant === emptyRaw ? 'empty raw ledger' : mutant === noLineage ? 'missing lineage' : 'missing field'})`, async () => {
    const item = pointerBank().find((entry) => entry.id === id);
    if (!item) throw new Error(`missing item ${id}`);
    clearSeedFreeCache();
    expect(await runItem(item, 1, reference)).toMatchObject({ pass: true });
    clearSeedFreeCache();
    expect(await runItem(item, 1, mutant)).toMatchObject({ pass: false });
  }, 60_000);
}

it('privacy.error-messages-quote-no-unit-text requires warning observations in the child', async () => {
  const item = pointerBank().find((entry) => entry.id === 'privacy.error-messages-quote-no-unit-text');
  if (!item) throw new Error('missing privacy item');
  const old = process.env.DRIFTBENCH_POINTER_SUT;
  try {
    process.env.DRIFTBENCH_POINTER_SUT = fileURLToPath(new URL('./reference/index.ts', import.meta.url));
    clearSeedFreeCache();
    expect(await runItem(item, 1, reference)).toMatchObject({ pass: true });
    process.env.DRIFTBENCH_POINTER_SUT = fileURLToPath(new URL('./missing-warnings.ts', import.meta.url));
    clearSeedFreeCache();
    expect(await runItem(item, 1, missingWarnings)).toMatchObject({ pass: false });
  } finally {
    if (old === undefined) delete process.env.DRIFTBENCH_POINTER_SUT;
    else process.env.DRIFTBENCH_POINTER_SUT = old;
    clearSeedFreeCache();
  }
}, 60_000);
