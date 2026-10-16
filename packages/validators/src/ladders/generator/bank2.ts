import { type Assertion, canonicalJson, type Spec } from '@agent-nexus/driftbench-core';
import { stimulusText } from '@agent-nexus/driftbench-generate';
import { compileSpace, placeSpec } from '@agent-nexus/driftbench-space';
import type { BankItem, SeedData, Tier, Verdict } from './bank';
import { DEVIATION_POOL, type HiddenSpec, readTurn, type ToolRole } from './hidden';
import type { Generation } from './measure';
import { hiddenSpaceMap } from './render';

/**
 * The research and parity families of the generator bank (docs/validators.md section 12.2, items 1 to 3):
 * paths (IntellAgent and tau-bench walk every policy branch and check the end state), sequence coverage
 * (ordered pairs on the stage graph and a deviation followed by recovery, the second layer of t-wise
 * coverage for sequence-dependent faults), allocation (a stratified usage model: every value present, the
 * spread even, Hill and Pielou numbers), and contrast (CheckList and Gardner minimal pairs: a one-slot
 * change changes the Then, an irrelevant change keeps it). Every oracle reads the generated suite against
 * the hidden specification.
 */

const verdict = (pass: boolean, detail: string): Verdict => ({ pass, detail });

const C = {
  scenario: 'packages/generate/src/seed/scenario.ts#buildScenario',
  seeders: 'packages/generate/src/seed/seeders.ts',
  relations: 'packages/generate/src/seed/relations.ts',
} as const;

export const BASE_PATHS = ['new-request-full', 'status-check-lookup', 'change-request-back'] as const;
const EXTRA_PATHS = ['status-check-unclear', 'new-request-short', 'status-check-again'];
const SEEDERS = ['graph', 'twise', 'boundary', 'deviation', 'metamorphic'] as const;

/** True for a count that allows no call: 0, or a range whose maximum is 0. */
function isZeroCount(count: unknown): boolean {
  if (typeof count === 'number') return count === 0;
  const range = count as { max?: number } | undefined;
  return range?.max === 0;
}

/** Exact integer equality in each finite assertion form supported by the spec contract. */
function assertsInteger(assertion: Assertion | undefined, value: unknown): boolean {
  if (typeof value !== 'number' || !Number.isInteger(value)) return false;
  if (assertion === value) return true;
  if (assertion === null || typeof assertion !== 'object') return false;
  if ('exact' in assertion) return assertion.exact === value;
  if ('one_of' in assertion)
    return assertion.one_of.length > 0 && assertion.one_of.every((entry) => entry === value);
  return false;
}
const STAGE_UNION = ['opening', 'intake', 'check', 'choice', 'details', 'recap', 'done'];

/** The path a generated spec walks, from the scenario title (`Path <id> of <flow>: ...`). */
export function pathOf(spec: Spec): string | undefined {
  return /Path (\S+) of /.exec(spec.title ?? '')?.[1];
}

function cellOf(spec: Spec): Record<string, string> {
  return ((spec.metadata?.generated as { cell?: Record<string, string> } | undefined)?.cell ?? {}) as Record<
    string,
    string
  >;
}

function walking(generated: Generation, path: string): Spec[] {
  return generated.complete.map((loaded) => loaded.spec).filter((spec) => pathOf(spec) === path);
}

function probes(spec: Spec): string[] {
  return spec.blocks.flatMap((block) =>
    block.when && 'injection' in block.when ? [block.when.injection.class] : [],
  );
}

/**
 * A cell the hidden space map allows: no written constraint forbids it and some path of the map can reach
 * it (possible.ts). The coverage level reads the same map, so no item asks for a cell the map rules out.
 */
function allowed(hidden: HiddenSpec, cell: Record<string, string>): boolean {
  return !hiddenSpaceMap(hidden).constraints.some((constraint) =>
    Object.entries(constraint.forbid).every(([dimension, value]) => cell[dimension] === value),
  );
}

function personaOf(spec: Spec): string | undefined {
  return (spec.tags ?? []).find((tag) => tag.startsWith('persona:'))?.slice('persona:'.length);
}

// paths ---------------------------------------------------------------------------------------------------

