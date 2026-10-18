import { describe, expect, it } from 'vitest';
import { cut, type Ledger, nextLedger, renderLedger } from '../../src/pointer';

// Invented files: a hall with crates, keys and keepers.
const HALL = [
  '# Hall',
  '',
  '- Water the plants on the left shelf',
  '- Name the keeper of every crate',
  '- Return the keys before you leave',
  '',
  'Count the crates twice. Lock the door when the hall is empty.',
  '',
].join('\n');

const filesOf = (texts: Record<string, string>) =>
  Object.entries(texts).map(([path, text]) => ({ path, cut: cut(text) }));
const scan = (texts: Record<string, string>, previous?: Ledger) =>
  nextLedger(filesOf(texts), previous, 'hall');
const idOf = (result: ReturnType<typeof scan>, path: string, text: string) =>
  result.ledger.entries.find((entry) => entry.path === path && entry.quote === text)?.id;

describe('the ledger', () => {
  it('mints the same ids for the same files in any clone, and none twice', () => {
    const first = scan({ 'hall.md': HALL });
    const second = scan({ 'hall.md': HALL });
    expect(renderLedger(second.ledger)).toBe(renderLedger(first.ledger));
    const ids = first.ledger.entries.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[a-z2-7]{10}$/.test(id))).toBe(true);
  });

  it('keeps every id when nothing changed, and counts every unit unchanged', () => {
    const first = scan({ 'hall.md': HALL });
    const again = scan({ 'hall.md': HALL }, first.ledger);
    expect(again.ledger.entries.map((entry) => entry.id)).toEqual(
      first.ledger.entries.map((entry) => entry.id),
    );
    expect(again.events.unchanged).toBe(first.ledger.entries.length);
  });

  it('keeps the id of a unit that is edited a little', () => {
    const first = scan({ 'hall.md': HALL });
    const before = idOf(first, 'hall.md', 'Name the keeper of every crate');
    const edited = HALL.replace('Name the keeper of every crate', 'Name the keeper of every blue crate');
    const second = scan({ 'hall.md': edited }, first.ledger);
    expect(idOf(second, 'hall.md', 'Name the keeper of every blue crate')).toBe(before);
    expect(second.events.changed).toBe(1);
  });

  it('follows a unit that moves down the file', () => {
    const first = scan({ 'hall.md': HALL });
    const before = idOf(first, 'hall.md', 'Return the keys before you leave');
    const moved = HALL.replace('- Return the keys before you leave\n', '').replace(
      'Count the crates twice.',
      '- Return the keys before you leave\n\nCount the crates twice.',
    );
    const second = scan({ 'hall.md': moved }, first.ledger);
    expect(idOf(second, 'hall.md', 'Return the keys before you leave')).toBe(before);
  });

  it('follows a unit that moves to another file', () => {
    const first = scan({ 'hall.md': HALL, 'yard.md': '# Yard\n\nSweep the yard at dusk.\n' });
    const before = idOf(first, 'hall.md', 'Return the keys before you leave');
    const second = scan(
      {
        'hall.md': HALL.replace('- Return the keys before you leave\n', ''),
        'yard.md': '# Yard\n\nSweep the yard at dusk.\n\n- Return the keys before you leave\n',
      },
      first.ledger,
    );
    expect(idOf(second, 'yard.md', 'Return the keys before you leave')).toBe(before);
    expect(second.events.moved).toBe(1);
  });

  it('does not carry the id of a unit that is rewritten from scratch', () => {
    const first = scan({ 'hall.md': HALL });
    const before = idOf(first, 'hall.md', 'Name the keeper of every crate');
    const second = scan(
      {
        'hall.md': HALL.replace(
          'Name the keeper of every crate',
          'Photograph each pallet near the loading dock',
        ),
      },
      first.ledger,
    );
    const after = idOf(second, 'hall.md', 'Photograph each pallet near the loading dock');
    expect(after).not.toBe(before);
    const old = second.ledger.entries.find((entry) => entry.id === before);
    expect(old?.status).toBe('deleted');
    expect(old?.quote).toBe('Name the keeper of every crate');
  });

  it('splits one unit into two and merges two into one', () => {
    const first = scan({ 'hall.md': HALL });
    const sentence = idOf(first, 'hall.md', 'Count the crates twice. Lock the door when the hall is empty.');
    expect(sentence).toBeUndefined(); // the cutter already made two sentences
    const lines = scan({ 'a.md': '- Count the crates twice and lock the door when the hall is empty\n' });
    const split = scan(
      { 'a.md': '- Count the crates twice\n- lock the door when the hall is empty\n' },
      lines.ledger,
    );
    expect(split.events.split).toBe(1);
    const merged = scan(
      { 'a.md': '- Count the crates twice and lock the door when the hall is empty\n' },
      split.ledger,
    );
    expect(merged.events.merged).toBeGreaterThanOrEqual(1);
  });

  it('keeps a recorded label only when the text and both neighbours are unchanged', () => {
    const first = scan({ 'hall.md': HALL });
    for (const entry of first.ledger.entries) {
      entry.labels.house = { label: 'rule', setHash: 'h1', labeler: 'l1', source: 'cassette:abc' };
    }
    // A reworded neighbour changes the context of the units beside it, never their text.
    const second = scan(
      { 'hall.md': HALL.replace('Name the keeper of every crate', 'Name the keeper of every blue crate') },
      first.ledger,
    );
    const labelled = (text: string) =>
      second.ledger.entries.find((entry) => entry.quote === text)?.labels.house;
    expect(labelled('Count the crates twice.')).toMatchObject({ label: 'rule' });
    expect(labelled('Water the plants on the left shelf')).toBeUndefined();
    expect(labelled('Return the keys before you leave')).toBeUndefined();
    expect(labelled('Name the keeper of every blue crate')).toBeUndefined();
  });

  it('writes no clock and sorts its keys, so equal ledgers are equal bytes', () => {
    const text = renderLedger(scan({ 'hall.md': HALL }).ledger);
    expect(text.endsWith('\n')).toBe(true);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(JSON.parse(text).version).toBe(1);
  });

  it('gives identical twin lines in one file distinct ids by occurrence', () => {
    const twins = scan({ 'a.md': '- Lock the door\n- Lock the door\n' });
    const ids = twins.ledger.entries.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(2);
    const again = scan({ 'a.md': '- Lock the door\n- Lock the door\n' }, twins.ledger);
    expect(again.ledger.entries.map((entry) => entry.id)).toEqual(ids);
  });
});
