import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clearObjectContexts, objectContextFor } from '@agent-nexus/driftbench-core';
import { openStore } from '@agent-nexus/driftbench-store';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type Io, main } from '../src/index';
import { OBJECTS, PROJECT, registerFixtureObjects } from './support/objects-fixture';

/**
 * Golden outputs of every `driftbench object` command on the objects fixture: a shipped value-check and check
 * set, a project that extends both (a file under driftbench/ and an inline object in driftbench.yaml), and a
 * spec whose block extends the project object inline.
 */

beforeAll(() => registerFixtureObjects());

let scratch = '';
afterEach(async () => {
  if (scratch) await rm(scratch, { recursive: true, force: true });
  scratch = '';
});

async function run(argv: string[], cwd = PROJECT): Promise<{ code: number; out: string; err: string }> {
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

/** A copy of the fixture project the test may write to. */
async function project(): Promise<string> {
  scratch = await mkdtemp(join(tmpdir(), 'driftbench-object-'));
  await cp(PROJECT, scratch, { recursive: true });
  return scratch;
}

const lines = (...text: string[]) => `${text.join('\n')}\n`;

describe('driftbench object list and show', () => {
  it('lists every object the folder sees, with its layer, hash and file', async () => {
    expect(await run(['object', 'list'])).toEqual({
      code: 0,
      out: lines(
        'check-set           default      shipped  c6d980a7',
        'check-set           no-accuracy  project  2bf086d2  driftbench.yaml#objects.0',
        'policy/value-check  acme         project  b4997f3e  driftbench/policy/value-check/acme.yaml',
        'policy/value-check  default      shipped  f35db486',
      ),
      err: '',
    });
    expect((await run(['object', 'list', 'check-set'])).out).not.toContain('policy/value-check');
    const unknown = await run(['object', 'list', 'policy/nope']);
    expect(unknown).toMatchObject({ code: 2, out: '' });
    expect(unknown.err).toMatch(/^unknown object kind policy\/nope; known kinds: check-set, /);
  });

  it('shows one resolved object, each item with the layer, file and line that set it', async () => {
    expect(await run(['object', 'show', 'policy/value-check/acme'])).toEqual({
      code: 0,
      out: lines(
        'policy/value-check -> acme@b4997f3e (extends default@f35db486)',
        '  rung1_outcome        disabled  settles [pass, fail]                            shipped',
        '  rung2_contract       enabled   settles [fail]                                  project driftbench/policy/value-check/acme.yaml:8',
        '  rung3_same_referent  disabled  settles [pass, fail, inconclusive]              shipped',
        '  rung4_exact          enabled   case_insensitive false, strip_punctuation true  project driftbench/policy/value-check/acme.yaml:6',
        'project driftbench/policy/value-check/acme.yaml; extends policy/value-check:default.',
      ),
      err: '',
    });
    const json = JSON.parse((await run(['object', 'show', 'policy/value-check/acme', '--json'])).out);
    expect(json).toMatchObject({
      ref: 'policy/value-check:acme@b4997f3e',
      chain: ['policy/value-check:acme', 'policy/value-check:default'],
    });
  });

  it('refuses an unknown object and an unknown kind with exit 2', async () => {
    expect(await run(['object', 'show', 'check-set/nope'])).toEqual({
      code: 2,
      out: '',
      err: 'unknown object check-set:nope; searched layers shipped, project, suite, spec, block, cli\n',
    });
    const kind = await run(['object', 'show', 'policy/nope/x']);
    expect(kind.code).toBe(2);
    expect(kind.err).toMatch(/^policy\/nope\/x names no object kind; the kinds are check-set, /);
  });
});

describe('driftbench object explain', () => {
  it('prints the object one block uses, with the block layer on top of the project file', async () => {
    expect(
      await run(['object', 'explain', 'policy/value-check', '--at', 'specs/refund-late-order.yaml#b1']),
    ).toEqual({
      code: 0,
      out: lines(
        'policy/value-check at specs/refund-late-order.yaml#b1 -> (block)@73b22b4a (extends acme@b4997f3e)',
        '  rung1_outcome        disabled  settles [pass, fail]                           shipped',
        '  rung2_contract       enabled   settles [fail]                                 project driftbench/policy/value-check/acme.yaml:8',
        '  rung3_same_referent  disabled  settles [pass, fail, inconclusive]             shipped',
        '  rung4_exact          enabled   case_insensitive true, strip_punctuation true  block blocks.0.uses.value_check.items.0',
      ),
      err: '',
    });
  });

  it('prints the spec layer for a block that names nothing, and the shipped default where no layer names one', async () => {
    const b2 = await run([
      'object',
      'explain',
      'policy/value-check',
      '--at',
      'specs/refund-late-order.yaml#b2',
    ]);
    expect(b2.out.split('\n')[0]).toBe(
      'policy/value-check at specs/refund-late-order.yaml#b2 -> acme@b4997f3e (extends default@f35db486)',
    );
    const shipped = await run(['object', 'explain', 'check-set', '--at', 'specs/refund-late-order.yaml#b2']);
    expect(shipped.out).toBe(
      lines(
        'check-set at specs/refund-late-order.yaml#b2 -> default@c6d980a7',
        '  tools.count              enabled   gating true   shipped',
        '  tools.input_closed       enabled   gating true   shipped',
        '  tools.order              enabled   gating true   shipped',
        '  tools.argument_accuracy  enabled   gating false  shipped',
        '  forbidden.count0         enabled   gating true   shipped',
      ),
    );
  });

  it('applies the command-line layer, --use and --set, over every file', async () => {
    const set = await run([
      'object',
      'explain',
      'policy/value-check',
      '--at',
      'specs/refund-late-order.yaml#b2',
      '--set',
      'policy/value-check#rung4_exact.case_insensitive=true',
    ]);
    expect(set.out.split('\n')).toEqual([
      'policy/value-check at specs/refund-late-order.yaml#b2 -> (cli)@73b22b4a (extends acme@b4997f3e)',
      expect.any(String),
      expect.any(String),
      expect.any(String),
      '  rung4_exact          enabled   case_insensitive true, strip_punctuation true  cli command line --set policy/value-check#rung4_exact',
      '',
    ]);
    const use = await run([
      'object',
      'explain',
      'policy/value-check',
      '--at',
      'specs/refund-late-order.yaml#b1',
      '--use',
      'policy/value-check/default',
    ]);
    expect(use.out.split('\n')[0]).toBe(
      'policy/value-check at specs/refund-late-order.yaml#b1 -> default@f35db486',
    );
  });

  it('names a block without an id by its place, blocks.<n>', async () => {
    const acme = fileURLToPath(
      new URL('../../../examples/acme/specs/conversations/plan-upgrade.yaml', import.meta.url),
    );
    const second = await run(['object', 'explain', 'check-set', '--at', `${acme}#blocks.1`]);
    expect(second.out.split('\n')[0]).toMatch(
      /^check-set at .*plan-upgrade\.yaml#blocks\.1 -> default@c6d980a7$/,
    );
    expect(await run(['object', 'explain', 'check-set', '--at', `${acme}#blocks.9`])).toEqual({
      code: 2,
      out: '',
      err: 'The spec acme-plan-upgrade has no block blocks.9. Its blocks: blocks.0, blocks.1, blocks.2, blocks.3, blocks.4.\n',
    });
  });

  it('exits 1, as documented, when an object the spec names does not resolve, and 2 for a spec it cannot read', async () => {
    const dir = await project();
    const spec = (uses: string) =>
      `id: names-nothing-real\nuses: { value_check: ${uses} }\nblocks:\n  - user: hello\n`;
    await writeFile(join(dir, 'specs', 'unresolved.yaml'), spec('does-not-exist'));
    const explained = await run(
      ['object', 'explain', 'policy/value-check', '--at', 'specs/unresolved.yaml'],
      dir,
    );
    expect(explained.code).toBe(1);
    expect(explained.out).toBe('');
    expect(explained.err).toContain('does-not-exist');
    // The same spec through `object graph`, which documents the same exit.
    const graphed = await run(['object', 'graph', 'specs/unresolved.yaml'], dir);
    expect(graphed.code).toBe(1);
    expect(graphed.err).toContain('does-not-exist');
    // A spec that is not a spec, a missing file and a spec invalid for another reason stay input errors.
    await writeFile(join(dir, 'specs', 'broken.yaml'), 'id: broken\nblocks: not-a-list\n');
    expect(
      (await run(['object', 'explain', 'policy/value-check', '--at', 'specs/broken.yaml'], dir)).code,
    ).toBe(2);
    expect(
      (await run(['object', 'explain', 'policy/value-check', '--at', 'specs/missing.yaml'], dir)).code,
    ).toBe(2);
    // An unresolved object does not hide a block the spec lacks: that is still the input error.
    expect(
      (await run(['object', 'explain', 'policy/value-check', '--at', 'specs/unresolved.yaml#b9'], dir)).code,
    ).toBe(2);
  });

  it('refuses a block the spec does not hold, and a kind that does not exist', async () => {
    expect(
      await run(['object', 'explain', 'policy/value-check', '--at', 'specs/refund-late-order.yaml#b9']),
    ).toEqual({
      code: 2,
      out: '',
      err: 'The spec refund-late-order has no block b9. Its blocks: b1, b2.\n',
    });
    expect(
      (await run(['object', 'explain', 'policy/nope', '--at', 'specs/refund-late-order.yaml'])).code,
    ).toBe(2);
  });
});

describe('driftbench object diff and graph', () => {
  it('compares two objects item by item and exits 1 when they differ', async () => {
    expect(await run(['object', 'diff', 'policy/value-check/default', 'policy/value-check/acme'])).toEqual({
      code: 1,
      out: lines(
        'M rung2_contract',
        '    enabled: false -> true',
        'M rung4_exact',
        '    params: {"case_insensitive":false,"strip_punctuation":false} -> {"case_insensitive":false,"strip_punctuation":true}',
        '2 items differ between policy/value-check:default@f35db486 and policy/value-check:acme@b4997f3e.',
      ),
      err: '',
    });
    expect(await run(['object', 'diff', 'check-set/default', 'check-set/default'])).toEqual({
      code: 0,
      out: 'No difference between check-set:default@c6d980a7 and check-set:default@c6d980a7: the same items, values and order.\n',
      err: '',
    });
  });

  it('prints the graph of a spec: each block, each object, where the reference was set and its parents', async () => {
    expect(await run(['object', 'graph', 'specs/refund-late-order.yaml'])).toEqual({
      code: 0,
      out: lines(
        'refund-late-order (specs/refund-late-order.yaml)',
        '  b1',
        '    value_check -> policy/value-check:(block)@73b22b4a  (block blocks.0.uses.value_check, extends policy/value-check:acme -> policy/value-check:default)',
        '    check_set -> check-set:no-accuracy@2bf086d2  (block blocks.0.uses.check_set, extends check-set:default)',
        '  b2',
        '    value_check -> policy/value-check:acme@b4997f3e  (spec uses.value_check, extends policy/value-check:default)',
        '    check_set -> check-set:default@c6d980a7  (shipped default)',
      ),
      err: '',
    });
  });
});

describe('driftbench object init', () => {
  it('writes a file that extends the parent and resolves to it: 0 item changes, the same hash', async () => {
    const cwd = await project();
    expect(await run(['object', 'init', 'policy/value-check', 'strict', '--from', 'default'], cwd)).toEqual({
      code: 0,
      out: 'Wrote driftbench/policy/value-check/strict.yaml: policy/value-check/strict extends default@f35db486, 4 items listed.\n',
      err: '',
    });
    expect(
      await run(['object', 'diff', 'policy/value-check/default', 'policy/value-check/strict'], cwd),
    ).toMatchObject({
      code: 0,
    });
    clearObjectContexts();
    const { store } = objectContextFor(join(cwd, 'driftbench.yaml'));
    const written = store.resolve('policy/value-check', 'strict');
    const parent = store.resolve('policy/value-check', 'default');
    expect(written.hash).toBe(parent.hash);
    expect(written.items.map(({ layer: _l, from: _f, ...item }) => item)).toEqual(
      parent.items.map(({ layer: _l, from: _f, ...item }) => item),
    );
  });

  it('lists every item as a comment that, uncommented, is a valid override changing nothing', async () => {
    const cwd = await project();
    await run(['object', 'init', 'check-set', 'all', '--from', 'default'], cwd);
    const path = join(cwd, 'driftbench/check-set/all.yaml');
    const text = await readFile(path, 'utf8');
    expect(text).toContain('#  - id: tools.argument_accuracy\n#    title: ');
    expect(text).toContain(
      '# order: [tools.count, tools.input_closed, tools.order, tools.argument_accuracy, forbidden.count0]',
    );
    const uncommented = text
      .replace('\nitems: []\n', '\nitems:\n')
      .replace(/^# {2}( *)(- id|title|enabled|when|effect|params|impl)/gm, '  $1$2')
      .replace(/^# order: /m, 'order: ');
    await writeFile(path, uncommented);
    expect(await run(['object', 'validate', 'driftbench/check-set/all.yaml'], cwd)).toEqual({
      code: 0,
      out: lines('✓ check-set:all@c6d980a7  driftbench/check-set/all.yaml', '1 object valid.'),
      err: '',
    });
  });

  it('refuses an id that exists, a parent that does not, and a file already there', async () => {
    const cwd = await project();
    expect(await run(['object', 'init', 'policy/value-check', 'acme', '--from', 'default'], cwd)).toEqual({
      code: 2,
      out: '',
      err: 'policy/value-check/acme already exists (project driftbench/policy/value-check/acme.yaml): pick another id.\n',
    });
    expect((await run(['object', 'init', 'check-set', 'mine', '--from', 'nope'], cwd)).err).toBe(
      'unknown object check-set:nope; searched layers shipped, project, suite, spec, block, cli\n',
    );
    await writeFile(join(cwd, 'mine.yaml'), 'kept\n');
    expect(
      await run(['object', 'init', 'check-set', 'mine', '--from', 'default', '--out', 'mine.yaml'], cwd),
    ).toEqual({ code: 2, out: '', err: 'mine.yaml already exists: nothing was written.\n' });
    expect(await readFile(join(cwd, 'mine.yaml'), 'utf8')).toBe('kept\n');
  });
});

describe('driftbench object validate', () => {
  it('passes every object the project sees', async () => {
    expect(await run(['object', 'validate'])).toEqual({
      code: 0,
      out: lines(
        '✓ check-set:default@c6d980a7  shipped',
        '✓ check-set:no-accuracy@2bf086d2  driftbench.yaml#objects.0',
        '✓ policy/value-check:acme@b4997f3e  driftbench/policy/value-check/acme.yaml',
        '✓ policy/value-check:default@f35db486  shipped',
        '4 objects valid.',
      ),
      err: '',
    });
  });

  it('refuses the 8 planted unknown-item files, each naming the unknown id and the parent items', async () => {
    const result = await run(['object', 'validate', 'unknown'], OBJECTS);
    expect(result.code).toBe(1);
    const refused = result.out.split('\n').filter((line) => line.startsWith('✗ '));
    expect(refused.map((line) => /unknown item (\S+) in (\S+)/.exec(line)?.slice(1))).toEqual([
      ['rung5_judge', 'policy/value-check:u1'],
      ['tools.ordr', 'check-set:u2'],
      ['R3', 'check-set:u3'],
      ['tools.coverage', 'check-set:u4'],
      ['Tools.order', 'check-set:u5'],
      ['rung4_Exact', 'policy/value-check:u6'],
      ['rung4_exact', 'check-set:u7'],
      ['rung2b_declared', 'policy/value-check:u8'],
    ]);
    expect(refused[0]).toBe(
      '✗ unknown item rung5_judge in policy/value-check:u1 (unknown/U1.yaml:5); the parent policy/value-check:default holds rung1_outcome, rung2_contract, rung3_same_referent, rung4_exact. To add a new item write add: true with title, when, effect and impl',
    );
    expect(result.out.endsWith('8 of 8 objects refused.\n')).toBe(true);
  });

  it('refuses a project file that does not load, and a file that redefines a shipped object', async () => {
    const cwd = await project();
    await writeFile(
      join(cwd, 'driftbench/policy/value-check/acme.yaml'),
      'kind: policy/value-check\nid: acme\nextends: default\nitems:\n  - id: rung4_exact\n    params: { case_insensitive: maybe }\n',
    );
    const broken = await run(['object', 'validate'], cwd);
    expect(broken.code).toBe(1);
    expect(broken.out).toContain(
      '✗ policy/value-check:acme: item rung4_exact params: params: case_insensitive must be true or false (driftbench/policy/value-check/acme.yaml:5)',
    );
    const shipped = await run(['object', 'validate', 'shipped/check-set-default.yaml'], OBJECTS);
    expect(shipped).toMatchObject({ code: 1 });
    expect(shipped.out).toContain(
      'check-set:default is shipped and immutable; write an object with another id that extends it',
    );
  });
});

describe('driftbench object validate and the folder load', () => {
  const WRONG = 'driftbench/policy/value-check/wrong-name.yaml';
  const COPY = 'driftbench/policy/value-check/acme-copy.yaml';

  it('refuses, by path, by folder and without paths, a file at the wrong place', async () => {
    const cwd = await project();
    await writeFile(join(cwd, WRONG), 'kind: policy/value-check\nid: acme2\nextends: default\nitems: []\n');
    for (const argv of [
      ['object', 'validate', WRONG],
      ['object', 'validate', 'driftbench'],
      ['object', 'validate'],
    ]) {
      const result = await run(argv, cwd);
      expect(result.code, argv.join(' ')).toBe(1);
      expect(result.out, argv.join(' ')).toContain(
        'holds policy/value-check:acme2, so it belongs at policy/value-check/acme2.yaml',
      );
    }
  });

  it('refuses, by path and by folder, a second file for an id another file holds', async () => {
    const cwd = await project();
    await writeFile(join(cwd, COPY), 'kind: policy/value-check\nid: acme\nextends: default\nitems: []\n');
    for (const argv of [
      ['object', 'validate', COPY],
      ['object', 'validate', 'driftbench'],
    ]) {
      const result = await run(argv, cwd);
      expect(result.code, argv.join(' ')).toBe(1);
      expect(result.out, argv.join(' ')).toContain(
        'acme-copy.yaml: holds policy/value-check:acme, so it belongs at policy/value-check/acme.yaml',
      );
    }
    // The file the copy sorts before is refused too, as the folder load refuses it: the project does not load.
    const first = await run(['object', 'validate', 'driftbench/policy/value-check/acme.yaml'], cwd);
    expect(first.code).toBe(1);
    expect(first.out).toContain('is defined twice');
  });

  it('passes a uses.yaml that loads, by path and by folder, and refuses one that does not', async () => {
    const cwd = await project();
    await writeFile(join(cwd, 'driftbench/uses.yaml'), 'value_check: acme\n');
    for (const argv of [
      ['object', 'validate', 'driftbench/uses.yaml'],
      ['object', 'validate', 'driftbench'],
    ]) {
      const result = await run(argv, cwd);
      expect(result.code, argv.join(' ')).toBe(0);
      expect(result.out, argv.join(' ')).not.toContain('✗');
    }
    await writeFile(join(cwd, 'driftbench/uses.yaml'), 'value_chek: acme\n');
    const broken = await run(['object', 'validate', 'driftbench/uses.yaml'], cwd);
    expect(broken.code).toBe(1);
    expect(broken.out).toContain('✗');
  });
});

describe('driftbench object init, list and explain, edges', () => {
  it('writes the parent it was given as extends, a shipped object or a project one', async () => {
    const cwd = await project();
    expect(
      (
        await run(
          ['object', 'init', 'policy/value-check', 'mine', '--from', 'acme', '--out', 'mine.yaml'],
          cwd,
        )
      ).code,
    ).toBe(0);
    expect(await readFile(join(cwd, 'mine.yaml'), 'utf8')).toContain('\nextends: acme\n');
    expect(
      (await run(['object', 'init', 'check-set', 'lean', '--from', 'no-accuracy', '--out', 'lean.yaml'], cwd))
        .code,
    ).toBe(0);
    expect(await readFile(join(cwd, 'lean.yaml'), 'utf8')).toContain('\nextends: no-accuracy\n');
  });

  it('counts the weaker objects a stronger one hides in list', async () => {
    const cwd = await project();
    await mkdir(join(cwd, '_driftbench/policy/value-check'), { recursive: true });
    await cp(
      join(cwd, 'driftbench/policy/value-check/acme.yaml'),
      join(cwd, '_driftbench/policy/value-check/acme.yaml'),
    );
    const listed = await run(['object', 'list', 'policy/value-check'], cwd);
    expect(listed.code).toBe(0);
    expect(listed.out).toMatch(/^policy\/value-check {2}acme +suite .*\(over 1 weaker\)$/m);
  });

  it('refuses the block at the count of blocks, not only one far beyond it', async () => {
    const acme = fileURLToPath(
      new URL('../../../examples/acme/specs/conversations/plan-upgrade.yaml', import.meta.url),
    );
    const last = await run(['object', 'explain', 'check-set', '--at', `${acme}#blocks.4`]);
    expect(last.code).toBe(0);
    const beyond = await run(['object', 'explain', 'check-set', '--at', `${acme}#blocks.5`]);
    expect(beyond).toMatchObject({ code: 2, out: '' });
    expect(beyond.err).toContain('has no block blocks.5');
  });
});

describe('driftbench object push', () => {
  it('stores object files as a registry version under object.<kind>, once per content', async () => {
    const cwd = await project();
    const argv = [
      'object',
      'push',
      'policy/value-check',
      'driftbench/policy/value-check',
      '--name',
      'acme',
      '--store',
      'acme.db',
    ];
    const first = await run(argv, cwd);
    expect(first.code).toBe(0);
    expect(first.out).toMatch(
      /^Pushed policy\/value-check acme@1 \(hash [0-9a-f]{12}\): 1 file from driftbench\/policy\/value-check\.\n$/,
    );
    expect(await run(argv, cwd)).toEqual({
      code: 0,
      out: 'Unchanged: policy/value-check acme@1 already holds these 1 file.\n',
      err: '',
    });
    const store = openStore(join(cwd, 'acme.db'));
    try {
      const versions = await store.listVersions('object.policy.value-check');
      expect(
        versions.map((version) => [version.name, version.version, version.files.map((file) => file.path)]),
      ).toEqual([['acme', 1, ['acme.yaml']]]);
      expect(await store.listVersions('dataset')).toEqual([]);
    } finally {
      await store.close();
    }
  });

  it('pushes nothing when a file is of another kind or does not resolve', async () => {
    const cwd = await project();
    const wrong = await run(
      [
        'object',
        'push',
        'check-set',
        'driftbench/policy/value-check/acme.yaml',
        '--name',
        'x',
        '--store',
        'acme.db',
      ],
      cwd,
    );
    expect(wrong).toEqual({
      code: 1,
      out: '',
      err: lines(
        '✗ driftbench/policy/value-check/acme.yaml: holds an object of kind policy/value-check, not check-set',
        'Fix the invalid objects first: nothing was pushed.',
      ),
    });
    const planted = await run(
      ['object', 'push', 'check-set', join(OBJECTS, 'unknown/U2.yaml'), '--name', 'x', '--store', 'acme.db'],
      cwd,
    );
    expect(planted.code).toBe(1);
    expect(planted.err).toContain('unknown item tools.ordr in check-set:u2');
  });
});
