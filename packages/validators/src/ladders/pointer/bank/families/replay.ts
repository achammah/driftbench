import { distinctSentences } from '../../kit/anchor-world';
import { runChild } from '../../kit/child-run';
import { compose } from '../../kit/compose';
import { loadFixture, makeFixture, perturb, requireFixtureLabels } from '../../kit/fixture';
import { show } from '../../kit/oracle';
import { requireSourceWitness } from '../../kit/positive';
import { PROBE_YAML, RULES_YAML, TWO_SETS_YAML } from '../../kit/sets';
import { type FakeTransport, fakeTransport } from '../../kit/transport';
import { headingText, Prose, rewordWords } from '../../kit/words';
import type { FetchRequest, ModelArm, ScanRequest, ScanResult, SourceFile } from '../../sut/port';
import { fail, type ItemContext, type Outcome, pass, type Run } from '../types';

const prose = (ctx: ItemContext) => new Prose(ctx.seed, ctx.id);
const para = (text: string) => ({ kind: 'paragraph' as const, sentences: [text] });

function threeFiles(ctx: ItemContext, tokens = false): { files: SourceFile[]; texts: string[][] } {
  const p = prose(ctx);
  const texts = [0, 1, 2].map((f) =>
    distinctSentences(p, 6).map((t, i) => (tokens ? t.replace(/\.$/, ` ZQ7-${f}${i}-NOTE.`) : t)),
  );
  const files = texts.map((ts, f) => ({
    path: `notes/${['a', 'b', 'c'][f]}.md`,
    text: compose([{ kind: 'heading', level: 1, text: headingText(p.random) }, ...ts.map(para)]).text,
  }));
  return { files, texts };
}

const closed = (): FakeTransport => fakeTransport({ respond: () => ({ status: 500, body: 'closed' }) });

async function record(
  files: SourceFile[],
  arm: ModelArm,
  fake: FakeTransport,
  extra: Partial<ScanRequest> = {},
  ctx?: ItemContext,
): Promise<ScanResult> {
  const result = await (ctx as ItemContext).sut.scan({
    files,
    model: { arm, transport: fake },
    ...extra,
    cassette: { mode: 'record' },
  });
  requireSourceWitness(result, files);
  if (fake.count === 0 || !result.cassette?.trim())
    throw new Error('positive witness: recording produced no request or cassette entry');
  return result;
}

async function replay(
  ctx: ItemContext,
  files: SourceFile[],
  arm: ModelArm,
  cassette: string,
  extra: Partial<ScanRequest> = {},
  threshold?: number,
): Promise<{ res: ScanResult; fake: FakeTransport }> {
  const fake = closed();
  const res = await ctx.sut.scan({
    files,
    model: { arm, transport: fake, ...(threshold !== undefined ? { threshold } : {}) },
    cassette: { mode: 'replay', text: cassette },
    ...extra,
  });
  if (res.ok) requireSourceWitness(res, files);
  return { res, fake };
}

const must = (res: ScanResult, what: string): string => {
  if (!res.ok || !res.ledger) throw new Error(`${what}: ${res.error ?? 'no ledger'}`);
  return res.ledger.raw;
};

const lines = (cassette: string) => cassette.split('\n').filter((l) => l.trim() !== '');

function keysOf(v: unknown, out: Map<string, unknown> = new Map(), prefix = ''): Map<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, x] of Object.entries(v)) {
      out.set(`${prefix}${k}`.toLowerCase().replace(/[^a-z0-9.]/g, ''), x);
      keysOf(x, out, `${prefix}${k}.`);
    }
  }
  return out;
}

const mentions = (error: string | undefined, names: string[]): boolean => {
  const e = (error ?? '').toLowerCase();
  return names.some((n) => e.includes(n.toLowerCase()));
};

