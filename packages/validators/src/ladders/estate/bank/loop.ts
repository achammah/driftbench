import {
  type Atom,
  diffEstateMaps,
  type EstateTest,
  estateImpact,
  type ImpactReport,
} from '@agent-nexus/driftbench-estate';
import { generateEstateSuite, StaticTest } from '@agent-nexus/driftbench-generate';
import { completionComponents, componentSpec } from '../completion';
import { completionApplies, completionContract } from '../completion-contract';
import { agentMutants, estateMeta, type MutantVerdict, type SpecVerdict, specVerdicts } from '../levels';
import { type EstateMutant, estateMutants } from '../mutants';
import {
  type EstateRun,
  estateRun,
  generationRun,
  replayChecks,
  replayOnFollower,
  scanRendered,
} from '../pipeline';
import { renderEstate } from '../render';
import { type Family, type ItemResult, itemsOf, type Tier } from './frame';

/**
 * The families of the rest of the loop, on the generated estate of each seed: generation (every class of
 * test, by test type and the role of the atom under test, is complete, valid, asks a distinct phrase and is
 * green on the rule follower; and the generator's own contract), agent mutants (every atom of a class, deleted
 * from the rule follower, fails one of its tests), and maintenance (each estate mutant gets exactly the
 * retirements, regenerations, re-approvals and new atoms it should).
 */

const THEN = 'packages/generate/src/estate/then.ts';
const GENERATE = 'packages/generate/src/estate/generate.ts';
const IMPACT = 'packages/estate/src/maintain/impact.ts';
const DIFF = 'packages/estate/src/maintain/diff.ts';

/** The role of an atom in the hidden estate: which rule, which kind of route, reference, tool or stage. */
export function roleOf(hid: string): string {
  const parts = hid.split(':');
  switch (parts[0]) {
    case 'rule':
      return (parts.length === 3 ? parts[2] : parts[1]) ?? '';
    case 'route':
      return parts[1] ?? '';
    case 'ref':
      return parts[1] === 'CLAUDE.md' ? 'standing' : 'skill';
    case 'tool':
    case 'guard':
      return parts[1] ?? '';
    case 'stage':
      return parts[1] === 'note' ? 'anytime' : 'flow';
    case 'hazard':
      return parts[2] ?? '';
    default:
      return '';
  }
}

function classOf(run: EstateRun, atom: Atom): string {
  return `${atom.kind}:${roleOf(run.scanned.match.hidOf.get(atom.id) ?? '')}`;
}

// gen.complete --------------------------------------------------------------------------------------------

/** Test type and the role of the atom under test, as seen on seeds 1 to 10. */
export const GEN_CLASSES: readonly string[] = [
  'contract_alone|subagent:',
  'dispatch|subagent:',
  'guard_hostile|guard:block-force-push.sh',
  'guard_hostile|guard:read-before-edit.py',
  'guard_hostile|guard:reply-length.py',
  'guard_hostile|guard:stop-word.sh',
  'guard_negative|guard:block-force-push.sh',
  'guard_negative|guard:read-before-edit.py',
  'guard_negative|guard:reply-length.py',
  'guard_negative|guard:stop-word.sh',
  'guard_positive|guard:block-force-push.sh',
  'guard_positive|guard:read-before-edit.py',
  'guard_positive|guard:reply-length.py',
  'guard_positive|guard:stop-word.sh',
  'guard_register|guard:block-force-push.sh',
  'guard_register|guard:read-before-edit.py',
  'guard_register|guard:reply-length.py',
  'guard_register|guard:stop-word.sh',
  'guard_speed|guard:block-force-push.sh',
  'guard_speed|guard:read-before-edit.py',
  'guard_speed|guard:reply-length.py',
  'guard_speed|guard:stop-word.sh',
  'hazard_recovery|hazard:after-compaction',
  'hazard_recovery|hazard:after-restart',
  'invariant|invariant:',
  'journey|route:table',
  'journey|stage:flow',
  'misroute|route:desc',
  'misroute|route:table',
  'obligation|instruction:after-compaction',
  'obligation|instruction:after-restart',
  'obligation|instruction:brief',
  'obligation|instruction:cites',
  'obligation|instruction:dispatch',
  'obligation|instruction:grounded-values',
  'obligation|instruction:no-force-push',
  'obligation|instruction:no-webfetch',
  'obligation|instruction:prohibition',
  'obligation|instruction:readonly',
  'obligation|instruction:script',
  'obligation|instruction:stop-word',
  'obligation|instruction:verify-before-report',
  'ordered_pair|gate:',
  'ordered_pair|gate:fixed-gate',
  'ordered_pair|gate:read-before-edit',
  'outside_trigger|instruction:after-compaction',
  'outside_trigger|instruction:after-restart',
  'outside_trigger|instruction:brief',
  'outside_trigger|instruction:cites',
  'outside_trigger|instruction:dispatch',
  'outside_trigger|instruction:grounded-values',
  'outside_trigger|instruction:no-force-push',
  'outside_trigger|instruction:no-webfetch',
  'outside_trigger|instruction:prohibition',
  'outside_trigger|instruction:readonly',
  'outside_trigger|instruction:script',
  'outside_trigger|instruction:stop-word',
  'outside_trigger|instruction:verify-before-report',
  'read_when|reference:skill',
  'read_when|reference:standing',
  'register_sample|register:json',
  'register_sample|register:lead-with-result',
  'register_sample|register:next-line',
  'register_sample|register:no-filler-words',
  'register_sample|register:register',
  'register_sample|register:reply-length',
  'route_near_miss|route:desc',
  'route_near_miss|route:table',
  'route_positive|route:desc',
  'route_positive|route:table',
  'route_positive|skill:',
  'script_fixture|script:',
  'skip_pressure|gate:',
  'skip_pressure|gate:fixed-gate',
  'skip_pressure|gate:read-before-edit',
  'stage_anytime|stage:anytime',
  'stage_order|stage:anytime',
  'stage_order|stage:flow',
  'stage_skip|stage:flow',
  'stop_resume|subagent:',
  'tool_boundary|tool:allow',
  'tool_boundary|tool:ask',
  'tool_boundary|tool:declared',
  'tool_denied|tool:deny',
  'twin|instruction:after-compaction',
  'twin|instruction:after-restart',
  'twin|instruction:brief',
  'twin|instruction:cites',
  'twin|instruction:dispatch',
  'twin|instruction:grounded-values',
  'twin|instruction:no-force-push',
  'twin|instruction:no-webfetch',
  'twin|instruction:prohibition',
  'twin|instruction:readonly',
  'twin|instruction:script',
  'twin|instruction:stop-word',
  'twin|instruction:verify-before-report',
];

