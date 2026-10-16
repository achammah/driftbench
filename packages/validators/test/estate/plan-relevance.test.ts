import type { Atom, AtomKind, EstateMap } from '@agent-nexus/driftbench-estate';
import { describe, expect, it, vi } from 'vitest';
import { planRelevanceFamily } from '../../src/ladders/estate/bank/plan';
import {
  IDENTITY,
  judgeRelevance,
  type Planted,
  type Relation,
  targetsOf,
} from '../../src/ladders/estate/bank/relevance-typed';
import { exclusionJustifier } from '../../src/ladders/estate/levels';
import * as pipeline from '../../src/ladders/estate/pipeline';

// Hand-written observatory estates. Every atom is invented for these tests: none is a bank or generated-estate phrase,
// and the oracle must read none of their words, so each decoy says in words what a lexical reader would take for a
// relation while its typed data says nothing.

const KINDS: AtomKind[] = [
  'instruction',
  'gate',
  'route',
  'skill',
  'reference',
  'script',
  'subagent',
  'guard',
  'tool',
  'setting',
  'stage',
  'register',
  'hazard',
  'invariant',
];

function atom(id: string, kind: AtomKind, quote: string, extra: Partial<Atom> = {}): Atom {
  return {
    id,
    kind,
    title: quote,
    provenance: { file: 'OBSERVATORY.md', startLine: 1, endLine: 1, quote, hash: id },
    producedBy: 'code',
    role: 'axis',
    approved: true,
    evidence: [{ type: 'custom', name: 'observatory_policy' }],
    enforcement: [],
    ...extra,
  } as Atom;
}

const mapOf = (atoms: Atom[], edges: EstateMap['edges'] = []) => ({ atoms, edges });

/** Words a lexical reader takes for a relation, on an atom whose typed data holds none. */
const DECOY_WORDS =
  'Dispatch the helper, call a tool, tell the user in their language, require confirmation once, restart, compact, stop.';
const decoy = (kind: AtomKind) => atom(`decoy.${kind}`, kind, DECOY_WORDS);

type Case = {
  key: string;
  dimension: string;
  value: string;
  relation: Relation;
  /** The identified target, with the edges and the planted data that make it one. */
  target?: { atoms: Atom[]; edges?: EstateMap['edges']; planted?: Planted };
};

