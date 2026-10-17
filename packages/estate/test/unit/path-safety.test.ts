import { access, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { UnitTest } from '@agent-nexus/driftbench-generate';
import { expect, it } from 'vitest';
import { ClaudeCodeReader, observeUnitTests, runUnitTests } from '../../src/index';
import { estate } from '../support';

function test(files: Record<string, string>): UnitTest {
  return {
    id: 'parcels',
    planRow: 'row',
    atom: 'script',
    mapHash: 'original',
    recordedOn: 'original',
    title: 'Fictional parcels',
    testType: 'script_fixture',
    target: { kind: 'script', path: '.claude/parcel.sh' },
    cases: [
      { id: 'sample', material: 'parcel', payload: { files }, expected: { decision: 'allow', exitCode: 0 } },
    ],
  };
}

it.each(['payload', 'declared'])('validates every %s fixture path before writing any file', async (mode) => {
  const root = await estate({ 'CLAUDE.md': '# Parcels\n', '.claude/parcel.sh': '#!/bin/sh\nexit 0\n' });
  const outside = join(await realpath(root), 'outside.txt');
  const files = { 'valid.txt': 'parcel', [`${'../'.repeat(32)}${outside.replace(/^\//, '')}`]: 'escaped' };
  if (mode === 'declared')
    await writeFile(
      join(root, 'driftbench.estate.yaml'),
      JSON.stringify({ scripts: { '.claude/parcel.sh': [{ files, expect: { exitCode: 0 } }] } }),
    );
  const attempt =
    mode === 'declared'
      ? runUnitTests([test({})], { root, reader: new ClaudeCodeReader(), noSandbox: true })
      : observeUnitTests([test(files)], { root, reader: new ClaudeCodeReader(), noSandbox: true });
  await expect(attempt).rejects.toThrow(/outside|absolute|escape/i);
  await expect(access(outside)).rejects.toThrow();
});

it('rejects an absolute fixture path', async () => {
  const root = await estate({ 'CLAUDE.md': '# Parcels\n', '.claude/parcel.sh': '#!/bin/sh\nexit 0\n' });
  await expect(
    observeUnitTests([test({ [join(root, 'outside.txt')]: 'escaped' })], {
      root,
      reader: new ClaudeCodeReader(),
      noSandbox: true,
    }),
  ).rejects.toThrow(/absolute|outside/i);
});

it('rejects a script target outside the estate copy', async () => {
  const root = await estate({ 'CLAUDE.md': '# Parcels\n' });
  const unit = test({});
  unit.target = { kind: 'script', path: '../../../../bin/echo' };
  await expect(
    observeUnitTests([unit], { root, reader: new ClaudeCodeReader(), noSandbox: true }),
  ).rejects.toThrow(/outside/i);
});

it('rejects symlink fixture parents planted by an earlier case', async () => {
  const root = await estate({
    'CLAUDE.md': '# Parcels\n',
    '.claude/parcel.sh':
      '#!/bin/sh\nif [ -n "$1" ]; then mkdir -p "$TMPDIR/case-2"; ln -s "$1" "$TMPDIR/case-2/link"; fi\n',
    'outside.txt': 'original',
  });
  const unit = test({ 'valid.txt': 'parcel', 'link/outside.txt': 'escaped' });
  unit.cases.unshift({ id: 'plant', material: 'fixture link', payload: { args: [await realpath(root)] } });
  await expect(
    observeUnitTests([unit], { root, reader: new ClaudeCodeReader(), noSandbox: true }),
  ).rejects.toThrow(/outside/i);
  expect(await readFile(join(root, 'outside.txt'), 'utf8')).toBe('original');
});

it('rejects copy destinations supplied by a reader before writing', async () => {
  const root = await estate({ 'CLAUDE.md': '# Parcels\n' });
  const reader = new ClaudeCodeReader();
  reader.listFiles = async () => ['../escape.txt'];
  await expect(runUnitTests([], { root, reader, noSandbox: true })).rejects.toThrow(/outside/i);
});

it('copies a layout link as a real file, never as a link', async () => {
  const root = await estate({ 'CLAUDE.md': '# Parcels\n' });
  const shared = await estate({ 'parcel.txt': 'shared fictional parcel' });
  await symlink(join(shared, 'parcel.txt'), join(root, 'parcel.txt'));
  const reader = new ClaudeCodeReader();
  reader.listFiles = async () => ['parcel.txt'];
  await expect(runUnitTests([], { root, reader, noSandbox: true })).resolves.toBeDefined();
});

it('reads the estate configuration from the runtime folder when the root has none', async () => {
  const declare = (stdout: string) =>
    JSON.stringify({ scripts: { '.claude/parcel.sh': [{ expect: { exitCode: 0, stdout } }] } });
  const root = await estate({
    'CLAUDE.md': '# Parcels\n',
    '.claude/parcel.sh': '#!/bin/sh\nprintf parcel\n',
    '.claude/driftbench.estate.yaml': declare('parcel'),
  });
  const options = { root, reader: new ClaudeCodeReader(), noSandbox: true };
  // Only a declared fixture can fail on its stdout; with no configuration read, the run would not.
  expect((await runUnitTests([test({})], options)).results[0]?.detail).not.toMatch(/no fixture|recorded/i);
  await writeFile(join(root, '.claude', 'driftbench.estate.yaml'), declare('different'));
  expect((await runUnitTests([test({})], options)).results[0]?.status).toBe('fail');
  await writeFile(join(root, 'driftbench.estate.yaml'), declare('parcel'));
  expect((await runUnitTests([test({})], options)).results[0]?.status).toBe('pass');
});
