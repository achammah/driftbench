import { rngFor } from '../../blocks/harness';
import { need } from '../../blocks/product';
import {
  type BankItem,
  blockStatus,
  blocks,
  CORE,
  expectAll,
  fail,
  gitem,
  type ItemContext,
  type ItemResult,
  PASS,
  play,
  type RunRecord,
  runOutcome,
  say,
  scenario,
  show,
  word,
} from './kit';

/**
 * bg-outcome: how a run, a cell and a block record read (docs/running.md "Outcomes"). Runs come from a scripted agent
 * through the runner; each rule is then tested by changing one thing of a real record and reading the outcome again, the
 * run without the change being the twin.
 */

const FAMILY = 'bg-outcome';
const D = 'docs/running.md "Outcomes"';

type Kind = 'pass' | 'fail' | 'not_run';

/** A real run of 3 blocks. `pass`: all pass. `fail`: block 0 fails. `not_run`: blocks 1 and 2 cannot be set up. */
async function realRun(ctx: ItemContext, tag: string, kind: Kind, n = 3): Promise<RunRecord> {
  const defs = blocks(ctx.seed, tag, n);
  if (kind === 'fail') (defs[0] as { plan: { text: string } }).plan.text = 'Let me look.';
  if (kind === 'not_run')
    (defs[1] as { given?: unknown }).given = {
      prefix: [
        { role: 'user', content: word(ctx.seed, `${tag}:pu`, 9) },
        { role: 'assistant', content: word(ctx.seed, `${tag}:pa`, 9) },
      ],
    };
  const sc = scenario(ctx.seed, tag, defs);
  const { rec } = await play(ctx, sc, kind === 'not_run' ? { capabilities: { seedPrefix: false } } : {});
  return rec;
}

const outcome = (ctx: ItemContext, rec: unknown) => runOutcome(ctx.product, rec as RunRecord);
const clone = <T>(value: T): T => structuredClone(value);
const statuses = (ctx: ItemContext, rec: RunRecord) =>
  rec.blocks.map((block) => blockStatus(ctx.product, block));

/** A base run, its twin changed by `change`: the base reads `base`, the changed one reads `fail`. */
async function changed(
  ctx: ItemContext,
  tag: string,
  kind: Kind,
  base: string,
  change: (rec: RunRecord) => void,
  what: string,
): Promise<ItemResult> {
  const rec = await realRun(ctx, tag, kind);
  const before = outcome(ctx, rec);
  const twin = clone(rec);
  change(twin);
  const after = outcome(ctx, twin);
  return expectAll([
    [
      before === base,
      say(D, `the unchanged run (blocks ${show(statuses(ctx, rec))}) reads ${base}`, `${before}`),
    ],
    [after === 'fail', say(D, `${what} makes the run fail, whatever its blocks`, `${after}`)],
  ]);
}

function ruleItems(): BankItem[] {
  const out: BankItem[] = [];
  const kinds: { kind: Kind; base: string }[] = [
    { kind: 'pass', base: 'pass' },
    { kind: 'not_run', base: 'not_run' },
  ];
  const rules: {
    id: string;
    cause: 'OC2' | 'OC3' | 'OC4' | 'OC5';
    what: string;
    change: (rec: RunRecord, variant: number) => void;
    variants: number;
  }[] = [
    {
      id: 'run-did-not-complete',
      cause: 'OC2',
      what: 'a run that did not complete',
      variants: 2,
      change: (rec, v) => {
        rec.status = v === 0 ? 'failed' : 'stopped';
      },
    },
    {
      id: 'end-verdict-not-success',
      cause: 'OC3',
      what: 'an end verdict other than success',
      variants: 2,
      change: (rec, v) => {
        (rec as Record<string, unknown>).endVerdict = v === 0 ? 'failure' : 'abandoned';
      },
    },
    {
      id: 'end-state-mismatch',
      cause: 'OC4',
      what: 'an end state that does not match',
      variants: 1,
      change: (rec) => {
        (rec as Record<string, unknown>).endState = {
          match: false,
          diff: [{ field: 'x', expected: 1, observed: 2 }],
        };
      },
    },
    {
      id: 'no-block',
      cause: 'OC5',
      what: 'a run with no block',
      variants: 1,
      change: (rec) => {
        rec.blocks = [];
      },
    },
  ];
  for (const rule of rules)
    for (const kind of kinds)
      for (let v = 0; v < rule.variants; v += 1) {
        // A run with no block has no not_run base: its twin is the run with blocks.
        if (rule.id === 'no-block' && kind.kind === 'not_run') continue;
        const id = `bg.outcome.${rule.id}.${kind.kind}${rule.variants > 1 ? `.${v}` : ''}`;
        out.push(
          gitem(
            FAMILY,
            id,
            3,
            CORE,
            rule.cause,
            `runOutcome reads ${rule.what} as fail, over a run that otherwise reads ${kind.base}`,
            (ctx) => changed(ctx, id, kind.kind, kind.base, (rec) => rule.change(rec, v), rule.what),
          ),
        );
      }
  return out;
}

