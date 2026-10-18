import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CheckContext, Observed, Spec } from '@agent-nexus/driftbench-core';
import { FakeJudge } from '@agent-nexus/driftbench-judges';
import { afterEach, describe, expect, it } from 'vitest';
import { runJudgeFrom } from '../src/commands/run-judge';
import { type Io, main } from '../src/index';
import { judgeSettingsFrom } from '../src/judge-settings';

/**
 * Criterion judge settings and the run-wide judge flags reach the judge from the CLI: a stand-in claude
 * command records the system prompt and the prompt it is sent, with no model call.
 */

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SESSION = 'examples/estates/sessions/skill-skipped.jsonl';

/** The fixture stand-in judge, which also appends what it is sent to RECORD_FILE. */
async function recorder(): Promise<string> {
  const fake = await readFile(join(ROOT, 'examples/estates/fixture/live/fake/judge.cjs'), 'utf8');
  const hook = "process.stdin.on('end', () => {";
  if (!fake.includes(hook)) throw new Error('the fixture judge changed: update the recorder hook');
  return fake.replace(
    hook,
    `${hook}\n  const at0 = process.argv.indexOf('--system-prompt');\n  require('node:fs').appendFileSync(process.env.RECORD_FILE, JSON.stringify({ system: at0 < 0 ? '' : process.argv[at0 + 1], input }) + '\\n');`,
  );
}

const temp: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'criterion-settings-'));
  temp.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of temp.splice(0)) await rm(dir, { recursive: true });
  delete process.env.RECORD_FILE;
});

async function cli(argv: string[]) {
  let out = '';
  let err = '';
  const io: Io = {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    cwd: ROOT,
  };
  return { code: await main(argv, io), out, err };
}

function spec(criterion: string): string {
  return [
    'id: judged-settings',
    'kind: task',
    'criteria:',
    '  - name: keeps-scope',
    '    rubric: Does the reply stay on the shop build?',
    criterion.includes('conformance') ? '' : '    scope: block',
    criterion,
    'blocks:',
    '  - user: Add a discount field to the invoice total in src/invoice.ts, then run the tests.',
    '    expect:',
    '      criteria: [keeps-scope]',
    '',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/**
 * Replays one session against a spec with the recorder as judge; returns what the judge was sent. The default
 * policy first routes each request with its own call; `calls` holds the criterion calls and `routes` the routing ones.
 */
async function recorded(criterion: string, ...flags: string[]) {
  const dir = await tempDir();
  const judge = join(dir, 'judge.cjs');
  await writeFile(judge, await recorder());
  await writeFile(join(dir, 'judged.yaml'), spec(criterion));
  process.env.RECORD_FILE = join(dir, 'calls.jsonl');
  await writeFile(process.env.RECORD_FILE, '');
  const result = await cli([
    'replay',
    SESSION,
    '--suite',
    dir,
    '--judge',
    'claude:haiku',
    '--judge-command',
    judge,
    ...flags,
    '--json',
  ]);
  const sent = (await readFile(process.env.RECORD_FILE, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { system: string; input: string });
  const routing = (call: { system: string }) => call.system.includes('"route":"criterion"');
  return { result, calls: sent.filter((call) => !routing(call)), routes: sent.filter(routing) };
}

describe('criterion settings from a spec reach the judge of a run', () => {
  it('sends the default policy prompt (version 2) without settings, the version 1 rules with prompt_version 1, and the items with items', async () => {
    const plain = await recorded('');
    expect(plain.result.err).toBe('');
    expect(plain.calls).toHaveLength(1);
    expect(plain.routes).toHaveLength(1);
    const again = await recorded('    prompt_version: 2');
    expect(again.calls).toEqual(plain.calls);

    const v1 = await recorded('    prompt_version: 1');
    expect(plain.calls[0]?.system).toContain('Compare each named identifier, number and unit exactly');
    expect(v1.calls[0]?.system).not.toContain('Compare each named identifier, number and unit exactly');
    // A pinned version keeps the request as written: no routing call.
    expect(v1.routes).toHaveLength(0);

    const items = await recorded(
      '    items:\n      - { name: on-scope, rubric: Edits only the invoice total. }\n    threshold: 0.5',
    );
    expect(JSON.stringify(items.calls[0])).toContain('Edits only the invoice total.');

    const conformance = await recorded(
      '    assessment: conformance\n    reference: The shop build stays in scope.',
    );
    expect(conformance.calls).toHaveLength(1);
    // An assessment is pinned too: an unexpected routing call fails here, not only in the count above.
    expect(conformance.routes).toHaveLength(0);
    expect(conformance.calls[0]?.input).toContain('The shop build stays in scope.');

    const repeat = await recorded('    repeat: 3');
    expect(repeat.calls).toHaveLength(3);
    // The repeats share one routing call; a second routing call per repeat would fail here.
    expect(repeat.routes).toHaveLength(1);
  }, 120_000);

  it('refuses a spec whose settings cannot work, naming the fix', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'bad.yaml'), spec('    assessment: fact-ledger'));
    const result = await cli(['spec', 'lint', join(dir, 'bad.yaml')]);
    expect(`${result.out}${result.err}`).toContain('assessment fact-ledger needs a nonempty reference');
  });
});

