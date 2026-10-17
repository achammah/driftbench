import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  type Localization,
  type LocalizeRow,
  localizeRows,
  localizeRuns,
  ochiaiLocalize,
} from '../../src/radius/localize';
import { parseSectionRegistry, type SectionRegistry } from '../../src/radius/sections';
import type { BlockLink } from '../../src/schema/links';
import type { RunResult } from '../../src/schema/run';
import type { Spec } from '../../src/schema/spec';
import { specHash } from '../../src/spec/identity';

const runOf = (failed: Record<string, boolean>) => new Map(Object.entries(failed));
const score = (result: Localization, section: string) =>
  Math.round((result.sections.find((each) => each.section === section)?.score ?? Number.NaN) * 1000) / 1000;

describe('Ochiai per section', () => {
  // Deep report section 3.1: seven blocks, faults planted in S4 and S5.
  const rows: LocalizeRow[] = [
    { key: 'a1', sections: ['S1', 'S2'], ancestors: [] },
    { key: 'a2', sections: ['S1', 'S3'], ancestors: ['a1'] },
    { key: 'a3', sections: ['S3', 'S4'], ancestors: ['a1', 'a2'] },
    { key: 'a4', sections: ['S3', 'S5'], ancestors: ['a1', 'a2', 'a3'] },
    { key: 'a5', sections: ['S3', 'S4'], ancestors: ['a1', 'a2', 'a3'] },
    { key: 'b1', sections: ['S1', 'S2'], ancestors: [] },
    { key: 'b2', sections: ['S2', 'S5'], ancestors: [] },
  ];
  const run = runOf({ a1: false, a2: false, a3: true, a4: true, a5: true, b1: false, b2: true });
  const local = ['S1', 'S2', 'S3', 'S4', 'S5'];

  it('reproduces the toy: flat counting blames S3, root counting ties S4 and S5 first', () => {
    const flat = ochiaiLocalize(rows, [run], { local }, 'flat');
    expect(score(flat, 'S3')).toBe(0.75);
    expect(flat.sections[0]?.section).toBe('S3');
    const grouped = ochiaiLocalize(rows, [run], { local });
    // 1 / sqrt(2) for S4 and S5, the deep report's 0.707.
    const half = Math.round(Math.SQRT1_2 * 1000) / 1000;
    expect([score(grouped, 'S4'), score(grouped, 'S5'), score(grouped, 'S3')]).toEqual([half, half, 0.5]);
    expect(grouped.sections.slice(0, 2).map((each) => [each.section, each.best, each.worst])).toEqual([
      ['S4', 1, 2],
      ['S5', 1, 2],
    ]);
    expect(grouped.inherited).toBe(2);
    expect(grouped.roots.sort()).toEqual(['a3', 'b2']);
  });

  it('keeps a passing child of a failing parent as a row, and drops only inherited failures', () => {
    const child = runOf({ a1: true, a2: false });
    const result = ochiaiLocalize(
      [
        { key: 'a1', sections: ['S1'], ancestors: [] },
        { key: 'a2', sections: ['S2'], ancestors: ['a1'] },
      ],
      [child],
      { local: ['S1', 'S2'] },
    );
    expect(result.rows).toBe(2);
    expect(result.inherited).toBe(0);
    expect(score(result, 'S2')).toBe(0);
  });

  it('gives all zeros on an all-pass suite, and lists global sections apart', () => {
    const pass = runOf(Object.fromEntries(rows.map((row) => [row.key, false])));
    const result = ochiaiLocalize(rows, [pass, pass], { local, global: ['tone'] });
    expect(result.sections.every((each) => each.score === 0)).toBe(true);
    expect(result.sections.every((each) => each.best === 1 && each.worst === 5)).toBe(true);
    expect(result.failureWeight).toBe(0);
    expect(result.global).toEqual(['tone']);
  });

  it('weighs repeats softly: a block failing one run in two counts half', () => {
    const result = ochiaiLocalize(
      [{ key: 'a', sections: ['S1'], ancestors: [] }],
      [runOf({ a: true }), runOf({ a: false })],
      { local: ['S1'] },
    );
    expect(result.sections[0]).toMatchObject({ failed: 0.5, passed: 0.5 });
    // 0.5 / sqrt(N_F 0.5 x (0.5 + 0.5)) = 1 / sqrt(2)
    expect(result.sections[0]?.score).toBeCloseTo(Math.SQRT1_2, 12);
  });
});

const acme = (name: string) =>
  readFileSync(new URL(`../../../../examples/acme/prompts/${name}`, import.meta.url), 'utf8');
const parsed = parseSectionRegistry(parseYaml(acme('acme-sales.sections.yaml')));
if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
const registry: SectionRegistry = parsed.registry;
const fixture = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`../fixtures/sections/${name}`, import.meta.url), 'utf8'));
const h7 = fixture<{ conversations: { id: string; blocks: { id: string; links: string[] }[] }[] }>(
  'h7-selection.json',
);
const h5 = fixture<{ variants: { variant: string; sections: string[]; failing: string[][] }[] }>(
  'h5-localize.json',
);
const linkTo = (block: string, section: string): BlockLink => ({
  block,
  to: { kind: 'prompt_section', prompt: 'acme-sales', section },
  status: 'declared',
});
const h7Specs: Spec[] = h7.conversations.map((conversation) => ({
  id: conversation.id,
  kind: 'conversation',
  blocks: conversation.blocks.map((block) => ({ id: block.id, when: { user: '.' } })),
  metadata: {
    links: conversation.blocks.flatMap((block) => block.links.map((section) => linkTo(block.id, section))),
  },
}));

