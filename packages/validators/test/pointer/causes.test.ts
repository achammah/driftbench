import { describe, expect, it } from 'vitest';
import { distinctCauses, pointerBank } from '../../src/ladders/pointer/bank';
import { validationCases } from '../../src/ladders/pointer/bank/families/labelset-validation';
import { runItem } from '../../src/ladders/pointer/bank/run';
import { constant } from '../../src/ladders/pointer/kit/labellers';
import { RULES_YAML } from '../../src/ladders/pointer/kit/sets';
import type { PointerSut } from '../../src/ladders/pointer/sut/port';
import { referenceSut } from './reference';

const ref = referenceSut();
const bank = pointerBank();
const item = (id: string) => {
  const found = bank.find((x) => x.id === id);
  if (!found) throw new Error(id);
  return found;
};

describe('cause corrections preserve correctness checks', () => {
  it('gives the eleven decision decoys one cause and rejects one shared shortcut', async () => {
    const decoys = bank.filter((x) => x.cause === 'scan:honor-labeller-decisions');
    expect(decoys).toHaveLength(11);
    const mutant: PointerSut = {
      ...ref,
      scan: (request) => ref.scan({ ...request, labeler: constant('none') }),
    };
    for (const value of decoys) {
      expect(await runItem(value, 1, ref), value.id).toMatchObject({ pass: true });
      expect(await runItem(value, 1, mutant), value.id).toMatchObject({ pass: false });
    }
  });
  for (const value of validationCases) {
    it(`isolates ${value.key} and keeps the aggregate strict`, async () => {
      const mutant: PointerSut = {
        ...ref,
        scan: (request) =>
          ref.scan({
            ...request,
            labelsYaml: request.labelsYaml === value.yaml ? RULES_YAML : request.labelsYaml,
          }),
      };
      for (const id of [`labels.set-validation-${value.key}`, 'labels.set-validation-errors']) {
        expect(await runItem(item(id), 1, ref), id).toMatchObject({ pass: true });
        expect(await runItem(item(id), 1, mutant), id).toMatchObject({ pass: false });
      }
    });
  }
  it('keeps the aggregate scored without claiming one atomic repair', () => {
    expect(item('labels.set-validation-errors').causeKind).toBe('composite');
    expect(distinctCauses(bank, ['labels.set-validation-errors'])).toEqual([]);
    expect(
      distinctCauses(
        bank,
        validationCases.map((v) => `labels.set-validation-${v.key}`),
      ),
    ).toHaveLength(5);
  });
});
