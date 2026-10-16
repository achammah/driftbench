import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { processAdapter } from '@agent-nexus/driftbench-adapters';
import { docxReader, pdfReader, readWorkbook } from '@agent-nexus/driftbench-artifacts';
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import { localProvider } from '@agent-nexus/driftbench-sandbox';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { docx, para, pdf } from '../../../artifacts/test/fixtures';
import { runSpec } from '../../src/runner/run';
import { blockStatus } from '../../src/runner/verdicts';
import { specOf } from './support';

/**
 * Parent blocks on a code agent in a sandbox: the files a parent leaves in its workspace are the child's
 * starting workspace, in a sandbox of its own. A tiny local agent, fictional Acme data, no model call.
 * The binary outputs of a code-interpreter agent (xlsx, docx, pdf, png) carry byte for byte.
 */

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const XLSX = 'examples/acme/families/price-sheet/instances/i06/.seed-base/out/price-sheet.xlsx';
const PNG = 'docs/assets/bench-judgebench-light.png';

/** A PDF as real writers emit it: a comment of high bytes after the header, so it is not UTF-8 text. */
function binaryPdf(pages: readonly string[]): Uint8Array {
  const marker = Buffer.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]);
  const text = Buffer.from(pdf(pages)).toString('latin1');
  const shifted = text
    .replace(
      /^(\d{10}) 00000 n $/gm,
      (_, offset: string) => `${String(Number(offset) + marker.length).padStart(10, '0')} 00000 n `,
    )
    .replace(/startxref\n(\d+)/, (_, offset: string) => `startxref\n${Number(offset) + marker.length}`);
  const header = '%PDF-1.4\n';
  return Buffer.concat([
    Buffer.from(header, 'latin1'),
    marker,
    Buffer.from(shifted.slice(header.length), 'latin1'),
  ]);
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

const AGENT = `import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const FIXTURES = process.env.ACME_FIXTURES;
const root = process.env.DRIFTBENCH_WORKSPACE;
const ask = readFileSync(0, 'utf8').trim();
const notes = join(root, 'notes.txt');
if (ask === 'write') { writeFileSync(notes, 'Acme order ACME-7\\n'); console.log('saved'); }
else if (ask === 'make') { mkdirSync(join(root, 'out'), { recursive: true }); for (const name of readdirSync(FIXTURES)) copyFileSync(join(FIXTURES, name), join(root, 'out', name)); console.log('made'); }
else if (ask === 'hash') { const out = join(root, 'out'); console.log(existsSync(out) ? readdirSync(out).sort().map((name) => name + ' ' + createHash('sha256').update(readFileSync(join(out, name))).digest('hex')).join('\\n') : 'no files'); }
else if (ask === 'append') { writeFileSync(notes, readFileSync(notes, 'utf8') + 'paid\\n'); console.log('appended'); }
else console.log(existsSync(notes) ? readFileSync(notes, 'utf8') : 'no notes');
`;

const driver = createScriptedDriver();
const checks = defaultChecks();
let parent: string;
let agent: string;
let fixtures: string;
/** The files the parent block makes, by name: what the child must find byte for byte. */
const made = new Map<string, Uint8Array>();

beforeAll(async () => {
  parent = await realpath(await mkdtemp(join(tmpdir(), 'driftbench-parents-sandbox-')));
  agent = join(parent, 'agent.mjs');
  await writeFile(agent, AGENT);
  fixtures = join(parent, 'fixtures');
  await mkdir(fixtures);
  made.set('prices.xlsx', await readFile(join(ROOT, XLSX)));
  made.set('memo.docx', await docx(para('Acme memo: Mobile M costs 25 USD (fictional)')));
  made.set('quote.pdf', binaryPdf(['Acme quote ACME-7 (fictional)']));
  made.set('logo.png', await readFile(join(ROOT, PNG)));
  // A CSV as spreadsheet tools save it: a UTF-8 byte-order mark first, then text.
  made.set(
    'prices.csv',
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('plan,usd\nMobile M,25\n')]),
  );
  for (const [name, bytes] of made) await writeFile(join(fixtures, name), bytes);
});
afterAll(async () => {
  await rm(parent, { recursive: true, force: true });
});

function adapter(exportMaxBytes?: number) {
  return processAdapter({
    command: process.execPath,
    args: [agent],
    provider: localProvider({ dir: parent }),
    deterministic: true,
    env: { ACME_FIXTURES: fixtures },
    ...(exportMaxBytes === undefined ? {} : { exportMaxBytes }),
  });
}

