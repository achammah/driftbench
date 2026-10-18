import { describe, expect, it } from 'vitest';
import { mapHash } from '../src/map/build';
import { approveAtoms, parseEstateMapText, renderEstateMap } from '../src/map/file';
import { AtomBuilder } from '../src/scan/code';
import { acceptProse } from '../src/scan/prose';
import type { ProseChunk } from '../src/scan/reader';
import { Atom, type EstateMap } from '../src/schema';

const quote = 'Ask the owner to supply the missing invoice number before continuing.';
const chunk: ProseChunk = { id: 'POLICY.md', file: 'POLICY.md', startLine: 1, endLine: 1, text: quote };
const declaration = { id: 'clarify', evidence: { type: 'text_segment', part: 'reply' } } as const;
const proposal = {
  kind: 'instruction',
  title: 'Request the missing invoice number',
  quote,
  polarity: 'obligation',
  evidence: [{ type: 'custom', name: 'grounded_values' }],
};

function accept(replyAct?: unknown, ask?: unknown) {
  return acceptProse(
    chunk,
    {
      chunk: chunk.id,
      atoms: [
        {
          ...proposal,
          ...(replyAct === undefined ? {} : { replyAct }),
          ...(ask === undefined ? {} : { ask }),
        },
      ],
    },
    quote,
    new AtomBuilder(new Map()),
  );
}

function legacyAtom() {
  const result = accept();
  const atom = result.accepted[0];
  if (!atom) throw new Error(JSON.stringify(result.refusals));
  return atom;
}

function mapOf(atom: Atom): EstateMap {
  return {
    version: 1,
    runtime: 'claude-code',
    root: 'fictional-estate',
    readAt: '2026-10-18T00:00:00.000Z',
    atoms: [atom],
    edges: [],
    hash: mapHash([atom], []),
  };
}

describe('optional typed map reply acts', () => {
  it.each(['answer', 'clarify', 'refuse', 'report', 'draft', 'acknowledge'])(
    'accepts the closed act ID %s with a recorded text-segment witness',
    (id) => {
      const parsed = Atom.parse({ ...legacyAtom(), replyAct: { ...declaration, id } });
      expect(parsed).toHaveProperty('replyAct', { ...declaration, id });
    },
  );

  it('accepts a draft segment as the declared output part', () => {
    const replyAct = { id: 'draft', evidence: { type: 'text_segment', part: 'draft' } };
    expect(Atom.parse({ ...legacyAtom(), replyAct })).toHaveProperty('replyAct', replyAct);
  });

  it.each([
    { ...declaration, id: 'invented-act' },
    { ...declaration, id: 'Clarify' },
    { id: 'clarify' },
    { ...declaration, evidence: { type: 'text_segment', part: 'anything' } },
    { ...declaration, evidence: { type: 'text', part: 'reply' } },
    { ...declaration, evidence: { type: 'text_segment', part: 'reply', must: ['invoice'] } },
    { ...declaration, extra: true },
    null,
  ])('rejects unsupported or open-ended declarations: %j', (replyAct) => {
    expect(Atom.safeParse({ ...legacyAtom(), replyAct }).success).toBe(false);
  });

  it('loads an older map without inventing a reply act from its prose', () => {
    const loaded = parseEstateMapText(renderEstateMap(mapOf(legacyAtom())));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
    expect(loaded.map.atoms[0]).not.toHaveProperty('replyAct');
  });

  it('preserves the declaration through proposal, map loading and explicit approval', () => {
    const result = accept(declaration);
    expect(result.refusals).toEqual([]);
    const atom = result.accepted[0];
    expect(atom).toHaveProperty('replyAct', declaration);
    if (!atom) throw new Error('The typed proposal was not accepted');
    expect(atom.approved).toBe(false);
    const text = renderEstateMap(mapOf(atom));
    const before = parseEstateMapText(text);
    expect(before.ok).toBe(true);
    if (!before.ok) throw new Error(JSON.stringify(before.errors));
    expect(before.map.atoms[0]).toHaveProperty('replyAct', declaration);
    const approved = approveAtoms(text, { all: true });
    expect(approved.ok).toBe(true);
    if (!approved.ok) throw new Error(JSON.stringify(approved.errors));
    const after = parseEstateMapText(approved.text);
    if (!after.ok) throw new Error(JSON.stringify(after.errors));
    expect(after.map.atoms[0]).toHaveProperty('replyAct', declaration);
    expect(after.map.atoms[0]?.approved).toBe(true);
    expect(after.map.hash).toBe(before.map.hash);
  });

  it('preserves a complete proposed request bound to the declared reply act', () => {
    const ask = {
      text: 'Reconcile the invoice against its purchase order',
      context: 'The supplied invoice has no invoice number',
    };
    const result = accept(declaration, ask);
    expect(result.refusals).toEqual([]);
    expect(result.accepted[0]?.fields?.ask).toEqual({
      ...ask,
      act: { kind: 'reply', name: 'clarify' },
    });
    expect(result.accepted[0]?.approved).toBe(false);
  });

  it('does not accept a proposed reply request without its declared act', () => {
    const result = accept(undefined, { text: 'Reconcile the invoice' });
    expect(result.accepted).toEqual([]);
    expect(result.refusals[0]?.reason).toContain('ask');
  });

  it.each([{ text: '' }, { text: 'Continue', context: '' }])(
    'refuses an empty proposed request field: %j',
    (ask) => {
      const result = accept(declaration, ask);
      expect(result.accepted).toEqual([]);
      expect(result.refusals[0]?.reason).toContain('ask');
    },
  );

  it('does not fill an absent request from the quote or title', () => {
    const result = accept(declaration);
    expect(result.refusals).toEqual([]);
    expect(result.accepted[0]?.fields).not.toHaveProperty('ask');
  });

  it('reports an invalid proposer declaration instead of dropping it', () => {
    const result = accept({ ...declaration, id: 'invented-act' });
    expect(result.accepted).toEqual([]);
    expect(result.refusals).toHaveLength(1);
    expect(result.refusals[0]?.reason).toContain('replyAct.id');
  });

  it('does not infer an act for a legacy proposer answer', () => {
    const result = accept();
    expect(result.refusals).toEqual([]);
    expect(result.accepted[0]).not.toHaveProperty('replyAct');
    expect(result.accepted[0]?.approved).toBe(false);
  });
});

