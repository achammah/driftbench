import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { findSpecFiles, isPlainObject, loadSpecFile, parseSpecText } from '@agent-nexus/driftbench-core';
import { StaticTest, shortQuote } from '@agent-nexus/driftbench-generate';
import { parseDocument } from 'yaml';
import { z } from 'zod';
import { estatePath } from '../paths';
import { AtomKind } from '../schema';
import { type EstateDiff, GuardMode } from './diff';
import { guardNeed } from './guards';
import { Regression, regressionNeeds, renderRegression } from './regression';

/**
 * The impact of an estate diff on the tests written for the estate. Tests index by atom id: a spec names the
 * atoms it covers under `metadata.estate.atoms`. For the diff:
 * - regenerate: every test that names an atom whose meaning changed (semantic), a restated atom, or a
 *   removed atom while it still names others, or a renamed atom (the same atom under another id); the
 *   generator writes it again;
 * - re-approve: every atom whose meaning changed (a semantic change); its phrasings wait for a person;
 * - retire: every test whose atoms are all removed, with the reason `atom <id> removed` written into the
 *   spec's metadata as `retired` (on `--write`);
 * - new: every added atom no live test names; its tests are generated and wait for approval.
 * A moved atom (the same quote at another span) and an atom whose quote changed in white space only touch
 * no test: a change reruns only what it can affect. A spec already carrying `metadata.retired`
 * is not a live test: it is counted and left alone.
 *
 * A static test (an invariant or a setting, a JSON record beside the specs) names the one atom it checks and
 * is a test like any spec: it is indexed, regenerated and retired with the atoms it names. Its retirement
 * reason is the record's own `retired` field.
 */

export const EstateTestMeta = z.looseObject({
  atoms: z.array(z.string().min(1)).min(1).describe('The atom ids the test covers'),
});

export type EstateTest = {
  id: string;
  /** The spec file, as found. */
  path: string;
  /** Explicit boundary retained for retirement writes. */
  root?: string;
  /** The spec file relative to the tests folder. */
  file: string;
  atoms: string[];
  /** The retirement reason, when the spec already carries one. */
  retired?: string;
};

export type LoadedTests = { ok: true; tests: EstateTest[]; others: number } | { ok: false; errors: string[] };

/** The JSON files under a folder, sorted: where static tests are looked for. */
async function jsonFilesUnder(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await jsonFilesUnder(full)));
    else if (/\.json$/i.test(entry.name)) found.push(full);
  }
  return found.sort();
}

/** Reads every spec under a folder; the specs with `metadata.estate.atoms` are the estate tests. */
export async function loadEstateTests(dir: string): Promise<LoadedTests> {
  const info = await stat(dir).catch(() => undefined);
  if (!info?.isDirectory()) return { ok: false, errors: [`${dir} is not a folder`] };
  const tests: EstateTest[] = [];
  const errors: string[] = [];
  let others = 0;
  for (const path of await jsonFilesUnder(dir)) {
    let raw: unknown;
    let safe: string;
    try {
      safe = await estatePath(dir, relative(dir, path));
    } catch (cause) {
      errors.push(`${relative(dir, path)}: ${String(cause)}`);
      continue;
    }
    try {
      raw = JSON.parse(await readFile(safe, 'utf8'));
    } catch {
      continue;
    }
    const record = StaticTest.safeParse(raw);
    if (!record.success) continue;
    tests.push({
      id: record.data.id,
      path,
      root: dir,
      file: relative(dir, path),
      atoms: [record.data.atom],
      ...(record.data.retired === undefined ? {} : { retired: record.data.retired }),
    });
  }
  for (const path of await findSpecFiles([dir])) {
    const file = relative(dir, path);
    let safe: string;
    try {
      safe = await estatePath(dir, file);
    } catch (cause) {
      errors.push(`${file}: ${String(cause)}`);
      continue;
    }
    const loaded = await loadSpecFile(safe);
    if (!loaded.ok) {
      for (const issue of loaded.errors) {
        errors.push(`${file}: ${issue.code}${issue.path ? ` ${issue.path}` : ''}: ${issue.message}`);
      }
      continue;
    }
    const metadata = loaded.spec.metadata ?? {};
    if (metadata.estate === undefined) {
      others++;
      continue;
    }
    const meta = EstateTestMeta.safeParse(metadata.estate);
    if (!meta.success) {
      errors.push(`${file}: metadata.estate needs atoms, a list of atom ids`);
      continue;
    }
    const retired = metadata.retired;
    if (retired !== undefined && typeof retired !== 'string') {
      errors.push(`${file}: metadata.retired is the retirement reason, a string`);
      continue;
    }
    tests.push({
      id: loaded.spec.id,
      path,
      root: dir,
      file,
      atoms: meta.data.atoms,
      ...(retired === undefined ? {} : { retired }),
    });
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, tests, others };
}

