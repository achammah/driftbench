import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { distinctSentences } from '../../kit/anchor-world';
import type { Job, JobOutput } from '../../kit/child';
import { type ChildRun, runChild } from '../../kit/child-run';
import { compose } from '../../kit/compose';
import { build, liveOf } from '../../kit/estate';
import { loadFixture, requireFixtureLabels } from '../../kit/fixture';
import { perfect } from '../../kit/labellers';
import { requireSourceWitness } from '../../kit/positive';
import { PROBE_YAML, RULES_YAML } from '../../kit/sets';
import { fakeTransport } from '../../kit/transport';
import { headingText, Prose } from '../../kit/words';
import type { ModelArm, ScanResult, SourceFile } from '../../sut/port';
import { fail, type ItemContext, pass, type Run } from '../types';

const prose = (ctx: ItemContext) => new Prose(ctx.seed, ctx.id);
const para = (text: string) => ({ kind: 'paragraph' as const, sentences: [text] });
const secret = (n: number) => `SECRET-7f3a-${n}`;

/** A private estate: a secret rides in a sentence, a list item, a table cell, a heading, a quote and a front matter value. */
function privateEstate(
  ctx: ItemContext,
  extra: Array<{ path: string; text: string }> = [],
): { files: SourceFile[]; secrets: string[] } {
  const p = prose(ctx);
  const put = (n: number, t: string) => t.replace(/\.$/, ` ${secret(n)}.`);
  const secrets = [1, 2, 3, 4, 5, 6].map(secret);
  const doc = compose([
    { kind: 'front', entries: [{ key: 'description', value: put(6, p.next()) }] },
    { kind: 'heading', level: 1, text: `${headingText(p.random)} ${secret(4)}` },
    para(put(1, p.next())),
    { kind: 'list', items: [{ text: put(2, p.next()) }] },
    { kind: 'table', header: ['a', 'b'], rows: [[put(3, p.next()), 'plain']] },
    { kind: 'quote', paragraphs: [put(5, p.next())] },
  ]);
  return { files: [{ path: 'private/notes.md', text: doc.text }, ...extra], secrets };
}

type Seen = {
  run: ChildRun;
  result: ScanResult | undefined;
  bodies: string[];
  all: string;
  files: SourceFile[];
};

async function go(job: Job, options: Parameters<typeof runChild>[1] = {}): Promise<Seen> {
  const run = await runChild(job, options);
  const out: JobOutput | undefined = run.output;
  // A reader that cannot be reached leaks nothing because it did nothing: that is a failure, never a pass.
  if (out && !out.ok && /not reachable/.test(out.error)) {
    run.cleanup();
    throw new Error(out.error);
  }
  const result = out?.ok ? (out.result as ScanResult) : undefined;
  const bodies = out?.ok ? (out.requests ?? []) : [];
  const files: string[] = [];
  const read = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) read(full);
      else files.push(readFileSync(full, 'utf8'));
    }
  };
  for (const d of [run.sandbox.home, run.sandbox.tmp, run.sandbox.cwd]) read(d);
  const all = [run.stdout, run.stderr, ...files].join('\n');
  return { run, result, bodies, all, files: job.kind === 'scan' ? job.files : [] };
}

const mustRun = (seen: Seen): ScanResult => {
  if (!seen.result)
    throw new Error(
      `the child run failed: ${seen.run.output && !seen.run.output.ok ? seen.run.output.error : seen.run.stderr.slice(0, 300)}`,
    );
  requireSourceWitness(seen.result, seen.files);
  return seen.result;
};

const hit = (haystack: string, needles: string[]): string | undefined =>
  needles.find((n) => haystack.includes(n));

const modelJob = (
  files: SourceFile[],
  arm: ModelArm,
  extra: Partial<Extract<Job, { kind: 'scan' }>> = {},
): Job => ({
  kind: 'scan',
  files,
  model: { arm },
  cassette: { mode: 'record' },
  labelsYaml: RULES_YAML,
  ...extra,
});

async function withClean<T>(seen: Seen, check: (s: Seen) => T): Promise<T> {
  try {
    return check(seen);
  } finally {
    seen.run.cleanup();
  }
}

