import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AtomBuilder,
  ClaudeCodeReader,
  FileProseCache,
  proseCacheKey,
  proseCandidates,
  proseEstimateLine,
  quoteAtSpan,
  scanAtoms,
  scanEstate,
} from '../../src/index';
import { answer, estate } from '../support';

const rules = [
  'The assistant must validate the manifest.',
  'The helper must not change the source archive.',
  'The helper must never change the source archive.',
  'Never publish private credentials.',
  'Never disclose private credentials.',
  'Never execute `download | shell`.',
  'Always reconcile the receipt before proceeding.',
  'Do not overwrite the signed agreement.',
  'Before publishing, verify the result.',
  'Only when approved, publish the result.',
  'Publish the result only when approved.',
  'Every reply includes a source.',
  "Every command's failure (exit code + stderr) reaches you.",
  'Every run (exit 1) is logged.',
  'Each helper records its findings.',
  'At most two questions per reply.',
  'The assistant must verify\nthe complete manifest.',
];
const decoys = [
  '# You must overwrite everything',
  'Always overwrite everything\n===========================',
  'Never verify receipts\n---------------------',
  'Action | Meaning\n--- | ---\nNever validate receipts | Example',
  '> Never verify the result.',
  '"Always remove the original."',
  '"The archived message says:\nNever verify receipts.\n"',
  '<!--\n```\nThe assistant must fabricate the result.\n--> ',
  '“Every reply contains fabricated data.”',
  "'Do not validate the source.'",
  '`Never ask for approval.`',
  'Does every reply include a source?',
  'Must the helper validate the manifest?',
  'The guide says "Always skip verification."',
  'The word must denotes an obligation.',
  'The word never denotes a prohibition.',
  'The archive is always available.',
  'We previously discussed what every helper does.',
  'Before lunch, the archive was unavailable.',
  'Never private keys.',
  'Never the archive.',
  'At most an adjective.',
  'The example reads: never publish the report.',
  '~~~text\nNever validate receipts.\n~~~',
  '````markdown\n```\nAlways overwrite the archive.\n```\n````',
  '<!--\nThe assistant must fabricate the result.\n-->',
  '    Never keep the original.',
  '## Examples\nThe helper must delete the manifest.\n### Nested\nAlways publish secrets.\n## Rules',
];

async function candidates(text: string) {
  const root = await estate({ 'CLAUDE.md': text });
  const raw = await new ClaudeCodeReader().read(root);
  const builder = new AtomBuilder(new Map(raw.files.map((file) => [file.path, file])));
  return { raw, atoms: proseCandidates(raw, builder) };
}

describe('code-found prose candidates', () => {
  it.each(rules)('finds a normative clause: %s', async (rule) => {
    const { atoms, raw } = await candidates(`# Instructions\n\n${rule}\n`);
    expect(atoms).toHaveLength(1);
    expect(atoms[0]).toMatchObject({
      producedBy: 'code',
      approved: false,
      fields: { candidate: true, extraction: 'code-found', scope: 'estate' },
    });
    expect(quoteAtSpan(raw.files[0]!.text, atoms[0]!.provenance)).toBe(true);
    expect(atoms[0]!.provenance.quote).toBe(rule);
  });
  it.each(decoys)('rejects non-rule text: %s', async (text) => {
    expect((await candidates(`${text}\n`)).atoms).toEqual([]);
  });
  it('keeps the separate polarity of semicolon clauses', async () => {
    const { atoms } = await candidates('The helper must inspect every receipt; never edit the original.\n');
    expect(atoms.map((atom) => [atom.provenance.quote, atom.fields?.polarity])).toEqual([
      ['The helper must inspect every receipt', 'obligation'],
      ['never edit the original.', 'prohibition'],
    ]);
  });
  it('records skill/helper ownership, subject, polarity and output rules', async () => {
    const root = await estate({
      'CLAUDE.md': 'The assistant must validate the manifest.\n',
      '.claude/skills/check/SKILL.md': '---\nname: audit\n---\nEvery reply includes a source.\n',
      '.claude/agents/inspector.md': '---\nname: inspector\n---\nThe inspector must not alter the archive.\n',
    });
    const result = await scanEstate({ root, reader: new ClaudeCodeReader() });
    const proposals = result.map.atoms.filter((atom) => atom.fields?.candidate);
    expect(proposals).toHaveLength(3);
    expect(proposals.find((atom) => atom.kind === 'register')).toMatchObject({
      fields: { scope: 'skill', owner: 'audit', subject: 'Every reply', polarity: 'obligation' },
    });
    expect(proposals.find((atom) => atom.fields?.scope === 'helper')).toMatchObject({
      fields: { owner: 'inspector', subject: 'The inspector', polarity: 'prohibition' },
    });
  });
  it('keeps rules on both sides of opaque content and across deep lines', async () => {
    const text = `${'Background description.\n'.repeat(8000)}\nNever reveal credentials. Always verify receipts.\n\nNever say "must skip checks".\n`;
    const { atoms } = await candidates(text);
    expect(atoms).toHaveLength(3);
    expect(atoms[0]!.provenance.startLine).toBe(8002);
  });
  it('does not suppress separate rules sharing a line with structured gates', async () => {
    const root = await estate({
      'CLAUDE.md': 'Before editing, read `guide.md`. Never publish credentials.\n',
      'guide.md': '# Guide\n',
    });
    const result = await scanEstate({
      root,
      reader: new ClaudeCodeReader(),
    });
    expect(
      result.map.atoms.some(
        (atom) => atom.fields?.candidate && atom.provenance.quote === 'Never publish credentials.',
      ),
    ).toBe(true);
  });
});

