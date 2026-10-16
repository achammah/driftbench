import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { PROTECTED_PATHS, protectedChanges } from '../src/index';

const WORKFLOW = new URL('../../../.github/workflows/validators.yml', import.meta.url);

describe('protectedChanges', () => {
  const files = [
    'packages/validators/src/ladders/stats.ts',
    'packages/validators/src/seeds.ts',
    'validators/floors.json',
    'examples/acme/faults/index.ts',
    'packages/stats/test/reference/fixtures.json',
    '.github/workflows/validators.yml',
    'validators/EXECUTOR.md',
    'packages/stats/src/intervals.ts',
    'validators/stats/journal.jsonl',
    'validators/floors.json.bak',
  ];
  it('names every protected file an executor branch changes, and nothing else', () => {
    expect(protectedChanges('exec/stats-wilson', files)).toEqual(files.slice(0, 7));
  });
  it('protects nothing from a branch that is not an executor branch', () => {
    expect(protectedChanges('lane/validators', files)).toEqual([]);
    expect(protectedChanges('executor/x', files)).toEqual([]);
  });
  it('covers the three paths the design names', () => {
    for (const path of [
      'packages/validators/src/ladders/x.ts',
      'validators/floors.json',
      'examples/acme/faults/a.ts',
    ])
      expect(protectedChanges('exec/a', [path])).toEqual([path]);
    expect(PROTECTED_PATHS.length).toBeGreaterThanOrEqual(3);
  });
});

const TRAIN_CONDITION = "github.event_name == 'push' || startsWith(github.head_ref, 'train/')";

/** A heavy job runs on main pushes, on train PRs, and on a dispatch on a train branch that lists its id. */
function heavyCondition(id: string): string {
  return `${TRAIN_CONDITION} || (github.event_name == 'workflow_dispatch' && startsWith(github.ref, 'refs/heads/train/') && contains(format(',{0},', inputs.jobs), ',${id},'))`;
}

const CI_HEAVY = [
  'bench',
  'research-replay',
  'build',
  'python',
  'comparison-replay',
  'viewer-journey',
  'guard',
];
const VALIDATORS_HEAVY = ['ladders', 'system-full'];

interface Ctx {
  event: string;
  ref: string;
  headRef?: string;
  jobs?: string;
  runId?: string;
}

/** Evaluates a workflow expression with the functions these workflows use. */
function evaluate(expression: string, ctx: Ctx): unknown {
  const github = {
    event_name: ctx.event,
    ref: ctx.ref,
    head_ref: ctx.headRef ?? '',
    run_id: ctx.runId ?? '1',
  };
  const inputs = { jobs: ctx.jobs ?? '' };
  const startsWith = (a: string, b: string) => String(a).toLowerCase().startsWith(String(b).toLowerCase());
  const contains = (a: string, b: string) => String(a).toLowerCase().includes(String(b).toLowerCase());
  const format = (pattern: string, ...args: unknown[]) =>
    pattern.replace(/\{(\d+)\}/g, (_, index) => String(args[Number(index)]));
  return new Function('github', 'inputs', 'startsWith', 'contains', 'format', `return (${expression});`)(
    github,
    inputs,
    startsWith,
    contains,
    format,
  );
}

function evaluateTemplate(text: unknown, ctx: Ctx): unknown {
  if (typeof text !== 'string') return text;
  const whole = text.match(/^\$\{\{([\s\S]*)\}\}$/);
  if (whole) return evaluate(whole[1] ?? '', ctx);
  return text.replace(/\$\{\{([\s\S]*?)\}\}/g, (_, expression) => String(evaluate(expression, ctx)));
}

const runs = (ctx: Ctx, id: string, workflow: ReturnType<typeof parse>): boolean =>
  Boolean(evaluate(workflow.jobs[id].if, ctx));

const MAIN_PUSH: Ctx = { event: 'push', ref: 'refs/heads/main' };
const TRAIN_PR: Ctx = { event: 'pull_request', ref: 'refs/pull/9/merge', headRef: 'train/9' };
const ORDINARY_PR: Ctx = { event: 'pull_request', ref: 'refs/pull/8/merge', headRef: 'fix/ordinary' };
const dispatchOn = (ref: string, jobs: string): Ctx => ({ event: 'workflow_dispatch', ref, jobs });