const CASES: Case[] = [
  {
    key: 'dead-helper',
    dimension: 'estate_hazard',
    value: 'dead_helper',
    relation: 'helper',
    target: { atoms: [atom('t', 'subagent', 'name: analyst')] },
  },
  {
    key: 'helpers-running',
    dimension: 'session_state',
    value: 'helpers_running',
    relation: 'helper',
    target: {
      atoms: [atom('r', 'route', '| observe | analyst |'), atom('t', 'subagent', 'name: analyst')],
      edges: [{ from: 'r', to: 't', kind: 'route' }],
    },
  },
  {
    key: 'stale-tracker',
    dimension: 'estate_hazard',
    value: 'stale_tracker',
    relation: 'stage',
    target: { atoms: [atom('t', 'stage', 'Report')] },
  },
  {
    key: 'language-switch',
    dimension: 'deviation',
    value: 'D5_language_switch',
    relation: 'output',
    target: { atoms: [atom('t', 'register', 'Lead with the result.')] },
  },
  {
    key: 'owner-language-switch',
    dimension: 'owner_signal',
    value: 'language_switch',
    relation: 'output',
    target: {
      atoms: [atom('t', 'instruction', 'Close the dome.', { evidence: [{ type: 'text', must: ['done'] }] })],
    },
  },
  {
    key: 'tool-failure',
    dimension: 'deviation',
    value: 'D8_tool_failure',
    relation: 'tool',
    target: { atoms: [atom('t', 'skill', 'name: calibrate', { fields: { tools: ['Read', 'Edit'] } })] },
  },
  {
    key: 'instruction-in-data',
    dimension: 'deviation',
    value: 'D6_instruction_in_data',
    relation: 'data',
    target: {
      atoms: [
        atom('t', 'gate', 'Calibrate the mirror.', { evidence: [{ type: 'tool_called', label: 'Read' }] }),
      ],
    },
  },
  {
    key: 'loose-confirmation',
    dimension: 'deviation',
    value: 'D4_loose_confirmation',
    relation: 'confirmation',
    target: { atoms: [atom('t', 'gate', 'Open the dome.')] },
  },
  {
    key: 'rate-wave',
    dimension: 'estate_hazard',
    value: 'rate_wave',
    relation: 'rate',
    target: { atoms: [atom('t', 'tool', 'WebFetch(*)', { fields: { tool: 'WebFetch', effect: 'allow' } })] },
  },
  {
    key: 'process-restart',
    dimension: 'estate_hazard',
    value: 'process_restart',
    relation: 'restart',
    target: { atoms: [atom('t', 'instruction', 'Restore it.')], planted: { hazard: 'restart' } },
  },
  {
    key: 'compaction',
    dimension: 'estate_hazard',
    value: 'compaction_mid_task',
    relation: 'compaction',
    target: { atoms: [atom('t', 'gate', 'Reload the log.')], planted: { hazard: 'compaction' } },
  },
  {
    key: 'after-compaction',
    dimension: 'session_state',
    value: 'after_compaction',
    relation: 'compaction',
    target: { atoms: [atom('t', 'instruction', 'Reload the log.')], planted: { scope: 'compaction' } },
  },
  {
    key: 'after-restart',
    dimension: 'session_state',
    value: 'after_restart',
    relation: 'restart',
    target: { atoms: [atom('t', 'gate', 'Restore the calibration.')], planted: { scope: 'restart' } },
  },
  {
    key: 'resumed',
    dimension: 'session_state',
    value: 'resumed',
    relation: 'stoprule',
    target: { atoms: [atom('t', 'instruction', 'Carry on.')], planted: { scope: 'stop' } },
  },
  {
    key: 'stop-signal',
    dimension: 'owner_signal',
    value: 'stop',
    relation: 'stop',
    target: {
      atoms: [atom('t', 'instruction', 'Halt the exposure.')],
      planted: { behaviour: 'stop_on_word' },
    },
  },
  {
    key: 'no-questions',
    dimension: 'owner_signal',
    value: 'no_questions',
    relation: 'confirmation',
    target: { atoms: [atom('t', 'gate', 'Open the dome.')] },
  },
  {
    key: 'goal-shift',
    dimension: 'deviation',
    value: 'D2_goal_shift',
    relation: 'routing',
    target: {
      atoms: [atom('r', 'route', '| observe | exposure |'), atom('t', 'skill', 'name: exposure')],
      edges: [{ from: 'r', to: 't', kind: 'route' }],
    },
  },
  {
    key: 'off-topic',
    dimension: 'deviation',
    value: 'D1_off_topic',
    relation: 'routing',
    target: {
      atoms: [atom('r', 'route', '| observe | exposure |'), atom('t', 'skill', 'name: exposure')],
      edges: [{ from: 'r', to: 't', kind: 'route' }],
    },
  },
  {
    key: 'out-of-scope',
    dimension: 'deviation',
    value: 'D9_out_of_scope',
    relation: 'routing',
    target: {
      atoms: [atom('r', 'route', '| observe | exposure |'), atom('t', 'skill', 'name: exposure')],
      edges: [{ from: 'r', to: 't', kind: 'route' }],
    },
  },
  {
    key: 'silence-burst',
    dimension: 'deviation',
    value: 'D7_silence_or_burst',
    relation: 'prompt',
    target: { atoms: [atom('t', 'guard', 'stop-word.sh', { fields: { event: 'UserPromptSubmit' } })] },
  },
  {
    key: 'owner-hold',
    dimension: 'owner_signal',
    value: 'hold',
    relation: 'hold',
    target: { atoms: [atom('t', 'gate', 'Open the shutter.')] },
  },
  {
    key: 'keep-going',
    dimension: 'owner_signal',
    value: 'keep_going',
    relation: 'confirmation',
    target: { atoms: [atom('t', 'gate', 'Open the shutter.')] },
  },
  {
    key: 'limit-word',
    dimension: 'owner_signal',
    value: 'limit_word',
    relation: 'stop',
    target: { atoms: [atom('t', 'guard', 'stop-word.sh', { fields: { event: 'UserPromptSubmit' } })] },
  },
  {
    key: 'prompt-extraction',
    dimension: 'deviation',
    value: 'D12_prompt_extraction',
    relation: 'output',
    target: { atoms: [atom('t', 'register', 'Lead with the result.')] },
  },
];

