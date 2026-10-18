import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '@agent-nexus/driftbench-store';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Io, main } from '../src/index';
import { judgeNeeded } from '../src/judge-options';
import type { DriftbenchPlugin } from '../src/plugins';

/**
 * The judge flags every judging command shares (`../src/judge-options`), offline: a stand-in claude command,
 * a local stand-in for the OpenAI chat endpoint, and recorded cassettes. Fictional data only.
 */

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FAKE = join(ROOT, 'examples/estates/fixture/live/fake/judge.cjs');
const SESSION = join(ROOT, 'examples/estates/sessions/skill-skipped.jsonl');
const AGENT = fileURLToPath(new URL('./fixtures/echo-agent.mjs', import.meta.url));
const ECHO = ['--target', 'process:echo', '--process-command', JSON.stringify([process.execPath, AGENT])];
const CRITERIA = join(ROOT, 'examples/acme/criteria');
const CASSETTE = join(CRITERIA, 'council.cassette.json');
const SLOW = 180_000;

const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});
afterEach(() => {
  vi.unstubAllEnvs();
});

async function folder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'driftbench-judge-flags-'));
  made.push(dir);
  return dir;
}

async function cli(argv: string[], cwd = ROOT, plugins?: readonly DriftbenchPlugin[]) {
  let out = '';
  let err = '';
  const io: Io = {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    cwd,
  };
  const code = await main(argv, io, plugins ? { plugins } : {});
  let json: Record<string, unknown> | undefined;
  try {
    json = JSON.parse(out) as Record<string, unknown>;
  } catch {
    json = undefined;
  }
  return { code, out, err, json };
}

/**
 * A stand-in for the OpenAI chat endpoint. A model whose name holds `fail` answers fail, any other pass; a
 * call whose system prompt asks to solve answers 42. It answers the ledger contract as the fake claude does.
 */
type Call = { model: string; system: string; user: string };
const calls: Call[] = [];
let server: Server;
beforeAll(async () => {
  server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      const payload = JSON.parse(body) as { model: string; messages: { role: string; content: string }[] };
      const system = payload.messages.find((m) => m.role === 'system')?.content ?? '';
      const user = payload.messages.find((m) => m.role === 'user')?.content ?? '';
      calls.push({ model: payload.model, system, user });
      let content: string;
      if (system.startsWith('Solve the question')) {
        content = '42';
      } else {
        const met = !payload.model.includes('fail');
        const block = user.match(/<transcript_data>\n([\s\S]*?)\n<\/transcript_data>/)?.[1] ?? '';
        const entries =
          block.trim().startsWith('[') && block.trim().endsWith(']')
            ? (JSON.parse(block) as { role: string; text: string }[])
            : [];
        const observed =
          entries.find((entry) => entry.role === 'agent')?.text ??
          entries.find((entry) => entry.role === 'user')?.text ??
          '';
        const reasoning = met ? 'The reply keeps to the rule.' : 'The reply breaks the rule.';
        content = system.includes('"checks"')
          ? JSON.stringify({
              checks: [
                {
                  id: user.match(/^CRITERION: ([^\n]+)$/m)?.[1] ?? 'missing',
                  reasoning,
                  evidence: observed.match(/[\p{L}\p{N}]+/u)?.[0] ?? null,
                  met,
                },
              ],
            })
          : JSON.stringify({ outcome: met ? 'pass' : 'fail', reasoning });
      }
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] }),
      );
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
});
afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

/** Points the OpenAI clients at the stand-in, with a fake key. */
function openAiStandIn(): void {
  const { port } = server.address() as AddressInfo;
  vi.stubEnv('OPENAI_API_KEY', 'stand-in-key');
  vi.stubEnv('OPENAI_BASE_URL', `http://127.0.0.1:${port}`);
  vi.stubEnv('OPENAI_JUDGE_MODEL', 'not-the-flag-model');
}

