import { runChild } from '../../kit/child-run';
import type { ScaleOp, ScaleOut, ScaleSpec } from '../../kit/scale';
import { fail, type ItemContext, type Outcome, pass, type Run } from '../types';

/**
 * Scale: each item runs in a child process, checks correctness first, then the clock and the memory. The budgets are
 * the bank's own (design says none). 1x is 300 units, 10x 3,000, 100x 30,000.
 */

const memo = new Map<string, Promise<{ out?: ScaleOut; error?: string; wallMs: number }>>();

function run(ctx: ItemContext, job: ScaleOp): Promise<{ out?: ScaleOut; error?: string; wallMs: number }> {
  const key = `${ctx.sut.name}|${process.env.DRIFTBENCH_POINTER_SUT ?? ''}|${JSON.stringify(job)}`;
  let known = memo.get(key);
  if (!known) {
    known = (async () => {
      const child = await runChild({ kind: 'scale', ...job }, { timeoutMs: 600_000 });
      try {
        if (child.timedOut) return { error: 'the child did not finish within 10 minutes', wallMs: child.ms };
        const o = child.output;
        if (!o) return { error: `the child gave no output: ${child.stderr.slice(0, 300)}`, wallMs: child.ms };
        if (!o.ok) return { error: o.error, wallMs: child.ms };
        return { out: o.result as ScaleOut, wallMs: child.ms };
      } finally {
        child.cleanup();
      }
    })();
    memo.set(key, known);
  }
  return known;
}

const SEED = 1;
const est = (files: number, perFile: number, extra: Partial<ScaleSpec> = {}): ScaleSpec => ({
  seed: SEED,
  files,
  perFile,
  ...extra,
});
const X1 = est(6, 50);
const X10 = est(10, 300);
const X100 = est(100, 300);

type Budget = { ms?: number; msIndex?: number; mb?: number };
const check = (out: ScaleOut, budget: Budget): string | undefined => {
  const ms = out.ms[budget.msIndex ?? out.ms.length - 1] ?? 0;
  if (budget.ms !== undefined && ms > budget.ms)
    return `took ${Math.round(ms)} ms, the budget is ${budget.ms} ms`;
  const mb = out.maxRssKb / 1024;
  if (budget.mb !== undefined && mb > budget.mb)
    return `peaked at ${Math.round(mb)} MB, the budget is ${budget.mb} MB`;
  return undefined;
};

async function viaChild(
  ctx: ItemContext,
  job: ScaleOp,
  verify: (out: ScaleOut) => string | undefined,
  budget: Budget,
): Promise<Outcome> {
  const r = await run(ctx, job);
  if (!r.out) return fail(r.error ?? 'no result');
  const wrong = verify(r.out);
  if (wrong) return fail(wrong);
  const over = check(r.out, budget);
  return over
    ? fail(`correct but ${over}`)
    : pass(`${Math.round(r.out.ms.at(-1) ?? 0)} ms, ${Math.round(r.out.maxRssKb / 1024)} MB`);
}

const cutOk = (out: ScaleOut) =>
  out.extra.total === out.extra.expected
    ? undefined
    : `${String(out.extra.total)} units cut, expected ${String(out.extra.expected)}`;

const scanOkVerify = (out: ScaleOut) => {
  if (out.live[0] !== out.extra.expectedLive)
    return `${out.live[0]} live entries, expected ${String(out.extra.expectedLive)}`;
  if (out.extra.badLabels !== 0)
    return `${String(out.extra.badLabels)} sampled labels differ from the planted truth`;
  return out.calls[0] === out.extra.windows
    ? undefined
    : `${out.calls[0]} labeller calls for ${String(out.extra.windows)} windows`;
};