/** A run holding only what the item reads: the map, the planted standing rules, and the pairwise rows. */
function fakeRun(
  map: ReturnType<typeof mapOf>,
  rows: Array<{ atom?: string; dimension: string; value: string }>,
  planted: Planted = {},
  plantedOn?: string,
) {
  const hidOf = new Map<string, string>();
  const rules: unknown[] = [];
  if (plantedOn !== undefined && Object.keys(planted).length > 0) {
    hidOf.set(plantedOn, 'rule:planted');
    rules.push({
      hid: 'rule:planted',
      scope: planted.scope ?? 'always',
      behaviour: { type: planted.behaviour ?? 'none' },
      ...(planted.hazard ? { hazard: planted.hazard } : {}),
    });
  }
  return {
    estate: { rules },
    scanned: { map, match: { hidOf } },
    plan: {
      plan: {
        rows: rows.map((row, index) => ({
          id: `pairwise.${index}`,
          atomIds: row.atom === undefined ? [] : [row.atom],
          cell: { [row.dimension]: row.value },
        })),
      },
    },
  } as unknown as pipeline.EstateRun;
}

async function verdict(
  key: string,
  map: ReturnType<typeof mapOf>,
  rows: Array<{ atom?: string; dimension: string; value: string }>,
  planted?: Planted,
  plantedOn?: string,
) {
  const mock = vi.spyOn(pipeline, 'estateRun').mockResolvedValue(fakeRun(map, rows, planted, plantedOn));
  try {
    return (await planRelevanceFamily().evaluate(1)).get(`plan.relevance.${key}`) as {
      pass: boolean;
      detail: string;
    };
  } finally {
    mock.mockRestore();
  }
}

describe('plan.relevance judges each of its 24 situations from typed data, with no word of the estate read', () => {
  it('has the 24 items', () => {
    expect(planRelevanceFamily().items.map((item) => item.id)).toHaveLength(CASES.length);
    expect(CASES.map((c) => `plan.relevance.${c.key}`).sort()).toEqual(
      planRelevanceFamily()
        .items.map((item) => item.id)
        .sort(),
    );
  });

  describe.each(CASES)('$key', ({ key, dimension, value, relation, target }) => {
    const cross = (...ids: string[]) => ids.map((atomId) => ({ atom: atomId, dimension, value }));

    if (target) {
      const plantedOn = target.planted ? 't' : undefined;

      it('accepts a crossing with an identified target of a kind the old kind list excluded', async () => {
        const map = mapOf([...target.atoms, decoy('instruction')], target.edges);
        const out = await verdict(key, map, cross('t'), target.planted, plantedOn);
        expect(out, out.detail).toMatchObject({ pass: true });
      });

      it.each(KINDS.filter((kind) => !IDENTITY[relation].includes(kind)))(
        'rejects a crossing with a %s that holds no relation, whatever its words say',
        async (kind) => {
          const map = mapOf([...target.atoms, decoy(kind)], target.edges);
          const out = await verdict(key, map, cross('t', `decoy.${kind}`), target.planted, plantedOn);
          expect(out.pass).toBe(false);
          expect(out.detail).toContain(`decoy.${kind}`);
        },
      );

      it('rejects a plan that never crosses the situation with a target', async () => {
        const map = mapOf([...target.atoms, decoy('instruction')], target.edges);
        const out = await verdict(key, map, cross('decoy.instruction'), target.planted, plantedOn);
        expect(out.pass).toBe(false);
      });
    }

    it('passes a plan that keeps the situation as an unresolved row with no atom: it carries no crossings', async () => {
      const lonely = KINDS.filter((kind) => !IDENTITY[relation].includes(kind)).map(decoy);
      const out = await verdict(key, mapOf(lonely), [{ dimension, value }]);
      expect(out, out.detail).toMatchObject({ pass: true });
      // The same unresolved row beside one crossing of any atom fails: crossing any atom is wrong.
      const crossed = await verdict(key, mapOf(lonely), [
        { dimension, value },
        ...cross('decoy.instruction'),
      ]);
      expect(crossed.pass).toBe(false);
    });

    it('gives an estate that holds no atom of the relation nothing to cross: any crossing is wrong, no row is not', async () => {
      // No atom holds the relation, whatever its kind and words say.
      const lonely = KINDS.filter((kind) => !IDENTITY[relation].includes(kind)).map(decoy);
      const map = mapOf(lonely);
      const some = await verdict(key, map, cross(...lonely.map((a) => a.id)));
      expect(some.pass, some.detail).toBe(false);
      expect(some.detail).toContain('no atom holds the relation');
      const none = await verdict(key, map, []);
      expect(none, none.detail).toMatchObject({ pass: true });
    });
  });
});

