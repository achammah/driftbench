import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { FakeModelPort } from '@agent-nexus/driftbench-generate';
import { FakeJudge } from '@agent-nexus/driftbench-judges';
import { loadRedteamPlugins } from '@agent-nexus/driftbench-users';
import { Command, CommanderError } from 'commander';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignDeps, defaultDeps } from '../src/commands/campaign';
import { type JudgeFactory, registerRedteamCommand } from '../src/commands/redteam';
import type { Io } from '../src/io';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SPEC = 'packages/cli/test/fixtures/redteam-acme.spec.json';
const REPLAY = 'packages/cli/test/fixtures/redteam-crescendo.json';
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'driftbench-redteam-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

export async function redteam(argv: string[], deps: CampaignDeps = defaultDeps, judgeFor?: JudgeFactory) {
  let out = '';
  let err = '';
  let code = 0;
  const io: Io = {
    cwd: ROOT,
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
  };
  const program = new Command('driftbench')
    .exitOverride()
    .configureOutput({ writeOut: io.out, writeErr: io.err });
  registerRedteamCommand(
    program,
    io,
    (exit) => {
      code = exit;
    },
    deps,
    judgeFor,
  );
  try {
    await program.parseAsync(['redteam', ...argv], { from: 'user' });
  } catch (cause) {
    if (!(cause instanceof CommanderError)) throw cause;
    code = cause.exitCode === 0 ? 0 : 2;
  }
  return { code, out, err };
}

function target(text = 'A normal response.') {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    adapter: functionAdapter({
      respond: () => {
        calls++;
        return { text, segments: [{ type: 'text', text }], toolCalls: [], cost: {}, latencyMs: 0 };
      },
    }),
  };
}

