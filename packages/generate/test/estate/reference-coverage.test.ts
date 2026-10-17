import { expect, it } from 'vitest';
import { anchoredLines, navigationFiles, navigationReference } from '../../src/estate/context';
import { generateEstateSuite } from '../../src/estate/generate';
import { APPROVED_PLAN, fixtureInputs, PLANNER_PATHS } from './support';

it('gives every reference of the fixture estate that the estate holds a complete spec, the one to a template in a templates folder included', async () => {
  const inputs = await fixtureInputs(APPROVED_PLAN);
  const result = generateEstateSuite(inputs, { paths: PLANNER_PATHS });
  const references = inputs.map.atoms.filter((atom) => atom.kind === 'reference');
  expect(references.length).toBeGreaterThan(0);
  // The report skill orders a read of its template: an instruction acts on that reference, so it is testable
  // although the template sits in a folder the map records as a template document.
  const navigation = navigationFiles(inputs.map.documents);
  expect(navigation.has('.claude/skills/weekly-report/templates/report.md')).toBe(true);
  const anchored = anchoredLines(inputs.map.atoms);
  expect(references.filter((atom) => navigationReference(atom, navigation, anchored))).toEqual([]);
  for (const atom of references) {
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
}, 120_000);
