import { describe, expect, it } from 'vitest';
import { entryNodes, planJourneys, START } from '../../src/index';
import { approvedFixture, edited } from './support';

describe('journeys over the estate graph', () => {
  it('starts at the routes the standing instructions state and at the first stage', async () => {
    const map = await approvedFixture();
    const entries = entryNodes(
      map.atoms,
      map.edges.filter((edge) => ['route', 'reference', 'script', 'dispatch', 'next'].includes(edge.kind)),
    );
    expect(entries.filter((id) => id.startsWith('route.'))).toHaveLength(6);
    expect(entries.every((id) => !id.startsWith('route.') || id.startsWith('route.standing.'))).toBe(true);
    expect(entries.at(-1)).toBe('stage.steps.stage-plan-restate-the-ask-and');
    expect(entries).not.toContain(START);
  });

  it('covers every route, reference, script, dispatch and next edge the standing instructions lead to', async () => {
    const map = await approvedFixture();
    const result = planJourneys(map);
    const walked = new Set(
      result.journeys.flatMap((journey) =>
        journey.atomIds.slice(1).map((to, index) => `${journey.atomIds[index]} ${to}`),
      ),
    );
    const uncovered = new Set(result.uncovered.map(({ edge }) => `${edge.from} ${edge.to}`));
    for (const edge of result.edges) {
      const key = `${edge.from} ${edge.to}`;
      expect(walked.has(key) || uncovered.has(key), key).toBe(true);
    }
    expect(
      result.edges
        .filter((edge) => edge.kind === 'next')
        .every((edge) => walked.has(`${edge.from} ${edge.to}`)),
    ).toBe(true);
    expect(
      walked.has(
        'skill.invoice-reconcile.skill-invoice-reconcile subagent.ledger-auditor.helper-ledger-auditor',
      ),
    ).toBe(true);
    for (const journey of result.journeys) {
      expect(
        journey.atomIds[0]?.startsWith('route.standing.') || journey.atomIds[0]?.startsWith('stage.'),
      ).toBe(true);
    }
  });

  it('lists the routes read from descriptions only as edges no journey takes, with the reason', async () => {
    const result = planJourneys(await approvedFixture());
    expect(result.uncovered).toHaveLength(7);
    for (const { edge, reason } of result.uncovered) {
      expect(edge.kind).toBe('route');
      expect(edge.from.startsWith('route.standing.')).toBe(false);
      expect(reason).toContain('description');
    }
    expect(result.uncovered.map(({ edge }) => edge.to)).toContain(
      'subagent.inbox-triager.helper-inbox-triager',
    );
  });

  it('walks the step list in order, the verify loop back to do included', async () => {
    const result = planJourneys(await approvedFixture());
    const stages = result.journeys.find((journey) => journey.atomIds[0]?.startsWith('stage.'));
    expect(stages?.atomIds.map((id) => id.split('-')[1])).toEqual([
      'plan',
      'do',
      'verify',
      'do',
      'verify',
      'report',
    ]);
  });

  it('leaves out edges of atoms not approved, and gives the same journeys for the same map', async () => {
    const map = await approvedFixture();
    const helper = 'subagent.ledger-auditor.helper-ledger-auditor';
    const unapproved = edited(map, (copy) => {
      const atom = copy.atoms.find((candidate) => candidate.id === helper);
      if (atom) atom.approved = false;
    });
    const result = planJourneys(unapproved);
    expect(result.edges.some((edge) => edge.from === helper || edge.to === helper)).toBe(false);
    expect(result.journeys.some((journey) => journey.atomIds.includes(helper))).toBe(false);
    expect(planJourneys(map)).toEqual(planJourneys(map));
  });

  it('gives no journey for a map with no journey edge', async () => {
    const map = edited(await approvedFixture(), (copy) => {
      copy.edges = copy.edges.filter(
        (edge) => !['route', 'reference', 'script', 'dispatch', 'next'].includes(edge.kind),
      );
    });
    expect(planJourneys(map)).toEqual({ journeys: [], edges: [], uncovered: [] });
  });
});
