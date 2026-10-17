import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentHash } from '@agent-nexus/driftbench-core';
import {
  type EstateMap,
  loadEstateMap,
  loadPlan,
  mapHash,
  type Plan,
  quoteAtSpan,
  toEstateSpaceMap,
} from '@agent-nexus/driftbench-estate';
import { loadSpaceMap, type SpaceMap } from '@agent-nexus/driftbench-space';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { isStandIn } from '../src/commands/estate-live';
import { type Io, main } from '../src/index';

/**
 * The whole estate chain on the fictional Northwind fixture, with no model call: scan, approve, space map,
 * plan, generate, mutate and run, diff, impact, radius. Each step reads the file the step before wrote, and
 * every hand-off is asserted by an id or a hash that the two steps must agree on. The table printed at the
 * end lists them. The same chain, step by step with its commands, is on docs/estate-chain.md.
 *
 * No model call. The scan replays recorded answers. The live runs use the fixture's stand-in command, a
 * script with the stand-in marker that `estate run` accepts without --allow-billed, and the check below
 * refuses the real runtime. The provider keys are emptied for the whole file, so a command that tried to
 * reach a model would stop with an error instead.
 */

vi.setConfig({ testTimeout: 600_000, hookTimeout: 60_000 });

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURE = join(ROOT, 'examples/estates/fixture');
const V2 = join(ROOT, 'examples/estates/fixture-v2');
const FAKE = join(FIXTURE, 'live/fake/claude.mjs');
const MANIFEST = join(FIXTURE, 'live/fake/manifest.json');
const STATES = join(FIXTURE, 'live/states/library.json');

/** The instruction atom the chain follows: mutated in step 6, rewritten in version 2, the radius of step 9. */
const R7 = 'instruction.standing.tell-the-user-about-a-late';
const R2 = 'instruction.standing.never-send-a-supplier-email-without';
const R12 = 'instruction.standing.keep-an-unconfirmed-draft-unsent';
const ROUTE_PLAN = 'route.standing.an-ask-to-plan-the-delivery';
const LEDGER_GUARD = 'guard.settings.posttooluse-bash-guard-ledger-guard-py';
const FORCE_PUSH_GUARD = 'guard.settings.pretooluse-bash-guard-block-force-push';
const CARRIER_CODE = 'instruction.shipment-tracker.always-pass-the-carrier-code-to';

type Generated = {
  path: string;
  /** The folder under the generated root: specs/live, specs/unit, incomplete/live or incomplete/replay. */
  folder: string;
  spec: {
    id: string;
    version?: string;
    given?: { vars?: { estate?: { map_hash?: string } } };
    blocks: Array<{ when?: { user?: string } }>;
    metadata: {
      estate: {
        atoms: string[];
        planRow: string;
        mapHash: string;
        testType: string;
        mode: string;
        cell: Record<string, string>;
        plan?: string;
        /** Set on a spec that stands for several equivalent plan rows (the generator folds them). */
        equivalence?: { count: number; planRows: string[] };
      };
    };
  };
};
/** One side of a changed atom in the diff: the atom's provenance. */
type Change = { file: string; startLine: number; endLine: number; quote: string; hash: string };
type DiffJson = {
  old: { path: string; readAt: string; hash: string; atoms: number; edges: number };
  new: { path: string; readAt: string; hash: string; atoms: number; edges: number };
  atoms: {
    added: Array<{ id: string }>;
    removed: Array<{ id: string }>;
    changed: Array<{ id: string; change: 'whitespace' | 'semantic'; before: Change; after: Change }>;
    moved: Array<{ id: string; from: { startLine: number }; to: { startLine: number } }>;
    restated: Array<{ id: string }>;
  };
  guards: Array<{ guard: string; move: string; from: string | null; to: string | null }>;
  summary: Record<
    'added' | 'removed' | 'whitespace' | 'semantic' | 'moved' | 'restated' | 'unchanged',
    number
  >;
};
type ImpactJson = {
  diff: { old: string; new: string };
  tests: { live: number };
  regenerate: Array<{ test: string; file: string; atoms: Array<{ atom: string; why: string }> }>;
  reapprove: Array<{ atom: string; tests: string[] }>;
  retire: Array<{ test: string; atoms: string[]; state: string }>;
  new: Array<{ atom: string }>;
  unaffected: { moved: number; tests: number };
  needsPerson: string[];
};
type RunJson = {
  standIn: boolean;
  pins: string[];
  costUsd: number;
  runs: Array<{ spec: string; status: string; pass: boolean; failing: string[] }>;
};
type RadiusJson = {
  manifest: { hash: string; from: string; to: string; changes: string[] };
  whole: { change: string; reason: string } | null;
  specs: Array<{
    specId: string;
    blocks: Array<{ id: string; why: string[]; state: Record<string, string> }>;
  }>;
  totals: Record<string, { in: number; direct: number; forward: number; out: number; total: number }>;
};

/** What each step leaves for the steps after it. */
const chain: {
  scanned?: EstateMap;
  approved?: EstateMap;
  space?: SpaceMap;
  plan?: Plan;
  specs?: Generated[];
  diff?: DiffJson;
  /** The impact of the diff on the generated suite, read by step 9. */
  suiteImpact?: ImpactJson;
} = {};

let work = '';

type Row = { step: string; input: string; output: string; tie: string; verified: 'yes' | 'NO' };
const rows: Row[] = [];

async function cli(argv: string[]) {
  const output = { out: '', err: '' };
  const io: Io = {
    out: (text) => {
      output.out += text;
    },
    err: (text) => {
      output.err += text;
    },
    cwd: work,
  };
  const code = await main(argv, io);
  return { code, ...output };
}

function must<T>(value: T | undefined, step: string): T {
  if (value === undefined)
    throw new Error(`step ${step} left nothing for this step to read: it did not finish`);
  return value;
}

/** Runs the assertions of one step. The row stays "NO" when one of them throws. */
async function prove(step: string, input: string, output: string, check: () => Promise<string>) {
  const row: Row = { step, input, output, tie: '', verified: 'NO' };
  rows.push(row);
  row.tie = await check();
  row.verified = 'yes';
}

