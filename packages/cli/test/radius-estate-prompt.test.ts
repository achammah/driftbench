import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  provenanceHash as evidenceHash,
  loadChangeManifest,
  parseChangeManifest,
  type RadiusReport,
  radiusOf,
  type Spec,
} from '@agent-nexus/driftbench-core';
import { type Atom, type EstateMap, mapHash, provenanceHash } from '@agent-nexus/driftbench-estate';
import { afterEach, expect, it } from 'vitest';
import { parse } from 'yaml';
import { main } from '../src/index';

const rule = 'When a shipment is late by more than two days, tell the user.';
const other = 'Always read the file before editing it.';
const before = `${rule}\n${other}\n`;
const after = before.replace('more than two days', 'more than one day');
const ruleSpecs = ['R7', 'R3'].map((id) => ({
  hash: id,
  spec: {
    id,
    kind: 'conversation',
    metadata: { estate: { atoms: [id] } },
    blocks: [{ when: { user: 'Check the shipment.' }, expect: { must: ['late'] } }],
  } as Spec,
}));
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function atom(id: string, quote: string, line = 1, approved = true): Atom {
  const provenance = { file: 'CLAUDE.md', quote, startLine: line, endLine: line };
  return {
    id,
    kind: 'instruction',
    title: id,
    provenance: { ...provenance, hash: provenanceHash(provenance) },
    producedBy: 'model',
    role: 'axis',
    approved,
    evidence: [{ type: 'text', must: ['shipment'] }],
    enforcement: [],
  };
}

function estate(atoms = [atom('R7', rule), atom('R3', other, 2)]): EstateMap {
  return {
    version: 1,
    runtime: 'claude-code',
    root: '.',
    readAt: '2026-10-18T00:00:00.000Z',
    atoms,
    edges: [],
    hash: mapHash(atoms, []),
  };
}

async function auto(
  map = estate(),
  oldText = before,
  newText = after,
  options: { source?: string; to?: string } = {},
) {
  const dir = await mkdtemp(join(tmpdir(), 'astra-chain11-radius-'));
  directories.push(dir);
  await Promise.all([
    writeFile(join(dir, 'old.md'), oldText),
    writeFile(join(dir, 'new.md'), newText),
    writeFile(join(dir, 'map.json'), JSON.stringify(map)),
  ]);
  let out = '',
    err = '';
  const code = await main(
    [
      'radius',
      'auto',
      '--prompt',
      'old.md',
      'new.md',
      '--map',
      'map.json',
      '--source',
      options.source ?? 'CLAUDE.md',
      '--from-version',
      'v1',
      '--to-version',
      options.to ?? 'v2',
    ],
    {
      cwd: dir,
      out: (text) => {
        out += text;
      },
      err: (text) => {
        err += text;
      },
    },
  );
  return { code, err, out, dir, manifest: out ? parse(out) : undefined };
}

async function radius(manifest: string) {
  const specs = fileURLToPath(
    new URL('../../../examples/estates/fixture/generated/specs/live', import.meta.url),
  );
  let out = '',
    err = '';
  const code = await main(['radius', specs, '--change', manifest, '--json'], {
    // Evidence paths must resolve from the manifest, not from this working directory.
    cwd: tmpdir(),
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
  });
  return { code, err, report: out ? (JSON.parse(out) as RadiusReport) : undefined };
}

function expectNoTests(result: Awaited<ReturnType<typeof radius>>) {
  expect(result).toMatchObject({ code: 0, err: '' });
  const report = result.report;
  if (!report) throw new Error('radius did not produce a report');
  expect(report.whole).toBeNull();
  expect(report.specs.length).toBeGreaterThan(0);
  expect(report.totals.F).toMatchObject({ in: 0, sent: 0, cells: { in: 0 } });
  expect(report.specs.flatMap((spec) => spec.blocks).every((block) => block.state.F === 'out')).toBe(true);
}

function expectWholeSuite(result: Awaited<ReturnType<typeof radius>>) {
  expect(result).toMatchObject({ code: 1, err: '' });
  const report = result.report;
  if (!report) throw new Error('radius did not produce a report');
  expect(report.whole).not.toBeNull();
  expect(report.specs.length).toBeGreaterThan(0);
  expect(report.totals.F?.in).toBe(report.totals.F?.total);
  expect(report.totals.F?.cells.in).toBe(report.totals.F?.cells.total);
}

