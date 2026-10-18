import { describe, expect, it } from 'vitest';
import { createAcmeAgent, TOOL_LABELS } from '../../../examples/acme/src/index';
import {
  assistantMessage,
  enterBlock,
  findSpecFiles,
  type GivenFinding,
  initialGiven,
  lintSpec,
  loadSpecFile,
  type Message,
  type Spec,
  stimulusMessages,
  validateSpec,
  valueInText,
  verifyGiven,
} from '../src/index';

/** Fictional data only: the Acme Telecom example agent and specs. */
const ACME_TOOLS = new Set<string>(TOOL_LABELS);

function specOf(raw: unknown): Spec {
  const result = validateSpec(raw);
  if (!result.ok) throw new Error(`invalid test spec: ${JSON.stringify(result.errors)}`);
  return result.spec;
}

describe('valueInText: whole tokens, case, spacing and punctuation aside', () => {
  it('finds a value written with other spacing or punctuation', () => {
    expect(valueInText('+12025550131', 'Call me on +1 202 555 0131 please')).toBe(true);
    expect(valueInText('12 Rue Verte', 'I live at 12, rue verte.')).toBe(true);
    expect(valueInText(42, 'order 42 is late')).toBe(true);
  });

  it('never matches inside a word: the H9 false grounding of lang EN', () => {
    expect(valueInText('EN', 'I went to the shop')).toBe(false);
    expect(valueInText('EN', 'Then again')).toBe(false);
    expect(valueInText('EN', 'Reply in EN please')).toBe(true);
    expect(valueInText('1042', 'order 10421')).toBe(false);
    expect(valueInText('', 'anything')).toBe(false);
  });
});