function genTier(testType: string): Tier {
  if (['route_positive', 'stage_order', 'register_sample', 'tool_denied'].includes(testType)) return 2;
  if (['hazard_recovery', 'invariant', 'stage_anytime', 'contract_alone'].includes(testType)) return 5;
  if (testType.startsWith('guard_') || ['dispatch', 'stop_resume', 'journey'].includes(testType)) return 4;
  return 3;
}

function keyOf(text: string): string {
  return text.replace(/[|:.]+/g, '-').replace(/-+$/, '');
}

function verdictOf(verdict: SpecVerdict): string | undefined {
  if (!verdict.spec.loaded || verdict.spec.errors.length > 0) return 'does not load';
  if (!verdict.complete)
    return `incomplete: ${(estateMeta(verdict.spec).needs ?? []).map((need) => need.marker).join(', ')}`;
  if (verdict.spec.warnings.length > 0) return 'fails strict lint';
  if (!verdict.distinct) return 'repeats an earlier positive ask';
  if (verdict.follower && !verdict.follower.pass)
    return `fails on the rule follower: ${verdict.follower.failing[0] ?? verdict.follower.error ?? ''}`;
  return undefined;
}

export function genCompleteFamily(): Family {
  const family = 'gen.complete';
  const items = itemsOf(
    family,
    4,
    THEN,
    GEN_CLASSES.map((cls) => {
      const [testType, role] = cls.split('|') as [string, string];
      return {
        key: keyOf(cls),
        tier: genTier(testType),
        title: `every ${testType} spec of a ${role.replace(/:$/, '')} atom is complete, valid, distinct and green`,
      };
    }),
  );
  return {
    id: family,
    level: 4,
    component: THEN,
    items,
    async evaluate(seed) {
      const run = await generationRun(seed);
      const all = await specVerdicts(run);
      const atoms = new Map(run.scanned.map.atoms.map((atom) => [atom.id, atom]));
      const byClass = new Map<string, SpecVerdict[]>();
      for (const verdict of all) {
        const head = atoms.get(estateMeta(verdict.spec).atoms?.[0] ?? '');
        if (!head) continue;
        const cls = `${verdict.spec.record.testType}|${classOf(run, head)}`;
        byClass.set(cls, [...(byClass.get(cls) ?? []), verdict]);
      }
      const out = new Map<string, ItemResult>();
      for (const cls of GEN_CLASSES) {
        const list = byClass.get(cls) ?? [];
        const bad = list.flatMap((verdict) => {
          const reason = verdictOf(verdict);
          return reason ? [`${verdict.spec.record.id}: ${reason}`] : [];
        });
        if (bad.length === 0)
          for (const verdict of list) {
            if (!verdict.spec.loaded || !completionApplies(run, verdict.spec)) continue;
            const inventory = completionComponents(completionContract(run, verdict.spec));
            for (const component of inventory.components) {
              const loaded = {
                ...verdict.spec.loaded,
                spec: componentSpec(verdict.spec.loaded.spec, component),
              };
              const control = await replayOnFollower(
                run,
                loaded,
                replayChecks(),
                undefined,
                component.prepare,
              );
              const controlVerdicts =
                control.run?.blocks[component.block]?.verdicts.filter((v) =>
                  component.controlVerdicts.includes(v.id),
                ) ?? [];
              if (
                control.run?.status !== 'completed' ||
                controlVerdicts.length !== component.controlVerdicts.length ||
                controlVerdicts.some((v) => v.outcome !== 'pass' || !v.gating)
              ) {
                bad.push(`${verdict.spec.record.id}: component control failed ${component.id}`);
                break;
              }
              const result = await replayOnFollower(run, loaded, replayChecks(), undefined, (o) => {
                component.prepare?.(o);
                component.change(o);
              });
              const targeted =
                result.run?.blocks[component.block]?.verdicts.filter((v) =>
                  component.verdicts.includes(v.id),
                ) ?? [];
              const witnessed =
                component.violationOutcome === 'absent'
                  ? targeted.length === 0
                  : targeted.length === component.verdicts.length &&
                    targeted.every(
                      (v) =>
                        v.gating &&
                        (component.violationOutcome
                          ? v.outcome === component.violationOutcome
                          : v.outcome === 'fail' || v.outcome === 'inconclusive'),
                    );
              if (result.run?.status !== 'completed' || !witnessed) {
                bad.push(`${verdict.spec.record.id}: accepts component violation ${component.id}`);
                break;
              }
            }
            if (inventory.gaps.length > 0)
              bad.push(`${verdict.spec.record.id}: component derivation gaps: ${inventory.gaps.join(', ')}`);
          }

        out.set(`${family}.${keyOf(cls)}`, {
          pass: bad.length === 0,
          detail:
            bad.length === 0
              ? list.length === 0
                ? 'no spec of the class on this seed'
                : 'holds'
              : `${bad.length} of ${list.length}: ${bad[0]}`,
        });
      }
      return out;
    },
  };
}

// gen.asks ------------------------------------------------------------------------------------------------

type AskCheck = {
  key: string;
  tier: Tier;
  title: string;
  component?: string;
  check(run: EstateRun, all: SpecVerdict[]): Promise<string | undefined> | string | undefined;
};

/** The situation each test type is asked in (docs/estate.md section 5); a live guard_positive is instructed. */
const USE_OF_TEST: Readonly<Record<string, string>> = {
  outside_trigger: 'outside',
  guard_negative: 'outside',
  route_near_miss: 'near_miss',
  misroute: 'misroute',
  skip_pressure: 'pressure',
  stage_skip: 'pressure',
};
const NO_ASK = new Set(['invariant', 'setting']);

/**
 * Whether the bank holds too few approved phrases for a plan row, from the row's atoms alone: the situations of
 * the row's use that hold its first atom (pins of the cell respected) and the approved phrases of the best one.
 * A row needs one approved phrase; a twin needs two. No such situation means the bank is short. A live
 * guard_positive row is asked in a `forced` situation, looked up the same way.
 */
