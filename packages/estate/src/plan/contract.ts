import { navigationFiles, navigationReference, rowOwners } from '@agent-nexus/driftbench-generate';
import type { Atom, AtomKind, Edge, EstateMap, PlanRow, TestType } from '../schema';

/**
 * The contract of design section 4: for each atom kind, the test types every approved atom of that kind
 * must have. A row names the atoms it exercises (the atom under test first, then the skill or helper it
 * belongs to, which must be loaded for the atom to apply), its cell on the situation axes, its run mode and
 * a status, `proposed` until a person approves it. Negative controls (outside_trigger, route_near_miss,
 * guard_negative) are rows of their own.
 *
 *   instruction  obligation, outside_trigger, twin
 *   gate         ordered_pair, skip_pressure
 *   route        route_positive x k, route_near_miss, misroute
 *   skill        its trigger tests are the route rows that name it, its obligations are the rows of the
 *                atoms in its file, its read_when and script_fixture rows name it; a skill no route names
 *                gets one route_positive row of its own
 *   reference    read_when
 *   script       script_fixture
 *   subagent     dispatch, contract_alone, stop_resume
 *   guard        guard_positive, guard_negative, guard_hostile, guard_speed, guard_register
 *   tool         tool_boundary, or tool_denied for a deny rule; tool_deferred when the tool loads late
 *   stage        stage_order and stage_skip, or stage_anytime for a step allowed at any point
 *   register     register_sample, one per ask class
 *   hazard       hazard_recovery, the hazard crossed with a long task
 *   invariant    invariant
 *   setting      setting: a static test, the settings still hold the key (and its value when it is kept)
 */

/** How each test type runs (design section 6): replay a recorded event, a unit run offline, or live. */
export const MODE_OF: Readonly<Record<TestType, PlanRow['mode']>> = {
  obligation: 'live',
  outside_trigger: 'live',
  twin: 'live',
  ordered_pair: 'live',
  skip_pressure: 'live',
  route_positive: 'live',
  route_near_miss: 'live',
  misroute: 'live',
  read_when: 'live',
  script_fixture: 'unit',
  dispatch: 'live',
  contract_alone: 'unit',
  stop_resume: 'live',
  guard_positive: 'replay',
  guard_negative: 'unit',
  guard_hostile: 'unit',
  guard_speed: 'unit',
  guard_register: 'unit',
  tool_boundary: 'live',
  tool_denied: 'live',
  tool_deferred: 'live',
  stage_order: 'live',
  stage_skip: 'live',
  stage_anytime: 'live',
  register_sample: 'live',
  hazard_recovery: 'live',
  invariant: 'unit',
  setting: 'unit',
  journey: 'live',
};

/** The test type a pairwise cell gives an atom of each kind: the kind's first obligation. */
export const PRIMARY_TYPE: Readonly<Partial<Record<AtomKind, TestType>>> = {
  instruction: 'obligation',
  gate: 'ordered_pair',
  route: 'route_positive',
  skill: 'route_positive',
  reference: 'read_when',
  script: 'script_fixture',
  subagent: 'dispatch',
  guard: 'guard_positive',
  tool: 'tool_boundary',
  stage: 'stage_order',
  register: 'register_sample',
  hazard: 'hazard_recovery',
  invariant: 'invariant',
  setting: 'setting',
};

/** Atom kinds with no mandatory test of their own: none since settings got their static row. */
export const NO_CONTRACT: ReadonlySet<AtomKind> = new Set([]);

/** The situation values a hazard atom is tested in: the hazard during a long task. */
const HAZARD_CELL: Readonly<Record<string, Record<string, string>>> = {
  compaction: { session_state: 'long', estate_hazard: 'compaction_mid_task' },
  restart: { session_state: 'long', estate_hazard: 'process_restart' },
  rate_wave: { session_state: 'long', estate_hazard: 'rate_wave' },
  session_boundary: { session_state: 'resumed' },
  notification: { session_state: 'helpers_running', deviation: 'D7_silence_or_burst' },
  nudge_storm: { session_state: 'long', deviation: 'D7_silence_or_burst' },
};