function table(): string {
  const head = ['step', 'input file', 'output file', 'id or hash that ties them', 'verified'];
  const body = rows.map((row) => [row.step, row.input, row.output, row.tie, row.verified]);
  const widths = head.map((title, at) =>
    Math.max(title.length, ...body.map((line) => (line[at] ?? '').length)),
  );
  const line = (cells: string[]) => cells.map((cell, at) => cell.padEnd(widths[at] ?? 0)).join('  ');
  return [line(head), line(widths.map((width) => '-'.repeat(width))), ...body.map(line)].join('\n');
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const short = (hash: string) => hash.slice(0, 12);
const sorted = (list: Iterable<string>) => [...list].sort();

/** The numbers captured by a pattern in a command's output. */
function figures(text: string, pattern: RegExp): number[] {
  const match = pattern.exec(text);
  if (match === null) throw new Error(`no line of the output matches ${pattern}:\n${text}`);
  return match.slice(1).map(Number);
}

async function filesUnder(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await filesUnder(path)));
    else out.push(path);
  }
  return out.sort();
}

async function readSpecs(dir: string): Promise<Generated[]> {
  const paths = (await filesUnder(dir)).filter((path) => path.endsWith('.yaml'));
  return Promise.all(
    paths.map(async (path) => ({
      path,
      folder: relative(dir, path).split('/').slice(0, 2).join('/'),
      spec: parseYaml(await readFile(path, 'utf8')) as Generated['spec'],
    })),
  );
}

async function loadMap(path: string): Promise<EstateMap> {
  const loaded = await loadEstateMap(path);
  if (!loaded.ok) throw new Error(`${path}: ${loaded.errors.map((issue) => issue.message).join('; ')}`);
  return loaded.map;
}

/** A map without the fields that say where and when it was read. */
function withoutRootAndTime(map: EstateMap) {
  return {
    ...map,
    root: '',
    readAt: '',
    ...(map.producedBy === undefined ? {} : { producedBy: { ...map.producedBy, at: '' } }),
  };
}

const atomsOf = (entry: Generated) => entry.spec.metadata.estate.atoms;

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), 'driftbench-estate-chain-'));
  // The parsed-map cache of the estate commands lives in the work folder, not in the shared temporary one.
  vi.stubEnv('DRIFTBENCH_MAP_CACHE', join(work, 'map-cache'));
  // No provider key: a command that tried to reach a model would stop with an error instead.
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  vi.stubEnv('OPENAI_API_KEY', '');
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(work, { recursive: true, force: true });
});

