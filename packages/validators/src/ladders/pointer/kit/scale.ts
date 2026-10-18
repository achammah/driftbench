import { rngFor } from '@agent-nexus/driftbench-generate';
import type { LedgerView, Link, PointerSut, ScanResult, SourceFile } from '../sut/port';
import { type Block, compose } from './compose';
import { makeFixture, requireFixtureLabels } from './fixture';
import { perfect, truthLabel } from './labellers';
import { norm } from './norm';
import { RULES_YAML } from './sets';
import { fakeTransport } from './transport';
import { type Rng, rewordWords, sentence } from './words';
import { tag } from './world';

/**
 * Scale workloads, generated and run inside a child process. One unit is a sentence of 60 to 140 characters with a
 * unique tag before its full stop. A workload is a set of files; an edit rewrites some units by a rule that
 * has one right answer for the ladder.
 */

export type ScaleSpec = {
  seed: number;
  files: number;
  perFile: number;
  /** Units per paragraph (1 = a paragraph per unit). */
  edit?: { kind: 'reword' | 'move' | 'rewrite'; share: number };
  /** Share of units that are one of six boilerplate sentences. */
  dupShare?: number;
};

export type ScaleOp =
  | { op: 'cut'; spec: ScaleSpec }
  | { op: 'scan'; spec: ScaleSpec }
  | { op: 'rescan'; spec: ScaleSpec }
  | { op: 'links'; spec: ScaleSpec }
  | { op: 'radius'; spec: ScaleSpec; blocks: number; deletes: number }
  | { op: 'replay'; spec: ScaleSpec }
  | { op: 'long-paragraph'; sentences: number }
  | { op: 'wide-table'; rows: number; cols: number }
  | { op: 'long-units'; units: number; chars: number };

const alien = (rng: Rng, i: number): string => {
  const letters = 'jkqvwxz';
  const word = () =>
    Array.from({ length: 4 + Math.floor(rng() * 3) }, () => letters[Math.floor(rng() * letters.length)]).join(
      '',
    );
  return `${Array.from({ length: 12 }, word)
    .join(' ')
    .replace(/^./, (c) => c.toUpperCase())} ${tag(i)}.`;
};

export type Estate = {
  before: SourceFile[];
  after: SourceFile[];
  texts: string[][];
  edits: Array<{ kind: 'reword' | 'move' | 'rewrite'; from: string; to?: string; toFile?: number }>;
};

const BOILER = [
  'Close the shutters before the last bell rings.',
  'Keep the till drawer shut between customers.',
  'Label every crate before it leaves the dock.',
  'Return each key to the board at night.',
  'Record the temperature of the cold room twice.',
  'Sweep the front step before the doors open.',
];

export function makeEstate(spec: ScaleSpec): Estate {
  const rng = rngFor(spec.seed, 'scale');
  let n = 0;
  const texts: string[][] = [];
  for (let f = 0; f < spec.files; f += 1) {
    const ts: string[] = [];
    for (let i = 0; i < spec.perFile; i += 1) {
      const dup = spec.dupShare !== undefined && rng() < spec.dupShare;
      const raw = dup
        ? (BOILER[Math.floor(rng() * BOILER.length)] as string)
        : sentence(rng).replace(/\.$/, ` ${tag(n)}.`);
      ts.push(dup ? raw : raw);
      n += 1;
    }
    texts.push(ts);
  }
  const next = texts.map((t) => [...t]);
  const edits: Estate['edits'] = [];
  if (spec.edit) {
    const every = Math.max(1, Math.round(1 / spec.edit.share));
    let k = 0;
    for (let f = 0; f < spec.files; f += 1) {
      for (let i = 0; i < spec.perFile; i += 1) {
        const text = texts[f]?.[i] as string;
        if (BOILER.includes(text) || (f * spec.perFile + i) % every !== 0 || i === 0) continue;
        k += 1;
        if (spec.edit.kind === 'reword') {
          const to = rewordWords(rng, text, 1);
          if (to === text) continue;
          next[f]![i] = to;
          edits.push({ kind: 'reword', from: text, to });
        } else if (spec.edit.kind === 'rewrite') {
          const to = alien(rng, 900_000 + k);
          next[f]![i] = to;
          edits.push({ kind: 'rewrite', from: text, to });
        } else if (spec.files > 1) {
          next[f]![i] = '';
          const toFile = (f + 1) % spec.files;
          next[toFile]?.push(text);
          edits.push({ kind: 'move', from: text, toFile });
        }
      }
    }
  }
  const render = (ts: string[][]): SourceFile[] =>
    ts.map((list, f) => ({
      path: `notes/${String(f).padStart(5, '0')}.md`,
      text: compose([
        { kind: 'heading', level: 1, text: `Notes number ${tag(f)}` },
        ...list.filter((t) => t !== '').map((t): Block => ({ kind: 'paragraph', sentences: [t] })),
      ]).text,
    }));
  return { before: render(texts), after: render(next), texts, edits };
}

