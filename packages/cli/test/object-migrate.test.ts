import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeModelPort } from '@agent-nexus/driftbench-generate';
import { loadPersona, type Persona } from '@agent-nexus/driftbench-users';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultDeps } from '../src/commands/campaign';
import { loadSituationalPersona } from '../src/commands/object-migrate';
import { registerSimulateCommand, type SimulateDeps } from '../src/commands/simulate';
import { type Io, main } from '../src/index';
import { cliRun } from './support/object-cli';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PERSONAS = join(ROOT, 'examples/acme/personas');

/** Answers a fake user port gives, the same for the old file and the migrated one. */
const ANSWERS: Record<string, string[]> = {
  'sam-upgrader': [
    "Hi, I'm already an Acme customer and my phone keeps running out of data.",
    'Sure, it is sam.rivera@example.com',
    'The unlimited one, please.',
    'Confirm',
    "No, that's all. Thanks!",
  ],
  'alex-newhome': [
    'hi, i just moved house, what home internet can i get?',
    '88 Summit Avenue, Acmeville',
    'ok',
    'yes',
    'bye',
  ],
  'dana-porting': [
    'Hello, I would like a mobile plan.',
    '+1 202 555 0150',
    'The middle one.',
    'Yes',
    'Thank you',
  ],
};

let dir: string;
let names: string[];
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'driftbench-object-migrate-'));
  names = (await readdir(PERSONAS)).filter((name) => name.endsWith('.yaml')).sort();
});
const cleanup: string[] = [];
/** A temp folder outside `dir`, which holds a driftbench.yaml of its own after the first migration. */
async function fresh(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'driftbench-object-migrate-'));
  cleanup.push(folder);
  return folder;
}
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  for (const folder of cleanup) await rm(folder, { recursive: true, force: true });
});

function capture(cwd: string): Io & { text: () => { out: string; err: string } } {
  let out = '';
  let err = '';
  return {
    cwd,
    out: (chunk) => {
      out += chunk;
    },
    err: (chunk) => {
      err += chunk;
    },
    text: () => ({ out, err }),
  };
}

/** One simulate run of `persona` on its spec through a fake port, and the requests the port received. */
async function play(persona: string, spec: string, answers: string[]) {
  const port = new FakeModelPort(answers, { family: 'mistral', model: 'fake-model' });
  const deps: SimulateDeps = { ...defaultDeps, modelPort: () => port };
  const run = await cliRun(
    (program, io, setExit) => registerSimulateCommand(program, io, setExit, deps),
    ['simulate', spec, '--persona', persona, '--target', 'function:acme-sales', '--model'],
    ROOT,
  );
  return { ...run, requests: port.requests };
}

