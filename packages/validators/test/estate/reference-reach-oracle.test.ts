import { describe, expect, it } from 'vitest';
import type { ScanOutcome } from '../../src/ladders/estate/bank/planted';
import { referenceReachCheck } from '../../src/ladders/estate/bank/scan-refs';

/** A valid map projection from a product that stores only direct file citations. */
function product() {
  const atoms = [
    { id: 'skill.review', kind: 'skill', provenance: { file: '.claude/skills/review/SKILL.md' } },
    {
      id: 'ref.first',
      kind: 'reference',
      provenance: { file: '.claude/skills/review/SKILL.md' },
      fields: { path: '.claude/skills/review/references/notes.md' },
    },
    {
      id: 'ref.inner',
      kind: 'reference',
      provenance: { file: '.claude/skills/review/references/notes.md' },
      fields: { path: '.claude/skills/review/references/detail.md' },
    },
  ];
  return {
    map: { atoms, edges: [{ from: 'skill.review', to: 'ref.first', kind: 'reference' }] },
    idOf: new Map([
      ['owner', 'skill.review'],
      ['inner', 'ref.inner'],
    ]),
    atomOf: new Map(atoms.map((atom) => [atom.id, atom])),
  } as unknown as ScanOutcome;
}

describe('chained reference reachability oracle', () => {
  it('accepts a direct-only product without an owner-to-inner edge', () => {
    expect(referenceReachCheck('owner', 'inner')(product())).toBeUndefined();
  });

  it('rejects a product that loses the inner reference', () => {
    const scan = product();
    scan.map.atoms = scan.map.atoms.filter((a) => a.id !== 'ref.inner');
    expect(referenceReachCheck('owner', 'inner')(scan)).toContain('not reachable');
  });

  it('rejects a disconnected chain even if a stale materialized edge claims reachability', () => {
    const scan = product();
    scan.map.atoms = scan.map.atoms.filter((a) => a.id !== 'ref.first');
    scan.map.edges.push({ from: 'skill.review', to: 'ref.inner', kind: 'reference' });
    expect(referenceReachCheck('owner', 'inner')(scan)).toContain('not reachable');
  });

  it('rejects a citation to the wrong folder and terminates cycles', () => {
    const scan = product();
    const first = scan.map.atoms.find((a) => a.id === 'ref.first');
    if (!first?.fields) throw new Error('missing fixture bridge');
    first.fields.path = '.claude/skills/review/SKILL.md';
    expect(referenceReachCheck('owner', 'inner')(scan)).toContain('not reachable');
  });
});
