import { expect, it } from 'vitest';
import { generateEstateSuite } from '../../src/estate/generate';
import { APPROVED_PLAN, fixtureInputs, PLANNER_PATHS } from './support';

it('gives every reference of the fixture estate at least one complete spec', async () => {
  const inputs = await fixtureInputs(APPROVED_PLAN);
  const result = generateEstateSuite(inputs, { paths: PLANNER_PATHS });
  const references = inputs.map.atoms.filter((atom) => atom.kind === 'reference');
  expect(references.length).toBeGreaterThan(0);
  for (const atom of references) {
    const done = result.specs.filter((record) => record.complete && record.atoms[0] === atom.id);
    expect(done.length, atom.id).toBeGreaterThan(0);
  }
}, 120_000);
