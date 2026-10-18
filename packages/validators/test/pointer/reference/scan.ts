import { lineOf } from '../../../src/ladders/pointer/kit/compose';
import type {
  Atom,
  Diagnostic,
  LabelRequest,
  LedgerEntry,
  LedgerView,
  ScanRequest,
  ScanResult,
} from '../../../src/ladders/pointer/sut/port';
import { anchorUnits, type NewUnit } from './anchor';
import { cutText, fingerprintText, sha } from './cut';
import { base32Id, canonicalJson } from './hash';
import { LabelSetError, type ParsedSet, parseLabelSets } from './labelset';
import { askModel, Cassette, CassetteError, type ModelCtx, readKey, validateAnswer } from './ports';
import { planWindows, type WindowPlan } from './window';

/** Reference ledgers always record lineage; absence is an invalid reference fixture. */
function lineageOf(entry: LedgerEntry): NonNullable<LedgerEntry['lineage']> {
  if (!entry.lineage) throw new Error(`reference ledger ${entry.id} has no lineage`);
  return entry.lineage;
}

type LedgerFile = { entries: LedgerEntry[]; scan: number; version: number };

const ESTATE_KEY = 'pointer-estate';
const READ_FILE = /(^|\/)\.claude\/(skills\/[^/]+\/SKILL\.md|agents\/[^/]+\.md)$/;

function fail(error: string, extra: Partial<ScanResult> = {}): ScanResult {
  return { ok: false, error, warnings: [], atoms: [], diagnostics: [], ...extra };
}

