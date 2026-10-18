import { distinctSentences } from '../../kit/anchor-world';
import { type Block, compose } from '../../kit/compose';
import { build, byId, liveByText, liveOf, scanOk } from '../../kit/estate';
import { makeFixture, requireFixtureLabels } from '../../kit/fixture';
import {
  constant,
  entriesFor,
  keyedOnHeading,
  keyedOnLength,
  perfect,
  type Recording,
  randomLabeler,
  recording,
  truthLabel,
} from '../../kit/labellers';
import { squash } from '../../kit/norm';
import { show } from '../../kit/oracle';
import { requireSourceWitness } from '../../kit/positive';
import { buildScript, filesOfSegments } from '../../kit/segments';
import {
  FIVE_YAML,
  keyOf,
  labelByText,
  PROBE_YAML,
  RULES_YAML,
  TWO_SETS_YAML,
  VOICE_YAML,
} from '../../kit/sets';
import { type FakeTransport, fakeTransport, TOO_LARGE } from '../../kit/transport';
import { headingText, longMake, Prose, rewordWords, sentence } from '../../kit/words';
import { bigDoc } from '../../kit/world';
import type {
  LabelAnswer,
  Labeler,
  LabelRequest,
  LedgerView,
  ModelArm,
  ScanRequest,
  ScanResult,
  SourceFile,
} from '../../sut/port';
import { fail, type ItemContext, type Outcome, pass, type Run } from '../types';
import { validateSetCases, validationRuns } from './labelset-validation';
import { stackRuns } from './stack';

const prose = (ctx: ItemContext) => new Prose(ctx.seed, ctx.id);
const para = (text: string): Block => ({ kind: 'paragraph', sentences: [text] });
const docOf = (texts: string[]): SourceFile[] => [{ path: 'doc.md', text: compose(texts.map(para)).text }];
const label = (ledger: LedgerView, text: string, set = 'agent-rules') =>
  liveByText(ledger, text)?.labels[set]?.label;

/** A labeller that gives `bad` the first time it is asked, then answers the truth. */
function invalidThen(bad: (request: LabelRequest) => LabelAnswer, good: Labeler = perfect()): Recording {
  let n = 0;
  return recording((request) => {
    n += 1;
    return n === 1 ? bad(request) : good(request);
  });
}

/** The 1-based window number of the first selectable unit satisfying `pick`. */
const firstN = (request: LabelRequest, pick: (u: LabelRequest['window']['units'][number]) => boolean) =>
  request.window.units.find(pick)?.n ?? 1;

async function refusalCase(
  ctx: ItemContext,
  bad: (r: LabelRequest) => LabelAnswer,
  options: { yaml?: string; texts?: string[] } = {},
): Promise<Outcome> {
  const texts = options.texts ?? distinctSentences(prose(ctx), 20);
  const labeler = invalidThen(bad);
  const res = await scanOk(ctx.sut, {
    files: docOf(texts),
    labeler,
    ...(options.yaml ? { labelsYaml: options.yaml } : {}),
  });
  if (labeler.calls.length !== 2)
    return fail(`${labeler.calls.length} calls for one window with one refused answer, expected 2`);
  for (const t of texts) {
    const got = label(res.ledger, t);
    if (got !== truthLabel(t))
      return fail(`${show(t, 36)} has label ${got}, the valid second answer gave ${truthLabel(t)}`);
  }
  return pass('refused once, the second answer applied');
}

/** Record a model-port scan on the fake transport and return everything the item reads. */
async function modelScan(
  ctx: ItemContext,
  files: SourceFile[],
  arm: ModelArm,
  transport: FakeTransport,
  extra: Partial<ScanRequest> = {},
  threshold?: number,
) {
  const res = await ctx.sut.scan({
    files,
    model: { arm, transport, ...(threshold !== undefined ? { threshold } : {}) },
    cassette: { mode: 'record' },
    ...extra,
  });
  return res;
}
const must = (res: ScanResult): ScanResult & { ledger: LedgerView } => {
  if (!res.ok || !res.ledger)
    throw new (class extends Error {})(`the scan failed: ${res.error ?? 'no ledger'}`);
  return res as ScanResult & { ledger: LedgerView };
};
const bodyText = (call: { body: string }): string => {
  const strings: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') strings.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  try {
    const b = JSON.parse(call.body) as Record<string, unknown>;
    walk([b.system, b.messages, b.state, b.questions, b.input, b.prompt]);
  } catch {
    strings.push(call.body);
  }
  return strings.join('\n');
};
/** Wraps the labels of a set into a labels file: the VOICE sets alone. */
const VOICE_ONLY = `labels:\n${VOICE_YAML}`;

/* ---------------- Jev helpers ---------------- */

type Probs = Record<string, number>;
const jevProbs = (table: Map<string, Probs>, fallback: Probs) => (text: string, name: string) =>
  (table.get(text) ?? fallback)[name] ?? 0.05;

async function jevLabels(
  ctx: ItemContext,
  arm: ModelArm,
  units: Array<{ text: string; probs: Probs }>,
  threshold?: number,
  yaml = PROBE_YAML,
) {
  const table = new Map(units.map((u) => [u.text, u.probs]));
  const fake = fakeTransport({ probability: (text, name) => jevProbs(table, {})(text, name) });
  const res = must(
    await modelScan(ctx, docOf(units.map((u) => u.text)), arm, fake, { labelsYaml: yaml }, threshold),
  );
  return { res, fake };
}

const expectedJev = (probs: Probs, names: string[], threshold: number): string => {
  let best: { name: string; p: number } | undefined;
  for (const n of names) {
    const p = probs[n] ?? 0.05;
    if (!best || p > best.p) best = { name: n, p };
  }
  return best && best.p > threshold ? best.name : 'none';
};

const NAMES = ['rule', 'prohibition', 'example'];

function probsAround(i: number, level: number, step: number): Probs {
  const top = NAMES[i % 3] as string;
  const second = NAMES[(i + 1) % 3] as string;
  const p: Probs = { rule: 0.05, prohibition: 0.05, example: 0.05 };
  p[top] = i % 2 === 0 ? level + step : level - step;
  if (i % 4 === 3) p[second] = (p[top] as number) - 0.1;
  return p;
}

const rewordOf = (_ctx: ItemContext, p: Prose, t: string) => rewordWords(p.random, t, 1);

