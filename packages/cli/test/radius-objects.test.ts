import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { loadSpecFile, objectContextOfSpec, resolveBlockObjects } from '@agent-nexus/driftbench-core';
import { openStore } from '@agent-nexus/driftbench-store';
import { Command } from 'commander';
import { expect, it } from 'vitest';
import { defaultDeps, registerCampaignCommands } from '../src/commands/campaign';

it('re-scores a whole-cell --change carry with the current project objects and no new agent call', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'driftbench-radius-objects-'));
  let sends = 0;
  try {
    await mkdir(join(dir, 'driftbench/check-set'), { recursive: true });
    await writeFile(join(dir, 'driftbench.yaml'), 'plugins: []\n');
    await writeFile(
      join(dir, 'spec.yaml'),
      [
        'id: current-object-carry',
        'metadata: { depends: {} }',
        'uses: { check_set: house }',
        'blocks:',
        '  - user: hello',
        '    expect: { must: ["^good$"] }',
        '',
      ].join('\n'),
    );
    await writeFile(
      join(dir, 'change.yaml'),
      'from: v1\nto: v2\nchanges:\n  - kind: criterion\n    id: unused\n',
    );
    const objectPath = join(dir, 'driftbench/check-set/house.yaml');
    const house = (enabled: boolean) =>
      `kind: check-set\nid: house\nextends: default\nitems:\n  - { id: must, enabled: ${enabled} }\n`;
    await writeFile(objectPath, house(false));
    const cli = async (id: string, version: string, radius: boolean) => {
      let code = 0;
      let error = '';
      const program = new Command('driftbench').exitOverride();
      registerCampaignCommands(
        program,
        {
          cwd: dir,
          out: () => {},
          err: (text) => {
            error += text;
          },
        },
        (exit) => {
          code = exit;
        },
        {
          ...defaultDeps,
          adapterFor: async () =>
            functionAdapter({
              respond: () => {
                sends++;
                return { text: 'bad', segments: [], toolCalls: [], cost: {}, latencyMs: 0 };
              },
            }),
        },
      );
      await program.parseAsync(
        [
          'campaign',
          'run',
          'spec.yaml',
          '--target',
          'function:echo',
          '--agent-version',
          version,
          '--campaign',
          id,
          '--store',
          'runs.db',
          '--no-cache',
          ...(radius ? ['--from', 'base', '--change', 'change.yaml'] : []),
        ],
        { from: 'user' },
      );
      expect(error).toBe('');
      return code;
    };
    expect(await cli('base', 'v1', false)).toBe(0);
    expect(sends).toBe(1);
    await writeFile(objectPath, house(true));
    sends = 0;
    expect(await cli('rescored', 'v2', true)).toBe(1);
    expect(sends).toBe(0);
    const spec = await loadSpecFile(join(dir, 'spec.yaml'));
    if (!spec.ok) throw new Error(JSON.stringify(spec.errors));
    const context = objectContextOfSpec(spec.spec);
    if (!context) throw new Error('missing object context');
    const current = resolveBlockObjects(spec.spec, 0, context).find(
      (entry) => entry.key === 'check_set',
    )?.object;
    if (!current) throw new Error('missing current check set');
    const store = openStore(join(dir, 'runs.db'));
    try {
      const [baseline] = await store.listRuns({ campaignId: 'base' });
      const [run] = await store.listRuns({ campaignId: 'rescored' });
      expect(run?.carried?.fromCampaign).toBe('base');
      expect(run?.blocks[0]?.observed).toEqual(baseline?.blocks[0]?.observed);
      expect(run?.blocks[0]?.pass).toBe(false);
      expect(run?.blocks[0]?.resolved?.hash).not.toBe(baseline?.blocks[0]?.resolved?.hash);
      expect(run?.blocks[0]?.resolved?.objects).toContainEqual(
        expect.objectContaining({ kind: 'check-set', id: 'house', hash: current.hash }),
      );
      expect(run?.blocks[0]?.verdicts.find((verdict) => verdict.name === 'must')).toMatchObject({
        outcome: 'fail',
        by: { object: current.ref, item: 'must' },
      });
    } finally {
      await store.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
