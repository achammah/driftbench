import { NONE } from '@agent-nexus/driftbench-space';
import type { PathRelation } from '../extract/proposal';
import { PENDING_STAGE } from '../extract/proposal';
import type { PreparedMap } from './map';

/**
 * The pairs of axis values no conversation of the map can reach, written as constraints. A cell is worth a
 * test only when the agent's own map lets a conversation reach it (the owner's rule for the coverage target:
 * no test for a situation the map rules out), so the t-wise target counts only the tuples some possible
 * cell holds.
 *
 * An event is something said at one position of one path: the move that reaches the stage (any position
 * after the first), or a deviation class said there. A class is said at a position when the flow recovers
 * from it, a phrase of it exists, the first turn carries only a class a first message can carry, a turn
 * after the last stage only a class whose recovery stays, and a tool failure only on a turn that calls a
 * tool the flow recovers from. A pair with a stage or a deviation is possible when some event matches it
 * and the path's flow, its branch values and the pair's other value break no written constraint; a
 * behaviour belongs to the flows that list it. A map without paths says nothing about reach: no pair is
 * ruled out.
 */

/** Classes a first message can carry: they need no earlier turn. */
const FIRST_TURN: ReadonlySet<string> = new Set([
  'D1_off_topic',
  'D5_language_switch',
  'D6_instruction_in_data',
  'D9_out_of_scope',
]);

/** A constraint: dimension and value indices, all of which a cell must hold to be forbidden. */
export type Forbid = Array<[dimension: number, value: number]>;

type Cell = Record<string, string>;

export function impossibleConstraints(
  prepared: PreparedMap,
  flowsOfBehaviour: (prepared: PreparedMap, behaviour: string) => string[],
): Forbid[] {
  const { relations, space } = prepared;
  if (relations.paths.length === 0 || prepared.stage === undefined || prepared.deviation === undefined) {
    return [];
  }
  const id = (dimension: number) => space.dimensions[dimension]?.id ?? '';
  const stageId = id(prepared.stage);
  const deviationId = id(prepared.deviation);
  const written = space.constraints.map((constraint) =>
    constraint.map(([dimension, value]) => [id(dimension), space.dimensions[dimension]?.values[value]?.id]),
  );
  const allowed = (cell: Cell) =>
    !written.some(
      (constraint) => constraint.length > 0 && constraint.every(([d, v]) => cell[d as string] === v),
    );
  const behaviourDimensions = new Set(
    [...prepared.axes]
      .filter((dimension) => dimension !== prepared.transition)
      .filter((dimension) => space.dimensions[dimension]?.kind === 'behaviour' && id(dimension) !== 'flow')
      .map(id),
  );
  const deviationPhrases = new Set(
    prepared.phrases.filter((phrase) => phrase.dimension === deviationId).map((phrase) => phrase.value),
  );
  const flowDimension = space.dimensions.some((dimension) => dimension.id === 'flow');

  const recoveriesOf = (cls: string, flow: string) =>
    relations.recoveries.filter((entry) => entry.class === cls && entry.flows.includes(flow));
  const calls = (flow: string, from: string, tool: string | undefined) =>
    relations.usesTools.some(
      (use) =>
        // A move's call is the flow's own. A behaviour's call is made in its own phrase turn, and a use of any
        // other kind of value (a persona, a channel) is made only in a cell that holds that value, which the
        // reachability the map derives (extract/derive.ts) does not assume: the target counts what it counts.
        use.subject.dimension === 'flow' &&
        use.subject.value === flow &&
        use.stage === from &&
        (tool === undefined || use.tool === tool),
    );
  const said = (path: PathRelation, index: number, cls: string): boolean => {
    const stage = path.stages[index] as string;
    const last = index === path.stages.length - 1;
    const recoveries = recoveriesOf(cls, path.flow);
    if (recoveries.length === 0) return false;
    if (cls === 'D8_tool_failure') {
      if (last) return false;
      return recoveries.some((entry) => calls(path.flow, stage, entry.tool));
    }
    if (!deviationPhrases.has(cls)) return false;
    if (index === 0 && !FIRST_TURN.has(cls)) return false;
    if (
      last &&
      !recoveries.some((entry) => entry.stage_after === PENDING_STAGE || entry.stage_after === stage)
    ) {
      return false;
    }
    return true;
  };
  const fits = (path: PathRelation, cell: Cell): boolean => {
    for (const dimension of behaviourDimensions) {
      const behaviour = cell[dimension];
      if (behaviour !== undefined && !flowsOfBehaviour(prepared, behaviour).includes(path.flow)) return false;
    }
    if (flowDimension && cell.flow !== undefined && cell.flow !== path.flow) return false;
    const branches = Object.entries(path.when ?? {});
    const choose = (at: number, picks: Cell): boolean => {
      if (at === branches.length) return allowed(picks);
      const [dimension, values] = branches[at] as [string, string[]];
      return values.some((value) =>
        picks[dimension] !== undefined && picks[dimension] !== value
          ? false
          : choose(at + 1, { ...picks, [dimension]: value }),
      );
    };
    return choose(0, flowDimension ? { ...cell, flow: path.flow } : cell);
  };
  const events = relations.paths.flatMap((path) =>
    path.stages.flatMap((stage, index) => [
      ...(index >= 1 ? [{ path, stage, deviation: NONE as string }] : []),
      ...[...deviationPhrases, ...relations.recoveries.map((entry) => entry.class)]
        .filter((cls, at, all) => all.indexOf(cls) === at && said(path, index, cls))
        .map((deviation) => ({ path, stage, deviation })),
    ]),
  );
  const possible = (cell: Cell) =>
    events.some(
      (event) =>
        (cell[stageId] === undefined || cell[stageId] === event.stage) &&
        (cell[deviationId] === undefined || cell[deviationId] === event.deviation) &&
        fits(event.path, { ...cell, [stageId]: event.stage, [deviationId]: event.deviation }),
    );

  const axes = [...prepared.axes]
    .filter((dimension) => dimension !== prepared.transition)
    .sort((a, b) => a - b);
  const out: Forbid[] = [];
  axes.forEach((first, index) => {
    for (const second of axes.slice(index + 1)) {
      if (![first, second].some((axis) => axis === prepared.stage || axis === prepared.deviation)) continue;
      const firstValues = space.dimensions[first]?.values ?? [];
      const secondValues = space.dimensions[second]?.values ?? [];
      firstValues.forEach((x, xi) => {
        secondValues.forEach((y, yi) => {
          const cell: Cell = { [id(first)]: x.id, [id(second)]: y.id };
          if (!allowed(cell)) return;
          if (cell[stageId] === undefined && cell[deviationId] === NONE) return;
          if (!possible(cell)) {
            out.push([
              [first, xi],
              [second, yi],
            ]);
          }
        });
      });
    }
  });
  return out;
}