export const labelsRuns: Record<string, Run> = {
  ...stackRuns,
  ...validationRuns,
  'perfect-labels-recovered': async (ctx) => {
    const p = prose(ctx);
    const texts = distinctSentences(p, 60);
    const res = await scanOk(ctx.sut, { files: docOf(texts), labeler: perfect() });
    for (const t of texts)
      if (label(res.ledger, t) !== truthLabel(t))
        return fail(`${show(t, 36)} has label ${label(res.ledger, t)}, planted ${truthLabel(t)}`);
    return pass('60 labels recovered');
  },
  'perfect-atoms-exact': async (ctx) => {
    const texts = distinctSentences(prose(ctx), 60);
    const res = await scanOk(ctx.sut, { files: docOf(texts), labeler: perfect() });
    const want = texts.filter((t) => ['rule', 'prohibition'].includes(truthLabel(t)));
    const got = new Map(res.atoms.map((a) => [keyOf(a.quote), a]));
    if (res.atoms.length !== want.length)
      return fail(`${res.atoms.length} atoms for ${want.length} planted rules`);
    for (const t of want) {
      const a = got.get(keyOf(t));
      if (!a) return fail(`no atom for ${show(t, 40)}`);
      const pol = truthLabel(t) === 'rule' ? 'obligation' : 'prohibition';
      if (a.kind !== 'instruction' || a.polarity !== pol)
        return fail(`the atom of ${show(t, 30)} is ${a.kind}/${a.polarity}, planted instruction/${pol}`);
    }
    return pass(`${want.length} atoms, exact`);
  },
  'heading-keyed-labeller': async (ctx) => {
    const p = prose(ctx);
    const [r1, r2, n1, n2] = [p.many(3), p.many(3), p.many(3), p.many(3)];
    const blocks: Block[] = [
      { kind: 'heading', level: 1, text: 'Handbook' },
      { kind: 'heading', level: 2, text: 'Rules' },
      { kind: 'paragraph', sentences: r1 },
      { kind: 'heading', level: 3, text: 'Sub rules' },
      { kind: 'paragraph', sentences: r2 },
      { kind: 'heading', level: 2, text: 'Notes' },
      { kind: 'paragraph', sentences: n1 },
      { kind: 'heading', level: 3, text: 'Sub notes' },
      { kind: 'paragraph', sentences: n2 },
    ];
    const doc = compose(blocks);
    const labeler = recording(keyedOnHeading('Rules'));
    const res = await scanOk(ctx.sut, { files: [{ path: 'doc.md', text: doc.text }], labeler });
    for (const u of doc.units.filter((x) => x.container === 'sentence')) {
      const shown = labeler.calls.flatMap((c) => c.window.units).find((x) => keyOf(x.text) === keyOf(u.text));
      if (!shown) return fail(`${show(u.text, 36)} was never shown to the labeller`);
      if (JSON.stringify(shown.path) !== JSON.stringify(u.path))
        return fail(
          `${show(u.text, 36)} was shown with heading path ${JSON.stringify(shown.path)}, truth ${JSON.stringify(u.path)}`,
        );
      const want = u.path.includes('Rules') ? 'rule' : 'none';
      if (label(res.ledger, u.text) !== want)
        return fail(`${show(u.text, 36)} has label ${label(res.ledger, u.text)}, planted ${want}`);
    }
    return pass('paths shown, labels follow them');
  },
  'length-keyed-labeller': async (ctx) => {
    const p = prose(ctx);
    const texts = [...p.many(10), ...p.many(10, longMake)];
    const labeler = recording(keyedOnLength(110));
    const res = await scanOk(ctx.sut, { files: docOf(texts), labeler });
    for (const t of texts) {
      const shown = labeler.calls.flatMap((c) => c.window.units).find((x) => keyOf(x.text) === keyOf(t));
      if (!shown) return fail(`${show(t, 36)} was never shown`);
      if (squash(shown.text) !== squash(t))
        return fail(`the shown text ${show(shown.text, 36)} is not the unit text`);
      const want = t.length > 110 ? 'description' : 'rule';
      if (label(res.ledger, t) !== want)
        return fail(`${show(t, 36)} has label ${label(res.ledger, t)}, planted ${want}`);
    }
    return pass('true text shown, labels follow it');
  },
  'none-labeller': async (ctx) => {
    const texts = distinctSentences(prose(ctx), 20);
    const res = await scanOk(ctx.sut, {
      files: docOf(texts),
      labeler: constant('none'),
    });
    if (!texts.every((text) => label(res.ledger, text) === 'none'))
      return fail('positive witness: each planted sentence must retain its none label');
    if (res.atoms.length !== 0) return fail(`${res.atoms.length} atoms from a labeller that said none`);
    const bad = res.diagnostics.filter((d) => d.code === 'unlabeled' || /fail/.test(d.code));
    return bad.length === 0
      ? pass('no atom, no diagnostic')
      : fail(`${bad.length} diagnostics for a valid all-none answer: ${bad[0]?.code}`);
  },
  'unlabeled-gap-listed': async (ctx) => {
    const texts = distinctSentences(prose(ctx), 20);
    const omit = new Set([7, 9]);
    const labeler: Labeler = (req) => ({
      labels: entriesFor(req, (u) => (omit.has(u.n) ? undefined : truthLabel(u.text))),
    });
    const res = await scanOk(ctx.sut, { files: docOf(texts), labeler });
    const gaps = res.diagnostics.filter((d) => d.code === 'unlabeled');
    const ids = new Set(gaps.map((d) => d.unit));
    const want = [texts[6], texts[8]].map((t) => liveByText(res.ledger, t as string)?.id);
    if (gaps.length !== 2 || !want.every((id) => id && ids.has(id)))
      return fail(
        `${gaps.length} unlabeled diagnostics naming ${JSON.stringify([...ids])}, expected the units ${JSON.stringify(want)}`,
      );
    for (const [i, t] of texts.entries()) {
      const got = label(res.ledger, t);
      if (omit.has(i + 1) ? got !== undefined : got !== truthLabel(t))
        return fail(`${show(t, 36)} has label ${got}`);
    }
    return pass('the two gaps listed, 18 labelled');
  },
  'label-on-every-container': async (ctx) => {
    const p = prose(ctx);
    const [a, b, c, d, e] = p.many(5);
    const doc = compose([
      { kind: 'front', entries: [{ key: 'description', value: e as string }] },
      { kind: 'heading', level: 1, text: 'Every container' },
      para(a as string),
      { kind: 'list', items: [{ text: b as string }] },
      { kind: 'table', header: ['one', 'two'], rows: [[c as string, 'plain']] },
      { kind: 'quote', paragraphs: [d as string] },
    ]);
    const res = await scanOk(ctx.sut, {
      files: [{ path: 'doc.md', text: doc.text }],
      labeler: constant('rule'),
    });
    const texts = [a, b, c, d, e, 'Every container'] as string[];
    for (const t of texts)
      if (label(res.ledger, t) !== 'rule')
        return fail(`${show(t, 36)} has label ${label(res.ledger, t)}, expected rule`);
    const atoms = texts.filter((t) => res.atoms.some((x) => keyOf(x.quote) === keyOf(t)));
    return atoms.length === texts.length
      ? pass('six containers labelled, six atoms')
      : fail(`${atoms.length} of ${texts.length} labelled units built an atom`);
  },
  'window-one-per-file-and-set': async (ctx) => {
    const p = prose(ctx);
    const files = ['a.md', 'b.md', 'c.md'].map((path) => ({
      path,
      text: compose([{ kind: 'heading', level: 1, text: headingText(p.random) }, ...p.many(6).map(para)])
        .text,
    }));
    const labeler = recording(perfect());
    await scanOk(ctx.sut, { files, labeler, labelsYaml: TWO_SETS_YAML });
    if (labeler.calls.length !== 6)
      return fail(`${labeler.calls.length} calls for 3 files and 2 sets, expected 6`);
    const pairs = new Set(labeler.calls.map((c) => `${c.window.file}|${c.set}`));
    if (pairs.size !== 6) return fail('the calls do not cover each (file, set) pair once');
    const bad = labeler.calls.find((c) => c.window.units.filter((u) => u.mode === 'label').length !== 7);
    return bad
      ? fail(
          `a request for ${bad.window.file} lists ${bad.window.units.filter((u) => u.mode === 'label').length} labelable units, expected 7`,
        )
      : pass('six requests');
  },
  'window-split-at-headings': async (ctx) => {
    const rng = prose(ctx).random;
    const big = bigDoc(rng, 30, 900_000, sentence);
    const text = compose(big.blocks).text;
    const labeler = recording((req) => ({ labels: entriesFor(req, () => 'none', true) }));
    await scanOk(ctx.sut, { files: [{ path: 'big.md', text }], labeler });
    const n = labeler.calls.length;
    if (n < 2 || n > 12)
      return fail(`${n} windows for a file of ${text.length} characters, expected 2 to 12`);
    const seen = new Set<string>();
    let total = 0;
    for (const c of labeler.calls) {
      const first = c.window.units[0];
      if (first?.container !== 'heading')
        return fail(`the window ${c.window.id} does not start at a heading`);
      const chars = c.window.units.reduce((s, u) => s + u.text.length, 0);
      if (chars > 420_000) return fail(`the window ${c.window.id} holds ${chars} characters of units`);
      for (const u of c.window.units.filter((x) => x.mode === 'label')) {
        if (seen.has(u.text)) return fail(`a unit is labelable in two windows: ${show(u.text, 40)}`);
        seen.add(u.text);
        total += 1;
      }
    }
    const want = big.texts.length + big.headings.length;
    return total === want
      ? pass(`${n} windows, ${total} units`)
      : fail(`${total} labelable units in the windows, the file has ${want}`);
  },
  'prompt-set-lines': async (ctx) => {
    const texts = distinctSentences(prose(ctx), 8);
    const fake = fakeTransport();
    const res = must(await modelScan(ctx, docOf(texts), 'haiku', fake, { labelsYaml: VOICE_ONLY }));
    void res;
    const text = fake.calls.map((c) => bodyText(c)).join('\n');
    const need = [
      'house-voice',
      'How a style guide for a bakery',
      'voice-rule',
      'A unit that fixes a tone or a word choice for customer emails.',
      'claim-needs-source',
      'legal-line',
      'Write as if you were speaking over the counter.',
      "Say 'loaf', never 'unit'.",
      'Allergen details are on the label.',
    ];
    const missing = need.filter((x) => !text.includes(x));
    return missing.length === 0
      ? pass('set, labels and examples in the request')
      : fail(`the request lacks ${JSON.stringify(missing)}`);
  },
  'prompt-generic-template': async (ctx) => {
    const texts = distinctSentences(prose(ctx), 8);
    // Equal-shape sets vary only caller-owned data, never a blacklist of words.
    const sets = [
      ['alpha-set', 'Alpha description.', 'alpha-label', 'Alpha meaning.', 'alpha-example'],
      ['omega-set', 'Omega description.', 'omega-label', 'Omega meaning.', 'omega-example'],
    ];
    const signatures: string[] = [];
    for (const fields of sets) {
      const [name, description, labelName, meaning, example] = fields;
      const labelsYaml = `labels:\n  - set: ${name}\n    description: ${description}\n    labels:\n      - name: ${labelName}\n        description: ${meaning}\n        examples: [${example}]\n`;
      const fake = fakeTransport();
      const res = must(await modelScan(ctx, docOf(texts), 'haiku', fake, { labelsYaml }));
      requireSourceWitness(res, docOf(texts));
      if (fake.calls.length !== 1 || fake.calls[0]?.set !== name)
        return fail('positive witness: expected one request for the declared set');
      let signature = bodyText(fake.calls[0] as NonNullable<(typeof fake.calls)[0]>);
      for (const [index, field] of fields.entries())
        signature = signature.split(field).join(`<set-field-${index}>`);
      signatures.push(signature);
    }
    return signatures[0] === signatures[1]
      ? pass('same template after substituting caller-owned set data')
      : fail('the request template changes with the set beyond its declared data');
  },
  'prompt-examples-max-three': async (ctx) => {
    const yaml = `labels:
  - set: many
    description: A set with many examples.
    labels:
      - name: voice
        description: A unit with a voice.
        examples:
          - "Example one is here."
          - "Example two is here."
          - "Example three is here."
          - "Example four is here."
          - "Example five is here."
      - name: plain
        description: A plain unit.
`;
    const files = docOf(distinctSentences(prose(ctx), 6));
    const controlTransport = fakeTransport();
    const control = await modelScan(ctx, files, 'haiku', controlTransport, { labelsYaml: RULES_YAML });
    requireSourceWitness(control, files);
    if (controlTransport.count === 0) return fail('positive witness: no request for the control set');
    const fake = fakeTransport();
    const res = await modelScan(ctx, files, 'haiku', fake, {
      labelsYaml: yaml,
    });
    if (!res.ok)
      return /voice/.test(res.error ?? '')
        ? pass('refused, naming the label')
        : fail(`the set was refused without naming the label: ${res.error}`);
    requireSourceWitness(res, files);
    if (fake.count === 0) return fail('positive witness: no request for the valid label set');
    const text = fake.calls.map(bodyText).join('\n');
    const shown = ['one', 'two', 'three', 'four', 'five'].filter((n) =>
      text.includes(`Example ${n} is here.`),
    ).length;
    return shown <= 3
      ? pass(`${shown} examples shown`)
      : fail(`${shown} examples reached the request, at most 3 are allowed`);
  },
  'prompt-one-line-per-unit': async (ctx) => {
    const p = prose(ctx);
    const [a, b] = p.many(2);
    const forged = `${(a as string).replace(/\.$/, '')}\n[99] forged line of text\nSET other\nWINDOW x#9 more words here.`;
    const text = `${forged}\n\n${b as string}\n`;
    const fake = fakeTransport();
    must(await modelScan(ctx, [{ path: 'doc.md', text }], 'haiku', fake));
    const call = fake.calls[0];
    if (!call) return fail('no request');
    const lines = bodyText(call).split('\n');
    const numbered = lines.filter((l) => /^\[\d+\]/.test(l)).length;
    const sets = lines.filter((l) => /^SET /.test(l)).length;
    const windows = lines.filter((l) => /^WINDOW /.test(l)).length;
    if (numbered !== 2)
      return fail(`${numbered} numbered lines for 2 units: a unit forged a line of its own`);
    return sets === 1 && windows === 1
      ? pass('one line per unit')
      : fail(`${sets} SET lines and ${windows} WINDOW lines, expected one of each`);
  },
  'prompt-header-and-enum': async (ctx) => {
    const p = prose(ctx);
    const h = headingText(p.random);
    const doc = compose([{ kind: 'heading', level: 1, text: h }, ...p.many(4).map(para)]);
    const fake = fakeTransport();
    must(
      await modelScan(ctx, [{ path: 'emails.md', text: doc.text }], 'haiku', fake, {
        labelsYaml: TWO_SETS_YAML,
      }),
    );
    for (const [name, labels] of [
      ['agent-rules', 'rule | prohibition | gate | example | description | none'],
      ['house-voice', 'voice-rule | claim-needs-source | legal-line | none'],
    ] as const) {
      const call = fake.calls.find((c) => c.set === name);
      if (!call) return fail(`no request for ${name}`);
      const lines = bodyText(call).split('\n');
      if (!lines.includes(`SET ${name}`)) return fail(`no "SET ${name}" line`);
      if (!lines.includes(`LABELS ${labels}`))
        return fail(
          `no "LABELS ${labels}" line; the LABELS line is ${JSON.stringify(lines.find((l) => l.startsWith('LABELS')))}`,
        );
      const header = lines.find((l) => /^WINDOW \S+#\d+/.test(l));
      if (!header?.includes(h)) return fail(`the window header ${JSON.stringify(header)} lacks the path`);
    }
    return pass('SET, LABELS and WINDOW lines right');
  },
  'refuse-unknown-label': (ctx) =>
    refusalCase(ctx, () => ({ labels: [{ units: '1', label: 'nonexistent' }] })),
  'refuse-unit-not-in-window': (ctx) =>
    refusalCase(ctx, () => ({ labels: [{ units: '999', label: 'rule' }] })),
  'refuse-range-leaves-window': (ctx) =>
    refusalCase(ctx, (r) => ({
      labels: [{ units: `${r.window.units.length - 2}-${r.window.units.length + 5}`, label: 'rule' }],
    })),
  'refuse-reversed-range': (ctx) => refusalCase(ctx, () => ({ labels: [{ units: '13-12', label: 'rule' }] })),
  'refuse-non-integer-unit': async (ctx) => {
    for (const units of ['1.5', '-3', '1e2', 'abc']) {
      const r = await refusalCase(ctx, () => ({ labels: [{ units, label: 'rule' }] }));
      if (!r.pass) return fail(`units ${JSON.stringify(units)}: ${r.detail}`);
    }
    return pass('four malformed units refused');
  },
  'refuse-target-on-plain-label': (ctx) =>
    refusalCase(ctx, () => ({ labels: [{ units: '1', label: 'rule', target: 2 }] }), { yaml: RULES_YAML }),
  'refuse-missing-target': (ctx) =>
    refusalCase(ctx, () => ({ labels: [{ units: '1', label: 'gate' }] }), { yaml: RULES_YAML }),
  'refuse-label-on-opaque-unit': async (ctx) => {
    const p = prose(ctx);
    const texts = p.many(10);
    const blocks: Block[] = [
      ...texts.slice(0, 5).map(para),
      { kind: 'fence', lines: [p.next(), p.next()], info: 'text' },
      ...texts.slice(5).map(para),
    ];
    const doc = compose(blocks);
    const labeler = invalidThen((r) => ({
      labels: [{ units: String(firstN(r, (u) => u.mode === 'opaque')), label: 'rule' }],
    }));
    const res = await scanOk(ctx.sut, { files: [{ path: 'doc.md', text: doc.text }], labeler });
    if (labeler.calls.length !== 2) return fail(`${labeler.calls.length} calls, expected 2`);
    if (!labeler.calls[0]?.window.units.some((u) => u.mode === 'opaque'))
      return fail('the fence was not offered as an opaque unit');
    return res.atoms.some((a) => a.quote.includes('```'))
      ? fail('an atom was built from the fence')
      : pass('refused once, no atom from the fence');
  },
  'refuse-label-on-context-unit': async (ctx) => {
    const p = prose(ctx);
    const texts = distinctSentences(p, 20);
    const edited = [...texts];
    edited[9] = rewordOf(ctx, p, texts[9] as string);
    const first = await scanOk(ctx.sut, { files: docOf(texts), labeler: perfect() });
    const labeler = invalidThen((r) => ({
      labels: [{ units: String(firstN(r, (u) => u.mode === 'context')), label: 'rule' }],
    }));
    const second = await scanOk(ctx.sut, { files: docOf(edited), previousLedger: first.ledger.raw, labeler });
    if (labeler.calls.length !== 2) return fail(`${labeler.calls.length} calls on the rescan, expected 2`);
    if (!labeler.calls[0]?.window.units.some((u) => u.mode === 'context'))
      return fail('the dirty window shows no context unit');
    const far = texts[2] as string;
    return label(second.ledger, far) === label(first.ledger, far)
      ? pass('refused once, the context unit kept its label')
      : fail('a context unit changed its label');
  },
  'refuse-overlap': (ctx) =>
    refusalCase(ctx, () => ({
      labels: [
        { units: '4', label: 'rule' },
        { units: '3-5', label: 'rule' },
      ],
    })),
  'retry-once-then-fail': async (ctx) => {
    const texts = distinctSentences(prose(ctx), 12);
    const labeler = recording(() => ({ labels: [{ units: '1', label: 'nonexistent' }] }));
    const res = await scanOk(ctx.sut, { files: docOf(texts), labeler });
    if (labeler.calls.length !== 2) return fail(`${labeler.calls.length} calls, expected exactly 2`);
    if (res.atoms.length !== 0) return fail('atoms from a window that failed');
    if (texts.some((t) => label(res.ledger, t) !== undefined))
      return fail('a unit of a failed window has a label');
    return res.diagnostics.some((d) => d.window !== undefined)
      ? pass('two calls, unlabeled, a diagnostic names the window')
      : fail('no diagnostic names the failed window');
  },
  'failed-window-isolated': async (ctx) => {
    const rng = prose(ctx).random;
    const big = bigDoc(rng, 40, 1_400_000, sentence);
    const text = compose(big.blocks).text;
    const labeler = recording((req) =>
      req.window.id.endsWith('#2') ? { labels: [{ units: '1', label: 'nonexistent' }] } : perfect()(req),
    );
    const res = await scanOk(ctx.sut, { files: [{ path: 'big.md', text }], labeler });
    const ids = new Set(labeler.calls.map((c) => c.window.id));
    if (ids.size < 3) return fail(`${ids.size} windows, expected at least 3`);
    if (labeler.calls.length !== ids.size + 1)
      return fail(`${labeler.calls.length} calls for ${ids.size} windows, expected ${ids.size + 1}`);
    const second = new Set(
      labeler.calls
        .filter((c) => c.window.id.endsWith('#2'))
        .flatMap((c) => c.window.units.map((u) => keyOf(u.text))),
    );
    for (const t of big.texts.filter((_, i) => i % 97 === 0)) {
      const got = label(res.ledger, t);
      if (second.has(keyOf(t))) {
        if (got !== undefined) return fail('a unit of the failed window has a label');
      } else if (got !== truthLabel(t))
        return fail(`a unit of another window has label ${got}, planted ${truthLabel(t)}`);
    }
    return pass(`${ids.size} windows, one failed, the rest labelled`);
  },
  'carry-forward-unchanged-no-calls': async (ctx) => {
    const texts = distinctSentences(prose(ctx), 30);
    const first = await scanOk(ctx.sut, { files: docOf(texts), labeler: perfect() });
    if (!texts.every((text) => label(first.ledger, text) === truthLabel(text)))
      return fail('positive witness: the first scan omitted planted labels');
    const labeler = recording(perfect());
    const second = await scanOk(ctx.sut, { files: docOf(texts), previousLedger: first.ledger.raw, labeler });
    if (labeler.calls.length !== 0) return fail(`${labeler.calls.length} labeller calls on unchanged files`);
    return texts.every((t) => label(second.ledger, t) === label(first.ledger, t))
      ? pass('no call, labels kept')
      : fail('a label changed');
  },
  'carry-forward-dirty-window-only': async (ctx) => {
    const rng = prose(ctx).random;
    const big = bigDoc(rng, 30, 900_000, sentence);
    const text1 = compose(big.blocks).text;
    const at = Math.floor(big.texts.length * 0.4) + 2;
    const target = big.texts[at] as string;
    const text2 = text1.replace(target, rewordWords(rng, target, 1));
    if (text2 === text1) return fail('the item could not edit the text');
    const first = await scanOk(ctx.sut, { files: [{ path: 'big.md', text: text1 }], labeler: perfect() });
    const labeler = recording(perfect());
    await scanOk(ctx.sut, {
      files: [{ path: 'big.md', text: text2 }],
      previousLedger: first.ledger.raw,
      labeler,
    });
    if (labeler.calls.length !== 1)
      return fail(`${labeler.calls.length} calls for one edited unit, expected 1`);
    const units = labeler.calls[0]?.window.units ?? [];
    const labelable = units.filter((u) => u.mode === 'label');
    const context = units.filter((u) => u.mode === 'context');
    if (labelable.length < 1 || labelable.length > 3)
      return fail(`${labelable.length} labelable units in the dirty window, expected 1 to 3`);
    if (context.length === 0)
      return fail('the dirty window shows no context unit: unchanged neighbours were sent as labelable');
    return pass(`${labelable.length} labelable, ${context.length} context`);
  },
  'carry-forward-keeps-recorded-labels': async (ctx) => {
    const p = prose(ctx);
    const texts = distinctSentences(p, 30);
    const edited = [...texts];
    edited[14] = rewordOf(ctx, p, texts[14] as string);
    const first = await scanOk(ctx.sut, { files: docOf(texts), labeler: perfect() });
    const second = await scanOk(ctx.sut, {
      files: docOf(edited),
      previousLedger: first.ledger.raw,
      labeler: constant('description'),
    });
    for (const [i, t] of texts.entries()) {
      if (Math.abs(i - 14) < 2) continue;
      if (label(second.ledger, t) !== label(first.ledger, t))
        return fail(
          `unit ${i} lost its recorded label ${label(first.ledger, t)} for ${label(second.ledger, t)}`,
        );
    }
    return label(second.ledger, edited[14] as string) === 'description'
      ? pass('far units kept their labels')
      : fail('the edited unit was not labelled again');
  },
  'carry-forward-context-changed-resent': async (ctx) => {
    const p = prose(ctx);
    const texts = distinctSentences(p, 24);
    const edited = [...texts];
    edited[11] = rewordOf(ctx, p, texts[11] as string);
    const first = await scanOk(ctx.sut, { files: docOf(texts), labeler: perfect() });
    const labeler = recording(perfect());
    const second = await scanOk(ctx.sut, { files: docOf(edited), previousLedger: first.ledger.raw, labeler });
    const sent = new Set(
      labeler.calls.flatMap((c) =>
        c.window.units.filter((u) => u.mode === 'label').map((u) => keyOf(u.text)),
      ),
    );
    let moved = 0;
    for (const e of liveOf(second.ledger)) {
      const before = byId(first.ledger, e.id);
      if (before && before.fp === e.fp && before.ctxFp !== e.ctxFp) {
        moved += 1;
        if (!sent.has(keyOf(e.quote)))
          return fail(
            `${show(e.quote, 36)} has a changed context fingerprint and was not offered for labelling`,
          );
      }
    }
    return moved > 0
      ? pass(`${moved} units with a changed context fingerprint, all resent`)
      : fail('no unit has a changed context fingerprint: the ledger does not record context');
  },
  'label-flip-not-deleted': async (ctx) => {
    const texts = distinctSentences(prose(ctx), 30);
    const rules = texts.filter((t) => truthLabel(t) === 'rule').slice(0, 3);
    if (rules.length < 3) return fail('the seed gave fewer than 3 rule units');
    const first = await scanOk(ctx.sut, { files: docOf(texts), labeler: perfect(), labelsYaml: RULES_YAML });
    const changed = RULES_YAML.replace(
      'A unit that tells the reader what to do.',
      'A unit that tells the reader what to do now.',
    );
    const flip: Labeler = (req) => ({
      labels: entriesFor(req, (u) =>
        rules.some((r) => keyOf(r) === keyOf(u.text)) ? 'none' : truthLabel(u.text),
      ),
    });
    const second = await scanOk(ctx.sut, {
      files: docOf(texts),
      previousLedger: first.ledger.raw,
      labeler: flip,
      labelsYaml: changed,
    });
    for (const t of rules) {
      const id = liveByText(first.ledger, t)?.id as string;
      const now = byId(second.ledger, id);
      if (now?.status !== 'live')
        return fail(`${show(t, 36)} is not live after the label flip (status ${now?.status})`);
      if (second.events?.[id] !== 'unchanged')
        return fail(`${show(t, 36)} has event ${second.events?.[id]}, expected unchanged`);
      if (now.labels['agent-rules']?.label !== 'none')
        return fail(`${show(t, 36)} has label ${now.labels['agent-rules']?.label}, expected none`);
      if (!second.diagnostics.some((d) => d.code === 'label_flip' && d.unit === id))
        return fail(`no label_flip diagnostic names ${show(t, 36)}`);
      if (second.atoms.some((a) => a.fields.unit === id))
        return fail('an atom survives for a unit the labeller stopped selecting');
    }
    return pass('three flips, none deleted');
  },
  'anchoring-independent-of-labeler': async (ctx) => {
    const p = prose(ctx);
    const segs = buildScript(
      p,
      ['reword', 'rewrite', 'delete', 'insert', 'split', 'merge', 'reword', 'move'],
      24,
      2,
    );
    const { before, after } = filesOfSegments(segs, 2, ['First notes', 'Second notes']);
    const labellers: Labeler[] = [perfect(), constant('none'), keyedOnLength(150), randomLabeler(ctx.seed)];
    const views: string[] = [];
    for (const l of labellers) {
      const first = await scanOk(ctx.sut, { files: build(before).files, labeler: l });
      requireSourceWitness(first, build(before).files);
      const second = await scanOk(ctx.sut, {
        files: build(after).files,
        previousLedger: first.ledger.raw,
        labeler: l,
      });
      requireSourceWitness(second, build(after).files);
      for (const entry of second.ledger.entries)
        if (second.events?.[entry.id] === undefined)
          return fail(`the reader does not expose an event for ${entry.id}`);
      const entries = JSON.parse(second.ledger.raw).entries.map((e: Record<string, unknown>) => {
        const { labels: _labels, ...rest } = e;
        return rest;
      });
      views.push(JSON.stringify({ entries, events: second.events }));
    }
    return views.every((v) => v === views[0])
      ? pass('ids, events and quotes equal under four labellers')
      : fail('the ledger changes with the labeller: change detection depends on labels');
  },
  'sets-independent': async (ctx) => {
    const texts = distinctSentences(prose(ctx), 20);
    const first = await scanOk(ctx.sut, {
      files: docOf(texts),
      labeler: perfect(),
      labelsYaml: TWO_SETS_YAML,
    });
    const changed = TWO_SETS_YAML.replace(
      'A unit that fixes a tone or a word choice for customer emails.',
      'A unit that fixes the tone of a customer email.',
    );
    const labeler = recording(perfect());
    const second = await scanOk(ctx.sut, {
      files: docOf(texts),
      previousLedger: first.ledger.raw,
      labeler,
      labelsYaml: changed,
    });
    if (labeler.calls.length === 0) return fail('no call after a label description changed');
    if (labeler.calls.some((c) => c.set !== 'house-voice'))
      return fail('a window of the unedited set was sent again');
    for (const t of texts) {
      if (liveByText(second.ledger, t)?.id !== liveByText(first.ledger, t)?.id)
        return fail('a unit id changed');
      if (label(second.ledger, t, 'agent-rules') !== label(first.ledger, t, 'agent-rules'))
        return fail('a label of the unedited set changed');
    }
    return pass(`${labeler.calls.length} calls, all for the edited set`);
  },
  'set-hash-ignores-yaml-formatting': async (ctx) => {
    const texts = distinctSentences(prose(ctx), 12);
    const first = await scanOk(ctx.sut, { files: docOf(texts), labeler: perfect(), labelsYaml: RULES_YAML });
    for (const text of texts)
      if (label(first.ledger, text) !== truthLabel(text))
        return fail('positive witness: every source unit must carry its planted label before formatting');
    const reformatted = `# labels of the estate
labels:
    - description: "What an instruction file asks of the agent."   # set text
      set: agent-rules
      labels:
        - description: 'A unit that tells the reader what to do.'
          atom: {polarity: obligation, kind: instruction}
          name: rule
        - name: prohibition
          atom:
            kind: instruction
            polarity: prohibition
          description: "A unit that tells the reader what never to do."
        - description: A unit that sets an order, one act before another.
          target: required
          atom: { kind: gate }
          name: gate
        - name: example
          description: A unit that shows a case and is not itself an instruction.
        - name: description
          description: A unit that states how something is, with no instruction.
`;
    const labeler = recording(perfect());
    const second = await scanOk(ctx.sut, {
      files: docOf(texts),
      previousLedger: first.ledger.raw,
      labeler,
      labelsYaml: reformatted,
    });
    for (const text of texts)
      if (label(second.ledger, text) !== truthLabel(text))
        return fail('positive witness: every source unit must keep its planted label after formatting');
    if (labeler.calls.length !== 0)
      return fail(`${labeler.calls.length} calls after a formatting-only change`);
    const h = (l: LedgerView) => liveOf(l)[0]?.labels['agent-rules']?.setHash;
    return h(first.ledger) !== undefined && h(first.ledger) === h(second.ledger)
      ? pass('same set hash, no call')
      : fail('the set hash changed with the YAML formatting');
  },
  'set-hash-covers-fields': async (ctx) => {
    const texts = distinctSentences(prose(ctx), 6);
    const mk = (rule: string) =>
      `labels:\n  - set: probe\n    description: A set to hash.\n    labels:\n${rule}      - name: other\n        description: Another label.\n`;
    const base =
      '      - name: rule\n        description: A unit that tells the reader what to do.\n        atom: { kind: instruction, polarity: obligation }\n';
    const variants = [
      base,
      base.replace('name: rule', 'name: rule2'),
      base.replace('what to do.', 'what to do now.'),
      base.replace('        atom:', '        examples:\n          - "Do this."\n        atom:'),
      base.replace('        atom:', '        target: required\n        atom:'),
      base.replace('obligation', 'prohibition'),
    ];
    const hashes: Array<string | undefined> = [];
    for (const v of variants) {
      const res = await scanOk(ctx.sut, { files: docOf(texts), labeler: perfect(), labelsYaml: mk(v) });
      hashes.push(liveOf(res.ledger)[0]?.labels.probe?.setHash);
    }
    if (hashes.some((h) => h === undefined)) return fail('a scan stored no set hash');
    return new Set(hashes).size === variants.length
      ? pass('six variants, six hashes')
      : fail(`${new Set(hashes).size} distinct hashes for ${variants.length} different sets`);
  },
  'set-validation-errors': (ctx) => validateSetCases(ctx),
  'read-unit-not-labelable': async (ctx) => {
    const p = prose(ctx);
    const name = 'shelf-audit';
    const description = `Checks the ${p.next().toLowerCase().replace(/\.$/, '')}.`;
    const body = p.many(4);
    const doc = compose([
      {
        kind: 'front',
        entries: [
          { key: 'name', value: name },
          { key: 'description', value: description },
        ],
      },
      { kind: 'heading', level: 1, text: 'Shelf audit' },
      ...body.map(para),
    ]);
    const path = '.claude/skills/shelf-audit/SKILL.md';
    const labeler = invalidThen((r) => ({
      labels: [{ units: String(firstN(r, (u) => u.mode === 'read')), label: 'rule' }],
    }));
    const res = await scanOk(ctx.sut, { files: [{ path, text: doc.text }], labeler });
    const units = labeler.calls[0]?.window.units ?? [];
    const readOnes = units.filter((u) => u.mode === 'read');
    if (!readOnes.some((u) => keyOf(u.text) === keyOf(description)))
      return fail('the description the structured reader turns into a route is not shown as read');
    if (labeler.calls.length !== 2)
      return fail(`${labeler.calls.length} calls, expected 2 (a label on a read unit is refused)`);
    return body.every((t) => label(res.ledger, t) === truthLabel(t))
      ? pass('read units marked, labels on them refused')
      : fail('the body units were not labelled by the second answer');
  },
  'default-set-is-data': async (ctx) => {
    const texts = distinctSentences(prose(ctx), 30);
    const plain = await scanOk(ctx.sut, { files: docOf(texts), labeler: perfect() });
    const written = await scanOk(ctx.sut, {
      files: docOf(texts),
      labeler: perfect(),
      labelsYaml: RULES_YAML,
    });
    const key = (r: typeof plain) =>
      r.atoms
        .map((a) => `${keyOf(a.quote)}|${a.kind}|${a.polarity ?? ''}`)
        .sort()
        .join('\n');
    if (key(plain) !== key(written))
      return fail('the shipped default set and the same set written as a file build different atoms');
    const custom = `labels:\n  - set: bakes\n    description: Steps of a bake.\n    labels:\n      - name: weigh\n        description: A unit about weighing.\n      - name: proof\n        description: A unit about proving.\n      - name: none-of-these\n        description: A unit about neither.\n`;
    const third = await scanOk(ctx.sut, { files: docOf(texts), labeler: perfect(), labelsYaml: custom });
    const names = new Set(liveOf(third.ledger).map((e) => e.labels.bakes?.label));
    return [...names].every((n) => ['weigh', 'proof', 'none-of-these'].includes(n as string)) &&
      names.size > 0
      ? pass('default as data, any label names')
      : fail(`the custom set stored labels ${JSON.stringify([...names])}`);
  },
  'none-always-allowed': async (ctx) => {
    const texts = distinctSentences(prose(ctx), 10);
    const labeler = recording(
      labelByText(
        [
          { text: texts[0] as string, label: 'rule' },
          { text: texts[1] as string, label: 'prohibition' },
        ],
        'none',
      ),
    );
    const res = await scanOk(ctx.sut, { files: docOf(texts), labeler, labelsYaml: RULES_YAML });
    if (labeler.calls.length !== 1)
      return fail(`${labeler.calls.length} calls: an answer with none was refused`);
    return res.atoms.length === 2 ? pass('none accepted') : fail(`${res.atoms.length} atoms, expected 2`);
  },
  'jev-threshold-window': async (ctx) => {
    const texts = distinctSentences(prose(ctx), 12);
    const units = texts.map((text, i) => ({ text, probs: probsAround(i, 0.4, 0.01) }));
    const { res } = await jevLabels(ctx, 'jev', units, undefined);
    for (const u of units) {
      const want = expectedJev(u.probs, NAMES, 0.4);
      const got = label(res.ledger, u.text, 'probe');
      if (got !== want)
        return fail(`${show(u.text, 30)} with ${JSON.stringify(u.probs)} has label ${got}, expected ${want}`);
    }
    return pass('12 units around the 0.4 threshold');
  },
  'jev-threshold-unit': async (ctx) => {
    const texts = distinctSentences(prose(ctx), 12);
    const units = texts.map((text, i) => ({ text, probs: probsAround(i, 0.7, 0.01) }));
    const { res } = await jevLabels(ctx, 'jev-unit', units, undefined);
    for (const u of units) {
      const want = expectedJev(u.probs, NAMES, 0.7);
      const got = label(res.ledger, u.text, 'probe');
      if (got !== want)
        return fail(`${show(u.text, 30)} with ${JSON.stringify(u.probs)} has label ${got}, expected ${want}`);
    }
    return pass('12 units around the 0.7 threshold');
  },
  'jev-highest-not-first': async (ctx) => {
    const texts = distinctSentences(prose(ctx), 6);
    const units = texts.map((text) => ({ text, probs: { rule: 0.5, prohibition: 0.8, example: 0.05 } }));
    const { res } = await jevLabels(ctx, 'jev', units);
    const bad = texts.find((t) => label(res.ledger, t, 'probe') !== 'prohibition');
    return bad
      ? fail(
          `${show(bad, 30)} has label ${label(res.ledger, bad, 'probe')}, the highest probability is prohibition`,
        )
      : pass('highest wins');
  },
  'jev-none-below-threshold': async (ctx) => {
    const texts = distinctSentences(prose(ctx), 8);
    const { res } = await jevLabels(
      ctx,
      'jev',
      texts.map((text) => ({ text, probs: { rule: 0.2, prohibition: 0.15, example: 0.1 } })),
    );
    const bad = texts.find((t) => label(res.ledger, t, 'probe') !== 'none');
    return bad
      ? fail(`${show(bad, 30)} has label ${label(res.ledger, bad, 'probe')}, expected none`)
      : res.atoms.length === 0
        ? pass('all none, no atom')
        : fail(`${res.atoms.length} atoms from labels below the threshold`);
  },
  'jev-threshold-is-a-replay-setting': async (ctx) => {
    const texts = distinctSentences(prose(ctx), 12);
    const units = texts.map((text, i) => ({
      text,
      probs: { rule: i % 2 === 0 ? 0.95 : 0.5, prohibition: 0.05, example: 0.05 },
    }));
    const { res } = await jevLabels(ctx, 'jev', units);
    if (!res.cassette) return fail('the record run returned no cassette');
    const fixture = makeFixture(
      'jev',
      [
        {
          path: 'doc.md',
          units: units.map((unit) => ({ text: unit.text, label: 'rule', probabilities: unit.probs })),
        },
      ],
      PROBE_YAML,
    );
    const closed = fakeTransport({ respond: () => ({ status: 500, body: 'closed' }) });
    const replay = await ctx.sut.scan({
      files: fixture.files,
      labelsYaml: PROBE_YAML,
      model: { arm: 'jev', transport: closed, threshold: 0.9 },
      cassette: { mode: 'replay', text: fixture.cassette },
    });
    if (!replay.ok || !replay.ledger) return fail(`the replay at another threshold failed: ${replay.error}`);
    requireFixtureLabels(replay, fixture, 0.9);
    if (closed.count !== 0) return fail(`${closed.count} transport calls on a replay`);
    for (const [i, t] of texts.entries()) {
      const want = i % 2 === 0 ? 'rule' : 'none';
      if (label(replay.ledger, t, 'probe') !== want)
        return fail(
          `${show(t, 30)} has label ${label(replay.ledger, t, 'probe')} at threshold 0.9, expected ${want}`,
        );
    }
    return pass('threshold changed with no call');
  },
  'jev-question-keys': async (ctx) => {
    const texts = distinctSentences(prose(ctx), 20);
    const fake = fakeTransport();
    must(await modelScan(ctx, docOf(texts), 'jev', fake, { labelsYaml: FIVE_YAML }));
    const keys = fake.calls.flatMap((c) => c.questions);
    const re = /^u\d+__(one|two|three|four|five)$/;
    if (keys.some((k) => !re.test(k)))
      return fail(`a question key is not u<n>__<label>: ${keys.find((k) => !re.test(k))}`);
    if (keys.length !== 100 || new Set(keys).size !== 100)
      return fail(`${keys.length} questions (${new Set(keys).size} distinct), expected 100 pairs once`);
    return pass('100 keyed questions');
  },
  'jev-window-cap': async (ctx) => {
    const texts = distinctSentences(prose(ctx), 100);
    const fake = fakeTransport();
    must(await modelScan(ctx, docOf(texts), 'jev', fake, { labelsYaml: FIVE_YAML }));
    if (fake.count < 2) return fail(`${fake.count} calls for 500 questions`);
    const big = fake.calls.find((c) => c.questions.length > 250);
    if (big) return fail(`a call carries ${big.questions.length} questions, the cap is 250`);
    const total = fake.calls.reduce((s, c) => s + c.questions.length, 0);
    return total === 500
      ? pass(`${fake.count} calls, 500 questions`)
      : fail(`${total} questions asked, expected 500`);
  },
  'jev-halve-on-refusal': async (ctx) => {
    const texts = distinctSentences(prose(ctx), 40);
    const fake = fakeTransport({
      respond: (_i, call) => (call.questions.length > 130 ? TOO_LARGE : undefined),
    });
    const res = must(await modelScan(ctx, docOf(texts), 'jev', fake, { labelsYaml: FIVE_YAML }));
    const refused = fake.calls.filter((c) => c.questions.length > 130).length;
    if (refused > 3)
      return fail(`${refused} refused calls, at most 3 are needed to halve 200 questions under 130`);
    const unlabeled = texts.filter((t) => label(res.ledger, t, 'five') === undefined);
    return unlabeled.length === 0
      ? pass(`${refused} refused, all 40 units labelled`)
      : fail(`${unlabeled.length} units were left unlabelled after the window was halved`);
  },
  'jev-unit-state-one-call-per-unit': async (ctx) => {
    const texts = distinctSentences(prose(ctx), 25);
    const fake = fakeTransport();
    must(await modelScan(ctx, docOf(texts), 'jev-unit', fake, { labelsYaml: FIVE_YAML }));
    if (fake.count !== 25) return fail(`${fake.count} calls for 25 units, expected 25`);
    const bad = fake.calls.find((c) => c.questions.length !== 5);
    return bad
      ? fail(`a call carries ${bad.questions.length} questions, expected 5`)
      : pass('25 calls of 5 questions');
  },
  'jev-probabilities-recorded': async (ctx) => {
    const texts = distinctSentences(prose(ctx), 20);
    const fake = fakeTransport();
    const res = must(await modelScan(ctx, docOf(texts), 'jev', fake, { labelsYaml: FIVE_YAML }));
    if (!res.cassette) return fail('no cassette');
    const found = new Map<string, number>();
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
          if (typeof x === 'number' && x >= 0 && x <= 1 && /^u\d+__/.test(k)) found.set(k, x);
          else walk(x);
        }
      }
    };
    for (const line of res.cassette.split('\n').filter(Boolean)) walk(JSON.parse(line));
    const asked = new Set(fake.calls.flatMap((c) => c.questions));
    const missing = [...asked].filter((k) => !found.has(k));
    return missing.length === 0
      ? pass(`${asked.size} probabilities recorded`)
      : fail(`${missing.length} asked questions have no recorded probability, e.g. ${missing[0]}`);
  },
  'haiku-dense-request': async (ctx) => {
    const p = prose(ctx);
    const files = ['a.md', 'b.md'].map((path) => ({
      path,
      text: compose([{ kind: 'heading', level: 1, text: headingText(p.random) }, ...p.many(8).map(para)])
        .text,
    }));
    const fake = fakeTransport();
    const res = must(await modelScan(ctx, files, 'haiku', fake));
    if (fake.count !== 2) return fail(`${fake.count} requests for 2 files, expected 2`);
    const bad = fake.calls.find((c) => c.arm !== 'haiku' || c.units.length !== 9);
    if (bad) return fail(`a request lists ${bad.units.length} units, expected 9`);
    const texts = fake.calls.flatMap((c) => c.units.map((u) => u.text));
    const wrong = texts.find((t) => label(res.ledger, t) !== truthLabel(t));
    return wrong
      ? fail(
          `${show(wrong, 30)} has label ${label(res.ledger, wrong)}, the model answered ${truthLabel(wrong)}`,
        )
      : pass('one dense request per file');
  },
  'haiku-thinking-block-first': async (ctx) => {
    const texts = distinctSentences(prose(ctx), 10);
    const fake = fakeTransport({
      thinkingFirst: 'Let me think. The first unit is probably an example. {"labels": []}',
    });
    const res = must(await modelScan(ctx, docOf(texts), 'haiku', fake));
    const wrong = texts.find((t) => label(res.ledger, t) !== truthLabel(t));
    return wrong
      ? fail(
          `${show(wrong, 30)} has label ${label(res.ledger, wrong)}, the answer block said ${truthLabel(wrong)}`,
        )
      : fake.count === 1
        ? pass('answer block read, thinking ignored')
        : fail(`${fake.count} calls, expected 1`);
  },
  'haiku-stop-reason-refused': async (ctx) => {
    const texts = distinctSentences(prose(ctx), 10);
    for (const stop of ['max_tokens', 'refusal']) {
      const fake = fakeTransport({
        respond: (i, _c, base) => {
          if (i !== 0) return undefined;
          const b = JSON.parse(base.body) as { stop_reason: string };
          b.stop_reason = stop;
          return { status: 200, body: JSON.stringify(b) };
        },
      });
      const res = await modelScan(ctx, docOf(texts), 'haiku', fake);
      if (!res.ok || !res.ledger) return fail(`stop reason ${stop}: the scan failed: ${res.error}`);
      if (fake.count !== 2)
        return fail(`stop reason ${stop}: ${fake.count} calls, expected 2 (refuse, retry once)`);
      if (label(res.ledger, texts[0] as string) !== truthLabel(texts[0] as string))
        return fail(`stop reason ${stop}: the retry's answer did not apply`);
    }
    return pass('both stop reasons refused and retried');
  },
  'haiku-refuse-wrong-window-or-set': async (ctx) => {
    const texts = distinctSentences(prose(ctx), 10);
    for (const field of ['window', 'set']) {
      const fake = fakeTransport({
        respond: (i, _c, base) => {
          if (i !== 0) return undefined;
          const b = JSON.parse(base.body) as { content: Array<{ type: string; text: string }> };
          const answer = JSON.parse(b.content[0]?.text ?? '{}') as Record<string, unknown>;
          answer[field] = field === 'window' ? 'other.md#9' : 'other-set';
          b.content[0]!.text = JSON.stringify(answer);
          return { status: 200, body: JSON.stringify(b) };
        },
      });
      const res = await modelScan(ctx, docOf(texts), 'haiku', fake);
      if (!res.ok) return fail(`echo of another ${field}: the scan failed: ${res.error}`);
      if (fake.count !== 2)
        return fail(`an answer echoing another ${field} was accepted: ${fake.count} calls, expected 2`);
    }
    return pass('wrong window and wrong set refused');
  },
};