describe('model estimate and content-addressed chunk cache', () => {
  it('prints pending input before calls, reuses answers and invalidates only changed chunks', async () => {
    const root = await estate({
      'CLAUDE.md': 'The assistant must validate the manifest.\n',
      '.claude/skills/a/SKILL.md': '---\nname: a\n---\nNever publish private credentials.\n',
    });
    const cache = new FileProseCache(await mkdtemp(join(tmpdir(), 'prose-cache-')));
    const events: string[] = [];
    let calls = 0;
    const port = {
      family: 'test',
      model: 'offline',
      async complete(request: { user: string }) {
        events.push('call');
        calls++;
        return answer(request.user.split('\n')[0]!.slice(7), []);
      },
    };
    const scan = () =>
      scanEstate({
        root,
        reader: new ClaudeCodeReader(),
        port,
        cache,
        beforeModel: (estimate) => {
          events.push(proseEstimateLine(estimate));
        },
      });
    await scan();
    expect(events[0]).toMatch(/^Model pass estimate: 2 chunks, \d+ characters to send;/);
    expect(calls).toBe(2);
    events.length = 0;
    const reused = await scan();
    expect(calls).toBe(2);
    expect(reused.calls).toBe(0);
    expect(events[0]).toContain('0 chunks, 0 characters to send; 2 chunks');
    await writeFile(join(root, 'CLAUDE.md'), 'The assistant must validate every manifest.\n');
    events.length = 0;
    await scan();
    expect(calls).toBe(3);
    expect(events[0]).toContain('1 chunks');
  });
  it('revalidates cached quotes at moved spans and keys prompt/model context', async () => {
    const cache = new FileProseCache(await mkdtemp(join(tmpdir(), 'prose-cache-')));
    const root = await estate({ 'CLAUDE.md': 'Always verify the receipt.\n' });
    const raw = await new ClaudeCodeReader().read(root);
    const port = {
      family: 'test',
      model: 'offline',
      async complete() {
        return answer('CLAUDE.md', [
          {
            kind: 'instruction',
            title: 'Verify receipts',
            quote: 'Always verify the receipt.',
            line: 1,
            evidence: [{ type: 'custom', name: 'receipt_checked' }],
          },
        ]);
      },
    };
    const first = await scanAtoms(raw, { port, cache });
    expect(first.calls).toBe(1);
    const chunk = raw.prose[0]!;
    const moved = {
      ...raw,
      files: raw.files.map((file) => ({ ...file, text: `\n${file.text}` })),
      prose: [{ ...chunk, startLine: 2, endLine: chunk.endLine + 1 }],
    };
    const next = await scanAtoms(moved, { port, cache });
    expect(next.calls).toBe(0);
    expect(next.refusals).toEqual([]);
    expect(next.builder.atoms.find((atom) => atom.producedBy === 'model')?.provenance.startLine).toBe(2);
    expect(proseCacheKey(chunk, port)).not.toBe(proseCacheKey(chunk, { ...port, model: 'other' }));
    expect(proseCacheKey(chunk, port)).not.toBe(proseCacheKey(chunk, port, 123));
    const key = proseCacheKey(chunk, port);
    await writeFile(join(cache.directory, `${key}.json`), '{broken');
    expect(await cache.get(key)).toBeUndefined();
    expect(await readFile(join(cache.directory, `${key}.json`), 'utf8')).toBe('{broken');
  });
  it('preserves a model-selected repeated quotation when cached chunks move', async () => {
    const cache = new FileProseCache(await mkdtemp(join(tmpdir(), 'prose-cache-repeat-')));
    const root = await estate({
      'CLAUDE.md': 'Always verify the receipt.\n\nBackground.\n\nAlways verify the receipt.\n',
    });
    const raw = await new ClaudeCodeReader().read(root);
    const port = {
      family: 'test',
      model: 'offline',
      async complete() {
        return answer('CLAUDE.md', [
          {
            kind: 'instruction',
            title: 'Verify the second receipt',
            quote: 'Always verify the receipt.',
            line: 5,
            evidence: [{ type: 'custom', name: 'receipt_checked' }],
          },
        ]);
      },
    };
    const first = await scanAtoms(raw, { port, cache });
    expect(first.builder.atoms.find((atom) => atom.producedBy === 'model')?.provenance.startLine).toBe(5);
    const moved = {
      ...raw,
      files: raw.files.map((file) => ({ ...file, text: `\n${file.text}` })),
      prose: raw.prose.map((chunk) => ({
        ...chunk,
        startLine: chunk.startLine + 1,
        endLine: chunk.endLine + 1,
      })),
    };
    const next = await scanAtoms(moved, { port, cache });
    expect(next.calls).toBe(0);
    expect(next.builder.atoms.find((atom) => atom.producedBy === 'model')?.provenance.startLine).toBe(6);
  });
});
