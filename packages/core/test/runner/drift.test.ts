import { defaultChecks } from '@agent-nexus/driftbench-checks';
import { machineVerdict, type Observed, type RunResult } from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { type AcmeAgent, acmeReplayer } from '../../../../examples/acme/src/index';
import {
  classifyStage,
  driftOf,
  flowVerdicts,
  ledgerContradictions,
  ledgerVerdicts,
  runSpec,
  stageSignatures,
  succession,
} from '../../src/runner';
import { acmeSpec, broken, loadAcmeConversations, realAcmeAdapter, specOf } from './support';

const loaded = await loadAcmeConversations();
const driver = createScriptedDriver();
const upgrade = acmeSpec(loaded, 'acme-plan-upgrade');

function observedOf(text: string, calls: Array<{ label: string; input?: unknown }> = []): Observed {
  return {
    segments: [{ type: 'text', text }],
    text,
    toolCalls: calls.map((call, index) => ({ id: `c${index}`, label: call.label, input: call.input ?? {} })),
    cost: { usd: 0 },
    latencyMs: 0,
  };
}

const user = (content: string) => ({ role: 'user' as const, content });

/** The Acme agent with its runtime stages removed: the step classifier must read the stage. */
const noStages = broken((observed) => {
  if (observed.runtime) delete observed.runtime.stages;
});

async function run(
  wrap: ((agent: AcmeAgent) => AcmeAgent) | undefined,
  mode: 'T' | 'F' = 'F',
  id = upgrade.id,
) {
  return runSpec(acmeSpec(loaded, id), {
    adapter: realAcmeAdapter(wrap),
    driver,
    // The Acme tools replay for the value check, so a wrong plan id is a fail of the tools check, not undecided.
    checks: defaultChecks({ valueCheck: { services: { replayer: acmeReplayer() } } }),
    mode,
    repeat: 0,
  });
}

function gatingFails(result: RunResult, block: number): string[] {
  return (result.blocks[block]?.verdicts ?? [])
    .filter((verdict) => verdict.gating && verdict.outcome === 'fail')
    .map((verdict) => verdict.id);
}

