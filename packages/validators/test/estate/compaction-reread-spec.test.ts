import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cli } from '../../src/ladders/estate/bank/bench';
import { FIXTURE, fixtureSuite, runOnFakeDetailed } from '../../src/ladders/estate/bank/fixture-suite';

/**
 * The compaction rule of the Northwind fixture (R15: after a compaction, re-read this file) is checked by a
 * committed, generated spec: the spec names the file to re-read, the fake agent passes it on the fixture, and a
 * fixture without the rule, whose fake never re-reads, fails it. No unit test stands in for the spec.
 */

const HAZARD = 'hazard.standing.recover-from-a-compaction-of-the';

describe('the generated compaction spec of the fixture', { timeout: 300_000 }, () => {
  const folders: string[] = [];
  afterAll(async () => {
    for (const folder of folders) await rm(folder, { recursive: true, force: true });
  });

  it('names the file to re-read, passes with the rule, and fails on the fixture without it', async () => {
    const suite = await fixtureSuite();
    const spec = suite.specs.find(
      (candidate) => candidate.complete && candidate.mode === 'live' && candidate.atoms.includes(HAZARD),
    );
    if (!spec) throw new Error('no complete live spec names the compaction hazard');
    const text = await readFile(spec.path, 'utf8');
    expect(text).toMatch(/hazard_recovery:\s*\n\s+hazard: compaction\s*\n\s+reread:\s*\n\s+- CLAUDE\.md/);

    const work = await mkdtemp(join(tmpdir(), 'compaction-spec-'));
    folders.push(work);
    const original = runOnFakeDetailed(FIXTURE, [spec.path], join(work, 'original.db'), suite.map);
    expect(original.get(spec.id)).toMatchObject({ completed: true, pass: true });

    // The same estate with the rule deleted: the fake has nothing to follow, so it never re-reads.
    const mutant = join(work, 'mutant');
    expect(cli(['estate', 'mutate', suite.map, '--atom', HAZARD, '--delete', '--to', mutant]).code).toBe(0);
    const red = runOnFakeDetailed(mutant, [spec.path], join(work, 'mutant.db'));
    const verdict = red.get(spec.id);
    expect(verdict?.completed).toBe(true);
    expect(verdict?.pass).toBe(false);
    expect(verdict?.failing.some((failing) => /reread/i.test(failing))).toBe(true);
  });
});
