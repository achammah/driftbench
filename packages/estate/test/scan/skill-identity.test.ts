import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader } from '../../src/index';
import { AtomBuilder, codeAtoms } from '../../src/scan/code';
import { estate } from '../support';

async function atomsOf(files: Record<string, string>) {
  const root = await estate(files);
  const raw = await new ClaudeCodeReader().read(root);
  const builder = new AtomBuilder(new Map(raw.files.map((file) => [file.path, file])));
  codeAtoms(raw, builder);
  return builder.atoms;
}

const skill = (name: string, extra: string[] = []) =>
  [
    '---',
    `name: ${name}`,
    'description: Closes the books of a month.',
    '---',
    '',
    '# Month close',
    '',
    'Run `scripts/close.py` after the totals are checked.',
    ...extra,
    '',
  ].join('\n');

describe('a skill is its declared name, not the folder that holds it', () => {
  it('keeps every atom id when the folder is renamed and the name is kept', async () => {
    const files = (folder: string) => ({
      'CLAUDE.md': '# Rules\n\nAlways answer in English.\n',
      [`.claude/skills/${folder}/SKILL.md`]: skill('month-close', ['', 'Never close a month twice.']),
      [`.claude/skills/${folder}/scripts/close.py`]: 'print("close")\n',
    });
    const before = await atomsOf(files('month-close'));
    const after = await atomsOf(files('books-v2'));
    expect(after.map((atom) => atom.id).sort()).toEqual(before.map((atom) => atom.id).sort());
    expect(after.some((atom) => atom.kind === 'script')).toBe(true);
    expect(after.find((atom) => atom.kind === 'skill')?.provenance.file).toBe(
      '.claude/skills/books-v2/SKILL.md',
    );
  });

  it('finds the scripts of a skill whose folder differs from its name', async () => {
    const atoms = await atomsOf({
      'CLAUDE.md': '# Rules\n',
      '.claude/skills/ledger-tools/SKILL.md': skill('month-close'),
      '.claude/skills/ledger-tools/scripts/close.py': 'print("close")\n',
    });
    const script = atoms.find((atom) => atom.kind === 'script');
    expect(script?.id.startsWith('script.month-close.')).toBe(true);
    expect(script?.fields).toMatchObject({
      skill: 'month-close',
      path: '.claude/skills/ledger-tools/scripts/close.py',
    });
  });

  it('keeps the folders apart when two skills declare one name', async () => {
    const atoms = await atomsOf({
      'CLAUDE.md': '# Rules\n',
      '.claude/skills/books-a/SKILL.md': skill('month-close'),
      '.claude/skills/books-a/scripts/close.py': 'print("a")\n',
      '.claude/skills/books-b/SKILL.md': skill('month-close'),
      '.claude/skills/books-b/scripts/close.py': 'print("b")\n',
    });
    const skills = atoms.filter((atom) => atom.kind === 'skill');
    expect(new Set(skills.map((atom) => atom.id)).size).toBe(2);
    expect(new Set(atoms.map((atom) => atom.id)).size).toBe(atoms.length);
    expect(atoms.filter((atom) => atom.kind === 'script')).toHaveLength(2);
  });
});
