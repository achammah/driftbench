import { expect, it } from 'vitest';
import { parse } from 'yaml';
import { type EstateGenerateInput, generateEstateSuite } from '../../src/estate/generate';

it.each(['deny', 'warn', 'nudge', 'ask'])(
  'preserves declared %s verdicts in every generated guard expectation',
  (verdict) => {
    const atom = {
      id: 'guard.review',
      kind: 'guard',
      title: 'Review changes',
      approved: true,
      fields: {
        name: 'review.sh',
        event: 'Stop',
        command: 'sh .claude/review.sh',
        enforces: [{ atom: 'rule.review', by: 'id' }],
      },
      evidence: [{ type: 'guard' as const, name: 'review.sh', verdict }],
    };
    const input: EstateGenerateInput = {
      map: {
        runtime: 'claude-code',
        hash: 'hand-review',
        atoms: [
          atom,
          {
            id: 'rule.review',
            kind: 'instruction',
            title: 'Review notice',
            approved: true,
            evidence: [],
            provenance: { quote: 'Never say "obsolete".' },
          },
        ],
      },
      plan: {
        mapHash: 'hand-review',
        rows: ['guard_positive', 'guard_negative', 'guard_hostile', 'guard_speed', 'guard_register'].map(
          (testType) => ({
            id: testType,
            atomIds: [atom.id],
            cell: {},
            testType,
            mode: 'unit',
            status: 'approved',
          }),
        ),
      },
      bank: {
        version: 1,
        estate: 'review',
        mapHash: 'hand-review',
        deviations: [],
        workspaces: [],
        situations: [],
      },
    };
    const result = generateEstateSuite(input, {
      paths: { map: 'map.yaml', plan: 'plan.yaml', phrases: 'phrases.yaml' },
    });
    expect(result.report.invalid).toEqual([]);
    expect(result.files.filter((f) => f.path.endsWith('.yaml'))).toHaveLength(5);
    for (const file of result.files.filter((f) => f.path.endsWith('.yaml'))) {
      expect(parse(file.text).blocks[0].expect.guards[0].verdict, file.path).toBe(verdict);
    }
  },
);
