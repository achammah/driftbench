// Blast radius of PR 448 on the command line's plugin lifecycle: a plugin that registers framework parts and is
// then refused part way (here, a rule for a kind no one registered) must leave nothing in the process-wide
// object registry: the kind, the rule and the object it registered before the refusal are gone after the run,
// and the next run in the same process sees the registry as it was.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearObjectContexts, objectRegistry } from '@agent-nexus/driftbench-core';
import { afterEach, describe, expect, it } from 'vitest';
import { type Io, main } from '../src/index';

const made: string[] = [];
afterEach(async () => {
  clearObjectContexts();
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true });
});

// Fictional data only. Registers a kind, a rule of it and an object of it, then a rule of an unknown kind.
const PLUGIN = `export default function plugin(api) {
  api.kind('policy/leak', { summary: 'A kind registered before the refusal.' });
  api.rule('policy/leak', 'leak-rule', { run: () => 'x' });
  api.object('objects/leak.yaml');
  api.rule('policy/nowhere', 'lost', { run: () => 0 });
}
`;
const OBJECT =
  'kind: policy/leak\nid: leaky\nitems:\n  - id: r1\n    title: Route it.\n    impl: plugin:leak-rule\n';

async function run(argv: string[], cwd: string): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const io: Io = {
    cwd,
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
  };
  const code = await main(argv, io);
  return { code, out, err };
}

describe('blast 448: a plugin refused part way leaves the object registry as it was', () => {
  it('drops the kind, the rule and the object it registered before the refusal, and the next run is clean', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'blast-objects-plugin-'));
    made.push(dir);
    await mkdir(join(dir, 'objects'));
    await writeFile(join(dir, 'plugin.mjs'), PLUGIN);
    await writeFile(join(dir, 'objects', 'leak.yaml'), OBJECT);
    await writeFile(join(dir, 'a.yaml'), 'id: a\nblocks:\n  - user: hi\n    expect: { must: [ok] }\n');
    // The shipped kinds register on first use, so one plain run comes before the baseline is read.
    const warm = await run(['spec', 'validate', 'a.yaml'], dir);
    expect(warm.code, warm.err).toBe(0);
    const kinds = objectRegistry.kinds().length;
    const shipped = objectRegistry.shipped().length;

    const refused = await run(['spec', 'validate', 'a.yaml', '--plugin', './plugin.mjs'], dir);
    expect(refused.code).toBe(2);
    expect(refused.err).toContain(
      'registers the rule lost for the kind policy/nowhere, which no one registered',
    );

    expect(objectRegistry.kind('policy/leak')).toBeUndefined();
    expect(objectRegistry.impl('plugin:leak-rule')).toBeUndefined();
    expect(objectRegistry.kinds()).toHaveLength(kinds);
    expect(objectRegistry.shipped()).toHaveLength(shipped);

    const next = await run(['spec', 'validate', 'a.yaml'], dir);
    expect(next.code, next.err).toBe(0);
  }, 120_000);
});
