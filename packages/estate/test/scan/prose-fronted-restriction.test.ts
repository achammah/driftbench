import { describe, expect, it } from 'vitest';
import { AtomBuilder, ClaudeCodeReader, codeAtoms, proseCandidates } from '../../src/index';
import { estate } from '../support';

async function candidates(text: string) {
  const root = await estate({ 'CLAUDE.md': text });
  const raw = await new ClaudeCodeReader().read(root);
  const builder = new AtomBuilder(new Map(raw.files.map((file) => [file.path, file])));
  codeAtoms(raw, builder);
  return proseCandidates(raw, builder);
}

describe('a restriction fronted by its condition is a rule', () => {
  it.each([
    'Only when the harbour master signs off may the pilot leave the berth.',
    'Only after the audit closes can an invoice be archived.',
    'Only if the buyer confirms the address may a parcel be released.',
    'Only once the crate is sealed may the clerk print its label.',
    'Only while the queue is empty may the loader pause the belt.',
  ])('proposes %s', async (rule) => {
    const atoms = await candidates(`# Rules\n\n${rule}\n`);
    expect(atoms.map((atom) => atom.provenance.quote)).toEqual([rule]);
    expect(atoms[0]?.kind).toBe('instruction');
    expect(atoms[0]?.fields).toMatchObject({ polarity: 'obligation' });
  });

  it.each([
    'Only when it rains does the grass look green.',
    'Only after dinner did the guests arrive.',
    'Only when the moon is out may people say it is bright.',
  ])('does not propose a statement about the world: %s', async (text) => {
    expect(await candidates(`# Notes\n\n${text}\n`)).toEqual([]);
  });

  it('still proposes the subject-led restriction', async () => {
    const rule = 'Only the dispatcher may close a ticket.';
    expect((await candidates(`# Rules\n\n${rule}\n`)).map((atom) => atom.provenance.quote)).toEqual([rule]);
  });
});

describe('the actor is taken from the main clause, whatever the condition holds', () => {
  it.each([
    ['Only when users may log in does the system start the sync.', 'the system'],
    ['Only when the lamp is lit, the clerk may stamp the form.', 'the clerk'],
    ['Only after the audit closes, the archive may be emptied.', 'the archive'],
    ['Only when the carrier confirms may the dispatcher close what can be closed.', 'the dispatcher'],
    ['Only if the buyer can pay does the cashier release the parcel.', 'the cashier'],
  ])('%s', async (rule, actor) => {
    const atoms = await candidates(`# Rules\n\n${rule}\n`);
    expect(atoms.map((atom) => atom.provenance.quote)).toEqual([rule]);
    expect(atoms[0]?.fields).toMatchObject({ form: 'restriction', subject: actor });
  });

  it.each([
    'Only when users may log in do people see the banner.',
    'Only when the lamp is lit, visitors may take photos.',
  ])('keeps a statement about other people no rule: %s', async (text) => {
    expect(await candidates(`# Notes\n\n${text}\n`)).toEqual([]);
  });
});
