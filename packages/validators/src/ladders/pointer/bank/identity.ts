import { type BankItem, type Json, type Probe, type Tier, token } from './types';

/**
 * The hash algorithm and tuple encoding are not specified by the design. These
 * probes compare raw fingerprints/ids, never guessed hash bytes. Representative
 * samples are harness witnesses only, not outputs supplied to the reader.
 */
function fingerprintObservation(actual: unknown): unknown {
  if (
    !Array.isArray(actual) ||
    actual.length !== 2 ||
    !actual.every((value) => typeof value === 'string' && value.length > 0)
  )
    return null;
  return { equal: actual[0] === actual[1] };
}

function fingerprints(left: string, right: string, equal: boolean, container = 'sentence'): Probe {
  return {
    request: {
      operation: 'fingerprint',
      input: {
        units: [
          { text: left, container },
          { text: right, container },
        ],
      },
    },
    expected: { equal },
    observe: fingerprintObservation,
    sample: equal
      ? ['opaque-fingerprint-a', 'opaque-fingerprint-a']
      : ['opaque-fingerprint-a', 'opaque-fingerprint-b'],
  };
}

type FingerprintCase = {
  name: string;
  cause: string;
  tier: Tier;
  container?: string;
  pair: (text: string) => [string, string];
  equal: boolean;
};

const fingerprintCases: FingerprintCase[] = [
  {
    name: 'nfc-acute',
    cause: 'normalise-nfc',
    tier: 1,
    pair: (s) => [`${s} é`, `${s} e\u0301`],
    equal: true,
  },
  {
    name: 'spaces',
    cause: 'collapse-whitespace',
    tier: 1,
    pair: (s) => [`${s} stays here`, `${s}  stays   here`],
    equal: true,
  },
  {
    name: 'tabs',
    cause: 'collapse-whitespace',
    tier: 1,
    pair: (s) => [`${s} stays here`, `${s}\tstays\there`],
    equal: true,
  },
  {
    name: 'case',
    cause: 'preserve-case',
    tier: 1,
    pair: (s) => [`${s} Return`, `${s} RETURN`],
    equal: false,
  },
  {
    name: 'lf-wrap',
    cause: 'collapse-whitespace',
    tier: 2,
    pair: (s) => [`${s} stays here`, `${s}\nstays\nhere`],
    equal: true,
  },
  {
    name: 'crlf-wrap',
    cause: 'collapse-whitespace',
    tier: 2,
    pair: (s) => [`${s} stays here`, `${s}\r\nstays\r\nhere`],
    equal: true,
  },
  {
    name: 'nonbreaking-space',
    cause: 'collapse-whitespace',
    tier: 2,
    pair: (s) => [`${s} stays here`, `${s}\u00a0stays\u00a0here`],
    equal: true,
  },
  {
    name: 'bold',
    cause: 'preserve-emphasis',
    tier: 2,
    pair: (s) => [`${s} stays here`, `**${s} stays here**`],
    equal: false,
  },
  {
    name: 'nfc-hangul',
    cause: 'normalise-nfc',
    tier: 3,
    pair: (s) => [`${s} 가`, `${s} \u1100\u1161`],
    equal: true,
  },
  {
    name: 'bullet-swap',
    cause: 'strip-container-markers',
    tier: 3,
    container: 'list_item',
    pair: (s) => [`- ${s} stays here`, `+ ${s} stays here`],
    equal: true,
  },
  {
    name: 'ordered-renumber',
    cause: 'strip-container-markers',
    tier: 3,
    container: 'list_item',
    pair: (s) => [`3. ${s} stays here`, `17. ${s} stays here`],
    equal: true,
  },
  {
    name: 'italic',
    cause: 'preserve-emphasis',
    tier: 3,
    pair: (s) => [`${s} stays here`, `*${s} stays here*`],
    equal: false,
  },
  {
    name: 'quote-marker',
    cause: 'strip-container-markers',
    tier: 4,
    container: 'blockquote',
    pair: (s) => [`> ${s} stays here`, `${s} stays here`],
    equal: true,
  },
  {
    name: 'pipe-marker',
    cause: 'strip-container-markers',
    tier: 4,
    container: 'table_cell',
    pair: (s) => [`| ${s} stays here |`, `${s} stays here`],
    equal: true,
  },
  {
    name: 'compatibility-ligature',
    cause: 'avoid-nfkc',
    tier: 4,
    pair: (s) => [`${s} ﬁ`, `${s} fi`],
    equal: false,
  },
  { name: 'fullwidth', cause: 'avoid-nfkc', tier: 4, pair: (s) => [`${s} Ａ`, `${s} A`], equal: false },
  {
    name: 'nfc-and-wrap',
    cause: 'compose-normalisation',
    tier: 5,
    pair: (s) => [`${s} ö stays`, `${s}\r\no\u0308\tstays`],
    equal: true,
  },
  {
    name: 'marker-and-nfc',
    cause: 'compose-normalisation',
    tier: 5,
    container: 'list_item',
    pair: (s) => [`- ${s} é stays`, `+ ${s} e\u0301  stays`],
    equal: true,
  },
  {
    name: 'whitespace-must-not-hide-case',
    cause: 'preserve-case',
    tier: 5,
    pair: (s) => [`${s} Keep here`, `${s}\tKEEP\nhere`],
    equal: false,
  },
  {
    name: 'nfc-must-not-hide-emphasis',
    cause: 'preserve-emphasis',
    tier: 5,
    pair: (s) => [`${s} é stays`, `${s} **e\u0301** stays`],
    equal: false,
  },
];

