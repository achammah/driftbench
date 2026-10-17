import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEstateMap } from '@agent-nexus/driftbench-estate';
import { FakeModelPort } from '@agent-nexus/driftbench-generate';
import { loadSpaceMap } from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import { estateScanCommand } from '../src/commands/estate';
import { type Io, main } from '../src/index';

const FIXTURE = fileURLToPath(new URL('../../../examples/estates/fixture/', import.meta.url));

function capture(cwd: string) {
  const output = { out: '', err: '' };
  const io: Io = {
    out: (text) => {
      output.out += text;
    },
    err: (text) => {
      output.err += text;
    },
    cwd,
  };
  return { io, output };
}

async function run(argv: string[], cwd: string) {
  const { io, output } = capture(cwd);
  const code = await main(argv, io);
  return { code, ...output };
}

/** A copy of the fixture estate in a temporary folder, without its committed outputs. */
async function fixtureCopy(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'driftbench-estate-cli-'));
  await cp(join(FIXTURE, 'CLAUDE.md'), join(root, 'CLAUDE.md'));
  await cp(join(FIXTURE, '.claude'), join(root, '.claude'), { recursive: true });
  await cp(join(FIXTURE, 'answers.yaml'), join(root, 'answers.yaml'));
  return root;
}

describe('driftbench estate scan', () => {
  it('reports an ambiguous table without inventing an automatic route', async () => {
    const root = await fixtureCopy();
    await writeFile(
      join(root, 'CLAUDE.md'),
      '| A | B |\n|---|---|\n| Inspect the crate seals | `invoice-reconcile` |\n| internal | `invoice-reconcile` |',
    );
    const result = await run(['estate', 'scan', '.', '--no-model', '--out', 'map.yaml'], root);
    expect(result.code).toBe(0);
    expect(result.out).toContain('CLAUDE.md: Ambiguous routing table');
    const loaded = await loadEstateMap(join(root, 'map.yaml'));
    expect(
      loaded.ok && loaded.map.atoms.filter((atom) => atom.kind === 'route' && atom.fields?.via === 'table'),
    ).toEqual([]);
  });

  it('refuses an unknown --provider before any model call, and writes nothing', async () => {
    const root = await fixtureCopy();
    const result = await run(['estate', 'scan', '.', '--out', 'map.yaml', '--provider', 'bogus'], root);
    expect(result.code).toBe(2);
    expect(result.err).toContain('unknown provider "bogus": use anthropic or openai.');
    await expect(readFile(join(root, 'map.yaml'), 'utf8')).rejects.toThrow();
  });

  it('writes the map from recorded answers and prints the counts, refusals, orphans and unenforced atoms', async () => {
    const root = await fixtureCopy();
    const result = await run(
      ['estate', 'scan', '.', '--runtime', 'claude-code', '--replay', 'answers.yaml', '--out', 'map.yaml'],
      root,
    );
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    expect(result.out).toContain(
      'Wrote map.yaml: 126 atoms (69 read by code and approved, 57 split from prose by the model and waiting for approval), 55 edges.',
    );
    expect(result.out).toMatch(/instruction\s+43 {2}\(43 by the model\)/);
    expect(result.out).toContain(
      // The fixture's weekly-report template is a template document, so no chunk of it is sent to the model.
      'Prose: 14 chunks, 6835 characters (standing 1, memory 2, skill bodies 4, skill files 4, helper bodies 3).',
    );
    expect(result.out).not.toContain('Unanswered prose chunks');
    expect(result.out).toContain('Refused: none.');
    expect(result.out).toContain('Orphans: .claude/skills/invoice-reconcile/references/old-tolerances.md.');
    expect(result.out).toContain(
      'Unreachable from the standing instructions: .claude/agents/inbox-triager.md.',
    );
    expect(result.out).toContain('Unenforced: 54 of 61 rules have no guard.');
    const loaded = await loadEstateMap(join(root, 'map.yaml'));
    expect(loaded.ok && loaded.map.root).toBe('.');
  });

  it('records the root relative to the map, and never refuses to read an estate elsewhere', async () => {
    const root = await fixtureCopy();
    const elsewhere = await mkdtemp(join(tmpdir(), 'driftbench-estate-out-'));
    const result = await run(
      ['estate', 'scan', root, '--no-model', '--out', join(elsewhere, 'maps', 'map.yaml')],
      elsewhere,
    );
    expect(result.code).toBe(0);
    expect(result.out).toContain(
      'No model call: structured atoms and code-found prose candidates (--no-model).',
    );
    expect(result.out).toContain('Unanswered prose chunks (no model call): 14, 6835 characters.');
    expect(result.out).toContain(
      '    .claude/skills/invoice-reconcile/references/matching-rules.md  261 characters\n',
    );
    const loaded = await loadEstateMap(join(elsewhere, 'maps', 'map.yaml'));
    if (!loaded.ok) throw new Error('invalid map');
    expect(loaded.map.root.startsWith('../')).toBe(true);
    const lint = await run(['estate', 'lint', 'maps/map.yaml'], elsewhere);
    expect(lint.code).toBe(1);
    expect(lint.out).toContain('6 findings.');
  });

  it('exits 1 and lists the refusal when an answer quotes text that is not in the file', async () => {
    const root = await fixtureCopy();
    const answers = await readFile(join(root, 'answers.yaml'), 'utf8');
    await writeFile(
      join(root, 'answers.yaml'),
      answers.replace(
        'quote: Ask at most one question per reply.',
        'quote: Ask at most two questions per reply.',
      ),
    );
    const result = await run(['estate', 'scan', '.', '--replay', 'answers.yaml', '--out', 'map.yaml'], root);
    expect(result.code).toBe(1);
    expect(result.out).toContain('Refused, not in the map:');
    expect(result.out).toContain(
      'CLAUDE.md  atom #9 (register: At most one question per reply)  the quote is not in CLAUDE.md',
    );
  });

  it('uses the model port it is given, and records its family and model', async () => {
    const root = await fixtureCopy();
    const { io, output } = capture(root);
    const port = new FakeModelPort(
      Array.from({ length: 14 }, () => (request) => {
        const chunk = /^CHUNK: (.+)$/m.exec(request.user)?.[1] ?? '';
        return JSON.stringify({ chunk, atoms: [] });
      }),
      { family: 'fake', model: 'fake-model' },
    );
    const code = await estateScanCommand('.', { out: 'map.yaml' }, io, {
      port,
      now: () => new Date('2026-10-11T00:00:00.000Z'),
    });
    expect(code).toBe(0);
    expect(port.requests).toHaveLength(14);
    expect(output.out).toContain('Model fake fake-model: 14 prose chunks, 14 calls.');
    const loaded = await loadEstateMap(join(root, 'map.yaml'));
    expect(loaded.ok && loaded.map.producedBy).toEqual({
      family: 'fake',
      model: 'fake-model',
      at: '2026-10-11T00:00:00.000Z',
    });
  });

  it('refuses a usage error and writes nothing', async () => {
    const root = await fixtureCopy();
    expect((await run(['estate', 'scan', '.', '--runtime', 'other', '--out', 'm.yaml'], root)).code).toBe(2);
    expect((await run(['estate', 'scan', '.', '--no-model'], root)).err).toContain("'--out <file>'");
    expect((await run(['estate', 'scan', 'missing', '--no-model', '--out', 'm.yaml'], root)).code).toBe(2);
    expect(
      (await run(['estate', 'scan', '.', '--no-model', '--replay', 'answers.yaml', '--out', 'm.yaml'], root))
        .code,
    ).toBe(2);
    expect(
      (await run(['estate', 'scan', '.', '--no-model', '--ceiling', 'lots', '--out', 'm.yaml'], root)).code,
    ).toBe(2);
    const noKey = capture(root);
    expect(await estateScanCommand('.', { out: 'm.yaml' }, noKey.io, { env: {} })).toBe(2);
    expect(noKey.output.err).toContain('Pass --no-model');
    await writeFile(join(root, 'taken.yaml'), 'x');
    const taken = await run(['estate', 'scan', '.', '--no-model', '--out', 'taken.yaml'], root);
    expect(taken.code).toBe(2);
    expect(await readFile(join(root, 'taken.yaml'), 'utf8')).toBe('x');
  });
});

