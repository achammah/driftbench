import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// A recorded session of the Northwind fixture must read like the runtime's own log: every guard the
// settings file wires to a tool call logs a decision for each call it covers, in the order the runtime
// runs them. This test reads the settings file and checks the sessions against it; it holds no guard name.
const FIXTURE = join(fileURLToPath(new URL('../../../', import.meta.url)), 'examples/estates/fixture');
/** The sessions checked here: the ones written to the runtime's order. */
const SESSIONS = ['force-push-blocked', 'invoice-edit-gated', 'stop-word-nudged'];

type Row = { at: string; event: string; check: string; verdict: string };
type Hook = { event: string; matcher: RegExp | undefined; script: string };

async function hooks(): Promise<Hook[]> {
  const settings = JSON.parse(await readFile(join(FIXTURE, '.claude/settings.json'), 'utf8')) as {
    hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string }> }>>;
  };
  return Object.entries(settings.hooks).flatMap(([event, groups]) =>
    groups.flatMap((group) =>
      group.hooks.map((hook) => ({
        event,
        matcher: group.matcher === undefined ? undefined : new RegExp(`^(?:${group.matcher})$`),
        script: hook.command.replace(/["']/g, '').split(/\s+/).at(-1)?.split('/').at(-1) ?? '',
      })),
    ),
  );
}

async function lines<T>(path: string): Promise<T[]> {
  return (await readFile(path, 'utf8'))
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as T);
}

type Item = { at: number; kind: 'use' | 'result' | 'text'; name?: string; id?: string };

async function transcript(name: string): Promise<Item[]> {
  const items: Item[] = [];
  for (const entry of await lines<{
    type: string;
    timestamp?: string;
    message?: { content: unknown };
  }>(join(FIXTURE, 'sessions', `${name}.jsonl`))) {
    if (entry.timestamp === undefined || (entry.type !== 'user' && entry.type !== 'assistant')) continue;
    const at = Date.parse(entry.timestamp);
    const content = entry.message?.content;
    for (const part of Array.isArray(content) ? (content as Array<Record<string, unknown>>) : []) {
      if (part.type === 'tool_use')
        items.push({ at, kind: 'use', name: String(part.name), id: String(part.id) });
      else if (part.type === 'tool_result') items.push({ at, kind: 'result', id: String(part.tool_use_id) });
      else if (part.type === 'text') items.push({ at, kind: 'text' });
    }
    if (typeof content === 'string') items.push({ at, kind: 'text' });
  }
  return items;
}

describe('recorded sessions follow the runtime log of the settings file', () => {
  it.each(SESSIONS)('%s: a guard that runs after a tool call logs a row after its result', async (name) => {
    const post = (await hooks()).filter((hook) => hook.event === 'PostToolUse');
    const items = await transcript(name);
    const rows = await lines<Row>(join(FIXTURE, 'sessions', `${name}.decisions.jsonl`));
    const missing: string[] = [];
    for (const use of items.filter((item) => item.kind === 'use')) {
      const result = items.find((item) => item.kind === 'result' && item.id === use.id);
      if (!result) continue;
      // A call a guard refused before it ran has no result of its own to follow.
      const refused = rows.some(
        (row) =>
          row.event === 'PreToolUse' &&
          row.verdict === 'deny' &&
          Date.parse(row.at) > use.at &&
          Date.parse(row.at) < result.at,
      );
      if (refused) continue;
      const next =
        items.find((item) => item.at > result.at && item.kind !== 'result')?.at ?? Number.POSITIVE_INFINITY;
      for (const hook of post.filter((candidate) => candidate.matcher?.test(use.name ?? '') ?? true)) {
        const logged = rows.some(
          (row) =>
            row.event === 'PostToolUse' &&
            row.check === hook.script &&
            Date.parse(row.at) >= result.at &&
            Date.parse(row.at) < next,
        );
        if (!logged)
          missing.push(`${use.name} ${use.id}: no PostToolUse ${hook.script} row after its result`);
      }
    }
    expect(missing).toEqual([]);
  });
});
