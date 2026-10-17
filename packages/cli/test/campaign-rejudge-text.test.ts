import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { main } from '../src/index';

const root = fileURLToPath(new URL('../../../', import.meta.url));

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'campaign-rejudge-text-'));
  const path = join(dir, 'runs.db');
  const file = join(dir, 'spec.json');
  const spec = {
    id: 'text-output',
    criteria: [{ name: 'quote', rubric: 'Answer the user.', gating: true }],
    blocks: [{ when: { user: 'Hello' }, expect: { criteria: ['quote'] } }, { when: { user: 'Thanks' } }],
  };
  const cli = async (args: string[]) => {
    let out = '';
    let err = '';
    const code = await main(args, {
      cwd: root,
      out: (text) => {
        out += text;
      },
      err: (text) => {
        err += text;
      },
    });
    return { code, out, err };
  };
  await writeFile(file, JSON.stringify(spec));
  const base = await cli([
    'campaign',
    'run',
    file,
    '--target',
    'function:acme-sales',
    '--agent-version',
    'v1',
    '--campaign',
    'source-campaign',
    '--store',
    path,
  ]);
  expect(base.err).toBe('');
  expect(base.code).not.toBe(2);
  return {
    dir,
    file,
    spec,
    cli,
    args: ['campaign', 'rejudge', file, '--from', 'source-campaign', '--store', path],
  };
}

it('labels scoring-only text output with the source of the observations', async () => {
  const { dir, cli, args } = await fixture();
  try {
    const result = await cli([...args, '--campaign', 'rescored', '--use', 'check-set/default']);
    expect(result.err).toBe('');
    expect(result.code).not.toBe(2);
    expect(result.out).toContain('Re-scored; observations from source-campaign');
    expect(result.out).toContain('2 blocks re-scored');
    expect(result.out).toContain('0 agent calls, 0 judge calls');
    expect(result.out).not.toContain('blocks re-judged');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);

it('retains the criterion rejudge text label', async () => {
  const { dir, file, spec, cli, args } = await fixture();
  try {
    const criterion = spec.criteria[0];
    if (!criterion) throw new Error('missing fixture criterion');
    criterion.rubric = 'Do not invent a public holiday.';
    await writeFile(file, JSON.stringify(spec));
    const change = join(dir, 'change.yaml');
    await writeFile(change, 'from: v1\nto: v1\nchanges:\n  - {kind: criterion, id: quote}\n');
    const result = await cli([
      ...args,
      '--campaign',
      'rejudged',
      '--change',
      change,
      '--judge',
      'claude:haiku',
      '--judge-command',
      join(root, 'examples/estates/fixture/live/fake/judge.cjs'),
    ]);
    expect(result.err).toBe('');
    expect(result.code).not.toBe(2);
    expect(result.out).toContain('Campaign rejudged: 1 blocks re-judged, 1 carried; 0 agent calls.');
    expect(result.out).not.toContain('Re-scored;');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);

it.each(['status', 'resume'])(
  'labels re-scored cells and the campaign %s summary',
  async (command) => {
    const { dir, cli, args } = await fixture();
    try {
      const scored = await cli([...args, '--campaign', 'rescored', '--use', 'check-set/default']);
      expect(scored.err).toBe('');
      const result = await cli(['campaign', command, 'rescored', '--store', join(dir, 'runs.db')]);
      expect(result.err).toBe('');
      expect(result.code).not.toBe(2);
      const lines = result.out.split('\n');
      const cell = lines.find((line) => line.includes('repeat 0'));
      const summary = lines.find((line) => line.startsWith('1 cell:'));
      expect(cell).toContain('Re-scored; observations from source-campaign');
      expect(summary).toContain('Re-scored; observations from source-campaign');
      expect(result.out).not.toContain('1 carried');
      expect(result.out).not.toContain('carried from source-campaign');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
  30_000,
);