function bankIsShort(
  run: EstateRun,
  row: { atomIds: string[]; cell: Record<string, string>; testType: string; mode: string },
): boolean {
  if (NO_ASK.has(row.testType)) return false;
  // A live guard test is asked in a `forced` situation, found like any other: no early allowance.
  const use =
    row.testType === 'guard_positive' && row.mode === 'live'
      ? 'forced'
      : (USE_OF_TEST[row.testType] ?? 'trigger');
  const head = row.atomIds[0];
  let best: { atoms: string[]; approved: number } | undefined;
  let score = -1;
  for (const situation of run.bank.situations) {
    if (situation.use !== use || head === undefined || !situation.atoms.includes(head)) continue;
    const pins = Object.entries(situation.cell ?? {});
    if (pins.some(([key, value]) => row.cell[key] !== undefined && row.cell[key] !== value)) continue;
    const held = row.atomIds.filter((id) => situation.atoms.includes(id)).length;
    if (held > score) {
      best = { atoms: situation.atoms, approved: situation.phrases.filter((p) => p.approved).length };
      score = held;
    }
  }
  const need = row.testType === 'twin' ? 2 : 1;
  return best === undefined || best.approved < need;
}

function asksOfSpec(verdict: SpecVerdict): string[] {
  return (verdict.spec.loaded?.spec.blocks ?? []).map((block) =>
    String((block.when as { user?: unknown } | undefined)?.user ?? ''),
  );
}

function routePositives(
  run: EstateRun,
  all: SpecVerdict[],
  route: string,
  target: 'skill' | 'subagent',
): string | undefined {
  const atoms = new Map(run.scanned.map.atoms.map((atom) => [atom.id, atom]));
  const groups = new Map<string, Set<string>>();
  for (const verdict of all) {
    if (!verdict.spec.record.row.startsWith('route_positive.')) continue;
    const head = atoms.get(estateMeta(verdict.spec).atoms?.[0] ?? '');
    if (head?.kind !== 'route' || head.fields?.targetKind !== target) continue;
    if (roleOf(run.scanned.match.hidOf.get(head.id) ?? '') !== route) continue;
    const asks = groups.get(head.id) ?? new Set<string>();
    for (const ask of asksOfSpec(verdict)) asks.add(ask);
    groups.set(head.id, asks);
  }
  const same = [...groups.entries()].filter(([, asks]) => asks.size < 3);
  return same.length === 0
    ? undefined
    : `${same.length} routes ask fewer than 3 distinct phrases, such as ${same[0]?.[0]} with ${same[0]?.[1].size}`;
}

