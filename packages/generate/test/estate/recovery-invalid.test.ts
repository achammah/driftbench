import { describe, expect, it } from 'vitest';
import type { EstateAtom } from '../../src/estate/inputs';
import { stageModel, thenOf } from '../../src/estate/then';

const call = { label: 'Bash', input: { command: { equals: 'node check.mjs' } }, count: { min: 2 } };
const valid = { reread: ['valid.md'], calls: [call], retry: true };
const context = {
  stages: stageModel([]),
  skills: new Set<string>(),
  customChecks: new Set(['hazard_recovery']),
};
function compile(source: 'fields' | 'options', declaration: Record<string, unknown>, judge = false) {
  const atom: EstateAtom = {
    id: 'hazard.fixture',
    kind: 'hazard',
    title: 'Restore fixture context',
    approved: true,
    fields: source === 'fields' ? { recovery: declaration } : {},
    evidence: [
      {
        type: 'custom',
        name: 'hazard_recovery',
        options: { hazard: 'compaction', ...(source === 'options' ? declaration : {}) },
      },
    ],
  };
  return thenOf([atom], 'positive', { ...context, judge });
}

const malformed: Array<[string, Record<string, unknown>]> = [
  ['null path beside a valid path', { ...valid, reread: ['valid.md', null] }],
  ['empty path beside a valid path', { ...valid, reread: ['valid.md', '  '] }],
  ['non-string path beside a valid path', { ...valid, reread: ['valid.md', 42] }],
  ['path list is not an array', { ...valid, reread: 'valid.md' }],
  ['null call beside a valid call', { ...valid, calls: [call, null] }],
  ['array call beside a valid call', { ...valid, calls: [call, []] }],
  ['call without input', { ...valid, calls: [call, { label: 'Read' }] }],
  ['call with null input', { ...valid, calls: [call, { label: 'Read', input: null }] }],
  ['call with array input', { ...valid, calls: [call, { label: 'Read', input: [] }] }],
  ['call with empty label', { ...valid, calls: [call, { label: ' ', input: {} }] }],
  ['call list is not an array', { ...valid, calls: call }],
  ['zero-count call beside a required call', { ...valid, calls: [call, { ...call, count: 0 }] }],
  ['zero-minimum call beside a required call', { ...valid, calls: [call, { ...call, count: { min: 0 } }] }],
  ['invalid call count', { ...valid, calls: [call, { ...call, count: 'two' }] }],
  ['count without a positive minimum', { ...valid, calls: [call, { ...call, count: {} }] }],
  ['upper-bound-only call count', { ...valid, calls: [call, { ...call, count: { max: 2 } }] }],
  ['reversed count bounds', { ...valid, calls: [call, { ...call, count: { min: 3, max: 2 } }] }],
  ['invalid retry flag', { ...valid, retry: 'yes' }],
  ['null unresolved target beside a valid target', { ...valid, unpathed: ['open fixture note', null] }],
  ['unresolved targets is not an array', { ...valid, unpathed: 'open fixture note' }],
];

for (const source of ['fields', 'options'] as const) {
  describe(`recovery declaration in ${source}`, () => {
    it.each(malformed)('fails closed for %s without weakening valid siblings', (_name, declaration) => {
      const then = compile(source, declaration);
      expect(then.gaps.length).toBeGreaterThan(0);
      expect(then.gaps.some((entry) => entry.atom === 'hazard.fixture')).toBe(true);
      if (Array.isArray(declaration.reread))
        expect(then.custom.hazard_recovery).toMatchObject({ reread: ['valid.md'] });
      if (Array.isArray(declaration.calls))
        expect((then.custom.hazard_recovery as { calls?: unknown[] })?.calls).toContainEqual(call);
    });

    it('does not let an advisory judge erase malformed evidence', () => {
      const then = compile(source, { ...valid, reread: ['valid.md', null], calls: [call, null] }, true);
      expect(then.gaps.length).toBeGreaterThan(0);
    });

    it('preserves valid typed paths, positive call counts and retry', () => {
      const then = compile(source, valid);
      expect(then.gaps).toEqual([]);
      expect(then.custom.hazard_recovery).toMatchObject(valid);
    });
  });
}

it.each([null, [], 'recovery'])('fails closed when fields.recovery is malformed: %j', (recovery) => {
  const atom: EstateAtom = {
    id: 'hazard.fixture',
    kind: 'hazard',
    title: 'Restore fixture context',
    approved: true,
    fields: { recovery },
    evidence: [
      { type: 'custom', name: 'hazard_recovery', options: { hazard: 'compaction', reread: ['valid.md'] } },
    ],
  };
  expect(thenOf([atom], 'positive', context).gaps.length).toBeGreaterThan(0);
});