describe('driftbench estate scan and lint with an ignore list', () => {
  const CASES = fileURLToPath(new URL('../../../examples/estates/reader-cases/', import.meta.url));

  it('prints what the defaults and the config skip, records the list in the map, and lints with it', async () => {
    const out = await mkdtemp(join(tmpdir(), 'driftbench-estate-ignore-'));
    const scan = await run(['estate', 'scan', CASES, '--no-model', '--out', join(out, 'map.yaml')], out);
    expect(scan.code).toBe(0);
    expect(scan.out).toContain(
      [
        '  Ignored: 9 files no runtime loads.',
        '    node_modules  1',
        '    __pycache__  1',
        '    *.log  1',
        '    tests/fixtures  2',
        '    hooks/**/tests  1',
        '    .trash  1',
        '    skills/synced  1',
        '    archive  1',
      ].join('\n'),
    );
    const lint = await run(['estate', 'lint', join(out, 'map.yaml')], out);
    // The documented local subtree wins before another skill with the same bare name.
    expect(lint.code).toBe(0);
    expect(lint.out).toContain('Clean.');
    expect(lint.out).not.toContain('AMBIGUOUS_REFERENCE');
    const original = await loadEstateMap(join(out, 'map.yaml'));
    if (!original.ok) throw new Error('invalid map');
    const localNotes = original.map.atoms.find(
      (atom) =>
        atom.kind === 'reference' &&
        atom.provenance.file === '.claude/skills/shipment-tracker/SKILL.md' &&
        atom.fields?.path === '.claude/skills/shipment-tracker/references/notes.md',
    );
    expect(localNotes?.fields).toMatchObject({ exists: true, resolvedBy: 'suffix' });
    expect(localNotes?.fields).not.toHaveProperty('candidates');

    // A glob given to the scan only travels in the map: lint reads the estate with it, unasked.
    const NOTES = 'shipment-tracker/references/notes.md';
    const orphan = `.claude/skills/${NOTES}: nothing in the estate names this file`;
    const more = await run(
      ['estate', 'scan', CASES, '--no-model', '--ignore', NOTES, '--out', join(out, 'more.yaml')],
      out,
    );
    expect(more.out).toContain(`    ${NOTES}  1`);
    const loaded = await loadEstateMap(join(out, 'more.yaml'));
    expect(loaded.ok && loaded.map.ignore).toEqual(['archive', NOTES]);
    const again = await run(['estate', 'lint', join(out, 'more.yaml')], out);
    expect(again.out).not.toContain(orphan);
    // The same map without its recorded list: lint reads the file again and finds it unnamed.
    const text = await readFile(join(out, 'more.yaml'), 'utf8');
    await writeFile(join(out, 'bare.yaml'), text.replace(/^ignore:\n(?: {2}- .*\n)+/m, ''));
    const bare = await run(['estate', 'lint', join(out, 'bare.yaml')], out);
    expect(bare.out).toContain(orphan);
  });
});