const JUDGED = [
  'id: judged-flags',
  'kind: task',
  'criteria:',
  '  - { name: keeps-scope, rubric: "Does the reply stay on the shop build?", gating: true, scope: block }',
  'blocks:',
  '  - user: Add a discount field to the invoice total in src/invoice.ts, then run the tests.',
  '    expect:',
  '      criteria: [keeps-scope]',
  '',
].join('\n');

type ReplayDoc = { judge: string; judgeCostUsd: number; runs: { pass: boolean; failing: string[] }[] };

async function replay(args: string[], suite?: string) {
  const dir = suite ?? (await folder());
  if (!suite) await writeFile(join(dir, 'judged.yaml'), JUDGED);
  const result = await cli(['replay', SESSION, '--suite', dir, '--json', ...args]);
  return { ...result, doc: result.json as unknown as ReplayDoc | undefined, dir };
}

describe('the refusal of judge flags with no judge', () => {
  it('says needs after one flag and need after several', () => {
    expect(judgeNeeded(['--verify'])).toBe(
      '--verify needs --judge claude:<model>, another --judge <kind>:<model>, or --judges <cassette>',
    );
    expect(judgeNeeded(['--panel-weights', '--panel-margin'])).toMatch(
      /^--panel-weights and --panel-margin need --judge claude:<model>,/,
    );
  });
});

describe('row 2: provider judges by --judge <kind>:<model>', () => {
  it(
    'judges with an OpenAI judge, on the model the flag names',
    async () => {
      openAiStandIn();
      calls.length = 0;
      const passing = await replay(['--judge', 'openai:pass-model']);
      expect(passing.err).toBe('');
      expect(passing.code).toBe(0);
      expect(passing.doc?.judge).toBe('openai:pass-model');
      expect(calls.map((call) => call.model)).toEqual(['pass-model']);
      const failing = await replay(['--judge', 'openai:fail-model']);
      expect(failing.code).toBe(1);
      expect(failing.doc?.runs[0]?.failing).toEqual(['block 0: judge.keeps-scope']);
    },
    SLOW,
  );

  it(
    'forms a council from repeated --judge, majority of three',
    async () => {
      openAiStandIn();
      const council = await replay([
        '--judge',
        'openai:pass-model',
        '--judge',
        'openai:fail-model',
        '--judge',
        'claude:haiku',
        '--judge-command',
        FAKE,
      ]);
      expect(council.err).toBe('');
      expect(council.code).toBe(0);
      expect(council.doc?.judge).toBe('openai-pass-model, openai-fail-model, claude-haiku');
      expect(council.doc?.judgeCostUsd).toBeCloseTo(0.0015);
    },
    SLOW,
  );

  it(
    'refuses an unknown kind and a missing key, before any call',
    async () => {
      const kind = await replay(['--judge', 'mistral:large']);
      expect(kind.code).toBe(2);
      expect(kind.err).toContain('--judge takes <kind>:<model>');
      vi.stubEnv('OPENAI_API_KEY', '');
      const key = await replay(['--judge', 'openai:pass-model']);
      expect(key.code).toBe(2);
      expect(key.err).toContain('OPENAI_API_KEY');
    },
    SLOW,
  );
});

describe('row 2: a bare provider kind', () => {
  it(
    'reads the model from the environment, as redteam grade --judge <kind> does',
    async () => {
      openAiStandIn();
      calls.length = 0;
      const bare = await replay(['--judge', 'openai']);
      expect(bare.err).toBe('');
      expect(bare.code).toBe(0);
      expect(bare.doc?.judge).toBe('openai');
      expect(calls.map((call) => call.model)).toEqual(['not-the-flag-model']);
      const claude = await replay(['--judge', 'claude']);
      expect(claude.code).toBe(2);
    },
    SLOW,
  );
});

