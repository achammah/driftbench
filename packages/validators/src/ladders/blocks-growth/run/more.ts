import { join } from 'node:path';
import { observed, type RawSpec, run, scriptedAdapter } from '../../blocks/harness';
import { need } from '../../blocks/product';
import { parsePlan, parseRun, summaryOf, withWorld } from './campaign';
import { computed, near, type Planted, playAll } from './compounding';
import { absent, build, enc, endOf, names as esNames, play as esPlay, sortByField } from './endstate';
import { exec, failOn, transport } from './execute';
import {
  type BankItem,
  blocks,
  CLI,
  CORE,
  call,
  expectAll,
  fail,
  gitem,
  type ItemContext,
  PASS,
  type Plan,
  say,
  scenario,
  show,
  word,
} from './kit';
import { plain } from './lifecycle';
import { runStage, stageOf, names as stNames } from './stage';

/**
 * The second pass of the run lane: items that give a cause with fewer than three twins another case on a different
 * seeded shape, so each cause is tested by a pass twin and failing twins across inputs.
 */

const D_CELLS = 'docs/running.md "Cells"';
const D_POOL = 'docs/running.md "The worker pool"';
const D_BUDGET = 'docs/running.md "The budget"';
const D_EVENTS = 'docs/running.md "Run events"';
const D_END = 'docs/running.md "End state"';
const D_CACHE = 'docs/running.md "The cache and replay"';
const D_CI = 'docs/concepts/run-modes.md "The compounding index"';
const D_STAGE = 'docs/concepts/drift.md "The stage classifier"';
const D_OUT = 'docs/running.md "Outcomes"';

