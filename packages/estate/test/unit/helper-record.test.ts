import { UnitTest } from '@agent-nexus/driftbench-generate';
import { expect, it } from 'vitest';
import { ClaudeCodeReader, runUnitTests } from '../../src/index';
import { estate } from '../support';

/** A hand-written harbour estate: the executor answers with the first rule of the agent file's body. */
const config = JSON.stringify({
  helpers: { pilot: { command: ['python3', '.claude/executor.py'], timeoutMs: 10000 } },
});
const executor =
  'import json,sys\nmsg=json.loads(sys.stdin.readline())\nbody=msg["systemPrompt"].strip()\n' +
  'if not body:\n    sys.stderr.write("no instructions")\n    sys.exit(1)\n' +
  'print(json.dumps({"text":body.splitlines()[0]+" | "+msg["task"],"segments":[],"toolCalls":[]}))\n';
const agent = (body: string) => `---\nname: pilot\ndescription: Guides ships.\n---\n${body}`;
const files = (body: string) => ({
  'CLAUDE.md': '# Harbour\n',
  '.claude/agents/pilot.md': agent(body),
  '.claude/driftbench.estate.yaml': config,
  '.claude/executor.py': executor,
});

const test = UnitTest.parse({
  id: 'unit.contract_alone.pilot',
  planRow: 'contract_alone.pilot',
  testType: 'contract_alone',
  atom: 'subagent.pilot.helper-pilot',
  title: 'Helper pilot',
  mapHash: 'abc',
  target: { kind: 'subagent', name: 'pilot', file: '.claude/agents/pilot.md' },
  cases: [{ id: 'case-01', payload: { task: 'Berth the Aster.', files: {} }, material: 'Berth the Aster.' }],
});

const run = (root: string, tests: UnitTest[], record = false) =>
  runUnitTests(tests, { root, reader: new ClaudeCodeReader(), record, noSandbox: true });

it('records the answer of a helper run alone on the original, and compares a later run with it', async () => {
  const original = await estate(files('Keep to the channel.\n'));
  const recording = await run(original, [test], true);
  const recorded = recording.results[0]?.recorded;
  expect(recording.results[0]?.status).toBe('pass');
  expect(recorded?.recordedOn).toBe('abc');
  expect(recorded?.cases[0]?.expected).toMatchObject({
    decision: 'allow',
    exitCode: 0,
    output: 'Keep to the channel. | Berth the Aster.',
  });
  const same = await run(original, [recorded as UnitTest]);
  expect(same.results[0]?.status).toBe('pass');
  // The agent file lost its body: the executor has nothing to follow, so the recorded answer is gone.
  const emptied = await estate(files(''));
  const lost = await run(emptied, [recorded as UnitTest]);
  expect(lost.results[0]?.status).toBe('fail');
  expect(lost.results[0]?.detail).toContain('error where allow was recorded');
  // The agent file changed what it asks: another answer.
  const changed = await estate(files('Wait for the tide.\n'));
  expect((await run(changed, [recorded as UnitTest])).results[0]?.status).toBe('fail');
}, 120_000);

it('is unrecorded before a record run, and fails to record when the estate declares no executor', async () => {
  const original = await estate(files('Keep to the channel.\n'));
  expect((await run(original, [test])).results[0]?.status).toBe('unrecorded');
  const bare = await estate({
    'CLAUDE.md': '# Harbour\n',
    '.claude/agents/pilot.md': agent('Keep to the channel.\n'),
  });
  const recording = await run(bare, [test], true);
  expect(recording.results[0]?.status).toBe('fail');
  expect(recording.results[0]?.detail).toContain('configured executor');
}, 120_000);
