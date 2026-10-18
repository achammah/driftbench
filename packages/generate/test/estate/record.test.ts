import { parseSpecText } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { generateEstateSuite } from '../../src/estate/generate';
import type { EstateAtom } from '../../src/estate/inputs';
import { ASK_FORMS, actRecord, formOf, fromRecord, linkOf } from '../../src/estate/record';
import { APPROVED_PLAN, fixtureInputs, PLANNER_PATHS } from './support';

const atom = (over: Partial<EstateAtom> & { id: string; kind: string }): EstateAtom => ({
  title: over.id,
  approved: true,
  evidence: [],
  provenance: { quote: `quote of ${over.id}`, hash: `hash-${over.id}` } as EstateAtom['provenance'],
  ...over,
});

describe('the record an ask carries about itself', () => {
  it('links the unit with its fingerprint', () => {
    expect(linkOf(atom({ id: 'gate.a', kind: 'gate' }))).toEqual({
      span: 'gate.a',
      fp: 'hash-gate.a',
      relation: 'exercises',
      createdBy: 'generator',
    });
  });

  it('derives the act of a unit from its evidence and fields, not from its words', () => {
    const guard = atom({
      id: 'guard.a',
      kind: 'guard',
      fields: { name: 'seal-check.sh' },
      evidence: [{ type: 'guard', name: 'seal-check.sh', verdict: 'deny' }],
    });
    expect(actRecord(guard)).toEqual({ kind: 'guard', name: 'seal-check.sh', verdict: 'deny' });
    expect(
      actRecord(
        atom({ id: 'gate.b', kind: 'gate', evidence: [{ type: 'ordered', before: 'Read', after: 'Write' }] }),
      ),
    ).toEqual({ kind: 'call', name: 'Write' });
    // An order that ends on a phrase names no tool, so no trace can show it.
    expect(
      actRecord(
        atom({
          id: 'gate.c',
          kind: 'gate',
          evidence: [{ type: 'ordered', before: 'Read', after: 'you revise a billing document' }],
        }),
      ),
    ).toEqual({ kind: 'reply' });
    expect(
      actRecord(atom({ id: 'reference.a', kind: 'reference', fields: { path: 'notes/tide.md' } })),
    ).toEqual({
      kind: 'read',
      target: 'notes/tide.md',
    });
    expect(actRecord(atom({ id: 'script.a', kind: 'script', fields: { path: 'bin/seal.sh' } }))).toEqual({
      kind: 'call',
      name: 'Bash',
      target: 'bin/seal.sh',
    });
    expect(actRecord(atom({ id: 'skill.a', kind: 'skill', fields: { name: 'mooring' } }))).toEqual({
      kind: 'skill',
      name: 'mooring',
    });
    expect(actRecord(atom({ id: 'sub.a', kind: 'subagent', fields: { name: 'harbour-clerk' } }))).toEqual({
      kind: 'helper',
      name: 'harbour-clerk',
    });
    expect(
      actRecord(
        atom({ id: 'route.a', kind: 'route', fields: { target: 'harbour-clerk', targetKind: 'subagent' } }),
      ),
    ).toEqual({ kind: 'helper', name: 'harbour-clerk' });
    const carrier = atom({ id: 'skill.b', kind: 'skill', fields: { name: 'mooring' } });
    expect(actRecord(atom({ id: 'instruction.a', kind: 'instruction' }), carrier)).toEqual({
      kind: 'owned',
      name: 'mooring',
      target: 'skill',
    });
    expect(actRecord(atom({ id: 'instruction.b', kind: 'instruction' }))).toEqual({ kind: 'reply' });
    expect(actRecord(atom({ id: 'tool.a', kind: 'tool' }))).toEqual({ kind: 'reply' });
  });

  it('names where an ask came from', () => {
    const atoms = new Map([['route.a', atom({ id: 'route.a', kind: 'route' })]]);
    expect(fromRecord({ bank: { situation: 'tide-check', phrase: 1 }, atoms })).toEqual({
      bank: 'tide-check',
      phrase: 1,
    });
    expect(fromRecord({ session: 'rope-snapped', atoms })).toEqual({ session: 'rope-snapped' });
    expect(fromRecord({ askFrom: 'neutral', neutral: 'resume', atoms })).toEqual({ neutral: 'resume' });
    expect(
      fromRecord({
        askFrom: 'route.a (asks it names)',
        built: {
          frame: 'trigger',
          act: 'help me with a delivery',
          context: 'The carrier answers',
          shape: 'help me with {}',
          contextShape: '{}',
          pieces: ['a delivery', 'The carrier answers'],
        },
        atoms,
      }),
    ).toEqual({
      form: 'asks it names',
      field: 'route.a#asks it names',
      fp: 'hash-route.a',
      frame: 'trigger',
      shape: 'help me with {}',
      context: '{}',
      pieces: ['a delivery', 'The carrier answers'],
    });
    expect(fromRecord({ askFrom: 'route.a (situation: a heading with a count)', atoms })).toMatchObject({
      form: 'situation',
    });
    expect(fromRecord({ askFrom: 'gone.a (title)', atoms })).toBeUndefined();
  });

  it('reads a form of the closed set from every label', () => {
    for (const label of ['enforced by guard.a', 'situation: a usage note', 'title', 'user prompt'])
      expect(ASK_FORMS).toContain(formOf(label) as (typeof ASK_FORMS)[number]);
  });
});

describe('the Northwind suite', () => {
  it('writes a link, an act and a source on every complete spec that asks', async () => {
    const result = generateEstateSuite(await fixtureInputs(APPROVED_PLAN), { paths: PLANNER_PATHS });
    let checked = 0;
    for (const record of result.specs.filter((entry) => entry.complete && entry.path.endsWith('.yaml'))) {
      const file = result.files.find((entry) => entry.path === record.path);
      const parsed = parseSpecText(file?.text ?? '', 'yaml', record.path);
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
      const meta = (parsed.spec.metadata as { estate: Record<string, unknown> }).estate;
      const link = meta.link as { span: string; fp: string; relation: string; createdBy: string };
      expect(link.span, record.id).toBe((meta.atoms as string[])[0]);
      expect(link.relation).toBe('exercises');
      expect(link.createdBy).toBe('generator');
      expect(typeof link.fp).toBe('string');
      expect(meta.act, record.id).toBeDefined();
      if (record.mode === 'static') continue;
      const from = meta.from as Record<string, unknown> | undefined;
      expect(from, record.id).toBeDefined();
      if (from && 'form' in from)
        expect(ASK_FORMS, record.id).toContain(from.form as (typeof ASK_FORMS)[number]);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(1000);
  }, 120_000);
});
