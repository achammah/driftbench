import { rm } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';
import { decoyRunners, heldOutRunners, NOISE, type RunnerCase, runnerCases } from './runner-entries-corpus';

// A hook entry that starts a generic runner and names the real guard as an argument: the guard's rule
// text comes from the script the runner runs, never from the runner's own start-up description.
const interpreter = (path: string) =>
  path.endsWith('.js') ? 'node' : path.endsWith('.sh') ? 'bash' : 'python3';

function rule(index: number): string {
  return `Guard number ${index} blocks a call that skips the approval step.`;
}

function comment(path: string, text: string): string {
  if (path.endsWith('.js')) return `/** ${text} */\nconsole.log("ok");\n`;
  if (path.endsWith('.sh')) return `#!/bin/sh\n# ${text}\ntrue\n`;
  return `"""${text}"""\nprint("ok")\n`;
}

async function guardOf(entry: RunnerCase, index: number) {
  const runner = entry.runner ?? '.claude/hooks/hookrun.py';
  const wrapper = entry.kind === 'wrapper command' ? 'uv run' : interpreter(runner);
  const files: Record<string, string> = {
    [runner]: entry.source,
    '.claude/settings.json': JSON.stringify({
      hooks: {
        PreToolUse: [
          { hooks: [{ type: 'command', command: `${wrapper} ${runner} ${entry.args.join(' ')}` }] },
        ],
      },
    }),
  };
  if (entry.target !== runner) files[entry.target] = comment(entry.target, rule(index));
  // Siblings the table and mode cases may name.
  files['.claude/hooks/pre-guard.py'] = comment(
    'pre-guard.py',
    'Pre guard of another number, not the one run.',
  );
  const root = await estate(files);
  try {
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    const guard = map.atoms.find((atom) => atom.kind === 'guard');
    return { script: guard?.fields?.script, ruleText: String(guard?.fields?.ruleText ?? '') };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

it('gives a runner-entry guard the rule text of the script it runs', async () => {
  const missed: string[] = [];
  let right = 0;
  for (const [index, entry] of runnerCases.entries()) {
    const found = await guardOf(entry, index);
    if (
      found.script === entry.target &&
      found.ruleText.includes(rule(index)) &&
      !found.ruleText.includes(NOISE)
    )
      right++;
    else missed.push(`${entry.kind}: ${entry.name} -> ${String(found.script)}`);
  }
  console.log(JSON.stringify({ runners: { cases: runnerCases.length, right, missed } }));
  expect(missed).toEqual([]);
}, 120_000);

it('reads runner shapes written after the reader was fitted', async () => {
  const missed: string[] = [];
  let right = 0;
  for (const [index, entry] of heldOutRunners.entries()) {
    const found = await guardOf(entry, 100 + index);
    if (
      found.script === entry.target &&
      found.ruleText.includes(rule(100 + index)) &&
      !found.ruleText.includes(NOISE)
    )
      right++;
    else missed.push(`${entry.name} -> ${String(found.script)}`);
  }
  console.log(JSON.stringify({ heldOut: { cases: heldOutRunners.length, right, missed } }));
  expect(missed).toEqual([]);
}, 120_000);

it('keeps a runner that runs no script of its arguments as the guard', async () => {
  for (const [index, entry] of decoyRunners.entries()) {
    const found = await guardOf(entry, index);
    expect(found.script, entry.name).toBe(entry.runner ?? '.claude/hooks/hookrun.py');
  }
}, 60_000);
