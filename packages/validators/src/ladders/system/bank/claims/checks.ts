import { CheckRegistry, defaultChecks } from '@agent-nexus/driftbench-checks';
import {
  type Check,
  type CheckContext,
  denseEmbedder,
  machineVerdict,
  type Observed,
  type RunMode,
  type RunResult,
  type Verdict,
  validateSpec,
} from '@agent-nexus/driftbench-core';
import type { Behaviour, RawSpec } from '../../plant';
import { between, type Rng, rngFor } from '../../random';
import { DOCUMENTED_CHECKS } from '../documented';
import { type BankItem, expectAll, fail, type ItemResult, PASS, type Tier } from '../types';
import { loadRaw, type RunScenario, runScenario } from '../world';

/**
 * Executable claims of docs/reference/checks.md: one item per statement the page makes about the machine
 * checks, each run through the real runner and the default checks (runScenario), or, where a run cannot
 * express the case, through the check's own `evaluate` on a built CheckContext. Every input is built so the
 * documented answer is known before anything runs; fictional data only.
 */

const FAMILY = 'claim-checks';
const PAGE = 'docs/reference/checks.md';

const C = (name: string) => `packages/checks/src/checks/${name}.ts`;
const DEFAULTS = 'packages/checks/src/defaults.ts';
const RUNNER = 'packages/core/src/runner/run.ts';
const ASSERT = 'packages/core/src/runner/assertion.ts';
const SEMANTICS = 'packages/core/src/spec/semantics.ts';
const LANGUAGE = 'packages/checks/src/support/language.ts';
const OPERATIONS = 'packages/checks/src/support/operations.ts';
const SCHEMA = 'packages/checks/src/support/schema.ts';
const PII = 'packages/checks/src/support/pii.ts';
const TERMS = 'packages/checks/src/support/terms.ts';
const STAGES = 'packages/core/src/runner/stages.ts';
const LEDGER = 'packages/core/src/runner/ledger.ts';

type Raw = Record<string, unknown>;

function add(
  out: BankItem[],
  slug: string,
  tier: Tier,
  component: string,
  title: string,
  cause: string,
  check: BankItem['check'],
  source: BankItem['source'] = 'contract',
): void {
  out.push({
    id: `claim/checks/${slug}`,
    family: FAMILY,
    tier,
    level: 3,
    component,
    source,
    title: `${title} (${PAGE})`,
    cause,
    check,
  });
}

// ---------------------------------------------------------------------------------------------------------
// Observations and scenes.

type CallShape = { label: string; input?: unknown; output?: unknown };

type Shape = {
  text?: string | string[];
  /** Overrides `observed.text`; '' leaves the visible text to the joined segments. */
  visible?: string;
  calls?: CallShape[];
  cards?: string[];
  runtime?: Observed['runtime'];
  diff?: { created?: string[]; changed?: string[]; deleted?: string[] };
  runs?: Array<{ command: string; exitCode: number; role?: 'agent' | 'command'; stderr?: string }>;
  usd?: number;
  segmentUsd?: number;
  latencyMs?: number;
};

function obs(shape: Shape): Observed {
  const texts = shape.text === undefined ? [] : Array.isArray(shape.text) ? shape.text : [shape.text];
  let segments: Observed['segments'] = [];
  const toolCalls: Observed['toolCalls'] = [];
  (shape.calls ?? []).forEach((call, index) => {
    const id = `call-${index}`;
    const input = call.input ?? {};
    const output = call.output ?? { ok: true };
    segments.push({ type: 'tool_call', id, label: call.label, input });
    segments.push({ type: 'tool_result', id, label: call.label, output });
    toolCalls.push({ id, label: call.label, input, output });
  });
  for (const name of shape.cards ?? []) segments.push({ type: 'card', name });
  for (const text of texts) segments.push({ type: 'text', text });
  if (shape.segmentUsd !== undefined) {
    const usd = shape.segmentUsd;
    segments = segments.map((segment) => ({ ...segment, cost: { usd } }));
  }
  return {
    segments,
    text: shape.visible ?? texts.join('\n'),
    toolCalls,
    ...(shape.runtime ? { runtime: shape.runtime } : {}),
    ...(shape.diff
      ? {
          workspaceDiff: {
            created: shape.diff.created ?? [],
            changed: shape.diff.changed ?? [],
            deleted: shape.diff.deleted ?? [],
          },
        }
      : {}),
    ...(shape.runs ? { executions: shape.runs } : {}),
    cost: shape.usd === undefined ? {} : { usd: shape.usd },
    latencyMs: shape.latencyMs ?? 0,
  };
}

type Turn = { observed: Observed; expect?: Raw; budget?: Raw; user?: string };

function rawSpec(seed: number, tag: string, turns: readonly Turn[], top: Raw = {}): RawSpec {
  const id = `ck-${tag}-${seed}`.replace(/[^A-Za-z0-9._-]/g, '-');
  return {
    id,
    kind: 'conversation',
    title: `Check claim ${tag}`,
    ...top,
    blocks: turns.map((turn, index) => ({
      id: `b${index}`,
      when: { user: userText(seed, tag, turn, index) },
      ...(turn.expect ? { expect: turn.expect } : {}),
      ...(turn.budget ? { budget: turn.budget } : {}),
    })),
  };
}

function userText(seed: number, tag: string, turn: Turn, index: number): string {
  return turn.user ?? `Turn ${index + 1} of the check claim ${tag}, seed ${seed}.`;
}

/** One run of the turns through the real runner and the default checks, unless options say otherwise. */
async function scene(
  seed: number,
  tag: string,
  turns: readonly Turn[],
  top: Raw = {},
  options: RunScenario = {},
): Promise<RunResult> {
  const raw = rawSpec(seed, tag, turns, top);
  const behaviours = new Map<string, Behaviour>();
  turns.forEach((turn, index) => {
    behaviours.set(userText(seed, tag, turn, index), () => structuredClone(turn.observed));
  });
  return runScenario(raw, behaviours, options);
}

/** A CheckContext for one block of a raw spec, for the cases a run cannot express. */
function ctxFor(
  raw: RawSpec,
  observed: Observed,
  options: { block?: number; mode?: RunMode; ledger?: Record<string, unknown>; endState?: unknown } = {},
): CheckContext {
  const spec = loadRaw(raw);
  const index = options.block ?? 0;
  const block = spec.blocks[index];
  if (!block) throw new Error(`the raw spec has no block ${index}`);
  const ledger = options.ledger ?? {};
  return {
    spec,
    mode: options.mode ?? 'F',
    blockIndex: index,
    block,
    expect: block.expect ?? {},
    given: {
      prefix: [],
      ledger,
      world: {},
      vars: {},
      target: { adapter: 'function' },
      hash: 'claim',
    } as unknown as CheckContext['given'],
    observed,
    history: [],
    ledger,
    ...(options.endState === undefined ? {} : { endState: options.endState }),
  };
}

// ---------------------------------------------------------------------------------------------------------
// Reading verdicts.

function verdictsOf(run: RunResult, block: number): Verdict[] {
  return run.blocks[block]?.verdicts ?? [];
}

function find(run: RunResult, block: number, id: string): Verdict | undefined {
  return verdictsOf(run, block).find((verdict) => verdict.id === id);
}

function shown(verdict: Verdict | undefined): string {
  if (!verdict) return 'no such verdict';
  return `${verdict.id} ${verdict.outcome}${verdict.gating ? '' : ' (not gating)'}${verdict.score === undefined ? '' : ` score ${verdict.score}`}: ${verdict.evidence}`;
}

function idsOf(verdicts: readonly Verdict[]): string {
  return verdicts.length === 0 ? 'none' : verdicts.map((verdict) => verdict.id).join(', ');
}

type Want = {
  outcome: Verdict['outcome'];
  gating?: boolean;
  evidence?: RegExp;
  /** The block's pass, when the item claims it. */
  pass?: boolean;
};

/** The verdict `id` of block `block` has the outcome (and gating, evidence, block pass) the docs give. */
function verdictIs(run: RunResult, block: number, id: string, want: Want): ItemResult {
  const verdict = find(run, block, id);
  const where = `block ${block}`;
  if (!verdict) {
    return fail(
      `${where}: expected a verdict ${id} ${want.outcome}, got none; verdict ids in the block: ${idsOf(verdictsOf(run, block))}`,
    );
  }
  const wanted = `${id} ${want.outcome}${want.gating === undefined ? '' : want.gating ? ' gating' : ' not gating'}`;
  if (verdict.outcome !== want.outcome || (want.gating !== undefined && verdict.gating !== want.gating)) {
    return fail(`${where}: expected ${wanted}, got ${shown(verdict)}`);
  }
  if (want.evidence && !want.evidence.test(verdict.evidence)) {
    return fail(`${where}: expected the evidence of ${id} to match ${want.evidence}, got ${shown(verdict)}`);
  }
  const pass = run.blocks[block]?.pass;
  if (want.pass !== undefined && pass !== want.pass) {
    const failing = verdictsOf(run, block)
      .filter((one) => one.gating && one.outcome !== 'pass')
      .map(shown);
    return fail(
      `${where}: expected the block to ${want.pass ? 'pass' : 'fail'}, it ${pass ? 'passed' : 'failed'}; failing gating verdicts: ${failing.join('; ') || 'none'}`,
    );
  }
  return PASS;
}

function verdictsIn(list: readonly Verdict[], id: string, want: Want): ItemResult {
  const verdict = list.find((one) => one.id === id);
  if (!verdict)
    return fail(`expected a verdict ${id} ${want.outcome}, got none; verdict ids: ${idsOf(list)}`);
  if (verdict.outcome !== want.outcome || (want.gating !== undefined && verdict.gating !== want.gating)) {
    return fail(
      `expected ${id} ${want.outcome}${want.gating === undefined ? '' : want.gating ? ' gating' : ' not gating'}, got ${shown(verdict)}`,
    );
  }
  if (want.evidence && !want.evidence.test(verdict.evidence)) {
    return fail(`expected the evidence of ${id} to match ${want.evidence}, got ${shown(verdict)}`);
  }
  return PASS;
}

/** No verdict of the block has an id starting with the prefix. */
function noVerdict(run: RunResult, block: number, prefix: string): ItemResult {
  const found = verdictsOf(run, block).filter((verdict) => verdict.id.startsWith(prefix));
  return found.length === 0
    ? PASS
    : fail(`block ${block}: expected no verdict starting ${prefix}, got ${found.map(shown).join('; ')}`);
}

function all(...results: ItemResult[]): ItemResult {
  return results.find((result) => !result.pass) ?? PASS;
}

// ---------------------------------------------------------------------------------------------------------
// Fictional values built from the seed.

const EN = (code: string) =>
  `Thank you for your message. Your request is recorded under reference ${code}, and we will continue together with the next step today.`;
const EN2 = (code: string) =>
  `Good morning. The engineer confirmed the visit for reference ${code}, and you will receive the written summary before the end of the week.`;
const FR = (code: string) =>
  `Merci beaucoup pour votre message. Votre demande est bien enregistrée sous la référence ${code}, et nous continuons ensemble maintenant.`;

function codeOf(rng: Rng): string {
  return `R-${between(rng, 1000, 9999)}`;
}

function mod97(digits: string): number {
  let remainder = 0;
  for (const char of digits) remainder = (remainder * 10 + Number(char)) % 97;
  return remainder;
}

/** A Belgian IBAN with a valid ISO 13616 checksum, built from 12 random digits (B = 11, E = 14). */
function belgianIban(rng: Rng): string {
  let bban = '';
  for (let index = 0; index < 12; index += 1) bban += String(between(rng, 0, 9));
  const check = 98 - mod97(`${bban}111400`);
  return `BE${String(check).padStart(2, '0')}${bban}`;
}

function grouped(iban: string): string {
  return iban.replace(/(.{4})/g, '$1 ').trim();
}

/** A Belgian national register number of 1985 with its check digits: 97 minus the first nine digits mod 97. */
function nationalNumber(rng: Rng, valid = true): string {
  const month = String(between(rng, 1, 12)).padStart(2, '0');
  const day = String(between(rng, 1, 28)).padStart(2, '0');
  const serial = String(between(rng, 100, 997)).padStart(3, '0');
  const base = `85${month}${day}${serial}`;
  const right = 97 - (Number(base) % 97);
  const check = valid ? right : (right % 97) + 1;
  return `85.${month}.${day}-${serial}.${String(check).padStart(2, '0')}`;
}

const LOOKUP = 'records.lookup';

// ---------------------------------------------------------------------------------------------------------
// Verdicts, the check list and the runner's handling of checks.

