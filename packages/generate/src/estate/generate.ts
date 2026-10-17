import { runtimeLoaded } from '@agent-nexus/driftbench-adapters';
import { checkSpec, type Issue, stringifyBlockYaml } from '@agent-nexus/driftbench-core';
import type { GeneratedFile } from '../enumerate/generate';
import { formatJson } from '../enumerate/json';
import { build, buildRow, situationOfRow, specId, uniqueId, useOf } from './build-row';
import { anchoredLines, estateOwners, navigationFiles, taskAtoms, unitRoutes } from './context';
import { equivalenceKey } from './equivalence';
import {
  type Built,
  type Context,
  ESTATE_COMPLETE_DIR,
  ESTATE_DEFAULT_SEED,
  ESTATE_INCOMPLETE_DIR,
  ESTATE_ORDER_FILE,
  ESTATE_REPORT_FILE,
  type EstateGenerateInput,
  type EstateGenerateOptions,
  type EstateGenerateResult,
  EstateInputError,
  type EstateReport,
  type EstateSpecRecord,
  FOCUS_MIN,
  FOCUS_VARIANTS,
  REPLAY_CUSTOM_CHECKS,
  SITUATION_OF,
  type Totals,
} from './generate-types';
import {
  checkBank,
  checkSessions,
  type EstateAtom,
  type EstateMapInput,
  type EstatePlanRow,
  type InputIssue,
} from './inputs';
import { compilePredicate, isCompiledPredicate } from './predicates';
import { STATIC_DIR, STATIC_TEST_TYPES, type StaticTest, staticCheckOf } from './static';
import { ordered, runOrder, sortedKeys, totalsFor } from './summary';
import { MARKER_NAMES, MARKERS, type Marker, stageModel } from './then';
import { CHECK_GAP, helperUnitTestOf, UNIT_DIR, UNIT_TEST_TYPES, type UnitTest, unitTestOf } from './unit';

/**
 * `driftbench estate generate`: every approved plan row becomes one or more task specs, by code only.
 *
 * - Given: the estate (runtime and map hash), the session state of the row's cell, the workspace seed of
 *   the situation, and the event of a hazard or a helper stop.
 * - When: an approved phrase of the phrase bank for the situation the row needs (the trigger, a situation
 *   just outside it, a near miss, a misroute, a skip temptation), drawn by the seed; or, for a replay row,
 *   the recorded ask of each session of that situation.
 * - Then: the evidence predicates of the row's atoms, as existing checks (see `then.ts`), and the outcome
 *   the situation declares: the paths it may touch, every other path untouched.
 *
 * A row that the bank, the sessions or the checks cannot fill is written to `incomplete/` with named
 * markers. Same inputs and seed give the same files, byte for byte.
 *
 * Fallbacks (on by default, off with `fallback: false`), so a row is never blocked by a missing phrase or
 * an undeclared outcome alone. Each is marked on the spec, and a reviewed input always wins:
 * - the ask: with no approved phrase for the row, an ask written by code from the atoms (`asks.ts`), tag
 *   `ask:code`; the same for a deviation message and a resume message;
 * - the outcome: with no paths declared by the situation and none the atoms name, the effect read from the
 *   atoms: nothing changes for a negative control, a denied tool, a guard that denies or blocks, or a row
 *   whose skills and helpers may use no writing tool; otherwise nothing is deleted. Recorded in
 *   `metadata.estate.outcome`.
 *
 * `focus` lists atoms to put first: the run order (`run-order.txt`) lists the complete specs of rows naming
 * a focus atom, then those of guards, gates and invariants, then the rest.
 */

export { findSituation, specId, useOf } from './build-row';
export {
  type AskSource,
  ESTATE_COMPLETE_DIR,
  ESTATE_DEFAULT_SEED,
  ESTATE_INCOMPLETE_DIR,
  ESTATE_ORDER_FILE,
  ESTATE_REPORT_FILE,
  ESTATE_SEEDER,
  type EstateGenerateInput,
  type EstateGenerateOptions,
  type EstateGenerateResult,
  EstateInputError,
  type EstateReport,
  type EstateSpecRecord,
  FOCUS_MIN,
  FOCUS_VARIANTS,
  NEGATIVE_TESTS,
  PRIORITY_KINDS,
  REPLAY_CUSTOM_CHECKS,
  SITUATION_OF,
  type Totals,
  WRITING_TOOLS,
} from './generate-types';
export { renderEstateSummary } from './summary';

