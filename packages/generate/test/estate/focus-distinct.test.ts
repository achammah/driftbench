import { parseSpecText } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { type EstateGenerateInput, generateEstateSuite } from '../../src/estate/generate';

const atom = {
  id: 'instruction.archive.ready',
  kind: 'instruction',
  title: 'Say ready after checking the archive.',
  approved: true,
  evidence: [{ type: 'text' as const, must: ['ready'] }],
};
const input: EstateGenerateInput = {
  map: { runtime: 'claude-code', hash: 'archive', atoms: [atom] },
  plan: {
    mapHash: 'archive',
    rows: Array.from({ length: 5 }, (_, n) => ({
      id: `check-${n}`,
      atomIds: [atom.id],
      cell: {},
      testType: 'obligation',
      mode: 'live',
      status: 'approved',
    })),
  },
  bank: {
    version: 1,
    estate: 'archive',
    mapHash: 'archive',
    deviations: [],
    workspaces: [],
    situations: [
      {
        id: 'archive',
        title: 'Check an archive',
        use: 'trigger',
        atoms: [atom.id],
        phrases: [{ text: 'Check this archive.', lang: 'en', approved: true }],
        touches: { created: [], changed: [], deleted: [] },
      },
    ],
  },
};

describe('focused mutation opportunities', () => {
  it('does not count repeated identical asks and cells as independent opportunities', () => {
    const result = generateEstateSuite(input, {
      focus: [atom.id],
      paths: { map: 'map.yaml', plan: 'plan.yaml', phrases: 'phrases.yaml' },
    });
    const cases = result.files
      .filter((file) => file.path.endsWith('.yaml'))
      .map((file) => {
        const parsed = parseSpecText(file.text, 'yaml', file.path);
        if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
        return JSON.stringify([
          parsed.spec.blocks[0]?.when,
          (parsed.spec.metadata?.estate as { cell: unknown } | undefined)?.cell,
        ]);
      });
    expect(new Set(cases).size).toBeGreaterThanOrEqual(5);
    expect(result.specs).toHaveLength(9);
  });
});
