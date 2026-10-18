import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { UnitTest } from '@agent-nexus/driftbench-generate';
import { expect, it } from 'vitest';
import { ClaudeCodeReader, runUnitTests } from '../../src/index';

it('runs a script using its shebang and passes the fixture stdin to its process', async () => {
  const root = await mkdtemp(join(tmpdir(), 'estate-written-script-'));
  await mkdir(join(root, '.claude/skills/labels/scripts'), { recursive: true });
  const path = '.claude/skills/labels/scripts/uppercase.task';
  await writeFile(join(root, 'CLAUDE.md'), '# Labels\n');
  await writeFile(
    join(root, '.claude/skills/labels/SKILL.md'),
    '---\nname: labels\n---\nRun `scripts/uppercase.task`.\n',
  );
  await writeFile(
    join(root, path),
    '#!/usr/bin/env python3\nimport sys\nprint(sys.stdin.read().upper().strip())\n',
  );
  const test: UnitTest = {
    id: 'label-input',
    planRow: 'row',
    atom: 'uppercase',
    mapHash: 'original',
    recordedOn: 'original',
    title: 'Uppercase a label',
    testType: 'script_fixture',
    target: { kind: 'script', path },
    cases: [
      {
        id: 'input',
        material: 'a label',
        payload: { stdin: 'small crate\n' },
        expected: { decision: 'allow', exitCode: 0, output: 'SMALL CRATE' },
      },
    ],
  };
  const result = await runUnitTests([test], { root, reader: new ClaudeCodeReader() });
  expect(result.results[0]?.status).toBe('pass');
}, 30000);

it('runs a project-relative hook command from the estate working folder', async () => {
  const root = await mkdtemp(join(tmpdir(), 'estate-written-cwd-'));
  await mkdir(join(root, '.claude/hooks'), { recursive: true });
  await writeFile(join(root, 'CLAUDE.md'), '# Reviews\n');
  await writeFile(join(root, '.claude/review.txt'), 'Review is needed.\n');
  await writeFile(join(root, '.claude/hooks/review.sh'), '#!/bin/sh\ncat .claude/review.txt >&2\nexit 2\n');
  const command = 'sh .claude/hooks/review.sh';
  await writeFile(
    join(root, '.claude/settings.json'),
    JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command }] }] } }),
  );
  const test: UnitTest = {
    id: 'review-location',
    planRow: 'row',
    atom: 'hook',
    mapHash: 'original',
    recordedOn: 'original',
    title: 'Review location',
    testType: 'guard_positive',
    target: { kind: 'guard', name: 'review.sh', command, event: 'Stop' },
    cases: [
      {
        id: 'stop',
        material: 'reply',
        payload: { last_reply: 'done' },
        expected: { decision: 'deny', exitCode: 2, message: 'Review is needed.' },
      },
    ],
  };
  const result = await runUnitTests([test], { root, reader: new ClaudeCodeReader() });
  expect(result.results[0]?.status).toBe('pass');
}, 30000);