type RawUnit = { id: string; path: string; text: string; sectionPath: string[]; container: string };
function rawId(seed: number, salt: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let n = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  let out = '';
  for (let i = 0; i < 10; i++) {
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
    out += alphabet[(n >>> 16) & 31];
  }
  return out;
}

type LedgerEntry = { id: string; path: string; quote: string; status: string };

/** Observe identities as equivalence classes across the complete scan history.
 * Sorting duplicate ids only assigns local names; no hash byte is an oracle. */
function ledgerObservation(actual: unknown): unknown {
  if (!Array.isArray(actual) || actual.length < 2) return null;
  const snapshots = actual as { entries?: LedgerEntry[] }[];
  if (!snapshots.every((snapshot) => Array.isArray(snapshot.entries))) return null;
  if (
    !snapshots.every((snapshot) =>
      snapshot.entries?.every(
        (entry) =>
          typeof entry.id === 'string' &&
          /^[a-z2-7]{10}$/.test(entry.id) &&
          typeof entry.path === 'string' &&
          typeof entry.quote === 'string' &&
          (entry.status === 'live' || entry.status === 'deleted'),
      ),
    )
  )
    return null;
  const names = new Map<string, number>();
  return snapshots.map((snapshot) => {
    const groups = new Map<string, { path: string; quote: string; status: string; ids: string[] }>();
    for (const entry of snapshot.entries ?? []) {
      const key = JSON.stringify([entry.path, entry.quote, entry.status]);
      const group = groups.get(key) ?? {
        path: entry.path,
        quote: entry.quote,
        status: entry.status,
        ids: [],
      };
      group.ids.push(entry.id);
      groups.set(key, group);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, group]) => {
        const identities = group.ids
          .sort()
          .map((id) => {
            if (!names.has(id)) names.set(id, names.size);
            return names.get(id) as number;
          })
          .sort((a, b) => a - b);
        return { path: group.path, quote: group.quote, status: group.status, identities };
      });
  });
}