function pathItems(): BankItem[] {
  const items: BankItem[] = [];
  const item = (
    id: string,
    tier: Tier,
    component: string,
    check: (generated: Generation) => Verdict,
  ): BankItem => ({
    id,
    family: 'paths',
    tier,
    level: 'paths',
    component,
    async check(data: SeedData) {
      return check(await data.generated());
    },
  });
  for (const id of BASE_PATHS) {
    items.push(
      item(`paths.${id}.walked`, 1, C.scenario, (generated) => {
        const specs = walking(generated, id);
        return verdict(specs.length > 0, `${specs.length} complete specs walk the path ${id}`);
      }),
      item(`paths.${id}.values`, 3, `${C.seeders}#twiseSeeder`, (generated) => {
        const path = generated.hidden.paths.find((entry) => entry.id === id);
        const specs = walking(generated, id);
        const missing = Object.entries(path?.when ?? {}).flatMap(([dimension, values]) =>
          values.filter((value) => !specs.some((spec) => cellOf(spec)[dimension] === value)),
        );
        return verdict(
          path !== undefined && specs.length > 0 && missing.length === 0,
          `${missing.length} values the path reads are walked by no complete spec: ${missing.slice(0, 4).join(', ')}`,
        );
      }),
      item(`paths.${id}.channels`, 3, `${C.seeders}#twiseSeeder`, (generated) => {
        const specs = walking(generated, id);
        const missing = generated.hidden.channels.filter(
          (channel) => !specs.some((spec) => spec.channel === channel),
        );
        return verdict(
          specs.length > 0 && missing.length === 0,
          `channels never walked on the path: ${missing.join(', ') || 'none'}`,
        );
      }),
      item(`paths.${id}.personas`, 3, `${C.seeders}#twiseSeeder`, (generated) => {
        const specs = walking(generated, id);
        const missing = generated.hidden.personas
          .map((persona) => persona.id)
          .filter((persona) => !specs.some((spec) => personaOf(spec) === persona));
        return verdict(
          specs.length > 0 && missing.length === 0,
          `personas never walked on the path: ${missing.join(', ') || 'none'}`,
        );
      }),
      item(`paths.${id}.probes`, 4, `${C.seeders}#deviationSeeder`, (generated) => {
        const path = generated.hidden.paths.find((entry) => entry.id === id);
        const flow = generated.hidden.flows.find((entry) => entry.id === path?.flow);
        const specs = walking(generated, id);
        const missing = (flow?.deviations ?? []).filter(
          (cls) => !specs.some((spec) => probes(spec).includes(cls)),
        );
        return verdict(
          path !== undefined && missing.length === 0,
          `classes the flow requires that no spec probes on this path: ${missing.join(', ') || 'none'}`,
        );
      }),
    );
  }
  items.push(
    item('paths.new-request-full.end-state', 2, C.relations, (generated) => {
      const path = generated.hidden.paths.find((entry) => entry.id === 'new-request-full');
      const last = path ? `${path.stages.at(-2)}-to-${path.stages.at(-1)}` : '';
      // A spec walks to the end when it takes the path's last move; a deviation whose recovery moves the
      // conversation elsewhere ends the walk early, and such a spec claims no end state.
      const specs = walking(generated, 'new-request-full').filter(
        (spec) =>
          !probes(spec).includes('D8_tool_failure') &&
          spec.blocks.some((block) => (block.id ?? '').endsWith(`-${last}`)),
      );
      const without = specs.filter((spec) => spec.end_state === undefined);
      return verdict(
        specs.length > 0 && without.length === 0,
        `${without.length} of ${specs.length} complete specs that walk to the end check no end state`,
      );
    }),
    item('paths.extras.walked', 3, C.scenario, (generated) => {
      const present = generated.hidden.paths.filter((path) => EXTRA_PATHS.includes(path.id));
      const missing = present
        .filter((path) => walking(generated, path.id).length === 0)
        .map((path) => path.id);
      return verdict(
        missing.length === 0,
        `extra-edge paths walked by no complete spec: ${missing.join(', ') || 'none'} (of ${present.length})`,
      );
    }),
    item('paths.all-walked', 2, C.scenario, (generated) => {
      const missing = generated.hidden.paths
        .filter((path) => walking(generated, path.id).length === 0)
        .map((path) => path.id);
      return verdict(
        missing.length === 0,
        `paths walked by no complete spec: ${missing.join(', ') || 'none'}`,
      );
    }),
    item('paths.unwalked-reported', 2, 'packages/generate/src/enumerate/generate.ts', (generated) => {
      const unwalked = new Set((generated.report?.graph.unwalked ?? []).map((entry) => entry.path));
      const notWalked = generated.hidden.paths
        .filter((path) => generated.loaded.every((result) => !result.ok || pathOf(result.spec) !== path.id))
        .map((path) => path.id);
      const silent = notWalked.filter((path) => !unwalked.has(path));
      return verdict(
        silent.length === 0,
        `paths no spec walks that the report does not list as unwalked: ${silent.join(', ') || 'none'}`,
      );
    }),
    item('paths.recorded', 2, 'packages/generate/src/seed/assemble.ts#renderDraft', (generated) => {
      const scenario = generated.complete.filter((loaded) => pathOf(loaded.spec) !== undefined);
      const unrecorded = scenario.filter(
        (loaded) => (loaded.spec.metadata?.generated as { path?: unknown } | undefined)?.path === undefined,
      );
      return verdict(
        scenario.length > 0 && unrecorded.length === 0,
        `${unrecorded.length} of ${scenario.length} scenario specs do not record their path id in metadata.generated`,
      );
    }),
  );
  // The map's reply_language relation governs every reply, and a tool the spec never calls is closed: each
  // seeder's complete specs state the language on every block and forbid (or expect 0 times) every unused tool.
  for (const seeder of SEEDERS) {
    const own = (generated: Generation) =>
      generated.complete
        .map((loaded) => loaded.spec)
        .filter((spec) => (spec.metadata?.generated as { seeder?: string } | undefined)?.seeder === seeder);
    items.push(
      item(`paths.lang.${seeder}`, 2, C.scenario, (generated) => {
        const wanted = generated.hidden.lang.toUpperCase();
        const specs = own(generated);
        const silent = specs.flatMap((spec) =>
          spec.blocks
            .map((block, index) => ({ block, index }))
            .filter(({ block }) => block.expect?.lang?.toUpperCase() !== wanted)
            .map(({ block, index }) => `${spec.id}#${block.id ?? index}`),
        );
        return verdict(
          specs.length > 0 && silent.length === 0,
          `${silent.length} blocks of ${specs.length} complete ${seeder} specs state no reply language ${wanted}: ${silent.slice(0, 3).join(', ')}`,
        );
      }),
      item(`paths.closed-tools.${seeder}`, 3, C.scenario, (generated) => {
        const specs = own(generated);
        const open: string[] = [];
        for (const spec of specs) {
          const called = new Set(
            spec.blocks.flatMap((block) =>
              (block.expect?.tools ?? [])
                .filter((tool) => !isZeroCount(tool.count))
                .map((tool) => tool.label),
            ),
          );
          for (const tool of generated.hidden.tools) {
            if (called.has(tool.name)) continue;
            const forbidden = spec.rules?.forbidden_tools?.includes(tool.name) ?? false;
            const zero = spec.blocks.every((block) =>
              (block.expect?.tools ?? []).some(
                (entry) => entry.label === tool.name && isZeroCount(entry.count),
              ),
            );
            if (!forbidden && !zero) open.push(`${spec.id}: ${tool.name}`);
          }
        }
        return verdict(
          specs.length > 0 && open.length === 0,
          `${open.length} tools a complete ${seeder} spec never calls are neither forbidden nor expected 0 times: ${open.slice(0, 3).join(', ')}`,
        );
      }),
    );
  }
  return items;
}