function orderItems(): BankItem[] {
  const out: BankItem[] = [];
  out.push(
    gitem(
      FAMILY,
      'bg.outcome.rule1.fail-outranks-not-run',
      3,
      CORE,
      'OC1',
      'a run with a failed block and blocks not run reads fail, and reads not_run once the failed block is not scored',
      async (ctx) => {
        const tag = 'bg.outcome.rule1.fail-outranks-not-run';
        const defs = blocks(ctx.seed, tag, 3);
        (defs[0] as { plan: { text: string } }).plan.text = 'Let me look.';
        (defs[1] as { given?: unknown }).given = {
          prefix: [
            { role: 'user', content: word(ctx.seed, `${tag}:pu`, 9) },
            { role: 'assistant', content: word(ctx.seed, `${tag}:pa`, 9) },
          ],
        };
        const { rec } = await play(ctx, scenario(ctx.seed, tag, defs), {
          capabilities: { seedPrefix: false },
        });
        const twin = clone(rec);
        twin.blocks[0] = { ...(twin.blocks[0] as object), pass: true, status: 'pass', verdicts: [] } as never;
        return expectAll([
          [
            statuses(ctx, rec).join() === 'fail,not_run,not_run',
            say(D, 'blocks fail, not_run, not_run', show(statuses(ctx, rec))),
          ],
          [
            outcome(ctx, rec) === 'fail',
            say(D, 'a failed block outranks the blocks not run: fail', outcome(ctx, rec)),
          ],
          [
            outcome(ctx, twin) === 'not_run',
            say(D, 'the same run with the first block passing reads not_run', outcome(ctx, twin)),
          ],
        ]);
      },
    ),
    gitem(
      FAMILY,
      'bg.outcome.rule1.fail-outranks-blocked',
      3,
      CORE,
      'OC1',
      'a run with a failed block and a blocked block reads fail',
      async (ctx) => {
        const rec = await realRun(ctx, 'bg.outcome.rule1.fail-outranks-blocked', 'fail');
        // The second block is blocked by the failed first one: its record as the runner writes a blocked block.
        rec.blocks[1] = {
          ...(rec.blocks[1] as object),
          pass: false,
          status: 'blocked',
          verdicts: [],
          blocked: { by: rec.blocks[0]?.blockId ?? 'x', root: rec.blocks[0]?.blockId ?? 'x' },
        } as never;
        return expectAll([
          [
            statuses(ctx, rec).join() === 'fail,blocked,pass',
            say(D, 'blocks fail, blocked, pass', show(statuses(ctx, rec))),
          ],
          [
            outcome(ctx, rec) === 'fail',
            say(D, 'a failed block outranks the blocked one: fail', outcome(ctx, rec)),
          ],
        ]);
      },
    ),
    gitem(
      FAMILY,
      'bg.outcome.rule1.one-failed-block-among-many',
      3,
      CORE,
      'OC1',
      'a run reads fail when any one of its blocks failed and pass when none did',
      async (ctx) => {
        const tag = 'bg.outcome.rule1.one-failed-block-among-many';
        const rng = rngFor(ctx.seed, tag);
        const n = 4 + Math.floor(rng() * 4);
        const at = Math.floor(rng() * n);
        const defs = blocks(ctx.seed, tag, n);
        const good = await play(ctx, scenario(ctx.seed, tag, defs));
        (defs[at] as { plan: { text: string } }).plan.text = 'Let me look.';
        const bad = await play(
          ctx,
          scenario(
            ctx.seed,
            `${tag}:bad`,
            blocks(ctx.seed, `${tag}:bad`, n).map((def, i) =>
              i === at ? { ...def, plan: { ...def.plan, text: 'Let me look.' } } : def,
            ),
          ),
        );
        return expectAll([
          [
            outcome(ctx, good.rec) === 'pass',
            say(D, `${n} passing blocks read pass`, outcome(ctx, good.rec)),
          ],
          [outcome(ctx, bad.rec) === 'fail', say(D, `block ${at} failing reads fail`, outcome(ctx, bad.rec))],
        ]);
      },
    ),
    gitem(
      FAMILY,
      'bg.outcome.rule2.incomplete-run-outranks-not-run',
      3,
      CORE,
      'OC2',
      'a run that did not complete reads fail even when a block was not run',
      async (ctx) => {
        const rec = await realRun(ctx, 'bg.outcome.rule2.incomplete-run-outranks-not-run', 'not_run');
        const stopped = clone(rec);
        stopped.status = 'stopped';
        return expectAll([
          [
            outcome(ctx, rec) === 'not_run',
            say(D, 'a completed run with blocks not run reads not_run', outcome(ctx, rec)),
          ],
          [
            outcome(ctx, stopped) === 'fail',
            say(D, 'rule 2 comes before rule 6: the stopped run reads fail', outcome(ctx, stopped)),
          ],
        ]);
      },
    ),
    gitem(
      FAMILY,
      'bg.outcome.rule4.end-state-match-keeps-the-outcome',
      3,
      CORE,
      'OC4',
      'an end state that matches leaves the outcome as the blocks give it',
      async (ctx) => {
        const tag = 'bg.outcome.rule4.end-state-match-keeps-the-outcome';
        const rec = await realRun(ctx, tag, 'pass');
        const matched = clone(rec);
        (matched as Record<string, unknown>).endState = { match: true, diff: [] };
        const mismatched = clone(rec);
        (mismatched as Record<string, unknown>).endState = {
          match: false,
          diff: [{ field: 'x', expected: 1, observed: 2 }],
        };
        return expectAll([
          [
            outcome(ctx, matched) === 'pass',
            say(D, 'a matching end state reads pass', outcome(ctx, matched)),
          ],
          [
            outcome(ctx, mismatched) === 'fail',
            say(D, 'a mismatching one reads fail', outcome(ctx, mismatched)),
          ],
        ]);
      },
    ),
    gitem(
      FAMILY,
      'bg.outcome.rule3.success-verdict-passes',
      3,
      CORE,
      'OC3',
      'a run that ends with the verdict success reads pass and one that ends with failure reads fail',
      async (ctx) => {
        const tag = 'bg.outcome.rule3.success-verdict-passes';
        const rec = await realRun(ctx, tag, 'pass');
        const good = clone(rec);
        (good as Record<string, unknown>).endVerdict = 'success';
        const bad = clone(rec);
        (bad as Record<string, unknown>).endVerdict = 'failure';
        return expectAll([
          [outcome(ctx, good) === 'pass', say(D, 'success reads pass', outcome(ctx, good))],
          [outcome(ctx, bad) === 'fail', say(D, 'failure reads fail', outcome(ctx, bad))],
        ]);
      },
    ),
  );
  return out;
}

