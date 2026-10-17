import { injecting } from '../../blocks-breaker/kit';
import { exec, failOn } from './execute';
import {
  type BankItem,
  blocks,
  CORE,
  call,
  expectAll,
  fail,
  gitem,
  type ItemContext,
  type ItemResult,
  PASS,
  type RunRecord,
  type Scenario,
  say,
  scenario,
  show,
  word,
} from './kit';

/**
 * bg-endstate: what the run record keeps of the end state (docs/running.md "End state"): the diff entries by case, the
 * value the checks saw, which runs carry it and how often the sources are read. The agent records tool payloads; the
 * end state it should leave is known from the payloads planted.
 */

const FAMILY = 'bg-endstate';
const D = 'docs/running.md "End state"';

type Diff = { field?: string; expected?: unknown; observed?: unknown; [key: string]: unknown }[];
type EndState = { match?: boolean; diff?: Diff };

export const endOf = (rec: RunRecord) => (rec as unknown as { endState?: EndState }).endState;
const recordOf = (rec: RunRecord) => rec as unknown as Record<string, unknown>;
export const enc = (value: unknown) => JSON.stringify(value) ?? 'undefined';
export const absent = { absent: true };
export const sortByField = (diff: Diff | undefined) =>
  [...(diff ?? [])].sort((a, b) => String(a.field).localeCompare(String(b.field)));

export type Names = {
  tool: string;
  other: string;
  f: string;
  g: string;
  h: string;
  v1: string;
  v2: string;
  v3: string;
  wrong: string;
};
export const names = (ctx: ItemContext, tag: string): Names => ({
  tool: word(ctx.seed, `${tag}:tool`, 6),
  other: word(ctx.seed, `${tag}:other`, 6),
  f: word(ctx.seed, `${tag}:f`, 5),
  g: word(ctx.seed, `${tag}:g`, 5),
  h: word(ctx.seed, `${tag}:h`, 5),
  v1: word(ctx.seed, `${tag}:v1`, 8),
  v2: word(ctx.seed, `${tag}:v2`, 8),
  v3: word(ctx.seed, `${tag}:v3`, 8),
  wrong: word(ctx.seed, `${tag}:wrong`, 8),
});

/** Three blocks; block 0 records `payloads` by tool; the spec asks `endState`. */
export function build(
  ctx: ItemContext,
  tag: string,
  calls: Record<number, ReturnType<typeof call>[]>,
  endState: unknown,
  extra: Record<string, unknown> = {},
): Scenario {
  return scenario(ctx.seed, tag, blocks(ctx.seed, tag, 3, calls), { end_state: endState, ...extra });
}

export async function play(ctx: ItemContext, sc: Scenario, mode: 'F' | 'T' = 'F'): Promise<RunRecord> {
  return (await exec(ctx, sc, {}, { mode })).rec;
}

export const same = (a: unknown, b: unknown) => enc(a) === enc(b);

