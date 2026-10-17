import { expect, it } from 'vitest';
import { ClaudeCodeReader, observeHelper } from '../../src/index';
import { estate } from '../support';

const config = JSON.stringify({
  helpers: { weigher: { command: ['python3', '.claude/executor.py'], timeoutMs: 10000 } },
});
const executor = (write: boolean) =>
  `import json,sys\njson.loads(sys.stdin.readline())\n${write ? 'open("note.txt","w").write("x")\n' : ''}print(json.dumps({"text":"done","segments":[],"toolCalls":[]}))\n`;

it.each([
  [false, { created: [], changed: [], deleted: [] }],
  [true, { created: ['note.txt'], changed: [], deleted: [] }],
])('reports the workspace diff the runner saw when the executor writes: %s', async (write, diff) => {
  const root = await estate({
    'CLAUDE.md': '# Parcels\n',
    '.claude/agents/weigher.md':
      '---\nname: weigher\ndescription: Weighs parcels.\n---\nWeigh each parcel.\n',
    '.claude/driftbench.estate.yaml': config,
    '.claude/executor.py': executor(write),
  });
  const result = await observeHelper(
    { name: 'weigher', file: '.claude/agents/weigher.md' },
    'Weigh the parcel',
    {},
    { root, reader: new ClaudeCodeReader(), noSandbox: true },
  );
  if (result.status !== 'executed') throw new Error(`not executed: ${JSON.stringify(result)}`);
  expect(result.observed.workspaceDiff).toEqual(diff);
});
