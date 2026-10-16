import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { defaultRegistry } from '@agent-nexus/driftbench-checks';
import type { JudgeClient } from '@agent-nexus/driftbench-judges';
import { afterEach, describe, expect, it } from 'vitest';
import { readAggregateConfig } from '../src/aggregate-config';
import { defaultPairwiseClient } from '../src/commands/compare';
import {
  campaignCommands,
  type DriftbenchPlugin,
  definePlugin,
  type Io,
  type MainOptions,
  main,
} from '../src/index';
import {
  applyPlugins,
  pluginAdapter,
  pluginAdapterNames,
  pluginArgs,
  pluginConfigPath,
  pluginPairwiseJudge,
  readPluginConfig,
  resetPlugins,
} from '../src/plugins';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const EXAMPLE = join(ROOT, 'examples/plugins');
const SPEC = 'examples/plugins/specs/hello.yaml';
const PLUGIN = 'examples/plugins/plugin.mjs';
const KNOWN =
  'The CLI reaches function:acme-sales (or function:acme), the Acme sales assistant, and process:acme-ops, the Acme ops agent. It also reaches http, litellm and nexus targets from the target.options of a spec.';

async function cli(argv: string[], cwd = ROOT, options?: MainOptions) {
  let out = '';
  let err = '';
  const io: Io = {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    cwd,
  };
  return { code: await main(argv, io, options), out, err };
}

const temps: string[] = [];
async function temp(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'driftbench-plugins-'));
  temps.push(dir);
  for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
  return dir;
}