describe('verifyGiven: each check on a planted defect, and silence on the correct form', () => {
  const call = (id: string, label: string, extra: Record<string, unknown> = {}) => ({
    id,
    label,
    input: {},
    output: { ok: true },
    ...extra,
  });
  const twoTurns = (calls: unknown[][]) => ({
    id: 'paired',
    metadata: { tool_schemas: { lookup: {}, notify: {} } },
    blocks: [
      {
        user: 'next',
        given: {
          prefix: [
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: 'one', tool_calls: calls[0] },
            { role: 'user', content: 'and' },
            { role: 'assistant', content: 'two', tool_calls: calls[1] },
          ],
        },
        expect: { must: ['x'] },
      },
    ],
  });
  const checks = (findings: GivenFinding[]) => findings.map((f) => `${f.level} ${f.check} ${f.path}`);

  it('the same id in two assistant turns is accepted: ids are unique per message (H9 rule fix 1)', () => {
    const spec = specOf(twoTurns([[call('call-1', 'lookup')], [call('call-1', 'notify')]]));
    expect(verifyGiven(spec)).toEqual([]);
  });

  it('the same id twice in one message, and a call with no result, are Given errors', () => {
    const spec = specOf(
      twoTurns([
        [call('call-1', 'lookup'), call('call-1', 'notify')],
        [{ id: 'c', label: 'lookup', input: {} }],
      ]),
    );
    expect(checks(verifyGiven(spec))).toEqual([
      'not_run tool_history_paired blocks.0.given.prefix.1.tool_calls.1.id',
      'not_run tool_history_paired blocks.0.given.prefix.3.tool_calls.0',
    ]);
  });

  it('a canonical prefix with a call that has no result is a warning only', () => {
    const raw = twoTurns([[call('a', 'lookup')], [{ id: 'b', label: 'notify', input: {} }]]);
    const canonical = {
      ...raw,
      blocks: [{ ...raw.blocks[0], given: { ...raw.blocks[0]?.given, origin: 'canonical' } }],
    };
    expect(checks(verifyGiven(specOf(canonical)))).toEqual([
      'warning tool_history_paired blocks.0.given.prefix.3.tool_calls.0',
    ]);
    expect(lintSpec(specOf(canonical)).map((issue) => issue.code)).toContain('GIVEN_CANONICAL_UNPAIRED');
  });

  it('tool_known reads metadata.tool_schemas, and is off without a tool set', () => {
    const raw = twoTurns([[call('a', 'lookup')], [call('b', 'mystery')]]);
    expect(checks(verifyGiven(specOf(raw)))).toEqual([
      'not_run tool_known blocks.0.given.prefix.3.tool_calls.0.label',
    ]);
    const { metadata: _none, ...open } = raw;
    expect(verifyGiven(specOf(open))).toEqual([]);
  });

  it('history_matches_world: a recorded call must record what the world forces', () => {
    const raw = twoTurns([[call('a', 'lookup')], [call('b', 'notify')]]);
    const forced = (tools: unknown) => ({
      ...raw,
      blocks: [{ ...raw.blocks[0], given: { ...raw.blocks[0]?.given, world: { tools } } }],
    });
    expect(verifyGiven(specOf(forced({ lookup: { result: { ok: true } } })))).toEqual([]);
    expect(checks(verifyGiven(specOf(forced({ lookup: { error: 'timeout' } }))))).toEqual([
      'not_run history_matches_world blocks.0.given.prefix.1.tool_calls.0',
    ]);
  });

  it('value_in_message: a shared fact is in the ledger and in the message named', () => {
    const raw = (shared: unknown, ledger: Record<string, unknown> = { phone: '+12025550131' }) => ({
      id: 'shared',
      given: { ledger },
      blocks: [
        {
          user: 'next',
          given: {
            prefix: [
              { role: 'user', content: 'my number is +1 202 555 0131' },
              { role: 'assistant', content: 'noted' },
            ],
            shared,
          },
          expect: { must: ['x'] },
        },
      ],
    });
    expect(verifyGiven(specOf(raw([{ fact: 'phone', by: 'user', in: 0 }])))).toEqual([]);
    expect(verifyGiven(specOf(raw([{ fact: 'customer', by: 'record' }])))).toEqual([]);
    const wrong = verifyGiven(specOf(raw([{ fact: 'phone', by: 'agent', in: 1 }])));
    expect(wrong.map((f) => [f.check, f.got])).toEqual([['value_in_message', 'the message says: noted']]);
    expect(verifyGiven(specOf(raw([{ fact: 'email', by: 'user', in: 0 }])))[0]?.got).toBe(
      'the ledger holds no such fact',
    );
    expect(verifyGiven(specOf(raw([{ fact: 'phone', by: 'agent', in: 5 }])))[0]?.got).toBe(
      'the prefix has no such message',
    );
  });

  it('value_in_message reads the history a later block inherits, and checks the speaker', () => {
    const inherits = (by: 'user' | 'agent', at: number) =>
      specOf({
        id: 'inherits',
        given: { ledger: { phone: '+12025550131' } },
        blocks: [
          {
            user: 'first',
            given: {
              prefix: [
                { role: 'user', content: 'my number is +1 202 555 0131' },
                { role: 'assistant', content: 'noted +1 202 555 0131' },
              ],
            },
            expect: { must: ['x'] },
          },
          { user: 'second', given: { shared: [{ fact: 'phone', by, in: at }] }, expect: { must: ['x'] } },
        ],
      });
    expect(verifyGiven(inherits('user', 0))).toEqual([]);
    expect(verifyGiven(inherits('agent', 1))).toEqual([]);
    const wrongSpeaker = verifyGiven(inherits('user', 1));
    expect(wrongSpeaker.map((f) => [f.check, f.got])).toEqual([
      ['value_in_message', 'it is an assistant message'],
    ]);
    expect(verifyGiven(inherits('agent', 0))[0]?.got).toBe('it is a user message');
  });

  it('chain and summary_present are warnings only', () => {
    const spec = specOf({
      id: 'warned',
      given: {
        ledger: { plan: 'fiber_500' },
        world: { workspace: { from: './seed' } },
        vars: { session_state: 'resumed' },
      },
      blocks: [{ user: 'hi', expect: { ledger_add: { plan: 'fiber_1000' } } }],
    });
    expect(checks(verifyGiven(spec))).toEqual([
      'warning summary_present given.world.workspace',
      'warning summary_present given.vars.session_state',
      'warning chain blocks.0.expect.ledger_add',
    ]);
    const summarised = specOf({
      id: 'summarised',
      given: {
        world: { workspace: { from: './seed', summary: 'sales.xlsx with a North and a South sheet' } },
        vars: { session_state: 'resumed' },
        summary: 'a session resumed after its first answer',
      },
      blocks: [{ user: 'hi' }],
    });
    expect(verifyGiven(summarised)).toEqual([]);
  });

  it('spec lint warns with GIVEN_UNMET and GIVEN_CHAIN, and leaves summaries to spec lint --summaries', () => {
    const spec = specOf({
      id: 'linted',
      given: { ledger: { plan: 'a' }, vars: { session_state: 'resumed' } },
      blocks: [
        {
          user: 'hi',
          given: {
            prefix: [{ role: 'assistant', content: 'x', tool_calls: [{ label: 'lookup', input: {} }] }],
          },
          expect: { ledger_add: { plan: 'b' } },
        },
      ],
    });
    expect(lintSpec(spec).map((issue) => issue.code)).toEqual(['GIVEN_UNMET', 'GIVEN_CHAIN']);
    expect(lintSpec(spec)[0]?.message).toBe(
      'tool_history_paired: expected lookup carries an output or an error; got a call with no result',
    );
  });
});

