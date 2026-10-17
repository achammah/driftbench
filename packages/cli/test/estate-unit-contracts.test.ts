import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { stringify } from 'yaml';
import { main } from '../src/index';

async function estate() {
  const root = await mkdtemp(join(tmpdir(), 'unit-contracts-'));
  await mkdir(join(root, '.claude/agents'), { recursive: true });
  await mkdir(join(root, '.claude/skills/labels/scripts'), { recursive: true });
  await writeFile(join(root, 'CLAUDE.md'), '# Label estate\n');
  await writeFile(
    join(root, '.claude/skills/labels/SKILL.md'),
    '---\nname: labels\n---\nRun `scripts/label.py`.\n',
  );
  return root;
}
async function run(root: string, spec: unknown) {
  const file = join(root, 'spec.yaml');
  await writeFile(file, stringify(spec));
  let out = '',
    err = '';
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
function spec(target: object, expect: object, cases: unknown[] = [], custom?: object) {
  return {
    id: 'label-contract',
    title: 'Label contract',
    kind: 'task',
    target: { adapter: 'claude-code' },
    blocks: [{ user: 'Read .claude/labels.txt and transform its label.', expect }],
    ...(custom ? { rules: { custom } } : {}),
    metadata: { estate: { mode: 'unit', testType: 'contract_alone', unit: { target, cases } } },
  };
}

it('executes a declared helper with its current body and task, and checks actual output', async () => {
  const root = await estate();
  await writeFile(join(root, '.claude/labels.txt'), 'blue crate\n');
  const helper = '.claude/agents/labeler.md';
  await writeFile(join(root, helper), '---\nname: labeler\ntools: Read\n---\nuppercase\n');
  // An independent local interpreter: the helper body selects an actual transformation of a file.
  await writeFile(
    join(root, '.claude/execute.py'),
    `import json,sys,pathlib
r=json.load(sys.stdin)
assert 'Read .claude/labels.txt' in r['task']
s=pathlib.Path('.claude/labels.txt').read_text().strip()
if r['systemPrompt'].strip() == 'uppercase': s=s.upper()
elif r['systemPrompt'].strip() == 'lowercase': s=s.lower()
else: raise ValueError('unknown label program')
print(json.dumps({'text':s,'segments':[{'type':'text','text':s}],'toolCalls':[{'label':'Read','input':{'file_path':'.claude/labels.txt'},'output':s}]}))
`,
  );
  await writeFile(
    join(root, 'driftbench.estate.yaml'),
    stringify({ helpers: { labeler: { command: ['python3', '.claude/execute.py'], timeoutMs: 3000 } } }),
  );
  const test = spec(
    { kind: 'subagent', name: 'labeler', file: helper },
    { exact: 'BLUE CRATE', exact_strict: true },
    [],
    {
      some_call: { calls: [{ label: 'Read', input: { file_path: { exact: '.claude/labels.txt' } } }] },
    },
  );
  const green = await run(root, test);
  expect(green.err).toBe('');
  expect(green.code, green.out).toBe(0);
  expect(JSON.parse(green.out).helpers[0]).toMatchObject({ helper: 'labeler', exit: 0, text: 'BLUE CRATE' });
  await writeFile(join(root, helper), '---\nname: labeler\n---\nlowercase\n');
  expect((await run(root, test)).code).toBe(1);
  await writeFile(join(root, helper), '---\nname: labeler\n---\n');
  const blank = await run(root, test);
  expect(blank.code).toBe(1);
  expect(JSON.parse(blank.out).helpers[0].exit).toBe(1);
}, 90000);

it.each(['missing', 'invalid-json', 'empty', 'timeout', 'exit'])(
  'never passes a helper with %s execution',
  async (failure) => {
    const root = await estate();
    const helper = '.claude/agents/labeler.md';
    await writeFile(join(root, helper), '---\nname: labeler\n---\nuppercase\n');
    const program =
      failure === 'timeout'
        ? 'sleep 2'
        : failure === 'exit'
          ? 'exit 4'
          : failure === 'invalid-json'
            ? 'echo hello'
            : "echo '{}'";
    if (failure !== 'missing')
      await writeFile(
        join(root, 'driftbench.estate.yaml'),
        stringify({ helpers: { labeler: { command: ['sh', '-c', program], timeoutMs: 50 } } }),
      );
    const result = await run(
      root,
      spec({ kind: 'subagent', name: 'labeler', file: helper }, { exact: 'BLUE CRATE', exact_strict: true }),
    );
    expect(result.code).toBe(failure === 'missing' ? 2 : 1);
  },
  30000,
);

it('uses documented script fixtures as independent exit and output oracles, with supported call checks', async () => {
  const root = await estate();
  const path = '.claude/skills/labels/scripts/label.py';
  await writeFile(
    join(root, path),
    '#!/usr/bin/env python3\nimport sys\nprint(sys.stdin.read().strip().upper())\n',
  );
  await writeFile(
    join(root, 'driftbench.estate.yaml'),
    stringify({
      scripts: {
        [path]: {
          usage: 'label.py < label',
          fixtures: [{ stdin: 'green parcel', expect: { exitCode: 0, stdout: 'GREEN PARCEL' } }],
        },
      },
    }),
  );
  const test = spec({ kind: 'script', path }, { execution: { ran_code: true, exit_code: 0 } }, [], {
    some_call: { calls: [{ label: 'Bash', input: { command: { contains: 'scripts/label.py' } } }] },
  });
  const green = await run(root, test);
  expect(green.err).toBe('');
  expect(green.code, green.out).toBe(0);
  await writeFile(join(root, path), '#!/usr/bin/env python3\nprint("wrong")\n');
  expect((await run(root, test)).code).toBe(1);
  await writeFile(join(root, path), '#!/bin/sh\nexit 7\n');
  expect((await run(root, test)).code).toBe(1);
}, 30000);

it('refuses usage-only script contracts and trace checks for commands never executed', async () => {
  const root = await estate();
  const path = '.claude/skills/labels/scripts/label.py';
  await writeFile(join(root, path), '#!/usr/bin/env python3\nprint("Usage: label.py")\n');
  await writeFile(
    join(root, 'driftbench.estate.yaml'),
    stringify({ scripts: { [path]: { usage: 'label.py', fixtures: [{ args: [] }] } } }),
  );
  const test = spec({ kind: 'script', path }, { execution: { ran_code: true } });
  expect((await run(root, test)).code).toBe(2);
  await writeFile(
    join(root, 'driftbench.estate.yaml'),
    stringify({ scripts: { [path]: [{ args: [], expect: { exitCode: 0, stdout: 'Usage: label.py' } }] } }),
  );
  const wrong = await run(root, {
    ...test,
    rules: {
      custom: { some_call: { calls: [{ label: 'Bash', input: { command: { contains: 'never-ran.sh' } } }] } },
    },
  });
  expect(wrong.code).toBe(1);
  const untraced = await run(root, {
    ...test,
    rules: {
      custom: { some_call: { calls: [{ label: 'Read', input: { file_path: { contains: 'labels' } } }] } },
    },
  });
  expect(untraced.code).toBe(2);
  expect(untraced.err).toContain('internal tool calls are not traced');
  expect(
    (await run(root, { ...test, blocks: [{ user: 'Read the usage', expect: { must: ['Usage'] } }] })).code,
  ).toBe(2);
}, 30000);

it('runs generated reply-boundary cases against a real hook and rejects both constant verdict mutants', async () => {
  const { generateEstateSuite } = await import('@agent-nexus/driftbench-generate');
  const { parseSpecText } = await import('@agent-nexus/driftbench-core');
  const root = await estate();
  const command = 'python3 .claude/boundary.py';
  await writeFile(
    join(root, '.claude/settings.json'),
    JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command }] }] } }),
  );
  await writeFile(
    join(root, '.claude/boundary.py'),
    'import json,sys\ne=json.load(sys.stdin)\nif len(e["last_assistant_message"])>37:\n print("Reply exceeds its declared limit",file=sys.stderr)\n sys.exit(2)\n',
  );
  const atom = {
    id: 'guard.length',
    kind: 'guard',
    title: 'Reply budget',
    approved: true,
    fields: { name: 'boundary.py', event: 'Stop', command, enforces: [{ atom: 'limit', by: 'id' }] },
    evidence: [{ type: 'guard' as const, name: 'boundary.py', verdict: 'deny' }],
  };
  const suite = generateEstateSuite(
    {
      map: {
        runtime: 'claude-code',
        hash: 'label-budget',
        atoms: [
          atom,
          {
            id: 'limit',
            kind: 'register',
            title: 'Reply limit',
            approved: true,
            evidence: [{ type: 'custom', name: 'max_characters', options: { max: 37 } }],
            provenance: { quote: 'Keep replies below the declared limit.' },
          },
        ],
      },
      plan: {
        mapHash: 'label-budget',
        rows: ['guard_negative', 'guard_hostile', 'guard_speed', 'guard_register'].map((testType) => ({
          id: testType,
          atomIds: [atom.id],
          cell: {},
          testType,
          mode: 'unit',
          status: 'approved',
        })),
      },
      bank: {
        version: 1,
        estate: 'labels',
        mapHash: 'label-budget',
        deviations: [],
        workspaces: [],
        situations: [],
      },
    },
    { paths: { map: 'map.yaml', plan: 'plan.yaml', phrases: 'phrases.yaml' } },
  );
  const tests = suite.files
    .filter((f) => f.path.endsWith('.yaml'))
    .map((f) => {
      const parsed = parseSpecText(f.text, 'yaml');
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
      return parsed.spec;
    });
  expect(tests).toHaveLength(4);
  for (const test of tests) expect((await run(root, test)).code, test.id).toBe(0);
  for (const exit of [0, 2]) {
    await writeFile(join(root, '.claude/boundary.py'), `import sys\nsys.stdin.read()\nsys.exit(${exit})\n`);
    const codes = [];
    for (const test of tests) codes.push((await run(root, test)).code);
    expect(codes).toContain(1);
    expect(codes).not.toContain(2);
  }
}, 90000);