/** The end verdict of a spec, through the scripted driver (docs/concepts/script.md). */
function endVerdictItems(): BankItem[] {
  return [
    gitem(
      FAMILY,
      'bg.outcome.rule3.spec-end-verdict-failure',
      4,
      CORE,
      'OC3',
      'a spec that ends with the verdict failure gives a run that reads fail, with every block that ran passing',
      async (ctx) => {
        const tag = 'bg.outcome.rule3.spec-end-verdict-failure';
        const run = async (verdict: string, suffix: string) =>
          (
            await play(
              ctx,
              scenario(ctx.seed, `${tag}:${suffix}`, blocks(ctx.seed, `${tag}:${suffix}`, 3), {
                end: { verdict },
              }),
            )
          ).rec;
        const good = await run('success', 'ok');
        const bad = await run('failure', 'bad');
        return expectAll([
          [
            outcome(ctx, good) === 'pass',
            say(
              D,
              'a spec ending with success reads pass',
              `${outcome(ctx, good)}; blocks ${show(statuses(ctx, good))}`,
            ),
          ],
          [
            outcome(ctx, bad) === 'fail',
            say(
              D,
              'a spec ending with failure reads fail',
              `${outcome(ctx, bad)}; blocks ${show(statuses(ctx, bad))}`,
            ),
          ],
        ]);
      },
    ),
    gitem(
      FAMILY,
      'bg.outcome.rule5.spec-end-before-the-first-block',
      4,
      CORE,
      'OC5',
      'a run that ends before its first block (atBlock -1) has no block and reads fail, even with the verdict success',
      async (ctx) => {
        const tag = 'bg.outcome.rule5.spec-end-before-the-first-block';
        const { rec } = await play(
          ctx,
          scenario(ctx.seed, tag, blocks(ctx.seed, tag, 3), { end: { verdict: 'success', atBlock: -1 } }),
        );
        return expectAll([
          [
            rec.blocks.length === 0,
            say(D, 'a run that ends at block -1 holds no block', `${rec.blocks.length} blocks`),
          ],
          [outcome(ctx, rec) === 'fail', say(D, 'a run with no block reads fail', outcome(ctx, rec))],
        ]);
      },
    ),
    gitem(
      FAMILY,
      'bg.outcome.rule4.end-state-of-a-real-run',
      4,
      CORE,
      'OC4',
      'a run whose end state does not match reads fail and one whose end state matches reads pass',
      async (ctx) => {
        const tag = 'bg.outcome.rule4.end-state-of-a-real-run';
        const tool = word(ctx.seed, `${tag}:tool`, 6);
        const value = word(ctx.seed, `${tag}:value`, 8);
        const other = word(ctx.seed, `${tag}:other`, 8);
        const make = async (suffix: string, said: string) => {
          const defs = blocks(ctx.seed, `${tag}:${suffix}`, 2, {
            1: [{ label: tool, input: { plan: said } }],
          });
          return (
            await play(
              ctx,
              scenario(ctx.seed, `${tag}:${suffix}`, defs, {
                end_state: { source: `tool:${tool}`, mode: 'subset', expect: { plan: value } },
              }),
            )
          ).rec;
        };
        const good = await make('ok', value);
        const bad = await make('bad', other);
        return expectAll([
          [
            outcome(ctx, good) === 'pass',
            say(
              D,
              'the end state matches: pass',
              `${outcome(ctx, good)}; ${show((good as Record<string, unknown>).endState)}`,
            ),
          ],
          [
            outcome(ctx, bad) === 'fail',
            say(
              D,
              'the end state differs: fail, with every block passing',
              `${outcome(ctx, bad)}; blocks ${show(statuses(ctx, bad))}`,
            ),
          ],
        ]);
      },
    ),
  ];
}

