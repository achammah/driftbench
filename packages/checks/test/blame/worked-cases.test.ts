import { readFileSync } from 'node:fs';
import type { evidence, ResolvedObject } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { blame, placement } from '../../src';
import { f7, f8c, r3b, WORKED_CASES, type WorkedCase } from '../fixtures/blame/cases';

/**
 * The nine worked cases of codeagent_equivalence_blame.md Part F (F1 to F9), the planted R3b case, the escape
 * test and the placement flip at two homes, on the shipped policy/blame:default and policy/placement:default.
 * Planted mutants of the rule files must turn these red.
 */

const NORTHWIND = new URL('../../../../examples/estates/fixture/', import.meta.url);

function decisions(session: string): evidence.GuardDecision[] {
  return readFileSync(new URL(`sessions/${session}.decisions.jsonl`, NORTHWIND), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as evidence.GuardDecision);
}

function run(
  one: WorkedCase,
  policy = blame.shippedPolicy('policy/blame'),
  place = blame.shippedPolicy('policy/placement'),
) {
  return blame.diagnoseBlock({
    verdicts: one.verdicts,
    evidenceFor: one.input,
    blame: policy,
    placement: place,
    ...(one.history === undefined ? {} : { history: one.history }),
  }).diagnoses;
}

function shape(diagnosis: blame.BlameDiagnosis) {
  return {
    item: diagnosis.item,
    fault: diagnosis.fault,
    disposition: diagnosis.disposition,
    fix_location: diagnosis.fix_location,
    placement: diagnosis.placement.split('#')[1],
  };
}

/** A copy of a resolved object with one item changed, as a planted mutant of the shipped file. */
function mutate(
  object: ResolvedObject,
  id: string,
  change: (item: ResolvedObject['items'][number]) => void,
): ResolvedObject {
  const copy = structuredClone(object);
  const item = copy.items.find((one) => one.id === id);
  if (!item) throw new Error(id);
  change(item);
  return copy;
}

describe('the worked cases F1 to F9 on the shipped files', () => {
  for (const one of [...WORKED_CASES, f8c(decisions('weekly-gate-violated'))]) {
    it(one.name, () => {
      const diagnoses = run(one);
      for (const [verdict, want] of Object.entries(one.expect)) {
        const got = diagnoses.find(
          (diagnosis) => diagnosis.verdict_ref === verdict && diagnosis.inherits === undefined,
        );
        expect(got, verdict).toBeDefined();
        const { confidence, ...rest } = want;
        expect(shape(got as blame.BlameDiagnosis)).toEqual(rest);
        if (confidence !== undefined) expect(got?.confidence).toBe(confidence);
      }
    });
  }

  it('F7 at two homes lists both local rewrites as copies to remove, and proposes a class rule', () => {
    const [diagnosis] = run(f7(2));
    expect(diagnosis?.remove_copies).toEqual([
      'skill:invoice-reconcile#.claude/skills/invoice-reconcile/SKILL.md:10',
      'skill:supplier-email#.claude/skills/supplier-email/SKILL.md:8',
    ]);
    expect(diagnosis?.fix_forms).toEqual(['prose', 'guard']);
    expect(diagnosis?.flags).toContain(
      'class_rule:In a loaded skill, read every file its body tells you to read for the current situation, before acting.',
    );
    expect(diagnosis?.flags.some((flag) => flag.startsWith('escape:'))).toBe(false);
  });

  it('F7 at one home stays local, with no copies to remove', () => {
    const [diagnosis] = run(f7(1));
    expect(diagnosis?.remove_copies).toBeUndefined();
    expect(diagnosis?.fix_target).toBe(
      'skill:invoice-reconcile#.claude/skills/invoice-reconcile/SKILL.md:10',
    );
  });

  it('F8a gets a guard beside the prose: mechanics push out', () => {
    const one = WORKED_CASES.find((c) => c.name.startsWith('F8a')) as WorkedCase;
    const [diagnosis] = run(one);
    expect(diagnosis?.fix_forms).toEqual(['prose', 'guard']);
  });

  it('F4 confirmed places the missing rule in the reference already forced in its situation', () => {
    const one = WORKED_CASES.find((c) => c.name.startsWith('F4 confirmed')) as WorkedCase;
    const [diagnosis] = run(one);
    expect(diagnosis?.fix_target).toBe('.claude/skills/invoice-reconcile/references/matching-rules.md');
  });
});

