import type { StackApi, StackDecision, StackRequest } from '../../sut/port';
import { fail, type ItemContext, type Outcome, Problem, pass, type Run } from '../types';

// Expected values come from the normative stack contract, never reader code or model output.
const vector = (rule: number, description: number, none: number) => ({ rule, description, none });
const request = (extra: Partial<StackRequest> = {}): StackRequest => ({
  probabilities: vector(0.5, 0.3, 0.2),
  system1Label: 'rule',
  system2Votes: ['description', 'description', 'description'],
  marginCut: 0.5,
  ...extra,
});
const api = (ctx: ItemContext): StackApi => {
  if (!ctx.sut.stack) throw new Problem('the reader has no stack capability');
  return ctx.sut.stack;
};
const equal = (got: StackDecision, label: string, by: 'system1' | 'system2') =>
  got?.label === label && got.by === by;
async function positive(stack: StackApi): Promise<void> {
  const got = await stack.decide(request());
  if (!equal(got, 'description', 'system2'))
    throw new Problem('positive witness: unanimous system 2 must produce description');
}
async function cases(ctx: ItemContext, rows: Array<[StackRequest, StackDecision]>): Promise<Outcome> {
  const stack = api(ctx);
  await positive(stack);
  for (const [input, expected] of rows) {
    const got = await stack.decide(input);
    if (expected === undefined ? got !== undefined : !equal(got, expected.label, expected.by))
      return fail(`stack decision ${JSON.stringify(got)}; expected ${JSON.stringify(expected)}`);
  }
  return pass(`${rows.length} contract outcomes, with a positive acceptance control`);
}
const first = { label: 'rule', by: 'system1' } as const;
const second = { label: 'description', by: 'system2' } as const;

