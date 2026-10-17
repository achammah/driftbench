import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate, USER_LAYER } from '../../src/index';
import { estate, NOW } from '../support';

const skill = (name: string, body = `# ${name}\n`) =>
  `---\nname: ${name}\ndescription: Handle the ${name} chores. Use when the user asks for the ${name} chores.\n---\n\n${body}`;

/** A home folder holding a user skill layer: files by path from the home folder, links by path to target. */
async function home(files: Record<string, string>, links: Record<string, string> = {}): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'driftbench-home-'));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(folder, path)), { recursive: true });
    await writeFile(join(folder, path), text);
  }
  for (const [path, target] of Object.entries(links)) {
    await mkdir(dirname(join(folder, path)), { recursive: true });
    await symlink(target.startsWith('/') ? target : join(folder, target), join(folder, path));
  }
  return folder;
}

const saved = process.env.HOME;
afterEach(() => {
  if (saved === undefined) delete process.env.HOME;
  else process.env.HOME = saved;
});

/** The reader that reads the user layer of the current test's home folder: the layer is opt-in. */
const layered = () =>
  new ClaudeCodeReader({ userSkills: join(process.env.HOME as string, '.claude/skills') });

async function scan(files: Record<string, string>, reader = layered()) {
  const root = await estate(files);
  return { root, ...(await scanEstate({ root, reader, now: NOW })) };
}
const skillNames = (map: { atoms: Array<{ kind: string; fields?: Record<string, unknown> }> }) =>
  map.atoms
    .filter((atom) => atom.kind === 'skill')
    .map((atom) => String(atom.fields?.name))
    .sort();