describe('row 4: --agent-family on replay and estate run', () => {
  it(
    'refuses a single judge of the agent family, and keeps one of another',
    async () => {
      const same = await replay([
        '--judge',
        'claude:haiku',
        '--judge-command',
        FAKE,
        '--agent-family',
        'anthropic',
      ]);
      expect(same.code).toBe(2);
      expect(same.err).toContain('judge claude-haiku is from the anthropic family');
      const other = await replay([
        '--judge',
        'claude:haiku',
        '--judge-command',
        FAKE,
        '--agent-family',
        'openai',
      ]);
      expect(other.code).toBe(0);
    },
    SLOW,
  );

  it(
    'refuses a council with a judge of the agent family',
    async () => {
      openAiStandIn();
      const council = await replay([
        '--judge',
        'openai:pass-model',
        '--judge',
        'claude:haiku',
        '--judge-command',
        FAKE,
        '--agent-family',
        'openai',
      ]);
      expect(council.code).toBe(2);
      expect(council.err).toContain('the family of the agent under test: refused');
    },
    SLOW,
  );

  it(
    'estate run takes the flag',
    async () => {
      const fixture = join(ROOT, 'examples/estates/fixture');
      const run = await cli([
        'estate',
        'run',
        join(
          fixture,
          'generated/specs/live/obligation/estate.obligation.instruction.route-planner.no-delivery-planned-on-a-public.yaml',
        ),
        '--estate',
        fixture,
        '--runtime',
        'claude-code',
        '--command',
        join(fixture, 'live/fake/claude.mjs'),
        '--store',
        join(await folder(), 'store.db'),
        '--judge',
        'claude:haiku',
        '--judge-command',
        FAKE,
        '--agent-family',
        'anthropic',
      ]);
      expect(run.code).toBe(2);
      expect(run.err).toContain('the family of the agent under test: refused');
    },
    SLOW,
  );
});

describe('row 3: --record, replayed with --judges', () => {
  it(
    'records the live answers and replays them with no call',
    async () => {
      const dir = await folder();
      await writeFile(join(dir, 'judged.yaml'), JUDGED);
      const tape = join(dir, 'judge.cassette.json');
      const recorded = await replay(
        ['--judge', 'claude:haiku', '--judge-command', FAKE, '--record', tape],
        dir,
      );
      expect(recorded.code).toBe(0);
      const cassette = JSON.parse(await readFile(tape, 'utf8')) as {
        judges: { id: string }[];
        entries: unknown[];
      };
      expect(cassette.judges.map((judge) => judge.id)).toEqual(['claude-haiku']);
      expect(cassette.entries.length).toBeGreaterThan(0);

      // The fake would now fail every call: a pass proves the answer came from the recording.
      vi.stubEnv('FAKE_JUDGE_FAIL', 'Add a discount');
      const replayed = await replay(['--judges', tape], dir);
      expect(replayed.err).toBe('');
      expect(replayed.code).toBe(0);
      expect(replayed.doc?.runs[0]?.pass).toBe(true);
    },
    SLOW,
  );

  it(
    'campaign run records too',
    async () => {
      const dir = await folder();
      await writeFile(join(dir, 'echo.yaml'), ECHO_JUDGED);
      const tape = join(dir, 'campaign.cassette.json');
      const run = await cli(
        [
          'campaign',
          'run',
          'echo.yaml',
          ...ECHO,
          '--judge',
          'claude:haiku',
          '--judge-command',
          FAKE,
          '--record',
          tape,
        ],
        dir,
      );
      expect(run.code).toBe(0);
      const cassette = JSON.parse(await readFile(tape, 'utf8')) as { entries: unknown[] };
      expect(cassette.entries.length).toBe(1);
    },
    SLOW,
  );
});

const ECHO_JUDGED = `id: echo-judged
criteria:
  - name: answers
    rubric: The agent answers the customer.
    gating: true
blocks:
  - user: hello
    expect:
      must: ['echo: hello']
      criteria: [answers]
`;