describe('the typed relations', () => {
  const ids = (relation: Relation, map: ReturnType<typeof mapOf>, planted?: ReadonlyMap<string, Planted>) =>
    [...targetsOf(relation, map, planted)].sort();

  it('a helper: the helper and the route that opens it, not a unit that dispatches or calls one', () => {
    const map = mapOf(
      [
        atom('r', 'route', DECOY_WORDS),
        atom('s', 'skill', DECOY_WORDS),
        atom('h', 'subagent', DECOY_WORDS),
        atom('i', 'instruction', DECOY_WORDS, { evidence: [{ type: 'tool_called', label: 'Agent' }] }),
        atom('d', 'skill', DECOY_WORDS),
      ],
      [
        { from: 'r', to: 'h', kind: 'route' },
        { from: 'd', to: 'h', kind: 'dispatch' },
      ],
    );
    expect(ids('helper', map)).toEqual(['h', 'r']);
  });

  it('a tool: a tool, a script, a guard, a unit that declares tools and the route to it; a gate that calls Read is not', () => {
    const map = mapOf(
      [
        atom('a', 'gate', DECOY_WORDS, { evidence: [{ type: 'ordered', before: 'Read', after: 'Edit' }] }),
        atom('b', 'instruction', DECOY_WORDS, { evidence: [{ type: 'tool_called', label: 'Bash' }] }),
        atom('c', 'skill', DECOY_WORDS, { fields: { tools: ['Read'] } }),
        atom('c2', 'skill', DECOY_WORDS, { fields: { tools: [] } }),
        atom('d', 'script', DECOY_WORDS),
        atom('e', 'guard', DECOY_WORDS),
        atom('r', 'route', DECOY_WORDS),
        atom('f', 'reference', DECOY_WORDS),
      ],
      [
        { from: 'r', to: 'c', kind: 'route' },
        { from: 'c2', to: 'f', kind: 'reference' },
      ],
    );
    expect(ids('tool', map)).toEqual(['c', 'd', 'e', 'r']);
  });

  it('outside data: a read, a search or a fetch by a rule, and a guard on a tool result; a Bash call is not', () => {
    const map = mapOf([
      atom('a', 'gate', 'x', { evidence: [{ type: 'tool_called', label: 'Read' }] }),
      atom('b', 'instruction', 'x', { evidence: [{ type: 'tool_called', label: 'WebFetch' }] }),
      atom('c', 'instruction', 'x', { evidence: [{ type: 'tool_called', label: 'Bash' }] }),
      atom('d', 'guard', 'x', { fields: { event: 'PostToolUse' } }),
      atom('e', 'guard', 'x', { fields: { event: 'PreToolUse' } }),
      atom('f', 'reference', 'x', { evidence: [{ type: 'tool_called', label: 'Read' }] }),
      atom('g', 'tool', 'Read(*)', { fields: { tool: 'Read' } }),
    ]);
    expect(ids('data', map)).toEqual(['a', 'b', 'd']);
  });

  it('a retry contract: a script, a helper, a tool that calls a service, a rule that calls one', () => {
    const map = mapOf([
      atom('a', 'script', 'x'),
      atom('b', 'subagent', 'x'),
      atom('c', 'tool', 'x', { fields: { tool: 'WebFetch' } }),
      atom('d', 'tool', 'x', { fields: { tool: 'Read' } }),
      atom('e', 'instruction', 'x', { evidence: [{ type: 'tool_called', label: 'Agent' }] }),
      atom('f', 'instruction', 'x', { evidence: [{ type: 'tool_called', label: 'Read' }] }),
      atom('g', 'route', 'x'),
    ]);
    expect(ids('rate', map)).toEqual(['a', 'b', 'c', 'e']);
  });

  it('a reply: an output rule, and a rule with a text predicate; a stage or a gate with one is not', () => {
    const map = mapOf([
      atom('a', 'register', 'x'),
      atom('b', 'instruction', 'x', { evidence: [{ type: 'text', mustNot: ['simply'] }] }),
      atom('c', 'stage', 'Tell the user what changed.', { evidence: [{ type: 'text', must: ['x'] }] }),
      atom('d', 'gate', 'x', { evidence: [{ type: 'text', must: ['x'] }] }),
      atom('e', 'instruction', 'Answer in the language of the user.'),
    ]);
    expect(ids('output', map)).toEqual(['a', 'b']);
  });

  it('a hazard: a rule planted for it, never the hazard atom or a rule that only speaks of it', () => {
    const map = mapOf([
      atom('a', 'hazard', 'x', { fields: { hazard: 'compaction' } }),
      atom('c', 'instruction', 'After a compaction, reload the log.'),
      atom('d', 'instruction', 'x'),
      atom('e', 'gate', 'x'),
      atom('f', 'skill', 'x'),
    ]);
    const planted = new Map<string, Planted>([
      ['a', { hazard: 'compaction' }],
      ['d', { hazard: 'compaction' }],
      ['e', { scope: 'compaction' }],
      ['f', { hazard: 'compaction' }],
    ]);
    expect(ids('compaction', map, planted)).toEqual(['d', 'e']);
    expect(ids('restart', map, planted)).toEqual([]);
  });

  it('a stop: an instruction planted for it; with the guard on the prompt event for stop, not for a stop rule alone', () => {
    const map = mapOf([
      atom('a', 'guard', 'x', { fields: { event: 'UserPromptSubmit' } }),
      atom('b', 'guard', 'x', { fields: { event: 'PreToolUse' } }),
      atom('c', 'instruction', 'On stop, stop all work.'),
      atom('d', 'instruction', 'x'),
      atom('e', 'stage', 'x'),
    ]);
    const planted = new Map<string, Planted>([
      ['d', { scope: 'stop' }],
      ['e', { scope: 'stop' }],
    ]);
    expect(ids('stoprule', map, planted)).toEqual(['d']);
    expect(ids('stop', map, planted)).toEqual(['a', 'd']);
    expect(ids('prompt', map, planted)).toEqual(['a']);
  });

  it('a confirmation: a gate, not a permission that asks nor an instruction that speaks of a yes', () => {
    const map = mapOf([
      atom('a', 'tool', 'x', { fields: { effect: 'ask' } }),
      atom('b', 'gate', 'Show the draft and get an explicit yes.'),
      atom('c', 'instruction', 'Get an explicit yes.'),
    ]);
    expect(ids('confirmation', map)).toEqual(['b']);
  });

  it('a route: the route and the skill it opens, not a helper it opens nor a skill no route opens', () => {
    const map = mapOf(
      [
        atom('r', 'route', 'x'),
        atom('s', 'skill', 'x'),
        atom('t', 'skill', 'x'),
        atom('r2', 'route', 'x'),
        atom('h', 'subagent', 'x'),
      ],
      [
        { from: 'r', to: 's', kind: 'route' },
        { from: 'r2', to: 'h', kind: 'route' },
      ],
    );
    expect(ids('routing', map)).toEqual(['r', 'r2', 's']);
  });
});

