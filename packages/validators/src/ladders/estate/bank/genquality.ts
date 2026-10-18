import { existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { loadEstateMap } from '@agent-nexus/driftbench-estate';
import { FIXTURE, type FixtureSuite, fixtureSuite } from './fixture-suite';
import { type Family, type ItemResult, itemsOf, type Tier } from './frame';

/**
 * Generation quality on the Northwind fixture's generated suite (seed-free, judged once):
 *
 * gen.task: every first ask of a complete spec holds a task: a task verb, not negated, followed by its
 * object. A rule restated as an ask ("Please do this: never guess a status") or a bare condition ("Please
 * handle this for me: the invoice is not in EUR") holds none. One item per test type.
 *
 * gen.reads: no complete spec expects a Read of a file the estate lacks. One item per test type.
 *
 * gen.coverage: at least one complete spec names every atom of a kind (one item per atom kind); every domain
 * rule of a skill has a judged criterion in a complete spec (one item per skill and the standing rules); no
 * spec carries the gap markers the bench run left (one item per marker).
 */

const GENERATE = 'packages/generate/src/estate/generate.ts';
const THEN = 'packages/generate/src/estate/then.ts';

const TEST_TYPES = [
  'obligation',
  'outside_trigger',
  'twin',
  'ordered_pair',
  'skip_pressure',
  'route_positive',
  'route_near_miss',
  'misroute',
  'read_when',
  'script_fixture',
  'dispatch',
  'contract_alone',
  'stop_resume',
  'guard_positive',
  'guard_negative',
  'guard_hostile',
  'tool_boundary',
  'tool_denied',
  'stage_order',
  'stage_skip',
  'register_sample',
  'hazard_recovery',
  'journey',
] as const;

const TASK_VERBS = new Set(
  `add answer archive audit book build cancel change chase check clean close compare correct count create delete
  draft email explain file fill find fix forward get give go handle list look make match merge move open order pay plan
  prepare price print put reconcile record refund remove rename reply report reschedule review run say schedule send
  set show sort summarise summarize tell track triage update write`
    .split(/\s+/)
    .filter(Boolean),
);
const SKIP = new Set([
  'a',
  'an',
  'the',
  'this',
  'that',
  'my',
  'our',
  'me',
  'us',
  'it',
  'up',
  'out',
  'in',
  'through',
]);
/** A code template that restates a rule, a condition or a refusal instead of asking for work. */
const TEMPLATES = [/^"?(please|could you)\s+(do|handle)\s+this(\s+for\s+me)?:/i, /go against this rule/i];
const QUESTION = /^(where|what|which|when|who|how|why|is|are|does|do|can|could|has)\b.*\?/i;

/**
 * Whether an ask holds a task: no rule template, and either a question about something or a task verb, not
 * negated, with its object after it (articles and phrasal particles skipped).
 */
export function holdsTask(ask: string): boolean {
  const text = ask.trim().replace(/^"|"$/g, '');
  if (TEMPLATES.some((template) => template.test(text))) return false;
  if (QUESTION.test(text)) return true;
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s'/.-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return words.some((word, index) => {
    if (!TASK_VERBS.has(word) || ['never', 'not', "don't", 'no'].includes(words[index - 1] ?? ''))
      return false;
    const object = words.slice(index + 1).find((next) => !SKIP.has(next));
    return object !== undefined && object.length > 1;
  });
}

function firstAsk(spec: FixtureSuite['specs'][number]): string | undefined {
  const block = (spec.spec.blocks ?? [])[0] as { when?: { user?: string } } | undefined;
  return block?.when?.user;
}

function readsOf(spec: FixtureSuite['specs'][number]): string[] {
  const out: string[] = [];
  for (const block of (spec.spec.blocks ?? []) as Array<{ expect?: { tools?: unknown[] } }>) {
    for (const tool of (block.expect?.tools ?? []) as Array<{
      label?: string;
      input?: Record<string, unknown>;
    }>) {
      if (tool.label !== 'Read') continue;
      const path = tool.input?.file_path as { contains?: string; equals?: string } | string | undefined;
      const value = typeof path === 'string' ? path : (path?.contains ?? path?.equals);
      if (typeof value === 'string' && value !== '') out.push(value);
    }
  }
  return out;
}

let fixtureFiles: string[] | undefined;
function filesOfFixture(): string[] {
  fixtureFiles ??= (
    readdirSync(FIXTURE, { recursive: true, withFileTypes: true }) as Array<{
      isFile(): boolean;
      parentPath: string;
      name: string;
    }>
  )
    .filter((entry) => entry.isFile())
    .map((entry) => relative(FIXTURE, join(entry.parentPath, entry.name)));
  return fixtureFiles;
}

