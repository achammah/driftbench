import type {
  Atom,
  CutResult,
  CutUnit,
  Diagnostic,
  LedgerEntry,
  LedgerView,
  PointerSut,
  ScanRequest,
  ScanResult,
  SourceFile,
  StackApi,
  Transport,
} from './port';
import { ReaderNotReachable } from './port';

/**
 * The one file that knows the real pointer reader. It maps the reader's exports (names and types only, as listed in
 * the seam) onto the bank's port. Nothing else in the bank imports the reader. The module is loaded at run time,
 * so a checkout without the reader still compiles and every item fails with "not reachable".
 */

type RUnit = {
  container: string;
  start: number;
  end: number;
  text: string;
  fp: string;
  path: string[];
  key?: string;
};
type RCut = { units: RUnit[]; digest: string };
type RLabel = { label: string; setHash: string; source: string; target?: string };
type REntry = {
  id: string;
  path: string;
  index: number;
  sectionPath: string[];
  container: string;
  fp: string;
  ctxFp: string;
  quote: string;
  prefix: string;
  suffix: string;
  status: 'live' | 'deleted';
  labels: Record<string, RLabel>;
  lineage?: LedgerEntry['lineage'];
  twinOf?: LedgerEntry['twinOf'];
};
type RLedger = { version: 1; cutDigests: Record<string, string>; entries: REntry[] };
type RSet = { set: string; description: string; labels: unknown[] };
type RWindow = {
  id: string;
  path: string;
  headingPath: string[];
  units: Array<{ n: number; text: string; index: number }>;
};
type RLabelled = { units: string; label: string; target?: number };
type RRecorded = {
  labels?: RLabelled[];
  probabilities?: Record<string, number>;
  returnedModel: string;
  stopReason: string;
  usage: { input: number; output: number };
};
type RWire = { labeler: string; body: Record<string, unknown> };
type RLabeler = {
  id: string;
  family: string;
  cls: 'system1' | 'system2';
  settings: Readonly<Record<string, unknown>>;
  model: string;
  maxUnits(set: RSet, wanted: number): number;
  render(set: RSet, window: RWindow): RWire;
  opinions(answer: RRecorded, set: RSet, window: RWindow): unknown;
  call?(wire: RWire, set: RSet, window: RWindow): Promise<RRecorded>;
};
type RLabelling = { members: readonly RLabeler[]; describe: string };
type RCassette = { render(): string };
type RLabelledUnit = unknown;
type RResult = {
  ledger: RLedger;
  events: Record<string, number>;
  /** Observability extensions: absence is not an empty observation. */
  eventsById?: Record<string, string>;
  warnings?: string[];
  cuts: Map<string, RCut>;
  labelled: RLabelledUnit[];
  windows: number;
  carried: number;
  calls: number;
  unlabeled: number;
  refusals: string[];
  failed: string[];
  recorded: number;
};
type RAtom = {
  kind: string;
  provenance: { file: string; startLine: number; endLine: number; quote: string };
  producedBy: string;
  approved: boolean;
  fields?: Record<string, unknown>;
  evidence: Array<Record<string, unknown>>;
};

export type ReaderExports = {
  /** Optional stack observables. Unsupported rules fail explicitly. */
  margin?: StackApi['margin'];
  stackDecision?: StackApi['decide'];
  AGENT_RULES_SET: string;
  AtomBuilder: new (files: ReadonlyMap<string, unknown>) => { atoms: RAtom[] };
  Cassette: { parse(text: string): RCassette };
  cut(source: string): RCut;
  LabelerError: new (message: string) => Error;
  buildLabelling(
    specs: Array<{ cls: 'system1' | 'system2'; client: string }>,
    options: {
      env: Record<string, string | undefined>;
      cwd: string;
      record: boolean;
      threshold?: number;
      fetch?: unknown;
    },
  ): Promise<{ ok: true; labelling: RLabelling } | { ok: false; message: string }>;
  singleLabelling(labeler: RLabeler): RLabelling;
  denseOpinions(answer: RRecorded, set: RSet, window: RWindow): unknown;
  /** Optional validator seam; the adapter never implements lockfile semantics. */
  checkLedger?(previous: string | undefined, current: RLedger): { ok: boolean; error?: string };
  parseDenseAnswer(text: string): RLabelled[];
  parseLabelSets(text: string): { ok: true; sets: RSet[] } | { ok: false; message: string };
  parseLedger(text: string): RLedger | undefined;
  renderLedger(ledger: RLedger): string;
  setHash(set: RSet): string;
  pointerScan(input: Record<string, unknown>): Promise<RResult>;
  pointerAtoms(
    labelled: readonly RLabelledUnit[],
    texts: ReadonlyMap<string, string>,
    builder: { atoms: RAtom[] },
    labeler: string,
  ): { accepted: RAtom[]; refusals: string[]; duplicates: string[] };
};