describe('a council from --judges judges each criterion as it asks', () => {
  it(
    'applies repeat to every seat: a recording of pass then fail is inconclusive, not a pass',
    async () => {
      const dir = await folder();
      await writeFile(
        join(dir, 'judged.yaml'),
        JUDGED.replace('scope: block }', 'scope: block, repeat: 2 }'),
      );
      const tools = await folder();
      // A stand-in that answers pass, then fail, then pass: the fake judge with its fail words switched per call.
      const alternating = join(tools, 'alternating.cjs');
      await writeFile(
        alternating,
        [
          '#!/usr/bin/env node',
          '// @driftbench-stand-in: alternates pass and fail. No model call.',
          "const fs = require('node:fs');",
          'const file = process.env.ALT_COUNTER;',
          "const n = fs.existsSync(file) ? Number(fs.readFileSync(file, 'utf8')) : 0;",
          'fs.writeFileSync(file, String(n + 1));',
          "process.env.FAKE_JUDGE_FAIL = n % 2 === 0 ? '' : 'Add a discount';",
          `require(${JSON.stringify(FAKE)});`,
          '',
        ].join('\n'),
      );
      vi.stubEnv('ALT_COUNTER', join(tools, 'counter'));
      const tape = join(tools, 'tape.json');
      const live = await replay(
        ['--judge', 'claude:haiku', '--judge-command', alternating, '--record', tape],
        dir,
      );
      expect(live.doc?.runs[0]?.failing).toEqual(['block 0: judge.keeps-scope (inconclusive)']);
      const cassette = JSON.parse(await readFile(tape, 'utf8')) as { entries: unknown[] };
      expect(cassette.entries).toHaveLength(2);

      const council = await replay(['--judges', tape], dir);
      expect(council.err).toBe('');
      expect(council.code).toBe(1);
      expect(council.doc?.runs[0]?.failing).toEqual(['block 0: judge.keeps-scope (inconclusive)']);
    },
    SLOW,
  );
});

