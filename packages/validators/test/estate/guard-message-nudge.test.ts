import type { Observed, Spec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { completionComponents } from '../../src/ladders/estate/completion';

/** Hand-written guards of an invented harbour estate: none of them is a guard of the bank. */
const GUARDS = [
  ['berth-fee.sh', 'deny'],
  ['quay-lock.sh', 'block'],
  ['tide-alarm.sh', 'warn'],
  ['crew-brief.sh', 'nudge'],
] as const;

const specOf = (guard: string): Spec =>
  ({
    id: 'estate.test',
    version: '1',
    kind: 'task',
    title: 't',
    blocks: [{ id: 'ask', when: { user: 'Berth the Aster.' }, expect: {} }],
    rules: { custom: { guard_message: { name: guard, mustNot: ['never'], block: 0 } } },
  }) as unknown as Spec;

const observedWith = (guard: string, verdict: string): Observed =>
  ({
    segments: [],
    text: '',
    toolCalls: [],
    cost: { usd: 0 },
    latencyMs: 0,
    runtime: {
      guards: [
        {
          name: guard,
          verdict,
          stdout: '',
          stderr: 'Check the berth fee first.',
          exitCode: verdict === 'deny' ? 2 : 0,
        },
      ],
    },
  }) as unknown as Observed;

describe('the guard_message component treats every acting verdict as an intervention', () => {
  it.each(GUARDS)(
    '%s answers %s: removing the intervention removes the run, renaming it hides it',
    (guard, verdict) => {
      const { components, gaps } = completionComponents(specOf(guard));
      expect(gaps).toEqual([]);
      const exists = components.find((component) => component.id.endsWith('intervention.exists'));
      if (!exists) throw new Error('no intervention.exists component');
      const o = observedWith(guard, verdict);
      exists.change(o);
      expect(o.runtime?.guards).toEqual([]);
      for (const component of components.filter((c) => c.id.includes('intervention.selector.'))) {
        const renamed = observedWith(guard, verdict);
        component.change(renamed);
        expect(renamed.runtime?.guards?.[0]?.name, component.id).not.toBe(guard);
      }
    },
  );

  it('a verdict outside the acting four is no intervention, and no spelling of an acting verdict other than deny and block is excluded as a near miss of one', () => {
    const { components } = completionComponents(specOf('tide-alarm.sh'));
    const excluded = components
      .map((component) => /intervention\.exclude\.(.+)$/.exec(component.id)?.[1])
      .filter((verdict): verdict is string => verdict !== undefined);
    expect(excluded).toContain('allow');
    for (const acting of ['warn', 'nudge', 'deny', 'block']) expect(excluded).not.toContain(acting);
    expect(excluded).toContain('NUDGE');
    expect(excluded).toContain('nudge_extra');
    const o = observedWith('tide-alarm.sh', 'allow');
    const exists = components.find((component) => component.id.endsWith('intervention.exists'));
    exists?.change(o);
    // An allow run was never an intervention: removing interventions leaves it.
    expect(o.runtime?.guards).toHaveLength(1);
  });
});
