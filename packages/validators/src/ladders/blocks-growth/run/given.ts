import { load, loadIssues, observed, type RawSpec, run, scriptedAdapter } from '../../blocks/harness';
import { need } from '../../blocks/product';
import {
  type BankItem,
  blocks,
  CORE,
  expectAll,
  fail,
  gitem,
  type ItemContext,
  type ItemResult,
  PASS,
  type Plan,
  play,
  runLoaded,
  say,
  scenario,
  show,
  word,
} from './kit';

/**
 * bg-given: the verdicts that do not gate, the words a Given accepts and the stimulus a block writes
 * (docs/concepts/block.md "What a block records", docs/concepts/given-when-then.md "Given", "When", "Then").
 */

const FAMILY = 'bg-modes';
const D_REC = 'docs/concepts/block.md "What a block records"';
const D_GIVEN = 'docs/concepts/given-when-then.md "Given"';
const D_WHEN = 'docs/concepts/given-when-then.md "When"';
const D_THEN = 'docs/concepts/given-when-then.md "Then"';

type VerdictLike = { id: string; name?: string; outcome: string; gating: boolean };

function gatingItems(): BankItem[] {
  const out: BankItem[] = [];
  const cases: {
    id: string;
    expect: string;
    reported?: string;
    pass: boolean;
    verdict: 'inconclusive' | 'fail' | 'pass';
  }[] = [
    { id: 'no-finish-reason-reported', expect: 'stop', pass: true, verdict: 'inconclusive' },
    { id: 'finish-reason-matches', expect: 'stop', reported: 'stop', pass: true, verdict: 'pass' },
    { id: 'finish-reason-is-length', expect: 'stop', reported: 'length', pass: false, verdict: 'fail' },
    { id: 'another-expected-reason-not-reported', expect: 'length', pass: true, verdict: 'inconclusive' },
  ];
  for (const each of cases)
    out.push(
      gitem(
        FAMILY,
        `bg.given.gating.${each.id}`,
        3,
        CORE,
        'GV1',
        'a block passes when every gating verdict passes: a verdict that does not gate never fails it',
        async (ctx) => {
          const tag = `bg.given.gating.${each.id}`;
          const defs = blocks(ctx.seed, tag, 2);
          (defs[0] as { expect: Record<string, unknown> }).expect.finish_reason = each.expect;
          const sc = scenario(ctx.seed, tag, defs);
          const adapter = scriptedAdapter(ctx.product, (turn) => {
            const key = [...sc.plans.keys()].find((each2) => turn.user.includes(each2)) as string;
            const plan = sc.plans.get(key) as Plan;
            const base = observed(plan.text, []);
            const first = turn.user.includes(sc.users[0] as string);
            return first && each.reported ? { ...base, runtime: { finishReason: each.reported } } : base;
          });
          const rec = await runLoaded(ctx.product, load(ctx.product, sc.raw), adapter);
          const block = rec.blocks[0];
          const v = (block?.verdicts ?? []).find((x) => (x as VerdictLike).id.startsWith('finish_reason')) as
            | VerdictLike
            | undefined;
          return expectAll([
            [v?.outcome === each.verdict, say(D_REC, `a finish_reason verdict ${each.verdict}`, show(v))],
            [
              each.verdict !== 'inconclusive' || v?.gating === false,
              say(D_REC, 'an inconclusive finish_reason verdict does not gate', show(v)),
            ],
            [
              block?.pass === each.pass,
              say(D_REC, `the block ${each.pass ? 'passes' : 'fails'}`, `pass ${block?.pass}`),
            ],
          ]);
        },
      ),
    );
  return out;
}