describe('row 1: judges in campaign run, resume, ci and smoke', () => {
  it(
    'campaign run judges the criteria it named, and without a judge leaves them unjudged',
    async () => {
      const dir = await folder();
      await writeFile(join(dir, 'echo.yaml'), ECHO_JUDGED);
      const judged = await cli(
        [
          'campaign',
          'run',
          'echo.yaml',
          ...ECHO,
          '--judge',
          'claude:haiku',
          '--judge-command',
          FAKE,
          '--json',
        ],
        dir,
      );
      expect(judged.err).toBe('');
      expect(judged.code).toBe(0);
      expect(judged.json?.checks).toContain('judge');
      expect(judged.json?.judge).toBe('claude:haiku');
      expect(judged.json?.judgeCostUsd).toBeCloseTo(0.0015);

      vi.stubEnv('FAKE_JUDGE_FAIL', 'echo: hello');
      const failing = await cli(
        [
          'campaign',
          'run',
          'echo.yaml',
          ...ECHO,
          '--judge',
          'claude:haiku',
          '--judge-command',
          FAKE,
          '--json',
        ],
        dir,
      );
      expect(failing.code).toBe(1);
      const cells = failing.json?.cells as { failing: string[] }[];
      expect(cells[0]?.failing.join(' ')).toContain('judge.answers');

      const bare = await cli(['campaign', 'run', 'echo.yaml', ...ECHO], dir);
      expect(bare.out).toContain('Not judged');
      expect(bare.out).not.toContain('Judge claude');
    },
    SLOW,
  );

  it(
    'campaign run takes a recorded council, its mode and its assignment flags',
    async () => {
      const dir = await folder();
      await writeFile(join(dir, 'echo.yaml'), ECHO_JUDGED);
      const tape = join(dir, 'tape.json');
      await cli(
        [
          'campaign',
          'run',
          'echo.yaml',
          ...ECHO,
          '--judge',
          'claude:haiku',
          '--judge-command',
          FAKE,
          '--record',
          tape,
        ],
        dir,
      );
      const council = await cli(['campaign', 'run', 'echo.yaml', ...ECHO, '--judges', tape, '--json'], dir);
      expect(council.code).toBe(0);
      expect(council.json?.judge).toBe('claude-haiku');
      const mode = await cli(
        ['campaign', 'run', 'echo.yaml', ...ECHO, '--judges', tape, '--judge-mode', 'system1'],
        dir,
      );
      expect(mode.code).toBe(2);
      expect(mode.err).toContain('mode system1 needs');
    },
    SLOW,
  );

  it(
    'campaign resume takes the judge, and a shaping flag needs one',
    async () => {
      const dir = await folder();
      await writeFile(join(dir, 'echo.yaml'), ECHO_JUDGED);
      const store = join(dir, 'store.db');
      const run = await cli(
        [
          'campaign',
          'run',
          'echo.yaml',
          ...ECHO,
          '--store',
          store,
          '--judge',
          'claude:haiku',
          '--judge-command',
          FAKE,
        ],
        dir,
      );
      expect(run.code).toBe(0);
      const resumed = await cli(
        [
          'campaign',
          'resume',
          '--store',
          store,
          ...ECHO.slice(2),
          '--judge',
          'claude:haiku',
          '--judge-command',
          FAKE,
        ],
        dir,
      );
      expect(resumed.err).toBe('');
      expect(resumed.out).toContain('Judge claude:haiku, 0.0000 USD.');
      const stray = await cli(['campaign', 'resume', '--store', store, '--judge-budget', '1'], dir);
      expect(stray.code).toBe(2);
      expect(stray.err).toContain('error: --judge-budget needs --judge claude:<model>');
    },
    SLOW,
  );

  it(
    'ci passes the judge to its candidate run',
    async () => {
      const dir = await folder();
      await writeFile(join(dir, 'echo.yaml'), ECHO_JUDGED);
      const store = join(dir, 'store.db');
      const judge = ['--judge', 'claude:haiku', '--judge-command', FAKE];
      const baseline = await cli(['campaign', 'run', 'echo.yaml', ...ECHO, '--store', store, ...judge], dir);
      expect(baseline.code).toBe(0);
      const ci = ['ci', '--specs', 'echo.yaml', ...ECHO, '--baseline', store, '--store', store, '--json'];
      const parity = await cli([...ci, ...judge], dir);
      expect(parity.err).toBe('');
      expect(parity.code).toBe(0);
      vi.stubEnv('FAKE_JUDGE_FAIL', 'echo: hello');
      const regressed = await cli([...ci, ...judge], dir);
      expect(regressed.code).toBe(1);
    },
    SLOW,
  );

  it(
    'smoke lists each run judged verdicts',
    async () => {
      const dir = await folder();
      await writeFile(
        join(dir, 'acme.yaml'),
        `id: acme-judged
target: { adapter: function, agent: acme-sales }
criteria:
  - name: answers
    rubric: The agent answers the customer.
blocks:
  - user: hello
    expect:
      criteria: [answers]
`,
      );
      const smoke = await cli(
        ['smoke', 'acme.yaml', '--runs', '2', '--judge', 'claude:haiku', '--judge-command', FAKE, '--json'],
        dir,
      );
      expect(smoke.err).toBe('');
      const runs = smoke.json?.runs as { judged: { criterion: string; outcome: string }[] }[];
      expect(runs.map((run) => run.judged)).toEqual([
        [{ block: 0, criterion: 'answers', outcome: 'pass' }],
        [{ block: 0, criterion: 'answers', outcome: 'pass' }],
      ]);
      expect(smoke.json?.judgeCostUsd).toBeCloseTo(0.003);
      const bare = await cli(['smoke', 'acme.yaml', '--runs', '2', '--json'], dir);
      expect(bare.json?.judge).toBeUndefined();
      expect((bare.json?.runs as Record<string, unknown>[] | undefined)?.[0]?.judged).toBeUndefined();
    },
    SLOW,
  );
});

