import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEstateMap } from '@agent-nexus/driftbench-estate';
import { describe, expect, it, vi } from 'vitest';
import * as fixture from '../../src/ladders/estate/bank/fixture-suite';
import { checksReadOf, coverageFamily } from '../../src/ladders/estate/bank/genquality';
import { agentMutants, estateRun } from '../../src/ladders/estate/index';
import { estateMeta } from '../../src/ladders/estate/levels';

describe('a Read of a file the estate does not hold (docs/estate.md section 5, needs-existing-file)', {
  timeout: 600_000,
}, () => {
  it('lists the estate beside its map, so only a reference to a missing file waits on the marker', async () => {
    const suite = await fixture.fixtureSuite();
    const map = await loadEstateMap(suite.map);
    if (!map.ok) throw new Error('the fixture map does not load');
    const waiting = (suite.report.gaps ?? []).find((gap) => gap.marker === 'needs-existing-file');
    const atoms = new Map(map.map.atoms.map((atom) => [atom.id, atom]));
    expect(waiting?.atoms.length).toBeGreaterThan(0);
    for (const id of waiting?.atoms ?? []) {
      const atom = atoms.get(id);
      expect(atom?.kind, id).toBe('reference');
      expect(atom?.fields?.exists, id).toBe(false);
      expect(existsSync(join(fixture.FIXTURE, String(atom?.fields?.path))), id).toBe(false);
    }
    // Every reference whose file the fixture holds is judged by a complete spec, never held back by the marker.
    const present = map.map.atoms.filter((a) => a.kind === 'reference' && a.fields?.exists === true);
    expect(present.length).toBeGreaterThan(0);
    for (const atom of present) expect(waiting?.atoms.includes(atom.id), atom.id).toBe(false);
  });

  it('judges a missing reference by its marker in gen.coverage, and still demands a spec for every other one', async () => {
    const suite = await fixture.fixtureSuite();
    const one = async (planted: typeof suite) => {
      const mock = vi.spyOn(fixture, 'fixtureSuite').mockResolvedValue(planted);
      try {
        return (await coverageFamily().evaluate(1)).get('gen.coverage.one-per-reference');
      } finally {
        mock.mockRestore();
      }
    };
    const real = await one(suite);
    expect(real?.detail).not.toContain('not marked');
    // Planted: the marker leaves the report, so the missing reference is not marked.
    const unmarked = {
      ...suite,
      report: {
        ...suite.report,
        gaps: (suite.report.gaps ?? []).filter((gap) => gap.marker !== 'needs-existing-file'),
      },
    };
    expect(await one(unmarked)).toMatchObject({
      pass: false,
      detail: expect.stringContaining('not marked needs-existing-file'),
    });
    // Planted: every complete spec of the references that exist is dropped; the item is red for them.
    const dropped = {
      ...suite,
      specs: suite.specs.filter((spec) => !spec.id.includes('reference') || !spec.complete),
    };
    const none = suite.specs.filter(
      (spec) => spec.complete && spec.atoms.some((id) => id.startsWith('reference.')),
    );
    if (none.length > 0) expect((await one(dropped))?.pass).toBe(false);
  });

  it('does not count the mutant of a reference to a missing file alive, and still counts a present one that has no complete test', async () => {
    const run = await estateRun(1);
    const mutants = await agentMutants(run);
    const absent = run.scanned.map.atoms.filter((a) => a.kind === 'reference' && a.fields?.exists === false);
    expect(absent.length).toBeGreaterThan(0);
    for (const atom of absent) {
      const mutant = mutants.find((m) => m.atom === atom.id);
      expect(mutant, atom.id).toMatchObject({ killed: false, untestable: true });
    }
    // Planted: the complete tests of a reference the estate holds are made incomplete. Its mutant is alive.
    const present = run.scanned.map.atoms.find(
      (a) =>
        a.kind === 'reference' && a.fields?.exists === true && mutants.find((m) => m.atom === a.id)?.killed,
    );
    if (!present) throw new Error('no killed present reference on seed 1');
    const planted = {
      ...run,
      specs: run.specs.map((spec) =>
        (estateMeta(spec).atoms ?? []).includes(present.id)
          ? { ...spec, record: { ...spec.record, complete: false } }
          : spec,
      ),
    };
    const after = (await agentMutants(planted)).find((m) => m.atom === present.id);
    expect(after).toMatchObject({ killed: false });
    expect(after?.untestable).toBeUndefined();
  });

  it('takes "absent" from the hidden estate, not from the product: a product that lies about which files exist gains nothing', async () => {
    for (const seed of [1, 2]) {
      const run = await estateRun(seed);
      const honest = await agentMutants(run);
      const held = (atomId: string) => {
        const hid = run.scanned.match.hidOf.get(atomId);
        const truth = run.rendered.atoms.find((candidate) => candidate.hid === hid);
        return truth?.kind === 'reference' && truth.key in run.rendered.files;
      };
      const present = run.scanned.map.atoms.filter((a) => a.kind === 'reference' && held(a.id));
      expect(present.length, `seed ${seed}`).toBeGreaterThan(0);
      expect(
        present.some((a) => honest.find((m) => m.atom === a.id)?.killed),
        `seed ${seed}: a present reference is judged`,
      ).toBe(true);
      // Planted product: the scan marks every reference absent, and every spec naming a reference waits on the marker.
      const references = new Set(
        run.scanned.map.atoms.filter((a) => a.kind === 'reference').map((a) => a.id),
      );
      const lying = {
        ...run,
        scanned: {
          ...run.scanned,
          map: {
            ...run.scanned.map,
            atoms: run.scanned.map.atoms.map((a) =>
              a.kind === 'reference' ? { ...a, fields: { ...a.fields, exists: false } } : a,
            ),
          },
        },
        specs: run.specs.map((spec) => {
          const named = (estateMeta(spec).atoms ?? []).filter((id) => references.has(id));
          if (named.length === 0 || spec.loaded === undefined) return spec;
          const metadata = spec.loaded.spec.metadata as { estate?: Record<string, unknown> };
          return {
            ...spec,
            record: { ...spec.record, complete: false },
            loaded: {
              ...spec.loaded,
              spec: {
                ...spec.loaded.spec,
                metadata: {
                  ...metadata,
                  estate: {
                    ...metadata.estate,
                    needs: named.map((atom) => ({ marker: 'needs-existing-file', atom, detail: 'planted' })),
                  },
                },
              },
            },
          };
        }),
      };
      const after = await agentMutants(lying);
      for (const atom of present)
        expect(after.find((m) => m.atom === atom.id)?.untestable, `seed ${seed} ${atom.id}`).toBeUndefined();
      // The reference the estate truly lacks is still named, not counted alive.
      const absent = run.scanned.map.atoms.filter((a) => a.kind === 'reference' && !held(a.id));
      expect(absent.length, `seed ${seed}`).toBeGreaterThan(0);
      for (const atom of absent)
        expect(
          after.find((m) => m.atom === atom.id),
          `seed ${seed} ${atom.id}`,
        ).toMatchObject({ untestable: true });
    }
  });

  it('derives "absent" in gen.coverage from the fixture folder, not from the exists flag of the committed map', async () => {
    const suite = await fixture.fixtureSuite();
    const text = await readFile(suite.map, 'utf8');
    const one = async (flag: (line: string) => string) => {
      const dir = await mkdtemp(join(tmpdir(), 'lying-map-'));
      try {
        const lying = join(dir, 'approved.yaml');
        await writeFile(lying, text.split('\n').map(flag).join('\n'));
        const mock = vi.spyOn(fixture, 'fixtureSuite').mockResolvedValue({ ...suite, map: lying });
        try {
          return (await coverageFamily().evaluate(1)).get('gen.coverage.one-per-reference');
        } finally {
          mock.mockRestore();
        }
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    };
    const real = await one((line) => line);
    expect(real?.detail).not.toContain('not marked');
    // The committed map says every reference is missing: the files the fixture holds are still judged by their specs.
    expect(await one((line) => line.replace('exists: true', 'exists: false'))).toEqual(real);
    // The committed map says the missing reference is present: it is still judged by its marker.
    expect(await one((line) => line.replace('exists: false', 'exists: true'))).toEqual(real);
  });

  it('judges a reference to a missing file by its marker only: a complete spec that checks the Read is the product ignoring it', async () => {
    const suite = await fixture.fixtureSuite();
    const waiting = (suite.report.gaps ?? []).find((gap) => gap.marker === 'needs-existing-file');
    const missing = waiting?.atoms[0];
    if (!missing || !suite.specs[0]) throw new Error('the fixture has no missing reference');
    const one = async (planted: typeof suite) => {
      const mock = vi.spyOn(fixture, 'fixtureSuite').mockResolvedValue(planted);
      try {
        return (await coverageFamily().evaluate(1)).get('gen.coverage.one-per-reference');
      } finally {
        mock.mockRestore();
      }
    };
    const path = String(
      (await loadEstateMap(suite.map).then((m) => (m.ok ? m.map.atoms : []))).find((a) => a.id === missing)
        ?.fields?.path,
    );
    const withChecks = (rules: Record<string, unknown>, expectation: Record<string, unknown>) => {
      const base = structuredClone(suite.specs[0]) as (typeof suite.specs)[number];
      const spec = base.spec as unknown as {
        blocks: Array<{ expect?: Record<string, unknown> }>;
        rules?: unknown;
      };
      if (spec.blocks[0]) spec.blocks[0].expect = expectation;
      spec.rules = rules;
      return { ...base, atoms: [missing], complete: true };
    };
    // Unmarked: the item fails and names the reference, whatever else judges it.
    const noMarker = {
      ...suite,
      report: {
        ...suite.report,
        gaps: (suite.report.gaps ?? []).filter((gap) => gap.marker !== 'needs-existing-file'),
      },
    };
    const checked = withChecks({}, { tools: [{ label: 'Read', input: { file_path: { contains: path } } }] });
    expect(await one({ ...noMarker, specs: [...suite.specs, checked] })).toMatchObject({
      pass: false,
      detail: expect.stringContaining('not marked needs-existing-file'),
    });
    // Marked, and a complete spec checks the Read as well: the item fails and names the reference.
    for (const complete of [
      checked,
      withChecks({}, { references: [{ path: `**/${path}`, count: { min: 1 } }] }),
      withChecks(
        {
          custom: {
            some_call: {
              calls: [{ label: 'Read', input: { file_path: path }, count: { min: 1 }, block: 0 }],
            },
          },
        },
        {},
      ),
    ])
      expect(await one({ ...suite, specs: [...suite.specs, complete] })).toMatchObject({
        pass: false,
        detail: expect.stringContaining(missing),
      });
    // Marked, and a complete spec reads it by its bare name, an absolute path, a pattern or a glob of its name: fails.
    const basename = path.slice(path.lastIndexOf('/') + 1);
    for (const complete of [
      withChecks({}, { tools: [{ label: 'Read', input: { file_path: { contains: basename } } }] }),
      withChecks({}, { tools: [{ label: 'Read', input: { file_path: `/work/northwind/${path}` } }] }),
      withChecks(
        {},
        {
          tools: [{ label: 'Read', input: { file_path: { regex: `${basename.split('.').join('\\.')}$` } } }],
        },
      ),
      withChecks({}, { references: [{ path: `**/${basename}` }] }),
    ])
      expect(await one({ ...suite, specs: [...suite.specs, complete] })).toMatchObject({
        pass: false,
        detail: expect.stringContaining(missing),
      });
    // Marked, and the specs that name it only name it (or read another file): no complaint about the missing reference.
    for (const harmless of [
      withChecks({}, { must: [path] }),
      withChecks({}, { tools: [{ label: 'Read', input: { file_path: { equals: `archive/${path}` } } }] }),
    ])
      expect((await one({ ...suite, specs: [...suite.specs, harmless] }))?.detail ?? '').not.toContain(
        'have a complete spec that checks a Read',
      );
  });

  describe('checksReadOf is a check of a Read of exactly the path', () => {
    const REF = 'lighthouse/logbook.md';
    const spec = (rules: Record<string, unknown>, expectation: Record<string, unknown>) =>
      ({
        path: 'p.yaml',
        id: 'p',
        atoms: [],
        testType: 'read_when',
        mode: 'task',
        complete: true,
        spec: { blocks: [{ expect: expectation }], rules },
      }) as unknown as Parameters<typeof checksReadOf>[0];
    const read = (input: Record<string, unknown>, count?: unknown) =>
      spec({}, { tools: [{ label: 'Read', input, ...(count === undefined ? {} : { count }) }] });
    const some = (input: Record<string, unknown>, count?: unknown) =>
      spec(
        {
          custom: {
            some_call: {
              calls: [{ label: 'Read', input, block: 0, ...(count === undefined ? {} : { count }) }],
            },
          },
        },
        {},
      );

    it.each([
      ['no count', undefined],
      ['a count of 1', 1],
      ['a minimum of 1', { min: 1 }],
      ['a range from 1 to 3', { min: 1, max: 3 }],
    ])('counts a Read asked for with %s', (_name, count) => {
      expect(checksReadOf(read({ file_path: { contains: REF } }, count), REF)).toBe(true);
      expect(checksReadOf(some({ file_path: REF }, count), REF)).toBe(true);
    });

    it.each([
      ['a count of 0', 0],
      ['a maximum of 0', { max: 0 }],
      ['an empty range', {}],
      ['a maximum of 3 (zero allowed)', { max: 3 }],
      ['a minimum of 0', { min: 0 }],
    ])('does not count a Read asked for with %s', (_name, count) => {
      expect(checksReadOf(read({ file_path: { contains: REF } }, count), REF)).toBe(false);
      expect(checksReadOf(some({ file_path: REF }, count), REF)).toBe(false);
    });

    it('compares the whole normalized path for equals and a bare path: another file that ends in it is not it', () => {
      expect(checksReadOf(read({ file_path: { equals: REF } }), REF)).toBe(true);
      expect(checksReadOf(read({ file_path: { equals: `./${REF}` } }), REF)).toBe(true);
      expect(checksReadOf(read({ file_path: { equals: 'archive/lighthouse/logbook.md' } }), REF)).toBe(false);
      expect(checksReadOf(read({ file_path: { equals: 'archive/logbook.md' } }), 'logbook.md')).toBe(false);
      expect(checksReadOf(some({ file_path: 'old/lighthouse/logbook.md' }), REF)).toBe(false);
      expect(checksReadOf(some({ file_path: REF }), REF)).toBe(true);
    });

    it('lets only a contains and a glob carry a prefix', () => {
      expect(checksReadOf(read({ file_path: { contains: `/estate/${REF}` } }), REF)).toBe(true);
      expect(checksReadOf(spec({}, { references: [{ path: `**/${REF}` }] }), REF)).toBe(true);
      expect(checksReadOf(spec({}, { references: [{ path: `**/archive/${REF}x` }] }), REF)).toBe(false);
      expect(checksReadOf(spec({}, { references: [{ path: 'archive/logbook.md' }] }), 'logbook.md')).toBe(
        false,
      );
    });

    it.each([
      ['by its bare name, as a contains', read({ file_path: { contains: 'logbook.md' } })],
      ['by its tail, as a contains', read({ file_path: { contains: 'lighthouse/logbook.md' } })],
      ['by an absolute path, bare', read({ file_path: `/work/northwind/${REF}` })],
      ['by an absolute path, as exact', read({ file_path: { exact: `/work/northwind/${REF}` } })],
      ['by an absolute path in a some_call', some({ file_path: `/work/northwind/${REF}` })],
      ['by a pattern that names the file', read({ file_path: { regex: 'logbook\\.md$' } })],
      ['by an anchored pattern with the folder', read({ file_path: { regex: '^lighthouse/logbook\\.md$' } })],
      ['by a pattern in a some_call', some({ file_path: { regex: 'lighthouse/logbook\\.md' } })],
      ['by a double-star glob of its name', spec({}, { references: [{ path: '**/logbook.md' }] })],
      ['by a double-star glob of its tail', spec({}, { references: [{ path: `**/${REF}` }] })],
      ['by one_of that lists it', read({ file_path: { one_of: ['other.md', REF] } })],
    ])('counts a Read of the file %s', (_name, candidate) => {
      expect(checksReadOf(candidate, REF)).toBe(true);
    });

    it.each([
      ['a bare name of another file', read({ file_path: { contains: 'notebook.md' } })],
      ['a contains that is no file name', read({ file_path: { contains: '.md' } })],
      ['a relative path with a folder in front', read({ file_path: `archive/${REF}` })],
      ['an absolute path of another file', read({ file_path: '/work/northwind/lighthouse/other.md' })],
      ['a pattern that names another file', read({ file_path: { regex: 'other\\.md$' } })],
      ['a pattern that names no file', read({ file_path: { regex: '.*' } })],
      ['a pattern that is no regular expression', read({ file_path: { regex: '(logbook.md' } })],
      ['a glob of another name', spec({}, { references: [{ path: '**/notebook.md' }] })],
      ['a glob of all markdown', spec({}, { references: [{ path: '**/*.md' }] })],
      ['one_of that lists other files', read({ file_path: { one_of: ['a.md', 'b.md'] } })],
    ])('does not count %s', (_name, candidate) => {
      expect(checksReadOf(candidate, REF)).toBe(false);
    });

    it('counts nothing else: another tool, a pattern, a name only', () => {
      expect(
        checksReadOf(spec({}, { tools: [{ label: 'Edit', input: { file_path: { contains: REF } } }] }), REF),
      ).toBe(false);
      expect(checksReadOf(read({ file_path: { matches: 'logbook' } }), REF)).toBe(false);
      expect(checksReadOf(spec({}, { must: [REF] }), REF)).toBe(false);
    });
  });
});
