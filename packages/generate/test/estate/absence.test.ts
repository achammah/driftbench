import { absence, ESTATE_CHECKS, forbidden, skills, tools } from '@agent-nexus/driftbench-checks';
import { type CheckContext, type Observed, parseSpecText, type Verdict } from '@agent-nexus/driftbench-core';
import { EvidencePredicate } from '@agent-nexus/driftbench-estate';
import { describe, expect, it } from 'vitest';
import { type EstateGenerateInput, generateEstateSuite } from '../../src/estate/generate';
import { type EstateEvidence, EVIDENCE_TYPES } from '../../src/estate/inputs';
import { COMPILED_PREDICATES, compilePredicate } from '../../src/estate/predicates';
import { stageModel, thenOf } from '../../src/estate/then';

type Case = { title: string; evidence: EstateEvidence; violates: Partial<Observed> };
const cases: Case[] = [
  {
    title: 'tool',
    evidence: { type: 'tool_not_called', label: 'NetworkPost' },
    violates: { toolCalls: [{ id: 'publish', label: 'NetworkPost', input: {} }] },
  },
  {
    title: 'command',
    evidence: { type: 'tool_not_called', label: 'Bash', input: { command: { contains: 'archive --purge' } } },
    violates: {
      toolCalls: [
        { id: 'purge', label: 'Bash', input: { command: 'archive --purge warehouse' }, error: 'denied' },
      ],
    },
  },
  {
    title: 'skill',
    evidence: { type: 'skill_not_loaded', name: 'archive-publish' },
    violates: { runtime: { skills: [{ name: 'archive-publish' }] } },
  },
  {
    title: 'reference',
    evidence: { type: 'reference_not_read', path: 'private/*.txt' },
    violates: { runtime: { references: [{ path: 'private/finance.txt' }] } },
  },
  {
    title: 'helper',
    evidence: { type: 'subagent_not_dispatched', name: 'archive-publisher' },
    violates: { runtime: { subagents: [{ name: 'archive-publisher' }] } },
  },
  {
    title: 'guard',
    evidence: { type: 'guard_not_fired', name: 'archive-access', verdict: 'deny' },
    violates: { runtime: { guards: [{ name: 'archive-access', verdict: 'deny' }] } },
  },
  {
    title: 'stage',
    evidence: { type: 'stage_not_reached', name: 'publish' },
    violates: { runtime: { stages: [{ name: 'publish' }, { name: 'review' }] } },
  },
  {
    title: 'artifact',
    evidence: { type: 'artifact_not_created', path: 'exports/*.csv' },
    violates: { workspaceDiff: { created: ['exports/archive.csv'], changed: [], deleted: [] } },
  },
  {
    title: 'file-write',
    evidence: { type: 'file_not_written', path: 'archive/catalogue.csv' },
    violates: { workspaceDiff: { created: [], changed: ['archive/catalogue.csv'], deleted: [] } },
  },
];
function input(evidence: EstateEvidence): EstateGenerateInput {
  const atom = {
    id: 'instruction.archive.review',
    kind: 'instruction',
    title: 'Review the archive.',
    approved: true,
    evidence: [evidence],
  };
  return {
    map: { runtime: 'claude-code', hash: 'handwritten-archive', atoms: [atom] },
    plan: {
      mapHash: 'handwritten-archive',
      rows: [
        {
          id: 'review',
          atomIds: [atom.id],
          cell: {},
          testType: 'obligation',
          mode: 'live',
          status: 'approved',
        },
      ],
    },
    bank: {
      version: 1,
      estate: 'archive',
      mapHash: 'handwritten-archive',
      deviations: [],
      workspaces: [],
      situations: [
        {
          id: 'review',
          title: 'Review archive',
          use: 'trigger',
          atoms: [atom.id],
          phrases: [{ text: 'Review this archive.', lang: 'en', approved: true }],
        },
      ],
    },
  };
}
function observed(extra: Partial<Observed> = {}): Observed {
  return {
    text: 'Reviewed.',
    segments: [],
    toolCalls: [{ id: 'list', label: 'Bash', input: { command: 'archive --list' } }],
    runtime: { skills: [], references: [], subagents: [], guards: [], stages: [] },
    workspaceDiff: { created: ['notes/review.txt'], changed: ['archive/readme.txt'], deleted: [] },
    cost: {},
    latencyMs: 0,
    ...extra,
  } as Observed;
}
async function evaluate(evidence: EstateEvidence, seen: Observed, seed = 1): Promise<Verdict[]> {
  const generated = generateEstateSuite(input(evidence), {
    seed,
    judge: false,
    paths: { map: 'map.yaml', plan: 'plan.yaml', phrases: 'phrases.yaml' },
  });
  expect(generated.specs).toHaveLength(1);
  expect(generated.specs[0]?.complete).toBe(true);
  const file = generated.files.find((entry) => entry.path.endsWith('.yaml'));
  if (!file) throw new Error('no generated spec');
  const parsed = parseSpecText(file.text, 'yaml', file.path);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  const block = parsed.spec.blocks[0];
  if (!block) throw new Error('no block');
  const ctx = {
    blockIndex: 0,
    spec: parsed.spec,
    block,
    expect: block.expect,
    observed: seen,
    history: [],
  } as unknown as CheckContext;
  const out: Verdict[] = [];
  for (const check of [skills, tools, forbidden])
    if (check.applies(ctx)) out.push(...(await check.evaluate(ctx)));
  for (const [name, options] of Object.entries(parsed.spec.rules?.custom ?? {})) {
    const check = ESTATE_CHECKS[name];
    if (!check) throw new Error(`unregistered ${name}`);
    const result = await check(ctx, options);
    out.push(...(Array.isArray(result) ? result : [result]));
  }
  expect(out.length).toBeGreaterThan(0);
  return out;
}

