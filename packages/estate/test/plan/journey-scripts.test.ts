import { someCall } from '@agent-nexus/driftbench-checks';
import { type CheckContext, parseSpecText } from '@agent-nexus/driftbench-core';
import { generateEstateSuite } from '@agent-nexus/driftbench-generate';
import { describe, expect, it } from 'vitest';
import { type Atom, type EstateMap, mapHash, planJourneys } from '../../src/index';

function atom(id: string, kind: Atom['kind'], file: string): Atom {
  return {
    id,
    kind,
    title: id,
    approved: true,
    producedBy: 'code',
    role: 'axis',
    enforcement: [],
    provenance: { file, startLine: 1, endLine: 1, quote: id, hash: id },
    evidence: [{ type: 'tool_called', label: kind === 'script' ? 'Bash' : 'Read' }],
  };
}

const route = atom('route.standing.export', 'route', 'CLAUDE.md');
const skill = atom('skill.archive.export', 'skill', '.claude/skills/archive/SKILL.md');
const script = atom('script.archive.pack', 'script', '.claude/skills/archive/SKILL.md');
const unrelated = atom('script.other.clean', 'script', '.claude/skills/other/SKILL.md');
const atoms = [route, skill, script, unrelated];
const edges: EstateMap['edges'] = [
  { from: route.id, to: skill.id, kind: 'route' },
  { from: skill.id, to: script.id, kind: 'script' },
];
script.evidence = [
  { type: 'tool_called', label: 'Bash', input: { command: { contains: 'scripts/pack.py' } } },
];
const map = { atoms, edges, hash: mapHash(atoms, edges), runtime: 'claude-code' } as EstateMap;

describe('script calls in estate journeys', () => {
  it('walks from the standing route through the skill to the script it requires', () => {
    const result = planJourneys(map);
    expect(result.edges).toContainEqual(edges[1]);
    expect(
      result.journeys.some(
        ({ atomIds }) =>
          atomIds.join('/') ===
          atoms
            .slice(0, 3)
            .map((a) => a.id)
            .join('/'),
      ),
    ).toBe(true);
    expect(result.journeys.some(({ atomIds }) => atomIds.includes(unrelated.id))).toBe(false);
    expect(result.uncovered).toEqual([]);
  });

  it('does not walk a script whose approval is withdrawn', () => {
    const copy = structuredClone(map);
    const copiedScript = copy.atoms.find((atom) => atom.id === script.id);
    if (!copiedScript) throw new Error('The copied script is missing');
    copiedScript.approved = false;
    expect(planJourneys(copy).edges.some((edge) => edge.kind === 'script')).toBe(false);
  });
});

describe('a generated journey catches a faulty script caller', () => {
  it('rejects a missing or substituted script even when the skill loaded and other commands ran', async () => {
    const journey = planJourneys(map).journeys.find((j) => j.atomIds.includes(script.id));
    expect(journey).toBeDefined();
    if (!journey) throw new Error('No journey reaches the required script');
    const result = generateEstateSuite(
      {
        map,
        plan: {
          mapHash: map.hash,
          rows: [
            {
              id: 'archive',
              atomIds: journey.atomIds,
              testType: 'journey',
              mode: 'live',
              status: 'approved',
              cell: {},
            },
          ],
        },
        bank: {
          version: 1,
          estate: 'archive',
          mapHash: map.hash,
          workspaces: [],
          deviations: [],
          situations: [
            {
              id: 'export',
              title: 'Export an archive',
              use: 'trigger',
              atoms: journey.atomIds,
              touches: { created: [], changed: [], deleted: [] },
              phrases: [{ text: 'Export the archive.', lang: 'en', approved: true }],
            },
          ],
        },
      },
      { paths: { map: 'map.yaml', plan: 'plan.yaml', phrases: 'phrases.yaml' } },
    );
    const file = result.files.find((f) => f.path.endsWith('.yaml'));
    if (!file) throw new Error('No generated spec');
    expect(result.specs[0]?.complete).toBe(true);
    const loaded = parseSpecText(file.text, 'yaml', file.path);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
    const options = loaded.spec.rules?.custom?.some_call;
    expect(options).toBeDefined();
    const verdict = async (commands: string[]) => {
      const result = await someCall(
        {
          blockIndex: 0,
          observed: {
            toolCalls: [
              { id: 'load', label: 'Skill', input: { skill: 'archive' } },
              ...commands.map((command, index) => ({ id: `cmd${index}`, label: 'Bash', input: { command } })),
            ],
          },
        } as CheckContext,
        options,
      );
      return Array.isArray(result) ? result : [result];
    };
    expect((await verdict(['python scripts/pack.py']))[0]?.outcome).toBe('pass');
    expect((await verdict([]))[0]?.outcome).toBe('fail');
    expect((await verdict(['python scripts/other.py']))[0]?.outcome).toBe('fail');
  });
});
