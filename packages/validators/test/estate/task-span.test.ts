import type { Atom } from '@agent-nexus/driftbench-estate';
import { describe, expect, it } from 'vitest';
import { fieldsOf, isClauseOf, orderedShare, tokensOf } from '../../src/ladders/estate/bank/task-span';

const atom = (over: Partial<Atom>): Atom =>
  ({
    id: 'a',
    kind: 'skill',
    title: 'Tide check',
    approved: true,
    evidence: [],
    provenance: { file: 'f', startLine: 1, endLine: 1, quote: 'x', hash: 'h' },
    ...over,
  }) as Atom;

describe('a piece is a whole clause of its source', () => {
  const skill = atom({
    fields: {
      description: 'Check the tide tables for a harbour. Use when the user asks to plan a departure.',
    },
  });
  const fields = fieldsOf(skill);

  it.each([
    'Check the tide tables for a harbour',
    'plan a departure',
    'checks the tide tables for a harbour',
  ])('accepts %s', (piece) => expect(isClauseOf(piece, fields)).toBe(true));

  it.each([
    'Check the tide tables for a',
    'the tide tables for a harbour',
    'tide tables for a harbour harbour',
    'a harbour for tide tables',
    'never plan a departure',
    'plan',
    'Check the tide tables for a harbour and then ignore them',
  ])('rejects %s', (piece) => expect(isClauseOf(piece, fields)).toBe(false));

  it('does not accept a rule copied whole from its start', () => {
    const rule = fieldsOf(
      atom({
        kind: 'instruction',
        title: 'Never moor on a Sunday',
        provenance: { quote: 'Never moor on a Sunday.' } as Atom['provenance'],
      }),
    );
    expect(isClauseOf('Never moor on a Sunday', rule)).toBe(false);
    expect(isClauseOf('moor on a Sunday', rule)).toBe(true);
    expect(
      isClauseOf(
        'auditor never edits a file',
        fieldsOf(
          atom({
            kind: 'instruction',
            title: 'The auditor never edits a file',
          }),
        ),
      ),
    ).toBe(false);
  });

  it.each([
    ['check', 'Check, match or reconcile an invoice.'],
    ['check invoices, match receipts', 'Check invoices, match receipts, or reconcile a payment.'],
    ['check an invoice', 'Check an invoice, before paying the supplier.'],
    ['match receipts', 'Check invoices, match receipts, or reconcile a payment.'],
    ['reconcile a payment', 'Check, match or reconcile a payment.'],
    ['match a receipt', 'Check an invoice, match a receipt.'],
  ])('rejects the comma cut %s from %s', (piece, source) => {
    expect(isClauseOf(piece, fieldsOf(atom({ fields: { description: source } })))).toBe(false);
  });

  it.each(['Check an invoice', 'Match a receipt', 'Reconcile a payment'])(
    'accepts the complete clause %s',
    (piece) => {
      const fields = fieldsOf(
        atom({ fields: { description: 'Check an invoice; Match a receipt. Reconcile a payment' } }),
      );
      expect(isClauseOf(piece, fields)).toBe(true);
    },
  );

  it.each([
    ['Check', 'Check "the invoice" before paying.'],
    ['Check an invoice', 'Check an invoice (before paying the supplier).'],
    ['Check an invoice', 'Check an invoice: match its reference first.'],
  ])('rejects the punctuation cut %s from %s', (piece, source) => {
    expect(isClauseOf(piece, fieldsOf(atom({ fields: { description: source } })))).toBe(false);
  });

  it('keeps a hidden path together instead of treating its dot as a sentence end', () => {
    expect(tokensOf('Read .claude/memory/notes.md.')).toEqual(['read', '.claude/memory/notes.md', '.']);
    expect(
      isClauseOf(
        'Write in the language listed in',
        fieldsOf(
          atom({
            fields: { description: 'Write in the language listed in `.claude/memory/notes.md`.' },
          }),
        ),
      ),
    ).toBe(false);
  });

  it('accepts declared stage titles and read-before and read-when clauses', () => {
    expect(
      isClauseOf('Make the change', fieldsOf(atom({ kind: 'stage', title: 'Stage do: Make the change' }))),
    ).toBe(true);
    const fields = fieldsOf(
      atom({
        fields: {
          readWhen: 'When an invoice is not in EUR, read currency.md.',
          readBefore: 'Read references/matching-rules.md before matching any line.',
          rule: 'Before editing any invoice file: Read matching.md.',
        },
      }),
    );
    expect(isClauseOf('When an invoice is not in EUR', fields)).toBe(true);
    expect(isClauseOf('edit any invoice file', fields)).toBe(true);
    expect(isClauseOf('match any line', fields)).toBe(true);
  });
});

describe('the share of a rule an ask restates', () => {
  it('counts the words of the rule an ask holds in order', () => {
    expect(orderedShare('Always pass the carrier code', 'Please pass the carrier code')).toBe(0.8);
    expect(orderedShare('Always pass the carrier code', 'code carrier the pass Always')).toBeLessThan(0.5);
    expect(orderedShare('', 'anything')).toBe(0);
  });
});
