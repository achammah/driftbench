// Blast radius of PR 446 on the commands that read driftbench.yaml: with a populated `objects:` list, every
// command accepts the key, and the commands that load specs agree with `object validate` on what the inline
// objects are: a spec naming a good inline object loads everywhere, a broken inline object is refused everywhere.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearObjectContexts } from '@agent-nexus/driftbench-core';
import { afterEach, describe, expect, it } from 'vitest';
import { type Io, main } from '../src/index';

let dir = '';
afterEach(async () => {
  clearObjectContexts();
  if (dir) await rm(dir, { recursive: true, force: true });
});

// Fictional data only.
const GOOD = 'campaign: { repeats: 1 }\nobjects:\n  - kind: policy/blame\n    id: acme\n    items: []\n';
const BROKEN = 'campaign: { repeats: 1 }\nobjects:\n  - kind: policy/nope\n    id: acme\n    items: []\n';
const SPEC =
  'id: blast-config\nuses: { blame: acme }\nblocks:\n  - user: Where is my order?\n    expect: { must: [ok] }\n';

async function project(config: string): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), 'blast-objects-config-cmd-'));
  await writeFile(join(dir, 'driftbench.yaml'), config);
  await writeFile(join(dir, 'a.yaml'), SPEC);
  return dir;
}

async function run(argv: string[], cwd: string): Promise<{ code: number; out: string; err: string }> {
  clearObjectContexts();
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

describe('blast 446: a populated objects key, read by every command', () => {
  it('spec validate, campaign plan and object validate all accept a spec naming a good inline object', async () => {
    const cwd = await project(GOOD);
    const validate = await run(['spec', 'validate', 'a.yaml'], cwd);
    expect(validate.code, validate.err).toBe(0);
    const plan = await run(['campaign', 'plan', 'a.yaml', '--target', 'function:acme'], cwd);
    expect(plan.err).not.toContain('unknown key');
    expect(plan.code, plan.err).toBe(0);
    const objects = await run(['object', 'validate'], cwd);
    expect(objects.code, objects.err).toBe(0);
    expect(objects.out).toContain('policy/blame:acme');
  }, 120_000);

  it('the same three refuse a broken inline object, each naming the kind, never as an unknown config key', async () => {
    const cwd = await project(BROKEN);
    for (const argv of [
      ['spec', 'validate', 'a.yaml'],
      ['campaign', 'plan', 'a.yaml', '--target', 'function:acme'],
      ['object', 'validate'],
    ]) {
      const result = await run(argv, cwd);
      expect(result.code, argv.join(' ')).not.toBe(0);
      expect(`${result.out}${result.err}`, argv.join(' ')).toContain('policy/nope');
      expect(result.err, argv.join(' ')).not.toContain('unknown key objects');
    }
  }, 120_000);
});
