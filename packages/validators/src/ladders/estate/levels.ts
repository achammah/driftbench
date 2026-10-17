import {
  type Atom,
  AtomKind,
  diffEstateMaps,
  type EstateMap,
  type EstateTest,
  estateImpact,
  type PlanRow,
  situationSpace,
  toEstateSpaceMap,
} from '@agent-nexus/driftbench-estate';
import type { Item, Measure } from '../../ladder';
import { componentOfKind, componentOfMarker, ESTATE_COMPONENTS } from './components';
import { follow } from './follower';
import type { HiddenEstate } from './hidden';
import { estateMutants } from './mutants';
import {
  asksOf,
  atomKey,
  type EstateRun,
  type GeneratedSpec,
  replayChecks,
  replayOnFollower,
  scanRendered,
} from './pipeline';
import { type ExpectedAtom, renderEstate } from './render';

/**
 * The seven levels of the estate validator (docs/validators.md section 6), each a ratio of two counts with
 * the items behind a failure. A level reads the run of its seed and never edits it.
 */

/** Level 3: positive asks per route the plan is built with (the plan's default). */
export const ROUTE_ASKS = 3;
/** Level 5: the mutation score each atom kind must reach. */
export const MUTATION_SCORE = 0.9;
/** Atom kinds an agent mutant deletes from the follower: a setting and an invariant have no act to delete. */
export const AGENT_KINDS: readonly string[] = AtomKind.options.filter(
  (kind) => kind !== 'setting' && kind !== 'invariant',
);

const SHOWN = 6;

function shown(list: readonly string[]): string {
  const head = list.slice(0, SHOWN).join(', ');
  return list.length > SHOWN ? `${head} and ${list.length - SHOWN} more` : head;
}

function lineOf(run: Pick<EstateRun, 'rendered'>, file: string, line: number): string {
  return run.rendered.files[file]?.split('\n')[line - 1]?.trim() ?? '';
}

// Level 1 ---------------------------------------------------------------------------------------------------

/** Level 1: every planted atom found, nothing else found, by kind; every edge of the design found. */
export function atomLevel(run: EstateRun): Measure {
  const { match, map } = run.scanned;
  const items: Item[] = [];
  const ratios: number[] = [];
  for (const kind of AtomKind.options) {
    const expected = run.rendered.atoms.filter((atom) => atom.kind === kind).length;
    const found = map.atoms.filter((atom) => atom.kind === kind).length;
    const matched = run.rendered.atoms.filter(
      (atom) => atom.kind === kind && match.idOf.has(atom.hid),
    ).length;
    if (expected > 0) ratios.push(matched / expected);
    if (found > 0) ratios.push(matched / found);
  }
  for (const atom of match.missed) {
    const refusal = run.scanned.refusals.find((text) => text.startsWith(atom.file));
    items.push({
      id: `atom-missed:${atom.hid}`,
      component: componentOfKind(atom),
      detail: `${atom.kind} ${atom.key ? `${atom.key} ` : ''}at ${atom.file}:${atom.line} was planted and not found: "${lineOf(run, atom.file, atom.line)}"${refusal ? `; the scan refused: ${refusal}` : ''}`,
    });
  }
  for (const atom of match.extra) {
    items.push({
      id: `atom-extra:${atom.id}`,
      component: componentOfKind({ kind: atom.kind, hid: atom.id }),
      detail: `${atom.kind} at ${atom.provenance.file}:${atom.provenance.startLine} was found and never planted: "${atom.provenance.quote}"`,
    });
  }
  const edges = new Set(map.edges.map((edge) => `${edge.from} ${edge.kind} ${edge.to}`));
  const id = (hid: string) => (hid.startsWith('event.') ? hid : match.idOf.get(hid));
  let foundEdges = 0;
  for (const edge of run.rendered.edges) {
    const from = id(edge.from);
    const to = id(edge.to);
    if (from && to && edges.has(`${from} ${edge.kind} ${to}`)) {
      foundEdges += 1;
      continue;
    }
    items.push({
      id: `edge-missed:${edge.from}>${edge.kind}>${edge.to}`,
      component: ESTATE_COMPONENTS.edges,
      detail:
        from && to
          ? `the ${edge.kind} edge from ${from} to ${to} is in the design and not in the map`
          : `the ${edge.kind} edge from ${edge.from} to ${edge.to} has an end the scan did not find`,
    });
  }
  if (run.rendered.edges.length > 0) ratios.push(foundEdges / run.rendered.edges.length);
  return { value: ratios.length === 0 ? 0 : Math.min(...ratios), items };
}