function diffItems(): BankItem[] {
  const out: BankItem[] = [];
  const add = (
    id: string,
    tier: 3 | 4,
    cause: 'ES1' | 'ES2' | 'ES3' | 'ES4' | 'ES5' | 'ES6',
    title: string,
    check: (ctx: ItemContext, tag: string, n: Names) => Promise<ItemResult>,
  ) =>
    out.push(
      gitem(FAMILY, `bg.endstate.diff.${id}`, tier, CORE, cause, title, (ctx) =>
        check(ctx, `bg.endstate.diff.${id}`, names(ctx, `bg.endstate.diff.${id}`)),
      ),
    );
  add(
    'one-field-differs',
    3,
    'ES1',
    'a field that does not hold is one entry with the field, the assertion and the observed value',
    async (ctx, tag, n) => {
      const sc = build(
        ctx,
        tag,
        { 0: [call(n.tool, { [n.f]: n.v1, [n.g]: n.v2 })] },
        { source: `tool:${n.tool}`, expect: { [n.f]: n.v1, [n.g]: { regex: `^${n.wrong}$` } } },
      );
      const rec = await play(ctx, sc);
      const diff = endOf(rec)?.diff ?? [];
      return expectAll([
        [endOf(rec)?.match === false, say(D, 'the end state does not match', show(endOf(rec)))],
        [diff.length === 1 && diff[0]?.field === n.g, say(D, `one entry for the field ${n.g}`, show(diff))],
        [
          same(diff[0]?.expected, { regex: `^${n.wrong}$` }),
          say(D, 'expected holds the assertion as written', show(diff[0]?.expected)),
        ],
        [same(diff[0]?.observed, n.v2), say(D, 'observed holds the recorded value', show(diff[0]?.observed))],
      ]);
    },
  );
  add(
    'two-fields-differ',
    3,
    'ES1',
    'every field that does not hold is an entry, and a field that holds is none',
    async (ctx, tag, n) => {
      const sc = build(
        ctx,
        tag,
        { 1: [call(n.tool, { [n.f]: n.v1, [n.g]: n.v2, [n.h]: n.v3 })] },
        {
          source: `tool:${n.tool}`,
          expect: { [n.f]: n.wrong, [n.g]: n.v2, [n.h]: { one_of: [n.wrong, `${n.wrong}x`] } },
        },
      );
      const diff = sortByField(endOf(await play(ctx, sc))?.diff);
      const fields = diff.map((entry) => entry.field);
      return fields.join() === [n.f, n.h].sort().join() &&
        same(diff.find((e) => e.field === n.h)?.expected, { one_of: [n.wrong, `${n.wrong}x`] }) &&
        same(diff.find((e) => e.field === n.f)?.observed, n.v1)
        ? PASS
        : fail(say(D, `entries for ${n.f} and ${n.h} only, with their assertion and value`, show(diff)));
    },
  );
  add(
    'a-state-that-holds-has-no-entry',
    3,
    'ES1',
    'an end state that holds has match true and an empty diff',
    async (ctx, tag, n) => {
      const sc = build(
        ctx,
        tag,
        { 2: [call(n.tool, { [n.f]: n.v1, [n.g]: n.v2 })] },
        { source: `tool:${n.tool}`, expect: { [n.f]: n.v1, [n.g]: n.v2 } },
      );
      const end = endOf(await play(ctx, sc));
      return end?.match === true && (end.diff ?? []).length === 0
        ? PASS
        : fail(say(D, 'match true and no entry', show(end)));
    },
  );
  add(
    'list-names-fields-by-source',
    4,
    'ES1',
    'in a list the field of an entry is named <source>.<field>',
    async (ctx, tag, n) => {
      const sc = build(
        ctx,
        tag,
        { 0: [call(n.tool, { [n.f]: n.v1 })], 1: [call(n.other, { [n.g]: n.v2 })] },
        [
          { source: `tool:${n.tool}`, expect: { [n.f]: n.wrong } },
          { source: `tool:${n.other}`, expect: { [n.g]: n.v2 } },
        ],
      );
      const diff = endOf(await play(ctx, sc))?.diff ?? [];
      return diff.length === 1 && diff[0]?.field === `tool:${n.tool}.${n.f}` && same(diff[0]?.observed, n.v1)
        ? PASS
        : fail(say(D, `one entry named tool:${n.tool}.${n.f}`, show(diff)));
    },
  );
  add(
    'a-single-mapping-names-the-bare-field',
    4,
    'ES1',
    'a single mapping names the field bare, not with its source',
    async (ctx, tag, n) => {
      const sc = build(
        ctx,
        tag,
        { 0: [call(n.tool, { [n.f]: n.v1 })] },
        { source: `tool:${n.tool}`, expect: { [n.f]: n.wrong } },
      );
      const diff = endOf(await play(ctx, sc))?.diff ?? [];
      return diff.length === 1 && diff[0]?.field === n.f
        ? PASS
        : fail(say(D, `the field is ${n.f}`, show(diff)));
    },
  );
  // A source that recorded nothing.
  for (const count of [1, 2, 3]) {
    add(
      `nothing-recorded.${count}-expected-fields`,
      3,
      'ES2',
      `a source that recorded nothing gives one entry per expected field, observed {absent: true}, absent assertions included (${count} fields)`,
      async (ctx, tag, n) => {
        const fields = [n.f, n.g, n.h].slice(0, count);
        const expect: Record<string, unknown> = {};
        fields.forEach((field, i) => {
          expect[field] = i === 1 ? absent : n.v1;
        });
        const sc = build(
          ctx,
          tag,
          { 0: [call(n.other, { [n.f]: n.v1 })] },
          { source: `tool:${n.tool}`, expect },
        );
        const diff = sortByField(endOf(await play(ctx, sc))?.diff);
        return diff.length === count &&
          diff.map((e) => e.field).join() === [...fields].sort().join() &&
          diff.every((e) => same(e.observed, absent))
          ? PASS
          : fail(
              say(D, `${count} entries, one per expected field, each observed {"absent":true}`, show(diff)),
            );
      },
    );
  }
  add(
    'nothing-recorded-in-a-list-names-the-source',
    4,
    'ES2',
    'in a list, the entries of a source that recorded nothing are named <source>.<field>',
    async (ctx, tag, n) => {
      const sc = build(ctx, tag, { 0: [call(n.other, { [n.g]: n.v2 })] }, [
        { source: `tool:${n.tool}`, expect: { [n.f]: n.v1 } },
        { source: `tool:${n.other}`, expect: { [n.g]: n.v2 } },
      ]);
      const diff = endOf(await play(ctx, sc))?.diff ?? [];
      return diff.length === 1 &&
        diff[0]?.field === `tool:${n.tool}.${n.f}` &&
        same(diff[0]?.observed, absent)
        ? PASS
        : fail(say(D, `one entry, tool:${n.tool}.${n.f}, observed absent`, show(diff)));
    },
  );
  // Empty expect.
  add(
    'empty-expect-and-nothing-recorded',
    4,
    'ES3',
    'an empty expect with nothing recorded is one entry {field: <source>, expected: {nonempty: true}, observed: {absent: true}}',
    async (ctx, tag, n) => {
      const sc = build(ctx, tag, {}, { source: `tool:${n.tool}`, expect: {} });
      const diff = endOf(await play(ctx, sc))?.diff ?? [];
      return diff.length === 1 &&
        diff[0]?.field === `tool:${n.tool}` &&
        same(diff[0]?.expected, { nonempty: true }) &&
        same(diff[0]?.observed, absent)
        ? PASS
        : fail(
            say(
              D,
              `[{"field":"tool:${n.tool}","expected":{"nonempty":true},"observed":{"absent":true}}]`,
              show(diff),
            ),
          );
    },
  );
  add(
    'empty-expect-and-something-recorded',
    4,
    'ES3',
    'an empty expect passes when the source recorded anything',
    async (ctx, tag, n) => {
      const sc = build(
        ctx,
        tag,
        { 1: [call(n.tool, { [n.f]: n.v1 })] },
        { source: `tool:${n.tool}`, expect: {} },
      );
      const end = endOf(await play(ctx, sc));
      return end?.match === true && (end.diff ?? []).length === 0
        ? PASS
        : fail(say(D, 'match true, no entry', show(end)));
    },
  );
  // Exact mode.
  for (const unlisted of [1, 2]) {
    add(
      `exact-mode.${unlisted}-unlisted`,
      3,
      'ES4',
      `in exact mode a field the spec does not list is an entry {field, expected: {absent: true}, observed: <value>} (${unlisted} unlisted)`,
      async (ctx, tag, n) => {
        const payload: Record<string, unknown> = { [n.f]: n.v1, [n.g]: n.v2, [n.h]: n.v3 };
        const listed = unlisted === 1 ? { [n.f]: n.v1, [n.g]: n.v2 } : { [n.f]: n.v1 };
        const sc = build(
          ctx,
          tag,
          { 0: [call(n.tool, payload)] },
          { source: `tool:${n.tool}`, mode: 'exact', expect: listed },
        );
        const diff = sortByField(endOf(await play(ctx, sc))?.diff);
        const want = Object.keys(payload)
          .filter((key) => !(key in listed))
          .sort();
        return diff.map((e) => e.field).join() === want.join() &&
          diff.every((e) => same(e.expected, absent) && same(e.observed, payload[e.field as string]))
          ? PASS
          : fail(
              say(
                D,
                `entries for ${want.join()}, expected {absent: true}, observed the recorded value`,
                show(diff),
              ),
            );
      },
    );
  }
  add(
    'exact-mode.every-field-listed',
    3,
    'ES4',
    'in exact mode a state whose fields are all listed and hold matches with no entry',
    async (ctx, tag, n) => {
      const sc = build(
        ctx,
        tag,
        { 0: [call(n.tool, { [n.f]: n.v1, [n.g]: n.v2 })] },
        { source: `tool:${n.tool}`, mode: 'exact', expect: { [n.f]: n.v1, [n.g]: n.v2 } },
      );
      const end = endOf(await play(ctx, sc));
      return end?.match === true && (end.diff ?? []).length === 0
        ? PASS
        : fail(say(D, 'match true, no entry', show(end)));
    },
  );
  // none
  for (const count of [1, 3]) {
    add(
      `none.${count}-payloads`,
      3,
      'ES5',
      `end_state none with ${count} payload(s) gives one entry per payload, field *.<index>, expected {absent: true}`,
      async (ctx, tag, n) => {
        const calls: Record<number, ReturnType<typeof call>[]> = {};
        for (let i = 0; i < count; i += 1) calls[i] = [call(n.tool, { [n.f]: `${n.v1}${i}` })];
        const diff = sortByField(endOf(await play(ctx, build(ctx, tag, calls, 'none')))?.diff);
        const want = Array.from({ length: count }, (_, i) => `*.${i}`).sort();
        return diff.map((e) => e.field).join() === want.join() && diff.every((e) => same(e.expected, absent))
          ? PASS
          : fail(say(D, `entries ${want.join()}, each expected {"absent":true}`, show(diff)));
      },
    );
  }
  add(
    'none.no-payload',
    3,
    'ES5',
    'end_state none with no payload recorded matches with no entry',
    async (ctx, tag) => {
      const end = endOf(await play(ctx, build(ctx, tag, {}, 'none')));
      return end?.match === true && (end.diff ?? []).length === 0
        ? PASS
        : fail(say(D, 'match true, no entry', show(end)));
    },
  );
  // A read that cannot happen.
  for (const sources of [1, 2]) {
    add(
      `unreadable.no-block-ran-${sources}-source`,
      4,
      'ES6',
      `when no block ran there is one entry per source (${sources}) and match is false`,
      async (ctx, tag, n) => {
        const specs = [
          { source: `tool:${n.tool}`, expect: { [n.f]: n.v1 } },
          { source: `tool:${n.other}`, expect: { [n.g]: n.v2 } },
        ].slice(0, sources);
        const sc = build(ctx, tag, {}, sources === 1 ? specs[0] : specs, {
          end: { verdict: 'success', atBlock: -1 },
        });
        const rec = await play(ctx, sc);
        const end = endOf(rec);
        return rec.blocks.length === 0 &&
          end?.match === false &&
          (end.diff ?? []).length === sources &&
          specs.every((s) => (end.diff ?? []).some((e) => enc(e).includes(s.source)))
          ? PASS
          : fail(
              say(
                D,
                `no block, match false and ${sources} entries naming the source`,
                `${rec.blocks.length} blocks, ${show(end)}`,
              ),
            );
      },
    );
  }
  return out;
}

