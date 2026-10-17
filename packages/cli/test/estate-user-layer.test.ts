import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type Io, main } from '../src/index';

async function run(argv: string[], cwd: string) {
  const output = { out: '', err: '' };
  const io: Io = {
    out: (text) => {
      output.out += text;
    },
    err: (text) => {
      output.err += text;
    },
    cwd,
  };
  const code = await main(argv, io);
  return { code, ...output };
}

const skill = (name: string) =>
  `---\nname: ${name}\ndescription: Handle the ${name} chores. Use when the user asks for the ${name} chores.\n---\n\n# ${name}\n`;

async function folder(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'driftbench-user-layer-'));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

const saved = process.env.HOME;
afterEach(() => {
  if (saved === undefined) delete process.env.HOME;
  else process.env.HOME = saved;
});

describe('driftbench estate scan and lint read the user-level skill layer only when asked', () => {
  it('reads no home folder by default: a populated HOME leaves the map unchanged', async () => {
    const root = await folder({ '.claude/skills/dock-roster/SKILL.md': skill('dock-roster') });
    process.env.HOME = await folder({});
    const empty = await run(['estate', 'scan', root, '--no-model', '--out', join(root, 'a.yaml')], root);
    process.env.HOME = await folder({ '.claude/skills/pier-notes/SKILL.md': skill('pier-notes') });
    const populated = await run(['estate', 'scan', root, '--no-model', '--out', join(root, 'b.yaml')], root);
    expect(empty.code).toBe(0);
    expect(populated.code).toBe(0);
    expect(populated.out).not.toContain('User skill layer');
    const [a, b] = await Promise.all([
      readFile(join(root, 'a.yaml'), 'utf8'),
      readFile(join(root, 'b.yaml'), 'utf8'),
    ]);
    expect(b.replace(/readAt:.*/, '')).toBe(a.replace(/readAt:.*/, ''));
    expect(b).not.toContain('pier-notes');
    expect(b).not.toContain('userSkills');
  }, 60_000);

  it('reads the folder --user-skills names, records it, and lint asks for the folder again', async () => {
    process.env.HOME = await folder({ '.claude/skills/pier-notes/SKILL.md': skill('pier-notes') });
    const team = await folder({ 'shared/tide-chart/SKILL.md': skill('tide-chart') });
    const root = await folder({ '.claude/skills/dock-roster/SKILL.md': skill('dock-roster') });
    const layer = join(team, 'shared');

    const scanned = await run(
      ['estate', 'scan', root, '--no-model', '--user-skills', layer, '--out', join(root, 'map.yaml')],
      root,
    );
    expect(scanned.code).toBe(0);
    expect(scanned.out).toContain('User skill layer: 1 skill read; 0 left out');
    const map = await readFile(join(root, 'map.yaml'), 'utf8');
    expect(map).toContain('~/.claude/skills/tide-chart/SKILL.md');
    expect(map).toContain('userSkills: true');
    expect(map).not.toContain('pier-notes');
    expect(map).not.toContain(team);

    // Lint reports on the project: the files of the layer are never orphans or unreachable.
    const linted = await run(['estate', 'lint', join(root, 'map.yaml'), '--user-skills', layer], root);
    expect(linted.out).toContain('.claude/skills/dock-roster/SKILL.md: no route');
    expect(linted.out).not.toContain('~/.claude');

    // Without the folder the layer's atoms cannot be checked: lint says so and does not guess a home folder.
    const unasked = await run(['estate', 'lint', join(root, 'map.yaml')], root);
    expect(unasked.code).toBe(2);
    expect(unasked.err).toContain('--user-skills <folder>');
  }, 60_000);

  it('reads a relative --user-skills folder from the folder the command is typed in', async () => {
    process.env.HOME = await folder({});
    const work = await folder({
      'team/tide-chart/SKILL.md': skill('tide-chart'),
      'project/.claude/skills/dock-roster/SKILL.md': skill('dock-roster'),
    });
    const scanned = await run(
      ['estate', 'scan', 'project', '--no-model', '--user-skills', 'team', '--out', 'map.yaml'],
      work,
    );
    expect(scanned.code).toBe(0);
    expect(scanned.out).toContain('User skill layer: 1 skill read');
    expect(await readFile(join(work, 'map.yaml'), 'utf8')).toContain('~/.claude/skills/tide-chart/SKILL.md');
    const linted = await run(['estate', 'lint', 'map.yaml', '--user-skills', 'team'], work);
    expect(linted.err).not.toContain('--user-skills <folder>');
  }, 60_000);

  it('expands ~ and ~/x in --user-skills against the home folder, whatever the working folder', async () => {
    process.env.HOME = await folder({
      'pier-notes/SKILL.md': skill('pier-notes'),
      '.claude/skills/tide-chart/SKILL.md': skill('tide-chart'),
    });
    const work = await folder({ '.claude/skills/dock-roster/SKILL.md': skill('dock-roster') });
    const nested = await run(
      [
        'estate',
        'scan',
        work,
        '--no-model',
        '--user-skills',
        '~/.claude/skills',
        '--out',
        join(work, 'a.yaml'),
      ],
      work,
    );
    expect(nested.code).toBe(0);
    const a = await readFile(join(work, 'a.yaml'), 'utf8');
    expect(a).toContain('~/.claude/skills/tide-chart/SKILL.md');
    expect(a).not.toContain('pier-notes');
    const bare = await run(
      ['estate', 'scan', work, '--no-model', '--user-skills', '~', '--out', join(work, 'b.yaml')],
      work,
    );
    expect(bare.code).toBe(0);
    const b = await readFile(join(work, 'b.yaml'), 'utf8');
    expect(b).toContain('~/.claude/skills/pier-notes/SKILL.md');
  }, 60_000);

  it.each(['', '  '])(
    'refuses an empty --user-skills value (%j) and writes nothing',
    async (value) => {
      const work = await folder({ '.claude/skills/dock-roster/SKILL.md': skill('dock-roster') });
      const scanned = await run(
        ['estate', 'scan', work, '--no-model', '--user-skills', value, '--out', join(work, 'map.yaml')],
        work,
      );
      expect(scanned.code).toBe(2);
      expect(scanned.err).toContain('--user-skills needs a folder');
      await expect(readFile(join(work, 'map.yaml'), 'utf8')).rejects.toThrow();
      const ok = await run(['estate', 'scan', work, '--no-model', '--out', join(work, 'map.yaml')], work);
      expect(ok.code).toBe(0);
      const linted = await run(['estate', 'lint', join(work, 'map.yaml'), '--user-skills', value], work);
      expect(linted.code).toBe(2);
      expect(linted.err).toContain('--user-skills needs a folder');
    },
    60_000,
  );
});
