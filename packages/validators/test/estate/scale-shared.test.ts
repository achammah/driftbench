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
    // Two for each skill, one for each helper, and one more for the skill that shares a citation with the index.
    expect(truth.unitCitations).toBe(40 * 2 + 17 + 1);
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
    return { files: 3659, units: 57, scanMs: 5000, planMs: 9000, planConsoleLines: 101, facts };
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

describe('each item of the family fails for its own cause', { timeout: 120_000 }, () => {
  const planted = sharedEstate(2, { scale: 0.1 });
  const truth = planted.truth;
  let map: EstateMap;
  let home: string;
  let root: string;
  const before = process.env.HOME;

  beforeAll(async () => {
    root = await writeEstate(planted.files);
    home = await mkdtemp(join(tmpdir(), 'shared-cause-home-'));
    process.env.HOME = home;
    const reader = readerFor(RUNTIME);
    if (!reader) throw new Error('no reader');
    const result = await scanEstate({ root, reader, now: () => new Date('2026-10-11T00:00:00.000Z') });
    map = {
      ...result.map,
      atoms: result.map.atoms.map((atom) => ({ ...atom, approved: true })),
    };
  });
  afterAll(async () => {
    if (before === undefined) delete process.env.HOME;
    else process.env.HOME = before;
    await rm(root, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  });

  const measuredOf = (m: EstateMap, extra: Partial<SharedMeasured> = {}): SharedMeasured => ({
    files: truth.files.length,
    units: truth.units.length,
    scanMs: 100,
    planMs: 100,
    planConsoleLines: 10,
    facts: sharedFacts(m, truth),
    ...extra,
  });
  const failing = (measured: SharedMeasured) =>
    [...judgeShared(measured)].filter(([, r]) => !r.pass).map(([id]) => id.replace('scale-shared.', ''));
  /** The file that cites the file of a class, first one. */
  const citerOf = (kind: string) => {
    const cited = Object.keys(truth.classes).filter((path) => truth.classes[path] === kind);
    return Object.keys(truth.cites).filter((from) =>
      (truth.cites[from] ?? []).some((to) => cited.includes(to)),
    );
  };
  const withoutCitationsOf = (files: string[]): EstateMap => ({
    ...map,
    atoms: map.atoms.filter((atom) => !(atom.kind === 'reference' && files.includes(atom.provenance.file))),
  });
  const reference = (from: string, to: string): Atom => {
    const stray = map.atoms.find((a) => a.kind === 'reference') as Atom;
    return {
      ...stray,
      id: `reference.hand.${from}.${to}`,
      provenance: { ...stray.provenance, file: from },
      fields: { ...stray.fields, path: to, exists: true },
    };
  };

  it('passes every item for the map the reader reads', () => {
    expect(failing(measuredOf(map))).toEqual([]);
  });

  it('fails the time items by the time they take, and no other', () => {
    expect(failing(measuredOf(map, { scanMs: 600_000 }))).toEqual(['shared-time-scan']);
    expect(failing(measuredOf(map, { planMs: 6_000_000 }))).toEqual(['shared-time-plan']);
  });

  it('fails a unit that stores more edges than its file cites: per unit and in all', () => {
    const unit = [...map.atoms].find((a) => a.kind === 'skill' && a.provenance.file === truth.units[1]?.file);
    const target = map.atoms.find(
      (a) => a.kind === 'reference' && a.provenance.file !== unit?.provenance.file,
    );
    if (!unit || !target) throw new Error('no unit');
    const more: EstateMap = {
      ...map,
      edges: [...map.edges, { from: unit.id, to: target.id, kind: 'reference' }],
    };
    expect(failing(measuredOf(more))).toEqual(
      expect.arrayContaining(['shared-edges-direct', 'shared-edges-per-unit']),
    );
  });

  it('fails a map with no reference edge at all: stored must equal what the units cite', () => {
    const none: EstateMap = { ...map, edges: map.edges.filter((edge) => edge.kind !== 'reference') };
    expect(failing(measuredOf(none))).toEqual(
      expect.arrayContaining(['shared-edges-direct', 'shared-edges-mixed-owner']),
    );
  });

  it('fails an edge that ends at no atom, and an edge stored twice', () => {
    const unit = map.atoms.find(
      (a) => a.kind === 'skill' && a.provenance.file === truth.units[1]?.file,
    ) as Atom;
    const first = map.edges.find((e) => e.kind === 'reference' && e.from === unit.id);
    if (!first) throw new Error('no edge');
    const dangling: EstateMap = {
      ...map,
      edges: [
        ...map.edges.filter((e) => e !== first),
        { from: unit.id, to: 'reference.nowhere', kind: 'reference' },
      ],
    };
    expect(failing(measuredOf(dangling))).toContain('shared-edges-resolved');
    const twice: EstateMap = { ...map, edges: [...map.edges, { ...first }] };
    expect(failing(measuredOf(twice))).toContain('shared-edges-once');
    expect(failing(measuredOf(twice))).not.toContain('shared-edges-resolved');
  });

  it('fails the skill that shares a citation with the index when it loses its own edge', () => {
    const unit = map.atoms.find((a) => a.kind === 'skill' && a.provenance.file === truth.mixed.unit) as Atom;
    const lost = map.edges.filter((e) => {
      if (e.kind !== 'reference' || e.from !== unit.id) return true;
      const target = map.atoms.find((a) => a.id === e.to);
      return !String(target?.fields?.path ?? '').endsWith('e-0.md');
    });
    expect(failing(measuredOf({ ...map, edges: lost }))).toContain('shared-edges-mixed-owner');
  });

  it.each([
    ['entries', 'index', 'shared-reach-entries'],
    ['chain-two', 'chain-two', 'shared-reach-chain-two'],
    ['chain-three', 'chain-three', 'shared-reach-chain-three'],
    ['fan-in', 'fan-in', 'shared-reach-fan-in'],
    ['relative', 'relative', 'shared-reach-relative-forms'],
  ] as const)('fails a map that leaves unread the citations that reach the %s files', (_name, kind, item) => {
    // The files that cite a file of the shape, and for the shapes reached only through the index, the index itself.
    const citers =
      kind === 'index'
        ? [Object.keys(truth.classes).find((p) => truth.classes[p] === 'index') as string]
        : citerOf(kind);
    expect(citers.length, kind).toBeGreaterThan(0);
    const out = failing(measuredOf(withoutCitationsOf(citers)));
    expect(out, kind).toContain(item);
    expect(out, kind).toContain('shared-reach-exact');
  });

  it('fails a scan that drops the back edge of a cycle, a self-citation, or one of two lines citing a document, each by its own item', () => {
    const [cycleA, cycleB] = truth.citing.cycle;
    const without = (file: string, keep = 0) => {
      let seen = 0;
      return {
        ...map,
        atoms: map.atoms.filter((atom) => {
          if (atom.kind !== 'reference' || atom.provenance.file !== file) return true;
          seen += 1;
          return seen <= keep;
        }),
      };
    };
    // The walk from a unit reaches every document either way, so the reach items cannot tell these apart.
    expect(failing(measuredOf(without(cycleB)))).toEqual(['shared-citation-cycle']);
    // The forward edge is also how the second document is reached, so its loss shows in the reach as well.
    expect(failing(measuredOf(without(cycleA)))).toEqual(['shared-reach-exact', 'shared-citation-cycle']);
    expect(failing(measuredOf(without(truth.citing.self)))).toEqual(['shared-citation-self']);
    // A scan that merges the two lines into one atom keeps the reach and has fewer atoms than citations.
    expect(failing(measuredOf(without(truth.citing.twice.from, 1)))).toEqual(['shared-citation-twice']);
  });

  it('fails a reference of one skill that reaches another skill', () => {
    const other = truth.units[1] as (typeof truth.units)[number];
    const own = Object.keys(truth.classes).find(
      (p) => truth.classes[p] === 'own' && !p.includes(`/${truth.units[0]?.name}/`),
    ) as string;
    const leak: EstateMap = {
      ...map,
      atoms: [...map.atoms, reference(truth.units[0]?.file as string, own)],
    };
    void other;
    expect(failing(measuredOf(leak))).toContain('shared-reach-own');
  });

  it('fails a citation of a missing file that reaches a file, and one that is not marked missing', () => {
    const marked = map.atoms.map((atom) =>
      atom.kind === 'reference' && atom.provenance.file === truth.missing.from
        ? { ...atom, fields: { ...atom.fields, exists: true } }
        : atom,
    );
    expect(failing(measuredOf({ ...map, atoms: marked }))).toEqual(['shared-reach-missing-target']);
    const wrong = map.atoms.map((atom, index) =>
      atom.kind === 'reference' &&
      index === map.atoms.findIndex((a) => a.kind === 'reference' && a.provenance.file !== truth.missing.from)
        ? { ...atom, fields: { ...atom.fields, exists: false } }
        : atom,
    );
    expect(failing(measuredOf({ ...map, atoms: wrong }))).toEqual(['shared-reach-missing-target']);
  });

  it('fails more reference atoms than citations, and atoms that do not grow with the files', () => {
    const doubled: EstateMap = {
      ...map,
      atoms: [
        ...map.atoms,
        // The citations of the index, once more each: reference atoms for a unit's reach, not for a citation.
        ...map.atoms
          .filter((a) => a.kind === 'reference' && a.provenance.file.endsWith('INDEX.md'))
          .map((a) => ({ ...a, id: `${a.id}.again` })),
      ],
    };
    expect(failing(measuredOf(doubled))).toEqual(['shared-atoms-per-citation']);
    const heap: EstateMap = {
      ...map,
      atoms: [
        ...map.atoms,
        ...Array.from({ length: truth.files.length * 6 }, (_, n) => ({
          ...(map.atoms.find((a) => a.kind === 'invariant') as Atom),
          id: `invariant.heap.${n}`,
          provenance: { ...(map.atoms[0] as Atom).provenance, file: 'heap.md' },
        })),
      ],
    };
    expect(failing(measuredOf(heap))).toEqual(['shared-atoms-linear']);
  });

  it('fails orphans left unlisted, and a named document listed as an orphan', () => {
    const listed = (paths: string[]): EstateMap => ({
      ...map,
      atoms: map.atoms.map((atom) =>
        atom.kind === 'invariant' && Array.isArray(atom.fields?.orphans)
          ? { ...atom, fields: { ...atom.fields, orphans: paths } }
          : atom,
      ),
    });
    expect(failing(measuredOf(listed([])))).toEqual(['shared-orphans-found']);
    const named = Object.keys(truth.classes).find((p) => truth.classes[p] === 'entry') as string;
    expect(failing(measuredOf(listed([...truth.orphans, named])))).toEqual(['shared-orphans-none-named']);
  });
});
