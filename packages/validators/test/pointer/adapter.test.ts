import { describe, expect, it, vi } from 'vitest';
import { eventNow } from '../../src/ladders/pointer/kit/estate';
import type { ScanRequest } from '../../src/ladders/pointer/sut/port';
import { type ReaderExports, readerAdapter } from '../../src/ladders/pointer/sut/reader';

type Result = Awaited<ReturnType<ReaderExports['pointerScan']>>;
const file = { path: 'notes.md', text: 'Preserve the source.' };
const request: ScanRequest = { files: [file], labeler: () => ({ labels: [] }) };

/** Export-shaped fixture. Values are deliberately impossible to infer from quote differences. */
function fixture() {
  const cut = {
    digest: 'cut-fingerprint',
    units: [{ container: 'sentence', start: 0, end: file.text.length, text: file.text, fp: 'fp', path: [] }],
  };
  const result: Result = {
    ledger: {
      version: 1,
      cutDigests: { [file.path]: cut.digest },
      entries: [
        {
          id: 'unit-id',
          path: file.path,
          index: 0,
          sectionPath: [],
          container: 'sentence',
          fp: 'fp',
          ctxFp: 'ctx',
          quote: file.text,
          prefix: '',
          suffix: '',
          status: 'live',
          labels: {},
          lineage: [{ scan: 7, event: 'ambiguous' }],
          twinOf: 'other-unit',
        },
      ],
    },
    events: { ambiguous: 1 },
    eventsById: { 'unit-id': 'ambiguous' },
    warnings: ['reader model old-model changed to new-model'],
    cuts: new Map([[file.path, cut]]),
    labelled: [],
    windows: 3,
    carried: 0,
    calls: 9,
    unlabeled: 0,
    refusals: [],
    failed: [],
    recorded: 0,
  };
  const reader: ReaderExports = {
    AGENT_RULES_SET: 'reader-owned-default',
    AtomBuilder: class {
      atoms = [];
    },
    Cassette: { parse: () => ({ render: () => 'reader-cassette' }) },
    cut: () => cut,
    LabelerError: Error,
    buildLabelling: vi.fn(async () => ({ ok: false as const, message: 'not configured' })),
    singleLabelling: (member) => ({ members: [member], describe: 'planted' }),
    denseOpinions: vi.fn(() => ({ byUnit: new Map(), refusals: [] })),
    parseDenseAnswer: () => [],
    parseLabelSets: () => ({ ok: true, sets: [] }),
    parseLedger: (raw) => JSON.parse(raw),
    renderLedger: JSON.stringify,
    setHash: () => 'set-hash',
    pointerScan: vi.fn(async () => result),
    pointerAtoms: () => ({ accepted: [], refusals: [], duplicates: [] }),
  };
  return { reader, result, sut: readerAdapter(reader) };
}