// sequence ------------------------------------------------------------------------------------------------

function sequenceItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const cls of DEVIATION_POOL) {
    items.push(
      {
        id: `sequence.after.${cls}`,
        family: 'sequence',
        tier: 3,
        level: 'sequence',
        component: C.scenario,
        async check(data) {
          const generated = await data.generated();
          const continued = generated.complete.some(({ spec }) => {
            const at = spec.blocks.findIndex(
              (block) =>
                block.when !== undefined && 'injection' in block.when && block.when.injection.class === cls,
            );
            return at >= 0 && at < spec.blocks.length - 1;
          });
          return verdict(
            continued,
            continued
              ? `a spec goes on after its ${cls} probe`
              : `no complete spec goes on after a ${cls} probe: recovery is never followed by the rest of the flow`,
          );
        },
      },
      {
        id: `sequence.stages.${cls}`,
        family: 'sequence',
        tier: 4,
        level: 'sequence',
        component: `${C.seeders}#deviationSeeder`,
        async check(data) {
          const generated = await data.generated();
          const hidden = generated.hidden;
          const flows = hidden.flows.filter((flow) => flow.deviations.includes(cls)).map((flow) => flow.id);
          const stages = new Set(
            hidden.paths
              .filter((path) => flows.includes(path.flow))
              .flatMap((path) => path.stages.slice(1, -1)),
          );
          const reachable = [...stages].filter((stage) => allowed(hidden, { deviation: cls, stage }));
          const probedAt = new Set<string>();
          for (const { spec } of generated.complete) {
            spec.blocks.forEach((block, index) => {
              if (!block.when || !('injection' in block.when) || block.when.injection.class !== cls) return;
              const before = spec.blocks
                .slice(0, index)
                .reverse()
                .find((earlier) => earlier.expect?.stage !== undefined)?.expect?.stage;
              if (before) probedAt.add(before);
            });
          }
          const missing = reachable.filter((stage) => !probedAt.has(stage));
          // A probe at a stage the map rules out for the class tests a conversation that cannot happen.
          const ruledOut = [...probedAt].filter((stage) => !allowed(hidden, { deviation: cls, stage }));
          return verdict(
            reachable.length > 0 && missing.length === 0 && ruledOut.length === 0,
            `stages where ${cls} can arrive but is never probed: ${missing.join(', ') || 'none'}; stages the map rules out for ${cls} but probed: ${ruledOut.join(', ') || 'none'}`,
          );
        },
      },
    );
  }
  for (const stage of STAGE_UNION) {
    items.push({
      id: `sequence.through.${stage}`,
      family: 'sequence',
      tier: 3,
      level: 'sequence',
      component: C.scenario,
      async check(data) {
        const generated = await data.generated();
        const hidden = generated.hidden;
        if (!hidden.stages.some((entry) => entry.id === stage))
          return verdict(true, `the hidden graph has no stage ${stage}`);
        const wanted = new Set<string>();
        for (const path of hidden.paths) {
          path.stages.forEach((at, index) => {
            if (at === stage && index > 0 && index < path.stages.length - 1)
              wanted.add(`${path.stages[index - 1]}>${at}>${path.stages[index + 1]}`);
          });
        }
        const walked = new Set<string>();
        for (const { spec } of generated.complete) {
          const seen = [
            hidden.start,
            ...spec.blocks
              .filter((block) => !(block.when && 'injection' in block.when))
              .map((block) => block.expect?.stage ?? ''),
          ];
          for (let index = 1; index + 1 < seen.length; index += 1)
            walked.add(`${seen[index - 1]}>${seen[index]}>${seen[index + 1]}`);
        }
        const missing = [...wanted].filter((pair) => !walked.has(pair));
        return verdict(
          missing.length === 0,
          `${missing.length} of ${wanted.size} ordered edge pairs through ${stage} walked by no complete spec: ${missing.join(', ')}`,
        );
      },
    });
  }
  return items;
}

