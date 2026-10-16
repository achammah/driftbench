import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { type Io, main } from '../src/index';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SPEC = join(ROOT, 'examples/acme/specs/conversations/plan-upgrade.yaml');
const POLICY = 'kind: policy/blame\nid: house\nitems: []\n';

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

/** A project policy named in the spec, or a policy chosen by project or suite defaults. */
async function project(where: 'spec' | 'project uses.yaml' | 'suite uses.yaml'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'driftbench-blast-objects-'));
  made.push(dir);
  await writeFile(join(dir, 'driftbench.yaml'), 'plugins: []\n');
  const objects = where === 'suite uses.yaml' ? 'specs/_driftbench' : 'driftbench';
  await mkdir(join(dir, objects, 'policy/blame'), { recursive: true });
  await writeFile(join(dir, objects, 'policy/blame/house.yaml'), POLICY);
  const text = await readFile(SPEC, 'utf8');
  await mkdir(join(dir, 'specs'), { recursive: true });
  if (where === 'spec') {
    await writeFile(
      join(dir, 'specs/plan-upgrade.yaml'),
      text.replace('id: acme-plan-upgrade\n', 'id: acme-plan-upgrade\nuses: { blame: house }\n'),
    );
  } else {
    await writeFile(join(dir, 'specs/plan-upgrade.yaml'), text);
    await writeFile(join(dir, objects, 'uses.yaml'), 'blame: house\n');
  }
  return dir;
}

describe('blast objects: spec lint resolves policies from the spec and file defaults', () => {
  for (const where of ['spec', 'project uses.yaml', 'suite uses.yaml'] as const) {
    it(`lints clean with policy/blame:house named in the ${where}`, async () => {
      const dir = await project(where);
      const lint = await cli(['spec', 'lint', join(dir, 'specs/plan-upgrade.yaml')], dir);
      expect(lint.out + lint.err).not.toContain('OBJECT_UNKNOWN');
      expect(lint.code, lint.out + lint.err).toBe(0);
    }, 60_000);
  }
});