function seedFreeFamily(
  id: string,
  level: number,
  component: string,
  specs: Array<{
    key: string;
    tier: Tier;
    title: string;
    cause: string;
    component?: string;
    judge(suite: FixtureSuite): Promise<ItemResult> | ItemResult;
  }>,
): Family {
  const items = itemsOf(
    id,
    level,
    component,
    specs.map(({ key, tier, title, cause, component: own }) => ({
      key,
      tier,
      title,
      cause,
      ...(own ? { component: own } : {}),
    })),
  );
  return {
    id,
    level,
    component,
    items,
    seedFree: true,
    async evaluate() {
      const suite = await fixtureSuite();
      const out = new Map<string, ItemResult>();
      for (const spec of specs) {
        try {
          out.set(`${id}.${spec.key}`, await spec.judge(suite));
        } catch (cause) {
          out.set(`${id}.${spec.key}`, {
            pass: false,
            detail: `the item threw: ${cause instanceof Error ? cause.message : String(cause)}`,
          });
        }
      }
      return out;
    },
  };
}

const ofType = (suite: FixtureSuite, type: string) =>
  suite.specs.filter((spec) => spec.complete && spec.testType === type);

export function taskFamily(): Family {
  return seedFreeFamily(
    'gen.task',
    4,
    GENERATE,
    TEST_TYPES.map((type) => ({
      key: type,
      tier: 2 as Tier,
      title: `every first ask of a complete ${type} spec holds a task: a verb and its object`,
      cause: 'write every ask as a task, never as a restated rule or a bare condition',
      async judge(suite) {
        const specs = ofType(suite, type);
        if (specs.length === 0) return { pass: false, detail: `no complete ${type} spec` };
        // A guard that watches the user's prompt is set off by its own trigger (a stop word): that ask is legitimate.
        const map = await loadEstateMap(suite.map);
        const promptGuards = new Set(
          map.ok
            ? map.map.atoms
                .filter((atom) => atom.kind === 'guard' && atom.fields?.event === 'UserPromptSubmit')
                .map((atom) => atom.id)
            : [],
        );
        const bad = specs.filter(
          (spec) =>
            !(type.startsWith('guard_') && spec.atoms.some((atom) => promptGuards.has(atom))) &&
            !holdsTask(firstAsk(spec) ?? ''),
        );
        return bad.length === 0
          ? { pass: true, detail: `holds (${specs.length})` }
          : {
              pass: false,
              detail: `${bad.length} of ${specs.length} asks hold no task, such as "${firstAsk(bad[0] as FixtureSuite['specs'][number])}"`,
            };
      },
    })),
  );
}

