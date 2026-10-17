import type { SpaceMap } from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import { type Atom, buildPlan, type EstateMap } from '../../src/index';
import { RELATION_OF, situationSpace, targetsOf } from '../../src/plan/relevance';

type Make = {
  kind: Atom['kind'];
  evidence?: Atom['evidence'];
  fields?: Atom['fields'];
  file?: string;
  line?: number;
  quote?: string;
};
/** A hand-written atom: its words are decoys, only its kind, evidence, fields and passage place it. */
function atom(id: string, make: Make): Atom {
  const line = make.line ?? 1;
  return {
    id,
    kind: make.kind,
    title: make.quote ?? id,
    provenance: {
      file: make.file ?? 'POLICY.md',
      startLine: line,
      endLine: line,
      quote: make.quote ?? id,
      hash: id,
    },
    producedBy: 'code',
    role: 'axis',
    approved: true,
    evidence: make.evidence ?? [],
    enforcement: [],
    ...(make.fields ? { fields: make.fields } : {}),
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
const rowsOf = (map: EstateMap) => buildPlan(map).plan.rows.filter((row) => row.id.startsWith('pairwise.'));
const crossed = (map: EstateMap, dimension: string, value: string) =>
  new Set(
    rowsOf(map)
      .filter((row) => row.cell[dimension] === value)
      .map((row) => row.atomIds[0]),
  );

/**
 * The relation each fixed-axis situation tests, written out here and read from nowhere in the product: a remap in
 * RELATION_OF turns the tests below red. Each line is the documented reason in docs/estate.md, in one word.
 */
const EXPECTED_RELATION: Readonly<Record<string, string>> = {
  dead_helper: 'helper',
  helpers_running: 'helper',
  stale_tracker: 'stage',
  D5_language_switch: 'output',
  language_switch: 'output',
  D8_tool_failure: 'tool',
  D6_instruction_in_data: 'data',
  D4_loose_confirmation: 'confirmation',
  no_questions: 'confirmation',
  rate_wave: 'rate',
  process_restart: 'restart',
  after_restart: 'restart',
  compaction_mid_task: 'compaction',
  after_compaction: 'compaction',
  resumed: 'stoprule',
  stop: 'stop',
  D2_goal_shift: 'routing',
  D1_off_topic: 'routing',
  D9_out_of_scope: 'routing',
  D7_silence_or_burst: 'prompt',
  hold: 'stop',
  keep_going: 'confirmation',
  frustration: 'output',
  limit_word: 'prompt',
  D3_contradiction: 'confirmation',
  D10_return: 'stoprule',
  D11_pii_leak: 'output',
  D12_prompt_extraction: 'output',
};

const DIMENSION_OF: Record<string, string> = Object.fromEntries([
  ...['dead_helper', 'rate_wave', 'stale_tracker', 'process_restart', 'compaction_mid_task'].map((v) => [
    v,
    'estate_hazard',
  ]),
  ...['helpers_running', 'after_restart', 'after_compaction', 'resumed'].map((v) => [v, 'session_state']),
  ...['language_switch', 'no_questions', 'stop', 'hold', 'keep_going', 'frustration', 'limit_word'].map(
    (v) => [v, 'owner_signal'],
  ),
  ...Object.keys(EXPECTED_RELATION)
    .filter((v) => v.startsWith('D'))
    .map((v) => [v, 'deviation']),
]);

/** A harbour estate: every kind of atom a relation reads, each with the typed fact and none with a telling word. */
function harbour(): EstateMap {
  return estate(
    [
      atom('pilot', { kind: 'subagent', fields: { name: 'pilot', tools: ['Read'] } }),
      atom('route-pilot', { kind: 'route' }),
      atom('route-chart', { kind: 'route' }),
      atom('chart', { kind: 'skill', fields: { name: 'chart' } }),
      atom('note', {
        kind: 'stage',
        fields: { id: 'note' },
        evidence: [{ type: 'stage_reached', name: 'note' }],
      }),
      atom('voice', { kind: 'register', evidence: [{ type: 'text', lang: 'FR' }] }),
      atom('spoken', { kind: 'instruction', evidence: [{ type: 'text', must: ['tide'] }] }),
      atom('reader', { kind: 'instruction', evidence: [{ type: 'tool_called', label: 'Read' }] }),
      atom('fetcher', { kind: 'instruction', evidence: [{ type: 'tool_called', label: 'WebFetch' }] }),
      atom('gate', { kind: 'gate', evidence: [{ type: 'ordered', before: 'Read', after: 'Edit' }] }),
      atom('tool-bash', { kind: 'tool', fields: { tool: 'Bash', effect: 'allow' } }),
      atom('tool-read', { kind: 'tool', fields: { tool: 'Read', effect: 'allow' } }),
      atom('script', { kind: 'script' }),
      atom('prompt-guard', { kind: 'guard', fields: { event: 'UserPromptSubmit' } }),
      atom('result-guard', { kind: 'guard', fields: { event: 'PostToolUse' } }),
      atom('stop-rule', { kind: 'instruction', evidence: [{ type: 'tool_not_called', label: 'Edit' }] }),
      atom('hazard-restart', {
        kind: 'hazard',
        line: 7,
        fields: { hazard: 'restart' },
        evidence: [{ type: 'custom', name: 'hazard_recovery', options: { hazard: 'restart' } }],
      }),
      atom('after-restart-rule', {
        kind: 'instruction',
        line: 7,
        evidence: [{ type: 'tool_called', label: 'Glob' }],
      }),
      atom('hazard-compaction', {
        kind: 'hazard',
        line: 9,
        fields: { hazard: 'compaction' },
        evidence: [{ type: 'custom', name: 'hazard_recovery', options: { hazard: 'compaction' } }],
      }),
      atom('after-compaction-gate', {
        kind: 'gate',
        line: 9,
        evidence: [{ type: 'ordered', before: 'Read', after: 'Edit' }],
      }),
      atom('decoy', {
        kind: 'instruction',
        quote: 'After a restart or a compaction, tell the user in French.',
      }),
    ],
    [
      { from: 'route-pilot', to: 'pilot', kind: 'route' },
      { from: 'route-chart', to: 'chart', kind: 'route' },
      { from: 'prompt-guard', to: 'stop-rule', kind: 'enforces' },
    ],
  );
}

describe('review cases', () => {
  const twoLines = () =>
    estate([
      atom('rule', {
        kind: 'instruction',
        file: 'POLICY.md',
        line: 4,
        evidence: [{ type: 'tool_called', label: 'Glob' }],
      }),
      atom('far', {
        kind: 'instruction',
        file: 'POLICY.md',
        line: 9,
        evidence: [{ type: 'tool_called', label: 'Glob' }],
      }),
      atom('other-file', {
        kind: 'instruction',
        file: 'OTHER.md',
        line: 4,
        evidence: [{ type: 'tool_called', label: 'Glob' }],
      }),
      atom('hazard', { kind: 'hazard', file: 'POLICY.md', line: 5, fields: { hazard: 'restart' } }),
    ]);

  it('places a rule written over two lines when its hazard atom sits on either line', () => {
    const map = twoLines();
    const rule = map.atoms.find((candidate) => candidate.id === 'rule') as Atom;
    rule.provenance.endLine = 5;
    expect([...targetsOf('restart', map)]).toEqual(['rule']);
    rule.provenance.startLine = 3;
    rule.provenance.endLine = 4;
    expect([...targetsOf('restart', map)]).toEqual([]);
    // A rule that only neighbours the hazard line, or lies in another file, is not placed.
    rule.provenance.startLine = 4;
    rule.provenance.endLine = 5;
    (map.atoms.find((candidate) => candidate.id === 'hazard') as Atom).provenance.startLine = 6;
    (map.atoms.find((candidate) => candidate.id === 'hazard') as Atom).provenance.endLine = 6;
    expect([...targetsOf('restart', map)]).toEqual([]);
  });

  it('places an instruction checked by any predicate the generator lowers to a reply check on the output relation', () => {
    const custom = (name: string, options?: Record<string, unknown>, id = name) =>
      atom(id, {
        kind: 'instruction',
        evidence: [{ type: 'custom', name, ...(options ? { options } : {}) }],
      });
    const map = estate([
      custom('no_secret_in_reply'),
      custom('max_characters', { max: 800 }),
      custom('json_only'),
      custom('same_language_as_user'),
      custom('asks_for', { value: 'the vessel name' }),
      // Lowered to no reply check, or too thin to lower: not a rule about the reply.
      custom('command_not_run', { contains: 'git push --force' }),
      custom('max_characters', undefined, 'thin'),
      custom('lab_ledger'),
    ]);
    expect([...targetsOf('output', map)].sort()).toEqual(
      ['asks_for', 'json_only', 'max_characters', 'no_secret_in_reply', 'same_language_as_user'].sort(),
    );
    // The leak and extraction deviations cross the secret rule, and without that relation they would cross none.
    for (const value of ['D11_pii_leak', 'D12_prompt_extraction'])
      expect(crossed(map, 'deviation', value).has('no_secret_in_reply'), value).toBe(true);
    expect(crossed(map, 'deviation', 'D11_pii_leak').has('lab_ledger')).toBe(false);
  });

  it('places a read-before gate on instruction-in-data only by the Read it calls, never by its order alone', () => {
    const map = estate([
      atom('ordered-only', { kind: 'gate', evidence: [{ type: 'ordered', before: 'Read', after: 'Edit' }] }),
      atom('reads', {
        kind: 'gate',
        evidence: [
          { type: 'ordered', before: 'Read', after: 'Edit' },
          { type: 'tool_called', label: 'Read', input: { file_path: { contains: 'rules.md' } } },
        ],
      }),
    ]);
    expect([...targetsOf('data', map)]).toEqual(['reads']);
    expect(crossed(map, 'deviation', 'D6_instruction_in_data').has('ordered-only')).toBe(false);
  });

  it('places a reply-language rule checked by the documented language predicate on a language switch', () => {
    const map = estate([
      atom('spoken', { kind: 'instruction', evidence: [{ type: 'custom', name: 'same_language_as_user' }] }),
      atom('other', { kind: 'instruction', evidence: [{ type: 'custom', name: 'lab_ledger' }] }),
    ]);
    expect([...targetsOf('output', map)]).toEqual(['spoken']);
  });

  it('gives every value of the fixed axes a relation, and crosses none with every atom', () => {
    const map = harbour();
    const count = map.atoms.length;
    const plan = buildPlan(map).plan.rows.filter((row) => row.id.startsWith('pairwise.'));
    for (const [dimension, value] of [
      ['owner_signal', 'hold'],
      ['owner_signal', 'keep_going'],
      ['owner_signal', 'frustration'],
      ['owner_signal', 'limit_word'],
      ['deviation', 'D3_contradiction'],
      ['deviation', 'D10_return'],
      ['deviation', 'D11_pii_leak'],
      ['deviation', 'D12_prompt_extraction'],
    ] as const) {
      expect(RELATION_OF[value], value).toBe(EXPECTED_RELATION[value]);
      const seen = new Set(plan.filter((row) => row.cell[dimension] === value).map((row) => row.atomIds[0]));
      expect(seen.size, value).toBeGreaterThan(0);
      expect(seen.size, value).toBeLessThan(count);
    }
  });
});

describe('situation relevance reads the typed facts of the map', () => {
  it.each([
    ['helper', ['pilot', 'route-pilot']],
    ['tool', ['pilot', 'route-pilot', 'tool-bash', 'tool-read', 'script', 'prompt-guard', 'result-guard']],
    ['stage', ['note']],
    ['output', ['voice', 'spoken']],
    ['data', ['reader', 'fetcher', 'after-restart-rule', 'result-guard']],
    ['confirmation', ['gate', 'after-compaction-gate']],
    ['rate', ['tool-bash', 'script', 'pilot', 'fetcher']],
    ['restart', ['after-restart-rule']],
    ['compaction', ['after-compaction-gate']],
    ['stoprule', ['stop-rule']],
    ['stop', ['stop-rule', 'prompt-guard']],
    ['prompt', ['prompt-guard']],
    ['routing', ['route-pilot', 'route-chart', 'chart']],
  ] as const)('the relation %s holds for exactly its typed atoms', (relation, ids) => {
    expect([...targetsOf(relation, harbour())].sort()).toEqual([...ids].sort());
  });

  it('maps every fixed-axis situation to the relation written out above, and to no other', () => {
    expect({ ...RELATION_OF }).toEqual(EXPECTED_RELATION);
  });

  it('crosses each fixed-axis situation with the atoms of its relation and with no other atom', () => {
    const map = harbour();
    for (const [value, relation] of Object.entries(EXPECTED_RELATION)) {
      const dimension = DIMENSION_OF[value] as string;
      const allowed = targetsOf(relation as Parameters<typeof targetsOf>[0], map);
      const seen = crossed(map, dimension, value);
      expect(
        [...seen].filter((id) => !allowed.has(id as string)),
        value,
      ).toEqual([]);
      expect(seen.size, value).toBeGreaterThan(0);
    }
  });

  it('does not read words: a rule that talks of a restart is not crossed with it unless its passage names the hazard', () => {
    const map = harbour();
    expect(crossed(map, 'estate_hazard', 'process_restart')).toEqual(new Set(['after-restart-rule']));
    expect(crossed(map, 'deviation', 'D5_language_switch').has('decoy')).toBe(false);
  });

  it('crosses a situation with no atom that holds its relation with nothing, and says so', () => {
    const map = estate([atom('seal', { kind: 'instruction', evidence: [{ type: 'custom', name: 'seal' }] })]);
    const rows = rowsOf(map);
    for (const value of ['process_restart', 'dead_helper', 'stale_tracker'])
      expect(
        rows.some((row) => row.cell.estate_hazard === value),
        value,
      ).toBe(false);
    expect(rows.some((row) => row.cell.deviation === 'D7_silence_or_burst')).toBe(false);
    const notes = buildPlan(map).details.notes.join('\n');
    expect(notes).toContain(
      'estate_hazard=process_restart: no atom of the estate holds the relation "restart"',
    );
    expect(buildPlan(map).details.tuples.covered).toBe(buildPlan(map).details.tuples.allowed);
  });

  it('keeps every combination of a value that names no relation, and leaves a supplied space authoritative', () => {
    const map = harbour();
    const unknown: SpaceMap = {
      version: 'lab',
      agent: 'lab',
      dimensions: [
        {
          id: 'deviation',
          kind: 'deviation',
          title: 'Deviation',
          values: [
            { id: 'none', title: 'None' },
            { id: 'X1_tide_surge', title: 'A tide surge' },
          ],
        },
        {
          id: 'atoms.instruction',
          kind: 'behaviour',
          title: 'Rules',
          values: [{ id: 'reader', title: 'Read' }],
        },
      ],
      constraints: [],
      prior: { kind: 'declared' },
    };
    // A value the planner has no relation for is the owner's own: nothing is excluded.
    expect(situationSpace(map, unknown).space.constraints).toEqual([]);
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
          values: [{ id: 'reader', title: 'Measure' }],
        },
      ],
      constraints: [],
      prior: { kind: 'declared' },
    };
    const own = buildPlan(map, { space });
    expect(own.details.relevanceConstraints ?? []).toEqual([]);
    expect(situationSpace(map, space).space.constraints).toEqual([]);
  });
});