describe('driftbench object migrate persona', { timeout: 120_000 }, () => {
  it('splits every Acme persona into a persona, a scenario and a situational block', async () => {
    const io = capture(ROOT);
    const files = names.map((name) => join('examples/acme/personas', name));
    const code = await main(['object', 'migrate', 'persona', ...files, '--out', dir], io);
    expect(io.text()).toEqual({
      out: `Wrote ${join(dir, 'driftbench.yaml')}: the project objects under driftbench/ are read beside it.\n${names
        .map((name) => {
          const id = name.replace(/\.yaml$/, '');
          return `Migrated ${id}: driftbench/persona/${id}.yaml, driftbench/scenario/${id}.yaml, situational/${id}.yaml under ${dir}.\n`;
        })
        .join('')}`,
      err: '',
    });
    expect(code).toBe(0);
    const sam = await readFile(join(dir, 'driftbench/persona/sam-upgrader.yaml'), 'utf8');
    expect(sam).toContain(
      'kind: persona\nid: sam-upgrader\ndescription: Sam Rivera, migrated from sam-upgrader.yaml.\nparams:\n  name: Sam Rivera\n',
    );
    expect(sam).toContain('  stop_token: "###STOP###"\n');
    expect(await readFile(join(dir, 'driftbench/scenario/sam-upgrader.yaml'), 'utf8')).toContain(
      'kind: scenario\nid: sam-upgrader\ndescription: What Sam Rivera wants, migrated from sam-upgrader.yaml.\nparams:\n  goal:',
    );
    expect(await readFile(join(dir, 'situational/sam-upgrader.yaml'), 'utf8')).toContain(
      'simulated_user:\n  scenario: sam-upgrader\n  personas:\n    - sam-upgrader\n',
    );
  });

  it('composes each migrated set back into exactly the persona the old file gave', async () => {
    for (const name of names) {
      const id = name.replace(/\.yaml$/, '');
      const old = await loadPersona(join(PERSONAS, name));
      const migrated = await loadSituationalPersona(join(dir, 'situational', `${id}.yaml`));
      const spec = (persona: Persona, from: string) =>
        persona.spec === undefined ? undefined : resolve(from, persona.spec);
      expect({ ...migrated, spec: spec(migrated, join(dir, 'situational')) }, id).toEqual({
        ...old,
        spec: spec(old, PERSONAS),
      });
    }
  });

  it('plays the same conversation from the migrated files, request for request', async () => {
    for (const name of names) {
      const id = name.replace(/\.yaml$/, '');
      const old = await loadPersona(join(PERSONAS, name));
      const spec = resolve(PERSONAS, old.spec as string);
      const answers = ANSWERS[id] as string[];
      const before = await play(join(PERSONAS, name), spec, answers);
      const after = await play(join(dir, 'situational', `${id}.yaml`), spec, answers);
      expect(before.requests.length, id).toBeGreaterThan(0);
      expect(after, id).toEqual(before);
    }
  });

  it('replays the hand-written recording of sam-upgrader from the migrated files', async () => {
    const recording = 'examples/acme/personas/recordings/sam-upgrader.yaml';
    const spec = 'examples/acme/specs/conversations/plan-upgrade.yaml';
    const run = async (persona: string) => {
      const io = capture(ROOT);
      const code = await main(['simulate', spec, '--persona', persona, '--recording', recording], io);
      return { code, ...io.text() };
    };
    const before = await run('examples/acme/personas/sam-upgrader.yaml');
    const after = await run(join(dir, 'situational/sam-upgrader.yaml'));
    expect(before.code).toBe(0);
    expect(before.out).toContain('✓ 5 of 5 blocks pass.');
    expect(after).toEqual(before);
  });

  it('plays the migrated files in a campaign with the simulated driver, as the old file', async () => {
    const recording = 'examples/acme/personas/recordings/sam-upgrader.yaml';
    const spec = 'examples/acme/specs/conversations/plan-upgrade.yaml';
    const run = async (persona: string) => {
      const io = capture(ROOT);
      const code = await main(
        ['campaign', 'run', spec, '--driver', 'simulated', '--persona', persona, '--recording', recording],
        io,
      );
      // The campaign id is new on every run; the rest of the output must not change.
      const { out, err } = io.text();
      return { code, out: out.replace(/c-[0-9a-f]{12}/g, 'c-<id>'), err };
    };
    const before = await run('examples/acme/personas/sam-upgrader.yaml');
    expect(before.code).toBe(0);
    expect(before.out).toContain(
      'Driver: simulated, persona sam-upgrader on acme-plan-upgrade, recording hand-written.',
    );
    expect(await run(join(dir, 'situational/sam-upgrader.yaml'))).toEqual(before);
  });

  it('refuses a file that is not a persona, and a situational block whose persona is missing', async () => {
    const io = capture(ROOT);
    const code = await main(
      ['object', 'migrate', 'persona', 'examples/acme/specs/conversations/plan-upgrade.yaml', '--out', dir],
      io,
    );
    expect(code).toBe(2);
    expect(io.text().err).toMatch(/plan-upgrade\.yaml: .*\nNothing was written\.\n$/);
    const lonely = await mkdtemp(join(tmpdir(), 'driftbench-object-lonely-'));
    cleanup.push(lonely);
    const sam = 'examples/acme/personas/sam-upgrader.yaml';
    expect(await main(['object', 'migrate', 'persona', sam, '--out', lonely], capture(ROOT))).toBe(0);
    await rm(join(lonely, 'driftbench', 'persona'), { recursive: true });
    await expect(loadSituationalPersona(join(lonely, 'situational', 'sam-upgrader.yaml'))).rejects.toThrow(
      /unknown object persona:sam-upgrader/,
    );
  });
});

