import type {
  Case,
  Cell,
  Issue,
  LayerName,
  Options,
  Plan,
  PlanTruth,
  Row,
  Run,
  Store,
  Variable,
} from './types';

export function canonical(value: unknown): string {
  if (typeof value === 'number' && !Number.isFinite(value)) return `number:${value}`;
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function insist(condition: unknown, detail: string): asserts condition {
  if (!condition) throw new Error(detail);
}

function same(a: unknown, b: unknown, detail: string) {
  insist(
    canonical(a) === canonical(b),
    `${detail}: expected ${canonical(b).slice(0, 600)}, received ${canonical(a).slice(0, 600)}`,
  );
}

function contains(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected))
    return (
      Array.isArray(actual) &&
      expected.length === actual.length &&
      expected.every((v, i) => contains(actual[i], v))
    );
  if (expected && typeof expected === 'object')
    return (
      !!actual &&
      typeof actual === 'object' &&
      Object.entries(expected).every(([k, v]) => contains((actual as Record<string, unknown>)[k], v))
    );
  return Object.is(actual, expected);
}

function issues(raw: unknown): Issue[] {
  insist(Array.isArray(raw), 'expected an issue list');
  return raw
    .map((issue) => {
      insist(
        issue && typeof issue.code === 'string' && typeof issue.path === 'string',
        'issue lacks code/path',
      );
      return { code: issue.code, path: issue.path };
    })
    .sort((a, b) => canonical(a).localeCompare(canonical(b)));
}

export function active(store: Store, options: Options): Variable[] {
  return store.variables
    .map((v) => ({
      ...v,
      values: v.values.filter((x) => options.approvedOnly === false || (x.approved ?? v.approved)),
    }))
    .filter((v) => v.values.length > 0);
}

export function activeConstraints(
  store: Store,
  options: Options,
  variables = active(store, options),
): Cell[] {
  return store.constraints
    .filter(
      (c) =>
        (options.approvedOnly === false || c.approved) &&
        Object.entries(c.forbid).every(([id, value]) =>
          variables.some((v) => v.id === id && v.values.some((x) => x.id === value)),
        ),
    )
    .map((c) => c.forbid);
}

export function matches(row: Cell, cell: Cell): boolean {
  return Object.entries(cell).every(([k, v]) => row[k] === v);
}

export function product(variables: Variable[]): Cell[] {
  let rows: Cell[] = [{}];
  for (const v of variables) rows = rows.flatMap((r) => v.values.map((x) => ({ ...r, [v.id]: x.id })));
  return rows;
}

export function choose<T>(values: T[], n: number): T[][] {
  if (n === 0) return [[]];
  return values.flatMap((v, i) => choose(values.slice(i + 1), n - 1).map((tail) => [v, ...tail]));
}

export type Targets = Record<LayerName, { feasible: Cell[]; infeasible: number }>;

/** Exhaustive small-space reference; no greedy planner or implementation hash is reproduced. */
export function targetTruth(store: Store, options: Options, truth: PlanTruth): Targets {
  const variables = active(store, options);
  const byId = new Map(variables.map((v) => [v.id, v]));
  const groups = truth.groups.map((g) => g.filter((id) => byId.has(id))).filter((g) => g.length > 0);
  const shared = truth.shared.filter((id) => byId.has(id));
  const used = new Set(groups.flat().concat(shared.length >= 2 ? shared : []));
  const tuples: Record<LayerName, string[][]> = {
    own: groups.flatMap((g) => choose(g, Math.min(3, g.length))),
    shared: choose(shared, 2),
    single: variables.filter((v) => !used.has(v.id)).map((v) => [v.id]),
  };
  const forbidden = activeConstraints(store, options, variables);
  insist(
    !truth.factorized || forbidden.length === 0,
    'factorized reference requires a constraint-free space',
  );
  const allowed = truth.factorized
    ? undefined
    : product(variables).filter((row) => !forbidden.some((c) => matches(row, c)));
  const targets = {} as Targets;
  for (const layer of ['own', 'shared', 'single'] as const) {
    const candidates = new Map<string, Cell>();
    for (const tuple of tuples[layer])
      for (const cell of product(tuple.map((id) => byId.get(id)!))) candidates.set(canonical(cell), cell);
    const feasible = [...candidates.values()].filter(
      (cell) => !allowed || allowed.some((row) => matches(row, cell)),
    );
    targets[layer] = { feasible, infeasible: candidates.size - feasible.length };
  }
  return targets;
}

export function expectedLogWeight(row: Cell, variables: Variable[]): number | null {
  let sum = 0;
  for (const v of variables) {
    const value = v.values.find((x) => x.id === row[v.id]);
    if (!value) continue;
    const denominator = v.values.reduce((n, x) => n + (x.weight ?? 1), 0);
    const share = (value.weight ?? 1) / denominator;
    if (share === 0) return null;
    sum += Math.log(share);
  }
  return sum;
}