const ASKS: AskCheck[] = [
  {
    key: 'k-asks-skill-description',
    tier: 2,
    title: 'a skill route by description gets k distinct positive asks',
    check: (r, a) => routePositives(r, a, 'desc', 'skill'),
  },
  {
    key: 'k-asks-skill-table',
    tier: 2,
    title: 'a skill route by the routing table gets k distinct positive asks',
    check: (r, a) => routePositives(r, a, 'table', 'skill'),
  },
  {
    key: 'k-asks-helper-description',
    tier: 3,
    title: 'a helper route by description gets k distinct positive asks',
    check: (r, a) => routePositives(r, a, 'desc', 'subagent'),
  },
  {
    key: 'k-asks-helper-table',
    tier: 3,
    title: 'a helper route by the routing table gets k distinct positive asks',
    check: (r, a) => routePositives(r, a, 'table', 'subagent'),
  },
  {
    key: 'twin-other-phrase',
    tier: 2,
    title: 'a twin asks another phrase than its obligation',
    check: (_r, all) => {
      const phrase = new Map<string, string>();
      for (const verdict of all.filter((v) => v.spec.record.testType === 'obligation'))
        phrase.set(estateMeta(verdict.spec).atoms?.[0] ?? '', asksOfSpec(verdict)[0] ?? '');
      const same = all.filter(
        (v) =>
          v.spec.record.testType === 'twin' &&
          phrase.get(estateMeta(v.spec).atoms?.[0] ?? '') === asksOfSpec(v)[0],
      );
      return same.length === 0 ? undefined : `${same.length} twins repeat their obligation's ask`;
    },
  },
  {
    key: 'near-miss-not-trigger',
    tier: 2,
    title: 'a near miss never asks a trigger phrase of its route',
    check: (run, all) => {
      const triggers = new Set(
        run.bank.situations.filter((s) => s.use === 'trigger').flatMap((s) => s.phrases.map((p) => p.text)),
      );
      const bad = all.filter(
        (v) => v.spec.record.testType === 'route_near_miss' && asksOfSpec(v).some((ask) => triggers.has(ask)),
      );
      return bad.length === 0 ? undefined : `${bad.length} near misses ask a trigger phrase`;
    },
  },
  {
    key: 'misroute-names-another',
    tier: 2,
    title: 'a misroute names a skill or helper other than its target',
    check: (run, all) => {
      const atoms = new Map(run.scanned.map.atoms.map((atom) => [atom.id, atom]));
      const bad = all.filter((v) => {
        if (v.spec.record.testType !== 'misroute' || !v.complete) return false;
        const target = String(atoms.get(estateMeta(v.spec).atoms?.[0] ?? '')?.fields?.target ?? '');
        return asksOfSpec(v).some((ask) => ask.includes(target) || !/\b(skill|agent|helper)\b/.test(ask));
      });
      return bad.length === 0 ? undefined : `${bad.length} misroutes name their own target or no primitive`;
    },
  },
  {
    key: 'resume-second-block',
    tier: 3,
    title: 'a stop and resume spec has a second block that asks a resume phrase',
    check: (run, all) => {
      const resumes = new Set(
        run.bank.situations.filter((s) => s.use === 'resume').flatMap((s) => s.phrases.map((p) => p.text)),
      );
      const bad = all.filter(
        (v) => v.spec.record.testType === 'stop_resume' && !resumes.has(asksOfSpec(v)[1] ?? ''),
      );
      return bad.length === 0 ? undefined : `${bad.length} stop and resume specs lack a resume ask`;
    },
  },
  {
    key: 'deviation-injected',
    tier: 3,
    title: 'a row with a deviation injects a perturbation of that class',
    check: (_r, all) => {
      const bad = all.filter((v) => {
        const cell = (estateMeta(v.spec) as { cell?: Record<string, string> }).cell ?? {};
        const deviation = cell.deviation;
        if (!deviation || deviation === 'none' || !v.spec.loaded) return false;
        return !(v.spec.loaded.spec.perturbations ?? []).some(
          (p) => (p as { class?: string }).class === deviation,
        );
      });
      return bad.length === 0 ? undefined : `${bad.length} specs drop the deviation of their cell`;
    },
  },
  {
    key: 'records-provenance',
    tier: 1,
    title: 'every spec records its atoms, plan row, cell, seeder, seed and map hash',
    check: (run, all) => {
      const bad = all.filter((v) => {
        // A static test (docs/estate.md section 5) records its atom, plan row and map hash in its own JSON.
        const fixed = staticRecord(v);
        if (fixed !== undefined)
          return (
            fixed === null ||
            typeof fixed.atom !== 'string' ||
            typeof fixed.planRow !== 'string' ||
            fixed.mapHash !== run.scanned.map.hash
          );
        const meta = estateMeta(v.spec) as Record<string, unknown>;
        return (
          !Array.isArray(meta.atoms) ||
          typeof meta.planRow !== 'string' ||
          typeof meta.cell !== 'object' ||
          meta.seeder !== 'estate' ||
          meta.seed !== run.estate.seed ||
          meta.mapHash !== run.scanned.map.hash
        );
      });
      return bad.length === 0 ? undefined : `${bad.length} specs miss a provenance field`;
    },
  },
  {
    key: 'byte-identical',
    tier: 1,
    title: 'the same map, plan, bank and seed give the same files byte for byte',
    component: GENERATE,
    check: (run) => {
      const again = generateEstateSuite(
        {
          map: { runtime: run.scanned.map.runtime, hash: run.scanned.map.hash, atoms: run.scanned.map.atoms },
          plan: { mapHash: run.plan.plan.mapHash, rows: run.plan.plan.rows },
          bank: run.bank,
          sessions: run.sessions,
        },
        {
          seed: run.estate.seed,
          paths: {
            map: 'map.yaml',
            plan: 'plan.yaml',
            phrases: 'phrases.yaml',
            sessions: 'sessions/index.yaml',
          },
        },
      );
      const before = new Map(run.suite.files.map((file) => [file.path, file.text]));
      const differ = again.files.filter((file) => before.get(file.path) !== file.text);
      return differ.length === 0 && again.files.length === before.size
        ? undefined
        : `${differ.length} files differ`;
    },
  },
  {
    key: 'seed-moves-phrases',
    tier: 2,
    title: 'another seed draws other phrases somewhere in the suite',
    component: GENERATE,
    check: (run) => {
      const other = generateEstateSuite(
        {
          map: { runtime: run.scanned.map.runtime, hash: run.scanned.map.hash, atoms: run.scanned.map.atoms },
          plan: { mapHash: run.plan.plan.mapHash, rows: run.plan.plan.rows },
          bank: run.bank,
          sessions: run.sessions,
        },
        {
          seed: run.estate.seed + 1000,
          paths: {
            map: 'map.yaml',
            plan: 'plan.yaml',
            phrases: 'phrases.yaml',
            sessions: 'sessions/index.yaml',
          },
        },
      );
      const before = new Map(run.suite.files.map((file) => [file.path, file.text]));
      const moved = other.files.filter(
        (file) =>
          /\bwhen:/.test(file.text) && before.get(file.path) !== file.text.replace(/seed \d+/g, (m) => m),
      );
      return moved.length > 0 ? undefined : 'no phrase moved with the seed';
    },
  },
  {
    key: 'unique-ids',
    tier: 1,
    title: 'spec ids are unique',
    check: (_r, all) =>
      new Set(all.map((v) => v.spec.record.id)).size === all.length ? undefined : 'two specs share an id',
  },
  {
    key: 'replay-sessions-exist',
    tier: 2,
    title: 'a replay spec names a session of the index',
    check: (run, all) => {
      const names = new Set(run.sessions.sessions.map((s) => s.name));
      const bad = all.filter((v) => {
        const replay = (v.spec.loaded?.spec.metadata as { replay?: { session?: string } } | undefined)
          ?.replay;
        return replay !== undefined && !names.has(replay.session ?? '');
      });
      return bad.length === 0 ? undefined : `${bad.length} replay specs name no session`;
    },
  },
  {
    key: 'complete-has-outcome',
    tier: 2,
    title: 'a complete spec with an ask states its workspace outcome',
    check: (_r, all) => {
      const bad = all.filter(
        (v) =>
          v.complete &&
          v.spec.loaded &&
          asksOfSpec(v).some(Boolean) &&
          !v.spec.loaded.spec.blocks.some(
            (b) =>
              b.expect?.workspace !== undefined ||
              b.expect?.execution !== undefined ||
              (b.expect?.artifacts?.length ?? 0) > 0,
          ),
      );
      return bad.length === 0 ? undefined : `${bad.length} complete specs state no outcome`;
    },
  },
  {
    key: 'negatives-negative',
    tier: 2,
    title: 'a negative control expects no act to happen',
    check: (_r, all) => {
      const negative = new Set(['outside_trigger', 'route_near_miss', 'guard_negative']);
      const bad = all.filter((v) => {
        if (!negative.has(v.spec.record.testType) || !v.spec.loaded) return false;
        return v.spec.loaded.spec.blocks.some((b) =>
          [...(b.expect?.skills ?? []), ...(b.expect?.guards ?? []), ...(b.expect?.tools ?? [])].some(
            (e) => JSON.stringify((e as { count?: unknown }).count) !== '0',
          ),
        );
      });
      return bad.length === 0 ? undefined : `${bad.length} negative controls expect an act`;
    },
  },
  {
    key: 'rows-give-specs',
    tier: 1,
    title: 'every approved plan row gives at least one spec',
    check: (run, all) => {
      const rows = new Set(all.map((v) => v.spec.record.row));
      const missing = run.plan.plan.rows.filter((row) => row.status === 'approved' && !rows.has(row.id));
      return missing.length === 0 ? undefined : `${missing.length} rows give no spec`;
    },
  },
  {
    key: 'incomplete-named',
    tier: 1,
    title: 'an incomplete spec names what it waits for',
    check: (_r, all) => {
      const bad = all.filter((v) => !v.complete && (estateMeta(v.spec).needs ?? []).length === 0);
      return bad.length === 0 ? undefined : `${bad.length} incomplete specs name nothing`;
    },
  },
  {
    key: 'judged-only-registers',
    tier: 2,
    title:
      'judged criteria appear only for output rules (not gating) and for domain rules and judged controls (gating, listed)',
    // docs/estate.md section 5, the Then table: `custom` on a register atom is a judged criterion, not gating;
    // `custom` with a name no code checks (a domain rule) is a gating judged criterion, the spec is tagged
    // `judged` and lists the atom in `metadata.estate.judged`; a control whose predicate has no machine inverse
    // is a judged control, named `<atom>.control`.
    check: (run, all) => {
      const atoms = new Map(run.scanned.map.atoms.map((atom) => [atom.id, atom]));
      const bad = all.filter((v) => {
        const spec = v.spec.loaded?.spec as { criteria?: unknown[]; tags?: unknown } | undefined;
        const judged = (estateMeta(v.spec) as { judged?: unknown }).judged;
        const listed = new Set(Array.isArray(judged) ? (judged as string[]) : []);
        const tagged = Array.isArray(spec?.tags) && spec.tags.includes('judged');
        return (spec?.criteria ?? []).some((entry) => {
          const criterion = entry as { name: string; gating?: boolean };
          const id = criterion.name.replace(/\.control$/, '');
          const atom = atoms.get(id);
          if (!atom) return true;
          if (atom.kind === 'register') return criterion.gating === true || id !== criterion.name;
          if (!(criterion.gating === true && listed.has(id) && tagged)) return true;
          // A judged control: only in a negative control, for an atom with a predicate that has no machine
          // inverse. A rule's own judged criterion: only for a custom predicate no code checks.
          if (id !== criterion.name)
            return !(
              NEGATIVE_CONTROLS.has(v.spec.record.testType) &&
              atom.evidence.some((evidence) => !hasMachineInverse(evidence))
            );
          return !atom.evidence.some(
            (evidence) => evidence.type === 'custom' && !DOC_CODE_CHECKED.has(evidence.name),
          );
        });
      });
      return bad.length === 0
        ? undefined
        : `${bad.length} specs judge an atom that is neither an output rule (not gating) nor a listed domain rule or control (gating)`;
    },
  },
  {
    key: 'asks-approved',
    tier: 1,
    title: 'a complete spec asks an approved phrase, or a disclosed code-written ask where none is approved',
    // docs/estate.md section 5: an approved phrase always wins; when the bank holds none for the row, code writes
    // the ask from the atoms, and the spec says so (tag `ask:code`, `metadata.estate.ask: code`, the field the
    // words came from in `askFrom`). Whether the bank holds one is derived here, from the plan row and its atoms
    // and the bank: never from the situation the generated spec reports about itself.
    check: (run, all) => {
      const approved = new Set(
        run.bank.situations.flatMap((s) => s.phrases.filter((p) => p.approved).map((p) => p.text)),
      );
      const rows = new Map(run.plan.plan.rows.map((row) => [row.id, row]));
      const disclosed = (v: SpecVerdict): boolean => {
        const spec = v.spec.loaded?.spec as { tags?: unknown } | undefined;
        const meta = estateMeta(v.spec) as { ask?: unknown; askFrom?: unknown };
        const tagged = Array.isArray(spec?.tags) && spec.tags.includes('ask:code');
        if (!tagged || meta.ask !== 'code' || typeof meta.askFrom !== 'string' || meta.askFrom === '')
          return false;
        const row = rows.get(v.spec.record.row) ?? rows.get(v.spec.record.row.replace(/\.\d+$/, ''));
        if (!row) return false;
        // The row the generator reports is bookkeeping it writes itself: the spec must say the same about itself
        // (its plan row, its atoms, its test type and the test tag), else the allowance does not apply.
        const own = estateMeta(v.spec) as { planRow?: unknown; atoms?: unknown; testType?: unknown };
        const atoms = Array.isArray(own.atoms) ? (own.atoms as unknown[]) : [];
        if (
          own.planRow !== row.id ||
          own.testType !== row.testType ||
          atoms.length !== row.atomIds.length ||
          !row.atomIds.every((id) => atoms.includes(id)) ||
          !(Array.isArray(spec?.tags) && spec.tags.includes(`test:${row.testType}`))
        )
          return false;
        return bankIsShort(run, row);
      };
      const bad = all.filter(
        (v) => v.complete && asksOfSpec(v).some((ask) => ask !== '' && !approved.has(ask)) && !disclosed(v),
      );
      return bad.length === 0
        ? undefined
        : `${bad.length} complete specs ask an unapproved phrase that is not a disclosed code-written ask`;
    },
  },
  {
    key: 'phrases-spread',
    tier: 3,
    title: 'a situation with three phrases is asked with more than one across its specs',
    check: (run, all) => {
      const used = new Map<string, Set<string>>();
      for (const v of all) {
        const situation = estateMeta(v.spec).situation;
        if (!situation) continue;
        used.set(situation, new Set([...(used.get(situation) ?? []), ...asksOfSpec(v)]));
      }
      const narrow = run.bank.situations.filter(
        (s) => s.phrases.length >= 3 && (used.get(s.id)?.size ?? 0) === 1,
      );
      return narrow.length === 0 ? undefined : `${narrow.length} situations are asked with one phrase only`;
    },
  },
  {
    key: 'version-is-map',
    tier: 1,
    title: "a spec's version is its map's hash",
    check: (run, all) => {
      const bad = all.filter(
        (v) => v.spec.loaded && v.spec.loaded.spec.version !== run.scanned.map.hash.slice(0, 12),
      );
      return bad.length === 0 ? undefined : `${bad.length} specs carry another version`;
    },
  },
  {
    key: 'strict-lint',
    tier: 2,
    title: 'every complete spec passes strict lint',
    check: (_r, all) => {
      const bad = all.filter((v) => v.complete && v.spec.warnings.length > 0);
      return bad.length === 0 ? undefined : `${bad.length} complete specs fail strict lint`;
    },
  },
  {
    key: 'all-load',
    tier: 1,
    title: 'every spec loads',
    check: (_r, all) => {
      // A static test is JSON for `estate static`, not a task spec: it loads when the runner's own schema
      // (StaticTest, the one `driftbench estate static` parses with) accepts it. Every other file loads as a task spec.
      const bad = all.filter((v) => {
        const fixed = staticRecord(v);
        if (fixed === undefined) return !v.spec.loaded;
        return fixed === null || !StaticTest.safeParse(fixed).success;
      });
      return bad.length === 0 ? undefined : `${bad.length} specs do not load`;
    },
  },
];

