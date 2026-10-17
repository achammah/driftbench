import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type EstateMap, readerFor, scanEstate } from '@agent-nexus/driftbench-estate';
import { afterEach, describe, expect, it } from 'vitest';
import { realEstate } from '../../src/ladders/estate/bank/scale-real-estate';
import { readFacts } from '../../src/ladders/estate/bank/scale-real-facts';
import { plantHome, userSkillsFolder } from '../../src/ladders/estate/bank/scale-real-home';
import { RUNTIME } from '../../src/ladders/estate/layout';
import { writeEstate } from '../../src/ladders/estate/pipeline';
import { findRoot } from '../../src/root';

const folders: string[] = [];
const saved = process.env.HOME;
afterEach(async () => {
  if (saved === undefined) delete process.env.HOME;
  else process.env.HOME = saved;
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

/** Scans the planted estate with its home folder as the platform's home, and reads the user-layer facts. */
async function userFacts(named: boolean) {
  const planted = realEstate(4, { scale: 0.1 });
  const root = await writeEstate(planted.files);
  const home = await plantHome(planted.home, root);
  folders.push(root, home);
  process.env.HOME = home;
  const reader = readerFor(RUNTIME, named ? { userSkills: userSkillsFolder(home) } : {});
  if (!reader) throw new Error('no reader');
  const result = await scanEstate({ root, reader, now: () => new Date('2026-10-11T00:00:00.000Z') });
  const map: EstateMap = {
    ...result.map,
    atoms: result.map.atoms.map((atom) => ({ ...atom, approved: true })),
  };
  return { facts: readFacts(map, planted.truth).user, truth: planted.truth };
}

describe('the user-level skill layer of the planted real-size estate is opt-in', () => {
  it('is not found when the reader is given no folder, whatever the platform home holds', async () => {
    const { facts, truth } = await userFacts(false);
    expect(truth.user.found.length).toBeGreaterThan(0);
    expect(facts.found).toBe(0);
    expect(facts.expected).toBe(truth.user.found.length);
  }, 120_000);

  it('is found, once and without its trash folder, when the reader is told the folder', async () => {
    const { facts, truth } = await userFacts(true);
    expect(facts).toMatchObject({
      expected: truth.user.found.length,
      found: truth.user.found.length,
      missed: [],
      duplicates: [],
      trashRead: [],
    });
  }, 120_000);
});

describe('the scale-real worker reads no home folder of the machine', () => {
  it('finds the planted user layer through the folder it names, and nothing from the platform home', async () => {
    const seed = 4;
    const scale = 0.1;
    const decoyHome = await mkdtemp(join(tmpdir(), 'driftbench-decoy-home-'));
    folders.push(decoyHome);
    await mkdir(join(decoyHome, '.claude', 'skills', 'decoy-skill'), { recursive: true });
    await writeFile(
      join(decoyHome, '.claude', 'skills', 'decoy-skill', 'SKILL.md'),
      '---\nname: decoy-skill\ndescription: Handle decoy work. Use when the user asks for decoy work.\n---\n\n# decoy\n',
    );
    const worker = fileURLToPath(
      new URL('../../src/ladders/estate/bank/scale-real-worker.ts', import.meta.url),
    );
    const run = spawnSync(process.execPath, ['--import', 'tsx', worker, String(seed), String(scale)], {
      cwd: findRoot(fileURLToPath(new URL('.', import.meta.url))),
      env: { ...process.env, HOME: decoyHome },
      encoding: 'utf8',
      maxBuffer: 1 << 28,
    });
    const line = run.stdout.trim().split('\n').pop() ?? '';
    const out = JSON.parse(line) as {
      error?: string;
      facts: { user: { expected: number; found: number } };
      userLayerSkills: string[];
    };
    expect(out.error).toBeUndefined();
    const planted = realEstate(seed, { scale: 0.1 });
    // Every planted skill of the layer, and no skill of the home folder the worker was started with.
    expect(out.facts.user.expected).toBe(planted.truth.user.found.length);
    expect(out.facts.user.found).toBe(planted.truth.user.found.length);
    expect(out.userLayerSkills).toEqual([...new Set(planted.truth.user.found)].sort());
    expect(out.userLayerSkills).not.toContain('decoy-skill');
  }, 300_000);
});