/** Checks the inputs against each other; throws an EstateInputError listing every issue. */
export function checkEstateInputs(input: EstateGenerateInput): void {
  const issues: InputIssue[] = [];
  const { map, plan, bank, sessions } = input;
  if (plan.mapHash !== map.hash) {
    issues.push({
      path: 'plan.mapHash',
      message: `the plan was made from map ${plan.mapHash.slice(0, 12)}, the map given is ${map.hash.slice(0, 12)}`,
    });
  }
  const atoms = new Map(map.atoms.map((atom) => [atom.id, atom]));
  const rows = new Set<string>();
  plan.rows.forEach((row, index) => {
    const at = `plan.rows.${index}`;
    if (rows.has(row.id)) issues.push({ path: `${at}.id`, message: `${row.id} twice` });
    rows.add(row.id);
    if (!(row.testType in SITUATION_OF)) {
      issues.push({ path: `${at}.testType`, message: `${row.testType} is no test type` });
    }
    row.atomIds.forEach((id, position) => {
      const atom = atoms.get(id);
      if (!atom) issues.push({ path: `${at}.atomIds.${position}`, message: `${id} is no atom of the map` });
      else if (!atom.approved && row.status !== 'struck') {
        issues.push({ path: `${at}.atomIds.${position}`, message: `${id} is not approved` });
      }
    });
  });
  issues.push(...checkBank(bank, map).map((issue) => ({ ...issue, path: `phrases.${issue.path}` })));
  if (sessions) {
    issues.push(
      ...checkSessions(sessions, bank, map).map((issue) => ({ ...issue, path: `sessions.${issue.path}` })),
    );
  }
  if (issues.length > 0) {
    throw new EstateInputError(
      `${issues.length} input issue${issues.length === 1 ? '' : 's'}; nothing written`,
      issues,
    );
  }
}