function verdictItems(out: BankItem[]): void {
  add(
    out,
    'defaults/order',
    1,
    DEFAULTS,
    'defaultChecks() returns the documented checks in the documented order ("Checks", first paragraph)',
    'defaults: defaultChecks returns the machine checks in the order the page lists',
    async () => {
      const want: readonly string[] = DOCUMENTED_CHECKS;
      const got = defaultChecks().map((check) => check.name);
      return got.join(',') === want.join(',')
        ? PASS
        : fail(`defaultChecks() names ${got.join(', ')}; the page lists ${want.join(', ')}`);
    },
  );
  add(
    out,
    'defaults/judge-last',
    1,
    DEFAULTS,
    'defaultChecks({ judges }) returns the same checks and then the judge check last ("Checks", "Judged criteria")',
    'defaults: a judge source appends its check after custom',
    async () => {
      const judge: Check = { name: 'judge', applies: () => false, evaluate: () => [] };
      const got = defaultChecks({ judges: { check: () => judge } }).map((check) => check.name);
      const want = DOCUMENTED_CHECKS.length + 1;
      return expectAll([
        [got.length === want, `defaultChecks({ judges }) returned ${got.length} checks, expected ${want}`],
        [got.at(-1) === 'judge', `the last check is ${got.at(-1)}, expected judge`],
        [got.at(-2) === 'custom', `the check before judge is ${got.at(-2)}, expected custom`],
      ]);
    },
  );
  add(
    out,
    'verdicts/id-prefix',
    1,
    RUNNER,
    'every verdict id starts with the name of its check, then a dot ("Verdicts")',
    'checks: every verdict id is the check name, a dot, then the fact',
    async ({ seed }) => {
      const rng = rngFor(seed, 'id-prefix');
      const code = codeOf(rng);
      const run = await scene(
        seed,
        'id-prefix',
        [
          {
            observed: obs({
              text: EN(code),
              calls: [{ label: LOOKUP, input: { step: 1 } }],
              runtime: { stages: [{ name: 'open' }], guards: [{ name: 'policy', verdict: 'allow' }] },
            }),
            expect: {
              stage: 'open',
              tools: [{ label: LOOKUP, count: 1, input: { step: 1 } }],
              must: [code],
              must_not: ['refund'],
              lang: 'EN',
              guards: [{ name: 'policy', verdict: 'allow' }],
              skills: [{ name: 'xlsx', count: 0 }],
            },
          },
        ],
        { stages: ['open'], rules: { forbidden_tools: ['orders.place'] } },
      );
      const wrong = verdictsOf(run, 0).filter(
        (verdict) =>
          !verdict.id.startsWith(`${verdict.id.split('.', 1)[0]}.`) ||
          verdict.id.split('.', 1)[0] !== verdict.name,
      );
      return wrong.length === 0
        ? PASS
        : fail(
            `verdicts whose id does not start with their check name and a dot: ${wrong.map(shown).join('; ')}`,
          );
    },
  );
  add(
    out,
    'verdicts/check-throws',
    2,
    RUNNER,
    'a check that throws does not stop the run: the runner records an inconclusive gating verdict <check>.error ("Verdicts")',
    'runner: a check that throws gives an inconclusive gating <check>.error verdict and the run goes on',
    async ({ seed }) => {
      const boom: Check = {
        name: 'boom',
        applies: () => true,
        evaluate: () => {
          throw new Error('planted failure');
        },
      };
      const run = await scene(
        seed,
        'check-throws',
        [{ observed: obs({ text: EN('R-1000') }) }, { observed: obs({ text: EN2('R-1001') }) }],
        {},
        { checks: [...defaultChecks(), boom] },
      );
      return expectAll([
        [
          run.blocks.length === 2,
          `the run has ${run.blocks.length} blocks, expected 2: the throw stopped it`,
        ],
        [
          find(run, 1, 'boom.error')?.outcome === 'inconclusive' &&
            find(run, 1, 'boom.error')?.gating === true,
          `block 1 boom.error: expected inconclusive gating, got ${shown(find(run, 1, 'boom.error'))}`,
        ],
        [run.blocks[0]?.pass === false, 'block 0 passed though a gating verdict was inconclusive'],
      ]);
    },
  );
  add(
    out,
    'verdicts/invalid-verdict',
    2,
    RUNNER,
    'a check that returns a verdict the schema refuses gives an inconclusive gating <check>.invalid ("Verdicts")',
    'runner: a verdict the schema refuses becomes an inconclusive gating <check>.invalid verdict',
    async ({ seed }) => {
      const bad: Check = {
        name: 'bad',
        applies: () => true,
        evaluate: () => [
          { id: 'bad.x', kind: 'machine', name: 'bad', gating: true, outcome: 'maybe' } as never,
        ],
      };
      const run = await scene(
        seed,
        'invalid-verdict',
        [{ observed: obs({ text: EN('R-1002') }) }],
        {},
        {
          checks: [...defaultChecks(), bad],
        },
      );
      return verdictIs(run, 0, 'bad.invalid', { outcome: 'inconclusive', gating: true, pass: false });
    },
  );
  add(
    out,
    'verdicts/not-gating-never-fails',
    2,
    RUNNER,
    'a verdict that does not gate never fails the block ("Verdicts")',
    'runner: a block passes when every gating verdict passes, whatever the non-gating ones say',
    async ({ seed }) => {
      const run = await scene(seed, 'not-gating', [
        {
          observed: obs({ text: 'Done.', calls: [{ label: LOOKUP, input: { step: 2 } }] }),
          expect: { lang: 'EN' },
          budget: { cost_usd: 1 },
        },
      ]);
      return all(
        verdictIs(run, 0, 'lang.expected', { outcome: 'inconclusive', gating: false }),
        verdictIs(run, 0, 'budget.cost_usd', { outcome: 'inconclusive', gating: false, pass: true }),
      );
    },
  );

  const noTrace: Array<[string, string, Raw, Shape, string]> = [
    [
      'skills',
      'skills.xlsx',
      { skills: [{ name: 'xlsx' }] },
      { text: EN('R-1003') },
      'skills: no runtime trace at all gives an inconclusive gating verdict per expected skill',
    ],
    [
      'guards',
      'guards.policy.allow',
      { guards: [{ name: 'policy', verdict: 'allow' }] },
      { text: EN('R-1004') },
      'guards: no runtime trace at all gives an inconclusive gating verdict per expected guard',
    ],
    [
      'execution',
      'execution.ran_code',
      { execution: { ran_code: true } },
      { text: EN('R-1005') },
      'execution: no executions list gives an inconclusive gating verdict per expected fact',
    ],
    [
      'workspace',
      'workspace.created',
      { workspace: { created: ['out/report.xlsx'] } },
      { text: EN('R-1006') },
      'workspace: no workspace diff gives an inconclusive gating verdict per expected set',
    ],
  ];
  for (const [check, id, expect, shape, cause] of noTrace) {
    add(
      out,
      `inconclusive/${check}-observed-nothing`,
      2,
      C(check),
      `${check} with nothing observed is inconclusive and gating, so the block cannot pass ("Verdicts", inconclusive table)`,
      cause,
      async ({ seed }) => {
        const run = await scene(seed, `nothing-${check}`, [{ observed: obs(shape), expect }]);
        return verdictIs(run, 0, id, { outcome: 'inconclusive', gating: true, pass: false });
      },
    );
  }

  add(
    out,
    'verdicts/repeat-tool-#2',
    2,
    C('tools'),
    'a tool expected twice in a block gets #2 in the id of its second entry: tools.<label>#2.count ("Verdicts")',
    'tools: the second entry of one label gets #2 after the label in its verdict ids',
    async ({ seed }) => {
      const run = await scene(seed, 'repeat-tool', [
        {
          observed: obs({ text: EN('R-1007'), calls: [{ label: 'order.create', input: { plan: 'a' } }] }),
          expect: {
            tools: [
              { label: 'order.create', count: 1 },
              { label: 'order.create', input: { plan: 'a' } },
            ],
          },
        },
      ]);
      return all(
        verdictIs(run, 0, 'tools.order.create.count', { outcome: 'pass' }),
        verdictIs(run, 0, 'tools.order.create#2.count', { outcome: 'pass' }),
        verdictIs(run, 0, 'tools.order.create#2.input.plan', { outcome: 'pass' }),
      );
    },
  );
  add(
    out,
    'verdicts/repeat-guard-#2',
    2,
    C('guards'),
    'a guard expected twice gets #2 in the id of its second entry ("Verdicts": this holds for guard names)',
    'guards: two entries of one guard get distinct ids, the second marked #2',
    async ({ seed }) => {
      const run = await scene(seed, 'repeat-guard', [
        {
          observed: obs({ text: EN('R-1008'), runtime: { guards: [{ name: 'policy', verdict: 'allow' }] } }),
          expect: {
            guards: [
              { name: 'policy', verdict: 'allow', count: 1 },
              { name: 'policy', verdict: 'allow', count: { min: 1 } },
            ],
          },
        },
      ]);
      const ids = verdictsOf(run, 0)
        .filter((verdict) => verdict.id.startsWith('guards.'))
        .map((verdict) => verdict.id);
      return expectAll([
        [ids.length === 2, `expected 2 guards verdicts, got ${ids.join(', ') || 'none'}`],
        [new Set(ids).size === ids.length, `the guards verdict ids repeat: ${ids.join(', ')}`],
        [ids[1]?.includes('#2') === true, `the second guards verdict id ${ids[1]} carries no #2`],
      ]);
    },
  );
}

// ---------------------------------------------------------------------------------------------------------
// Tools, forbidden tools and rules on tools.

function toolItems(out: BankItem[]): void {
  add(
    out,
    'tools/count-range',
    2,
    C('tools'),
    'count { min, max } bounds the calls of a tool on both sides ("Tools, skills, guards...")',
    'tools: a count range fails a call count above its max and passes one inside it',
    async ({ seed }) => {
      const calls = (n: number) => Array.from({ length: n }, () => ({ label: LOOKUP, input: { n } }));
      const expect = { tools: [{ label: LOOKUP, count: { min: 1, max: 2 } }] };
      const run = await scene(seed, 'count-range', [
        { observed: obs({ text: EN('R-1010'), calls: calls(3) }), expect },
        { observed: obs({ text: EN2('R-1011'), calls: calls(2) }), expect },
      ]);
      return all(
        verdictIs(run, 0, `tools.${LOOKUP}.count`, { outcome: 'fail' }),
        verdictIs(run, 1, `tools.${LOOKUP}.count`, { outcome: 'pass' }),
      );
    },
  );
  add(
    out,
    'tools/no-count-at-least-once',
    1,
    C('tools'),
    'without count, the tool must run at least once ("Tools, skills, guards...")',
    'tools: an entry without count fails when the tool never ran',
    async ({ seed }) => {
      const run = await scene(seed, 'no-count', [
        { observed: obs({ text: EN('R-1012') }), expect: { tools: [{ label: LOOKUP }] } },
      ]);
      return verdictIs(run, 0, `tools.${LOOKUP}.count`, { outcome: 'fail', evidence: /0 times/ });
    },
  );
  add(
    out,
    'tools/input-every-call',
    2,
    C('tools'),
    'every call of the tool must hold each input assertion ("Tools, skills, guards...")',
    'tools: one call breaking an input assertion fails it even when another call holds it',
    async ({ seed }) => {
      const email = `client${seed}@example.org`;
      const run = await scene(seed, 'input-every', [
        {
          observed: obs({
            text: EN('R-1013'),
            calls: [
              { label: LOOKUP, input: { email } },
              { label: LOOKUP, input: { email: `other${seed}@example.org` } },
            ],
          }),
          expect: { tools: [{ label: LOOKUP, count: 2, input: { email } }] },
        },
      ]);
      return verdictIs(run, 0, `tools.${LOOKUP}.input.email`, { outcome: 'fail', evidence: /call 2/ });
    },
  );
  add(
    out,
    'tools/not-called-fails-inputs',
    2,
    C('tools'),
    'a tool that was not called fails each of its input assertions, an absent assertion included ("Tools, skills, guards...")',
    'tools: input assertions of a tool never called fail, even { absent: true }',
    async ({ seed }) => {
      const run = await scene(seed, 'not-called', [
        {
          observed: obs({ text: EN('R-1014') }),
          expect: {
            tools: [
              { label: 'submit_order', count: 1, input: { plan: 'fiber_500', coupon: { absent: true } } },
            ],
          },
        },
      ]);
      return all(
        verdictIs(run, 0, 'tools.submit_order.input.plan', { outcome: 'fail' }),
        verdictIs(run, 0, 'tools.submit_order.input.coupon', { outcome: 'fail' }),
      );
    },
  );
  add(
    out,
    'tools/order-exact',
    2,
    C('tools'),
    'tool_order exact: the calls split into consecutive runs, one per expected tool in order, nothing left over ("Tools, skills, guards...")',
    'tools: exact order accepts consecutive runs and refuses an interleaved call',
    async ({ seed }) => {
      const expect = {
        tools: [
          { label: 'a.find', count: { min: 1 } },
          { label: 'b.save', count: 1 },
        ],
        tool_order: 'exact',
      };
      const run = await scene(seed, 'order-exact', [
        {
          observed: obs({
            text: EN('R-1015'),
            calls: [{ label: 'a.find' }, { label: 'a.find' }, { label: 'b.save' }],
          }),
          expect,
        },
        {
          observed: obs({
            text: EN2('R-1016'),
            calls: [{ label: 'a.find' }, { label: 'b.save' }, { label: 'a.find' }],
          }),
          expect,
        },
      ]);
      return all(
        verdictIs(run, 0, 'tools.order', { outcome: 'pass' }),
        verdictIs(run, 1, 'tools.order', { outcome: 'fail' }),
      );
    },
  );
  add(
    out,
    'tools/order-in-order',
    2,
    C('tools'),
    'tool_order in_order: the expected calls appear in order, other calls may sit between ("Tools, skills, guards...")',
    'tools: in_order passes with a call between the expected ones and fails on the reverse order',
    async ({ seed }) => {
      const expect = { tools: [{ label: 'a.find' }, { label: 'b.save' }], tool_order: 'in_order' };
      const run = await scene(seed, 'order-in', [
        {
          observed: obs({
            text: EN('R-1017'),
            calls: [{ label: 'a.find' }, { label: 'x.note' }, { label: 'b.save' }],
          }),
          expect,
        },
        { observed: obs({ text: EN2('R-1018'), calls: [{ label: 'b.save' }, { label: 'a.find' }] }), expect },
      ]);
      return all(
        verdictIs(run, 0, 'tools.order', { outcome: 'pass' }),
        verdictIs(run, 1, 'tools.order', { outcome: 'fail' }),
      );
    },
  );
  add(
    out,
    'tools/order-any-order',
    1,
    C('tools'),
    'tool_order any_order: the expected calls appear in any order ("Tools, skills, guards...")',
    'tools: any_order passes the expected calls in reverse order',
    async ({ seed }) => {
      const run = await scene(seed, 'order-any', [
        {
          observed: obs({ text: EN('R-1019'), calls: [{ label: 'b.save' }, { label: 'a.find' }] }),
          expect: { tools: [{ label: 'a.find' }, { label: 'b.save' }], tool_order: 'any_order' },
        },
      ]);
      return verdictIs(run, 0, 'tools.order', { outcome: 'pass' });
    },
  );
  add(
    out,
    'tools/order-min-count',
    3,
    C('tools'),
    'for in_order, each tool stands for as many calls as its count requires at the least ("Tools, skills, guards...")',
    'tools: in_order needs as many calls of a tool as its minimum count',
    async ({ seed }) => {
      const run = await scene(seed, 'order-min', [
        {
          observed: obs({ text: EN('R-1020'), calls: [{ label: 'a.find' }, { label: 'b.save' }] }),
          expect: {
            tools: [{ label: 'a.find', count: { min: 2 } }, { label: 'b.save' }],
            tool_order: 'in_order',
          },
        },
      ]);
      return verdictIs(run, 0, 'tools.order', { outcome: 'fail' });
    },
  );
  add(
    out,
    'tools/argument-accuracy',
    2,
    C('tools'),
    'the argument accuracy never gates; its score is the share of expected arguments that matched ("Every check and its verdict ids")',
    'tools: argument accuracy of 0.5 does not gate an otherwise passing block, as a verdict or as a diagnosis',
    async ({ seed }) => {
      // Isolate accuracy from the failed argument assertion: input verdicts still
      // supply its score, but only accuracy itself could make this scene fail.
      const checks = defaultChecks().map((check) =>
        check.name !== 'tools'
          ? check
          : {
              ...check,
              evaluate: async (ctx: CheckContext) =>
                (await check.evaluate(ctx)).map((entry) =>
                  entry.id.includes('.input.') ? { ...entry, gating: false } : entry,
                ),
            },
      );
      const run = await scene(
        seed,
        'arg-accuracy',
        [
          {
            observed: obs({
              text: EN('R-1021'),
              calls: [{ label: LOOKUP, input: { plan: 'fiber_500', email: 'x' } }],
            }),
            expect: {
              tools: [{ label: LOOKUP, input: { plan: 'fiber_500', email: { regex: '@example\\.org$' } } }],
            },
          },
        ],
        {},
        { checks },
      );
      const inputs = verdictsOf(run, 0).filter((entry) => entry.id.includes('.input.'));
      if (
        inputs.length !== 2 ||
        inputs.some((entry) => entry.gating) ||
        inputs.filter((entry) => entry.outcome === 'pass').length !== 1 ||
        inputs.filter((entry) => entry.outcome === 'fail').length !== 1
      ) {
        return fail('expected two non-gating input verdicts: one pass and one fail');
      }
      const otherGating = verdictsOf(run, 0).filter(
        (entry) => entry.gating && entry.id !== 'tools.argument_accuracy',
      );
      if (otherGating.length === 0 || otherGating.some((entry) => entry.outcome !== 'pass')) {
        return fail('expected every other gating verdict to pass');
      }
      const verdict = find(run, 0, 'tools.argument_accuracy');
      // The block framework moves a measure computed from other verdicts to a diagnosis, which never gates: the
      // claim holds the same score and the same "never gates" on whichever form the code ships, and refuses both.
      const block = run.blocks[0] as
        | { pass: boolean; diagnoses?: Array<{ diagnostic: string; score?: number }> }
        | undefined;
      const diagnosis = block?.diagnoses?.find((entry) =>
        entry.diagnostic.startsWith('diagnostic:argument-accuracy@'),
      );
      if (verdict && diagnosis) {
        return fail(`expected the argument accuracy once, got both ${shown(verdict)} and a diagnosis`);
      }
      if (diagnosis) {
        return diagnosis.score === 0.5 && block?.pass === true
          ? PASS
          : fail(
              `expected the argument-accuracy diagnosis with score 0.5 (1 of 2 matched) and a passing block, got score ${String(diagnosis.score)}, pass ${String(block?.pass)}`,
            );
      }
      return verdict?.gating === false && verdict.score === 0.5 && block?.pass === true
        ? PASS
        : fail(
            `expected tools.argument_accuracy not gating with score 0.5 (1 of 2 matched) and a passing block, got ${shown(verdict)}, pass ${String(block?.pass)}`,
          );
    },
  );
  add(
    out,
    'tools/order-alone-applies',
    2,
    C('tools'),
    'the tools check applies when tool_order is set even with no tool listed ("Every check and its verdict ids")',
    'tools: tool_order alone makes the check apply and exact refuses unexpected calls',
    async ({ seed }) => {
      const run = await scene(seed, 'order-alone', [
        {
          observed: obs({ text: EN('R-1022'), calls: [{ label: LOOKUP }] }),
          expect: { tool_order: 'exact' },
        },
      ]);
      return verdictIs(run, 0, 'tools.order', { outcome: 'fail' });
    },
  );
  add(
    out,
    'tools/count-zero-is-forbidden',
    1,
    C('forbidden'),
    'count: 0 is reported by forbidden, not by tools, so never twice ("Tools, skills, guards...")',
    'forbidden: a tool expected 0 times is reported once, by forbidden only',
    async ({ seed }) => {
      const run = await scene(seed, 'count-zero', [
        { observed: obs({ text: EN('R-1023') }), expect: { tools: [{ label: 'coverage.check', count: 0 }] } },
      ]);
      return all(
        verdictIs(run, 0, 'forbidden.coverage.check', { outcome: 'pass', evidence: /0 times/ }),
        noVerdict(run, 0, 'tools.'),
      );
    },
  );
  add(
    out,
    'forbidden/one-verdict-every-reason',
    2,
    C('forbidden'),
    'a forbidden tool gets one verdict that names every reason it is forbidden ("Rules on tools")',
    'forbidden: one verdict per tool lists forbidden_tools, max_calls 0 and an expected 0 together',
    async ({ seed }) => {
      const run = await scene(
        seed,
        'every-reason',
        [
          {
            observed: obs({ text: EN('R-1024'), calls: [{ label: 'orders.place' }] }),
            expect: { tools: [{ label: 'orders.place', count: 0 }] },
          },
        ],
        { rules: { forbidden_tools: ['orders.place'], max_calls: { 'orders.place': 0 } } },
      );
      const mine = verdictsOf(run, 0).filter((verdict) => verdict.id.startsWith('forbidden.'));
      const one = mine[0];
      return expectAll([
        [mine.length === 1, `expected one forbidden verdict, got ${mine.map(shown).join('; ') || 'none'}`],
        [one?.outcome === 'fail', `expected it to fail, got ${shown(one)}`],
        [
          /forbidden_tools/.test(one?.evidence ?? '') &&
            /max_calls/.test(one?.evidence ?? '') &&
            /0 times/.test(one?.evidence ?? ''),
          `expected the evidence to name forbidden_tools, max_calls and the expected 0, got ${shown(one)}`,
        ],
      ]);
    },
  );
  add(
    out,
    'forbidden/max-calls-run-wide',
    3,
    C('forbidden'),
    'rules.max_calls above 0 caps calls across the run, and one excess is reported once ("Rules on tools")',
    'forbidden: a cap counts earlier blocks and fails only the block whose own calls pass it',
    async ({ seed }) => {
      const run = await scene(
        seed,
        'max-calls',
        [
          { observed: obs({ text: EN('R-1025'), calls: [{ label: 'quote.send' }] }) },
          { observed: obs({ text: EN2('R-1026'), calls: [{ label: 'quote.send' }] }) },
          { observed: obs({ text: EN('R-1027') }) },
        ],
        { rules: { max_calls: { 'quote.send': 1 } } },
      );
      return all(
        verdictIs(run, 0, 'forbidden.max_calls.quote.send', { outcome: 'pass' }),
        verdictIs(run, 1, 'forbidden.max_calls.quote.send', { outcome: 'fail' }),
        verdictIs(run, 2, 'forbidden.max_calls.quote.send', { outcome: 'pass' }),
      );
    },
  );
  add(
    out,
    'forbidden/expected-forbidden-refused',
    1,
    SEMANTICS,
    'a block that expects a tool the rules forbid is an error when the spec loads, TOOL_FORBIDDEN_EXPECTED ("Rules for the whole spec")',
    'loader: a spec expecting a forbidden tool is refused with TOOL_FORBIDDEN_EXPECTED',
    async ({ seed }) => {
      const raw = rawSpec(
        seed,
        'forbidden-expected',
        [{ observed: obs({}), expect: { tools: [{ label: 'orders.place', count: 1 }] } }],
        {
          rules: { forbidden_tools: ['orders.place'] },
        },
      );
      const loaded = validateSpec(raw);
      const codes = loaded.ok ? [] : loaded.errors.map((issue) => issue.code);
      return codes.includes('TOOL_FORBIDDEN_EXPECTED')
        ? PASS
        : fail(`expected TOOL_FORBIDDEN_EXPECTED, the loader gave ${loaded.ok ? 'ok' : codes.join(', ')}`);
    },
  );
}