/** Behaviour of the heavy-job conditions, as GitHub would evaluate them. */
function assertDispatchBehaviour(workflow: ReturnType<typeof parse>, ids: string[]) {
  const [first, second] = ids;
  for (const id of ids) {
    expect(runs(MAIN_PUSH, id, workflow)).toBe(true);
    expect(runs(TRAIN_PR, id, workflow)).toBe(true);
    expect(runs(ORDINARY_PR, id, workflow)).toBe(false);
    // a dispatch on a train branch runs exactly the listed jobs
    expect(runs(dispatchOn('refs/heads/train/9a', ids.join(',')), id, workflow)).toBe(true);
    expect(runs(dispatchOn('refs/heads/train/9a', ''), id, workflow)).toBe(false);
    expect(runs(dispatchOn('refs/heads/train/9a', `${id}-docs,x${id}`), id, workflow)).toBe(false);
    // a dispatch, partial or complete, never runs anything on main or on a look-alike ref
    for (const ref of [
      'refs/heads/main',
      'refs/heads/train-lookalike',
      'refs/heads/feature/train/9',
      'refs/tags/train/9',
    ])
      expect(runs(dispatchOn(ref, ids.join(',')), id, workflow)).toBe(false);
  }
  // listing one job never runs another
  if (first && second) expect(runs(dispatchOn('refs/heads/train/9a', first), second, workflow)).toBe(false);
}

/** Runs on main never cancel each other, and a dispatch never cancels or joins a push run. */
function assertConcurrency(workflow: ReturnType<typeof parse>) {
  const group = (ctx: Ctx) => String(evaluateTemplate(workflow.concurrency.group, ctx));
  const cancel = (ctx: Ctx) => Boolean(evaluateTemplate(workflow.concurrency['cancel-in-progress'], ctx));
  const push = (runId: string): Ctx => ({ ...MAIN_PUSH, runId });
  expect(group(push('1'))).not.toBe(group(push('2')));
  expect(group({ ...dispatchOn('refs/heads/main', 'build'), runId: '2' })).not.toBe(group(push('1')));
  expect(group({ ...dispatchOn('refs/heads/main', 'build'), runId: '3' })).not.toBe(
    group({ ...dispatchOn('refs/heads/main', 'build'), runId: '4' }),
  );
  for (const ctx of [
    push('1'),
    dispatchOn('refs/heads/main', 'build'),
    dispatchOn('refs/heads/train/9a', 'build'),
  ])
    expect(cancel(ctx)).toBe(false);
  expect(cancel(ORDINARY_PR)).toBe(true);
  expect(cancel(TRAIN_PR)).toBe(false);
  expect(group(ORDINARY_PR)).toBe(group({ ...ORDINARY_PR, runId: '77' }));
}

/** No job or trigger is path-filtered, and no step may skip work. */
function assertNoPathFilters(workflow: ReturnType<typeof parse>) {
  for (const trigger of [workflow.on.pull_request, workflow.on.push]) {
    expect(trigger.paths).toBeUndefined();
    expect(trigger['paths-ignore']).toBeUndefined();
  }
  expect(workflow.on.workflow_dispatch.paths).toBeUndefined();
  for (const job of Object.values(workflow.jobs) as {
    if?: string;
    needs?: unknown;
    steps: { if?: string; uses?: string; run?: string }[];
  }[]) {
    expect(String(job.if ?? '')).not.toMatch(/changes|paths|changed/i);
    expect(JSON.stringify(job.needs ?? [])).not.toMatch(/changes|paths/i);
    for (const step of job.steps) {
      expect(step.uses ?? '').not.toMatch(/paths-filter|changed-files/i);
      expect(String(step.if ?? '')).not.toMatch(/changes|paths|changed/i);
    }
  }
}

/** The trigger set and the dispatch input, exactly. */
function assertTriggers(workflow: ReturnType<typeof parse>) {
  expect(Object.keys(workflow.on).sort()).toEqual(['pull_request', 'push', 'workflow_dispatch']);
  expect(workflow.on.push.branches).toContain('main');
  const inputs = workflow.on.workflow_dispatch.inputs;
  expect(Object.keys(inputs)).toEqual(['jobs']);
  expect(inputs.jobs.required).toBe(true);
  expect(inputs.jobs.type).toBe('string');
}