// ---------------------------------------------------------------- the H9 battery, in the repo

type Clean = { path: string; spec: Spec };

/**
 * H9 part A: a recorded Given. Blocks 0 to k-1 of an Acme spec run through the deterministic Acme agent; the
 * history becomes block k's prefix, with every ledger fact a user message states (whole tokens) in `shared`.
 */
async function recordClean(path: string, spec: Spec): Promise<{ clean?: Clean; reason?: string }> {
  const k = spec.blocks.length - 1;
  if (k < 1) return { reason: 'one block' };
  const agent = createAcmeAgent();
  let running = initialGiven(spec);
  const ledger: Record<string, unknown> = { ...running.ledger };
  const messages: Message[] = [];
  const worlds: string[] = [];
  for (let j = 0; j < k; j++) {
    const block = spec.blocks[j] as Spec['blocks'][number];
    if (block.given?.prefix) return { reason: 'authored prefix' };
    running = enterBlock(running, block.given);
    worlds.push(JSON.stringify({ tools: running.world.tools ?? null, store: running.world.store ?? null }));
    messages.push(...stimulusMessages(block.when));
    messages.push(assistantMessage(await agent.respond(messages, running.world)));
    Object.assign(ledger, block.given?.ledger, block.expect?.ledger_add);
  }
  const last = spec.blocks[k] as Spec['blocks'][number];
  running = enterBlock(running, last.given);
  Object.assign(ledger, running.ledger);
  const worldK = JSON.stringify({ tools: running.world.tools ?? null, store: running.world.store ?? null });
  if (worlds.some((world) => world !== worldK)) return { reason: 'world changes between blocks' };
  const calls = messages.flatMap((message) => message.tool_calls ?? []);
  if (!calls.some((c) => c.output !== undefined || c.error !== undefined))
    return { reason: 'no recorded result' };
  const shared: { fact: string; by: 'user'; in: number }[] = [];
  for (const [fact, value] of Object.entries(ledger)) {
    const index = messages.findIndex(
      (message) => message.role === 'user' && valueInText(value, message.content),
    );
    if (index >= 0) shared.push({ fact, by: 'user', in: index });
  }
  if (shared.length === 0) return { reason: 'no ledger fact said in a user message' };
  const clean = specOf({
    id: `${spec.id}-recorded`,
    given: { ledger, world: running.world, vars: running.vars },
    blocks: [
      {
        when: last.when,
        given: { prefix: JSON.parse(JSON.stringify(messages)), shared },
        expect: last.expect,
      },
    ],
  });
  return { clean: { path, spec: clean } };
}

const DEFECTS = [
  { id: 'dropped_tool_result', check: 'tool_history_paired', layer: '2' },
  { id: 'fact_not_in_message', check: 'value_in_message', layer: '4' },
  { id: 'flipped_world_row', check: 'history_matches_world', layer: '5' },
  { id: 'unknown_tool', check: 'tool_known', layer: '2' },
] as const;