// ---------------------------------------------------------------------------------------------------------
// Assertions on values, through tool inputs (and end_state where named).

function assertionItems(out: BankItem[]): void {
  type Case = [string, string, unknown, unknown, unknown, string];
  const cases: Case[] = [
    [
      'bare',
      'a bare value passes when the value is equal to it',
      'fiber_500',
      'fiber_500',
      'fiber_1000',
      'assertions: a bare scalar asserts equality',
    ],
    [
      'exact',
      '{ exact } passes on exactly this JSON value, nested mappings and lists included',
      { exact: { plan: 'p', tags: ['a', 'b'] } },
      { plan: 'p', tags: ['a', 'b'] },
      { plan: 'p', tags: ['a'] },
      'assertions: exact compares the whole JSON value',
    ],
    [
      'regex-m-flag',
      '{ regex } compiles with the m flag, so ^ matches at a line start',
      { regex: '^ref R-\\d{4}$' },
      'note\nref R-4821',
      'note ref R-4821',
      'assertions: regex patterns compile with the m flag',
    ],
    [
      'contains-string',
      '{ contains } passes on a string that contains the text',
      { contains: 'Summit' },
      '88 Summit Avenue',
      '88 Harbor Road',
      'assertions: contains finds a substring of a string',
    ],
    [
      'contains-list',
      '{ contains } passes on a list that holds the text as an item',
      { contains: 'fiber' },
      ['tv', 'fiber'],
      ['tv', 'fiberglass'],
      'assertions: contains finds an item of a list, not a substring of one',
    ],
    [
      'one-of',
      '{ one_of } passes on one of the listed values',
      { one_of: ['callback', 'no_coverage'] },
      'no_coverage',
      'later',
      'assertions: one_of accepts any listed value and nothing else',
    ],
    [
      'nonempty-spaces',
      '{ nonempty } refuses a string of spaces only',
      { nonempty: true },
      'a summary',
      '   ',
      'assertions: nonempty refuses a blank string',
    ],
    [
      'nonempty-empty-list',
      '{ nonempty } refuses an empty list',
      { nonempty: true },
      ['x'],
      [],
      'assertions: nonempty refuses an empty list',
    ],
    [
      'nonempty-empty-mapping',
      '{ nonempty } refuses a mapping whose keys hold nothing',
      { nonempty: true },
      { a: 1 },
      {},
      'assertions: nonempty refuses an empty mapping',
    ],
    [
      'subset-nested',
      '{ subset } holds at least these keys, nested mappings compared the same way',
      { subset: { address: { city: 'Acmeville' } } },
      { address: { city: 'Acmeville', zip: '1000' }, plan: 'p' },
      { address: { zip: '1000' } },
      'assertions: subset compares nested mappings as subsets',
    ],
    [
      'list-order',
      'equality compares lists item by item, in order',
      { exact: ['a', 'b'] },
      ['a', 'b'],
      ['b', 'a'],
      'assertions: list equality is ordered',
    ],
  ];
  for (const [slug, title, assertion, good, bad, cause] of cases) {
    add(out, `assert/${slug}`, 2, ASSERT, `${title} ("Assertions on values")`, cause, async ({ seed }) => {
      const expect = { tools: [{ label: 'plans.quote', input: { value: assertion } }] };
      const run = await scene(seed, `assert-${slug}`, [
        {
          observed: obs({ text: EN('R-1030'), calls: [{ label: 'plans.quote', input: { value: good } }] }),
          expect,
        },
        {
          observed: obs({ text: EN2('R-1031'), calls: [{ label: 'plans.quote', input: { value: bad } }] }),
          expect,
        },
      ]);
      return all(
        verdictIs(run, 0, 'tools.plans.quote.input.value', { outcome: 'pass' }),
        verdictIs(run, 1, 'tools.plans.quote.input.value', { outcome: 'fail' }),
      );
    });
  }
  add(
    out,
    'assert/nonempty-null-mapping',
    3,
    ASSERT,
    '{ nonempty } refuses a mapping whose keys hold nothing; in JSON input a key holds nothing when it is null ("Assertions on values")',
    'assertions: nonempty treats a mapping whose keys all hold null as empty',
    async ({ seed }) => {
      const expect = { tools: [{ label: 'plans.quote', input: { value: { nonempty: true } } }] };
      const run = await scene(seed, 'assert-null-map', [
        {
          observed: obs({
            text: EN('R-1035'),
            calls: [{ label: 'plans.quote', input: { value: { summary: null, notes: null } } }],
          }),
          expect,
        },
      ]);
      return verdictIs(run, 0, 'tools.plans.quote.input.value', { outcome: 'fail' });
    },
    'adversarial',
  );
  add(
    out,
    'assert/absent',
    1,
    ASSERT,
    '{ absent } passes when the key is absent and fails when it holds a value ("Assertions on values")',
    'assertions: absent passes only on a missing key',
    async ({ seed }) => {
      const expect = { tools: [{ label: 'plans.quote', input: { coupon: { absent: true } } }] };
      const run = await scene(seed, 'assert-absent', [
        {
          observed: obs({ text: EN('R-1032'), calls: [{ label: 'plans.quote', input: { plan: 'p' } }] }),
          expect,
        },
        {
          observed: obs({
            text: EN2('R-1033'),
            calls: [{ label: 'plans.quote', input: { plan: 'p', coupon: 'X10' } }],
          }),
          expect,
        },
      ]);
      return all(
        verdictIs(run, 0, 'tools.plans.quote.input.coupon', { outcome: 'pass' }),
        verdictIs(run, 1, 'tools.plans.quote.input.coupon', { outcome: 'fail' }),
      );
    },
  );
  add(
    out,
    'assert/undefined-key-absent',
    3,
    ASSERT,
    'a key that holds no value counts as absent in JSON equality ("Assertions on values")',
    'assertions: equality ignores keys that hold no value',
    async ({ seed }) => {
      const raw = rawSpec(seed, 'undefined-key', [
        {
          observed: obs({}),
          expect: { tools: [{ label: 'plans.quote', input: { value: { exact: { plan: 'p' } } } }] },
        },
      ]);
      const observed = obs({
        text: EN('R-1034'),
        calls: [{ label: 'plans.quote', input: { value: { plan: 'p', coupon: undefined } } }],
      });
      const tools = defaultChecks()[0] as Check;
      const verdicts = await tools.evaluate(ctxFor(raw, observed));
      return verdictsIn(verdicts, 'tools.plans.quote.input.value', { outcome: 'pass' });
    },
  );
}

// ---------------------------------------------------------------------------------------------------------
// Text and language.

