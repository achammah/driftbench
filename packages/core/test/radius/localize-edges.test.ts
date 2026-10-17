import { describe, expect, it } from 'vitest';
import { localizeRows, localizeRuns } from '../../src/radius/localize';
import type { SectionRegistry } from '../../src/radius/sections';
import type { BlockLink } from '../../src/schema/links';
import type { RunResult } from '../../src/schema/run';
import type { Spec } from '../../src/schema/spec';
import { specHash } from '../../src/spec/identity';

/** Fictional data only. Hand-written specs and registry, so every ancestor and rank can be read by eye. */
const link = (block: string, section: string): BlockLink => ({
  block,
  to: { kind: 'prompt_section', prompt: 'p', section },
  status: 'declared',
});
const specOf = (id: string, blocks: { id: string; section: string }[], parent?: string): Spec =>
  ({
    id,
    kind: 'conversation',
    blocks: blocks.map((block, index) => ({
      id: block.id,
      when: { user: '.' },
      ...(index === 0 && parent !== undefined ? { given: { parent } } : {}),
    })),
    metadata: { links: blocks.map((block) => link(block.id, block.section)) },
  }) as Spec;
const registryOf = (stale: string[] = []): SectionRegistry => ({
  prompt_id: 'p',
  version: 'v1',
  text_sha256: '0'.repeat(64),
  sections: ['tone', 'intro', 'offer', 'close', 'old'].map((id, index) => ({
    id,
    scope: id === 'tone' ? ('global' as const) : ('local' as const),
    span: { start: index * 10, end: index * 10 + 9 },
    sha256: '0'.repeat(64),
    anchor: { quote: id },
    ...(stale.includes(id) ? { stale: true } : {}),
  })),
});

describe('localisation across a parent edge', () => {
  // grand: g1 g2 g3. parent starts from grand#g2: p1 p2. child starts from parent#p2: c1 c2.
  const grand = specOf('grand', [
    { id: 'g1', section: 'intro' },
    { id: 'g2', section: 'offer' },
    { id: 'g3', section: 'close' },
  ]);
  const parent = specOf(
    'parent',
    [
      { id: 'p1', section: 'intro' },
      { id: 'p2', section: 'offer' },
    ],
    'grand#g2',
  );
  const child = specOf(
    'child',
    [
      { id: 'c1', section: 'close' },
      { id: 'c2', section: 'close' },
    ],
    'parent#p2',
  );
  const suite = [child, parent, grand];

  it('chains the parent block, its earlier blocks and the grandparent chain, in order', () => {
    const rows = localizeRows(suite, registryOf(), 'F');
    const ancestors = (key: string) => rows.find((row) => row.key === key)?.ancestors;
    expect(ancestors('grand#g2')).toEqual(['grand#g1']);
    expect(ancestors('parent#p1')).toEqual(['grand#g1', 'grand#g2']);
    expect(ancestors('child#c1')).toEqual(['grand#g1', 'grand#g2', 'parent#p1', 'parent#p2']);
    expect(ancestors('child#c2')).toEqual(['grand#g1', 'grand#g2', 'parent#p1', 'parent#p2', 'child#c1']);
    // In mode T a block starts from its canonical Given and inherits nothing, parent edge or not.
    expect(localizeRows(suite, registryOf(), 'T').every((row) => row.ancestors.length === 0)).toBe(true);
  });

  it('drops a failure inherited from the grandparent as one run reads it', () => {
    const run = (specId: string, spec: Spec, failed: string[]): RunResult =>
      ({
        runId: `r-${specId}`,
        specId,
        specHash: specHash(spec),
        target: { adapter: 'function', agent: 'acme-sales' },
        mode: 'F',
        repeat: 0,
        blocks: spec.blocks.map((block, index) => ({ index, pass: !failed.includes(block.id ?? '') })),
      }) as unknown as RunResult;
    // The grandparent block g2 fails; the child's c1 fails after it, so c1 is inherited, not a root.
    const result = localizeRuns(
      suite,
      [run('grand', grand, ['g2']), run('parent', parent, []), run('child', child, ['c1'])],
      registryOf(),
      { mode: 'F' },
    );
    expect(result.localization.roots).toEqual(['grand#g2']);
    expect(result.localization.inherited).toBe(1);
    expect(result.localization.sections[0]?.section).toBe('offer');
  });
});

describe('localisation leaves stale sections out', () => {
  const spec = specOf('only', [
    { id: 'a', section: 'old' },
    { id: 'b', section: 'offer' },
  ]);
  const stale = registryOf(['old']);

  it('gives a row no stale section, and the ranking no stale section', () => {
    expect(localizeRows([spec], stale, 'F').map((row) => row.sections)).toEqual([[], ['offer']]);
    const run = {
      runId: 'r',
      specId: spec.id,
      specHash: specHash(spec),
      target: { adapter: 'function', agent: 'acme-sales' },
      mode: 'F',
      repeat: 0,
      blocks: [
        { index: 0, pass: false },
        { index: 1, pass: true },
      ],
    } as unknown as RunResult;
    const { localization } = localizeRuns([spec], [run], stale, { mode: 'F' });
    expect(localization.sections.map((each) => each.section).sort()).toEqual(['close', 'intro', 'offer']);
    expect(localization.global).toEqual(['tone']);
    // The failing block links only to the stale section, so no live section carries its failure.
    expect(localization.sections.every((each) => each.score === 0)).toBe(true);
  });
});
