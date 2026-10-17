import type { SpaceMap } from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import { type Atom, buildPlan, type EstateMap } from '../../src/index';
import { situationSpace } from '../../src/plan/relevance';

function atom(
  id: string,
  kind: Atom['kind'],
  quote: string,
  evidence: Atom['evidence'],
  fields?: Atom['fields'],
): Atom {
  return {
    id,
    kind,
    title: quote,
    provenance: { file: 'POLICY.md', startLine: 1, endLine: 1, quote, hash: id },
    producedBy: 'code',
    role: 'axis',
    approved: true,
    evidence,
    enforcement: [],
    ...(fields ? { fields } : {}),
  };
}
function estate(atoms: Atom[], edges: EstateMap['edges'] = []): EstateMap {
  return {
    version: 1,
    runtime: 'fictional',
    root: '.',
    readAt: '2026-01-01T00:00:00Z',
    hash: 'handwritten',
    atoms,
    edges,
  };
}
const samples = () =>
  estate([
    atom('a', 'instruction', 'Run the spectrometer and save its reading.', [
      { type: 'tool_called', label: 'Measure' },
    ]),
    atom('b', 'instruction', 'Answer in the language of the customer.', [{ type: 'text', lang: 'FR' }]),
    atom('c', 'instruction', 'Dispatch the mineral analyst with the specimen number.', [
      { type: 'tool_called', label: 'Agent' },
    ]),
    atom('d', 'stage', 'Update the tracker with the specimen result.', [
      { type: 'stage_reached', name: 'record' },
    ]),
    atom('e', 'instruction', 'After a restart, read the laboratory notebook.', [
      { type: 'tool_called', label: 'Read' },
    ]),
  ]);
const cells = (map: EstateMap) => buildPlan(map).plan.rows.filter((row) => row.id.startsWith('pairwise.'));