function textItems(out: BankItem[]): void {
  add(
    out,
    'must/evidence-offset',
    1,
    C('must'),
    'the evidence of must gives the matched text and its offset ("Text and language")',
    'must: the evidence quotes the match and its offset in the visible text',
    async ({ seed }) => {
      const code = codeOf(rngFor(seed, 'must-offset'));
      const text = EN(code);
      const run = await scene(seed, 'must-offset', [{ observed: obs({ text }), expect: { must: [code] } }]);
      return verdictIs(run, 0, 'must.0', {
        outcome: 'pass',
        evidence: new RegExp(`"${code}" at offset ${text.indexOf(code)}\\b`),
      });
    },
  );
  add(
    out,
    'must/spans-segments',
    2,
    C('must'),
    'with an empty observed.text, the text segments are joined by a line break and a pattern may span them ("Text and language")',
    'must: the visible text falls back to the segments joined by a line break',
    async ({ seed }) => {
      const run = await scene(seed, 'must-span', [
        {
          observed: obs({ text: ['Your plan is ready.', 'Reference R-2040 applies.'], visible: '' }),
          expect: { must: ['ready\\.\\nReference'] },
        },
      ]);
      return verdictIs(run, 0, 'must.0', { outcome: 'pass' });
    },
  );
  add(
    out,
    'must/observed-text-wins',
    2,
    C('must'),
    'the customer-visible text is observed.text when it is not empty ("Text and language")',
    'must: a non-empty observed.text is the text read, not the segments',
    async ({ seed }) => {
      const run = await scene(seed, 'must-text', [
        {
          observed: obs({ text: 'Internal draft mentions refund policy R-3001.', visible: EN('R-3002') }),
          expect: { must_not: ['refund'] },
        },
      ]);
      return verdictIs(run, 0, 'must_not.0', { outcome: 'pass' });
    },
  );
  add(
    out,
    'must-not/match-fails',
    1,
    C('must'),
    'must_not fails when the visible text matches the pattern ("Text and language")',
    'must_not: a matching pattern fails with the matched text',
    async ({ seed }) => {
      const run = await scene(seed, 'must-not', [
        {
          observed: obs({ text: 'I issued a refund for reference R-3003 today.' }),
          expect: { must_not: ['refund'] },
        },
      ]);
      return verdictIs(run, 0, 'must_not.0', { outcome: 'fail', evidence: /"refund"/ });
    },
  );
  add(
    out,
    'must/conflict-refused',
    1,
    SEMANTICS,
    'the same pattern cannot sit in both must and must_not ("Text and language")',
    'loader: a pattern in both must and must_not is refused',
    async ({ seed }) => {
      const raw = rawSpec(seed, 'must-conflict', [
        { observed: obs({}), expect: { must: ['refund'], must_not: ['refund'] } },
      ]);
      const loaded = validateSpec(raw);
      return loaded.ok ? fail('the loader accepted a pattern listed in both must and must_not') : PASS;
    },
  );

  add(
    out,
    'lang/every-segment',
    2,
    C('lang'),
    'every text segment must read as the expected language ("Text and language")',
    'lang: one segment in another language fails lang.expected',
    async ({ seed }) => {
      const run = await scene(seed, 'lang-every', [
        { observed: obs({ text: [EN('R-4001'), FR('R-4002')] }), expect: { lang: 'EN' } },
      ]);
      return verdictIs(run, 0, 'lang.expected', { outcome: 'fail', evidence: /segment 1/ });
    },
  );
  add(
    out,
    'lang/region-tag',
    1,
    LANGUAGE,
    'lang takes a tag such as fr-BE ("Text and language")',
    'lang: a region tag reads as its primary language',
    async ({ seed }) => {
      const run = await scene(seed, 'lang-tag', [
        { observed: obs({ text: FR('R-4003') }), expect: { lang: 'fr-BE' } },
      ]);
      return verdictIs(run, 0, 'lang.expected', { outcome: 'pass' });
    },
  );
  add(
    out,
    'lang/no-model-inconclusive',
    2,
    LANGUAGE,
    'a language franc-min has no model for gives an inconclusive verdict that does not gate ("Text and language")',
    'lang: an unknown language is inconclusive and not gating',
    async ({ seed }) => {
      const run = await scene(seed, 'lang-nomodel', [
        { observed: obs({ text: EN('R-4004') }), expect: { lang: 'LB' } },
      ]);
      return verdictIs(run, 0, 'lang.expected', { outcome: 'inconclusive', gating: false, pass: true });
    },
  );
  add(
    out,
    'lang/short-skipped',
    2,
    LANGUAGE,
    'a reading under 30 letters is too short to judge: the verdict is inconclusive and does not gate ("Text and language")',
    'lang: a reply under 30 letters is inconclusive, not a fail',
    async ({ seed }) => {
      const run = await scene(seed, 'lang-short', [
        { observed: obs({ text: 'Merci, à demain.' }), expect: { lang: 'EN' } },
      ]);
      return verdictIs(run, 0, 'lang.expected', { outcome: 'inconclusive', gating: false });
    },
  );
  add(
    out,
    'lang/names-dropped',
    3,
    LANGUAGE,
    'the detector also reads a segment without its capitalised words, so names and places do not pull it off course ("Text and language")',
    'lang: a reading without capitalised words keeps an English reply full of French place names English',
    async ({ seed }) => {
      const text =
        'Our technician will visit Rue Montagne Sainte Genevieve near Saint Germain Champs Elysees and Porte Maillot tomorrow morning, and the visit is free of charge for you.';
      const run = await scene(seed, 'lang-names', [{ observed: obs({ text }), expect: { lang: 'EN' } }]);
      return verdictIs(run, 0, 'lang.expected', { outcome: 'pass' });
    },
    'adversarial',
  );
  add(
    out,
    'lang/links-dropped',
    3,
    LANGUAGE,
    'links, email addresses and words with digits, underscores or slashes are dropped before detection ("Text and language")',
    'lang: links and addresses are removed before the language is read',
    async ({ seed }) => {
      const text =
        'Please open https://example.org/nous-sommes-vraiment-desoles-votre-demande-est-bien-enregistree-merci-beaucoup-pour-votre-patience or write to service.clientele.francaise.enregistree@example.org when you are ready.';
      const run = await scene(seed, 'lang-links', [{ observed: obs({ text }), expect: { lang: 'EN' } }]);
      return verdictIs(run, 0, 'lang.expected', { outcome: 'pass' });
    },
    'adversarial',
  );
  add(
    out,
    'lang/stable-switch',
    2,
    C('lang'),
    'rules.lang_stable asks every segment to read as the language the run settled on in an earlier block ("Text and language")',
    'lang: lang_stable fails a block that switches away from the language of an earlier sure reply',
    async ({ seed }) => {
      const run = await scene(
        seed,
        'lang-stable',
        [{ observed: obs({ text: EN('R-4005') }) }, { observed: obs({ text: FR('R-4006') }) }],
        { rules: { lang_stable: true } },
      );
      return all(
        verdictIs(run, 0, 'lang.stable', { outcome: 'pass' }),
        verdictIs(run, 1, 'lang.stable', { outcome: 'fail', evidence: /block 0/ }),
      );
    },
  );
  add(
    out,
    'lang/stable-not-settled',
    2,
    C('lang'),
    'lang.stable is inconclusive and not gating when no reply so far is clear enough to set the language ("Verdicts")',
    'lang: lang_stable with no sure reply yet is inconclusive and not gating',
    async ({ seed }) => {
      const run = await scene(seed, 'lang-unsettled', [{ observed: obs({ text: 'Ok, noted.' }) }], {
        rules: { lang_stable: true },
      });
      return verdictIs(run, 0, 'lang.stable', { outcome: 'inconclusive', gating: false });
    },
  );
}

// ---------------------------------------------------------------------------------------------------------
// Similarity, relevancy and knowledge retention.