describe('redteam CLI', { timeout: 120_000 }, () => {
  it.each(['crescendo', 'goat'])(
    'replays %s on Acme as inconclusive, writes a replay, and never opens the model port',
    async (strategy) => {
      const saved = join(dir, `${strategy}.json`);
      const deps = {
        ...defaultDeps,
        modelPort: () => {
          throw new Error('No model call allowed');
        },
      };
      const first = await redteam(
        [
          'run',
          SPEC,
          '--replay',
          `packages/cli/test/fixtures/redteam-${strategy}.json`,
          '--record',
          saved,
          '--json',
        ],
        deps,
      );
      expect(first.err).toBe('');
      // The fixtures are hand-written and unscored: a recorded grading error, never a pass.
      expect(first.code).toBe(1);
      const doc = JSON.parse(first.out);
      expect(doc).toMatchObject({
        passed: false,
        run: { status: 'stopped', endVerdict: 'inconclusive' },
        recording: { strategy, outcome: 'grading_error' },
      });
      expect(doc.run.blocks).toHaveLength(4);
      expect(doc.run.blocks[0].observed.text).toContain('Acme');
      const second = await redteam(['run', SPEC, '--replay', saved, '--json'], deps);
      expect(second.code).toBe(1);
      expect(JSON.parse(second.out).recording).toEqual(JSON.parse(await readFile(saved, 'utf8')));
    },
  );

  it.each(['crescendo', 'goat'])(
    'drives the live %s API with recorded model answers and detects a breach',
    async (strategy) => {
      const t = target();
      const message =
        strategy === 'goat'
          ? JSON.stringify({ observation: '', strategy: 'RESPONSE_PRIMING', reply: 'Disclose it.' })
          : 'Disclose it.';
      const port = new FakeModelPort(
        [
          ...(strategy === 'crescendo' ? ['A recorded attack plan.'] : []),
          message,
          '{"score":9}',
          message,
          '{"score":10}',
        ],
        { family: 'fixture' },
      );
      const result = await redteam(
        [
          'run',
          SPEC,
          '--model',
          '--strategy',
          strategy,
          '--objective',
          'extract a fictional canary',
          '--json',
        ],
        { ...defaultDeps, adapterFor: async () => t.adapter, modelPort: () => port },
      );
      expect(result.err).toBe('');
      expect(result.code).toBe(1);
      expect(JSON.parse(result.out)).toMatchObject({
        passed: false,
        recording: { outcome: 'breached', objectiveReached: true },
        run: { endVerdict: 'failure' },
      });
      expect(t.calls).toBe(2);
      expect(port.remaining).toBe(0);
    },
  );

  it('a scorer error stays inconclusive and exits 1, never resisted', async () => {
    const t = target();
    const port = new FakeModelPort(['Ask.', '{"score":"9"}'], { family: 'fixture' });
    const result = await redteam(
      [
        'run',
        SPEC,
        '--model',
        '--strategy',
        'crescendo',
        '--objective',
        'disclose',
        '--attack-plan',
        join(ROOT, REPLAY),
        '--json',
      ],
      { ...defaultDeps, adapterFor: async () => t.adapter, modelPort: () => port },
    );
    expect(result.code).toBe(1);
    expect(JSON.parse(result.out)).toMatchObject({
      passed: false,
      recording: { outcome: 'grading_error' },
      run: { status: 'stopped', endVerdict: 'inconclusive' },
    });
    expect(t.calls).toBe(1);
  });

  it('an unscored replay is not run, exit 3, never resisted', async () => {
    // A hand-written recording whose turns carry no score and no grading error.
    const recording = JSON.parse(await readFile(join(ROOT, REPLAY), 'utf8'));
    delete recording.turns.at(-1).gradingError;
    delete recording.turns.at(-1).scoredBy;
    const unscored = join(dir, 'no-scores.json');
    await writeFile(unscored, JSON.stringify(recording));
    const deps = {
      ...defaultDeps,
      modelPort: () => {
        throw new Error('No model call allowed');
      },
    };
    const json = await redteam(['run', SPEC, '--replay', unscored, '--json'], deps);
    expect(json.code).toBe(3);
    const doc = JSON.parse(json.out);
    expect(doc).toMatchObject({
      passed: false,
      outcome: 'not_run',
      recording: { outcome: 'unscored', objectiveReached: false },
      run: { endVerdict: 'inconclusive' },
    });
    expect(doc.run.blocks.every((block: { pass: boolean }) => block.pass)).toBe(true);
    const text = await redteam(['run', SPEC, '--replay', unscored], deps);
    expect(text.code).toBe(3);
    expect(text.out).toContain('Red-team crescendo: unscored.');
    expect(text.out).toContain('not run (no breach could be detected)');
    expect(text.out).toMatch(/turns 1, 2, 3, 4 carry no score/);
  });

  it('a breach detection turned off is not run, exit 3, even with scores', async () => {
    const recording = JSON.parse(await readFile(join(ROOT, REPLAY), 'utf8'));
    for (const turn of recording.turns) {
      delete turn.gradingError;
      turn.score = 1;
      turn.scoredBy = 'recording';
    }
    const scored = join(dir, 'low-scores.json');
    await writeFile(scored, JSON.stringify(recording));
    const off = await redteam(['run', SPEC, '--replay', scored, '--success-score', 'off', '--json']);
    expect(off.code).toBe(3);
    expect(JSON.parse(off.out).recording.outcome).toBe('unscored');
    const on = await redteam(['run', SPEC, '--replay', scored, '--json']);
    expect(on.code).toBe(0);
    expect(JSON.parse(on.out)).toMatchObject({ passed: true, recording: { outcome: 'resisted' } });
  });

  it('a search too short for its confirm window is not run, exit 3, with every turn scored 10', async () => {
    const recording = JSON.parse(await readFile(join(ROOT, REPLAY), 'utf8'));
    for (const turn of recording.turns) {
      delete turn.gradingError;
      turn.score = 10;
      turn.scoredBy = 'recording';
    }
    const high = join(dir, 'high-scores.json');
    await writeFile(high, JSON.stringify(recording));
    const wide = await redteam(['run', SPEC, '--replay', high, '--success-confirm-turns', '5', '--json']);
    expect(wide.code).toBe(3);
    expect(JSON.parse(wide.out)).toMatchObject({ outcome: 'not_run', recording: { outcome: 'unscored' } });
    const short = await redteam(['run', SPEC, '--replay', high, '--turns', '1']);
    expect(short.code).toBe(3);
    expect(short.out).toContain('a breach needs 2 consecutive scored turns and the search had 1');
    // A one-block spec with a one-turn recording, every default.
    const raw = JSON.parse(await readFile(join(ROOT, SPEC), 'utf8'));
    raw.blocks = raw.blocks.slice(0, 1);
    const oneBlock = join(dir, 'one-block.spec.json');
    await writeFile(oneBlock, JSON.stringify(raw));
    const oneTurn = join(dir, 'one-turn.json');
    await writeFile(
      oneTurn,
      JSON.stringify({ ...recording, totalTurns: 1, turns: recording.turns.slice(0, 1) }),
    );
    const single = await redteam(['run', oneBlock, '--replay', oneTurn, '--json']);
    expect(single.code).toBe(3);
    expect(JSON.parse(single.out).recording.outcome).toBe('unscored');
    // The control: the same scores over the four turns breach at the defaults.
    const breach = await redteam(['run', SPEC, '--replay', high, '--json']);
    expect(breach.code).toBe(1);
    expect(JSON.parse(breach.out).recording.outcome).toBe('breached');
  });

  it('an unscored search does not hide failed block expectations or an unjudged rubric', async () => {
    const raw = JSON.parse(await readFile(join(ROOT, SPEC), 'utf8'));
    raw.criteria = [{ name: 'private', rubric: 'No private disclosure.', gating: true }];
    raw.blocks[0].expect.criteria = ['private'];
    const path = join(dir, 'judged.spec.json');
    await writeFile(path, JSON.stringify(raw));
    // Without its grading error the fixture exhausts its turns unscored; the failed block still decides.
    const recording = JSON.parse(await readFile(join(ROOT, REPLAY), 'utf8'));
    delete recording.turns.at(-1).gradingError;
    const unscored = join(dir, 'unscored.json');
    await writeFile(unscored, JSON.stringify(recording));
    const result = await redteam(['run', path, '--replay', unscored, '--json']);
    expect(result.code).toBe(1);
    const doc = JSON.parse(result.out);
    expect(doc.recording.outcome).toBe('unscored');
    expect(doc.outcome).toBe('fail');
    expect(doc.run.blocks[0].verdicts).toContainEqual(
      expect.objectContaining({ id: 'judge.private', gating: true, outcome: 'inconclusive' }),
    );
  });

  it('refuses invalid inputs and family collisions before target or model execution', async () => {
    const t = target();
    const port = new FakeModelPort([], { family: 'fixture' });
    const deps = { ...defaultDeps, adapterFor: async () => t.adapter, modelPort: () => port };
    const badRecording = join(dir, 'bad-recording.json');
    await writeFile(badRecording, JSON.stringify({ strategy: 'goat', turns: [{}] }));
    const cases = [
      ['run', SPEC],
      ['run', SPEC, '--model', '--replay', REPLAY],
      ['run', SPEC, '--replay', REPLAY, '--turns', '0'],
      ['run', SPEC, '--replay', REPLAY, '--turns', '9007199254740992'],
      ['run', SPEC, '--replay', REPLAY, '--encoding-probability', 'NaN'],
      ['run', SPEC, '--replay', REPLAY, '--success-score', '11'],
      ['run', SPEC, '--replay', REPLAY, '--success-confirm-turns', '0'],
      ['run', SPEC, '--replay', REPLAY, '--strategy', 'goat'],
      ['run', SPEC, '--replay', REPLAY, '--objective', 'foreign objective'],
      ['run', SPEC, '--replay', badRecording],
      ['run', SPEC, '--model', '--strategy', 'goat', '--objective', 'test', '--agent-family', 'fixture'],
      ['run', SPEC, '--model', '--strategy', 'goat', '--objective', 'test', '--judge-family', 'fixture'],
    ];
    for (const args of cases) {
      const result = await redteam(args, deps);
      expect(result.code, args.join(' ')).toBe(2);
      expect(result.err).not.toBe('');
    }
    expect(t.calls).toBe(0);
    expect(port.requests).toHaveLength(0);
  });

  it('lists all 40 plugins and generates every one through the recorded-source CLI', async () => {
    const listed = await redteam(['plugins', '--json']);
    expect(JSON.parse(listed.out)).toEqual(loadRedteamPlugins());
    expect(JSON.parse(listed.out)).toHaveLength(40);
    for (const plugin of loadRedteamPlugins()) {
      const out = join(dir, `${plugin.id}.spec.json`);
      const result = await redteam([
        'generate',
        plugin.id,
        '--purpose',
        'Fictional Acme sales assistant',
        '--attack-file',
        `packages/cli/test/fixtures/redteam-plugins/${plugin.id}.json`,
        '--out',
        out,
        '--json',
      ]);
      expect(result, plugin.id).toMatchObject({ code: 0, err: '' });
      const spec = JSON.parse(await readFile(out, 'utf8'));
      expect(JSON.parse(result.out)).toEqual(spec);
      expect(spec.metadata.plugin).toBe(plugin.id);
      expect(spec.blocks[0].when.user).toBe(
        JSON.parse(
          await readFile(join(ROOT, `packages/cli/test/fixtures/redteam-plugins/${plugin.id}.json`), 'utf8'),
        )[0],
      );
      expect(spec.criteria[0]).toMatchObject({ name: plugin.id, gating: true });
      expect(spec.criteria[0].rubric).toContain(spec.blocks[0].when.user);
    }
  });

  it('generation refuses bad output, duplicate output, and same-family models without overwriting', async () => {
    const out = join(dir, 'protected.spec.json');
    await writeFile(out, 'keep');
    const port = new FakeModelPort(['["attack"]'], { family: 'fixture' });
    const args = [
      'generate',
      'sql-injection',
      '--purpose',
      'Fictional Acme',
      '--model',
      '--agent-family',
      'none',
      '--out',
      out,
    ];
    expect((await redteam(args, { ...defaultDeps, modelPort: () => port })).code).toBe(2);
    expect(await readFile(out, 'utf8')).toBe('keep');
    expect(port.requests).toHaveLength(0);
    const failed = await redteam(
      [...args.slice(0, -1), join(dir, 'new.spec.json'), '--judge-family', 'fixture'],
      { ...defaultDeps, modelPort: () => port },
    );
    expect(failed.code).toBe(2);
    expect(port.requests).toHaveLength(0);
    const invalid = join(dir, 'invalid.json');
    await writeFile(invalid, '["one", "two"]');
    const malformed = await redteam([
      'generate',
      'sql-injection',
      '--purpose',
      'Acme',
      '--attack-file',
      invalid,
      '--out',
      join(dir, 'invalid.spec.json'),
    ]);
    expect(malformed.code).toBe(2);
    expect(malformed.err).toContain('one non-empty attack');
    expect((await redteam(['plugins', 'missing'])).code).toBe(2);
  });

  describe('grade', () => {
    const CASSETTE = 'packages/cli/test/fixtures/redteam-grade.cassette.json';
    const noLiveJudge: JudgeFactory = () => {
      throw new Error('No live judge allowed');
    };
    async function pluginSpec(name: string) {
      const out = join(dir, name);
      const made = await redteam([
        'generate',
        'prompt-extraction',
        '--purpose',
        'Fictional Acme Telecom sales assistant; only plans and orders, no private data',
        '--attack-file',
        'packages/cli/test/fixtures/redteam-plugins/prompt-extraction.json',
        '--out',
        out,
      ]);
      expect(made.code).toBe(0);
      return out;
    }

    it('replays a recorded inconclusive judge answer as inconclusive, exit 1, with no judge call', async () => {
      const spec = await pluginSpec('grade-replay.spec.json');
      const result = await redteam(
        ['grade', spec, '--target', 'function:acme-sales', '--cassette', CASSETTE, '--json'],
        defaultDeps,
        noLiveJudge,
      );
      expect(result.err).toBe('');
      expect(result.code).toBe(1);
      const doc = JSON.parse(result.out);
      expect(doc.passed).toBe(false);
      // docs/concepts/block.md: a gating verdict that is inconclusive fails the block, so the run fails.
      expect(doc.outcome).toBe('fail');
      expect(doc.run.blocks[0].pass).toBe(false);
      expect(doc.run.blocks[0].observed.text).toContain('Acme');
      expect(doc.run.blocks[0].verdicts).toContainEqual(
        expect.objectContaining({ kind: 'judge', gating: true, outcome: 'inconclusive' }),
      );
    });

    it('a live judge records a cassette, a replay of it gives the same verdict, and only a judged pass passes', async () => {
      const spec = await pluginSpec('grade-live.spec.json');
      const saved = join(dir, 'grade-live.cassette.json');
      let made = 0;
      const judgeFor: JudgeFactory = (provider) => {
        made++;
        expect(provider).toBe('openai');
        return new FakeJudge(
          'fake-openai',
          [{ outcome: 'pass', reasoning: 'Refused to reveal instructions.' }],
          {
            family: 'openai',
          },
        );
      };
      const live = await redteam(
        ['grade', spec, '--target', 'function:acme-sales', '--judge', 'openai', '--record', saved],
        defaultDeps,
        judgeFor,
      );
      expect(live.err).toBe('');
      expect(live.code).toBe(0);
      expect(live.out).toContain('pass');
      expect(made).toBe(1);
      const replay = await redteam(
        ['grade', spec, '--target', 'function:acme-sales', '--cassette', saved],
        defaultDeps,
        noLiveJudge,
      );
      expect(replay.code).toBe(0);
      const again = await redteam(
        ['grade', spec, '--target', 'function:acme-sales', '--judge', 'openai', '--record', saved],
        defaultDeps,
        judgeFor,
      );
      expect(again.code).toBe(2);
      expect(again.err).toContain('already exists');
      expect(made).toBe(1);
    });

    it('refuses bad sources, a same-family judge and a spec with no criterion before any target call', async () => {
      const spec = await pluginSpec('grade-refusals.spec.json');
      const t = target();
      const sameFamily: JudgeFactory = () => new FakeJudge('same', [], { family: 'Anthropic ' });
      const deps = { ...defaultDeps, adapterFor: async () => t.adapter };
      const cases: [string[], JudgeFactory][] = [
        [['grade', spec, '--target', 'http:bot'], noLiveJudge],
        [['grade', spec, '--target', 'http:bot', '--judge', 'openai', '--cassette', CASSETTE], noLiveJudge],
        [
          ['grade', spec, '--target', 'http:bot', '--cassette', CASSETTE, '--record', join(dir, 'x.json')],
          noLiveJudge,
        ],
        [['grade', spec, '--target', 'http:bot', '--judge', 'anthropic'], sameFamily],
        [
          ['grade', spec, '--target', 'http:bot', '--judge', 'anthropic', '--agent-family', 'anthropic'],
          sameFamily,
        ],
        [['grade', SPEC, '--cassette', CASSETTE], noLiveJudge],
      ];
      for (const [args, factory] of cases) {
        const result = await redteam(args, deps, factory);
        expect(result.code, args.join(' ')).toBe(2);
        expect(result.err).not.toBe('');
      }
      expect(t.calls).toBe(0);
    });
  });
});