// allocation ----------------------------------------------------------------------------------------------

function counts(generated: Generation, dimension: string): Map<string, number> {
  const hidden = generated.hidden;
  const values =
    dimension === 'behaviour'
      ? hidden.behaviours.map((entry) => entry.id)
      : dimension === 'deviation'
        ? [...DEVIATION_POOL]
        : dimension === 'channel'
          ? hidden.channels
          : dimension === 'stage'
            ? hidden.stages.map((entry) => entry.id)
            : hidden.personas.map((entry) => entry.id);
  const out = new Map(values.map((value) => [value, 0]));
  const add = (value: string | undefined) => {
    if (value !== undefined && out.has(value)) out.set(value, (out.get(value) ?? 0) + 1);
  };
  // Stage and deviation are event-level strata. Use the same placement contract as coverage:
  // blocks and declared perturbations both count; a deviation is placed where it arrives,
  // not at its recovery destination. Spec-level strata below retain their per-spec unit.
  if (dimension === 'stage' || dimension === 'deviation') {
    const space = compileSpace(hiddenSpaceMap(hidden));
    const index = space.dimensions.findIndex((entry) => entry.id === dimension);
    for (const { spec } of generated.complete) {
      for (const event of placeSpec(space, spec).events) {
        for (const position of event.values[index] ?? []) add(space.dimensions[index]?.values[position]?.id);
      }
    }
    return out;
  }
  for (const { spec } of generated.complete) {
    if (dimension === 'behaviour') for (const id of spec.covers ?? []) add(id);
    else if (dimension === 'channel') add(spec.channel);
    else if (dimension === 'user_type') add(personaOf(spec));
  }
  return out;
}

function allocationItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const dimension of ['behaviour', 'deviation', 'channel', 'stage', 'user_type']) {
    const stat = (
      name: string,
      tier: Tier,
      test: (values: number[], keys: string[]) => [boolean, string],
    ): BankItem => ({
      id: `allocation.${dimension}.${name}`,
      family: 'allocation',
      tier,
      level: 'allocation',
      component: dimension === 'stage' ? C.scenario : `${C.seeders}#twiseSeeder`,
      async check(data) {
        const map = counts(await data.generated(), dimension);
        const [pass, detail] = test([...map.values()], [...map.keys()]);
        return verdict(
          pass,
          `${detail}; counts ${[...map.entries()].map(([key, value]) => `${key} ${value}`).join(', ')}`,
        );
      },
    });
    const entropy = (values: number[]) => {
      const total = values.reduce((sum, value) => sum + value, 0);
      return total === 0
        ? 0
        : -values
            .filter((value) => value > 0)
            .reduce((sum, value) => sum + (value / total) * Math.log(value / total), 0);
    };
    items.push(
      stat('present', 2, (values, keys) => {
        const missing = keys.filter((_, index) => values[index] === 0);
        return [missing.length === 0, `values no complete spec places on: ${missing.join(', ') || 'none'}`];
      }),
      stat('ratio', 3, (values) => {
        const max = Math.max(...values);
        const min = Math.min(...values);
        return [
          min > 0 && max / min <= 3,
          `the most placed value has ${max}, the least ${min} (ratio at most 3)`,
        ];
      }),
      stat('evenness', 4, (values) => {
        const j = values.length > 1 ? entropy(values) / Math.log(values.length) : 1;
        return [j >= 0.9, `Pielou evenness ${j.toFixed(3)} (at least 0.9)`];
      }),
      stat('hill1', 3, (values) => {
        const d1 = Math.exp(entropy(values));
        return [
          d1 >= 0.8 * values.length,
          `Hill number of order 1 is ${d1.toFixed(2)} for ${values.length} values (at least 0.8 of them)`,
        ];
      }),
    );
  }
  return items;
}

// contrast ------------------------------------------------------------------------------------------------

/**
 * An invariance pair holds the initial facts and ordered stimuli fixed. Approved phrases supply their
 * meaning and bound values; persona introductions alone may vary. Transition intents carry the stage
 * sequence, never an expected stage (a wrong Then must not split its own pair). Unknown wording stays
 * literal. Block ids and generation labels are bookkeeping, not conversational input.
 */
export function heldFixed(spec: Spec, hidden: HiddenSpec): string {
  const message = (text: string): unknown => {
    const turn = readTurn(hidden, text);
    if (!turn) return { text };
    const { intent, slots } = turn;
    if (intent.kind === 'persona') return { intent: { kind: 'persona' }, slots };
    if (intent.kind === 'transition') {
      const edge = hidden.transitions.find((edge) => edge.id === intent.edge);
      if (edge) return { intent: { kind: 'transition', from: edge.from, to: edge.to }, slots };
    }
    return { intent, slots };
  };
  return canonicalJson({
    data: Object.entries(cellOf(spec))
      .filter(([key]) => key.includes('.in.') || key.includes('.out.'))
      .sort(),
    given: spec.given,
    lang: spec.lang,
    turns: spec.blocks.map((block) => ({
      given: block.given,
      when: !block.when
        ? undefined
        : 'user' in block.when
          ? { user: message(block.when.user) }
          : 'burst' in block.when
            ? { burst: block.when.burst.map(message) }
            : { injection: { class: block.when.injection.class, user: message(block.when.injection.user) } },
    })),
  });
}