function assertWorkflowPolicy(workflow: ReturnType<typeof parse>, ids: string[]) {
  assertTriggers(workflow);
  assertNoPathFilters(workflow);
  assertConcurrency(workflow);
  assertDispatchBehaviour(workflow, ids);
  for (const id of ids) {
    expect(workflow.jobs[id].if).toBe(heavyCondition(id));
    for (const step of workflow.jobs[id].steps) {
      // A step condition may only keep artifacts after a failure; it may never skip work.
      if (step.if !== undefined) expect(step.if).toBe('always()');
    }
  }
}

/** Conditions and steps must keep the complete validators on every train and main push. */
function assertTrainValidators(workflow: ReturnType<typeof parse>) {
  assertWorkflowPolicy(workflow, VALIDATORS_HEAVY);
  const commands = workflow.jobs.ladders.steps.flatMap((step: { run?: string }) => step.run ?? []);
  expect(commands).toContain('pnpm driftbench validate all --seeds 1..3 --hidden --check-floor');
  expect(commands).toContain('pnpm driftbench validate all --check-handover');
  const system = workflow.jobs['system-full'].steps
    .map((step: { run?: string }) => step.run ?? '')
    .join('\n');
  expect(system).toContain('pnpm driftbench validate system --seeds 1..3 --hidden --all-levels');
  expect(system).toContain('test "$status" -eq 11');
}

const OK = 'success,success,success,success,success,success,success';
const ONE_RED = 'success,failure,success,success,success,success,success';
const GATE_CASES: [string, string, string, string, string, number][] = [
  // event, head ref, ref name, jobs, needs results, expected exit code
  ['pull_request', 'train/ci-speed', '', '', OK, 0],
  ['push', '', 'main', '', OK, 0],
  ['pull_request', 'fix/ordinary', '', '', 'skipped,skipped,skipped,skipped,skipped,skipped,skipped', 1],
  ['pull_request', 'train-lookalike', '', '', OK, 1],
  [
    'workflow_dispatch',
    '',
    'train/9a',
    'build',
    'skipped,skipped,success,skipped,skipped,skipped,skipped',
    0,
  ],
  [
    'workflow_dispatch',
    '',
    'train/9a',
    'build,python',
    'skipped,skipped,success,success,skipped,skipped,skipped',
    0,
  ],
  ['workflow_dispatch', '', 'train/9a', '', 'skipped,skipped,skipped,skipped,skipped,skipped,skipped', 1],
  ['workflow_dispatch', '', 'main', 'build', OK, 1],
  ['workflow_dispatch', '', 'main', 'build,python,bench', OK, 1],
  ['workflow_dispatch', '', 'train-lookalike', 'build', OK, 1],
  ['workflow_dispatch', '', 'feature/train/9', 'build', OK, 1],
  // a red or cancelled heavy job turns the gate red, on every kind of run that can count
  ['pull_request', 'train/ci-speed', '', '', ONE_RED, 1],
  ['pull_request', 'train/ci-speed', '', '', 'success,success,cancelled,success,success,success,success', 1],
  ['push', '', 'main', '', ONE_RED, 1],
  [
    'workflow_dispatch',
    '',
    'train/9a',
    'build',
    'skipped,skipped,failure,skipped,skipped,skipped,skipped',
    1,
  ],
  [
    'workflow_dispatch',
    '',
    'train/9a',
    'build',
    'skipped,skipped,cancelled,skipped,skipped,skipped,skipped',
    1,
  ],
];

/** Runs the train gate script for every case. A partial dispatch counts only on a train branch. */
function assertGate(command: string) {
  for (const [event, head, refName, jobs, results, expected] of GATE_CASES) {
    const result = spawnSync('bash', ['-c', command], {
      encoding: 'utf8',
      env: {
        ...process.env,
        EVENT_NAME: event,
        HEAD_REF: head,
        REF_NAME: refName,
        JOBS: jobs,
        RESULTS: results,
      },
    });
    expect(result.status, `${event} ${head} ${refName} [${jobs}] ${results}`).toBe(expected);
    if (expected === 1) expect(result.stdout).toMatch(/::error::/);
    if (expected === 1 && event === 'pull_request' && head === 'fix/ordinary')
      expect(result.stdout).toContain('Merge through a train (train/<n>)');
  }
}

