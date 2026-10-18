import type { Observed, Spec } from '@agent-nexus/driftbench-core';
import type { Atom } from '@agent-nexus/driftbench-estate';
import { codeAsk, OUTSIDE_ASK } from '@agent-nexus/driftbench-generate';
import { describe, expect, it, vi } from 'vitest';
import { fromRecord, linkOf } from '../../../generate/src/estate/record';
import { disclosedAskReasons } from '../../src/ladders/estate/bank/askfrom';
import type { SuiteSpec } from '../../src/ladders/estate/bank/fixture-suite';
import { genAsksFamily } from '../../src/ladders/estate/bank/loop';
import { actOfAtom } from '../../src/ladders/estate/bank/task-act';
import { envOf } from '../../src/ladders/estate/bank/task-check';
import * as levels from '../../src/ladders/estate/levels';
import * as pipeline from '../../src/ladders/estate/pipeline';

const UNAPPROVED = 'Please run the inventory report.';
const DECLARED = 'berthify the vessel';
const atom = (): Atom =>
  ({
    id: 'guard.harbour',
    kind: 'guard',
    title: 'Harbour guard',
    provenance: { file: 'CLAUDE.md', startLine: 1, endLine: 1, quote: 'Harbour guard', hash: 'harbour' },
    producedBy: 'code',
    role: 'axis',
    approved: true,
    fields: {
      name: 'harbour-check',
      matcher: 'Bash',
      ask: { text: DECLARED, act: { kind: 'guard', name: 'harbour-check', verdict: 'deny' } },
    },
    evidence: [{ type: 'guard', name: 'harbour-check', verdict: 'deny' }],
    enforcement: [],
  }) as Atom;
const observed = (name = 'harbour-check'): Observed =>
  ({
    text: '',
    segments: [],
    toolCalls: [],
    cost: { total: 0 },
    latencyMs: 0,
    runtime: { guards: [{ name, verdict: 'deny' }] },
  }) as Observed;

/** Small fictional input; the source/row checks are real and the recorded-run boundary is mocked. */
function fixture() {
  const guard = atom();
  const built = codeAsk('forced', [guard], []);
  if (!built.text || !built.frame || !built.act) throw new Error('declared guard ask did not render');
  const from = fromRecord({
    askFrom: built.source,
    built: { ...built, frame: built.frame, act: built.act },
    atoms: new Map([[guard.id, guard]]),
  });
  const row = {
    id: 'guard_positive.harbour',
    atomIds: [guard.id],
    cell: {},
    testType: 'guard_positive',
    mode: 'live',
    status: 'approved',
  };
  const spec = {
    id: 'harbour-ask',
    tags: ['ask:code', 'test:guard_positive'],
    blocks: [{ id: 'ask', when: { user: built.text } }],
    metadata: {
      estate: {
        atoms: [guard.id],
        planRow: row.id,
        testType: row.testType,
        ask: 'code',
        askFrom: built.source,
        link: linkOf(guard),
        act: actOfAtom(guard, [guard]),
        from,
      },
    },
  } as unknown as Spec;
  const generated: pipeline.GeneratedSpec = {
    record: {
      id: spec.id,
      path: 'fictional.yaml',
      row: row.id,
      atoms: [guard.id],
      mode: 'live',
      testType: row.testType,
      complete: true,
      markers: [],
      ask: 'code',
      outcome: 'The harbour guard denies the operation.',
      judged: [],
    },
    loaded: { ok: true, path: 'fictional.yaml', spec, hash: 'fictional', warnings: [] },
    text: '',
    errors: [],
    warnings: [],
  };
  const run = {
    estate: { seed: 1 },
    scanned: {
      map: { atoms: [guard], runtime: 'claude-code', hash: 'fictional' },
      match: { hidOf: new Map() },
    },
    plan: { plan: { rows: [row], mapHash: 'fictional' } },
    bank: { situations: [] },
    sessions: { sessions: [] },
    suite: { files: [] },
    specs: [generated],
  } as unknown as pipeline.EstateRun;
  return { run, guard, generated, spec, meta: spec.metadata?.estate as Record<string, unknown> };
}