describe('driftbench object migrate persona, where it writes', { timeout: 120_000 }, () => {
  const SAM = join(PERSONAS, 'sam-upgrader.yaml');
  const exists = (path: string) =>
    stat(path).then(
      () => true,
      () => false,
    );

  it('refuses to overwrite an object file that exists, and writes none of the others', async () => {
    const project = await fresh();
    await mkdir(join(project, 'driftbench/persona'), { recursive: true });
    await writeFile(join(project, 'driftbench.yaml'), '# project\n');
    const mine = join(project, 'driftbench/persona/sam-upgrader.yaml');
    const handwritten =
      'kind: persona\nid: sam-upgrader\ndescription: hand-written, must survive\nparams: { name: Kept }\n';
    await writeFile(mine, handwritten);
    const io = capture(project);
    expect(await main(['object', 'migrate', 'persona', SAM, '--out', '.'], io)).toBe(2);
    expect(io.text().err).toContain(
      'driftbench/persona/sam-upgrader.yaml already exists: nothing was written.',
    );
    expect(await readFile(mine, 'utf8')).toBe(handwritten);
    expect(await exists(join(project, 'driftbench/scenario/sam-upgrader.yaml'))).toBe(false);
    expect(await exists(join(project, 'situational/sam-upgrader.yaml'))).toBe(false);
  });

  it('refuses a second migration of the same persona and leaves the first untouched', async () => {
    const out = await fresh();
    expect(await main(['object', 'migrate', 'persona', SAM, '--out', out], capture(ROOT))).toBe(0);
    const first = await readFile(join(out, 'situational/sam-upgrader.yaml'), 'utf8');
    await writeFile(join(out, 'situational/sam-upgrader.yaml'), `${first}# edited by hand\n`);
    const io = capture(ROOT);
    expect(await main(['object', 'migrate', 'persona', SAM, '--out', out], io)).toBe(2);
    expect(io.text().err).toContain('already exists: nothing was written.');
    expect(await readFile(join(out, 'situational/sam-upgrader.yaml'), 'utf8')).toContain('# edited by hand');
  });

  it('writes no nested driftbench.yaml from a folder of a project, and names the project', async () => {
    const project = await fresh();
    await mkdir(join(project, 'specs'), { recursive: true });
    await writeFile(join(project, 'driftbench.yaml'), '# project\n');
    const io = capture(join(project, 'specs'));
    expect(await main(['object', 'migrate', 'persona', SAM], io)).toBe(2);
    expect(io.text().err).toContain('is inside the project at');
    expect(io.text().err).toContain('Nothing was written.');
    expect(await exists(join(project, 'specs/driftbench.yaml'))).toBe(false);
    expect(await exists(join(project, 'specs/driftbench'))).toBe(false);
    expect(await exists(join(project, 'specs/situational'))).toBe(false);
    // From the project root the same migration writes into the project.
    expect(await main(['object', 'migrate', 'persona', SAM, '--out', project], capture(ROOT))).toBe(0);
    expect(await exists(join(project, 'driftbench/persona/sam-upgrader.yaml'))).toBe(true);
  });
});

describe('driftbench object migrate persona, the scenario of a situational block', () => {
  it('reads the scenario by the id the block gives, not by the persona id', async () => {
    const out = await fresh();
    expect(
      await main(
        ['object', 'migrate', 'persona', join(PERSONAS, 'sam-upgrader.yaml'), '--out', out],
        capture(ROOT),
      ),
    ).toBe(0);
    await writeFile(
      join(out, 'driftbench/scenario/other-goal.yaml'),
      'kind: scenario\nid: other-goal\ndescription: another goal\nparams:\n  goal: Ask about roaming.\n',
    );
    const situational = join(out, 'situational/sam-upgrader.yaml');
    const text = await readFile(situational, 'utf8');
    expect(text).toContain('scenario: sam-upgrader');
    await writeFile(situational, text.replace('scenario: sam-upgrader', 'scenario: other-goal'));
    const persona = await loadSituationalPersona(situational);
    expect(persona.goal).toBe('Ask about roaming.');
    expect(persona.name).toBe('Sam Rivera');
  });
});