type LedgerCase = { name: string; cause: string; tier: Tier; mode: string };
const ledgerCases: LedgerCase[] = [
  { name: 'independent-clones', cause: 'derive-id-from-estate-tuple', tier: 1, mode: 'clone' },
  { name: 'same-file-occurrences', cause: 'include-occurrence-index', tier: 1, mode: 'duplicate' },
  { name: 'separate-estate-keys', cause: 'include-estate-key', tier: 2, mode: 'estate' },
  { name: 'separate-file-paths', cause: 'include-path-at-mint', tier: 2, mode: 'path' },
  { name: 'display-number-insertion', cause: 'persist-id-after-edit', tier: 3, mode: 'number' },
  { name: 'small-text-edit', cause: 'persist-id-after-edit', tier: 3, mode: 'edit' },
  { name: 'cross-file-move', cause: 'persist-id-after-move', tier: 4, mode: 'move' },
  { name: 'set-description-edit', cause: 'decouple-id-from-label-set', tier: 4, mode: 'set' },
  { name: 'stack-bound-edit', cause: 'decouple-id-from-labeler', tier: 5, mode: 'bounds' },
  { name: 'two-sets-one-unit', cause: 'one-id-per-unit', tier: 5, mode: 'sets' },
];

/** Bank input boundary: files carry their actual fictional Markdown source.
 * hint.start/end are zero-based UTF-16, end-exclusive offsets into that source;
 * line is the one-based line containing hint.start. Positions are input evidence,
 * never identities and never additional requirements on returned ledger entries.
 * Layout controls are generator-only and are removed from the emitted request. */
function ledgerRequest(scans: Json[], independent: boolean): Probe['request'] {
  const positioned = scans.map((value) => {
    const scan = value as Record<string, Json>;
    const files = scan.files as {
      path: string;
      units: { text: string }[];
      leadingNewlines?: number;
      betweenNewlines?: number;
    }[];
    return {
      ...scan,
      files: files.map((file) => {
        let source = '\n'.repeat(file.leadingNewlines ?? 0);
        const units = file.units.map((unit, index) => {
          if (index > 0) source += '\n'.repeat(file.betweenNewlines ?? 2);
          const start = source.length;
          const line = source.slice(0, start).split('\n').length;
          source += unit.text;
          return { ...unit, hint: { start, end: source.length }, line };
        });
        return { path: file.path, source, units };
      }),
    };
  });
  return { operation: 'ledger', input: { scans: positioned, independent } };
}

