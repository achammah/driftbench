import {
  type Atom,
  buildPlan,
  type EstateMap,
  type PlanRow,
  planJourneys,
  toEstateSpaceMap,
} from '@agent-nexus/driftbench-estate';
import type { SpaceMap } from '@agent-nexus/driftbench-space';
import { requiredRows } from '../levels';
import { type EstateRun, estateRun } from '../pipeline';
import { type Family, type ItemResult, itemsOf, type Tier } from './frame';
import { judgeTargets, plantedTargets, type Relation, type Truth } from './relevance-planted';

/**
 * Three plan families on the generated estate of each seed.
 *
 * plan.contract: every approved atom of a kind (and of each variant: a deny rule, an anytime stage) has the
 * rows the design's contract table asks; every journey edge of the graph is walked by a journey; pairwise
 * rows cover only axis atoms, carry every situation axis, and no two rows share an id.
 *
 * plan.pairs: the covering array against brute force on space maps built for the item, of strength 2 and 3,
 * with constraints of two and three values, a constraint on a target atom, a value no cell can take, one
 * value dimensions and wide dimensions. The oracle enumerates every allowed tuple.
 *
 * plan.relevance: a situation value is crossed only with the atoms it can act on, judged from typed data and no
 * word of the estate (relevance-typed.ts): the kind of an atom, the type of its evidence predicates, the kinds of
 * its edges, its typed fields and what the hidden estate planted for a standing rule. Each situation has one
 * narrow relation (a helper, a declared tool, a read of outside data, a call with a retry contract, a gate, a rule
 * planted for a hazard or a stop, a guard on the prompt, a route). The atoms that hold it are the situation's
 * identified targets; a crossing with any other atom is wrong, and no relation allows an atom that the kind list
 * of the previous oracle rejected. When no atom holds the relation, no atom applies and any crossing is wrong. A
 * plan that crosses every situation with every atom fails all 20 items.
 */

const CONTRACT = 'packages/estate/src/plan/contract.ts';
const PAIRWISE = 'packages/estate/src/plan/pairwise.ts';
const BUILD = 'packages/estate/src/plan/build.ts';
const JOURNEYS = 'packages/estate/src/plan/journeys.ts';

type Variant = { key: string; tier: Tier; title: string; select(atom: Atom): boolean };

const VARIANTS: Variant[] = [
  { key: 'instruction', tier: 1, title: 'instructions', select: (a) => a.kind === 'instruction' },
  { key: 'gate', tier: 1, title: 'gates', select: (a) => a.kind === 'gate' },
  { key: 'route', tier: 1, title: 'routes', select: (a) => a.kind === 'route' },
  {
    key: 'route-to-helper',
    tier: 2,
    title: 'routes to a helper',
    select: (a) => a.kind === 'route' && a.fields?.targetKind === 'subagent',
  },
  { key: 'skill', tier: 1, title: 'skills', select: (a) => a.kind === 'skill' },
  { key: 'reference', tier: 1, title: 'references', select: (a) => a.kind === 'reference' },
  {
    key: 'missing-reference',
    tier: 2,
    title: 'references to a missing file',
    select: (a) => a.kind === 'reference' && a.fields?.exists === false,
  },
  { key: 'script', tier: 1, title: 'scripts', select: (a) => a.kind === 'script' },
  { key: 'subagent', tier: 1, title: 'helpers', select: (a) => a.kind === 'subagent' },
  { key: 'guard', tier: 1, title: 'guards', select: (a) => a.kind === 'guard' },
  {
    key: 'tool-allow',
    tier: 1,
    title: 'allow rules',
    select: (a) => a.kind === 'tool' && a.fields?.effect === 'allow',
  },
  {
    key: 'tool-deny',
    tier: 1,
    title: 'deny rules',
    select: (a) => a.kind === 'tool' && a.fields?.effect === 'deny',
  },
  {
    key: 'tool-declared',
    tier: 2,
    title: 'declared tools',
    select: (a) => a.kind === 'tool' && a.fields?.effect === 'declared',
  },
  {
    key: 'stage-flow',
    tier: 1,
    title: 'stages of the flow',
    select: (a) => a.kind === 'stage' && a.fields?.anytime !== true,
  },
  {
    key: 'stage-anytime',
    tier: 2,
    title: 'anytime stages',
    select: (a) => a.kind === 'stage' && a.fields?.anytime === true,
  },
  { key: 'register', tier: 1, title: 'output rules', select: (a) => a.kind === 'register' },
  { key: 'hazard', tier: 1, title: 'hazards', select: (a) => a.kind === 'hazard' },
  { key: 'invariant', tier: 1, title: 'invariants', select: (a) => a.kind === 'invariant' },
];

