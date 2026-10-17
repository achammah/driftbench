import { describe, expect, it } from 'vitest';
import { AtomBuilder, ClaudeCodeReader, codeAtoms, proseCandidates } from '../../src/index';
import { estate } from '../support';

async function candidates(text: string) {
  const root = await estate({ 'CLAUDE.md': text });
  const raw = await new ClaudeCodeReader().read(root);
  const builder = new AtomBuilder(new Map(raw.files.map((file) => [file.path, file])));
  codeAtoms(raw, builder);
  return { raw, atoms: proseCandidates(raw, builder) };
}

describe('quantified clauses in the passive voice', () => {
  it.each([
    'Every release is tagged.',
    'Each invoice is archived after payment.',
    'Every receipt is stored in the vault, with its checksum.',
    'Every request (priority 1) is acknowledged within an hour.',
    'Every customer message is answered in the same language.',
  ])('proposes a present passive: %s', async (rule) => {
    const { atoms } = await candidates(`# Rules\n\n${rule}\n`);
    expect(atoms.map((atom) => atom.provenance.quote)).toEqual([rule]);
    expect(atoms[0]!.fields).toMatchObject({ form: 'quantified', polarity: 'obligation' });
  });
  it.each([
    'Every release was tagged.',
    'Every invoices were archived.',
    'Every receipt has been stored.',
    'Every receipt had been stored.',
    'Every request is being acknowledged.',
  ])('does not propose a past, perfect or progressive statement: %s', async (text) => {
    expect((await candidates(`# Notes\n\n${text}\n`)).atoms).toEqual([]);
  });
});

describe('scanning does not slow down with the size of one file', () => {
  const budget = 5000;
  /** Processor time, so a loaded host cannot fail a test that measures the product's own work. */
  const cpu = () => {
    const used = process.cpuUsage();
    return (used.user + used.system) / 1000;
  };
  const timed = async (text: string) => {
    const { atoms } = await candidates(text);
    return atoms.length;
  };
  it('reads a long run of lines in one paragraph', async () => {
    const lines = Array.from(
      { length: 12000 },
      (_, index) => `Background line ${index} describes the archive.`,
    );
    const started = cpu();
    expect(await timed(`${lines.join('\n')}\nNever disclose credentials. Always verify receipts.\n`)).toBe(2);
    expect(cpu() - started).toBeLessThan(budget);
  });
  it('places thousands of candidates beside one another', async () => {
    const rules = Array.from({ length: 3000 }, (_, index) => `Item ${index} must keep its source.`);
    const started = cpu();
    const { atoms } = await candidates(`${rules.join('\n\n')}\n`);
    expect(cpu() - started).toBeLessThan(budget);
    expect(atoms).toHaveLength(3000);
    expect(atoms.at(-1)!.provenance.startLine).toBe(3000 * 2 - 1);
  });
});

describe('stray punctuation stays inside its paragraph', () => {
  it.each([
    'Use a 5" pipe here.',
    'He said “hello and left.',
    'The path C:\\temp\\ is not a quote.',
    'Use the `tick in this sentence.',
  ])('does not hide the rules after: %s', async (before) => {
    const { atoms } = await candidates(
      `${before}\n\nNever disclose credentials.\n\n- Always verify receipts.\n`,
    );
    expect(atoms.map((atom) => atom.provenance.quote)).toEqual(
      expect.arrayContaining(['Never disclose credentials.', 'Always verify receipts.']),
    );
  });
  it('counts a quote that cannot be found at its lines instead of failing the scan', async () => {
    const { atoms, raw } = await candidates(
      'Always \\"x verify the receipt.\n\nNever disclose credentials.\n',
    );
    expect(atoms.map((atom) => atom.provenance.quote)).toEqual(['Never disclose credentials.']);
    expect(raw.notes.filter((note) => note.message.startsWith('Prose candidate skipped'))).toHaveLength(1);
  });
});

describe('instructions that have lost their object', () => {
  it.each(['Read before any change.', 'Review before each merge.'])(
    'does not propose a bare verb with only a time phrase: %s',
    async (text) => {
      expect((await candidates(`# Notes\n\n${text}\n`)).atoms).toEqual([]);
    },
  );
  it.each(['Ask before you delete the branch.', 'Read the changelog before any change.'])(
    'proposes an instruction with its own object or clause: %s',
    async (text) => {
      expect((await candidates(`# Notes\n\n${text}\n`)).atoms.map((atom) => atom.provenance.quote)).toEqual([
        text,
      ]);
    },
  );
});

describe('clauses cut at an abbreviation', () => {
  it.each([
    'Format the output, e.g. never print raw JSON.',
    'Name the branch after the ticket, i.e. always include the id.',
    'Keep the list short, etc. you must stop at five.',
  ])('does not propose the tail of a cut sentence: %s', async (text) => {
    const { atoms } = await candidates(`# Notes\n\n${text}\n\nKeep replies short.\n`);
    expect(atoms.map((atom) => atom.provenance.quote)).toEqual(
      expect.arrayContaining(['Keep replies short.']),
    );
    expect(atoms.map((atom) => atom.provenance.quote).filter((quote) => /^[a-z]/.test(quote))).toEqual([]);
  });
});

describe('two coordinated rules and option summaries', () => {
  it.each([
    [
      'Water the ferns on Monday and never mist the cacti.',
      ['Water the ferns on Monday', 'never mist the cacti.'],
    ],
    ['Lock the gate, but do not lock the shed.', ['Lock the gate', 'do not lock the shed.']],
  ])('splits one sentence that holds two directives: %s', async (text, quotes) => {
    const { atoms } = await candidates(`# Notes\n\n${text}\n`);
    expect(atoms.map((atom) => atom.provenance.quote)).toEqual(quotes);
  });
  it('keeps a "never" that is not a second directive in one clause', async () => {
    const { atoms } = await candidates('# Notes\n\nNever open the gate and the shed at once.\n');
    expect(atoms.map((atom) => atom.provenance.quote)).toEqual(['Never open the gate and the shed at once.']);
  });
  it.each([
    'Use the kiln log when you need the firing times.',
    'Pick the long ladder if you want to reach the loft.',
    'Choose the red pen when you would like a bold line.',
  ])('does not propose a line that describes an option: %s', async (text) => {
    expect((await candidates(`# Notes\n\n${text}\n`)).atoms).toEqual([]);
  });
  it('still proposes an instruction that only starts the same way', async () => {
    const { atoms } = await candidates('# Notes\n\nUse the kiln log before you fire.\n');
    expect(atoms).toHaveLength(1);
  });
});
