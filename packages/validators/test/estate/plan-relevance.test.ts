import type { AtomKind } from '@agent-nexus/driftbench-estate';
import { describe, expect, it, vi } from 'vitest';
import { planRelevanceFamily, RELEVANCE, truthOf } from '../../src/ladders/estate/bank/plan';
import { plantedTargets, type Relation, type Truth } from '../../src/ladders/estate/bank/relevance-planted';
import * as pipeline from '../../src/ladders/estate/pipeline';
// The map reader below is a planner that reads the SCANNED MAP perfectly (typed fields, evidence, edges). It is the
// stand-in for a product: the oracle under test must agree with it where the map is faithful, and must catch it when it
// is wrong, because the oracle reads the planted truth and never the map.
import { type Planted, targetsOf } from './map-reader';

// Hand-written observatory estates. Every id is invented for these tests; none is a bank or generated-estate phrase.

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

type Rule = Truth['rules'][number];

/** A planted truth from short lists: atoms by hid and kind, and the planted details of rules and guards. */
function truth(parts: {
  atoms: Array<[hid: string, kind: AtomKind]>;
  edges?: Truth['edges'];
  rules?: Rule[];
  guards?: Truth['guards'];
  declaresTools?: string[];
}): Truth {
  return {
    atoms: parts.atoms.map(([hid, kind]) => ({ hid, kind })),
    edges: parts.edges ?? [],
    rules: parts.rules ?? [],
    guards: parts.guards ?? [],
    declaresTools: parts.declaresTools ?? [],
  };
}

const ids = (relation: Relation, planted: Truth) => [...plantedTargets(relation, planted)].sort();

