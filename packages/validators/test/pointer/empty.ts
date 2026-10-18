import type { PointerSut } from '../../src/ladders/pointer/sut/port';

/** The independent review's empty reader, also imported by every child process. */
export default {
  name: 'empty-reader',
  cut: async () => ({ units: [], cutDigest: 'constant' }),
  scan: async () => ({
    ok: true,
    warnings: [],
    ledger: { raw: '{}', entries: [] },
    atoms: [],
    diagnostics: [],
    cassette: '',
    events: {},
    eventCounts: {},
    windows: 0,
    calls: 0,
  }),
} satisfies PointerSut;