const request = { text: 'Reconcile the supplied invoice' };
function existing(kind: 'gate' | 'register' | 'stage' | 'hazard', overrides: Partial<Atom> = {}) {
  const builder = new AtomBuilder(new Map());
  const atom = builder.add({
    kind,
    title: 'Existing fixture rule',
    at: { file: chunk.file, startLine: 1, endLine: 1, quote },
    evidence: [{ type: 'custom', name: 'grounded_values' }],
    fields: { retained: 'fixture-value' },
  });
  Object.assign(atom, overrides);
  return { builder, atom };
}
function enrich(builder: AtomBuilder, kind: string, extra: Record<string, unknown> = {}) {
  return acceptProse(
    chunk,
    { chunk: chunk.id, atoms: [{ ...proposal, kind, replyAct: declaration, ask: request, ...extra }] },
    quote,
    builder,
  );
}

describe('reviewed enrichment of code-derived reply atoms', () => {
  it.each(['gate', 'register', 'stage', 'hazard'] as const)(
    'preserves existing %s identity and evidence while requiring semantic approval',
    (kind) => {
      const { builder, atom } = existing(kind);
      const before = structuredClone(atom);
      const result = enrich(builder, kind);
      expect(result.refusals).toEqual([]);
      expect(builder.atoms).toHaveLength(1);
      expect(result.accepted).toHaveLength(1);
      expect(atom.id).toBe(before.id);
      expect(atom.provenance).toEqual(before.provenance);
      expect(atom.evidence).toEqual(before.evidence);
      expect(atom.title).toBe(before.title);
      expect(atom.fields?.retained).toBe('fixture-value');
      expect(atom).toHaveProperty('replyAct', declaration);
      expect(atom.fields?.ask).toEqual({ ...request, act: { kind: 'reply', name: 'clarify' } });
      expect(atom.producedBy).toBe('model');
      expect(atom.approved).toBe(false);
    },
  );

  it('does not overwrite an approved semantic declaration with a duplicate proposal', () => {
    const prior = { id: 'answer', evidence: { type: 'text_segment', part: 'reply' } };
    const { builder, atom } = existing('register');
    Object.assign(atom, { replyAct: prior, producedBy: 'model', approved: true });
    const before = structuredClone(atom);
    expect(enrich(builder, 'register').accepted).toEqual([]);
    expect(atom).toEqual(before);
  });

  it('does not overwrite an approved authored ask when the reply declaration is absent', () => {
    const { builder, atom } = existing('register');
    atom.fields = { ...atom.fields, ask: { text: 'Keep this authored request intact' } };
    const before = structuredClone(atom);
    expect(atom.approved).toBe(true);
    expect(atom).not.toHaveProperty('replyAct');
    expect(enrich(builder, 'register').accepted).toEqual([]);
    expect(atom).toEqual(before);
  });

  it('does not enrich an overlapping span with a different quote', () => {
    const { builder, atom } = existing('gate');
    atom.provenance.quote = 'A different requirement on the same line.';
    const before = structuredClone(atom);
    expect(enrich(builder, 'gate').accepted).toEqual([]);
    expect(atom).toEqual(before);
  });

  it.each(['stage', 'hazard'])('cannot invent a new %s from a prose proposal', (kind) => {
    const builder = new AtomBuilder(new Map());
    const result = enrich(builder, kind);
    expect(result.accepted).toEqual([]);
    expect(result.refusals).toHaveLength(1);
    expect(builder.atoms).toEqual([]);
  });
});
