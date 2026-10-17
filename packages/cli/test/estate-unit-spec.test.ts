import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { stringify } from 'yaml';
import { main } from '../src/index';

it('executes YAML unit specs from explicit payloads, checks both decisions, and reports real messages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'unit-written-'));
  await mkdir(join(root, '.claude/hooks'), { recursive: true });
  await writeFile(join(root, 'CLAUDE.md'), '# A review estate\n');
  const script = join(root, '.claude/hooks/review.sh');
  await writeFile(
    script,
    '#!/bin/sh\ninput=$(cat)\ncase "$input" in *restricted*) echo "Requires reviewer" >&2; exit 2;; esac\n',
  );
  await chmod(script, 0o755);
  await writeFile(
    join(root, '.claude/settings.json'),
    JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR"/.claude/hooks/review.sh' }],
          },
        ],
      },
    }),
  );
  const file = join(root, 'spec.yaml');
  await writeFile(
    file,
    stringify({
      id: 'review-operation',
      kind: 'task',
      title: 'Review restricted changes',
      target: { adapter: 'claude-code' },
      blocks: [
        {
          user: 'Request review',
          expect: { guards: [{ name: 'review.sh', verdict: 'deny', count: { min: 1 } }] },
        },
      ],
      metadata: {
        estate: {
          mode: 'unit',
          testType: 'guard_positive',
          unit: {
            target: {
              kind: 'guard',
              name: 'review.sh',
              event: 'PreToolUse',
              matcher: 'Bash',
              command: '"$CLAUDE_PROJECT_DIR"/.claude/hooks/review.sh',
            },
            cases: [
              {
                id: 'restricted',
                material: 'restricted',
                payload: { tool_name: 'Bash', tool_input: { command: 'restricted' } },
              },
            ],
          },
        },
      },
    }),
  );
  async function run() {
    let out = '';
    let err = '';
    const code = await main(['estate', 'unit', file, '--estate', root, '--json'], {
      cwd: root,
      out: (t) => {
        out += t;
      },
      err: (t) => {
        err += t;
      },
    });
    return { code, out, err };
  }
  const green = await run();
  expect(green.err).toBe('');
  expect(green.code).toBe(0);
  expect(JSON.parse(green.out).guards).toContainEqual({
    guard: 'review.sh',
    event: 'PreToolUse',
    decision: 'deny',
    message: 'Requires reviewer',
    ms: expect.any(Number),
  });
  await writeFile(script, '#!/bin/sh\ncat >/dev/null\nexit 0\n');
  expect((await run()).code).toBe(1);
}, 30000);

it.each([
  { verdict: 'warn', source: '#!/bin/sh\ncat >/dev/null\necho "Review service unavailable" >&2\nexit 1\n' },
  { verdict: 'nudge', source: '#!/bin/sh\ncat >/dev/null\necho "Remember the review note"\n' },
])(
  'uses the runtime $verdict semantics and never relabels a result to satisfy an expectation',
  async ({ verdict, source }) => {
    const root = await mkdtemp(join(tmpdir(), 'unit-decision-'));
    await mkdir(join(root, '.claude/hooks'), { recursive: true });
    await writeFile(join(root, 'CLAUDE.md'), '# Review hints\n');
    const script = join(root, '.claude/hooks/hint.sh');
    await writeFile(script, source);
    await chmod(script, 0o755);
    const command = '"$CLAUDE_PROJECT_DIR"/.claude/hooks/hint.sh';
    await writeFile(
      join(root, '.claude/settings.json'),
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command }] }] } }),
    );
    const file = join(root, 'operation.json');
    await writeFile(
      file,
      JSON.stringify({
        id: 'hint',
        title: 'Review hint',
        kind: 'task',
        target: { adapter: 'claude-code' },
        blocks: [{ user: 'Conclude the review', expect: { guards: [{ name: 'hint.sh', verdict }] } }],
        metadata: {
          estate: {
            mode: 'unit',
            testType: 'guard_positive',
            unit: {
              target: { kind: 'guard', name: 'hint.sh', event: 'Stop', command, verdict },
              cases: [{ id: 'stop', payload: { last_reply: 'The review ends.' }, material: 'reply' }],
            },
          },
        },
      }),
    );
    async function run() {
      let out = '';
      const code = await main(['estate', 'unit', file, '--estate', root, '--json'], {
        cwd: root,
        out: (t) => {
          out += t;
        },
        err: (t) => {
          out += t;
        },
      });
      return { code, out };
    }
    expect((await run()).code).toBe(0);
    await writeFile(script, '#!/bin/sh\ncat >/dev/null\nexit 2\n');
    const wrong = await run();
    expect(wrong.code).toBe(1);
    expect(JSON.parse(wrong.out).guards[0].decision).toBe('deny');
  },
  30000,
);