/** Verifies a rescan against the edits: the ladder's answer for each edited unit and no collateral change. */
function rescanOk(kind: 'reword' | 'move' | 'rewrite' | 'none', max?: { calls?: number }) {
  return (out: ScaleOut): string | undefined => {
    const [s1, s2] = out.slims;
    const edits = (out.extra.edits ?? []) as Array<{ kind: string; from: string; to?: string }>;
    if (!s1 || !s2) return 'the child gave no ledgers';
    if (
      !(Number(out.extra.expectedLive) > 0) ||
      out.live[0] !== out.extra.expectedLive ||
      out.live[1] !== out.extra.expectedLive
    )
      return 'positive witness: both scans must retain all planted live units';
    const byQuote1 = new Map(s1.map(([id, , q]) => [q, id]));
    const byId2 = new Map(s2.map(([id, st, q]) => [id, { st, q }]));
    const live2 = s2.filter(([, st]) => st === 'live');
    if (new Set(live2.map(([id]) => id)).size !== live2.length) return 'two live entries share an id';
    let changedIds = 0;
    for (const [id, q] of s1.map(([i, , q]) => [i, q] as const)) {
      const now = byId2.get(id);
      if (!now) return `the id ${id} is gone from the ledger`;
      if (now.st === 'live' && now.q !== q) changedIds += 1;
    }
    if (kind === 'none') {
      if (out.extra.sameBytes !== true) return 'rescanning unchanged files rewrote the ledger';
      return out.calls[1] === 0 ? undefined : `${out.calls[1]} labeller calls on unchanged files`;
    }
    for (const e of edits) {
      const id = byQuote1.get(e.from);
      const now = id ? byId2.get(id) : undefined;
      if (!id || !now) return 'an edited unit has no old id';
      if (kind === 'reword' && !(now.st === 'live' && now.q === e.to)) return 'a reworded unit lost its id';
      if (kind === 'move' && !(now.st === 'live' && now.q === e.from)) return 'a moved unit lost its id';
      if (kind === 'rewrite' && now.st === 'live') return 'a rewritten unit was carried by the ladder';
    }
    if (kind === 'reword' && changedIds !== edits.length)
      return `${changedIds} units changed text under their id, expected ${edits.length}`;
    if (kind === 'rewrite') {
      const fresh = live2.filter(([id]) => !byId2.has(id) || !s1.some(([i]) => i === id)).length;
      if (fresh < edits.length) return `${fresh} fresh ids for ${edits.length} rewrites`;
    }
    if (max?.calls !== undefined && (out.calls[1] ?? 0) > max.calls)
      return `${out.calls[1]} labeller calls, at most ${max.calls} windows are dirty`;
    return undefined;
  };
}

const growth = async (
  ctx: ItemContext,
  op: (spec: ScaleSpec) => ScaleOp,
  pick: (out: ScaleOut) => number,
  verify: (out: ScaleOut) => string | undefined,
): Promise<Outcome> => {
  const a = await run(ctx, op(X10));
  const b = await run(ctx, op(X100));
  if (!a.out || !b.out) return fail(a.error ?? b.error ?? 'no result');
  const wrong = verify(a.out) ?? verify(b.out);
  if (wrong) return fail(`positive witness: ${wrong}`);
  const t10 = pick(a.out);
  const t100 = pick(b.out);
  if (t10 < 300) return pass(`the 10x run took ${Math.round(t10)} ms: too fast to compare`);
  return t100 / t10 <= 40
    ? pass(`ratio ${(t100 / t10).toFixed(1)}`)
    : fail(
        `time grew ${(t100 / t10).toFixed(1)} times from 10x to 100x, the bound is 40 (n to the power 1.6)`,
      );
};

const editSpec = (
  spec: ScaleSpec,
  kind: 'reword' | 'move' | 'rewrite',
  share: number,
  dup?: number,
): ScaleSpec => ({ ...spec, edit: { kind, share }, ...(dup ? { dupShare: dup } : {}) });
const rescan = (spec: ScaleSpec): ScaleOp => ({ op: 'rescan', spec });