function ledgerProbe(seed: number, mode: string, lifecycle: boolean): Probe {
  const text = `Retain the fictional parcel ${token(seed)} until the sealed carrier returns with its receipt.`;
  const trackedText = `Inspect the fictional vessel ${token(seed, 3)} under the painted cabinet before its keeper closes the register.`;
  const editedText = trackedText.replace('painted', 'marked');
  const estate = `estate-${token(seed, 2)}`;
  const unit = (quote: string) => ({
    text: quote,
    container: 'sentence',
    labels: { demo: 'kept' },
    linked: false,
  });
  const files = (tracked = trackedText, moved = false, removed = false) => [
    { path: 'a.md', units: [unit(text), unit(text)] },
    { path: 'b.md', units: [unit(text)] },
    ...(removed ? [] : [{ path: moved ? 'relocated/tracked.md' : 'tracked.md', units: [unit(tracked)] }]),
  ];
  const initial = { estateKey: estate, files: files(), labelSets: { demo: 'Keep parcel instructions.' } };
  const entries: LedgerEntry[] = [
    { id: rawId(seed, 0), path: 'a.md', quote: text, status: 'live' },
    { id: rawId(seed, 1), path: 'a.md', quote: text, status: 'live' },
    { id: rawId(seed, 2), path: 'b.md', quote: text, status: 'live' },
    { id: rawId(seed, 3), path: 'tracked.md', quote: trackedText, status: 'live' },
  ];
  const reviseTracked = (quote: string, path: string, status = 'live') =>
    entries.map((entry, index) => (index === 3 ? { ...entry, quote, path, status } : { ...entry }));
  let scans: Json[] = [initial, initial];
  let later = entries.map((entry) => ({ ...entry }));
  let independent = mode === 'clone' || mode === 'estate' || mode === 'path';
  if (mode === 'estate') {
    scans = [initial, { ...initial, estateKey: `${estate}-other` }];
    later = entries.map((entry, index) => ({ ...entry, id: rawId(seed, index + 40) }));
  }
  if (mode === 'path') {
    scans = [
      initial,
      { ...initial, files: initial.files.map((file) => ({ ...file, path: `other/${file.path}` })) },
    ];
    later = entries.map((entry, index) => ({
      ...entry,
      path: `other/${entry.path}`,
      id: rawId(seed, index + 40),
    }));
  }
  if (mode === 'number') {
    scans = [
      initial,
      {
        ...initial,
        files: files().map((file) => ({
          ...file,
          units: file.units.map((u, index) => ({ ...u, displayNumber: index + 8 })),
        })),
      },
    ];
  }
  if (mode === 'edit') {
    scans = [initial, { ...initial, files: files(editedText) }];
    later = reviseTracked(editedText, 'tracked.md');
  }
  if (mode === 'move') {
    scans = [initial, { ...initial, files: files(trackedText, true) }];
    later = reviseTracked(trackedText, 'relocated/tracked.md');
  }
  if (mode === 'set') scans = [initial, { ...initial, labelSets: { demo: 'Keep all parcel instructions.' } }];
  if (mode === 'bounds')
    scans = [
      { ...initial, bounds: { passAt: 0.9, failAt: 0.1 } },
      { ...initial, bounds: { passAt: 0.95, failAt: 0.05 } },
    ];
  if (mode === 'sets')
    scans = [
      initial,
      {
        ...initial,
        files: files().map((file) => ({
          ...file,
          units: file.units.map((u) => ({ ...u, labels: { demo: 'kept', second: 'selected' } })),
        })),
        labelSets: { demo: 'Keep parcel instructions.', second: 'Select carrier procedures.' },
      },
    ];
  let sample: Json = [{ entries }, { entries: later }];
  if (lifecycle) {
    // These are the same occurrence/path identities as the named scenario, now
    // followed through edits, a relocation, and a tombstone. Duplicate boilerplate
    // remains live throughout; only the distinctive tracked unit changes.
    independent = false;
    scans = [
      initial,
      { ...initial, files: files(editedText) },
      { ...initial, files: files(editedText, true) },
      { ...initial, files: files(editedText, true, true) },
    ];
    sample = [
      { entries },
      { entries: reviseTracked(editedText, 'tracked.md') },
      { entries: reviseTracked(editedText, 'relocated/tracked.md') },
      { entries: reviseTracked(editedText, 'relocated/tracked.md', 'deleted') },
    ];
  }
  return {
    request: ledgerRequest(scans, independent),
    expected: ledgerObservation(sample) as Json,
    observe: ledgerObservation,
    sample,
  };
}

/** Independent minting must include the fingerprint. All positional evidence,
 * including UTF-16 lengths, is identical across these fresh snapshots. */
function freshFingerprintProbe(seed: number): Probe {
  const estateKey = `fresh-${token(seed, 90)}`;
  const texts = [
    `Retain the fictional 📦 parcel ${token(seed, 91)} until its carrier presents receipt X.`,
    `Inspect the fictional cabinet ${token(seed, 92)} before its keeper closes register X.`,
    `Return the fictional vessel ${token(seed, 93)} after its custodian checks marker X.`,
  ];
  const changed = texts.map((text) => text.replace(' X.', ' Y.'));
  const unit = (text: string) => ({ text, container: 'sentence', labels: { demo: 'kept' }, linked: false });
  const scan = (quotes: string[]): Json => ({
    estateKey,
    files: [
      { path: 'fresh/a.md', units: quotes.slice(0, 2).map(unit) },
      { path: 'fresh/b.md', units: quotes.slice(2).map(unit) },
    ],
    labelSets: { demo: 'Keep the fictional handling instructions.' },
  });
  const entries = (quotes: string[], salt: number): LedgerEntry[] =>
    quotes.map((quote, index) => ({
      id: rawId(seed, salt + index),
      path: index < 2 ? 'fresh/a.md' : 'fresh/b.md',
      quote,
      status: 'live',
    }));
  const sample: Json = [{ entries: entries(texts, 120) }, { entries: entries(changed, 140) }];
  return {
    request: ledgerRequest([scan(texts), scan(changed)], true),
    expected: ledgerObservation(sample) as Json,
    observe: ledgerObservation,
    sample,
  };
}