export const stackRuns: Record<string, Run> = {
  'stack-margin-exact': async (ctx) => {
    const stack = api(ctx);
    for (const [probabilities, label, margin] of [
      [vector(0.75, 0.125, 0.125), 'rule', 0.625],
      [vector(0.125, 0.25, 0.625), 'none', 0.375],
      [vector(0.5, 0.5, 0), 'rule', 0],
    ] as const) {
      const got = await stack.margin(probabilities);
      if (!got || !Number.isFinite(got.margin) || Math.abs(got.margin - margin) > 1e-12)
        return fail(`margin ${got?.margin}, expected ${margin}`);
      // A tied top label is unspecified; only its zero margin is contractual.
      if (margin !== 0 && got.label !== label) return fail(`top label ${got.label}, expected ${label}`);
    }
    return pass('planted sorted-vector differences and top labels');
  },
  'stack-margin-invalid': async (ctx) => {
    const stack = api(ctx);
    const good = await stack.margin(vector(0.75, 0.125, 0.125));
    if (good?.label !== 'rule' || good.margin !== 0.625)
      return fail('positive witness: valid vector must produce rule with margin 0.625');
    for (const bad of [
      vector(-0.1, 0.6, 0.5),
      vector(1.1, 0, -0.1),
      vector(Number.NaN, 0, 1),
      vector(Number.POSITIVE_INFINITY, 0, 0),
      vector(0.4, 0.3, 0.2),
      vector(0.6, 0.3, 0.2),
    ]) {
      let refused = false;
      try {
        await stack.margin(bad);
      } catch {
        refused = true;
      }
      if (!refused) return fail('an invalid probability vector was not rejected');
    }
    return pass('invalid probabilities rejected; valid positive control retained');
  },
  'stack-margin-boundary': (ctx) =>
    cases(ctx, [
      [request({ probabilities: vector(0.75, 0.25, 0), marginCut: 0.5 }), first],
      [request({ probabilities: vector(0.75, 0.25, 0), marginCut: 0.5001 }), second],
      [request({ probabilities: vector(0.75, 0.25, 0), marginCut: 0.4999 }), first],
    ]),
  'stack-zero-cut': (ctx) =>
    cases(ctx, [
      [request({ marginCut: 0 }), first],
      [
        request({
          probabilities: vector(0.25, 0.5, 0.25),
          system1Label: 'description',
          marginCut: 0,
          system2Votes: ['rule', 'rule', 'rule'],
        }),
        { label: 'description', by: 'system1' },
      ],
    ]),
  'stack-monotone-routing': async (ctx) => {
    const stack = api(ctx);
    await positive(stack);
    const vectors = [vector(0.5, 0.5, 0), vector(0.75, 0.25, 0), vector(1, 0, 0)];
    const table = [
      [0, ['system1', 'system1', 'system1']],
      [0.25, ['system2', 'system1', 'system1']],
      [0.5, ['system2', 'system1', 'system1']],
      [0.75, ['system2', 'system2', 'system1']],
      [1, ['system2', 'system2', 'system1']],
    ] as const;
    for (const [marginCut, routes] of table) {
      for (const [i, probabilities] of vectors.entries()) {
        const got = await stack.decide(request({ probabilities, marginCut }));
        const by = routes[i];
        if (!got || got.by !== by || got.label !== (by === 'system1' ? 'rule' : 'description'))
          return fail(`cut ${marginCut}, vector ${i}: wrong accepted label or route`);
      }
    }
    return pass('exact nested route sets across five cuts, with full accepted labels');
  },
  'stack-unanimity': (ctx) =>
    cases(ctx, [
      [request(), second],
      [request({ system2Votes: ['rule', 'rule', 'rule'] }), { label: 'rule', by: 'system2' }],
      [request({ system2Votes: ['none', 'none', 'none'] }), { label: 'none', by: 'system2' }],
    ]),
  'stack-unsure-disagreement': (ctx) =>
    cases(ctx, [
      [request({ system2Votes: ['description', 'description', 'rule'] }), undefined],
      [request({ system2Votes: ['description', 'rule', 'description'] }), undefined],
      [request({ system2Votes: ['rule', 'description', 'description'] }), undefined],
    ]),
  'stack-missing-vote': (ctx) =>
    cases(ctx, [
      [request({ system2Votes: [null, 'description', 'description'] }), undefined],
      [request({ system2Votes: ['description', null, 'description'] }), undefined],
      [request({ system2Votes: ['description', 'description', null] }), undefined],
    ]),
  'stack-malformed-vote': (ctx) =>
    cases(ctx, [
      [request({ system2Votes: ['', 'description', 'description'] }), undefined],
      [request({ system2Votes: ['description', 'outside-declared-set', 'description'] }), undefined],
      [request({ system2Votes: ['description', 'description', ' '] }), undefined],
    ]),
  'stack-require-agreement': (ctx) =>
    cases(ctx, [
      [request({ requireAgreement: false }), second],
      [request({ requireAgreement: true }), undefined],
      [
        request({ requireAgreement: true, system2Votes: ['rule', 'rule', 'rule'] }),
        { label: 'rule', by: 'system2' },
      ],
      [request({ requireAgreement: true, probabilities: vector(1, 0, 0) }), undefined],
      [
        request({
          requireAgreement: true,
          probabilities: vector(1, 0, 0),
          system2Votes: ['rule', 'rule', 'rule'],
        }),
        first,
      ],
    ]),
  'stack-route-independent': (ctx) =>
    cases(ctx, [
      [request({ probabilities: vector(1, 0, 0) }), first],
      [request({ probabilities: vector(0.875, 0.125, 0) }), first],
      [request({ probabilities: vector(0.75, 0.25, 0), marginCut: 0.5 }), first],
      [request({ probabilities: vector(1, 0, 0) }), first],
      [request({ probabilities: vector(0.5, 0.3, 0.2), marginCut: 0.5 }), second],
      [request({ probabilities: vector(0.75, 0.25, 0), marginCut: 0.5 }), first],
    ]),
  'stack-no-empty-label': (ctx) =>
    cases(ctx, [
      [request({ system2Votes: ['', '', ''] }), undefined],
      [request({ system2Votes: [null, null, null] }), undefined],
      [
        request({ system2Votes: ['outside-declared-set', 'outside-declared-set', 'outside-declared-set'] }),
        undefined,
      ],
    ]),
};
