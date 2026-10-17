import { rm } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

// Handwritten operating instructions for a fictional editorial repository.
// These exercise the public scanner without a model, a bank import, or an oracle fixture.
async function scan(text: string) {
  const root = await estate({
    'CLAUDE.md': `${text}\n`,
    'policy.md': '# Editorial policy\n',
    'docs/release.v2.md': '# Publication policy\n',
    'docs/release notes.md': '# Publication notes\n',
    'delivery.md': '# Delivery instructions\n',
  });
  try {
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    return map.atoms.filter((atom) => atom.kind === 'gate');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('natural prerequisite instructions', () => {
  it.each([
    'Before editing the ledger: read policy.md',
    'Before editing the ledger: read policy.md.',
    'Please read `policy.md` before editing the ledger.',
    'Crucially, read `policy.md` before editing the ledger.',
    'As part of your review, read `policy.md` before editing the ledger.',
    'For every draft, read `policy.md` before editing the ledger.',
    'To keep the audit trail intact, read `policy.md` before editing the ledger.',
    'In particular, read `policy.md` before editing the ledger.',
    'Whenever a correction is requested, read `policy.md` before editing the ledger.',
    'It is essential to read `policy.md` before editing the ledger.',
    'We require you to read `policy.md` before editing the ledger.',
    'Kindly read `policy.md` before editing the ledger.',
    'Be sure to read `policy.md` before editing the ledger.',
    'You must read `policy.md` before editing the ledger.',
    'You should read `policy.md` before editing the ledger.',
    'We need to read `policy.md` before editing the ledger.',
    'The assistant must read `policy.md` before editing the ledger.',
    'Always read `policy.md` before editing the ledger.',
    'Remember to read `policy.md` before editing the ledger.',
    'Make sure you read `policy.md` before editing the ledger.',
    'For this task, please read `policy.md` before editing the ledger.',
    'Before editing the ledger, please read `policy.md`.',
    'If no objection is raised, please read `policy.md` before editing the ledger.',
    'Read `policy.md` before editing optional metadata.',
    'Before editing the ledger: you must read `policy.md`.',
    'Read `policy.md` before you can edit the ledger.',
    'Please `read` `policy.md` before `editing` the ledger.',
    'Please do not edit the ledger without reading `policy.md`.',
    'You must not edit the ledger until you have read `policy.md`.',
    "Don't edit the ledger until you've read `policy.md`.",
    "Read 'policy.md' before editing the ledger.",
    'Read "policy.md" before editing the ledger.',
    'Note: read `policy.md` before editing the ledger.',
  ])('recognizes the required read in: %s', async (text) => {
    const gates = await scan(text);
    expect(gates).toHaveLength(1);
    expect(gates[0]?.fields).toMatchObject({ first: 'policy.md', path: 'policy.md' });
    expect(gates[0]?.evidence).toContainEqual({ type: 'ordered', before: 'Read', after: 'Edit' });
    expect(gates[0]?.provenance.quote).toBe(text);
  });

  it.each([
    ['Before editing the article: read docs/release.v2.md.', 'docs/release.v2.md'],
    ['Read `docs/release.v2.md` before editing the article.', 'docs/release.v2.md'],
    ['Please read `docs/release notes.md` before editing the article.', 'docs/release notes.md'],
    [
      'You must read [the notes](docs/release.v2.md#publish) before editing the article.',
      'docs/release.v2.md',
    ],
  ])('preserves the whole file target: %s', async (text, path) => {
    const gates = await scan(text);
    expect(gates).toHaveLength(1);
    expect(gates[0]?.fields).toMatchObject({ first: path, path });
  });

  it.each([
    'Please do not read `policy.md` before editing the ledger.',
    'You must never read `policy.md` before editing the ledger.',
    'You are not required to read `policy.md` before editing the ledger.',
    'You need not read `policy.md` before editing the ledger.',
    'Please do not ever read `policy.md` before editing the ledger.',
    'You must under no circumstances read `policy.md` before editing the ledger.',
    'Print `Read policy.md before editing the ledger` as the sample output.',
    'Run `echo "Read policy.md before editing the ledger"` to print the example.',
    'Example: "Please read `policy.md` before editing the ledger."',
    'The sample sentence is "You must read `policy.md` before editing the ledger."',
    "You don't need to read `policy.md` before editing the ledger.",
    'There is no need to read `policy.md` before editing the ledger.',
    'Under no circumstances read `policy.md` before editing the ledger.',
    'Never, ever read `policy.md` before editing the ledger.',
    'Optionally, read `policy.md` before editing the ledger.',
    'If you read `policy.md` before editing the ledger, you lose your place.',
    'When a reviewer comment arrives, read it before anything else.',
    'Read it before editing the ledger.',
  ])('does not invent a prerequisite from: %s', async (text) => {
    expect(await scan(text)).toEqual([]);
  });

  it('binds each coordinated directive to its own read and action', async () => {
    const text =
      'Read policy.md before editing the article, and read delivery.md before writing the announcement.';
    const gates = await scan(text);
    expect(gates.map((gate) => gate.fields?.path)).toEqual(['policy.md', 'delivery.md']);
    expect(gates.map((gate) => gate.evidence[0])).toEqual([
      { type: 'ordered', before: 'Read', after: 'Edit' },
      { type: 'ordered', before: 'Read', after: 'Write' },
    ]);
  });

  it('keeps both reads and their full targets across real sentence boundaries', async () => {
    const text =
      'Please read docs/release.v2.md before editing the article. You must read `delivery.md` before writing the announcement.';
    const gates = await scan(text);
    expect(gates.map((gate) => gate.fields?.path)).toEqual(['docs/release.v2.md', 'delivery.md']);
    expect(gates.map((gate) => gate.provenance.quote)).toEqual([text, text]);
  });
});