describe('the 13 relations, each from what the generator planted', () => {
  it('a helper: the helper and the route that opens it, not a unit that dispatches or calls one', () => {
    const t = truth({
      atoms: [
        ['route:a', 'route'],
        ['skill:s', 'skill'],
        ['helper:h', 'subagent'],
        ['rule:i', 'instruction'],
        ['route:b', 'route'],
      ],
      edges: [
        { from: 'route:a', to: 'helper:h', kind: 'route' },
        { from: 'skill:s', to: 'helper:h', kind: 'dispatch' },
        { from: 'route:b', to: 'skill:s', kind: 'route' },
      ],
      rules: [{ hid: 'rule:i', kind: 'instruction', evidence: [{ type: 'tool_called', label: 'Agent' }] }],
    });
    expect(ids('helper', t)).toEqual(['helper:h', 'route:a']);
  });

  it('a tool: tools, scripts, guards, the skills and helpers that declare tools, and the route to them', () => {
    const t = truth({
      atoms: [
        ['tool:allow:Read', 'tool'],
        ['script:x', 'script'],
        ['guard:g', 'guard'],
        ['skill:s', 'skill'],
        ['skill:plain', 'skill'],
        ['helper:h', 'subagent'],
        ['route:r', 'route'],
        ['route:other', 'route'],
        ['rule:gate', 'gate'],
        ['ref:f', 'reference'],
      ],
      edges: [
        { from: 'route:r', to: 'skill:s', kind: 'route' },
        { from: 'route:other', to: 'skill:plain', kind: 'route' },
      ],
      rules: [
        {
          hid: 'rule:gate',
          kind: 'gate',
          evidence: [{ type: 'tool_called', label: 'Read' }, { type: 'ordered' }],
        },
      ],
      declaresTools: ['skill:s', 'helper:h'],
    });
    expect(ids('tool', t)).toEqual([
      'guard:g',
      'helper:h',
      'route:r',
      'script:x',
      'skill:s',
      'tool:allow:Read',
    ]);
  });

  it('a step: the stages of the flow', () => {
    const t = truth({
      atoms: [
        ['stage:plan', 'stage'],
        ['rule:i', 'instruction'],
      ],
      rules: [{ hid: 'rule:i', kind: 'instruction', evidence: [{ type: 'stage_reached' }] }],
    });
    expect(ids('stage', t)).toEqual(['stage:plan']);
  });

  it('a reply: an output rule and an instruction planted with a text predicate; a gate or a stage with one is not', () => {
    const t = truth({
      atoms: [
        ['rule:reg', 'register'],
        ['rule:text', 'instruction'],
        ['rule:plain', 'instruction'],
        ['rule:gate', 'gate'],
        ['stage:s', 'stage'],
      ],
      rules: [
        { hid: 'rule:text', kind: 'instruction', evidence: [{ type: 'text' }] },
        { hid: 'rule:plain', kind: 'instruction', evidence: [{ type: 'custom' }] },
        { hid: 'rule:gate', kind: 'gate', evidence: [{ type: 'text' }] },
      ],
    });
    expect(ids('output', t)).toEqual(['rule:reg', 'rule:text']);
  });

  it('outside data: a read, a search or a fetch by a rule, and an order that starts with a read; a Bash call or another order is not', () => {
    const t = truth({
      atoms: [
        ['gate:skill', 'gate'],
        ['rule:readgate', 'gate'],
        ['rule:ordered', 'gate'],
        ['rule:fetch', 'instruction'],
        ['rule:bash', 'instruction'],
        ['tool:allow:Read', 'tool'],
      ],
      rules: [
        { hid: 'gate:skill', kind: 'gate', evidence: [{ type: 'ordered', before: 'Read' }] },
        { hid: 'rule:readgate', kind: 'gate', evidence: [{ type: 'tool_called', label: 'Read' }] },
        { hid: 'rule:ordered', kind: 'gate', evidence: [{ type: 'ordered', before: 'verify' }] },
        { hid: 'rule:fetch', kind: 'instruction', evidence: [{ type: 'tool_called', label: 'WebFetch' }] },
        { hid: 'rule:bash', kind: 'instruction', evidence: [{ type: 'tool_called', label: 'Bash' }] },
      ],
    });
    expect(ids('data', t)).toEqual(['gate:skill', 'rule:fetch', 'rule:readgate']);
  });

  it('a confirmation: the gates, not an instruction that speaks of a yes', () => {
    const t = truth({
      atoms: [
        ['rule:g', 'gate'],
        ['gate:s', 'gate'],
        ['rule:i', 'instruction'],
        ['tool:ask:Bash', 'tool'],
      ],
    });
    expect(ids('confirmation', t)).toEqual(['gate:s', 'rule:g']);
  });

  it('a retry contract: scripts, helpers, service tools and the rules that call a service or a helper', () => {
    const t = truth({
      atoms: [
        ['script:x', 'script'],
        ['helper:h', 'subagent'],
        ['tool:allow:WebFetch', 'tool'],
        ['tool:deny:Bash(rm -rf:*)', 'tool'],
        ['tool:allow:Read', 'tool'],
        ['rule:agent', 'instruction'],
        ['rule:read', 'instruction'],
        ['route:r', 'route'],
      ],
      rules: [
        { hid: 'rule:agent', kind: 'instruction', evidence: [{ type: 'tool_called', label: 'Agent' }] },
        { hid: 'rule:read', kind: 'instruction', evidence: [{ type: 'tool_called', label: 'Read' }] },
      ],
    });
    expect(ids('rate', t)).toEqual([
      'helper:h',
      'rule:agent',
      'script:x',
      'tool:allow:WebFetch',
      'tool:deny:Bash(rm -rf:*)',
    ]);
  });

  it('a hazard: the rule planted for it, never the hazard atom or a skill', () => {
    const t = truth({
      atoms: [
        ['rule:c', 'instruction'],
        ['rule:g', 'gate'],
        ['hazard:rule:c', 'hazard'],
        ['rule:r', 'instruction'],
        ['rule:s', 'instruction'],
        ['skill:s', 'skill'],
        ['rule:reg', 'register'],
      ],
      rules: [
        { hid: 'rule:c', kind: 'instruction', hazard: 'compaction', scope: 'compaction', evidence: [] },
        { hid: 'rule:g', kind: 'gate', scope: 'compaction', evidence: [] },
        { hid: 'rule:r', kind: 'instruction', hazard: 'restart', scope: 'restart', evidence: [] },
        { hid: 'rule:s', kind: 'instruction', scope: 'stop', evidence: [] },
        { hid: 'rule:reg', kind: 'register', hazard: 'compaction', evidence: [] },
      ],
    });
    expect(ids('compaction', t)).toEqual(['rule:c', 'rule:g']);
    expect(ids('restart', t)).toEqual(['rule:r']);
  });

  it('a stop: the instruction a planted guard on the prompt event enforces; with that guard for stop', () => {
    const t = truth({
      atoms: [
        ['guard:stop', 'guard'],
        ['guard:push', 'guard'],
        ['rule:stop', 'instruction'],
        ['rule:push', 'instruction'],
        ['rule:scoped', 'instruction'],
        ['rule:gate', 'gate'],
      ],
      edges: [
        { from: 'guard:stop', to: 'rule:stop', kind: 'enforces' },
        { from: 'guard:stop', to: 'rule:gate', kind: 'enforces' },
        { from: 'guard:push', to: 'rule:push', kind: 'enforces' },
      ],
      rules: [{ hid: 'rule:scoped', kind: 'instruction', scope: 'stop', evidence: [] }],
      guards: [
        { hid: 'guard:stop', event: 'UserPromptSubmit' },
        { hid: 'guard:push', event: 'PreToolUse' },
      ],
    });
    expect(ids('stoprule', t)).toEqual(['rule:stop']);
    expect(ids('stop', t)).toEqual(['guard:stop', 'rule:stop']);
    expect(ids('prompt', t)).toEqual(['guard:stop']);
  });

  it('a route: the route and the skill it opens, not a helper it opens nor a skill no route opens', () => {
    const t = truth({
      atoms: [
        ['route:r', 'route'],
        ['skill:s', 'skill'],
        ['skill:t', 'skill'],
        ['route:r2', 'route'],
        ['helper:h', 'subagent'],
      ],
      edges: [
        { from: 'route:r', to: 'skill:s', kind: 'route' },
        { from: 'route:r2', to: 'helper:h', kind: 'route' },
      ],
    });
    expect(ids('routing', t)).toEqual(['route:r', 'route:r2', 'skill:s']);
  });
});

