import { describe, expect, it } from 'vitest';
import {
  AGENT_RULES_SET,
  checkAnswer,
  expandUnits,
  type LabelSet,
  parseLabelSets,
  setHash,
} from '../../src/pointer';

// Two invented sets on the same units: one for a bakery's counter notes, one for a harbour's mooring notes.
const TWO_SETS = `labels:
  - set: counter-voice
    description: How the counter notes of a bakery are worded.
    labels:
      - name: greeting
        description: A unit that fixes how a customer is welcomed.
        examples:
          - "Say good morning first."
      - name: price-claim
        description: A unit that states what a loaf costs.
  - set: mooring
    description: What the harbour notes ask of a skipper.
    labels:
      - name: order
        description: A unit that tells the skipper to tie up in a given way.
        target: required
        atom: { kind: gate }
      - name: remark
        description: A unit that only says how the quay is.
`;

function load(text: string): LabelSet[] {
  const parsed = parseLabelSets(text);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.sets;
}

describe('label sets', () => {
  it('reads a user set and the shipped set with the same parser', () => {
    expect(load(TWO_SETS).map((set) => set.set)).toEqual(['counter-voice', 'mooring']);
    const shipped = load(AGENT_RULES_SET);
    expect(shipped[0]?.labels.map((label) => label.name)).toEqual([
      'rule',
      'prohibition',
      'gate',
      'reply-rule',
      'example',
      'description',
    ]);
  });

  it('refuses a duplicate set, a duplicate label, the reserved name and a bad name', () => {
    const one = 'labels:\n  - set: a\n    description: d\n    labels:\n      - { name: x, description: d }\n';
    expect(parseLabelSets(`${one}${one.replace('labels:\n', '')}`)).toMatchObject({
      ok: false,
      message: 'the set a is declared twice',
    });
    expect(
      parseLabelSets(
        one.replace(
          '- { name: x, description: d }',
          '- { name: x, description: d }\n      - { name: x, description: e }',
        ),
      ),
    ).toMatchObject({
      ok: false,
      message: 'the set a declares x twice',
    });
    expect(parseLabelSets(one.replace('name: x', 'name: none'))).toMatchObject({ ok: false });
    expect(parseLabelSets(one.replace('name: x', 'name: Not Ok'))).toMatchObject({ ok: false });
  });

  it('refuses a label with more than three examples and an unknown key', () => {
    const base =
      'labels:\n  - set: a\n    description: d\n    labels:\n      - name: x\n        description: d\n';
    expect(parseLabelSets(`${base}        examples: [a, b, c, d]\n`)).toMatchObject({ ok: false });
    expect(parseLabelSets(`${base}        colour: red\n`)).toMatchObject({ ok: false });
  });

  it('changes only the hash of the set that was edited', () => {
    const before = load(TWO_SETS);
    const after = load(
      TWO_SETS.replace('A unit that states what a loaf costs.', 'A unit that states a price.'),
    );
    expect(setHash(after[0] as LabelSet)).not.toBe(setHash(before[0] as LabelSet));
    expect(setHash(after[1] as LabelSet)).toBe(setHash(before[1] as LabelSet));
  });
});

describe('unit ranges', () => {
  it('reads a number and a range, and nothing else', () => {
    expect(expandUnits('5')).toEqual([5]);
    expect(expandUnits('5-7')).toEqual([5, 6, 7]);
    expect(expandUnits('7-5')).toBeUndefined();
    expect(expandUnits('five')).toBeUndefined();
    expect(expandUnits('5,7')).toBeUndefined();
  });
});

describe('checking an answer', () => {
  const [counter, mooring] = load(TWO_SETS) as [LabelSet, LabelSet];
  const window = {
    id: 'notes.md#1',
    path: 'notes.md',
    headingPath: [],
    units: [1, 2, 3, 4].map((n) => ({ n, text: `unit ${n}`, index: n - 1 })),
  };

  it('accepts labels and ranges, and counts a unit named none as covered', () => {
    const checked = checkAnswer(counter, window, [
      { units: '1-2', label: 'greeting' },
      { units: '3', label: 'none' },
    ]);
    expect(checked.refusals).toEqual([]);
    expect([...checked.accepted.keys()]).toEqual([1, 2]);
    expect([...checked.covered]).toEqual([1, 2, 3]);
  });

  it('refuses a label that is not in the set, with the reason', () => {
    const checked = checkAnswer(counter, window, [{ units: '1', label: 'order' }]);
    expect(checked.refusals).toEqual(['notes.md#1: the label order is not in the set counter-voice']);
    expect(checked.accepted.size).toBe(0);
  });

  it('refuses a unit that is not in the window and a range that leaves it', () => {
    const checked = checkAnswer(counter, window, [
      { units: '9', label: 'greeting' },
      { units: '3-5', label: 'greeting' },
    ]);
    expect(checked.refusals).toHaveLength(2);
    expect(checked.accepted.size).toBe(0);
  });

  it('refuses a unit named twice and keeps the first answer', () => {
    const checked = checkAnswer(counter, window, [
      { units: '1-2', label: 'greeting' },
      { units: '2', label: 'price-claim' },
    ]);
    expect(checked.refusals).toEqual(['notes.md#1: "2" names a unit that is already labelled']);
    expect(checked.accepted.get(2)?.label).toBe('greeting');
  });

  it('needs a target inside the window on a label that asks for one, and refuses one on a label that takes none', () => {
    expect(checkAnswer(mooring, window, [{ units: '1', label: 'order' }]).refusals).toHaveLength(1);
    expect(checkAnswer(mooring, window, [{ units: '1', label: 'order', target: 8 }]).refusals).toHaveLength(
      1,
    );
    expect(checkAnswer(mooring, window, [{ units: '1', label: 'order', target: 3 }]).accepted.get(1)).toEqual(
      {
        label: 'order',
        target: 3,
      },
    );
    expect(checkAnswer(mooring, window, [{ units: '1', label: 'remark', target: 3 }]).refusals).toEqual([
      'notes.md#1: the label remark takes no target',
    ]);
  });

  it('refuses a malformed range', () => {
    expect(checkAnswer(counter, window, [{ units: 'one', label: 'greeting' }]).refusals).toHaveLength(1);
  });
});
