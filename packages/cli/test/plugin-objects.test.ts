import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  clearObjectContexts,
  loadSpecFile,
  objectContextFor,
  objectRegistry,
  resolveBlockObjects,
} from '@agent-nexus/driftbench-core';
import { afterEach, describe, expect, it } from 'vitest';
import { type DriftbenchPlugin, type Io, main } from '../src/index';
import {
  applyPlugins,
  beginPluginRun,
  pluginEvidence,
  pluginEvidenceNames,
  pluginPromptTemplate,
  resetPlugins,
} from '../src/plugins';

/**
 * The plugin API of the rules framework: `api.kind`, `api.rule`, `api.evidence`, `api.diagnosticStep`,
 * `api.promptTemplate` and `api.object`. The fixture plugin registers one of each, and its spec uses them by id.
 */

const FIXTURE = fileURLToPath(new URL('./fixtures/plugin-objects', import.meta.url));
const PLUGIN = join(FIXTURE, 'plugin.mjs');
const SPEC = 'specs/routed.yaml';

const temps: string[] = [];
afterEach(async () => {
  resetPlugins();
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function cli(argv: string[], cwd = FIXTURE, plugins?: DriftbenchPlugin[]) {
  let out = '';
  let err = '';
  const io: Io = {
    cwd,
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
  };
  const code = await main(argv, io, plugins === undefined ? undefined : { plugins });
  return { code, out, err };
}

/** Runs plugins given in code in an isolated run, and returns the refusal, if any, and the cleanup. */
async function run(plugins: DriftbenchPlugin[]): Promise<{ refused: string | undefined; end: () => void }> {
  const end = beginPluginRun();
  return { refused: await applyPlugins(plugins, FIXTURE), end };
}

const ROOT_CHECK_SET = (id: string) =>
  `kind: check-set\nid: ${id}\nitems:\n  - id: tone\n    title: Replies keep the tone\n    impl: plugin:acme-tone\n`;

describe('the plugin API of the rules framework', () => {
  it('registers one of each, and a spec uses the plugin objects by id', async () => {
    expect(await cli(['spec', 'validate', SPEC])).toMatchObject({ code: 0 });
    const plugin = (await import(PLUGIN)).default as DriftbenchPlugin;
    const { refused, end } = await run([plugin]);
    try {
      expect(refused).toBeUndefined();
      clearObjectContexts();
      const path = join(FIXTURE, SPEC);
      const loaded = await loadSpecFile(path);
      if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
      const used = resolveBlockObjects(loaded.spec, 0, objectContextFor(path)).map((use) => [
        use.key,
        use.setAt,
        use.object.ref,
        use.object.items.map((item) => [item.id, item.impl, item.params]),
      ]);
      expect(used).toEqual([
        ['check_set', 'spec', 'check-set:acme@f0458f5f', [['tone', 'plugin:acme-tone', { tone: 'warm' }]]],
        [
          'diagnostics',
          'spec',
          'diagnostic:acme-dedup@e4985b87',
          [['dedup', 'plugin:acme-dedup', { prompt_template: 'linker/acme' }]],
        ],
      ]);
      expect(objectContextFor(path).store.resolve('policy/routing', 'intent').ref).toBe(
        'policy/routing:intent@36c5829b',
      );
    } finally {
      end();
    }
  });

  it('a spec that names a plugin object does not load without the plugin', async () => {
    const elsewhere = await mkdtemp(join(tmpdir(), 'driftbench-plugin-objects-'));
    temps.push(elsewhere);
    await writeFile(join(elsewhere, 'routed.yaml'), await readFile(join(FIXTURE, SPEC), 'utf8'));
    const alone = await cli(['spec', 'validate', 'routed.yaml'], elsewhere);
    expect(alone.code).toBe(1);
    expect(alone.out).toContain('OBJECT_UNKNOWN');
    expect(alone.out).toContain('unknown object check-set:acme');
  });

  it('keeps the evidence, the steps and the prompt template a plugin registered for the run, then forgets them', async () => {
    const plugin = (await import(PLUGIN)).default as DriftbenchPlugin;
    const { refused, end } = await run([plugin]);
    try {
      expect(refused).toBeUndefined();
      expect(pluginEvidenceNames('check-set')).toEqual(['tone_score']);
      expect(pluginEvidence('check-set', 'tone_score')?.()).toBe(0.5);
      const template = pluginPromptTemplate('linker/acme');
      expect(template?.parts).toEqual({
        system: 'You link blocks to prompt units.',
        rubric: 'One unit per line.',
      });
      expect(template?.contract('a\nb')).toEqual(['a', 'b']);
      expect(template?.fingerprint).toMatch(/^[0-9a-f]{12}$/);
      expect(objectRegistry.kind('policy/routing')?.summary).toBe('Which team a conversation goes to.');
      expect(objectRegistry.impl('plugin:acme-dedup')).toBeDefined();
      expect(objectRegistry.impl('plugin:route-by-intent')).toBeDefined();
    } finally {
      end();
    }
    expect(pluginEvidence('check-set', 'tone_score')).toBeUndefined();
    expect(pluginPromptTemplate('linker/acme')).toBeUndefined();
    expect(objectRegistry.kind('policy/routing')).toBeUndefined();
    expect(objectRegistry.impl('plugin:acme-dedup')).toBeUndefined();
  });

  it('one run does not leak its kinds, rules and objects into the next', async () => {
    const elsewhere = await mkdtemp(join(tmpdir(), 'driftbench-plugin-objects-'));
    temps.push(elsewhere);
    await writeFile(join(elsewhere, 'routed.yaml'), await readFile(join(FIXTURE, SPEC), 'utf8'));
    expect((await cli(['spec', 'validate', 'routed.yaml', '--plugin', PLUGIN], elsewhere)).code).toBe(0);
    expect(objectRegistry.kind('policy/routing')).toBeUndefined();
    expect(objectRegistry.impl('plugin:acme-tone')).toBeUndefined();
    expect(objectRegistry.shipped().map(({ path }) => path)).not.toContain(
      join(FIXTURE, 'objects/check-set-acme.yaml'),
    );
    const next = await cli(['spec', 'validate', 'routed.yaml'], elsewhere);
    expect(next.code).toBe(1);
    expect(next.out).toContain('unknown object check-set:acme');
  });

  it('refuses a name two plugins register, for every part, naming both plugins', async () => {
    const twice: Array<[string, DriftbenchPlugin]> = [
      ['the object kind policy/twice', (api) => api.kind('policy/twice', { summary: 'Twice.' })],
      ['the implementation plugin:twice', (api) => api.rule('check-set', 'twice', { run: () => [] })],
      ['the implementation plugin:twice', (api) => api.diagnosticStep('twice', () => ({}))],
      ['the evidence twice of check-set', (api) => api.evidence('check-set', 'twice', () => 1)],
      [
        'the prompt template twice',
        (api) => api.promptTemplate('twice', { system: 'x' }, (answer) => answer),
      ],
    ];
    for (const [label, plugin] of twice) {
      const { refused, end } = await run([plugin, plugin]);
      end();
      expect(refused, label).toBe(
        `The plugin given in code (2) registers ${label}, which the plugin given in code (1) already registered. A plugin never replaces what driftbench ships or another plugin registered: give it another name, or ship an object that extends it.`,
      );
    }
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-plugin-objects-'));
    temps.push(dir);
    await writeFile(join(dir, 'acme.yaml'), ROOT_CHECK_SET('twice'));
    const rule: DriftbenchPlugin = (api) => api.rule('check-set', 'acme-tone', { run: () => [] });
    const object: DriftbenchPlugin = (api) => api.object(join(dir, 'acme.yaml'));
    const { refused, end } = await run([rule, object, object]);
    end();
    expect(refused).toBe(
      'The plugin given in code (3) gives the object check-set:twice, which driftbench or another plugin already ships. A plugin never replaces what driftbench ships or another plugin registered: give it another name, or ship an object that extends it.',
    );
  });

  it('never replaces a shipped kind or object; a plugin object that extends one is accepted', async () => {
    const kind = await run([(api) => api.kind('check-set', { summary: 'Mine.' })]);
    kind.end();
    expect(kind.refused).toBe(
      'The plugin given in code (1) registers the object kind check-set, which driftbench already has. A plugin never replaces what driftbench ships or another plugin registered: give it another name, or ship an object that extends it.',
    );
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-plugin-objects-'));
    temps.push(dir);
    await writeFile(join(dir, 'base.yaml'), ROOT_CHECK_SET('base'));
    await writeFile(
      join(dir, 'over.yaml'),
      'kind: check-set\nid: base\nextends: base\nitems:\n  - id: tone\n    enabled: false\n',
    );
    await writeFile(
      join(dir, 'child.yaml'),
      'kind: check-set\nid: child\nextends: base\nitems:\n  - id: tone\n    params: { tone: plain }\n',
    );
    const rule: DriftbenchPlugin = (api) => api.rule('check-set', 'acme-tone', { run: () => [] });
    const shipper: DriftbenchPlugin = (api) => api.object(join(dir, 'base.yaml'));
    const replacer = await run([rule, shipper, (api) => api.object(join(dir, 'over.yaml'))]);
    replacer.end();
    expect(replacer.refused).toBe(
      'The plugin given in code (3) gives the object check-set:base, which driftbench or another plugin already ships. A plugin never replaces what driftbench ships or another plugin registered: give it another name, or ship an object that extends it.',
    );
    const extender = await run([rule, shipper, (api) => api.object(join(dir, 'child.yaml'))]);
    try {
      expect(extender.refused).toBeUndefined();
    } finally {
      extender.end();
    }
  });

  it('stops the run on a plugin object that does not resolve, and on a rule for a kind no one registered', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-plugin-objects-'));
    temps.push(dir);
    await writeFile(
      join(dir, 'bad.yaml'),
      ROOT_CHECK_SET('bad').replace('plugin:acme-tone', 'plugin:nobody'),
    );
    const bad = await run([(api) => api.object(join(dir, 'bad.yaml'))]);
    bad.end();
    expect(bad.refused).toBe(
      'The plugin given in code (1) gives the object check-set:bad, which does not resolve: check-set:bad: item tone names plugin:nobody, which no builtin or plugin provides (' +
        join(dir, 'bad.yaml') +
        '#items.0)',
    );
    const orphan = await run([(api) => api.rule('policy/nowhere', 'lost', { run: () => 0 })]);
    orphan.end();
    expect(orphan.refused).toBe(
      'The plugin given in code (1) registers the rule lost for the kind policy/nowhere, which no one registered.',
    );
    const other = await cli(['spec', 'validate', SPEC], FIXTURE, [
      (api) => api.rule('check-set', 'other', { run: () => [] }),
    ]);
    expect(other.code).toBe(0);
  });

  it('checks the params of a plugin rule against the schema it declares', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-plugin-objects-'));
    temps.push(dir);
    await writeFile(join(dir, 'loud.yaml'), `${ROOT_CHECK_SET('loud')}    params: { tone: loud }\n`);
    const plugin = (await import(PLUGIN)).default as DriftbenchPlugin;
    const loud = await run([plugin, (api) => api.object(join(dir, 'loud.yaml'))]);
    loud.end();
    expect(loud.refused).toContain('check-set:loud: item tone params: params.tone: tone is plain or warm');
  });
});