/** What each situation tests: the 20 items of plan.relevance. */
const CASES = RELEVANCE.map(({ key, dimension, value, relation }) => ({ key, dimension, value, relation }));

/** The kinds the previous oracle allowed for each situation, and the routes to a helper it also allowed. */
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
};
const MAIN_HELPER_ROUTES = new Set(['dead-helper', 'helpers-running']);

describe('no situation allows an atom the previous oracle rejected', () => {
  // Atoms of every kind, every rule planted with every attribute a relation reads, every guard on every event.
  const atoms: Array<[string, AtomKind]> = KINDS.flatMap((kind) => [
    [`${kind}:a`, kind] as [string, AtomKind],
    [`${kind}:b`, kind] as [string, AtomKind],
  ]);
  atoms.push(['tool:allow:WebFetch', 'tool'], ['tool:deny:Bash(x:*)', 'tool']);
  const ruleKinds = ['instruction', 'gate', 'register'];
  const rich = truth({
    atoms,
    edges: atoms.flatMap(([from, kind]) =>
      kind === 'route' || kind === 'guard'
        ? atoms.map(([to]) => ({ from, to, kind: kind === 'route' ? 'route' : 'enforces' }))
        : [],
    ),
    rules: atoms
      .filter(([, kind]) => ruleKinds.includes(kind))
      .map(([hid, kind]) => ({
        hid,
        kind,
        hazard: 'restart',
        scope: 'stop',
        evidence: ['Read', 'WebFetch', 'Agent', 'Bash']
          .map((label) => ({ type: 'tool_called', label }))
          .concat([{ type: 'text' } as never]),
      })),
    guards: atoms.filter(([, kind]) => kind === 'guard').map(([hid]) => ({ hid, event: 'UserPromptSubmit' })),
    declaresTools: atoms.filter(([, kind]) => kind === 'skill' || kind === 'subagent').map(([hid]) => hid),
  });

  it.each(CASES.map((c) => [c.key, c.relation] as const))('%s (synthetic estate)', (key, relation) => {
    const kindOf = new Map(atoms);
    const allowed = new Set(MAIN_KINDS[key]);
    const tooMany = [...plantedTargets(relation, rich)].filter((hid) => {
      const kind = kindOf.get(hid) as string;
      return !allowed.has(kind) && !(MAIN_HELPER_ROUTES.has(key) && kind === 'route');
    });
    expect(tooMany, key).toEqual([]);
  });
});