const NAMES = [
  'AtomBuilder',
  'AGENT_RULES_SET',
  'Cassette',
  'cut',
  'LabelerError',
  'buildLabelling',
  'singleLabelling',
  'denseOpinions',
  'parseDenseAnswer',
  'parseLabelSets',
  'parseLedger',
  'renderLedger',
  'setHash',
  'pointerScan',
  'pointerAtoms',
] as const;

const SPECIFIER = '@agent-nexus/driftbench-estate';
let loaded: Promise<ReaderExports> | undefined;

/** Bounds module loading once, before a baseline can spend an item timeout on a missing component. */
export async function loadReaderExports(
  importer: () => Promise<Record<string, unknown>>,
  timeoutMs = 5_000,
): Promise<ReaderExports> {
  let timer: NodeJS.Timeout | undefined;
  const importing = (async () => {
    let mod: Record<string, unknown>;
    try {
      mod = await importer();
    } catch (cause) {
      throw new ReaderNotReachable(
        `${SPECIFIER} cannot be loaded (${cause instanceof Error ? cause.message : String(cause)})`,
      );
    }
    const ns = (mod.pointer ?? {}) as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...ns, AtomBuilder: mod.AtomBuilder };
    const missing = NAMES.filter((n) => merged[n] === undefined);
    if (missing.length > 0)
      throw new ReaderNotReachable(`${SPECIFIER} does not export ${missing.join(', ')} (namespace pointer)`);
    return merged as unknown as ReaderExports;
  })();
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new ReaderNotReachable(
            `${SPECIFIER} import did not settle within ${timeoutMs} ms; the reader component must be available before a baseline`,
          ),
        ),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([importing, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function load(): Promise<ReaderExports> {
  loaded ??= loadReaderExports(
    async () => (await import(/* @vite-ignore */ SPECIFIER)) as Record<string, unknown>,
  );
  return loaded;
}

/** A real baseline requires the actual reader exports before it runs any item or writes any score. */
export async function assertReaderAvailable(): Promise<void> {
  await load();
}

/* ----- cut ----- */

function bankContainer(unit: RUnit): string {
  if (unit.container === 'front_matter_value') return 'front_matter';
  if (unit.container === 'opaque') return /^\s*(```|~~~)/.test(unit.text) ? 'fence' : 'comment';
  return unit.container;
}

/** `$.description`, `$.items[0].name` or `$['a b']` as path parts. */
function yamlPathOf(key: string | undefined): string[] | undefined {
  if (key === undefined) return undefined;
  const parts: string[] = [];
  const pattern = /\.([^.[\]]+)|\[(\d+)\]|\['([^']*)'\]|\["([^"]*)"\]/g;
  let m: RegExpExecArray | null = pattern.exec(key);
  while (m !== null) {
    parts.push((m[1] ?? m[2] ?? m[3] ?? m[4]) as string);
    m = pattern.exec(key);
  }
  return parts;
}

function toUnit(unit: RUnit): CutUnit {
  const yamlPath = yamlPathOf(unit.key);
  return {
    container: bankContainer(unit),
    start: unit.start,
    end: unit.end,
    text: unit.text,
    fp: unit.fp,
    path: unit.path,
    ...(yamlPath ? { yamlPath } : {}),
    opaque: unit.container === 'opaque',
  };
}

/* ----- ledger view and events ----- */

function viewOf(reader: ReaderExports, ledger: RLedger, cuts: Map<string, RCut>): LedgerView {
  const entries: LedgerEntry[] = ledger.entries.map((e) => {
    const unit = cuts.get(e.path)?.units[e.index];
    const container =
      e.container === 'front_matter_value'
        ? 'front_matter'
        : e.container === 'opaque'
          ? /^\s*(```|~~~)/.test(e.quote)
            ? 'fence'
            : 'comment'
          : e.container;
    const labels: LedgerEntry['labels'] = {};
    for (const [name, label] of Object.entries(e.labels))
      Object.defineProperty(labels, name, {
        value: label,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    return {
      id: e.id,
      path: e.path,
      sectionPath: e.sectionPath,
      container,
      fp: e.fp,
      ctxFp: e.ctxFp,
      quote: e.quote,
      prefix: e.prefix,
      suffix: e.suffix,
      ...(unit && e.status === 'live' ? { hint: { start: unit.start, end: unit.end } } : {}),
      status: e.status,
      labels,
      ...(e.lineage !== undefined ? { lineage: e.lineage } : {}),
      ...(e.twinOf !== undefined ? { twinOf: e.twinOf } : {}),
    };
  });
  return { raw: reader.renderLedger(ledger), entries };
}

/* ----- labelers ----- */

function plantedLabeler(reader: ReaderExports, request: ScanRequest, cuts: Map<string, RCut>): RLabeler {
  const planted = request.labeler;
  return {
    id: 'planted',
    family: 'planted',
    cls: 'system2',
    settings: {},
    model: 'planted',
    maxUnits: (_set, wanted) => wanted,
    render: (set, window) => ({ labeler: 'planted', body: { set: set.set, window } }),
    opinions: (answer, set, window) => reader.denseOpinions(answer, set, window),
    async call(_wire, set, window) {
      if (!planted) throw new reader.LabelerError('no labeller');
      const cutOf = cuts.get(window.path);
      const answer = await planted({
        set: set.set,
        setHash: reader.setHash(set),
        labels: (set.labels as never[]) ?? [],
        window: {
          id: window.id,
          file: window.path,
          path: window.headingPath,
          units: window.units.map((u) => {
            const unit = cutOf?.units[u.index];
            return {
              n: u.n,
              text: u.text,
              container: unit ? bankContainer(unit) : 'sentence',
              path: unit?.path ?? window.headingPath,
              mode: unit?.container === 'opaque' ? ('opaque' as const) : ('label' as const),
            };
          }),
        },
      });
      const labels =
        'raw' in answer
          ? reader.parseDenseAnswer(answer.raw)
          : answer.labels.map((l) => ({
              units: String(l.units),
              label: l.label,
              ...(l.target !== undefined ? { target: l.target } : {}),
            }));
      return { labels, returnedModel: 'planted', stopReason: 'end_turn', usage: { input: 0, output: 0 } };
    },
  };
}

const TEST_ENV: Record<string, string> = {
  ANTHROPIC_API_KEY: 'test-key-not-real',
  JEV_API_KEY: 'test-key-not-real',
  JEV_KEY: 'test-key-not-real',
};

function fetchOf(
  transport: Transport,
): (url: unknown, init?: { headers?: unknown; body?: unknown }) => Promise<Response> {
  return async (url, init) => {
    const headers: Record<string, string> = {};
    const raw = init?.headers;
    if (raw instanceof Headers)
      raw.forEach((v, k) => {
        headers[k] = v;
      });
    else if (Array.isArray(raw)) for (const [k, v] of raw as Array<[string, string]>) headers[k] = v;
    else if (raw && typeof raw === 'object') Object.assign(headers, raw);
    const out = await transport({
      url: String(url),
      headers,
      body: typeof init?.body === 'string' ? init.body : '',
    });
    return new Response(out.body, { status: out.status });
  };
}

/* ----- scan ----- */

async function scan(reader: ReaderExports, request: ScanRequest): Promise<ScanResult> {
  const fail = (error: string): ScanResult => ({
    ok: false,
    error,
    atoms: [],
    diagnostics: [],
  });
  if (request.check && !reader.checkLedger)
    throw new ReaderNotReachable('check mode requires the reader checkLedger export');
  const labelsText = request.labelsYaml ?? reader.AGENT_RULES_SET;
  const parsed = reader.parseLabelSets(labelsText);
  if (!parsed.ok) return fail(parsed.message);
  let previous: RLedger | undefined;
  if (request.previousLedger !== undefined) {
    previous = reader.parseLedger(request.previousLedger);
    if (!previous) return fail('the previous ledger cannot be read');
  }
  const cuts = new Map<string, RCut>();
  for (const file of request.files) cuts.set(file.path, reader.cut(file.text));
  const mode = request.cassette?.mode ?? 'record';
  const cassette = reader.Cassette.parse(request.cassette?.text ?? '');
  let labelling: RLabelling;
  if (request.model) {
    try {
      const built = await reader.buildLabelling(
        [
          {
            cls: request.model.arm === 'haiku' ? 'system2' : 'system1',
            client: request.model.arm === 'haiku' ? 'anthropic' : request.model.arm,
          },
        ],
        {
          record: mode === 'record',
          cwd: '.',
          env: TEST_ENV,
          fetch: fetchOf(request.model.transport),
          ...(request.model.threshold !== undefined ? { threshold: request.model.threshold } : {}),
        },
      );
      if (!built.ok) return fail(built.message);
      labelling = built.labelling;
    } catch (cause) {
      return fail(cause instanceof Error ? cause.message : String(cause));
    }
  } else {
    labelling = reader.singleLabelling(plantedLabeler(reader, request, cuts));
  }
  let result: RResult;
  try {
    result = await reader.pointerScan({
      files: request.files,
      sets: parsed.sets,
      labelling,
      cassette,
      mode,
      ...(previous ? { previous } : {}),
    });
  } catch (cause) {
    return fail(cause instanceof Error ? cause.message : String(cause));
  }
  const view = viewOf(reader, result.ledger, result.cuts);
  if (request.check && reader.checkLedger) {
    const checked = reader.checkLedger(request.previousLedger, result.ledger);
    if (!checked.ok)
      return {
        ...fail(checked.error ?? 'the reader rejected check mode'),
        ledger: view,
        ...(result.warnings !== undefined ? { warnings: result.warnings } : {}),
      };
  }

  const texts = new Map(request.files.map((f: SourceFile) => [f.path, f.text]));
  let atoms: Atom[] = [];
  const diagnostics: Diagnostic[] = [
    ...result.refusals.map((detail) => ({ code: 'refusal', detail })),
    ...result.failed.map((detail) => ({ code: 'failed-window', detail })),
  ];
  try {
    const builder = new reader.AtomBuilder(new Map());
    const made = reader.pointerAtoms(result.labelled, texts, builder, labelling.describe);
    atoms = made.accepted.map(atomOf);
    diagnostics.push(
      ...made.refusals.map((detail) => ({ code: 'atom-refusal', detail })),
      ...made.duplicates.map((detail) => ({ code: 'duplicate', detail })),
    );
  } catch (cause) {
    diagnostics.push({
      code: 'atoms-failed',
      detail: cause instanceof Error ? cause.message : String(cause),
    });
  }
  return {
    ok: true,
    ...(result.warnings !== undefined ? { warnings: result.warnings } : {}),
    ledger: view,
    atoms,
    diagnostics,
    cassette: cassette.render(),
    ...(result.eventsById !== undefined ? { events: result.eventsById } : {}),
    eventCounts: result.events,
    windows: result.windows,
    calls: result.calls,
  };
}

function atomOf(atom: RAtom): Atom {
  const fields = atom.fields ?? {};
  const polarity = typeof fields.polarity === 'string' ? fields.polarity : undefined;
  return {
    kind: atom.kind,
    ...(polarity ? { polarity } : {}),
    file: atom.provenance.file,
    startLine: atom.provenance.startLine,
    endLine: atom.provenance.endLine,
    quote: atom.provenance.quote,
    producedBy: atom.producedBy,
    approved: atom.approved,
    fields: {
      extraction: String(fields.extraction ?? ''),
      unit: String(fields.unit ?? ''),
      labelSet: String(fields.labelSet ?? fields.set ?? ''),
      ...(typeof fields.cassette === 'string' ? { cassette: fields.cassette } : {}),
    },
    evidence: atom.evidence.map((e) => ({
      type: String(e.type),
      name: String(e.name ?? ''),
      ...(typeof e.reviewRequired === 'boolean' ? { reviewRequired: e.reviewRequired } : {}),
    })),
  };
}

/** The real reader as a PointerSut. Layer C is not built in the reader, so `links` is absent. */
export function realReader(): PointerSut {
  return {
    name: 'pointer-reader',
    async cut(file: SourceFile): Promise<CutResult> {
      const reader = await load();
      const out = reader.cut(file.text);
      return { units: out.units.map(toUnit), cutDigest: out.digest };
    },
    scan: async (request) => scan(await load(), request),
    stack: {
      margin: async (probabilities) => stackOf(await load()).margin(probabilities),
      decide: async (request) => stackOf(await load()).decide(request),
    },
  };
}

/** Binds an already loaded reader for seam verification; it does not replace reader behavior. */
export function readerAdapter(reader: ReaderExports): PointerSut {
  return {
    name: 'pointer-reader',
    async cut(file) {
      const out = reader.cut(file.text);
      return { units: out.units.map(toUnit), cutDigest: out.digest };
    },
    scan: (request) => scan(reader, request),
    stack: stackOf(reader),
  };
}

function stackOf(reader: ReaderExports): StackApi {
  return {
    margin(probabilities) {
      if (!reader.margin) throw new ReaderNotReachable('the reader does not expose margin');
      return reader.margin(probabilities);
    },
    decide(request) {
      if (!reader.stackDecision)
        throw new ReaderNotReachable('the reader does not expose the independent-vote stackDecision seam');
      return reader.stackDecision(request);
    },
  };
}
