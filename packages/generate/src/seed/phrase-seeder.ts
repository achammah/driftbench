/** Phrases no complete spec says: each said once at the stage after the walk's first move. */

import type { ToolExpect } from '@agent-nexus/driftbench-core';
import { NONE } from '@agent-nexus/driftbench-space';
import { FLOW_DIMENSION, type PathRelation, type ProposalPhrase } from '../extract/proposal';
import { type Pick, pickOf, type SpecDraft } from './assemble';
import { dimensionId, type PreparedMap } from './map';
import { slotsOf } from './relations';
import { type SeedContext, scenarioDraft } from './seed-drafts';

/** The dimensions whose phrases ask for something without moving the walk: a behaviour, a flow. */
const ASKING = new Set(['behaviour', FLOW_DIMENSION]);

/** An approved phrase the seeder tried to say and no walk could hold, with each reason a walk gave. */
export type UnsaidPhrase = { dimension: string; value: string; text: string; reasons: string[] };

/** A phrase the seeder may place: what it is about, and what its turn expects of a tool. */
type Plan = {
  phrase: ProposalPhrase;
  target: Pick;
  dimension: string;
  found: ReturnType<PreparedMap['toolDimensions']['get']>;
  tools: ToolExpect[];
  /** A behaviour stays in its inventory flows; without an inventory, an explicit path lists it. */
  flows?: string[];
};

/** A placed phrase that holds a (stage, flow) slot of its dimension. */
type Holder = { plan: Plan; id: string; index: number };

/**
 * One spec per approved phrase of a behaviour, flow or data value that no complete spec says yet. The walk's
 * moves reach a stage, then the user says the phrase there; the Then is that stage, the conversation
 * staying where it was. A phrase about a side-effecting tool expects no run of it (it runs after its own move
 * only); a phrase asking for another tool's returned value expects one run. A phrase that states slot
 * values (`binds`, or a `{slot}`) is left out: a stage-only Then cannot judge the values it carries.
 * A phrase no free slot holds may take the slot of a placed sibling that can move to another free slot;
 * a phrase that still finds none goes to `unsaid`, with the reasons the walks gave.
 */