/** A run holding what the item reads: the truth (hidden estate and rendering), the scan's ids, and the pairwise rows. */
function fakeRun(t: Truth, rows: Array<{ atom?: string; dimension: string; value: string }>) {
  const kinds = new Map(t.atoms.map((a) => [a.hid, a.kind]));
  const idOf = new Map(t.atoms.map((a) => [a.hid, `scan:${a.hid}`]));
  return {
    estate: {
      rules: t.rules.map((rule) => ({ ...rule, kind: rule.kind })),
      guards: t.guards,
      skills: t.declaresTools.filter((h) => kinds.get(h) === 'skill').map((hid) => ({ hid })),
      helpers: t.declaresTools.filter((h) => kinds.get(h) === 'subagent').map((hid) => ({ hid })),
    },
    rendered: {
      atoms: t.atoms.map((a) => ({ ...a, file: `f:${a.hid}`, line: 1 })),
      edges: t.edges,
      recording: {
        answers: Object.fromEntries(
          t.rules.map((rule) => [
            `f:${rule.hid}`,
            { atoms: [{ line: 1, kind: rule.kind, evidence: rule.evidence }] },
          ]),
        ),
      },
    },
    scanned: {
      map: { atoms: t.atoms.map((a) => ({ id: `scan:${a.hid}`, kind: a.kind })), edges: [] },
      match: { idOf },
    },
    plan: {
      plan: {
        rows: rows.map((row, index) => ({
          id: `pairwise.${index}`,
          atomIds: row.atom === undefined ? [] : [`scan:${row.atom}`],
          cell: { [row.dimension]: row.value },
        })),
      },
    },
  } as unknown as pipeline.EstateRun;
}

async function judge(t: Truth, rows: Array<{ atom?: string; dimension: string; value: string }>) {
  const mock = vi.spyOn(pipeline, 'estateRun').mockResolvedValue(fakeRun(t, rows));
  try {
    const out = await planRelevanceFamily().evaluate(1);
    return Object.fromEntries(
      CASES.map(({ key }) => [key, out.get(`plan.relevance.${key}`) as { pass: boolean; detail: string }]),
    );
  } finally {
    mock.mockRestore();
  }
}

