import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadEstateMap } from '@agent-nexus/driftbench-estate';
import { describe, expect, it, vi } from 'vitest';
import * as fixture from '../../src/ladders/estate/bank/fixture-suite';
import { coverageFamily } from '../../src/ladders/estate/bank/genquality';
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
    // Planted: the marker leaves the report, so the missing reference is neither marked nor covered.
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
});