export function phraseDrafts(
  prepared: PreparedMap,
  context: SeedContext,
  said: ReadonlySet<string>,
  first: number,
  unsaid?: UnsaidPhrase[],
): SpecDraft[] {
  const sideEffecting = new Set(
    prepared.relations.paths.flatMap((path) =>
      path.end_state ? [path.end_state.source.replace(/^tool:/, '')] : [],
    ),
  );
  const drafts: SpecDraft[] = [];
  const asked = new Set<string>();
  // The (stage, flow) slots each dimension's placed phrases hold, and which phrase holds each.
  const holders = new Map<string, Map<string, Holder>>();
  const holding = (dimension: string) => {
    const own = holders.get(dimension) ?? new Map<string, Holder>();
    holders.set(dimension, own);
    return own;
  };
  const deepest = Math.max(0, ...prepared.relations.paths.map((path) => path.stages.length - 1));
  const flowAt = prepared.space.dimensions.findIndex((entry) => entry.id === FLOW_DIMENSION);
  const slotOf = (path: PathRelation, at: number) => `${path.stages[at]}@${path.flow}`;
  // A tool's value is asked for after a move that already ran the tool, whose Then checks the call and
  // the reply: a fault on the tool's arguments or its reported fields shows there first.
  const ran = (path: PathRelation, at: number, tool: string) =>
    prepared.relations.usesTools.some(
      (use) =>
        use.tool === tool &&
        use.subject.dimension === FLOW_DIMENSION &&
        use.subject.value === path.flow &&
        path.stages.some(
          (stage, index) => index < at && stage === use.stage && path.stages[index + 1] === use.to,
        ),
    );
  // A free phrase closes only the calls the map declares for it. A behaviour phrase is said once the walk's
  // moves have run every read tool its flow calls, so a fault on such a call shows at the move first. Two such
  // phrases of one dimension at the same stage of the same flow are one-slot siblings with the same Then, which
  // the gate rejects when the reference answers them differently; each takes a stage and flow none of its
  // siblings holds, and the flow joins its cell.
  const readTools = (path: PathRelation) => [
    ...new Set(
      prepared.relations.usesTools
        .filter(
          (use) =>
            use.subject.dimension === FLOW_DIMENSION &&
            use.subject.value === path.flow &&
            !sideEffecting.has(use.tool),
        )
        .map((use) => use.tool),
    ),
  ];
  const exercised = (path: PathRelation, at: number) => readTools(path).every((tool) => ran(path, at, tool));

  /** The phrase's plan, or undefined when the seeder leaves it out. */
  const planOf = (phrase: ProposalPhrase): Plan | undefined => {
    if (Object.keys(phrase.binds ?? {}).length > 0 || slotsOf(phrase.text).length > 0) return undefined;
    const target = pickOf(prepared, phrase);
    if (!target || phrase.value === NONE) return undefined;
    const dimension = dimensionId(prepared, target[0]);
    const found = prepared.toolDimensions.get(target[0]);
    if (!ASKING.has(dimension) && !found) return undefined;
    const tools: ToolExpect[] = [];
    if (found && sideEffecting.has(found.tool.name)) tools.push({ label: found.tool.name, count: 0 });
    else if (found?.direction === 'out') tools.push({ label: found.tool.name, count: 1 });
    else if (found) return undefined;
    const flows = found
      ? undefined
      : dimension === FLOW_DIMENSION
        ? [phrase.value]
        : prepared.inventory
          ? prepared.inventory.flows
              .filter((flow) => flow.behaviours.includes(phrase.value))
              .map((flow) => flow.id)
          : [
              ...new Set(
                prepared.relations.paths
                  .filter((path) => path.behaviours?.includes(phrase.value))
                  .map((path) => path.flow),
              ),
            ];
    return { phrase, target, dimension, found, tools, ...(flows ? { flows } : {}) };
  };

  /**
   * Builds the phrase's spec in one pass: the first pass says it before a walk's last stage, the second at the
   * last stage of a walk. `taken` names the slots it may not use; `wanted`, when given, the only one it may.
   */
  const place = (
    plan: Plan,
    id: string,
    last: boolean,
    taken: (slot: string) => boolean,
    wanted?: string,
  ): { draft: SpecDraft; slot?: string } | { reasons: string[] } => {
    const { phrase, target, dimension, found, tools } = plan;
    const reasons: string[] = [];
    if (plan.flows && !prepared.relations.paths.some((path) => plan.flows?.includes(path.flow)))
      return { reasons: [`no approved path walks an owning flow for ${dimension}=${phrase.value}`] };
    // Two phrases of one dimension said at the same stage are one-slot siblings with the same Then; when the
    // reference answers them differently (one runs a tool, one saves a file) the gate rightly rejects the
    // pair. A phrase asking for something goes to a stage no other phrase of its dimension is said at, the
    // first one along the walk; a tool's value is said after the first move, its siblings answering alike.
    const tries = found
      ? [
          ...Array.from({ length: Math.max(0, deepest - 1) }, (_, index) => ({
            at: index + 2,
            fresh: false,
            after: true,
          })),
          { at: 1, fresh: false, after: false },
        ]
      : last
        ? // The second pass tries each walk at its last stage: every walk with no end state before any walk
          // with one, then the shorter walk first.
          prepared.relations.paths
            .map((path, order) => ({ path, order }))
            .sort(
              (a, b) =>
                Number(a.path.end_state !== undefined) - Number(b.path.end_state !== undefined) ||
                a.path.stages.length - b.path.stages.length ||
                a.order - b.order,
            )
            .map(({ path }) => ({ at: path.stages.length - 1, fresh: true, after: true, only: path }))
        : [
            // No fallback: a sibling at a held stage and flow is rejected by the gate whenever the reference
            // answers the two differently, and the map does not say when that is.
            ...Array.from({ length: deepest }, (_, index) => ({
              at: index + 1,
              fresh: true,
              after: true,
            })),
          ];
    for (const { at, fresh, after, only } of tries as Array<{
      at: number;
      fresh: boolean;
      after: boolean;
      only?: PathRelation;
    }>) {
      // The first pass says a phrase before a walk's last stage. The second says the phrases left over at the
      // last stage, after the walk's last move, which cuts nothing: the walk still checks its end state.
      const fits = (path: PathRelation) =>
        (only ? path === only : path.stages.length > at + 1) &&
        (plan.flows === undefined || plan.flows.includes(path.flow)) &&
        !(fresh && taken(slotOf(path, at))) &&
        (wanted === undefined || slotOf(path, at) === wanted) &&
        (!after ||
          (found ? ran(path, at, found.tool.name) : dimension === FLOW_DIMENSION || exercised(path, at)));
      const candidates = prepared.relations.paths.filter(fits);
      const own = candidates.filter((path) => dimension !== FLOW_DIMENSION || path.flow === phrase.value);
      const order = found
        ? [candidates]
        : [...own, ...candidates.filter((path) => !own.includes(path))].map((path) => [path]);
      for (const paths of order) {
        if (paths.length === 0) continue;
        const path = paths.length === 1 ? paths[0] : undefined;
        const flow = path ? prepared.space.dimensions[flowAt]?.index.get(path.flow) : undefined;
        // The flow joins the cell; a flow phrase's own value is its flow already.
        const carries: Pick[] = [
          target,
          ...(found || flow === undefined || target[0] === flowAt ? [] : [[flowAt, flow] as Pick]),
        ];
        // The scenario resolves all declared read calls against its actual stage, conditions and slots,
        // and states the returned fields of each applicable call.
        const runs =
          found || dimension === FLOW_DIMENSION
            ? []
            : prepared.relations.usesTools.filter(
                (use) =>
                  use.subject.dimension === dimension &&
                  use.subject.value === phrase.value &&
                  !sideEffecting.has(use.tool),
              );
        const attempt = scenarioDraft(
          prepared,
          context,
          id,
          'cover',
          `Phrase of ${dimension}=${phrase.value}`,
          [target],
          found
            ? { preferred: own, others: candidates.filter((entry) => !own.includes(entry)) }
            : { preferred: paths, others: [] },
          {
            turn: {
              stimulus: { kind: 'phrase', phrase },
              carries,
              tools,
              ...(runs.length > 0 ? { usesTools: runs } : {}),
              free: !found,
              at,
              ...(found?.direction === 'out' && !sideEffecting.has(found.tool.name)
                ? { report: found.tool.name }
                : {}),
            },
          },
        );
        if ('draft' in attempt)
          return { draft: attempt.draft, ...(!found && path ? { slot: slotOf(path, at) } : {}) };
        reasons.push(...attempt.reasons);
      }
    }
    return { reasons };
  };

  /** Every (stage, flow) slot the phrase could be said at in either pass, held or not, in pass order. */
  const slotsFor = (plan: Plan): string[] => {
    const slots: string[] = [];
    for (const path of prepared.relations.paths)
      for (let at = 1; at < path.stages.length; at += 1) {
        const slot = slotOf(path, at);
        if (!slots.includes(slot)) slots.push(slot);
      }
    return plan.found ? [] : slots;
  };

  // A build made only to learn whether a phrase fits a slot leaves the context's value balance as it was.
  const trial = <T>(build: () => T): T => {
    const saved = context.usage
      ? new Map([...context.usage].map(([dimension, counts]) => [dimension, new Map(counts)]))
      : undefined;
    const result = build();
    if (saved) context.usage = saved;
    else delete context.usage;
    return result;
  };
  const fitsAt = (plan: Plan, id: string, slot: string) =>
    [false, true].some((last) => 'draft' in trial(() => place(plan, id, last, () => false, slot)));
  /** Builds the phrase at that slot for good, in whichever pass reaches it first. */
  const commit = (plan: Plan, id: string, slot: string): SpecDraft | undefined => {
    for (const last of [false, true]) {
      const built = place(plan, id, last, () => false, slot);
      if ('draft' in built) return built.draft;
    }
    return undefined;
  };
  // An augmenting path over the slots of one dimension: the phrase takes a slot it fits that is free, or held
  // by a sibling that can itself move to another slot. Every phrase placed so far stays said.
  const augment = (plan: Plan, id: string, visited: Set<string>): string | undefined => {
    const own = holding(plan.dimension);
    for (const slot of slotsFor(plan)) {
      if (visited.has(slot)) continue;
      if (!fitsAt(plan, id, slot)) continue;
      visited.add(slot);
      const holder = own.get(slot);
      if (holder) {
        const moved = augment(holder.plan, holder.id, visited);
        if (!moved) continue;
        const draft = commit(holder.plan, holder.id, moved);
        if (!draft) continue;
        drafts[holder.index] = draft;
        own.set(moved, holder);
        own.delete(slot);
      }
      return slot;
    }
    return undefined;
  };

  const pending: Array<{ plan: Plan; reasons: string[] }> = [];
  // The cap stops building specs, not accounting for eligible approved phrases. Include phrases
  // not visited yet as well as those already waiting for a slot, without repeating a reported gap.
  const capped = (): SpecDraft[] => {
    const reported = new Set(unsaid?.map((entry) => entry.text));
    for (const phrases of prepared.phrasesOf.values())
      for (const phrase of phrases) {
        if (said.has(phrase.text) || asked.has(phrase.text) || reported.has(phrase.text)) continue;
        const plan = planOf(phrase);
        if (!plan) continue;
        unsaid?.push({
          dimension: plan.dimension,
          value: phrase.value,
          text: phrase.text,
          reasons: [
            ...new Set([
              ...(pending.find((entry) => entry.plan.phrase === phrase)?.reasons ?? []),
              'cut by --max',
            ]),
          ],
        });
        reported.add(phrase.text);
      }
    return drafts;
  };
  // A first pass says each phrase before a walk's last stage; a second says the phrases left over at the last
  // stage of a walk with no end state, after every other phrase, so the phrases the first pass places keep
  // their ids and their streams.
  for (const last of [false, true])
    for (const phrases of prepared.phrasesOf.values()) {
      for (const phrase of phrases) {
        if (first + drafts.length >= context.max) return capped();
        if (said.has(phrase.text) || asked.has(phrase.text)) continue;
        const plan = planOf(phrase);
        if (!plan) continue;
        if (last && plan.found) continue;
        const id = `gen-phrase-${String(first + drafts.length + 1).padStart(3, '0')}`;
        const own = holding(plan.dimension);
        const built = place(plan, id, last, (slot) => own.has(slot));
        const waiting = pending.findIndex((entry) => entry.plan.phrase === phrase);
        if (!('draft' in built)) {
          if (waiting < 0) pending.push({ plan, reasons: built.reasons });
          else pending[waiting]?.reasons.push(...built.reasons);
          continue;
        }
        if (waiting >= 0) pending.splice(waiting, 1);
        if (built.slot) own.set(built.slot, { plan, id, index: drafts.length });
        asked.add(phrase.text);
        drafts.push(built.draft);
      }
    }
  // A phrase both passes left over may still be said: it takes a slot a placed sibling gives up for another.
  for (const { plan, reasons } of pending) {
    if (first + drafts.length >= context.max) return capped();
    const id = `gen-phrase-${String(first + drafts.length + 1).padStart(3, '0')}`;
    const slot = plan.found ? undefined : augment(plan, id, new Set());
    const draft = slot ? commit(plan, id, slot) : undefined;
    if (slot && draft) {
      holding(plan.dimension).set(slot, { plan, id, index: drafts.length });
      asked.add(plan.phrase.text);
      drafts.push(draft);
      continue;
    }
    // A flow no path walks (one only a task family holds) has no conversation to say its phrase in.
    const walked =
      plan.dimension !== FLOW_DIMENSION ||
      prepared.relations.paths.some((path) => path.flow === plan.phrase.value);
    unsaid?.push({
      dimension: plan.dimension,
      value: plan.phrase.value,
      text: plan.phrase.text,
      reasons: !walked
        ? [`no approved path walks the flow ${plan.phrase.value}`]
        : [...new Set(reasons.length > 0 ? reasons : ['no walk reaches a stage it can be said at'])],
    });
  }
  return drafts;
}
