import type { Spec } from '@agent-nexus/driftbench-core';
import { coverage, type SpaceCoverage } from '@agent-nexus/driftbench-space';
import type { BankItem, SeedData, Tier, Verdict } from './bank';
import { FAULT_CLASSES } from './faults';
import { DEVIATION_POOL, type HiddenSpec } from './hidden';
import type { Generation } from './measure';
import { matchesPhrase, phraseStimulus } from './phrase-stimulus';
import { hiddenInventory } from './render';

/**
 * Four more families of the generator bank (docs/validators.md section 12.2):
 *
 * - report: the coverage and diversity measures of the research dossier (Good-Turing discovery, Chao
 *   coverage and richness, Hill numbers, Pielou evenness, t = 3 coverage, the weighted share and its
 *   effective sample size, value coverage per axis, the required cells, the share of machine Thens), each
 *   stated in `generate-report.json` under `coverage.measures.<name>` and equal to the validator's own
 *   computation over the same axis map.
 * - phrases: every approved phrase and slot value of the bank reaches a complete spec (grammar expansion
 *   coverage).
 * - behaviours: every behaviour of the inventory is covered by a spec with a machine Then that exercises it.
 * - adequacy: a planted fault is caught at the block where it first changes what the agent does, in every
 *   spec where it changes anything (localisation, not a late consequence).
 */

const verdict = (pass: boolean, detail: string): Verdict => ({ pass, detail });
const obligation = (data: SeedData, id: string, holds: boolean): boolean =>
  data.obligation?.(id, holds) ?? holds;

// report --------------------------------------------------------------------------------------------------

type Measures = Record<string, number>;

/** The measures the report must state, computed by the validator from the generated complete specs. */
export function expectedMeasures(generated: Generation): Measures | undefined {
  const axisMap = generated.prepared?.axisMap;
  if (!axisMap) return undefined;
  const two = coverage(axisMap, generated.complete, { t: 2, inventory: hiddenInventory(generated.hidden) });
  const three: SpaceCoverage | undefined =
    axisMap.dimensions.length >= 3 ? coverage(axisMap, generated.complete, { t: 3 }) : undefined;
  const counts = two.grid.cells.map((cell) => cell.count).filter((count) => count > 0);
  const n = counts.reduce((sum, count) => sum + count, 0);
  const f1 = counts.filter((count) => count === 1).length;
  const f2 = counts.filter((count) => count === 2).length;
  const shares = counts.map((count) => count / Math.max(1, n));
  const entropy = -shares.reduce((sum, share) => sum + (share > 0 ? share * Math.log(share) : 0), 0);
  const out: Measures = {
    discovery: n === 0 ? 1 : f1 / n,
    chao_coverage: n === 0 ? 0 : 1 - (f1 / n) * (((n - 1) * f1) / ((n - 1) * f1 + 2 * f2 || 1)),
    chao1:
      counts.length +
      (n === 0 ? 0 : f2 > 0 ? ((n - 1) / n) * ((f1 * f1) / (2 * f2)) : ((n - 1) / n) * ((f1 * (f1 - 1)) / 2)),
    hill_q0: counts.length,
    hill_q1: Math.exp(entropy),
    hill_q2:
      1 /
      Math.max(
        Number.EPSILON,
        shares.reduce((sum, share) => sum + share * share, 0),
      ),
    pielou: counts.length > 1 ? entropy / Math.log(counts.length) : 1,
    t3_share: three?.grid.share ?? 0,
    t3_allowed: three?.grid.allowed ?? 0,
    weighted_share: two.grid.weighted ?? 0,
    effective_sample_size: two.grid.effectiveSampleSize ?? 0,
    required_covered: two.required.filter((cell) => cell.covered).length,
    required_total: two.required.length,
  };
  for (const dimension of two.dimensions) out[`axis_${dimension.id}`] = dimension.covered;
  let blocks = 0;
  let machine = 0;
  for (const { spec } of generated.complete) {
    for (const block of spec.blocks) {
      blocks += 1;
      const expect = block.expect ?? {};
      if (
        Object.keys(expect).some((key) => key !== 'criteria' && key !== 'ledger_add') ||
        spec.rules !== undefined
      )
        machine += 1;
    }
  }
  out.machine_then_share = blocks === 0 ? 0 : machine / blocks;
  out.judged_only_blocks = blocks - machine;
  return out;
}

