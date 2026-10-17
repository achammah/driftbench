import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import type { ChangeManifest } from '../../src/radius/change';
import { radiusOf } from '../../src/radius/radius';
import { parseSectionRegistry, reanchorRegistry, type SectionRegistry } from '../../src/radius/sections';
import {
  defaultParentOf,
  SECTION_SELECTION_ADVISORY,
  type SectionSelection,
  sectionChangeManifest,
  sectionSelection,
} from '../../src/radius/select';
import type { BlockLink } from '../../src/schema/links';
import type { Spec } from '../../src/schema/spec';

const acme = (name: string) =>
  readFileSync(new URL(`../../../../examples/acme/prompts/${name}`, import.meta.url), 'utf8');
const parsed = parseSectionRegistry(parseYaml(acme('acme-sales.sections.yaml')));
if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
const registry: SectionRegistry = parsed.registry;

type H7 = {
  flaky: string[];
  conversations: { id: string; blocks: { id: string; links: string[] }[] }[];
  mutants: { variant: string; sections: string[]; control: boolean; pair: boolean; E: string[] }[];
};
/**
 * The H7 suite (research/block-links): 19 conversations, 37 blocks, declared links, confirmed flips. The
 * suite lists links to local sections only; global sections link to every block implicitly, so each
 * block here also links to every global section.
 */
const h7: H7 = JSON.parse(
  readFileSync(new URL('../fixtures/sections/h7-selection.json', import.meta.url), 'utf8'),
);
const globals = registry.sections
  .filter((section) => section.scope === 'global')
  .map((section) => section.id);
const h7Specs = h7.conversations.map((conversation) => ({
  hash: conversation.id,
  spec: {
    id: conversation.id,
    kind: 'conversation',
    blocks: conversation.blocks.map((block) => ({ id: block.id, when: { user: '.' } })),
    metadata: {
      links: conversation.blocks.flatMap((block) =>
        [...block.links, ...globals].map(
          (section): BlockLink => ({
            block: block.id,
            to: { kind: 'prompt_section', prompt: 'acme-sales', section },
            status: 'declared',
            created_by: 'author',
          }),
        ),
      ),
    },
  } as Spec,
}));
const manifestOf = (sections: string[]): ChangeManifest => ({
  from: 'v1',
  to: 'mutant',
  changes: sections.map((section) => ({ kind: 'prompt_section', id: `acme-sales#${section}` })),
});

/** STARTS safety: a mutant violates safety when a block it flipped (E) is outside the selection (T). */
function rescore(which: (mutant: H7['mutants'][number]) => boolean, include: (state: string) => boolean) {
  const flaky = new Set(h7.flaky);
  const stable = h7.conversations.flatMap((c) => c.blocks.map((b) => b.id)).filter((id) => !flaky.has(id));
  const rows = h7.mutants.filter(which);
  let violations = 0;
  let ratio = 0;
  for (const mutant of rows) {
    const selection = sectionSelection(h7Specs, manifestOf(mutant.sections), [registry]);
    const selected = new Set(
      selection.specs.flatMap((spec) => spec.blocks.filter((b) => include(b.state)).map((b) => b.id)),
    );
    const T = new Set([...selected].filter((id) => !flaky.has(id)));
    if (mutant.E.some((id) => !T.has(id))) violations++;
    ratio += T.size / stable.length;
  }
  return { mutants: rows.length, violations, share: violations / rows.length, ratio: ratio / rows.length };
}
const single = (m: H7['mutants'][number]) => !m.control && !m.pair;
const all = (m: H7['mutants'][number]) => !m.control;