/** Plants one defect in one copy, deterministically: the first recorded call or shared fact. */
function plant(clean: Spec, defect: (typeof DEFECTS)[number]): Spec {
  const spec = JSON.parse(JSON.stringify(clean)) as Spec;
  const block = spec.blocks[0] as Spec['blocks'][number] & {
    given: NonNullable<Spec['blocks'][number]['given']>;
  };
  const recorded = (block.given.prefix ?? [])
    .flatMap((message) => message.tool_calls ?? [])
    .filter((call) => call.output !== undefined || call.error !== undefined);
  const first = recorded[0] as NonNullable<Message['tool_calls']>[number];
  switch (defect.id) {
    case 'dropped_tool_result':
      delete first.output;
      delete first.error;
      break;
    case 'fact_not_in_message': {
      const fact = (block.given.shared ?? [])[0]?.fact as string;
      spec.given = { ...spec.given, ledger: { ...spec.given?.ledger, [fact]: 'ZZ-planted-1000' } };
      break;
    }
    case 'flipped_world_row': {
      const forced =
        first.error !== undefined ? { result: { planted: 1000 } } : { error: 'planted failure 1000' };
      block.given.world = { tools: { [first.label]: forced } };
      break;
    }
    case 'unknown_tool':
      first.label = 'unknown_tool_1000';
      break;
  }
  return spec;
}

describe('the H9 battery: planted Given defects on recorded Acme specs', async () => {
  const files = (await findSpecFiles(['examples/acme'])).filter((path) =>
    /examples\/acme\/(specs|golden|gated|generated)\//.test(path),
  );
  const pool: { path: string; spec: Spec }[] = [];
  for (const path of files) {
    const loaded = await loadSpecFile(path);
    if (loaded.ok && (loaded.spec.target === undefined || loaded.spec.target.agent === 'acme-sales')) {
      pool.push({ path, spec: loaded.spec });
    }
  }
  const clean: Clean[] = [];
  for (const item of pool) {
    if (clean.length === 20) break;
    const result = await recordClean(item.path, item.spec);
    if (result.clean) clean.push(result.clean);
  }

  it('records at least 10 clean specs, and flags none of them', () => {
    expect(clean.length).toBeGreaterThanOrEqual(10);
    const flagged = clean.flatMap((item) =>
      verifyGiven(item.spec, { tools: ACME_TOOLS })
        .filter((finding) => finding.level === 'not_run')
        .map((finding) => `${item.path}: ${finding.check} ${finding.got}`),
    );
    expect(flagged).toEqual([]);
  });

  it('finds every planted defect with the right check on the right layer', () => {
    const missed: string[] = [];
    for (const item of clean) {
      for (const defect of DEFECTS) {
        const findings = verifyGiven(plant(item.spec, defect), { tools: ACME_TOOLS });
        const hit = findings.some(
          (finding) =>
            finding.level === 'not_run' &&
            finding.check === defect.check &&
            finding.layer.includes(defect.layer),
        );
        if (!hit) missed.push(`${item.path} ${defect.id}`);
      }
    }
    expect(missed).toEqual([]);
    expect(clean.length * DEFECTS.length).toBeGreaterThanOrEqual(40);
  });
});

describe('the shipped example specs', () => {
  it('give no Given error and no chain warning; only missing summaries (1,074 when H9 counted)', async () => {
    const files = await findSpecFiles(['examples']);
    const counts: Record<string, number> = {};
    let loaded = 0;
    for (const path of files) {
      const result = await loadSpecFile(path);
      if (!result.ok) continue;
      loaded += 1;
      for (const finding of verifyGiven(result.spec)) {
        counts[`${finding.level} ${finding.check}`] = (counts[`${finding.level} ${finding.check}`] ?? 0) + 1;
      }
    }
    expect(loaded).toBeGreaterThan(2000);
    expect(Object.keys(counts)).toEqual(['warning summary_present']);
  }, 120_000);
});
