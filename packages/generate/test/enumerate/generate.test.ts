import { lintSpec, parseSpecText, type Spec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { generateSuite, INCOMPLETE_DIR, REPORT_FILE } from '../../src/enumerate/generate';
import { NO_THEN_CRITERION, PLACEHOLDER_CRITERION } from '../../src/seed/assemble';
import { prepareMap } from '../../src/seed/map';
import { userTexts, ZED_TOOLS, zedPrepared, zedProposal } from './support';

const run = (options: { seed?: number; t?: number; max?: number } = {}) =>
  generateSuite(zedPrepared(), { mapPath: '../map.yaml', t: 2, ...options });

type Generated = {
  generated: Record<string, unknown> & { blocks: Array<{ block: string; cell: Record<string, string> }> };
};

function meta(spec: Spec): Generated['generated'] {
  return (spec.metadata as Generated).generated;
}

function bySeeder(specs: Spec[], seeder: string): Spec[] {
  return specs.filter((spec) => meta(spec).seeder === seeder);
}

describe('generateSuite on a small fictional map', () => {
  const result = run();
  const specs = result.all;

  it('writes only specs the core loader accepts; complete ones lint clean, placeholder ones are flagged by lint', () => {
    expect(result.report.invalid).toEqual([]);
    expect(result.report.lint).toEqual([]);
    for (const file of result.files.filter((entry) => entry.path.endsWith('.yaml'))) {
      const loaded = parseSpecText(file.text, 'yaml', file.path);
      expect(loaded.ok, file.path).toBe(true);
      if (!loaded.ok) continue;
      if (file.path.startsWith(`${INCOMPLETE_DIR}/`)) {
        expect(loaded.warnings.map((warning) => warning.code)).toEqual(['CRITERION_UNRESOLVED']);
        expect(loaded.warnings[0]?.message).toMatch(
          new RegExp(`${PLACEHOLDER_CRITERION}|${NO_THEN_CRITERION}`),
        );
      } else {
        expect(lintSpec(loaded.spec), file.path).toEqual([]);
      }
    }
  });

  it('reports zero cut blocks for every seeder when no walk is shortened', () => {
    let cuts = 0;
    for (const [seeder, totals] of Object.entries(result.report.seeders)) {
      const recorded = bySeeder(specs, seeder).reduce((sum, spec) => {
        const reduction = meta(spec).reduced_ends as { duplicates: unknown[] } | undefined;
        return sum + (reduction?.duplicates.length ?? 0);
      }, 0);
      expect(totals).toHaveProperty('cut_blocks', recorded);
      cuts += recorded;
    }
    expect(cuts).toBe(0);
  });

  it('sends only approved phrases or named placeholders, never other text', () => {
    const prepared = zedPrepared();
    const approved = new Set(prepared.phrases.map((phrase) => phrase.text));
    for (const spec of specs) {
      for (const text of userTexts(spec)) {
        const placeholder = /^\[no approved phrase for [^=\]]+=[^\]]+\]$/.test(text);
        expect(approved.has(text) || placeholder, `${spec.id}: ${text}`).toBe(true);
      }
    }
    // The bank holds one unapproved phrase; it never reaches a spec.
    expect(specs.flatMap(userTexts)).not.toContain('Sent from my mail.');
  });

  it('graph: every block expects the stage its transition reaches; every reachable edge is walked', () => {
    const graph = bySeeder(specs, 'graph');
    expect(graph.length).toBeGreaterThan(0);
    for (const spec of graph) {
      const records = meta(spec).blocks;
      spec.blocks.forEach((block, index) => {
        const transition = records[index]?.cell.stage_transition ?? '';
        expect(block.expect?.stage).toBe(transition.split('-to-')[1]);
      });
    }
    expect(result.report.graph).toMatchObject({
      start: 'greet',
      edges: 5,
      covered: 4,
      unreachable: ['lost-to-help'],
      blocked: [],
      unparsed: ['greet-to-nowhere'],
    });
  });

  it('t-wise: the rows cover every allowed pair and never hold a forbidden combination', () => {
    expect(result.report.twise.covered).toBe(result.report.twise.allowed);
    expect(result.report.twise.share).toBe(1);
    // The axes but stage: the details are chosen inside each row's cell, never crossed.
    expect(result.report.twise.dimensions).toEqual(['flow', 'deviation', 'channel', 'user']);
    for (const spec of bySeeder(specs, 'twise')) {
      const cell = meta(spec).cell as Record<string, string>;
      expect(cell.flow === 'card' && cell.channel === 'email', spec.id).toBe(false);
      // Each row's cell holds a value of every detail but the stage graph's.
      expect(cell['lookup.in.account'], spec.id).toBeDefined();
      expect(cell['lookup.out.found'], spec.id).toBeDefined();
      expect(cell.stage_transition, spec.id).toBeUndefined();
    }
    // By hand: flow 2, deviation 4 (none added), channel 2, user 2 values. Pairs: the 3 subsets with
    // deviation give 8 each (24), the 3 others 4 each (12): 36, less flow=card with channel=email: 35.
    expect(result.report.twise.allowed).toBe(35);
  });

  it('places axis values only: details stay in the record and the Given, never in tags or covers', () => {
    const prepared = zedPrepared();
    const axisValues = new Set(
      prepared.axisMap.dimensions.flatMap((dimension) => dimension.values.map((value) => value.id)),
    );
    for (const spec of specs) {
      for (const tag of spec.tags ?? []) {
        if (tag.startsWith('flow:')) continue;
        expect(axisValues.has(tag.slice(tag.indexOf(':') + 1)), `${spec.id} ${tag}`).toBe(true);
      }
      for (const id of spec.covers ?? []) expect(axisValues.has(id), `${spec.id} ${id}`).toBe(true);
    }
    expect(prepared.axisMap.dimensions.map((dimension) => dimension.id)).toEqual([
      'stage',
      'flow',
      'deviation',
      'channel',
      'user',
    ]);
  });

  it('t-wise: the Given carries the tool answer the cell states', () => {
    for (const spec of bySeeder(specs, 'twise')) {
      const cell = meta(spec).cell as Record<string, string>;
      const answer = spec.given?.world?.tools?.lookup?.result as { found: boolean };
      expect(answer.found).toBe(cell['lookup.out.found'] === 'lookup.out.found.true');
    }
  });

  it('deviation: one probe per class, a detour expects the stage it was injected at', () => {
    const probes = bySeeder(specs, 'deviation');
    expect(probes.map((spec) => meta(spec).cell)).toHaveLength(3);
    expect(result.report.deviation.probes.map((probe) => probe.class)).toEqual([
      'D1_off_topic',
      'D5_language_switch',
      'D8_tool_failure',
    ]);
    for (const spec of probes) {
      const index = spec.blocks.findIndex((block) => 'injection' in block.when);
      if (index < 0) continue;
      const arrival = index === 0 ? 'greet' : spec.blocks[index - 1]?.expect?.stage;
      expect(spec.blocks[index]?.expect?.stage, spec.id).toBe(arrival);
    }
    const language = probes.find((spec) =>
      spec.blocks.some(
        (block) => 'injection' in block.when && block.when.injection.class === 'D5_language_switch',
      ),
    );
    expect(language?.blocks.at(-1)?.expect?.lang).toBe('EN');
  });

  it('deviation: a tool failure with no phrase is a perturbation that fails a tool and allows one retry', () => {
    const failure = bySeeder(specs, 'deviation').find(
      (spec) => spec.perturbations?.[0]?.class === 'D8_tool_failure',
    );
    const perturbation = failure?.perturbations?.[0];
    expect(perturbation?.world?.tools?.lookup?.error).toBeDefined();
    expect(perturbation?.expect?.tools).toEqual([{ label: 'lookup', count: { max: 2 } }]);
    expect(perturbation?.recovery).toEqual({ within_blocks: 1 });
    // It goes in after the route to its stage, before a phrased turn that leaves that stage.
    const probe = result.report.deviation.probes.find((entry) => entry.class === 'D8_tool_failure');
    const at = perturbation?.inject_at ?? -1;
    const arrival = at === 0 ? 'greet' : failure?.blocks[at - 1]?.expect?.stage;
    expect(probe?.stage).toBe(arrival);
    expect(failure?.blocks[at]).toBeDefined();
    expect(userTexts(failure as Spec)[at]).not.toMatch(/^\[no approved phrase/);
  });

  it('boundary: an output value is the tool answer and expects the call; an invalid input forbids it', () => {
    const boundary = bySeeder(specs, 'boundary');
    const of = (value: string) => boundary.find((spec) => spec.title?.startsWith(`Boundary value ${value}:`));
    expect(of('lookup.in.account.below-min-length')?.blocks[0]?.expect?.tools).toEqual([
      { label: 'lookup', count: 0 },
    ]);
    expect(of('lookup.in.account.at-min-length')?.blocks[0]?.expect?.tools).toEqual([
      // One run of the tool, its only argument named, so the input is closed.
      { label: 'lookup', count: 1, input: { account: { regex: '^[\\s\\S]{1}$' } }, input_closed: true },
    ]);
    const notFound = of('lookup.out.found.false');
    expect(notFound?.given?.world?.tools?.lookup?.result).toEqual({ found: false });
    expect(notFound?.blocks[0]?.expect?.tools).toEqual([{ label: 'lookup', count: 1 }]);
    expect((meta(notFound as Spec).concrete as Record<string, unknown>)['lookup.out.found.false']).toBe(
      false,
    );
  });

  it('metamorphic: a family differs only in the phrasing of one value, with the same Then', () => {
    const family = bySeeder(specs, 'metamorphic');
    expect(family.map((spec) => spec.id)).toEqual(['gen-metamorphic-001-1', 'gen-metamorphic-001-2']);
    const strip = (spec: Spec) => {
      const copy = JSON.parse(JSON.stringify(spec)) as Spec & Record<string, unknown>;
      copy.id = '';
      copy.title = '';
      const record = (copy.metadata as Generated).generated;
      record.metamorphic = undefined;
      record.blocks = record.blocks.map((entry) => ({ ...entry, phrase: null }));
      copy.blocks = copy.blocks.map((block) => ({ ...block, when: { user: '' } }));
      return JSON.stringify(copy);
    };
    expect(strip(family[0] as Spec)).toBe(strip(family[1] as Spec));
    expect(family.map((spec) => userTexts(spec)[0])).toEqual(['I lost my card.', 'My card is gone.']);
    expect(result.report.metamorphic.values).toEqual(['flow=card']);
  });

  it('records the seeder, the seed, the map version and hash, and every block cell', () => {
    const prepared = zedPrepared();
    for (const spec of specs) {
      const record = meta(spec);
      expect(record.seed).toBe(1);
      expect(record.map).toEqual({ path: '../map.yaml', agent: 'zed', version: '1', hash: prepared.hash });
      expect(spec.version).toBe(prepared.hash);
      expect(record.blocks.map((entry) => entry.block)).toEqual(spec.blocks.map((block) => block.id));
      for (const entry of record.blocks) expect(entry.cell.spec).toBe('metadata.generated.cell');
    }
  });

  it('gives byte-identical files for the same map and seed, and other rows for another seed', () => {
    const again = run();
    expect(again.files).toEqual(result.files);
    const other = run({ seed: 2 });
    const twise = (files: typeof result.files) =>
      files.filter((file) => file.path.includes('/twise/')).map((file) => file.text);
    expect(twise(other.files)).not.toEqual(twise(result.files));
  });

  it('reports blocks per seeder, the covering array, edges, gaps and constraints', () => {
    const report = result.report;
    const seeders = Object.values(report.seeders);
    expect(report.summary.specs).toBe(seeders.reduce((sum, entry) => sum + entry.specs, 0));
    expect(report.summary.blocks).toBe(seeders.reduce((sum, entry) => sum + entry.blocks, 0));
    expect(report.summary.specs).toBe(specs.length);
    expect(result.files.filter((file) => file.path.endsWith('.yaml'))).toHaveLength(specs.length);
    expect(result.files.at(-1)?.path).toBe(REPORT_FILE);
    expect(report.constraints.applied).toBe(2);
    expect(report.no_phrase.map((gap) => `${gap.dimension}=${gap.value}`)).toEqual(
      expect.arrayContaining([
        'stage_transition=verify-to-verify',
        'lookup.out.found=lookup.out.found.false',
      ]),
    );
    const parsed = JSON.parse(result.files.at(-1)?.text ?? '{}');
    expect(parsed).toEqual(JSON.parse(JSON.stringify(report)));
    expect(report.coverage.all.covered).toBeGreaterThanOrEqual(report.coverage.complete.covered);
  });

  it('cuts each seeder at --max and says so', () => {
    const cut = run({ max: 2 });
    expect(cut.report.twise.rows).toBe(2);
    expect(cut.report.seeders.twise.cut).toBe(true);
    expect(cut.report.seeders.boundary.specs).toBe(2);
    expect(cut.report.seeders.boundary.cut).toBe(true);
    expect(run().report.seeders.twise.cut).toBe(false);
  });

  it('marks a block the map supports no Then for, and keeps it out of the complete specs', () => {
    // No behaviour dimension and no tool: a t-wise row without a deviation has nothing to check.
    const proposal = zedProposal();
    proposal.dimensions = proposal.dimensions.filter((dimension) =>
      ['deviation', 'channel', 'user'].includes(dimension.id),
    );
    proposal.constraints = [];
    const lean = generateSuite(prepareMap(proposal, { tools: [] }), { mapPath: '../map.yaml' });
    expect(lean.report.no_then.length).toBeGreaterThan(0);
    for (const entry of lean.report.no_then) {
      const file = lean.files.find((candidate) => candidate.path.endsWith(`/${entry.spec}.yaml`));
      expect(file?.path.startsWith(`${INCOMPLETE_DIR}/`)).toBe(true);
      const loaded = parseSpecText(file?.text ?? '', 'yaml');
      expect(loaded.ok && loaded.warnings[0]?.message).toContain(NO_THEN_CRITERION);
    }
    expect(lean.report.lint).toEqual([]);
    expect(lean.report.summary.incomplete).toBeGreaterThanOrEqual(lean.report.no_then.length);
    expect(
      lean.complete.every((spec) => spec.blocks.every((block) => Object.keys(block.expect ?? {}).length > 0)),
    ).toBe(true);
  });

  it('deviation: a probe is injected only at a stage the constraints allow for its class', () => {
    const proposal = zedProposal();
    const evidence = { source: 'prompt.md', quote: 'Stages, in order: greet, verify, help.' };
    for (const stage of ['greet', 'verify']) {
      proposal.constraints.push({
        forbid: { deviation: 'D1_off_topic', stage },
        reason: 'test',
        evidence,
        produced_by: 'model',
        approved: true,
      });
    }
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const constrained = generateSuite(prepareMap(proposal, { tools: ZED_TOOLS }), {
        mapPath: '../map.yaml',
        seed,
      });
      const probe = constrained.report.deviation.probes.find((entry) => entry.class === 'D1_off_topic');
      expect(probe?.stage, `seed ${seed}`).toBe('help');
    }
  });

  it('writes YAML that reads back to the same spec', () => {
    const file = result.files.find((entry) => entry.path.includes('/twise/'));
    const raw = parseYaml(file?.text ?? '') as { id: string };
    expect(raw.id).toBe('gen-twise-001');
    expect(
      file?.text.startsWith('# Generated by driftbench generate (seeder twise, seed 1) from ../map.yaml'),
    ).toBe(true);
  });
});

