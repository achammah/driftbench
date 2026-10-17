import { expect, it, vi } from 'vitest';

vi.mock('compromise/two', async (importOriginal) => {
  const real = await importOriginal<{
    default: ((text: string) => unknown) & { model(): unknown };
  }>();
  return {
    ...real,
    // The parser function fails on one sentence; its other members (the lexicon model) stay the real ones.
    default: Object.assign(
      (text: string) => {
        if (text.includes('trigger a parser failure')) throw new Error('injected sentence parser failure');
        return real.default(text);
      },
      { model: () => real.default.model() },
    ),
  };
});

import { AtomBuilder, ClaudeCodeReader, codeAtoms, proseCandidates } from '../../src/index';
import { estate } from '../support';

it('records a sentence the parser fails on and still proposes the clauses around it', async () => {
  const root = await estate({
    'CLAUDE.md':
      'The helper must verify the manifest.\n\nThe helper must trigger a parser failure.\n\nNever publish credentials.\n',
  });
  const raw = await new ClaudeCodeReader().read(root);
  const builder = new AtomBuilder(new Map(raw.files.map((file) => [file.path, file])));
  codeAtoms(raw, builder);
  const atoms = proseCandidates(raw, builder);
  expect(atoms.map((atom) => atom.provenance.quote)).toEqual([
    'The helper must verify the manifest.',
    'Never publish credentials.',
  ]);
  expect(raw.notes.filter((note) => note.message.startsWith('Prose candidate skipped'))).toEqual([
    {
      file: 'CLAUDE.md',
      message: 'Prose candidate skipped at lines 3-3: injected sentence parser failure',
    },
  ]);
});