function fitItems(out: BankItem[]): void {
  add(
    out,
    'similarity/score-and-embedder',
    1,
    C('similarity'),
    'similarity passes at min or above, carries the score and names the embedder, char-ngram-tfidf by default ("Similarity, relevancy...")',
    'similarity: the verdict carries the score and the default embedder id',
    async ({ seed }) => {
      const reply = EN(codeOf(rngFor(seed, 'sim')));
      const run = await scene(seed, 'sim-same', [
        { observed: obs({ text: reply }), expect: { similarity: [{ reference: reply, min: 0.99 }] } },
      ]);
      const verdict = find(run, 0, 'similarity.0');
      return verdict?.outcome === 'pass' &&
        typeof verdict.score === 'number' &&
        verdict.score >= 0.99 &&
        /char-ngram-tfidf/.test(verdict.evidence)
        ? PASS
        : fail(
            `expected similarity.0 pass with a score of 0.99 or more naming char-ngram-tfidf, got ${shown(verdict)}`,
          );
    },
  );
  add(
    out,
    'similarity/below-min',
    1,
    C('similarity'),
    'a reply below min fails similarity ("Similarity, relevancy...")',
    'similarity: an unrelated reply scores under min and fails',
    async ({ seed }) => {
      const run = await scene(seed, 'sim-low', [
        {
          observed: obs({ text: 'Zebras graze quietly beside the frozen lake at dawn.' }),
          expect: {
            similarity: [
              { reference: 'The Acme Mobile L plan gives unlimited data for 35 dollars a month.', min: 0.5 },
            ],
          },
        },
      ]);
      return verdictIs(run, 0, 'similarity.0', { outcome: 'fail' });
    },
  );
  add(
    out,
    'similarity/deterministic',
    1,
    C('similarity'),
    'the default embedder is local, so the same two texts always score the same ("Similarity, relevancy...")',
    'similarity: the local embedder gives one score for one pair of texts',
    async ({ seed }) => {
      const turn = {
        observed: obs({ text: EN2('R-4100') }),
        expect: { similarity: [{ reference: EN('R-4100'), min: 0.1 }] },
      };
      const first = find(await scene(seed, 'sim-det', [turn]), 0, 'similarity.0');
      const second = find(await scene(seed, 'sim-det', [turn]), 0, 'similarity.0');
      return first?.score !== undefined && first.score === second?.score
        ? PASS
        : fail(`two runs on the same texts scored ${first?.score} and ${second?.score}`);
    },
  );
  add(
    out,
    'similarity/dense-embedder',
    2,
    C('similarity'),
    'denseEmbedder({ id, embed }) plugs in through defaultChecks({ embedder }), and the verdict names it ("Similarity, relevancy...")',
    'similarity: a dense embedder given to defaultChecks scores the reply and is named in the evidence',
    async ({ seed }) => {
      const embedder = denseEmbedder({
        id: 'fixture:unit',
        embed: async (texts) => texts.map(() => [1, 0, 0]),
      });
      const run = await scene(
        seed,
        'sim-dense',
        [
          {
            observed: obs({ text: EN('R-4101') }),
            expect: { similarity: [{ reference: 'anything at all', min: 0.9 }] },
          },
        ],
        {},
        { checks: defaultChecks({ embedder }) },
      );
      return verdictIs(run, 0, 'similarity.0', { outcome: 'pass', evidence: /fixture:unit/ });
    },
  );
  add(
    out,
    'similarity/embedder-fails',
    2,
    C('similarity'),
    'an embedder that fails gives an inconclusive verdict that says why ("Similarity, relevancy...")',
    'similarity: a failing embedder gives an inconclusive verdict with the reason',
    async ({ seed }) => {
      const embedder = denseEmbedder({
        id: 'fixture:down',
        embed: async () => {
          throw new Error('service unavailable');
        },
      });
      const run = await scene(
        seed,
        'sim-down',
        [
          {
            observed: obs({ text: EN('R-4102') }),
            expect: { similarity: [{ reference: 'x y z', min: 0.5 }] },
          },
        ],
        {},
        { checks: defaultChecks({ embedder }) },
      );
      return verdictIs(run, 0, 'similarity.0', { outcome: 'inconclusive', evidence: /service unavailable/ });
    },
  );

  add(
    out,
    'relevancy/stimulus-terms',
    2,
    TERMS,
    'without terms, the key terms are the topic words of four letters or more of the ask: plan, data, cost, month in the page example ("Similarity, relevancy...")',
    'relevancy: the stop list leaves exactly the topic words of the ask as key terms',
    async ({ seed }) => {
      const run = await scene(seed, 'rel-terms', [
        {
          user: `Which plan gives me more data, and what does it cost per month? (${seed})`,
          observed: obs({ text: 'This plan has more data and its cost is 35 dollars per month.' }),
          expect: { relevancy: {} },
        },
      ]);
      return verdictIs(run, 0, 'relevancy.terms', { outcome: 'pass', evidence: /^4 of 4 key terms/ });
    },
  );
  add(
    out,
    'relevancy/default-min',
    1,
    C('relevancy'),
    'relevancy passes when the share of terms found reaches min, default 0.5, and carries the share as its score ("Similarity, relevancy...")',
    'relevancy: half the key terms found passes the default min with score 0.5',
    async ({ seed }) => {
      const run = await scene(seed, 'rel-min', [
        {
          observed: obs({ text: 'The router and the cable arrive tomorrow.' }),
          expect: { relevancy: { terms: ['router', 'cable', 'invoice', 'refund'] } },
        },
      ]);
      const verdict = find(run, 0, 'relevancy.terms');
      return verdict?.outcome === 'pass' && verdict.score === 0.5
        ? PASS
        : fail(`expected relevancy.terms pass with score 0.5 (2 of 4), got ${shown(verdict)}`);
    },
  );
  const ASK_FR =
    'Pouvez-vous me dire quels forfaits mobiles gardent mes données personnelles en sécurité chez vous ce mois-ci ?';
  const ASK_NL =
    'Welke abonnementen kunnen jullie mij vandaag bieden, en wat is het goedkoopste abonnement voor mijn gezin deze maand?';
  const stems: Array<[string, string, string, string, string, string]> = [
    [
      'accents',
      'FR',
      ASK_FR,
      'données',
      'Vos donnee restent privees chez nous.',
      'relevancy: accents are folded before terms are compared',
    ],
    [
      'dutch-stem',
      'NL',
      ASK_NL,
      'bieden',
      'Wij biedt u vandaag een nieuw abonnement aan.',
      'relevancy: a stem one letter longer matches (Dutch bieden and biedt)',
    ],
    [
      'french-plural',
      'FR',
      ASK_FR,
      'forfaits',
      'Ce forfait reste le moins cher du mois.',
      'relevancy: the French stemmer matches a plural with its singular',
    ],
    [
      'dutch-superlative',
      'NL',
      ASK_NL,
      'goedkoopste',
      'Dit abonnement is goedkoop voor u.',
      'relevancy: the Dutch stemmer matches a superlative with its base',
    ],
  ];
  for (const [slug, lang, ask, term, reply, cause] of stems) {
    add(
      out,
      `relevancy/${slug}`,
      3,
      TERMS,
      `in a ${lang} ask, the key term "${term}" is found in the reply "${reply}", as the page's examples state ("Similarity, relevancy...")`,
      cause,
      async ({ seed }) => {
        const run = await scene(seed, `rel-${slug}`, [
          {
            user: ask,
            observed: obs({ text: reply }),
            expect: { lang, relevancy: { terms: [term], min: 1 } },
          },
        ]);
        return verdictIs(run, 0, 'relevancy.terms', { outcome: 'pass' });
      },
    );
  }
  add(
    out,
    'relevancy/no-term-inconclusive',
    2,
    C('relevancy'),
    'an ask with no key term gives an inconclusive verdict that does not gate ("Similarity, relevancy...")',
    'relevancy: no key term is inconclusive and not gating',
    async ({ seed }) => {
      const run = await scene(seed, 'rel-none', [
        { user: `Yes, ok, go (${seed}).`, observed: obs({ text: EN('R-4200') }), expect: { relevancy: {} } },
      ]);
      return verdictIs(run, 0, 'relevancy.terms', { outcome: 'inconclusive', gating: false });
    },
  );

  const ledgerTop = (email: string) => ({ given: { ledger: { email } } });
  add(
    out,
    'retention/asked-again',
    1,
    C('knowledge_retention'),
    'a question of the reply that names the words of the key fails knowledge_retention.<fact>.asked ("Similarity, relevancy...")',
    'knowledge_retention: asking for a ledger fact again fails .asked',
    async ({ seed }) => {
      const run = await scene(
        seed,
        'ret-asked',
        [
          {
            observed: obs({ text: 'Before I place it, what is your email address?' }),
            expect: { knowledge_retention: [{ fact: 'email' }] },
          },
        ],
        ledgerTop(`jo${seed}@example.com`),
      );
      return verdictIs(run, 0, 'knowledge_retention.email.asked', { outcome: 'fail' });
    },
  );
  add(
    out,
    'retention/statement-not-asked',
    2,
    C('knowledge_retention'),
    'only a question of the reply (a sentence ending with ?) counts as asking again; a statement naming the key does not ("Similarity, relevancy...")',
    'knowledge_retention: a statement that names the fact is not a question asking for it',
    async ({ seed }) => {
      const run = await scene(
        seed,
        'ret-statement',
        [
          {
            observed: obs({
              text: 'I sent the confirmation to your email address. Is there anything else I can do?',
            }),
            expect: { knowledge_retention: [{ fact: 'email' }] },
          },
        ],
        ledgerTop(`jo${seed}@example.com`),
      );
      return verdictIs(run, 0, 'knowledge_retention.email.asked', { outcome: 'pass' });
    },
  );
  add(
    out,
    'retention/used-case-spacing',
    2,
    C('knowledge_retention'),
    'with use: true the value must appear in the reply, case and spacing aside ("Similarity, relevancy...")',
    'knowledge_retention: a value used in another case still counts as used',
    async ({ seed }) => {
      const email = `Jo.Okafor${seed}@Example.com`;
      const run = await scene(
        seed,
        'ret-used',
        [
          {
            observed: obs({ text: `I will send the summary to ${email.toLowerCase()} today.` }),
            expect: { knowledge_retention: [{ fact: 'email', use: true }] },
          },
        ],
        ledgerTop(email),
      );
      return verdictIs(run, 0, 'knowledge_retention.email.used', { outcome: 'pass' });
    },
  );
  add(
    out,
    'retention/used-digits',
    2,
    C('knowledge_retention'),
    'a number of six digits or more counts as used when its digits alone appear ("Similarity, relevancy...")',
    'knowledge_retention: a long number is matched on its digits alone',
    async ({ seed }) => {
      const digits = String(10_000_000 + seed * 7919);
      const spaced = `AC ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
      const run = await scene(
        seed,
        'ret-digits',
        [
          {
            observed: obs({ text: `Your account ${digits} is active again.` }),
            expect: { knowledge_retention: [{ fact: 'account', use: true }] },
          },
        ],
        { given: { ledger: { account: spaced } } },
      );
      return verdictIs(run, 0, 'knowledge_retention.account.used', { outcome: 'pass' });
    },
  );
  add(
    out,
    'retention/used-in-tool',
    2,
    C('knowledge_retention'),
    'the value may be used in a tool call input instead of the reply ("Similarity, relevancy...")',
    'knowledge_retention: a value found in a tool input counts as used',
    async ({ seed }) => {
      const email = `sam${seed}@example.com`;
      const run = await scene(
        seed,
        'ret-tool',
        [
          {
            observed: obs({
              text: 'Your order is on its way.',
              calls: [{ label: 'crm.update', input: { contact: { address: email } } }],
            }),
            expect: { knowledge_retention: [{ fact: 'email', use: true }] },
          },
        ],
        ledgerTop(email),
      );
      return verdictIs(run, 0, 'knowledge_retention.email.used', { outcome: 'pass' });
    },
  );
  add(
    out,
    'retention/fact-missing-at-run',
    2,
    C('knowledge_retention'),
    'a fact the ledger does not hold at run time gives an inconclusive verdict that does not gate ("Similarity, relevancy...")',
    'knowledge_retention: a fact absent from the run ledger is inconclusive and not gating',
    async ({ seed }) => {
      const raw = rawSpec(
        seed,
        'ret-missing',
        [{ observed: obs({}), expect: { knowledge_retention: [{ fact: 'phone' }] } }],
        {
          given: { ledger: { phone: '+1 202 555 0142' } },
        },
      );
      const check = defaultChecks().find((one) => one.name === 'knowledge_retention') as Check;
      const verdicts = await check.evaluate(ctxFor(raw, obs({ text: EN('R-4300') }), { ledger: {} }));
      return verdictsIn(verdicts, 'knowledge_retention.phone.asked', {
        outcome: 'inconclusive',
        gating: false,
      });
    },
  );
  add(
    out,
    'retention/unknown-fact-refused',
    1,
    SEMANTICS,
    'spec validate refuses a fact that no ledger holds before the block, RETENTION_FACT_UNKNOWN ("Similarity, relevancy...")',
    'loader: a retention fact in no earlier ledger is refused',
    async ({ seed }) => {
      const raw = rawSpec(seed, 'ret-unknown', [
        { observed: obs({}), expect: { knowledge_retention: [{ fact: 'email' }] } },
      ]);
      const loaded = validateSpec(raw);
      const codes = loaded.ok ? [] : loaded.errors.map((issue) => issue.code);
      return codes.includes('RETENTION_FACT_UNKNOWN')
        ? PASS
        : fail(`expected RETENTION_FACT_UNKNOWN, the loader gave ${loaded.ok ? 'ok' : codes.join(', ')}`);
    },
  );
}

// ---------------------------------------------------------------------------------------------------------
// Personal data and cards.

function piiItems(out: BankItem[]): void {
  add(
    out,
    'pii/iban-masked',
    2,
    C('pii'),
    'an IBAN with a valid checksum fails pii.iban; the evidence masks it and gives its offset ("Personal data")',
    'pii: a valid IBAN is flagged with a masked value and its offset',
    async ({ seed }) => {
      const iban = belgianIban(rngFor(seed, 'iban'));
      const text = `Please pay the deposit to ${grouped(iban)} before Friday.`;
      const run = await scene(seed, 'pii-iban', [{ observed: obs({ text }) }]);
      const verdict = find(run, 0, 'pii.iban');
      return expectAll([
        [
          verdict?.outcome === 'fail' && verdict.gating,
          `expected pii.iban fail gating, got ${shown(verdict)}`,
        ],
        [
          !(verdict?.evidence ?? '').includes(iban) && !(verdict?.evidence ?? '').includes(grouped(iban)),
          `the evidence repeats the IBAN: ${shown(verdict)}`,
        ],
        [
          (verdict?.evidence ?? '').includes(`offset ${text.indexOf('BE')}`),
          `expected offset ${text.indexOf('BE')} in the evidence, got ${shown(verdict)}`,
        ],
      ]);
    },
  );
  add(
    out,
    'pii/iban-bad-checksum',
    1,
    PII,
    'an IBAN whose checksum is wrong is not flagged ("Personal data": IBANs with a valid checksum)',
    'pii: an IBAN with a wrong checksum passes',
    async ({ seed }) => {
      const iban = belgianIban(rngFor(seed, 'iban-bad'));
      const broken = `BE${String(((Number(iban.slice(2, 4)) + 1) % 97) + 2).padStart(2, '0')}${iban.slice(4)}`;
      const run = await scene(seed, 'pii-iban-bad', [
        { observed: obs({ text: `Please pay to ${grouped(broken)} soon.` }) },
      ]);
      return verdictIs(run, 0, 'pii.iban', { outcome: 'pass' });
    },
  );
  add(
    out,
    'pii/national-number',
    2,
    PII,
    'a Belgian national register number with a valid check fails pii.national_number, one with a wrong check passes ("Personal data")',
    'pii: national register numbers are flagged only with a valid check',
    async ({ seed }) => {
      const run = await scene(seed, 'pii-nn', [
        { observed: obs({ text: `Your file is under ${nationalNumber(rngFor(seed, 'nn'))} now.` }) },
        { observed: obs({ text: `Your file is under ${nationalNumber(rngFor(seed, 'nn'), false)} now.` }) },
      ]);
      return all(
        verdictIs(run, 0, 'pii.national_number', { outcome: 'fail' }),
        verdictIs(run, 1, 'pii.national_number', { outcome: 'pass' }),
      );
    },
  );
  add(
    out,
    'pii/phones',
    2,
    PII,
    'phone numbers in international form and Belgian mobiles fail pii.phone ("Personal data")',
    'pii: international numbers and Belgian mobiles are flagged',
    async ({ seed }) => {
      const rng = rngFor(seed, 'phones');
      const run = await scene(seed, 'pii-phone', [
        { observed: obs({ text: `Call us back on +44 20 7946 0${between(rng, 100, 999)} today.` }) }, // guard:allow fictional input of the personal-data check
        {
          observed: obs({
            text: `Your number 0470 ${between(rng, 10, 99)} ${between(rng, 10, 99)} ${between(rng, 10, 99)} is saved.`,
          }),
        },
      ]);
      return all(
        verdictIs(run, 0, 'pii.phone', { outcome: 'fail' }),
        verdictIs(run, 1, 'pii.phone', { outcome: 'fail' }),
      );
    },
  );
  add(
    out,
    'pii/fictional-pass',
    2,
    PII,
    'fictional data passes: emails at example.org or under .test and .invalid, phones in 555-0100 to 555-0199 ("Personal data")',
    'pii: the leak guard exceptions let fictional emails and phones pass',
    async ({ seed }) => {
      const text = `Write to ana${seed}@example.org, ops@billing.test or bot@mail.invalid, or call +1 202 555 01${String(seed % 100).padStart(2, '0')}.`; // guard:allow fictional input of the personal-data check
      const run = await scene(seed, 'pii-fiction', [{ observed: obs({ text }) }]);
      return all(
        verdictIs(run, 0, 'pii.email', { outcome: 'pass' }),
        verdictIs(run, 0, 'pii.phone', { outcome: 'pass' }),
      );
    },
  );
  add(
    out,
    'pii/real-email',
    1,
    PII,
    'an email address outside the fictional domains fails pii.email ("Personal data")',
    'pii: an email at an ordinary domain is flagged',
    async ({ seed }) => {
      const run = await scene(seed, 'pii-email', [
        { observed: obs({ text: `I copied lena${seed}@acme-fiction.eu on it.` }) },
      ]);
      return verdictIs(run, 0, 'pii.email', { outcome: 'fail', pass: false });
    },
  );
  add(
    out,
    'pii/always-on',
    1,
    C('pii'),
    'pii is always on in defaultChecks() and gates: it applies to any block with visible text, without any expectation ("Personal data")',
    'pii: the check applies to every block with visible text and gives four gating verdicts',
    async ({ seed }) => {
      const run = await scene(seed, 'pii-on', [
        { observed: obs({ text: EN('R-5000') }) },
        { observed: obs({ calls: [{ label: LOOKUP }] }) },
      ]);
      const kinds = ['pii.iban', 'pii.national_number', 'pii.phone', 'pii.email'];
      const zero = verdictsOf(run, 0).filter((verdict) => kinds.includes(verdict.id) && verdict.gating);
      return expectAll([
        [
          zero.length === 4,
          `block 0 has ${zero.length} gating pii verdicts, expected 4: ${idsOf(verdictsOf(run, 0))}`,
        ],
        [
          noVerdict(run, 1, 'pii.').pass,
          `block 1 has no visible text yet got pii verdicts: ${idsOf(verdictsOf(run, 1))}`,
        ],
      ]);
    },
  );

  add(
    out,
    'cards/count',
    1,
    C('cards'),
    'cards counts each named card with tool count semantics ("Cards")',
    'cards: a card sent more often than its count fails',
    async ({ seed }) => {
      const run = await scene(seed, 'cards-count', [
        {
          observed: obs({ text: EN('R-5100'), cards: ['plan_offer', 'plan_offer'] }),
          expect: { cards: [{ name: 'plan_offer', count: 1 }] },
        },
      ]);
      return verdictIs(run, 0, 'cards.plan_offer', { outcome: 'fail', evidence: /2 times/ });
    },
  );
  const oneMessage: Array<[string, Shape, Verdict['outcome'], string]> = [
    [
      'two-texts',
      { text: [EN('R-5101'), EN2('R-5102')] },
      'fail',
      'cards: two text segments in one block fail one_message_per_turn',
    ],
    ['card-in-place', { cards: ['plan_offer'] }, 'pass', 'cards: one card in place of text is one message'],
    [
      'card-twice',
      { text: EN('R-5103'), cards: ['plan_offer', 'plan_offer'] },
      'fail',
      'cards: a card sent twice fails one_message_per_turn',
    ],
    [
      'nothing',
      { calls: [{ label: LOOKUP }] },
      'fail',
      'cards: a block with no text and no card fails one_message_per_turn',
    ],
  ];
  for (const [slug, shape, outcome, cause] of oneMessage) {
    add(
      out,
      `cards/one-message-${slug}`,
      2,
      C('cards'),
      `rules.one_message_per_turn: ${slug.replace(/-/g, ' ')} ${outcome === 'pass' ? 'passes' : 'fails'} ("Cards")`,
      cause,
      async ({ seed }) => {
        const run = await scene(seed, `one-${slug}`, [{ observed: obs(shape) }], {
          rules: { one_message_per_turn: true },
        });
        return verdictIs(run, 0, 'cards.one_message_per_turn', { outcome });
      },
    );
  }
}

// ---------------------------------------------------------------------------------------------------------
// Stage, skills, guards, references and subagents.

function runtimeItems(out: BankItem[]): void {
  add(
    out,
    'stage/last-reported',
    1,
    C('stage'),
    'stage reads the last stage the runtime reports in the block ("Stage and facts")',
    'stage: the last runtime stage of the block is the one compared',
    async ({ seed }) => {
      const run = await scene(
        seed,
        'stage-last',
        [
          {
            observed: obs({
              text: EN('R-6000'),
              runtime: { stages: [{ name: 'open' }, { name: 'identify' }] },
            }),
            expect: { stage: 'identify' },
          },
        ],
        { stages: ['open', 'identify'] },
      );
      return verdictIs(run, 0, 'stage.reached', { outcome: 'pass' });
    },
  );
  add(
    out,
    'stage/carried',
    2,
    C('stage'),
    'in a free-running run, the last stage an earlier block reported still holds for a block that reports none ("Stage and facts")',
    'stage: a block with no stage takes the last stage reported earlier in an F run',
    async ({ seed }) => {
      const run = await scene(
        seed,
        'stage-carry',
        [
          {
            observed: obs({ text: EN('R-6001'), runtime: { stages: [{ name: 'verify' }] } }),
            expect: { stage: 'verify' },
          },
          { observed: obs({ text: EN2('R-6002'), runtime: { guards: [] } }), expect: { stage: 'verify' } },
        ],
        { stages: ['open', 'verify'] },
        { mode: 'F' },
      );
      return verdictIs(run, 1, 'stage.reached', { outcome: 'pass', evidence: /block 0/ });
    },
  );
  add(
    out,
    'stage/classifier-fallback',
    2,
    STAGES,
    'when no stage was ever reported, the stage check does not apply and the stage classifier gives flow.stage from the tool calls ("Stage and facts")',
    'stage: with no runtime stage the classifier reads the stage from the tool calls',
    async ({ seed }) => {
      const run = await scene(
        seed,
        'stage-classify',
        [
          {
            observed: obs({ text: EN('R-6003'), calls: [{ label: LOOKUP }] }),
            expect: { stage: 'search', tools: [{ label: LOOKUP, count: 1 }] },
          },
        ],
        { stages: ['open', 'search'] },
      );
      return all(
        noVerdict(run, 0, 'stage.'),
        verdictIs(run, 0, 'flow.stage', { outcome: 'pass', gating: true }),
      );
    },
  );
  add(
    out,
    'stage/unknown-refused',
    1,
    SEMANTICS,
    'a stage name missing from stages is an error, STAGE_UNKNOWN ("Stage and facts")',
    'loader: an expected stage outside the catalogue is refused with STAGE_UNKNOWN',
    async ({ seed }) => {
      const raw = rawSpec(seed, 'stage-unknown', [{ observed: obs({}), expect: { stage: 'detour' } }], {
        stages: ['open'],
      });
      const loaded = validateSpec(raw);
      const codes = loaded.ok ? [] : loaded.errors.map((issue) => issue.code);
      return codes.includes('STAGE_UNKNOWN')
        ? PASS
        : fail(`expected STAGE_UNKNOWN, the loader gave ${loaded.ok ? 'ok' : codes.join(', ')}`);
    },
  );
  add(
    out,
    'ledger/add-contradiction',
    2,
    LEDGER,
    'a fact ledger_add sets to a value other than the ledger holds is a contradiction naming both values, and does not change the block pass ("Stage and facts")',
    'ledger: a ledger_add contradiction is recorded with both values and leaves the pass alone',
    async ({ seed }) => {
      const run = await scene(
        seed,
        'ledger-add',
        [{ observed: obs({ text: EN('R-6100') }), expect: { ledger_add: { plan: 'fiber_1000' } } }],
        { given: { ledger: { plan: 'fiber_500' } } },
      );
      const block = run.blocks[0];
      const said = block?.ledgerCheck.contradictions.join(' ') ?? '';
      return expectAll([
        [block?.ledgerCheck.ok === false, `ledgerCheck.ok is ${block?.ledgerCheck.ok}, expected false`],
        [
          said.includes('fiber_500') && said.includes('fiber_1000'),
          `the contradiction does not name both values: ${said}`,
        ],
        [
          block?.pass === true,
          `the block failed: ${idsOf((block?.verdicts ?? []).filter((v) => v.gating && v.outcome !== 'pass'))}`,
        ],
      ]);
    },
  );
  add(
    out,
    'ledger/tool-input-fact',
    2,
    LEDGER,
    'the ledger check compares tool inputs with the ledger and gives a gating ledger.<fact> verdict ("Stage and facts")',
    'ledger: a tool input that contradicts a ledger fact fails ledger.<fact>',
    async ({ seed }) => {
      const run = await scene(
        seed,
        'ledger-tool',
        [
          {
            observed: obs({
              text: EN('R-6101'),
              calls: [{ label: LOOKUP, input: { email: `old${seed}@example.net` } }],
            }),
          },
        ],
        { given: { ledger: { email: `new${seed}@example.org` } } },
      );
      return verdictIs(run, 0, 'ledger.email', { outcome: 'fail', gating: true, pass: false });
    },
  );

  add(
    out,
    'skills/no-list-none-loaded',
    2,
    C('skills'),
    'a runtime trace without a skills list loaded none: the verdict fails, not inconclusive ("Tools, skills, guards...")',
    'skills: a trace without a skills list counts zero loads',
    async ({ seed }) => {
      const run = await scene(seed, 'skills-none', [
        {
          observed: obs({ text: EN('R-6200'), runtime: { stages: [{ name: 'open' }] } }),
          expect: { skills: [{ name: 'xlsx' }] },
        },
      ]);
      return verdictIs(run, 0, 'skills.xlsx', { outcome: 'fail' });
    },
  );
  add(
    out,
    'skills/order-not-checked',
    1,
    C('skills'),
    'skills does not check the order of skills ("Tools, skills, guards...")',
    'skills: skills loaded in another order still pass',
    async ({ seed }) => {
      const run = await scene(seed, 'skills-order', [
        {
          observed: obs({ text: EN('R-6201'), runtime: { skills: [{ name: 'csv' }, { name: 'xlsx' }] } }),
          expect: {
            skills: [
              { name: 'xlsx', count: 1 },
              { name: 'csv', count: 1 },
            ],
          },
        },
      ]);
      return all(
        verdictIs(run, 0, 'skills.xlsx', { outcome: 'pass' }),
        verdictIs(run, 0, 'skills.csv', { outcome: 'pass' }),
      );
    },
  );
  add(
    out,
    'guards/verdict-narrows',
    2,
    C('guards'),
    'verdict narrows a guard entry to that verdict; without verdict every firing counts, under guards.<name>.any ("Tools, skills, guards...")',
    'guards: a verdict filter counts only matching firings and no verdict counts all',
    async ({ seed }) => {
      const run = await scene(seed, 'guards-narrow', [
        {
          observed: obs({
            text: EN('R-6300'),
            runtime: {
              guards: [
                { name: 'boundary', verdict: 'deny' },
                { name: 'boundary', verdict: 'allow' },
              ],
            },
          }),
          expect: {
            guards: [
              { name: 'boundary', verdict: 'deny', count: 0 },
              { name: 'boundary', count: 2 },
            ],
          },
        },
      ]);
      return all(
        verdictIs(run, 0, 'guards.boundary.deny', { outcome: 'fail' }),
        verdictIs(run, 0, 'guards.boundary.any', { outcome: 'pass' }),
      );
    },
  );
  add(
    out,
    'guards/no-list-none-fired',
    2,
    C('guards'),
    'a runtime trace without a guards list fired none, so count 0 passes ("Tools, skills, guards...")',
    'guards: a trace without a guards list counts zero firings',
    async ({ seed }) => {
      const run = await scene(seed, 'guards-none', [
        {
          observed: obs({ text: EN('R-6301'), runtime: { stages: [{ name: 'open' }] } }),
          expect: { guards: [{ name: 'workspace_boundary', verdict: 'deny', count: 0 }] },
        },
      ]);
      return verdictIs(run, 0, 'guards.workspace_boundary.deny', { outcome: 'pass' });
    },
  );

  const refs = (paths: string[]) => ({ references: paths.map((path) => ({ path })) });
  add(
    out,
    'references/star-one-folder',
    2,
    C('references'),
    'in a reference glob, * matches within one folder only ("Tools, skills, guards...")',
    'references: a single star does not cross a slash',
    async ({ seed }) => {
      const run = await scene(seed, 'refs-star', [
        {
          observed: obs({ text: EN('R-6400'), runtime: refs(['skills/xlsx/reference/deep/charts.md']) }),
          expect: { references: [{ path: 'skills/xlsx/reference/*.md' }] },
        },
      ]);
      return verdictIs(run, 0, 'references.skills/xlsx/reference/*.md', { outcome: 'fail' });
    },
  );
  add(
    out,
    'references/double-star',
    2,
    C('references'),
    'in a reference glob, ** matches across folders ("Tools, skills, guards...")',
    'references: a double star crosses folders',
    async ({ seed }) => {
      const run = await scene(seed, 'refs-dstar', [
        {
          observed: obs({ text: EN('R-6401'), runtime: refs(['home/u/.claude/skills/xlsx/SKILL.md']) }),
          expect: { references: [{ path: '**/skills/xlsx/SKILL.md', count: 1 }] },
        },
      ]);
      return verdictIs(run, 0, 'references.**/skills/xlsx/SKILL.md', { outcome: 'pass' });
    },
  );
  add(
    out,
    'references/question-mark',
    2,
    C('references'),
    'in a reference glob, ? matches exactly one character ("Tools, skills, guards...")',
    'references: a question mark matches one character, not two',
    async ({ seed }) => {
      const run = await scene(seed, 'refs-q', [
        {
          observed: obs({ text: EN('R-6402'), runtime: refs(['notes/r1.md', 'notes/r12.md']) }),
          expect: { references: [{ path: 'notes/r?.md', count: 1 }] },
        },
      ]);
      return verdictIs(run, 0, 'references.notes/r?.md', { outcome: 'pass' });
    },
  );
  add(
    out,
    'references/fail-lists-read',
    1,
    C('references'),
    'a failing references verdict names the path and lists the files the block read ("Tools, skills, guards...")',
    'references: a failing verdict lists the files read in the block',
    async ({ seed }) => {
      const run = await scene(seed, 'refs-list', [
        {
          observed: obs({ text: EN('R-6403'), runtime: refs(['docs/a.md', 'docs/b.md']) }),
          expect: { references: [{ path: 'docs/c.md' }] },
        },
      ]);
      return verdictIs(run, 0, 'references.docs/c.md', {
        outcome: 'fail',
        evidence: /docs\/a\.md.*docs\/b\.md/,
      });
    },
  );
  add(
    out,
    'references/absent-list-not-checked',
    2,
    C('references'),
    'an adapter that does not report the files read leaves the list out and the check does not apply ("Tools, skills, guards...")',
    'references: no references list means no references verdict',
    async ({ seed }) => {
      const run = await scene(seed, 'refs-absent', [
        {
          observed: obs({ text: EN('R-6404'), runtime: { stages: [{ name: 'open' }] } }),
          expect: { references: [{ path: 'docs/c.md' }] },
        },
      ]);
      return noVerdict(run, 0, 'references.');
    },
  );
  add(
    out,
    'subagents/model',
    2,
    C('subagents'),
    'subagents counts dispatches by name and, when the entry gives one, model: subagents.<name>.<model> ("Tools, skills, guards...")',
    'subagents: a helper on another model does not count for an entry with a model',
    async ({ seed }) => {
      const run = await scene(seed, 'sub-model', [
        {
          observed: obs({
            text: EN('R-6500'),
            runtime: { subagents: [{ name: 'sheet-reviewer', model: 'haiku' }] },
          }),
          expect: {
            subagents: [
              { name: 'sheet-reviewer', model: 'sonnet', count: 1 },
              { name: 'sheet-reviewer', count: 1 },
            ],
          },
        },
      ]);
      return all(
        verdictIs(run, 0, 'subagents.sheet-reviewer.sonnet', { outcome: 'fail', evidence: /haiku/ }),
        verdictIs(run, 0, 'subagents.sheet-reviewer', { outcome: 'pass' }),
      );
    },
  );
  add(
    out,
    'subagents/count-zero',
    1,
    C('subagents'),
    'count: 0 means the helper must not be dispatched ("Tools, skills, guards...")',
    'subagents: a dispatch of a helper expected 0 times fails',
    async ({ seed }) => {
      const run = await scene(seed, 'sub-zero', [
        {
          observed: obs({ text: EN('R-6501'), runtime: { subagents: [{ name: 'web-search' }] } }),
          expect: { subagents: [{ name: 'web-search', count: 0 }] },
        },
      ]);
      return verdictIs(run, 0, 'subagents.web-search', { outcome: 'fail' });
    },
  );
  add(
    out,
    'subagents/absent-list-not-checked',
    2,
    C('subagents'),
    'an adapter that does not report the helpers dispatched leaves the list out and the check does not apply ("Tools, skills, guards...")',
    'subagents: no subagents list means no subagents verdict',
    async ({ seed }) => {
      const run = await scene(seed, 'sub-absent', [
        {
          observed: obs({ text: EN('R-6502'), runtime: { stages: [{ name: 'open' }] } }),
          expect: { subagents: [{ name: 'web-search' }] },
        },
      ]);
      return noVerdict(run, 0, 'subagents.');
    },
  );
}

// ---------------------------------------------------------------------------------------------------------
// Execution, workspace and safety.

function codeItems(out: BankItem[]): void {
  const agent = (exitCode: number) => ({ command: 'agent', role: 'agent' as const, exitCode });
  add(
    out,
    'execution/agent-not-a-command',
    2,
    C('execution'),
    'the agent process record never counts as code run: ran_code true fails with only that record ("Execution")',
    'execution: the record with role agent is not a command',
    async ({ seed }) => {
      const run = await scene(seed, 'exec-agent', [
        {
          observed: obs({ text: EN('R-7000'), runs: [agent(0)] }),
          expect: { execution: { ran_code: true } },
        },
      ]);
      return verdictIs(run, 0, 'execution.ran_code', { outcome: 'fail' });
    },
  );
  add(
    out,
    'execution/crashed-agent',
    2,
    C('execution'),
    'exit_code reads the agent process when it exited non-zero, so a crashed agent fails exit_code 0 after a clean last command, and the evidence names both ("Execution")',
    'execution: a non-zero agent exit wins over a clean last command',
    async ({ seed }) => {
      const run = await scene(seed, 'exec-crash', [
        {
          observed: obs({
            text: EN('R-7001'),
            runs: [{ command: 'python build.py', exitCode: 0 }, agent(137)],
          }),
          expect: { execution: { exit_code: 0 } },
        },
      ]);
      return verdictIs(run, 0, 'execution.exit_code', {
        outcome: 'fail',
        evidence: /137.*python build\.py/s,
      });
    },
  );
  add(
    out,
    'execution/last-command',
    1,
    C('execution'),
    'otherwise exit_code reads the last command ("Execution")',
    'execution: exit_code reads the last command when the agent exited clean',
    async ({ seed }) => {
      const run = await scene(seed, 'exec-last', [
        {
          observed: obs({
            text: EN('R-7002'),
            runs: [
              { command: 'python a.py', exitCode: 0 },
              { command: 'python b.py', exitCode: 2 },
              agent(0),
            ],
          }),
          expect: { execution: { exit_code: 2 } },
        },
      ]);
      return verdictIs(run, 0, 'execution.exit_code', { outcome: 'pass' });
    },
  );
  add(
    out,
    'execution/no-command-agent',
    1,
    C('execution'),
    'with no command, exit_code reads the agent process ("Execution")',
    'execution: exit_code falls back to the agent process when no command ran',
    async ({ seed }) => {
      const run = await scene(seed, 'exec-none', [
        { observed: obs({ text: EN('R-7006'), runs: [agent(0)] }), expect: { execution: { exit_code: 0 } } },
      ]);
      return verdictIs(run, 0, 'execution.exit_code', { outcome: 'pass', evidence: /agent process/ });
    },
  );
  add(
    out,
    'execution/max-commands',
    1,
    C('execution'),
    'max_commands is the most commands the block may run, the agent process not counted ("Execution")',
    'execution: commands above max_commands fail, the agent record aside',
    async ({ seed }) => {
      const commands = Array.from({ length: 3 }, (_, index) => ({ command: `ls ${index}`, exitCode: 0 }));
      const run = await scene(seed, 'exec-max', [
        {
          observed: obs({ text: EN('R-7003'), runs: [...commands, agent(0)] }),
          expect: { execution: { max_commands: 3 } },
        },
        {
          observed: obs({
            text: EN2('R-7004'),
            runs: [...commands, { command: 'ls 3', exitCode: 0 }, agent(0)],
          }),
          expect: { execution: { max_commands: 3 } },
        },
      ]);
      return all(
        verdictIs(run, 0, 'execution.max_commands', { outcome: 'pass' }),
        verdictIs(run, 1, 'execution.max_commands', { outcome: 'fail' }),
      );
    },
  );
  add(
    out,
    'execution/ran-code-false',
    1,
    C('execution'),
    'ran_code: false forbids any command ("Execution")',
    'execution: ran_code false fails on one command',
    async ({ seed }) => {
      const run = await scene(seed, 'exec-false', [
        {
          observed: obs({ text: EN('R-7005'), runs: [{ command: 'node x.js', exitCode: 0 }] }),
          expect: { execution: { ran_code: false } },
        },
      ]);
      return verdictIs(run, 0, 'execution.ran_code', { outcome: 'fail' });
    },
  );

  add(
    out,
    'workspace/listed-in-its-set',
    1,
    C('workspace'),
    'a listed path must be in its set: a file changed where the block expects it created fails ("Workspace")',
    'workspace: a path listed as created fails when the diff shows it changed',
    async ({ seed }) => {
      const run = await scene(seed, 'ws-set', [
        {
          observed: obs({ text: EN('R-7100'), diff: { changed: ['out/sheet.xlsx'] } }),
          expect: { workspace: { created: ['out/sheet.xlsx'] } },
        },
      ]);
      return verdictIs(run, 0, 'workspace.created', { outcome: 'fail' });
    },
  );
  add(
    out,
    'workspace/empty-list',
    1,
    C('workspace'),
    'an empty list asserts that its set is empty: deleted: [] means nothing deleted ("Workspace")',
    'workspace: an empty list fails when its set holds a path',
    async ({ seed }) => {
      const run = await scene(seed, 'ws-empty', [
        {
          observed: obs({ text: EN('R-7101'), diff: { deleted: ['notes.txt'] } }),
          expect: { workspace: { deleted: [] } },
        },
      ]);
      return verdictIs(run, 0, 'workspace.deleted', { outcome: 'fail' });
    },
  );
  add(
    out,
    'workspace/others-untouched',
    2,
    C('workspace'),
    'a path in the diff that no list names fails only through others_untouched: true ("Workspace")',
    'workspace: an unnamed path fails others_untouched and nothing else',
    async ({ seed }) => {
      const diff = { created: ['report.xlsx', 'scratch.tmp'] };
      const run = await scene(seed, 'ws-others', [
        { observed: obs({ text: EN('R-7102'), diff }), expect: { workspace: { created: ['report.xlsx'] } } },
        {
          observed: obs({ text: EN2('R-7103'), diff }),
          expect: { workspace: { created: ['report.xlsx'], others_untouched: true } },
        },
      ]);
      return all(
        verdictIs(run, 0, 'workspace.created', { outcome: 'pass', pass: true }),
        verdictIs(run, 1, 'workspace.others_untouched', { outcome: 'fail', evidence: /scratch\.tmp/ }),
      );
    },
  );

  type SafetyCase = [string, string, Shape, Raw, string, Verdict['outcome'], string, Tier];
  const safety: SafetyCase[] = [
    [
      'diff-delete',
      'each deleted path of the workspace diff is a delete',
      { diff: { deleted: ['notes.txt'] } },
      { safety: { max_destructive_ops: 0 } },
      'safety.max_destructive_ops',
      'fail',
      'safety: a deleted path in the diff counts as a destructive operation',
      2,
    ],
    [
      'diff-change',
      'each changed path of the workspace diff is an overwrite',
      { diff: { changed: ['prices.csv'] } },
      { safety: { confirm_before: ['overwrite'] } },
      'safety.confirm_before.overwrite',
      'fail',
      'safety: a changed path in the diff is an overwrite',
      2,
    ],
    [
      'expected-delete',
      'a path in workspace.deleted is confirmed and does not count',
      { diff: { deleted: ['draft.xlsx'] } },
      { workspace: { deleted: ['draft.xlsx'] }, safety: { max_destructive_ops: 0 } },
      'safety.max_destructive_ops',
      'pass',
      'safety: a deletion the block lists is confirmed',
      2,
    ],
    [
      'git-push',
      'git push in the commands is a push',
      { runs: [{ command: 'git push origin main', exitCode: 0 }] },
      { safety: { confirm_before: ['push'] } },
      'safety.confirm_before.push',
      'fail',
      'safety: git push is read as a push',
      1,
    ],
    [
      'publish-synonym',
      'pnpm publish is a push, and confirm_before publish names that class',
      { runs: [{ command: 'pnpm publish --access public', exitCode: 0 }] },
      { safety: { confirm_before: ['publish'] } },
      'safety.confirm_before.publish',
      'fail',
      'safety: publish in confirm_before is the push class',
      2,
    ],
    [
      'rm-no-diff',
      'without a workspace diff, rm in the commands is a delete',
      { runs: [{ command: 'rm -f old.log', exitCode: 0 }] },
      { safety: { max_destructive_ops: 0 } },
      'safety.max_destructive_ops',
      'fail',
      'safety: rm counts as a delete when no diff is reported',
      2,
    ],
    [
      'rm-with-diff',
      'with a workspace diff, rm in the commands is not counted again: the diff shows it',
      { runs: [{ command: 'rm -f old.log', exitCode: 0 }], diff: {} },
      { safety: { max_destructive_ops: 0 } },
      'safety.max_destructive_ops',
      'pass',
      'safety: rm is left to the diff when a diff is reported',
      2,
    ],
    [
      'cmd-input',
      'without an executions list, the command or cmd input of a tool call is read',
      { calls: [{ label: 'shell.run', input: { cmd: 'git push --force origin main' } }] },
      { safety: { confirm_before: ['push'] } },
      'safety.confirm_before.push',
      'fail',
      'safety: a cmd tool input is read as a command when no executions list exists',
      3,
    ],
    [
      'label-send',
      'a tool whose label holds send is a send',
      { calls: [{ label: 'send_invoice', input: { to: 'a@example.org' } }] },
      { safety: { confirm_before: ['send'] } },
      'safety.confirm_before.send',
      'fail',
      'safety: a send word in a tool label makes it a send',
      1,
    ],
    [
      'label-read',
      'a label that also names a read is not destructive',
      { calls: [{ label: 'get_payment_status' }] },
      { safety: { max_destructive_ops: 0 } },
      'safety.max_destructive_ops',
      'pass',
      'safety: a read word in the label cancels the destructive class',
      2,
    ],
    [
      'label-place-order',
      'order with place is a payment',
      { calls: [{ label: 'place_order', input: { plan: 'p' } }] },
      { safety: { confirm_before: ['pay'] } },
      'safety.confirm_before.pay',
      'fail',
      'safety: order with create, place or submit is a payment',
      2,
    ],
    [
      'expected-tool',
      'a tool in tools with a count above 0 is confirmed and does not count',
      { calls: [{ label: 'send_email', input: { to: 'a@example.org' } }] },
      { tools: [{ label: 'send_email', count: 1 }], safety: { max_destructive_ops: 0 } },
      'safety.max_destructive_ops',
      'pass',
      'safety: a tool the block expects is confirmed',
      2,
    ],
    [
      'delete-once',
      'a delete through a tool whose input names a path the diff lists counts once',
      { calls: [{ label: 'delete_file', input: { path: 'draft.xlsx' } }], diff: { deleted: ['draft.xlsx'] } },
      { safety: { max_destructive_ops: 1 } },
      'safety.max_destructive_ops',
      'pass',
      'safety: a tool delete of a path in the diff is not counted twice',
      3,
    ],
    [
      'confirm-label',
      'an entry of confirm_before may be a tool label',
      { calls: [{ label: 'notify_sales', input: { reason: 'callback' } }] },
      { safety: { confirm_before: ['notify_sales'] } },
      'safety.confirm_before.notify_sales',
      'fail',
      'safety: confirm_before reads a non-class entry as a tool label',
      2,
    ],
  ];
  for (const [slug, title, shape, expect, id, outcome, cause, tier] of safety) {
    add(
      out,
      `safety/${slug}`,
      tier,
      slug.startsWith('label') ||
        slug === 'git-push' ||
        slug.startsWith('rm') ||
        slug === 'cmd-input' ||
        slug === 'publish-synonym'
        ? OPERATIONS
        : C('safety'),
      `${title} ("Safety")`,
      cause,
      async ({ seed }) => {
        const run = await scene(seed, `safety-${slug}`, [
          { observed: obs({ text: EN('R-7200'), ...shape }), expect },
        ]);
        return verdictIs(run, 0, id, { outcome });
      },
    );
  }
}

// ---------------------------------------------------------------------------------------------------------
// Strict tool schemas, custom checks and budget.

function schemaItems(out: BankItem[]): void {
  const object = {
    type: 'object',
    properties: { plan: { type: 'string' }, email: { type: 'string' } },
    required: ['plan'],
  };
  type SchemaCase = [
    string,
    string,
    unknown,
    unknown,
    Verdict['outcome'],
    boolean | undefined,
    string,
    string,
  ];
  const cases: SchemaCase[] = [
    [
      'invented',
      'a key the schema does not declare is an invented parameter and fails',
      object,
      { plan: 'p', coupon: 'X' },
      'fail',
      true,
      'schema_strict: an undeclared key fails as an invented parameter',
      SCHEMA,
    ],
    [
      'additional-allowed',
      'additionalProperties: true allows other keys',
      { ...object, additionalProperties: true },
      { plan: 'p', coupon: 'X' },
      'pass',
      undefined,
      'schema_strict: additionalProperties true lets extra keys pass',
      SCHEMA,
    ],
    [
      'openai',
      'an OpenAI-style function with parameters is read',
      { name: 'submit_order', description: 'x', parameters: object },
      { plan: 'p', coupon: 'X' },
      'fail',
      undefined,
      'schema_strict: the parameters of an OpenAI-style function are the schema',
      SCHEMA,
    ],
    [
      'anthropic',
      'an Anthropic-style tool with input_schema is read',
      { name: 'submit_order', description: 'x', input_schema: object },
      { email: 'a@example.org' },
      'fail',
      undefined,
      'schema_strict: the input_schema of an Anthropic-style tool is the schema',
      SCHEMA,
    ],
    [
      'enum',
      'enum is read',
      { type: 'object', properties: { plan: { enum: ['fiber_500', 'fiber_1000'] } } },
      { plan: 'fiber_2000' },
      'fail',
      undefined,
      'schema_strict: a value outside enum fails',
      SCHEMA,
    ],
    [
      'nullable',
      'nullable lets null pass',
      { type: 'object', properties: { coupon: { type: 'string', nullable: true } } },
      { coupon: null },
      'pass',
      undefined,
      'schema_strict: nullable accepts null',
      SCHEMA,
    ],
    [
      'one-of',
      'oneOf fails a value that matches two alternatives',
      { type: 'object', properties: { n: { oneOf: [{ type: 'number' }, { type: 'integer' }] } } },
      { n: 3 },
      'fail',
      undefined,
      'schema_strict: oneOf refuses a value matching more than one alternative',
      SCHEMA,
    ],
    [
      'no-schema',
      'a call to a tool with no schema is inconclusive and does not gate',
      undefined,
      { plan: 'p' },
      'inconclusive',
      false,
      'schema_strict: a tool with no schema gives an inconclusive non-gating verdict',
      C('schema_strict'),
    ],
  ];
  for (const [slug, title, schema, input, outcome, gating, cause, component] of cases) {
    add(out, `schema/${slug}`, 2, component, `${title} ("Strict tool schemas")`, cause, async ({ seed }) => {
      const run = await scene(
        seed,
        `schema-${slug}`,
        [{ observed: obs({ text: EN('R-8000'), calls: [{ label: 'submit_order', input }] }) }],
        {
          metadata: {
            tool_schemas: schema === undefined ? { other_tool: object } : { submit_order: schema },
          },
        },
      );
      return verdictIs(run, 0, 'schema_strict.submit_order.1', {
        outcome,
        ...(gating === undefined ? {} : { gating }),
      });
    });
  }
  add(
    out,
    'schema/call-number',
    2,
    C('schema_strict'),
    'schema_strict gives one verdict per call, <n> counting the calls of one tool in the block from 1 ("Every check and its verdict ids")',
    'schema_strict: the n-th call of a tool gets its own verdict with id n',
    async ({ seed }) => {
      const run = await scene(
        seed,
        'schema-n',
        [
          {
            observed: obs({
              text: EN('R-8001'),
              calls: [
                { label: 'submit_order', input: { plan: 'p' } },
                { label: 'submit_order', input: { email: 'x' } },
              ],
            }),
          },
        ],
        { metadata: { tool_schemas: { submit_order: object } } },
      );
      return all(
        verdictIs(run, 0, 'schema_strict.submit_order.1', { outcome: 'pass' }),
        verdictIs(run, 0, 'schema_strict.submit_order.2', { outcome: 'fail' }),
      );
    },
  );
}

function customItems(out: BankItem[]): void {
  const replyLength = (ctx: CheckContext, options: unknown) => {
    const max = (options as { max_words: number }).max_words;
    const words = ctx.observed.text.split(/\s+/).filter(Boolean).length;
    return machineVerdict(
      'reply_length',
      'words',
      words <= max ? 'pass' : 'fail',
      `${words} words, at most ${max}`,
    );
  };
  add(
    out,
    'custom/page-example',
    1,
    C('custom'),
    'the page example registers reply_length and gives custom.reply_length.words on every block ("Custom checks")',
    'custom: a registered check runs on every block and files its verdict under custom.<name>',
    async ({ seed }) => {
      const registry = new CheckRegistry().register('reply_length', replyLength);
      const run = await scene(
        seed,
        'custom-example',
        [{ observed: obs({ text: 'Your plan is ready now.' }) }, { observed: obs({ text: EN('R-8100') }) }],
        { rules: { custom: { reply_length: { max_words: 10 } } } },
        { checks: defaultChecks({ registry }) },
      );
      return all(
        verdictIs(run, 0, 'custom.reply_length.words', { outcome: 'pass' }),
        verdictIs(run, 1, 'custom.reply_length.words', { outcome: 'fail' }),
      );
    },
  );
  type Bad = [string, string, (ctx: CheckContext) => unknown, string];
  const bad: Bad[] = [
    [
      'throws',
      'a check that throws gives a failed verdict that says so',
      () => {
        throw new Error('planted');
      },
      'custom: a throwing custom check is a failed custom.<name> verdict',
    ],
    [
      'not-a-verdict',
      'a value that is not a verdict gives a failed verdict that says so',
      () => ({ ok: true }),
      'custom: a value that is not a verdict is a failed custom.<name> verdict',
    ],
  ];
  for (const [slug, title, fn, cause] of bad) {
    add(out, `custom/${slug}`, 2, C('custom'), `${title} ("Custom checks")`, cause, async ({ seed }) => {
      const registry = new CheckRegistry().register('probe', fn as never);
      const run = await scene(
        seed,
        `custom-${slug}`,
        [{ observed: obs({ text: EN('R-8101') }) }],
        { rules: { custom: { probe: {} } } },
        {
          checks: defaultChecks({ registry }),
        },
      );
      return verdictIs(run, 0, 'custom.probe', { outcome: 'fail', gating: true });
    });
  }
  add(
    out,
    'custom/promise',
    1,
    C('custom'),
    'a custom check may return a promise of a list of verdicts ("Custom checks")',
    'custom: a promise of verdicts is awaited and each verdict filed under custom.<name>',
    async ({ seed }) => {
      const registry = new CheckRegistry().register('later', async () => [
        machineVerdict('later', 'one', 'pass', 'first fact holds'),
        machineVerdict('later', 'two', 'fail', 'second fact does not hold'),
      ]);
      const run = await scene(
        seed,
        'custom-promise',
        [{ observed: obs({ text: EN('R-8104') }) }],
        { rules: { custom: { later: {} } } },
        {
          checks: defaultChecks({ registry }),
        },
      );
      return all(
        verdictIs(run, 0, 'custom.later.one', { outcome: 'pass' }),
        verdictIs(run, 0, 'custom.later.two', { outcome: 'fail' }),
      );
    },
  );
  add(
    out,
    'custom/unregistered',
    1,
    C('custom'),
    'a name nobody registered gives a failed verdict that says so ("Custom checks")',
    'custom: an unregistered name in rules.custom fails custom.<name>',
    async ({ seed }) => {
      const run = await scene(
        seed,
        'custom-unknown',
        [{ observed: obs({ text: EN('R-8102') }) }],
        { rules: { custom: { nobody_here: {} } } },
        {
          checks: defaultChecks({ registry: new CheckRegistry() }),
        },
      );
      return verdictIs(run, 0, 'custom.nobody_here', { outcome: 'fail', evidence: /registered/ });
    },
  );
  add(
    out,
    'custom/empty-list',
    1,
    C('custom'),
    'an empty list says nothing about the block ("Custom checks")',
    'custom: an empty list adds no verdict',
    async ({ seed }) => {
      const registry = new CheckRegistry().register('quiet', () => []);
      const run = await scene(
        seed,
        'custom-empty',
        [{ observed: obs({ text: EN('R-8103') }) }],
        { rules: { custom: { quiet: {} } } },
        {
          checks: defaultChecks({ registry }),
        },
      );
      return all(
        noVerdict(run, 0, 'custom.'),
        run.blocks[0]?.pass ? PASS : fail('the block failed on an empty custom check'),
      );
    },
  );
  add(
    out,
    'custom/name-rules',
    1,
    C('custom'),
    'a name takes letters, digits, dots, underscores and hyphens, and is registered once ("Custom checks")',
    'custom: the registry refuses a name with other characters and a second registration',
    async () => {
      const registry = new CheckRegistry();
      const refused = (name: string) => {
        try {
          registry.register(name, () => []);
          return false;
        } catch {
          return true;
        }
      };
      return expectAll([
        [!refused('reply.length_v2-x'), 'the registry refused the name reply.length_v2-x'],
        [refused('reply length'), 'the registry accepted a name with a space'],
        [refused('reply.length_v2-x'), 'the registry accepted the same name twice'],
      ]);
    },
  );
}

function budgetItems(out: BankItem[]): void {
  add(
    out,
    'budget/steps-larger-count',
    2,
    C('budget'),
    'the steps are the larger of the tool calls and the commands, not their sum ("Budget")',
    'budget: steps are the larger of the two counts',
    async ({ seed }) => {
      const calls = [
        { label: 'shell.run', input: { command: 'ls' } },
        { label: 'shell.run', input: { command: 'pwd' } },
      ];
      const runs = [
        { command: 'ls', exitCode: 0 },
        { command: 'pwd', exitCode: 0 },
      ];
      const run = await scene(seed, 'budget-steps', [
        { observed: obs({ text: EN('R-9000'), calls, runs }), budget: { steps: 2 } },
      ]);
      return verdictIs(run, 0, 'budget.steps', { outcome: 'pass' });
    },
  );
  add(
    out,
    'budget/agent-not-a-step',
    2,
    C('budget'),
    'the agent process record never counts as a budget step ("Execution")',
    'budget: the role agent record is not a step',
    async ({ seed }) => {
      const runs = [
        { command: 'node x.js', exitCode: 0 },
        { command: 'agent', role: 'agent' as const, exitCode: 0 },
      ];
      const run = await scene(seed, 'budget-agent', [
        { observed: obs({ text: EN('R-9001'), runs }), budget: { steps: 1 } },
      ]);
      return verdictIs(run, 0, 'budget.steps', { outcome: 'pass' });
    },
  );
  add(
    out,
    'budget/segment-cost',
    2,
    C('budget'),
    'the cost is the sum of the segment costs when only those are reported ("Budget")',
    'budget: segment costs add up when no block total is reported',
    async ({ seed }) => {
      const run = await scene(seed, 'budget-seg', [
        {
          observed: obs({ text: EN('R-9002'), calls: [{ label: LOOKUP }], segmentUsd: 0.002 }),
          budget: { cost_usd: 0.005 },
        },
      ]);
      return verdictIs(run, 0, 'budget.cost_usd', { outcome: 'fail', evidence: /0\.006/ });
    },
  );
  add(
    out,
    'budget/latency',
    1,
    C('budget'),
    'the latency is observed.latencyMs ("Budget")',
    'budget: a latency above latency_ms fails',
    async ({ seed }) => {
      const run = await scene(seed, 'budget-latency', [
        { observed: obs({ text: EN('R-9003'), latencyMs: 120 }), budget: { latency_ms: 100 } },
        { observed: obs({ text: EN2('R-9004'), latencyMs: 80 }), budget: { latency_ms: 100 } },
      ]);
      return all(
        verdictIs(run, 0, 'budget.latency_ms', { outcome: 'fail' }),
        verdictIs(run, 1, 'budget.latency_ms', { outcome: 'pass' }),
      );
    },
  );
}

// ---------------------------------------------------------------------------------------------------------
// End state.

function endStateItems(out: BankItem[]): void {
  const submit = (input: unknown) => obs({ text: EN('R-9100'), calls: [{ label: 'orders.submit', input }] });
  const plain = () => obs({ text: EN2('R-9101') });
  add(
    out,
    'end-state/subset',
    1,
    C('end_state'),
    'subset (the default) compares the listed fields of the state ("End state")',
    'end_state: subset mode passes the listed fields and ignores the others',
    async ({ seed }) => {
      const run = await scene(
        seed,
        'es-subset',
        [{ observed: submit({ plan: 'fiber_500', email: `a${seed}@example.org` }) }],
        {
          end_state: { source: 'tool:orders.submit', expect: { plan: 'fiber_500' } },
        },
      );
      return verdictIs(run, 0, 'end_state.plan', { outcome: 'pass' });
    },
  );
  add(
    out,
    'end-state/exact-extra',
    2,
    C('end_state'),
    'exact mode also fails every field of the state the spec does not list ("End state")',
    'end_state: exact mode fails an unlisted field under its own id',
    async ({ seed }) => {
      const run = await scene(
        seed,
        'es-exact',
        [{ observed: submit({ plan: 'fiber_500', email: `a${seed}@example.org` }) }],
        {
          end_state: { source: 'tool:orders.submit', mode: 'exact', expect: { plan: 'fiber_500' } },
        },
      );
      return all(
        verdictIs(run, 0, 'end_state.plan', { outcome: 'pass' }),
        verdictIs(run, 0, 'end_state.email', { outcome: 'fail' }),
      );
    },
  );
  add(
    out,
    'end-state/nothing-recorded',
    2,
    C('end_state'),
    'a source that recorded nothing fails every expected field, { absent: true } included ("End state")',
    'end_state: an empty source fails every field, absent assertions too',
    async ({ seed }) => {
      const run = await scene(seed, 'es-nothing', [{ observed: plain() }], {
        end_state: { source: 'tool:orders.submit', expect: { plan: 'fiber_500', coupon: { absent: true } } },
      });
      return all(
        verdictIs(run, 0, 'end_state.plan', { outcome: 'fail' }),
        verdictIs(run, 0, 'end_state.coupon', { outcome: 'fail' }),
      );
    },
  );
  add(
    out,
    'end-state/not-a-mapping',
    2,
    C('end_state'),
    'a state that is not a mapping fails every expected field, and the evidence names its type ("End state")',
    'end_state: a string state fails each field and names its type',
    async ({ seed }) => {
      const run = await scene(seed, 'es-string', [{ observed: submit('fiber_500') }], {
        end_state: { source: 'tool:orders.submit', expect: { plan: 'fiber_500' } },
      });
      return verdictIs(run, 0, 'end_state.plan', { outcome: 'fail', evidence: /string/ });
    },
  );
  add(
    out,
    'end-state/empty-expect',
    2,
    C('end_state'),
    'an empty expect gives one verdict for the source: pass when it recorded anything, fail when nothing ("End state")',
    'end_state: an empty expect is one presence verdict per source',
    async ({ seed }) => {
      const top = { end_state: { source: 'tool:orders.submit', expect: {} } };
      const recorded = await scene(seed, 'es-empty-a', [{ observed: submit({ plan: 'p' }) }], top);
      const nothing = await scene(seed, 'es-empty-b', [{ observed: plain() }], top);
      return all(
        verdictIs(recorded, 0, 'end_state.tool:orders.submit', { outcome: 'pass' }),
        verdictIs(nothing, 0, 'end_state.tool:orders.submit', { outcome: 'fail' }),
      );
    },
  );
  add(
    out,
    'end-state/list-ids',
    2,
    C('end_state'),
    'for a list, the fields are named <source>.<field> ("End state")',
    'end_state: a list of mappings names each field after its source',
    async ({ seed }) => {
      const run = await scene(
        seed,
        'es-list',
        [
          {
            observed: obs({
              text: EN('R-9102'),
              calls: [
                { label: 'orders.submit', input: { plan: 'p' } },
                { label: 'notify_sales', input: { reason: 'callback' } },
              ],
            }),
          },
        ],
        {
          end_state: [
            { source: 'tool:orders.submit', expect: { plan: 'p' } },
            { source: 'tool:notify_sales', expect: { reason: { one_of: ['callback', 'no_coverage'] } } },
          ],
        },
      );
      return all(
        verdictIs(run, 0, 'end_state.tool:orders.submit.plan', { outcome: 'pass' }),
        verdictIs(run, 0, 'end_state.tool:notify_sales.reason', { outcome: 'pass' }),
      );
    },
  );
  add(
    out,
    'end-state/none',
    2,
    C('end_state'),
    'none passes when nothing was submitted and fails with one verdict naming the first payload ("End state")',
    'end_state: none reads every payload and fails once on the first',
    async ({ seed }) => {
      const empty = await scene(seed, 'es-none-a', [{ observed: plain() }], { end_state: 'none' });
      const two = await scene(
        seed,
        'es-none-b',
        [
          {
            observed: obs({
              text: EN('R-9103'),
              calls: [
                { label: 'orders.submit', input: { plan: 'first' } },
                { label: 'notify_sales', input: { reason: 'second' } },
              ],
            }),
          },
        ],
        { end_state: 'none' },
      );
      const mine = verdictsOf(two, 0).filter((verdict) => verdict.id.startsWith('end_state.'));
      return all(
        verdictIs(empty, 0, 'end_state.none', { outcome: 'pass' }),
        verdictIs(two, 0, 'end_state.none', { outcome: 'fail', evidence: /first/ }),
        mine.length === 1 ? PASS : fail(`expected one end_state verdict for none, got ${idsOf(mine)}`),
      );
    },
  );
  add(
    out,
    'end-state/last-block-only',
    1,
    C('end_state'),
    'the end-state check runs on the last spec block only ("End state")',
    'end_state: only the last spec block gets end-state verdicts',
    async ({ seed }) => {
      const run = await scene(seed, 'es-last', [{ observed: submit({ plan: 'p' }) }, { observed: plain() }], {
        end_state: { source: 'tool:orders.submit', expect: { plan: 'p' } },
      });
      return all(noVerdict(run, 0, 'end_state.'), verdictIs(run, 1, 'end_state.plan', { outcome: 'pass' }));
    },
  );
  add(
    out,
    'end-state/not-perturbed',
    2,
    C('end_state'),
    'the end-state check never runs in perturbed mode, and runs in teacher-forced mode ("End state")',
    'end_state: the check applies in T and F and not in P',
    async ({ seed }) => {
      const raw = rawSpec(seed, 'es-modes', [{ observed: obs({}) }], {
        end_state: { source: 'tool:orders.submit', expect: { plan: 'p' } },
      });
      const check = defaultChecks().find((one) => one.name === 'end_state') as Check;
      const applies = (mode: RunMode) =>
        check.applies(ctxFor(raw, obs({ text: 'x' }), { mode, endState: { plan: 'p' } }));
      return expectAll([
        [applies('T'), 'end_state does not apply in mode T'],
        [applies('F'), 'end_state does not apply in mode F'],
        [!applies('P'), 'end_state applies in mode P'],
      ]);
    },
  );
  add(
    out,
    'end-state/run-record',
    2,
    RUNNER,
    'the runner writes the end-state comparison into the run record, field by field ("End state")',
    'runner: the run record holds the end-state match and a diff entry per failing field',
    async ({ seed }) => {
      const run = await scene(seed, 'es-record', [{ observed: submit({ plan: 'fiber_1000' }) }], {
        end_state: { source: 'tool:orders.submit', expect: { plan: 'fiber_500' } },
      });
      const diff = run.endState?.diff ?? [];
      return expectAll([
        [run.endState?.match === false, `run.endState.match is ${run.endState?.match}, expected false`],
        [
          diff.some((entry) => entry.field === 'plan'),
          `run.endState.diff has no entry for plan: ${JSON.stringify(diff)}`,
        ],
      ]);
    },
  );
  add(
    out,
    'end-state/assertion-regex',
    1,
    ASSERT,
    'end_state.expect asserts values with the same forms as tool input, such as { regex } ("Assertions on values")',
    'end_state: field assertions use the shared assertion forms',
    async ({ seed }) => {
      const run = await scene(
        seed,
        'es-regex',
        [{ observed: submit({ address: '88 Summit Avenue, Acmeville' }) }],
        {
          end_state: { source: 'tool:orders.submit', expect: { address: { regex: '^88 Summit Avenue' } } },
        },
      );
      return verdictIs(run, 0, 'end_state.address', { outcome: 'pass' });
    },
  );
}

/** The executable claims of docs/reference/checks.md. */
export function checksItems(): BankItem[] {
  const out: BankItem[] = [];
  verdictItems(out);
  toolItems(out);
  assertionItems(out);
  textItems(out);
  fitItems(out);
  piiItems(out);
  runtimeItems(out);
  codeItems(out);
  schemaItems(out);
  customItems(out);
  budgetItems(out);
  endStateItems(out);
  return out;
}
