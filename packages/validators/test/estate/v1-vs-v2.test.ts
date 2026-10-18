import type { Spec } from '@agent-nexus/driftbench-core';
import type { Atom } from '@agent-nexus/driftbench-estate';
import { describe, expect, it } from 'vitest';
import { observed } from '../../../checks/test/support/context';
import type { SuiteSpec } from '../../src/ladders/estate/bank/fixture-suite';
import { holdsTask, taskFamily } from '../../src/ladders/estate/bank/genquality';
import { actOfAtom } from '../../src/ladders/estate/bank/task-act';
import { checkAsk, envOf } from '../../src/ladders/estate/bank/task-check';
import { judgeSpecs, taskFamilyV2 } from '../../src/ladders/estate/bank/taskv2';

/** The old entry point now uses the same structured oracle, retaining its bank contract. */
it('preserves every legacy item id, tier, title, cause and component', () => {
  const legacy = taskFamily();
  const structural = taskFamilyV2();
  expect(legacy.items.map((item) => item.id)).toEqual([
    'gen.task.obligation',
    'gen.task.outside_trigger',
    'gen.task.twin',
    'gen.task.ordered_pair',
    'gen.task.skip_pressure',
    'gen.task.route_positive',
    'gen.task.route_near_miss',
    'gen.task.misroute',
    'gen.task.read_when',
    'gen.task.script_fixture',
    'gen.task.dispatch',
    'gen.task.contract_alone',
    'gen.task.stop_resume',
    'gen.task.guard_positive',
    'gen.task.guard_negative',
    'gen.task.guard_hostile',
    'gen.task.tool_boundary',
    'gen.task.tool_denied',
    'gen.task.stage_order',
    'gen.task.stage_skip',
    'gen.task.register_sample',
    'gen.task.hazard_recovery',
    'gen.task.journey',
  ]);
  expect(legacy.items).toEqual(
    structural.items.map((item) => ({
      ...item,
      family: 'gen.task',
      id: item.id.replace('gen.task.v2.', 'gen.task.'),
    })),
  );
  for (const item of legacy.items) {
    expect(item.tier).toBe(2);
    expect(item.cause).toBe('write every ask as a task, never as a restated rule or a bare condition');
  }
});

const atom = (kind: 'guard' | 'instruction'): Atom => ({
  id: `fixture.${kind}`,
  kind,
  title: 'Fictional harbour result',
  approved: true,
  producedBy: 'code',
  role: 'axis',
  enforcement: [],
  provenance: {
    file: 'CLAUDE.md',
    startLine: 1,
    endLine: 1,
    quote: 'Fictional harbour result',
    hash: 'fixture-hash',
  },
  ...(kind === 'guard'
    ? {
        fields: { name: 'harbour-guard' },
        evidence: [{ type: 'guard', name: 'harbour-guard', verdict: 'deny' }],
      }
    : {
        replyAct: { id: 'report', evidence: { type: 'text_segment', part: 'reply' } },
        evidence: [{ type: 'text', must: ['BERTH-42'] }],
      }),
});
function fixture(unit: Atom, ask: string) {
  const env = envOf(
    [unit],
    { situations: [{ id: 'approved', atoms: [unit.id], phrases: [{ text: ask, approved: true }] }] },
    { sessions: [] },
  );
  const spec: SuiteSpec = {
    id: 'fixture',
    path: 'fictional.yaml',
    atoms: [unit.id],
    mode: 'live',
    testType: 'obligation',
    complete: true,
    spec: {
      id: 'fixture',
      blocks: [{ id: 'ask', when: { user: ask } }],
      metadata: {
        estate: {
          atoms: [unit.id],
          act: actOfAtom(unit, [unit]),
          link: { span: unit.id, fp: unit.provenance.hash, relation: 'exercises', createdBy: 'generator' },
          from: { bank: 'approved', phrase: 0 },
        },
      },
    } as unknown as Spec,
  };
  return { env, spec };
}

describe.each(['guard', 'instruction'] as const)('both oracle entry points judge a %s act', (kind) => {
  const right =
    kind === 'guard'
      ? observed('', [], { runtime: { guards: [{ name: 'harbour-guard', verdict: 'deny' }] } })
      : observed('BERTH-42', [], {
          replyAct: {
            id: 'report',
            evidence: { type: 'text_segment', part: 'reply', index: 0 },
            source: { kind: 'adapter', name: 'fictional-harbour-adapter' },
          },
        });
  const wrong =
    kind === 'guard'
      ? observed('', [], { runtime: { guards: [{ name: 'other-guard', verdict: 'deny' }] } })
      : observed('BERTH-42', [], {
          replyAct: {
            id: 'answer',
            evidence: { type: 'text_segment', part: 'reply', index: 0 },
            source: { kind: 'adapter', name: 'fictional-harbour-adapter' },
          },
        });

  it('rejects a previously allowed verb when the trace shows the wrong act', async () => {
    const { spec, env } = fixture(atom(kind), 'Please run the inventory report.');
    expect(checkAsk(spec, env).reasons).toEqual([]);
    expect(holdsTask(spec, env, wrong)).toBe(false);
    const [result] = await judgeSpecs([spec], env, async () => new Map([[spec.id, wrong]]));
    expect(result?.reasons).toEqual([expect.stringContaining('does not show the act')]);
  });

  it('accepts an unlisted verb with the right act, and rejects an absent trace', async () => {
    const { spec, env } = fixture(atom(kind), 'Please berthify the vessel.');
    expect(holdsTask(spec, env, right)).toBe(true);
    const [result] = await judgeSpecs([spec], env, async () => new Map([[spec.id, right]]));
    expect(result?.reasons).toEqual([]);
    expect(holdsTask(spec, env)).toBe(false);
    const [absent] = await judgeSpecs([spec], env, async () => new Map());
    expect(absent?.reasons).toEqual(['the fake did not run the ask']);
  });
});
