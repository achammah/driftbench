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
    'Only when it snows do the roads close.',
    'Only when the river rises do the fields flood.',
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
  const rule = (sentence: string, actor: string) => async () => {
    const atoms = await candidates(`# Rules\n\n${sentence}\n`);
    expect(atoms.map((atom) => atom.provenance.quote)).toEqual([sentence]);
    expect(atoms[0]?.fields).toMatchObject({ form: 'restriction', subject: actor });
  };
  const world = (sentence: string) => async () => {
    expect(await candidates(`# Notes\n\n${sentence}\n`)).toEqual([]);
  };

  describe('a modal inside the condition', () => {
    it(
      'inverted, with does',
      rule('Only when users may log in does the system start the sync.', 'the system'),
    );
    it(
      'inverted, with two modals',
      rule('Only when users may log in may the system start the sync.', 'the system'),
    );
    it(
      'after a comma, with two modals',
      rule('Only when users may log in, the system may start the sync.', 'the system'),
    );
    it(
      'inverted, a modal in a later clause',
      rule('Only when the carrier confirms may the dispatcher close what can be closed.', 'the dispatcher'),
    );
  });

  describe('commas inside the condition', () => {
    it(
      'a list of conditions',
      rule(
        'Only when the lamp is lit, the door is shut and the form is signed, the clerk may stamp the form.',
        'the clerk',
      ),
    );
    it(
      'a relative clause',
      rule(
        'Only when the clerk, who is new, signs the log, the supervisor may release the pallet.',
        'the supervisor',
      ),
    );
    it(
      'a list, then an inverted main clause',
      rule(
        'Only when the lamp is lit, the door is shut and the form is signed may the clerk stamp the form.',
        'the clerk',
      ),
    );
    it(
      'a comma before the inversion',
      rule('Only when the lamp is lit, may the clerk stamp the form.', 'the clerk'),
    );
  });

  describe('if and unless inside the condition', () => {
    it(
      'an inner if after a comma',
      rule('Only when the batch is sealed, if the lab agrees, the clerk may ship the crate.', 'the clerk'),
    );
    it(
      'an inner unless after a comma',
      rule(
        'Only if the form is signed, unless the buyer waives it, the clerk may ship the crate.',
        'the clerk',
      ),
    );
    it(
      'an inner unless without a comma',
      rule(
        'Only if the form is signed unless the buyer waives it may the clerk ship the crate.',
        'the clerk',
      ),
    );
  });

  describe('a modal or auxiliary inside the condition is not the main clause', () => {
    it(
      'an adverb after the modal',
      rule('Only when users may also log in does the system start the sync.', 'the system'),
    );
    it(
      'a noun-verb word ends the condition',
      rule('Only when the buyer pays may the cashier release the parcel.', 'the cashier'),
    );
    it(
      'a does inside the condition',
      rule('Only when the clerk does the audit may the pilot leave the berth.', 'the pilot'),
    );
    it(
      'a noun-verb word before a comma',
      rule('Only when the buyer pays, the cashier may release the parcel.', 'the cashier'),
    );
  });

  describe('the passive and the other forms', () => {
    it(
      'a passive permission',
      rule('Only after the audit closes, the archive may be emptied.', 'the archive'),
    );
    it(
      'an inverted passive',
      rule('Only if the buyer confirms the address may a parcel be released.', 'a parcel'),
    );
    it(
      'the agent itself',
      rule('Only when the owner approves, the agent may spend the budget.', 'the agent'),
    );
    it(
      'an act with no object by the agent',
      rule('Only when the owner approves may the agent proceed.', 'the agent'),
    );
  });

  describe('a sentence about the world or other people is no rule', () => {
    it('a happening', world('Only when it snows do the roads close.'));
    it('a state', world('Only when it rains does the grass look green.'));
    it('a happening after a comma', world('Only when the tide is out, the boats may rest on the sand.'));
    it('other people', world('Only when users may log in do people see the banner.'));
    it('visitors', world('Only when the lamp is lit, visitors may take photos.'));
  });
});