describe('localisation on the stored H7 runs (H5)', () => {
  const rows = localizeRows(h7Specs, registry, 'F');
  const local = registry.sections.filter((s) => s.scope === 'local').map((s) => s.id);
  const global = new Set(registry.sections.filter((s) => s.scope === 'global').map((s) => s.id));
  const keyOf = new Map(h7.conversations.flatMap((c) => c.blocks.map((b) => [b.id, `${c.id}#${b.id}`])));
  const all = new Set(keyOf.values());
  /** EXAM of the best ranked planted section, ties averaged, as H5 registered it. */
  const exam = (result: Localization, planted: string[]) =>
    Math.min(
      ...planted.map((section) => {
        const at = result.sections.find((each) => each.section === section);
        if (!at) return Number.POSITIVE_INFINITY;
        const tau = (at.best - 1 + at.worst - 1) / 2;
        return (tau + 1) / local.length;
      }),
    );

  it('reads an F-mode chain: a block inherits every earlier block of its conversation', () => {
    const third = rows.find((row) => row.key === 'upgrade-happy#u3');
    expect(third?.ancestors).toEqual(['upgrade-happy#u1', 'upgrade-happy#u2']);
    expect(third?.sections).toEqual(['recap']);
    expect(localizeRows(h7Specs, registry, 'T').every((row) => row.ancestors.length === 0)).toBe(true);
  });

  it('ranks the planted section worse than flat counting on at most 5% of faults (3 of 98)', () => {
    let worse = 0;
    let better = 0;
    let faults = 0;
    for (const variant of h5.variants) {
      if (variant.sections.some((section) => global.has(section))) continue;
      const runs = variant.failing.map((failing) => {
        const failed = new Set(failing.map((id) => keyOf.get(id)));
        return new Map([...all].map((key) => [key, failed.has(key)]));
      });
      const flat = ochiaiLocalize(rows, runs, { local }, 'flat');
      const grouped = ochiaiLocalize(rows, runs, { local });
      if (flat.failureWeight === 0) continue;
      faults++;
      if (exam(grouped, variant.sections) > exam(flat, variant.sections)) worse++;
      if (exam(grouped, variant.sections) < exam(flat, variant.sections)) better++;
    }
    expect(faults).toBe(98);
    expect([worse, better]).toEqual([3, 5]);
    expect(worse / faults).toBeLessThanOrEqual(0.05);
  });
});

describe('localisation from stored runs', () => {
  const spec = h7Specs[0] as Spec;
  const run = (repeat: number, failed: number[], over: Partial<RunResult> = {}): RunResult =>
    ({
      runId: `r${repeat}`,
      specId: spec.id,
      specHash: specHash(spec),
      target: { adapter: 'function', agent: 'acme-sales' },
      mode: 'F',
      repeat,
      blocks: spec.blocks.map((_, index) => ({ index, pass: !failed.includes(index) })),
      ...over,
    }) as unknown as RunResult;

  it('pools one suite run per repeat and leaves out other modes and other spec versions', () => {
    const result = localizeRuns(
      [spec],
      [
        run(0, [2]),
        run(1, []),
        run(2, [2], { mode: 'T', runId: 't' }),
        run(3, [2], { specHash: 'old', runId: 'old' }),
      ],
      registry,
      { mode: 'F' },
    );
    expect(result.suiteRuns).toBe(2);
    expect(result.skipped.map((each) => each.runId)).toEqual(['t', 'old']);
    expect(result.localization.sections[0]).toMatchObject({ section: 'recap', failed: 0.5 });
    expect(result.localization.global).toEqual(
      registry.sections.filter((s) => s.scope === 'global').map((s) => s.id),
    );
    expect(result.localization.global).toHaveLength(4);
    const ranked = new Set(result.localization.sections.map((each) => each.section));
    expect(result.localization.global.some((section) => ranked.has(section))).toBe(false);
  });

  it('leaves refuted links and other prompts out of a row', () => {
    const linkedSpec: Spec = {
      ...spec,
      metadata: {
        links: [
          {
            block: 'u1',
            to: { kind: 'prompt_section', prompt: 'acme-sales', section: 'recap' },
            status: 'refuted',
          },
          {
            block: 'u1',
            to: { kind: 'prompt_section', prompt: 'other', section: 'closing' },
            status: 'declared',
          },
          {
            block: 'u1',
            to: { kind: 'prompt_section', prompt: 'acme-sales', section: 'closing' },
            status: 'verified',
          },
        ],
      },
    };
    expect(localizeRows([linkedSpec], registry, 'F')[0]?.sections).toEqual(['closing']);
  });

  it('counts no row for a block with a not_run or blocked status, nor for an injected one', () => {
    const blocked = run(0, [2]);
    (blocked.blocks[3] as unknown as { status: string }).status = 'blocked';
    (blocked.blocks[4] as unknown as { injected: boolean }).injected = true;
    const result = localizeRuns([spec], [blocked], registry, { mode: 'F' });
    expect(result.localization.rows).toBe(3);
  });
});