async function positiveReplay(ctx: ItemContext, arm: ModelArm = 'haiku') {
  const fixture = loadFixture(arm);
  const { res, fake } = await replay(ctx, fixture.files, arm, fixture.cassette, {
    labelsYaml: fixture.labelsYaml,
  });
  requireFixtureLabels(res, fixture);
  if (fake.count) throw new Error('fixture replay called transport');
  return { fixture, res };
}
async function missCase(
  ctx: ItemContext,
  edit: (files: SourceFile[], texts: string[][], yaml: string) => { files: SourceFile[]; yaml: string },
  names: string[],
  arm: ModelArm = 'haiku',
): Promise<Outcome> {
  const { fixture } = await positiveReplay(ctx, arm);
  const changed = edit(
    fixture.files,
    fixture.documents.map((d) => d.units.map((u) => u.text)),
    fixture.labelsYaml,
  );
  if (JSON.stringify(changed.files) === JSON.stringify(fixture.files) && changed.yaml === fixture.labelsYaml)
    return fail('the miss probe did not change an input');
  const { res, fake } = await replay(ctx, changed.files, arm, fixture.cassette, { labelsYaml: changed.yaml });
  if (res.ok) return fail('changed request incorrectly replayed');
  if (fake.count) return fail('miss reached network');
  return mentions(res.error, names)
    ? pass('miss names changed input')
    : fail(`miss does not name ${names.join(', ')}: ${res.error}`);
}
const fixtureMissCase =
  (arm: ModelArm, field: string, value: string, names: string[], extra: string[] = []): Run =>
  async (ctx) => {
    const { fixture } = await positiveReplay(ctx, arm);
    const changed = perturb(fixture, arm, ctx.seed, field, value);
    const { res, fake } = await replay(ctx, fixture.files, arm, changed.cassette, {
      labelsYaml: fixture.labelsYaml,
    });
    if (res.ok) return fail('a one-field stale cassette was accepted');
    if (fake.count) return fail('the miss reached the network');
    if (!mentions(res.error, names)) return fail(`the miss does not name ${names.join(', ')}: ${res.error}`);
    for (const part of extra) if (!(res.error ?? '').includes(part)) return fail(`the miss omits ${part}`);
    return pass(`miss names ${field}`);
  };