describe('cross_cutting fires at two homes, not at one', () => {
  it('one home: skill-local; two homes: the core prompt', () => {
    expect(shape(run(f7(1))[0] as blame.BlameDiagnosis).placement).toBe('skill_local');
    expect(shape(run(f7(2))[0] as blame.BlameDiagnosis).placement).toBe('cross_cutting');
  });

  it('a project that sets min_homes 3 keeps two homes local (the G8 override)', () => {
    const place = mutate(blame.shippedPolicy('policy/placement'), 'cross_cutting', (item) => {
      item.params = { ...item.params, min_homes: 3 };
    });
    expect(shape(run(f7(2), undefined, place)[0] as blame.BlameDiagnosis).fix_location).toBe('skill.layout');
  });
});

describe('the escape test', () => {
  it('flags a fix text that names a skill or a file, and passes the class wording', () => {
    expect(
      placement.lintFixText('In invoice-reconcile, read references/currency-table.md first.', [
        'invoice-reconcile',
      ]),
    ).toEqual([
      { kind: 'skill_name', text: 'invoice-reconcile' },
      { kind: 'file_name', text: 'references/currency-table.md' },
    ]);
    expect(placement.lintFixText('Convert at 0.92 when the invoice is in USD.')).toEqual([
      { kind: 'literal_value', text: '0.92' },
    ]);
    for (const text of Object.values(placement.CLASS_RULE_BY_ACT))
      expect(placement.lintFixText(text, ['invoice-reconcile'])).toEqual([]);
  });

  it('writes the findings on the diagnosis of a proposed wording', () => {
    const diagnoses = blame.diagnoseBlock({
      verdicts: f7(1).verdicts,
      evidenceFor: f7(1).input,
      blame: blame.shippedPolicy('policy/blame'),
      placement: blame.shippedPolicy('policy/placement'),
      fixText: 'In invoice-reconcile, read references/currency-table.md before converting.',
    }).diagnoses;
    expect(diagnoses[0]?.flags).toEqual(
      expect.arrayContaining([
        'escape:skill_name:invoice-reconcile',
        'escape:file_name:references/currency-table.md',
      ]),
    );
  });
});

describe('planted mutants', () => {
  it('R3 without the recovery split: the planted R3b and F3 flip, and the test sees it', () => {
    const policy = mutate(blame.shippedPolicy('policy/blame'), 'R3', (item) => {
      item.params = {
        ...item.params,
        disposition_by_next_action: {},
        recovery_ok: ['asked_user', 'gave_up', 'wrong_fact'],
      };
    });
    const silent = mutate(blame.shippedPolicy('policy/blame'), 'tool_silent_success', (item) => {
      item.params = { ...item.params, disposition_by_next_action: { continued: 'setup' } };
    });
    expect(run(r3b('gave_up'), policy)[0]?.disposition).toBe('setup');
    expect(run(r3b('gave_up'))[0]?.disposition).toBe('shared');
    const f3 = WORKED_CASES.find((c) => c.name.startsWith('F3 tool.impl: the invoice script')) as WorkedCase;
    expect(run(f3, silent)[0]?.disposition).toBe('setup');
    expect(run(f3)[0]?.disposition).toBe('shared');
  });

  it('cross_cutting at one home: F7 flips to the core prompt too early', () => {
    const place = mutate(blame.shippedPolicy('policy/placement'), 'cross_cutting', (item) => {
      item.params = { ...item.params, min_homes: 1 };
    });
    expect(shape(run(f7(1), undefined, place)[0] as blame.BlameDiagnosis).placement).toBe('cross_cutting');
    expect(shape(run(f7(1))[0] as blame.BlameDiagnosis).placement).toBe('skill_local');
  });
});