// Level 2 ---------------------------------------------------------------------------------------------------

/** Level 2: the lint gives every planted defect and no other finding (trust findings left aside). */
export function lintLevel(run: EstateRun): Measure {
  const expected = run.rendered.findings.map((finding) => ({
    ...finding,
    subject: finding.atom ? (run.scanned.match.idOf.get(finding.atom) ?? finding.atom) : finding.subject,
  }));
  const found = run.lint.findings.filter((finding) => finding.code !== 'UNENFORCED');
  const key = (code: string, subject: string) => `${code} ${subject}`;
  const open = new Set(found.map((finding) => key(finding.code, finding.subject)));
  const items: Item[] = [];
  let matched = 0;
  for (const finding of expected) {
    if (open.delete(key(finding.code, finding.subject))) {
      matched += 1;
      continue;
    }
    items.push({
      id: `lint-missed:${finding.code}:${finding.subject}`,
      component: ESTATE_COMPONENTS.lint,
      detail: `the planted defect ${finding.defect} should give ${finding.code} on ${finding.subject}; the lint did not`,
    });
  }
  for (const finding of found.filter((candidate) => open.has(key(candidate.code, candidate.subject)))) {
    items.push({
      id: `lint-extra:${finding.code}:${finding.subject}`,
      component: finding.code === 'QUOTE_DRIFT' ? ESTATE_COMPONENTS.scan : ESTATE_COMPONENTS.analyze,
      detail: `the lint gave ${finding.code} with no defect planted: ${finding.message}`,
    });
  }
  const total = expected.length + items.filter((item) => item.id.startsWith('lint-extra:')).length;
  return { value: total === 0 ? 1 : matched / total, items };
}

// Level 3 ---------------------------------------------------------------------------------------------------

/** The test types the design requires per atom kind (docs/estate.md section 4), read by the validator. */
export function requiredRows(
  atom: Atom,
  askClasses: readonly string[],
): Array<{ type: string; count: number }> {
  const fields = atom.fields ?? {};
  switch (atom.kind) {
    case 'instruction':
      return [
        { type: 'obligation', count: 1 },
        { type: 'outside_trigger', count: 1 },
        { type: 'twin', count: 1 },
      ];
    case 'gate':
      return [
        { type: 'ordered_pair', count: 1 },
        { type: 'skip_pressure', count: 1 },
      ];
    case 'route':
      return [
        { type: 'route_positive', count: ROUTE_ASKS },
        { type: 'route_near_miss', count: 1 },
        { type: 'misroute', count: 1 },
      ];
    case 'reference':
      return [{ type: 'read_when', count: 1 }];
    case 'script':
      return [{ type: 'script_fixture', count: 1 }];
    case 'subagent':
      return [
        { type: 'dispatch', count: 1 },
        { type: 'contract_alone', count: 1 },
        { type: 'stop_resume', count: 1 },
      ];
    case 'guard':
      return ['guard_positive', 'guard_negative', 'guard_hostile', 'guard_speed', 'guard_register'].map(
        (type) => ({ type, count: 1 }),
      );
    case 'tool':
      return [{ type: fields.effect === 'deny' ? 'tool_denied' : 'tool_boundary', count: 1 }];
    case 'stage':
      return fields.anytime === true
        ? [{ type: 'stage_anytime', count: 1 }]
        : [
            { type: 'stage_order', count: 1 },
            { type: 'stage_skip', count: 1 },
          ];
    case 'register':
      return [{ type: 'register_sample', count: Math.max(1, askClasses.length) }];
    case 'hazard':
      return [{ type: 'hazard_recovery', count: 1 }];
    case 'invariant':
      return [{ type: 'invariant', count: 1 }];
    default:
      return [];
  }
}

type Dimension = { id: string; values: string[] };

/**
 * Every pair of values of two situation axes (the target atom being one axis) that some full cell allows
 * under the constraint list, found by a search over the other axes: the slow and obviously correct way.
 */