async function verdict(run: pipeline.EstateRun, trace: Observed | null = observed(), status = 'completed') {
  const mocks = [
    vi.spyOn(pipeline, 'estateRun').mockResolvedValue(run),
    vi
      .spyOn(levels, 'specVerdicts')
      .mockResolvedValue(run.specs.map((spec) => ({ spec, valid: true, complete: true, distinct: true }))),
    vi.spyOn(pipeline, 'replayChecks').mockReturnValue({} as ReturnType<typeof pipeline.replayChecks>),
    vi
      .spyOn(pipeline, 'replayOnFollower')
      .mockResolvedValue({ run: { status, blocks: [{ observed: trace ?? undefined }] } } as Awaited<
        ReturnType<typeof pipeline.replayOnFollower>
      >),
  ];
  try {
    return (await genAsksFamily().evaluate(1)).get('gen.asks.asks-approved');
  } finally {
    for (const mock of mocks) mock.mockRestore();
  }
}
function ask(spec: Spec, value: string) {
  const first = spec.blocks[0];
  if (!first) throw new Error('no ask block');
  first.when = { user: value };
}
function candidate(generated: pipeline.GeneratedSpec): SuiteSpec {
  if (!generated.loaded) throw new Error('no loaded spec');
  return { ...generated.record, spec: generated.loaded.spec };
}
function disclosed(f: ReturnType<typeof fixture>) {
  return disclosedAskReasons(candidate(f.generated), envOf([f.guard], f.run.bank, f.run.sessions));
}
function forcedPhrase(f: ReturnType<typeof fixture>, approved = true) {
  f.run.bank.situations.push({
    id: 'forced-planted',
    title: 'Fictional forced situation',
    use: 'forced',
    atoms: [f.guard.id],
    touches: { created: [], changed: [], deleted: [] },
    phrases: [{ text: 'Please run the harbour task.', lang: 'en', approved }],
  });
}

describe('gen.asks.asks-approved uses structured disclosure and recorded map acts', () => {
  it('accepts an unlisted verb with a declared source and the matching recorded guard act', async () => {
    const f = fixture();
    expect(await verdict(f.run)).toEqual({ pass: true, detail: 'holds' });
  });

  it('rejects an allowed verb whose recorded guard act is wrong', async () => {
    const f = fixture();
    forcedPhrase(f);
    ask(f.spec, 'Please run the harbour task.');
    f.meta.ask = 'bank';
    f.meta.from = { bank: 'forced-planted', phrase: 0 };
    expect(await verdict(f.run)).toEqual({ pass: true, detail: 'holds' });
    expect((await verdict(f.run, observed('other-guard')))?.pass).toBe(false);
  });

  it('rejects missing and unfinished runs even with correct source and act ids', async () => {
    const f = fixture();
    expect((await verdict(f.run, null))?.pass).toBe(false);
    expect((await verdict(f.run, observed(), 'failed'))?.pass).toBe(false);
  });

  it.each([
    [
      'code tag',
      (f: ReturnType<typeof fixture>) => {
        f.spec.tags = ['test:guard_positive'];
      },
    ],
    [
      'code declaration',
      (f: ReturnType<typeof fixture>) => {
        f.meta.ask = 'bank';
      },
    ],
    [
      'source',
      (f: ReturnType<typeof fixture>) => {
        delete f.meta.askFrom;
      },
    ],
    [
      'test tag',
      (f: ReturnType<typeof fixture>) => {
        f.spec.tags = ['ask:code'];
      },
    ],
    [
      'test type',
      (f: ReturnType<typeof fixture>) => {
        f.meta.testType = 'route_positive';
      },
    ],
    [
      'row atoms',
      (f: ReturnType<typeof fixture>) => {
        f.meta.atoms = [f.guard.id, 'other'];
      },
    ],
    [
      'plan row',
      (f: ReturnType<typeof fixture>) => {
        f.meta.planRow = 'donor-row';
      },
    ],
    [
      'map act',
      (f: ReturnType<typeof fixture>) => {
        f.meta.act = { kind: 'guard', name: 'other', verdict: 'deny' };
      },
    ],
  ])('rejects an invalid %s on an otherwise valid disclosure', async (_label, edit) => {
    const f = fixture();
    expect((await verdict(f.run))?.pass).toBe(true);
    edit(f);
    expect((await verdict(f.run))?.pass).toBe(false);
  });

  it.each([undefined, null, 'no-such-situation'])(
    'rejects invented text regardless of its self-reported situation (%s)',
    async (situation) => {
      const f = fixture();
      ask(f.spec, UNAPPROVED);
      Object.assign(f.meta, { askFrom: 'a description', situation });
      expect(await verdict(f.run)).toMatchObject({
        pass: false,
        detail: expect.stringContaining('1 complete specs ask an unapproved phrase'),
      });
    },
  );

  it('rejects a forged disclosure borrowing another existing plan row', async () => {
    const f = fixture();
    f.run.plan.plan.rows.push({
      ...f.run.plan.plan.rows[0],
      id: 'donor-row',
    } as (typeof f.run.plan.plan.rows)[number]);
    f.generated.record.row = 'donor-row';
    expect((await verdict(f.run))?.pass).toBe(false);
  });

  it('rejects an extra cloned spec carrying an invented ask and donor row', async () => {
    const f = fixture();
    f.run.plan.plan.rows.push({
      ...f.run.plan.plan.rows[0],
      id: 'donor-row',
    } as (typeof f.run.plan.plan.rows)[number]);
    const clone = structuredClone(f.generated);
    clone.record.id += '.clone';
    clone.record.row = 'donor-row';
    if (!clone.loaded) throw new Error('missing clone');
    ask(clone.loaded.spec, UNAPPROVED);
    f.run.specs.push(clone);
    expect(await verdict(f.run)).toMatchObject({
      pass: false,
      detail: expect.stringContaining('1 complete specs ask an unapproved phrase'),
    });
  });

  it('permits a code ask only while the live guard bank lacks an approved forced phrase', async () => {
    const f = fixture();
    expect((await verdict(f.run))?.pass).toBe(true);
    forcedPhrase(f);
    expect((await verdict(f.run))?.pass).toBe(false);
    const phrase = f.run.bank.situations[0]?.phrases[0];
    if (!phrase) throw new Error('missing phrase');
    phrase.approved = false;
    expect((await verdict(f.run))?.pass).toBe(true);
  });

  it('rejects a bank phrase approved for another atom', async () => {
    const f = fixture();
    forcedPhrase(f);
    const situation = f.run.bank.situations[0];
    if (!situation) throw new Error('missing situation');
    situation.atoms = ['other-guard'];
    ask(f.spec, situation.phrases[0]?.text ?? '');
    f.meta.from = { bank: situation.id, phrase: 0 };
    expect((await verdict(f.run))?.pass).toBe(false);
  });
});