export const RegenerateWhy = z.enum([
  'whitespace',
  'semantic',
  'restated',
  'removed',
  'renamed',
  'guard_state',
]);
export type RegenerateWhy = z.infer<typeof RegenerateWhy>;

export const ImpactReport = z.strictObject({
  version: z.literal(1),
  diff: z.strictObject({ old: z.string().min(1), new: z.string().min(1) }),
  tests: z.strictObject({
    live: z.number().int().min(0),
    retired: z.number().int().min(0).describe('Estate tests already retired before this diff'),
    other: z.number().int().min(0).describe('Specs with no metadata.estate'),
  }),
  regenerate: z.array(
    z.strictObject({
      test: z.string().min(1),
      file: z.string().min(1),
      atoms: z.array(z.strictObject({ atom: z.string().min(1), why: RegenerateWhy })).min(1),
    }),
  ),
  reapprove: z.array(
    z.strictObject({
      atom: z.string().min(1),
      kind: AtomKind,
      title: z.string().min(1),
      quote: z.string(),
      tests: z.array(z.string()),
    }),
  ),
  retire: z.array(
    z.strictObject({
      test: z.string().min(1),
      file: z.string().min(1),
      atoms: z.array(z.string().min(1)).min(1),
      reason: z.string().min(1),
      state: z.enum(['to_write', 'written', 'already']),
    }),
  ),
  new: z.array(
    z.strictObject({
      atom: z.string().min(1),
      kind: AtomKind,
      title: z.string().min(1),
      file: z.string().min(1),
      line: z.number().int().min(1),
    }),
  ),
  guards: z
    .array(
      z.strictObject({
        guard: z.string().min(1),
        move: z.enum(['promoted', 'demoted', 'added', 'removed']),
        from: GuardMode.nullable(),
        to: GuardMode.nullable(),
        tests: z
          .array(z.string())
          .describe('Live tests that name the guard; a new mode changes their verdict'),
        need: z.string().nullable().describe('What a person must decide, if anything'),
      }),
    )
    .describe('Guards whose enforcement state changed'),
  unaffected: z.strictObject({
    moved: z.number().int().min(0).describe('Atoms moved with the same quote: no test changes'),
    tests: z.number().int().min(0).describe('Live tests the diff does not touch'),
  }),
  regression: Regression.optional().describe('The replay of the corpus with the suite, when asked'),
  needsPerson: z.array(z.string()),
});
export type ImpactReport = z.infer<typeof ImpactReport>;

export function retirementReason(atoms: readonly string[]): string {
  return atoms.map((atom) => `atom ${atom} removed`).join('; ');
}

export type ImpactOptions = {
  /** Specs read beside the estate tests that carry no `metadata.estate`. */
  others?: number;
  /** The replay of the corpus, compared with the stored previous replay. */
  regression?: Regression;
};