function contractItem(
  map: EstateMap,
  rows: readonly PlanRow[],
  variant: Variant,
  askClasses: string[],
): ItemResult {
  const missing: string[] = [];
  for (const atom of map.atoms.filter((candidate) => candidate.approved && variant.select(candidate))) {
    const needs =
      atom.kind === 'skill' ? [{ type: 'route_positive', count: 1 }] : requiredRows(atom, askClasses);
    for (const need of needs) {
      const has = rows.filter(
        (row) =>
          row.testType === need.type &&
          (atom.kind === 'skill' ? row.atomIds.includes(atom.id) : row.atomIds[0] === atom.id),
      ).length;
      if (has < need.count) missing.push(`${atom.id} has ${has} of ${need.count} ${need.type}`);
    }
  }
  return {
    pass: missing.length === 0,
    detail: missing.length === 0 ? 'holds' : missing.slice(0, 3).join('; '),
  };
}

export function planContractFamily(): Family {
  const family = 'plan.contract';
  const extra = [
    {
      key: 'journey-route',
      tier: 2 as Tier,
      title:
        'every route the standing instructions state is walked by a journey, and a route read only from a description starts none',
    },
    { key: 'journey-reference', tier: 2 as Tier, title: 'every reference edge is walked by a journey' },
    { key: 'journey-dispatch', tier: 2 as Tier, title: 'every dispatch edge is walked by a journey' },
    { key: 'journey-next', tier: 2 as Tier, title: 'every next edge is walked by a journey' },
    { key: 'pairwise-axis-only', tier: 1 as Tier, title: 'pairwise rows target axis atoms only' },
    { key: 'pairwise-full-cells', tier: 1 as Tier, title: 'every pairwise row carries every situation axis' },
    { key: 'unique-ids', tier: 1 as Tier, title: 'no two rows share an id' },
  ];
  const items = itemsOf(family, 3, CONTRACT, [
    ...VARIANTS.map((variant) => ({
      key: variant.key,
      tier: variant.tier,
      title: `every approved atom among ${variant.title} has its mandatory rows`,
    })),
    ...extra.map((entry) => ({ ...entry, component: entry.key.startsWith('journey') ? JOURNEYS : BUILD })),
  ]);
  return {
    id: family,
    level: 3,
    component: CONTRACT,
    items,
    async evaluate(seed) {
      const run = await estateRun(seed);
      const map = run.scanned.map;
      const rows = run.plan.plan.rows;
      const space = toEstateSpaceMap(map);
      const askClasses = (space.dimensions.find((d) => d.id === 'ask_class')?.values ?? []).map((v) => v.id);
      const out = new Map<string, ItemResult>();
      for (const variant of VARIANTS)
        out.set(`${family}.${variant.key}`, contractItem(map, rows, variant, askClasses));
      const journeys = planJourneys(map);
      const walked = new Set<string>();
      for (const journey of journeys.journeys) {
        for (let index = 0; index + 1 < journey.atomIds.length; index += 1) {
          walked.add(`${journey.atomIds[index]}>${journey.atomIds[index + 1]}`);
        }
      }
      // docs/estate.md section 4: a route read only from a skill or helper description starts no journey. Which
      // routes those are is read here from the map (a route atom in the file of a skill or helper), not from the
      // plan under test.
      const unitFiles = new Set(
        map.atoms
          .filter((atom) => atom.kind === 'skill' || atom.kind === 'subagent')
          .map((atom) => atom.provenance.file),
      );
      const described = new Set(
        map.atoms
          .filter((atom) => atom.kind === 'route' && unitFiles.has(atom.provenance.file))
          .map((atom) => atom.id),
      );
      const started = new Set(journeys.journeys.map((journey) => journey.atomIds[0]));
      for (const kind of ['route', 'reference', 'dispatch', 'next']) {
        const all = journeys.edges.filter((edge) => edge.kind === kind);
        const edges = kind === 'route' ? all.filter((edge) => !described.has(edge.from)) : all;
        const unwalked = edges.filter((edge) => !walked.has(`${edge.from}>${edge.to}`));
        const fromDescription =
          kind === 'route'
            ? all.filter(
                (edge) =>
                  described.has(edge.from) &&
                  (walked.has(`${edge.from}>${edge.to}`) || started.has(edge.from)),
              )
            : [];
        if (fromDescription.length > 0) {
          out.set(`${family}.journey-${kind}`, {
            pass: false,
            detail: `${fromDescription.length} routes read only from a description start a journey: ${fromDescription
              .slice(0, 2)
              .map((edge) => `${edge.from} to ${edge.to}`)
              .join('; ')}`,
          });
          continue;
        }
        out.set(`${family}.journey-${kind}`, {
          pass: unwalked.length === 0,
          detail:
            unwalked.length === 0
              ? 'holds'
              : `${unwalked.length} of ${edges.length} ${kind} edges in no journey: ${unwalked
                  .slice(0, 2)
                  .map((edge) => `${edge.from} to ${edge.to}`)
                  .join('; ')}`,
        });
      }
      const pairwise = rows.filter((row) => row.id.startsWith('pairwise.'));
      const axis = new Set(map.atoms.filter((atom) => atom.role === 'axis').map((atom) => atom.id));
      const offAxis = pairwise.filter((row) => !axis.has(row.atomIds[0] as string));
      out.set(`${family}.pairwise-axis-only`, {
        pass: offAxis.length === 0,
        detail: offAxis.length === 0 ? 'holds' : `${offAxis.length} rows target detail atoms`,
      });
      const situation = space.dimensions.filter((d) => !d.id.startsWith('atoms.')).map((d) => d.id);
      const partial = pairwise.filter((row) => situation.some((id) => row.cell[id] === undefined));
      out.set(`${family}.pairwise-full-cells`, {
        pass: partial.length === 0,
        detail: partial.length === 0 ? 'holds' : `${partial.length} rows lack an axis`,
      });
      const ids = new Set(rows.map((row) => row.id));
      out.set(`${family}.unique-ids`, {
        pass: ids.size === rows.length,
        detail: ids.size === rows.length ? 'holds' : `${rows.length - ids.size} repeated ids`,
      });
      return out;
    },
  };
}