/**
 * The kinds the previous oracle allowed for each situation, and the routes to a helper it also allowed: the baseline no
 * relation may exceed. The four values it held no row for (a hold, keep going, a limit word, a prompt extraction) have
 * the kinds the contract table names for them: a gate for a hold and for skip pressure, a rule or a guard on the prompt
 * for a stop word, an output rule for a reply that refuses.
 */
const MAIN_KINDS: Record<string, readonly string[]> = {
  'dead-helper': ['subagent'],
  'helpers-running': ['subagent'],
  'stale-tracker': ['stage'],
  'language-switch': ['register', 'instruction'],
  'owner-language-switch': ['register', 'instruction'],
  'tool-failure': ['tool', 'script', 'guard', 'subagent', 'skill', 'route'],
  'instruction-in-data': ['instruction', 'gate', 'guard', 'register'],
  'loose-confirmation': ['instruction', 'gate', 'guard'],
  'rate-wave': ['tool', 'script', 'subagent', 'instruction', 'stage'],
  'process-restart': ['stage', 'subagent', 'instruction', 'gate'],
  compaction: ['instruction', 'gate', 'register', 'stage', 'skill', 'route'],
  'after-compaction': ['instruction', 'gate', 'register', 'stage', 'skill', 'route'],
  'after-restart': ['stage', 'subagent', 'instruction', 'gate'],
  resumed: ['stage', 'instruction', 'gate', 'skill', 'route'],
  'stop-signal': ['instruction', 'stage', 'subagent', 'guard'],
  'no-questions': ['instruction', 'gate', 'register'],
  'goal-shift': ['route', 'skill', 'stage', 'instruction'],
  'off-topic': ['route', 'skill', 'instruction', 'register', 'stage'],
  'out-of-scope': ['route', 'skill', 'subagent', 'instruction'],
  'silence-burst': ['instruction', 'register', 'guard', 'subagent'],
  'owner-hold': ['gate', 'instruction', 'guard'],
  'keep-going': ['gate'],
  'limit-word': ['instruction', 'guard'],
  'prompt-extraction': ['register', 'instruction'],
};
const MAIN_HELPER_ROUTES = new Set(['dead-helper', 'helpers-running']);