type Counts = Record<string, number>;

function countItems(): BankItem[] {
  const out: BankItem[] = [];
  const mk = (status: string, index: number) => ({
    index,
    pass: status === 'pass',
    status,
    verdicts: [],
    ...(status === 'not_run'
      ? {
          notRun: {
            kind: 'unsupported',
            layer: 'prefix',
            check: 'capability',
            expected: 'seedPrefix',
            got: 'none',
          },
        }
      : {}),
    ...(status === 'blocked' ? { blocked: { by: 'p', root: 'p' } } : {}),
  });
  for (let k = 0; k < 5; k += 1) {
    const id = `bg.outcome.count-blocks.${k}`;
    out.push(
      gitem(
        FAMILY,
        id,
        2,
        CORE,
        'OC9',
        'countBlocks counts the blocks by status into pass, fail, not_run and blocked',
        async (ctx) => {
          const rng = rngFor(ctx.seed, id);
          const statusList = Array.from(
            { length: 6 + k },
            () => ['pass', 'fail', 'not_run', 'blocked'][Math.floor(rng() * 4)] as string,
          );
          const want: Counts = { pass: 0, fail: 0, not_run: 0, blocked: 0 };
          for (const s of statusList) want[s] = (want[s] ?? 0) + 1;
          const countBlocks = need<(blocks: unknown[]) => Counts>(ctx.product.core, 'core', 'countBlocks');
          const got = countBlocks(statusList.map(mk));
          return ['pass', 'fail', 'not_run', 'blocked'].every((key) => got[key] === want[key])
            ? PASS
            : fail(say(D, `counts ${show(want)} for ${show(statusList)}`, show(got)));
        },
      ),
    );
  }
  const texts: { id: string; counts: Counts; text: string }[] = [
    { id: 'both-parts', counts: { pass: 3, fail: 1, not_run: 2, blocked: 1 }, text: '2 not run, 1 blocked' },
    { id: 'not-run-only', counts: { pass: 1, fail: 0, not_run: 4, blocked: 0 }, text: '4 not run' },
    { id: 'blocked-only', counts: { pass: 0, fail: 2, not_run: 0, blocked: 3 }, text: '3 blocked' },
    { id: 'neither', counts: { pass: 5, fail: 2, not_run: 0, blocked: 0 }, text: '' },
    {
      id: 'single-counts',
      counts: { pass: 0, fail: 0, not_run: 1, blocked: 1 },
      text: '1 not run, 1 blocked',
    },
  ];
  for (const each of texts)
    out.push(
      gitem(
        FAMILY,
        `bg.outcome.unscored-text.${each.id}`,
        2,
        CORE,
        'OC10',
        'unscoredText shows a part only when its count is above 0 and is empty when both are 0',
        async (ctx) => {
          const unscoredText = need<(counts: Counts) => string>(ctx.product.core, 'core', 'unscoredText');
          const got = unscoredText({ ...each.counts });
          return got === each.text
            ? PASS
            : fail(say(D, `${show(each.counts)} reads ${show(each.text)}`, show(got)));
        },
      ),
    );
  return out;
}

