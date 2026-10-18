import { createHash } from 'node:crypto';
import type { Json, PointerAdapter } from './bank/types.js';

/**
 * Independent review attacks, retained with their original behavior. These
 * adapters inspect requests only; they never read bank items or expectations.
 * They intentionally ignore any optional harness IO argument.
 */
type ReviewUnit = {
  n: number;
  text: string;
  contextOnly?: boolean;
  opaque?: boolean;
};
type ReviewLabel = { units: string; label: string; target?: number };
type DecisionInput = {
  action?: string;
  window: { units: ReviewUnit[] };
  system2: { labels: ReviewLabel[] };
};
type FingerprintInput = { units: { text: string }[] };
type LedgerInput = {
  scans: { files: { units: { text: string }[] }[] }[];
};
type PrivacyInput = {
  mode: string;
  source: string;
  apiKey: string;
  answer: { labels: Json[] };
};

const hashed = (text: string): string =>
  Array.from(
    createHash('sha256').update(text).digest().subarray(0, 10),
    (x) => 'abcdefghijklmnopqrstuvwxyz234567'[x & 31],
  ).join('');

const firstUnit = {
  execute({ operation, input }) {
    const x = input as unknown as DecisionInput;
    if (operation === 'labels' && x.action === 'decide') {
      const first = x.window.units.find((u) => !u.contextOnly && !u.opaque) as ReviewUnit;
      const label = x.system2.labels[0] as ReviewLabel;
      return {
        labels: x.window.units
          .filter((u) => !u.contextOnly && !u.opaque)
          .map(() => ({
            n: first.n,
            label: label.label,
            ...(label.target === undefined ? {} : { target: label.target }),
          })),
      };
    }
    return null;
  },
} satisfies PointerAdapter;

const textHash = {
  execute({ operation, input }) {
    if (operation === 'fingerprint') {
      const x = input as unknown as FingerprintInput;
      return x.units.map((u) => hashed(u.text));
    }
    if (operation === 'ledger') {
      const x = input as unknown as LedgerInput;
      return x.scans.map((scan) => ({
        entries: scan.files.flatMap((f) =>
          f.units.map((u) => ({
            id: hashed(u.text),
            status: 'live',
            quote: u.text,
          })),
        ),
      }));
    }
    return null;
  },
} satisfies PointerAdapter;

const copying = {
  execute({ operation, input }) {
    if (operation === 'labels') {
      const x = input as unknown as DecisionInput;
      if (x.action === 'decide') {
        return {
          labels: x.system2.labels.flatMap((p) => {
            const [lo, hi] = p.units.split('-').map(Number) as [number, number?];
            return Array.from({ length: (hi ?? lo) - lo + 1 }, (_, i) => ({
              n: lo + i,
              label: p.label,
              ...(p.target === undefined ? {} : { target: p.target }),
            }));
          }),
        };
      }
    }
    if (operation === 'privacy') {
      const x = input as unknown as PrivacyInput;
      const miss = x.mode === 'ci-miss';
      const record = x.mode === 'record';
      return {
        cassette: miss ? [] : [x.answer],
        logs: [] as string[],
        plan: { characters: x.source.length },
        labels: miss ? [] : x.answer.labels,
        networkCalls: record ? 1 : 0,
        keyReads: record ? 1 : 0,
        location: '.cache/',
        committed: false,
        status: miss ? 'miss' : 'ok',
      };
    }
    return null;
  },
} satisfies PointerAdapter;

const leakyCopy = {
  execute(request) {
    const out = copying.execute(request);
    if (request.operation === 'privacy') {
      const x = request.input as unknown as PrivacyInput;
      const mid = Math.floor(x.source.length / 2);
      const keyMid = Math.floor(x.apiKey.length / 2);
      (out as { logs: string[] }).logs = [
        x.source.slice(0, mid),
        x.source.slice(mid),
        x.apiKey.slice(0, keyMid),
        x.apiKey.slice(keyMid),
      ];
    }
    return out;
  },
} satisfies PointerAdapter;

