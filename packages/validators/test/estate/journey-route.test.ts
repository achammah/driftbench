import * as estate from '@agent-nexus/driftbench-estate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { planContractFamily } from '../../src/ladders/estate/bank/plan';

vi.mock('@agent-nexus/driftbench-estate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agent-nexus/driftbench-estate')>();
  return { ...actual, planJourneys: vi.fn(actual.planJourneys) };
});

const ID = 'plan.contract.journey-route';
type Journeys = ReturnType<typeof estate.planJourneys>;

/** Runs the family on a seed with the journeys the product gave changed by `fault`. */
async function withJourneys(seed: number, fault?: (journeys: Journeys, map: estate.EstateMap) => Journeys) {
  const actual = await vi.importActual<typeof estate>('@agent-nexus/driftbench-estate');
  vi.mocked(estate.planJourneys).mockImplementation((map, options) => {
    const journeys = actual.planJourneys(map, options);
    return fault ? fault(journeys, map) : journeys;
  });
  return (await planContractFamily().evaluate(seed)).get(ID);
}

/** The route atoms read in the file of a skill or helper (their descriptions), and the others. */
function routes(map: estate.EstateMap) {
  const unitFiles = new Set(
    map.atoms.filter((a) => a.kind === 'skill' || a.kind === 'subagent').map((a) => a.provenance.file),
  );
  const all = map.atoms.filter((a) => a.kind === 'route');
  return {
    described: all.filter((a) => unitFiles.has(a.provenance.file)).map((a) => a.id),
    standing: all.filter((a) => !unitFiles.has(a.provenance.file)).map((a) => a.id),
  };
}

describe(`${ID} follows docs/estate.md section 4`, { timeout: 300_000 }, () => {
  afterEach(() => vi.mocked(estate.planJourneys).mockReset());

  it.each([1, 2, 3])(
    'passes a plan that leaves description routes with no journey, on seed %i',
    async (seed) => {
      let unwalked = 0;
      const result = await withJourneys(seed, (journeys, map) => {
        const described = new Set(routes(map).described);
        unwalked = journeys.uncovered.filter((entry) => described.has(entry.edge.from)).length;
        return journeys;
      });
      // The planted estate holds description routes, and the product reports them as edges with no journey.
      expect(unwalked).toBeGreaterThan(0);
      expect(result).toMatchObject({ pass: true });
    },
  );

  it('fails a plan that drops the journeys of a route the standing instructions state', async () => {
    const result = await withJourneys(1, (journeys, map) => {
      const first = routes(map).standing.find((id) => journeys.journeys.some((j) => j.atomIds[0] === id));
      if (!first) throw new Error('the planted estate has no standing route with a journey');
      return { ...journeys, journeys: journeys.journeys.filter((j) => j.atomIds[0] !== first) };
    });
    expect(result?.pass).toBe(false);
    expect(result?.detail).toContain('route edges in no journey');
  });

  it('fails a plan that starts a journey at a route read only from a description', async () => {
    const result = await withJourneys(1, (journeys, map) => {
      const described = new Set(routes(map).described);
      const edge = journeys.edges.find((each) => each.kind === 'route' && described.has(each.from));
      if (!edge) throw new Error('the planted estate has no description route');
      return { ...journeys, journeys: [...journeys.journeys, { atomIds: [edge.from, edge.to] }] };
    });
    expect(result?.pass).toBe(false);
    expect(result?.detail).toContain('read only from a description start a journey');
  });

  it('fails a plan with no journey at all', async () => {
    const result = await withJourneys(1, (journeys) => ({ ...journeys, journeys: [] }));
    expect(result?.pass).toBe(false);
  });
});