export const MEASURES = [
  'discovery',
  'chao_coverage',
  'chao1',
  'hill_q0',
  'hill_q1',
  'hill_q2',
  'pielou',
  't3_share',
  't3_allowed',
  'weighted_share',
  'effective_sample_size',
  'required_covered',
  'required_total',
  'axis_behaviour',
  'axis_deviation',
  'axis_channel',
  'axis_stage',
  'axis_user_type',
  'machine_then_share',
  'judged_only_blocks',
] as const;

function reportItems(): BankItem[] {
  return MEASURES.map(
    (name): BankItem => ({
      id: `report.${name}`,
      family: 'report',
      tier: name.startsWith('axis_') || name.startsWith('required') ? 2 : 3,
      level: 'report',
      component: 'packages/generate/src/enumerate/generate.ts#generateSuite',
      async check(data: SeedData) {
        const generated = await data.generated();
        const expected = expectedMeasures(generated)?.[name];
        const stated = (generated.report?.coverage as { measures?: Record<string, unknown> } | undefined)
          ?.measures?.[name];
        if (typeof stated !== 'number') {
          return verdict(
            false,
            `generate-report.json states no coverage.measures.${name}; the validator computes ${expected}`,
          );
        }
        const ok =
          expected !== undefined && Math.abs(stated - expected) <= 1e-9 * Math.max(1, Math.abs(expected));
        return verdict(ok, `the report states ${stated}, the validator computes ${expected}`);
      },
    }),
  );
}

// phrases -------------------------------------------------------------------------------------------------

function turns(generated: Generation): string[] {
  return generated.complete.flatMap(({ spec }) =>
    spec.blocks.map((block) =>
      block.when === undefined
        ? ''
        : 'user' in block.when
          ? block.when.user
          : 'injection' in block.when
            ? block.when.injection.user
            : block.when.burst.join('\n'),
    ),
  );
}

function phraseUse(
  generated: Generation,
  select: (phrase: HiddenSpec['phrases'][number]) => boolean,
  data: SeedData,
): { used: number; total: number; missing: string[] } {
  const stimuli = generated.complete.flatMap(({ spec }) => spec.blocks.map(phraseStimulus));
  const wanted = generated.hidden.phrases.filter(select);
  const missing = wanted
    .filter((phrase) => {
      const used = stimuli.some((stimulus) =>
        matchesPhrase(
          stimulus.carrier === 'user' ? { ...stimulus, text: stimulus.text.trim() } : stimulus,
          phrase,
        ),
      );
      return !obligation(
        data,
        `phrase:${JSON.stringify([phrase.dimension, phrase.value, phrase.text, phrase.lang, phrase.intent])}`,
        used,
      );
    })
    .map((phrase) => phrase.text);
  return { used: wanted.length - missing.length, total: wanted.length, missing };
}