export function estateImpact(
  diff: EstateDiff,
  tests: readonly EstateTest[],
  options: ImpactOptions = {},
): ImpactReport {
  const why = new Map<string, RegenerateWhy>();
  // A change of white space alone changes nothing a test checks: its tests stay as they are. Respaced and
  // restated at once, the atom is restated.
  for (const change of diff.atoms.changed) {
    if (change.change === 'semantic') why.set(change.id, 'semantic');
    else if (change.fields.length > 0) why.set(change.id, 'restated');
  }
  for (const entry of diff.atoms.restated) if (!why.has(entry.id)) why.set(entry.id, 'restated');
  const removed = new Set(diff.atoms.removed.map((atom) => atom.id));
  for (const id of removed) why.set(id, 'removed');
  for (const entry of diff.atoms.renamed ?? []) why.set(entry.from, 'renamed');
  for (const entry of diff.guards ?? []) {
    if ((entry.move === 'promoted' || entry.move === 'demoted') && !why.has(entry.guard)) {
      why.set(entry.guard, 'guard_state');
    }
  }

  const live = tests.filter((test) => test.retired === undefined);
  const retiredBefore = tests.length - live.length;
  const regenerate: ImpactReport['regenerate'] = [];
  const retire: ImpactReport['retire'] = [];
  let untouched = 0;

  for (const test of live) {
    const gone = test.atoms.filter((atom) => removed.has(atom));
    if (gone.length > 0 && gone.length === test.atoms.length) {
      retire.push({
        test: test.id,
        file: test.file,
        atoms: gone,
        reason: retirementReason(gone),
        state: 'to_write',
      });
      continue;
    }
    const atoms = test.atoms.flatMap((atom) => {
      const reason = why.get(atom);
      return reason === undefined ? [] : [{ atom, why: reason }];
    });
    if (atoms.length > 0) regenerate.push({ test: test.id, file: test.file, atoms });
    else untouched++;
  }
  for (const test of tests) {
    if (test.retired === undefined) continue;
    const gone = test.atoms.filter((atom) => removed.has(atom));
    if (gone.length > 0 && test.retired === retirementReason(gone)) {
      retire.push({ test: test.id, file: test.file, atoms: gone, reason: test.retired, state: 'already' });
    }
  }

  const testsOf = (atom: string) => live.filter((test) => test.atoms.includes(atom)).map((test) => test.id);
  const reapprove = diff.atoms.changed
    .filter((change) => change.change === 'semantic')
    .map((change) => ({
      atom: change.id,
      kind: change.kind,
      title: change.title,
      quote: change.after.quote,
      tests: testsOf(change.id),
    }));
  const fresh = diff.atoms.added
    .filter((atom) => testsOf(atom.id).length === 0)
    .map((atom) => ({
      atom: atom.id,
      kind: atom.kind,
      title: atom.title,
      file: atom.at.file,
      line: atom.at.startLine,
    }));

  const guards = (diff.guards ?? []).flatMap((entry) =>
    entry.move === 'unchanged'
      ? []
      : [
          {
            guard: entry.guard,
            move: entry.move,
            from: entry.from,
            to: entry.to,
            tests: testsOf(entry.guard),
            need: guardNeed(entry) ?? null,
          },
        ],
  );

  const needsPerson = [
    ...reapprove.map(
      (entry) =>
        `re-approve ${entry.atom}: its meaning changed${entry.tests.length > 0 ? `; ${entry.tests.length} ${entry.tests.length === 1 ? 'test waits' : 'tests wait'}` : ''}`,
    ),
    ...fresh.map((entry) => `approve the tests of the new atom ${entry.atom}: no test covers it yet`),
    ...guards.flatMap((entry) => (entry.need === null ? [] : [entry.need])),
    ...(options.regression ? regressionNeeds(options.regression) : []),
  ];

  return {
    version: 1,
    diff: { old: diff.old.hash, new: diff.new.hash },
    tests: { live: live.length, retired: retiredBefore, other: options.others ?? 0 },
    regenerate,
    reapprove,
    retire,
    new: fresh,
    guards,
    unaffected: { moved: diff.atoms.moved.length, tests: untouched },
    ...(options.regression ? { regression: options.regression } : {}),
    needsPerson,
  };
}

export type RetireWrite = { file: string; ok: true } | { file: string; ok: false; message: string };

/**
 * Writes each retirement reason into its spec as `metadata.retired`, keeping the file's comments and layout.
 * The spec is loaded again after the edit; a spec that no longer loads is not written.
 */