/** An identity follows a unique unit through genuine structural changes. Array
 * order, file order, line number and offset are deliberately independent axes. */
function positionHistoryProbe(seed: number): Probe {
  const estateKey = `history-${token(seed, 150)}`;
  const texts = [
    `Retain the fictional 📦 parcel ${token(seed, 151)} beside the blue compartment until its courier presents the receipt.`,
    `Inspect the fictional cabinet ${token(seed, 152)} beside the copper doorway before its keeper closes the register.`,
    `Return the fictional vessel ${token(seed, 153)} to the green alcove after its custodian verifies the marker.`,
    `Place the fictional envelope ${token(seed, 154)} beneath the silver panel while its steward reviews the manifest.`,
    `Secure the fictional container ${token(seed, 155)} behind the amber screen until its attendant checks the seal.`,
    `Count the fictional receipts ${token(seed, 156)} above the violet drawer before its auditor opens the ledger.`,
  ];
  const extended = `${(texts[2] as string).slice(0, -1)} beside the additional fictional reference ${token(seed, 157)}.`;
  type Placement = { path: string; indices: number[]; leadingNewlines?: number; betweenNewlines?: number };
  type Phase = { placements: Placement[]; deleted: number[]; extend?: boolean };
  const initial: Placement[] = [
    { path: 'history/a.md', indices: [0, 1, 2] },
    { path: 'history/b.md', indices: [3, 4] },
  ];
  const permuted: Placement[] = [
    { path: 'history/b.md', indices: [4, 3] },
    { path: 'history/a.md', indices: [2, 0, 1] },
  ];
  const spaced = permuted.map((file) => ({ ...file, leadingNewlines: 3, betweenNewlines: 4 }));
  const phases: Phase[] = [
    { placements: initial, deleted: [] },
    // Real insertion before all three surviving units, not a display-number edit.
    { placements: [{ path: 'history/a.md', indices: [5, 0, 1, 2] }, initial[1] as Placement], deleted: [] },
    { placements: initial, deleted: [5] },
    // Both the input file array and the unique units within each file are permuted.
    { placements: permuted, deleted: [5] },
    // Indices and text stay fixed while preceding blank lines move every position.
    { placements: spaced, deleted: [5] },
    // Same lines and indices: a longer earlier unit shifts later UTF-16 offsets.
    { placements: spaced, deleted: [5], extend: true },
    // Remove a middle unit, retaining its tombstone and the later unit's identity.
    {
      placements: [spaced[0] as Placement, { ...spaced[1], path: 'history/a.md', indices: [2, 1] }],
      deleted: [5, 0],
      extend: true,
    },
  ];
  const quoteAt = (index: number, phase: Phase) =>
    index === 2 && phase.extend ? extended : (texts[index] as string);
  const scans: Json[] = phases.map((phase) => ({
    estateKey,
    labelSets: { demo: 'Keep the fictional handling instructions.' },
    files: phase.placements.map((file) => ({
      path: file.path,
      leadingNewlines: file.leadingNewlines ?? 0,
      betweenNewlines: file.betweenNewlines ?? 2,
      units: file.indices.map((index) => ({
        text: quoteAt(index, phase),
        container: 'sentence',
        labels: { demo: 'kept' },
        linked: false,
      })),
    })),
  }));
  const sample: Json = phases.map((phase) => ({
    entries: [
      ...phase.placements.flatMap((file) =>
        file.indices.map((index) => ({
          id: rawId(seed, 170 + index),
          path: file.path,
          quote: quoteAt(index, phase),
          status: 'live',
        })),
      ),
      ...phase.deleted.map((index) => ({
        id: rawId(seed, 170 + index),
        path: 'history/a.md',
        quote: texts[index] as string,
        status: 'deleted',
      })),
    ],
  }));
  return {
    request: ledgerRequest(scans, false),
    expected: ledgerObservation(sample) as Json,
    observe: ledgerObservation,
    sample,
  };
}