it('checks script case outputs and refuses an absent oracle or a helper with no executor', async () => {
  const root = await mkdtemp(join(tmpdir(), 'unit-output-'));
  await mkdir(join(root, '.claude/skills/labels/scripts'), { recursive: true });
  await writeFile(join(root, 'CLAUDE.md'), '# Label operations\n');
  await writeFile(
    join(root, '.claude/skills/labels/SKILL.md'),
    '---\nname: labels\n---\nRun `scripts/label.task`.\n',
  );
  const path = '.claude/skills/labels/scripts/label.task';
  await writeFile(
    join(root, path),
    '#!/usr/bin/env python3\nimport sys\nprint(sys.stdin.read().upper().strip())\n',
  );
  const file = join(root, 'operation.yaml');
  const unit = {
    target: { kind: 'script', path },
    cases: [
      {
        id: 'stdin',
        payload: { stdin: 'blue box' },
        material: 'label',
        expected: { decision: 'allow', exitCode: 0, output: 'BLUE BOX' },
      },
    ],
  };
  const spec = {
    id: 'label-output',
    title: 'Uppercase a label',
    kind: 'task',
    target: { adapter: 'claude-code' },
    blocks: [{ user: 'Prepare the label', expect: { execution: { ran_code: true } } }],
    metadata: { estate: { mode: 'unit', testType: 'script_fixture', unit } },
  };
  async function run(value: unknown) {
    await writeFile(file, stringify(value));
    let out = '';
    let err = '';
    const code = await main(['estate', 'unit', file, '--estate', root, '--json'], {
      cwd: root,
      out: (t) => {
        out += t;
      },
      err: (t) => {
        err += t;
      },
    });
    return { code, out, err };
  }
  expect((await run(spec)).code).toBe(0);
  await writeFile(join(root, path), '#!/usr/bin/env python3\nprint("wrong output")\n');
  expect((await run(spec)).code).toBe(1);
  const noOracle = {
    ...spec,
    metadata: {
      estate: {
        ...spec.metadata.estate,
        unit: { ...unit, cases: unit.cases.map(({ expected: _expected, ...c }) => c) },
      },
    },
  };
  const unsupported = await run(noOracle);
  expect(unsupported.code).toBe(2);
  expect(unsupported.err).toContain('no expected exit or output');
  expect(unsupported.out).toBe('');
  const helper = await run({
    ...spec,
    metadata: {
      estate: {
        mode: 'unit',
        testType: 'contract_alone',
        unit: {
          target: { kind: 'subagent', name: 'reviewer', file: '.claude/agents/reviewer.md' },
          cases: [],
        },
      },
    },
  });
  expect(helper.code).toBe(2);
  expect(helper.err).toContain('configured executor');
  expect(helper.out).toBe('');
}, 30000);

it('preserves explicitly declared reply payload fields and empty values', async () => {
  const root = await mkdtemp(join(tmpdir(), 'unit-payload-'));
  await mkdir(join(root, '.claude/hooks'), { recursive: true });
  await writeFile(join(root, 'CLAUDE.md'), '# Payload handling\n');
  await writeFile(
    join(root, '.claude/hooks/echo.py'),
    'import json,sys\ne=json.load(sys.stdin)\nprint(json.dumps([e["last_reply"],e["last_assistant_message"]]))\n',
  );
  const command = 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/echo.py';
  await writeFile(
    join(root, '.claude/settings.json'),
    JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command }] }] } }),
  );
  const file = join(root, 'operation.yaml');
  await writeFile(
    file,
    stringify({
      id: 'literal-payload',
      title: 'Preserve the declared event',
      kind: 'task',
      target: { adapter: 'claude-code' },
      blocks: [{ user: 'Inspect the event' }],
      metadata: {
        estate: {
          mode: 'unit',
          testType: 'guard_positive',
          unit: {
            target: { kind: 'guard', name: 'echo.py', command, event: 'Stop' },
            cases: [
              {
                id: 'empty',
                material: 'empty reply',
                payload: { last_reply: '' },
                expected: { decision: 'allow', exitCode: 0, output: '["", ""]' },
              },
            ],
          },
        },
      },
    }),
  );
  let out = '';
  let err = '';
  const code = await main(['estate', 'unit', file, '--estate', root, '--json'], {
    cwd: root,
    out: (t) => {
      out += t;
    },
    err: (t) => {
      err += t;
    },
  });
  expect(err).toBe('');
  expect(code, out).toBe(0);
}, 30000);