export async function writeRetirements(
  report: ImpactReport,
  tests: readonly EstateTest[],
): Promise<RetireWrite[]> {
  const results: RetireWrite[] = [];
  for (const entry of report.retire) {
    if (entry.state !== 'to_write') continue;
    const test = tests.find((candidate) => candidate.id === entry.test && candidate.file === entry.file);
    if (!test) {
      results.push({ file: entry.file, ok: false, message: 'the spec is not among the tests read' });
      continue;
    }
    try {
      const path = await estatePath(
        test.root ?? dirname(test.path),
        test.root === undefined ? relative(dirname(test.path), test.path) : relative(test.root, test.path),
      );
      const text = await readFile(path, 'utf8');
      if (/\.json$/i.test(test.path) && StaticTest.safeParse(JSON.parse(text)).success) {
        await writeFile(path, `${JSON.stringify({ ...JSON.parse(text), retired: entry.reason }, null, 2)}\n`);
        entry.state = 'written';
        results.push({ file: entry.file, ok: true });
        continue;
      }
      const doc = parseDocument(text, { uniqueKeys: true });
      const current: unknown = doc.toJS();
      const metadata = isPlainObject(current) ? current.metadata : undefined;
      if (metadata !== undefined && !isPlainObject(metadata)) {
        results.push({ file: entry.file, ok: false, message: 'metadata is not a mapping' });
        continue;
      }
      doc.setIn(['metadata', 'retired'], entry.reason);
      const next = doc.toString({ lineWidth: 0 });
      const check = parseSpecText(next, 'yaml', test.path);
      if (!check.ok) {
        results.push({
          file: entry.file,
          ok: false,
          message: `the spec would no longer load: ${check.errors.map((issue) => issue.message).join('; ')}`,
        });
        continue;
      }
      await writeFile(path, next);
      entry.state = 'written';
      results.push({ file: entry.file, ok: true });
    } catch (cause) {
      results.push({
        file: entry.file,
        ok: false,
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }
  return results;
}

const WHY: Record<RegenerateWhy, string> = {
  whitespace: 'white space',
  semantic: 'semantic',
  restated: 'restated',
  removed: 'removed',
  renamed: 'renamed',
  guard_state: 'guard state',
};

/** The impact as lines a person reads. */
export function renderImpact(report: ImpactReport): string {
  const lines: string[] = [];
  const t = report.tests;
  lines.push(
    `Impact of the estate diff ${report.diff.old.slice(0, 12)} to ${report.diff.new.slice(0, 12)} on ${t.live} live estate ${t.live === 1 ? 'test' : 'tests'} (${t.retired} retired before, ${t.other} other ${t.other === 1 ? 'spec' : 'specs'}).`,
  );
  lines.push(
    `  Regenerate ${report.regenerate.length}, re-approve ${report.reapprove.length}, retire ${report.retire.length}, new ${report.new.length}; ${report.unaffected.tests} ${report.unaffected.tests === 1 ? 'test' : 'tests'} untouched, ${report.unaffected.moved} ${report.unaffected.moved === 1 ? 'atom' : 'atoms'} moved with the same quote.`,
  );
  if (report.regenerate.length > 0) {
    lines.push('Regenerate:');
    for (const entry of report.regenerate) {
      lines.push(
        `  ${entry.test} (${entry.file}): ${entry.atoms.map((item) => `${item.atom} ${WHY[item.why]}`).join(', ')}`,
      );
    }
  }
  if (report.reapprove.length > 0) {
    lines.push('Re-approve, the meaning changed:');
    for (const entry of report.reapprove) {
      lines.push(`  ${entry.atom} (${entry.kind}): ${shortQuote(entry.quote, 100)}`);
      lines.push(`      tests: ${entry.tests.length > 0 ? entry.tests.join(', ') : 'none yet'}`);
    }
  }
  if (report.retire.length > 0) {
    lines.push('Retire:');
    const state = { to_write: 'to write with --write', written: 'written', already: 'already written' };
    for (const entry of report.retire) {
      lines.push(`  ${entry.test} (${entry.file}): retired: ${entry.reason} [${state[entry.state]}]`);
    }
  }
  if (report.new.length > 0) {
    lines.push('New atoms with no test:');
    for (const entry of report.new) lines.push(`  ${entry.atom} (${entry.kind}) ${entry.file}:${entry.line}`);
  }
  if (report.guards.length > 0) {
    lines.push('Guards whose enforcement state changed:');
    for (const entry of report.guards) {
      const tests = entry.tests.length > 0 ? `; tests: ${entry.tests.join(', ')}` : '';
      lines.push(
        `  ${entry.move} ${entry.guard}: ${entry.from ?? 'no state'} to ${entry.to ?? 'no state'}${tests}`,
      );
    }
  }
  if (report.regression) lines.push(...renderRegression(report.regression));
  if (report.needsPerson.length === 0) lines.push('Nothing needs a person.');
  else {
    lines.push(`Needs a person: ${report.needsPerson.length}.`);
    for (const item of report.needsPerson) lines.push(`  - ${item}`);
  }
  return `${lines.join('\n')}\n`;
}
