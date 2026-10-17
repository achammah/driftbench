// Blast radius of unit F2 on the run commands: a project check set the loader accepts is the one the runner
// applies. A spec that names a project object with `uses.check_set`, and a project `uses.yaml` that sets one,
// run under it on `campaign run`, and every stored verdict is stamped with it.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '@agent-nexus/driftbench-store';
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

describe('blast stamps: campaign run applies the project check set the loader resolved', () => {
  // BUG: store.putSpec re-validates against the shipped objects only, so a spec naming a project object is refused, reported to lead
  // BUG: campaign run passes no objects to runSpec, so a project uses.yaml check set is ignored, reported to lead
  for (const where of ['spec', 'uses.yaml'] as const) {
    it(`runs under check-set:house named in the ${where}`, async () => {
      const dir = await project(where);
      const result = await cli(
        [
          'campaign',
          'run',
          join(dir, 'specs/plan-upgrade.yaml'),
          '--target',
          'function:acme-sales',
          '--agent-version',
          'acme-v1',
          '--mode',
          'T',
          '--campaign',
          'house',
          '--store',
          'runs.db',
        ],
        dir,
      );
      expect(result.code, result.err).toBeLessThan(2);
      const store = openStore(join(dir, 'runs.db'));
      try {
        const runs = await store.listRuns({ campaignId: 'house' });
        expect(runs.length).toBeGreaterThan(0);
        const verdicts = runs.flatMap((run) => run.blocks.flatMap((block) => block.verdicts));
        expect(verdicts.length).toBeGreaterThan(0);
        expect(verdicts.some((verdict) => verdict.name === 'must')).toBe(false);
        for (const verdict of verdicts) expect(verdict.by?.object).toMatch(/^check-set:house@/);
        for (const run of runs)
          for (const block of run.blocks)
            expect(block.resolved?.objects.find((object) => object.key === 'check_set')?.id).toBe('house');
      } finally {
        await store.close();
      }
    }, 60_000);
  }
});
