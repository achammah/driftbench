import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Atom, type EstateMap, readerFor, scanEstate } from '@agent-nexus/driftbench-estate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { judgeShared, type SharedMeasured } from '../../src/ladders/estate/bank/scale-shared';
import { sharedEstate } from '../../src/ladders/estate/bank/scale-shared-estate';
import { sharedFacts } from '../../src/ladders/estate/bank/scale-shared-facts';
import { RUNTIME } from '../../src/ladders/estate/layout';
import { writeEstate } from '../../src/ladders/estate/pipeline';

describe('the shared-index estate', () => {
  it('has 57 units citing one index that cites thousands of files, at scale 1', () => {
    const { truth } = sharedEstate(1);
    expect(truth.units).toHaveLength(57);
    expect(truth.indexEntries).toBe(3500);
    expect(truth.unitCitations).toBe(40 * 2 + 17);
    // Every unit reaches the index, every entry, and the documents the first entries cite on, and nothing else.
    const sizes = new Set(Object.values(truth.closure).map((reached) => reached.length));
    expect(sizes.size).toBeLessThanOrEqual(2);
    const skill = truth.units[0] as (typeof truth.units)[number];
    expect(truth.closure[skill.file]).toContain('.claude/memory/INDEX.md');
    expect(truth.closure[skill.file]).toContain('.claude/memory/extra/appendix-0.md');
    const helper = truth.units.at(-1) as (typeof truth.units)[number];
    expect(truth.closure[helper.file]).not.toContain(
      truth.closure[skill.file]?.find((p) => p.endsWith('own.md')),
    );
  });

  it('is the same for a seed and differs for another', () => {
    expect(sharedEstate(3, { scale: 0.1 }).files).toEqual(sharedEstate(3, { scale: 0.1 }).files);
    expect(sharedEstate(3, { scale: 0.1 }).files).not.toEqual(sharedEstate(4, { scale: 0.1 }).files);
  });
});

describe('the facts of a shared-index map', { timeout: 120_000 }, () => {
  const planted = sharedEstate(2, { scale: 0.1 });
  let map: EstateMap;
  let home: string;
  let root: string;
  const before = process.env.HOME;

  beforeAll(async () => {
    root = await writeEstate(planted.files);
    home = await mkdtemp(join(tmpdir(), 'shared-test-home-'));
    process.env.HOME = home;
    const reader = readerFor(RUNTIME);
    if (!reader) throw new Error('no reader');
    const result = await scanEstate({ root, reader, now: () => new Date('2026-10-11T00:00:00.000Z') });
    map = result.map;
  });
  afterAll(async () => {
    if (before === undefined) delete process.env.HOME;
    else process.env.HOME = before;
    await rm(root, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  });

  const unitAtoms = (m: EstateMap) =>
    m.atoms.filter(
      (a) => (a.kind === 'skill' || a.kind === 'subagent') && planted.truth.closure[a.provenance.file],
    );

  it('holds for the map the reader reads', () => {
    const facts = sharedFacts(map, planted.truth);
    expect(facts.edges).toMatchObject({
      stored: planted.truth.unitCitations,
      allowed: planted.truth.unitCitations,
      foreign: 0,
    });
    expect(facts.reach).toMatchObject({ wrong: 0, missing: 0, extra: 0 });
  });

  it('fails a map that links every unit to what the index cites: the flattened graph', () => {
    const indexAtoms = map.atoms.filter(
      (a) => a.kind === 'reference' && a.provenance.file === '.claude/memory/INDEX.md',
    );
    expect(indexAtoms.length).toBe(planted.truth.indexEntries);
    const flat: EstateMap = {
      ...map,
      edges: [
        ...map.edges,
        ...unitAtoms(map).flatMap((unit) =>
          indexAtoms.map((to) => ({ from: unit.id, to: to.id, kind: 'reference' as const })),
        ),
      ],
    };
    const facts = sharedFacts(flat, planted.truth);
    expect(facts.edges.foreign).toBeGreaterThan(planted.truth.indexEntries);
    expect(judgeShared(measured(facts)).get('scale-shared.shared-edges-direct')?.pass).toBe(false);
    // The reach does not change: the citations are all read.
    expect(facts.reach.wrong).toBe(0);
  });

  it('fails a map that leaves the citations of the index or of the documents it names unread', () => {
    const noIndex: EstateMap = {
      ...map,
      atoms: map.atoms.filter((a) => a.provenance.file !== '.claude/memory/INDEX.md'),
    };
    const a = sharedFacts(noIndex, planted.truth);
    expect(a.reach.wrong).toBe(unitAtoms(map).length);
    expect(a.reach.missing).toBeGreaterThan(0);
    const noChain: EstateMap = {
      ...map,
      atoms: map.atoms.filter((x) => !x.provenance.file.startsWith('.claude/memory/entries/e-0.md')),
    };
    const b = sharedFacts(noChain, planted.truth);
    expect(b.reach.wrong).toBe(unitAtoms(map).length);
    expect(sharedFacts({ ...map, atoms: [], edges: [] }, planted.truth).reach.wrong).toBe(
      unitAtoms(map).length,
    );
  });

  it('fails a map that reads a citation nobody planted', () => {
    const stray = map.atoms.find(
      (x): x is Atom => x.kind === 'reference' && x.provenance.file.endsWith('INDEX.md'),
    ) as Atom;
    const invented: Atom = {
      ...stray,
      id: 'reference.invented',
      provenance: { ...stray.provenance, file: '.claude/memory/entries/e-5.md' },
      fields: {
        ...stray.fields,
        path: `.claude/skills/${planted.truth.units[0]?.name ?? ''}/references/own.md`,
      },
    };
    const facts = sharedFacts({ ...map, atoms: [...map.atoms, invented] }, planted.truth);
    expect(facts.reach.extra).toBeGreaterThan(0);
  });

  function measured(facts: ReturnType<typeof sharedFacts>): SharedMeasured {
    return { files: 3659, units: 57, scanMs: 5000, planConsoleLines: 101, facts };
  }

  it('judges each item by itself', () => {
    const facts = sharedFacts(map, planted.truth);
    const fine = judgeShared(measured(facts));
    expect([...fine.values()].every((r) => r.pass)).toBe(true);
    const slow = judgeShared({ ...measured(facts), scanMs: 60_000 });
    expect([...slow].filter(([, r]) => !r.pass).map(([id]) => id)).toEqual(['scale-shared.shared-time-scan']);
    const loud = judgeShared({ ...measured(facts), planConsoleLines: 199_052 });
    expect([...loud].filter(([, r]) => !r.pass).map(([id]) => id)).toEqual(['scale-shared.shared-console']);
    const failed = judgeShared({ ...measured(facts), planConsoleLines: -1 });
    expect(failed.get('scale-shared.shared-console')?.pass).toBe(false);
  });
});