function reanchorObservation(actual: unknown): unknown {
  if (!Array.isArray(actual)) return null;
  const entries = actual as {
    id?: unknown;
    path?: unknown;
    quote?: unknown;
    status?: unknown;
    lineage?: { event?: unknown }[];
    candidates?: { path?: unknown; quote?: unknown }[];
  }[];
  if (
    !entries.every(
      (entry) =>
        typeof entry.id === 'string' &&
        typeof entry.path === 'string' &&
        typeof entry.quote === 'string' &&
        (entry.status === 'live' || entry.status === 'deleted') &&
        Array.isArray(entry.lineage) &&
        entry.lineage.length > 0,
    )
  )
    return null;
  return entries
    .map((entry) => ({
      id: entry.id,
      path: entry.path,
      quote: entry.quote,
      status: entry.status,
      event: entry.lineage?.at(-1)?.event,
      candidates: (entry.candidates ?? [])
        .map((candidate) => ({ path: candidate.path, quote: candidate.quote }))
        .sort((a, b) => String(a.path).localeCompare(String(b.path))),
    }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

type AnchorCase = { name: string; cause: string; tier: Tier; mode: string };
const anchorCases: AnchorCase[] = [
  { name: 'unchanged', cause: 'histogram-anchors-before-fuzzy', tier: 1, mode: 'unchanged' },
  { name: 'deleted', cause: 'retain-deleted-quote', tier: 1, mode: 'deleted' },
  { name: 'cross-file-move', cause: 'search-exact-estate-move', tier: 2, mode: 'move' },
  { name: 'small-edit', cause: 'accept-high-text-similarity', tier: 2, mode: 'edit' },
  { name: 'rewrite-floor', cause: 'enforce-text-floor', tier: 3, mode: 'rewrite' },
  { name: 'ambiguous-move', cause: 'retain-all-exact-candidates', tier: 3, mode: 'ambiguous' },
  { name: 'exact-before-near', cause: 'exact-before-fuzzy', tier: 4, mode: 'exact-first' },
  { name: 'original-plus-copy', cause: 'keep-anchor-before-twin', tier: 4, mode: 'copy' },
  { name: 'exact-concatenation-split', cause: 'compare-neighbour-concatenation', tier: 5, mode: 'split' },
  { name: 'exact-concatenation-merge', cause: 'compare-neighbour-concatenation', tier: 5, mode: 'merged' },
];

/** Three independent stressors compose with every transition: Unicode, repeated
 * local context, and Markdown emphasis. They change evidence, not fixture names. */
const contexts = ['unicode', 'repeated-neighbours', 'emphasis'] as const;

/** Lineage edges expose the old ids and the event, never which new child owns
 * an id. The design does not fix child-id assignment for splits and merges. */
function concatenationObservation(actual: unknown): unknown {
  if (!Array.isArray(actual)) return null;
  const events = actual as { event?: unknown; sourceIds?: unknown; targetTexts?: unknown }[];
  if (
    !events.every(
      (edge) =>
        typeof edge.event === 'string' &&
        Array.isArray(edge.sourceIds) &&
        edge.sourceIds.every((id) => typeof id === 'string') &&
        Array.isArray(edge.targetTexts) &&
        edge.targetTexts.every((text) => typeof text === 'string'),
    )
  )
    return null;
  return events
    .map((edge) => ({
      event: edge.event,
      sourceIds: [...(edge.sourceIds as string[])].sort(),
      targetTexts: edge.targetTexts,
    }))
    .sort((a, b) => a.sourceIds.join(',').localeCompare(b.sourceIds.join(',')));
}

function concatenationProbe(
  seed: number,
  mode: 'split' | 'merged',
  context: (typeof contexts)[number],
  control: boolean,
): Probe {
  const nonce = token(seed);
  const firstBase = `Retain the fictional parcel ${nonce} inside the sealed chamber until its carrier brings the receipt.`;
  const secondBase = `Place the fictional vessel ${nonce} beside the painted cabinet while its keeper checks the register.`;
  const decorate = (text: string) =>
    context === 'unicode' ? `${text} Café.` : context === 'emphasis' ? `**${text}**` : text;
  const first = decorate(firstBase);
  const second = decorate(secondBase);
  const joined = first + second;
  const path = `${nonce}/concatenated.md`;
  const ids = [rawId(seed, 81), rawId(seed, 82)];
  const neighbours = context === 'repeated-neighbours' ? 'Identical neighbouring context. '.repeat(4) : nonce;
  const make = (text: string, index: number): Json => ({
    id: ids[index] as string,
    path,
    text,
    container: 'list_item',
    sectionPath: ['Parcel records'],
    prefix: neighbours,
    suffix: neighbours,
  });
  const before = mode === 'split' ? [make(joined, 0)] : [make(first, 0), make(second, 1)];
  const targetTexts = mode === 'split' ? [first, second] : [joined];
  const after = control
    ? before
    : targetTexts.map((text) => ({
        path,
        text,
        container: 'list_item',
        sectionPath: ['Parcel records'],
        prefix: neighbours,
        suffix: neighbours,
      }));
  const sources = mode === 'split' ? [ids[0] as string] : ids;
  const sample: Json = control
    ? before.map((unit, index) => ({
        event: 'unchanged',
        sourceIds: [sources[index] as string],
        targetTexts: [(unit as { text: string }).text],
      }))
    : [{ event: mode, sourceIds: sources, targetTexts }];
  return {
    request: {
      operation: 'reanchor',
      input: {
        before,
        after,
        // Isolate step 4: individual halves cannot clear this configured threshold,
        // but their exact concatenation scores 1. No fuzzy-score tie is asserted.
        settings: { threshold: 0.99, textFloor: 0.4, exactLengthFloor: 20 },
        selectIds: sources,
        observation: 'lineage-edges',
      },
    },
    expected: concatenationObservation(sample) as Json,
    observe: concatenationObservation,
    sample,
  };
}

function anchorProbe(
  seed: number,
  mode: string,
  context: (typeof contexts)[number],
  control: boolean,
): Probe {
  if (mode === 'split' || mode === 'merged') return concatenationProbe(seed, mode, context, control);
  const nonce = token(seed);
  const base = `Retain the fictional parcel ${nonce} inside the sealed chamber until the returning carrier presents the numbered receipt.`;
  const text =
    context === 'unicode' ? `${base} Café ${nonce}.` : context === 'emphasis' ? `**${base}**` : base;
  const id = rawId(seed, 71);
  const before: RawUnit = {
    id,
    path: `${nonce}/before.md`,
    text,
    sectionPath: ['Parcel records'],
    container: 'sentence',
  };
  const prefix =
    context === 'repeated-neighbours' ? 'The repeated context remains. '.repeat(4) : `Prior ${nonce}.`;
  const suffix = context === 'repeated-neighbours' ? prefix : `Later ${nonce}.`;
  const origin = { ...before, prefix, suffix };
  const candidate = (path: string, nextText = text): Json => ({
    path,
    text: nextText,
    container: 'sentence',
    sectionPath: ['Parcel records'],
    prefix,
    suffix,
  });
  let after: Json[] = [candidate(before.path)];
  let event = 'unchanged';
  let path = before.path;
  let quote = text;
  let candidates: { path: string; quote: string }[] = [];
  if (mode === 'deleted') {
    after = [];
    event = 'deleted';
  }
  if (mode === 'move') {
    path = `${nonce}/moved.md`;
    after = [candidate(path)];
    event = 'moved';
  }
  if (mode === 'edit') {
    quote = text.replace('sealed', 'closed');
    after = [candidate(path, quote)];
    event = 'changed';
  }
  if (mode === 'rewrite') {
    // Disjoint alphabets force text similarity below .4 even with identical context.
    const replacement = '界'.repeat(text.length);
    after = [candidate(path, replacement)];
    event = 'deleted';
  }
  if (mode === 'ambiguous') {
    const paths = [`${nonce}/one.md`, `${nonce}/two.md`];
    after = paths.map((p) => candidate(p));
    candidates = paths.map((p) => ({ path: p, quote: text }));
    event = 'ambiguous';
  }
  if (mode === 'exact-first') {
    path = `${nonce}/exact.md`;
    after = [candidate(before.path, text.replace('sealed', 'closed')), candidate(path)];
    event = 'moved';
  }
  if (mode === 'copy') after = [candidate(before.path), candidate(`${nonce}/copy.md`)];
  if (control) {
    after = mode === 'deleted' || mode === 'rewrite' ? [candidate(before.path)] : [];
    event = after.length ? 'unchanged' : 'deleted';
    path = before.path;
    quote = text;
    candidates = [];
  }
  const sample = [
    { id, path, quote, status: event === 'deleted' ? 'deleted' : 'live', lineage: [{ event }], candidates },
  ];
  return {
    request: {
      operation: 'reanchor',
      input: {
        before: [origin],
        after,
        settings: { threshold: 0.45, textFloor: 0.4, exactLengthFloor: 20 },
        selectIds: [id],
      },
    },
    expected: reanchorObservation(sample) as Json,
    observe: reanchorObservation,
    sample,
  };
}

export function identityItems(): BankItem[] {
  const fingerprintsBank: BankItem[] = fingerprintCases.map((c) => ({
    id: `pointer.ids.${c.name}`,
    family: 'ids',
    tier: c.tier,
    level: c.tier,
    component: 'pointer.fingerprint',
    title: c.name,
    cause: c.cause,
    design: '4. Layer A: the ledger — Fingerprint',
    generate(seed) {
      const text = `Parcel ${token(seed)}`;
      const [left, right] = c.pair(text);
      return {
        probes: [
          fingerprints(left, right, c.equal, c.container),
          // A distinct-byte equal pair proves normalization even in semantic-
          // inequality cases; returning a hash of the raw text cannot pass.
          fingerprints(
            `${left.normalize('NFC')} Café witness`,
            `${left}  Cafe\u0301\twitness`,
            true,
            c.container,
          ),
          fingerprints(left, `${left} extra`, false, c.container),
        ],
      };
    },
  }));
  const ledgerBank: BankItem[] = ledgerCases.map((c) => ({
    id: `pointer.ids.${c.name}`,
    family: 'ids',
    tier: c.tier,
    level: c.tier,
    component: 'pointer.ledger',
    title: c.name,
    cause: c.cause,
    design: '4. Layer A: the ledger — Id; 1. Label sets; 3. The default stack',
    generate: (seed) => ({
      probes: [
        ledgerProbe(seed, c.mode, false),
        ledgerProbe(seed, c.mode, true),
        freshFingerprintProbe(seed),
        positionHistoryProbe(seed),
      ],
    }),
  }));
  const anchorBank: BankItem[] = anchorCases.flatMap((c) =>
    contexts.map((context) => ({
      id: `pointer.re-anchoring.${c.name}.${context}`,
      family: 're-anchoring',
      tier: c.tier,
      level: c.tier,
      component: 'pointer.reanchor',
      title: `${c.name} with ${context}`,
      cause: c.cause,
      design: '4. Layer A: the ledger — Re-anchoring on a changed file',
      generate: (seed: number) => ({
        probes: [anchorProbe(seed, c.mode, context, false), anchorProbe(seed, c.mode, context, true)],
      }),
    })),
  );
  return [...fingerprintsBank, ...ledgerBank, ...anchorBank];
}