export const scaleRuns: Record<string, Run> = {
  'cut-1x': (ctx) => viaChild(ctx, { op: 'cut', spec: X1 }, cutOk, { ms: 1000, mb: 450 }),
  'cut-10x': (ctx) => viaChild(ctx, { op: 'cut', spec: X10 }, cutOk, { ms: 4000, mb: 600 }),
  'cut-100x': (ctx) => viaChild(ctx, { op: 'cut', spec: X100 }, cutOk, { ms: 25_000, mb: 1200 }),
  'scan-10x': (ctx) => viaChild(ctx, { op: 'scan', spec: X10 }, scanOkVerify, { ms: 8000 }),
  'scan-100x': (ctx) => viaChild(ctx, { op: 'scan', spec: X100 }, scanOkVerify, { ms: 60_000, mb: 1500 }),
  'rescan-unchanged-100x': (ctx) => viaChild(ctx, rescan(X100), rescanOk('none'), { ms: 30_000 }),
  'rescan-edit-1pct-10x': (ctx) =>
    viaChild(ctx, rescan(editSpec(X10, 'reword', 0.01)), rescanOk('reword', { calls: 10 }), { ms: 8000 }),
  'rescan-edit-1pct-100x': (ctx) =>
    viaChild(ctx, rescan(editSpec(X100, 'reword', 0.01)), rescanOk('reword', { calls: 100 }), { ms: 40_000 }),
  'rescan-move-100x': (ctx) =>
    viaChild(ctx, rescan(editSpec(X100, 'move', 0.01)), rescanOk('move'), { ms: 40_000 }),
  'rescan-duplicates-100x': (ctx) =>
    viaChild(ctx, rescan(editSpec(X100, 'reword', 0.01, 0.13)), rescanOk('reword'), { ms: 40_000 }),
  'rescan-rewrite-10pct-10x': (ctx) =>
    viaChild(ctx, rescan(editSpec(X10, 'rewrite', 0.1)), rescanOk('rewrite'), { ms: 30_000 }),
  'rescan-rewrite-10pct-100x': (ctx) =>
    viaChild(ctx, rescan(editSpec(X100, 'rewrite', 0.1)), rescanOk('rewrite'), { ms: 120_000 }),
  'ledger-canonical-100x': (ctx) => viaChild(ctx, rescan(X100), rescanOk('none'), { ms: 60_000, msIndex: 0 }),
  'links-100x': (ctx) =>
    viaChild(
      ctx,
      { op: 'links', spec: editSpec(X100, 'reword', 0.01) },
      (o) =>
        o.extra.suspect === o.extra.expectedSuspect && o.extra.wrong === 0
          ? undefined
          : `${String(o.extra.suspect)} suspect links (${String(o.extra.wrong)} wrong), expected ${String(o.extra.expectedSuspect)}`,
      { ms: 20_000 },
    ),
  'radius-100x': (ctx) =>
    viaChild(
      ctx,
      { op: 'radius', spec: X100, blocks: 50_000, deletes: 100 },
      (o) =>
        o.extra.same === true
          ? undefined
          : `the rerun set holds ${String(o.extra.got)} blocks, expected ${String(o.extra.want)}`,
      { ms: 20_000 },
    ),
  'replay-100x': (ctx) =>
    viaChild(
      ctx,
      { op: 'replay', spec: X100 },
      (o) => {
        if (
          o.live[0] !== o.extra.expectedLive ||
          o.live[1] !== o.extra.expectedLive ||
          Number(o.extra.entries) <= 0
        )
          return 'positive witness: record and replay must retain the planted units and a cassette';
        return o.extra.calls === 0 && o.extra.same === true
          ? undefined
          : `replay: ${String(o.extra.calls)} calls, same ledger ${String(o.extra.same)} ${String(o.extra.error ?? '')}`;
      },
      { ms: 40_000 },
    ),
  'long-paragraph': (ctx) =>
    viaChild(
      ctx,
      { op: 'long-paragraph', sentences: 12_000 },
      (o) =>
        o.units === o.extra.expected && o.extra.exact === true
          ? undefined
          : `${o.units} units for ${String(o.extra.expected)} sentences`,
      { ms: 10_000 },
    ),
  'wide-table': (ctx) =>
    viaChild(
      ctx,
      { op: 'wide-table', rows: 99, cols: 100 },
      (o) =>
        o.units === o.extra.expected ? undefined : `${o.units} cells, expected ${String(o.extra.expected)}`,
      { ms: 10_000 },
    ),
  'many-small-files': (ctx) =>
    viaChild(
      ctx,
      { op: 'scan', spec: est(5000, 6) },
      (o) => (o.live[0] === 35_000 ? undefined : `${o.live[0]} live entries, expected 35000`),
      { ms: 60_000, mb: 1500 },
    ),
  'long-units-fingerprint': (ctx) =>
    viaChild(
      ctx,
      { op: 'long-units', units: 3000, chars: 5000 },
      (o) => (o.units === 3000 && o.extra.exact === true ? undefined : `${o.units} units, expected 3000`),
      { ms: 15_000 },
    ),
  'memory-cut-100x': (ctx) => viaChild(ctx, { op: 'cut', spec: X100 }, cutOk, { mb: 1200 }),
  'memory-scan-100x': (ctx) => viaChild(ctx, { op: 'scan', spec: X100 }, scanOkVerify, { mb: 1500 }),
  'growth-cut': (ctx) =>
    growth(
      ctx,
      (spec) => ({ op: 'cut', spec }),
      (o) => o.ms[0] ?? 0,
      cutOk,
    ),
  'growth-rescan': (ctx) =>
    growth(
      ctx,
      (spec) => rescan(editSpec(spec, 'reword', 0.01)),
      (o) => o.ms[1] ?? 0,
      rescanOk('reword'),
    ),
};