/** Generates the suite. Pure: no clock, no file system. */
export function generateEstateSuite(
  input: EstateGenerateInput,
  options: EstateGenerateOptions,
): EstateGenerateResult {
  checkEstateInputs(input);
  const lookup = new Map(input.map.atoms.map((atom) => [atom.id, atom]));
  const owners = estateOwners(input.map.atoms, input.map.edges);
  input = {
    ...input,
    plan: {
      ...input.plan,
      rows: input.plan.rows.map((row) => ({
        ...row,
        atomIds: taskAtoms(
          row.atomIds.map((id) => lookup.get(id) as EstateAtom),
          lookup,
          owners,
        ).map((atom) => atom.id),
      })),
    },
  };
  const seed = options.seed ?? ESTATE_DEFAULT_SEED;
  const checks = [...(options.customChecks ?? REPLAY_CUSTOM_CHECKS)].sort();
  const ctx: Context = {
    map: input.map,
    atoms: new Map(input.map.atoms.map((atom) => [atom.id, atom])),
    bank: input.bank,
    ...(input.sessions ? { sessions: input.sessions } : {}),
    seed,
    owners,
    routes: unitRoutes(input.map.atoms, input.map.edges),
    navigation: navigationFiles(input.map.documents),
    anchored: anchoredLines(input.map.atoms),
    paths: options.paths,
    fallback: options.fallback ?? true,
    judge: options.judge ?? true,
    files: new Set(options.files ?? mapFiles(input.map)),
    ...(loadedOf(options, input.map.runtime) ? { loaded: loadedOf(options, input.map.runtime) } : {}),
    units: [
      ...new Set(
        input.map.atoms
          .filter((atom) => atom.kind === 'skill')
          .map((atom) => atom.fields?.name)
          .filter((name): name is string => typeof name === 'string'),
      ),
    ].sort(),
    stages: stageModel(input.map.atoms),
    outputRules: outputRulesOf(input.map.atoms),
    skills: new Set(
      input.map.atoms
        .filter((atom) => atom.kind === 'skill')
        .map((atom) => atom.fields?.name)
        .filter((name): name is string => typeof name === 'string'),
    ),
    customChecks: new Set(checks),
  };

  const files: GeneratedFile[] = [];
  const records: EstateSpecRecord[] = [];
  const perTestType: Record<string, Totals> = {};
  const perMode: Record<string, Totals> = {};
  const gaps = new Map<string, { specs: Set<string>; atoms: Set<string>; details: Set<string> }>();
  const invalid: EstateReport['invalid'] = [];
  const lint: EstateReport['lint'] = [];
  const replay: EstateReport['replay'] = [];
  const waiting: string[] = [];
  const struck: string[] = [];
  const used = new Set<string>();
  const unitSeen = new Set<string>();
  const unitWritten: UnitTest[] = [];
  const unitSkipped: string[] = [];
  const focusCases = new Map<string, Set<string>>();
  const incomplete: EstateReport['incomplete'] = [];
  const equivalents = new Map<
    string,
    {
      built: Built;
      row: EstatePlanRow;
      file: GeneratedFile;
      record: EstateSpecRecord;
      rows: string[];
      count: number;
    }
  >();
  const askTexts: string[] = [];
  let collapsed = 0;
  let blocks = 0;
  let judged = 0;
  const focusCaseKey = (built: Built, row: EstatePlanRow): string =>
    JSON.stringify([(built.spec.blocks as Array<{ when: unknown }>)[0]?.when, sortedKeys(row.cell)]);

  /** Writes one built spec: its file, its record, the totals of its row's test type and mode, its gaps. */
  const emit = (built: Built, row: EstatePlanRow, totalsType: Totals, totalsMode: Totals): void => {
    const markers = [...new Set(built.gaps.map((entry) => entry.marker))].sort() as Marker[];
    const complete = markers.length === 0;
    const key = complete ? equivalenceKey(built, row, ctx.atoms.get(row.atomIds[0] ?? '')) : undefined;
    const equivalent = key === undefined ? undefined : equivalents.get(key);
    if (equivalent) {
      equivalent.count += 1;
      collapsed += 1;
      equivalent.rows.push(row.variantOf ?? row.id);
      equivalent.record.atoms = [...new Set([...equivalent.record.atoms, ...row.atomIds])];
      const meta = (equivalent.built.spec.metadata as { estate: Record<string, unknown> }).estate;
      meta.atoms = equivalent.record.atoms;
      equivalent.record.judged = [...new Set([...equivalent.record.judged, ...built.judgedAtoms])];
      if (equivalent.record.judged.length > 0) meta.judged = equivalent.record.judged;
      meta.equivalence = { count: equivalent.count, planRows: equivalent.rows };
      equivalent.file.text = specText(equivalent.built, equivalent.row, ctx, []);
      for (const atom of row.atomIds) {
        const cases = focusCases.get(atom) ?? new Set<string>();
        cases.add(focusCaseKey(built, row));
        focusCases.set(atom, cases);
      }
      return;
    }
    const text = specText(built, row, ctx, markers);
    // The text is the writer's rendering of this object, so the object is what is checked (as enumerate does).
    const loaded = checkSpec(built.spec, built.id);
    if (!loaded.ok) {
      invalid.push({ id: built.id, errors: loaded.errors });
      return;
    }
    const unexpected = loaded.warnings.filter((warning) => !explained(warning, markers));
    if (unexpected.length > 0) lint.push({ id: built.id, warnings: unexpected });
    const folder = complete ? ESTATE_COMPLETE_DIR : ESTATE_INCOMPLETE_DIR;
    // By mode first, so a replay run takes `specs/replay` and nothing else.
    const path = `${folder}/${row.mode}/${row.testType}/${built.id}.yaml`;
    const file = { path, text };
    files.push(file);
    const record: EstateSpecRecord = {
      id: built.id,
      path,
      row: row.variantOf ?? row.id,
      testType: row.testType,
      mode: row.mode,
      complete,
      markers,
      atoms: row.atomIds,
      ask: built.ask,
      outcome: built.outcome,
      judged: built.judgedAtoms,
      ...(built.session ? { session: built.session.name } : {}),
      ...(built.expect ? { expect: built.expect } : {}),
    };
    records.push(record);
    if (key !== undefined)
      equivalents.set(key, { built, row, file, record, rows: [row.variantOf ?? row.id], count: 1 });
    if (!complete) incomplete.push({ spec: built.id, path, row: row.id, reasons: built.gaps });
    if (complete) {
      const ask = (built.spec.blocks as Array<{ when?: { user?: string } }>)[0]?.when?.user;
      if (ask && built.ask !== 'none') askTexts.push(ask);
      const key = focusCaseKey(built, row);
      for (const atom of row.atomIds) {
        const cases = focusCases.get(atom) ?? new Set<string>();
        cases.add(key);
        focusCases.set(atom, cases);
      }
    }
    if (built.session && built.expect && complete) {
      replay.push({ spec: built.id, session: built.session.name, planRow: row.id, expect: built.expect });
    }
    for (const totals of [totalsType, totalsMode]) {
      totals.specs += 1;
      if (complete) totals.complete += 1;
      else totals.incomplete += 1;
    }
    blocks += built.blocks;
    if (complete && built.judged > 0) judged += 1;
    for (const entry of built.gaps) {
      const known = gaps.get(entry.marker) ?? { specs: new Set(), atoms: new Set(), details: new Set() };
      known.specs.add(built.id);
      known.atoms.add(entry.atom);
      known.details.add(entry.detail);
      gaps.set(entry.marker, known);
    }
  };

  for (const row of input.plan.rows) {
    if (row.status === 'struck') {
      struck.push(row.id);
      continue;
    }
    if (row.status !== 'approved') {
      waiting.push(row.id);
      continue;
    }
    const totalsType = totalsFor(perTestType, row.testType);
    const totalsMode = totalsFor(perMode, row.mode);
    totalsType.rows += 1;
    totalsMode.rows += 1;
    const head = ctx.atoms.get(row.atomIds[0] ?? '');
    // A guard or script row also gets a unit test, once per test type and atom: the guard or the script run
    // directly by driftbench estate unit, with no model in the loop.
    if (head && UNIT_TEST_TYPES.has(row.testType)) {
      const key = `${row.testType}:${head.id}`;
      if (!unitSeen.has(key)) {
        unitSeen.add(key);
        const id = `unit.${row.testType}.${head.id}`;
        const built = unitTestOf(row, head, ctx.atoms, ctx.map.hash, id);
        if (typeof built === 'string') unitSkipped.push(`${id}: ${built}`);
        else {
          files.push({ path: `${UNIT_DIR}/${row.testType}/${id}.json`, text: formatJson(built) });
          unitWritten.push(built);
        }
      }
    }
    // A static row with a check the static runner knows is a static test, not a spec.
    const check = head && STATIC_TEST_TYPES.has(row.testType) ? staticCheckOf(row, head) : undefined;
    if (head && check !== undefined && typeof check !== 'string') {
      const id = uniqueId(specId(row.id), used);
      const test: StaticTest = {
        id,
        planRow: row.id,
        testType: row.testType as StaticTest['testType'],
        atom: head.id,
        title: head.title,
        check,
        mapHash: ctx.map.hash,
      };
      const path = `${STATIC_DIR}/${row.testType}/${id}.json`;
      files.push({ path, text: formatJson(test) });
      records.push({
        id,
        path,
        row: row.id,
        testType: row.testType,
        mode: row.mode,
        complete: true,
        markers: [],
        atoms: row.atomIds,
        ask: 'none',
        outcome: 'static',
        judged: [],
      });
      for (const totals of [totalsType, totalsMode]) {
        totals.specs += 1;
        totals.complete += 1;
      }
      continue;
    }
    for (const built of buildRow(row, ctx, used)) {
      emit(built, row, totalsType, totalsMode);
      // A helper run alone is also a JSON run record: the task and the seeded files of the spec just built, for
      // `estate unit --record` to run on the original estate and write the helper's answer into.
      const helper = row.testType === 'contract_alone' ? head : undefined;
      if (helper?.kind === 'subagent' && built.expect === undefined) {
        const when = (built.spec.blocks as Array<{ when?: { user?: unknown } }> | undefined)?.[0]?.when;
        const seeded = (
          built.spec.given as { world?: { workspace?: { files?: Record<string, string> } } } | undefined
        )?.world?.workspace?.files;
        const id = `unit.contract_alone.${helper.id}`;
        const test = helperUnitTestOf(
          helper,
          { task: typeof when?.user === 'string' ? when.user : '', files: seeded ?? {} },
          ctx.map.hash,
          id,
          row,
        );
        if (typeof test === 'string') unitSkipped.push(`${id}: ${test}`);
        else if (!unitSeen.has(`contract_alone:${helper.id}`)) {
          unitSeen.add(`contract_alone:${helper.id}`);
          files.push({ path: `${UNIT_DIR}/contract_alone/${id}.json`, text: formatJson(test) });
          unitWritten.push(test);
        }
      }
    }
  }

  // Focus atoms: variants of their rows, another ask and another situation each, until FOCUS_MIN complete
  // specs name the atom (a mutant of it then has several chances to turn one red).
  for (const atom of options.focus ? [...new Set(options.focus)] : []) {
    const doneOf = () => focusCases.get(atom)?.size ?? 0;
    if (doneOf() >= FOCUS_MIN) continue;
    const rows = input.plan.rows.filter(
      (row) =>
        row.status === 'approved' &&
        row.atomIds.includes(atom) &&
        row.mode !== 'replay' &&
        !STATIC_TEST_TYPES.has(row.testType),
    );
    const completeRows = new Set(records.filter((record) => record.complete).map((record) => record.row));
    rows.sort((a, b) => Number(completeRows.has(b.id)) - Number(completeRows.has(a.id)));
    for (let variant = 1; variant <= FOCUS_VARIANTS.length && doneOf() < FOCUS_MIN; variant += 1) {
      for (const row of rows) {
        if (doneOf() >= FOCUS_MIN) break;
        const varied: EstatePlanRow = {
          ...row,
          id: `${row.id}.v${variant}`,
          cell: { ...row.cell, ...(FOCUS_VARIANTS[variant - 1] ?? {}) },
          variantOf: row.id,
        };
        const atoms = varied.atomIds.map((id) => ctx.atoms.get(id) as EstateAtom);
        const use = useOf(varied);
        const situation = use === 'none' ? undefined : situationOfRow(ctx, use, varied, atoms[0]);
        const built = build(varied, atoms, ctx, used, situation, undefined, false, variant);
        if (built.gaps.length === 0 && focusCases.get(atom)?.has(focusCaseKey(built, varied))) continue;
        emit(built, varied, totalsFor(perTestType, row.testType), totalsFor(perMode, row.mode));
      }
    }
  }

  const complete = records.filter((record) => record.complete).length;
  const done = records.filter((record) => record.complete);
  const asks = { bank: 0, code: 0, session: 0, none: 0 };
  const outcomes: Record<string, number> = {};
  for (const record of done) {
    asks[record.ask] += 1;
    outcomes[record.outcome] = (outcomes[record.outcome] ?? 0) + 1;
  }
  const focus = options.focus ? [...new Set(options.focus)] : undefined;
  const order = runOrder(records, ctx.atoms, focus ?? []);
  files.push({ path: ESTATE_ORDER_FILE, text: order.length === 0 ? '' : `${order.join('\n')}\n` });
  const report: EstateReport = {
    generator: 'driftbench estate generate',
    map: {
      path: options.paths.map,
      runtime: input.map.runtime,
      hash: input.map.hash,
      atoms: input.map.atoms.length,
    },
    plan: {
      path: options.paths.plan,
      rows: input.plan.rows.length,
      approved: input.plan.rows.filter((row) => row.status === 'approved').length,
      proposed: waiting.length,
      struck: struck.length,
    },
    phrases: {
      path: options.paths.phrases,
      situations: input.bank.situations.length,
      phrases: input.bank.situations.reduce(
        (sum, situation) => sum + situation.phrases.filter((phrase) => phrase.approved).length,
        0,
      ),
      workspaces: input.bank.workspaces.length,
    },
    sessions:
      input.sessions && options.paths.sessions
        ? { path: options.paths.sessions, sessions: input.sessions.sessions.length }
        : null,
    options: { seed, checks, fallback: ctx.fallback, judge: ctx.judge === true },
    summary: { specs: records.length, blocks, complete, incomplete: records.length - complete, judged },
    incomplete,
    equivalence: {
      collapsed,
      groups: [...equivalents.values()]
        .filter((group) => group.count > 1)
        .map((group) => ({
          spec: group.built.id,
          count: group.count,
          atoms: group.record.atoms,
          rows: group.rows,
        })),
    },
    quality: {
      completeShare: records.length ? complete / records.length : 0,
      askedTests: askTexts.length,
      distinctAsks: new Set(askTexts).size,
      distinctAsksPer100: askTexts.length ? (new Set(askTexts).size * 100) / askTexts.length : 0,
    },
    unit: {
      tests: unitWritten.length,
      guards: new Set(unitWritten.filter((test) => test.target.kind === 'guard').map((test) => test.atom))
        .size,
      scripts: unitWritten.filter((test) => test.target.kind === 'script').length,
      helpers: unitWritten.filter((test) => test.target.kind === 'subagent').length,
      cases: unitWritten.reduce((sum, test) => sum + test.cases.length, 0),
      checks: {
        tested: unitWritten.filter((test) => test.target.kind === 'guard' && test.target.check !== undefined)
          .length,
        needsTrigger: unitSkipped.filter((line) => line.endsWith(CHECK_GAP.trigger)).length,
        needsHost: unitSkipped.filter((line) => line.endsWith(CHECK_GAP.host)).length,
      },
      skipped: unitSkipped,
    },
    sources: {
      asks,
      outcomes: sortedKeys(outcomes),
      judged: done.filter((record) => record.judged.length > 0).length,
    },
    focus: focus
      ? {
          atoms: focus.length,
          complete: done.filter((record) => record.atoms.some((atom) => focus.includes(atom))).length,
          perAtom: focus.map((atom) => {
            const own = records.filter((record) => record.atoms.includes(atom));
            return {
              atom,
              complete: own.filter((record) => record.complete).length,
              incomplete: own.filter((record) => !record.complete).length,
              markers: [
                ...new Set(own.filter((record) => !record.complete).flatMap((record) => record.markers)),
              ].sort(),
            };
          }),
        }
      : null,
    perTestType: ordered(perTestType, Object.keys(SITUATION_OF)),
    perMode: ordered(perMode, ['replay', 'unit', 'live']),
    gaps: [...gaps.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([marker, entry]) => ({
        marker,
        specs: entry.specs.size,
        atoms: [...entry.atoms].sort(),
        details: [...entry.details].sort(),
      })),
    replay,
    waiting,
    struck,
    invalid,
    lint,
  };
  files.push({ path: ESTATE_REPORT_FILE, text: formatJson(report) });
  return { files, report, specs: records };
}

