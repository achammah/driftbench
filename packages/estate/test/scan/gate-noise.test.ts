import { rm } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

// Lines that look like a read-before rule and are not one: titles, column headers, templates, relative
// clauses, plain nouns the estate never defines. Fictional wording written for this test.
async function gates(text: string, extra: Record<string, string> = {}) {
  const root = await estate({
    'CLAUDE.md': `${text}\n`,
    'recipes/dough.md': '# Dough\n',
    '.claude/skills/bakery/SKILL.md': '---\nname: bakery\ndescription: Bakery\n---\nBody.\n',
    '.claude/skills/pastry/SKILL.md': '---\nname: pastry\ndescription: Pastry\n---\nBody.\n',
    ...extra,
  });
  try {
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    return map.atoms.filter((atom) => atom.kind === 'gate');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('titles and column headers are no rule', () => {
  it.each([
    '### READ before shaping any loaf',
    '## Read before you bake',
    '# READ BEFORE YOU WRITE',
    '**READ BEFORE YOU WRITE**',
    'READ BEFORE YOU WRITE',
    '> READ BEFORE TOUCHING THE OVEN',
    '## Read this before you bake',
  ])('gives no gate for %s', async (line) => {
    expect(await gates(line)).toEqual([]);
  });

  it('gives no gate for a column title above a separator row', async () => {
    const table = ['| Kind | Read before shaping |', '|---|---|', '| bread | rye |'].join('\n');
    expect(await gates(table)).toEqual([]);
  });

  it('reads a short list item that is a sentence', async () => {
    expect(await gates('- Read this before baking')).toHaveLength(1);
  });

  it('still reads a sentence under the same heading', async () => {
    const found = await gates('## Kitchen\n\nRead this before you bake the first loaf.');
    expect(found).toHaveLength(1);
  });

  it('still reads a rule written in a table body', async () => {
    const table = [
      '| Ask | Rule |',
      '|---|---|',
      '| price | Before editing a price: read `recipes/dough.md`. |',
    ].join('\n');
    expect(await gates(table)).toHaveLength(1);
  });
});

describe('a template is no rule', () => {
  it.each([
    'Before <act>: read <file>.',
    'Before <act>, read `recipes/dough.md`.',
    'Read <path> before <act>.',
    'Use the form "Before <act>: Read <file>" for every rule.',
  ])('gives no gate for %s', async (line) => {
    expect(await gates(line)).toEqual([]);
  });
});

describe('a sentence about something else is no rule', () => {
  it.each([
    'The loader opens a folder that reads SKILL.md before it starts the hook.',
    'The linter, which reads `recipes/dough.md` before it checks the prices, runs nightly.',
    'A person who reads `recipes/dough.md` before baking learns the ratios.',
  ])('gives no gate for %s', async (line) => {
    expect(await gates(line)).toEqual([]);
  });

  it('does not point a bare SKILL.md at one of several skills', async () => {
    const found = await gates('Before editing a skill, read SKILL.md.');
    for (const gate of found) {
      expect(gate.fields?.path).toBeUndefined();
      expect(gate.fields?.unresolved).toBe('ambiguous');
    }
  });

  it('resolves a bare SKILL.md beside the file that names it', async () => {
    const found = await gates('', {
      '.claude/skills/bakery/SKILL.md':
        '---\nname: bakery\ndescription: Bakery\n---\nBefore baking, read SKILL.md.\n',
    });
    expect(found.map((gate) => gate.fields?.path)).toEqual(['.claude/skills/bakery/SKILL.md']);
  });
});

describe('a bare read with several candidate documents names none', () => {
  it('gates nothing when two documents follow', async () => {
    const found = await gates(
      'Read before shaping the first loaf.\nSee `recipes/dough.md` and `recipes/rye.md`.',
      {
        'recipes/rye.md': '# Rye\n',
      },
    );
    expect(found).toEqual([]);
  });
});

const UNDEFINED_PHRASES = [
  'the browser console',
  'the bank statement',
  'the delivery note',
  'the weather forecast',
  'the opening hours',
  'the supplier invoice',
  'the shift roster',
  'the till receipt',
  'the oven display',
  'the staff rota',
  'the customer review',
  'the street map',
  'the cash drawer',
  'the fridge thermometer',
  'the loyalty card',
  'the price tag on the shelf',
  'the first page of the order',
  'the notes from the morning',
  'the status report',
  'the flour delivery',
  'the open tab',
  'the shared inbox',
  'the pastry counter',
  'the oven timer',
  'the sample tray',
  'the recipe card',
  'the lunch menu',
  'the baker’s apron',
  'the customer’s message',
  'the service entrance',
];

describe('an ordinary phrase the estate never defines is no gate', () => {
  it('gives no gate for 30 plain noun phrases', async () => {
    const lines = UNDEFINED_PHRASES.map((phrase) => `Read ${phrase} before you reply.`);
    const found = await gates(lines.join('\n\n'));
    expect(found.map((gate) => gate.provenance.quote)).toEqual([]);
  });
});