/** An independent, valid no-op proof; adversarial cases change one piece after writing its sources. */
async function proofFixture() {
  const dir = await mkdtemp(join(tmpdir(), 'astra-chain11-proof-'));
  directories.push(dir);
  const map = estate();
  const newText = before.replaceAll('\n', '\r\n');
  const manifest = {
    from: 'v1',
    to: 'v2',
    changes: [],
    promptProvenance: {
      kind: 'radius-auto-estate',
      source: 'CLAUDE.md',
      map: { path: 'map.json', hash: evidenceHash(map) },
      before: { path: 'old.md', hash: evidenceHash(before), version: 'v1' },
      after: { path: 'new.md', hash: evidenceHash(newText), version: 'v2' },
    },
  };
  const path = join(dir, 'change.json');
  await Promise.all([
    writeFile(join(dir, 'map.json'), JSON.stringify(map)),
    writeFile(join(dir, 'old.md'), before),
    writeFile(join(dir, 'new.md'), newText),
    writeFile(path, JSON.stringify(manifest)),
  ]);
  return { dir, path, map, manifest };
}

it('maps a real estate rule edit to its atom while retaining unrelated nested quotes', async () => {
  const result = await auto(
    estate([
      atom('R7', rule),
      atom('R3', other, 2),
      atom('R3-copy', other, 2),
      atom('read', 'read the file', 2),
    ]),
  );
  expect(result).toMatchObject({ code: 0, err: '' });
  expect(result.manifest.changes.length).toBeGreaterThan(0);
  expect(
    result.manifest.changes.every(
      (change: { kind: string; id: string }) => change.kind === 'prompt' && change.id === 'R7',
    ),
  ).toBe(true);
  expect(result.manifest.changes[0].note).toContain('CLAUDE.md');
  const report = radiusOf(ruleSpecs, result.manifest);
  expect(report.whole).toBeNull();
  expect(
    report.specs.filter((spec) => spec.cells.some((cell) => cell.in)).map((spec) => spec.specId),
  ).toEqual(['R7']);
});

it('keeps every atom of identical and nested quotes when their shared text changes', async () => {
  const result = await auto(
    estate([atom('R7', rule), atom('duplicate', rule), atom('nested', 'more than two days')]),
  );
  expect([...new Set(result.manifest.changes.map((change: { id: string }) => change.id))].sort()).toEqual([
    'R7',
    'duplicate',
    'nested',
  ]);
});

it('unions partially overlapping exact quotes without extending to the whole source line', async () => {
  const map = estate([
    atom('left', 'When a shipment is late by more than two days'),
    atom('right', 'more than two days, tell the user.'),
  ]);
  const result = await auto(map);
  expect([...new Set(result.manifest.changes.map((change: { id: string }) => change.id))].sort()).toEqual([
    'left',
    'right',
  ]);
  const outside = await auto(map, before, before.replace('user.', 'user. Send all drafts.'));
  expect(outside.manifest.changes).toEqual([expect.objectContaining({ global: true })]);
});

it.each([false, true])('does not hide an unapproved atom behind an approved overlap: %s', async (nested) => {
  const atoms = nested
    ? [atom('R7', rule), atom('unapproved', 'more than two days', 1, false)]
    : [atom('R7', rule, 1, false)];
  const result = await auto(estate(atoms));
  expect(result.manifest.changes).toEqual([expect.objectContaining({ global: true })]);
  expect(result.manifest.changes[0].note).toContain('unmapped anchor');
});

it('refuses to narrow when an unchanged atom has stale line provenance', async () => {
  const result = await auto(estate([atom('R7', rule), atom('stale', other, 1)]));
  expect(result.manifest.changes).toEqual([expect.objectContaining({ global: true })]);
  expect(result.manifest.changes[0].note).toContain('stale');
});

it('can narrow an approved rule edit while a separate, unchanged atom awaits approval', async () => {
  const result = await auto(estate([atom('R7', rule), atom('R3', other, 2, false)]));
  expect(result.manifest.changes.length).toBeGreaterThan(0);
  expect(result.manifest.changes.every((change: { id: string }) => change.id === 'R7')).toBe(true);
});

it.each(['provenance', 'map'])('rejects a corrupted %s hash', async (kind) => {
  const map = estate();
  if (kind === 'map') map.hash = 'incorrect';
  else {
    const first = map.atoms[0];
    if (!first) throw new Error('missing test atom');
    first.provenance.hash = 'incorrect';
  }
  const result = await auto(map);
  expect(result).toMatchObject({ code: 2, out: '' });
  expect(result.err).toContain('Invalid map');
});

