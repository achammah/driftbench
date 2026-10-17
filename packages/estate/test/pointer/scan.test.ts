import { ModelError } from '@agent-nexus/driftbench-generate';
import { describe, expect, it } from 'vitest';
import {
  Cassette,
  CassetteMiss,
  cut,
  type Labeler,
  LabelerError,
  type Labelled,
  type LabelSet,
  type PointerInput,
  parseLabelSets,
  pointerScan,
  renderLedger,
  type Window,
  windowsOf,
} from '../../src/pointer';

// Invented files: a harbour office with quays, ropes and skippers.
const QUAY = [
  '# Quay',
  '',
  '- Coil the ropes on the red post',
  '- Name the skipper of every boat',
  '- Hang the lamp before dusk',
  '',
  'Count the boats twice. Close the gate when the quay is empty.',
  '',
].join('\n');
const OFFICE = ['# Office', '', 'The office opens at nine.', '', '- Log each boat at the desk', ''].join(
  '\n',
);
const FILES = [
  { path: 'quay.md', text: QUAY },
  { path: 'office.md', text: OFFICE },
];

const SETS = `labels:
  - set: duty
    description: What the harbour notes ask of a skipper.
    labels:
      - name: order
        description: A unit that tells the skipper what to do.
        atom: { kind: instruction, polarity: obligation }
      - name: remark
        description: A unit that only says how the quay is.
  - set: tone
    description: How a note is worded.
    labels:
      - name: curt
        description: A unit of three words or fewer.
      - name: long
        description: A unit of more than three words.
`;
const load = (text: string): LabelSet[] => {
  const parsed = parseLabelSets(text);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.sets;
};

/** A labeler that answers from a table of its own, and keeps a log of the windows it was asked about. */
function planted(
  answer: (window: Window, set: LabelSet) => Labelled[],
  log: string[] = [],
  options: { fail?: (window: Window) => Error | undefined } = {},
): Labeler {
  return {
    id: 'planted',
    family: 'planted',
    model: 'planted-1',
    maxUnits: (_set, wanted) => wanted,
    render: (set, window) => ({
      labeler: 'planted',
      body: { set: set, window: window.id, units: window.units.map((unit) => unit.text) },
    }),
    interpret: (recorded) => recorded.labels ?? [],
    async call(_wire, set, window) {
      log.push(`${window.id}:${set.set}`);
      const failure = options.fail?.(window);
      if (failure) throw failure;
      return {
        labels: answer(window, set),
        returnedModel: 'planted-1',
        stopReason: 'end_turn',
        usage: { input: 10, output: 4 },
      };
    },
  };
}

/** Everything is an order in `duty`; the tone label follows the length of the unit's text. */
const byLength = (window: Window, set: LabelSet): Labelled[] =>
  window.units.map((unit) => ({
    units: String(unit.n),
    label: set.set === 'duty' ? 'order' : unit.text.split(/\s+/).length <= 3 ? 'curt' : 'long',
  }));

const input = (labeler: Labeler, cassette: Cassette, over: Partial<PointerInput> = {}): PointerInput => ({
  files: FILES,
  sets: load(SETS),
  labeler,
  cassette,
  mode: 'record',
  ...over,
});

describe('the windows', () => {
  it('cut at a top-level heading and at the size, and leave an opaque unit out', () => {
    const text = '# One\n\nA first sentence. A second sentence.\n\n```sh\nrun\n```\n\n# Two\n\n- Item\n';
    const units = cut(text).units;
    const windows = windowsOf('a.md', units, 60);
    expect(windows.map((window) => window.units.length)).toEqual([3, 2]);
    expect(
      windows.flatMap((window) => window.units.map((unit) => units[unit.index]?.container)),
    ).not.toContain('opaque');
    expect(windowsOf('a.md', units, 2).map((window) => window.units.length)).toEqual([2, 1, 2]);
    expect(windows[1]?.id).toBe('a.md#2');
  });
});

