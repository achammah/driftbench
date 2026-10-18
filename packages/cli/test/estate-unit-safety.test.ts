import { Expect, type Spec } from '@agent-nexus/driftbench-core';
import { ClaudeCodeReader } from '@agent-nexus/driftbench-estate';
import { expect, it } from 'vitest';
import { estate } from '../../estate/test/support';
import { runUnitSpecs } from '../src/commands/estate-unit-spec';

const unsupported = Object.keys(Expect.shape).filter(
  (key) => !['guards', 'execution', 'workspace'].includes(key),
);
it.each(unsupported)('refuses unsupported expect.%s before executing any operation', async (key) => {
  const root = await estate({
    'CLAUDE.md': '# Fictional parcels\n',
    '.claude/marker.sh': '#!/bin/sh\nprintf specimen\n',
  });
  const spec = {
    id: 'unsupported',
    title: 'Fictional assertion',
    kind: 'task',
    target: { adapter: 'claude-code' },
    blocks: [
      {
        user: 'Inspect a parcel',
        expect: {
          execution: { exit_code: 0 },
          [key]:
            key === 'skills' ? [{ name: 'parcels', count: 1 }] : key === 'must' ? ['unseen phrase'] : null,
        },
      },
    ],
    metadata: {
      estate: {
        mode: 'unit',
        testType: 'script_fixture',
        unit: {
          target: { kind: 'script', path: '.claude/marker.sh' },
          cases: [{ id: 'sample', material: 'parcel', payload: {} }],
        },
      },
    },
  } as unknown as Spec;
  const result = await runUnitSpecs([spec], { root, reader: new ClaudeCodeReader(), noSandbox: true });
  expect(result.inputErrors.join('\n')).toContain(`expect.${key}`);
  expect(result.runs[0]?.pass).toBe(false);
  expect(result.scripts).toEqual([]);
});

function scriptSpec(script: string, workspace: unknown, payload: object = {}): Spec {
  return {
    id: 'workspace',
    title: 'Fictional workspace',
    kind: 'task',
    target: { adapter: 'claude-code' },
    blocks: [{ user: 'Make a parcel', expect: { execution: { exit_code: 0 }, workspace } }],
    metadata: {
      estate: {
        mode: 'unit',
        testType: 'script_fixture',
        unit: {
          target: { kind: 'script', path: `.claude/${script}` },
          cases: [
            { id: 'sample', material: 'parcel', payload, expected: { decision: 'allow', exitCode: 0 } },
          ],
        },
      },
    },
  } as unknown as Spec;
}

it.each([
  ['an unmet created path', { created: ['missing.txt'] }, 'make.sh', /missing\.txt was not created/],
  ['a stray file under others_untouched', { others_untouched: true }, 'make.sh', /parcel\.txt \(created\)/],
  ['a deletion the block forbids', { deleted: [] }, 'drop.sh', /expects nothing deleted/],
])(
  'evaluates expect.workspace against the files a script touches: %s',
  async (_name, workspace, script, message) => {
    const root = await estate({
      'CLAUDE.md': '# Fictional parcels\n',
      '.claude/make.sh': '#!/bin/sh\nprintf parcel > parcel.txt\n',
      '.claude/drop.sh': '#!/bin/sh\nrm -f gone.txt\n',
    });
    const spec = scriptSpec(script, workspace, { files: { 'gone.txt': 'old' } });
    const result = await runUnitSpecs([spec], { root, reader: new ClaudeCodeReader(), noSandbox: true });
    expect(result.inputErrors).toEqual([]);
    expect(result.runs[0]?.pass).toBe(false);
    expect(result.runs[0]?.failing.join('\n')).toMatch(message);
  },
);

it('passes expect.workspace when the diff matches what the script did', async () => {
  const root = await estate({
    'CLAUDE.md': '# Fictional parcels\n',
    '.claude/make.sh': '#!/bin/sh\nprintf parcel > parcel.txt\n',
  });
  const spec = scriptSpec('make.sh', { created: ['parcel.txt'], others_untouched: true });
  const result = await runUnitSpecs([spec], { root, reader: new ClaudeCodeReader(), noSandbox: true });
  expect(result.runs[0]?.failing).toEqual([]);
  expect(result.runs[0]?.pass).toBe(true);
});

it('evaluates expect.workspace on a script that has declared fixtures', async () => {
  const root = await estate({
    'CLAUDE.md': '# Fictional parcels\n',
    '.claude/make.sh': '#!/bin/sh\nprintf parcel > parcel.txt\n',
    '.claude/driftbench.estate.yaml': JSON.stringify({
      scripts: { '.claude/make.sh': [{ expect: { exitCode: 0 } }] },
    }),
  });
  const run = (workspace: unknown) =>
    runUnitSpecs([scriptSpec('make.sh', workspace)], {
      root,
      reader: new ClaudeCodeReader(),
      noSandbox: true,
    });
  expect((await run({ created: ['parcel.txt'], others_untouched: true })).runs[0]?.pass).toBe(true);
  const stray = await run({ others_untouched: true });
  expect(stray.inputErrors).toEqual([]);
  expect(stray.runs[0]?.failing.join('\n')).toMatch(/parcel\.txt \(created\)/);
});

it('counts any firing, a warning included, when a guard expectation names no verdict', async () => {
  const root = await estate({
    'CLAUDE.md': '# Fictional parcels\n',
    '.claude/warn.sh': '#!/bin/sh\ncat > /dev/null\necho "careful" >&2\nexit 1\n',
    '.claude/settings.json': JSON.stringify({
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '.claude/warn.sh' }] }] },
    }),
  });
  const spec = {
    id: 'warn',
    title: 'Fictional guard',
    kind: 'task',
    target: { adapter: 'claude-code' },
    blocks: [{ user: 'Weigh a parcel', expect: { guards: [{ name: 'warn.sh', count: { max: 0 } }] } }],
    metadata: {
      estate: {
        mode: 'unit',
        testType: 'guard_negative',
        unit: {
          target: {
            kind: 'guard',
            name: 'warn.sh',
            event: 'PreToolUse',
            matcher: 'Bash',
            command: '.claude/warn.sh',
          },
          cases: [
            {
              id: 'sample',
              material: 'parcel',
              payload: { tool_name: 'Bash', tool_input: { command: 'ls' } },
            },
          ],
        },
      },
    },
  } as unknown as Spec;
  const result = await runUnitSpecs([spec], { root, reader: new ClaudeCodeReader(), noSandbox: true });
  expect(result.inputErrors).toEqual([]);
  expect(result.runs[0]?.failing.join('\n')).toMatch(/1 matching guard decisions/);
  expect(result.runs[0]?.pass).toBe(false);
});