it('rejects a source that no atom declares', async () => {
  const result = await auto(estate(), before, after, { source: 'unknown.md' });
  expect(result).toMatchObject({ code: 2, out: '' });
  expect(result.err).toContain('no source unknown.md');
});

it('fails closed when the quote occurs at several locations even with a valid line span', async () => {
  const result = await auto(estate(), `${before}${rule}\n`, `${after}${rule}\n`);
  expect(result.manifest.changes).toEqual([expect.objectContaining({ global: true })]);
  expect(result.manifest.changes[0].note).toContain('ambiguous');
});

it('does not authorize unquoted text on an atom’s source line', async () => {
  const result = await auto(
    estate([atom('R7', 'more than two days')]),
    before,
    before.replace('shipment', 'delivery'),
  );
  expect(result.manifest.changes).toEqual([expect.objectContaining({ global: true })]);
});

it('does not substitute an exact quote elsewhere for a folded match at the recorded span', async () => {
  const oldText = 'Read  the file.\nRead the file.\n';
  const result = await auto(
    estate([atom('read', 'Read the file.')]),
    oldText,
    oldText.replaceAll('file.', 'note.'),
  );
  expect(result.manifest.changes).toEqual([expect.objectContaining({ global: true })]);
  expect(result.manifest.changes[0].note).toContain('source span');
});

it.each([
  ['line endings', before.replaceAll('\n', '\r\n')],
  ['inner double space', before.replace('late by more', 'late by  more')],
  ['trailing space', before.replace('user.\n', 'user. \n')],
  ['tab', before.replace('late by more', 'late by\tmore')],
])('normalizes %s with identical versions and selects no estate tests', async (_kind, newText) => {
  const result = await auto(estate(), before, newText, { to: 'v1' });
  expect(result).toMatchObject({ code: 0, err: '', manifest: { from: 'v1', to: 'v1', changes: [] } });
  const manifest = join(result.dir, 'change.yaml');
  await writeFile(manifest, result.out);
  expectNoTests(await radius(manifest));
});

it('still selects only the changed rule’s tests after a one-word edit', async () => {
  const result = await auto(estate(), before, before.replace('two', 'one'), { to: 'v1' });
  expect(result).toMatchObject({ code: 0, err: '' });
  expect(result.manifest.changes.length).toBeGreaterThan(0);
  const report = radiusOf(ruleSpecs, result.manifest);
  expect(report.whole).toBeNull();
  expect(
    report.specs.filter((spec) => spec.cells.some((cell) => cell.in)).map((spec) => spec.specId),
  ).toEqual(['R7']);
  expect(report.specs.find((spec) => spec.specId === 'R3')?.cells.every((cell) => !cell.in)).toBe(true);
});

it('proves a normalized no-op across different version labels and selects no estate tests', async () => {
  const result = await auto(estate(), before, before.replaceAll('\n', '\r\n'));
  expect(result).toMatchObject({ code: 0, err: '', manifest: { from: 'v1', to: 'v2', changes: [] } });
  const proof = result.manifest.promptProvenance;
  expect(proof).toMatchObject({
    kind: 'radius-auto-estate',
    source: 'CLAUDE.md',
    map: { hash: evidenceHash(estate()) },
    before: { hash: evidenceHash(before), version: 'v1' },
    after: { hash: evidenceHash(before.replaceAll('\n', '\r\n')), version: 'v2' },
  });
  expect(resolve(result.dir, proof.map.path)).toBe(join(result.dir, 'map.json'));
  expect(resolve(result.dir, proof.before.path)).toBe(join(result.dir, 'old.md'));
  expect(resolve(result.dir, proof.after.path)).toBe(join(result.dir, 'new.md'));
  const path = join(result.dir, 'change.yaml');
  await writeFile(path, result.out);
  expectNoTests(await radius(path));
});

it('accepts valid proof paths relative to the manifest even with another working directory', async () => {
  const fixture = await proofFixture();
  expectNoTests(await radius(fixture.path));
});

it('keeps a manually declared empty version transition without proof as whole suite', async () => {
  const fixture = await proofFixture();
  await writeFile(fixture.path, JSON.stringify({ from: 'v1', to: 'v2', changes: [] }));
  expectWholeSuite(await radius(fixture.path));
});