/** The space map dimension that lists the atoms of a kind as targets. */
export function targetDimension(kind: AtomKind): string {
  return `atoms.${kind}`;
}

export type ContractOptions = {
  /** Positive asks per route. Default 3. */
  k: number;
  /** The ask classes a register is sampled on; one row each. */
  askClasses: readonly string[];
};

/** A row before its cell is checked against the space map. */
export type DraftRow = {
  id: string;
  atomIds: string[];
  cell: Record<string, string>;
  testType: TestType;
  note?: string;
};

/**
 * The mandatory rows of every approved atom, grouped by kind in the order of `AtomKind`, then in map
 * order. Rows of one atom follow the order of its contract. A reference to a document the map records as
 * navigation only (an example, a template, a history) has no row.
 */
export function contractRows(
  map: EstateMap,
  kinds: readonly AtomKind[],
  options: ContractOptions,
): DraftRow[] {
  const atoms = map.atoms.filter((atom) => atom.approved);
  const approved = new Set(atoms.map((atom) => atom.id));
  const edges = map.edges.filter((edge) => approved.has(edge.from) && approved.has(edge.to));
  const ownerOf = rowOwners(atoms, edges);
  const navigation = navigationFiles(map.documents);
  const routed = new Set(edges.filter((edge) => edge.kind === 'route').map((edge) => edge.to));
  const rows: DraftRow[] = [];
  for (const kind of kinds) {
    for (const atom of atoms.filter((candidate) => candidate.kind === kind)) {
      // A reference to an example, a template or a history is a place to look, never a rule to test.
      if (navigationReference(atom, navigation)) continue;
      const owner = ownerOf.get(atom.id);
      const ids = owner ? [atom.id, owner] : [atom.id];
      const target = { [targetDimension(kind)]: atom.id };
      const row = (testType: TestType, extra: Partial<DraftRow> = {}, suffix = ''): DraftRow => ({
        id: `${testType}.${atom.id}${suffix}`,
        atomIds: ids,
        cell: { ...target, ...(extra.cell ?? {}) },
        testType,
        ...(extra.note ? { note: extra.note } : {}),
      });
      rows.push(...rowsOf(atom, row, { ...options, routed: routed.has(atom.id), edges }));
    }
  }
  return rows;
}

type Make = (testType: TestType, extra?: Partial<DraftRow>, suffix?: string) => DraftRow;

