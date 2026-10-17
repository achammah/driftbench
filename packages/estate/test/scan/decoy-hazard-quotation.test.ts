import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

async function hazards(line: string) {
  const root = await estate({ 'CLAUDE.md': `${line}\n` });
  const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
  return map.atoms.filter((atom) => atom.kind === 'hazard');
}

describe('quoted examples and runtime hazard instructions', () => {
  it.each([
    'An error reads like "rate limit exceeded for parcel 71"; quote it unchanged.',
    'Example: "after a compaction, count the parcels".',
    'The phrase "process restart" is only an example.',
    'A log message says "context compacted at 10:02"; copy it into the ticket.',
    'For example, "rate limit reached" may appear in the vendor reply.',
  ])('ignores illustrative text: %s', async (line) => {
    expect(await hazards(line)).toEqual([]);
  });
  it.each([
    'After a "compaction", reload the saved state.',
    'If the tool reports "rate limit exceeded", wait and retry.',
    'If an error reads like "rate limit exceeded", save the state and wait.',
  ])('keeps quoted labels in runtime instructions: %s', async (line) => {
    const found = await hazards(line);
    expect(found).toHaveLength(1);
    expect(found[0]?.provenance.quote).toBe(line);
  });
  it.each([
    'Treat the phrase "rate limit exceeded" as a signal to wait.',
    'Interpret the literal “process restart” as a runtime event and reload saved state.',
    'The literal "rate limit exceeded" signals a retry delay.',
  ])('keeps an operational signal definition: %s', async (line) => {
    const found = await hazards(line);
    expect(found).toHaveLength(1);
    expect(found[0]?.provenance.quote).toBe(line);
  });
  it('does not promote an illustrative signal definition into a runtime instruction', async () => {
    expect(await hazards('Example: "rate limit exceeded" signals a retry delay.')).toEqual([]);
  });
  it('keeps an actual hazard after an unrelated quoted illustration', async () => {
    const found = await hazards('Example: "process restart"; after a compaction, reload the saved state.');
    expect(found.map((atom) => atom.fields?.hazard)).toEqual(['compaction']);
  });
});
