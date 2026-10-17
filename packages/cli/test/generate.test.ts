import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { loadSpecs, runSpec } from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { type Io, main } from '../src/index';

const ACME = fileURLToPath(new URL('../../../examples/acme/', import.meta.url));

async function run(argv: string[], cwd: string) {
  const output = { out: '', err: '' };
  const io: Io = {
    out: (text) => {
      output.out += text;
    },
    err: (text) => {
      output.err += text;
    },
    cwd,
  };
  const code = await main(argv, io);
  return { code, ...output };
}

async function tree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (at: string) => {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const full = join(at, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out[relative(dir, full)] = await readFile(full, 'utf8');
    }
  };
  await walk(dir);
  return out;
}

const PROMPT = 'You are the Zed Bank assistant. Stages, in order: greet, help, done.\n';
const EVIDENCE = '{ source: prompt.md, quote: "Stages, in order: greet, help, done." }';
const CODE = 'produced_by: code';

/**
 * A map every value of which has an approved phrase, and one approved path with a recovery from its one
 * deviation class: the generator has nothing to leave as a placeholder or without a machine Then.
 */
const PHRASED_MAP = `version: 1
agent: zed
produced_by: { family: lane, model: by hand, at: 2026-10-11T00:00:00.000Z }
sources:
  - { kind: prompt, path: prompt.md }
dimensions:
  - id: stage
    title: Stages
    kind: stage
    role: axis
    ${CODE}
    approved: true
    values:
      - { id: greet, title: The assistant greets, evidence: ${EVIDENCE}, ${CODE} }
      - { id: help, title: The assistant helps, evidence: ${EVIDENCE}, ${CODE} }
      - { id: done, title: The assistant is done, evidence: ${EVIDENCE}, ${CODE} }
  - id: stage_transition
    title: Transitions
    kind: behaviour
    role: detail
    ${CODE}
    approved: true
    values:
      - { id: greet-to-help, title: The user asks for help, evidence: ${EVIDENCE}, ${CODE} }
      - { id: help-to-done, title: The user is done, evidence: ${EVIDENCE}, ${CODE} }
  - id: flow
    title: Flows
    kind: behaviour
    role: axis
    ${CODE}
    approved: true
    values:
      - { id: balance, title: The customer asks for their balance, evidence: ${EVIDENCE}, ${CODE} }
  - id: deviation
    title: Deviations
    kind: deviation
    role: axis
    ${CODE}
    approved: true
    values:
      - { id: D1_off_topic, title: An off-topic question, evidence: ${EVIDENCE}, ${CODE} }
  - id: channel
    title: Channels
    kind: channel
    role: axis
    ${CODE}
    approved: true
    values:
      - { id: chat, title: The chat, evidence: ${EVIDENCE}, ${CODE} }
constraints: []
phrases:
  - { dimension: stage_transition, value: greet-to-help, text: I need help with my account., lang: en, produced_by: model, approved: true }
  - { dimension: stage_transition, value: help-to-done, text: That is all., lang: en, produced_by: model, approved: true }
  - { dimension: deviation, value: D1_off_topic, text: Are you open on Sunday?, lang: en, produced_by: model, approved: true }
  - { dimension: channel, value: chat, text: Hello from the chat., lang: en, produced_by: model, approved: true }
  - { dimension: flow, value: balance, text: What is my balance?, lang: en, produced_by: model, approved: true }
relations:
  - { kind: path, id: balance-help, flow: balance, stages: [greet, help, done], evidence: ${EVIDENCE}, produced_by: model, approved: true }
  - { kind: recovery, class: D1_off_topic, flows: [balance], stage_after: pending, evidence: ${EVIDENCE}, produced_by: model, approved: true }
`;