/**
 * The custom predicates code checks, as docs/estate.md section 5 lists them, held here and not read from the
 * product: the registered checks of the runners, then the predicates the generator compiles. A judged criterion
 * on a rule is right only for a custom predicate outside this list.
 */
const DOC_CODE_CHECKED: ReadonlySet<string> = new Set([
  // Registered checks.
  'ordered',
  'some_call',
  'hazard_recovery',
  'permission',
  'grounded_values',
  'max_words',
  'no_delete_under',
  'stage_seen',
  // Compiled predicates.
  'command_not_run',
  'max_characters',
  'max_questions',
  'no_secret_in_reply',
  'currency_after_amount',
  'stopped_and_confirmed',
  'json_only',
  'asks_for',
  'route_table',
  'same_language_as_user',
  'confirmed_before_send',
  'asks_again_on_loose_yes',
]);
/** The test types that are negative controls (docs/estate.md section 4: the control rows). */
const NEGATIVE_CONTROLS: ReadonlySet<string> = new Set([
  'outside_trigger',
  'route_near_miss',
  'guard_negative',
]);

/**
 * Whether code can write the negative of a predicate (docs/estate.md section 5, the Then table): a skill not
 * loaded, a guard that does not fire, a tool not called, a reply without the required words. Every other
 * predicate (ordered, custom, a text with no required words) has no machine inverse.
 */