export const replayRuns: Record<string, Run> = {
  // Legacy IDs are retained. Each now pairs exhaustive valid replay with exactly one stale input field.
  'fixture-haiku-replays-committed': fixtureMissCase('haiku', 'part.messages', 'changed', ['part.messages']),
  'fixture-jev-replays-committed': fixtureMissCase('jev', 'part.state', 'changed', ['part.state']),
  'fixture-jev-unit-replays-committed': fixtureMissCase('jev-unit', 'path', 'changed.md', ['path']),
  'fixture-replay-twice-identical': fixtureMissCase('haiku', 'window', 'changed#1', ['window']),
  'fixture-miss-names-model': fixtureMissCase('haiku', 'model', 'claude-haiku-4-0', ['model']),
  'fixture-miss-names-prompt-version': fixtureMissCase('haiku', 'promptVersion', 'p0', [
    'promptVersion',
    'prompt version',
  ]),
  'fixture-miss-names-schema-version': fixtureMissCase('haiku', 'schemaVersion', 's0', [
    'schemaVersion',
    'schema version',
  ]),
  'fixture-miss-names-set-hash': fixtureMissCase('haiku', 'setHash', '0000000000000000', [
    'setHash',
    'set hash',
  ]),
  'fixture-miss-names-labeler': fixtureMissCase('haiku', 'labeler', 'jev', ['labeler']),
  'fixture-miss-names-system-part': fixtureMissCase('haiku', 'part.system', '000000000000', [
    'part.system',
    'system',
  ]),
  'fixture-miss-names-questions-part': fixtureMissCase('jev-unit', 'part.questions', '000000000000', [
    'part.questions',
    'questions',
  ]),
  'fixture-miss-names-cut-digest': fixtureMissCase(
    'haiku',
    'cutDigest',
    '0'.repeat(64),
    ['cutDigest', 'cut digest'],
    [process.versions.node, process.versions.icu ?? ''],
  ),
  'record-then-replay-identical': async (ctx) => {
    const { fixture, res } = await positiveReplay(ctx);
    const fake = fakeTransport({
      truth: (text) => fixture.expected.find((e) => e.quote === text)?.label ?? 'none',
    });
    const rec = await ctx.sut.scan({
      files: fixture.files,
      labelsYaml: fixture.labelsYaml,
      model: { arm: 'haiku', transport: fake },
      cassette: {
        mode: 'record',
        text: fixture.rows
          .slice(1)
          .map((r) => JSON.stringify(r))
          .concat('')
          .join('\n'),
      },
    });
    requireFixtureLabels(rec, fixture);
    if (fake.count !== 1) return fail('record must fill exactly the missing fixture window');
    return rec.ledger?.raw === res.ledger?.raw && JSON.stringify(rec.atoms) === JSON.stringify(res.atoms)
      ? pass('authored fixture replay equals record byte for byte')
      : fail('record and replay ledger or atoms differ');
  },
  'replay-twice-identical': async (ctx) => {
    const a = await positiveReplay(ctx),
      b = await positiveReplay(ctx);
    return a.res.ledger?.raw === b.res.ledger?.raw &&
      JSON.stringify(a.res.atoms) === JSON.stringify(b.res.atoms)
      ? pass('identical')
      : fail('two fixture replays differ');
  },
  'two-recordings-same-cassette': async (ctx) => {
    const { files } = threeFiles(ctx);
    const a = await record(files, 'haiku', fakeTransport(), { labelsYaml: TWO_SETS_YAML }, ctx);
    const b = await record(files, 'haiku', fakeTransport(), { labelsYaml: TWO_SETS_YAML }, ctx);
    must(a, 'record');
    must(b, 'record');
    return a.cassette && a.cassette === b.cassette
      ? pass('byte-identical')
      : fail('two independent recordings dump different cassettes');
  },
  'miss-fails-without-network': async (ctx) => {
    const { files } = threeFiles(ctx);
    // A reader that always fails must first demonstrate a successful recording.
    await record(files, 'haiku', fakeTransport(), {}, ctx);
    const { res, fake } = await replay(ctx, files, 'haiku', '');
    if (res.ok) return fail('a replay with an empty cassette succeeded');
    return fake.count === 0 ? pass('failed, no call') : fail(`${fake.count} transport calls on a miss`);
  },
  'record-is-explicit': async (ctx) => {
    const { fixture } = await positiveReplay(ctx);
    const off = await replay(ctx, fixture.files, 'haiku', '', { labelsYaml: fixture.labelsYaml });
    if (off.res.ok || off.fake.count) return fail('empty replay did not fail offline');
    const fake = fakeTransport();
    await record(fixture.files, 'haiku', fake, { labelsYaml: fixture.labelsYaml }, ctx);
    if (fake.count !== 3) return fail('record must call all three windows');
    const again = fakeTransport();
    const second = await ctx.sut.scan({
      files: fixture.files,
      labelsYaml: fixture.labelsYaml,
      model: { arm: 'haiku', transport: again },
      cassette: { mode: 'record', text: fixture.cassette },
    });
    requireFixtureLabels(second, fixture);
    return again.count === 0
      ? pass('offline miss, three record calls, zero fixture reuse calls')
      : fail('existing committed entries were re-recorded');
  },
  'miss-names-description-edit': (ctx) =>
    missCase(
      ctx,
      (f, _t, yaml) => ({
        files: f,
        yaml: yaml.replace(
          'A unit that tells the reader what to do.',
          'A unit that tells the reader what to do now.',
        ),
      }),
      ['setHash', 'part.user'],
    ),
  'miss-names-renamed-label': (ctx) =>
    missCase(ctx, (f, _t, yaml) => ({ files: f, yaml: yaml.replaceAll('name: example', 'name: summary') }), [
      'setHash',
      'part.output',
      'part.user',
    ]),
  'miss-names-added-example': (ctx) =>
    missCase(
      ctx,
      (f, _t, yaml) => ({
        files: f,
        yaml: yaml.replace(
          '        description: A unit that tells the reader what never to do.\n',
          '        description: A unit that tells the reader what never to do.\n        examples:\n          - "Never do this."\n',
        ),
      }),
      ['setHash', 'part.user'],
    ),
  'miss-names-changed-unit': (ctx) =>
    missCase(
      ctx,
      (f, t, yaml) => {
        const p = prose(ctx);
        const edited = f.map((file, i) =>
          i === 1
            ? {
                ...file,
                text: file.text.replace(t[1]?.[2] as string, rewordWords(p.random, t[1]?.[2] as string, 1)),
              }
            : file,
        );
        return { files: edited, yaml };
      },
      ['part.messages', 'part.user', 'cutDigest'],
    ),
  'miss-names-new-file': (ctx) =>
    missCase(
      ctx,
      (f, _t, yaml) => ({
        files: [...f, { path: 'notes/d.md', text: compose([para(prose(ctx).next())]).text }],
        yaml,
      }),
      ['part.user', 'file', 'path', 'window'],
    ),
  'miss-names-cut-digest': fixtureMissCase('haiku', 'cutDigest', 'tampered', ['cutDigest']),
  'miss-names-labeler': async (ctx) => {
    for (const arm of ['haiku', 'jev'] as const) {
      const own = await positiveReplay(ctx, arm),
        other = loadFixture(arm === 'haiku' ? 'jev' : 'haiku');
      const { res, fake } = await replay(ctx, own.fixture.files, arm, other.cassette, {
        labelsYaml: own.fixture.labelsYaml,
      });
      if (res.ok || fake.count || !mentions(res.error, ['labeler', 'model']))
        return fail(`wrong-arm cassette did not fail by name: ${res.error}`);
    }
    return pass('both arms refuse the other fixture');
  },
  'miss-names-set-name': (ctx) =>
    missCase(ctx, (f, _t, yaml) => ({ files: f, yaml: yaml.replace('set: probe', 'set: renamed') }), [
      'setName',
      'set',
    ]),
  'miss-names-nearest-entry': async (ctx) => {
    const { fixture } = await positiveReplay(ctx);
    const edited = fixture.files.map((f, i) =>
      i === 1 ? { ...f, text: f.text.replace('receipt', 'voucher') } : f,
    );
    const { res } = await replay(ctx, edited, 'haiku', fixture.cassette, { labelsYaml: fixture.labelsYaml });
    return !res.ok && (res.error ?? '').includes('notes/b.md#1')
      ? pass('nearest window named')
      : fail(`nearest window missing: ${res.error}`);
  },
  'cut-digest-mismatch-names-versions': fixtureMissCase(
    'haiku',
    'cutDigest',
    'tampered',
    ['cutDigest'],
    [process.versions.node, process.versions.icu ?? ''],
  ),
  'key-is-sha256-hex': async (ctx) => {
    const { files } = threeFiles(ctx);
    const rec = await record(files, 'haiku', fakeTransport(), { labelsYaml: TWO_SETS_YAML }, ctx);
    must(rec, 'record');
    const keys = lines(rec.cassette ?? '').map((l) => (JSON.parse(l) as { key?: string }).key);
    if (keys.length === 0) return fail('the cassette holds no entry');
    if (keys.some((k) => typeof k !== 'string' || !/^[0-9a-f]{64}$/.test(k)))
      return fail(
        `a key is not 64 hex characters: ${JSON.stringify(keys.find((k) => !/^[0-9a-f]{64}$/.test(String(k))))}`,
      );
    return new Set(keys).size === keys.length ? pass(`${keys.length} keys`) : fail('two entries share a key');
  },
  'key-ignores-threshold': async (ctx) => {
    const { fixture } = await positiveReplay(ctx, 'jev');
    const { res, fake } = await replay(
      ctx,
      fixture.files,
      'jev',
      fixture.cassette,
      { labelsYaml: fixture.labelsYaml },
      0.9,
    );
    requireFixtureLabels(res, fixture);
    return fake.count === 0 ? pass('threshold is outside key') : fail('threshold change called transport');
  },
  'key-ignores-clone-path': async (ctx) => {
    const { fixture, res: a } = await positiveReplay(ctx);
    const { res: b } = await replay(ctx, fixture.files, 'haiku', fixture.cassette, {
      labelsYaml: fixture.labelsYaml,
      location: { parent: 'different-parent', name: 'clone' },
    });
    requireFixtureLabels(b, fixture);
    return a.ledger?.raw === b.ledger?.raw ? pass('same ledger') : fail('clone path changed ledger');
  },
  'key-ignores-yaml-formatting': async (ctx) => {
    const { fixture } = await positiveReplay(ctx);
    const { res, fake } = await replay(ctx, fixture.files, 'haiku', fixture.cassette, {
      labelsYaml: `# only formatting\n${fixture.labelsYaml.replace('set: probe', 'set: "probe"')}`,
    });
    requireFixtureLabels(res, fixture);
    return fake.count === 0 ? pass('format-independent') : fail('formatting called transport');
  },
  'cassette-no-file-text': async (ctx) => {
    const { files, texts } = threeFiles(ctx, true);
    const rec = await record(files, 'haiku', fakeTransport(), {}, ctx);
    must(rec, 'record');
    const cassette = rec.cassette ?? '';
    const leaked = texts.flat().find((t) => cassette.includes(/ZQ7-\d+-NOTE/.exec(t)?.[0] ?? '\u0000'));
    return leaked
      ? fail(`unit text reached the cassette: ${show(leaked, 50)}`)
      : pass('no unit token in the cassette');
  },
  'cassette-readable-fields': async (ctx) => {
    const { files } = threeFiles(ctx);
    const rec = await record(files, 'haiku', fakeTransport(), { labelsYaml: RULES_YAML }, ctx);
    must(rec, 'record');
    const want: Array<[string, string[]]> = [
      ['file', ['file', 'path']],
      ['window', ['window']],
      ['prompt version', ['promptversion', 'prompt']],
      ['schema version', ['schemaversion', 'schema']],
      ['set name', ['setname', 'set']],
      ['set hash', ['sethash']],
      ['labeler', ['labeler', 'labeller', 'model']],
      ['cut digest', ['cutdigest']],
    ];
    for (const l of lines(rec.cassette ?? '')) {
      const flat = keysOf(JSON.parse(l));
      for (const [name, aliases] of want) {
        const hit = [...flat].find(
          ([k, v]) =>
            aliases.some((a) => k === a || k.endsWith(`.${a}`)) && typeof v === 'string' && v !== '',
        );
        if (!hit) return fail(`an entry has no readable ${name} (looked for ${aliases.join(', ')})`);
      }
    }
    return pass('every entry readable');
  },
  'cassette-stored-answer': async (ctx) => {
    const { files } = threeFiles(ctx);
    for (const arm of ['haiku', 'jev'] as const) {
      const rec = await record(files, arm, fakeTransport(), { labelsYaml: PROBE_YAML }, ctx);
      must(rec, `${arm} record`);
      for (const l of lines(rec.cassette ?? '')) {
        const flat = [...keysOf(JSON.parse(l)).keys()];
        const has = (alias: string) => flat.some((k) => k.includes(alias));
        const need = arm === 'haiku' ? ['labels'] : ['probabilit'];
        for (const n of [...need, 'model', 'stop', 'usage'])
          if (!has(n)) return fail(`a ${arm} entry stores no ${n}`);
      }
    }
    return pass('labels or probabilities, model, stop reason and usage stored');
  },
  'model-mismatch-warns': async (ctx) => {
    const { fixture } = await positiveReplay(ctx);
    const rows = structuredClone(fixture.rows).slice(1);
    for (const row of rows) row.answer.returnedModel = 'm-1';
    const res = await ctx.sut.scan({
      files: fixture.files,
      labelsYaml: fixture.labelsYaml,
      model: { arm: 'haiku', transport: fakeTransport({ model: 'm-2' }) },
      cassette: {
        mode: 'record',
        text: rows
          .map((r) => JSON.stringify(r))
          .concat('')
          .join('\n'),
      },
    });
    if (!res.ok) return fail(`re-record failed: ${res.error}`);
    return res.warnings?.some((w) => w.includes('m-1') && w.includes('m-2'))
      ? pass('both model IDs named')
      : fail('returned-model warning missing');
  },
  'carry-forward-needs-only-dirty-entries': async (ctx) => {
    const { fixture, res: before } = await positiveReplay(ctx);
    const documents = structuredClone(fixture.documents);
    const dirty = documents[1];
    if (!dirty) return fail('fixture lacks second file');
    dirty.units = dirty.units.map((u) => ({
      ...u,
      text: u.text.replace(/\.$/, ' beside the red notebook.'),
    }));
    const changed = makeFixture('haiku', documents, fixture.labelsYaml);
    const onlyDirty = changed.rows
      .filter((r) => r.readable.path === dirty.path)
      .map((r) => JSON.stringify(r))
      .concat('')
      .join('\n');
    const { res, fake } = await replay(ctx, changed.files, 'haiku', onlyDirty, {
      labelsYaml: fixture.labelsYaml,
      previousLedger: must(before, 'baseline replay'),
    });
    requireFixtureLabels(res, changed);
    return fake.count === 0 ? pass('only dirty file entry needed') : fail('carry-forward called transport');
  },
  'fresh-replay-needs-all-entries': async (ctx) => {
    const { fixture } = await positiveReplay(ctx);
    const { res, fake } = await replay(
      ctx,
      fixture.files,
      'haiku',
      fixture.rows
        .slice(1)
        .map((r) => JSON.stringify(r))
        .concat('')
        .join('\n'),
      { labelsYaml: fixture.labelsYaml },
    );
    return !res.ok && fake.count === 0 && /window|#\d/i.test(res.error ?? '')
      ? pass('missing window named')
      : fail('fresh replay did not reject missing entry');
  },
  'failed-recording-keeps-valid-cassette': async (ctx) => {
    const { files } = threeFiles(ctx);
    let n = 0;
    const base = fakeTransport();
    const flaky = ((r: FetchRequest) => {
      n += 1;
      if (n === 2) throw new Error('network down');
      return base(r);
    }) as FakeTransport;
    const failedRun = await ctx.sut.scan({
      files,
      model: { arm: 'haiku', transport: flaky },
      cassette: { mode: 'record' },
    });
    if (failedRun.ok) return fail('a transport failure did not fail the scan');
    const text = failedRun.cassette ?? '';
    const entries = lines(text);
    if (entries.length !== 1)
      return fail(`the cassette of the failed run holds ${entries.length} entries, expected 1`);
    try {
      for (const l of entries) JSON.parse(l);
    } catch {
      return fail('the cassette of the failed run is not valid JSON lines');
    }
    const fixture = loadFixture('haiku');
    const fake = fakeTransport();
    const again = await ctx.sut.scan({
      files: fixture.files,
      labelsYaml: fixture.labelsYaml,
      model: { arm: 'haiku', transport: fake },
      cassette: { mode: 'record', text: `${JSON.stringify(fixture.rows[0])}\n` },
    });
    if (!again.ok) return fail(`the second record run failed: ${again.error}`);
    return fake.count === 2
      ? pass('one entry kept, two calls to finish')
      : fail(`${fake.count} calls to finish a 3 window recording with 1 entry, expected 2`);
  },
  'answers-frozen-despite-random-transport': async (ctx) => {
    const { fixture, res: baseline } = await positiveReplay(ctx);
    for (let i = 0; i < 2; i++) {
      const wild = fakeTransport({ truth: () => (Math.random() < 0.5 ? 'rule' : 'prohibition') });
      const res = await ctx.sut.scan({
        files: fixture.files,
        labelsYaml: fixture.labelsYaml,
        model: { arm: 'haiku', transport: wild },
        cassette: { mode: 'replay', text: fixture.cassette },
      });
      requireFixtureLabels(res, fixture);
      if (wild.count || res.ledger?.raw !== baseline.ledger?.raw)
        return fail('replay used random transport or changed ledger');
    }
    return pass('committed answers stay frozen');
  },
  'jsonl-format': async (ctx) => {
    const { files } = threeFiles(ctx);
    const rec = await record(files, 'haiku', fakeTransport(), {}, ctx);
    must(rec, 'record');
    const text = rec.cassette ?? '';
    if (!text.endsWith('\n')) return fail('the cassette does not end with a newline');
    if (
      text
        .split('\n')
        .slice(0, -1)
        .some((l) => l.trim() === '')
    )
      return fail('the cassette holds a blank line');
    for (const l of lines(text)) {
      const v = JSON.parse(l);
      if (v === null || typeof v !== 'object' || Array.isArray(v)) return fail('a line is not a JSON object');
    }
    return pass(`${lines(text).length} lines`);
  },
  'one-cassette-per-arm': async (ctx) => {
    const { fixture } = await positiveReplay(ctx, 'jev-unit');
    const other = loadFixture('haiku');
    const { res, fake } = await replay(ctx, fixture.files, 'jev-unit', other.cassette, {
      labelsYaml: fixture.labelsYaml,
    });
    return !res.ok && fake.count === 0 && mentions(res.error, ['labeler', 'model'])
      ? pass('own fixture works, other arm refused')
      : fail('wrong arm accepted or unnamed');
  },
  'replay-env-independent': async (ctx) => {
    const { fixture, res } = await positiveReplay(ctx);
    const files = fixture.files;
    const ledger = must(res, 'committed replay');
    const envs: Array<{ env: Record<string, string>; cwdName: string }> = [
      { env: { TZ: 'UTC', LANG: 'en_US.UTF-8' }, cwdName: 'one' },
      { env: { TZ: 'Asia/Kolkata', LANG: 'tr_TR.UTF-8', LC_ALL: 'tr_TR.UTF-8' }, cwdName: 'two' },
      { env: { TZ: 'America/Sao_Paulo', LANG: 'C' }, cwdName: 'three' },
    ];
    for (const e of envs) {
      const out = await runChild(
        {
          kind: 'scan',
          files,
          labelsYaml: fixture.labelsYaml,
          model: { arm: 'haiku' },
          cassette: { mode: 'replay', text: fixture.cassette },
        },
        e,
      );
      try {
        const r = out.output?.ok ? (out.output.result as ScanResult) : undefined;
        if (!r?.ok)
          return fail(
            `a child replay failed: ${out.output && !out.output.ok ? out.output.error : (r?.error ?? out.stderr.slice(0, 200))}`,
          );
        requireFixtureLabels(r, fixture);
        if (r.ledger?.raw !== ledger)
          return fail(`the replay under ${JSON.stringify(e.env)} differs from the recording`);
      } finally {
        out.cleanup();
      }
    }
    return pass('three environments, one ledger');
  },
};