describe('driftbench generate', () => {
  it('builds --tasks instances per task_family relation the map names', async () => {
    // Each relation gets --tasks instances; an instance writes one spec per variant (base, corners, planted),
    // so the spec count is not a multiple of --tasks. Count the instances, read from the specs themselves.
    const map = parseYaml(await readFile(`${ACME}map/approved.yaml`, 'utf8')) as {
      relations: Array<{ kind: string }>;
    };
    const relations = map.relations.filter((relation) => relation.kind === 'task_family').length;
    expect(relations).toBeGreaterThan(0);
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-generate-tasks-'));
    const instances = async (tasks: string) => {
      const result = await run(
        ['generate', '--map', `${ACME}map/approved.yaml`, '--out', `t${tasks}`, '--t', '2', '--tasks', tasks],
        dir,
      );
      expect(result.code).toBe(1);
      const loaded = await loadSpecs([join(dir, `t${tasks}`, 'specs', 'task')]);
      const seen = new Set<string>();
      for (const spec of loaded) {
        if (!spec.ok) throw new Error(`invalid task spec ${spec.path}`);
        const family = spec.spec.metadata?.family as { id?: string; instance?: string } | undefined;
        expect(family?.instance, spec.path).toBeDefined();
        seen.add(`${family?.id}#${family?.instance}`);
      }
      return seen.size;
    };
    expect(await instances('1')).toBe(relations);
    expect(await instances('2')).toBe(2 * relations);
  }, 120_000);

  it('writes the Acme suite, refuses to overwrite it, and writes it again byte for byte with --force', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-generate-'));
    const first = await run(['generate', '--map', `${ACME}map/approved.yaml`, '--out', 'a', '--t', '2'], dir);
    // Exit 1: the suite is written, and blocks whose value has no approved phrase are placeholders.
    expect(first.code).toBe(1);
    expect(first.out.split('\n')[0]).toMatch(/^Actual axis-map coverage .*pairs 708 of 708 \(100\.0%\)/);
    expect(first.out.split('\n')[1]).toContain('Candidate t-wise array');
    expect(first.out).toContain('Stage graph: 18 of 23 edges covered in 12 paths from needs.');
    expect(first.out).toContain(
      'Candidate t-wise array (before the total cap): covering array of 156 rows over 5 dimensions',
    );
    expect(first.out).toContain('Constraints applied: 463.');
    expect(first.out).toContain(
      '  Most frequent reasons:\n     3  it needs user_type in existing-customer; the cell holds new-customer',
    );
    const before = await tree(join(dir, 'a'));
    expect(Object.keys(before)).toContain('generate-report.json');
    // The spec files of specs/; the workbook seed folders (`.seed-<id>/`) sit beside them.
    expect(
      Object.keys(before).filter((path) => path.startsWith('specs/') && !path.includes('/.seed-')),
    ).toHaveLength(437);

    const refused = await run(
      ['generate', '--map', `${ACME}map/approved.yaml`, '--out', 'a', '--t', '2'],
      dir,
    );
    expect(refused.code).toBe(2);
    expect(refused.err).toContain('Pass --force');

    const again = await run(
      ['generate', '--map', `${ACME}map/approved.yaml`, '--out', 'a', '--force', '--t', '2'],
      dir,
    );
    expect(again.code).toBe(1);
    expect(await tree(join(dir, 'a'))).toEqual(before);

    const elsewhere = await run(
      ['generate', '--map', `${ACME}map/approved.yaml`, '--out', 'b/c', '--t', '2'],
      dir,
    );
    expect(elsewhere.code).toBe(1);
    const moved = await tree(join(dir, 'b/c'));
    // Only the recorded map path differs: it is relative to the output folder. A workbook task names its seed
    // folder relative to its own spec file, so that path is the same wherever the suite is written.
    const strip = (files: Record<string, string>) =>
      Object.fromEntries(
        Object.entries(files).map(([path, text]) => [path, text.replaceAll(/(\.\.\/)+/g, '')]),
      );
    expect(strip(moved)).toEqual(strip(before));
  }, 120_000);

  it('writes a capped suite and keeps --budget a row budget', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-spec-cap-'));
    await writeFile(join(dir, 'prompt.md'), PROMPT);
    await writeFile(join(dir, 'map.yaml'), PHRASED_MAP);
    const result = await run(
      [
        'generate',
        '--map',
        'map.yaml',
        '--out',
        'capped',
        '--budget',
        '5',
        '--spec-cap',
        '100',
        '--spec-cap-mode',
        'pairs',
        '--json',
      ],
      dir,
    );
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    const report = JSON.parse(result.out);
    const files = await tree(join(dir, 'capped'));
    const yaml = Object.keys(files).filter((path) => path.endsWith('.yaml'));
    expect(report.options.budget).toBe(5);
    expect(report.budget.budget).toBe(5);
    expect(report.spec_cap.mode).toBe('pairs');
    expect(report.spec_cap.preserved).toBe(true);
    expect(yaml.length).toBe(report.summary.specs);
    expect(yaml.length).toBeLessThanOrEqual(100);
    expect(JSON.parse(files['generate-report.json'] ?? '')).toEqual(report);
    for (const args of [
      ['--spec-cap', '0'],
      ['--spec-cap-mode', 'pairs'],
      ['--spec-cap', '100', '--spec-cap-mode', 'wrong'],
    ]) {
      const refused = await run(['generate', '--map', 'map.yaml', '--out', 'invalid', ...args], dir);
      expect(refused.code).toBe(2);
      expect(refused.err).toMatch(/spec-cap/);
    }
  });

  it('refuses a map with unapproved entries, naming the count', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-generate-'));
    const result = await run(['generate', '--map', `${ACME}map/proposal.yaml`, '--out', 'out'], dir);
    expect(result.code).toBe(2);
    expect(result.err).toContain('MAP_NOT_APPROVED');
    expect(result.err).toContain('291 of 291 entries are not approved');
    expect(await readdir(dir)).toEqual([]);
  });

  it('refuses a missing map and bad numbers', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-generate-'));
    expect((await run(['generate', '--map', 'nowhere.yaml', '--out', 'out'], dir)).code).toBe(2);
    const t = await run(['generate', '--map', `${ACME}map/approved.yaml`, '--out', 'out', '--t', '0'], dir);
    expect(t.code).toBe(2);
    expect(t.err).toContain('--t must be a whole number of at least 1');
    const seed = await run(
      ['generate', '--map', `${ACME}map/approved.yaml`, '--out', 'out', '--seed', 'x'],
      dir,
    );
    expect(seed.code).toBe(2);
  });

  it('exits 0 when every block has an approved phrase, and measures a baseline on the same map', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-generate-'));
    await writeFile(join(dir, 'prompt.md'), PROMPT);
    await writeFile(join(dir, 'map.yaml'), PHRASED_MAP);
    const result = await run(['generate', '--map', 'map.yaml', '--out', 'out', '--json'], dir);
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    const report = JSON.parse(result.out);
    expect(report.summary.incomplete).toBe(0);
    expect(report.graph).toMatchObject({ edges: 2, covered: 2 });
    expect(report.twise.rows).toBe(2);
    const files = await tree(join(dir, 'out'));
    expect(Object.keys(files).some((path) => path.startsWith('incomplete/'))).toBe(false);

    const baseline = await run(
      ['generate', '--map', 'map.yaml', '--out', 'again', '--json', '--baseline', 'out/specs'],
      dir,
    );
    expect(baseline.code).toBe(0);
    const measured = JSON.parse(baseline.out).coverage;
    expect(measured.baseline.label).toBe('out/specs');
    expect(measured.baseline.covered).toBe(measured.complete.covered);
  });

  it('exits 0 below full pair coverage in budget mode and reports the uncovered pairs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-generate-'));
    await writeFile(join(dir, 'prompt.md'), PROMPT);
    const map = PHRASED_MAP.replace(
      `constraints: []`,
      `      - { id: voice, title: Voice, evidence: ${EVIDENCE}, ${CODE} }\nconstraints: []`,
    ).replace(
      `relations:\n`,
      `  - { dimension: channel, value: voice, text: Hello from the voice channel., lang: en, produced_by: model, approved: true }\nrelations:\n`,
    );
    await writeFile(join(dir, 'map.yaml'), map);
    const result = await run(['generate', '--map', 'map.yaml', '--out', 'out', '--budget', '1'], dir);
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    expect(result.out).toContain('pairs covered 3 of 8');
    const report = JSON.parse(await readFile(join(dir, 'out/generate-report.json'), 'utf8'));
    expect(report.budget.picked).toBe(1);
    expect(report.seeders.twise.cut).toBe(false);
    expect(report.budget.pairs).toMatchObject({ covered: 3, allowed: 8 });
  });

  it('refuses invalid budgets before writing output', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-generate-'));
    for (const budget of ['0', '-1', '1.5', 'NaN']) {
      const result = await run(
        ['generate', '--map', `${ACME}map/approved.yaml`, '--out', 'out', '--budget', budget],
        dir,
      );
      expect(result.code).toBe(2);
      expect(result.err).toContain('--budget must be a whole number of at least 1');
    }
    expect(await readdir(dir)).toEqual([]);
  });

  it('samples numeric runtime vars globally and within categorical rows, and delivers them to the adapter', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-generate-'));
    const quote = 'temperature ranges from 0 to 1; iterations range from 1 to 5 integer attempts.';
    await writeFile(join(dir, 'prompt.md'), `${PROMPT}${quote}\n`);
    await writeFile(
      join(dir, 'map.yaml'),
      `${PHRASED_MAP}\nnumeric_settings:\n` +
        `  - { id: temperature, min: 0, max: 1, evidence: { source: prompt.md, quote: "${quote}" }, produced_by: code, approved: true }\n` +
        `  - { id: iterations, min: 1, max: 5, integer: true, unit: attempts, evidence: { source: prompt.md, quote: "${quote}" }, produced_by: code, approved: true }\n`,
    );
    const result = await run(
      ['generate', '--map', 'map.yaml', '--out', 'out', '--budget', '20', '--t', '2', '--json'],
      dir,
    );
    expect(result.code).toBe(0);
    expect(result.err).toBe('');
    const report = JSON.parse(result.out);
    expect(report.budget.pool).toBeLessThan(20);
    expect(report.budget.picked).toBe(20);
    expect(report.budget.capped).toBe(false);
    const numeric = report.budget.numeric as {
      settings: Array<{ id: string; unit?: string }>;
      rows: Array<{
        spec: string;
        cell: Record<string, string>;
        vars: Record<string, number>;
        quantiles: Record<string, number>;
      }>;
    };
    expect(numeric.settings.find((setting) => setting.id === 'iterations')?.unit).toBe('attempts');
    const groups = new Map<string, typeof numeric.rows>();
    for (const row of numeric.rows) {
      const key = JSON.stringify(row.cell);
      groups.set(key, [...(groups.get(key) ?? []), row]);
      expect(Number.isInteger(row.vars.iterations)).toBe(true);
      expect(row.vars.iterations).toBeGreaterThanOrEqual(1);
      expect(row.vars.iterations).toBeLessThanOrEqual(5);
    }
    const bands = (values: number[], n: number) =>
      values.map((value) => Math.floor(value * n)).sort((a, b) => a - b);
    for (const id of ['temperature', 'iterations']) {
      expect(
        bands(
          numeric.rows.map((row) => row.quantiles[id] as number),
          20,
        ),
      ).toEqual(Array.from({ length: 20 }, (_, i) => i));
      for (const rows of groups.values())
        expect(
          bands(
            rows.map((row) => row.quantiles[id] as number),
            rows.length,
          ),
        ).toEqual(Array.from({ length: rows.length }, (_, i) => i));
    }
    for (const rows of groups.values())
      expect(
        bands(
          rows.map((row) => row.vars.temperature as number),
          rows.length,
        ),
      ).toEqual(Array.from({ length: rows.length }, (_, i) => i));
    const specs = await loadSpecs([join(dir, 'out/specs/twise')]);
    expect(specs).toHaveLength(20);
    for (const entry of specs) {
      if (!entry.ok) throw new Error(entry.path);
      expect(entry.spec.given?.vars).toEqual(numeric.rows.find((row) => row.spec === entry.spec.id)?.vars);
    }
    const first = specs[0];
    if (!first?.ok) throw new Error('missing numeric spec');
    const received: Record<string, unknown>[] = [];
    const adapter = functionAdapter({
      create: () => ({}),
      respond: (_messages, _world, vars) => {
        received.push(vars);
        return {
          text: 'Numeric variables received.',
          segments: [{ type: 'text', text: 'Numeric variables received.' }],
          toolCalls: [],
          cost: { usd: 0 },
          latencyMs: 0,
        };
      },
    });
    await runSpec(first.spec, { adapter, driver: createScriptedDriver(), checks: [], mode: 'F', repeat: 1 });
    expect(received.length).toBeGreaterThan(0);
    expect(
      received.every(
        (vars) =>
          vars.temperature === first.spec.given?.vars?.temperature &&
          vars.iterations === first.spec.given?.vars?.iterations,
      ),
    ).toBe(true);
    const unsupported = await run(['generate', '--map', 'map.yaml', '--out', 'plain'], dir);
    expect(unsupported.code).toBe(2);
    expect(unsupported.err).toContain('numeric_settings requires --budget');
  });
});
