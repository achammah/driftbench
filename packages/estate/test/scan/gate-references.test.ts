import { rm } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

// What a read-before sentence must name to become a gate, and what kind of sentence it must be: an
// instruction to the agent that names a file, a skill or a document of the estate. Hand-written wordings.
async function gates(lines: string[]) {
  const root = await estate({
    'CLAUDE.md': `${lines.join('\n')}\n`,
    'policy.md': '# Policy\n',
    'notes/style guide.md': '# Style\n',
    '.claude/skills/editor/SKILL.md': '---\nname: editor\ndescription: Edit an index\n---\n',
  });
  try {
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    return map.atoms.filter((atom) => atom.kind === 'gate').map((atom) => atom.provenance.quote);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const ACTS = ['editing the index', 'you run a migration', 'each deploy'];
const frames: Array<(target: string, act: string) => string> = [
  (t, a) => `Before ${a}, read ${t}.`,
  (t, a) => `Before ${a}: read ${t}.`,
  (t, a) => `Before ${a} read ${t}`,
  (t, a) => `Prior to ${a}, read ${t}.`,
  (t, a) => `Read ${t} before ${a}.`,
  (t, a) => `Read ${t} first, then edit the index and ${a}.`,
  (t, a) => `Never ${a.replace(/^you /, '')} until you have read ${t}.`,
];

describe('a read target must be a reference', () => {
  const vague = [
    'it',
    'them',
    'this carefully',
    'that',
    'everything',
    'all of it',
    'anything relevant',
    'whatever applies',
    'carefully',
    'more',
    'the rest',
    'both',
    'the file',
    'the files',
    'the docs',
    'the code',
    'what the user asked',
    'the error',
    'up',
    'up on the policy',
    'up on policy',
    'about the policy',
    'on the policy',
  ];
  it('gives no gate for a pronoun, a vague word or a phrasal verb', async () => {
    const lines = vague.flatMap((target) => ACTS.flatMap((act) => frames.map((frame) => frame(target, act))));
    const found = await gates(lines);
    expect(found).toEqual([]);
  });

  const urls = [
    'https://example.com/policy.md',
    'http://example.com/docs/policy.md',
    '<https://example.com/policy.md>',
    '`https://example.com/policy.md`',
    '[the policy](https://example.com/policy.md)',
    'www.example.com/policy.md',
    'ftp://example.com/policy.md',
  ];
  it('gives no gate for a web address', async () => {
    const lines = urls.flatMap((target) => ACTS.flatMap((act) => frames.map((frame) => frame(target, act))));
    expect(await gates(lines)).toEqual([]);
  });

  it('keeps the gate for a file, a path, a skill and a named document', async () => {
    const wanted = [
      'Before editing the index, read policy.md.',
      'Before editing the index, read `policy.md`.',
      'Before editing the index, read `notes/style guide.md`.',
      'Before editing the index, read notes/style guide.md.',
      'Before editing the index, read the policy.',
      'Before editing the index, read the policy document.',
      'Before editing the index, read the style guide.',
      'Before editing the index, read the editor skill.',
      'Before editing the index, read [the policy](policy.md).',
      'Read `policy.md` before you run a migration.',
    ];
    expect(await gates(wanted)).toEqual(wanted);
  });
});

describe('a target that names no file is kept with what it is', () => {
  async function atoms(lines: string[], files: Record<string, string> = {}) {
    const root = await estate({
      'CLAUDE.md': `${lines.join('\n')}\n\nDocuments: \`pricing.md\`.\n`,
      'pricing.md': '# Pricing\n',
      'policy.md': '# Policy\n',
      ...files,
    });
    try {
      const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
      return map.atoms.filter((atom) => atom.kind === 'gate');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  it.each([
    ['Before any release, read `regions/<slug>/RULES.md` FULLY.', 'placeholder'],
    ['Before any release, read `regions/{slug}/RULES.md`.', 'placeholder'],
    ['Before any release, read regions/<slug>/RULES.md.', 'placeholder'],
    ['Before editing the index, read the region\u2019s checklist.', 'role'],
    ["Before editing the index, read the region's checklist (paths: see the top of this file).", 'role'],
    ["Before editing the index, read the ledger's current state.", 'state'],
    ['Before editing the index, read Plan C.', 'section'],
    ['Before editing the index, read Phase 3 of the plan.', 'section'],
    ['Before planning any edit, read the step of the pricing guide.', 'role'],
  ])('keeps the gate for %s as %s', async (line, kind) => {
    const found = await atoms([line]);
    expect(found).toHaveLength(1);
    expect(found[0]?.fields?.unresolved).toBe(kind);
    expect(found[0]?.fields?.path).toBeUndefined();
    // No file is invented for a name that matches no document.
    expect(String(found[0]?.fields?.first)).not.toBe('pricing.md');
    expect(found[0]?.evidence).toEqual([{ type: 'ordered', before: 'Read', after: expect.any(String) }]);
  });

  it.each([
    'Read this before any version publish.',
    'Before any version publish, read this.',
    'Before any version publish: read this file.',
    'Before any version publish, read this document.',
  ])('reads "this" as the document the rule stands in: %s', async (line) => {
    const found = await atoms([line]);
    expect(found).toHaveLength(1);
    expect(found[0]?.fields).toMatchObject({ self: true, path: 'CLAUDE.md' });
    expect(found[0]?.evidence).toContainEqual({
      type: 'tool_called',
      label: 'Read',
      input: { file_path: { contains: 'CLAUDE.md' } },
    });
  });

  it('never gives a long phrase the file name of one word in it', async () => {
    const found = await atoms(['Read the step of the pricing guide before planning any prompt edit.']);
    for (const gate of found) expect(gate.fields?.first).not.toBe('pricing.md');
  });
});

describe('a gate keeps its shape under decoration and phrase targets', () => {
  async function found(lines: string[], files: Record<string, string> = {}) {
    // The estate reads the documents its files name.
    const root = await estate({
      'CLAUDE.md': `${lines.join('\n')}\n\nDocuments: \`policy.md\`, \`pricing.md\`, \`notes/summary.md\`.\n`,
      'policy.md': '# Policy\n',
      'pricing.md': '# Pricing\n',
      'references/pricing-rules.md': '# Rules\n',
      'notes/summary.md': '# Summary\n',
      ...files,
    });
    try {
      const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
      return map.atoms.filter((atom) => atom.kind === 'gate');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  it.each([
    'Read `references/pricing-rules.md` before committing ANY base.',
    'R#12 \u2014 Read `references/pricing-rules.md` before committing ANY base.',
    '**R12 \u2014 Read `references/pricing-rules.md`** before committing ANY base.',
    'Read `references/pricing-rules.md` (procedural) before committing ANY base.',
    '> Read `references/pricing-rules.md` before committing ANY base.',
    '| Gate | Read `references/pricing-rules.md` before committing ANY base |',
    '## Read `references/pricing-rules.md` before committing ANY base',
    'Read `references/pricing-rules.md` in full before committing ANY base.',
    'Read the `references/pricing-rules.md` file before committing ANY base.',
    'Rule 3: Read `references/pricing-rules.md` before committing ANY base.',
    'Read `references/pricing-rules.md` BEFORE committing ANY base (see the rules table).',
  ])('reads the path in: %s', async (line) => {
    const gates = await found([line]);
    expect(gates).toHaveLength(1);
    expect(gates[0]?.fields).toMatchObject({ first: 'references/pricing-rules.md' });
  });

  it.each([
    'R#12 \u2014 Read this before ANY version publish.',
    '> Read this before ANY version publish.',
    'Read this (the whole file) before ANY version publish.',
  ])('reads "this" as the document in: %s', async (line) => {
    const gates = await found([line]);
    expect(gates).toHaveLength(1);
    expect(gates[0]?.fields).toMatchObject({ self: true, path: 'CLAUDE.md' });
  });

  it.each([
    ['Read Plan C before publishing.', 'section'],
    ['Read the Plan C section before publishing.', 'section'],
    ["Read the ledger's current state before every dispatch.", 'state'],
    ['Read the current ledger state before every dispatch.', 'state'],
    ["Read the region's checklist first, then publish.", 'role'],
    ["Read the region's checklist first when publishing.", 'role'],
    ["First, read the region's checklist, then publish.", 'role'],
    ["Read the region's checklist prior to publishing.", 'role'],
    ['Read the pricing guide before editing the index.', 'role'],
  ])('keeps a phrase target in: %s', async (line, kind) => {
    const gates = await found([line]);
    expect(gates).toHaveLength(1);
    expect(gates[0]?.fields?.unresolved).toBe(kind);
  });

  it.each([
    ['Read the policy before editing the index.', 'policy.md'],
    ['Read the policy first, then edit the index.', 'policy.md'],
    ['Read the policy document before editing the index.', 'policy.md'],
  ])('resolves a named document in: %s', async (line, file) => {
    const gates = await found([line]);
    expect(gates).toHaveLength(1);
    expect(gates[0]?.fields).toMatchObject({ first: file, path: file });
  });

  it.each([
    'Read the file and edit it before publishing.',
    'Read it before editing the index.',
    'Read them before editing the index.',
    'Read it, then edit the index.',
  ])('gives no gate for a pronoun without a document: %s', async (line) => {
    expect(await found([line])).toEqual([]);
  });

  it('resolves "it" to the one document the sentence before names', async () => {
    const gates = await found(['See `notes/summary.md`.', 'Read it before editing the index.']);
    expect(gates).toHaveLength(1);
    expect(gates[0]?.fields).toMatchObject({ first: 'notes/summary.md', path: 'notes/summary.md' });
    const two = await found(['See `notes/summary.md` and `policy.md`.', 'Read it before editing the index.']);
    expect(two).toEqual([]);
  });

  it('resolves a bare SKILL.md to the skill the rule stands in', async () => {
    const skill = (name: string, body: string) => ({
      [`.claude/skills/${name}/SKILL.md`]: `---\nname: ${name}\ndescription: ${name}\n---\n${body}\n`,
    });
    const root = await estate({
      ...skill('alpha', 'Read SKILL.md before any edit.'),
      ...skill('beta', 'Beta.'),
      '.claude/skills/alpha/references/guide.md': 'Read SKILL.md before reviewing the index.\n',
    });
    try {
      const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
      const paths = map.atoms
        .filter((atom) => atom.kind === 'gate')
        .map((atom) => String(atom.fields?.path))
        .sort();
      expect(paths).toEqual(['.claude/skills/alpha/SKILL.md', '.claude/skills/alpha/SKILL.md']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('a gate is an instruction to the agent', () => {
  const habits = [
    'We read policy.md before deploying every release at the weekly meeting.',
    'We usually read policy.md before editing the index.',
    'We always read policy.md before editing the index.',
    'Our editors read policy.md before editing the index.',
    'Reviewers read policy.md before editing the index.',
    'The team lead reads policy.md before editing the index.',
    'I read policy.md before editing the index.',
    'They read policy.md before editing the index.',
    'Most contributors read policy.md before editing the index.',
    'Before editing the index, we read policy.md.',
    'Before each deploy, our editors read policy.md.',
    'Maintainers typically read policy.md before editing the index.',
    'Nobody needs to read policy.md before editing the index.',
    'No one reads policy.md before editing the index.',
  ];
  it('gives no gate for a description of habit', async () => {
    expect(await gates(habits)).toEqual([]);
  });

  const optional = [
    'It is fine to read policy.md before editing the index, but not required.',
    'You may read policy.md before editing the index, but it is not required.',
    'You may read policy.md before editing the index.',
    'You can read policy.md before editing the index.',
    'You might read policy.md before editing the index.',
    'Feel free to read policy.md before editing the index.',
    'It is fine to read policy.md before editing the index.',
    'It is okay to read policy.md before editing the index.',
    'It is good practice to read policy.md before editing the index.',
    'It helps to read policy.md before editing the index.',
    'Consider reading policy.md before editing the index.',
    'Reading policy.md before editing the index is optional.',
    'Optionally, read policy.md before editing the index.',
    'Read policy.md before editing the index if you like.',
    'Read policy.md before editing the index if you want to.',
    'Read policy.md before editing the index; this is not required.',
    'Read policy.md before editing the index (not mandatory).',
    'Before editing the index, read policy.md, but this is not necessary.',
    'Before editing the index, it is fine to read policy.md.',
    'Before editing the index, you may read policy.md.',
  ];
  it('gives no gate for an optional or merely allowed read', async () => {
    expect(await gates(optional)).toEqual([]);
  });

  it('keeps the gate for an instruction in any voice', async () => {
    const wanted = [
      'Read policy.md before editing the index.',
      'Always read policy.md before editing the index.',
      'You must read policy.md before editing the index.',
      'You should read policy.md before editing the index.',
      'The assistant must read policy.md before editing the index.',
      'We need to read policy.md before editing the index.',
      'Make sure you read policy.md before editing the index.',
      'Be sure to read policy.md before editing the index.',
      'Remember to read policy.md before editing the index.',
      'It is essential to read policy.md before editing the index.',
      'For every draft read policy.md before editing the index.',
      'In this repository, always read policy.md before editing the index.',
      'Editors: read policy.md before editing the index.',
    ];
    expect(await gates(wanted)).toEqual(wanted);
  });
});