describe('no situation allows an atom the previous oracle rejected', () => {
  // Atoms of every kind carrying every typed attribute a relation reads, planted for every hazard and stop.
  const RICH: Array<Partial<Atom>> = [
    {
      evidence: [
        { type: 'tool_called', label: 'Read' },
        { type: 'tool_called', label: 'WebFetch' },
        { type: 'tool_called', label: 'Agent' },
        { type: 'tool_called', label: 'Bash' },
        { type: 'ordered', before: 'Read', after: 'Edit' },
        { type: 'text', must: ['x'] },
        { type: 'stage_reached', name: 'note' },
      ],
      fields: { tools: ['Read'], tool: 'WebFetch', effect: 'ask', hazard: 'restart', targetKind: 'subagent' },
    },
    { fields: { event: 'UserPromptSubmit' } },
    { fields: { event: 'PostToolUse' } },
  ];
  const rich = KINDS.flatMap((kind) =>
    RICH.map((extra, index) => atom(`${kind}.${index}`, kind, DECOY_WORDS, extra)),
  );
  const edges: EstateMap['edges'] = rich
    .filter((a) => a.kind === 'route')
    .flatMap((route) =>
      rich
        .filter((a) => ['skill', 'subagent', 'script', 'guard', 'tool', 'stage'].includes(a.kind))
        .map((target) => ({ from: route.id, to: target.id, kind: 'route' as const })),
    );
  const planted = new Map<string, Planted>(
    rich.map((a) => [a.id, { hazard: 'restart', scope: 'stop', behaviour: 'stop_on_word' }]),
  );

  it.each(CASES.map((c) => [c.key, c.relation] as const))('%s', (key, relation) => {
    const allowedKinds = new Set(MAIN_KINDS[key]);
    const byId = new Map(rich.map((a) => [a.id, a]));
    const targets = [...targetsOf(relation, mapOf(rich, edges), planted)];
    const tooMany = targets.filter((id) => {
      const kind = byId.get(id)?.kind as string;
      if (allowedKinds.has(kind)) return false;
      // The previous oracle also allowed a route whose target is a helper.
      return !(MAIN_HELPER_ROUTES.has(key) && kind === 'route');
    });
    expect(tooMany, key).toEqual([]);
    // Planted for the restart hazard on every atom, a compaction relation holds none of them.
    if (relation === 'compaction') expect(targets).toEqual([]);
  });
});