// plan.pairs -----------------------------------------------------------------------------------------------

type PairShape = {
  key: string;
  tier: Tier;
  title: string;
  t: 2 | 3;
  /** Sizes of the situation dimensions. */
  sizes: number[];
  /** Constraints as lists of [dimension index, value index]; dimension -1 is the target. */
  constraints: Array<Array<[number, number]>>;
  targets: number;
};

const PAIR_SHAPES: PairShape[] = [
  {
    key: 't2-plain',
    tier: 1,
    title: 'strength 2, no constraint',
    t: 2,
    sizes: [3, 3, 2],
    constraints: [],
    targets: 3,
  },
  {
    key: 't2-one-forbid',
    tier: 1,
    title: 'strength 2, one forbidden pair',
    t: 2,
    sizes: [3, 3, 2],
    constraints: [
      [
        [0, 0],
        [1, 0],
      ],
    ],
    targets: 3,
  },
  {
    key: 't2-target-forbid',
    tier: 2,
    title: 'strength 2, a pair forbidden with a target atom',
    t: 2,
    sizes: [3, 2],
    constraints: [
      [
        [-1, 0],
        [0, 1],
      ],
    ],
    targets: 3,
  },
  {
    key: 't2-three-forbid',
    tier: 3,
    title: 'strength 2, a forbidden triple',
    t: 2,
    sizes: [2, 2, 2],
    constraints: [
      [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
    ],
    targets: 2,
  },
  {
    key: 't2-dead-value',
    tier: 3,
    title: 'strength 2, a value no cell can take',
    t: 2,
    sizes: [2, 2],
    constraints: [
      [
        [0, 1],
        [1, 0],
      ],
      [
        [0, 1],
        [1, 1],
      ],
    ],
    targets: 2,
  },
  {
    key: 't2-single-value',
    tier: 2,
    title: 'strength 2, a dimension of one value',
    t: 2,
    sizes: [1, 3, 3],
    constraints: [],
    targets: 2,
  },
  {
    key: 't2-many-small',
    tier: 2,
    title: 'strength 2, eight dimensions of two values',
    t: 2,
    sizes: [2, 2, 2, 2, 2, 2, 2, 2],
    constraints: [],
    targets: 2,
  },
  {
    key: 't2-wide',
    tier: 2,
    title: 'strength 2, a dimension of twenty values',
    t: 2,
    sizes: [20, 3],
    constraints: [],
    targets: 3,
  },
  {
    key: 't2-chain',
    tier: 3,
    title: 'strength 2, a chain of forbidden pairs',
    t: 2,
    sizes: [3, 3, 3],
    constraints: [
      [
        [0, 0],
        [1, 1],
      ],
      [
        [1, 1],
        [2, 2],
      ],
      [
        [0, 2],
        [2, 0],
      ],
    ],
    targets: 2,
  },
  {
    key: 't2-forbid-all-but-one',
    tier: 4,
    title: 'strength 2, one value pair left between two dimensions',
    t: 2,
    sizes: [2, 2],
    constraints: [
      [
        [0, 0],
        [1, 0],
      ],
      [
        [0, 0],
        [1, 1],
      ],
      [
        [0, 1],
        [1, 0],
      ],
    ],
    targets: 2,
  },
  {
    key: 't3-plain',
    tier: 2,
    title: 'strength 3, no constraint',
    t: 3,
    sizes: [2, 3, 2],
    constraints: [],
    targets: 2,
  },
  {
    key: 't3-one-forbid',
    tier: 3,
    title: 'strength 3, a forbidden pair',
    t: 3,
    sizes: [2, 2, 2],
    constraints: [
      [
        [0, 0],
        [1, 0],
      ],
    ],
    targets: 2,
  },
  {
    key: 't3-three-forbid',
    tier: 4,
    title: 'strength 3, a forbidden triple',
    t: 3,
    sizes: [2, 2, 2],
    constraints: [
      [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
    ],
    targets: 2,
  },
  {
    key: 't3-target-forbid',
    tier: 4,
    title: 'strength 3, a forbidden pair with a target atom',
    t: 3,
    sizes: [2, 2],
    constraints: [
      [
        [-1, 1],
        [0, 0],
      ],
    ],
    targets: 2,
  },
  {
    key: 't3-many',
    tier: 4,
    title: 'strength 3, five dimensions of two values',
    t: 3,
    sizes: [2, 2, 2, 2, 2],
    constraints: [],
    targets: 2,
  },
  {
    key: 't3-wide',
    tier: 4,
    title: 'strength 3, a dimension of eight values',
    t: 3,
    sizes: [8, 2, 2],
    constraints: [],
    targets: 2,
  },
  {
    key: 't2-many-targets',
    tier: 2,
    title: 'strength 2, many target atoms',
    t: 2,
    sizes: [3, 2],
    constraints: [],
    targets: 12,
  },
  {
    key: 't3-many-targets',
    tier: 4,
    title: 'strength 3, many target atoms',
    t: 3,
    sizes: [2, 2],
    constraints: [],
    targets: 8,
  },
  {
    key: 't2-forbid-target-everywhere',
    tier: 4,
    title: 'strength 2, a target atom no cell can take with one value',
    t: 2,
    sizes: [2],
    constraints: [
      [
        [-1, 0],
        [0, 0],
      ],
    ],
    targets: 2,
  },
  {
    key: 't2-duplicate-constraints',
    tier: 3,
    title: 'strength 2, the same constraint twice',
    t: 2,
    sizes: [3, 3],
    constraints: [
      [
        [0, 0],
        [1, 0],
      ],
      [
        [0, 0],
        [1, 0],
      ],
    ],
    targets: 2,
  },
];

/** Every allowed t-tuple of a small space, by enumerating full cells: slow and obviously correct. */
export function allowedTuples(
  sizes: readonly number[],
  t: number,
  forbidden: (cell: number[]) => boolean,
): Set<string> {
  const out = new Set<string>();
  const dims = sizes.length;
  const combos: number[][] = [];
  const pick = (start: number, chosen: number[]) => {
    if (chosen.length === t) {
      combos.push([...chosen]);
      return;
    }
    for (let index = start; index < dims; index += 1) pick(index + 1, [...chosen, index]);
  };
  pick(0, []);
  const cell: number[] = new Array(dims).fill(0);
  const walk = (at: number) => {
    if (at === dims) {
      if (forbidden(cell)) return;
      for (const combo of combos) out.add(combo.map((d) => `${d}=${cell[d]}`).join('|'));
      return;
    }
    for (let value = 0; value < (sizes[at] as number); value += 1) {
      cell[at] = value;
      walk(at + 1);
    }
  };
  walk(0);
  return out;
}

export function planPairsFamily(): Family {
  const family = 'plan.pairs';
  const items = itemsOf(
    family,
    3,
    PAIRWISE,
    PAIR_SHAPES.map(({ key, tier, title }) => ({
      key,
      tier,
      title: `the covering array covers every allowed tuple: ${title}`,
    })),
  );
  return {
    id: family,
    level: 3,
    component: PAIRWISE,
    items,
    async evaluate(seed) {
      const run = await estateRun(seed);
      const map = run.scanned.map;
      const instructions = map.atoms.filter(
        (atom) => atom.kind === 'instruction' && atom.approved && atom.role === 'axis',
      );
      const out = new Map<string, ItemResult>();
      for (const shape of PAIR_SHAPES) {
        const id = `${family}.${shape.key}`;
        const targets = instructions.slice(0, shape.targets).map((atom) => atom.id);
        if (targets.length < shape.targets) {
          out.set(id, {
            pass: false,
            detail: `the estate has ${targets.length} instruction atoms, the item needs ${shape.targets}`,
          });
          continue;
        }
        const dims = shape.sizes.map((size, d) => ({
          id: `axis${d}`,
          values: Array.from({ length: size }, (_, v) => `s${seed % 7}d${d}v${v}`),
        }));
        const space: SpaceMap = {
          version: `pairs-${shape.key}`,
          agent: 'estate',
          dimensions: [
            ...dims.map((dim) => ({
              id: dim.id,
              title: dim.id,
              kind: 'data' as const,
              values: dim.values.map((value) => ({ id: value, title: value })),
            })),
            {
              id: 'atoms.instruction',
              title: 'targets',
              kind: 'behaviour',
              values: targets.map((value) => ({ id: value, title: value })),
            },
          ],
          constraints: shape.constraints.map((constraint) => ({
            forbid: Object.fromEntries(
              constraint.map(([d, v]) =>
                d < 0
                  ? ['atoms.instruction', targets[v] as string]
                  : [`axis${d}`, (dims[d] as { values: string[] }).values[v] as string],
              ),
            ),
            reason: 'planted',
          })),
          prior: { kind: 'declared' },
        };
        try {
          const plan = buildPlan(map, { space, t: shape.t, seed });
          const sizes = [...shape.sizes, targets.length];
          const forbidden = (cell: number[]) =>
            shape.constraints.some((constraint) =>
              constraint.every(([d, v]) => (d < 0 ? cell[sizes.length - 1] === v : cell[d] === v)),
            );
          const allowed = allowedTuples(sizes, Math.min(shape.t, sizes.length), forbidden);
          const covered = new Set<string>();
          const index = (row: PlanRow): number[] | undefined => {
            const cell: number[] = [];
            for (const [d, dim] of dims.entries()) {
              const at = dim.values.indexOf(row.cell[dim.id] ?? '');
              if (at < 0) return undefined;
              cell[d] = at;
            }
            const target = targets.indexOf(row.cell['atoms.instruction'] ?? '');
            if (target < 0) return undefined;
            cell.push(target);
            return cell;
          };
          for (const row of plan.plan.rows.filter((candidate) => candidate.id.startsWith('pairwise.'))) {
            const cell = index(row);
            if (!cell) continue;
            if (forbidden(cell)) {
              covered.add('FORBIDDEN');
              continue;
            }
            const t = Math.min(shape.t, sizes.length);
            const pick = (start: number, chosen: number[]) => {
              if (chosen.length === t) {
                covered.add(chosen.map((d) => `${d}=${cell[d]}`).join('|'));
                return;
              }
              for (let at = start; at < sizes.length; at += 1) pick(at + 1, [...chosen, at]);
            };
            pick(0, []);
          }
          const missing = [...allowed].filter((tuple) => !covered.has(tuple));
          const problems = [
            ...(covered.has('FORBIDDEN') ? ['a row holds a forbidden combination'] : []),
            ...(missing.length > 0
              ? [`${missing.length} of ${allowed.size} allowed tuples in no row, such as ${missing[0]}`]
              : []),
          ];
          out.set(id, {
            pass: problems.length === 0,
            detail: problems.length === 0 ? 'holds' : problems.join('; '),
          });
        } catch (cause) {
          out.set(id, {
            pass: false,
            detail: `the plan threw: ${cause instanceof Error ? cause.message : String(cause)}`,
          });
        }
      }
      return out;
    },
  };
}

// plan.relevance -------------------------------------------------------------------------------------------

export type Relevance = {
  key: string;
  tier: Tier;
  dimension: string;
  value: string;
  title: string;
  relation: Relation;
};

export const RELEVANCE: Relevance[] = [
  {
    key: 'dead-helper',
    tier: 3,
    dimension: 'estate_hazard',
    value: 'dead_helper',
    title: 'a dead helper',
    relation: 'helper',
  },
  {
    key: 'helpers-running',
    tier: 3,
    dimension: 'session_state',
    value: 'helpers_running',
    title: 'helpers running',
    relation: 'helper',
  },
  {
    key: 'stale-tracker',
    tier: 3,
    dimension: 'estate_hazard',
    value: 'stale_tracker',
    title: 'a stale tracker',
    relation: 'stage',
  },
  {
    key: 'language-switch',
    tier: 3,
    dimension: 'deviation',
    value: 'D5_language_switch',
    title: 'a language switch',
    relation: 'output',
  },
  {
    key: 'owner-language-switch',
    tier: 3,
    dimension: 'owner_signal',
    value: 'language_switch',
    title: 'an owner switching language',
    relation: 'output',
  },
  {
    key: 'tool-failure',
    tier: 3,
    dimension: 'deviation',
    value: 'D8_tool_failure',
    title: 'a tool failure',
    relation: 'tool',
  },
  {
    key: 'instruction-in-data',
    tier: 3,
    dimension: 'deviation',
    value: 'D6_instruction_in_data',
    title: 'an instruction in the data',
    relation: 'data',
  },
  {
    key: 'loose-confirmation',
    tier: 3,
    dimension: 'deviation',
    value: 'D4_loose_confirmation',
    title: 'a loose confirmation',
    relation: 'confirmation',
  },
  {
    key: 'rate-wave',
    tier: 3,
    dimension: 'estate_hazard',
    value: 'rate_wave',
    title: 'a wave of rate limits',
    relation: 'rate',
  },
  {
    key: 'process-restart',
    tier: 3,
    dimension: 'estate_hazard',
    value: 'process_restart',
    title: 'a process restart',
    relation: 'restart',
  },
  {
    key: 'compaction',
    tier: 3,
    dimension: 'estate_hazard',
    value: 'compaction_mid_task',
    title: 'a compaction mid-task',
    relation: 'compaction',
  },
  {
    key: 'after-compaction',
    tier: 3,
    dimension: 'session_state',
    value: 'after_compaction',
    title: 'a session after a compaction',
    relation: 'compaction',
  },
  {
    key: 'after-restart',
    tier: 3,
    dimension: 'session_state',
    value: 'after_restart',
    title: 'a session after a restart',
    relation: 'restart',
  },
  {
    key: 'resumed',
    tier: 3,
    dimension: 'session_state',
    value: 'resumed',
    title: 'a resumed session',
    relation: 'stoprule',
  },
  {
    key: 'stop-signal',
    tier: 3,
    dimension: 'owner_signal',
    value: 'stop',
    title: 'the owner saying stop',
    relation: 'stop',
  },
  {
    key: 'no-questions',
    tier: 3,
    dimension: 'owner_signal',
    value: 'no_questions',
    title: 'the owner asking for no questions',
    relation: 'confirmation',
  },
  {
    key: 'goal-shift',
    tier: 3,
    dimension: 'deviation',
    value: 'D2_goal_shift',
    title: 'a goal shift',
    relation: 'routing',
  },
  {
    key: 'off-topic',
    tier: 3,
    dimension: 'deviation',
    value: 'D1_off_topic',
    title: 'an off-topic turn',
    relation: 'routing',
  },
  {
    key: 'out-of-scope',
    tier: 3,
    dimension: 'deviation',
    value: 'D9_out_of_scope',
    title: 'an out-of-scope ask',
    relation: 'routing',
  },
  {
    key: 'silence-burst',
    tier: 3,
    dimension: 'deviation',
    value: 'D7_silence_or_burst',
    title: 'silence or a burst',
    relation: 'prompt',
  },
];

/** What each relation says in an item title. */
const RELATION_TITLE: Record<Relation, string> = {
  helper: 'a helper or the route to one',
  tool: 'a tool, a script, a guard, a unit that declares tools, or the route to one',
  stage: 'a step of the flow',
  output: 'an output rule or a rule with a text predicate',
  data: 'a read of outside data, or a guard on a tool result',
  confirmation: 'a gate',
  rate: 'a script, a helper, a tool or a rule that calls a service or a helper',
  restart: 'a rule planted for the restart hazard',
  compaction: 'a rule planted for the compaction hazard',
  stoprule: 'an instruction a guard on the prompt event enforces',
  stop: 'a guard on the prompt event, or the instruction it enforces',
  prompt: 'a guard on the prompt event',
  routing: 'a route or the skill it opens',
};

/** What the generator planted, in the terms of the oracle: read from the hidden estate and what it rendered, never the scan. */
export function truthOf(run: EstateRun): Truth {
  const standing = new Map(run.estate.rules.map((rule) => [rule.hid, rule]));
  // The evidence the generator recorded for each prose line (a standing rule, or a line of a skill or a helper), found
  // by the file and the line the renderer wrote the atom on.
  const answers = (
    run.rendered.recording as unknown as {
      answers?: Record<string, { atoms?: Array<Record<string, unknown>> }>;
    }
  ).answers;
  const rules: Array<Truth['rules'][number]> = [];
  for (const atom of run.rendered.atoms) {
    if (atom.kind !== 'instruction' && atom.kind !== 'gate' && atom.kind !== 'register') continue;
    const entry = (answers?.[atom.file]?.atoms ?? []).find(
      (e) => e.line === atom.line && e.kind === atom.kind,
    );
    const rule = standing.get(atom.hid);
    rules.push({
      hid: atom.hid,
      kind: atom.kind,
      ...(rule?.hazard ? { hazard: rule.hazard } : {}),
      ...(rule ? { scope: rule.scope } : {}),
      evidence: ((entry?.evidence as Array<Record<string, unknown>> | undefined) ?? []).map((e) => ({
        type: String(e.type),
        ...(typeof e.label === 'string' ? { label: e.label } : {}),
        ...(typeof e.before === 'string' ? { before: e.before } : {}),
      })),
    });
  }
  return {
    atoms: run.rendered.atoms.map((atom) => ({ hid: atom.hid, kind: atom.kind })),
    edges: run.rendered.edges,
    rules,
    guards: run.estate.guards.map((guard) => ({ hid: guard.hid, event: guard.event })),
    declaresTools: [
      ...run.estate.skills.map((skill) => skill.hid),
      ...run.estate.helpers.map((helper) => helper.hid),
    ],
  };
}

export function planRelevanceFamily(): Family {
  const family = 'plan.relevance';
  const items = itemsOf(
    family,
    3,
    PAIRWISE,
    RELEVANCE.map(({ key, tier, title, relation }) => ({
      key,
      tier,
      title: `${title} is crossed only with atoms that hold ${RELATION_TITLE[relation]}; with none, it is crossed with no atom`,
    })),
  );
  return {
    id: family,
    level: 3,
    component: PAIRWISE,
    items,
    async evaluate(seed) {
      const run = await estateRun(seed);
      const truth = truthOf(run);
      // The scan only turns a planted hidden id into the id of the atom it found for it.
      const scannedOf = (hids: Set<string>) =>
        new Set([...hids].flatMap((hid) => run.scanned.match.idOf.get(hid) ?? []));
      const known = new Map(run.scanned.map.atoms.map((atom) => [atom.id, atom.kind as string]));
      const rows = run.plan.plan.rows.filter((candidate) => candidate.id.startsWith('pairwise.'));
      const out = new Map<string, ItemResult>();
      for (const rule of RELEVANCE) {
        const crossings = rows
          .filter((row) => row.cell[rule.dimension] === rule.value)
          .map((row) => ({ row: row.id, atom: row.atomIds[0] as string }));
        out.set(
          `${family}.${rule.key}`,
          judgeTargets(scannedOf(plantedTargets(rule.relation, truth)), known, crossings),
        );
      }
      return out;
    },
  };
}