function recordItems(): BankItem[] {
  const out: BankItem[] = [];
  const cases: { id: string; status?: string; pass: boolean; accepted: boolean }[] = [
    { id: 'pass-true-status-fail', status: 'fail', pass: true, accepted: false },
    { id: 'pass-false-status-pass', status: 'pass', pass: false, accepted: false },
    { id: 'pass-true-status-not-run', status: 'not_run', pass: true, accepted: false },
    { id: 'pass-true-status-blocked', status: 'blocked', pass: true, accepted: false },
    { id: 'pass-true-status-pass', status: 'pass', pass: true, accepted: true },
    { id: 'pass-false-status-fail', status: 'fail', pass: false, accepted: true },
    { id: 'pass-true-no-status', pass: true, accepted: true },
    { id: 'pass-false-no-status', pass: false, accepted: true },
  ];
  for (const each of cases)
    out.push(
      gitem(
        FAMILY,
        `bg.outcome.record.${each.id}`,
        3,
        CORE,
        'OC11',
        'a block record whose pass and status disagree is refused when it is read back, and a consistent one is accepted',
        async (ctx) => {
          const tag = `bg.outcome.record.${each.id}`;
          const rec = await realRun(ctx, tag, 'pass', 2);
          const copy = JSON.parse(JSON.stringify(rec)) as RunRecord;
          const target = copy.blocks[1] as Record<string, unknown>;
          target.pass = each.pass;
          if (each.status === undefined) delete target.status;
          else target.status = each.status;
          if (each.status === 'not_run')
            target.notRun = {
              kind: 'unsupported',
              layer: 'prefix',
              check: 'capability',
              expected: 'seedPrefix',
              got: 'none',
            };
          if (each.status === 'blocked')
            target.blocked = { by: copy.blocks[0]?.blockId ?? 'x', root: copy.blocks[0]?.blockId ?? 'x' };
          const schema = need<{
            safeParse?: (value: unknown) => { success: boolean };
            parse?: (value: unknown) => unknown;
          }>(ctx.product.core, 'core', 'RunResult');
          const base = schema.safeParse ? schema.safeParse(JSON.parse(JSON.stringify(rec))).success : true;
          const verdict = (() => {
            if (schema.safeParse) return schema.safeParse(copy).success;
            try {
              schema.parse?.(copy);
              return true;
            } catch {
              return false;
            }
          })();
          return expectAll([
            [base, say(D, 'a run record as the runner wrote it is read back', 'refused')],
            [
              verdict === each.accepted,
              say(
                D,
                `a block with pass ${each.pass} and status ${each.status ?? 'none'} is ${each.accepted ? 'accepted' : 'refused'}`,
                verdict ? 'accepted' : 'refused',
              ),
            ],
          ]);
        },
      ),
    );
  return out;
}