describe('row 5: --judge-route escalation', () => {
  it(
    'escalates on its trigger, label-blind, and keeps the first answer otherwise',
    async () => {
      openAiStandIn();
      const route = [
        '--judge-route',
        'escalation',
        '--route-first',
        'claude:haiku',
        '--route-then',
        'openai:fail-model',
      ];
      // The fake claude answers with no score: low confidence escalates, and the then judge fails it.
      const escalated = await replay([...route, '--judge-command', FAKE, '--route-on', 'low-confidence']);
      expect(escalated.err).toBe('');
      expect(escalated.code).toBe(1);
      expect(escalated.doc?.judge).toBe('escalation claude-haiku then openai-fail-model');
      expect(escalated.doc?.runs[0]?.failing).toEqual(['block 0: judge.keeps-scope']);
      const kept = await replay([...route, '--judge-command', FAKE, '--route-on', 'inconclusive']);
      expect(kept.code).toBe(0);
    },
    SLOW,
  );

  it(
    'refuses a route that holds the agent family',
    async () => {
      openAiStandIn();
      const refused = await replay([
        '--judge-route',
        'escalation',
        '--route-first',
        'claude:haiku',
        '--route-then',
        'openai:pass-model',
        '--judge-command',
        FAKE,
        '--agent-family',
        'openai',
      ]);
      expect(refused.code).toBe(2);
      expect(refused.err).toContain('shares the agent family');
    },
    SLOW,
  );

  it(
    'judge run routes recorded judges',
    async () => {
      const dir = await folder();
      await copyFile(join(CRITERIA, 'ledger_intact.yaml'), join(dir, 'ledger_intact.yaml'));
      const routed = await cli([
        'judge',
        'run',
        '--criteria',
        dir,
        '--cassette',
        CASSETTE,
        '--judge-route',
        'escalation',
        '--route-first',
        'openai-chat',
        '--route-then',
        'google-chat',
        '--route-then',
        'anthropic-chat',
        '--json',
      ]);
      const rows = routed.json?.rows as { fixtures: { votes: { judge: string }[] }[] }[];
      expect(rows).toHaveLength(1);
      expect(rows[0]?.fixtures[0]?.votes[0]?.judge).toBe('escalation:openai-chat');
      const missing = await cli([
        'judge',
        'run',
        '--criteria',
        dir,
        '--cassette',
        CASSETTE,
        '--judge-route',
        'escalation',
        '--route-first',
        'nobody',
        '--route-then',
        'google-chat',
      ]);
      expect(missing.code).toBe(2);
      expect(missing.err).toContain('the cassette holds no judge nobody');
    },
    SLOW,
  );
});

describe('row 6: panel weights and council weights', () => {
  it(
    'a weighted panel decides by weight and abstains on a thin margin',
    async () => {
      openAiStandIn();
      const judges = ['--judge', 'openai:pass-model', '--judge', 'openai:fail-model'];
      const weighted = await replay([
        ...judges,
        '--panel-weights',
        'openai-pass-model=2,openai-fail-model=1',
      ]);
      expect(weighted.err).toBe('');
      expect(weighted.code).toBe(0);
      const even = await replay([...judges, '--panel-weights', 'openai-pass-model=1,openai-fail-model=1']);
      expect(even.code).toBe(1);
      expect(even.doc?.runs[0]?.failing).toEqual(['block 0: judge.keeps-scope (inconclusive)']);
      const missing = await replay([...judges, '--panel-weights', 'openai-pass-model=1']);
      expect(missing.code).toBe(2);
      expect(missing.err).toContain('gives no weight to openai-fail-model');
    },
    SLOW,
  );

  it(
    '--weights weighs the council votes',
    async () => {
      openAiStandIn();
      const judges = ['--judge', 'openai:pass-model', '--judge', 'openai:fail-model'];
      const split = await replay(judges);
      expect(split.doc?.runs[0]?.failing).toEqual(['block 0: judge.keeps-scope (inconclusive)']);
      const weighted = await replay([...judges, '--weights', 'openai-pass-model=3,openai-fail-model=1']);
      expect(weighted.code).toBe(0);
    },
    SLOW,
  );

  it(
    'judge run decides recorded judges by a panel',
    async () => {
      const dir = await folder();
      await copyFile(join(CRITERIA, 'plain_language.yaml'), join(dir, 'plain_language.yaml'));
      const panel = await cli([
        'judge',
        'run',
        '--criteria',
        dir,
        '--cassette',
        CASSETTE,
        '--panel-weights',
        's1p-a=1,s1p-b=1,openai-decisions=1,openai-chat=0,google-chat=0,anthropic-chat=0',
        '--json',
      ]);
      const rows = panel.json?.rows as { fixtures: { votes: { judge: string }[] }[] }[];
      expect(rows[0]?.fixtures[0]?.votes[0]?.judge).toMatch(/^panel:s1p-a\+s1p-b\+openai-decisions/);
    },
    SLOW,
  );
});