describe('the pointer scan', () => {
  it('records one answer per window and set, then replays the same ledger with no labeler', async () => {
    const log: string[] = [];
    const cassette = new Cassette();
    const first = await pointerScan(input(planted(byLength, log), cassette));
    expect(first.failed).toEqual([]);
    expect(first.refusals).toEqual([]);
    expect(first.unlabeled).toBe(0);
    // Two files, one window each, two sets.
    expect(log).toHaveLength(4);
    expect(cassette.entries.size).toBe(4);
    expect(first.usage).toEqual({ input: 40, output: 16 });

    const replayer: Labeler = { ...planted(byLength), call: undefined };
    const second = await pointerScan(input(replayer, Cassette.parse(cassette.render()), { mode: 'replay' }));
    expect(second.calls).toBe(0);
    expect(renderLedger(second.ledger)).toBe(renderLedger(first.ledger));
    expect(second.labelled.map((item) => [item.id, item.label])).toEqual(
      first.labelled.map((item) => [item.id, item.label]),
    );
  });

  it('keeps a label of the ledger without asking again', async () => {
    const cassette = new Cassette();
    const first = await pointerScan(input(planted(byLength), cassette));
    const log: string[] = [];
    const again = await pointerScan(
      input(planted(byLength, log), new Cassette(), { previous: first.ledger, mode: 'replay' }),
    );
    expect(log).toEqual([]);
    expect(again.carried).toBe(4);
    expect(again.windows).toBe(0);
  });

  it('re-labels only the windows of an edited unit', async () => {
    const files = [{ path: 'quay.md', text: QUAY }];
    const first = await pointerScan(input(planted(byLength), new Cassette(), { files, windowUnits: 4 }));
    const log: string[] = [];
    const edited = [
      {
        path: 'quay.md',
        text: QUAY.replace('Name the skipper of every boat', 'Name the skipper of each boat'),
      },
    ];
    await pointerScan(
      input(planted(byLength, log), new Cassette(), {
        files: edited,
        windowUnits: 4,
        previous: first.ledger,
      }),
    );
    // The edit and the units beside it sit in the first window of four units; the second window keeps its labels.
    expect(log.map((entry) => entry.split(':')[0])).toEqual(['quay.md#1', 'quay.md#1']);
  });

  it('re-labels only the set whose label was edited, and changes no unit id', async () => {
    const first = await pointerScan(input(planted(byLength), new Cassette()));
    const edited = load(
      SETS.replace('A unit that only says how the quay is.', 'A unit that describes the quay.'),
    );
    const log: string[] = [];
    const second = await pointerScan(
      input(planted(byLength, log), new Cassette(), { sets: edited, previous: first.ledger }),
    );
    expect(log.every((entry) => entry.endsWith(':duty'))).toBe(true);
    expect(log).toHaveLength(2);
    expect(second.ledger.entries.map((entry) => entry.id)).toEqual(
      first.ledger.entries.map((entry) => entry.id),
    );
    const tone = (result: typeof first) => result.ledger.entries.map((entry) => entry.labels.tone);
    expect(tone(second)).toEqual(tone(first));
  });

  it('misses in replay on a changed set, and names the field that differs', async () => {
    const cassette = new Cassette();
    await pointerScan(input(planted(byLength), cassette));
    const edited = load(SETS.replace('What the harbour notes ask of a skipper.', 'What the notes ask.'));
    // A labeler that renders the set into the request, as a real one does.
    const real = (labeler: Labeler): Labeler => ({
      ...labeler,
      render: (set, window) => ({
        labeler: 'planted',
        body: { set: set.description, window: window.id, units: window.units.map((unit) => unit.text) },
      }),
    });
    const recorded = new Cassette();
    await pointerScan(input(real(planted(byLength)), recorded));
    await expect(
      pointerScan(
        input({ ...real(planted(byLength)), call: undefined }, recorded, { sets: edited, mode: 'replay' }),
      ),
    ).rejects.toThrow(/differs in: .*part\.body|differs in: .*setHash/);
  });

  it('refuses a bad pointer, lists it, and labels nothing from it', async () => {
    const bad = (window: Window, set: LabelSet): Labelled[] =>
      set.set === 'duty'
        ? [
            { units: '99', label: 'order' },
            { units: '1', label: 'rotate' },
            { units: '2-3', label: 'order' },
            { units: '3', label: 'remark' },
          ]
        : byLength(window, set);
    const result = await pointerScan(
      input(planted(bad), new Cassette(), { files: [FILES[0] as (typeof FILES)[number]] }),
    );
    expect(result.refusals).toEqual([
      'quay.md#1: "99" leaves the window',
      'quay.md#1: the label rotate is not in the set duty',
      'quay.md#1: "3" names a unit that is already labelled',
    ]);
    const duty = result.labelled.filter((item) => item.set.set === 'duty');
    // Only the accepted range 2-3 is labelled; the rest of the window got no accepted answer.
    expect(duty.map((item) => item.unit.text)).toEqual([
      'Coil the ropes on the red post',
      'Name the skipper of every boat',
    ]);
    expect(result.unlabeled).toBeGreaterThan(0);
  });

  it('retries an unreadable answer once, then lists the window as failed and records nothing', async () => {
    const log: string[] = [];
    const cassette = new Cassette();
    const result = await pointerScan(
      input(
        planted(byLength, log, {
          fail: (window) =>
            window.path === 'office.md' ? new LabelerError('the answer is not JSON') : undefined,
        }),
        cassette,
      ),
    );
    expect(log.filter((entry) => entry.startsWith('office.md'))).toHaveLength(4);
    expect(result.failed).toHaveLength(2);
    expect(result.failed[0]).toContain('the answer is not JSON');
    expect([...cassette.entries.values()].every((entry) => entry.readable.path === 'quay.md')).toBe(true);
    expect(result.labelled.every((item) => item.path === 'quay.md')).toBe(true);
  });

  it('does not retry a refusal', async () => {
    const log: string[] = [];
    const result = await pointerScan(
      input(planted(byLength, log, { fail: () => new ModelError('refusal', 'declined') }), new Cassette()),
    );
    expect(log).toHaveLength(4);
    expect(result.failed).toHaveLength(4);
  });

  it('stops on a miss when it may not record', async () => {
    await expect(
      pointerScan(input({ ...planted(byLength), call: undefined }, new Cassette(), { mode: 'replay' })),
    ).rejects.toBeInstanceOf(CassetteMiss);
  });

  it('gives the labeler no text of a unit it cannot point at', async () => {
    const seen: string[] = [];
    const labeler = planted((window) => {
      seen.push(...window.units.map((unit) => unit.text));
      return [];
    });
    await pointerScan(
      input(labeler, new Cassette(), {
        files: [{ path: 'a.md', text: '# T\n\n```sh\nsecret fence\n```\n\nA sentence.\n' }],
      }),
    );
    expect(seen.join('\n')).not.toContain('secret fence');
  });

  it('halves a window the endpoint refuses as too large, records the refusal, and replays the same halves', async () => {
    const tooLarge = () => new ModelError('http', '400 max_tokens_exceeded', { status: 400 });
    const log: string[] = [];
    const files = [{ path: 'quay.md', text: QUAY }];
    const refuseOver = (limit: number) => (window: Window) =>
      window.units.length > limit ? tooLarge() : undefined;
    const cassette = new Cassette();
    const first = await pointerScan(
      input(planted(byLength, log, { fail: refuseOver(2) }), cassette, { files, windowUnits: 12 }),
    );
    // Six units: the window of six and the two halves of three are refused, the quarters of two and one answer.
    expect(first.failed).toEqual([]);
    expect(first.unlabeled).toBe(0);
    const perSet = [
      'quay.md#1',
      'quay.md#1a',
      'quay.md#1aa',
      'quay.md#1ab',
      'quay.md#1b',
      'quay.md#1ba',
      'quay.md#1bb',
    ];
    expect(log.map((entry) => entry.split(':')[0])).toEqual([...perSet, ...perSet]);
    expect(first.labelled.filter((item) => item.set.set === 'duty')).toHaveLength(6);
    expect([...cassette.entries.values()].some((entry) => entry.answer.refused === 'too_large')).toBe(true);

    const again = await pointerScan(
      input({ ...planted(byLength), call: undefined }, Cassette.parse(cassette.render()), {
        files,
        windowUnits: 12,
        mode: 'replay',
      }),
    );
    expect(again.calls).toBe(0);
    expect(renderLedger(again.ledger)).toBe(renderLedger(first.ledger));
  });

  it('fails a window of one unit that is still refused as too large', async () => {
    const result = await pointerScan(
      input(
        planted(byLength, [], {
          fail: () => new ModelError('http', '400 max_tokens_exceeded', { status: 400 }),
        }),
        new Cassette(),
        { files: [{ path: 'one.md', text: 'Lock the gate.\n' }] },
      ),
    );
    expect(result.failed).toHaveLength(2);
    expect(result.failed[0]).toContain('window of one unit');
  });
});