describe('pilot iteration 2: the default strength of the covering array', () => {
  it('is 3, so the t-wise rows cover every allowed triple of the axes', () => {
    const result = generateSuite(zedPrepared(), { mapPath: '../map.yaml' });
    expect(result.report.twise.t).toBe(3);
    expect(result.report.twise.share).toBe(1);
  });
});

describe('iteration 17: the report states the coverage and diversity measures', () => {
  it('states every measure of the complete suite, and four of each seeder', () => {
    const { report, complete } = run();
    const measures = (report.coverage as unknown as { measures?: Record<string, number> }).measures;
    for (const name of [
      'discovery',
      'chao_coverage',
      'chao1',
      'hill_q0',
      'hill_q1',
      'hill_q2',
      'pielou',
      't3_share',
      't3_allowed',
      'weighted_share',
      'effective_sample_size',
      'required_covered',
      'required_total',
      'machine_then_share',
      'judged_only_blocks',
    ]) {
      expect(typeof measures?.[name], name).toBe('number');
    }
    expect(measures?.judged_only_blocks).toBeLessThanOrEqual(complete.flatMap((spec) => spec.blocks).length);
    const graph = (report.seeders.graph as unknown as { measures?: Record<string, number> }).measures;
    for (const name of ['machine_then_share', 'judged_only_blocks', 'hill_q0', 'pielou']) {
      expect(typeof graph?.[name], `graph ${name}`).toBe('number');
    }
  });
});

