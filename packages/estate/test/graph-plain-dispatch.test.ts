import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../src/index';
import { estate, NOW } from './support';

async function dispatches(body: string) {
  const root = await estate({
    '.claude/skills/parcels/SKILL.md': `---\nname: parcels\ndescription: Review fictional parcels.\n---\n${body}\n`,
    '.claude/agents/parcel-check.md': '---\nname: parcel-check\ndescription: Check fictional parcels.\n---\n',
  });
  const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
  return map.edges.filter((edge) => edge.kind === 'dispatch');
}

describe('helper dispatch by a plain name', () => {
  it.each([
    'Dispatch the parcel-check agent to check the records.',
    'Call parcel-check for the final count.',
    'Delegate to the parcel-check helper.',
    'Invoke parcel-check.',
    'Ask the parcel-check agent to count the boxes.',
    'Hand the batch off to parcel-check.',
    'Spawn parcel-check for each pallet.',
  ])('reads the affirmative act: %s', async (body) => {
    expect(await dispatches(body)).toHaveLength(1);
  });

  it.each([
    'Never dispatch the parcel-check agent.',
    'Do not call parcel-check.',
    'The parcel-check report is archived.',
    'Ask the customer whether parcel-check found anything.',
    'Dispatch parcel-check-extended.',
    'Dispatch old-parcel-check.',
  ])('rejects a forbidden, non-action or different name: %s', async (body) => {
    expect(await dispatches(body)).toEqual([]);
  });

  it('keeps a later positive occurrence after a forbidden occurrence', async () => {
    expect(
      await dispatches('Never dispatch parcel-check for weather; dispatch parcel-check for parcels.'),
    ).toHaveLength(1);
  });

  it('retains quoted handover wording', async () => {
    expect(await dispatches('Hand the final count to the `parcel-check` agent.')).toHaveLength(1);
  });
});