describe('advisory section selection on the stored H7 runs', () => {
  it('reproduces the registered H7 numbers from the direct selection alone', () => {
    const direct = (state: string) => state === 'direct';
    expect(rescore(single, direct)).toMatchObject({ mutants: 90, violations: 3 });
    expect(rescore(single, direct).ratio).toBeCloseTo(0.199, 3);
    expect(rescore(all, direct)).toMatchObject({ mutants: 110, violations: 9 });
  });

  it('keeps the violation share at or below 5% on the 90 and the 110 mutants with forward closure', () => {
    const selected = (state: string) => state !== 'out';
    const ninety = rescore(single, selected);
    const hundredTen = rescore(all, selected);
    expect(ninety).toMatchObject({ mutants: 90, violations: 2 });
    expect(hundredTen).toMatchObject({ mutants: 110, violations: 4 });
    expect(ninety.share).toBeLessThanOrEqual(0.05);
    expect(hundredTen.share).toBeLessThanOrEqual(0.05);
    expect(ninety.ratio).toBeCloseTo(0.2276, 3);
    expect(hundredTen.ratio).toBeCloseTo(0.2244, 3);
  });

  it('selects nothing outside a mutant of a control-only section and every block for a global one', () => {
    const local = sectionSelection(h7Specs, manifestOf(['explicit_confirm']), [registry]);
    expect(local.all).toBeNull();
    expect(local.closure).toContain('acme-sales#explicit_confirm');
    expect(local.counts.skipped).toBeGreaterThan(0);
    const global = sectionSelection(h7Specs, manifestOf(['identity']), [registry]);
    expect(global.all).toBe('acme-sales#identity is a global section');
    expect(global.counts.skipped).toBe(0);
  });
});

const tiny = (blocks: { id: string; links?: BlockLink[] }[], id = 'order', given?: unknown): Spec =>
  ({
    id,
    kind: 'conversation',
    blocks: blocks.map((block, index) => ({
      id: block.id,
      when: { user: '.' },
      ...(index === 0 && given !== undefined ? { given } : {}),
    })),
    metadata: { links: blocks.flatMap((block) => block.links ?? []) },
  }) as Spec;
const link = (block: string, section: string, status: BlockLink['status'] = 'declared'): BlockLink => ({
  block,
  to: { kind: 'prompt_section', prompt: 'p', section },
  status,
});
const small: SectionRegistry = {
  prompt_id: 'p',
  version: 'v1',
  text_sha256: '0'.repeat(64),
  sections: ['tone', 'refund', 'refund_faq', 'exceptions', 'recap', 'closing'].map((id, index) => ({
    id,
    scope: id === 'tone' ? 'global' : 'local',
    span: { start: index * 10, end: index * 10 + 9 },
    sha256: '0'.repeat(64),
    anchor: { quote: id },
    ...(id === 'exceptions' ? { references: ['refund'] } : {}),
    ...(id === 'refund_faq' ? { duplicates: ['refund'] } : {}),
    ...(id === 'closing' ? { stale: true } : {}),
  })),
};
const pick = (selection: SectionSelection, spec = 'order') =>
  Object.fromEntries(
    (selection.specs.find((each) => each.specId === spec)?.blocks ?? []).map((b) => [b.id, b.state]),
  );
const changeOf = (...ids: string[]): ChangeManifest => ({
  from: 'v1',
  to: 'v2',
  changes: ids.map((id) => ({ kind: 'prompt_section', id })),
});