describe('the ledger check', () => {
  it('compares tool inputs with the ledger, nested and by a key written either way', () => {
    const ledger = {
      customer_id: 'cust-001',
      plan_id: 'mobile-l',
      phone: '+12025550188',
      customer: 'existing',
    };
    const found = ledgerContradictions(
      ledger,
      observedOf('done', [
        { label: 'order.create', input: { customerId: 'CUST-001 ', plan_id: 'mobile-s' } },
        { label: 'notify_sales', input: { customer: { phone: '+1 (202) 555-0188' } } },
      ]),
      [],
    );
    expect(found.checked.sort()).toEqual(['customer_id', 'phone', 'plan_id']);
    expect(found.contradictions).toEqual([
      {
        fact: 'plan_id',
        source: 'tool',
        ledger: 'mobile-l',
        observed: 'mobile-s',
        where: 'order.create.plan_id',
      },
    ]);
  });

  it('finds a reply that silently takes a second phone number the user gave, and not one that asks which', () => {
    const ledger = { phone: '+12025550188' };
    const said = [user('My number is +1 202 555 0188'), user('Actually use +1 202 555 0177')];
    const took = ledgerContradictions(ledger, observedOf('Booked a callback on +1 202 555 0177.'), said);
    expect(took.contradictions).toEqual([
      { fact: 'phone', source: 'reply', ledger: '+12025550188', observed: '+1 202 555 0177', where: 'reply' },
    ]);
    const asks = ledgerContradictions(
      ledger,
      observedOf('Which number should we use: +1 202 555 0188 or +1 202 555 0177?'),
      said,
    );
    expect(asks).toEqual({ checked: ['phone'], contradictions: [] });
  });

  it('reads no contradiction from a number the user never gave, a date, or a fact that holds a structure', () => {
    const ledger = { phone: '+12025550188', email: 'sam.rivera@example.com', basket: { items: 2 } };
    const said = [user('I am sam.rivera@example.com, call +1 202 555 0188 on 2026-10-11')];
    const care = ledgerContradictions(
      ledger,
      observedOf('Call Acme Care on +1 202 555 0100 before 2026-10-12.'),
      said,
    );
    expect(care.contradictions).toEqual([]);
    const other = ledgerContradictions(
      { email: 'sam.rivera@example.com' },
      observedOf('I will write to sam@example.com.'),
      [user('sam.rivera@example.com'), user('or sam@example.com')],
    );
    expect(other.contradictions.map((entry) => entry.observed)).toEqual(['sam@example.com']);
  });

  it('gives one gating verdict per fact stated, failing on a contradiction', () => {
    const { verdicts } = ledgerVerdicts(
      { plan_id: 'mobile-l', customer_id: 'cust-001' },
      observedOf('ok', [{ label: 'order.create', input: { plan_id: 'mobile-s', customer_id: 'cust-001' } }]),
      [],
    );
    expect(verdicts.map((verdict) => [verdict.id, verdict.outcome, verdict.gating])).toEqual([
      ['ledger.plan_id', 'fail', true],
      ['ledger.customer_id', 'pass', true],
    ]);
    expect(verdicts[0]?.evidence).toBe(
      'plan_id: order.create.plan_id is "mobile-s", the ledger holds "mobile-l"',
    );
  });

  it('marks X2 in a run when the agent orders a plan the ledger does not hold, beside the X5 of the tools check', async () => {
    const wrongPlan = broken((observed) => {
      for (const call of observed.toolCalls) {
        if (call.label === 'order.create' && call.input && typeof call.input === 'object') {
          (call.input as Record<string, unknown>).plan_id = 'mobile-s';
        }
      }
    });
    const result = await run(wrongPlan);
    expect(result.blocks[3]?.drift).toEqual(['X2_contradiction', 'X5_tool']);
    expect(gatingFails(result, 3)).toEqual(['tools.order.create.input.plan_id', 'ledger.plan_id']);
    expect(result.blocks[3]?.ledgerCheck).toEqual({
      ok: false,
      contradictions: ['plan_id: the ledger holds "mobile-l", order.create.plan_id sent "mobile-s"'],
    });
  });

  it('holds on every block of the six Acme specs with the deterministic agent, in T and F', async () => {
    for (const { spec } of loaded) {
      for (const mode of ['T', 'F'] as const) {
        const result = await run(undefined, mode, spec.id);
        for (const block of result.blocks) {
          expect(block.ledgerCheck, `${spec.id} ${mode} block ${block.index}`).toEqual({
            ok: true,
            contradictions: [],
          });
          expect(block.drift).toEqual([]);
        }
      }
    }
  });
});

