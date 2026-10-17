import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ClaudeCodeReader, lintEstate, scanEstate } from '../src/index';
import { estate, NOW } from './support';

const saved = process.env.HOME;
afterEach(() => {
  if (saved === undefined) delete process.env.HOME;
  else process.env.HOME = saved;
});

async function home(files: Record<string, string>): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'driftbench-home-'));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(folder, path)), { recursive: true });
    await writeFile(join(folder, path), text);
  }
  return folder;
}

const skill = (name: string, body: string) =>
  `---\nname: ${name}\ndescription: Handle the ${name} chores. Use when the user asks for the ${name} chores.\n---\n\n${body}`;

/** The reader that reads the user layer of the current test's home folder: the layer is opt-in. */
const layered = () =>
  new ClaudeCodeReader({ userSkills: join(process.env.HOME as string, '.claude/skills') });

describe('the lint reports on the project, not on the user-level skill layer', () => {
  it('lists the orphans and unreachable files of the project and none of the layer', async () => {
    process.env.HOME = await home({
      '.claude/skills/pier-notes/SKILL.md': skill('pier-notes', 'Read `references/tides.md` first.\n'),
      '.claude/skills/pier-notes/references/tides.md': '# Tides\nRead `references/gone.md`.\n',
      '.claude/skills/pier-notes/assets/loose.md': '# A file nothing names\n',
    });
    const root = await estate({
      'CLAUDE.md': '# Standing\n',
      '.claude/skills/dock-roster/SKILL.md': skill('dock-roster', '# Roster\n'),
      '.claude/skills/dock-roster/assets/loose.md': '# A file nothing names\n',
    });
    const { map, raw } = await scanEstate({
      root,
      reader: new ClaudeCodeReader({ userSkills: join(process.env.HOME as string, '.claude/skills') }),
      now: NOW,
    });
    expect(map.atoms.some((atom) => atom.provenance.file.startsWith('~/'))).toBe(true);
    const lint = lintEstate(map, raw);
    expect(lint.findings.map((finding) => [finding.code, finding.subject])).toEqual([
      ['ORPHAN', '.claude/skills/dock-roster/assets/loose.md'],
      ['UNREACHABLE', '.claude/skills/dock-roster/SKILL.md'],
    ]);
  });

  it('keeps the invariants of the project whatever the layer holds', async () => {
    process.env.HOME = await home({
      '.claude/skills/pier-notes/SKILL.md': skill('pier-notes', '# Pier\n'),
      '.claude/skills/pier-notes/assets/loose.md': '# A file nothing names\n',
    });
    const root = await estate({ 'CLAUDE.md': '# Standing\n' });
    const { map } = await scanEstate({
      root,
      reader: new ClaudeCodeReader({ userSkills: join(process.env.HOME as string, '.claude/skills') }),
      now: NOW,
    });
    const orphans = map.atoms.find((atom) => atom.fields?.check === 'no_orphans');
    expect(orphans?.fields?.orphans).toEqual([]);
    expect(orphans?.fields?.holds).toBe(true);
  });
});
