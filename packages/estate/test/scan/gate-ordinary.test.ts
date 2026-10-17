import { rm } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

// Ordinary instructions about the conversation or the work (read the thread, read the diff) are not
// read-before rules about a document; instructions that name a file, a skill or a written standard are.
async function gates(lines: string[]) {
  const root = await estate({
    'CLAUDE.md': `${lines.join('\n\n')}\n`,
    'Handbook.md': '# Handbook\n',
    'docs/guide.md': '# Guide\n',
    'docs/plans/a.md': '# Plan\n',
    'policy.md': '# Policy\n',
    'rules.md': '# Rules\n',
  });
  try {
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    return map.atoms.filter((atom) => atom.kind === 'gate').map((atom) => atom.provenance.quote);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const frames: Array<(object: string) => string> = [
  (o) => `Read ${o} before you reply.`,
  (o) => `Before you answer, read ${o}.`,
  (o) => `Read ${o} first, then respond.`,
  (o) => `Never send anything until you have read ${o}.`,
];
const ordinary = [
  'the whole thread',
  'the full message',
  'the entire conversation',
  'the customer’s last email',
  'the open ticket',
  'the error output',
  'the stack trace',
  'the diff',
  'the question twice',
  'the previous answer',
];

describe('ordinary reading is no gate', () => {
  it('gives no gate for 40 wordings about the conversation or the work', async () => {
    const lines = ordinary.flatMap((object) => frames.map((frame) => frame(object)));
    expect(lines).toHaveLength(40);
    expect(await gates(lines)).toEqual([]);
  });
});

describe('a named file or folder is a gate', () => {
  const targets = ['`Handbook.md`', '`docs/guide.md`', 'policy.md', '`rules.md`'];
  const shapes: Array<(target: string) => string> = [
    (t) => `Read ${t} before you reply.`,
    (t) => `Before you reply, read ${t}.`,
    (t) => `Before replying: read ${t} FULLY.`,
    (t) => `Never send anything until you have read ${t}.`,
    (t) => `Do not send anything before reading ${t}.`,
    (t) => `Never reply before you read ${t}.`,
    (t) => `Reply only after reading ${t}.`,
    (t) => `Edit \`Handbook.md\` only after reading ${t}.`,
    (t) => `Never edit \`Handbook.md\` before reading ${t}.`,
    (t) => `Edit \`Handbook.md\` only once you have read ${t}.`,
  ];
  it('gives a gate for 40 wordings', async () => {
    const lines = shapes.flatMap((shape) => targets.map((target) => shape(target)));
    expect(lines).toHaveLength(40);
    const found = await gates(lines);
    expect(lines.filter((line) => !found.includes(line))).toEqual([]);
  });

  it.each([
    'Read every file under `docs/plans/` before planning.',
    'Read all the files in `docs/plans/` before planning.',
    'Before planning, read each document in `docs/plans/`.',
    'Never plan before reading every file under `docs/plans/`.',
  ])('keeps a quantified read of a folder: %s', async (line) => {
    const found = await gates([line]);
    expect(found).toEqual([line]);
  });
});

describe('a part named by role is a gate only when it is a written source', () => {
  it.each([
    'Read the style guide before you reply.',
    'Read the region’s checklist before you publish.',
    'Read the review standard before you publish.',
    'Read the ONE playbook that covers that kind of change before editing.',
  ])('keeps %s', async (line) => {
    expect(await gates([line])).toEqual([line]);
  });
});

const SK = '.claude/skills/bakery/SKILL.md';
const HEAD = '---\nname: bakery\ndescription: Bakery\n---\n';

describe('a role target gates only with evidence the estate defines it', () => {
  async function withFiles(line: string, extra: Record<string, string>) {
    const root = await estate({ 'CLAUDE.md': `${line}\n`, ...extra });
    try {
      const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
      return map.atoms.filter((atom) => atom.kind === 'gate');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  it('gives no gate for a multi-word target the estate never defines', async () => {
    expect(
      await withFiles('Read the delivery windows before you reply.', {
        [SK]: '---\nname: bakery\ndescription: Bakery\n---\n# Notes\n',
      }),
    ).toEqual([]);
  });

  it.each([
    ['a heading', { [SK]: `${HEAD}# Notes\n\n## Delivery windows\n\nNine to five.\n` }],
    ['a bold term', { [SK]: `${HEAD}The **delivery windows** are fixed.\n` }],
    ['a quoted term', { [SK]: `${HEAD}We call these "delivery windows" everywhere.\n` }],
    ['a definition line', { [SK]: `${HEAD}Delivery windows: nine to five.\n` }],
  ])('gives a role gate when %s defines it', async (_name, extra) => {
    const gates = await withFiles('Read the delivery windows before you reply.', extra);
    expect(gates).toHaveLength(1);
    expect(gates[0]?.fields?.unresolved).toBe('role');
  });

  it('resolves to the file when a file is named after it', async () => {
    const gates = await withFiles('Read the delivery windows before you reply.', {
      [SK]: `${HEAD}See \`references/delivery-windows.md\`.\n`,
      '.claude/skills/bakery/references/delivery-windows.md': '# x\n',
    });
    expect(gates).toHaveLength(1);
    expect(gates[0]?.fields?.first).toBe('delivery-windows.md');
  });
});