describe('row 7: --reference-solve', () => {
  it(
    'solves the question blind, then judges against the agreed answer',
    async () => {
      openAiStandIn();
      calls.length = 0;
      const solved = await replay([
        '--judge',
        'openai:pass-model',
        '--reference-solve',
        'openai:solver',
        '--reference-samples',
        '1',
      ]);
      expect(solved.err).toBe('');
      expect(solved.code).toBe(0);
      const solves = calls.filter((call) => call.system.startsWith('Solve the question'));
      expect(solves.map((call) => call.model)).toEqual(['solver']);
      expect(solves[0]?.user).not.toContain('<transcript_data>');
      const judged = calls.filter((call) => call.model === 'pass-model');
      expect(judged).toHaveLength(1);
      expect(judged[0]?.user).toContain('<reference_data>');
      expect(judged[0]?.user).toMatch(/<reference_data>\n42\n/);
    },
    SLOW,
  );

  it(
    'refuses it on a council',
    async () => {
      openAiStandIn();
      const council = await replay([
        '--judge',
        'openai:pass-model',
        '--judge',
        'openai:fail-model',
        '--reference-solve',
        'openai:solver',
      ]);
      expect(council.code).toBe(2);
      expect(council.err).toContain('--reference-solve asks one judge');
    },
    SLOW,
  );
});

describe('row 8 and row 2: judge calibrate with --judge and --judge-route escalation', () => {
  it(
    'measures the deployable route on live stand-in judges',
    async () => {
      openAiStandIn();
      const dir = await folder();
      const out = join(dir, 'route.json');
      const run = await cli([
        'judge',
        'calibrate',
        '--criteria',
        CRITERIA,
        '--labels',
        join(ROOT, 'examples/acme/labels'),
        '--only',
        'plain_language',
        '--repeats',
        '1',
        '--claude-command',
        FAKE,
        '--judge',
        'claude:haiku',
        '--judge',
        'openai:pass-model',
        '--judge-route',
        'escalation',
        '--route-first',
        'claude:haiku',
        '--route-then',
        'openai:pass-model',
        '--route-on',
        'low-confidence',
        '--out',
        out,
        '--json',
      ]);
      expect(run.err).toBe('');
      const report = JSON.parse(await readFile(out, 'utf8')) as {
        first: string;
        escalateTo: string[];
        criteria: { criterion: string; escalated: { why: string }[] }[];
      };
      expect(report.first).toBe('escalation:claude-haiku');
      expect(report.escalateTo).toEqual([]);
      expect(report.criteria[0]?.criterion).toBe('plain_language');
      expect(report.criteria[0]?.escalated.length).toBeGreaterThan(0);
      expect(report.criteria[0]?.escalated.every((row) => row.why === 'low-confidence')).toBe(true);
      const both = await cli([
        'judge',
        'calibrate',
        '--criteria',
        CRITERIA,
        '--labels',
        join(ROOT, 'examples/acme/labels'),
        '--cassette',
        CASSETTE,
        '--cascade',
        '--judge-route',
        'escalation',
        '--out',
        out,
      ]);
      expect(both.code).toBe(2);
      expect(both.err).toContain('give one');
    },
    SLOW,
  );
});

