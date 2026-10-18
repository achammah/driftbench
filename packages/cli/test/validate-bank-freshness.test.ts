import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readJournal, statsBankHash } from '@agent-nexus/driftbench-validators';
import { afterEach, expect, it } from 'vitest';
import { journalOf, journalRow, PASSING_AUDIT, plantedLadder } from '../../validators/test/support';
import { validateCommand } from '../src/commands/validate';
import type { Io } from '../src/io';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'astra-stats-freshness-'));
  roots.push(root);
  const put = (path: string, content: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  put('packages/validators/src/ladders/stats/index.ts', 'export const bank = [1];');
  put('packages/validators/fixtures/stats/exact.json', '{"expected":1}');
  put('packages/stats/test/reference/fixtures.json', '{"reference":1}');
  for (const name of ['bank.ts', 'ladder.ts', 'seeds.ts']) {
    put(`packages/validators/src/${name}`, 'export const measurement = 1;');
  }
  put('validators/stats/audit.md', PASSING_AUDIT);
  const output = { out: '', err: '' };
  const io: Io = {
    cwd: root,
    out: (text) => {
      output.out += text;
    },
    err: (text) => {
      output.err += text;
    },
  };
  const { ladder } = plantedLadder([], 'stats');
  const deps = { root, ladders: () => ({ stats: ladder }) };
  const journal = (hash?: string) => {
    const rows = journalOf([30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40], 300, {
      '1': 100,
      '2': 80,
      '3': 60,
      '4': 40,
      '5': 20,
    });
    put(
      'validators/stats/journal.jsonl',
      `${rows
        .map((row) =>
          JSON.stringify({
            ...(row as object),
            ...(hash === undefined ? {} : { bankHash: hash }),
          }),
        )
        .join('\n')}\n`,
    );
  };
  return { root, put, io, output, deps, journal };
}

it('refuses a current gate claim from a legacy pilot without a bank hash, retaining its measurements', async () => {
  const f = fixture();
  f.journal();
  expect(await validateCommand('stats', { hardness: true, json: true }, f.io, f.deps)).toBe(1);
  const h = JSON.parse(f.output.out);
  expect(h.forecast).toBe(260);
  expect(h.freshness.status).toBe('unverified');
  expect(h.gate.reasons.join(' ')).toContain('bankHash');
});

it('rejects a mismatched hash even when the complete pilot and every audit check pass', async () => {
  const f = fixture();
  f.journal('a'.repeat(64));
  expect(await validateCommand('stats', { hardness: true }, f.io, f.deps)).toBe(1);
  expect(f.output.out).toContain('bank hash differs from the live bank');
  expect(f.output.out).toContain('Gate: NOT MET');
});

it('accepts a matching bank hash and rejects a changed baseline even if the final row matches', async () => {
  const f = fixture();
  const hash = statsBankHash(f.root);
  f.journal(hash);
  expect(await validateCommand('stats', { hardness: true, json: true }, f.io, f.deps)).toBe(0);
  expect(JSON.parse(f.output.out).freshness).toMatchObject({ status: 'current', liveBankHash: hash });
  const path = join(f.root, 'validators/stats/journal.jsonl');
  const rows = readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  rows[0].bankHash = 'b'.repeat(64);
  f.put('validators/stats/journal.jsonl', `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
  f.output.out = '';
  expect(await validateCommand('stats', { hardness: true, json: true }, f.io, f.deps)).toBe(1);
  expect(JSON.parse(f.output.out).freshness.status).toBe('stale');
});

it.each([
  ['source', 'packages/validators/src/ladders/stats/index.ts', 'export const bank = [2];'],
  ['fixture', 'packages/validators/fixtures/stats/exact.json', '{"expected":2}'],
  ['reference', 'packages/stats/test/reference/fixtures.json', '{"reference":2}'],
  ['scoring frame', 'packages/validators/src/ladder.ts', 'export const measurement = 2;'],
])('invalidates the pilot after a %s change', async (_kind, path, contents) => {
  const f = fixture();
  const before = statsBankHash(f.root);
  f.journal(before);
  f.put(path, contents);
  expect(statsBankHash(f.root)).not.toBe(before);
  expect(await validateCommand('stats', { hardness: true }, f.io, f.deps)).toBe(1);
  expect(f.output.out).toContain('bank hash differs from the live bank');
});

it('keeps the fingerprint stable through product changes and journal, gate and audit writes', async () => {
  const f = fixture();
  const hash = statsBankHash(f.root);
  f.journal(hash);
  f.put('packages/stats/src/index.ts', 'export const mean = () => 42;');
  f.put('validators/stats/GATE.md', 'Min forecast: 70\n');
  f.put('validators/stats/audit.md', `${PASSING_AUDIT}\nEvidence note.\n`);
  expect(statsBankHash(f.root)).toBe(hash);
  expect(await validateCommand('stats', { hardness: true }, f.io, f.deps)).toBe(0);
});

it('emits the measured bank hash on a full JSON run and requires it unchanged when appending', async () => {
  const f = fixture();
  const hash = statsBankHash(f.root);
  expect(await validateCommand('stats', { seed: '1', items: true, json: true }, f.io, f.deps)).toBe(3);
  expect(JSON.parse(f.output.out).bankHash).toBe(hash);
  const row = journalRow(0);
  f.put('row.json', JSON.stringify(row));
  expect(await validateCommand('stats', { journal: 'row.json' }, f.io, f.deps)).toBe(1);
  expect(f.output.err).toContain('bankHash');
  f.put('row.json', JSON.stringify({ ...row, bankHash: 'c'.repeat(64) }));
  expect(await validateCommand('stats', { journal: 'row.json' }, f.io, f.deps)).toBe(1);
  f.put('row.json', JSON.stringify({ ...row, bankHash: hash }));
  expect(await validateCommand('stats', { journal: 'row.json' }, f.io, f.deps)).toBe(0);
  const saved = readJournal(f.root, 'stats');
  expect(saved.problems).toEqual([]);
  expect(saved.rows.map((row) => row.bankHash)).toEqual([hash]);
});