describe('the Northwind estate chain, from scan to radius, with no model call', () => {
  it('step 1: scan with recorded answers writes a map whose atom ids and provenance hashes recompute', async () => {
    await prove('1 scan', 'estate folder, answers.yaml', 'map.yaml', async () => {
      const out = join(work, 'map.yaml');
      const result = await cli([
        'estate',
        'scan',
        FIXTURE,
        '--runtime',
        'claude-code',
        '--replay',
        join(FIXTURE, 'answers.yaml'),
        '--out',
        out,
      ]);
      expect(result.err).toBe('');
      expect(result.code).toBe(0);
      const map = await loadMap(out);
      chain.scanned = map;

      // The count line agrees with the file: code atoms are approved as read, model atoms wait for a person.
      const byCode = map.atoms.filter((atom) => atom.producedBy === 'code' && atom.approved).length;
      const byModel = map.atoms.filter((atom) => atom.producedBy === 'model' && !atom.approved).length;
      expect(byCode + byModel).toBe(map.atoms.length);
      expect(
        figures(
          result.out,
          /: (\d+) atoms \((\d+) read by code and approved, (\d+) split from prose by the model and waiting for approval\), (\d+) edges\./,
        ),
      ).toEqual([map.atoms.length, byCode, byModel, map.edges.length]);

      // Every atom has an id that starts with its kind, and no id is used twice.
      expect(new Set(map.atoms.map((atom) => atom.id)).size).toBe(map.atoms.length);
      for (const atom of map.atoms) expect(atom.id.startsWith(`${atom.kind}.`), atom.id).toBe(true);

      // Every provenance hash recomputes from file, span and quote, and the quote is in the estate file at its span.
      const texts = new Map<string, string>();
      for (const atom of map.atoms) {
        const { file, startLine, endLine, quote, hash } = atom.provenance;
        expect(sha256(`${file}\n${startLine}-${endLine}\n${quote}`), atom.id).toBe(hash);
        if (!texts.has(file)) texts.set(file, await readFile(join(FIXTURE, file), 'utf8'));
        expect(quoteAtSpan(texts.get(file) ?? '', atom.provenance), `${atom.id}: quote at its span`).toBe(
          true,
        );
      }

      // The map hash recomputes from the atom hashes and the edges. The map is the committed one, except for
      // the root it records and the time of the scan.
      expect(mapHash(map.atoms, map.edges)).toBe(map.hash);
      expect(resolve(work, map.root)).toBe(FIXTURE);
      const committed = await loadMap(join(FIXTURE, 'map.yaml'));
      expect(map.hash).toBe(committed.hash);
      expect(withoutRootAndTime(map)).toEqual(withoutRootAndTime(committed));
      return `map hash ${short(map.hash)}, ${map.atoms.length} atoms`;
    });
  });

  it('step 2: approve --all writes the same map with every atom approved, and the map hash does not move', async () => {
    await prove('2 approve', 'map.yaml', 'approved.yaml', async () => {
      const scanned = must(chain.scanned, '1');
      const out = join(work, 'approved.yaml');
      const result = await cli(['estate', 'approve', join(work, 'map.yaml'), '--all', '--to', out]);
      expect(result.err).toBe('');
      expect(result.code).toBe(0);
      const waiting = scanned.atoms.filter((atom) => !atom.approved).length;
      expect(figures(result.out, /Approved (\d+) atoms in .*; (\d+) were already approved\./)).toEqual([
        waiting,
        scanned.atoms.length - waiting,
      ]);

      // Only the approved flag changed: same ids, same quotes, same edges, same hash.
      const approved = await loadMap(out);
      chain.approved = approved;
      expect(approved.atoms.every((atom) => atom.approved)).toBe(true);
      expect(approved.atoms).toEqual(scanned.atoms.map((atom) => ({ ...atom, approved: true })));
      expect(approved.edges).toEqual(scanned.edges);
      expect(approved.hash).toBe(scanned.hash);

      // The listing says every atom is approved, and the map is the committed approved map.
      const listing = await cli(['estate', 'approve', out]);
      expect(listing.code).toBe(0);
      expect(listing.out).toContain(`all ${approved.atoms.length} atoms are approved.`);
      const committed = await loadMap(join(FIXTURE, 'approved.yaml'));
      expect(withoutRootAndTime(approved)).toEqual(withoutRootAndTime(committed));
      return `${approved.atoms.length} atoms approved, map hash ${short(approved.hash)} unchanged`;
    });
  });

  it('step 3: map writes a space map whose target values are approved atom ids of that map', async () => {
    await prove('3 space map', 'approved.yaml', 'space.yaml', async () => {
      const approved = must(chain.approved, '2');
      const out = join(work, 'space.yaml');
      const result = await cli([
        'estate',
        'map',
        join(work, 'approved.yaml'),
        '--to',
        out,
        '--agent',
        'northwind',
      ]);
      expect(result.err).toBe('');
      expect(result.code).toBe(0);
      const loaded = await loadSpaceMap(out);
      if (!loaded.ok) throw new Error(loaded.errors.map((issue) => issue.message).join('; '));
      const space = loaded.map;
      chain.space = space;

      // The space map names its map: its version is the start of the map hash.
      expect(space.version).toBe(short(approved.hash));
      const byId = new Map(approved.atoms.map((atom) => [atom.id, atom]));
      const targets = space.dimensions.filter((dimension) => dimension.id.startsWith('atoms.'));
      expect(targets.length).toBeGreaterThan(0);
      const listed: string[] = [];
      for (const dimension of targets) {
        for (const value of dimension.values) {
          const atom = byId.get(value.id);
          expect(atom, `${value.id} is an atom of the approved map`).toBeDefined();
          expect(atom?.approved, `${value.id} is approved`).toBe(true);
          expect(atom?.role, `${value.id} is an axis atom`).toBe('axis');
          expect(`atoms.${atom?.kind}`, `${value.id} sits under its kind`).toBe(dimension.id);
          expect(value.title).toBe(atom?.title);
          listed.push(value.id);
        }
      }
      // No approved axis atom is missing from it.
      expect(sorted(listed)).toEqual(
        sorted(approved.atoms.filter((atom) => atom.approved && atom.role === 'axis').map((atom) => atom.id)),
      );
      // The count line agrees with the file, and the file is the committed space map.
      expect(
        figures(result.out, /: (\d+) situation axes, (\d+) target dimensions \(.*\), (\d+) constraints\./),
      ).toEqual([space.dimensions.length - targets.length, targets.length, space.constraints.length]);
      const committed = await loadSpaceMap(join(FIXTURE, 'space.yaml'));
      expect(committed.ok && committed.map).toEqual(space);
      return `space version ${space.version} is the map hash start; ${listed.length} target atoms`;
    });
  });

  it('step 4: plan reads the space map and writes rows whose atoms exist in the approved map', async () => {
    await prove('4 plan', 'approved.yaml, space.yaml', 'plan.yaml', async () => {
      const approved = must(chain.approved, '2');
      const space = must(chain.space, '3');
      const out = join(work, 'plan.yaml');
      const result = await cli([
        'estate',
        'plan',
        join(work, 'approved.yaml'),
        '--space',
        join(work, 'space.yaml'),
        '--out',
        out,
      ]);
      expect(result.err).toBe('');
      expect(result.code).toBe(0);
      const loaded = await loadPlan(out);
      if (!loaded.ok) throw new Error(loaded.errors.map((issue) => issue.message).join('; '));
      const plan = loaded.plan;
      chain.plan = plan;
      expect(figures(result.out, /: (\d+) rows \(/)).toEqual([plan.rows.length]);

      // The plan names its map and its space map by hash, and so does the summary beside it.
      expect(plan.mapHash).toBe(approved.hash);
      expect(plan.spaceHash).toBe(contentHash(space));
      const summary = JSON.parse(await readFile(join(work, 'plan.summary.json'), 'utf8')) as {
        mapHash: string;
        spaceHash: string;
      };
      expect([summary.mapHash, summary.spaceHash]).toEqual([plan.mapHash, plan.spaceHash]);

      // Every row names approved atoms of the map, and every cell value is one the space map holds.
      const byId = new Map(approved.atoms.map((atom) => [atom.id, atom]));
      const values = new Map(
        space.dimensions.map((dimension) => [
          dimension.id,
          new Set(dimension.values.map((value) => value.id)),
        ]),
      );
      for (const row of plan.rows) {
        expect(row.status, row.id).toBe('proposed');
        for (const id of row.atomIds) expect(byId.get(id)?.approved, `${row.id} names ${id}`).toBe(true);
        for (const [dimension, value] of Object.entries(row.cell)) {
          expect(
            values.get(dimension)?.has(value),
            `${row.id}: ${dimension}=${value} is in the space map`,
          ).toBe(true);
          if (dimension.startsWith('atoms.')) {
            expect(`atoms.${byId.get(value)?.kind}`, `${row.id}: ${value} sits under its kind`).toBe(
              dimension,
            );
          }
        }
      }

      // The committed plan has these rows and this summary. Its spaceHash differs: it was written without
      // --space, from the map's own space map, which carries the agent name "estate" instead of "northwind".
      const committed = await loadPlan(join(FIXTURE, 'plan.yaml'));
      if (!committed.ok) throw new Error('the committed plan does not load');
      expect(plan.rows).toEqual(committed.plan.rows);
      expect(plan.summary).toEqual(committed.plan.summary);
      expect(plan.mapHash).toBe(committed.plan.mapHash);
      expect(committed.plan.spaceHash).toBe(contentHash(toEstateSpaceMap(approved)));
      return `plan map hash ${short(plan.mapHash)}, space hash ${plan.spaceHash}`;
    });
  });

  it('step 5: plan approve then generate write tests that name approved atoms, the map hash and a row of the plan', async () => {
    await prove('5 generate', 'approved.yaml, plan.yaml', 'generated/', async () => {
      const approved = must(chain.approved, '2');
      const plan = must(chain.plan, '4');
      const planPath = join(work, 'plan.yaml');

      const approving = await cli(['estate', 'plan', 'approve', planPath, '--all']);
      expect(approving.err).toBe('');
      expect(approving.code).toBe(0);
      expect(figures(approving.out, /Approved (\d+) rows in .*; (\d+) were already approved\./)).toEqual([
        plan.rows.length,
        0,
      ]);
      const reread = await loadPlan(planPath);
      if (!reread.ok) throw new Error('the approved plan does not load');
      expect(reread.plan.rows.every((row) => row.status === 'approved')).toBe(true);

      const out = join(work, 'generated');
      const generated = await cli([
        'estate',
        'generate',
        '--map',
        join(work, 'approved.yaml'),
        '--plan',
        planPath,
        '--out',
        out,
        '--phrases',
        join(FIXTURE, 'phrases.yaml'),
        '--sessions',
        join(FIXTURE, 'sessions/index.yaml'),
        '--json',
      ]);
      expect(generated.err).toBe('');
      // Exit 1: the suite is written, and some specs are incomplete; each names the gap that keeps it so.
      expect(generated.code).toBe(1);
      const report = JSON.parse(generated.out) as {
        map: { hash: string; atoms: number };
        plan: { rows: number; approved: number; proposed: number; struck: number };
        summary: { specs: number; complete: number; incomplete: number };
        /** Absent from a report of a generator that folds nothing. */
        equivalence?: { collapsed: number; groups: Array<{ spec: string; count: number; rows: string[] }> };
      };
      expect(report.map).toMatchObject({ hash: approved.hash, atoms: approved.atoms.length });
      expect(report.plan).toMatchObject({
        rows: plan.rows.length,
        approved: plan.rows.length,
        proposed: 0,
        struck: 0,
      });

      const specs = await readSpecs(out);
      chain.specs = specs;
      const rowsById = new Map(plan.rows.map((row) => [row.id, row]));
      const atomIds = new Set(approved.atoms.map((atom) => atom.id));
      const covered = new Set<string>();
      /** The rows folded into another spec: they have no spec of their own. */
      const folded = new Set<string>();
      const representatives = new Set<string>();
      for (const { spec, path } of specs) {
        const where = relative(out, path);
        const estate = spec.metadata.estate;
        // The three hand-offs: atoms of the approved map, the map hash, a row of the plan.
        for (const atom of estate.atoms) expect(atomIds.has(atom), `${where}: ${atom} is an atom`).toBe(true);
        expect(estate.mapHash, where).toBe(approved.hash);
        expect(spec.given?.vars?.estate?.map_hash, where).toBe(approved.hash);
        expect(spec.version, where).toBe(short(approved.hash));
        const row = rowsById.get(estate.planRow);
        expect(row, `${where}: ${estate.planRow} is a row of the plan`).toBeDefined();
        // And the spec carries what its row says.
        expect(estate.atoms, where).toEqual(row?.atomIds);
        expect([estate.testType, estate.mode, estate.cell], where).toEqual([
          row?.testType,
          row?.mode,
          row?.cell,
        ]);
        covered.add(estate.planRow);
        representatives.add(estate.planRow);
        // The generator folds exactly equivalent specs into one representative, by design. The representative
        // lists every row it stands for in `equivalence.planRows`: each is a row of the plan, and each counts as
        // covered by this spec.
        if (estate.equivalence !== undefined) {
          const { count, planRows } = estate.equivalence;
          expect(planRows, `${where}: the folded rows`).toContain(estate.planRow);
          expect(count, `${where}: the fold count`).toBe(planRows.length);
          expect(new Set(planRows).size, `${where}: a row is folded once`).toBe(planRows.length);
          for (const id of planRows) {
            expect(rowsById.has(id), `${where}: ${id} is a row of the plan`).toBe(true);
            expect(folded.has(id), `${where}: ${id} is folded into one spec only`).toBe(false);
            if (id !== estate.planRow) folded.add(id);
            covered.add(id);
          }
        }
      }
      // The static and the unit tests are JSON files that carry the same three fields.
      const jsonTests = (await filesUnder(out)).filter(
        (path) => path.endsWith('.json') && /\/(static|unit)\//.test(path),
      );
      for (const path of jsonTests) {
        const test = JSON.parse(await readFile(path, 'utf8')) as {
          atom: string;
          planRow: string;
          mapHash: string;
        };
        expect(atomIds.has(test.atom), `${path}: ${test.atom}`).toBe(true);
        expect(test.mapHash, path).toBe(approved.hash);
        expect(rowsById.has(test.planRow), `${path}: ${test.planRow}`).toBe(true);
        covered.add(test.planRow);
      }
      // Every approved row gave a test, and every test came from a row.
      expect(sorted(covered)).toEqual(sorted(rowsById.keys()));
      // The report counts what the folders hold: complete specs sit under specs/ and static/, the others under incomplete/.
      const incomplete = specs.filter((entry) => entry.folder.startsWith('incomplete')).length;
      const staticTests = jsonTests.filter((path) => path.includes('/static/')).length;
      expect(report.summary.incomplete).toBe(incomplete);
      expect(report.summary.complete).toBe(specs.length - incomplete + staticTests);
      expect(report.summary.specs).toBe(specs.length + staticTests);
      // The written specs plus the rows folded into them are the plan rows, and the report counts the folds.
      const collapsed = report.equivalence?.collapsed ?? 0;
      expect(collapsed).toBe(folded.size);
      expect([...folded].filter((id) => representatives.has(id))).toEqual([]);
      expect((report.equivalence?.groups ?? []).reduce((sum, group) => sum + group.count - 1, 0)).toBe(
        folded.size,
      );
      expect(report.summary.specs + collapsed).toBe(plan.rows.length);
      return `${plan.rows.length} plan rows, ${covered.size} rows with a test (${folded.size} folded into an equivalent spec), all on map hash ${short(approved.hash)}`;
    });
  });

  /**
   * The 14 complete live specs of the fixture's own proof (estate-live.test.ts), one per test type, here
   * taken from the suite this chain generated. The force-push guard spec is found by its content: pairwise
   * specs are numbered by their row.
   */
  const PROOF = [
    'journey/estate.journey.03.yaml',
    'misroute/estate.misroute.route.shipment-tracker.an-ask-that-fits-shipment-tracker.yaml',
    'obligation/estate.obligation.instruction.standing.tell-the-user-about-a-late.yaml',
    'ordered_pair/estate.ordered_pair.gate.standing.never-report-done-before-verify-passed.yaml',
    'outside_trigger/estate.outside_trigger.instruction.standing.tell-the-user-about-a-late.yaml',
    'register_sample/estate.register_sample.register.invoice-reconcile.one-closing-line-per-invoice.build.yaml',
    'route_near_miss/estate.route_near_miss.route.invoice-reconcile.an-ask-that-fits-invoice-reconcile.yaml',
    'route_positive/estate.route_positive.route.invoice-reconcile.an-ask-that-fits-invoice-reconcile.1.yaml',
    'skip_pressure/estate.skip_pressure.gate.standing.read-a-file-before-editing-it.yaml',
    'stage_order/estate.stage_order.stage.steps.stage-do-make-the-change.yaml',
    'stage_skip/estate.stage_skip.stage.steps.stage-verify-run-the-check-that.yaml',
    'tool_denied/estate.tool_denied.tool.settings.deny-webfetch.yaml',
    'twin/estate.twin.instruction.standing.tell-the-user-about-a-late.yaml',
  ];
  /** The two planted faults of the recorded streams: they fail on their own checks, with or without a mutant. */
  const FAULTS = [
    'estate.misroute.route.shipment-tracker.an-ask-that-fits-shipment-tracker',
    'estate.tool_denied.tool.settings.deny-webfetch',
  ];

  /** What one spec did in a run: pass or fail (or its run status), and the checks that failed. */
  type Result = { outcome: string; failing: string[] };

  async function estateRun(name: string, estateRoot: string, specs: string[], ...extra: string[]) {
    const result = await cli([
      'estate',
      'run',
      ...specs,
      '--estate',
      estateRoot,
      '--runtime',
      'claude-code',
      '--command',
      FAKE,
      '--set-env',
      `FAKE_MANIFEST=${MANIFEST}`,
      '--store',
      join(work, `${name}.db`),
      '--states',
      STATES,
      '--json',
      ...extra,
    ]);
    expect(result.err).toBe('');
    const json = JSON.parse(result.out) as RunJson;
    const results: Record<string, Result> = Object.fromEntries(
      json.runs.map((run) => [
        run.spec,
        {
          outcome: run.status === 'completed' ? (run.pass ? 'pass' : 'fail') : run.status,
          failing: run.failing,
        },
      ]),
    );
    return { code: result.code, json, results };
  }

  it('step 6: inverting the instruction atom turns the specs that name it red, and no other spec moves', async () => {
    await prove('6 mutate, run', 'approved.yaml, generated specs', 'mutant/, run results', async () => {
      const approved = must(chain.approved, '2');
      const generated = must(chain.specs, '5');
      const atom = approved.atoms.find((candidate) => candidate.id === R7);
      if (atom === undefined) throw new Error(`${R7} is not an atom of the approved map`);

      // No model: the command is the fixture's stand-in, and a run of the real runtime is refused.
      expect(await isStandIn(FAKE)).toBe(true);
      const refused = await cli([
        'estate',
        'run',
        join(work, 'generated', 'specs', 'live', PROOF[0] ?? ''),
        '--estate',
        FIXTURE,
        '--runtime',
        'claude-code',
        '--store',
        join(work, 'refused.db'),
      ]);
      expect(refused.code).toBe(2);
      expect(refused.err).toContain('claude is not a stand-in');

      // The mutant: the atom's line inverted in a copy of the estate, with its own map beside it.
      const mutantDir = join(work, 'mutant');
      const made = await cli([
        'estate',
        'mutate',
        join(work, 'approved.yaml'),
        '--atom',
        R7,
        '--invert',
        '--to',
        mutantDir,
        '--json',
      ]);
      expect(made.err).toBe('');
      expect(made.code).toBe(0);
      const record = JSON.parse(made.out) as {
        atom: string;
        op: string;
        file: string;
        before: string;
        after: string;
        originalMapHash: string;
        mapHash: string;
      };
      const mutantMap = await loadMap(join(mutantDir, 'map.yaml'));
      expect(record).toMatchObject({
        atom: R7,
        op: 'invert',
        file: atom.provenance.file,
        originalMapHash: approved.hash,
      });
      expect(record.mapHash).toBe(mutantMap.hash);
      expect(mutantMap.hash).not.toBe(approved.hash);
      expect(record.before).toContain(atom.provenance.quote);
      expect(record.after).toContain('do not tell the user');
      // Only that file differs from the estate, and only on that line.
      const changedFiles: string[] = [];
      for (const path of await filesUnder(mutantDir)) {
        const name = relative(mutantDir, path);
        if (name === 'map.yaml' || name === 'mutant.json') continue;
        const was = await readFile(join(FIXTURE, name), 'utf8');
        const now = await readFile(path, 'utf8');
        if (was === now) continue;
        changedFiles.push(name);
        expect(now).toBe(was.replace(record.before, record.after));
      }
      expect(changedFiles).toEqual([atom.provenance.file]);

      // The hand-off by hash is enforced by the command too, not only by this test: the plan and the phrase
      // bank answer to the original map, so the mutant's map is refused and nothing is written.
      const wrong = await cli([
        'estate',
        'generate',
        '--map',
        join(mutantDir, 'map.yaml'),
        '--plan',
        join(work, 'plan.yaml'),
        '--out',
        join(work, 'refused'),
        '--phrases',
        join(FIXTURE, 'phrases.yaml'),
        '--sessions',
        join(FIXTURE, 'sessions/index.yaml'),
      ]);
      expect(wrong.code).toBe(2);
      expect(wrong.err).toContain(
        `the plan was made from map ${short(approved.hash)}, the map given is ${short(record.mapHash)}`,
      );
      expect(await readdir(work)).not.toContain('refused');

      // What the stand-in reads of the estate: each recorded ask has alternatives, and when the estate copy
      // no longer holds a quote, the alternative plays instead. On the original none plays. On the mutant the
      // ones that play are keyed on the inverted line, and so are the asks they belong to.
      const recorded = JSON.parse(await readFile(MANIFEST, 'utf8')) as {
        asks: Array<{ ask: string; unless?: Array<{ file: string; quote: string }> }>;
      };
      const alternatives = recorded.asks.flatMap((entry) =>
        (entry.unless ?? []).map((rule) => ({ ask: entry.ask, ...rule })),
      );
      const playing = async (root: string) => {
        const out: typeof alternatives = [];
        for (const rule of alternatives) {
          if (!(await readFile(join(root, rule.file), 'utf8')).includes(rule.quote)) out.push(rule);
        }
        return out;
      };
      expect(await playing(FIXTURE)).toEqual([]);
      const played = await playing(mutantDir);
      expect(played.length).toBeGreaterThan(0);
      for (const rule of played) {
        expect([rule.file, rule.quote], rule.ask).toEqual([atom.provenance.file, atom.provenance.quote]);
      }
      const affected = new Set(played.map((rule) => rule.ask));

      // The specs to run. Every spec that names the atom. Every other spec whose ask is one the mutant
      // changes: in playback mode the stand-in reads the changed file only through those alternatives, so
      // these are the specs that can move. And the specs of the fixture's own proof, one of each test type,
      // that carry no changed ask: the controls.
      const live = generated.filter((entry) => entry.folder === 'specs/live');
      const byPath = new Map(live.map((entry) => [entry.path, entry]));
      const asksChanged = (entry: Generated) =>
        entry.spec.blocks.some((block) => affected.has(block.when?.user ?? ''));
      const naming = live.filter((entry) => atomsOf(entry).includes(R7));
      const sharing = live.filter((entry) => !naming.includes(entry) && asksChanged(entry));
      const forcePush = live
        .filter(
          ({ spec }) =>
            spec.metadata.estate.testType === 'guard_positive' &&
            spec.metadata.estate.atoms.includes(FORCE_PUSH_GUARD) &&
            spec.metadata.estate.cell.deviation === 'none',
        )
        .map((entry) => entry.path)
        .sort()[0];
      const proof = [
        ...PROOF.map((name) => join(work, 'generated', 'specs', 'live', name)),
        forcePush ?? '',
      ].map((path) => {
        const entry = byPath.get(path);
        if (entry === undefined) throw new Error(`the generated suite has no live spec ${path}`);
        return entry;
      });
      expect(proof).toHaveLength(14);
      const controls = proof.filter((entry) => !naming.includes(entry) && !sharing.includes(entry));
      expect(controls.length).toBeGreaterThan(0);
      expect(naming.map((entry) => entry.spec.metadata.estate.testType)).toEqual(
        expect.arrayContaining(['obligation', 'outside_trigger', 'twin']),
      );
      expect(sharing.length).toBeGreaterThan(0);
      const paths = [...naming, ...sharing, ...controls].map((entry) => entry.path).sort();
      expect(new Set(paths).size).toBe(paths.length);

      // The generated specs of the proof are the committed ones, except for the plan path they record.
      for (const entry of proof) {
        const name = relative(join(work, 'generated'), entry.path);
        const committed = parseYaml(
          await readFile(join(FIXTURE, 'generated', name), 'utf8'),
        ) as Generated['spec'];
        const mine = structuredClone(entry.spec);
        delete mine.metadata.estate.plan;
        delete committed.metadata.estate.plan;
        expect(mine, name).toEqual(committed);
      }

      // The original estate, pinned to the map this chain approved.
      const original = await estateRun('original', FIXTURE, paths, '--map', join(work, 'approved.yaml'));
      expect(original.code).toBe(1);
      expect(original.json.standIn).toBe(true);
      expect(original.json.costUsd).toBe(0);
      expect(original.json.pins).toEqual([approved.hash]);
      const before = original.results;
      expect(Object.keys(before)).toHaveLength(paths.length);
      // Every spec that names the atom passes. The specs that fail are the two planted faults of the
      // recorded streams, and the specs that need what the recorded stream of the shipment asks never does:
      // the carrier-code fault, planted by design. That stream reads neither the shipment data file nor
      // `track.sh`. So every spec that requires the carrier-code rule, a read of the shipment data or a run of
      // `track.sh` is red on the original, and stays as red on the mutant. They are the specs of the
      // carrier-code instruction, and the journeys that walk the data reference or the script edge.
      for (const entry of naming) expect(before[entry.spec.id]?.outcome, entry.spec.id).toBe('pass');
      const needsMore = (atom: string) =>
        atom === CARRIER_CODE ||
        atom.startsWith('reference.shipment-tracker.') ||
        atom.startsWith('script.shipment-tracker.');
      const carrier = sharing.filter((entry) => atomsOf(entry).some(needsMore));
      expect(carrier.length).toBeGreaterThan(0);
      for (const entry of carrier) {
        const result = before[entry.spec.id];
        expect(result?.outcome, entry.spec.id).toBe('fail');
        expect(result?.failing.length, entry.spec.id).toBeGreaterThan(0);
        if (atomsOf(entry).includes(CARRIER_CODE)) {
          expect(result, entry.spec.id).toEqual({
            outcome: 'fail',
            failing: ['block 0: custom.some_call.0'],
          });
        }
      }
      expect(
        sorted(Object.entries(before).flatMap(([id, result]) => (result.outcome === 'pass' ? [] : [id]))),
      ).toEqual(sorted([...FAULTS, ...carrier.map((entry) => entry.spec.id)]));

      // The same specs on the mutant, pinned to the original map hash and to the mutant's own.
      const mutant = await estateRun('mutant', mutantDir, paths);
      expect(mutant.code).toBe(1);
      expect(mutant.json.standIn).toBe(true);
      expect(mutant.json.pins).toEqual([approved.hash, record.mapHash]);
      const after = mutant.results;
      expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());

      // A spec that names the atom and asks what the mutant changes fails: the reply no longer says "late".
      // The control that must not fire where the rule does not apply (its ask is a neutral one) stays green.
      const red = naming.filter((entry) => after[entry.spec.id]?.outcome === 'fail');
      expect(red.map((entry) => entry.spec.id).sort()).toEqual(
        sorted(naming.filter(asksChanged).map((entry) => entry.spec.id)),
      );
      expect(sorted(new Set(red.map((entry) => entry.spec.metadata.estate.testType)))).toEqual([
        'obligation',
        'twin',
      ]);
      for (const entry of red) {
        expect(after[entry.spec.id], entry.spec.id).toEqual({
          outcome: 'fail',
          failing: ['block 0: must.0'],
        });
      }
      for (const entry of naming.filter((candidate) => !red.includes(candidate))) {
        expect(after[entry.spec.id], entry.spec.id).toEqual(before[entry.spec.id]);
      }
      // Every other spec gives the result it gave before, the failing checks included.
      for (const entry of [...sharing, ...controls]) {
        expect(after[entry.spec.id], entry.spec.id).toEqual(before[entry.spec.id]);
      }
      return `${R7} inverted, map ${short(approved.hash)} to ${short(record.mapHash)}; ${red.length} of ${naming.length} specs that name it fail, ${sharing.length + controls.length} others unchanged`;
    });
  });

  it('step 7: the diff of the approved map against version 2 names the semantic changes, with the chain hashes on both sides', async () => {
    await prove('7 diff', 'approved.yaml, fixture-v2/map.yaml', 'diff.json', async () => {
      const approved = must(chain.approved, '2');
      const out = join(work, 'diff.json');
      const result = await cli([
        'estate',
        'diff',
        join(work, 'approved.yaml'),
        join(V2, 'map.yaml'),
        '--old-guards',
        join(V2, 'maintain/guard-state.v1.yaml'),
        '--out',
        out,
      ]);
      expect(result.err).toBe('');
      expect(result.code).toBe(0);
      const diff = JSON.parse(await readFile(out, 'utf8')) as DiffJson;
      chain.diff = diff;
      const v2 = await loadMap(join(V2, 'map.yaml'));

      // Both sides are named by hash: the old side is the map this chain approved.
      expect([diff.old.hash, diff.old.atoms, diff.old.edges]).toEqual([
        approved.hash,
        approved.atoms.length,
        approved.edges.length,
      ]);
      expect([diff.new.hash, diff.new.atoms]).toEqual([v2.hash, v2.atoms.length]);

      // The changes of section 8 of docs/estate.md.
      const semantic = diff.atoms.changed.filter((change) => change.change === 'semantic');
      expect(sorted(semantic.map((change) => change.id))).toEqual(sorted([ROUTE_PLAN, R7]));
      expect(
        diff.atoms.changed.filter((change) => change.change === 'whitespace').map((change) => change.id),
      ).toEqual([R2]);
      expect(diff.atoms.removed.map((atom) => atom.id)).toEqual([R12]);
      expect(sorted(diff.atoms.added.map((atom) => atom.id))).toEqual(
        sorted([
          'instruction.standing.name-the-finance-lead-on-a',
          'instruction.standing.keep-a-credit-note-as-a',
        ]),
      );
      expect(diff.atoms.moved).toHaveLength(24);
      expect(diff.atoms.restated.map((atom) => atom.id)).toEqual([
        'invariant.standing.the-standing-instructions-stay-under-40000',
      ]);
      expect(diff.guards.filter((guard) => guard.move !== 'unchanged')).toMatchObject([
        { guard: LEDGER_GUARD, move: 'promoted', from: 'warn', to: 'enforce' },
      ]);
      expect(diff.summary).toMatchObject({
        added: 2,
        removed: 1,
        whitespace: 1,
        semantic: 2,
        moved: 24,
        restated: 1,
      });
      expect(diff.summary.unchanged).toBe(
        diff.old.atoms -
          diff.atoms.removed.length -
          diff.atoms.changed.length -
          diff.atoms.moved.length -
          diff.atoms.restated.length,
      );

      // R7: the "before" hash is the hash the scan gave the atom in step 1, the "after" hash is version 2's.
      const before = approved.atoms.find((atom) => atom.id === R7)?.provenance;
      const after = v2.atoms.find((atom) => atom.id === R7)?.provenance;
      const change = semantic.find((entry) => entry.id === R7);
      expect(change?.before).toEqual(before);
      expect(change?.after).toEqual(after);
      expect(change?.before.quote).toContain('more than two days');
      expect(change?.after.quote).toContain('more than one day');
      // A moved atom keeps its quote and changes only its line.
      for (const move of diff.atoms.moved) {
        const was = approved.atoms.find((atom) => atom.id === move.id)?.provenance;
        const now = v2.atoms.find((atom) => atom.id === move.id)?.provenance;
        expect(now?.quote, move.id).toBe(was?.quote);
        expect([move.from.startLine, move.to.startLine], move.id).toEqual([was?.startLine, now?.startLine]);
        expect(move.to.startLine).not.toBe(move.from.startLine);
      }
      // The diff is the committed one, except for where the old map was written and when it was read.
      const committed = JSON.parse(await readFile(join(V2, 'maintain/diff.json'), 'utf8')) as DiffJson;
      const bare = (value: DiffJson) => ({
        ...value,
        old: { ...value.old, path: '', readAt: '' },
        new: { ...value.new, path: '' },
      });
      expect(bare(diff)).toEqual(bare(committed));
      return `old ${short(diff.old.hash)} to new ${short(diff.new.hash)}; ${R7} hash ${short(before?.hash ?? '')} to ${short(after?.hash ?? '')}`;
    });
  });

  it('step 8: impact gives 4, 2, 1, 2 on the version 1 tests, and on the generated suite it finds exactly the specs that name a changed atom', async () => {
    await prove('8 impact', 'diff.json, fixture-v2/tests, generated specs', 'impact.json', async () => {
      const diff = must(chain.diff, '7');
      const generated = must(chain.specs, '5');
      const removed = diff.atoms.removed.map((atom) => atom.id);
      const promoted = diff.guards.filter((guard) => guard.move === 'promoted').map((guard) => guard.guard);
      const semantic = diff.atoms.changed
        .filter((change) => change.change === 'semantic')
        .map((change) => change.id);
      const restated = diff.atoms.restated.map((atom) => atom.id);
      const reasonOf = (atom: string) =>
        removed.includes(atom) ? 'removed' : promoted.includes(atom) ? 'guard_state' : 'semantic';

      // The eight version 1 tests of the fixture.
      const out = join(work, 'impact.json');
      const result = await cli([
        'estate',
        'impact',
        join(work, 'diff.json'),
        '--tests',
        join(V2, 'tests'),
        '--out',
        out,
      ]);
      expect(result.err).toBe('');
      // Exit 1: four items wait for a person.
      expect(result.code).toBe(1);
      const impact = JSON.parse(await readFile(out, 'utf8')) as ImpactJson;
      expect(impact.diff).toEqual({ old: diff.old.hash, new: diff.new.hash });
      expect([
        impact.regenerate.length,
        impact.reapprove.length,
        impact.retire.length,
        impact.new.length,
      ]).toEqual([4, 2, 1, 2]);
      expect(impact.needsPerson).toHaveLength(4);
      expect(impact.unaffected).toEqual({ moved: diff.atoms.moved.length, tests: impact.tests.live - 4 - 1 });
      for (const entry of impact.regenerate) {
        // Each regenerated test names, in its own metadata, an atom the diff changed, for the reason given.
        const test = parseYaml(await readFile(join(V2, 'tests', entry.file), 'utf8')) as {
          metadata: { estate: { atoms: string[] } };
        };
        for (const { atom, why } of entry.atoms) {
          expect(test.metadata.estate.atoms, `${entry.test} names ${atom}`).toContain(atom);
          expect([...removed, ...promoted, ...semantic], `${atom} changed in the diff`).toContain(atom);
          expect(why).toBe(reasonOf(atom));
        }
      }
      expect(sorted(impact.regenerate.map((entry) => entry.test))).toEqual([
        'northwind-draft-pair',
        'northwind-late-shipment',
        'northwind-ledger-archive',
        'northwind-route-planner',
      ]);
      expect(sorted(impact.reapprove.map((entry) => entry.atom))).toEqual(sorted(semantic));
      expect(impact.reapprove.find((entry) => entry.atom === R7)?.tests).toEqual(['northwind-late-shipment']);
      expect(impact.retire).toMatchObject([
        { test: 'northwind-unsent-draft', atoms: [R12], state: 'to_write' },
      ]);
      expect(sorted(impact.new.map((entry) => entry.atom))).toEqual(
        sorted(diff.atoms.added.map((atom) => atom.id)),
      );

      // The suite this chain generated, indexed the same way. A spec is retired when all its atoms are
      // removed. It is regenerated when it names an atom that changed in meaning, was restated, was promoted
      // or was removed. A respaced atom and a moved atom touch no spec.
      const suite = generated.filter((entry) => entry.folder.startsWith('specs/'));
      const retiring = suite.filter((entry) => atomsOf(entry).every((atom) => removed.includes(atom)));
      const touching = new Set([...semantic, ...restated, ...promoted, ...removed]);
      const regenerating = suite.filter(
        (entry) => atomsOf(entry).some((atom) => touching.has(atom)) && !retiring.includes(entry),
      );
      const wideOut = join(work, 'impact-generated.json');
      const bulk = await cli([
        'estate',
        'impact',
        join(work, 'diff.json'),
        '--tests',
        join(work, 'generated', 'specs'),
        '--out',
        wideOut,
      ]);
      expect(bulk.err).toBe('');
      expect(bulk.code).toBe(1);
      const wide = JSON.parse(await readFile(wideOut, 'utf8')) as ImpactJson;
      chain.suiteImpact = wide;
      expect(wide.tests.live).toBe(suite.length);
      expect(sorted(wide.regenerate.map((entry) => entry.test))).toEqual(
        sorted(regenerating.map((entry) => entry.spec.id)),
      );
      expect(sorted(wide.retire.map((entry) => entry.test))).toEqual(
        sorted(retiring.map((entry) => entry.spec.id)),
      );
      expect(wide.unaffected.tests).toBe(suite.length - regenerating.length - retiring.length);
      const respaced = suite.filter((entry) => atomsOf(entry).every((atom) => atom === R2));
      expect(respaced.length).toBeGreaterThan(0);
      const touched = new Set([...wide.regenerate, ...wide.retire].map((entry) => entry.test));
      for (const entry of respaced) expect(touched.has(entry.spec.id), entry.spec.id).toBe(false);
      // R7: the specs that wait for re-approval are the generated specs that name R7.
      const namingR7 = suite.filter((entry) => atomsOf(entry).includes(R7)).map((entry) => entry.spec.id);
      expect(namingR7.length).toBeGreaterThan(3);
      expect(sorted(wide.reapprove.find((entry) => entry.atom === R7)?.tests ?? [])).toEqual(
        sorted(namingR7),
      );
      return `diff hashes ${short(impact.diff.old)} and ${short(impact.diff.new)}; ${namingR7.length} generated specs name ${R7}`;
    });
  });

  it('step 9: the radius of a prompt change to the instruction atom is the generated specs that name it, not the whole suite', async () => {
    await prove('9 radius', 'generated specs, change manifest', 'radius report', async () => {
      const generated = must(chain.specs, '5');
      const manifest = join(work, 'change.yaml');
      await writeFile(
        manifest,
        [
          'from: northwind-v1',
          'to: northwind-v2',
          'changes:',
          '  - kind: prompt',
          `    id: ${R7}`,
          '    note: R7 tells the user after one late day instead of two',
          '',
        ].join('\n'),
      );
      const result = await cli(['radius', join(work, 'generated', 'specs'), '--change', manifest, '--json']);
      expect(result.err).toBe('');
      const report = JSON.parse(result.out) as RadiusJson;
      // The radius being the whole suite is a failure, and the reason the command gives is printed with it.
      expect(report.whole, `the radius is the whole suite: ${JSON.stringify(report.whole)}`).toBeNull();
      expect(result.code).toBe(0);
      expect(report.manifest).toMatchObject({
        from: 'northwind-v1',
        to: 'northwind-v2',
        changes: [`prompt:${R7}`],
      });

      const suite = generated.filter((entry) => entry.folder.startsWith('specs/'));
      const namingR7 = new Set(
        suite.filter((entry) => atomsOf(entry).includes(R7)).map((entry) => entry.spec.id),
      );
      expect(report.specs.map((spec) => spec.specId).sort()).toEqual(
        sorted(suite.map((entry) => entry.spec.id)),
      );
      let inside = 0;
      let outside = 0;
      for (const spec of report.specs) {
        for (const block of spec.blocks) {
          if (namingR7.has(spec.specId)) {
            // Every block of a spec that names the atom is in the radius, for that atom.
            expect(block.state.F, `${spec.specId}/${block.id}`).toBe('direct');
            expect(block.why, `${spec.specId}/${block.id}`).toEqual([`prompt:${R7}`]);
            inside++;
          } else {
            expect(block.state.F, `${spec.specId}/${block.id}`).toBe('out');
            outside++;
          }
        }
      }
      expect(inside).toBeGreaterThan(0);
      // At least one block that does not name the atom is out.
      expect(outside).toBeGreaterThan(0);
      expect(report.totals.F).toMatchObject({ in: inside, direct: inside, forward: 0, out: outside });

      // The radius, the impact of step 8 and the metadata of step 5 name the same specs.
      const impact = must(chain.suiteImpact, '8');
      expect(sorted(impact.reapprove.find((entry) => entry.atom === R7)?.tests ?? [])).toEqual(
        sorted(namingR7),
      );
      return `manifest ${report.manifest.hash} names ${R7}; ${inside} of ${inside + outside} blocks in the radius, ${outside} out`;
    });
  });

  it('step 10: every hand-off above is verified, and the table lists them', () => {
    // The table is printed even when a step failed, so the failing step shows as NO.
    console.log(`\n${table()}\n`);
    expect(rows.map((row) => row.step.slice(0, 1))).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
    expect(rows.filter((row) => row.verified !== 'yes')).toEqual([]);
  });
});
