import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { type Atom, type EstateMap, mapHash, provenanceHash } from '@agent-nexus/driftbench-estate';
import { openStore } from '@agent-nexus/driftbench-store';
import { Command } from 'commander';
import { expect, it } from 'vitest';
import { defaultDeps, registerCampaignCommands } from '../src/commands/campaign';
import { main } from '../src/index';

it('carries every verdict for a proved estate no-op, but reruns an unproved empty version transition', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'astra-chain11-carry-'));
  const storePath = join(dir, 'runs.db');
  const quotes = ['Read a file before editing it.', 'Never send drafts without approval.'];
  const atoms: Atom[] = quotes.map((quote, index) => {
    const id = index === 0 ? 'R3' : 'R2';
    const provenance = { file: 'CLAUDE.md', startLine: index + 1, endLine: index + 1, quote };
    return {
      id,
      kind: 'instruction',
      title: id,
      provenance: { ...provenance, hash: provenanceHash(provenance) },
      producedBy: 'code',
      role: 'axis',
      approved: true,
      evidence: [{ type: 'text', must: ['good'] }],
      enforcement: [],
    };
  });
  const map: EstateMap = {
    version: 1,
    runtime: 'claude-code',
    root: '.',
    readAt: '2026-10-18T00:00:00.000Z',
    atoms,
    edges: [],
    hash: mapHash(atoms, []),
  };
  const before = `${quotes.join('\n')}\n`;
  try {
    await Promise.all([
      writeFile(join(dir, 'old.md'), before),
      writeFile(join(dir, 'new.md'), before.replace('before editing', 'before  editing')),
      writeFile(join(dir, 'map.json'), JSON.stringify(map)),
      ...atoms.map((atom, index) =>
        writeFile(
          join(dir, `${atom.id}.json`),
          JSON.stringify({
            id: atom.id,
            kind: 'conversation',
            metadata: { estate: { atoms: [atom.id] } },
            blocks: [
              {
                when: { user: 'Check this fictional rule.' },
                expect: { must: [index === 0 ? '^good$' : '^blocked$'] },
              },
            ],
          }),
        ),
      ),
      writeFile(join(dir, 'manual.json'), JSON.stringify({ from: 'v1', to: 'v2', changes: [] })),
    ]);
    let autoOut = '',
      autoErr = '';
    const autoCode = await main(
      [
        'radius',
        'auto',
        '--prompt',
        'old.md',
        'new.md',
        '--map',
        'map.json',
        '--source',
        'CLAUDE.md',
        '--from-version',
        'v1',
        '--to-version',
        'v2',
        '--out',
        'proved.yaml',
      ],
      {
        cwd: dir,
        out: (text) => {
          autoOut += text;
        },
        err: (text) => {
          autoErr += text;
        },
      },
    );
    expect({ code: autoCode, out: autoOut, err: autoErr }).toEqual({ code: 0, out: '', err: '' });

    async function campaign(id: string, version: string, change?: string) {
      let code = 0,
        out = '',
        err = '',
        opens = 0,
        sends = 0;
      const program = new Command('driftbench').exitOverride();
      registerCampaignCommands(
        program,
        {
          cwd: dir,
          out: (text) => {
            out += text;
          },
          err: (text) => {
            err += text;
          },
        },
        (value) => {
          code = value;
        },
        {
          ...defaultDeps,
          adapterFor: async () => {
            const adapter = functionAdapter({
              respond: () => {
                sends++;
                return { text: 'good', segments: [], toolCalls: [], cost: {}, latencyMs: 0 };
              },
            });
            const open = adapter.open.bind(adapter);
            adapter.open = async (given) => {
              opens++;
              return open(given);
            };
            return adapter;
          },
        },
      );
      await program.parseAsync(
        [
          'campaign',
          'run',
          'R3.json',
          'R2.json',
          '--target',
          'function:fictional-estate',
          '--agent-version',
          version,
          '--campaign',
          id,
          '--store',
          storePath,
          '--mode',
          'F',
          '--repeats',
          '1',
          '--concurrency',
          '1',
          '--no-cache',
          '--json',
          ...(change ? ['--change', change, '--from', 'base'] : []),
        ],
        { from: 'user' },
      );
      expect(err).toBe('');
      const report = JSON.parse(out) as {
        cells: Array<{ specId: string; reused: boolean }>;
        summary: { pass: number; fail: number; failed: number; pending: number };
        radius?: { fresh: number; carried: number };
      };
      const store = openStore(storePath);
      try {
        return { code, opens, sends, report, runs: await store.listRuns({ campaignId: id }) };
      } finally {
        store.close();
      }
    }

    const baseline = await campaign('base', 'v1');
    expect(baseline).toMatchObject({ code: 1, opens: 2, sends: 2 });
    expect(baseline.report.summary).toMatchObject({ pass: 1, fail: 1, failed: 0, pending: 0 });
    expect(baseline.runs).toHaveLength(2);
    expect(baseline.runs.every((run) => run.carried === undefined)).toBe(true);
    expect(
      baseline.runs.flatMap((run) => run.blocks.flatMap((block) => block.verdicts)).length,
    ).toBeGreaterThan(0);
    const original = new Map(baseline.runs.map((run) => [run.specId, run]));

    const carried = await campaign('proved-noop', 'v2', 'proved.yaml');
    expect(carried).toMatchObject({ code: 1, opens: 0, sends: 0 });
    expect(carried.report.radius).toMatchObject({ fresh: 0, carried: 2 });
    expect(carried.report.summary).toMatchObject({ pass: 1, fail: 1, failed: 0, pending: 0 });
    expect(carried.report.cells).toHaveLength(2);
    expect(carried.report.cells.every((cell) => cell.reused)).toBe(true);
    expect(carried.runs).toHaveLength(2);
    for (const run of carried.runs) {
      const source = original.get(run.specId);
      expect(source).toBeDefined();
      expect(run.carried).toMatchObject({
        fromCampaign: 'base',
        fromRun: source?.runId,
        agentVersion: 'v1',
        age: { campaigns: 1 },
      });
      expect(run.runId).not.toBe(source?.runId);
      expect(run.blocks).toEqual(source?.blocks);
      expect(run.status).toBe(source?.status);
      expect(run.endState).toEqual(source?.endState);
    }

    const manual = await campaign('manual-empty', 'v2', 'manual.json');
    expect(manual).toMatchObject({ code: 1, opens: 2, sends: 2 });
    expect(manual.report.radius).toMatchObject({ fresh: 2, carried: 0 });
    expect(manual.report.cells).toHaveLength(2);
    expect(manual.report.cells.every((cell) => !cell.reused)).toBe(true);
    expect(manual.runs).toHaveLength(2);
    expect(manual.runs.every((run) => run.carried === undefined)).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);