export function moreItems(): BankItem[] {
  const out: BankItem[] = [];
  const cacheOf = (ctx: ItemContext) => need<() => unknown>(ctx.product.store, 'store', 'openMemoryStore')();

  /* stage: the tools a perturbation expects at a stage */
  out.push(
    gitem(
      'bg-stage',
      'bg.stage.signature.two-perturbations-add-up',
      4,
      CORE,
      'ST6',
      'the tools of every perturbation that expects a stage add to its signature',
      async (ctx) => {
        const tag = 'bg.stage.signature.two-perturbations-add-up';
        const { s, t } = stNames(ctx, tag, 2, 4);
        const [a, b, c, d] = t as [string, string, string, string];
        const setup = {
          stages: s,
          blocks: [
            { calls: [b, c] },
            { expect: s[0] as string, tools: [a, d] },
            { expect: s[1] as string, tools: [a] },
          ],
        };
        const with2 = await runStage(ctx, `${tag}:with`, {
          ...setup,
          perts: [
            { id: word(ctx.seed, `${tag}:p1`, 5), at: 1, expect: s[1] as string, tools: [b] },
            { id: word(ctx.seed, `${tag}:p2`, 5), at: 2, expect: s[1] as string, tools: [c] },
          ],
        });
        const without = await runStage(ctx, `${tag}:without`, setup);
        const none = stageOf(without.blocks[0]);
        return stageOf(with2.blocks[0]) === s[1] && (none === undefined || none === null)
          ? PASS
          : fail(
              say(
                D_STAGE,
                'with both perturbations stage 1 holds {a, b, c} and wins; without them no stage expects the calls',
                `with ${show(stageOf(with2.blocks[0]))}, without ${show(none)}`,
              ),
            );
      },
    ),
  );

  /* outcome: a run with no block */
  out.push(
    gitem(
      'bg-outcome',
      'bg.outcome.rule5.mode-t-run-with-no-block',
      4,
      CORE,
      'OC5',
      'a teacher-forced run that ends before its first block has no block and reads fail',
      async (ctx) => {
        const tag = 'bg.outcome.rule5.mode-t-run-with-no-block';
        const sc = scenario(ctx.seed, tag, blocks(ctx.seed, tag, 3), {
          end: { verdict: 'success', atBlock: -1 },
        });
        const adapter = scriptedAdapter(ctx.product, (turn) => {
          const plan = [...sc.plans].find(([key]) => turn.user.includes(key))?.[1] as Plan;
          return observed(plan.text, []);
        });
        const rec = await run(ctx.product, sc.raw as RawSpec, adapter, { mode: 'T' });
        const outcome = need<(r: unknown) => string>(ctx.product.core, 'core', 'runOutcome')(rec);
        return rec.blocks.length === 0 && outcome === 'fail'
          ? PASS
          : fail(say(D_OUT, 'no block, outcome fail', `${rec.blocks.length} blocks, ${outcome}`));
      },
    ),
  );

  /* lifecycle: jitter, stopped end, replay */
  for (const [id, random] of [
    ['random-near-one', 0.999],
    ['random-zero', 0],
    ['random-half', 0.5],
  ] as [string, number][])
    out.push(
      gitem(
        'bg-lifecycle',
        `bg.lifecycle.retry.wait.jitter-${id}`,
        4,
        CORE,
        'LC6',
        'with jitter each retry wait is drawn below its backoff (100, 200, 400 ms), never above it',
        async (ctx) => {
          const tag = `bg.lifecycle.retry.wait.jitter-${id}`;
          const sc = plain(ctx, tag, 2);
          const r = await exec(
            ctx,
            sc,
            { 0: failOn(3, () => transport(ctx.product, word(ctx.seed, `${tag}:m`, 8), 503)) },
            { retry: { baseDelayMs: 100, maxDelayMs: 100000, jitter: true, random: () => random } },
          );
          const limits = [100, 200, 400];
          return r.waits.length === 3 &&
            r.waits.every((wait, i) => wait >= 0 && wait <= (limits[i] as number))
            ? PASS
            : fail(
                say(
                  'docs/retries.md "The policy"',
                  'each wait is at most its backoff (100, 200, 400)',
                  `${r.waits.join()}`,
                ),
              );
        },
      ),
    );
  out.push(
    gitem(
      'bg-lifecycle',
      'bg.lifecycle.events.a-stopped-run-ends-with-its-status',
      3,
      CORE,
      'LC8',
      'a run the step guard stops reports a run end event whose status is stopped',
      async (ctx) => {
        const tag = 'bg.lifecycle.events.a-stopped-run-ends-with-its-status';
        const r = await exec(ctx, plain(ctx, tag, 4), {}, { maxSteps: 2 });
        const last = JSON.stringify(r.events[r.events.length - 1]);
        return r.rec.status === 'stopped' && last.includes('stopped')
          ? PASS
          : fail(
              say(D_EVENTS, 'the last event is the run end with status stopped', `${r.rec.status}: ${last}`),
            );
      },
    ),
    gitem(
      'bg-lifecycle',
      'bg.lifecycle.events.a-retry-in-a-later-block-is-one-event',
      3,
      CORE,
      'LC8',
      'a retry in the last block is reported as one more event',
      async (ctx) => {
        const tag = 'bg.lifecycle.events.a-retry-in-a-later-block-is-one-event';
        const base = await exec(ctx, plain(ctx, `${tag}:base`, 3), {});
        const r = await exec(ctx, plain(ctx, tag, 3), {
          2: failOn(1, () => transport(ctx.product, word(ctx.seed, `${tag}:m`, 8), 500)),
        });
        return r.events.length === base.events.length + 1
          ? PASS
          : fail(say(D_EVENTS, `${base.events.length} + 1 events`, `${r.events.length}`));
      },
    ),
  );
  for (const [id, n] of [
    ['five-blocks', 5],
    ['two-blocks', 2],
  ] as [string, number][])
    out.push(
      gitem(
        'bg-lifecycle',
        `bg.lifecycle.resume.a-complete-cache-replays-${id}`,
        4,
        CORE,
        'LC13',
        'a run whose every block is cached replays the same verdicts and asks the agent nothing',
        async (ctx) => {
          const tag = `bg.lifecycle.resume.a-complete-cache-replays-${id}`;
          const cache = cacheOf(ctx);
          const sc = plain(ctx, tag, n);
          const merge = Object.fromEntries(Array.from({ length: n }, (_, i) => [i, { cost: { usd: 0.5 } }]));
          const first = await exec(ctx, sc, {}, { cache, merge });
          const second = await exec(ctx, sc, {}, { cache, merge });
          const verdicts = (rec: typeof first.rec) =>
            JSON.stringify(rec.blocks.map((b) => b.verdicts.map((v) => `${v.id}:${v.outcome}`)));
          return expectAll([
            [
              (first.rec as Record<string, unknown>).cost === n * 0.5,
              say(
                D_CACHE,
                `the first run costs ${n * 0.5}`,
                show((first.rec as Record<string, unknown>).cost),
              ),
            ],
            [
              second.turns.length === 0 && (second.rec as Record<string, unknown>).cacheHit === true,
              say(D_CACHE, 'the replay asks the agent nothing', `${second.turns.length} turns`),
            ],
            [
              verdicts(first.rec) === verdicts(second.rec),
              say(D_CACHE, 'the replay gives the same verdicts', 'they differ'),
            ],
          ]);
        },
      ),
    );
  out.push(
    gitem(
      'bg-lifecycle',
      'bg.lifecycle.cache.a-third-repeat-is-a-miss',
      4,
      CORE,
      'LC14',
      'the repeat is part of the cache key: repeat 2 misses where repeat 0 hit',
      async (ctx) => {
        const tag = 'bg.lifecycle.cache.a-third-repeat-is-a-miss';
        const cache = cacheOf(ctx);
        const sc = plain(ctx, tag, 2);
        await exec(ctx, sc, {}, { cache });
        const other = await exec(ctx, sc, {}, { cache, repeat: 2 });
        const same = await exec(ctx, sc, {}, { cache, repeat: 0 });
        return other.turns.length === 2 && same.turns.length === 0
          ? PASS
          : fail(
              say(
                D_CACHE,
                'repeat 2 misses, repeat 0 hits',
                `repeat 2: ${other.turns.length} turns; repeat 0: ${same.turns.length}`,
              ),
            );
      },
    ),
  );

  /* end state: empty expect in a list, no block in T */
  out.push(
    gitem(
      'bg-endstate',
      'bg.endstate.diff.empty-expect-in-a-list',
      4,
      CORE,
      'ES3',
      'in a list, a source with an empty expect and nothing recorded gives the entry named by its source',
      async (ctx) => {
        const tag = 'bg.endstate.diff.empty-expect-in-a-list';
        const n = esNames(ctx, tag);
        const sc = build(ctx, tag, { 0: [call(n.other, { [n.f]: n.v1 })] }, [
          { source: `tool:${n.tool}`, expect: {} },
          { source: `tool:${n.other}`, expect: { [n.f]: n.v1 } },
        ]);
        const diff = sortByField(endOf(await esPlay(ctx, sc))?.diff);
        return diff.length === 1 &&
          diff[0]?.field === `tool:${n.tool}` &&
          enc(diff[0]?.expected) === enc({ nonempty: true }) &&
          enc(diff[0]?.observed) === enc(absent)
          ? PASS
          : fail(say(D_END, 'one entry for the empty source', show(diff)));
      },
    ),
    gitem(
      'bg-endstate',
      'bg.endstate.diff.empty-expect-after-a-late-payload',
      4,
      CORE,
      'ES3',
      'an empty expect passes when the source recorded in a late block, and fails when it recorded in none',
      async (ctx) => {
        const tag = 'bg.endstate.diff.empty-expect-after-a-late-payload';
        const n = esNames(ctx, tag);
        const hit = endOf(
          await esPlay(
            ctx,
            build(
              ctx,
              `${tag}:hit`,
              { 2: [call(n.tool, { [n.f]: n.v1 })] },
              { source: `tool:${n.tool}`, expect: {} },
            ),
          ),
        );
        const miss = endOf(
          await esPlay(
            ctx,
            build(
              ctx,
              `${tag}:miss`,
              { 2: [call(n.other, { [n.f]: n.v1 })] },
              { source: `tool:${n.tool}`, expect: {} },
            ),
          ),
        );
        return hit?.match === true && miss?.match === false
          ? PASS
          : fail(say(D_END, 'match true then false', `${show(hit)} then ${show(miss)}`));
      },
    ),
    gitem(
      'bg-endstate',
      'bg.endstate.diff.unreadable.no-block-in-mode-t',
      4,
      CORE,
      'ES6',
      'when no block ran in mode T there is one entry per source and match is false',
      async (ctx) => {
        const tag = 'bg.endstate.diff.unreadable.no-block-in-mode-t';
        const n = esNames(ctx, tag);
        const sc = build(
          ctx,
          tag,
          {},
          { source: `tool:${n.tool}`, expect: { [n.f]: n.v1 } },
          { end: { verdict: 'success', atBlock: -1 } },
        );
        const rec = await esPlay(ctx, sc, 'T');
        const end = endOf(rec);
        return rec.blocks.length === 0 && end?.match === false && (end.diff ?? []).length === 1
          ? PASS
          : fail(say(D_END, 'no block, match false, one entry', `${rec.blocks.length} blocks, ${show(end)}`));
      },
    ),
  );

  /* compounding */
  out.push(
    gitem(
      'bg-compounding',
      'bg.compounding.a-spec-that-ran-in-f-only-has-no-index',
      4,
      CORE,
      'CI4',
      'a spec that ran in F only gets no entry',
      async (ctx) => {
        const tag = 'bg.compounding.a-spec-that-ran-in-f-only-has-no-index';
        const planted: Planted[] = [
          { mode: 'F', fails: [1], repeat: 0 },
          { mode: 'F', fails: [], repeat: 1 },
        ];
        const runs = await playAll(ctx, tag, 3, planted);
        const result = await computed(ctx, runs);
        return (result.specs ?? []).length === 0 || (result.specs ?? []).every((e) => e.index === undefined)
          ? PASS
          : fail(say(D_CI, 'no entry for a spec that ran in F only', JSON.stringify(result).slice(0, 200)));
      },
    ),
    gitem(
      'bg-compounding',
      'bg.compounding.a-negative-index-is-kept',
      4,
      CORE,
      'CI1',
      'when F does better than T the index is negative',
      async (ctx) => {
        const tag = 'bg.compounding.a-negative-index-is-kept';
        const planted: Planted[] = [
          { mode: 'T', fails: [0, 1], repeat: 0 },
          { mode: 'F', fails: [], repeat: 0 },
        ];
        const runs = await playAll(ctx, tag, 4, planted);
        const result = await computed(ctx, runs);
        return near(result.specs?.[0]?.index, -0.5)
          ? PASS
          : fail(say(D_CI, 'index -0.5 (T passes 2 of 4, F all 4)', show(result.specs?.[0]?.index)));
      },
    ),
    gitem(
      'bg-compounding',
      'bg.compounding.equal-rates-give-zero',
      4,
      CORE,
      'CI1',
      'with the same blocks failing in T and F the index is 0',
      async (ctx) => {
        const tag = 'bg.compounding.equal-rates-give-zero';
        const planted: Planted[] = [
          { mode: 'T', fails: [2], repeat: 0 },
          { mode: 'F', fails: [2], repeat: 0 },
        ];
        const runs = await playAll(ctx, tag, 4, planted);
        const result = await computed(ctx, runs);
        return near(result.specs?.[0]?.index, 0)
          ? PASS
          : fail(say(D_CI, 'index 0', show(result.specs?.[0]?.index)));
      },
    ),
  );

  /* campaign */
  out.push(
    gitem(
      'bg-campaign',
      'bg.campaign.cell.run-id-in-status',
      4,
      CLI,
      'CE2',
      'the run id campaign status prints for a cell is its cell id',
      async (ctx) => {
        const tag = 'bg.campaign.cell.run-id-in-status';
        return withWorld(ctx, tag, { specs: 2 }, async (w) => {
          const store = join(w.dir, 'store.db');
          const planned = parsePlan((await w.run(['campaign', 'plan', ...w.files])).out);
          await w.run(['campaign', 'run', ...w.files, '--store', store, '--campaign', 'c-id']);
          const status = await w.run(['campaign', 'status', 'c-id', '--store', store, '--json']);
          const missing = planned.filter((cell) => !status.out.includes(cell.id));
          return planned.length === 2 && missing.length === 0
            ? PASS
            : fail(
                say(
                  D_CELLS,
                  'status names the planned cell ids',
                  `${missing.length} of ${planned.length} missing: ${status.out.slice(0, 160)}`,
                ),
              );
        });
      },
    ),
    gitem(
      'bg-campaign',
      'bg.campaign.pool.lines-follow-the-plan-across-modes',
      4,
      CLI,
      'CP3',
      'the cell lines of a run come in the order of the plan, modes and perturbations included, whatever the cells take',
      async (ctx) => {
        const tag = 'bg.campaign.pool.lines-follow-the-plan-across-modes';
        return withWorld(
          ctx,
          tag,
          { specs: 2, perturbations: 1, delay: (user) => (user.length % 3) * 40 },
          async (w) => {
            const key = (c: { spec: string; mode: string; repeat: number; perturbation?: string }) =>
              `${c.spec}/${c.mode}/${c.repeat}/${c.perturbation ?? ''}`;
            const planned = parsePlan(
              (await w.run(['campaign', 'plan', ...w.files, '--mode', 'T,F,P'])).out,
            ).map(key);
            const ran = parseRun(
              (await w.run(['campaign', 'run', ...w.files, '--mode', 'T,F,P', '--no-cache'])).out,
            ).map(key);
            return planned.length === 6 && ran.join() === planned.join()
              ? PASS
              : fail(
                  say(
                    D_POOL,
                    'the run prints its cells in plan order',
                    `${show(ran)} against ${show(planned)}`,
                  ),
                );
          },
        );
      },
    ),
  );
  for (const [id, specs, blocksPerSpec, perts] of [
    ['three-specs-one-block', 3, 1, 1],
    ['one-spec-three-blocks-two-perturbations', 1, 3, 2],
  ] as [string, number, number, number][])
    out.push(
      gitem(
        'bg-campaign',
        `bg.campaign.pool.p-cells-start-last.${id}`,
        4,
        CLI,
        'CP2',
        'the T and F cells start first in cell order, then the P cells',
        async (ctx) => {
          const tag = `bg.campaign.pool.p-cells-start-last.${id}`;
          return withWorld(ctx, tag, { specs, blocks: blocksPerSpec, perturbations: perts }, async (w) => {
            const r = await w.run([
              'campaign',
              'run',
              ...w.files,
              '--mode',
              'T,F,P',
              '--concurrency',
              '1',
              '--no-cache',
            ]);
            const injected = w.specs.flatMap((s) => s.perturbations?.map((p) => p.user) ?? []);
            const flags = w.agent.requests.map((req) => injected.some((u) => req.user.includes(u)));
            const firstP = flags.indexOf(true);
            const want = specs * blocksPerSpec * 2;
            return r.code === 0 && firstP === want
              ? PASS
              : fail(say(D_POOL, `the first P request is request ${want}`, `at ${firstP}; exit ${r.code}`));
          });
        },
      ),
    );
  for (const [id, repeats, specs] of [
    ['two-repeats', 2, 1],
    ['three-specs', 1, 3],
  ] as [string, number, number][])
    out.push(
      gitem(
        'bg-campaign',
        `bg.campaign.pool.p-waits-for-f.${id}`,
        5,
        CLI,
        'CP4',
        'a P cell does not start before the F run it takes as its reference has ended',
        async (ctx) => {
          const tag = `bg.campaign.pool.p-waits-for-f.${id}`;
          return withWorld(ctx, tag, { specs, blocks: 2, perturbations: 1, delay: () => 150 }, async (w) => {
            await w.run([
              'campaign',
              'run',
              ...w.files,
              '--mode',
              'F,P',
              '--repeats',
              String(repeats),
              '--concurrency',
              '8',
              '--no-cache',
            ]);
            const injected = w.specs.flatMap((s) => s.perturbations?.map((p) => p.user) ?? []);
            const isP = (req: { user: string }) => injected.some((u) => req.user.includes(u));
            const firstP = Math.min(...w.agent.requests.filter(isP).map((req) => req.startedAt));
            const firstFEnd = Math.min(
              ...w.agent.requests.filter((req) => !isP(req)).map((req) => req.endedAt),
            );
            return Number.isFinite(firstP) && firstP >= firstFEnd - 1
              ? PASS
              : fail(
                  say(
                    D_POOL,
                    'no P request begins before an F run has ended',
                    `first P at ${firstP}, first F request ends at ${firstFEnd}`,
                  ),
                );
          });
        },
      ),
    );
  out.push(
    gitem(
      'bg-campaign',
      'bg.campaign.budget.only-fresh-runs-are-counted',
      4,
      CLI,
      'CB2',
      'in a campaign half replayed from the cache, only the fresh runs spend against the budget',
      async (ctx) => {
        const tag = 'bg.campaign.budget.only-fresh-runs-are-counted';
        return withWorld(ctx, tag, { specs: 4, usd: 1, delay: () => 20 }, async (w) => {
          const store = join(w.dir, 'store.db');
          await w.run([
            'campaign',
            'run',
            w.files[0] as string,
            w.files[1] as string,
            '--concurrency',
            '1',
            '--store',
            store,
            '--campaign',
            'c-one',
          ]);
          const before = w.agent.requests.length;
          const second = await w.run([
            'campaign',
            'run',
            ...w.files,
            '--concurrency',
            '1',
            '--store',
            store,
            '--campaign',
            'c-two',
            '--budget-usd',
            '1.5',
          ]);
          const lines = parseRun(second.out);
          return before === 2 &&
            lines.length === 4 &&
            lines.every((l) => l.state === 'pass') &&
            w.agent.requests.length === 4 &&
            summaryOf(second.out).spent === 2
            ? PASS
            : fail(
                say(
                  D_BUDGET,
                  'the 2 cached cells cost nothing, the 2 fresh cells run and spend $2',
                  `${show(lines.map((l) => l.state))}; ${w.agent.requests.length} requests; ${second.out.split('\n').slice(-2).join(' | ')}`,
                ),
              );
        });
      },
    ),
    gitem(
      'bg-campaign',
      'bg.campaign.exit.smoke-invalid-spec',
      3,
      CLI,
      'CX3',
      'smoke on a spec with an unknown key exits 2 and runs nothing',
      async (ctx) => {
        const tag = 'bg.campaign.exit.smoke-invalid-spec';
        return withWorld(ctx, tag, { specs: 1 }, async (w) => {
          w.rewrite(0, (def) => ({ ...def, extra: { [word(ctx.seed, `${tag}:key`, 7)]: 1 } }));
          const r = await w.run(['smoke', w.files[0] as string]);
          return r.code === 2 && w.agent.requests.length === 0
            ? PASS
            : fail(
                say(
                  'docs/running.md "Exit codes"',
                  'exit 2, no request',
                  `${r.code}; ${w.agent.requests.length} requests`,
                ),
              );
        });
      },
    ),
  );

  /* given: injection stimulus of other classes */
  for (const cls of ['D1_off_topic', 'D12_prompt_extraction'])
    out.push(
      gitem(
        'bg-modes',
        `bg.given.when.injection-stimulus-class-${(cls.split('_')[0] ?? '').toLowerCase()}`,
        4,
        CORE,
        'GW3',
        'a block whose stimulus is an injection of any class is part of the script and runs with the injected text',
        async (ctx) => {
          const tag = `bg.given.when.injection-stimulus-class-${cls}`;
          const sc = scenario(ctx.seed, tag, blocks(ctx.seed, tag, 3));
          const marker = sc.users[1] as string;
          const block = sc.raw.blocks[1] as Record<string, unknown>;
          delete block.user;
          block.when = { injection: { class: cls, user: marker } };
          const seen: string[] = [];
          const adapter = scriptedAdapter(ctx.product, (turn) => {
            seen.push(turn.user);
            const key = [...sc.plans.keys()].find((each) => turn.user.includes(each)) as string;
            return observed((sc.plans.get(key) as Plan).text, []);
          });
          const rec = await run(ctx.product, sc.raw as RawSpec, adapter, { mode: 'F' });
          return rec.blocks.length === 3 && seen[1]?.includes(marker) === true
            ? PASS
            : fail(
                say(
                  'docs/concepts/given-when-then.md "When"',
                  'the injected text reaches the agent as block 1',
                  show(seen),
                ),
              );
        },
      ),
    );

  return out;
}