describe('section selection rules', () => {
  it('follows references and duplicates, skips refuted links, keeps stale and missing links', () => {
    const spec = tiny([
      { id: 'a', links: [link('a', 'recap')] },
      { id: 'b', links: [link('b', 'exceptions')] },
      { id: 'c', links: [link('c', 'refund_faq')] },
      { id: 'd', links: [link('d', 'refund', 'refuted'), link('d', 'recap')] },
      { id: 'e', links: [link('e', 'closing')] },
      { id: 'f', links: [link('f', 'nope')] },
    ]);
    // No forward closure here: each block is its own conversation.
    const specs = spec.blocks.map((block, index) => ({
      hash: String(index),
      spec: { ...spec, id: block.id ?? '', blocks: [block] } as Spec,
    }));
    const selection = sectionSelection(specs, changeOf('p#refund'), [small]);
    expect(selection.closure.sort()).toEqual(['p#exceptions', 'p#refund', 'p#refund_faq']);
    const state = Object.fromEntries(selection.specs.map((s) => [s.specId, s.blocks[0]?.why]));
    expect(state).toEqual({
      a: [],
      b: ['link:p#exceptions (declared)'],
      c: ['link:p#refund_faq (declared)'],
      d: [],
      e: ['stale-link:p#closing'],
      f: ['stale-link:p#nope'],
    });
  });

  it('selects a block with no link to the changed prompt, and closes forward in the conversation', () => {
    const spec = tiny([
      { id: 'a', links: [link('a', 'recap')] },
      { id: 'b' },
      { id: 'c', links: [link('c', 'recap')] },
    ]);
    const selection = sectionSelection([{ spec, hash: 'x' }], changeOf('p#refund'), [small]);
    expect(pick(selection)).toEqual({ a: 'out', b: 'direct', c: 'forward' });
    expect(selection.specs[0]?.blocks[1]?.why).toEqual(['no-links:p']);
    expect(selection.specs[0]?.blocks[2]?.why).toEqual(['after b']);
  });

  it('selects every block for a global section, an unknown section or a prompt with no registry', () => {
    const spec = tiny([{ id: 'a', links: [link('a', 'recap')] }]);
    for (const [id, reason] of [
      ['p#tone', 'p#tone is a global section'],
      ['p#missing', 'the section p#missing is in no registry'],
      ['q#refund', 'no section registry describes the prompt q'],
    ] as const) {
      const selection = sectionSelection([{ spec, hash: 'x' }], changeOf(id), [small]);
      expect(selection.all).toBe(reason);
      expect(pick(selection)).toEqual({ a: 'direct' });
    }
    // A section id without a prompt is looked up in every registry.
    expect(sectionSelection([{ spec, hash: 'x' }], changeOf('refund'), [small]).closure).toContain(
      'p#refund',
    );
  });

  it('carries a selection to the descendants of a parent block', () => {
    const stem = tiny(
      [
        { id: 's1', links: [link('s1', 'recap')] },
        { id: 's2', links: [link('s2', 'refund')] },
      ],
      'stem',
    );
    const early = tiny([{ id: 'x1', links: [link('x1', 'recap')] }], 'from-s1', { parent: 'stem#s1' });
    const late = tiny([{ id: 'y1', links: [link('y1', 'recap')] }], 'from-s2', {
      parent: { ref: 'stem#s2' },
    });
    const grandchild = tiny([{ id: 'z1', links: [link('z1', 'recap')] }], 'from-y1', { from: 'from-s2#y1' });
    expect(defaultParentOf(late)).toEqual({ spec: 'stem', block: 's2' });
    const selection = sectionSelection(
      [grandchild, early, late, stem].map((spec) => ({ spec, hash: spec.id })),
      changeOf('p#refund'),
      [small],
    );
    expect(pick(selection, 'stem')).toEqual({ s1: 'out', s2: 'direct' });
    expect(pick(selection, 'from-s1')).toEqual({ x1: 'out' });
    expect(pick(selection, 'from-s2')).toEqual({ y1: 'forward' });
    expect(pick(selection, 'from-y1')).toEqual({ z1: 'forward' });
    expect(selection.specs.find((s) => s.specId === 'from-y1')?.blocks[0]?.why).toEqual(['via from-s2#y1']);
  });
});

describe('the radius stays the whole suite', () => {
  it('reads a prompt_section change as the whole suite and adds the advisory list only with registries', () => {
    const report = radiusOf(h7Specs, manifestOf(['explicit_confirm']), {
      modes: ['F', 'T'],
      sections: [registry],
    });
    expect(report.whole).toEqual({
      change: 'prompt_section:acme-sales#explicit_confirm',
      reason: SECTION_SELECTION_ADVISORY,
    });
    expect(report.totals.F?.out).toBe(0);
    expect(report.totals.T?.out).toBe(0);
    expect(report.advisory?.advisory).toBe(true);
    expect(report.advisory?.counts.skipped).toBeGreaterThan(0);
    expect(radiusOf(h7Specs, manifestOf(['explicit_confirm'])).advisory).toBeUndefined();
  });

  it('turns a re-anchoring into prompt_section changes, and outside edits into a global change', () => {
    const prompt = acme('acme-sales.md');
    const next = `Note.\n\n${prompt.replace('Call order_create only after', 'Call order_create only once after')}`;
    const made = reanchorRegistry(registry, prompt, next, 'v2');
    if (!made.ok) throw new Error(made.errors.join('\n'));
    const manifest = sectionChangeManifest(registry, made.result, { to: 'v2' });
    expect(manifest.from).toBe('v1');
    expect(
      manifest.changes.map((change) => [change.kind, change.id ?? null, change.global ?? false]),
    ).toEqual([
      ...made.result.sections
        .filter((section) => section.status === 'stale')
        .map((section) => ['prompt_section', `acme-sales#${section.id}`, false]),
      ['prompt', null, true],
    ]);
  });
});