describe('parent blocks on a sandboxed code agent', () => {
  it.each(['F', 'T'] as const)(
    '%s carries the parent workspace into the child sandbox, and isolates siblings and roots',
    async (mode) => {
      const spec = specOf({
        id: 'sandbox-parents',
        blocks: [
          { id: 'write', user: 'write', expect: { must: ['saved'] } },
          { id: 'read', parent: 'write', user: 'read', expect: { must: ['ACME-7'] } },
          { id: 'append', parent: 'write', user: 'append' },
          { id: 'after', parent: 'append', user: 'read', expect: { must: ['paid'] } },
          { id: 'sibling', parent: 'write', user: 'read', expect: { must_not: ['paid'] } },
          { id: 'fresh', user: 'read', expect: { must: ['no notes'] } },
        ],
      });
      const run = await runSpec(spec, { adapter: adapter(), driver, checks, mode, repeat: 0 });
      expect(run.blocks.map((block) => `${block.blockId}:${blockStatus(block)}`)).toEqual([
        'write:pass',
        'read:pass',
        'append:pass',
        'after:pass',
        'sibling:pass',
        'fresh:pass',
      ]);
    },
    120_000,
  );

  it('the fixtures are real, readable files: four binary, one CSV with a byte-order mark', async () => {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    for (const [name, bytes] of made) {
      if (name.endsWith('.csv')) expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
      else expect(() => decoder.decode(bytes), name).toThrow();
    }
    expect((await readWorkbook(made.get('prices.xlsx') as Uint8Array)).length).toBeGreaterThan(0);
    expect((await docxReader.open(made.get('memo.docx') as Uint8Array, 'out/memo.docx')).text()).toContain(
      'Acme memo',
    );
    expect((await pdfReader.open(made.get('quote.pdf') as Uint8Array, 'out/quote.pdf')).text()).toContain(
      'ACME-7',
    );
    expect(
      Buffer.from(made.get('logo.png') as Uint8Array)
        .subarray(1, 4)
        .toString('latin1'),
    ).toBe('PNG');
  });

  it.each(['F', 'T'] as const)(
    '%s carries xlsx, docx, pdf, png and a BOM CSV byte for byte into the child and the grandchild',
    async (mode) => {
      const hashes = [...made].map(([name, bytes]) => `${name} ${sha256(bytes)}`);
      const spec = specOf({
        id: 'sandbox-binary',
        blocks: [
          { id: 'make', user: 'make', expect: { must: ['made'] } },
          { id: 'child', parent: 'make', user: 'hash', expect: { must: hashes } },
          { id: 'grandchild', parent: 'child', user: 'hash', expect: { must: hashes } },
          { id: 'fresh', user: 'hash', expect: { must: ['no files'] } },
        ],
      });
      const run = await runSpec(spec, { adapter: adapter(), driver, checks, mode, repeat: 0 });
      expect(run.blocks.map((block) => `${block.blockId}:${blockStatus(block)}`)).toEqual([
        'make:pass',
        'child:pass',
        'grandchild:pass',
        'fresh:pass',
      ]);
    },
    120_000,
  );

  it('marks the children not run with the reason only above the export cap', async () => {
    const total = [...made.values()].reduce((sum, bytes) => sum + bytes.length, 0);
    const blocks = [
      { id: 'make', user: 'make' },
      { id: 'child', parent: 'make', user: 'hash' },
      { id: 'leaf', parent: 'child', user: 'hash' },
      { id: 'other', user: 'hash', expect: { must: ['no files'] } },
    ];
    const at = await runSpec(specOf({ id: 'sandbox-at-cap', blocks }), {
      adapter: adapter(total),
      driver,
      checks,
      mode: 'T',
      repeat: 0,
    });
    expect(at.blocks.map(blockStatus)).toEqual(['pass', 'pass', 'pass', 'pass']);
    const over = await runSpec(specOf({ id: 'sandbox-over-cap', blocks }), {
      adapter: adapter(total - 1),
      driver,
      checks,
      mode: 'T',
      repeat: 0,
    });
    expect(over.blocks.map(blockStatus)).toEqual(['pass', 'not_run', 'blocked', 'pass']);
    expect(over.blocks[1]?.notRun).toMatchObject({ kind: 'setup_failed', check: 'parent snapshot' });
    expect(over.blocks[1]?.notRun?.got).toContain(`more than the export bound of ${total - 1}`);
    expect(over.blocks[2]?.blocked).toMatchObject({ by: 'child', root: 'child' });
  }, 120_000);

  it('marks the children not run when a sandbox adapter cannot export at all, never resetting them', async () => {
    const { snapshotGiven: _export, ...rest } = adapter();
    const spec = specOf({
      id: 'sandbox-unexported',
      blocks: [
        { id: 'write', user: 'write' },
        { id: 'read', parent: 'write', user: 'read', expect: { must: ['ACME-7'] } },
      ],
    });
    const run = await runSpec(spec, { adapter: rest, driver, checks, mode: 'T', repeat: 0 });
    expect(run.blocks.map(blockStatus)).toEqual(['pass', 'not_run']);
    expect(run.blocks[1]?.notRun).toMatchObject({ kind: 'unsupported', layer: '5 world' });
  }, 120_000);
});