/** The gate waits for every heavy ci.yml job, so a red heavy job cannot sit beside a green gate. */
function assertGateWaits(workflow: ReturnType<typeof parse>) {
  const job = workflow.jobs['train-gate'];
  expect(job.if).toBe('always()');
  expect([...job.needs].sort()).toEqual([...CI_HEAVY].sort());
  const step = job.steps.find((s: { run?: string }) => s.run);
  expect(step.env.RESULTS).toBe("${{ join(needs.*.result, ',') }}");
  expect(step.run).not.toContain('${{');
}

describe('the validators workflow', () => {
  const workflow = parse(readFileSync(WORKFLOW, 'utf8'));
  const stepRuns = (job: string): string[] =>
    (workflow.jobs[job].steps as { run?: string }[]).flatMap((step) => (step.run ? [step.run] : []));
  it('runs all registered validators in full on every train PR and main push, without path filters', () => {
    assertTrainValidators(workflow);
  });
  it('rejects an extra trigger such as pull_request_target, and a missing workflow_dispatch', () => {
    const changed = structuredClone(workflow);
    changed.on.pull_request_target = {};
    expect(() => assertTrainValidators(changed)).toThrow();
    const missing = structuredClone(workflow);
    delete missing.on.workflow_dispatch;
    expect(() => assertTrainValidators(missing)).toThrow();
  });
  it('rejects a dispatch input other than a required jobs string', () => {
    const extra = structuredClone(workflow);
    extra.on.workflow_dispatch.inputs.ref = { type: 'string' };
    expect(() => assertTrainValidators(extra)).toThrow();
    const optional = structuredClone(workflow);
    optional.on.workflow_dispatch.inputs.jobs.required = false;
    expect(() => assertTrainValidators(optional)).toThrow();
  });
  it('rejects removing the train condition', () => {
    const changed = structuredClone(workflow);
    changed.jobs.ladders.if = changed.jobs.ladders.if.replace(TRAIN_CONDITION, "github.event_name == 'push'");
    expect(() => assertTrainValidators(changed)).toThrow();
  });
  it('rejects a dispatch that could run a job on main, or ignore the jobs list', () => {
    const anyRef = structuredClone(workflow);
    anyRef.jobs.ladders.if = anyRef.jobs.ladders.if.replace(
      " && startsWith(github.ref, 'refs/heads/train/')",
      '',
    );
    expect(() => assertDispatchBehaviour(anyRef, VALIDATORS_HEAVY)).toThrow();
    const ignoresList = structuredClone(workflow);
    ignoresList.jobs['system-full'].if = `${TRAIN_CONDITION} || github.event_name == 'workflow_dispatch'`;
    expect(() => assertDispatchBehaviour(ignoresList, VALIDATORS_HEAVY)).toThrow();
    const prefixMatch = structuredClone(workflow);
    prefixMatch.jobs.ladders.if = prefixMatch.jobs.ladders.if.replace("',{0},'", "'{0}'");
    expect(() => assertDispatchBehaviour(prefixMatch, VALIDATORS_HEAVY)).toThrow();
  });
  it('rejects path-filtering a ladder job or its execution step', () => {
    const jobFiltered = structuredClone(workflow);
    jobFiltered.jobs.ladders.if += " && needs.changes.outputs.validators == 'true'";
    expect(() => assertTrainValidators(jobFiltered)).toThrow();
    const stepFiltered = structuredClone(workflow);
    stepFiltered.jobs.ladders.steps.find((step: { run?: string }) => step.run?.includes('--check-floor')).if =
      "needs.changes.outputs.validators == 'true'";
    expect(() => assertTrainValidators(stepFiltered)).toThrow();
    const workflowFiltered = structuredClone(workflow);
    workflowFiltered.on.pull_request.paths = ['packages/validators/**'];
    expect(() => assertTrainValidators(workflowFiltered)).toThrow();
    const lightJob = structuredClone(workflow);
    lightJob.jobs.protect.if += " && needs.changes.outputs.any == 'true'";
    expect(() => assertNoPathFilters(lightJob)).toThrow();
  });
  it('rejects runs on main that cancel each other', () => {
    const cancelling = structuredClone(workflow);
    cancelling.concurrency['cancel-in-progress'] = true;
    expect(() => assertConcurrency(cancelling)).toThrow();
    const sharedGroup = structuredClone(workflow);
    sharedGroup.concurrency.group = 'validators-${{ github.ref }}';
    expect(() => assertConcurrency(sharedGroup)).toThrow();
  });
  it('checks every pull request for protected changes with the full history', () => {
    expect(workflow.jobs.protect.if).toBe("github.event_name == 'pull_request'");
    expect(workflow.jobs.protect.steps[0].with['fetch-depth']).toBe(0);
    expect(stepRuns('protect')).toContain(
      'pnpm driftbench validate protect --branch "$HEAD_REF" --base "origin/$BASE_REF"',
    );
  });
});

