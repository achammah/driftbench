// Blast radius of unit F2 on `spec lint`: a project check set that extends the shipped `check-set:default` is a
// valid object, so a spec that uses it, by name or through a project uses.yaml, lints clean. This file runs
// `spec lint` alone in its process, as a user does: no other command has loaded the checks package first.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { type Io, main } from '../src/index';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SPEC = join(ROOT, 'examples/acme/specs/conversations/plan-upgrade.yaml');
const HOUSE = 'kind: check-set\nid: house\nextends: default\nitems:\n  - { id: must, enabled: false }\n';

const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

async function cli(argv: string[], cwd: string) {
  let out = '';
  let err = '';
  const io: Io = {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    cwd,
  };
  return { code: await main(argv, io), out, err };
}

/** A project with the house check set; the spec names it itself, or a project uses.yaml does. */
async function project(where: 'spec' | 'uses.yaml'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'driftbench-blast-objects-'));
  made.push(dir);
  await writeFile(join(dir, 'driftbench.yaml'), 'plugins: []\n');
  await mkdir(join(dir, 'driftbench/check-set'), { recursive: true });
  await writeFile(join(dir, 'driftbench/check-set/house.yaml'), HOUSE);
  const text = await readFile(SPEC, 'utf8');
  await mkdir(join(dir, 'specs'), { recursive: true });
  if (where === 'spec') {
    await writeFile(
      join(dir, 'specs/plan-upgrade.yaml'),
      text.replace('id: acme-plan-upgrade\n', 'id: acme-plan-upgrade\nuses: { check_set: house }\n'),
    );
  } else {
    await writeFile(join(dir, 'specs/plan-upgrade.yaml'), text);
    await writeFile(join(dir, 'driftbench/uses.yaml'), 'check_set: house\n');
  }
  return dir;
}

describe('blast stamps: spec lint resolves a project check set that extends the default', () => {
  for (const where of ['spec', 'uses.yaml'] as const) {
    it(`lints clean with check-set:house named in the ${where}`, async () => {
      const dir = await project(where);
      const lint = await cli(['spec', 'lint', join(dir, 'specs/plan-upgrade.yaml')], dir);
      expect(lint.out + lint.err).not.toContain('OBJECT_UNKNOWN');
      expect(lint.code, lint.out + lint.err).toBe(0);
    }, 60_000);
  }
});