function phraseItems(): BankItem[] {
  const items: BankItem[] = [];
  const item = (
    id: string,
    tier: Tier,
    component: string,
    check: (generated: Generation, data: SeedData) => Verdict,
  ): BankItem => ({
    id,
    family: 'phrases',
    tier,
    level: 'phrases',
    component,
    async check(data: SeedData) {
      return check(await data.generated(), data);
    },
  });
  for (const cls of DEVIATION_POOL) {
    if (cls === 'D8_tool_failure') {
      items.push(
        item(
          'phrases.D8_tool_failure.given',
          2,
          'packages/generate/src/seed/scenario.ts#toolFailure',
          (generated, data) => {
            const failing = generated.complete.some(({ spec }) =>
              spec.blocks.some((block) =>
                Object.values(block.given?.world?.tools ?? {}).some((tool) => tool.error !== undefined),
              ),
            );
            return verdict(
              obligation(data, 'phrase:tool-failure-given', failing),
              failing ? 'a complete spec fails a tool in the Given' : 'no complete spec makes a tool fail',
            );
          },
        ),
      );
      continue;
    }
    items.push(
      item(`phrases.${cls}`, 2, 'packages/generate/src/seed/scenario.ts#buildScenario', (generated, data) => {
        const use = phraseUse(
          generated,
          (phrase) => phrase.intent.kind === 'deviation' && phrase.intent.class === cls,
          data,
        );
        return verdict(
          use.total > 0 && use.missing.length === 0,
          `${use.used} of ${use.total} approved phrases of ${cls} reach a complete spec; unused: ${use.missing.join(' | ') || 'none'}`,
        );
      }),
    );
  }
  const kinds: Array<[string, Tier, (phrase: HiddenSpec['phrases'][number], spec: HiddenSpec) => boolean]> = [
    ['transitions', 2, (phrase) => phrase.intent.kind === 'transition'],
    [
      'data-in',
      3,
      (phrase, spec) =>
        phrase.intent.kind === 'data' &&
        spec.data.find((value) => value.id === (phrase.intent as { value: string }).value)?.direction ===
          'in',
    ],
    [
      'data-out',
      3,
      (phrase, spec) =>
        phrase.intent.kind === 'data' &&
        spec.data.find((value) => value.id === (phrase.intent as { value: string }).value)?.direction ===
          'out',
    ],
    ['flows', 3, (phrase) => phrase.intent.kind === 'flow'],
    ['personas', 3, (phrase) => phrase.intent.kind === 'persona'],
    ['behaviours', 3, (phrase) => phrase.intent.kind === 'behaviour' || phrase.intent.kind === 'save'],
  ];
  for (const [name, tier, select] of kinds) {
    items.push(
      item(`phrases.${name}`, tier, 'packages/generate/src/seed/seeders.ts', (generated, data) => {
        const use = phraseUse(generated, (phrase) => select(phrase, generated.hidden), data);
        return verdict(
          use.total > 0 && use.missing.length === 0,
          `${use.used} of ${use.total} approved phrases reach a complete spec; unused: ${use.missing.slice(0, 4).join(' | ') || 'none'}`,
        );
      }),
    );
  }
  items.push(
    item('phrases.slot-values', 3, 'packages/generate/src/seed/relations.ts#fillText', (generated, data) => {
      const said = turns(generated).join('\n');
      // The value as a word of a turn: not inside a longer word, and at the end of a sentence too ("set to east.").
      const says = (value: unknown) =>
        new RegExp(
          `(?<![A-Za-z0-9_-])${String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_-])`,
        ).test(said);
      const missing = generated.hidden.data
        .filter((value) => value.binds !== undefined)
        .filter((value) => !obligation(data, `slot-value:${value.id}`, says(value.value)))
        .map((value) => value.id);
      return verdict(
        missing.length === 0,
        `slot values no complete turn says: ${missing.join(', ') || 'none'}`,
      );
    }),
    item(
      'phrases.metamorphic',
      3,
      'packages/generate/src/seed/seeders.ts#metamorphicSeeder',
      (generated, data) => {
        const multi = new Map<string, number>();
        for (const phrase of generated.hidden.phrases)
          multi.set(
            `${phrase.dimension}=${phrase.value}`,
            (multi.get(`${phrase.dimension}=${phrase.value}`) ?? 0) + 1,
          );
        const values = [...multi].filter(([, count]) => count >= 2).map(([key]) => key);
        const families = new Set(
          generated.complete.flatMap(({ spec }) => {
            const meta = spec.metadata?.generated as
              | {
                  metamorphic?: unknown;
                  blocks?: Array<{ phrase?: { dimension: string; value: string } | null }>;
                }
              | undefined;
            return meta?.metamorphic
              ? (meta.blocks ?? []).flatMap((entry) =>
                  entry.phrase ? [`${entry.phrase.dimension}=${entry.phrase.value}`] : [],
                )
              : [];
          }),
        );
        const missing = values.filter(
          (value) => !obligation(data, `metamorphic:${value}`, families.has(value)),
        );
        return verdict(
          missing.length === 0,
          `values with two or more phrases and no complete metamorphic family: ${missing.join(', ') || 'none'}`,
        );
      },
    ),
    item('phrases.no-repeat', 3, 'packages/generate/src/seed/scenario.ts#buildScenario', (generated) => {
      const repeated = generated.complete.filter(({ spec }) => {
        const said = spec.blocks.map((block) => JSON.stringify(block.when));
        return said.some((text, index) => index > 0 && text === said[index - 1]);
      });
      return verdict(
        repeated.length === 0,
        `${repeated.length} complete specs say the same turn twice in a row: ${repeated
          .slice(0, 3)
          .map(({ spec }) => spec.id)
          .join(', ')}`,
      );
    }),
    item('phrases.other-language', 2, 'packages/generate/src/seed/scenario.ts#buildScenario', (generated) => {
      const foreign = generated.hidden.phrases.filter((phrase) => phrase.lang !== generated.hidden.lang);
      const misplaced = generated.complete.filter(({ spec }) =>
        spec.blocks.some(
          (block) =>
            block.when !== undefined &&
            'user' in block.when &&
            foreign.some((phrase) => phrase.text === (block.when as { user: string }).user),
        ),
      );
      return verdict(
        misplaced.length === 0,
        `${misplaced.length} complete specs say a phrase in another language outside a language-switch injection`,
      );
    }),
  );
  return items;
}

