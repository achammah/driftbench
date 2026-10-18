import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEstateMap } from '@agent-nexus/driftbench-estate';
import { expect, it } from 'vitest';
import { estateScanCommand } from '../src/commands/estate';

it('reports the model budget before a call and persists unchanged chunks across CLI scans', async () => {
  const root = await mkdtemp(join(tmpdir(), 'estate-prose-cli-'));
  await writeFile(join(root, 'CLAUDE.md'), 'The helper must validate the manifest.\n');
  const events: string[] = [];
  let calls = 0;
  const io = {
    cwd: root,
    out(text: string) {
      events.push(text);
    },
    err(text: string) {
      throw new Error(text);
    },
  };
  const port = {
    family: 'test',
    model: 'offline',
    async complete(request: { user: string }) {
      expect(events[0]).toMatch(/^Model pass estimate: 1 chunks, \d+ characters to send;/);
      calls++;
      return JSON.stringify({ chunk: request.user.split('\n')[0]?.slice(7), atoms: [] });
    },
  };
  expect(await estateScanCommand('.', { out: 'map.yaml' }, io, { port })).toBe(0);
  expect(calls).toBe(1);
  events.length = 0;
  expect(await estateScanCommand('.', { out: 'map.yaml', force: true }, io, { port })).toBe(0);
  expect(calls).toBe(1);
  expect(events[0]).toContain('0 chunks, 0 characters to send; 1 chunks');
  events.length = 0;
  expect(await estateScanCommand('.', { out: 'code.yaml', model: false }, io)).toBe(0);
  const loaded = await loadEstateMap(join(root, 'code.yaml'));
  expect(
    loaded.ok && loaded.map.atoms.some((atom) => atom.fields?.candidate === true && !atom.approved),
  ).toBe(true);
  expect(events.join('')).toContain('1 code-found candidates waiting for approval');
});