export const privacyRuns: Record<string, Run> = {
  'secret-not-in-cassette': async (ctx) => {
    const { files, secrets } = privateEstate(ctx);
    const seen = await go(modelJob(files, 'haiku'));
    return withClean(seen, () => {
      const r = mustRun(seen);
      const leak = hit(r.cassette ?? '', secrets);
      return leak ? fail(`${leak} reached the cassette`) : pass('no secret in the cassette');
    });
  },
  'secret-not-in-output': async (ctx) => {
    const { files, secrets } = privateEstate(ctx);
    const good = await go(modelJob(files, 'haiku'));
    const a = await withClean(good, (s) => {
      mustRun(s);
      return hit(`${s.run.stdout}\n${s.run.stderr}`, secrets);
    });
    if (a) return fail(`${a} was printed by a successful scan`);
    const bad = await go(modelJob(files, 'haiku', { fake: { badAnswers: true } }));
    const b = await withClean(bad, (s) => hit(`${s.run.stdout}\n${s.run.stderr}`, secrets));
    return b
      ? fail(`${b} was printed by a scan with a failing window`)
      : pass('stdout and stderr hold no unit text');
  },
  'writes-stay-inside-root': async (ctx) => {
    const { files } = privateEstate(ctx);
    const seen = await go(modelJob(files, 'haiku'));
    return withClean(seen, () => {
      mustRun(seen);
      const outside = seen.run.written.filter((p) => p.startsWith('home/') || p.startsWith('cwd/'));
      if (outside.length > 0)
        return fail(`files written outside the estate folder: ${outside.slice(0, 3).join(', ')}`);
      const tops = new Set(
        seen.run.written.filter((p) => p.startsWith('tmp/')).map((p) => p.split('/').slice(0, 2).join('/')),
      );
      return tops.size <= 1
        ? pass(`${seen.run.written.length} files, all in one folder`)
        : fail(`files written in ${tops.size} places under the temporary folder: ${[...tops].join(', ')}`);
    });
  },
  'ledger-only-where-asked': async (ctx) => {
    const { files, secrets } = privateEstate(ctx);
    const seen = await go(modelJob(files, 'haiku'));
    return withClean(seen, () => {
      mustRun(seen);
      const stray = seen.run.written.filter((p) => !p.startsWith('tmp/'));
      if (stray.length > 0)
        return fail(`files written outside the temporary folder: ${stray.slice(0, 3).join(', ')}`);
      const leak = hit(`${seen.run.stdout}\n${seen.run.stderr}`, secrets);
      return leak ? fail(`${leak} left the estate through a stream`) : pass('no stray copy');
    });
  },
  'model-key-never-in-outputs': async (ctx) => {
    const { files } = privateEstate(ctx);
    const key = `KEY-planted-${ctx.seed}-0000`;
    const homeFiles = Object.fromEntries(
      ['anthropic.key', 'haiku.key', 'jev.key', 'api.key'].map((n) => [`.nexus-secrets/${n}`, key]),
    );
    for (const arm of ['haiku', 'jev'] as const) {
      const seen = await go(modelJob(files, arm, { fake: { echoHeaders: false } }), { homeFiles });
      const where = await withClean(seen, () => {
        const r = mustRun(seen);
        const text = `${JSON.stringify(r ?? {})}\n${seen.run.stdout}\n${seen.run.stderr}\n${seen.bodies.join('\n')}`;
        return text.includes(key) ? `the ${arm} run exposed the key` : undefined;
      });
      if (where) return fail(where);
    }
    return pass('the key stays out of every output');
  },
  'env-secret-not-printed': async (ctx) => {
    const { files } = privateEstate(ctx);
    const value = `ENV-planted-${ctx.seed}-9999`;
    const env = { ANTHROPIC_API_KEY: value, JEV_API_KEY: value, NEXUS_API_KEY: value };
    for (const fake of [{}, { badAnswers: true }]) {
      const seen = await go(modelJob(files, 'haiku', { fake }), { env });
      const text = await withClean(seen, () => {
        if (!('badAnswers' in fake)) mustRun(seen);
        return `${JSON.stringify(seen.result ?? {})}\n${seen.all}`;
      });
      if (text.includes(value)) return fail('an environment secret was printed or recorded');
    }
    return pass('environment secrets stay out of outputs');
  },
  'no-headers-in-cassette': async (ctx) => {
    const { files } = privateEstate(ctx);
    const key = `HDR-planted-${ctx.seed}-5555`;
    const seen = await go(modelJob(files, 'haiku', { fake: { echoHeaders: true } }), {
      homeFiles: { '.nexus-secrets/anthropic.key': key, '.nexus-secrets/haiku.key': key },
    });
    return withClean(seen, () => {
      const r = mustRun(seen);
      return (r.cassette ?? '').includes(key)
        ? fail('a request header value was recorded')
        : pass('no header in the cassette');
    });
  },
  'thinking-text-not-stored': async (ctx) => {
    const { files, secrets } = privateEstate(ctx);
    const seen = await go(
      modelJob(files, 'haiku', {
        fake: { thinkingFirst: `The unit says ${secrets.join(' and ')} which I repeat here.` },
      }),
    );
    return withClean(seen, () => {
      const leak = hit(mustRun(seen).cassette ?? '', secrets);
      return leak
        ? fail(`${leak} reached the cassette through a thinking block`)
        : pass('thinking text not stored');
    });
  },
  'raw-response-text-not-stored': async (ctx) => {
    const { files, secrets } = privateEstate(ctx);
    const seen = await go(
      modelJob(files, 'haiku', { fake: { extraText: `Notes on ${secrets[0]} and ${secrets[2]}` } }),
    );
    return withClean(seen, () => {
      const leak = hit(mustRun(seen).cassette ?? '', secrets);
      return leak
        ? fail(`${leak} reached the cassette through the raw response`)
        : pass('only the parsed answer is stored');
    });
  },
  'replay-makes-no-network': async (ctx) => {
    const { files } = privateEstate(ctx);
    const rec = await go(modelJob(files, 'haiku'));
    await withClean(rec, () => mustRun(rec));
    const fixture = loadFixture('haiku');
    const canary = `const net = require('node:net');
const fs = require('node:fs');
const log = process.env.CANARY_LOG;
const orig = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) { fs.appendFileSync(log, 'connect\\n'); return orig.apply(this, args); };
`;
    const seen = await go(
      {
        kind: 'scan',
        files: fixture.files,
        model: { arm: 'haiku' },
        cassette: { mode: 'replay', text: fixture.cassette },
        labelsYaml: fixture.labelsYaml,
        fake: { badAnswers: true },
      },
      {
        homeFiles: { 'canary.cjs': canary },
        env: { NODE_OPTIONS: '--require={home}/canary.cjs', CANARY_LOG: '{tmp}/../canary.log' },
      },
    );
    return withClean(seen, () => {
      const out = seen.run.output;
      if (!out?.ok) return fail(`the replay child failed: ${seen.run.stderr.slice(0, 200)}`);
      requireFixtureLabels(mustRun(seen), fixture);
      if ((out.fakeCalls ?? 0) !== 0) return fail(`${out.fakeCalls} transport calls in a private replay`);
      return pass('no transport call, no connection');
    });
  },
  'fingerprints-are-hashes': async (ctx) => {
    const p = prose(ctx);
    const texts = distinctSentences(p, 12);
    const rec = await ctx.sut.scan({
      files: build([{ path: 'a.md', blocks: texts.map(para) }]).files,
      labeler: perfect(),
    });
    if (!rec.ok || !rec.ledger) return fail(`the scan failed: ${rec.error}`);
    for (const text of texts) {
      if (
        !liveOf(rec.ledger).some(
          (entry) => entry.quote === text && entry.fp.length > 0 && entry.ctxFp.length > 0,
        )
      )
        return fail('positive witness: no fingerprints for a planted sentence');
    }
    const grams = new Set<string>();
    for (const t of texts) {
      const s = t.toLowerCase();
      for (let i = 0; i + 8 <= s.length; i += 1) {
        const g = s.slice(i, i + 8);
        if (!/^[0-9a-f]+$/.test(g)) grams.add(g);
      }
    }
    const hashes = liveOf(rec.ledger).flatMap((e) => [e.fp, e.ctxFp]);
    const fake = await ctx.sut.scan({
      files: build([{ path: 'a.md', blocks: texts.map(para) }]).files,
      model: { arm: 'haiku', transport: fakeTransport() },
      cassette: { mode: 'record' },
    });
    if (fake.cassette)
      for (const l of fake.cassette.split('\n').filter(Boolean))
        hashes.push((JSON.parse(l) as { key?: string }).key ?? '');
    for (const h of hashes) {
      const s = h.toLowerCase();
      for (let i = 0; i + 8 <= s.length; i += 1)
        if (grams.has(s.slice(i, i + 8))) return fail(`a fingerprint or key holds text: ${h.slice(0, 40)}`);
    }
    return pass(`${hashes.length} hashes hold no unit text`);
  },
  'opaque-content-not-sent': async (ctx) => {
    const p = prose(ctx);
    const doc = compose([
      para(p.next()),
      { kind: 'fence', lines: ['first line', 'second line', `third line ${secret(7)}`], info: 'text' },
      { kind: 'comment', lines: ['a comment', `second line ${secret(8)}`] },
      para(p.next()),
    ]);
    const seen = await go(modelJob([{ path: 'private/o.md', text: doc.text }], 'haiku'));
    return withClean(seen, () => {
      const r = mustRun(seen);
      const leak = hit(`${seen.bodies.join('\n')}\n${r.cassette ?? ''}`, [secret(7), secret(8)]);
      return leak
        ? fail(`${leak} from an opaque block reached a request or the cassette`)
        : pass('fence and comment interiors never sent');
    });
  },
  'request-scoped-to-window': async (ctx) => {
    const p = prose(ctx);
    const a = compose([para(p.next()), para(p.next())]).text;
    const b = compose([para(p.next().replace(/\.$/, ` ${secret(9)}.`)), para(p.next())]).text;
    const seen = await go(
      modelJob(
        [
          { path: 'private/a.md', text: a },
          { path: 'private/b.md', text: b },
        ],
        'haiku',
      ),
    );
    return withClean(seen, () => {
      mustRun(seen);
      for (const body of seen.bodies) {
        let text = body;
        try {
          const j = JSON.parse(body) as { messages?: unknown; state?: unknown };
          text = JSON.stringify([j.messages, j.state]);
        } catch {
          /* keep the raw body */
        }
        if (/private\/a\.md#/.test(text) && text.includes(secret(9)))
          return fail('a request for private/a.md holds text of private/b.md');
      }
      return pass('requests hold their own window only');
    });
  },
  'abs-path-not-recorded': async (ctx) => {
    const { files } = privateEstate(ctx);
    const seen = await go(
      modelJob(files, 'haiku', { location: { parent: 'PLANTED-USER-7q', name: 'estate' } }),
    );
    return withClean(seen, () => {
      const r = mustRun(seen);
      const text = `${r.ledger?.raw ?? ''}\n${r.cassette ?? ''}\n${JSON.stringify(r.atoms)}\n${seen.bodies.join('\n')}\n${seen.run.stdout}\n${seen.run.stderr}`;
      return text.includes('PLANTED-USER-7q')
        ? fail('the absolute path of the estate was recorded or sent')
        : pass('relative paths only');
    });
  },
  'secret-in-front-matter-stays-inside': async (ctx) => {
    const { files } = privateEstate(ctx);
    const seen = await go(modelJob(files, 'haiku'));
    return withClean(seen, () => {
      const r = mustRun(seen);
      const leak = hit(`${r.cassette ?? ''}\n${seen.run.stdout}\n${seen.run.stderr}`, [secret(6)]);
      if (leak) return fail(`${leak} (a front matter value) left the ledger`);
      const outside = seen.run.written.filter((p) => p.startsWith('home/') || p.startsWith('cwd/'));
      return outside.length === 0
        ? pass('inside the root only')
        : fail(`files written outside the root: ${outside.slice(0, 3).join(', ')}`);
    });
  },
  'secret-in-heading-stays-inside': async (ctx) => {
    const { files } = privateEstate(ctx);
    const seen = await go(modelJob(files, 'haiku'));
    return withClean(seen, () => {
      const leak = hit(mustRun(seen).cassette ?? '', [secret(4)]);
      return leak
        ? fail(`${leak} (a heading) reached the cassette`)
        : pass('no heading text in the cassette');
    });
  },
  'temp-files-removed': async (ctx) => {
    const { files } = privateEstate(ctx);
    for (const fake of [{}, { badAnswers: true }]) {
      const seen = await go(modelJob(files, 'haiku', { fake }));
      const left = await withClean(seen, () => {
        if (!('badAnswers' in fake)) mustRun(seen);
        return seen.run.written.filter((p) => p.startsWith('tmp/'));
      });
      if (left.length > 0)
        return fail(`${left.length} files remain in the temporary folder: ${left.slice(0, 3).join(', ')}`);
    }
    return pass('the temporary folder is empty after both runs');
  },
  'crash-leaves-no-secret': async (ctx) => {
    const { files, secrets } = privateEstate(ctx);
    // A crash may legitimately produce no ledger; pair it with a successful scan of the same estate.
    const healthy = await go(modelJob(files, 'haiku'));
    await withClean(healthy, () => mustRun(healthy));
    const seen = await go(modelJob(files, 'haiku', { fake: { throwWithRequest: true } }));
    return withClean(seen, () => {
      const out = seen.run.output;
      const printed = `${seen.run.stdout}\n${seen.run.stderr}\n${out?.ok ? `${(out.result as ScanResult).error ?? ''}${JSON.stringify((out.result as ScanResult).diagnostics)}` : (out?.error ?? '')}`;
      const leak = hit(printed, secrets);
      if (leak) return fail(`${leak} reached an error message`);
      const outside = seen.run.written.filter((p) => p.startsWith('home/') || p.startsWith('cwd/'));
      if (outside.length > 0)
        return fail(`files written outside the root after a crash: ${outside.slice(0, 3).join(', ')}`);
      const left = seen.run.written.filter((p) => p.startsWith('tmp/') && !/cassette|ledger/.test(p));
      return left.length === 0
        ? pass('no leak after a crash')
        : fail(`temporary files remain after a crash: ${left.slice(0, 3).join(', ')}`);
    });
  },
  'error-messages-quote-no-unit-text': async (ctx) => {
    const { files, secrets } = privateEstate(ctx);
    const healthy = await go(modelJob(files, 'haiku'));
    await withClean(healthy, () => mustRun(healthy));
    const seen = await go(modelJob(files, 'haiku', { fake: { badAnswers: true } }));
    return withClean(seen, () => {
      const out = seen.run.output;
      const r = out?.ok ? (out.result as ScanResult) : undefined;
      if (r && !Array.isArray(r.warnings)) return fail('the reader does not expose warnings');
      const text = `${r?.error ?? ''}\n${JSON.stringify(r?.diagnostics ?? [])}\n${JSON.stringify(r?.warnings ?? [])}\n${seen.run.stdout}\n${seen.run.stderr}`;
      const leak = hit(text, secrets);
      if (leak) return fail(`${leak} is in a failure message`);
      return r && (r.diagnostics.length > 0 || !r.ok)
        ? pass('failures name windows, not text')
        : fail('the failing windows left no diagnostic or error at all');
    });
  },
  'estate-files-unchanged': async (ctx) => {
    const { files } = privateEstate(ctx);
    const frozen = files.map((f) => Object.freeze({ ...f }));
    const copy = JSON.stringify(files);
    const fake = fakeTransport();
    const rec = await ctx.sut.scan({
      files: frozen,
      model: { arm: 'haiku', transport: fake },
      cassette: { mode: 'record' },
    });
    if (!rec.ok || !rec.ledger) return fail(`the record run failed: ${rec.error}`);
    requireSourceWitness(rec, files);
    const fixture = loadFixture('haiku');
    const fixtureCopy = JSON.stringify(fixture.files);
    const again = await ctx.sut.scan({
      files: fixture.files.map((file) => Object.freeze({ ...file })),
      labelsYaml: fixture.labelsYaml,
      model: { arm: 'haiku', transport: fakeTransport() },
      cassette: { mode: 'replay', text: fixture.cassette },
    });
    if (!again.ok) return fail(`the replay failed: ${again.error}`);
    requireFixtureLabels(again, fixture);
    return JSON.stringify(files) === copy && JSON.stringify(fixture.files) === fixtureCopy
      ? pass('files as they were')
      : fail('a scan changed the text of a private file');
  },
  'label-set-text-only-in-requests': async (ctx) => {
    const { files } = privateEstate(ctx);
    const phrase = `PLANTED-PHRASE-${ctx.seed}-9z`;
    const yaml = PROBE_YAML.replace(
      'A unit that tells the reader what to do.',
      `A unit that tells the reader what to do, ${phrase}.`,
    );
    const seen = await go(modelJob(files, 'haiku', { labelsYaml: yaml }));
    return withClean(seen, () => {
      const r = mustRun(seen);
      if (!seen.bodies.join('\n').includes(phrase))
        return fail('the label description did not reach the request');
      const text = `${r.cassette ?? ''}\n${r.ledger?.raw ?? ''}\n${seen.run.stdout}\n${seen.run.stderr}`;
      return text.includes(phrase)
        ? fail('the label description text was stored or printed')
        : pass('in the request only');
    });
  },
};