const slim = (ledger: LedgerView) =>
  ledger.entries.map((e) => [e.id, e.status, e.quote] as [string, string, string]);

export type ScaleOut = {
  ms: number[];
  maxRssKb: number;
  units: number;
  live: number[];
  calls: number[];
  slims: Array<Array<[string, string, string]>>;
  extra: Record<string, unknown>;
  problems: string[];
};

const rss = () => process.resourceUsage().maxRSS;

async function timed<T>(work: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t = performance.now();
  const value = await work();
  return { value, ms: performance.now() - t };
}

function countCalls(labeler: ReturnType<typeof perfect>): {
  labeler: ReturnType<typeof perfect>;
  calls: () => number;
} {
  let n = 0;
  return {
    labeler: (r) => {
      n += 1;
      return labeler(r);
    },
    calls: () => n,
  };
}

const ok = (r: ScanResult, what: string): LedgerView => {
  if (!r.ok || !r.ledger) throw new Error(`${what} failed: ${r.error ?? 'no ledger'}`);
  return r.ledger;
};

export async function runScaleOp(job: ScaleOp, sut: PointerSut): Promise<ScaleOut> {
  const out: ScaleOut = {
    ms: [],
    maxRssKb: 0,
    units: 0,
    live: [],
    calls: [],
    slims: [],
    extra: {},
    problems: [],
  };
  if (job.op === 'long-paragraph') {
    const rng = rngFor(1, 'long-paragraph');
    const sentences = Array.from({ length: job.sentences }, (_, i) =>
      sentence(rng).replace(/\.$/, ` ${tag(i)}.`),
    );
    const doc = compose([{ kind: 'paragraph', sentences }]);
    const { value, ms } = await timed(() => sut.cut({ path: 'long.md', text: doc.text }));
    out.ms.push(ms);
    out.units = value.units.length;
    out.extra = {
      expected: sentences.length,
      textLength: doc.text.length,
      exact: value.units.every((u, i) => u.text === sentences[i]),
    };
  } else if (job.op === 'wide-table') {
    const rng = rngFor(1, 'wide-table');
    const header = Array.from({ length: job.cols }, (_, c) => `col${tag(c)}`);
    const rows = Array.from({ length: job.rows }, (_, r) =>
      Array.from({ length: job.cols }, (_, c) => `${sentence(rng).slice(0, 20)} ${tag(r * job.cols + c)}`),
    );
    const doc = compose([{ kind: 'table', header, rows }]);
    const { value, ms } = await timed(() => sut.cut({ path: 'wide.md', text: doc.text }));
    out.ms.push(ms);
    out.units = value.units.length;
    out.extra = { expected: (job.rows + 1) * job.cols };
  } else if (job.op === 'long-units') {
    const rng = rngFor(1, 'long-units');
    const make = (i: number) => {
      const parts: string[] = [];
      let len = 0;
      while (len < job.chars) {
        const s = sentence(rng).replace(/\.$/, '');
        parts.push(len === 0 ? s : s.charAt(0).toLowerCase() + s.slice(1));
        len += s.length + 6;
      }
      return `${parts.join(', and ')} ${tag(i)}.`;
    };
    const texts = Array.from({ length: job.units }, (_, i) => make(i));
    const doc = compose(texts.map((t): Block => ({ kind: 'paragraph', sentences: [t] })));
    const { value, ms } = await timed(() => sut.cut({ path: 'units.md', text: doc.text }));
    out.ms.push(ms);
    out.units = value.units.length;
    out.extra = { expected: job.units, exact: value.units.every((u, i) => u.text === texts[i]) };
  } else {
    const estate = makeEstate(job.spec);
    out.units = estate.texts.flat().length;
    if (job.op === 'cut') {
      let total = 0;
      let exact = true;
      const t = performance.now();
      for (const file of estate.before) {
        const cut = await sut.cut(file);
        total += cut.units.length;
        if (cut.units.length < 2 || !cut.units[1]?.text.includes('.')) exact = false;
      }
      out.ms.push(performance.now() - t);
      out.extra = { total, expected: out.units + job.spec.files, exact };
    } else if (job.op === 'scan' || job.op === 'rescan') {
      const first = countCalls(perfect());
      const a = await timed(() => sut.scan({ files: estate.before, labeler: first.labeler }));
      const ledger1 = ok(a.value, 'the first scan');
      out.ms.push(a.ms);
      out.calls.push(first.calls());
      out.live.push(ledger1.entries.filter((e) => e.status === 'live').length);
      if (job.op === 'scan') {
        let bad = 0;
        ledger1.entries.forEach((e, i) => {
          if (
            i % 97 === 0 &&
            e.container !== 'heading' &&
            e.labels['agent-rules']?.label !== truthLabel(e.quote)
          )
            bad += 1;
        });
        out.extra = {
          badLabels: bad,
          atoms: a.value.atoms.length,
          windows: a.value.windows,
          expectedLive: out.units + job.spec.files,
        };
      } else {
        out.slims.push(slim(ledger1));
        const second = countCalls(perfect());
        const b = await timed(() =>
          sut.scan({ files: estate.after, previousLedger: ledger1.raw, labeler: second.labeler }),
        );
        const ledger2 = ok(b.value, 'the rescan');
        out.ms.push(b.ms);
        out.calls.push(second.calls());
        out.live.push(ledger2.entries.filter((e) => e.status === 'live').length);
        out.slims.push(slim(ledger2));
        out.extra = {
          expectedLive: out.units + job.spec.files,
          edits: estate.edits,
          sameBytes: ledger1.raw === ledger2.raw,
          eventCounts: b.value.eventCounts,
          windows: b.value.windows,
        };
      }
    } else if (job.op === 'replay') {
      const fake = fakeTransport();
      const rec = await sut.scan({
        files: estate.before,
        model: { arm: 'haiku', transport: fake },
        cassette: { mode: 'record' },
      });
      const ledger1 = ok(rec, 'the record run');
      const fixture = makeFixture(
        'haiku',
        estate.before.map((file, index) => ({
          path: file.path,
          text: file.text,
          units: [
            {
              text: `# Notes number ${tag(index)}`,
              container: 'heading',
              path: [],
              label: truthLabel(`# Notes number ${tag(index)}`),
            },
            ...(estate.texts[index] ?? []).map((text) => ({
              text,
              path: [`Notes number ${tag(index)}`],
              label: truthLabel(text),
            })),
          ],
        })),
        RULES_YAML,
      );
      requireFixtureLabels(rec, fixture);
      const closed = fakeTransport({ respond: () => ({ status: 500, body: 'closed' }) });
      const firstReplay = await sut.scan({
        files: fixture.files,
        labelsYaml: fixture.labelsYaml,
        model: { arm: 'haiku', transport: closed },
        cassette: { mode: 'replay', text: fixture.cassette },
      });
      requireFixtureLabels(firstReplay, fixture);
      const { value, ms } = await timed(() =>
        sut.scan({
          files: fixture.files,
          labelsYaml: fixture.labelsYaml,
          model: { arm: 'haiku', transport: closed },
          cassette: { mode: 'replay', text: fixture.cassette },
        }),
      );
      requireFixtureLabels(value, fixture);
      out.ms.push(ms);
      out.live.push(ledger1.entries.filter((entry) => entry.status === 'live').length);
      out.live.push(value.ledger?.entries.filter((entry) => entry.status === 'live').length ?? 0);
      out.extra = {
        expectedLive: out.units + job.spec.files,
        calls: closed.count,
        same: value.ok && value.ledger?.raw === firstReplay.ledger?.raw,
        error: value.error,
        entries: (rec.cassette ?? '').split('\n').filter(Boolean).length,
      };
    } else if (job.op === 'links' || job.op === 'radius') {
      const api = sut.links;
      if (!api) throw new Error('the binding offers no links api');
      const scan1 = await sut.scan({
        files: estate.before,
        labeler: (await import('./labellers')).constant('rule'),
      });
      const ledger1 = ok(scan1, 'the first scan');
      const ids = new Map(
        ledger1.entries.filter((e) => e.container !== 'heading').map((e) => [norm(e.quote), e.id]),
      );
      const links: Link[] = [];
      const ownersOf = new Map<string, string[]>();
      const rng = rngFor(job.spec.seed, 'links');
      const units = estate.texts.flat();
      const blocks = job.op === 'radius' ? job.blocks : units.length;
      for (let b = 0; b < blocks; b += 1) {
        const owner = `b${b}`;
        const picks =
          job.op === 'radius' ? [Math.floor(rng() * units.length), Math.floor(rng() * units.length)] : [b];
        for (const pi of picks) {
          const t = units[pi] as string;
          links.push(api.create(ledger1, owner, ids.get(norm(t)) as string, 'verifies', 'verified'));
          ownersOf.set(t, [...(ownersOf.get(t) ?? []), owner]);
        }
      }
      const changed: string[] = [];
      let files = estate.before;
      if (job.op === 'radius') {
        const next = estate.texts.map((t) => [...t]);
        for (let d = 0; d < job.deletes; d += 1) {
          const f = (d * 7) % job.spec.files;
          const i = 1 + ((d * 13) % (job.spec.perFile - 1));
          if (next[f]?.[i]) {
            changed.push(next[f]?.[i] as string);
            next[f]![i] = '';
          }
        }
        files = next.map((list, f) => ({
          path: `notes/${String(f).padStart(5, '0')}.md`,
          text: compose([
            { kind: 'heading', level: 1, text: `Notes number ${tag(f)}` },
            ...list.filter((t) => t !== '').map((t): Block => ({ kind: 'paragraph', sentences: [t] })),
          ]).text,
        }));
      } else {
        files = estate.after;
        for (const e of estate.edits) changed.push(e.from);
      }
      const scan2 = await sut.scan({
        files,
        previousLedger: ledger1.raw,
        labeler: (await import('./labellers')).constant('rule'),
      });
      const ledger2 = ok(scan2, 'the rescan');
      if (job.op === 'links') {
        const { value, ms } = await timed(async () => api.classify(ledger1, ledger2, links));
        out.ms.push(ms);
        const owner = links.map((l) => l.owner);
        const suspect = value.reduce((s, x) => s + (x === 'suspect' ? 1 : 0), 0);
        const wrong = value.filter(
          (x, i) => x === 'suspect' && !changed.includes(units[Number(owner[i]?.slice(1))] as string),
        ).length;
        out.extra = { suspect, expectedSuspect: changed.length, wrong };
      } else {
        const { value, ms } = await timed(async () => api.blast(ledger1, ledger2, links));
        out.ms.push(ms);
        const want = [...new Set(changed.flatMap((t) => ownersOf.get(t) ?? []))].sort();
        out.extra = {
          same: JSON.stringify(value.rerun) === JSON.stringify(want),
          got: value.rerun.length,
          want: want.length,
        };
      }
    }
  }
  out.maxRssKb = rss();
  return out;
}