export function allowedPairs(
  dimensions: readonly Dimension[],
  constraints: ReadonlyArray<Record<string, string>>,
): Array<[string, string, string, string]> {
  // Each forbid is indexed under every one of its literals, so a check reads only the forbids that name a value the
  // cell holds. The answer is the one a scan of the whole list gives.
  const byLiteral = new Map<string, Array<Record<string, string>>>();
  for (const forbid of constraints)
    for (const [dimension, value] of Object.entries(forbid)) {
      const key = `${dimension}=${value}`;
      byLiteral.set(key, [...(byLiteral.get(key) ?? []), forbid]);
    }
  const forbids = (cell: Record<string, string>) =>
    Object.entries(cell).some(([dimension, value]) =>
      (byLiteral.get(`${dimension}=${value}`) ?? []).some((forbid) =>
        Object.entries(forbid).every(([name, wanted]) => cell[name] === wanted),
      ),
    );
  // A search that fills the open axis with the fewest values left first, and drops a value a forbid already rules
  // out, finds a cell as the plain search does, in far fewer steps.
  const extends_ = (cell: Record<string, string>): boolean => {
    if (forbids(cell)) return false;
    let best: { dimension: Dimension; values: string[] } | undefined;
    for (const dimension of dimensions) {
      if (cell[dimension.id] !== undefined) continue;
      const values = dimension.values.filter((value) => !forbids({ ...cell, [dimension.id]: value }));
      if (values.length === 0) return false;
      if (!best || values.length < best.values.length) best = { dimension, values };
    }
    if (!best) return true;
    const open = best;
    return open.values.some((value) => extends_({ ...cell, [open.dimension.id]: value }));
  };
  const out: Array<[string, string, string, string]> = [];
  for (let a = 0; a < dimensions.length; a += 1) {
    for (let b = a + 1; b < dimensions.length; b += 1) {
      const da = dimensions[a] as Dimension;
      const db = dimensions[b] as Dimension;
      for (const va of da.values) {
        for (const vb of db.values) {
          if (extends_({ [da.id]: va, [db.id]: vb })) out.push([da.id, va, db.id, vb]);
        }
      }
    }
  }
  return out;
}

/**
 * The space the plan is built over: the declared one, narrowed by the relevance of each event to the targets whose
 * contract it concerns (packages/estate/src/plan/relevance.ts). A pair the plan leaves out for lack of relevance is
 * not an allowed pair of the plan.
 */
export function planSpace(map: EstateMap) {
  return situationSpace(map, toEstateSpaceMap(map)).space;
}

/** Level 3: every allowed pair is in a row of the plan, and every approved atom has its mandatory rows. */
export function planLevel(run: EstateRun): Measure {
  const map = run.scanned.map;
  const space = planSpace(map);
  const situations = space.dimensions.filter((dimension) => !dimension.id.startsWith('atoms.'));
  const targets = space.dimensions.filter((dimension) => dimension.id.startsWith('atoms.'));
  const dimensions: Dimension[] = [
    ...situations.map((dimension) => ({
      id: dimension.id,
      values: dimension.values.map((value) => value.id),
    })),
    { id: 'target', values: targets.flatMap((dimension) => dimension.values.map((value) => value.id)) },
  ];
  const constraints = space.constraints.map((constraint) => {
    const forbid: Record<string, string> = {};
    for (const [dimension, value] of Object.entries(constraint.forbid)) {
      forbid[dimension.startsWith('atoms.') ? 'target' : dimension] = value;
    }
    return forbid;
  });
  const pairs = allowedPairs(dimensions, constraints);
  const covered = new Set<string>();
  for (const row of run.plan.plan.rows) {
    const cell: Record<string, string> = {};
    for (const [dimension, value] of Object.entries(row.cell)) {
      cell[dimension.startsWith('atoms.') ? 'target' : dimension] = value;
    }
    const ids = Object.keys(cell);
    for (const a of ids) for (const b of ids) if (a !== b) covered.add(`${a}=${cell[a]}|${b}=${cell[b]}`);
  }
  const items: Item[] = [];
  let pairsCovered = 0;
  const missing: string[] = [];
  for (const [da, va, db, vb] of pairs) {
    if (covered.has(`${da}=${va}|${db}=${vb}`)) pairsCovered += 1;
    else missing.push(`${da}=${va} with ${db}=${vb}`);
  }
  if (missing.length > 0) {
    items.push({
      id: 'pairs-uncovered',
      component: ESTATE_COMPONENTS.pairwise,
      detail: `${missing.length} of ${pairs.length} allowed pairs are in no row: ${shown(missing)}`,
    });
  }
  const askClasses = (space.dimensions.find((dimension) => dimension.id === 'ask_class')?.values ?? []).map(
    (value) => value.id,
  );
  let required = 0;
  let present = 0;
  for (const atom of map.atoms.filter((candidate) => candidate.approved)) {
    const own = (type: string) =>
      run.plan.plan.rows.filter(
        (row: PlanRow) =>
          row.testType === type &&
          (atom.kind === 'skill' ? row.atomIds.includes(atom.id) : row.atomIds[0] === atom.id),
      ).length;
    const needs =
      atom.kind === 'skill' ? [{ type: 'route_positive', count: 1 }] : requiredRows(atom, askClasses);
    for (const need of needs) {
      required += need.count;
      const has = Math.min(own(need.type), need.count);
      present += has;
      if (has < need.count) {
        items.push({
          id: `rows-missing:${atom.id}:${need.type}`,
          component: ESTATE_COMPONENTS.contract,
          detail: `the ${atom.kind} ${atom.id} needs ${need.count} ${need.type} row${need.count === 1 ? '' : 's'}; the plan has ${has}`,
        });
      }
    }
  }
  const ratios = [
    pairs.length === 0 ? 1 : pairsCovered / pairs.length,
    required === 0 ? 1 : present / required,
  ];
  return { value: Math.min(...ratios), items };
}

