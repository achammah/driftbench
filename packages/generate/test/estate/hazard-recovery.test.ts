import { hazardRecovery } from '@agent-nexus/driftbench-checks';
import { type CheckContext, type Observed, parseSpecText, type ToolCall } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { type EstateGenerateInput, generateEstateSuite } from '../../src/estate/generate';

const samples = [
  { kind: 'compaction', quote: 'After compaction, re-read this file before continuing.', read: 'POLICY.md' },
  {
    kind: 'restart',
    quote: 'After a process restart, run `node tools/recover.mjs`.',
    command: 'node tools/recover.mjs',
  },
  { kind: 'rate_wave', quote: 'After a rate limit, retry the failed request.', retry: true },
  {
    kind: 'session_boundary',
    quote: 'At the start of every session, read `notes/context.md`.',
    read: 'notes/context.md',
  },
  {
    kind: 'notification',
    quote: 'On a helper notification, read `notes/helper.md`.',
    read: 'notes/helper.md',
  },
  {
    kind: 'nudge_storm',
    quote: 'After repeated nudges, execute `node tools/inspect.mjs`.',
    command: 'node tools/inspect.mjs',
  },
] as const;

function generate(kind: string, quote: string, seed = 1, declared: Record<string, unknown> = {}) {
  const atom = {
    id: 'hazard.archive.recovery',
    kind: 'hazard',
    title: 'Recover the archive session',
    approved: true,
    fields: { hazard: kind },
    provenance: { quote, file: 'POLICY.md' },
    evidence: [{ type: 'custom' as const, name: 'hazard_recovery', options: { ...declared, hazard: kind } }],
  };
  const input: EstateGenerateInput = {
    map: { runtime: 'claude-code', hash: 'archive-recovery', atoms: [atom] },
    plan: {
      mapHash: 'archive-recovery',
      rows: [
        {
          id: 'recover',
          atomIds: [atom.id],
          cell: {},
          testType: 'hazard_recovery',
          mode: 'live',
          status: 'approved',
        },
      ],
    },
    bank: {
      version: 1,
      estate: 'archive',
      mapHash: 'archive-recovery',
      deviations: [],
      workspaces: [],
      situations: [
        {
          id: 'recover',
          title: 'Continue archive review',
          use: 'trigger',
          atoms: [atom.id],
          phrases: [{ text: 'Continue reviewing the archive.', lang: 'en', approved: true }],
          touches: { created: [], changed: [], deleted: [] },
        },
      ],
    },
  };
  const generated = generateEstateSuite(input, {
    seed,
    judge: false,
    paths: { map: 'map.yaml', plan: 'plan.yaml', phrases: 'phrases.yaml' },
  });
  const file = generated.files.find((f) => f.path.endsWith('.yaml'));
  if (!file) throw new Error('missing generated spec');
  const parsed = parseSpecText(file.text, 'yaml', file.path);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return { generated, spec: parsed.spec };
}
const call = (label: string, input: unknown, error?: string): ToolCall => ({
  id: 'fictional',
  label,
  input,
  ...(error ? { error } : {}),
});
async function evaluate(
  kind: string,
  options: unknown,
  calls: ToolCall[],
  boundary = 0,
  history: ToolCall[] = [],
) {
  const observed = {
    text: 'Continuing.',
    segments: [],
    toolCalls: calls,
    cost: {},
    latencyMs: 0,
    workspaceDiff: { created: [], changed: [], deleted: [] },
    raw: { markers: [{ kind, afterToolCalls: boundary }] },
  } as unknown as Observed;
  const result = await hazardRecovery(
    {
      observed,
      blockIndex: 0,
      history: history.length ? [{ observed: { toolCalls: history } }] : [],
    } as unknown as CheckContext,
    options,
  );
  return Array.isArray(result) ? result : [result];
}