describe('the step classifier', () => {
  it('reads the tools each stage expects from the spec', () => {
    const signatures = stageSignatures(upgrade);
    expect(Object.fromEntries([...signatures].map(([stage, tools]) => [stage, [...tools]]))).toEqual({
      identify: [],
      offer: ['catalog.search'],
      recap: [],
      order_placed: ['order.create'],
      callback: [],
      handover: [],
      closing: [],
    });
  });

  it('classifies by the called tools, carries the stage over a block with none, and starts at the first stage with none', () => {
    expect(classifyStage(upgrade, observedOf('hi'), undefined)).toMatchObject({
      stage: 'identify',
      source: 'start',
    });
    expect(
      classifyStage(upgrade, observedOf('M or L?', [{ label: 'catalog.search' }]), 'identify'),
    ).toMatchObject({
      stage: 'offer',
      source: 'tools',
    });
    expect(classifyStage(upgrade, observedOf('Reply CONFIRM'), 'offer')).toMatchObject({
      stage: 'offer',
      source: 'carried',
    });
    expect(classifyStage(upgrade, observedOf('?', [{ label: 'weather.get' }]), 'offer')).toBeUndefined();
    expect(
      classifyStage(specOf({ id: 'flat', blocks: [{ user: 'a' }] }), observedOf('x'), undefined),
    ).toBeUndefined();
  });

  it('breaks a tie with the first stage at or after the stage before the block', () => {
    const spec = specOf({
      id: 'tie',
      stages: ['a', 'b', 'c'],
      blocks: [
        { user: '1', expect: { stage: 'a', tools: [{ label: 'look' }] } },
        { user: '2', expect: { stage: 'c', tools: [{ label: 'look' }] } },
      ],
    });
    expect(classifyStage(spec, observedOf('', [{ label: 'look' }]), undefined)?.stage).toBe('a');
    expect(classifyStage(spec, observedOf('', [{ label: 'look' }]), 'b')?.stage).toBe('c');
  });

  it('assigns the stage when the runtime reports none: the Acme agent without stages still passes', async () => {
    const result = await run(noStages);
    expect(result.blocks.map((block) => block.stageObserved)).toEqual([
      'identify',
      'offer',
      'offer',
      'order_placed',
      'order_placed',
    ]);
    expect(
      result.blocks.map((block) => block.verdicts.find((verdict) => verdict.id === 'flow.stage')?.outcome),
    ).toEqual(['inconclusive', 'pass', 'inconclusive', 'pass', 'inconclusive']);
    expect(result.blocks.every((block) => block.pass)).toBe(true);
  });

  it('gives X3 when the tools show a skipped stage: an order placed on the recap block', async () => {
    const eager = (agent: AcmeAgent): AcmeAgent => ({
      async respond(messages, world) {
        const observed = await agent.respond(messages, world);
        if (observed.runtime) delete observed.runtime.stages;
        if (messages.filter((message) => message.role === 'user').length === 3) {
          observed.toolCalls.push({
            id: 'x',
            label: 'order.create',
            input: { plan_id: 'mobile-l' },
            output: {},
          });
        }
        return observed;
      },
    });
    const result = await run(eager);
    const flow = result.blocks[2]?.verdicts.find((verdict) => verdict.id === 'flow.stage');
    expect(flow).toMatchObject({ outcome: 'fail', gating: true });
    expect(flow?.evidence).toContain('skipped ahead past recap');
    expect(result.blocks[2]?.drift).toEqual(['X3_flow', 'X5_tool']);
  });

  it('names a flow that goes back when the block expects no stage', () => {
    const spec = specOf({ id: 'back', stages: ['a', 'b'], blocks: [{ user: '1' }] });
    const back = flowVerdicts(spec, {}, { stage: 'a', source: 'runtime', evidence: '' }, 'b');
    expect(back.map((verdict) => [verdict.id, verdict.outcome])).toEqual([['flow.order', 'fail']]);
    const on = flowVerdicts(spec, {}, { stage: 'b', source: 'runtime', evidence: '' }, 'a');
    expect(on.map((verdict) => verdict.outcome)).toEqual(['pass']);
    expect(flowVerdicts(spec, { stage: 'a' }, { stage: 'b', source: 'runtime', evidence: '' }, 'a')).toEqual(
      [],
    );
  });
});

describe('drift classes and succession', () => {
  it('maps every family, keeps several classes on one block, and leaves passing blocks clean', () => {
    const verdicts = [
      machineVerdict('must', '0', 'fail', 'x'),
      machineVerdict('ledger', 'phone', 'fail', 'x'),
      machineVerdict('flow', 'stage', 'fail', 'x'),
      machineVerdict('cards', 'offer.count', 'fail', 'x'),
      machineVerdict('tools', 'a.count', 'fail', 'x'),
    ];
    expect(driftOf(verdicts)).toEqual(['X1_local', 'X2_contradiction', 'X3_flow', 'X4_format', 'X5_tool']);
    expect(driftOf([machineVerdict('must', '0', 'pass', 'x')])).toEqual([]);
    expect(driftOf([machineVerdict('must', '0', 'fail', 'x', { gating: false })])).toEqual([]);
  });

  it('computes the succession of a run that drifts after block 2, checked by hand', async () => {
    const drifts = (agent: AcmeAgent): AcmeAgent => ({
      async respond(messages, world) {
        const observed = await agent.respond(messages, world);
        if (messages.filter((message) => message.role === 'assistant').length >= 3) {
          observed.text = 'Sorry, what is your email address?';
          observed.segments = [{ type: 'text', text: observed.text }];
        }
        return observed;
      },
    });
    const result = await run(drifts);
    expect(result.blocks.map((block) => block.pass)).toEqual([true, true, true, false, false]);
    expect(result.blocks.map((block) => block.drift)).toEqual([[], [], [], ['X1_local'], ['X1_local']]);
    expect(result.succession).toEqual({
      firstDriftBlock: 3,
      driftCount: 2,
      driftRate: 0.4,
      longestClean: 3,
      minOverBlocks: false,
    });
    expect(succession([])).toEqual({ driftCount: 0, driftRate: 0, longestClean: 0, minOverBlocks: false });
  });
});