// Level 4 ---------------------------------------------------------------------------------------------------

export type SpecVerdict = {
  spec: GeneratedSpec;
  /** Loads with no error and no lint warning. */
  valid: boolean;
  complete: boolean;
  /** For a k-th positive ask of a route: whether its phrase differs from the earlier ones. */
  distinct: boolean;
  /** The replay on the rule follower; undefined when the spec was not replayed. */
  follower?: { pass: boolean; failing: string[]; error?: string };
};

const verdicts = new WeakMap<EstateRun, Promise<SpecVerdict[]>>();

/** Every generated spec, checked: valid, complete, a distinct ask, and its replay on the rule follower. */
export function specVerdicts(run: EstateRun): Promise<SpecVerdict[]> {
  let known = verdicts.get(run);
  if (!known) {
    known = computeVerdicts(run);
    verdicts.set(run, known);
  }
  return known;
}

async function computeVerdicts(run: EstateRun): Promise<SpecVerdict[]> {
  const checks = replayChecks();
  const phrases = new Map<string, number[]>();
  const out: SpecVerdict[] = [];
  for (const spec of run.specs) {
    const meta = estateMeta(spec);
    const valid = spec.loaded !== undefined && spec.errors.length === 0 && spec.warnings.length === 0;
    let distinct = true;
    // The k positive asks of a route are its contract rows route_positive.<atom>.1 to .k.
    if (spec.record.row.startsWith('route_positive.') && typeof meta.phrase === 'number') {
      const route = String(meta.atoms?.[0] ?? spec.record.row);
      const earlier = phrases.get(route) ?? [];
      distinct = !earlier.includes(meta.phrase);
      phrases.set(route, [...earlier, meta.phrase]);
    }
    const verdict: SpecVerdict = { spec, valid, complete: spec.record.complete, distinct };
    if (valid && spec.record.complete && spec.loaded && meta.situation !== null) {
      const outcome = await replayOnFollower(run, spec.loaded, checks);
      verdict.follower = {
        pass: outcome.pass,
        failing: outcome.failing,
        ...(outcome.error ? { error: outcome.error } : {}),
      };
    }
    out.push(verdict);
  }
  return out;
}

type EstateMeta = {
  atoms?: string[];
  phrase?: number | null;
  situation?: string | null;
  needs?: Array<{ marker: string; atom: string; detail: string }>;
};

export function estateMeta(spec: GeneratedSpec): EstateMeta {
  const metadata = spec.loaded?.spec.metadata as { estate?: EstateMeta } | undefined;
  return metadata?.estate ?? {};
}

/** Whether a spec counts at level 4: valid, complete, a distinct ask, and green on the rule follower. */
export function specOk(verdict: SpecVerdict): boolean {
  return (
    verdict.valid &&
    verdict.complete &&
    verdict.distinct &&
    (verdict.follower === undefined || verdict.follower.pass)
  );
}

