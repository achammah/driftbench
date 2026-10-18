import { sha } from './cut';
import { canonical, type Labelled } from './labels';

/**
 * The cassette holds every recorded labeler answer. The models cannot be pinned to temperature zero, so
 * determinism lives here: the key is the hash of the whole request, so a changed prompt, set, model, window
 * or labeler misses, and the miss names the field that differs from the nearest entry.
 */

/** The request as it goes on the wire. `body` is what the provider receives. */
export type Wire = { labeler: string; body: Record<string, unknown> };

/** What a labeler answered, as recorded. A yes or no model records its probabilities, so a threshold can change without a new call. */
export type Recorded = {
  labels?: Labelled[];
  probabilities?: Record<string, number>;
  returnedModel: string;
  stopReason: string;
  /** Set when the endpoint refused the request as too large: the scan halves the window and asks for each half. */
  refused?: 'too_large';
  usage: { input: number; output: number };
};

export type Readable = Record<string, string>;

export type CassetteEntry = { key: string; readable: Readable; answer: Recorded };

export const wireKey = (wire: Wire): string => sha(canonical(wire));

/** Fields kept beside the key, so a miss can say what differs. `part.*` is a hash per top-level key of the request. */
export function readableOf(
  wire: Wire,
  meta: {
    path: string;
    window: string;
    promptVersion: string;
    schemaVersion: string;
    set: string;
    setHash: string;
    model: string;
    cutDigest: string;
  },
): Readable {
  const parts = Object.fromEntries(
    Object.entries(wire.body).map(([name, value]) => [`part.${name}`, sha(canonical(value)).slice(0, 12)]),
  );
  return { ...meta, labeler: wire.labeler, ...parts };
}

export class CassetteMiss extends Error {
  constructor(
    readonly key: string,
    readonly differs: string[],
    readonly nearest: string | undefined,
  ) {
    super(
      nearest
        ? `the cassette has no answer for request ${key.slice(0, 12)}; the nearest entry ${nearest.slice(0, 12)} differs in: ${differs.join(', ')}`
        : `the cassette has no answer for request ${key.slice(0, 12)}, and no entry for the same file, window and set`,
    );
    this.name = 'CassetteMiss';
  }
}

export class Cassette {
  readonly entries = new Map<string, CassetteEntry>();
  /** Called with each entry as it is recorded, so a long run can append it to a file and lose nothing if it stops. */
  onPut?: (entry: CassetteEntry) => void;

  static parse(text: string): Cassette {
    const cassette = new Cassette();
    for (const [index, line] of text.split('\n').entries()) {
      if (line.trim() === '') continue;
      let entry: CassetteEntry;
      try {
        entry = JSON.parse(line) as CassetteEntry;
      } catch {
        throw new Error(`the cassette is not JSON lines: line ${index + 1} cannot be read`);
      }
      if (typeof entry.key !== 'string' || !entry.readable || !entry.answer) {
        throw new Error(`the cassette line ${index + 1} is not an entry`);
      }
      cassette.entries.set(entry.key, entry);
    }
    return cassette;
  }

  /** Sorted by key, canonical JSON: the same content is the same bytes. */
  render(): string {
    const lines = [...this.entries.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((entry) => canonical(entry));
    return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
  }

  /** The recorded answer for a request, or the miss with the fields that differ from the nearest entry. */
  get(wire: Wire, readable: Readable): CassetteEntry {
    const key = wireKey(wire);
    const hit = this.entries.get(key);
    if (hit) {
      // The key covers the request; the cut digest guards the cutter: same request, different cut.
      if (hit.readable.cutDigest !== readable.cutDigest) {
        throw new CassetteMiss(key, ['cutDigest'], hit.key);
      }
      return hit;
    }
    const same = [...this.entries.values()].filter(
      (entry) =>
        entry.readable.path === readable.path &&
        entry.readable.window === readable.window &&
        entry.readable.set === readable.set &&
        entry.readable.labeler === readable.labeler,
    );
    const differs = (entry: CassetteEntry): string[] =>
      [...new Set([...Object.keys(readable), ...Object.keys(entry.readable)])]
        .filter((field) => readable[field] !== entry.readable[field])
        .sort();
    const nearest = same.sort((a, b) => differs(a).length - differs(b).length)[0];
    throw new CassetteMiss(key, nearest ? differs(nearest) : [], nearest?.key);
  }

  put(wire: Wire, readable: Readable, answer: Recorded): CassetteEntry {
    const key = wireKey(wire);
    const entry = { key, readable, answer };
    this.entries.set(key, entry);
    this.onPut?.(entry);
    return entry;
  }
}
