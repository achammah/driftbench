import { rm } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

// Fictional bakery wording for the layouts a read-before rule can take: banners, block quotes, table
// rows, wrapped sentences, calls, quoted sections, skills. Hand-written for this test.
async function gatesOf(block: string) {
  const root = await estate({
    'CLAUDE.md': `${block}\n`,
    'recipes/dough.md': '# Dough\n',
    'shop/pricing/rates.md': '# Rates\n',
    'shop/pricing/menu.md': '# Menu\n',
    '.claude/skills/oven-log/SKILL.md': '---\nname: oven-log\ndescription: Log the oven\n---\n',
  });
  try {
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    return map.atoms.filter((atom) => atom.kind === 'gate');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const everything = (gate: { fields?: Record<string, unknown> }) =>
  [String(gate.fields?.first), ...((gate.fields?.also as string[] | undefined) ?? [])].sort();

describe('layouts of a read-before rule', () => {
  it.each([
    [
      'a banner with a passive verb in capitals',
      '!! Before any menu or price list is PUBLISHED: Read `shop/pricing/rates.md` FULLY !!',
      ['shop/pricing/rates.md'],
    ],
    [
      'a block quote with "this file"',
      '> !! Before step 3 of ANY loaf BAKE: read this file IN FULL. A wrong proof time ruins the batch. !!',
      ['CLAUDE.md'],
    ],
    [
      'a table row with a section mark',
      '| "Change the bread price" | !! Before editing a price: Read `shop/pricing/rates.md §Holiday rates`. No price change without it. !! |',
      ['shop/pricing/rates.md'],
    ],
    [
      'a routing row that loads a skill',
      '| "log the oven" | `oven-log` -- !! Load it before any bake or cooling step !! |',
      ['oven-log'],
    ],
    [
      'a sentence broken after Read',
      '!! Before any bake, Read\n`shop/pricing/menu.md`\nand skim the notes. !!',
      ['shop/pricing/menu.md'],
    ],
    [
      'a label, a long condition and a second path',
      'KITCHEN RULE -- when the order has a custom cake (tiers, fillings, allergen cards), Read `recipes/dough.md` BEFORE your first action, and with it `shop/pricing/rates.md`.',
      ['recipes/dough.md', 'shop/pricing/rates.md'],
    ],
    [
      'a read written as a call',
      'Use `Read(recipes/dough.md)` BEFORE shaping any loaf (the dough rules change by season).',
      ['recipes/dough.md'],
    ],
    ['"this" before a clause', '!! Read this BEFORE the bakery opens. !!', ['CLAUDE.md']],
    [
      'a trigger that holds the word read, then a coordinated read',
      'Before your FIRST read of the freezer log: run `date` in code, and read the price table in `shop/pricing/rates.md`.',
      ['shop/pricing/rates.md'],
    ],
    [
      'two Before clauses, a skill and a quoted section',
      'Before you bake, AND before you label: `oven-log` and read "Proofing Times" FULLY',
      ['Proofing Times', 'oven-log'],
    ],
    [
      'paths with quoted headings over two lines',
      '> !! Before you quote a custom order:\n> Read `recipes/dough.md` "for a wedding cake, or" `shop/pricing/rates.md` "for a party tray".',
      ['recipes/dough.md', 'shop/pricing/rates.md'],
    ],
    [
      'a bullet with a statement and a list',
      '- !! Pricing is fixed per season -- BEFORE quoting ANY order (cakes · pies · trays): Read `shop/pricing/rates.md` !!',
      ['shop/pricing/rates.md'],
    ],
    [
      'a banner wrapped over lines',
      '!! Read `recipes/dough.md` BEFORE touching the oven\nand when the shift restarts,\nre-read on resume !!',
      ['recipes/dough.md'],
    ],
  ])('reads %s', async (_name, block, files) => {
    const gates = await gatesOf(block);
    expect(gates.length).toBeGreaterThan(0);
    expect(gates.flatMap(everything).sort()).toEqual([...files].sort());
  });

  it('keeps the section mark apart from the path', async () => {
    const [gate] = await gatesOf('Before editing a price: Read `shop/pricing/rates.md §Holiday rates`.');
    expect(gate?.fields).toMatchObject({ first: 'shop/pricing/rates.md', section: '§Holiday rates' });
  });

  it('records a quoted section as unresolved, never as a file', async () => {
    const [gate] = await gatesOf('Before you label: read "Proofing Times" FULLY');
    expect(gate?.fields).toMatchObject({ first: 'Proofing Times', unresolved: 'section' });
    expect(gate?.fields?.path).toBeUndefined();
  });

  it('takes the path a later sentence names for a read with no target', async () => {
    const [gate] = await gatesOf(
      'KITCHEN RULE -- read before the FIRST oven setting of a shift.\nThe rules are in `recipes/dough.md`.',
    );
    expect(gate?.fields).toMatchObject({ first: 'recipes/dough.md' });
  });

  it('loads a skill only when it is one', async () => {
    expect(await gatesOf('Load the weather page before any bake.')).toEqual([]);
    expect((await gatesOf('Load `oven-log` before any bake.')).map(everything)).toEqual([['oven-log']]);
  });
});

describe('a read with no object gates only through "this" or one path that follows', () => {
  it.each([
    'Read before any change.',
    'Read before you edit __init__ settings.',
    'Title line\nRead before any change.',
    'READ BEFORE YOU WRITE',
    '### Rule: Read before you write',
    '| Read before editing |',
    'After a restart, read this file again before you bake anything.',
    'Read this file again before you touch the oven.',
    'Read <name>.md before baking.',
    'Before baking, read `<name>.md`.',
    'Read before the first loaf of the day.',
    'Read before any change.\nSee `recipes/dough.md`.',
  ])('gives no gate for %s', async (block) => {
    expect(await gatesOf(block)).toEqual([]);
  });

  it('gives no gate for a read whose target is only a slot', async () => {
    expect(await gatesOf('Before shaping a loaf, read `<file>`.')).toEqual([]);
    expect(await gatesOf('Before shaping a loaf: read <path>.')).toEqual([]);
  });
});

describe('a bare read gates only when the line carries a rule marker', () => {
  it.each([
    ['a banner', '!! Read BEFORE naming a special, "the soup of the day", and a discount. !!'],
    ['bold', '**Read before the first loaf.**'],
    ['capitals', 'You MUST READ before the first loaf.'],
    ['BEFORE in capitals', 'Read BEFORE the bakery opens.'],
    ['a capitalised label', 'KITCHEN RULE -- read before the FIRST oven setting of a shift.'],
  ])('gates the file itself through %s', async (_name, block) => {
    const gates = await gatesOf(block);
    expect(gates).toHaveLength(1);
    expect(gates[0]?.fields).toMatchObject({ self: true, path: 'CLAUDE.md' });
  });

  it('takes the one path after a marked bare read', async () => {
    const [gate] = await gatesOf('!! Read BEFORE the first loaf !!\nThe rules are in `recipes/dough.md`.');
    expect(gate?.fields).toMatchObject({ first: 'recipes/dough.md' });
  });
});

describe('"this file" with a qualifier', () => {
  it.each([
    'Read this file IN FULL before you bake.',
    'Read this file carefully before you bake.',
    'Before you bake, read this file first.',
    'Before you bake, read this document FULLY.',
  ])('still gates %s', async (block) => {
    const gates = await gatesOf(block);
    expect(gates).toHaveLength(1);
    expect(gates[0]?.fields).toMatchObject({ self: true });
  });
});

describe('sentences that are not gates', () => {
  it.each([
    'The banner syntax is "Before X: Read Y", where X is a placeholder for an act and Y for a file.',
    'The bakery opens the day before the market, and prices are set before noon.',
    'Last week the baker read `recipes/dough.md` before shaping the loaves.',
  ])('refuses %s', async (block) => {
    expect(await gatesOf(block)).toEqual([]);
  });
});
