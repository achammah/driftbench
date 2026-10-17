import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { guards } from '@agent-nexus/driftbench-checks';
import { type CheckContext, parseSpecText } from '@agent-nexus/driftbench-core';
import { ClaudeCodeReader, scanEstate } from '@agent-nexus/driftbench-estate';
import { expect, it } from 'vitest';
import { stringify } from 'yaml';
import { stageModel, thenOf } from '../../generate/src/estate/then';
import { main } from '../src/index';

it('a generated negative guard control accepts allow and rejects deny without a declared verdict', async () => {
  const root = await mkdtemp(join(tmpdir(), 'receipt-control-'));
  await mkdir(join(root, '.claude/hooks'), { recursive: true });
  await writeFile(join(root, 'CLAUDE.md'), '# Receipt archive\n');
  const command = 'sh .claude/hooks/archive.sh';
  const script = join(root, '.claude/hooks/archive.sh');
  await writeFile(script, '#!/bin/sh\nexit 0\n');
  await writeFile(
    join(root, '.claude/settings.json'),
    JSON.stringify({
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command }] }] },
    }),
  );
  const { map } = await scanEstate({ root, reader: new ClaudeCodeReader() });
  const guard = map.atoms.find((atom) => atom.kind === 'guard');
  if (!guard) throw new Error('the hand-written estate has no guard');
  const evidence = guard.evidence.find((entry) => entry.type === 'guard');
  if (evidence?.type !== 'guard') throw new Error('the guard has no runtime evidence');
  const guardName = evidence.name;
  expect(evidence.verdict).toBeUndefined();
  const then = thenOf([guard], 'negative', {
    stages: stageModel([]),
    skills: new Set(),
    customChecks: new Set(),
  });
  const file = join(root, 'negative.yaml');
  await writeFile(
    file,
    stringify({
      id: 'archive-neutral-operation',
      kind: 'task',
      title: 'A neutral archive operation remains allowed',
      target: { adapter: 'claude-code' },
      blocks: [{ user: 'List the receipt archive.', expect: { guards: then.guards } }],
      metadata: {
        estate: {
          mode: 'unit',
          testType: 'guard_negative',
          unit: {
            target: { kind: 'guard', name: evidence.name, event: 'PreToolUse', matcher: 'Bash', command },
            cases: [
              {
                id: 'list',
                material: 'list the archive',
                payload: { tool_name: 'Bash', tool_input: { command: 'ls receipts/' } },
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
      out: (text) => {
        out += text;
      },
      err: (text) => {
        err += text;
      },
    });
    expect(err).toBe('');
    return { code, result: JSON.parse(out) };
  }
  const parsed = parseSpecText(await readFile(file, 'utf8'), 'yaml');
  if (!parsed.ok) throw new Error('the generated control does not parse');
  const spec = parsed.spec;
  const block = spec.blocks[0];
  if (!block) throw new Error('the generated control has no block');
  const replayDecision = async (verdict: string) => {
    const context: CheckContext = {
      spec,
      mode: 'F',
      blockIndex: 0,
      block,
      expect: block.expect ?? {},
      given: {
        prefix: [],
        ledger: {},
        world: {},
        vars: {},
        target: { adapter: 'function' },
        hash: 'receipt-control',
      },
      observed: {
        segments: [],
        text: '',
        toolCalls: [],
        cost: { usd: 0 },
        latencyMs: 0,
        runtime: { guards: [{ name: guardName, verdict }] },
      },
      history: [],
      ledger: {},
    };
    return (await guards.evaluate(context)).map((result) => result.outcome);
  };
  const allowed = await run();
  expect(allowed.code).toBe(0);
  expect(allowed.result.guards[0]?.decision).toBe('allow');
  // The control now checks every intervention kind (deny, warn, nudge); an allow passes each of them.
  const allowedOutcomes = await replayDecision(allowed.result.guards[0].decision);
  expect(allowedOutcomes.length).toBeGreaterThan(0);
  expect(new Set(allowedOutcomes)).toEqual(new Set(['pass']));
  await writeFile(script, '#!/bin/sh\necho "Archive is locked" >&2\nexit 2\n');
  const denied = await run();
  expect(denied.code).toBe(1);
  expect(denied.result.guards[0]?.decision).toBe('deny');
  const deniedOutcomes = await replayDecision(denied.result.guards[0].decision);
  // Only the deny expectation fails; the warn and nudge expectations still hold.
  expect(deniedOutcomes.filter((outcome) => outcome === 'fail')).toHaveLength(1);
}, 30_000);