describe('driftbench estate lint, approve and map', () => {
  it('lints the planted defects, approves by kind and all, and writes a space map the space package loads', async () => {
    const root = await fixtureCopy();
    expect(
      (await run(['estate', 'scan', '.', '--replay', 'answers.yaml', '--out', 'map.yaml'], root)).code,
    ).toBe(0);

    const lint = await run(['estate', 'lint', 'map.yaml'], root);
    expect(lint.code).toBe(1);
    expect(lint.out.match(/^ {2}[A-Z_]+/gm)?.map((code) => code.trim())).toEqual([
      'ORPHAN',
      'UNREACHABLE',
      'MISSING_REFERENCE',
      'UNANCHORED_GUARD',
      'REGISTRY_ROW',
      'REGISTRY_GUARD',
      'UNENFORCED',
      'EXTERNAL',
    ]);
    expect(lint.out).toContain('  EXTERNAL    0 named paths outside the estate (information).');

    const pending = await run(['estate', 'approve', 'map.yaml'], root);
    expect(pending.code).toBe(0);
    expect(pending.out).toContain('map.yaml: 57 of 126 atoms wait for approval.');
    const kind = await run(
      ['estate', 'approve', 'map.yaml', '--kind', 'register', '--to', 'registers.yaml'],
      root,
    );
    expect(kind.out).toBe('Approved 10 atoms in registers.yaml; 0 were already approved.\n');
    const all = await run(['estate', 'approve', 'registers.yaml', '--all', '--to', 'approved.yaml'], root);
    expect(all.out).toBe('Approved 47 atoms in approved.yaml; 79 were already approved.\n');
    expect((await run(['estate', 'approve', 'map.yaml', '--kind', 'rule'], root)).code).toBe(1);
    expect((await run(['estate', 'approve', 'map.yaml', '--all', '--kind', 'gate'], root)).code).toBe(2);
    expect(
      (await run(['estate', 'approve', 'map.yaml', '--all', '--to', '/tmp/elsewhere.yaml'], root)).code,
    ).toBe(2);

    const map = await run(['estate', 'map', 'approved.yaml', '--to', 'space.yaml'], root);
    expect(map.code).toBe(0);
    expect(map.out).toContain('6 situation axes, 8 target dimensions');
    const space = await loadSpaceMap(join(root, 'space.yaml'));
    expect(space.ok).toBe(true);
    expect(
      space.ok && space.map.dimensions.find((dimension) => dimension.id === 'atoms.instruction')?.values,
    ).toHaveLength(43);
    const unapproved = await run(['estate', 'map', 'map.yaml', '--to', 'code-only.yaml'], root);
    expect(unapproved.out).toContain('6 target dimensions (gate 4, route 13');
    expect((await run(['estate', 'map', 'map.yaml'], root)).code).toBe(2);
  });

  it('refuses a map whose quotes were edited by hand', async () => {
    const root = await fixtureCopy();
    await run(['estate', 'scan', '.', '--no-model', '--out', 'map.yaml'], root);
    const text = await readFile(join(root, 'map.yaml'), 'utf8');
    await writeFile(
      join(root, 'map.yaml'),
      text.replace('quote: "name: invoice-reconcile"', 'quote: "name: invoice"'),
    );
    const lint = await run(['estate', 'lint', 'map.yaml'], root);
    expect(lint.code).toBe(1);
    expect(lint.err).toContain('MAP_HASH');
    expect((await run(['estate', 'lint', 'nope.yaml'], root)).code).toBe(2);
  });
});
