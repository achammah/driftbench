import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '@agent-nexus/driftbench-store';
import { expect, it } from 'vitest';
import { main } from '../src/index';

const root = fileURLToPath(new URL('../../../', import.meta.url));

it('re-scores a stored campaign under --use with no agent call, and refuses an agent-facing object', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'acme-rescore-'));
  const cli = async (args: string[]) => {
    let out = '';
    let err = '';
    const code = await main(args, {
      cwd: dir,
      out: (s) => {
        out += s;
      },
      err: (s) => {
        err += s;
      },
    });
    return { code, out, err };
  };
  try {
    await writeFile(join(dir, 'driftbench.yaml'), 'plugins: []\n');
    await mkdir(join(dir, 'driftbench', 'check-set'), { recursive: true });
    await writeFile(
      join(dir, 'driftbench', 'check-set', 'quiet.yaml'),
      'kind: check-set\nid: quiet\nextends: default\nitems:\n  - { id: must, enabled: false }\n',
    );
    await mkdir(join(dir, 'specs'));
    await copyFile(
      join(root, 'examples/acme/specs/conversations/plan-upgrade.yaml'),
      join(dir, 'specs/plan-upgrade.yaml'),
    );
    const base = await cli([
      'campaign',
      'run',
      'specs/plan-upgrade.yaml',
      '--target',
      'function:acme-sales',
      '--agent-version',
      'acme-v1',
      '--campaign',
      'base',
      '--store',
      'runs.db',
    ]);
    expect(base.err).toBe('');
    const args = ['campaign', 'rejudge', 'specs/plan-upgrade.yaml', '--from', 'base', '--store', 'runs.db'];
    for (const [index, flag] of [
      'check-set/missing#must.limit=2',
      'check-set/quiet#missing.limit=2',
      'diagnostic/missing#rule.limit=2',
    ].entries()) {
      const campaign = `invalid-${index}`;
      const rejected = await cli([...args, '--campaign', campaign, '--set', flag]);
      expect(rejected.code, rejected.err).toBe(2);
      expect(rejected.err).toMatch(/unknown object|no item/);
      const db = openStore(join(dir, 'runs.db'));
      try {
        expect(await db.getCampaign(campaign), flag).toBeUndefined();
        expect(await db.listRuns({ campaignId: campaign })).toEqual([]);
      } finally {
        await db.close();
      }
    }
    const rescored = await cli([...args, '--campaign', 'quiet', '--use', 'check-set/quiet', '--json']);
    expect(rescored.err).toBe('');
    expect(JSON.parse(rescored.out)).toMatchObject({ agentCalls: 0, rescored: 5, use: ['check-set/quiet'] });
    // Reviewer regression: the report command also describes these observations as re-scored.
    const reported = await cli(['report', 'quiet', '--store', 'runs.db', '--out', 'quiet.html']);
    expect(reported.code, reported.err).toBe(0);
    expect(reported.err).toBe('');
    expect(reported.out).toContain('Re-scored; observations from base');
    expect(reported.out).not.toContain('re-judged observations');
    expect(reported.out).not.toContain('1 run carried');

    const db = openStore(join(dir, 'runs.db'));
    const [before] = await db.listRuns({ campaignId: 'base' });
    const [after] = await db.listRuns({ campaignId: 'quiet' });
    expect(before?.blocks.flatMap((b) => b.verdicts).some((v) => v.name === 'must')).toBe(true);
    expect(after?.blocks.flatMap((b) => b.verdicts).some((v) => v.name === 'must')).toBe(false);
    expect(after?.blocks.map((b) => b.observed)).toEqual(before?.blocks.map((b) => b.observed));
    expect(after?.blocks[0]?.verdicts[0]?.by?.object).toMatch(/^check-set:quiet@/);
    expect(after?.blocks[0]?.resolved?.objects.find((object) => object.key === 'check_set')).toMatchObject({
      key: 'check_set',
      id: 'quiet',
      setAt: 'cli',
    });
    expect(after?.cost).toBe(0);
    await db.close();

    const facing = await cli([...args, '--campaign', 'refused', '--use', 'run-profile/fast']);
    expect(facing.code).toBe(2);
    expect(facing.err).toContain('run-profile is agent-facing');
    expect(facing.err).toContain('rerun the agent in a full campaign');
    const both = await cli([...args, '--campaign', 'both', '--use', 'check-set/quiet', '--change', 'x.yaml']);
    expect(both.code).toBe(2);
    expect(both.err).toContain('one at a time');
    const neither = await cli([...args, '--campaign', 'neither']);
    expect(neither.code).toBe(2);
    expect(neither.err).toContain('Re-judge needs --change');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 60_000);

it.each([
  ['--use', 'diagnostic/missing', 'diagnostic:missing'],
  ['--use', 'prompt-template/missing', 'prompt-template:missing'],
  ['--set', 'prompt-template#missing.limit=2', 'prompt-template:default'],
])(
  'refuses %s %s before writing a re-scored campaign',
  async (flag, value, target) => {
    const dir = await mkdtemp(join(tmpdir(), 'rescore-all-kinds-'));
    const cli = async (args: string[]) => {
      let out = '';
      let err = '';
      const code = await main(args, {
        cwd: dir,
        out: (s) => {
          out += s;
        },
        err: (s) => {
          err += s;
        },
      });
      return { code, out, err };
    };
    try {
      await writeFile(join(dir, 'driftbench.yaml'), 'plugins: []\n');
      await copyFile(
        join(root, 'examples/acme/specs/conversations/plan-upgrade.yaml'),
        join(dir, 'spec.yaml'),
      );
      const base = await cli([
        'campaign',
        'run',
        'spec.yaml',
        '--target',
        'function:acme-sales',
        '--agent-version',
        'acme-v1',
        '--campaign',
        'base',
        '--store',
        'runs.db',
      ]);
      expect(base.err).toBe('');
      const before = openStore(join(dir, 'runs.db'));
      const campaigns = await before.listCampaigns();
      const runs = await before.listRuns({ campaignId: 'base' });
      await before.close();
      const rejected = await cli([
        'campaign',
        'rejudge',
        'spec.yaml',
        '--from',
        'base',
        '--campaign',
        'invalid',
        '--store',
        'runs.db',
        flag,
        value,
      ]);
      expect(rejected.code, rejected.out + rejected.err).toBe(2);
      expect(rejected.err).toContain(target);
      expect(rejected.err).toContain('searched layers shipped, project, suite, spec, block, cli');
      const after = openStore(join(dir, 'runs.db'));
      try {
        expect(await after.listCampaigns()).toEqual(campaigns);
        expect(await after.listRuns({ campaignId: 'invalid' })).toEqual([]);
        expect(await after.listRuns({ campaignId: 'base' })).toEqual(runs);
      } finally {
        await after.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
  60_000,
);