// behaviours ----------------------------------------------------------------------------------------------

/** The bank's behaviour titles, in a fixed order, with what exercises each. */
const BEHAVIOURS: Array<{
  key: string;
  title: string;
  exercise: (spec: Spec, hidden: HiddenSpec) => boolean;
}> = [
  {
    key: 'lookup',
    title: 'Look up the record with lookup_record',
    exercise: (spec) => calls(spec, 'lookup_record'),
  },
  {
    key: 'submit',
    title: 'Submit the request with submit_request',
    exercise: (spec) => calls(spec, 'submit_request'),
  },
  {
    key: 'list',
    title: 'List the options with list_options',
    exercise: (spec) => calls(spec, 'list_options'),
  },
  {
    key: 'off-topic',
    title: 'Answer an off-topic question',
    exercise: (spec) => injects(spec, 'D1_off_topic'),
  },
  {
    key: 'loose-yes',
    title: 'Treat a loose yes',
    exercise: (spec) => injects(spec, 'D4_loose_confirmation'),
  },
  {
    key: 'tool-failure',
    title: 'Report a failed tool honestly',
    exercise: (spec) => injects(spec, 'D8_tool_failure'),
  },
  {
    key: 'instruction',
    title: 'Treat an instruction inside a message',
    exercise: (spec) => injects(spec, 'D6_instruction_in_data'),
  },
  {
    key: 'save',
    title: 'Save the record as a file',
    exercise: (spec) =>
      spec.blocks.some((block) => (block.expect?.workspace ?? block.expect?.artifacts) !== undefined),
  },
];

function calls(spec: Spec, tool: string): boolean {
  return spec.blocks.some((block) =>
    (block.expect?.tools ?? []).some((entry) => entry.label === tool && entry.count !== 0),
  );
}

function injects(spec: Spec, cls: string): boolean {
  return spec.blocks.some(
    (block) => block.when !== undefined && 'injection' in block.when && block.when.injection.class === cls,
  );
}