describe('handwritten archive hazards assert recovery, not a generic continuation', () => {
  it('keeps quoted retry targets on their original tool instead of inventing a shell command', async () => {
    for (const target of ['https://example.invalid/catalogue', 'Fetch']) {
      const { spec } = generate('rate_wave', `After a rate limit, retry \`${target}\`.`, 1, { retry: true });
      const options = spec.rules?.custom?.hazard_recovery as Record<string, unknown>;
      expect(options.calls).toBeUndefined();
      const request = { url: 'https://example.invalid/catalogue' };
      expect(
        (
          await evaluate('rate_wave', options, [call('Fetch', request)], 0, [
            call('Fetch', request, 'rate limited'),
          ])
        ).every((verdict) => verdict.outcome === 'pass'),
      ).toBe(true);
    }
  });
  it('retains bare recovery filenames with arbitrary extensions and multiple dots', () => {
    const { generated, spec } = generate(
      'session_boundary',
      'At each session boundary, read notes/archive.index.CFG.',
      1,
      { reread: ['notes/archive.index.CFG'] },
    );
    expect(generated.specs[0]?.complete).toBe(true);
    expect(spec.rules?.custom?.hazard_recovery).toMatchObject({ reread: ['notes/archive.index.CFG'] });
  });
  it('does not treat an empty path or zero required calls as a recovery obligation', () => {
    const { generated, spec } = generate('restart', 'Resume safely.', 1, {
      reread: [''],
      calls: [{ label: 'Read', input: {}, count: 0 }],
    });
    expect(generated.specs[0]?.complete).toBe(false);
    expect(spec.rules?.custom?.hazard_recovery).toBeUndefined();
  });
  for (const sample of samples) {
    it(sample.kind, async () => {
      for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 1019]) {
        const { generated, spec } = generate(
          sample.kind,
          sample.quote,
          seed,
          'read' in sample
            ? { reread: [sample.read] }
            : 'command' in sample
              ? { calls: [{ label: 'Bash', input: { command: { contains: sample.command } } }] }
              : { retry: true },
        );
        expect(generated.specs[0]?.complete).toBe(true);
        const options = spec.rules?.custom?.hazard_recovery as Record<string, unknown>;
        expect(!!options.reread || !!options.calls || options.retry === true).toBe(true);
        const recovering =
          'read' in sample
            ? call('Read', { file_path: `/work/${sample.read}` })
            : 'command' in sample
              ? call('Bash', { command: sample.command })
              : call('Fetch', { url: 'https://example.invalid/catalogue' });
        const failed = call('Fetch', { url: 'https://example.invalid/catalogue' }, 'rate limited');
        const history = 'retry' in sample ? [failed] : [];
        expect(
          (await evaluate(sample.kind, options, [recovering], 0, history)).every((v) => v.outcome === 'pass'),
        ).toBe(true);
        expect((await evaluate(sample.kind, options, [], 0, history)).some((v) => v.outcome === 'fail')).toBe(
          true,
        );
        expect(
          (await evaluate(sample.kind, options, [recovering], 1, history)).some((v) => v.outcome === 'fail'),
        ).toBe(true);
      }
    });
    it(`${sample.kind} fails closed when its contract names no assertable action`, () => {
      const { generated, spec } = generate(sample.kind, 'Recover appropriately when interrupted.');
      expect(generated.specs[0]?.complete).toBe(false);
      expect(generated.report.gaps.some((g) => g.marker === 'needs-registered-check')).toBe(true);
      expect(spec.rules?.custom?.hazard_recovery).toBeUndefined();
    });
  }
  for (const quote of [
    'After restart, never run `node tools/unsafe.mjs`.',
    'After restart, do not blindly run `node tools/unsafe.mjs`.',
    'After restart, you may read `notes/context.md`.',
    'After restart, the retry policy mentions `notes/context.md`.',
  ])
    it(`does not invent a required action from: ${quote}`, () => {
      const { generated, spec } = generate('restart', quote);
      expect(generated.specs[0]?.complete).toBe(false);
      expect(spec.rules?.custom?.hazard_recovery).toBeUndefined();
    });
  it('does not accept a different input as retrying the failed request', async () => {
    const { spec } = generate('rate_wave', 'After a rate limit, retry the failed request.', 1, {
      retry: true,
    });
    const verdicts = await evaluate(
      'rate_wave',
      spec.rules?.custom?.hazard_recovery,
      [call('Fetch', { url: 'https://example.invalid/other' })],
      0,
      [call('Fetch', { url: 'https://example.invalid/catalogue' }, 'rate limited')],
    );
    expect(verdicts.some((v) => v.outcome === 'fail')).toBe(true);
  });
});
