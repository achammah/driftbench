import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Atom, type EstateMap, mapHash, provenanceHash } from '@agent-nexus/driftbench-estate';
import { afterEach, expect, it } from 'vitest';
import { parse } from 'yaml';
import { main } from '../src/index';

const rule = 'When a shipment is late by more than two days, tell the user.';
const other = 'Always read the file before editing it.';
const before = `${rule}\n${other}\n`;
const after = before.replace('more than two days', 'more than one day');
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

it('normalizes a line-ending-only edit with identical versions and selects no estate tests', async () => {
  const result = await auto(estate(), before, before.replaceAll('\n', '\r\n'), { to: 'v1' });
  expect(result).toMatchObject({ code: 0, err: '', manifest: { from: 'v1', to: 'v1', changes: [] } });
  const manifest = join(result.dir, 'change.yaml');
  await writeFile(manifest, result.out);
  const specs = fileURLToPath(
    new URL('../../../examples/estates/fixture/generated/specs/live', import.meta.url),
  );
  let out = '',
    err = '';
  const code = await main(['radius', specs, '--change', manifest, '--json'], {
    cwd: result.dir,
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
  });
  expect({ code, err }).toEqual({ code: 0, err: '' });
  const report = JSON.parse(out) as {
    whole: unknown;
    totals: { F: { in: number; sent: number; cells: { in: number } } };
    specs: Array<{ blocks: Array<{ state: { F: string } }> }>;
  };
  expect(report.whole).toBeNull();
  expect(report.specs.length).toBeGreaterThan(0);
  expect(report.totals.F).toMatchObject({ in: 0, sent: 0, cells: { in: 0 } });
  expect(report.specs.flatMap((spec) => spec.blocks).every((block) => block.state.F === 'out')).toBe(true);
});

it('keeps the conservative version-transition rule for normalized identical text', async () => {
  const result = await auto(estate(), before, before.replaceAll('\n', '\r\n'));
  expect(result.manifest.changes).toEqual([expect.objectContaining({ global: true })]);
});