describe('iteration 21: the cells a spec reaches come from one projection of the grid', () => {
  it('counts the cells as the space package does, for the empty suite and for the generated one', async () => {
    const { coverage } = await import('@agent-nexus/driftbench-space');
    const { cellsOf } = await import('../../src/enumerate/generate');
    const prepared = zedPrepared();
    const { complete } = generateSuite(prepared, { mapPath: '../map.yaml', t: 2 });
    for (const specs of [[], complete, complete.slice(0, 3)]) {
      const results = specs.map((spec) => ({
        ok: true as const,
        path: spec.id,
        spec,
        hash: '',
        warnings: [],
      }));
      const expected = coverage(prepared.axisMap, results, { t: 2 }).grid.cells.map((cell) => ({
        values: { ...cell.values },
        count: cell.count,
      }));
      expect(cellsOf(prepared, specs, 2)).toEqual(expected);
    }
  });
});

describe('iteration 22: a spec is validated as built, not parsed back from its text', () => {
  it('holds the spec a reader gets from the written file, with the same hash and warnings', () => {
    const { files, all } = run();
    const byId = new Map(all.map((spec) => [spec.id, spec]));
    let compared = 0;
    for (const file of files) {
      if (!file.path.endsWith('.yaml')) continue;
      const loaded = parseSpecText(file.text, 'yaml', file.path);
      if (!loaded.ok) throw new Error(`${file.path} does not load`);
      expect(byId.get(loaded.spec.id), file.path).toEqual(loaded.spec);
      compared += 1;
    }
    expect(compared).toBe(all.length);
  });
});

