import { expect, it } from 'vitest';
import { navigationFiles, navigationReference } from '../../src/estate/context';
import { generateEstateSuite } from '../../src/estate/generate';
import { APPROVED_PLAN, fixtureInputs, PLANNER_PATHS } from './support';

it('gives every reference of the fixture estate that the estate holds a complete spec, but those to a navigation-only document', async () => {
  const inputs = await fixtureInputs(APPROVED_PLAN);
  const result = generateEstateSuite(inputs, { paths: PLANNER_PATHS });
  const references = inputs.map.atoms.filter((atom) => atom.kind === 'reference');
  expect(references.length).toBeGreaterThan(0);
  // A reference to an example, a template or a history holds no rule: the map records the document as
  // navigation only and the plan gives it no row.
  const navigation = navigationFiles(inputs.map.documents);
  const navigational = references.filter((atom) => navigationReference(atom, navigation));
  expect(navigational.map((atom) => atom.id)).toEqual(['reference.weekly-report.read-templates-report-md']);
  for (const atom of references.filter((reference) => !navigational.includes(reference))) {
    const done = result.specs.filter((record) => record.complete && record.atoms[0] === atom.id);
    if (atom.fields?.exists === false) {
      // A Read of a file the estate does not hold waits on needs-existing-file, whatever checks the runner registers
      // (docs/estate.md, section 5): the reference has no complete spec, and every spec it has says why.
      expect(done.length, atom.id).toBe(0);
      const own = result.specs.filter((record) => record.atoms[0] === atom.id);
      expect(own.length, atom.id).toBeGreaterThan(0);
      continue;
    }
    expect(done.length, atom.id).toBeGreaterThan(0);
  }
  for (const atom of navigational) {
    expect(
      result.specs.filter((record) => record.atoms[0] === atom.id),
      atom.id,
    ).toEqual([]);
  }
}, 120_000);
