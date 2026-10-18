import type { Spec } from '@agent-nexus/driftbench-core';
import type { Atom } from '@agent-nexus/driftbench-estate';
import { expect, it } from 'vitest';
import { observed } from '../../../checks/test/support/context';
import type { SuiteSpec } from '../../src/ladders/estate/bank/fixture-suite';
import { holdsTask } from '../../src/ladders/estate/bank/genquality';
import { actOfAtom } from '../../src/ladders/estate/bank/task-act';
import { checkAsk, envOf } from '../../src/ladders/estate/bank/task-check';

function fixture() {
  const unit: Atom = {
    id: 'skill.fictional.berthify',
    kind: 'skill',
    title: 'Fictional harbour planning',
    approved: true,
    producedBy: 'code',
    role: 'axis',
    enforcement: [],
    evidence: [],
    provenance: {
      file: '.claude/skills/berthify/SKILL.md',
      startLine: 1,
      endLine: 3,
      quote: 'Plan a harbour departure from the tide table.',
      hash: 'fictional-source',
    },
    fields: { name: 'berthify', description: 'Plan a harbour departure from the tide table.' },
  };
  const act = actOfAtom(unit, [unit]);
  const candidate: SuiteSpec = {
    id: 'forged-name-piece',
    path: 'fictional-source.yaml',
    atoms: [unit.id],
    mode: 'live',
    testType: 'obligation',
    complete: true,
    spec: {
      id: 'forged-name-piece',
      blocks: [{ id: 'ask', when: { user: 'Please berthify.' } }],
      metadata: {
        estate: {
          atoms: [unit.id],
          act,
          link: { span: unit.id, fp: unit.provenance.hash, relation: 'exercises', createdBy: 'generator' },
          from: {
            form: 'description',
            field: `${unit.id}#description`,
            fp: unit.provenance.hash,
            frame: 'trigger',
            shape: '{}',
            pieces: ['berthify'],
          },
        },
      },
    } as unknown as Spec,
  };
  const env = envOf([unit], { situations: [] }, { sessions: [] });
  const trace = observed('', [{ label: 'Skill', input: { skill: 'berthify' } }]);
  expect(act).toEqual({ kind: 'skill', name: 'berthify' });
  return { unit, candidate, env, trace };
}

it('rejects a legacy description disclosure whose only piece comes from the skill name', () => {
  const { candidate, env, trace } = fixture();
  const verdict = checkAsk(candidate, env);
  expect(verdict.reasons).not.toEqual([]);
  expect(verdict.trace).toBeUndefined();
  expect(holdsTask(candidate, env, trace)).toBe(false);
});

it('rejects a forged structured ask that borrows its piece from the name instead of the declaration', () => {
  const { unit, candidate, env, trace } = fixture();
  const text = 'plan a harbour departure from the tide table';
  unit.fields = { ...unit.fields, ask: { text, act: actOfAtom(unit, [unit]) } };
  const meta = candidate.spec.metadata?.estate as { from: Record<string, unknown> };
  meta.from.form = 'structured ask';
  meta.from.field = `${unit.id}#structured ask`;
  expect(checkAsk(candidate, env).reasons).not.toEqual([]);
  expect(holdsTask(candidate, env, trace)).toBe(false);
  meta.from.pieces = [text];
  const block = candidate.spec.blocks[0];
  if (!block) throw new Error('missing ask block');
  block.when = { user: `Please ${text}.` };
  expect(checkAsk(candidate, env).reasons).toEqual([]);
  expect(holdsTask(candidate, env, trace)).toBe(true);
});

it('accepts an exact structured act rendered from the skill identity', () => {
  const { unit, candidate, env, trace } = fixture();
  const meta = candidate.spec.metadata?.estate as { from: Record<string, unknown> };
  Object.assign(meta.from, {
    form: 'structured act',
    field: `${unit.id}#structured act`,
    shape: 'use the {} skill for its task',
    pieces: ['berthify'],
  });
  const block = candidate.spec.blocks[0];
  if (!block) throw new Error('missing ask block');
  block.when = { user: 'Please use the berthify skill for its task.' };
  expect(checkAsk(candidate, env).reasons).toEqual([]);
  expect(holdsTask(candidate, env, trace)).toBe(true);
});