describe('the real-reader adapter maps observations without implementing behavior', () => {
  it('passes through per-id decisions, counts, warnings, lineage, twins, and calls', async () => {
    const { sut, result } = fixture();
    const out = await sut.scan({ ...request, previousLedger: JSON.stringify(result.ledger) });
    expect(out.events).toEqual({ 'unit-id': 'ambiguous' });
    expect(out.eventCounts).toEqual({ ambiguous: 1 });
    expect(out.warnings).toEqual(['reader model old-model changed to new-model']);
    expect(out.ledger?.entries[0]?.lineage).toEqual([{ scan: 7, event: 'ambiguous' }]);
    expect(out.ledger?.entries[0]?.twinOf).toBe('other-unit');
    expect(out.calls).toBe(9);
  });

  it.each(['changed', 'split', 'merged', 'moved', 'deleted', 'unchanged', 'new'])(
    'does not repair a reader event mutant (%s) by comparing quotes',
    async (event) => {
      const { sut, result } = fixture();
      result.eventsById = { 'unit-id': event };
      const out = await sut.scan({ ...request, previousLedger: JSON.stringify(result.ledger) });
      expect(out.events?.['unit-id']).toBe(event);
      expect(out.events?.['unit-id']).not.toBe('ambiguous');
    },
  );

  it.each(['eventsById', 'warnings', 'lineage', 'twinOf'])(
    'leaves an unexposed %s observable absent, without an empty substitute',
    async (field) => {
      const { sut, result } = fixture();
      if (field === 'eventsById') delete result.eventsById;
      else if (field === 'warnings') delete result.warnings;
      else if (field === 'lineage') delete result.ledger.entries[0]?.lineage;
      else delete result.ledger.entries[0]?.twinOf;
      const out = await sut.scan(request);
      if (field === 'eventsById') {
        expect(out).not.toHaveProperty('events');
        const entry = out.ledger?.entries[0];
        expect(entry).toBeDefined();
        if (!entry) throw new Error('fixture ledger missing');
        expect(() => eventNow(out, entry)).toThrow('does not expose an event');
      } else if (field === 'warnings') expect(out).not.toHaveProperty('warnings');
      else expect(out.ledger?.entries[0]).not.toHaveProperty(field);
    },
  );

  it('exposes erased reader warnings and lineage without restoring the expected values', async () => {
    const { sut, result } = fixture();
    result.warnings = [];
    const entry = result.ledger.entries[0];
    if (!entry) throw new Error('fixture ledger missing');
    entry.lineage = [];
    entry.twinOf = null;
    const out = await sut.scan(request);
    expect(out.warnings).toEqual([]);
    expect(out.ledger?.entries[0]?.lineage).toEqual([]);
    expect(out.ledger?.entries[0]?.twinOf).toBeNull();
  });

  it('delegates stale-ledger acceptance even when bytes differ', async () => {
    const { reader, sut, result } = fixture();
    reader.checkLedger = vi.fn(() => ({ ok: true }));
    const previous = JSON.stringify({ ...result.ledger, cutDigests: {} });
    const out = await sut.scan({ ...request, check: true, previousLedger: previous });
    expect(reader.checkLedger).toHaveBeenCalledWith(previous, result.ledger);
    expect(out.ok).toBe(true);
  });

  it('delegates rejection even when ledger bytes match, preserving the reader reason', async () => {
    const { reader, sut, result } = fixture();
    reader.checkLedger = vi.fn(() => ({ ok: false, error: 'reader check rejected this ledger' }));
    const out = await sut.scan({ ...request, check: true, previousLedger: JSON.stringify(result.ledger) });
    expect(out.ok).toBe(false);
    expect(out.error).toBe('reader check rejected this ledger');
    expect(out.warnings).toEqual(result.warnings);
  });

  it('does not fabricate warning availability on a reader check failure', async () => {
    const { reader, sut, result } = fixture();
    delete result.warnings;
    reader.checkLedger = () => ({ ok: false, error: 'product rejection' });
    const out = await sut.scan({ ...request, check: true });
    expect(out.ok).toBe(false);
    expect(out).not.toHaveProperty('warnings');
  });

  it('fails unsupported check mode explicitly, without running or emulating the check', async () => {
    const { sut, reader } = fixture();
    await expect(sut.scan({ ...request, check: true })).rejects.toThrow('checkLedger');
    expect(reader.pointerScan).not.toHaveBeenCalled();
  });

  it('maps the current labelling API and delegates planted answer interpretation', async () => {
    const { sut, reader } = fixture();
    await sut.scan(request);
    const input = vi.mocked(reader.pointerScan).mock.calls[0]?.[0];
    expect(input).toHaveProperty('labelling');
    expect(input).not.toHaveProperty('labeler');
    if (!input) throw new Error('reader was not called');
    const labeler = (input.labelling as ReturnType<ReaderExports['singleLabelling']>).members[0];
    const answer = {
      labels: [],
      returnedModel: 'planted',
      stopReason: 'end_turn',
      usage: { input: 0, output: 0 },
    };
    const set = { set: 'set', description: '', labels: [] };
    const window = { id: 'window', path: file.path, headingPath: [], units: [] };
    labeler?.opinions(answer, set, window);
    expect(reader.denseOpinions).toHaveBeenCalledWith(answer, set, window);
  });

  it.each([
    ['haiku', 'system2', 'anthropic'],
    ['jev', 'system1', 'jev'],
    ['jev-unit', 'system1', 'jev-unit'],
  ] as const)('maps model arm %s to the current product client', async (arm, cls, client) => {
    const { reader, sut } = fixture();
    reader.buildLabelling = vi.fn(async () => ({
      ok: true as const,
      labelling: { members: [], describe: 'product arm' },
    }));
    await sut.scan({
      files: [file],
      model: { arm, transport: () => ({ status: 200, body: '{}' }), threshold: 0.71 },
      cassette: { mode: 'replay' },
    });
    expect(reader.buildLabelling).toHaveBeenCalledWith(
      [{ cls, client }],
      expect.objectContaining({ record: false, threshold: 0.71, fetch: expect.any(Function) }),
    );
  });

  it('preserves explicit replay mode for a planted labeler', async () => {
    const { sut, reader } = fixture();
    await sut.scan({ ...request, cassette: { mode: 'replay', text: 'fixture cassette' } });
    expect(reader.pointerScan).toHaveBeenCalledWith(expect.objectContaining({ mode: 'replay' }));
  });

  it('forwards the product margin and independent-vote decision without implementing voting', async () => {
    const { sut, reader } = fixture();
    reader.margin = vi.fn(() => ({ label: 'product-choice', margin: 0.17 }));
    reader.stackDecision = vi.fn(() => ({ label: 'product-choice', by: 'system2' as const }));
    const input = { probabilities: { x: 0.95, y: 0.05 }, system2Votes: ['y', 'y', 'y'], marginCut: 0.65 };
    expect(await sut.stack?.margin(input.probabilities)).toEqual({ label: 'product-choice', margin: 0.17 });
    expect(await sut.stack?.decide(input)).toEqual({ label: 'product-choice', by: 'system2' });
    expect(reader.stackDecision).toHaveBeenCalledWith(input);
    reader.stackDecision = () => undefined;
    expect(await sut.stack?.decide(input)).toBeUndefined();
  });

  it('reports missing independent-vote support rather than dropping votes', async () => {
    const { sut } = fixture();
    const input = { probabilities: { x: 1 }, system2Votes: ['x', 'x', 'x'], marginCut: 0.65 };
    expect(() => sut.stack?.decide(input)).toThrow('stackDecision');
    expect(() => sut.stack?.margin(input.probabilities)).toThrow('margin');
  });
});