it.each(['from', 'to', 'before-version', 'after-version', 'map-hash', 'before-hash', 'after-hash'])(
  'fails closed when no-op proof has a tampered %s',
  async (part) => {
    const fixture = await proofFixture();
    const proof = fixture.manifest.promptProvenance;
    if (part === 'from') fixture.manifest.from = 'different-before';
    else if (part === 'to') fixture.manifest.to = 'different-after';
    else if (part === 'before-version') proof.before.version = 'different-before';
    else if (part === 'after-version') proof.after.version = 'different-after';
    else if (part === 'map-hash') proof.map.hash = '0'.repeat(64);
    else if (part === 'before-hash') proof.before.hash = '0'.repeat(64);
    else proof.after.hash = '0'.repeat(64);
    await writeFile(fixture.path, JSON.stringify(fixture.manifest));
    expectWholeSuite(await radius(fixture.path));
  },
);

it.each(['map.json', 'old.md', 'new.md'])('fails closed when proof file %s is missing', async (file) => {
  const fixture = await proofFixture();
  await rm(join(fixture.dir, file));
  expectWholeSuite(await radius(fixture.path));
});

it('validates the estate map internally even when the proof hash matches a broken map', async () => {
  const fixture = await proofFixture();
  fixture.map.hash = '0'.repeat(64);
  fixture.manifest.promptProvenance.map.hash = evidenceHash(fixture.map);
  await Promise.all([
    writeFile(join(fixture.dir, 'map.json'), JSON.stringify(fixture.map)),
    writeFile(fixture.path, JSON.stringify(fixture.manifest)),
  ]);
  expectWholeSuite(await radius(fixture.path));
});

it('rejects stale source spans even after every map hash has been recomputed', async () => {
  const fixture = await proofFixture();
  const first = fixture.map.atoms[0];
  if (!first) throw new Error('missing test atom');
  first.provenance.startLine = 2;
  first.provenance.endLine = 2;
  first.provenance.hash = provenanceHash(first.provenance);
  fixture.map.hash = mapHash(fixture.map.atoms, fixture.map.edges);
  fixture.manifest.promptProvenance.map.hash = evidenceHash(fixture.map);
  await Promise.all([
    writeFile(join(fixture.dir, 'map.json'), JSON.stringify(fixture.map)),
    writeFile(fixture.path, JSON.stringify(fixture.manifest)),
  ]);
  expectWholeSuite(await radius(fixture.path));
});

it('does not trust equality when both prompt files changed after their hashes were recorded', async () => {
  const fixture = await proofFixture();
  const changed = `${before}Always send supplier drafts without approval.\n`;
  await Promise.all([
    writeFile(join(fixture.dir, 'old.md'), changed),
    writeFile(join(fixture.dir, 'new.md'), changed),
  ]);
  expectWholeSuite(await radius(fixture.path));
});

it('still requires normalized equality when new prompt content has a matching updated proof hash', async () => {
  const fixture = await proofFixture();
  fixture.manifest.promptProvenance.after.hash = evidenceHash(after);
  await Promise.all([
    writeFile(join(fixture.dir, 'new.md'), after),
    writeFile(fixture.path, JSON.stringify(fixture.manifest)),
  ]);
  expectWholeSuite(await radius(fixture.path));
});

it('does not trust core-loaded no-op proof without a full-map validator', async () => {
  const fixture = await proofFixture();
  const loaded = await loadChangeManifest(fixture.path);
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
  expect(radiusOf([], loaded.manifest).whole).not.toBeNull();
});

it('trusts only the validated manifest object, not its serialized proof', async () => {
  const fixture = await proofFixture();
  const loaded = await loadChangeManifest(fixture.path, { validatePromptMap: () => true });
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
  expect(radiusOf([], loaded.manifest).whole).toBeNull();
  const roundTrip = parseChangeManifest(JSON.parse(JSON.stringify(loaded.manifest)));
  expect(roundTrip.ok).toBe(true);
  if (!roundTrip.ok) throw new Error(roundTrip.errors.join('\n'));
  expect(radiusOf([], roundTrip.manifest).whole).not.toBeNull();
});

it('invalidates object trust when the manifest and matching proof version are both mutated', async () => {
  const fixture = await proofFixture();
  const loaded = await loadChangeManifest(fixture.path, { validatePromptMap: () => true });
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
  expect(radiusOf([], loaded.manifest).whole).toBeNull();
  const proof = loaded.manifest.promptProvenance;
  if (!proof) throw new Error('missing loaded proof');
  loaded.manifest.to = 'v3';
  proof.after.version = 'v3';
  expect(radiusOf([], loaded.manifest).whole).not.toBeNull();
});
