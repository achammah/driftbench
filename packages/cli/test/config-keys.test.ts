import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '@agent-nexus/driftbench-store';
import { afterEach, describe, expect, it } from 'vitest';
import { readAggregateConfig, readScaleConfig } from '../src/aggregate-config';
import { readCampaignConfig } from '../src/campaign-config';
import { viewCommand } from '../src/commands/view';
import { type Io, main } from '../src/index';

const spec = fileURLToPath(
  new URL('../../../examples/acme/specs/conversations/plan-upgrade.yaml', import.meta.url),
);
let dir = '';
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe.each(['explicit', 'default'])('%s project config', (source) => {
  it.each(['campaign run', 'campaign plan', 'view', 'report', 'ci'])(
    '%s refuses an unknown top-level key with the same file, line and exit code',
    async (command) => {
      dir = await mkdtemp(join(tmpdir(), 'driftbench-config-keys-'));
      const filename = source === 'explicit' ? 'custom.yaml' : 'driftbench.yaml';
      const path = join(dir, filename);
      await writeFile(path, '# Project settings\naggregates: []\ncampagin:\n  repeats: 2\n');
      const store = await openStore(join(dir, 'runs.db'));
      await store.close();
      let out = '';
      let err = '';
      const io: Io = {
        cwd: dir,
        out: (text) => {
          out += text;
        },
        err: (text) => {
          err += text;
        },
      };
      const config = source === 'explicit' ? { config: filename } : {};
      let code: number;
      if (command === 'view') {
        code = await viewCommand(
          { store: 'runs.db', port: '0', labels: 'labels', ...config },
          io,
          async () => {},
        );
      } else {
        const args = command.startsWith('campaign')
          ? [...command.split(' '), spec, '--target', 'function:acme', '--store', 'runs.db']
          : command === 'report'
            ? ['report', '--store', 'runs.db', '--out', 'report.html']
            : [
                'ci',
                '--specs',
                spec,
                '--target',
                'function:acme',
                '--baseline',
                'c-base',
                '--store',
                'runs.db',
              ];
        if (source === 'explicit') args.push('--config', filename);
        code = await main(args, io);
      }
      expect({ code, out, err }).toEqual({
        code: 2,
        out: '',
        err: `${path}:3: unknown key campagin; the config defines aggregates, campaign, objects, plugins, prices, scales only\n`,
      });
    },
    120_000,
  );
});

it('accepts every recognized section together through each config reader', async () => {
  dir = await mkdtemp(join(tmpdir(), 'driftbench-config-keys-'));
  const path = join(dir, 'driftbench.yaml');
  await writeFile(
    path,
    'campaign: { repeats: 2 }\naggregates: []\nscales: { quality: { min: 1, max: 5 } }\nplugins: []\nprices: {}\nobjects: []\n',
  );
  expect(await readCampaignConfig(undefined, dir)).toEqual({ ok: true, config: { repeats: 2 } });
  expect(await readAggregateConfig(path)).toEqual({ ok: true, specs: [] });
  expect(await readScaleConfig(path)).toEqual({ ok: true, scales: { quality: { min: 1, max: 5 } } });
});

it('report accepts the objects key and still refuses an unknown key beside it', async () => {
  dir = await mkdtemp(join(tmpdir(), 'driftbench-config-keys-'));
  const store = await openStore(join(dir, 'runs.db'));
  await store.close();
  const run = async (text: string) => {
    await writeFile(join(dir, 'driftbench.yaml'), text);
    let err = '';
    const io: Io = { cwd: dir, out: () => {}, err: (chunk) => (err += chunk) };
    const code = await main(['report', '--store', 'runs.db', '--out', 'report.html'], io);
    return { code, err };
  };
  const objects =
    'objects:\n  - kind: policy/blame\n    id: acme\n    extends: default\n    items: [{ id: R6, enabled: false }]\n';
  const accepted = await run(objects);
  expect(accepted.err).not.toContain('unknown key');
  const refused = await run(`${objects}objectz: []\n`);
  expect(refused).toEqual({
    code: 2,
    err: `${join(dir, 'driftbench.yaml')}:6: unknown key objectz; the config defines aggregates, campaign, objects, plugins, prices, scales only\n`,
  });
}, 120_000);
