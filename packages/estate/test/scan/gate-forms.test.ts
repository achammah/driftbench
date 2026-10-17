import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader } from '../../src/index';
import { AtomBuilder, codeAtoms } from '../../src/scan/code';
import { estate } from '../support';

async function gates(lines: string[]) {
  const root = await estate({
    'CLAUDE.md': ['# Work rules', '', ...lines, ''].join('\n'),
    'policy.md': '# Policy\n',
    'delivery.md': '# Delivery\n',
  });
  const raw = await new ClaudeCodeReader().read(root);
  const builder = new AtomBuilder(new Map(raw.files.map((file) => [file.path, file])));
  codeAtoms(raw, builder);
  return builder.atoms.filter((atom) => atom.kind === 'gate');
}

describe('read prerequisites in directive clauses', () => {
  it.each([
    ['Read `policy.md` first, then edit the roster.', 'edit the roster'],
    ['Never edit the roster without reading `policy.md`.', 'edit the roster'],
    ['Edit the roster only after reading `policy.md`.', 'Edit the roster'],
    ['Editing the roster? Read `policy.md` first.', 'Editing the roster'],
    ['Prior to editing the roster, read `policy.md`.', 'editing the roster'],
  ])('reads %s', async (line, trigger) => {
    const found = await gates([line]);
    expect(found).toHaveLength(1);
    expect(found[0]?.fields).toMatchObject({ first: 'policy.md', path: 'policy.md', trigger });
    expect(found[0]?.evidence).toContainEqual({ type: 'ordered', before: 'Read', after: 'Edit' });
    expect(found[0]?.provenance).toMatchObject({ file: 'CLAUDE.md', startLine: 3, endLine: 3, quote: line });
  });

  it('resolves a linked prerequisite and keeps its original quote', async () => {
    const line = 'Before updating the roster: read [the policy](policy.md#scope "Current policy").';
    const found = await gates([line]);
    expect(found).toHaveLength(1);
    expect(found[0]?.fields).toMatchObject({ first: 'policy.md', path: 'policy.md' });
    expect(found[0]?.provenance.quote).toBe(line);
    expect(found[0]?.evidence).toContainEqual({ type: 'ordered', before: 'Read', after: 'Edit' });
  });

  it('reads each directive in source order on a shared line', async () => {
    const line = 'Before renaming a file: read `policy.md`; read `delivery.md` first, then write the note.';
    const found = await gates([line]);
    expect(found.map((atom) => atom.fields?.first)).toEqual(['policy.md', 'delivery.md']);
    expect(found.map((atom) => atom.evidence[0])).toEqual([
      { type: 'ordered', before: 'Read', after: 'Bash' },
      { type: 'ordered', before: 'Read', after: 'Write' },
    ]);
    expect(found.map((atom) => atom.provenance.quote)).toEqual([line, line]);
  });

  it('preserves a command prerequisite and punctuation inside its code span', async () => {
    const found = await gates(['Do not commit until you have read the output of `git status; git diff`.']);
    expect(found).toHaveLength(1);
    expect(found[0]?.fields).toMatchObject({ first: 'git status; git diff', trigger: 'commit' });
    expect(found[0]?.evidence).toContainEqual({ type: 'ordered', before: 'Bash', after: 'Bash' });
    expect(found[0]?.evidence).toContainEqual({
      type: 'tool_called',
      label: 'Bash',
      input: { command: { contains: 'git status; git diff' } },
    });
  });

  it('accepts list and rule labels without accepting a quoted example', async () => {
    const found = await gates([
      '- **R8.** Before modifying the roster, read `policy.md`.',
      '4. **Before writing the note**: read `delivery.md`.',
      'The phrase "before editing: read the notes" is an example.',
      'Example: "Read `policy.md` before editing the roster."',
    ]);
    expect(found.map((atom) => atom.provenance.startLine)).toEqual([3, 4]);
  });

  it.each(['Never', 'Do not', "Don't", 'You must not'])(
    'rejects %s read before while retaining a later positive prerequisite',
    async (negative) => {
      const found = await gates([
        `${negative} read \`policy.md\` before editing the roster; Before writing a note: read \`delivery.md\`.`,
      ]);
      expect(found.map((atom) => atom.fields?.first)).toEqual(['delivery.md']);
    },
  );
});