describe('the user-level skill layer is a second skill layer', () => {
  it('reads the skills of the folder it is given, beside the project skills', async () => {
    process.env.HOME = await home({
      '.claude/skills/pier-notes/SKILL.md': skill('pier-notes'),
      '.claude/skills/pier-notes/references/tides.md': '# Tides\n',
    });
    const { map } = await scan({ '.claude/skills/dock-roster/SKILL.md': skill('dock-roster') });
    expect(skillNames(map)).toEqual(['dock-roster', 'pier-notes']);
    const user = map.atoms.find((atom) => atom.kind === 'skill' && atom.fields?.name === 'pier-notes');
    expect(user?.provenance.file).toBe(`${USER_LAYER}/pier-notes/SKILL.md`);
    expect(user?.fields?.folder).toBe(`${USER_LAYER}/pier-notes`);
  });

  it('reads the layer as it lies: links to folders elsewhere, a container one level deeper', async () => {
    process.env.HOME = await home(
      {
        '.claude/skills/real-one/SKILL.md': skill('real-one'),
        '.claude/shared/elsewhere/SKILL.md': skill('elsewhere'),
        '.claude/skills/synced/from-cloud/SKILL.md': skill('from-cloud'),
        '.claude/skills/synced/deeper/inside/SKILL.md': skill('too-deep'),
      },
      { '.claude/skills/linked': '.claude/shared/elsewhere' },
    );
    const { map } = await scan({ 'CLAUDE.md': '# Standing\n' });
    expect(skillNames(map)).toEqual(['elsewhere', 'from-cloud', 'real-one']);
  });

  it('does not read a hidden folder, at the top of the layer or inside a container', async () => {
    process.env.HOME = await home({
      '.claude/skills/kept/SKILL.md': skill('kept'),
      '.claude/skills/.archive/binned/SKILL.md': skill('binned'),
      '.claude/skills/.archive/SKILL.md': skill('archived'),
      '.claude/skills/synced/.archive/SKILL.md': skill('stale'),
      '.claude/skills/synced/visible/SKILL.md': skill('visible'),
    });
    const { map } = await scan({ 'CLAUDE.md': '# Standing\n' });
    expect(skillNames(map)).toEqual(['kept', 'visible']);
  });

  it('does not read a dependency folder, at the top of the layer or inside a container', async () => {
    process.env.HOME = await home({
      '.claude/skills/kept/SKILL.md': skill('kept'),
      '.claude/skills/node_modules/pkg/SKILL.md': skill('package-skill'),
      '.claude/skills/node_modules/SKILL.md': skill('package-root'),
      '.claude/skills/synced/node_modules/SKILL.md': skill('nested-package'),
      '.claude/skills/synced/visible/SKILL.md': skill('visible'),
    });
    const { map, raw } = await scan({ 'CLAUDE.md': '# Standing\n' });
    expect(skillNames(map)).toEqual(['kept', 'visible']);
    // The ignore list would drop the files of a dependency folder anyway: the layer must not count it as read.
    expect([...(raw.userLayer?.read ?? [])].sort()).toEqual(['kept', 'visible']);
  });

  it.each(['trash', 'Trash'])(
    'reads a top-level folder named %s that holds a SKILL.md as a skill',
    async (name) => {
      process.env.HOME = await home({ [`.claude/skills/${name}/SKILL.md`]: skill('bin-skill') });
      const { map } = await scan({ 'CLAUDE.md': '# Standing\n' });
      expect(skillNames(map)).toEqual(['bin-skill']);
    },
  );

  it('does not read a folder named Trash or trash as a container, but reads a skill that holds a SKILL.md', async () => {
    process.env.HOME = await home({
      '.claude/skills/kept/SKILL.md': skill('kept'),
      '.claude/skills/Trash/binned/SKILL.md': skill('binned'),
      '.claude/skills/trash/old/SKILL.md': skill('older'),
      '.claude/skills/TRASH/gone/SKILL.md': skill('gone'),
      '.claude/skills/synced/trash/SKILL.md': skill('named-trash'),
    });
    const { map } = await scan({ 'CLAUDE.md': '# Standing\n' });
    expect(skillNames(map)).toEqual(['kept', 'named-trash']);
  });

  it('counts a skill once when a link of the layer leads into the project', async () => {
    const project = await estate({ '.claude/skills/dock-roster/SKILL.md': skill('dock-roster') });
    process.env.HOME = await home(
      { '.claude/skills/own/SKILL.md': skill('own') },
      { '.claude/skills/dock-roster': join(project, '.claude/skills/dock-roster') },
    );
    const { map, raw } = await scanEstate({ root: project, reader: layered(), now: NOW });
    expect(skillNames(map)).toEqual(['dock-roster', 'own']);
    expect(raw.userLayer).toEqual({ read: ['own'], shadowed: [] });
    expect(raw.notes.filter((note) => note.message.includes('duplicate'))).toEqual([]);
  });

  it('lets the project layer win a name clash, and says what it left out', async () => {
    process.env.HOME = await home({
      '.claude/skills/roster-copy/SKILL.md': skill('dock-roster', '# The user copy\n'),
      '.claude/skills/other/SKILL.md': skill('other'),
    });
    const { map, raw } = await scan({
      '.claude/skills/dock-roster/SKILL.md': skill('dock-roster', '# The project copy\n'),
    });
    expect(skillNames(map)).toEqual(['dock-roster', 'other']);
    const kept = map.atoms.find((atom) => atom.kind === 'skill' && atom.fields?.name === 'dock-roster');
    expect(kept?.provenance.file).toBe('.claude/skills/dock-roster/SKILL.md');
    expect(raw.userLayer?.shadowed).toEqual(['dock-roster']);
    expect(raw.notes).toContainEqual({
      file: `${USER_LAYER}/roster-copy/SKILL.md`,
      message: expect.stringContaining('shadowed'),
    });
  });

  it('keeps the first folder, by name, of two user skills that share a name', async () => {
    process.env.HOME = await home({
      '.claude/skills/b-copy/SKILL.md': skill('twin'),
      '.claude/skills/a-copy/SKILL.md': skill('twin'),
    });
    const { map } = await scan({ 'CLAUDE.md': '# Standing\n' });
    const twins = map.atoms.filter((atom) => atom.kind === 'skill');
    expect(twins.map((atom) => atom.provenance.file)).toEqual([`${USER_LAYER}/a-copy/SKILL.md`]);
  });

  it('reads the rules and references of a user skill like those of a project skill', async () => {
    process.env.HOME = await home({
      '.claude/skills/pier-notes/SKILL.md': skill(
        'pier-notes',
        '# Pier notes\n\nRead `references/tides.md` before you answer.\n',
      ),
      '.claude/skills/pier-notes/references/tides.md': '# Tides\n',
    });
    const { map } = await scan({ 'CLAUDE.md': '# Standing\n' });
    const reference = map.atoms.find((atom) => atom.kind === 'reference');
    expect(reference?.fields?.path).toBe(`${USER_LAYER}/pier-notes/references/tides.md`);
    expect(reference?.fields?.exists).not.toBe(false);
    expect(map.edges.some((edge) => edge.kind === 'reference')).toBe(true);
  });
});