/** Level 4: every generated spec validates, is complete, and passes on the rule follower. */
export async function specLevel(run: EstateRun): Promise<Measure> {
  const all = await specVerdicts(run);
  const items: Item[] = [];
  const invalid = all.filter(
    (verdict) => verdict.spec.loaded === undefined || verdict.spec.errors.length > 0,
  );
  for (const verdict of invalid) {
    items.push({
      id: `invalid:${verdict.spec.record.id}`,
      component: ESTATE_COMPONENTS.generate,
      detail: `the spec does not load: ${verdict.spec.errors.join('; ')}`,
    });
  }
  const warned = all.filter((verdict) => verdict.complete && verdict.spec.warnings.length > 0);
  for (const verdict of warned) {
    items.push({
      id: `lint:${verdict.spec.record.id}`,
      component: ESTATE_COMPONENTS.generate,
      detail: `a complete spec fails strict lint: ${verdict.spec.warnings.join('; ')}`,
    });
  }
  // Incomplete specs, by the marker that keeps them so.
  const byMarker = new Map<string, { specs: Set<string>; types: Set<string>; details: Set<string> }>();
  for (const verdict of all.filter((candidate) => !candidate.complete)) {
    for (const need of estateMeta(verdict.spec).needs ?? []) {
      const entry = byMarker.get(need.marker) ?? { specs: new Set(), types: new Set(), details: new Set() };
      entry.specs.add(verdict.spec.record.id);
      entry.types.add(verdict.spec.record.testType);
      entry.details.add(need.detail);
      byMarker.set(need.marker, entry);
    }
  }
  for (const [marker, entry] of [...byMarker.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    // The bank holds a situation for every ask the estate can be put; a phrase still missing is a row the
    // plan asks that no ask can fill, such as a situation outside a rule that applies always.
    const phrase = marker === 'needs-approved-phrase' || marker === 'needs-workspace-outcome';
    items.push({
      id: `gap:${marker}`,
      component: phrase ? ESTATE_COMPONENTS.contract : componentOfMarker(marker),
      detail: `${entry.specs.size} specs wait (test types ${[...entry.types].sort().join(', ')})${phrase ? '; the bank holds every situation the estate has, so the plan asks a row no ask can fill' : ''}: ${shown([...entry.details].sort())}`,
    });
  }
  const repeated = all.filter((verdict) => !verdict.distinct);
  if (repeated.length > 0) {
    items.push({
      id: 'same-phrase:route_positive',
      component: ESTATE_COMPONENTS.generate,
      detail: `${repeated.length} positive asks of a route repeat the phrase of an earlier positive ask of the same route, so the ${ROUTE_ASKS} asks are one ask: ${shown(repeated.map((verdict) => verdict.spec.record.id))}`,
    });
  }
  // Wrong expectations: complete specs the rule follower fails, by test type and failing check.
  const failed = new Map<string, string[]>();
  for (const verdict of all.filter((candidate) => candidate.follower && !candidate.follower.pass)) {
    const follower = verdict.follower as NonNullable<SpecVerdict['follower']>;
    const first = follower.error ?? follower.failing[0] ?? 'no verdict failed, the run did not complete';
    // The check is the first part of the verdict id: `skills` of `skills.weekly-report`.
    const check = /^block \d+: ([^.:]+)/.exec(first)?.[1] ?? 'run';
    const key = `${verdict.spec.record.testType}:${check}`;
    failed.set(key, [...(failed.get(key) ?? []), `${verdict.spec.record.id} (${first})`]);
  }
  for (const [key, specs] of [...failed.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    items.push({
      id: `follower:${key}`,
      component: ESTATE_COMPONENTS.expectations,
      detail: `${specs.length} complete specs fail on the rule follower, which obeys every atom: a wrong expectation. ${shown(specs)}`,
    });
  }
  const ok = all.filter(specOk).length;
  return { value: all.length === 0 ? 0 : ok / all.length, items };
}

// Level 5 ---------------------------------------------------------------------------------------------------

export type MutantVerdict = {
  atom: string;
  kind: string;
  tests: string[];
  killed: boolean;
  /**
   * The follower records the same session with and without the atom, on every ask and ordered pair of asks of
   * its situations and on the asks of the tests that name the atom: no test of any product can tell the two apart. Not counted alive.
   */
  equivalent?: true;
  /**
   * The contract gives the atom no complete test: a reference to a file the hidden estate does not hold. A Read of a missing
   * file waits on `needs-existing-file` (docs/estate.md section 5), so there is no test to kill the mutant with. The
   * atom is judged by that marker; its mutant is named, not counted alive.
   */
  untestable?: true;
  /** Why it lived: no complete test, or the tests that ran and passed. */
  reason?: string;
};

/**
 * Whether deleting the atom leaves the rule follower's session unchanged on each list of asks: a rule the hidden
 * estate gives the behaviour `none`, or an act another atom still asks for. Such a mutant is the follower.
 */
export function equivalentMutant(
  run: EstateRun,
  hid: string,
  asks: readonly (readonly string[])[],
  base: Map<string, string> = new Map(),
): boolean {
  const session = (list: readonly string[], mutant?: string) =>
    JSON.stringify(follow(run.estate, run.situations, list, mutant ? { mutant } : {}));
  return asks.every((list) => {
    const key = JSON.stringify(list);
    let whole = base.get(key);
    if (whole === undefined) {
      whole = session(list);
      base.set(key, whole);
    }
    return whole === session(list, hid);
  });
}

/** Level 5's mutants: each agent-kind atom deleted from the follower, run on its complete green tests. */
export async function agentMutants(run: EstateRun): Promise<MutantVerdict[]> {
  const all = await specVerdicts(run);
  const checks = replayChecks();
  const out: MutantVerdict[] = [];
  // What the follower can be asked: each ask of its situations alone, and each ordered pair of them (a skill
  // loaded by one ask changes what a guard does on the next). An ask outside its situations gets no act.
  const phrases = run.situations.flatMap((situation) => situation.phrases);
  const situationAsks = [
    ...phrases.map((phrase) => [phrase]),
    ...phrases.flatMap((first) => phrases.map((second) => [first, second])),
  ];
  const base = new Map<string, string>();
  const truthOf = new Map(run.rendered.atoms.map((truth) => [truth.hid, truth]));
  for (const atom of run.scanned.map.atoms.filter((candidate) => AGENT_KINDS.includes(candidate.kind))) {
    const hid = run.scanned.match.hidOf.get(atom.id);
    const named = all.filter((verdict) => (estateMeta(verdict.spec).atoms ?? []).includes(atom.id));
    const green = named.filter((verdict) => verdict.follower?.pass === true);
    if (hid !== undefined) {
      const asks = [
        ...situationAsks,
        ...named.flatMap((verdict) => (verdict.spec.loaded ? [asksOf(verdict.spec.loaded)] : [])),
      ];
      if (equivalentMutant(run, hid, asks, base)) {
        out.push({
          atom: atom.id,
          kind: atom.kind,
          tests: named.map((verdict) => verdict.spec.record.id),
          killed: false,
          equivalent: true,
          reason:
            'the rule follower records the same session with and without the atom, on every ask and pair of asks of its situations and on the asks of its tests: no test can tell the two apart',
        });
        continue;
      }
    }
    // The validator holds the hidden estate: a reference is absent when its path is no file of the rendered estate,
    // whatever the product's scan says of it. The product's marker is the second condition.
    const truth = hid === undefined ? undefined : truthOf.get(hid);
    if (
      truth?.kind === 'reference' &&
      !(truth.key in run.rendered.files) &&
      named.length > 0 &&
      named.every(
        (verdict) =>
          !verdict.spec.record.complete &&
          (estateMeta(verdict.spec).needs ?? []).some((need) => need.marker === 'needs-existing-file'),
      )
    ) {
      out.push({
        atom: atom.id,
        kind: atom.kind,
        tests: named.map((verdict) => verdict.spec.record.id),
        killed: false,
        untestable: true,
        reason:
          'the estate holds no such file, and a Read of a missing file waits on needs-existing-file: every test naming the atom is incomplete by that marker',
      });
      continue;
    }
    if (hid === undefined || green.length === 0) {
      const markers = [
        ...new Set(
          named.flatMap((verdict) => (estateMeta(verdict.spec).needs ?? []).map((need) => need.marker)),
        ),
      ].sort();
      out.push({
        atom: atom.id,
        kind: atom.kind,
        tests: named.map((verdict) => verdict.spec.record.id),
        killed: false,
        reason:
          named.length === 0
            ? 'no generated test names the atom'
            : `no complete test passes on the rule follower to run it on; its ${named.length} tests wait for ${markers.join(', ') || 'a fix of their expectation'}`,
      });
      continue;
    }
    let killed = false;
    for (const verdict of green) {
      const loaded = verdict.spec.loaded;
      if (!loaded) continue;
      const outcome = await replayOnFollower(run, loaded, checks, hid);
      if (!outcome.pass) {
        killed = true;
        break;
      }
    }
    out.push({
      atom: atom.id,
      kind: atom.kind,
      tests: green.map((verdict) => verdict.spec.record.id),
      killed,
      ...(killed
        ? {}
        : {
            reason: `${green.length} complete tests ran on the follower with the atom deleted and all passed; the evidence ${atom.evidence.map((item) => item.type).join(', ')} did not fire`,
          }),
    });
  }
  return out;
}

/** Level 5: every atom deleted from the agent fails one of its tests; the lowest kind score is the value. */
export async function agentMutantLevel(run: EstateRun): Promise<Measure> {
  // An equivalent mutant is the follower itself: it is neither killed nor alive.
  const mutants = (await agentMutants(run)).filter((mutant) => !mutant.equivalent && !mutant.untestable);
  const items: Item[] = [];
  let lowest = 1;
  const kinds = [...new Set(mutants.map((mutant) => mutant.kind))];
  for (const kind of kinds) {
    const own = mutants.filter((mutant) => mutant.kind === kind);
    const score = own.filter((mutant) => mutant.killed).length / own.length;
    lowest = Math.min(lowest, score);
    if (score >= MUTATION_SCORE) continue;
    for (const mutant of own.filter((candidate) => !candidate.killed)) {
      const atom = run.scanned.map.atoms.find((candidate) => candidate.id === mutant.atom);
      items.push({
        id: `mutant-alive:${mutant.atom}`,
        component: mutant.reason?.startsWith('no complete')
          ? componentOfMarker(/wait for ([a-z-]+)/.exec(mutant.reason)?.[1] ?? '')
          : ESTATE_COMPONENTS.expectations,
        detail: `${kind} score ${own.filter((candidate) => candidate.killed).length} of ${own.length}; the follower without ${mutant.atom} ("${atom?.provenance.quote ?? ''}") ${mutant.reason ?? ''}${mutant.tests.length > 0 ? `; tests: ${shown(mutant.tests)}` : ''}`,
      });
    }
  }
  return { value: mutants.length === 0 ? 0 : lowest, items };
}

// Level 6 ---------------------------------------------------------------------------------------------------

export type RetirementVerdict = { mutant: string; test: string; expected: string; got: string; why: string };

/** Level 6's decisions: for each estate mutant, what maintenance did to each test against what it should. */
export async function estateMutantDecisions(
  run: EstateRun,
): Promise<{ judged: number; wrong: RetirementVerdict[] }> {
  const tests: EstateTest[] = run.specs.map((spec) => ({
    id: spec.record.id,
    path: spec.record.path,
    file: spec.record.path,
    atoms: estateMeta(spec).atoms ?? [],
  }));
  const before = new Set(run.rendered.atoms.map((atom) => atom.hid));
  let judged = 0;
  const wrong: RetirementVerdict[] = [];
  for (const mutant of estateMutants(run.estate)) {
    const rendered = renderEstate(mutant.estate);
    const after = new Set(rendered.atoms.map((atom) => atom.hid));
    const removed = new Set(
      [...before].filter((hid) => !after.has(hid)).flatMap((hid) => run.scanned.match.idOf.get(hid) ?? []),
    );
    const scanned = await scanRendered(rendered);
    const diff = diffEstateMaps(run.scanned.map, scanned.map);
    const impact = estateImpact(diff, tests);
    const retired = new Set(impact.retire.map((entry) => entry.test));
    const regenerated = new Map(impact.regenerate.map((entry) => [entry.test, entry.atoms]));
    for (const test of tests) {
      if (test.atoms.length === 0) continue;
      const head = test.atoms[0] as string;
      const journey = test.id.startsWith('estate.journey.');
      const touched = test.atoms.filter((atom) => removed.has(atom));
      if (mutant.kind === 'wording') {
        const reworded = run.scanned.match.idOf.get(mutant.estate.wrap ?? '');
        if (!reworded || !test.atoms.includes(reworded)) continue;
        judged += 1;
        const changed = retired.has(test.id) || regenerated.has(test.id);
        if (changed) {
          wrong.push({
            mutant: mutant.id,
            test: test.id,
            expected: 'untouched',
            got: retired.has(test.id) ? 'retired' : 'regenerated',
            why: `the rule's words did not change, only their layout`,
          });
        }
        continue;
      }
      judged += 1;
      const shouldRetire = !journey && removed.has(head);
      const didRetire = retired.has(test.id);
      if (shouldRetire === didRetire) continue;
      const others = test.atoms.filter((atom) => !removed.has(atom));
      wrong.push({
        mutant: mutant.id,
        test: test.id,
        expected: shouldRetire ? 'retired' : 'kept',
        got: didRetire ? 'retired' : regenerated.has(test.id) ? 'regenerated' : 'untouched',
        why: shouldRetire
          ? `its atom under test ${head} left the estate (${mutant.what}); the test also names ${shown(others)}, which stayed`
          : `it names ${shown(touched)} that left, but its atom under test ${head} ${removed.has(head) ? 'is in a journey' : 'stayed'}`,
      });
    }
    if (mutant.kind === 'wording' && impact.reapprove.length > 0) {
      judged += 1;
      wrong.push({
        mutant: mutant.id,
        test: impact.reapprove.map((entry) => entry.atom).join(', '),
        expected: 'no re-approval',
        got: 're-approve',
        why: 'a re-wrap sends no phrasing back to a person',
      });
    }
  }
  return { judged, wrong };
}

/** Level 6: maintenance retires exactly the tests of a deleted atom and keeps the rest; a re-wrap changes no test. */
export async function estateMutantLevel(run: EstateRun): Promise<Measure> {
  const { judged, wrong } = await estateMutantDecisions(run);
  const groups = new Map<string, RetirementVerdict[]>();
  for (const verdict of wrong) {
    const key = `${verdict.mutant}:${verdict.expected}-but-${verdict.got}`;
    groups.set(key, [...(groups.get(key) ?? []), verdict]);
  }
  const items: Item[] = [...groups.entries()].map(([key, list]) => ({
    id: `retire:${key}`,
    component: ESTATE_COMPONENTS.impact,
    detail: `${list.length} tests ${list[0]?.expected === 'retired' ? 'should retire' : 'should stay'} and were ${list[0]?.got}: ${list[0]?.why}. Tests: ${shown(list.map((verdict) => verdict.test))}`,
  }));
  return { value: judged === 0 ? 0 : (judged - wrong.length) / judged, items };
}

// Level 7 ---------------------------------------------------------------------------------------------------

export type LevelFunction = (run: EstateRun) => Measure | Promise<Measure>;

/** Levels 1 to 6 in order, with their thresholds: level 7 runs them on the holdout estate. */
export const LOWER_LEVELS: ReadonlyArray<{ id: string; threshold: number; compute: LevelFunction }> = [
  { id: 'atoms-and-edges', threshold: 1, compute: atomLevel },
  { id: 'lint', threshold: 1, compute: lintLevel },
  { id: 'plan', threshold: 1, compute: planLevel },
  { id: 'specs', threshold: 1, compute: specLevel },
  { id: 'agent-mutants', threshold: MUTATION_SCORE, compute: agentMutantLevel },
  { id: 'estate-mutants', threshold: 1, compute: estateMutantLevel },
];

/** Level 7: levels 1 to 6 hold on the holdout estate of the seed, whose forms the visible seeds never use. */
export async function holdoutLevel(holdout: EstateRun): Promise<Measure> {
  let passed = 0;
  for (const level of LOWER_LEVELS) {
    let measure: Measure;
    try {
      measure = await level.compute(holdout);
    } catch (cause) {
      measure = {
        value: Number.NaN,
        items: [
          {
            id: `${level.id}:error`,
            component: ESTATE_COMPONENTS.validator,
            detail: `the level threw: ${cause instanceof Error ? cause.message : String(cause)}`,
          },
        ],
      };
    }
    if (measure.value >= level.threshold) {
      passed += 1;
      continue;
    }
    return {
      value: passed / LOWER_LEVELS.length,
      items: measure.items.map((item) => ({
        ...item,
        id: `holdout:${level.id}:${item.id}`,
        detail: `on the holdout estate, level ${passed + 1} (${level.id}): ${item.detail}`,
      })),
    };
  }
  return { value: 1, items: [] };
}

/** The atoms a hidden estate renders, for tests and the handoff. */
export function plantedAtoms(estate: HiddenEstate): ExpectedAtom[] {
  return renderEstate(estate).atoms;
}

export type { EstateMap };
/** The key code reads an atom by: re-exported for tests. */
export { atomKey };