function behaviourItems(): BankItem[] {
  const items: BankItem[] = [];
  const item = (
    id: string,
    tier: Tier,
    check: (generated: Generation, data: SeedData) => Verdict,
  ): BankItem => ({
    id,
    family: 'behaviours',
    tier,
    level: 'behaviours',
    component: 'packages/generate/src/seed/seeders.ts#twiseSeeder',
    async check(data: SeedData) {
      return check(await data.generated(), data);
    },
  });
  for (const behaviour of BEHAVIOURS) {
    const idOf = (hidden: HiddenSpec) =>
      hidden.behaviours.find((entry) => entry.title.startsWith(behaviour.title))?.id;
    items.push(
      item(`behaviour.${behaviour.key}.covered`, 2, (generated, data) => {
        const id = idOf(generated.hidden);
        if (!id) return verdict(true, 'the hidden specification has no such behaviour');
        const covering = generated.complete.filter(({ spec }) => (spec.covers ?? []).includes(id));
        return verdict(
          obligation(data, `behaviour-covered:${id}`, covering.length > 0),
          `${covering.length} complete specs cover ${id}`,
        );
      }),
      item(`behaviour.${behaviour.key}.exercised`, 4, (generated, data) => {
        const id = idOf(generated.hidden);
        if (!id) return verdict(true, 'the hidden specification has no such behaviour');
        const exercised = generated.complete.filter(
          ({ spec }) => (spec.covers ?? []).includes(id) && behaviour.exercise(spec, generated.hidden),
        );
        return verdict(
          obligation(data, `behaviour-exercised:${id}`, exercised.length > 0),
          `${exercised.length} complete specs cover ${id} and hold the Then that exercises it`,
        );
      }),
    );
  }
  items.push(
    item('behaviour.channels', 2, (generated) => {
      const restricted = generated.hidden.behaviours.filter((behaviour) => behaviour.channels !== undefined);
      const wrong = generated.complete.filter(({ spec }) =>
        restricted.some(
          (behaviour) =>
            (spec.covers ?? []).includes(behaviour.id) && !behaviour.channels?.includes(spec.channel ?? ''),
        ),
      );
      return verdict(
        wrong.length === 0,
        `${wrong.length} complete specs cover a behaviour on a channel it does not apply on`,
      );
    }),
    item('behaviour.all-covered', 2, (generated, data) => {
      const missing = generated.hidden.behaviours
        .filter(
          (behaviour) =>
            !obligation(
              data,
              `behaviour-covered:${behaviour.id}`,
              generated.complete.some(({ spec }) => (spec.covers ?? []).includes(behaviour.id)),
            ),
        )
        .map((behaviour) => behaviour.id);
      return verdict(
        missing.length === 0,
        `behaviours no complete spec covers: ${missing.join(', ') || 'none'}`,
      );
    }),
    item('behaviour.flows', 3, (generated, data) => {
      const missing = generated.hidden.flows.flatMap((flow) =>
        flow.behaviours
          .filter(
            (id) =>
              !obligation(
                data,
                `flow-behaviour:${flow.id}/${id}`,
                generated.complete.some(
                  ({ spec }) =>
                    (spec.tags ?? []).includes(`flow:${flow.id}`) && (spec.covers ?? []).includes(id),
                ),
              ),
          )
          .map((id) => `${flow.id}/${id}`),
      );
      return verdict(
        missing.length === 0,
        `flow behaviours covered by no spec of that flow: ${missing.slice(0, 5).join(', ') || 'none'}`,
      );
    }),
    item('behaviour.machine', 3, (generated, data) => {
      const judgedOnly = generated.hidden.behaviours.filter((behaviour) => {
        const covered = generated.complete.some(({ spec }) => (spec.covers ?? []).includes(behaviour.id));
        const machine = obligation(
          data,
          `behaviour-machine:${behaviour.id}`,
          generated.complete.some(
            ({ spec }) =>
              (spec.covers ?? []).includes(behaviour.id) &&
              spec.blocks.some((block) => Object.keys(block.expect ?? {}).some((key) => key !== 'criteria')),
          ),
        );
        return covered && !machine;
      });
      return verdict(
        judgedOnly.length === 0,
        `behaviours covered only by judged criteria: ${judgedOnly.map((behaviour) => behaviour.id).join(', ') || 'none'}`,
      );
    }),
  );
  return items;
}

// adequacy ------------------------------------------------------------------------------------------------

function adequacyItems(): BankItem[] {
  return FAULT_CLASSES.filter((cls) => cls.family !== 'code').map(
    (cls): BankItem => ({
      id: `adequacy.${cls.id}`,
      family: 'adequacy',
      tier: 4,
      level: 'adequacy',
      component: 'packages/generate/src/seed/scenario.ts#buildScenario',
      async check(data: SeedData) {
        const runs = await data.runs();
        const record = runs.faults.find((entry) => entry.fault.def.id === `${cls.id}@any/r1`);
        if (!record) return verdict(false, 'the every-time instance was not planted');
        const changed = Object.entries(record.firstChange);
        if (changed.length === 0)
          return verdict(false, `${cls.id} never changes what the agent does in a complete spec`);
        const late = changed.filter(([spec, index]) => {
          const block = runs.blocks.find((entry) => entry.spec === spec && entry.index === index);
          return block?.reference[0] !== 'pass' || block.faults[record.fault.def.id] !== 'fail';
        });
        return verdict(
          late.length === 0,
          `in ${late.length} of ${changed.length} specs the block where ${cls.id} first changes the agent does not fail: ${late
            .slice(0, 3)
            .map(([spec, index]) => `${spec} block ${index}`)
            .join(', ')}`,
        );
      },
    }),
  );
}

/** The report, phrase, behaviour and adequacy families. */
export function moreItems(): BankItem[] {
  return [...reportItems(), ...phraseItems(), ...behaviourItems(), ...adequacyItems()];
}