describe('a plan that crosses everything with everything fails all 24 items', { timeout: 600_000 }, () => {
  const holders = [
    atom('h.helper', 'subagent', 'name: analyst'),
    atom('h.tool', 'script', 'scripts/run.py'),
    atom('h.stage', 'stage', 'Report'),
    atom('h.output', 'register', 'Lead with the result.'),
    atom('h.ask', 'tool', 'Bash(dome:*)', { fields: { effect: 'ask' } }),
    atom('h.restart', 'hazard', 'Hazard.', { fields: { hazard: 'restart' } }),
    atom('h.compaction', 'hazard', 'Hazard.', { fields: { hazard: 'compaction' } }),
    atom('h.stop', 'guard', 'stop-word.sh', { fields: { event: 'UserPromptSubmit' } }),
    atom('h.route', 'route', '| observe | exposure |'),
  ];
  const everything = (atoms: Atom[]) =>
    CASES.flatMap(({ dimension, value }) => atoms.map((a) => ({ atom: a.id, dimension, value })));

  it('fails every item on an estate that holds a typed atom for each relation, decoys of every kind among them', async () => {
    const atoms = [...holders, ...KINDS.map(decoy)];
    const rows = everything(atoms);
    for (const { key } of CASES) {
      const out = await verdict(
        key,
        mapOf(atoms, [{ from: 'h.route', to: 'decoy.skill', kind: 'route' }]),
        rows,
        { hazard: 'compaction' },
        'decoy.instruction',
      );
      expect(out.pass, `${key}: ${out.detail}`).toBe(false);
    }
  });

  it('fails every item on an estate that holds almost no typed atom: no atom applies, so any crossing is wrong', async () => {
    const atoms = KINDS.filter((kind) => !['stage', 'subagent', 'register', 'route'].includes(kind)).map(
      decoy,
    );
    const rows = everything(atoms);
    for (const { key } of CASES) {
      const out = await verdict(key, mapOf(atoms), rows);
      expect(out.pass, `${key}: ${out.detail}`).toBe(false);
    }
  });

  it('fails every item on the real generated estate when its plan crosses every situation with every axis atom', async () => {
    const run = await pipeline.estateRun(1);
    const atoms = run.scanned.map.atoms.filter((a) => a.role === 'axis');
    const rows = CASES.flatMap(({ dimension, value }) =>
      atoms.map((a, index) => ({
        id: `pairwise.${dimension}.${value}.${index}`,
        atomIds: [a.id],
        cell: { [dimension]: value },
      })),
    );
    const everything = { ...run, plan: { ...run.plan, plan: { ...run.plan.plan, rows } } };
    const mock = vi.spyOn(pipeline, 'estateRun').mockResolvedValue(everything as pipeline.EstateRun);
    try {
      const out = await planRelevanceFamily().evaluate(1);
      for (const { key } of CASES) expect(out.get(`plan.relevance.${key}`)?.pass, key).toBe(false);
    } finally {
      mock.mockRestore();
    }
  });
});

describe('plan.relevance on the generated estate', { timeout: 600_000 }, () => {
  it('judges the real plan of seeds 1 and 2: 24 items, each with a verdict and a detail', async () => {
    for (const seed of [1, 2]) {
      const verdicts = await planRelevanceFamily().evaluate(seed);
      expect(verdicts.size, `seed ${seed}`).toBe(CASES.length);
      for (const [id, result] of verdicts) expect(typeof result.detail, id).toBe('string');
    }
  });

  it('crosses a real helper with a dead helper and rejects a real helper-dispatching instruction and a real register with it', async () => {
    const run = await pipeline.estateRun(1);
    const dispatcher = run.scanned.map.atoms.find(
      (a) =>
        a.kind === 'instruction' && a.evidence.some((e) => e.type === 'tool_called' && e.label === 'Agent'),
    );
    const register = run.scanned.map.atoms.find((a) => a.kind === 'register');
    if (!dispatcher || !register) throw new Error('the estate holds no dispatching instruction or register');
    const base = run.plan.plan.rows.find((row) => row.id.startsWith('pairwise.'));
    if (!base) throw new Error('no pairwise row');
    const planted = (atomId: string) => ({
      ...run,
      plan: {
        ...run.plan,
        plan: {
          ...run.plan.plan,
          rows: [
            {
              ...structuredClone(base),
              id: 'pairwise.planted',
              atomIds: [atomId],
              cell: { estate_hazard: 'dead_helper' },
            },
            ...run.plan.plan.rows.filter(
              (row) => row.id.startsWith('pairwise.') && row.cell.estate_hazard !== 'dead_helper',
            ),
          ],
        },
      },
    });
    const helper = run.scanned.map.atoms.find((a) => a.kind === 'subagent');
    if (!helper) throw new Error('the estate holds no helper');
    for (const [atomId, pass] of [
      [helper.id, true],
      [dispatcher.id, false],
      [register.id, false],
    ] as const) {
      const mock = vi.spyOn(pipeline, 'estateRun').mockResolvedValue(planted(atomId));
      try {
        const out = (await planRelevanceFamily().evaluate(1)).get('plan.relevance.dead-helper');
        expect(out?.pass, `${atomId}: ${out?.detail}`).toBe(pass);
      } finally {
        mock.mockRestore();
      }
    }
  });
});

