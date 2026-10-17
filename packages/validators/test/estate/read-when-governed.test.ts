import { loadEstateMap } from '@agent-nexus/driftbench-estate';
import { describe, expect, it, vi } from 'vitest';
import * as fixture from '../../src/ladders/estate/bank/fixture-suite';
import { performsGoverned, taskFamily } from '../../src/ladders/estate/bank/genquality';

describe('a read-before ask performs the act its rule governs', () => {
  const rule = 'Before editing any invoice file, Read `references/rules.md`.';

  it.each([
    'Please edit any invoice file.',
    'Edit the invoice file for April.',
    'Could you edit the invoice files?',
  ])('accepts an ask that edits an invoice file: %s', (ask) =>
    expect(performsGoverned(ask, rule)).toBe(true),
  );

  it.each([
    'Please delete any invoice file.',
    'Please edit the shipment note.',
    'Read the invoice file.',
    'Please sort the inbox.',
  ])('rejects an ask with another verb or another object: %s', (ask) =>
    expect(performsGoverned(ask, rule)).toBe(false),
  );

  it('reads the four documented forms of the clause', () => {
    for (const form of [
      '!! Before writing the report: Read `templates/report.md` !!',
      'Before writing the report, read `templates/report.md`.',
      'Read `templates/report.md` before writing the report.',
      'Do not write the report until you have read `templates/report.md`.',
    ]) {
      expect(performsGoverned('Write up last week in the usual weekly report.', form), form).toBe(true);
      expect(performsGoverned('Send the report to the supplier.', form), form).toBe(false);
    }
  });

  it.each([
    '- **R5.** Before editing any invoice file: Read `references/rules.md`.',
    '**R5.** Before editing any invoice file, Read `references/rules.md`.',
    '5. Before editing any invoice file: Read `references/rules.md`.',
    'A1: Read `references/rules.md` before editing any invoice file.',
    '- **R12.** Do not edit any invoice file until you have read `references/rules.md`.',
  ])('reads the clause behind a rule label: %s', (quote) => {
    expect(performsGoverned('Please edit any invoice file.', quote)).toBe(true);
    expect(performsGoverned('Please delete any invoice file.', quote)).toBe(false);
    expect(performsGoverned('Please edit the shipment note.', quote)).toBe(false);
  });

  // The clause is anchored at its start ("Before ...", "Do not ... until"), so only the label strip can read it: a
  // label with other punctuation, with several letters or written as a word must be removed first.
  it.each([
    'A1: Before editing any invoice file: Read `references/rules.md`.',
    '3) Before editing any invoice file: Read `references/rules.md`.',
    'AB12) Before editing any invoice file, Read `references/rules.md`.',
    'R5. Before editing any invoice file: Read `references/rules.md`.',
    'Rule 5. Before editing any invoice file: Read `references/rules.md`.',
    'Step 2: Before editing any invoice file, Read `references/rules.md`.',
    '**Rule 12.** Before editing any invoice file: Read `references/rules.md`.',
    '- **Step 2:** Do not edit any invoice file until you have read `references/rules.md`.',
    'Rule 7) Do not edit any invoice file until you have read `references/rules.md`.',
  ])('reads an anchored clause behind a label of any punctuation, length or word: %s', (quote) => {
    expect(performsGoverned('Please edit any invoice file.', quote), quote).toBe(true);
    expect(performsGoverned('Please delete any invoice file.', quote), quote).toBe(false);
    expect(performsGoverned('Please edit the shipment note.', quote), quote).toBe(false);
  });

  it.each([
    'Section 4.2 Before editing any invoice file: Read `references/rules.md`.',
    'Section 4.2. Before editing any invoice file: Read `references/rules.md`.',
    '4.2) Before editing any invoice file, Read `references/rules.md`.',
    'Article 3.1: Do not edit any invoice file until you have read `references/rules.md`.',
    'Policy 7 Before editing any invoice file: Read `references/rules.md`.',
    '**Clause 2.4.1** Before editing any invoice file: Read `references/rules.md`.',
    'Item 9) Do not edit any invoice file until you have read `references/rules.md`.',
  ])('strips a label noun with a number, decimals included: %s', (quote) => {
    expect(performsGoverned('Please edit any invoice file.', quote), quote).toBe(true);
    expect(performsGoverned('Please delete any invoice file.', quote), quote).toBe(false);
  });

  // The words before the number are part of the clause here, not a label: stripping them would leave a clause that
  // names no act, and every ask would pass.
  it.each([
    ['Read 5: tickets requires a reviewer.', 'Please read the tickets.', 'Please delete the tickets.'],
    [
      'Send 3. the invoices requires a signed order.',
      'Please send the invoices.',
      'Please delete the invoices.',
    ],
    [
      'Edit 2) invoice files requires a reviewer.',
      'Please edit the invoice files.',
      'Please delete the invoice files.',
    ],
  ])('keeps the words before a number that are no label noun: %s', (quote, accepted, refused) => {
    expect(performsGoverned(accepted, quote), quote).toBe(true);
    expect(performsGoverned(refused, quote), quote).toBe(false);
  });

  it('holds an ask to nothing when the clause names no act and object', () => {
    expect(performsGoverned('Anything at all.', 'Read `a.md` first.')).toBe(true);
  });
});

describe('gen.task.read_when judges the governed act', { timeout: 120_000 }, () => {
  async function verdict(ask?: string) {
    const suite = await fixture.fixtureSuite();
    const specs = structuredClone(suite.specs);
    if (ask !== undefined) {
      const target = specs.find((spec) => spec.testType === 'read_when' && spec.complete);
      const block = (target?.spec.blocks as Array<{ when: { user: string } }> | undefined)?.[0];
      if (!block) throw new Error('no complete read_when spec');
      block.when.user = ask;
    }
    const mock = vi.spyOn(fixture, 'fixtureSuite').mockResolvedValue({ ...suite, specs });
    try {
      return (await taskFamily().evaluate(1)).get('gen.task.read_when');
    } finally {
      mock.mockRestore();
    }
  }

  it('holds on the generated suite', async () => {
    expect(await verdict()).toMatchObject({ pass: true });
  });

  it('fails a read_when ask that is a task, but not the governed one', async () => {
    expect(await verdict('Please sort the shared operations inbox into folders.')).toMatchObject({
      pass: false,
    });
    expect(await verdict('Send the weekly report to the supplier.')).toMatchObject({ pass: false });
  });

  it('is judged from the validator’s own map', async () => {
    const suite = await fixture.fixtureSuite();
    expect((await loadEstateMap(suite.map)).ok).toBe(true);
  });
});