describe('row 24, 25, 26: tool policy, plugin embedder, owner allowlist', () => {
  it(
    '--tool-policy fails a block whose call a rule denies',
    async () => {
      const dir = await folder();
      await writeFile(join(dir, 'judged.yaml'), JUDGED);
      const rules = await folder();
      await writeFile(join(rules, 'policy.yaml'), '- { pattern: Bash, action: deny }\n');
      const denied = await replay(['--tool-policy', join(rules, 'policy.yaml')], dir);
      expect(denied.doc?.runs[0]?.failing).toContain('block 0: tool_policy.Bash');
      const spec = join(ROOT, 'examples/acme/specs/conversations/off-topic-return.yaml');
      await writeFile(join(dir, 'acme-policy.yaml'), 'catalog.*: deny\n');
      const campaign = await cli(
        [
          'campaign',
          'run',
          spec,
          '--target',
          'function:acme',
          '--tool-policy',
          'acme-policy.yaml',
          '--store',
          'runs.db',
          '--json',
        ],
        dir,
      );
      expect(campaign.err).toBe('');
      const cells = campaign.json?.cells as { failing: string[] }[];
      expect(cells[0]?.failing.join(' ')).toContain('tool_policy.catalog.search');
      expect(campaign.json?.checks).toContain('tool_policy');
      // The run itself marks the denied call, as runSpec does with a tool policy.
      const store = openStore(join(dir, 'runs.db'));
      try {
        const [stored] = await store.listRuns({ campaignId: String(campaign.json?.campaignId) });
        const searched = (stored?.blocks ?? [])
          .flatMap((block) => block.observed.toolCalls)
          .filter((call) => call.label === 'catalog.search');
        expect(searched.length).toBeGreaterThan(0);
        expect(searched.every((call) => call.error?.includes('denied by tool policy rule catalog.*'))).toBe(
          true,
        );
      } finally {
        await store.close();
      }
      const bad = await cli(
        ['campaign', 'run', spec, '--target', 'function:acme', '--tool-policy', 'missing.yaml'],
        dir,
      );
      expect(bad.code).toBe(2);
      expect(bad.err).toContain('cannot read the tool policy');
    },
    SLOW,
  );

  it(
    '--embedder scores similarity with the embedder a plugin registered',
    async () => {
      const dir = await folder();
      await writeFile(
        join(dir, 'similar.yaml'),
        `id: similar
blocks:
  - user: hello
    expect:
      similarity: [{ reference: "zzzz qqqq", min: 0.99 }]
`,
      );
      const plugin: DriftbenchPlugin = (api) => {
        api.embedder('always-one', () => ({ id: 'always-one', similarity: async () => 1 }));
      };
      const local = await cli(['campaign', 'run', 'similar.yaml', ...ECHO], dir, [plugin]);
      expect(local.code).toBe(1);
      const plugged = await cli(
        ['campaign', 'run', 'similar.yaml', ...ECHO, '--embedder', 'always-one'],
        dir,
        [plugin],
      );
      expect(plugged.err).toBe('');
      expect(plugged.code).toBe(0);
      const unknown = await cli(['campaign', 'run', 'similar.yaml', ...ECHO, '--embedder', 'nobody'], dir, [
        plugin,
      ]);
      expect(unknown.code).toBe(2);
      expect(unknown.err).toContain('no plugin registered the embedder nobody');
    },
    SLOW,
  );

  it(
    '--owner and --owner-file on campaign run leave the owner values out of the pii check',
    async () => {
      const dir = await folder();
      const owner = ['lee.morgan', 'mailhost.dev'].join('@');
      await writeFile(
        join(dir, 'mail.yaml'),
        `id: mail
blocks:
  - user: write to ${owner}
`,
      );
      const flagged = await cli(['campaign', 'run', 'mail.yaml', ...ECHO, '--json'], dir);
      expect(flagged.code).toBe(1);
      expect((flagged.json?.cells as { failing: string[] }[] | undefined)?.[0]?.failing.join(' ')).toContain(
        'pii.email',
      );
      const owned = await cli(['campaign', 'run', 'mail.yaml', ...ECHO, '--owner', owner, '--json'], dir);
      expect(owned.code).toBe(0);
      await writeFile(join(dir, 'owner.txt'), `# mine\n${owner}\n`);
      const file = await cli(
        ['campaign', 'run', 'mail.yaml', ...ECHO, '--owner-file', 'owner.txt', '--json'],
        dir,
      );
      expect(file.code).toBe(0);
    },
    SLOW,
  );
});