describe('run-wide judge flags', () => {
  it('--prompt-budget fits the prompt and --verify arithmetic hands the judge the checked equations', async () => {
    const io: Io = { out: () => {}, err: () => {}, cwd: ROOT };
    const fake = new FakeJudge('j', ['{"outcome":"pass","reasoning":"ok"}'], { cls: 'system2' });
    const settings = judgeSettingsFrom({ verify: 'arithmetic', promptBudget: '100000' }, io);
    const request = {
      criterion: { name: 'math', rubric: 'Is the total right?' },
      transcript: [
        { role: 'user' as const, text: 'What is 12 * 3?' },
        { role: 'agent' as const, text: 'It is 12 * 3 = 35.' },
      ],
    };
    await settings?.(fake).judge(request);
    const tool = fake.requests[0]?.transcript.at(-1);
    expect(tool?.tool).toBe('judge.arithmetic');
    expect(tool?.text).toContain('"matches":false');

    const long = {
      ...request,
      transcript: [
        ...Array.from({ length: 30 }, (_, i) => ({
          role: 'context' as const,
          text: `older note ${i} `.repeat(20),
        })),
        ...request.transcript,
      ],
    };
    const fitted = new FakeJudge('k', ['{"outcome":"pass","reasoning":"ok"}'], { cls: 'system2' });
    await judgeSettingsFrom({ promptBudget: '3000' }, io)?.(fitted).judge(long);
    expect(fitted.requests[0]?.transcript[0]?.text).toMatch(/^\[\d+ earlier entries omitted\]$/);
    const untouched = new FakeJudge('u', ['{"outcome":"pass","reasoning":"ok"}'], { cls: 'system2' });
    await judgeSettingsFrom({}, io)?.(untouched).judge(long);
    expect(untouched.requests[0]).toBe(long);
  });

  it('reaches the judge a run builds: the stand-in reads the arithmetic check', async () => {
    const dir = await tempDir();
    const judge = join(dir, 'judge.cjs');
    await writeFile(judge, await recorder());
    process.env.RECORD_FILE = join(dir, 'calls.jsonl');
    await writeFile(process.env.RECORD_FILE, '');
    const io: Io = { out: () => {}, err: () => {}, cwd: ROOT };
    const built = await runJudgeFrom(
      { judge: 'claude:haiku', judgeCommand: judge, verify: 'arithmetic', promptBudget: '200000' },
      io,
    );
    const observed: Observed = {
      segments: [{ type: 'text', text: 'The total is 12 * 3 = 35.' }],
      text: 'The total is 12 * 3 = 35.',
      toolCalls: [],
      cost: {},
      latencyMs: 1,
    };
    const block = { when: { user: 'What is the total?' }, expect: { criteria: ['math'] } };
    const ctx: CheckContext = {
      spec: {
        id: 'math',
        kind: 'conversation',
        criteria: [{ name: 'math', rubric: 'Is the total right?' }],
        blocks: [block],
      } as Spec,
      mode: 'F',
      blockIndex: 0,
      block,
      expect: block.expect,
      given: { prefix: [], ledger: {}, world: {}, vars: {}, target: { adapter: 'claude-code' }, hash: 'h' },
      observed,
      history: [],
      ledger: {},
    };
    await built?.check.evaluate(ctx);
    const calls = await readFile(process.env.RECORD_FILE, 'utf8');
    expect(calls).toContain('judge.arithmetic');
  }, 60_000);

  it('refuses a wrong value with a clear message', async () => {
    const errors: string[] = [];
    const io: Io = { out: () => {}, err: (text) => errors.push(text), cwd: ROOT };
    expect(judgeSettingsFrom({ verify: 'units' }, io)).toBeUndefined();
    expect(judgeSettingsFrom({ promptBudget: '0' }, io)).toBeUndefined();
    expect(errors.join('')).toContain('--verify takes arithmetic, not "units"');
    expect(errors.join('')).toContain('--prompt-budget takes a whole number of characters above 0, not "0"');
    const without = await cli(['replay', SESSION, '--suite', ROOT, '--verify', 'arithmetic']);
    expect(without.code).toBe(2);
    expect(without.err).toContain('error: --verify needs --judge claude:<model>');
  });
});