export const reviewCheats = { firstUnit, textHash, copying, leakyCopy } satisfies Record<
  string,
  PointerAdapter
>;

/** Coordinate-only shortcuts from the second independent review. */
type PositionedUnit = {
  text: string;
  line?: number;
  hint?: { start: number; end?: number };
};
type PositionedFile = {
  path: string;
  source?: string;
  units: PositionedUnit[];
};
type PositionalInput = {
  independent?: boolean;
  scans: { estateKey: string; files: PositionedFile[] }[];
};
type PositionalEntry = {
  id: string;
  path: string;
  quote: string;
  status: 'live' | 'deleted';
};

// Preserve the reviewer's exact global-ordinal reuse and trailing deletion rule.
const byIndex = {
  execute({ operation, input }) {
    if (operation !== 'ledger') return null;
    const x = input as unknown as PositionalInput;
    let previous: PositionalEntry[] = [];
    return x.scans.map((scan) => {
      let ordinal = 0;
      const entries: PositionalEntry[] = scan.files.flatMap((file) =>
        file.units.map((unit): PositionalEntry => {
          const at = ordinal++;
          const old = previous[at];
          return {
            id: !x.independent && old ? old.id : hashed(`${scan.estateKey}:${file.path}:${at}`),
            path: file.path,
            quote: unit.text,
            status: 'live',
          };
        }),
      );
      if (!x.independent) {
        for (let at = entries.length; at < previous.length; at++) {
          const old = previous[at] as PositionalEntry;
          entries.push({ ...old, status: 'deleted' });
        }
      }
      previous = structuredClone(entries);
      return { entries };
    });
  },
} satisfies PointerAdapter;

/**
 * Fallback positions are actual text coordinates, not aliases for ordinals.
 * JavaScript string offsets count UTF-16 code units. LF counts make lines
 * one-based, including when source uses CRLF. Explicit coordinates win.
 */
function positionedUnits(file: PositionedFile): { unit: PositionedUnit; line: number; start: number }[] {
  const joined = file.units.map((unit) => unit.text).join('\n\n');
  const source = file.source ?? joined;
  let cursor = 0;
  let joinedStart = 0;
  return file.units.map((unit) => {
    const found = source.indexOf(unit.text, cursor);
    const start = unit.hint?.start ?? (found >= 0 ? found : joinedStart);
    const positionSource = unit.hint || found >= 0 ? source : joined;
    const line = unit.line ?? positionSource.slice(0, start).split('\n').length;
    if (unit.hint || found >= 0) cursor = start + unit.text.length;
    joinedStart += unit.text.length + 2;
    return { unit, line, start };
  });
}

function coordinateCheat(kind: 'line' | 'offset'): PointerAdapter {
  return {
    execute({ operation, input }) {
      if (operation !== 'ledger') return null;
      const x = input as unknown as PositionalInput;
      let previous = new Map<string, PositionalEntry>();
      return x.scans.map((scan) => {
        const next = new Map<string, PositionalEntry>();
        const entries: PositionalEntry[] = [];
        for (const file of scan.files) {
          for (const { unit, line, start } of positionedUnits(file)) {
            const coordinate = kind === 'line' ? line : start;
            const key = JSON.stringify([scan.estateKey, file.path, coordinate]);
            const old = x.independent ? undefined : previous.get(key);
            const entry: PositionalEntry = {
              id: old?.id ?? hashed(key),
              path: file.path,
              quote: unit.text,
              status: 'live',
            };
            entries.push(entry);
            next.set(key, entry);
          }
        }
        if (!x.independent) {
          for (const [key, old] of previous) {
            if (!next.has(key)) {
              const tombstone: PositionalEntry = { ...old, status: 'deleted' };
              entries.push(tombstone);
              next.set(key, tombstone);
            }
          }
        }
        previous = next;
        return { entries };
      });
    },
  };
}

export const positionalCheats = {
  byIndex,
  byLine: coordinateCheat('line'),
  byOffset: coordinateCheat('offset'),
} satisfies Record<string, PointerAdapter>;
