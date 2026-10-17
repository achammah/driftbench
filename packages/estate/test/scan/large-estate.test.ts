import { describe, expect, it } from 'vitest';
import { AtomBuilder, ClaudeCodeReader, lineAt, locateNamed, scanEstate, sliceLines } from '../../src/index';
import type { EstateFile } from '../../src/scan/reader';
import { estate, NOW } from '../support';

/**
 * The indexes that keep a large estate linear give the answers a plain search gives: line numbers and spans
 * from a line index, ids from a suffix hint, endings from a kept answer, and a folder of thousands of files.
 */

describe('a large estate reads as a small one does', () => {
  it('finds lines and spans as counting from the top does', () => {
    const count = (text: string, offset: number) => {
      let line = 1;
      for (let index = 0; index < offset && index < text.length; index++) if (text[index] === '\n') line++;
      return line;
    };
    const cut = (text: string, from: number, to: number) =>
      text
        .split('\n')
        .slice(from - 1, to)
        .join('\n');
    for (const text of ['', '\n', 'a', 'a\n', '\na', 'a\nb\n\nc', 'x\r\ny\r\n']) {
      for (let offset = -2; offset <= text.length + 2; offset++)
        expect(lineAt(text, offset)).toBe(count(text, offset));
      expect(lineAt(text, Number.NaN)).toBe(count(text, Number.NaN));
      for (const from of [-1, 0, 1, 2, 3, 9, 1.5])
        for (const to of [-1, 0, 1, 2, 3, 9, 2.5, Number.POSITIVE_INFINITY])
          expect(sliceLines(text, from, to)).toBe(cut(text, from, to));
    }
  });

  it('gives a repeated title the first free suffix, past ids another title took', () => {
    const file: EstateFile = { path: 'CLAUDE.md', kind: 'standing', text: 'a\nb\nc\nd\n' };
    const builder = new AtomBuilder(new Map([[file.path, file]]));
    const at = (line: number) => ({
      file: file.path,
      startLine: line,
      endLine: line,
      quote: 'abcd'[line - 1] ?? '',
    });
    const add = (title: string, line: number) =>
      builder.add({ kind: 'instruction', title, at: at(line), evidence: [] }).id;
    expect(add('Keep it', 1)).toBe('instruction.standing.keep-it');
    expect(add('Keep it 3', 2)).toBe('instruction.standing.keep-it-3');
    expect(add('Keep it', 3)).toBe('instruction.standing.keep-it-2');
    expect(add('Keep it', 4)).toBe('instruction.standing.keep-it-4');
    expect(builder.atomsOf(file.path).map((atom) => atom.provenance.startLine)).toEqual([1, 2, 3, 4]);
  });

  it('finds a file by its ending again after the name gains a file', () => {
    const files = new Map<string, EstateFile>(
      ['.claude/skills/a/references/notes.md'].map((path) => [path, { path, kind: 'skill_file', text: '' }]),
    );
    const named = ['.claude/skills/a/references/notes.md'];
    const byName = new Map([['notes.md', named]]);
    const from = '.claude/skills/c/SKILL.md';
    expect(locateNamed('references/notes.md', from, files, { byName }).path).toBe(named[0]);
    named.push('.claude/skills/b/references/notes.md');
    files.set('.claude/skills/b/references/notes.md', {
      path: '.claude/skills/b/references/notes.md',
      kind: 'skill_file',
      text: '',
    });
    expect(locateNamed('references/notes.md', from, files, { byName }).candidates).toEqual([
      '.claude/skills/a/references/notes.md',
      '.claude/skills/b/references/notes.md',
    ]);
  });

  // Writing the folder is most of this test's time on a busy machine: the limit is for the fixture.
  it('reads every file of a folder of three thousand', { timeout: 60_000 }, async () => {
    const files: Record<string, string> = {
      'CLAUDE.md': '# Estate\n',
      '.claude/skills/wide/SKILL.md': '---\nname: wide\ndescription: Wide.\n---\n\nBody.\n',
    };
    for (let index = 0; index < 3000; index++)
      files[`.claude/skills/wide/references/n${index}.md`] = `# ${index}\n`;
    const root = await estate(files);
    const { raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(raw.files.filter((file) => file.path.includes('/references/'))).toHaveLength(3000);
    expect(raw.files.find((file) => file.path.endsWith('/n2999.md'))?.kind).toBe('skill_file');
  });
});