/** The rule for files the runtime loads by itself: the caller's, else the runtime adapter's. */
function loadedOf(options: EstateGenerateOptions, runtime: string): ((path: string) => boolean) | undefined {
  if (options.loaded) return options.loaded;
  return runtimeLoaded(runtime);
}

/** The YAML text of a spec, with a header. */
function specText(built: Built, row: EstatePlanRow, ctx: Context, markers: readonly Marker[]): string {
  const header = [
    `# Generated by driftbench estate generate (plan row ${row.id}, seed ${ctx.seed}) from ${ctx.paths.plan} and ${ctx.paths.map}, map hash ${ctx.map.hash.slice(0, 12)}.`,
    built.ask === 'code'
      ? '# Code wrote it: no approved phrase yet, so code wrote the ask from the atoms (tag ask:code); the Then comes from the atoms of the row.'
      : '# Code wrote it: the ask is an approved phrase of the bank, the Then comes from the atoms of the row.',
    '# Do not edit it by hand: change the estate, the plan or the bank and generate again. Fictional data only.',
  ];
  if (markers.length > 0) {
    header.push(`# Not runnable yet: ${markers.join(', ')} (see metadata.estate.needs).`);
  }
  const body = stringifyBlockYaml(built.spec);
  return `${header.join('\n')}\n${body}`;
}