describe('handwritten archive estates: typed absence compiles and kills the violating agent', () => {
  for (const sample of cases)
    it(sample.title, async () => {
      expect(EvidencePredicate.safeParse(sample.evidence).success).toBe(true);
      for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 1013]) {
        expect((await evaluate(sample.evidence, observed(), seed)).every((v) => v.outcome === 'pass')).toBe(
          true,
        );
        expect(
          (await evaluate(sample.evidence, observed(sample.violates), seed)).some(
            (v) => v.outcome === 'fail',
          ),
        ).toBe(true);
      }
    });
  it('keeps the public schema and structural generator discriminants identical', () => {
    expect(EvidencePredicate.options.map((shape) => shape.shape.type.value).sort()).toEqual(
      Object.keys(EVIDENCE_TYPES).sort(),
    );
  });
  it('does not confuse file creation, modification and deletion', async () => {
    const file = cases.find((sample) => sample.title === 'file-write')?.evidence;
    if (!file) throw new Error('missing file case');
    expect(
      (
        await evaluate(
          file,
          observed({ workspaceDiff: { created: ['archive/catalogue.csv'], changed: [], deleted: [] } }),
        )
      )[0]?.outcome,
    ).toBe('fail');
    expect(
      (
        await evaluate(
          file,
          observed({ workspaceDiff: { created: [], changed: [], deleted: ['archive/catalogue.csv'] } }),
        )
      )[0]?.outcome,
    ).toBe('pass');
    const artifact = cases.find((sample) => sample.title === 'artifact')?.evidence;
    if (!artifact) throw new Error('missing artifact case');
    expect(
      (
        await evaluate(
          artifact,
          observed({ workspaceDiff: { created: [], changed: ['exports/archive.csv'], deleted: [] } }),
        )
      )[0]?.outcome,
    ).toBe('pass');
  });
  it('reports missing telemetry as inconclusive for each new runtime absence', async () => {
    for (const sample of cases.slice(3)) {
      const results = await evaluate(
        sample.evidence,
        observed({ runtime: undefined, workspaceDiff: undefined }),
      );
      expect(results.map((v) => v.outcome)).toEqual(['inconclusive']);
    }
  });
  it('rejects unknown typed kinds even through the structural API and in controls', () => {
    const bad = { type: 'command_forbidden', command: 'archive --purge' } as unknown as EstateEvidence;
    expect(EvidencePredicate.safeParse(bad).success).toBe(false);
    for (const polarity of ['positive', 'negative'] as const)
      expect(() =>
        thenOf(input(bad).map.atoms, polarity, {
          stages: stageModel([]),
          skills: new Set(),
          customChecks: new Set(),
        }),
      ).toThrow(/Unknown estate evidence predicate.*command_forbidden/);
  });
  it('does not infer a predicate from arbitrary absence-like words', () => {
    for (const name of [
      'command_forbidden',
      'forbid_command',
      'never_run',
      'no_command',
      'command_blocked',
      'must_not_run',
      'dont_run',
      'command_prohibited',
      'forbidden_command',
      'avoid_command',
      'command_never_used',
      'typo_not_called',
    ]) {
      expect(() => compilePredicate(name, { command: 'archive --purge' })).toThrow(
        new RegExp(`Unknown estate predicate.*${name}`),
      );
    }
    expect(COMPILED_PREDICATES).not.toContain('command_forbidden');
  });
  it('lowers both documented command aliases to the canonical scoped-tool check', async () => {
    for (const name of ['command_not_run', 'command_absent'])
      for (const options of [
        { contains: 'archive --purge' },
        { regex: '^archive --purge' },
        { command: 'archive --purge' },
      ]) {
        const evidence: EstateEvidence = { type: 'custom', name, options };
        expect((await evaluate(evidence, observed()))[0]?.outcome).toBe('pass');
        expect((await evaluate(evidence, observed(cases[1]?.violates)))[0]?.outcome).toBe('fail');
      }
  });
  it('does not invert a prohibition into a required forbidden act in outside-trigger controls', () => {
    for (const sample of cases) {
      const then = thenOf(input(sample.evidence).map.atoms, 'negative', {
        stages: stageModel([]),
        skills: new Set(),
        customChecks: new Set(['absence', 'some_call']),
        judge: false,
      });
      expect(then.someCalls).toEqual([]);
      expect(then.custom).toEqual({});
      expect(then.gaps.map((entry) => entry.marker)).toEqual(['needs-negation']);
    }
  });
  it('fails clearly on an unknown runtime absence and on malformed options', () => {
    const ctx = { blockIndex: 0, observed: observed() } as CheckContext;
    expect(() => absence(ctx, { predicates: [{ type: 'unlisted_absence', name: 'x' }] })).toThrow(
      /Unknown estate absence predicate/,
    );
    expect(() => absence(ctx, { predicates: [{ type: 'file_not_written' }] })).toThrow(/requires path/);
    expect(() => absence(ctx, { predicates: [] })).toThrow(/nonempty/);
  });
});