describe('hand-written plans: a correct plan passes, a cross-everything plan fails, a plan missing a held relation fails', () => {
  // A planted truth that holds every relation, with decoys of kinds that hold none. The targets of each situation are
  // listed by hand from the documented relations, not computed by the oracle.
  const t = truth({
    atoms: [
      ['helper:h', 'subagent'],
      ['route:h', 'route'],
      ['skill:k', 'skill'],
      ['route:k', 'route'],
      ['script:s', 'script'],
      ['stage:report', 'stage'],
      ['rule:reg', 'register'],
      ['rule:text', 'instruction'],
      ['gate:skill', 'gate'],
      ['rule:gate', 'gate'],
      ['tool:allow:WebFetch', 'tool'],
      ['guard:stop', 'guard'],
      ['rule:stop', 'instruction'],
      ['rule:restart', 'instruction'],
      ['rule:compact', 'instruction'],
      ['ref:d', 'reference'],
      ['setting:d', 'setting'],
      ['invariant:d', 'invariant'],
    ],
    edges: [
      { from: 'route:h', to: 'helper:h', kind: 'route' },
      { from: 'route:k', to: 'skill:k', kind: 'route' },
      { from: 'guard:stop', to: 'rule:stop', kind: 'enforces' },
    ],
    rules: [
      { hid: 'rule:text', kind: 'instruction', evidence: [{ type: 'text' }] },
      { hid: 'gate:skill', kind: 'gate', evidence: [{ type: 'ordered', before: 'Read' }] },
      { hid: 'rule:gate', kind: 'gate', evidence: [{ type: 'tool_called', label: 'Read' }] },
      { hid: 'rule:restart', kind: 'instruction', hazard: 'restart', scope: 'restart', evidence: [] },
      { hid: 'rule:compact', kind: 'instruction', hazard: 'compaction', scope: 'compaction', evidence: [] },
    ],
    guards: [{ hid: 'guard:stop', event: 'UserPromptSubmit' }],
    declaresTools: ['skill:k', 'helper:h'],
  });
  const HELPER = ['helper:h', 'route:h'];
  const TARGETS: Record<string, string[]> = {
    'dead-helper': HELPER,
    'helpers-running': HELPER,
    'stale-tracker': ['stage:report'],
    'language-switch': ['rule:reg', 'rule:text'],
    'owner-language-switch': ['rule:reg', 'rule:text'],
    'tool-failure': [
      'script:s',
      'tool:allow:WebFetch',
      'guard:stop',
      'skill:k',
      'route:k',
      'helper:h',
      'route:h',
    ],
    'instruction-in-data': ['gate:skill', 'rule:gate'],
    'loose-confirmation': ['gate:skill', 'rule:gate'],
    'rate-wave': ['script:s', 'helper:h', 'tool:allow:WebFetch'],
    'process-restart': ['rule:restart'],
    compaction: ['rule:compact'],
    'after-compaction': ['rule:compact'],
    'after-restart': ['rule:restart'],
    resumed: ['rule:stop'],
    'stop-signal': ['guard:stop', 'rule:stop'],
    'no-questions': ['gate:skill', 'rule:gate'],
    'goal-shift': ['route:h', 'route:k', 'skill:k'],
    'off-topic': ['route:h', 'route:k', 'skill:k'],
    'out-of-scope': ['route:h', 'route:k', 'skill:k'],
    'silence-burst': ['guard:stop'],
  };
  const rowsFor = (pick: (key: string) => string[]) =>
    CASES.flatMap(({ key, dimension, value }) => pick(key).map((atom) => ({ atom, dimension, value })));
  const everyone = t.atoms.map((a) => a.hid);

  it('lists a target for each of the 20 situations', () => {
    expect(Object.keys(TARGETS).sort()).toEqual(CASES.map((c) => c.key).sort());
    for (const [key, list] of Object.entries(TARGETS)) expect(list.length, key).toBeGreaterThan(0);
  });

  it('agrees with the hand-listed targets for every situation', () => {
    for (const { key, relation } of CASES) {
      const hand = [...(TARGETS[key] ?? [])].sort();
      // The two guards that hold tools also hold the tool relation: the list above names them explicitly.
      expect(ids(relation, t), key).toEqual(hand);
    }
  });

  it('passes a correct plan: each situation crossed with exactly its targets', async () => {
    const out = await judge(
      t,
      rowsFor((key) => TARGETS[key] ?? []),
    );
    for (const { key } of CASES)
      expect(out[key], `${key}: ${out[key]?.detail}`).toMatchObject({ pass: true });
  });

  it('passes a correct plan that crosses only some of the targets of each situation', async () => {
    const out = await judge(
      t,
      rowsFor((key) => (TARGETS[key] ?? []).slice(0, 1)),
    );
    for (const { key } of CASES)
      expect(out[key], `${key}: ${out[key]?.detail}`).toMatchObject({ pass: true });
  });

  it('fails a cross-everything plan on all 20 items', async () => {
    const out = await judge(
      t,
      rowsFor(() => everyone),
    );
    for (const { key } of CASES) expect(out[key]?.pass, `${key}: ${out[key]?.detail}`).toBe(false);
  });

  it('fails a plan that adds one decoy to the targets of each situation', async () => {
    for (const decoy of ['ref:d', 'setting:d', 'invariant:d']) {
      const out = await judge(
        t,
        rowsFor((key) => [...(TARGETS[key] ?? []), decoy]),
      );
      for (const { key } of CASES) expect(out[key]?.pass, `${key} + ${decoy}`).toBe(false);
    }
  });

  it('fails a plan missing a held relation: no row crosses the situation with any of its targets', async () => {
    const none = await judge(
      t,
      rowsFor(() => []),
    );
    for (const { key } of CASES) expect(none[key]?.pass, `${key}: ${none[key]?.detail}`).toBe(false);
    const wrong = await judge(
      t,
      rowsFor(() => ['ref:d']),
    );
    for (const { key } of CASES) expect(wrong[key]?.pass, key).toBe(false);
  });

  it('passes a plan that keeps a situation as a row with no atom when no atom holds its relation', async () => {
    // Kinds that hold no relation here: no stage, helper, register, gate, route, tool, script or guard is planted.
    const bare = truth({
      atoms: (['reference', 'setting', 'invariant', 'skill', 'hazard', 'instruction'] as const).map(
        (kind) => [`${kind}:d`, kind] as [string, AtomKind],
      ),
    });
    const out = await judge(
      bare,
      CASES.map(({ dimension, value }) => ({ dimension, value })),
    );
    for (const { key } of CASES)
      expect(out[key], `${key}: ${out[key]?.detail}`).toMatchObject({ pass: true });
    const crossed = await judge(
      bare,
      CASES.flatMap(({ dimension, value }) => bare.atoms.map((a) => ({ atom: a.hid, dimension, value }))),
    );
    for (const { key } of CASES) expect(crossed[key]?.pass, key).toBe(false);
  });
});