function hasMachineInverse(evidence: { type: string; must?: readonly string[] }): boolean {
  if (evidence.type === 'text') return (evidence.must ?? []).length > 0;
  return ['skill_loaded', 'guard', 'tool_called'].includes(evidence.type);
}

/**
 * The JSON of a static test (a file under `static/` ending in `.json`, docs/estate.md section 5: "Invariant and
 * setting rows are static tests: JSON under `static/<test type>/`"): the object, null when the text is not a
 * JSON object, undefined for every other file.
 */
export function staticRecord(v: {
  spec: { record: { path: string }; text: string };
}): Record<string, unknown> | null | undefined {
  const path = v.spec.record.path;
  if (!path.startsWith('static/') || !path.endsWith('.json')) return undefined;
  try {
    const parsed: unknown = JSON.parse(v.spec.text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function genAsksFamily(): Family {
  const family = 'gen.asks';
  const items = itemsOf(
    family,
    4,
    GENERATE,
    ASKS.map(({ key, tier, title, component }) => ({
      key,
      tier,
      title,
      ...(component ? { component } : {}),
    })),
  );
  return {
    id: family,
    level: 4,
    component: GENERATE,
    items,
    async evaluate(seed) {
      const run = await estateRun(seed);
      const all = await specVerdicts(run);
      const out = new Map<string, ItemResult>();
      for (const ask of ASKS) {
        let reason: string | undefined;
        try {
          reason = await ask.check(run, all);
        } catch (cause) {
          reason = `the check threw: ${cause instanceof Error ? cause.message : String(cause)}`;
        }
        out.set(`${family}.${ask.key}`, { pass: reason === undefined, detail: reason ?? 'holds' });
      }
      return out;
    },
  };
}

// mutant.agent --------------------------------------------------------------------------------------------

export const MUTANT_CLASSES: readonly string[] = [
  'gate:',
  'gate:fixed-gate',
  'gate:read-before-edit',
  'guard:block-force-push.sh',
  'guard:read-before-edit.py',
  'guard:reply-length.py',
  'guard:stop-word.sh',
  'hazard:after-compaction',
  'hazard:after-restart',
  'instruction:after-compaction',
  'instruction:after-restart',
  'instruction:brief',
  'instruction:cites',
  'instruction:dispatch',
  'instruction:grounded-values',
  'instruction:no-force-push',
  'instruction:no-webfetch',
  'instruction:prohibition',
  'instruction:readonly',
  'instruction:script',
  'instruction:stop-word',
  'instruction:verify-before-report',
  'reference:skill',
  'reference:standing',
  'register:json',
  'register:lead-with-result',
  'register:next-line',
  'register:no-filler-words',
  'register:register',
  'register:reply-length',
  'route:desc',
  'route:table',
  'route:table-helper',
  'route:desc-helper',
  'script:',
  'skill:',
  'stage:anytime',
  'stage:flow',
  'subagent:',
  'tool:allow',
  'tool:ask',
  'tool:declared',
  'tool:deny',
  'tool:deny-bare',
];

function mutantClass(run: EstateRun, atom: Atom): string {
  const base = classOf(run, atom);
  if (atom.kind === 'route' && atom.fields?.targetKind === 'subagent') return `${base}-helper`;
  if (atom.kind === 'tool' && atom.fields?.effect === 'deny' && atom.fields?.pattern === undefined)
    return 'tool:deny-bare';
  return base;
}

export function mutantFamily(): Family {
  const family = 'mutant.agent';
  const items = itemsOf(
    family,
    5,
    THEN,
    MUTANT_CLASSES.map((cls) => ({
      key: keyOf(cls),
      tier:
        cls.startsWith('hazard') ||
        cls.startsWith('tool:') ||
        cls.endsWith('readonly') ||
        cls.endsWith('brief')
          ? 5
          : cls.startsWith('skill') ||
              cls.startsWith('stage:flow') ||
              cls.startsWith('register:next') ||
              cls.startsWith('register:no-filler')
            ? 2
            : 4,
      title: `every ${cls.replace(/:$/, '')} atom deleted from the agent fails one of its generated tests`,
    })),
  );
  return {
    id: family,
    level: 5,
    component: THEN,
    items,
    async evaluate(seed) {
      const run = await estateRun(seed);
      const mutants = await agentMutants(run);
      const atoms = new Map(run.scanned.map.atoms.map((atom) => [atom.id, atom]));
      const byClass = new Map<string, MutantVerdict[]>();
      for (const mutant of mutants) {
        const atom = atoms.get(mutant.atom);
        if (!atom) continue;
        const cls = mutantClass(run, atom);
        byClass.set(cls, [...(byClass.get(cls) ?? []), mutant]);
      }
      const out = new Map<string, ItemResult>();
      for (const cls of MUTANT_CLASSES) {
        const every = byClass.get(cls) ?? [];
        // A mutant the follower's session cannot show is no kill target: it is named, not counted alive.
        const same = every.filter((mutant) => mutant.equivalent);
        // A reference to a missing file has no complete test by contract: named too, judged by its marker.
        const absent = every.filter((mutant) => mutant.untestable);
        const list = every.filter((mutant) => !mutant.equivalent && !mutant.untestable);
        const alive = list.filter((mutant) => !mutant.killed);
        const noted =
          same.length === 0
            ? ''
            : ` (${same.length} of ${every.length} not judged, the follower's session is the same without it: ${same[0]?.atom})`;
        const missing =
          absent.length === 0
            ? ''
            : ` (${absent.length} of ${every.length} not judged, the estate holds no such file and its tests wait on needs-existing-file: ${absent[0]?.atom})`;
        out.set(`${family}.${keyOf(cls)}`, {
          pass: alive.length === 0,
          detail:
            alive.length === 0
              ? every.length === 0
                ? 'no atom of the class on this seed'
                : list.length === 0
                  ? `no atom of the class changes the follower's session on this seed${noted}${missing}`
                  : `holds${noted}${missing}`
              : `${alive.length} of ${list.length} live: ${alive[0]?.atom} ${alive[0]?.reason ?? ''}`,
        });
      }
      return out;
    },
  };
}

// maintain.impact -----------------------------------------------------------------------------------------

type ImpactItem = {
  key: string;
  tier: Tier;
  title: string;
  kind: string;
  component?: string;
  judge(context: ImpactContext): string | undefined;
};
type ImpactContext = {
  run: EstateRun;
  mutant: EstateMutant;
  impact: ImpactReport;
  tests: EstateTest[];
  removed: Set<string>;
  added: string[];
  /** Tests naming an atom whose words changed meaning, whitespace or nothing. */
  testsOf(hid: string): string[];
};

/** docs/estate.md section 8: the complete metadata atom set decides retirement. */
function deletionTests(c: ImpactContext) {
  const live = c.tests.filter((test) => test.retired === undefined);
  const retire = live.filter(
    (test) => test.atoms.length > 0 && test.atoms.every((atom) => c.removed.has(atom)),
  );
  const regenerate = live.filter(
    (test) =>
      test.atoms.some((atom) => c.removed.has(atom)) && test.atoms.some((atom) => !c.removed.has(atom)),
  );
  return { retire, regenerate };
}

/** An already-written retirement of a non-live spec is not a new retirement. */
function liveRetirements(c: ImpactContext) {
  return c.impact.retire.filter(
    (entry) =>
      !(
        entry.state === 'already' &&
        c.tests.some((test) => test.id === entry.test && test.retired !== undefined)
      ),
  );
}

function retiresExactly(c: ImpactContext): string | undefined {
  const expected = deletionTests(c);
  const reported = liveRetirements(c);
  const retired = new Set(reported.map((entry) => entry.test));
  const missed = expected.retire.filter((test) => !retired.has(test.id));
  if (missed.length > 0)
    return `${missed.length} all-removed tests are not retired, such as ${missed[0]?.id}`;
  const extra = retiresNothingElse(c);
  if (extra) return extra;
  if (reported.length !== retired.size) return 'a test is retired more than once';
  const both = expected.retire.filter((test) => c.impact.regenerate.some((entry) => entry.test === test.id));
  if (both.length > 0) return `all-removed test also regenerated: ${both[0]?.id}`;
  for (const test of expected.regenerate) {
    const entry = c.impact.regenerate.find((candidate) => candidate.test === test.id);
    if (!entry) return `test with remaining atoms not regenerated: ${test.id}`;
    const gone = test.atoms.filter((atom) => c.removed.has(atom));
    const missing = gone.filter(
      (atom) => !entry.atoms.some((reason) => reason.atom === atom && reason.why === 'removed'),
    );
    if (missing.length > 0)
      return `removed-atom regeneration reason missing for ${test.id}: ${missing.join(', ')}`;
  }
  return undefined;
}

function retiresNothingElse(c: ImpactContext): string | undefined {
  const should = new Set(deletionTests(c).retire.map((test) => test.id));
  const wrong = liveRetirements(c).filter((entry) => !should.has(entry.test));
  return wrong.length === 0
    ? undefined
    : `${wrong.length} tests retired before all their atoms left, or unrelated tests retired, such as ${wrong[0]?.test}`;
}

const DELETION_KINDS = [
  'instruction',
  'gate',
  'reference',
  'script',
  'register',
  'route',
  'subagent',
  'guard',
  'stage',
  'tool',
];

const IMPACT_ITEMS: ImpactItem[] = [
  ...DELETION_KINDS.flatMap((kind): ImpactItem[] => [
    {
      key: `${kind}-retires-its-tests`,
      tier: kind === 'subagent' || kind === 'guard' ? 4 : 3,
      title: `a deleted ${kind} retires all-removed tests and regenerates tests with remaining atoms`,
      kind,
      judge: retiresExactly,
    },
    {
      key: `${kind}-retires-nothing-else`,
      tier: 2,
      title: `a deleted ${kind} retires no other test`,
      kind,
      judge: retiresNothingElse,
    },
  ]),
  {
    key: 'rewrap-touches-nothing',
    tier: 2,
    title: 'a rule re-wrapped over two lines touches no test',
    kind: 'wording',
    judge: (c) => {
      const touched = c
        .testsOf(c.mutant.estate.wrap ?? '')
        .filter(
          (id) =>
            c.impact.retire.some((e) => e.test === id) || c.impact.regenerate.some((e) => e.test === id),
        );
      return touched.length === 0 ? undefined : `${touched.length} tests of the re-wrapped rule touched`;
    },
  },
  {
    key: 'rewrap-no-reapproval',
    tier: 2,
    title: 'a re-wrap sends nothing to re-approval',
    kind: 'wording',
    judge: (c) =>
      c.impact.reapprove.length === 0 ? undefined : `${c.impact.reapprove.length} atoms sent to re-approval`,
  },
  {
    key: 'addition-listed-new',
    tier: 2,
    title: 'an added rule is listed as new',
    kind: 'addition',
    judge: (c) =>
      c.added.length > 0 && c.added.every((id) => c.impact.new.some((entry) => entry.atom === id))
        ? undefined
        : 'the added rule is not listed as new',
  },
  {
    key: 'addition-touches-nothing',
    tier: 2,
    title: 'an added rule retires and regenerates nothing',
    kind: 'addition',
    judge: (c) =>
      c.impact.retire.length + c.impact.regenerate.length === 0
        ? undefined
        : `${c.impact.retire.length} retired, ${c.impact.regenerate.length} regenerated`,
  },
  {
    key: 'semantic-reapproval',
    tier: 2,
    title: 'a rule whose meaning changed goes back for approval',
    kind: 'semantic',
    component: DIFF,
    judge: (c) => {
      const id = c.run.scanned.match.idOf.get('rule:no-webfetch');
      return c.impact.reapprove.some((entry) => entry.atom === id)
        ? undefined
        : 'the reworded rule is not sent to re-approval';
    },
  },
  {
    key: 'semantic-regenerates',
    tier: 2,
    title: 'the tests of a rule whose meaning changed are regenerated',
    kind: 'semantic',
    judge: (c) => {
      const tests = c.testsOf('rule:no-webfetch');
      const missed = tests.filter((id) => !c.impact.regenerate.some((entry) => entry.test === id));
      return missed.length === 0 ? undefined : `${missed.length} of ${tests.length} tests not regenerated`;
    },
  },
  {
    key: 'semantic-retires-nothing',
    tier: 2,
    title: 'a rule whose meaning changed retires nothing',
    kind: 'semantic',
    judge: (c) => (c.impact.retire.length === 0 ? undefined : `${c.impact.retire.length} retired`),
  },
  {
    key: 'spacing-touches-nothing',
    tier: 2,
    title: 'two spaces inside a rule touch no test',
    kind: 'spacing',
    component: DIFF,
    judge: (c) => {
      const touched = c
        .testsOf('rule:no-webfetch')
        .filter(
          (id) =>
            c.impact.regenerate.some((e) => e.test === id) || c.impact.retire.some((e) => e.test === id),
        );
      return touched.length === 0 && c.impact.reapprove.length === 0
        ? undefined
        : `${touched.length} tests touched, ${c.impact.reapprove.length} re-approvals`;
    },
  },
  {
    key: 'move-touches-nothing',
    tier: 2,
    title: 'two swapped output rules touch no test',
    kind: 'move',
    judge: (c) =>
      c.impact.retire.length + c.impact.regenerate.length + c.impact.reapprove.length === 0
        ? undefined
        : `${c.impact.retire.length} retired, ${c.impact.regenerate.length} regenerated, ${c.impact.reapprove.length} re-approvals`,
  },
  {
    key: 'rename-retires-nothing',
    tier: 4,
    title: 'a skill folder renamed with its name kept retires no test',
    kind: 'rename',
    judge: (c) =>
      c.impact.retire.length === 0
        ? undefined
        : `${c.impact.retire.length} tests retired, such as ${c.impact.retire[0]?.test}`,
  },
  {
    key: 'rename-no-new-atoms',
    tier: 4,
    title: 'a renamed skill folder brings no new atom',
    kind: 'rename',
    judge: (c) =>
      c.impact.new.length === 0
        ? undefined
        : `${c.impact.new.length} atoms listed as new, such as ${c.impact.new[0]?.atom}`,
  },
  {
    key: 'verdict-regenerates',
    tier: 3,
    title: 'a guard whose verdict changed has its tests regenerated',
    kind: 'verdict',
    judge: (c) => {
      const guard = c.mutant.id.replace(/^verdict:/, '');
      const id = c.run.scanned.map.atoms.find(
        (atom) => atom.kind === 'guard' && atom.fields?.name === guard,
      )?.id;
      const tests = c.tests.filter((t) => id && t.atoms.includes(id)).map((t) => t.id);
      const missed = tests.filter((test) => !c.impact.regenerate.some((entry) => entry.test === test));
      return missed.length === 0
        ? undefined
        : `${missed.length} of ${tests.length} tests of the guard not regenerated`;
    },
  },
  {
    key: 'verdict-retires-nothing',
    tier: 2,
    title: 'a guard whose verdict changed retires nothing',
    kind: 'verdict',
    judge: (c) => (c.impact.retire.length === 0 ? undefined : `${c.impact.retire.length} retired`),
  },
];

export function impactFamily(): Family {
  const family = 'maintain.impact';
  const items = itemsOf(
    family,
    6,
    IMPACT,
    IMPACT_ITEMS.map(({ key, tier, title, component }) => ({
      key,
      tier,
      title,
      ...(component ? { component } : {}),
    })),
  );
  return {
    id: family,
    level: 6,
    component: IMPACT,
    items,
    async evaluate(seed) {
      const run = await estateRun(seed);
      const tests: EstateTest[] = run.specs.map((spec) => {
        const retired = spec.loaded?.spec.metadata?.retired;
        return {
          id: spec.record.id,
          path: spec.record.path,
          file: spec.record.path,
          atoms: estateMeta(spec).atoms ?? [],
          ...(typeof retired === 'string' ? { retired } : {}),
        };
      });
      const before = new Set(run.rendered.atoms.map((atom) => atom.hid));
      const out = new Map<string, ItemResult>();
      const mutants = estateMutants(run.estate);
      for (const item of IMPACT_ITEMS) {
        const mutant = mutants.find((candidate) => candidate.kind === item.kind);
        if (!mutant) {
          out.set(`${family}.${item.key}`, { pass: false, detail: `no ${item.kind} mutant on this seed` });
          continue;
        }
        out.set(`${family}.${item.key}`, await judgeImpact(run, mutant, item, tests, before));
      }
      return out;
    },
  };
}

const impacts = new Map<string, Promise<{ impact: ImpactReport; added: string[] }>>();

async function judgeImpact(
  run: EstateRun,
  mutant: EstateMutant,
  item: ImpactItem,
  tests: EstateTest[],
  before: Set<string>,
): Promise<ItemResult> {
  try {
    const rendered = renderEstate(mutant.estate);
    const key = `${run.estate.seed}:${run.estate.profile}:${mutant.id}`;
    let known = impacts.get(key);
    if (!known) {
      known = (async () => {
        const scanned = await scanRendered(rendered);
        const diff = diffEstateMaps(run.scanned.map, scanned.map);
        const added = rendered.atoms
          .filter((atom) => !before.has(atom.hid))
          .flatMap((atom) => scanned.match.idOf.get(atom.hid) ?? []);
        return { impact: estateImpact(diff, tests), added };
      })();
      impacts.set(key, known);
    }
    const { impact, added } = await known;
    const after = new Set(rendered.atoms.map((atom) => atom.hid));
    const removed = new Set(
      [...before].filter((hid) => !after.has(hid)).flatMap((hid) => run.scanned.match.idOf.get(hid) ?? []),
    );
    const testsOf = (hid: string) => {
      const id = run.scanned.match.idOf.get(hid);
      return tests.filter((t) => id && t.atoms.includes(id)).map((t) => t.id);
    };
    const reason = item.judge({ run, mutant, impact, tests, removed, added, testsOf });
    return { pass: reason === undefined, detail: reason ?? 'holds' };
  } catch (cause) {
    return {
      pass: false,
      detail: `the item threw: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
}