describe('iteration 23: the coverage share is read from the cached grid', () => {
  it('states the allowed, covered and share the space package counts', async () => {
    const { coverage } = await import('@agent-nexus/driftbench-space');
    const { measuredCoverage } = await import('../../src/enumerate/generate');
    const prepared = zedPrepared();
    const { complete } = generateSuite(prepared, { mapPath: '../map.yaml', t: 2 });
    for (const t of [2, 3]) {
      for (const specs of [[], complete, complete.slice(0, 2)]) {
        const results = specs.map((spec) => ({
          ok: true as const,
          path: spec.id,
          spec,
          hash: '',
          warnings: [],
        }));
        const grid = coverage(prepared.axisMap, results, {
          t: Math.min(t, prepared.axisMap.dimensions.length),
        }).grid;
        expect(measuredCoverage(prepared, [...specs], t)).toEqual({
          t: grid.t,
          specs: specs.length,
          allowed: grid.allowed,
          covered: grid.covered,
          share: grid.share,
        });
      }
    }
  });
});

describe('generateSuite with task specs whose workspace holds a binary file', () => {
  it('writes the workspace beside the spec, in the folder its workspace_seed names, the bytes unchanged', () => {
    const bytes = new Uint8Array([0x50, 0x4b, 3, 4, 0, 255]);
    const spec = {
      id: 'fam-i01-base',
      version: '1',
      kind: 'task',
      title: 'A task',
      tier: 'generated',
      tags: ['flow:x'],
      target: { adapter: 'process', agent: 'ops' },
      workspace_seed: { from: 'out/specs/task/.seed-fam-i01-base' },
      blocks: [{ id: 'b', user: 'Do the task.', expect: { execution: { ran_code: true } } }],
    };
    const relation = {
      kind: 'task_family' as const,
      flow: 'x',
      family: '../families/fam',
      stages: ['s'],
      evidence: { source: 'prompt.md', quote: 'Stages, in order: greet, verify, help.' },
      produced_by: 'model' as const,
      approved: true,
    };
    const result = generateSuite(zedPrepared(), {
      mapPath: '../map.yaml',
      t: 2,
      tasks: [
        {
          relation,
          variants: [{ spec, seed: { text: { 'items.csv': 'a,b\n' }, binary: { 'out/book.xlsx': bytes } } }],
        },
      ],
    });
    expect(result.report.invalid).toEqual([]);
    const seedFiles = result.files.filter((file) => file.path.startsWith('specs/task/.seed-fam-i01-base/'));
    expect(seedFiles.map((file) => file.path).sort()).toEqual([
      'specs/task/.seed-fam-i01-base/items.csv',
      'specs/task/.seed-fam-i01-base/out/book.xlsx',
    ]);
    expect(seedFiles.find((file) => file.path.endsWith('items.csv'))?.text).toBe('a,b\n');
    expect([...(seedFiles.find((file) => file.path.endsWith('.xlsx'))?.bytes ?? [])]).toEqual([...bytes]);
    expect(result.files.some((file) => file.path === 'specs/task/fam-i01-base.yaml')).toBe(true);
  });
});

describe('the measures of the report are the same bytes on every machine', () => {
  it('keeps a measure that goes through a logarithm or an exponential to twelve decimals', () => {
    const { report } = run();
    const coverage = (report.coverage as unknown as { measures: Record<string, number> }).measures;
    const seeders = Object.values(report.seeders).map(
      (seeder) => (seeder as unknown as { measures?: Record<string, number> }).measures ?? {},
    );
    const values = [coverage.hill_q1, coverage.pielou, ...seeders.map((measures) => measures.pielou)].filter(
      (value): value is number => typeof value === 'number',
    );
    expect(values.length).toBeGreaterThan(2);
    for (const value of values) expect(Math.round(value * 1e12) / 1e12).toBe(value);
    // Not every value is a whole number or a short fraction: the rounding is what holds them.
    expect(values.some((value) => !Number.isInteger(value))).toBe(true);
  });
});