/** A lint warning the spec's markers explain: an incomplete spec references criteria nobody defines. */
function explained(warning: Issue, markers: readonly Marker[]): boolean {
  if (markers.length === 0) return false;
  if (warning.code === 'CRITERION_UNRESOLVED') {
    return [...MARKER_NAMES].some((name) => warning.message.includes(name));
  }
  if (warning.code === 'TASK_WITHOUT_OUTCOME') {
    return markers.includes(MARKERS.outcome) || markers.includes(MARKERS.static);
  }
  return false;
}

/** The must_not patterns the approved register atoms of the map compile into (`predicates.ts`). */
export function outputRulesOf(atoms: readonly EstateAtom[]): string[] {
  const out = new Set<string>();
  for (const atom of atoms) {
    if (atom.kind !== 'register' || !atom.approved) continue;
    for (const evidence of atom.evidence) {
      if (evidence.type !== 'custom' || !isCompiledPredicate(evidence.name)) continue;
      for (const pattern of compilePredicate(evidence.name, evidence.options)?.mustNot ?? [])
        out.add(pattern);
    }
  }
  return [...out].sort();
}

/** The files a map knows: those its atoms are read from, and the references and scripts that exist. */
export function mapFiles(map: EstateMapInput): string[] {
  const files = new Set<string>();
  for (const atom of map.atoms) {
    if (atom.provenance?.file) files.add(atom.provenance.file);
    const path = atom.fields?.path;
    if (
      (atom.kind === 'reference' || atom.kind === 'script') &&
      typeof path === 'string' &&
      atom.fields?.exists !== false
    ) {
      files.add(path);
    }
  }
  return [...files].sort();
}