function notRunItems(): BankItem[] {
  const out: BankItem[] = [];
  const layers: {
    id: string;
    given: (tool: string, seed: number, tag: string) => Record<string, unknown>;
    expect: string;
  }[] = [
    {
      id: 'prefix',
      given: (_t, seed, tag) => ({
        prefix: [
          { role: 'user', content: word(seed, `${tag}:pu`, 9) },
          { role: 'assistant', content: word(seed, `${tag}:pa`, 9) },
        ],
      }),
      expect: 'seedPrefix',
    },
    {
      id: 'forced-tool-result',
      given: (tool) => ({ world: { tools: { [tool]: { result: { ok: true } } } } }),
      expect: 'toolStubs',
    },
  ];
  for (const layer of layers)
    for (const caps of ['seedPrefix', 'toolStubs'] as const) {
      const applies = caps === layer.expect;
      const id = `bg.outcome.not-run.${layer.id}.${caps}-${applies ? 'off' : 'only-other-off'}`;
      out.push(
        gitem(
          FAMILY,
          id,
          3,
          CORE,
          'OC7',
          `a block whose ${layer.id} the target cannot apply is not_run with kind unsupported; one it can apply runs`,
          async (ctx) => {
            const tag = id;
            const tool = word(ctx.seed, `${tag}:tool`, 6);
            const defs = blocks(ctx.seed, tag, 2);
            (defs[1] as { given?: unknown }).given = layer.given(tool, ctx.seed, tag);
            const sc = scenario(ctx.seed, tag, defs);
            const { rec } = await play(ctx, sc, { capabilities: { [caps]: false } });
            const b = rec.blocks[1] as unknown as {
              pass: boolean;
              status?: string;
              verdicts: unknown[];
              notRun?: Record<string, unknown>;
            };
            if (!applies)
              return expectAll([
                [
                  statuses(ctx, rec).join() === 'pass,pass',
                  say(D, 'a layer the target can apply runs', show(statuses(ctx, rec))),
                ],
              ]);
            return expectAll([
              [statuses(ctx, rec)[1] === 'not_run', say(D, 'the block is not_run', show(statuses(ctx, rec)))],
              [
                b.pass === false && b.verdicts.length === 0,
                say(
                  D,
                  'a block not run has pass false and no verdicts',
                  `pass ${b.pass}, ${b.verdicts.length} verdicts`,
                ),
              ],
              [b.notRun?.kind === 'unsupported', say(D, 'kind unsupported', show(b.notRun))],
              [b.notRun?.check === 'capability', say(D, 'the capability check', show(b.notRun))],
              [
                ['layer', 'expected', 'got'].every((key) => {
                  const text = b.notRun?.[key];
                  return typeof text === 'string' && text.length > 0;
                }),
                say(
                  D,
                  'the notRun record names the layer, what was expected and what the target declares',
                  show(b.notRun),
                ),
              ],
              [
                String(b.notRun?.expected ?? '').includes(layer.expect),
                say(D, `what was expected names ${layer.expect}`, show(b.notRun)),
              ],
            ]);
          },
        ),
      );
    }
  for (const n of [2, 3, 4])
    out.push(
      gitem(
        FAMILY,
        `bg.outcome.not-run.mode-t-after-the-first.${n}`,
        4,
        CORE,
        'OC8',
        'in mode T a block after the first needs seedPrefix: without it the first block runs and the others are not_run',
        async (ctx) => {
          const tag = `bg.outcome.not-run.mode-t-after-the-first.${n}`;
          const sc = scenario(ctx.seed, tag, blocks(ctx.seed, tag, n));
          const off = await play(ctx, sc, { mode: 'T', capabilities: { seedPrefix: false } });
          const on = await play(ctx, scenario(ctx.seed, `${tag}:on`, blocks(ctx.seed, `${tag}:on`, n)), {
            mode: 'T',
          });
          const want = ['pass', ...Array.from({ length: n - 1 }, () => 'not_run')];
          return expectAll([
            [
              statuses(ctx, off.rec).join() === want.join(),
              say(D, `blocks ${want.join()}`, show(statuses(ctx, off.rec))),
            ],
            [
              statuses(ctx, on.rec).every((s) => s === 'pass'),
              say(D, 'with seedPrefix every block runs', show(statuses(ctx, on.rec))),
            ],
          ]);
        },
      ),
    );
  return out;
}

export function outcomeItems(): BankItem[] {
  return [
    ...ruleItems(),
    ...orderItems(),
    ...endVerdictItems(),
    ...countItems(),
    ...recordItems(),
    ...notRunItems(),
  ];
}