describe('the folder of the user layer is configurable', () => {
  it.each(['', '   '])(
    'refuses an empty userSkills option (%j) instead of reading the working folder',
    (value) => {
      expect(() => new ClaudeCodeReader({ userSkills: value })).toThrow(/userSkills must name a folder/);
    },
  );

  it('reads the folder the reader is given instead of the home folder', async () => {
    process.env.HOME = await home({ '.claude/skills/in-home/SKILL.md': skill('in-home') });
    const other = await home({ 'skills/elsewhere/SKILL.md': skill('elsewhere') });
    const { map } = await scan(
      { 'CLAUDE.md': '# Standing\n' },
      new ClaudeCodeReader({ userSkills: join(other, 'skills') }),
    );
    expect(skillNames(map)).toEqual(['elsewhere']);
  });

  it('reads no home folder by default: a populated home gives the same map as an empty one', async () => {
    const files = {
      'CLAUDE.md': '# Standing\n\nAlways answer in plain words.\n',
      '.claude/skills/dock-roster/SKILL.md': skill('dock-roster'),
    };
    process.env.HOME = await mkdtemp(join(tmpdir(), 'driftbench-empty-home-'));
    const empty = await scan(files, new ClaudeCodeReader());
    process.env.HOME = await home({
      '.claude/skills/pier-notes/SKILL.md': skill('pier-notes'),
      '.claude/skills/tide-chart/SKILL.md': skill('tide-chart'),
    });
    const populated = await scan(files, new ClaudeCodeReader());
    expect(populated.map.atoms).toEqual(empty.map.atoms);
    expect(populated.map.edges).toEqual(empty.map.edges);
    expect(populated.map.hash).toBe(empty.map.hash);
    expect(populated.raw.userLayer).toBeUndefined();
    expect(populated.map.userSkills).toBeUndefined();
    expect(skillNames(populated.map)).toEqual(['dock-roster']);
  });

  it('records in the map that a layer was read', async () => {
    process.env.HOME = await home({ '.claude/skills/in-home/SKILL.md': skill('in-home') });
    const { map } = await scan({ 'CLAUDE.md': '# Standing\n' });
    expect(map.userSkills).toBe(true);
  });

  it('reads a relative reader option from the working folder, and a relative configuration folder from the estate', async () => {
    process.env.HOME = await mkdtemp(join(tmpdir(), 'driftbench-empty-home-'));
    const work = await home({ 'mine/own-one/SKILL.md': skill('own-one') });
    const estateOnly = await estate({
      'driftbench.estate.yaml': 'userSkills: team\n',
      'team/shared-one/SKILL.md': skill('shared-one'),
    });
    const before = process.cwd();
    process.chdir(work);
    try {
      const option = await scanEstate({
        root: estateOnly,
        reader: new ClaudeCodeReader({ userSkills: 'mine' }),
        now: NOW,
      });
      expect(skillNames(option.map)).toEqual(['own-one']);
      // The option wins over the file, and the file's folder is relative to the estate, not to the working folder.
      const config = await scanEstate({ root: estateOnly, reader: new ClaudeCodeReader(), now: NOW });
      expect(skillNames(config.map)).toEqual(['shared-one']);
    } finally {
      process.chdir(before);
    }
  });

  it('reads the folder the estate configuration names, relative to the estate', async () => {
    process.env.HOME = await home({ '.claude/skills/in-home/SKILL.md': skill('in-home') });
    const named = await scan(
      {
        'driftbench.estate.yaml': 'userSkills: team-skills\n',
        'team-skills/shared-one/SKILL.md': skill('shared-one'),
      },
      new ClaudeCodeReader(),
    );
    expect(skillNames(named.map)).toEqual(['shared-one']);
    expect(named.map.userSkills).toBe(true);
  });

  it('notes a configuration value that is not a folder and reads no layer', async () => {
    process.env.HOME = await home({ '.claude/skills/in-home/SKILL.md': skill('in-home') });
    const bad = await scan({ 'driftbench.estate.yaml': 'userSkills: false\n' }, new ClaudeCodeReader());
    expect(skillNames(bad.map)).toEqual([]);
    expect(bad.raw.notes).toContainEqual({
      file: 'driftbench.estate.yaml',
      message: expect.stringContaining('userSkills'),
    });
  });

  it('notes a folder that was named and cannot be read', async () => {
    process.env.HOME = await mkdtemp(join(tmpdir(), 'driftbench-empty-home-'));
    const named = await scan(
      { 'CLAUDE.md': '# Standing\n' },
      new ClaudeCodeReader({ userSkills: join(tmpdir(), 'driftbench-no-such-folder') }),
    );
    expect(named.raw.notes).toContainEqual({
      file: USER_LAYER,
      message: expect.stringContaining('cannot be read'),
    });
  });

  it('keeps the layer out of the files a copy of the project needs', async () => {
    process.env.HOME = await home({ '.claude/skills/pier-notes/SKILL.md': skill('pier-notes') });
    const root = await estate({ '.claude/skills/dock-roster/SKILL.md': skill('dock-roster') });
    const listed = await layered().listFiles(root);
    expect(listed).toContain('.claude/skills/dock-roster/SKILL.md');
    expect(listed.filter((path) => path.startsWith('~'))).toEqual([]);
  });
});