function liveEntries(entries: readonly LedgerEntry[]): LedgerEntry[] {
  return entries.filter((e) => e.status === 'live');
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function viewOf(raw: string): LedgerView {
  const file = JSON.parse(raw) as LedgerFile;
  return { raw, entries: file.entries };
}

export async function scanEstate(req: ScanRequest): Promise<ScanResult> {
  const warnings: string[] = [];
  const diagnostics: Diagnostic[] = [];
  let sets: ParsedSet[];
  try {
    sets = parseLabelSets(req.labelsYaml);
  } catch (cause) {
    if (cause instanceof LabelSetError) return fail(cause.message);
    throw cause;
  }
  let previous: LedgerFile | undefined;
  if (req.previousLedger !== undefined && req.previousLedger.trim() !== '') {
    try {
      previous = JSON.parse(req.previousLedger) as LedgerFile;
    } catch {
      return fail('the previous ledger is not JSON');
    }
  }
  const prevEntries = previous?.entries ?? [];
  const prevScan = previous?.scan ?? 0;

  // ---- cut
  const files = [...req.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const sources = new Map(files.map((f) => [f.path, f.text]));
  const news: NewUnit[] = [];
  const digests = new Map<string, string>();
  const fileUnits = new Map<string, number[]>();
  for (const file of files) {
    const cut = cutText(file.text);
    digests.set(
      file.path,
      req.cassette?.text?.includes('"readable"')
        ? sha(cut.units.map((u) => `${u.container}:${u.fp.slice(0, 16)}`).join('\n'))
        : cut.cutDigest,
    );
    const globals: number[] = [];
    cut.units.forEach((unit, index) => {
      globals.push(news.length);
      news.push({
        path: file.path,
        index,
        text: unit.text,
        fp: unit.fp,
        start: unit.start,
        end: unit.end,
        container: unit.container,
        sectionPath: unit.path,
        prefix: file.text.slice(Math.max(0, unit.start - 24), unit.start),
        suffix: file.text.slice(unit.end, unit.end + 24),
        ctxFp: '',
        ...(unit.yamlPath ? { yamlPath: unit.yamlPath } : {}),
      });
    });
    fileUnits.set(file.path, globals);
    for (const [at, g] of globals.entries()) {
      const before = news[globals[at - 1] ?? -1]?.fp ?? '';
      const after = news[globals[at + 1] ?? -1]?.fp ?? '';
      (news[g] as NewUnit).ctxFp = sha(`${before}|${after}`);
    }
  }

  // ---- anchor
  const verdict = anchorUnits(liveEntries(prevEntries), news);
  const usedIds = new Set(prevEntries.map((e) => e.id));
  const occurrence = new Map<string, number>();
  const occurrenceOf: number[] = [];
  news.forEach((unit, g) => {
    const k = `${unit.path}|${unit.fp}`;
    const n = occurrence.get(k) ?? 0;
    occurrence.set(k, n + 1);
    occurrenceOf[g] = n;
  });
  const mint = (unit: NewUnit, occ: number): string => {
    let n = occ;
    for (;;) {
      const id = base32Id(`${ESTATE_KEY}|${unit.path}|${unit.fp}|${n}`);
      if (!usedIds.has(id)) {
        usedIds.add(id);
        return id;
      }
      n += 1;
    }
  };

  type Work = { entry: LedgerEntry; base?: LedgerEntry; event: string; g: number };
  const work: Work[] = news.map((unit, g) => {
    const hit = verdict.assigned.get(g);
    const base = hit?.entry;
    const entry: LedgerEntry = {
      id: base ? base.id : mint(unit, occurrenceOf[g] as number),
      path: unit.path,
      sectionPath: unit.sectionPath,
      container: unit.container,
      fp: unit.fp,
      ctxFp: unit.ctxFp,
      quote: unit.text,
      prefix: unit.prefix,
      suffix: unit.suffix,
      hint: { start: unit.start, end: unit.end },
      status: 'live',
      labels: base ? JSON.parse(JSON.stringify(base.labels)) : {},
      lineage: base ? [...lineageOf(base)] : [],
      twinOf: null,
    };
    return { entry, base, event: hit ? hit.event : 'new', g };
  });
  const byG = new Map(work.map((w) => [w.g, w]));

  // ---- labels
  const modelCtx: ModelCtx | undefined = req.model
    ? {
        arm: req.model.arm,
        transport: req.model.transport,
        cassette: new Cassette(req.cassette?.text, req.cassette?.mode ?? 'replay'),
        threshold: req.model.threshold,
        cutDigestOf: (file) => digests.get(file) ?? '',
        warnings,
        keyHeader: readKey(),
      }
    : undefined;
  let windowCount = 0;
  let callCount = 0;
  const cassetteKeyOf = new Map<string, string>();
  const gateTargets = new Map<string, number>();
  const finish = (result: ScanResult): ScanResult => {
    if (modelCtx) result.cassette = modelCtx.cassette.dump();
    result.warnings = warnings;
    return result;
  };
  if (!req.labeler && !req.model) return fail('no labeller was given');
  try {
    for (const set of sets) {
      for (const file of files) {
        const globals = fileUnits.get(file.path) ?? [];
        const dirty = new Set<number>();
        const read = new Set<number>();
        globals.forEach((g, index) => {
          const w = byG.get(g) as Work;
          const unit = news[g] as NewUnit;
          if (unit.container === 'fence' || unit.container === 'comment') return;
          if (READ_FILE.test(file.path) && unit.container === 'front_matter') {
            const head = unit.yamlPath?.[0];
            if (head === 'name' || head === 'description') {
              read.add(index);
              return;
            }
          }
          const base = w.base;
          const carried =
            base !== undefined &&
            base.fp === unit.fp &&
            base.ctxFp === unit.ctxFp &&
            base.labels[set.set]?.setHash === set.hash &&
            w.event !== 'changed' &&
            w.event !== 'split' &&
            w.event !== 'merged';
          if (!carried) dirty.add(index);
        });
        const plans = planWindows(
          file.path,
          globals.map((g) => news[g] as NewUnit),
          dirty,
          read,
        );
        for (const plan of plans) {
          windowCount += 1;
          const outcome = await labelWindow(plan, set, req, modelCtx, () => {
            callCount += 1;
          });
          if ('abort' in outcome) {
            return finish(fail(outcome.abort));
          }
          const labelUnits = plan.units.filter((u) => u.mode === 'label');
          if (outcome.failed) {
            diagnostics.push({
              code: 'window_failed',
              window: plan.id,
              detail: `the window ${plan.id} was refused twice: ${outcome.failed}`,
            });
          }
          for (const u of labelUnits) {
            const g = globals[u.index] as number;
            const w = byG.get(g) as Work;
            const got = outcome.labels?.get(u.n);
            const old = w.base?.labels[set.set];
            if (got) {
              const source = outcome.key ? `cassette:${outcome.key}` : 'labeler:planted';
              Object.defineProperty(w.entry.labels, set.set, {
                value: { label: got.label, source, setHash: set.hash },
                enumerable: true,
                writable: true,
                configurable: true,
              });
              if (outcome.key) cassetteKeyOf.set(`${w.entry.id}|${set.set}`, outcome.key);
              if (got.target !== undefined) {
                const targetUnit = plan.units[got.target - 1];
                if (targetUnit) gateTargets.set(`${w.entry.id}|${set.set}`, targetUnit.index);
              }
              if (old && old.label !== got.label && w.base?.fp === w.entry.fp) {
                diagnostics.push({
                  code: 'label_flip',
                  unit: w.entry.id,
                  window: plan.id,
                  detail: `the label of ${w.entry.id} went from ${old.label} to ${got.label} under ${set.set}`,
                });
              }
            } else {
              delete w.entry.labels[set.set];
              diagnostics.push({
                code: 'unlabeled',
                unit: w.entry.id,
                window: plan.id,
                detail: `the unit ${w.entry.id} has no label under ${set.set}`,
              });
            }
          }
        }
      }
      // drop labels of a set that is no longer declared
    }
  } catch (cause) {
    if (cause instanceof CassetteError) return finish(fail(cause.message));
    throw cause;
  }
  const setNames = new Set(sets.map((s) => s.set));
  for (const w of work) {
    for (const name of Object.keys(w.entry.labels)) if (!setNames.has(name)) delete w.entry.labels[name];
  }

  // ---- twins
  const firstOf = new Map<string, LedgerEntry>();
  for (const w of work) {
    const key = `${w.entry.fp}#${occurrenceOf[w.g]}`;
    const first = firstOf.get(key);
    if (!first) firstOf.set(key, w.entry);
    else if (first.path !== w.entry.path) w.entry.twinOf = first.id;
  }

  // ---- ledger text
  const goneEntries: LedgerEntry[] = verdict.gone.map(({ entry, event }) => ({
    ...entry,
    status: event === 'deleted' ? 'deleted' : event,
    lineage: [...lineageOf(entry)],
  }));
  const eventOf = new Map<string, string>();
  for (const w of work) eventOf.set(w.entry.id, w.event);
  for (const g of goneEntries)
    eventOf.set(g.id, verdict.gone.find((x) => x.entry.id === g.id)?.event ?? 'deleted');
  const untouched = prevEntries.filter((e) => e.status !== 'live');
  const build = (scanNo: number): string => {
    const entries: LedgerEntry[] = [];
    for (const w of work) {
      const e = JSON.parse(JSON.stringify(w.entry)) as LedgerEntry;
      if (w.event !== 'unchanged') lineageOf(e).push({ scan: scanNo, event: w.event });
      entries.push(e);
    }
    for (const g of goneEntries) {
      const e = JSON.parse(JSON.stringify(g)) as LedgerEntry;
      lineageOf(e).push({ scan: scanNo, event: eventOf.get(g.id) ?? 'deleted' });
      entries.push(e);
    }
    entries.push(...untouched);
    const order = (e: LedgerEntry) => (e.status === 'live' ? 0 : 1);
    entries.sort(
      (a, b) =>
        (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) ||
        order(a) - order(b) ||
        (a.hint?.start ?? 0) - (b.hint?.start ?? 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    return canonicalJson({ version: 1, scan: scanNo, entries });
  };
  let raw = build(prevScan);
  if (previous === undefined || raw !== req.previousLedger) raw = build(prevScan + 1);
  if (previous !== undefined && sameJson(JSON.parse(raw).entries, previous.entries))
    raw = canonicalJson(previous);
  const ledger = viewOf(raw);

  if (req.check) {
    if (req.previousLedger === undefined || raw !== req.previousLedger) {
      const oldByPath = new Map<string, string>();
      for (const e of prevEntries)
        oldByPath.set(e.path, `${oldByPath.get(e.path) ?? ''}${e.id}${e.fp}${e.status};`);
      const newByPath = new Map<string, string>();
      for (const e of ledger.entries)
        newByPath.set(e.path, `${newByPath.get(e.path) ?? ''}${e.id}${e.fp}${e.status};`);
      const changed = [...new Set([...oldByPath.keys(), ...newByPath.keys()])]
        .filter((p) => oldByPath.get(p) !== newByPath.get(p))
        .sort();
      return finish(
        fail(`the ledger is stale for ${changed.join(', ') || 'the estate'}; update it`, { diagnostics }),
      );
    }
  }

  // ---- atoms
  const atoms: Atom[] = [];
  for (const entry of ledger.entries) {
    if (entry.status !== 'live') continue;
    const text = sources.get(entry.path) ?? '';
    for (const set of sets) {
      const label = entry.labels[set.set];
      if (!label) continue;
      const def = set.labels.find((l) => l.name === label.label);
      if (!def?.atom) continue;
      let start = entry.hint?.start ?? 0;
      let end = entry.hint?.end ?? start;
      if (def.target === 'required') {
        const target = gateTargets.get(`${entry.id}|${set.set}`);
        const g = fileUnits.get(entry.path)?.[target ?? -1];
        const other = g === undefined ? undefined : news[g];
        if (other) {
          start = Math.min(start, other.start);
          end = Math.max(end, other.end);
        }
      }
      const key = cassetteKeyOf.get(`${entry.id}|${set.set}`);
      atoms.push({
        kind: def.atom.kind,
        ...(def.atom.polarity ? { polarity: def.atom.polarity } : {}),
        file: entry.path,
        startLine: lineOf(text, start),
        endLine: lineOf(text, Math.max(start, end - 1)),
        quote: text.slice(start, end),
        producedBy: 'model',
        approved: false,
        fields: {
          extraction: 'pointer',
          unit: entry.id,
          labelSet: set.set,
          ...(key ? { cassette: key } : {}),
        },
        evidence: [{ type: 'custom', name: 'prose_pointer', reviewRequired: true }],
      });
    }
  }
  const events: Record<string, string> = {};
  const eventCounts: Record<string, number> = {};
  for (const w of work) {
    events[w.entry.id] = w.event;
    eventCounts[w.event] = (eventCounts[w.event] ?? 0) + 1;
  }
  for (const g of verdict.gone) {
    events[g.entry.id] = g.event;
    eventCounts[g.event] = (eventCounts[g.event] ?? 0) + 1;
  }
  return finish({
    ok: true,
    warnings,
    ledger,
    atoms,
    diagnostics,
    events,
    eventCounts,
    windows: windowCount,
    calls: callCount,
  });
}

type Outcome =
  | { abort: string }
  | { labels?: Map<number, { label: string; target?: number }>; key?: string; failed?: string };

async function labelWindow(
  plan: WindowPlan,
  set: ParsedSet,
  req: ScanRequest,
  model: ModelCtx | undefined,
  onCall: () => void,
): Promise<Outcome> {
  let reason = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    onCall();
    if (model) {
      let result: Awaited<ReturnType<typeof askModel>>;
      try {
        result = await askModel(plan, set, model);
      } catch (cause) {
        return { abort: `the model call failed: ${cause instanceof Error ? cause.message : String(cause)}` };
      }
      if (result.kind === 'error') return { abort: result.message };
      if (result.kind === 'refused') {
        reason = result.reason;
        continue;
      }
      const checked = validateAnswer(result.answer, plan, set);
      if (checked.ok) return { labels: checked.labels, key: result.key };
      reason = checked.reason;
      continue;
    }
    const request: LabelRequest = {
      set: set.set,
      setHash: set.hash,
      labels: set.labels,
      window: {
        id: plan.id,
        file: plan.file,
        path: plan.path,
        units: plan.units.map((u) => ({
          n: u.n,
          text: u.text,
          container: u.container,
          path: u.path,
          mode: u.mode,
        })),
      },
    };
    const answer = await (req.labeler as NonNullable<ScanRequest['labeler']>)(request);
    const checked = validateAnswer(answer, plan, set);
    if (checked.ok) return { labels: checked.labels };
    reason = checked.reason;
  }
  return { failed: reason };
}

export { fingerprintText };