describe('a declared exclusion counts only where the one relevance table justifies it', () => {
  const gate = atom('g', 'gate', 'Open the shutter.');
  const promptGuard = atom('pg', 'guard', 'stop-word.sh', { fields: { event: 'UserPromptSubmit' } });
  const register = atom('o', 'register', 'Lead with the result.');
  const stage = atom('s', 'stage', 'Report');
  const map = mapOf([gate, promptGuard, register, stage]);
  const accepts = exclusionJustifier(map);
  const forbid = (dimension: string, value: string, target: string) => ({
    [dimension]: value,
    'atoms.any': target,
  });

  it('accepts an exclusion of an atom the value cannot act on, and refuses one of an atom it can', () => {
    expect(accepts(forbid('owner_signal', 'keep_going', 's'))).toBe(true);
    expect(accepts(forbid('owner_signal', 'keep_going', 'g'))).toBe(false);
    // A hold acts on a gate and on a guard on the prompt, and on nothing else.
    expect(accepts(forbid('owner_signal', 'hold', 'g'))).toBe(false);
    expect(accepts(forbid('owner_signal', 'hold', 'pg'))).toBe(false);
    expect(accepts(forbid('owner_signal', 'hold', 'o'))).toBe(true);
    expect(accepts(forbid('owner_signal', 'limit_word', 'pg'))).toBe(false);
    expect(accepts(forbid('owner_signal', 'limit_word', 'g'))).toBe(true);
    expect(accepts(forbid('deviation', 'D12_prompt_extraction', 'o'))).toBe(false);
    expect(accepts(forbid('deviation', 'D12_prompt_extraction', 's'))).toBe(true);
  });

  it('refuses an exclusion the table cannot judge: a value with no row, two situations, two targets, an unknown atom', () => {
    expect(accepts(forbid('deviation', 'D3_contradiction', 's'))).toBe(false);
    expect(accepts({ owner_signal: 'hold', deviation: 'D12_prompt_extraction' })).toBe(false);
    expect(accepts({ owner_signal: 'hold', 'atoms.a': 's', 'atoms.b': 'o' })).toBe(false);
    expect(accepts(forbid('owner_signal', 'hold', 'missing'))).toBe(false);
    expect(accepts({ 'atoms.a': 's' })).toBe(false);
  });

  it('reads what the hidden estate planted: a stop rule is a target of a stop, an instruction without it is not', () => {
    const rule = atom('i', 'instruction', 'Close the dome.');
    const other = atom('j', 'instruction', 'Close the dome.');
    const planted = new Map<string, Planted>([['i', { scope: 'stop', behaviour: 'stop_on_word' }]]);
    const withPlant = exclusionJustifier(mapOf([rule, other]), planted);
    expect(withPlant(forbid('owner_signal', 'limit_word', 'i'))).toBe(false);
    expect(withPlant(forbid('owner_signal', 'limit_word', 'j'))).toBe(true);
    expect(exclusionJustifier(mapOf([rule, other]))(forbid('owner_signal', 'limit_word', 'i'))).toBe(true);
  });
});