describe('situation relevance follows the estate contract', () => {
  it('does not cross a language event with a measurement-only instruction', () => {
    const rows = cells(samples());
    expect(rows.some((row) => row.atomIds[0] === 'a' && row.cell.deviation === 'D5_language_switch')).toBe(
      false,
    );
    expect(rows.some((row) => row.atomIds[0] === 'b' && row.cell.deviation === 'D5_language_switch')).toBe(
      true,
    );
  });

  it('keeps a tool failure and a failed helper relevant to instructions that call them', () => {
    const rows = cells(samples());
    expect(rows.some((row) => row.atomIds[0] === 'a' && row.cell.deviation === 'D8_tool_failure')).toBe(true);
    expect(rows.some((row) => row.atomIds[0] === 'c' && row.cell.estate_hazard === 'dead_helper')).toBe(true);
    expect(rows.some((row) => row.atomIds[0] === 'b' && row.cell.estate_hazard === 'dead_helper')).toBe(
      false,
    );
  });

  it('uses tracker and restart instructions regardless of their kind or opaque id', () => {
    const map = samples();
    map.atoms.push(
      atom('f', 'instruction', 'Reconcile the tracker before continuing.', [
        { type: 'custom', name: 'lab_ledger' },
      ]),
    );
    const rows = cells(map);
    for (const id of ['d', 'f']) {
      expect(rows.some((row) => row.atomIds[0] === id && row.cell.estate_hazard === 'stale_tracker')).toBe(
        true,
      );
    }
    expect(rows.some((row) => row.atomIds[0] === 'e' && row.cell.estate_hazard === 'process_restart')).toBe(
      true,
    );
    expect(rows.some((row) => row.atomIds[0] === 'b' && row.cell.estate_hazard === 'process_restart')).toBe(
      false,
    );
  });

  it('does not use ids or file paths as behavioural text', () => {
    const map = samples();
    map.atoms.push(
      atom('restart.helper.language', 'instruction', 'Keep the calibration seal intact.', [
        { type: 'custom', name: 'seal' },
      ]),
    );
    const sealed = map.atoms.find((candidate) => candidate.id === 'restart.helper.language');
    if (!sealed) throw new Error('missing hand-written seal rule');
    sealed.provenance.file = 'language/helpers/restart.md';
    const rows = cells(map);
    expect(
      rows.some(
        (row) =>
          row.atomIds[0] === 'restart.helper.language' &&
          (row.cell.estate_hazard === 'dead_helper' || row.cell.estate_hazard === 'process_restart'),
      ),
    ).toBe(false);
  });

  it('uses the called unit contract for routing relevance, without importing unrelated neighbours', () => {
    const map = samples();
    map.atoms.push(atom('unit', 'subagent', 'Mineral analyst', [{ type: 'tool_called', label: 'Agent' }]));
    map.atoms.push(
      atom('route', 'route', 'Send specimens for mineral analysis.', [
        { type: 'custom', name: 'choose_analyst' },
      ]),
    );
    map.edges.push({ from: 'route', to: 'unit', kind: 'route' });
    const rows = cells(map);
    expect(rows.some((row) => row.atomIds[0] === 'route' && row.cell.estate_hazard === 'dead_helper')).toBe(
      true,
    );
    expect(
      rows.some((row) => row.atomIds[0] === 'route' && row.cell.deviation === 'D5_language_switch'),
    ).toBe(false);
  });

  it('propagates a called unit through dispatch chains and cycles without importing its callers', () => {
    const map = samples();
    map.atoms.push(
      atom('middle', 'skill', 'Unused identifier', [{ type: 'skill_loaded', name: 'middle' }], {
        description: 'Analyze the specimen.',
      }),
    );
    map.atoms.push(atom('entry', 'route', 'Choose an analysis.', [{ type: 'custom', name: 'analysis' }]));
    map.atoms.push(
      atom('analyst', 'subagent', 'Unused identifier', [{ type: 'tool_called', label: 'Agent' }]),
    );
    map.edges.push(
      { from: 'entry', to: 'middle', kind: 'route' },
      { from: 'middle', to: 'analyst', kind: 'dispatch' },
      { from: 'analyst', to: 'middle', kind: 'dispatch' },
    );
    const rows = cells(map);
    expect(rows.some((row) => row.atomIds[0] === 'entry' && row.cell.estate_hazard === 'dead_helper')).toBe(
      true,
    );
    expect(
      rows.some((row) => row.atomIds[0] === 'analyst' && row.cell.deviation === 'D5_language_switch'),
    ).toBe(false);
  });

  it('retains situations with unresolved relevance instead of reporting vacuous coverage', () => {
    const map = estate([
      atom('seal', 'instruction', 'Keep the calibration seal intact.', [{ type: 'custom', name: 'seal' }]),
    ]);
    expect(cells(map).some((row) => row.cell.estate_hazard === 'process_restart')).toBe(true);
    expect(
      buildPlan(map).details.notes.some(
        (note) => note.includes('no relevant target') && note.includes('retained'),
      ),
    ).toBe(true);
  });

  it('recognizes an estate-specific subject with opaque situation ids and no built-in kind policy', () => {
    const map = estate([
      atom('reactor', 'instruction', 'If the catalyst expires, reject the sample.', [
        { type: 'custom', name: 'lab_rule' },
      ]),
      atom('voice', 'register', 'Keep replies concise.', [{ type: 'text', mustNot: ['verbose'] }]),
    ]);
    const space: SpaceMap = {
      version: 'chemistry',
      agent: 'lab',
      dimensions: [
        {
          id: 'owner_signal',
          kind: 'persona',
          title: 'Condition',
          values: [
            { id: 'nominal', title: 'Routine operation' },
            { id: 'cx17', title: 'A catalyst expires' },
          ],
        },
        {
          id: 'atoms.instruction',
          kind: 'behaviour',
          title: 'Reaction',
          values: [{ id: 'reactor', title: 'Reaction' }],
        },
        {
          id: 'atoms.register',
          kind: 'behaviour',
          title: 'Voice',
          values: [{ id: 'voice', title: 'Voice' }],
        },
      ],
      constraints: [],
      prior: { kind: 'declared' },
    };
    const fitted = situationSpace(map, space);
    const result = buildPlan(map, { space: fitted.space });
    expect(
      result.plan.rows.some(
        (row) =>
          row.id.startsWith('pairwise.') && row.atomIds[0] === 'reactor' && row.cell.owner_signal === 'cx17',
      ),
    ).toBe(true);
    expect(
      result.plan.rows.some(
        (row) =>
          row.id.startsWith('pairwise.') && row.atomIds[0] === 'voice' && row.cell.owner_signal === 'cx17',
      ),
    ).toBe(false);
    expect(result.details.tuples.covered).toBe(result.details.tuples.allowed);
    expect(fitted.space.constraints).toHaveLength(1);
  });

  it('leaves an explicit user space authoritative and covers its declared tuples', () => {
    const map = samples();
    const space: SpaceMap = {
      version: 'lab',
      agent: 'lab',
      dimensions: [
        {
          id: 'specimen',
          kind: 'data',
          title: 'Specimen',
          values: [
            { id: 'wet', title: 'Wet' },
            { id: 'dry', title: 'Dry' },
          ],
        },
        {
          id: 'atoms.instruction',
          kind: 'behaviour',
          title: 'Rules',
          values: [{ id: 'a', title: 'Measure' }],
        },
      ],
      constraints: [],
      prior: { kind: 'declared' },
    };
    const result = buildPlan(map, { space });
    expect(result.details.tuples).toEqual({ allowed: 2, covered: 2 });
  });
});