/** The machine expectations of a spec's blocks: what an invariance pair is compared on. */

function thens(spec: Spec): string {
  return JSON.stringify(spec.blocks.map((block) => ({ ...block.expect, criteria: undefined })));
}

function contrastItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const role of ['read', 'list', 'write'] as ToolRole[]) {
    for (const [i, j] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ] as const) {
      items.push({
        id: `contrast.${role}.enum.${i}-${j}`,
        family: 'contrast',
        tier: 3,
        level: 'contrast',
        component: C.relations,
        async check(data) {
          const generated = await data.generated();
          const tool = generated.hidden.tools.find((entry) => entry.role === role);
          const property = tool?.input[0];
          if (!tool || property?.type !== 'enum') return verdict(false, 'no enum input');
          if (!generated.hidden.paths.some((path) => path.stages.includes(tool.stage ?? '-')))
            return verdict(true, `no path calls ${tool.name}`);
          const dimension = `${tool.name}.in.${property.name}`;
          const holding = (member: string) =>
            generated.complete.filter(
              ({ spec }) =>
                cellOf(spec)[dimension] === `${dimension}.${member}` && pathOf(spec) !== undefined,
            );
          const a = holding(property.members[i] as string);
          const b = holding(property.members[j] as string);
          const found = a.some((left) =>
            b.some(
              (right) =>
                pathOf(left.spec) === pathOf(right.spec) &&
                JSON.stringify(
                  left.spec.blocks.map(
                    (block) => (block.expect?.tools ?? []).find((entry) => entry.label === tool.name)?.input,
                  ),
                ) !==
                  JSON.stringify(
                    right.spec.blocks.map(
                      (block) =>
                        (block.expect?.tools ?? []).find((entry) => entry.label === tool.name)?.input,
                    ),
                  ),
            ),
          );
          return verdict(
            found,
            `${a.length} and ${b.length} scenario specs hold members ${property.members[i]} and ${property.members[j]}; ${found ? 'a pair on one path expects different inputs' : 'no pair on one path expects different inputs for the change'}`,
          );
        },
      });
    }
    for (const [low, high] of [
      ['at-minimum', 'above-minimum'],
      ['below-maximum', 'at-maximum'],
    ] as const) {
      items.push({
        id: `contrast.${role}.integer.${low}-${high}`,
        family: 'contrast',
        tier: 2,
        level: 'contrast',
        component: 'packages/generate/src/seed/values.ts#inputAssertion',
        async check(data) {
          const generated = await data.generated();
          const tool = generated.hidden.tools.find((entry) => entry.role === role);
          const property = tool?.input[1];
          if (!tool || property?.type !== 'integer') return verdict(false, 'no integer input');
          const dimension = `${tool.name}.in.${property.name}`;
          // The approved data request identifies the measured block. A scenario's earlier call may
          // legitimately use the default on both sides; labels and cell metadata are not stimuli.
          // Read-only requests must assert the exact requested integer and one call. A direct request
          // to a side-effecting tool does not supply the required confirmation, so both values forbid
          // the call. Equal refusals follow the contract; missing or permissive assertions do not.
          const measured = [low, high].map((partition) => {
            const value = generated.hidden.data.find((entry) => entry.id === `${dimension}.${partition}`);
            const blocks = generated.complete.flatMap(({ spec }) =>
              spec.blocks.filter((block) => {
                const read = block.when && readTurn(generated.hidden, stimulusText(block.when));
                return read?.intent.kind === 'data' && read.intent.value === value?.id;
              }),
            );
            const wrong = blocks.filter((block) => {
              const assertions = (block.expect?.tools ?? []).filter((entry) => entry.label === tool.name);
              return (
                assertions.length === 0 ||
                assertions.some((entry) => {
                  if (tool.sideEffect) return !isZeroCount(entry.count);
                  const once =
                    entry.count === 1 ||
                    (typeof entry.count === 'object' && entry.count.min === 1 && entry.count.max === 1);
                  return !once || !assertsInteger(entry.input?.[property.name], value?.value);
                })
              );
            });
            return {
              partition,
              value: value?.value,
              present: value !== undefined && !value.invalid,
              blocks: blocks.length,
              wrong: wrong.length,
            };
          });
          return verdict(
            measured.every((entry) => entry.present && entry.blocks > 0 && entry.wrong === 0),
            measured
              .map(
                (entry) =>
                  `${property.name} ${entry.partition} (${String(entry.value)}): ${entry.blocks} approved request blocks, ${entry.wrong} wrong assertions; expected ${tool.sideEffect ? 'no direct side-effect call' : 'one call with the exact requested integer'}`,
              )
              .join('; '),
          );
        },
      });
    }
  }
  for (const path of BASE_PATHS) {
    items.push(
      {
        id: `invariance.${path}.persona`,
        family: 'contrast',
        tier: 4,
        level: 'contrast',
        component: `${C.seeders}#metamorphicSeeder`,
        async check(data) {
          const generated = await data.generated();
          const specs = walking(generated, path).filter((spec) => probes(spec).length === 0);
          // Invariance varies persona/channel while holding all input and returned data and the turns fixed.
          const keys = new Map(specs.map((spec) => [spec, heldFixed(spec, generated.hidden)]));
          const slots = (spec: Spec) => keys.get(spec);
          const pair = specs.some((left) =>
            specs.some((right) => personaOf(left) !== personaOf(right) && slots(left) === slots(right)),
          );
          const equal = specs.every((left) =>
            specs.every((right) => slots(left) !== slots(right) || thens(left) === thens(right)),
          );
          return verdict(
            pair && equal,
            pair
              ? equal
                ? 'specs that differ only in persona expect the same'
                : 'two specs that differ only in persona expect different things'
              : 'no two complete specs walk the path with the same values and different personas',
          );
        },
      },
      {
        id: `contrast.${path}.values`,
        family: 'contrast',
        tier: 3,
        level: 'contrast',
        component: C.relations,
        async check(data) {
          const generated = await data.generated();
          const specs = walking(generated, path).filter((spec) => probes(spec).length === 0);
          const slots = (spec: Spec) =>
            JSON.stringify(
              Object.entries(cellOf(spec))
                .filter(([key]) => key.includes('.in.'))
                .sort(),
            );
          const found = specs.some((left) =>
            specs.some((right) => slots(left) !== slots(right) && thens(left) !== thens(right)),
          );
          return verdict(
            found,
            found
              ? 'two specs with different slot values expect different things'
              : 'no two complete specs walk the path with different slot values',
          );
        },
      },
      {
        id: `invariance.${path}.channel`,
        family: 'contrast',
        tier: 4,
        level: 'contrast',
        component: `${C.seeders}#metamorphicSeeder`,
        async check(data) {
          const generated = await data.generated();
          const specs = walking(generated, path).filter((spec) => probes(spec).length === 0);
          // Invariance varies persona/channel while holding all input and returned data and the turns fixed.
          const keys = new Map(specs.map((spec) => [spec, heldFixed(spec, generated.hidden)]));
          const slots = (spec: Spec) => keys.get(spec);
          const pair = specs.some((left) =>
            specs.some((right) => left.channel !== right.channel && slots(left) === slots(right)),
          );
          const equal = specs.every((left) =>
            specs.every((right) => slots(left) !== slots(right) || thens(left) === thens(right)),
          );
          return verdict(
            pair && equal,
            pair
              ? equal
                ? 'specs that differ only in channel expect the same'
                : 'two specs that differ only in channel expect different things'
              : 'no two complete specs walk the path with the same values on different channels',
          );
        },
      },
    );
  }
  return items;
}

/** The research and parity families. */
export function researchItems(): BankItem[] {
  return [...pathItems(), ...sequenceItems(), ...allocationItems(), ...contrastItems()];
}