describe('merge train enforcement', () => {
  const workflow = parse(readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8'));
  it('keeps every heavy CI job on trains and main, with no path filters', () => {
    assertWorkflowPolicy(workflow, CI_HEAVY);
    expect(workflow.jobs.build.strategy.matrix.node).toEqual([22, 24]);
    expect(workflow.jobs.python.strategy.matrix.python).toEqual(['3.11', '3.12']);
  });
  it('rejects a pull_request_target trigger, a missing dispatch trigger and a skipped step on a heavy job', () => {
    const target = structuredClone(workflow);
    target.on.pull_request_target = {};
    expect(() => assertWorkflowPolicy(target, CI_HEAVY)).toThrow();
    const missing = structuredClone(workflow);
    delete missing.on.workflow_dispatch;
    expect(() => assertWorkflowPolicy(missing, CI_HEAVY)).toThrow();
    const skipped = structuredClone(workflow);
    skipped.jobs.build.steps[skipped.jobs.build.steps.length - 1].if = "github.event_name == 'push'";
    expect(() => assertWorkflowPolicy(skipped, CI_HEAVY)).toThrow();
  });
  it('rejects a dispatch that could run a heavy job on main, or ignore the jobs list', () => {
    const anyRef = structuredClone(workflow);
    for (const id of CI_HEAVY)
      anyRef.jobs[id].if = anyRef.jobs[id].if.replace(" && startsWith(github.ref, 'refs/heads/train/')", '');
    expect(() => assertDispatchBehaviour(anyRef, CI_HEAVY)).toThrow();
    const ignoresList = structuredClone(workflow);
    ignoresList.jobs.bench.if = `${TRAIN_CONDITION} || github.event_name == 'workflow_dispatch'`;
    expect(() => assertDispatchBehaviour(ignoresList, CI_HEAVY)).toThrow();
  });
  it('rejects path filters on any job or step', () => {
    const filtered = structuredClone(workflow);
    filtered.jobs.build.if += " && needs.changes.outputs.code == 'true'";
    expect(() => assertNoPathFilters(filtered)).toThrow();
    const action = structuredClone(workflow);
    action.jobs.guard.steps.unshift({ uses: 'dorny/paths-filter@v3' });
    expect(() => assertNoPathFilters(action)).toThrow();
    const triggerFiltered = structuredClone(workflow);
    triggerFiltered.on.workflow_dispatch.paths = ['x'];
    expect(() => assertNoPathFilters(triggerFiltered)).toThrow();
  });
  it('rejects runs on main that cancel each other', () => {
    const cancelling = structuredClone(workflow);
    cancelling.concurrency['cancel-in-progress'] = true;
    expect(() => assertConcurrency(cancelling)).toThrow();
    const sharedGroup = structuredClone(workflow);
    sharedGroup.concurrency.group = 'ci-${{ github.ref }}';
    expect(() => assertConcurrency(sharedGroup)).toThrow();
    const prCancelOff = structuredClone(workflow);
    prCancelOff.concurrency['cancel-in-progress'] = false;
    expect(() => assertConcurrency(prCancelOff)).toThrow();
  });
  it('declares train gate as required and fails ordinary PRs with the merge instruction', () => {
    const job = workflow.jobs['train-gate'];
    expect(job.name).toBe('train gate');
    assertGateWaits(workflow);
    const policy = readFileSync(new URL('../../../CONTRIBUTING.md', import.meta.url), 'utf8');
    expect(policy).toContain('`train gate` must be required in branch protection');
    const command = job.steps.find((step: { run?: string }) => step.run).run;
    assertGate(command);
  });
  it('rejects a gate that lets a dispatch count outside a train branch, or with an empty list', () => {
    const command: string = workflow.jobs['train-gate'].steps.find((step: { run?: string }) => step.run).run;
    expect(() => assertGate(command.replace(/REF_NAME/g, 'HEAD_REF'))).toThrow();
    expect(() => assertGate(command.replace('-z "$JOBS"', '-z "x"'))).toThrow();
    expect(() => assertGate(command.replace('[[ "$REF_NAME" != train/* ]]', 'false'))).toThrow();
  });
  it('rejects a gate that does not wait for every heavy job, or ignores a red one', () => {
    const noNeeds = structuredClone(workflow);
    delete noNeeds.jobs['train-gate'].needs;
    expect(() => assertGateWaits(noNeeds)).toThrow();
    for (const id of CI_HEAVY) {
      const missing = structuredClone(workflow);
      missing.jobs['train-gate'].needs = missing.jobs['train-gate'].needs.filter((n: string) => n !== id);
      expect(() => assertGateWaits(missing)).toThrow();
    }
    const skippedWhenRed = structuredClone(workflow);
    delete skippedWhenRed.jobs['train-gate'].if;
    expect(() => assertGateWaits(skippedWhenRed)).toThrow();
    const command: string = workflow.jobs['train-gate'].steps.find((s: { run?: string }) => s.run).run;
    // the same script without its result check lets a red heavy job through
    const blind = command.replace(
      /if \[\[ ",\$RESULTS," == \*,failure,\* \|\| ",\$RESULTS," == \*,cancelled,\* \]\]; then/,
      'if false; then',
    );
    expect(blind).not.toBe(command);
    expect(() => assertGate(blind)).toThrow();
    expect(() => assertGate(command.replace('*,cancelled,*', '*,never,*'))).toThrow();
  });
  it('passes the gate its dispatch inputs through the environment, never inline in the script', () => {
    const step = workflow.jobs['train-gate'].steps.find((s: { run?: string }) => s.run);
    expect(step.env.REF_NAME).toBe('${{ github.ref_name }}');
    expect(step.env.JOBS).toBe('${{ inputs.jobs }}');
    expect(step.run).not.toContain('${{');
  });
  it('scans the commits of a dispatched train branch with gitleaks, never "no commits"', () => {
    const scan = workflow.jobs.guard.steps.find((s: { name?: string }) => s.name === 'Secret scan');
    expect(scan.run).toContain('workflow_dispatch');
    expect(scan.run).toContain('origin/main..${GITHUB_SHA}');
  });
  it('runs a bounded fast check on every PR with full diff history and affected tests', () => {
    const job = workflow.jobs['pr-fast'];
    expect(job.name).toBe('pr fast');
    expect(job.if).toBe("github.event_name == 'pull_request'");
    expect(job['timeout-minutes']).toBe(8);
    expect(job.steps[0].with['fetch-depth']).toBe(0);
    const commands = job.steps.flatMap((step: { run?: string }) => step.run ?? '');
    expect(commands).toContain('pnpm lint');
    expect(commands).toContain('pnpm typecheck');
    expect(commands).toContain('node tools/structure/api-surface.mjs --build --check');
    expect(commands).toContain('pnpm test --maxWorkers=2 --changed origin/main --passWithNoTests');
    // On a train the affected-tests step is skipped, because the build jobs run the full suite there.
    const affected = job.steps.find((step: { name?: string }) => step.name === 'Tests affected by this PR');
    expect(affected.if).toBe("${{ !startsWith(github.head_ref, 'train/') }}");
    for (const id of ['build']) expect(workflow.jobs[id].if).toBe(heavyCondition(id));
  });
});

describe('the protect list and the frame files', () => {
  it('protects the complete benchmark frame and both enforcement workflows from executor changes', () => {
    const files = [
      'benchmarks/run.ts',
      'benchmarks/support/scorer.ts',
      'benchmarks/slices/planted-verify.json',
      'benchmarks/floors.json',
      'benchmarks/cassettes/haiku.json',
      'benchmarks/evidence/haiku.json',
      'benchmarks/test/floors.test.ts',
      'tools/bench-lint.mjs',
      'tools/bench-lint.test.mjs',
      'tools/bench-lint-future.mjs',
      'packages/cli/src/commands/bench.ts',
      'packages/cli/src/commands/bench-record.ts',
      '.github/workflows/ci.yml',
      '.github/workflows/bench-record.yml',
    ];
    expect(protectedChanges('exec/replace-bench', files)).toEqual(files);
    expect(protectedChanges('feat/maintainer-record', files)).toEqual([]);
    expect(protectedChanges('exec/other', ['benchmarks-old/run.ts', 'tools/other.mjs'])).toEqual([]);
  });

  it('protects every file of the frame, the bank and hardness modules, the bank fixtures and the validator tests', () => {
    for (const file of [
      'packages/validators/src/bank.ts',
      'packages/validators/src/hardness.ts',
      'packages/validators/src/floors.ts',
      'packages/validators/src/journal.ts',
      'packages/validators/src/ladder.ts',
      'packages/validators/fixtures/judges/good.cassette.json',
      'packages/validators/test/judges/ladder.test.ts',
      'validators/floors.json',
      'validators/EXECUTOR.md',
    ]) {
      expect(protectedChanges('exec/x', [file])).toEqual([file]);
    }
  });
});

describe('the benchmark workflows', () => {
  it('enforces public imports and replays every slice against its floor in CI', () => {
    const workflow = parse(
      readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8'),
    );
    const runs = workflow.jobs.bench.steps.flatMap((step: { run?: string }) => step.run ?? []);
    expect(runs).toContain('node tools/bench-lint.mjs');
    expect(runs).toContain('node --import tsx benchmarks/cli.ts replay --slice all --check-floor');
    expect(Object.keys(workflow.on)).toEqual(expect.arrayContaining(['pull_request', 'push']));
    expect(workflow.permissions).toEqual({ contents: 'read' });
  });

  it('keeps the developer bench shortcut pointed at the repository entry', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
    expect(manifest.scripts.bench).toBe('tsx benchmarks/cli.ts');
  });

  it('records only by manual dispatch, with bounded spend and artifact review before a maintainer commit', () => {
    const workflow = parse(
      readFileSync(new URL('../../../.github/workflows/bench-record.yml', import.meta.url), 'utf8'),
    );
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
    const inputs = workflow.on.workflow_dispatch.inputs;
    expect(inputs.slice.required).toBe(true);
    expect(inputs.model.options).toEqual(['haiku', 'gpt-6-luna', 'gemini-3.5-flash-lite']);
    expect(inputs['spend-cap-usd'].required).toBe(true);
    expect(Object.keys(inputs).sort()).toEqual(['model', 'slice', 'spend-cap-usd']);
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(workflow.jobs.haiku['runs-on']).toContain('self-hosted');
    expect(workflow.jobs.haiku['runs-on']).toContain('claude-cli');
    for (const job of Object.values(workflow.jobs) as {
      steps: { run?: string; uses?: string; with?: Record<string, string> }[];
    }[]) {
      const commands = job.steps.flatMap((step) => step.run ?? []).join('\n');
      expect(commands).toContain(
        'bench record --slice "$BENCH_SLICE" --model "$BENCH_MODEL" --spend-cap-usd "$BENCH_SPEND_CAP_USD"',
      );
      expect(commands).not.toMatch(/git (?:push|commit)/);
      expect(commands).not.toContain('${{ inputs.');
      expect(commands).not.toContain('--openai-input-usd-per-million');
      expect(commands).not.toContain('--openai-output-usd-per-million');
      const upload = job.steps.find((step) => step.uses?.startsWith('actions/upload-artifact@'));
      expect(upload?.with?.path).toContain('benchmarks/cassettes/');
      expect(upload?.with?.path).toContain('benchmarks/evidence/');
    }
  });
});