function recordItems(): BankItem[] {
  const out: BankItem[] = [];
  const add = (
    id: string,
    tier: 3 | 4,
    cause: 'ES7' | 'ES8',
    title: string,
    check: (ctx: ItemContext, tag: string, n: Names) => Promise<ItemResult>,
  ) =>
    out.push(
      gitem(FAMILY, `bg.endstate.record.${id}`, tier, CORE, cause, title, (ctx) =>
        check(ctx, `bg.endstate.record.${id}`, names(ctx, `bg.endstate.record.${id}`)),
      ),
    );
  add(
    'a-failed-run-carries-the-end-state',
    4,
    'ES7',
    'a run that failed still carries endState',
    async (ctx, tag, n) => {
      const sc = build(
        ctx,
        tag,
        { 0: [call(n.tool, { [n.f]: n.v1 })] },
        { source: `tool:${n.tool}`, expect: { [n.f]: n.v1 } },
      );
      const r = await exec(ctx, sc, { 2: failOn(1, () => new Error(word(ctx.seed, `${tag}:m`, 8))) });
      return r.rec.status === 'failed' && typeof endOf(r.rec)?.match === 'boolean'
        ? PASS
        : fail(say(D, 'a failed run holds endState with a match', `${r.rec.status}: ${show(endOf(r.rec))}`));
    },
  );
  add(
    'a-stopped-run-carries-the-end-state',
    4,
    'ES7',
    'a run that was stopped still carries endState',
    async (ctx, tag, n) => {
      const sc = build(
        ctx,
        tag,
        { 0: [call(n.tool, { [n.f]: n.v1 })] },
        { source: `tool:${n.tool}`, expect: { [n.f]: n.v1 } },
      );
      const r = await exec(ctx, sc, {}, { maxSteps: 1 });
      return r.rec.status === 'stopped' && typeof endOf(r.rec)?.match === 'boolean'
        ? PASS
        : fail(say(D, 'a stopped run holds endState with a match', `${r.rec.status}: ${show(endOf(r.rec))}`));
    },
  );
  add(
    'a-spec-without-an-end-state-carries-none',
    3,
    'ES7',
    'a spec that names no end state has no endState in its run',
    async (ctx, tag) => {
      const rec = await play(ctx, scenario(ctx.seed, tag, blocks(ctx.seed, tag, 2)));
      return endOf(rec) === undefined && recordOf(rec).endStateValue === undefined
        ? PASS
        : fail(say(D, 'no endState and no endStateValue', show(endOf(rec))));
    },
  );
  add(
    'value-is-the-recorded-payload',
    3,
    'ES8',
    'endStateValue is what the checks saw: the payload the source recorded',
    async (ctx, tag, n) => {
      const payload = { [n.f]: n.v1, [n.g]: { inner: n.v2 } };
      const rec = await play(
        ctx,
        build(
          ctx,
          tag,
          { 1: [call(n.tool, payload)] },
          { source: `tool:${n.tool}`, expect: { [n.f]: n.v1 } },
        ),
      );
      return same(recordOf(rec).endStateValue, payload)
        ? PASS
        : fail(say(D, `endStateValue is the payload ${enc(payload)}`, enc(recordOf(rec).endStateValue)));
    },
  );
  add(
    'value-is-null-when-nothing-recorded',
    3,
    'ES8',
    'endStateValue is null when the source recorded nothing',
    async (ctx, tag, n) => {
      const rec = await play(ctx, build(ctx, tag, {}, { source: `tool:${n.tool}`, expect: { [n.f]: n.v1 } }));
      return recordOf(rec).endStateValue === null
        ? PASS
        : fail(say(D, 'endStateValue is null', enc(recordOf(rec).endStateValue)));
    },
  );
  add(
    'value-of-a-list-is-keyed-by-source',
    4,
    'ES8',
    'for a list, endStateValue is a record keyed by source',
    async (ctx, tag, n) => {
      const a = { [n.f]: n.v1 };
      const b = { [n.g]: n.v2 };
      const rec = await play(
        ctx,
        build(ctx, tag, { 0: [call(n.tool, a)], 2: [call(n.other, b)] }, [
          { source: `tool:${n.tool}`, expect: { [n.f]: n.v1 } },
          { source: `tool:${n.other}`, expect: { [n.g]: n.v2 } },
        ]),
      );
      return same(recordOf(rec).endStateValue, { [`tool:${n.tool}`]: a, [`tool:${n.other}`]: b })
        ? PASS
        : fail(say(D, 'a record keyed by source', enc(recordOf(rec).endStateValue)));
    },
  );
  add(
    'value-of-none-is-the-payload-list',
    4,
    'ES8',
    'for none, endStateValue is the list of every payload',
    async (ctx, tag, n) => {
      const a = { [n.f]: n.v1 };
      const b = { [n.g]: n.v2 };
      const rec = await play(ctx, build(ctx, tag, { 0: [call(n.tool, a)], 1: [call(n.other, b)] }, 'none'));
      const got = recordOf(rec).endStateValue;
      return Array.isArray(got) &&
        got.length === 2 &&
        [a, b].every((payload) => got.some((entry) => enc(entry).includes(enc(payload).slice(1, -1))))
        ? PASS
        : fail(say(D, 'the list of the two payloads', enc(got)));
    },
  );
  add(
    'value-is-absent-when-no-read-happened',
    4,
    'ES8',
    'endStateValue is absent when no read happened',
    async (ctx, tag, n) => {
      const rec = await play(
        ctx,
        build(
          ctx,
          tag,
          { 0: [call(n.tool, { [n.f]: n.v1 })] },
          { source: `tool:${n.tool}`, expect: { [n.f]: n.v1 } },
          { end: { verdict: 'success', atBlock: -1 } },
        ),
      );
      return recordOf(rec).endStateValue === undefined && endOf(rec)?.match === false
        ? PASS
        : fail(
            say(
              D,
              'no endStateValue and a mismatch',
              `${enc(recordOf(rec).endStateValue)}; ${show(endOf(rec))}`,
            ),
          );
    },
  );
  return out;
}

