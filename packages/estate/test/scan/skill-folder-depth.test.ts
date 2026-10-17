import { describe, expect, it } from 'vitest';
import { AtomBuilder, codeAtoms } from '../../src/scan/code';
import type { RawEstate, SkillDecl } from '../../src/scan/reader';

/** A hand-written runtime adapter: its layout is independent of Claude Code. */
function rawSkills(roots: Array<[folder: string, name: string]>): RawEstate {
  const skills: SkillDecl[] = roots.map(([folder, name]) => {
    const file = `${folder}/SKILL.md`;
    return {
      name,
      file,
      folder,
      at: { file, startLine: 1, endLine: 1, quote: '# Procedure' },
      tools: [],
      fields: {},
      body: { startLine: 1, endLine: 2 },
    };
  });
  return {
    runtime: 'hand-written',
    labels: { read: 'open', edit: 'edit', write: 'write', shell: 'exec', dispatch: 'delegate' },
    skills,
    files: skills.flatMap((skill) => [
      {
        path: skill.file,
        kind: 'skill' as const,
        text: '# Procedure\nRun `scripts/verify.py`.\n',
        owner: skill.name,
      },
      {
        path: `${skill.folder}/scripts/verify.py`,
        kind: 'skill_file' as const,
        text: 'print("checked")\n',
        owner: skill.name,
      },
    ]),
    prose: skills.map((skill) => ({
      id: skill.file,
      file: skill.file,
      startLine: 1,
      endLine: 2,
      text: '# Procedure\nRun `scripts/verify.py`.\n',
    })),
    subagents: [],
    guards: [],
    permissions: [],
    settings: [],
    registry: [],
    steps: [],
    notes: [],
  };
}

function scripts(raw: RawEstate) {
  const builder = new AtomBuilder(new Map(raw.files.map((file) => [file.path, file])));
  codeAtoms(raw, builder);
  return builder.atoms.filter((atom) => atom.kind === 'script');
}

describe('script grouping by declared skill roots', () => {
  it.each(['procedure', 'skills/procedure', '.claude/skills/procedure', 'runtime/team/skills/procedure'])(
    'reads scripts at root %s, independently of the skill name',
    (folder) => {
      const found = scripts(rawSkills([[folder, 'audit']]));
      expect(found).toHaveLength(1);
      expect(found[0]?.fields).toEqual({ path: `${folder}/scripts/verify.py`, skill: 'audit', named: true });
      expect(found[0]?.provenance).toMatchObject({ file: `${folder}/SKILL.md`, startLine: 2 });
    },
  );

  it.each([false, true])(
    'assigns nested files to the deepest declared root (reverse order: %s)',
    (reverse) => {
      const roots: Array<[string, string]> = [
        ['runtime/procedure', 'outer'],
        ['runtime/procedure/team/inner', 'inner'],
      ];
      const raw = rawSkills(reverse ? roots.toReversed() : roots);
      // Owner labels can be stale after a folder rename; the declared roots decide membership.
      for (const file of raw.files) file.owner = 'old-name';
      raw.files.push(
        { path: 'runtime/procedure/team/inner/scripts/deep/run.sh', kind: 'skill_file', text: 'echo ok\n' },
        { path: 'runtime/procedure-other/scripts/stray.py', kind: 'skill_file', text: 'print(0)\n' },
        { path: 'unclaimed/scripts/stray.py', kind: 'skill_file', text: 'print(0)\n' },
        { path: 'runtime/procedure/guard.py', kind: 'guard_script', text: 'print(0)\n' },
      );
      const found = scripts(raw);
      expect(found.map((atom) => [atom.fields?.path, atom.fields?.skill]).sort()).toEqual([
        ['runtime/procedure/scripts/verify.py', 'outer'],
        ['runtime/procedure/team/inner/scripts/deep/run.sh', 'inner'],
        ['runtime/procedure/team/inner/scripts/verify.py', 'inner'],
      ]);
      expect(
        found.find((atom) => atom.fields?.path === 'runtime/procedure/team/inner/scripts/deep/run.sh')
          ?.provenance.file,
      ).toBe('runtime/procedure/team/inner/scripts/deep/run.sh');
    },
  );
});