describe('independence: a planner that reads the map perfectly is caught when one relation is wrong', {
  timeout: 900_000,
}, () => {
  /** The hazards and stops the map reader needs from the plan, read as the earlier map-based oracle did. */
  function plantedOfRun(run: pipeline.EstateRun): Map<string, Planted> {
    const rules = new Map(run.estate.rules.map((rule) => [rule.hid, rule]));
    const out = new Map<string, Planted>();
    for (const atom of run.scanned.map.atoms) {
      const hid = run.scanned.match.hidOf.get(atom.id);
      const rule = hid === undefined ? undefined : rules.get(hid.startsWith('hazard:') ? hid.slice(7) : hid);
      if (rule)
        out.set(atom.id, {
          ...(rule.hazard ? { hazard: rule.hazard } : {}),
          scope: rule.scope,
          behaviour: rule.behaviour.type,
        });
    }
    return out;
  }

  /** The plan of a map reader: each situation crossed with the atoms its relation selects in the scanned map. */
  function mapPlan(run: pipeline.EstateRun, swapped?: Relation) {
    const planted = plantedOfRun(run);
    const map = run.scanned.map;
    const rows = CASES.flatMap(({ dimension, value, relation }) => {
      let targets = targetsOf(relation as never, map, planted);
      if (swapped !== undefined && relation === swapped) {
        // The map reader is wrong about this relation only: it selects the atoms of a kind that holds none of its targets.
        const wanted = new Set(map.atoms.filter((a) => targets.has(a.id)).map((a) => a.kind));
        const kind = (['skill', 'reference', 'setting', 'invariant', 'hazard'] as const).find(
          (k) => !wanted.has(k) && map.atoms.some((a) => a.kind === k),
        );
        targets = new Set(map.atoms.filter((a) => a.kind === kind).map((a) => a.id));
      }
      return [...targets].map((atom) => ({ atom, dimension, value }));
    });
    return {
      ...run,
      plan: {
        ...run.plan,
        plan: {
          ...run.plan.plan,
          rows: rows.map((row, index) => ({
            ...structuredClone(run.plan.plan.rows[0]),
            id: `pairwise.${index}`,
            atomIds: [row.atom as string],
            cell: { [row.dimension]: row.value },
          })),
        },
      },
    } as pipeline.EstateRun;
  }

  async function verdicts(run: pipeline.EstateRun) {
    const mock = vi.spyOn(pipeline, 'estateRun').mockResolvedValue(run);
    try {
      return await planRelevanceFamily().evaluate(1);
    } finally {
      mock.mockRestore();
    }
  }

  const RELATIONS = [...new Set(CASES.map((c) => c.relation))];

  it.each([1, 2])(
    'seed %i: the map reader and the planted truth agree on every situation the map states',
    async (seed) => {
      const run = await pipeline.estateRun(seed);
      const out = await verdicts(mapPlan(run));
      for (const { key } of CASES)
        expect(
          out.get(`plan.relevance.${key}`),
          `${key}: ${out.get(`plan.relevance.${key}`)?.detail}`,
        ).toMatchObject({ pass: true });
    },
  );

  it.each(RELATIONS)(
    'seed 1: a map reader that swaps the kind of the %s relation fails exactly the items that test it',
    async (relation) => {
      const run = await pipeline.estateRun(1);
      const out = await verdicts(mapPlan(run, relation));
      for (const { key, relation: own } of CASES) {
        const item = out.get(`plan.relevance.${key}`);
        if (own === relation) expect(item?.pass, `${key}: ${item?.detail}`).toBe(false);
        else expect(item?.pass, `${key}: ${item?.detail}`).toBe(true);
      }
    },
  );

  it.each([1, 2])('seed %i: no situation allows an atom the previous oracle rejected', async (seed) => {
    const run = await pipeline.estateRun(seed);
    const t = truthOf(run);
    const kindOf = new Map(run.scanned.map.atoms.map((a) => [a.id, a.kind as string]));
    for (const { key, relation } of CASES) {
      const allowed = new Set(MAIN_KINDS[key]);
      const targets = [...plantedTargets(relation, t)].flatMap(
        (hid) => run.scanned.match.idOf.get(hid) ?? [],
      );
      const tooMany = targets.filter((id) => {
        const kind = kindOf.get(id) as string;
        return !allowed.has(kind) && !(MAIN_HELPER_ROUTES.has(key) && kind === 'route');
      });
      expect(tooMany, `${key}, seed ${seed}`).toEqual([]);
    }
  });
});