describe('disclosed asks are re-rendered from source and act identities', () => {
  it('accepts the complete explicit clause without a verb dictionary', () => {
    const f = fixture();
    expect(disclosed(f)).toEqual([]);
  });

  it('rejects changed text even when its words occur in the source', () => {
    const f = fixture();
    ask(f.spec, 'Please the vessel berthify.');
    expect(disclosed(f)).toContain('the ask is not what its frame, shapes and pieces give');
  });

  it('rejects a disclosure naming no atom, a different atom, or a stale source fingerprint', () => {
    for (const source of ['a description', 'guard.other (structured ask)']) {
      const f = fixture();
      f.meta.askFrom = source;
      expect(disclosed(f)).not.toEqual([]);
    }
    const f = fixture();
    (f.meta.from as Record<string, unknown>).fp = 'stale';
    expect(disclosed(f)).not.toEqual([]);
  });

  it('rejects a source declaration carrying the wrong act even if the generated metadata is correct', () => {
    const f = fixture();
    if (!f.guard.fields) throw new Error('missing fields');
    f.guard.fields.ask = { text: DECLARED, act: { kind: 'guard', name: 'other', verdict: 'deny' } };
    expect(disclosed(f)).toContain('the source declares no ask with the map act');
  });

  it.each([
    'Edit',
    'MultiEdit',
    'Write',
    'NotebookEdit',
    'Bash',
    'Read',
    'Glob',
    'Grep',
    'WebFetch',
    'WebSearch',
  ])('binds the %s rendering template to its exact matcher id', (matcher) => {
    const f = fixture();
    if (!f.guard.fields) throw new Error('missing fields');
    delete f.guard.fields.ask;
    f.guard.fields.matcher = matcher;
    const built = codeAsk('forced', [f.guard], []);
    if (!built.text || !built.frame || !built.act) throw new Error('missing tool ask');
    ask(f.spec, built.text);
    f.meta.askFrom = built.source;
    f.meta.from = fromRecord({
      askFrom: built.source,
      built: { ...built, frame: built.frame, act: built.act },
      atoms: new Map([[f.guard.id, f.guard]]),
    });
    expect(disclosed(f)).toEqual([]);
    (f.meta.from as Record<string, unknown>).tool = 'OtherTool';
    expect(disclosed(f)).toContain('the tool template does not belong to the cited guard');
  });

  it('accepts only the exact registered neutral template', () => {
    const f = fixture();
    ask(f.spec, OUTSIDE_ASK);
    f.meta.askFrom = 'neutral';
    f.meta.from = { neutral: 'outside' };
    expect(disclosed(f)).toEqual([]);
    ask(f.spec, `Please ${DECLARED}.`);
    expect(disclosed(f)).not.toEqual([]);
  });
});