export function readsFamily(): Family {
  return seedFreeFamily(
    'gen.reads',
    4,
    THEN,
    TEST_TYPES.map((type) => ({
      key: type,
      tier: 2 as Tier,
      title: `no complete ${type} spec expects a Read of a file the estate lacks`,
      cause: 'expect a Read only of a file the estate holds',
      judge(suite) {
        const files = filesOfFixture();
        const specs = ofType(suite, type);
        if (specs.length === 0) return { pass: false, detail: `no complete ${type} spec` };
        for (const spec of specs) {
          for (const read of readsOf(spec)) {
            const clean = read.replace(/^\.\//, '');
            if (!existsSync(join(FIXTURE, clean)) && !files.some((file) => file.endsWith(clean)))
              return { pass: false, detail: `${spec.id} expects a Read of ${read}, which the estate lacks` };
          }
        }
        return { pass: true, detail: `holds (${specs.length})` };
      },
    })),
  );
}

const FOCUS_KINDS: Array<[string, Tier]> = [
  ['instruction', 2],
  ['gate', 2],
  ['reference', 3],
  ['route', 1],
  ['skill', 2],
  ['script', 3],
  ['subagent', 3],
  ['guard', 3],
  ['tool', 3],
  ['register', 3],
  ['stage', 3],
  ['hazard', 4],
  ['setting', 4],
  ['invariant', 4],
];
/** docs/estate.md section 5 (--focus): the report names the atoms with no complete spec. */
const AT_LEAST = 1;
const SKILLS = ['invoice-reconcile', 'shipment-tracker', 'supplier-email', 'weekly-report', 'standing'];
/** The gap markers and their fix; a fix the generated estates' items already name keeps that cause. */
const MARKERS: Array<[string, string]> = [
  ['needs-ordered-anchor', 'anchor an ordered pair whose ends are no tool label, skill or stage'],
  ['needs-stage-reach-check', 'write a stage reach check'],
  ['needs-guard-timing', 'write a guard timing check'],
  ['needs-guard-message-check', 'write a guard message check'],
  ['needs-recorded-session', 'replay a row from a recorded session the generator finds by itself'],
  ['needs-negation', 'write the inverse of a predicate for a negative control'],
];

export function coverageFamily(): Family {
  return seedFreeFamily('gen.coverage', 4, GENERATE, [
    ...FOCUS_KINDS.map(([kind, tier]) => ({
      key: `one-per-${kind}`,
      tier,
      title: `every ${kind} atom is named by at least ${AT_LEAST} complete spec`,
      cause: `generate a complete spec for every ${kind} atom`,
      async judge(suite: FixtureSuite): Promise<ItemResult> {
        const map = await loadEstateMap(suite.map);
        if (!map.ok) return { pass: false, detail: 'the map does not load' };
        const atoms = map.map.atoms.filter((atom) => atom.kind === kind);
        if (atoms.length === 0) return { pass: false, detail: `the fixture holds no ${kind} atom` };
        // docs/estate.md section 5: a Read of a file the estate copy does not hold waits on `needs-existing-file`, so a
        // reference to a missing file has no complete spec by contract. It is judged by that marker: a spec of it
        // that waits there, never a complete one that expects the Read.
        const waiting = new Set(
          (suite.report.gaps ?? []).find((entry) => entry.marker === 'needs-existing-file')?.atoms ?? [],
        );
        const absent = atoms.filter((atom) => kind === 'reference' && atom.fields?.exists === false);
        const unmarked = absent.filter((atom) => !waiting.has(atom.id));
        if (unmarked.length > 0)
          return {
            pass: false,
            detail: `${unmarked.length} of ${absent.length} references to a missing file are not marked needs-existing-file, such as ${unmarked[0]?.id}`,
          };
        const short = atoms
          .filter((atom) => !absent.includes(atom))
          .map(
            (atom) =>
              [
                atom.id,
                suite.specs.filter((spec) => spec.complete && spec.atoms.includes(atom.id)).length,
              ] as const,
          )
          .filter(([, count]) => count < AT_LEAST);
        return short.length === 0
          ? { pass: true, detail: 'holds' }
          : {
              pass: false,
              detail: `${short.length} of ${atoms.length} ${kind} atoms have fewer than ${AT_LEAST} complete specs, such as ${short[0]?.[0]} with ${short[0]?.[1]}`,
            };
      },
    })),
    ...SKILLS.map((skill) => ({
      key: `judged-${skill}`,
      tier: 3 as Tier,
      title: `every domain rule of ${skill} has a judged criterion in a complete spec`,
      cause: 'judge every domain rule no code checks with a criterion from its own words',
      component: THEN,
      async judge(suite: FixtureSuite): Promise<ItemResult> {
        const map = await loadEstateMap(suite.map);
        if (!map.ok) return { pass: false, detail: 'the map does not load' };
        const rules = map.map.atoms.filter(
          (atom) =>
            atom.kind === 'instruction' &&
            atom.id.startsWith(`instruction.${skill}.`) &&
            atom.evidence.some((item) => item.type === 'custom'),
        );
        if (rules.length === 0) return { pass: true, detail: 'no domain rule here' };
        const unjudged = rules.filter(
          (rule) =>
            !suite.specs.some(
              (spec) =>
                spec.complete &&
                ((spec.spec.blocks ?? []) as Array<{ expect?: { criteria?: unknown[] } }>).some((block) =>
                  (block.expect?.criteria ?? []).some((criterion) =>
                    JSON.stringify(criterion).includes(rule.id),
                  ),
                ),
            ),
        );
        return unjudged.length === 0
          ? { pass: true, detail: `holds (${rules.length})` }
          : {
              pass: false,
              detail: `${unjudged.length} of ${rules.length} domain rules have no judged criterion, such as ${unjudged[0]?.id}`,
            };
      },
    })),
    ...MARKERS.map(([marker, cause]) => ({
      key: marker,
      tier: 4 as Tier,
      title: `no generated spec of the fixture is incomplete for ${marker}`,
      cause,
      component: THEN,
      judge(suite: FixtureSuite): ItemResult {
        const gap = (suite.report.gaps ?? []).find((entry) => entry.marker === marker);
        return !gap || gap.specs === 0
          ? { pass: true, detail: 'holds' }
          : {
              pass: false,
              detail: `${gap.specs} specs are incomplete for ${marker}, such as on ${gap.atoms[0]}`,
            };
      },
    })),
  ]);
}