afterEach(async () => {
  resetPlugins();
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('plugins', () => {
  it('without a plugin, a target no adapter reaches is refused with the message of before', async () => {
    const run = await cli(['campaign', 'run', SPEC]);
    expect(run.code).toBe(2);
    expect(run.err).toBe(`No adapter is set up for echo:demo, the target of plugins-hello. ${KNOWN}\n`);
  });

  it('--plugin loads the adapter and the check of the example', async () => {
    const run = await cli(['campaign', 'run', SPEC, '--plugin', PLUGIN, '--json']);
    expect(run.err).toBe('');
    expect(run.code).toBe(0);
    expect(run.out).toContain('"id": "custom.polite.banned"');
    expect(run.out).not.toContain('no check of that name is registered');
    const smoke = await cli(['smoke', `--plugin=${PLUGIN}`, SPEC]);
    expect(smoke.code).toBe(0);
    expect(smoke.out).toContain('plugins-hello on echo:demo');
  });

  it('the plugins list of driftbench.yaml is read from the working folder, paths relative to the file', async () => {
    const run = await cli(['campaign', 'run', 'specs/hello.yaml'], EXAMPLE);
    expect(run.err).toBe('');
    expect(run.code).toBe(0);
    expect(run.out).toContain('plugins-hello · echo:demo');
  });

  it('plugins and campaign settings live in one config', async () => {
    const dir = await temp({
      'both.yaml': `plugins:\n  - ${join(EXAMPLE, 'plugin.mjs')}\ncampaign:\n  specs: [${SPEC}]\n  repeats: 2\n`,
    });
    const run = await cli(['campaign', 'run', '--config', join(dir, 'both.yaml')]);
    expect(run.err).toBe('');
    expect(run.code).toBe(0);
    expect(run.out).toContain('2 cells: 2 pass');
  });

  it('a plugin check fails the block it catches', async () => {
    const dir = await temp({
      'rude.yaml': [
        'id: plugins-rude',
        "version: '1'",
        'title: The banned word comes back',
        'channel: chat',
        'lang: EN',
        'target: { adapter: echo, agent: demo }',
        'rules: { custom: { polite: { banned: [stupid] } } }',
        'blocks:',
        '  - user: That is stupid',
        '',
      ].join('\n'),
    });
    const run = await cli(['campaign', 'run', join(dir, 'rude.yaml'), '--plugin', PLUGIN, '--json']);
    expect(run.code).toBe(1);
    expect(run.out).toContain('the reply holds the banned word stupid');
  });

  it('one run does not leak its plugins into the next', async () => {
    expect((await cli(['smoke', SPEC, '--plugin', PLUGIN])).code).toBe(0);
    const next = await cli(['smoke', SPEC]);
    expect(next.code).toBe(2);
    expect(next.err).toContain(`No adapter is set up for echo:demo, the target of plugins-hello. ${KNOWN}\n`);
  });

  it('names the plugin adapters when a target has none', async () => {
    const run = await cli(['smoke', SPEC, '--target', 'grpc:nobody', '--plugin', PLUGIN]);
    expect(run.code).toBe(2);
    expect(run.err).toBe(`No adapter is set up for grpc:nobody. ${KNOWN} Plugins add the adapters echo.\n`);
  });

  it('refuses a plugin that cannot load, with exit 2 and one line', async () => {
    const dir = await temp({
      'empty.mjs': 'export const nothing = 1;\n',
      'throws.mjs': "export default () => { throw new Error('no key set'); };\n",
      'bad.yaml': 'aggregates: []\nplugins: ./one.mjs\n',
      'blank.yaml': "plugins:\n  - ''\n",
    });
    const missing = await cli(['spec', 'lint', SPEC, '--plugin', './nowhere.mjs']);
    expect(missing.code).toBe(2);
    expect(missing.err).toMatch(/^driftbench: Cannot load the plugin \.\/nowhere\.mjs: .+\n$/);
    const empty = await cli(['spec', 'lint', SPEC, '--plugin', join(dir, 'empty.mjs')]);
    expect(empty.code).toBe(2);
    expect(empty.err).toContain('exports no function');
    const throws = await cli(['spec', 'lint', SPEC, '--plugin', join(dir, 'throws.mjs')]);
    expect(throws.code).toBe(2);
    expect(throws.err).toContain('failed: no key set');
    const noValue = await cli(['spec', 'lint', SPEC, '--plugin']);
    expect(noValue.code).toBe(2);
    expect(noValue.err).toBe('driftbench: --plugin takes a module path or a package name\n');
    const bad = await readPluginConfig(join(dir, 'bad.yaml'));
    expect(bad).toEqual({
      ok: false,
      message: `${join(dir, 'bad.yaml')}:2: plugins must be a list of module paths or package names`,
    });
    expect((await readPluginConfig(join(dir, 'blank.yaml'))).ok).toBe(false);
    const run = await cli(['spec', 'lint', SPEC, '--config', join(dir, 'bad.yaml')]);
    expect(run.code).toBe(2);
    expect(run.err).toContain('bad.yaml:2: plugins must be a list');
  });

  it('reads no plugin from a config that is absent, not a map or without the key', async () => {
    const dir = await temp({
      'list.yaml': '- a\n',
      'broken.yaml': 'a: [b\n',
      'plain.yaml': 'aggregates: []\n',
    });
    for (const name of ['list.yaml', 'broken.yaml', 'plain.yaml', 'absent.yaml']) {
      expect(await readPluginConfig(join(dir, name))).toEqual({ ok: true, sources: [] });
    }
    expect(pluginConfigPath(['report'], dir)).toBeUndefined();
    expect(pluginConfigPath(['report', '--config', 'plain.yaml'], dir)).toBe(join(dir, 'plain.yaml'));
    expect(pluginConfigPath(['estate', 'run', '--config', 'host'], dir)).toBeUndefined();
  });

  it('the config accepts the plugins key, and names its keys when it refuses one', async () => {
    const dir = await temp({
      'ok.yaml': 'aggregates: []\nplugins: []\n',
      'unknown.yaml': 'aggregates: []\nmystery: 1\n',
    });
    expect(await readAggregateConfig(join(dir, 'ok.yaml'))).toEqual({ ok: true, specs: [] });
    expect(await readAggregateConfig(join(dir, 'unknown.yaml'))).toEqual({
      ok: false,
      message: `${join(dir, 'unknown.yaml')}:2: unknown key mystery; the config defines aggregates, campaign, objects, plugins, prices, scales only`,
    });
  });

  it('takes --plugin anywhere before --, in both spellings', () => {
    expect(pluginArgs(['smoke', '--plugin', 'a.mjs', 'x.yaml', '--plugin=b', '--', '--plugin', 'c'])).toEqual(
      {
        argv: ['smoke', 'x.yaml', '--', '--plugin', 'c'],
        modules: ['a.mjs', 'b'],
        missing: false,
      },
    );
    expect(pluginArgs(['smoke', '--plugin', '--json']).missing).toBe(true);
    expect(pluginArgs(['smoke', '--plugin=']).missing).toBe(true);
    expect(pluginArgs(['lint', 'x.yaml'])).toEqual({ argv: ['lint', 'x.yaml'], modules: [], missing: false });
  });

  it('main takes plugins and deps in code', async () => {
    const plugin: DriftbenchPlugin = definePlugin((api) => {
      api.adapter('echo', () =>
        functionAdapter({
          respond: (messages) => {
            const text = `You said: ${messages.at(-1)?.content ?? ''}`;
            return { segments: [{ type: 'text', text }], text, toolCalls: [], cost: {}, latencyMs: 0 };
          },
          deterministic: true,
        }),
      );
    });
    const withPlugin = await cli(['smoke', SPEC], ROOT, { plugins: [plugin] });
    expect(withPlugin.code).toBe(0);
    let asked = '';
    const withDeps = await cli(['smoke', SPEC], ROOT, {
      deps: {
        adapterFor: async (target) => {
          asked = `${target.adapter}:${target.agent}`;
          return undefined;
        },
      },
    });
    expect(asked).toBe('echo:demo');
    expect(withDeps.code).toBe(2);
  });

  it('the campaign commands load on demand', async () => {
    const { campaignRunCommand, defaultDeps } = await campaignCommands();
    expect(typeof campaignRunCommand).toBe('function');
    expect((await defaultDeps.adapterFor({ adapter: 'function', agent: 'acme-sales' }))?.id).toBe('function');
  });

  it('a plugin never replaces a check that is already registered, and a reset leaves that check as it was', async () => {
    const original = () => [];
    const replacement = () => [];
    defaultRegistry.register('preexisting', original);
    try {
      const clash = await cli(['--help'], ROOT, {
        plugins: [(api) => api.check('preexisting', replacement)],
      });
      expect(clash.code).toBe(2);
      expect(clash.err).toBe(
        'driftbench: The plugin given in code (1) registers the check preexisting, which is already registered outside the plugins of this run. A plugin never replaces a check: give it another name.\n',
      );
      expect(defaultRegistry.get('preexisting')).toBe(original);
      expect((await cli(['--help'])).code).toBe(0);
      expect(defaultRegistry.get('preexisting')).toBe(original);
    } finally {
      defaultRegistry.unregister('preexisting');
    }
  });

  it('two plugins that register the same check are refused, both named', async () => {
    const dir = await temp({
      'one.mjs': "export default (api) => api.check('twice', () => []);\n",
      'two.mjs': "export default (api) => api.check('twice', () => []);\n",
    });
    const run = await cli(['--help', '--plugin', join(dir, 'one.mjs'), '--plugin', join(dir, 'two.mjs')]);
    expect(run.code).toBe(2);
    expect(run.err).toBe(
      `driftbench: The plugin ${join(dir, 'two.mjs')} registers the check twice, which the plugin ${join(dir, 'one.mjs')} already registered. A plugin never replaces a check: give it another name.\n`,
    );
    expect(defaultRegistry.get('twice')).toBeUndefined();
  });

  it.each([
    ['adapter', 'adapter', '() => undefined'],
    ['check', 'check', '() => []'],
    ['pairwiseJudge', 'judge', "() => ({ id: 'custom' })"],
  ])('refuses duplicate %s registrations with both module owners', async (method, kind, factory) => {
    const dir = await temp({
      'first.mjs': `export default api => api.${method}('duplicate', ${factory});`,
      'second.mjs': `export default api => api.${method}('duplicate', ${factory});`,
    });
    const run = await cli([
      '--help',
      '--plugin',
      join(dir, 'first.mjs'),
      '--plugin',
      join(dir, 'second.mjs'),
    ]);
    expect(run.code).toBe(2);
    expect(run.err).toContain(`The plugin ${join(dir, 'second.mjs')} registers the ${kind} duplicate`);
    expect(run.err).toContain(`the plugin ${join(dir, 'first.mjs')} already registered`);
    expect(run.err).toContain(`never replaces ${kind === 'adapter' ? 'an' : 'a'} ${kind}:`);
    expect(pluginAdapterNames()).toEqual([]);
    expect(pluginPairwiseJudge('duplicate')).toBeUndefined();
    expect(defaultRegistry.get('duplicate')).toBeUndefined();
  });

  it.each([3, 5])('restores all registries after each of %i alternating calls', async (count) => {
    const keptCheck = () => [];
    const keptJudge = { id: 'kept' } as JudgeClient;
    const keptAdapter = functionAdapter({
      respond: () => ({ segments: [], text: 'kept', toolCalls: [], cost: {}, latencyMs: 0 }),
      deterministic: true,
    });
    await applyPlugins(
      [
        (api) => {
          api.adapter('kept', () => keptAdapter);
          api.check('kept', keptCheck);
          api.pairwiseJudge('kept', () => keptJudge);
        },
      ],
      ROOT,
    );
    const names = defaultRegistry.names();
    const before = names.map((name) => defaultRegistry.get(name));
    const plugin: DriftbenchPlugin = (api) => {
      api.adapter('scoped', () => keptAdapter);
      api.check('scoped', () => []);
      api.pairwiseJudge('scoped', () => ({ id: 'scoped' }) as JudgeClient);
    };
    for (let index = 0; index < count; index++) {
      const withPlugin = index % 2 === 0;
      let observed = false;
      const code = await main(
        ['--help'],
        {
          cwd: ROOT,
          err: () => {},
          out: () => {
            observed = true;
            expect(defaultRegistry.get('scoped') !== undefined).toBe(withPlugin);
            expect(pluginAdapterNames().includes('scoped')).toBe(withPlugin);
            expect(pluginPairwiseJudge('scoped')?.id).toBe(withPlugin ? 'scoped' : undefined);
          },
        },
        { plugins: withPlugin ? [plugin] : [] },
      );
      expect(code).toBe(0);
      expect(observed).toBe(true);
      expect(JSON.stringify(defaultRegistry.names())).toBe(JSON.stringify(names));
      for (const [at, name] of names.entries()) expect(defaultRegistry.get(name)).toBe(before[at]);
      expect(pluginAdapterNames()).toEqual(['kept']);
      expect(await pluginAdapter({ adapter: 'kept', agent: 'demo' })).toBe(keptAdapter);
      expect(pluginPairwiseJudge('kept')).toBe(keptJudge);
      expect(pluginPairwiseJudge('scoped')).toBeUndefined();
    }
  });

  it.each(['load', 'command', 'throw'])('restores all registries on %s failure', async (failure) => {
    const before = defaultRegistry.names().map((name) => [name, defaultRegistry.get(name)]);
    const plugins: DriftbenchPlugin[] = [
      (api) => {
        api.adapter('scoped', () => undefined);
        api.check('scoped', () => []);
        api.pairwiseJudge('scoped', () => ({ id: 'scoped' }) as JudgeClient);
      },
    ];
    if (failure === 'load')
      plugins.push((api) => {
        api.adapter('partial', () => undefined);
        api.check('partial', () => []);
        throw new Error('registration interrupted');
      });
    const run = main(
      failure === 'command' ? ['--plugin'] : ['--help'],
      {
        cwd: ROOT,
        err: () => {},
        out: () => {
          if (failure === 'throw') throw new Error('output interrupted');
        },
      },
      { plugins },
    );
    if (failure === 'throw') await expect(run).rejects.toThrow('output interrupted');
    else expect(await run).toBe(2);
    expect(defaultRegistry.names().map((name) => [name, defaultRegistry.get(name)])).toEqual(before);
    expect(pluginAdapterNames()).toEqual([]);
    expect(pluginPairwiseJudge('scoped')).toBeUndefined();
  });

  it('a module named in the config and by the flag runs once', async () => {
    const run = await cli(['campaign', 'run', 'specs/hello.yaml', '--plugin', './plugin.mjs'], EXAMPLE);
    expect(run.err).toBe('');
    expect(run.code).toBe(0);
  });

  it('a check a plugin added is gone after the run, and other checks are untouched', async () => {
    const mine = () => [];
    defaultRegistry.register('kept', mine);
    try {
      await cli(['--help'], ROOT, { plugins: [(api) => api.check('added', () => [])] });
      expect(defaultRegistry.get('added')).toBeUndefined();
      await cli(['--help']);
      expect(defaultRegistry.get('added')).toBeUndefined();
      expect(defaultRegistry.get('kept')).toBe(mine);
    } finally {
      defaultRegistry.unregister('kept');
    }
  });

  it('a plugin judge may not take the name of a built-in judge', async () => {
    for (const name of ['openai', 'anthropic', 'google']) {
      const run = await cli(['--help'], ROOT, {
        plugins: [(api) => api.pairwiseJudge(name, () => ({ id: 'mine' }) as JudgeClient)],
      });
      expect(run.code).toBe(2);
      expect(run.err).toBe(
        `driftbench: The plugin given in code (1) failed: the judge name ${name} is built in (openai, anthropic, google): a plugin judge needs another name\n`,
      );
    }
  });

  it('the top-level help lists --plugin', async () => {
    const help = await cli(['--help']);
    expect(help.out).toMatch(/--plugin <module>\s+load a plugin/);
  });

  it('a plugin judge answers --pairwise-judge by its name; an unknown name is refused as before', async () => {
    const judge = { id: 'mine' } as JudgeClient;
    await main(
      ['--help'],
      {
        cwd: ROOT,
        err: () => {},
        out: () => {
          expect(defaultPairwiseClient('mine')).toBe(judge);
        },
      },
      { plugins: [(api) => api.pairwiseJudge('mine', () => judge)] },
    );
    expect(() => defaultPairwiseClient('mine')).toThrow(
      'unknown pairwise judge mine: use openai, anthropic or google',
    );
  });
});
