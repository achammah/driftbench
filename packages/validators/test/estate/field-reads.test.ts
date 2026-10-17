import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { type FieldReads, fieldReadCensus, readSites } from './field-reads';

const SKILLS: FieldReads[] = [
  { receivers: ['expect'], fields: ['guards', 'references', 'skills', 'subagents'] },
];
const COUNT: FieldReads[] = [{ receivers: ['guard', 'skill', 'helper'], fields: ['count'] }];

const sites = (text: string, reads: FieldReads[] = SKILLS) => readSites(text, reads);

describe('the field-read census reads the syntax tree', () => {
  it('finds the plain read and the same read through an optional chain', () => {
    expect(sites('const a = ctx.expect.skills;')).toEqual(['const a = ctx.expect.skills;']);
    expect(sites('const a = ctx.expect?.skills ?? [];')).toEqual(['const a = ctx.expect?.skills ?? [];']);
    expect(sites('const a = expect?.skills?.length;')).toEqual(['const a = expect?.skills?.length;']);
    expect(sites('for (const guard of block.expect?.guards ?? []) guard.verdict = 1;')).toHaveLength(1);
  });

  it('finds a read of the exact field the proof deletes, planted behind an optional chain', () => {
    const planted = 'const n = input.expect?.skills?.map((skill) => skill?.count);';
    expect(sites(planted)).toEqual([planted]);
    expect(sites(planted, COUNT)).toEqual([planted]);
  });

  it('finds a read through a non-null assertion, a cast, a literal key and a binding pattern', () => {
    expect(sites('const a = ctx.expect!.skills;')).toHaveLength(1);
    expect(sites('const a = (ctx as Ctx).expect.skills;')).toHaveLength(1);
    expect(sites('const a = (ctx.expect satisfies Expect).skills;')).toHaveLength(1);
    expect(sites("const a = ctx.expect['skills'];")).toHaveLength(1);
    expect(sites("const a = ctx['expect']['guards'];")).toHaveLength(1);
    expect(sites('const { skills } = ctx.expect;')).toEqual(['const { skills } = ctx.expect;']);
    expect(sites('const { skills: wanted = [] } = ctx.expect;')).toHaveLength(1);
    expect(sites("const { 'guards': g } = expect;")).toHaveLength(1);
  });

  it('counts a line once, and every line that reads', () => {
    expect(sites('const a = expect.skills ?? expect.guards;')).toHaveLength(1);
    expect(sites('const a = expect.skills;\nconst b = 1;\nconst c = expect?.guards;')).toEqual([
      'const a = expect.skills;',
      'const c = expect?.guards;',
    ]);
  });

  it('does not count a word in a string, a template text, a comment or a regular expression', () => {
    expect(sites("const a = 'expect.skills';")).toEqual([]);
    expect(sites('const a = "expect?.skills";')).toEqual([]);
    expect(sites('const a = `reads expect.skills here`;')).toEqual([]);
    expect(sites('const a = /expect\\.skills/;')).toEqual([]);
    expect(sites('// ctx.expect.skills is read below\nconst a = 1;')).toEqual([]);
    expect(sites('/* ctx.expect?.skills */ const a = 1;')).toEqual([]);
    expect(sites('/**\n * Reads expect.skills.\n */\nconst a = 1;')).toEqual([]);
    expect(sites('const m = "expect.skills " + other;')).toEqual([]);
  });

  it('counts a read inside a template expression, which is code', () => {
    const template = 'const a = `#{ctx.expect?.skills?.length} skills`;'.replace('#{', '$' + '{');
    expect(sites(template)).toHaveLength(1);
  });

  it('does not count a type position, another receiver or another field', () => {
    expect(sites("type S = Expect['skills'];")).toEqual([]);
    expect(sites('type S = typeof expect;')).toEqual([]);
    expect(sites('const a = options.skills;')).toEqual([]);
    expect(sites('const a = expect.criteria;')).toEqual([]);
    expect(sites('const a = expectation.skills;')).toEqual([]);
    expect(sites('const a = skills.expect;')).toEqual([]);
    expect(sites('const { criteria } = ctx.expect;')).toEqual([]);
    expect(sites('const { skills } = ctx.options;')).toEqual([]);
  });

  it('reads the count of an entry by the receiver it ends in, optional chain included', () => {
    expect(sites('const n = guard.count;', COUNT)).toHaveLength(1);
    expect(sites('const n = guard?.count;', COUNT)).toHaveLength(1);
    expect(sites('const n = state.helper.count;', COUNT)).toHaveLength(1);
    expect(sites('const n = other.count;', COUNT)).toEqual([]);
    expect(sites("const n = 'guard.count';", COUNT)).toEqual([]);
  });
});

describe('the census of a folder', () => {
  const root = mkdtempSync(join(tmpdir(), 'driftbench-field-reads-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'src/deep'), { recursive: true });
  writeFileSync(join(root, 'src/a.ts'), 'export const a = (c: Ctx) => c.expect.skills ?? [];\n');
  writeFileSync(join(root, 'src/deep/b.ts'), "// expect.skills\nexport const b = 'expect.skills';\n");
  writeFileSync(join(root, 'src/deep/c.ts'), 'export const c = (c: Ctx) => c.expect?.guards;\n');
  writeFileSync(join(root, 'src/notes.md'), 'ctx.expect.skills\n');

  it('lists the readers of the folder in file order, with the line, and nothing else', () => {
    expect(fieldReadCensus(`${root}/`, ['src'], SKILLS)).toEqual([
      'src/a.ts: export const a = (c: Ctx) => c.expect.skills ?? [];',
      'src/deep/c.ts: export const c = (c: Ctx) => c.expect?.guards;',
    ]);
  });

  it('changes when a reader is planted behind an optional chain, which a text search for expect. misses', () => {
    const before = fieldReadCensus(`${root}/`, ['src'], SKILLS);
    writeFileSync(
      join(root, 'src/planted.ts'),
      'export const p = (c: Ctx) => c.expect?.skills?.map((s) => s?.count);\n',
    );
    const after = fieldReadCensus(`${root}/`, ['src'], SKILLS);
    expect(after).toHaveLength(before.length + 1);
    expect(after.at(-1)).toBe(
      'src/planted.ts: export const p = (c: Ctx) => c.expect?.skills?.map((s) => s?.count);',
    );
    expect(/expect\.(guards|references|skills|subagents)\b/.test('c.expect?.skills')).toBe(false);
  });
});