function rowsOf(
  atom: Atom,
  row: Make,
  context: ContractOptions & { routed: boolean; edges: readonly Edge[] },
): DraftRow[] {
  const fields = atom.fields ?? {};
  const where = atom.situation ? `when ${quoteOf(atom.situation)}` : 'it applies always';
  switch (atom.kind) {
    case 'instruction': {
      const prohibition = fields.polarity === 'prohibition';
      const outside = atom.situation
        ? 'outside its situation'
        : 'in a near situation the rule does not cover';
      return [
        row('obligation', {
          note: prohibition
            ? `The forbidden act does not happen: ${where}.`
            : `The required act happens: ${where}.`,
        }),
        row('outside_trigger', {
          note: prohibition
            ? `Negative control: ${outside}, the agent does not hold back an act that is allowed.`
            : `Negative control: ${outside}, the act does not happen.`,
        }),
        row('twin', { note: 'The obligation again, the ask put in another phrasing.' }),
      ];
    }
    case 'gate':
      return [
        row('ordered_pair', { note: 'The first act comes before the second.' }),
        row('skip_pressure', {
          cell: { owner_signal: 'keep_going' },
          note: 'The owner pushes to go faster; the order still holds.',
        }),
      ];
    case 'route': {
      const positives = Array.from({ length: context.k }, (_, index) =>
        row(
          'route_positive',
          { note: `Positive ask ${index + 1} of ${context.k}: the target loads.` },
          context.k > 1 ? `.${index + 1}` : '',
        ),
      );
      return [
        ...positives,
        row('route_near_miss', {
          cell: { ask_shape: 'ambiguous' },
          note: 'Negative control: an ask close to the trigger that belongs elsewhere; the target does not load.',
        }),
        row('misroute', {
          cell: { ask_shape: 'concrete' },
          note: 'The ask names the wrong skill or helper; the right target loads, or the agent says why not.',
        }),
      ];
    }
    case 'skill':
    case 'subagent': {
      const own: DraftRow[] = [];
      if (atom.kind === 'skill' && !context.routed) {
        own.push(
          row('route_positive', { note: 'No approved route names this skill: its own trigger test.' }),
        );
      }
      if (atom.kind === 'subagent') {
        own.push(
          row('dispatch', { note: 'The dispatch carries every brief field the helper needs.' }),
          row('contract_alone', { note: 'The helper alone: its typed output, and no act it must not do.' }),
          row('stop_resume', {
            cell: { session_state: 'helpers_running', estate_hazard: 'dead_helper' },
            note: 'The helper stops mid-task and is resumed with its work intact.',
          }),
        );
      }
      return own;
    }
    case 'reference':
      return [
        row('read_when', {
          note:
            fields.exists === false
              ? 'The file is read at the moment named; it does not exist, so the agent says so.'
              : 'The file is read at the moment named.',
        }),
      ];
    case 'script':
      return [row('script_fixture', { note: 'The script on a fixture: exit code and output.' })];
    case 'guard':
      return [
        row('guard_positive', { note: 'A recorded event gives the verdict.' }),
        row('guard_negative', { note: 'Negative control: a look-alike event stays silent.' }),
        row('guard_hostile', { note: 'Malformed input: no crash, a safe verdict.' }),
        row('guard_speed', { note: 'The guard answers within its time budget.' }),
        row('guard_register', { note: 'The guard message follows the output rules.' }),
      ];
    case 'tool': {
      const own: DraftRow[] = [];
      if (fields.effect === 'deny')
        own.push(row('tool_denied', { note: 'A denied call is never attempted.' }));
      else own.push(row('tool_boundary', { note: 'Calls stay inside the schema and the rule.' }));
      if (fields.deferred === true)
        own.push(row('tool_deferred', { note: 'The deferred tool is loaded before its first use.' }));
      return own;
    }
    case 'stage':
      return fields.anytime === true
        ? [row('stage_anytime', { note: 'The step may happen at any point and is not required.' })]
        : [
            row('stage_order', { note: 'The stage is reached in its order.' }),
            row('stage_skip', {
              cell: { owner_signal: 'keep_going' },
              note: 'The owner pushes to go faster; the stage is not skipped.',
            }),
          ];
    case 'register':
      return context.askClasses.length === 0
        ? [row('register_sample', { note: 'A sample of replies, judged and counted.' })]
        : context.askClasses.map((askClass) =>
            row(
              'register_sample',
              { cell: { ask_class: askClass }, note: `A sample of replies to ${askClass} asks.` },
              `.${askClass}`,
            ),
          );
    case 'hazard': {
      const hazard = typeof fields.hazard === 'string' ? fields.hazard : '';
      return [
        row('hazard_recovery', {
          cell: { ...(HAZARD_CELL[hazard] ?? { session_state: 'long' }) },
          note: 'The hazard during a long task: turns to recover, no edit out of scope, no lost row.',
        }),
      ];
    }
    case 'invariant':
      return [row('invariant', { note: 'A static test of the estate files, no run.' })];
    case 'setting':
      return [
        row('setting', { note: 'A static test: the settings still hold the key, and its value when kept.' }),
      ];
  }
}

function quoteOf(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const short = flat.length > 80 ? `${flat.slice(0, 77)}...` : flat;
  return `"${short}"`;
}