function readItems(): BankItem[] {
  const out: BankItem[] = [];
  const counting = (counter: { reads: string[] }) => (adapter: Record<string, unknown>) => {
    const endState = adapter.endState as (...args: unknown[]) => unknown;
    return {
      ...adapter,
      endState: (...args: unknown[]) => {
        counter.reads.push(String(args.find((arg) => typeof arg === 'string') ?? '?'));
        return endState.apply(adapter, args);
      },
    };
  };
  const add = (
    id: string,
    tier: 3 | 4,
    title: string,
    check: (ctx: ItemContext, tag: string, n: Names) => Promise<ItemResult>,
  ) =>
    out.push(
      gitem(FAMILY, `bg.endstate.reads.${id}`, tier, CORE, 'ES9', title, (ctx) =>
        check(ctx, `bg.endstate.reads.${id}`, names(ctx, `bg.endstate.reads.${id}`)),
      ),
    );
  add(
    'one-source-once-in-f',
    3,
    'the runner reads a source once in a free-running run, after the last block',
    async (ctx, tag, n) => {
      const counter = { reads: [] as string[] };
      const sc = build(
        ctx,
        tag,
        { 0: [call(n.tool, { [n.f]: n.v1 })] },
        { source: `tool:${n.tool}`, expect: { [n.f]: n.v1 } },
      );
      const r = await exec(ctx, sc, {}, { wrapAdapter: counting(counter) });
      return counter.reads.length === 1 && endOf(r.rec)?.match === true
        ? PASS
        : fail(say(D, 'one read of the one source', `${counter.reads.length} reads: ${show(counter.reads)}`));
    },
  );
  add('two-sources-once-each-in-f', 3, 'with two sources each is read once', async (ctx, tag, n) => {
    const counter = { reads: [] as string[] };
    const sc = build(ctx, tag, { 0: [call(n.tool, { [n.f]: n.v1 })], 1: [call(n.other, { [n.g]: n.v2 })] }, [
      { source: `tool:${n.tool}`, expect: { [n.f]: n.v1 } },
      { source: `tool:${n.other}`, expect: { [n.g]: n.v2 } },
    ]);
    await exec(ctx, sc, {}, { wrapAdapter: counting(counter) });
    return counter.reads.length === 2 && new Set(counter.reads).size === 2
      ? PASS
      : fail(say(D, 'two reads, one per source', `${counter.reads.length}: ${show(counter.reads)}`));
  });
  add('none-reads-the-star-source-once', 3, 'end_state none reads the source * once', async (ctx, tag, n) => {
    const counter = { reads: [] as string[] };
    await exec(
      ctx,
      build(ctx, tag, { 1: [call(n.tool, { [n.f]: n.v1 })] }, 'none'),
      {},
      { wrapAdapter: counting(counter) },
    );
    return counter.reads.length === 1 && counter.reads[0] === '*'
      ? PASS
      : fail(say(D, 'one read of *', show(counter.reads)));
  });
  add(
    'mode-t-reads-after-every-block',
    4,
    'in mode T the runner reads the sources after every block',
    async (ctx, tag, n) => {
      const counter = { reads: [] as string[] };
      const sc = build(
        ctx,
        tag,
        { 0: [call(n.tool, { [n.f]: n.v1 })] },
        { source: `tool:${n.tool}`, expect: { [n.f]: n.v1 } },
      );
      await exec(ctx, sc, {}, { mode: 'T', wrapAdapter: counting(counter) });
      return counter.reads.length === 3
        ? PASS
        : fail(say(D, 'a read after each of the 3 blocks', `${counter.reads.length} reads`));
    },
  );
  add(
    'mode-p-never-reads',
    4,
    'in mode P the end state is neither read nor compared',
    async (ctx, tag, n) => {
      const counter = { reads: [] as string[] };
      const pid = word(ctx.seed, `${tag}:pid`, 6);
      const iw = word(ctx.seed, `${tag}:iw`, 10);
      const sc = build(
        ctx,
        tag,
        { 0: [call(n.tool, { [n.f]: n.v1 })] },
        { source: `tool:${n.tool}`, expect: { [n.f]: n.v1 } },
        { perturbations: [{ id: pid, class: 'D1_off_topic', inject_at: 1, user: iw }] },
      );
      sc.plans.set(iw, { text: 'ok' });
      const r = await exec(
        ctx,
        sc,
        {},
        {
          mode: 'P',
          driver: injecting(ctx.product, pid),
          perturbationId: pid,
          wrapAdapter: counting(counter),
        },
      );
      return counter.reads.length === 0 &&
        r.rec.blocks.every((b) => !b.verdicts.some((v) => v.id.startsWith('end_state')))
        ? PASS
        : fail(say(D, 'no read and no end_state verdict', `${counter.reads.length} reads`));
    },
  );
  return out;
}

export function endStateItems(): BankItem[] {
  return [...diffItems(), ...recordItems(), ...readItems()];
}
