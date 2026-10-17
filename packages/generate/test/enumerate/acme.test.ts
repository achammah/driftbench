import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { type LoadedSpec, loadSpecs, type Spec } from '@agent-nexus/driftbench-core';
import {
  compileSpace,
  isForbidden,
  loadSpaceMap,
  coverage as spaceCoverage,
} from '@agent-nexus/driftbench-space';
import { beforeAll, describe, expect, it } from 'vitest';
import { type GenerateResult, generateSuite } from '../../src/enumerate/generate';
import { loadApprovedMap } from '../../src/enumerate/load';
import { worldCarried } from '../../src/seed/data-carrier';
import type { PreparedMap } from '../../src/seed/map';
import { buildTaskInputs } from '../../src/seed/tasks';
import { ACME, ACME_MAP, ACME_PROPOSAL, userTexts } from './support';

const GENERATED = `${ACME}generated`;

async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await files(full)));
    else out.push(full);
  }
  return out.sort();
}

describe('generate on the approved Acme map', () => {
  let prepared: PreparedMap;
  let result: GenerateResult;
  let handWritten: Spec[];

  beforeAll(async () => {
    const loaded = await loadApprovedMap(ACME_MAP);
    if (!loaded.ok) throw new Error(`${loaded.code}: ${loaded.message}`);
    prepared = loaded.prepared;
    const hand = await loadSpecs([`${ACME}specs`]);
    handWritten = hand.filter((entry): entry is LoadedSpec => entry.ok).map((entry) => entry.spec);
    // The price-sheet task family builds its instances first, as `driftbench generate` does (8 by default).
    const tasks = await buildTaskInputs(prepared, dirname(ACME_MAP), {
      n: 8,
      seed: 1,
      // As `driftbench generate` names it: the folder beside the spec, relative to the spec file.
      seedFrom: (id) => `./.seed-${id}`,
    });
    expect(tasks.refused).toEqual([]);
    // The committed suite is written at strength 2 (`--t 2`); the default is 3.
    result = generateSuite(prepared, {
      t: 2,
      mapPath: '../map/approved.yaml',
      baseline: { label: 'examples/acme/specs', specs: handWritten },
      tasks: tasks.inputs,
    });
  }, 180_000);

  it('reads the 51 approved dimensions, the 111 written constraints and those the relations imply, the 55 approved phrases and the relations', () => {
    expect(prepared.map.dimensions).toHaveLength(51);
    // 59 from the sources, 52 from the inventory (a behaviour belongs to its flows), and the pairs the
    // relations rule out (extract/derive.ts).
    const derived = prepared.map.constraints.filter((constraint) => constraint.reason.startsWith('derived'));
    expect(prepared.map.constraints.length - derived.length).toBe(111);
    expect(prepared.map.constraints).toHaveLength(463);
    expect(prepared.phrases).toHaveLength(55);
    expect(prepared.relations.paths).toHaveLength(12);
    expect(prepared.relations.usesTools).toHaveLength(14);
    expect(prepared.relations.binds.size).toBe(12);
    expect(prepared.relations.recoveries).toHaveLength(26);
    expect(prepared.relations.replyLanguage).toBe('EN');
    expect(prepared.tools.map((tool) => tool.name)).toEqual([
      'catalog.search',
      'coverage.check',
      'port.check',
      'order.create',
      'notify_sales',
    ]);
    // Every tool data dimension of the map is matched to its schema property, except the unknown-key
    // dimension of a closed input: it names no property.
    const toolDimensions = prepared.map.dimensions.filter(
      (dimension) => /\.(in|out)\./.test(dimension.id) && !dimension.id.endsWith('.unknown-key'),
    );
    expect(toolDimensions).toHaveLength(25);
    expect(prepared.toolDimensions.size).toBe(toolDimensions.length);
  });

  it('is byte for byte the suite committed in examples/acme/generated', async () => {
    const committed = (await files(GENERATED)).map((path) => relative(GENERATED, path));
    expect(committed).toEqual(result.files.map((file) => file.path).sort());
    for (const file of result.files) {
      // A workbook of a seed folder is compared by its bytes; every other file by its text.
      if (file.bytes)
        expect([...(await readFile(join(GENERATED, file.path)))], file.path).toEqual([...file.bytes]);
      else expect(await readFile(join(GENERATED, file.path), 'utf8'), file.path).toBe(file.text);
    }
  });

  it('walks the stage graph along the approved paths, and names the edges no path takes', () => {
    // 13 stages: the 11 of the conversations and the 2 of the price-sheet task, which no move reaches.
    expect(result.report.graph).toMatchObject({
      stages: 13,
      start: 'needs',
      edges: 23,
      covered: 18,
      paths: 12,
    });
    expect(result.report.graph.blocked).toEqual([
      'needs-to-offer',
      'address-to-details',
      'recap-to-recap',
      'recap-to-handover',
      'callback-to-offer',
    ]);
    expect(result.report.graph.unparsed).toEqual([]);
  });

  it('covers every allowed pair of the 5 conversation axes and applies every constraint', () => {
    const twise = result.report.twise;
    // workspace_start is a task setting: the task families write its values, never the covering array.
    expect(twise.dimensions).toEqual(['behaviour', 'deviation', 'channel', 'user_type', 'coverage_result']);
    expect(twise.covered).toBe(twise.allowed);
    // The pairs of the 5 axes that one path can hold together, after the written constraints and the ones
    // the relations imply (coverage_result has `none` for a path that states no coverage).
    expect(twise.allowed).toBe(356);
    // Every row of the array is one t-wise spec.
    expect(twise.rows).toBe(result.report.seeders.twise.specs);
    expect(result.report.constraints.applied).toBe(463);
    const space = compileSpace(prepared.map);
    for (const spec of result.all.filter(
      (entry) => (entry.metadata as { generated: { seeder: string } }).generated.seeder === 'twise',
    )) {
      const cell = (spec.metadata as { generated: { cell: Record<string, string> } }).generated.cell;
      const row = space.dimensions.map((dimension) => dimension.index.get(cell[dimension.id] ?? '') ?? -1);
      // The row and its details, every dimension but stage and transitions, against every constraint.
      expect(isForbidden(space, row), spec.id).toBe(false);
    }
  });

  it('writes valid specs only; the complete ones lint clean', () => {
    expect(result.report.invalid).toEqual([]);
    expect(result.report.lint).toEqual([]);
    expect(result.report.summary).toMatchObject({ complete: 437, incomplete: 75 });
  });

  it('never walks a spec on a path of a flow its behaviours do not belong to', () => {
    const flows = new Map((prepared.inventory?.flows ?? []).map((flow) => [flow.id, flow.behaviours ?? []]));
    for (const spec of result.complete) {
      const flow = (spec.tags ?? []).find((tag) => tag.startsWith('flow:'))?.slice('flow:'.length);
      if (!flow) continue;
      for (const behaviour of spec.covers ?? [])
        expect(flows.get(flow), `${spec.id} ${behaviour}`).toContain(behaviour);
    }
  });

  it('probes all 12 deviation classes, each user turn an approved phrase with its slots filled from the map', () => {
    expect(result.report.deviation.probes.map((probe) => probe.class)).toHaveLength(12);
    const bound = new Set<string>();
    for (const slots of prepared.relations.binds.values())
      for (const value of Object.values(slots)) bound.add(value);
    const templates = prepared.phrases.map((phrase) => {
      const parts = phrase.text
        .split(/\{[a-z][a-z0-9_]*\}/)
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      return new RegExp(`^${parts.join('(.+)')}$`);
    });
    // A task spec's instruction comes from its family's approved phrases, checked by the family.
    const filled = (text: string) =>
      templates
        .map((template) => template.exec(text))
        .some((found) => found?.slice(1).every((value) => bound.has(value)) === true);
    let supplied = 0;
    for (const spec of result.complete.filter((entry) => entry.kind !== 'task')) {
      const texts = userTexts(spec);
      // Some approved phrase matches, every slot it holds filled with a value the map binds.
      for (const text of texts.filter((entry) => entry !== ''))
        expect(filled(text), `${spec.id}: ${text}`).toBe(true);
      // A class carried in the world says nothing in its turn: its approved text is a supplied file.
      const silent = [
        ...spec.blocks
          .filter(
            (block) =>
              'injection' in block.when &&
              worldCarried(block.when.injection.class) &&
              block.when.injection.user === '',
          )
          .map((block) => block.given?.world),
        ...(spec.perturbations ?? [])
          .filter((entry) => worldCarried(entry.class) && entry.user === '')
          .map((entry) => entry.world),
      ];
      expect(texts.filter((entry) => entry === '')).toHaveLength(silent.length);
      for (const world of silent) {
        supplied += 1;
        expect(Object.values(world?.workspace?.files ?? {}).some(filled), spec.id).toBe(true);
      }
    }
    expect(supplied).toBeGreaterThan(0);
  });

  it('gives each metamorphic family one cell and one Then: only the phrasing differs', () => {
    const family = (spec: Spec) =>
      (spec.metadata as { generated: { metamorphic?: { family: string } } }).generated.metamorphic?.family;
    const groups = new Map<string, Spec[]>();
    // Phrasing families only: a context family varies a persona or a channel (its title says over).
    for (const spec of result.all.filter((entry) => !(entry.title ?? '').includes(' over '))) {
      const name = family(spec);
      if (name) groups.set(name, [...(groups.get(name) ?? []), spec]);
    }
    expect([...groups.keys()]).toHaveLength(7);
    const strip = (spec: Spec) => {
      const copy = JSON.parse(JSON.stringify(spec));
      copy.id = '';
      copy.title = '';
      copy.lang = '';
      delete copy.metadata.generated.metamorphic;
      for (const record of copy.metadata.generated.blocks) {
        record.phrase = null;
        record.cell = {};
      }
      for (const block of copy.blocks) {
        if (block.when.injection) block.when.injection.user = '';
        else block.when.user = '';
      }
      return JSON.stringify(copy);
    };
    for (const specs of groups.values()) {
      expect(specs.length).toBeGreaterThanOrEqual(2);
      expect(new Set(specs.map(strip)).size).toBe(1);
      expect(new Set(specs.flatMap(userTexts)).size).toBeGreaterThanOrEqual(specs.length);
    }
  });

  it('tags each spec that covers an inventory flow with flow:<id>, the way the core joins flows', () => {
    const flows = new Set((prepared.inventory?.flows ?? []).map((flow) => flow.id));
    for (const spec of result.all) {
      for (const id of spec.covers ?? []) {
        if (flows.has(id)) expect(spec.tags, spec.id).toContain(`flow:${id}`);
      }
    }
  });

  it('lists the values with no approved phrase: the tool schema values and the data cases no path says', () => {
    const placeholders = result.report.no_phrase.filter((gap) => gap.blocks > 0);
    const gaps = new Set(placeholders.map((gap) => gap.dimension));
    expect(gaps.has('stage_transition')).toBe(false);
    expect(gaps.has('coverage.check.out.found')).toBe(true);
    expect([...gaps].filter((dimension) => !/\.(in|out)\./.test(dimension)).sort()).toEqual([
      'callback_phone',
      'customer_details',
      'home_plans',
      'retry_outcome',
      'tool_answer',
    ]);
    expect(placeholders).toHaveLength(72);
  });

  it('lists the approved phrase of the flow no path walks, which no conversation can say', () => {
    expect(result.report.no_phrase.filter((gap) => gap.unsaid)).toEqual([
      {
        dimension: 'flow',
        value: 'price-sheet',
        blocks: 0,
        specs: [],
        unsaid: [
          {
            text: 'Build the price sheet from catalog.csv, one sheet per category.',
            reasons: ['no approved path walks the flow price-sheet'],
          },
        ],
      },
    ]);
  });

  it('gives every block of every complete spec a machine Then, derived from an approved path', () => {
    expect(result.complete).toHaveLength(437);
    // A task spec's Then comes from its family's oracle, not from a path: the task seeder is checked apart.
    for (const spec of result.complete.filter((entry) => entry.kind !== 'task')) {
      const generated = (spec.metadata as { generated: { path?: string } }).generated;
      expect(
        prepared.relations.paths.map((path) => path.id),
        spec.id,
      ).toContain(generated.path);
      spec.blocks.forEach((block, index) => {
        const machine =
          block.expect?.stage !== undefined ||
          (block.expect?.tools?.length ?? 0) > 0 ||
          (block.expect?.guards?.length ?? 0) > 0;
        expect(machine, `${spec.id} block ${index}`).toBe(true);
      });
    }
  });

  it('expects the reply language the map fixes, also after a message in another language', () => {
    let probes = 0;
    // A task spec states its language once, for the whole task.
    for (const spec of result.complete.filter((entry) => entry.kind !== 'task')) {
      for (const block of spec.blocks) {
        expect(block.expect?.lang, spec.id).toBe('EN');
        if ('injection' in block.when && block.when.injection.class === 'D5_language_switch') probes += 1;
      }
    }
    expect(probes).toBeGreaterThan(0);
  });

  it('expects a tool input only as the map binds it: the value the block itself states, or a stored id', () => {
    const bound = new Set<string>();
    for (const slots of prepared.relations.binds.values())
      for (const value of Object.values(slots)) bound.add(value);
    for (const phrase of prepared.phrases)
      for (const value of Object.values(phrase.binds ?? {})) bound.add(value);
    const literals = new Set(['mobile', 'home', 'new', 'upgrade', 'no_coverage', 'callback', 'order_failed']);
    const values = (assertion: unknown): string[] => {
      if (typeof assertion === 'string') return [assertion];
      if (assertion && typeof assertion === 'object') return Object.values(assertion).flatMap(values);
      return [];
    };
    for (const spec of result.complete) {
      for (const block of spec.blocks) {
        for (const tool of block.expect?.tools ?? []) {
          for (const value of Object.values(tool.input ?? {}).flatMap(values)) {
            expect(bound.has(value) || literals.has(value), `${spec.id} ${tool.label} ${value}`).toBe(true);
          }
        }
      }
    }
  });

  it('sends every spec the paths cannot build to incomplete/, with the reason', () => {
    for (const spec of result.all) {
      if (result.complete.includes(spec)) continue;
      const generated = (spec.metadata as { generated: Record<string, unknown> }).generated;
      const why = (generated.needs_then_why as string[] | undefined) ?? [];
      const phrase = (generated.needs_phrase as unknown[] | undefined) ?? [];
      expect(why.length + phrase.length, spec.id).toBeGreaterThan(0);
    }
    // The price-sheet task family starts from the catalog or from an existing workbook, one branch of its
    // relation each: an allowed pair holds every value of the map.
    expect(result.report.cover.unreachable).toEqual([]);
  });

  it('builds a scenario for each allowed pair the other seeders leave uncovered, and names why the rest cannot be', () => {
    const cover = result.report.cover;
    expect(cover.cells).toBe(8);
    expect(cover.covered).toBe(8);
    expect(cover.unbuilt).toEqual([]);
    // Approved policy guards now distinguish opening recoveries from idle replies.
    expect(result.report.coverage.complete.covered).toBe(708);
    expect(result.report.coverage.allowed - result.report.coverage.complete.covered).toBe(
      cover.unbuilt.length,
    );
    expect(result.report.coverage.allowed).toBe(708);
  });

  it('counts coverage on the axis map that extract map writes, as space coverage does', async () => {
    const written = await loadSpaceMap(`${ACME}map/space.yaml`);
    if (!written.ok) throw new Error('space.yaml is invalid');
    expect(prepared.axisMap.dimensions).toEqual(written.map.dimensions);
    expect(prepared.axisMap.constraints).toEqual(written.map.constraints);
    const coverage = result.report.coverage;
    // The hand-written baseline: 237 of the 708 pairs the map allows.
    expect(coverage.baseline).toMatchObject({ specs: 7, allowed: 708, covered: 237 });
    expect(coverage.complete.covered).toBeGreaterThan(2 * (coverage.baseline?.covered ?? 0));
    const generated = await loadSpecs([GENERATED]);
    const counted = spaceCoverage(written.map, generated, { t: 2 });
    expect(counted.grid.covered).toBe(coverage.all.covered);
    // Every tag and covers id names an axis value: nothing is unknown, every spec falls in a cell.
    expect(counted.warnings.map((warning) => warning.code)).toEqual([]);
  });

  it('refuses the unapproved proposal with the count', async () => {
    const loaded = await loadApprovedMap(ACME_PROPOSAL);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.code).toBe('MAP_NOT_APPROVED');
    expect(loaded.message).toContain('291 of 291 entries are not approved');
  });
});