export function expectedSeeds(store: Store, options: Options): Row[] {
  const variables = active(store, options);
  return (options.seeds ?? []).map((s) => {
    const values = Object.fromEntries(
      Object.entries(s.values).filter(([key, value]) =>
        variables.some((v) => v.id === key && v.values.some((x) => x.id === value)),
      ),
    );
    return { id: `seed.${s.id}`, source: 'seed', values, logWeight: expectedLogWeight(values, variables) };
  });
}

export function expectedWarningCodes(store: Store, options: Options, truth: PlanTruth): string[] {
  const variables = active(store, options);
  const forbidden = activeConstraints(store, options, variables);
  const seeds = expectedSeeds(store, options);
  const codes = new Set<string>();
  if (!variables.length) codes.add('no_variables');
  if (
    seeds.some((row, i) => Object.keys(row.values).length !== Object.keys(options.seeds![i]!.values).length)
  )
    codes.add('seed_unknown_value');
  if (seeds.some((row) => forbidden.some((c) => matches(row.values, c)))) codes.add('seed_forbidden');
  if (!truth.factorized) {
    const allowed = product(variables).filter((row) => !forbidden.some((c) => matches(row, c)));
    if (variables.some((v) => v.values.some((x) => !allowed.some((row) => row[v.id] === x.id))))
      codes.add('value_unreachable');
  }
  return [...codes].sort();
}

function checkPlan(test: Case, raw: unknown): void {
  insist(test.request.operation === 'plan' && test.truth.kind === 'plan', 'plan fixture mismatch');
  insist(raw && typeof raw === 'object', 'plan result is not an object');
  const { plan, text } = raw as { plan: Plan; text: string };
  insist(
    plan &&
      Array.isArray(plan.rows) &&
      plan.layers &&
      Array.isArray(plan.rules) &&
      Array.isArray(plan.warnings),
    'missing plan structure',
  );
  insist(typeof text === 'string' && text.trim().length > 0, 'rendered text is empty');
  const { store, options } = test.request;
  same([plan.agent, plan.version, plan.seed], [store.agent, store.version, options.seed], 'plan identity');
  if (options.budget !== undefined) same(plan.budget, options.budget, 'reported budget');
  const variables = active(store, options);
  const forbidden = activeConstraints(store, options, variables);
  const seeds = expectedSeeds(store, options);
  const targets = targetTruth(store, options, test.truth);
  insist(plan.rows.length >= seeds.length, 'budget removed a seed');
  for (const [i, seed] of seeds.entries()) {
    const row = plan.rows[i]!;
    same([row.id, row.source, row.values], [seed.id, seed.source, seed.values], 'seed order/content');
  }
  const planned = plan.rows.slice(seeds.length);
  insist(new Set(plan.rows.map((row) => row.id)).size === plan.rows.length, 'duplicate row identifiers');
  for (const row of planned) {
    insist(/^row\.\d{3,}$/.test(row.id), 'planned row identifier must have the documented row.001 form');
    same(row.source, 'planned', 'new row source');
    same(
      Object.keys(row.values).sort(),
      variables.map((v) => v.id).sort(),
      'new row must assign every approved variable',
    );
    for (const v of variables)
      insist(
        v.values.some((x) => x.id === row.values[v.id]),
        `unknown/unapproved value for ${v.id}`,
      );
    insist(!forbidden.some((c) => matches(row.values, c)), 'new row contains an impossible combination');
  }
  for (const row of plan.rows) {
    const expected = expectedLogWeight(row.values, variables);
    if (expected === null) same(row.logWeight, null, 'zero weight serializes as null');
    else
      insist(
        typeof row.logWeight === 'number' &&
          Number.isFinite(row.logWeight) &&
          Math.abs(row.logWeight - expected) <= 5.1e-10,
        `logWeight differs from normalized product: ${expected}`,
      );
  }
  for (let i = 1; i < planned.length; i++)
    insist(
      (planned[i - 1]!.logWeight ?? Number.NEGATIVE_INFINITY) >=
        (planned[i]!.logWeight ?? Number.NEGATIVE_INFINITY),
      'planned rows are not in descending weight order',
    );
  insist(
    Number.isInteger(plan.generated) &&
      Number.isInteger(plan.cut) &&
      plan.cut >= 0 &&
      plan.generated === planned.length + plan.cut,
    'generated/cut accounting',
  );
  if (options.budget === undefined) same(plan.cut, 0, 'unlimited plan cut');
  else insist(plan.rows.length <= Math.max(seeds.length, options.budget), 'budget overflow');
  for (const layer of ['own', 'shared', 'single'] as const) {
    const expected = targets[layer];
    const seeded = expected.feasible.filter((cell) => seeds.some((row) => matches(row.values, cell))).length;
    const covered = expected.feasible.filter((cell) =>
      plan.rows.some((row) => matches(row.values, cell)),
    ).length;
    const actual = plan.layers[layer];
    insist(actual, `missing layer ${layer}`);
    insist(
      Number.isInteger(actual.groups) &&
        actual.groups >= 0 &&
        (expected.feasible.length === 0 || actual.groups > 0),
      `${layer} group count is missing or invalid`,
    );
    same(actual.strength, { own: 3, shared: 2, single: 1 }[layer], `${layer} strength`);
    same(
      [actual.targets, actual.infeasible, actual.seeded, actual.covered, actual.uncovered],
      [expected.feasible.length, expected.infeasible, seeded, covered, expected.feasible.length - covered],
      `${layer} exact counters`,
    );
    if (options.budget === undefined) same(covered, expected.feasible.length, `${layer} missing targets`);
  }
  const normalize = (groups: string[][]) =>
    groups.map((g) => [...g].sort()).sort((a, b) => canonical(a).localeCompare(canonical(b)));
  insist(
    plan.rules.every(
      (rule) =>
        typeof rule.id === 'string' &&
        rule.id.length > 0 &&
        typeof rule.label === 'string' &&
        rule.label.length > 0,
    ),
    'rule id/label missing',
  );
  insist(new Set(plan.rules.map((r) => r.id)).size === plan.rules.length, 'duplicate rule identifiers');
  insist(
    plan.warnings.every((warning) => typeof warning.message === 'string' && warning.message.length > 0),
    'warning message missing',
  );
  same(normalize(plan.rules.map((r) => r.variables)), normalize(test.truth.groups), 'rule membership');
  same(
    [...new Set(plan.warnings.map((w) => w.code))].sort(),
    expectedWarningCodes(store, options, test.truth),
    'warning codes',
  );
}

