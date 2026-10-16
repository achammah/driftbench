// Blast radius of PR 443 on the project config readers: the spec loader reads `objects:` from driftbench.yaml
// (objectContextFor, the project layer) and the help documents it, so every command that reads the same file
// must accept the key, not refuse it as unknown with exit 2.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearObjectContexts, loadSpecFile } from '@agent-nexus/driftbench-core';
import { afterEach, describe, expect, it } from 'vitest';
import { readAggregateConfig } from '../src/aggregate-config';
import { readCampaignConfig } from '../src/campaign-config';

let dir = '';
afterEach(async () => {
  clearObjectContexts();
  if (dir) await rm(dir, { recursive: true, force: true });
});

const CONFIG = 'objects:\n  - kind: policy/blame\n    id: acme\n    items: []\n';

describe('blast 443: the objects key of driftbench.yaml', () => {
  it('the spec loader reads it: a spec naming the inline object loads', async () => {
    dir = await mkdtemp(join(tmpdir(), 'blast-objects-config-'));
    await writeFile(join(dir, 'driftbench.yaml'), CONFIG);
    await writeFile(join(dir, 'a.yaml'), 'id: a\nuses: { blame: acme }\nblocks: [{ user: hi }]\n');
    const loaded = await loadSpecFile(join(dir, 'a.yaml'));
    expect(loaded.ok ? [] : loaded.errors.map((issue) => issue.code)).toEqual([]);
  });

  it('the campaign and aggregate config readers accept it', async () => {
    dir = await mkdtemp(join(tmpdir(), 'blast-objects-config-'));
    const path = join(dir, 'driftbench.yaml');
    await writeFile(path, CONFIG);
    expect(await readCampaignConfig(undefined, dir)).toEqual({ ok: true, config: undefined });
    expect(await readAggregateConfig(path)).toEqual({ ok: true, specs: [] });
  });
});