function originItems(): BankItem[] {
  const out: BankItem[] = [];
  for (const [id, origin, accepted] of [
    ['authored', 'authored', true],
    ['recorded', 'recorded', true],
    ['canonical', 'canonical', true],
    ['another-word', null, false],
    ['another-word-two', null, false],
  ] as [string, string | null, boolean][])
    out.push(
      gitem(
        FAMILY,
        `bg.given.origin.${id}`,
        3,
        CORE,
        'GW1',
        'a Given origin is one of authored, recorded or canonical: any other word is refused',
        async (ctx) => {
          const tag = `bg.given.origin.${id}`;
          const word1 = origin ?? word(ctx.seed, `${tag}:origin`, 8);
          const prefix = [
            { role: 'user', content: word(ctx.seed, `${tag}:pu`, 9) },
            { role: 'assistant', content: word(ctx.seed, `${tag}:pa`, 9) },
          ];
          const raw = scenario(
            ctx.seed,
            tag,
            blocks(ctx.seed, tag, 2, {}, { 1: { given: { origin: word1, prefix } } }),
          ).raw;
          const result = loadIssues(ctx.product, raw);
          return result.ok === accepted
            ? PASS
            : fail(
                say(
                  D_GIVEN,
                  `a spec with origin ${word1} is ${accepted ? 'loaded' : 'refused'}`,
                  `${result.ok ? 'loaded' : `refused: ${result.codes.join()}`}`,
                ),
              );
        },
      ),
    );
  return out;
}

function lintItems(): BankItem[] {
  const out: BankItem[] = [];
  for (const k of [0, 1, 2])
    out.push(
      gitem(
        FAMILY,
        `bg.given.then.no-expect-is-linted.${k}`,
        3,
        CORE,
        'GW2',
        'a block with no expect checks nothing and spec lint warns about it',
        async (ctx) => {
          const tag = `bg.given.then.no-expect-is-linted.${k}`;
          const n = 3 + k;
          const at = k + 1;
          const make = (bare: boolean) => {
            const raw = scenario(ctx.seed, tag, blocks(ctx.seed, tag, n)).raw as RawSpec;
            if (bare) delete (raw.blocks[at] as Record<string, unknown>).expect;
            return load(ctx.product, raw);
          };
          const lintSpec = need<(spec: unknown) => { code: string; path: string }[]>(
            ctx.product.core,
            'core',
            'lintSpec',
          );
          const full = lintSpec(make(false)).map((issue) => issue.path);
          const bare = lintSpec(make(true)).map((issue) => issue.path);
          const added = bare.filter((path) => !full.includes(path));
          return added.length >= 1 && added.every((path) => path.startsWith(`blocks.${at}`))
            ? PASS
            : fail(
                say(
                  D_THEN,
                  `spec lint warns at blocks.${at} when it has no expect`,
                  `new warnings ${show(added)}`,
                ),
              );
        },
      ),
    );
  return out;
}

function injectionItems(): BankItem[] {
  const out: BankItem[] = [];
  for (const mode of ['F', 'T'] as const)
    out.push(
      gitem(
        FAMILY,
        `bg.given.when.injection-stimulus-runs-in-${mode}`,
        4,
        CORE,
        'GW3',
        'a block whose stimulus is an injection is part of the script: it runs, with the injected text as its message, in every mode',
        async (ctx) => {
          const tag = `bg.given.when.injection-stimulus-runs-in-${mode}`;
          const n = 3;
          const sc = scenario(ctx.seed, tag, blocks(ctx.seed, tag, n));
          const at = 1;
          const marker = sc.users[at] as string;
          const block = sc.raw.blocks[at] as Record<string, unknown>;
          delete block.user;
          block.when = { injection: { class: 'D6_instruction_in_data', user: marker } };
          const seen: string[] = [];
          const adapter = scriptedAdapter(ctx.product, (turn) => {
            seen.push(turn.user);
            const key = [...sc.plans.keys()].find((each) => turn.user.includes(each)) as string;
            const plan = sc.plans.get(key) as Plan;
            return observed(plan.text, []);
          });
          const rec = await run(ctx.product, sc.raw as RawSpec, adapter, { mode });
          return expectAll([
            [
              rec.status === 'completed' && rec.blocks.length === n,
              say(D_WHEN, `the run holds ${n} blocks`, `${rec.status}, ${rec.blocks.length} blocks`),
            ],
            [
              seen.length === n && seen[at]?.includes(marker) === true,
              say(D_WHEN, 'the injected text reaches the agent as the message of its block', show(seen)),
            ],
            [
              rec.blocks.every((b) => b.pass),
              say(D_WHEN, 'every block passes', show(rec.blocks.map((b) => b.pass))),
            ],
          ]);
        },
      ),
    );
  void play;
  return out;
}

export function givenItems(): BankItem[] {
  return [...gatingItems(), ...originItems(), ...lintItems(), ...injectionItems()];
}
void ({} as ItemContext);
void ({} as ItemResult);