export function checkRun(run: Run): void {
  const { case: test, result } = run;
  if (test.budgetMs !== undefined)
    insist(run.ms <= test.budgetMs, `time budget exceeded: ${run.ms}ms > ${test.budgetMs}ms`);
  if (test.heapBytes !== undefined)
    insist(
      run.heapBytes <= test.heapBytes,
      `retained heap budget exceeded: ${run.heapBytes} > ${test.heapBytes}`,
    );
  if (test.truth.kind === 'plan') {
    checkPlan(test, result);
    return;
  }
  insist(result && typeof result === 'object', 'adapter returned no result');
  const reply = result as Record<string, unknown>;
  if (test.truth.kind === 'validation') {
    same(reply.ok, test.truth.ok, 'load acceptance');
    if (test.truth.ok) {
      insist(contains(reply.store, test.truth.preserved), 'accepted store lost or altered a planted field');
      same(issues(reply.warnings), test.truth.issues, 'load warnings');
    } else same(issues(reply.errors), issues(test.truth.issues), 'load issues');
  } else same(issues(reply.errors), issues(test.truth.issues), 'quote issues');
}

export function checkRelations(runs: Run[]): void {
  const plans = runs
    .filter((run) => run.case.request.operation === 'plan')
    .map((run) => {
      const request = run.case.request;
      if (request.operation !== 'plan') throw new Error('plan relation request');
      const reply = run.result as { plan: Plan; text: string };
      const { budget: _budget, ...options } = request.options;
      return {
        ...run,
        keys: {
          request: canonical(request),
          reply: canonical(reply),
          store: canonical(request.store),
          options: canonical(options),
          rows: canonical(reply.plan.rows),
          identity: canonical([reply.plan.agent, reply.plan.version, reply.plan.seed]),
        },
      };
    });
  for (let i = 0; i < plans.length; i++)
    for (let j = i + 1; j < plans.length; j++) {
      const a = plans[i]!;
      const b = plans[j]!;
      const qa = a.case.request;
      const qb = b.case.request;
      if (qa.operation !== 'plan' || qb.operation !== 'plan') continue;
      const ra = a.result as { plan: Plan; text: string };
      const rb = b.result as { plan: Plan; text: string };
      if (a.keys.request === b.keys.request)
        insist(a.keys.reply === b.keys.reply, 'same store/options must render identical bytes and plan');
      if (a.keys.identity !== b.keys.identity)
        insist(ra.text !== rb.text, 'renderer returned constant bytes for different plan identity');
      if (a.keys.rows !== b.keys.rows)
        insist(ra.text !== rb.text, 'renderer returned constant bytes for different rows');
      const budgetA = qa.options.budget;
      const budgetB = qb.options.budget;
      if (a.keys.store !== b.keys.store || a.keys.options !== b.keys.options) continue;
      if ((budgetA === undefined) !== (budgetB === undefined)) {
        const unlimited = budgetA === undefined ? ra : rb;
        const limited = budgetA === undefined ? rb : ra;
        const budget = budgetA === undefined ? budgetB : budgetA;
        const kept = Math.max(qa.options.seeds?.length ?? 0, budget ?? 0);
        same(
          limited.plan.rows,
          unlimited.plan.rows.slice(0, kept),
          'budget must keep exact unlimited prefix including IDs',
        );
        same(limited.plan.generated, unlimited.plan.generated, 'budget changed generation count');
        same(
          limited.plan.cut,
          unlimited.plan.rows.length - limited.plan.rows.length,
          'cut differs from unlimited rows',
        );
      }
    }
}