it.each([
  { title: 'ran_code false', execution: { ran_code: false }, custom: undefined, code: 1 },
  { title: 'command limit', execution: { max_commands: 0 }, custom: undefined, code: 1 },
  { title: 'unsupported custom check', execution: undefined, custom: { unknown_check: {} }, code: 2 },
])(
  'enforces script $title instead of dropping the assertion',
  async ({ execution, custom, code: expected }) => {
    const root = await mkdtemp(join(tmpdir(), 'unit-script-assertion-'));
    await mkdir(join(root, '.claude/skills/sample/scripts'), { recursive: true });
    await writeFile(join(root, 'CLAUDE.md'), '# Samples\n');
    await writeFile(
      join(root, '.claude/skills/sample/SKILL.md'),
      '---\nname: sample\n---\nRun `scripts/sample.sh`.\n',
    );
    const path = '.claude/skills/sample/scripts/sample.sh';
    await writeFile(join(root, path), '#!/bin/sh\nprintf specimen\n');
    const file = join(root, 'operation.yaml');
    await writeFile(
      file,
      stringify({
        id: 'script-assertion',
        title: 'Sample execution',
        kind: 'task',
        target: { adapter: 'claude-code' },
        blocks: [{ user: 'Produce a sample', ...(execution ? { expect: { execution } } : {}) }],
        ...(custom ? { rules: { custom } } : {}),
        metadata: {
          estate: {
            mode: 'unit',
            testType: 'script_fixture',
            unit: {
              target: { kind: 'script', path },
              cases: [
                {
                  id: 'sample',
                  payload: {},
                  material: 'sample',
                  expected: { decision: 'allow', exitCode: 0, output: 'specimen' },
                },
              ],
            },
          },
        },
      }),
    );
    let out = '';
    let err = '';
    const code = await main(['estate', 'unit', file, '--estate', root, '--json'], {
      cwd: root,
      out: (t) => {
        out += t;
      },
      err: (t) => {
        err += t;
      },
    });
    expect(code, `${out}\n${err}`).toBe(expected);
  },
  30000,
);

it('applies a script exit expectation to the last command while case oracles cover each fixture', async () => {
  const root = await mkdtemp(join(tmpdir(), 'unit-last-command-'));
  await mkdir(join(root, '.claude/skills/sample/scripts'), { recursive: true });
  await writeFile(join(root, 'CLAUDE.md'), '# Samples\n');
  await writeFile(
    join(root, '.claude/skills/sample/SKILL.md'),
    '---\nname: sample\n---\nRun `scripts/sample.sh`.\n',
  );
  const path = '.claude/skills/sample/scripts/sample.sh';
  await writeFile(
    join(root, path),
    '#!/bin/sh\nif [ "$1" = reject ]; then printf rejected; exit 1; fi\nprintf specimen\n',
  );
  const file = join(root, 'operation.yaml');
  await writeFile(
    file,
    stringify({
      id: 'last-command',
      title: 'Fixture outcomes',
      kind: 'task',
      target: { adapter: 'claude-code' },
      blocks: [
        {
          user: 'Exercise both outcomes',
          expect: { execution: { exit_code: 0, max_commands: 2, ran_code: true } },
        },
      ],
      metadata: {
        estate: {
          mode: 'unit',
          testType: 'script_fixture',
          unit: {
            target: { kind: 'script', path },
            cases: [
              {
                id: 'reject',
                payload: { args: ['reject'] },
                material: 'reject',
                expected: { decision: 'error', exitCode: 1, output: 'rejected' },
              },
              {
                id: 'accept',
                payload: { args: ['accept'] },
                material: 'accept',
                expected: { decision: 'allow', exitCode: 0, output: 'specimen' },
              },
            ],
          },
        },
      },
    }),
  );
  let out = '';
  let err = '';
  const code = await main(['estate', 'unit', file, '--estate', root, '--json'], {
    cwd: root,
    out: (t) => {
      out += t;
    },
    err: (t) => {
      err += t;
    },
  });
  expect(err).toBe('');
  expect(code, out).toBe(0);
}, 30000);
