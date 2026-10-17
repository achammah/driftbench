import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { between, list, pick, type RawSpec, type Rng, rngFor, run, SHOP } from '../harness';
import { type Action, type FileAction, plantedAgent, token } from '../kinds';
import type { BlocksProduct } from '../product';
import { type BankItem, expectAll, fail, type ItemResult, PASS, type Tier } from '../types';

/**
 * Level 1, code-interpreter only (the approved design): the files a code agent produces are judged on their
 * content (a planted cell value, a page count, a field of a schema), the workspace diff is exact (created, changed
 * and deleted, also in a workspace of 1,000 files), a write outside the workspace never enters the diff and the
 * sandbox reports its isolation, and exit codes are read (a failing command behind a confident reply fails). Each
 * item plants one action of the code agent and knows which verdict must fail and which must pass.
 */

const ARTIFACTS = 'packages/checks/src/checks/artifacts.ts';
const WORKSPACE = 'packages/checks/src/checks/workspace.ts';
const EXECUTION = 'packages/checks/src/checks/execution.ts';
const PROCESS = 'packages/adapters/src/process/index.ts';

type Verdicts = { id: string; outcome: string; gating: boolean }[];

/** One code block: a spec seeding `seed` files, an action, and the expectations; returns the block's record. */
async function oneBlock(
  product: BlocksProduct,
  seed: number,
  scratch: string,
  tag: string,
  action: Action,
  expect: Record<string, unknown>,
  workspace: Record<string, string> = { 'data/rentals.csv': 'bike,days\nFern 3,4\n' },
) {
  const marker = token(seed, `${tag}#marker`, 8);
  const raw: RawSpec = {
    id: `spec-${token(seed, `${tag}#spec`)}`,
    kind: 'task',
    workspace_seed: { files: workspace },
    blocks: [{ id: token(seed, `${tag}#id`), user: `${marker} Do the task.`, expect }],
  };
  const agent = plantedAgent(product, 'code', new Map([[marker, action]]), { scratch, keep: true });
  const record = await run(product, raw, agent.adapter);
  const block = record.blocks[0] as unknown as
    | { verdicts: Verdicts; observed: Record<string, unknown>; pass: boolean }
    | undefined;
  return { record, block };
}

/** The verdicts that should fail are exactly the planted ones: misses and extras both count. */
function exactly(verdicts: Verdicts, failing: readonly string[], why: string): ItemResult {
  const got = verdicts
    .filter((v) => v.gating && v.outcome !== 'pass')
    .map((v) => v.id)
    .sort();
  const want = [...failing].sort();
  const missed = want.filter((id) => !got.includes(id));
  const extra = got.filter((id) => !want.includes(id));
  if (missed.length > 0 || extra.length > 0)
    return fail(
      `${why}: the failing verdicts should be ${want.length === 0 ? 'none' : list(want)}; got ${got.length === 0 ? 'none' : list(got)}${missed.length > 0 ? ` (missed ${list(missed)})` : ''}${extra.length > 0 ? ` (extra ${list(extra)})` : ''}`,
    );
  return PASS;
}

type ArtifactCase = {
  id: string;
  tier: Tier;
  /** The file, its checks, and which check (by index) the planted change breaks, if any. */
  build(
    rng: Rng,
    path: string,
  ): { file: FileAction; checks: Record<string, unknown>[]; planted?: { file: FileAction; breaks: number } };
};

const CASES: ArtifactCase[] = [
  {
    id: 'xlsx-cell',
    tier: 1,
    build: (rng, path) => {
      const days = between(rng, 2, 40);
      const file: FileAction = {
        path: `${path}.xlsx`,
        format: 'xlsx',
        data: {
          sheets: [
            {
              name: 'Rentals',
              rows: [
                ['Bike', 'Days'],
                ['Fern 3', days],
                ['Moss Cargo', days + 1],
              ],
            },
          ],
        },
      };
      return {
        file,
        checks: [{ sheets: ['Rentals'] }, { value: { sheet: 'Rentals', cell: 'B3', equals: days + 1 } }],
        planted: {
          file: {
            ...file,
            data: {
              sheets: [
                {
                  name: 'Rentals',
                  rows: [
                    ['Bike', 'Days'],
                    ['Fern 3', days],
                    ['Moss Cargo', days],
                  ],
                },
              ],
            },
          },
          breaks: 1,
        },
      };
    },
  },
  {
    id: 'xlsx-wrong-column',
    tier: 2,
    build: (rng, path) => {
      const bike = pick(rng, SHOP.bikes);
      const file: FileAction = {
        path: `${path}.xlsx`,
        format: 'xlsx',
        data: {
          sheets: [
            {
              name: 'Rentals',
              rows: [
                ['Bike', 'Days', 'Rate'],
                [bike, 3, 12],
              ],
            },
          ],
        },
      };
      return {
        file,
        checks: [
          { header: { sheet: 'Rentals', values: ['Bike', 'Days', 'Rate'] } },
          { rows: { sheet: 'Rentals', count: 1, from_row: 2 } },
        ],
        planted: {
          file: {
            ...file,
            data: {
              sheets: [
                {
                  name: 'Rentals',
                  rows: [
                    ['Bike', 'Rate', 'Days'],
                    [bike, 12, 3],
                  ],
                },
              ],
            },
          },
          breaks: 0,
        },
      };
    },
  },
  {
    id: 'xlsx-missing-sheet',
    tier: 1,
    build: (_rng, path) => {
      const file: FileAction = {
        path: `${path}.xlsx`,
        format: 'xlsx',
        data: {
          sheets: [
            { name: 'North', rows: [['Bike'], ['Fern 3']] },
            { name: 'South', rows: [['Bike'], ['Tern Light']] },
          ],
        },
      };
      return {
        file,
        checks: [{ sheets: ['North', 'South'] }, { no_error_cells: true }],
        planted: {
          file: { ...file, data: { sheets: [{ name: 'North', rows: [['Bike'], ['Fern 3']] }] } },
          breaks: 0,
        },
      };
    },
  },
  {
    id: 'xlsx-off-by-one-total',
    tier: 3,
    build: (rng, path) => {
      const a = between(rng, 2, 9);
      const b = between(rng, 2, 9);
      const file: FileAction = {
        path: `${path}.xlsx`,
        format: 'xlsx',
        data: {
          sheets: [
            {
              name: 'Totals',
              rows: [
                ['Item', 'Days'],
                ['Fern 3', a],
                ['Tern Light', b],
              ],
            },
          ],
        },
      };
      return {
        file,
        checks: [{ total: { sheet: 'Totals', column: 'B', from_row: 2, to_row: 3, equals: a + b } }],
        planted: {
          file: {
            ...file,
            data: {
              sheets: [
                {
                  name: 'Totals',
                  rows: [
                    ['Item', 'Days'],
                    ['Fern 3', a],
                    ['Tern Light', b + 1],
                  ],
                },
              ],
            },
          },
          breaks: 0,
        },
      };
    },
  },
  {
    id: 'csv-cell',
    tier: 1,
    build: (rng, path) => {
      const days = between(rng, 2, 40);
      const file: FileAction = {
        path: `${path}.csv`,
        format: 'csv',
        data: [
          ['bike', 'days'],
          ['Fern 3', days],
        ],
      };
      return {
        file,
        checks: [{ header: ['bike', 'days'] }, { value: { column: 'days', row: 2, equals: days } }],
        planted: {
          file: {
            ...file,
            data: [
              ['bike', 'days'],
              ['Fern 3', days - 1],
            ],
          },
          breaks: 1,
        },
      };
    },
  },
  {
    id: 'csv-wrong-column',
    tier: 2,
    build: (rng, path) => {
      const days = between(rng, 2, 40);
      const file: FileAction = {
        path: `${path}.csv`,
        format: 'csv',
        data: [
          ['bike', 'days'],
          ['Fern 3', days],
        ],
      };
      return {
        file,
        checks: [{ header: ['bike', 'days'] }, { rows: 1 }],
        planted: {
          file: {
            ...file,
            data: [
              ['bike', 'nights'],
              ['Fern 3', days],
            ],
          },
          breaks: 0,
        },
      };
    },
  },
  {
    id: 'csv-row-count',
    tier: 2,
    build: (rng, path) => {
      const n = between(rng, 2, 6);
      const rows = [['bike', 'days'], ...Array.from({ length: n }, (_, i) => [pick(rng, SHOP.bikes), i + 1])];
      return {
        file: { path: `${path}.csv`, format: 'csv', data: rows },
        checks: [{ rows: n }],
        planted: { file: { path: `${path}.csv`, format: 'csv', data: rows.slice(0, -1) }, breaks: 0 },
      };
    },
  },
  {
    id: 'json-schema',
    tier: 2,
    build: (rng, path) => {
      const days = between(rng, 2, 40);
      const file: FileAction = {
        path: `${path}.json`,
        format: 'json',
        data: { rental: { bike: 'Fern 3', days }, currency: 'EUR' },
      };
      return {
        file,
        checks: [
          { subset: { rental: { bike: 'Fern 3' }, currency: 'EUR' } },
          { value: { path: 'rental.days', equals: days } },
        ],
        planted: {
          file: { ...file, data: { rental: { bike: 'Fern 3', days: String(days) }, currency: 'EUR' } },
          breaks: 1,
        },
      };
    },
  },
  {
    id: 'json-missing-field',
    tier: 2,
    build: (_rng, path) => {
      const file: FileAction = {
        path: `${path}.json`,
        format: 'json',
        data: { rental: { bike: 'Fern 3' }, currency: 'EUR' },
      };
      return {
        file,
        checks: [{ subset: { rental: { bike: 'Fern 3' }, currency: 'EUR' } }],
        planted: { file: { ...file, data: { rental: { bike: 'Fern 3' } } }, breaks: 0 },
      };
    },
  },
  {
    id: 'pdf-page-count',
    tier: 1,
    build: (rng, path) => {
      const pages = between(rng, 2, 6);
      const file: FileAction = {
        path: `${path}.pdf`,
        format: 'pdf',
        data: { pages: Array.from({ length: pages }, (_, i) => `Rental page ${i + 1}`) },
      };
      return {
        file,
        checks: [{ page_count: pages }, { contains: 'Rental page 1' }],
        planted: {
          file: {
            ...file,
            data: { pages: Array.from({ length: pages + 1 }, (_, i) => `Rental page ${i + 1}`) },
          },
          breaks: 0,
        },
      };
    },
  },
  {
    id: 'pdf-text',
    tier: 2,
    build: (rng, path) => {
      const bike = pick(rng, SHOP.bikes);
      const file: FileAction = {
        path: `${path}.pdf`,
        format: 'pdf',
        data: { pages: [`Report for the ${bike}`] },
      };
      return {
        file,
        checks: [{ page_count: 1 }, { contains: `the ${bike}` }],
        planted: { file: { ...file, data: { pages: ['Report for the fleet'] } }, breaks: 1 },
      };
    },
  },
  {
    id: 'docx-text',
    tier: 2,
    build: (rng, path) => {
      const who = pick(rng, SHOP.customers);
      const file: FileAction = {
        path: `${path}.docx`,
        format: 'docx',
        data: { paragraphs: ['Rental agreement', `Renter: ${who}`] },
      };
      return {
        file,
        checks: [{ contains: `Renter: ${who}` }, { not_contains: 'TODO' }],
        planted: {
          file: { ...file, data: { paragraphs: ['Rental agreement', 'Renter: unknown'] } },
          breaks: 0,
        },
      };
    },
  },
  {
    id: 'txt-lines',
    tier: 1,
    build: (rng, path) => {
      const n = between(rng, 3, 8);
      const text = Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n');
      return {
        file: { path: `${path}.txt`, format: 'txt', data: `${text}\n` },
        checks: [{ lines: n }],
        planted: {
          file: { path: `${path}.txt`, format: 'txt', data: `${text}\nline ${n + 1}\n` },
          breaks: 0,
        },
      };
    },
  },
];

function artifactItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const artifactCase of CASES) {
    for (const fate of ['right', 'planted'] as const) {
      const id = `code/artifacts/${artifactCase.id}/${fate}`;
      items.push({
        id,
        family: 'code-artifacts',
        tier: Math.min(5, artifactCase.tier + (fate === 'planted' ? 1 : 0)) as Tier,
        level: 1,
        component: ARTIFACTS,
        title: `a code agent's ${artifactCase.id.replace(/-/g, ' ')} file ${fate === 'right' ? 'that holds the planted content passes every declared check' : 'with one planted defect fails exactly the check it breaks, read from the file itself'}`,
        cause: `The artifacts check opens a written ${artifactCase.id.split('-')[0]} file and judges its content against each declared check.`,
        check: async ({ seed, scratch, product }) => {
          const rng = rngFor(seed, id);
          const path = `out/${token(seed, id)}`;
          const { file, checks, planted } = artifactCase.build(rng, path);
          const written = fate === 'planted' && planted ? planted.file : file;
          // The reply claims success either way: the check must read the file, never the agent's words.
          const { block } = await oneBlock(
            product,
            seed,
            scratch,
            id,
            {
              reply: `Done: ${file.path} is ready and correct.`,
              files: [written],
              commands: [{ command: 'python build.py', exitCode: 0 }],
            },
            { artifacts: [{ path: file.path, kind: file.format === 'txt' ? 'text' : file.format, checks }] },
          );
          if (!block) return fail('the run holds no block');
          const failing =
            fate === 'planted' && planted
              ? [
                  `artifacts.${file.path}.${planted.breaks}.${Object.keys(checks[planted.breaks] as object)[0]}`,
                ]
              : [];
          return exactly(
            block.verdicts,
            failing,
            fate === 'planted'
              ? `the planted defect breaks only ${failing[0]}`
              : 'the file holds the planted content',
          );
        },
      });
    }
  }
  return items;
}

type DiffCase = {
  id: string;
  tier: Tier;
  /** The seeded workspace, the agent's writes and deletes, the expectation, and the diff the run must observe. */
  build(
    rng: Rng,
    base: string,
  ): {
    workspace: Record<string, string>;
    action: Pick<Action, 'files' | 'deletes'>;
    expect: Record<string, unknown>;
    diff: { created: string[]; changed: string[]; deleted: string[] };
    failing: string[];
  };
};

const seeded = (n: number, base: string) =>
  Object.fromEntries(
    Array.from({ length: n }, (_, i) => [`${base}/in-${i}.csv`, `id,value\n${i},${i * 3}\n`]),
  );

const DIFFS: DiffCase[] = [
  {
    id: 'create-one',
    tier: 1,
    build: (_r, base) => ({
      workspace: seeded(3, base),
      action: { files: [{ path: `${base}/out.csv`, format: 'csv', data: [['a'], [1]] }] },
      expect: { workspace: { created: [`${base}/out.csv`], others_untouched: true } },
      diff: { created: [`${base}/out.csv`], changed: [], deleted: [] },
      failing: [],
    }),
  },
  {
    id: 'change-one',
    tier: 2,
    build: (_r, base) => ({
      workspace: seeded(3, base),
      action: { files: [{ path: `${base}/in-1.csv`, format: 'txt', data: 'id,value\n1,4\n' }] },
      expect: { workspace: { changed: [`${base}/in-1.csv`], others_untouched: true } },
      diff: { created: [], changed: [`${base}/in-1.csv`], deleted: [] },
      failing: [],
    }),
  },
  {
    id: 'delete-one',
    tier: 2,
    build: (_r, base) => ({
      workspace: seeded(3, base),
      action: { deletes: [`${base}/in-2.csv`] },
      expect: { workspace: { deleted: [`${base}/in-2.csv`], others_untouched: true } },
      diff: { created: [], changed: [], deleted: [`${base}/in-2.csv`] },
      failing: [],
    }),
  },
  {
    id: 'unexpected-change',
    tier: 3,
    build: (_r, base) => ({
      workspace: seeded(3, base),
      action: {
        files: [
          { path: `${base}/out.csv`, format: 'csv', data: [['a'], [1]] },
          { path: `${base}/in-0.csv`, format: 'txt', data: 'id,value\n0,1\n' },
        ],
      },
      expect: { workspace: { created: [`${base}/out.csv`], others_untouched: true } },
      diff: { created: [`${base}/out.csv`], changed: [`${base}/in-0.csv`], deleted: [] },
      failing: ['workspace.others_untouched'],
    }),
  },
  {
    id: 'unexpected-delete',
    tier: 3,
    build: (_r, base) => ({
      workspace: seeded(4, base),
      action: {
        files: [{ path: `${base}/out.csv`, format: 'csv', data: [['a'], [1]] }],
        deletes: [`${base}/in-3.csv`],
      },
      expect: { workspace: { created: [`${base}/out.csv`], deleted: [], others_untouched: true } },
      diff: { created: [`${base}/out.csv`], changed: [], deleted: [`${base}/in-3.csv`] },
      failing: ['workspace.deleted', 'workspace.others_untouched'],
    }),
  },
  {
    id: 'missing-create',
    tier: 2,
    build: (_r, base) => ({
      workspace: seeded(2, base),
      action: { files: [] },
      expect: { workspace: { created: [`${base}/out.csv`] } },
      diff: { created: [], changed: [], deleted: [] },
      failing: ['workspace.created'],
    }),
  },
  {
    id: 'rewrite-same-bytes',
    tier: 4,
    build: (_r, base) => ({
      workspace: seeded(2, base),
      action: { files: [{ path: `${base}/in-0.csv`, format: 'txt', data: 'id,value\n0,0\n' }] },
      expect: { workspace: { changed: [], others_untouched: true } },
      diff: { created: [], changed: [], deleted: [] },
      failing: [],
    }),
  },
  {
    id: 'thousand-files-one-change',
    tier: 5,
    build: (rng, base) => {
      const at = between(rng, 0, 999);
      return {
        workspace: seeded(1000, base),
        action: { files: [{ path: `${base}/in-${at}.csv`, format: 'txt', data: `id,value\n${at},-1\n` }] },
        expect: { workspace: { changed: [`${base}/in-${at}.csv`], others_untouched: true } },
        diff: { created: [], changed: [`${base}/in-${at}.csv`], deleted: [] },
        failing: [],
      };
    },
  },
  {
    id: 'thousand-files-one-stray',
    tier: 5,
    build: (rng, base) => {
      const at = between(rng, 0, 999);
      return {
        workspace: seeded(1000, base),
        action: {
          files: [
            { path: `${base}/report.csv`, format: 'csv', data: [['n'], [1000]] },
            { path: `${base}/in-${at}.csv`, format: 'txt', data: `id,value\n${at},-1\n` },
          ],
        },
        expect: { workspace: { created: [`${base}/report.csv`], others_untouched: true } },
        diff: { created: [`${base}/report.csv`], changed: [`${base}/in-${at}.csv`], deleted: [] },
        failing: ['workspace.others_untouched'],
      };
    },
  },
  {
    id: 'thousand-files-delete-and-create',
    tier: 5,
    build: (rng, base) => {
      const at = between(rng, 0, 999);
      return {
        workspace: seeded(1000, base),
        action: {
          files: [{ path: `${base}/merged.csv`, format: 'csv', data: [['n'], [999]] }],
          deletes: [`${base}/in-${at}.csv`],
        },
        expect: {
          workspace: {
            created: [`${base}/merged.csv`],
            deleted: [`${base}/in-${at}.csv`],
            others_untouched: true,
          },
        },
        diff: { created: [`${base}/merged.csv`], changed: [], deleted: [`${base}/in-${at}.csv`] },
        failing: [],
      };
    },
  },
];

function diffItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const diffCase of DIFFS) {
    for (const folder of ['data', 'deep/nested/inputs']) {
      const id = `code/workspace/${diffCase.id}/${folder.split('/').length}`;
      items.push({
        id,
        family: 'code-workspace',
        tier: diffCase.tier,
        level: 1,
        component: diffCase.id.startsWith('thousand') ? PROCESS : WORKSPACE,
        title: `a code agent that ${diffCase.id.replace(/-/g, ' ')} under ${folder} leaves exactly the planted workspace diff, and the workspace check fails exactly where the planted diff breaks the expectation`,
        cause: diffCase.id.startsWith('thousand')
          ? 'The process adapter diffs a workspace of 1,000 files exactly: created, changed and deleted.'
          : ['unexpected-change', 'unexpected-delete', 'missing-create'].includes(diffCase.id)
            ? 'The workspace check fails exactly the expectation an unexpected, missing or deleted change breaks.'
            : 'The workspace diff lists the net change: created, changed and deleted, and never a file rewritten with the same bytes.',
        check: async ({ seed, scratch, product }) => {
          const rng = rngFor(seed, id);
          const base = `${folder}/${token(seed, id)}`;
          const planted = diffCase.build(rng, base);
          const { block } = await oneBlock(
            product,
            seed,
            scratch,
            id,
            { reply: 'Finished.', ...planted.action, commands: [{ command: 'python step.py', exitCode: 0 }] },
            planted.expect,
            planted.workspace,
          );
          if (!block) return fail('the run holds no block');
          const diff = block.observed.workspaceDiff as
            | { created: string[]; changed: string[]; deleted: string[] }
            | undefined;
          if (!diff) return fail('the block should record its workspace diff; it records none');
          for (const set of ['created', 'changed', 'deleted'] as const) {
            const got = [...diff[set]].sort();
            const want = [...planted.diff[set]].sort();
            if (got.join(',') !== want.join(','))
              return fail(
                `the diff should list ${set} ${want.length === 0 ? 'nothing' : list(want)}; it lists ${got.length === 0 ? 'nothing' : list(got)}`,
              );
          }
          return exactly(
            block.verdicts,
            planted.failing,
            `the planted diff ${JSON.stringify(planted.diff).slice(0, 120)}`,
          );
        },
      });
    }
  }
  return items;
}

/** Sandbox isolation: a write outside the workspace never enters the diff or the artifacts, and the run says how isolated it was. */
function isolationItems(): BankItem[] {
  const items: BankItem[] = [];
  const escapes = ['sibling', 'parent', 'two-up', 'absolute-scratch'] as const;
  for (const route of escapes) {
    for (const alsoInside of [false, true]) {
      for (const format of ['txt', 'json', 'csv'] as const) {
        const id = `code/isolation/${route}/${alsoInside ? 'with-inside-file' : 'only-outside'}/${format}`;
        items.push({
          id,
          family: 'code-isolation',
          tier: (route === 'absolute-scratch' ? 4 : 3) as Tier,
          level: 1,
          component: PROCESS,
          title: `a code agent that writes a ${format} file outside its workspace (${route.replace(/-/g, ' ')})${alsoInside ? ' and one inside' : ''}: the outside file is in no diff and no artifact, the inside one is, and the block reports a local sandbox of weak isolation`,
          cause:
            'The process adapter snapshots only the workspace and records the sandbox isolation on every block.',
          check: async ({ seed, scratch, product }) => {
            const name = `route-${token(seed, id)}.${format}`;
            const outside =
              route === 'sibling'
                ? `../${name}`
                : route === 'parent'
                  ? `../../${name}`
                  : route === 'two-up'
                    ? `../../../${name}`
                    : join(scratch, name);
            const inside = `out/${token(seed, `${id}#inside`)}.${format}`;
            const data =
              format === 'json' ? { leaked: true } : format === 'csv' ? [['leaked'], ['yes']] : 'leaked\n';
            const files: FileAction[] = [
              { path: outside, format, data },
              ...(alsoInside ? [{ path: inside, format, data } as FileAction] : []),
            ];
            const { block } = await oneBlock(
              product,
              seed,
              scratch,
              id,
              { reply: 'Saved.', files, commands: [{ command: 'python leak.py', exitCode: 0 }] },
              { workspace: { created: alsoInside ? [inside] : [], others_untouched: true } },
            );
            if (!block) return fail('the run holds no block');
            const observed = block.observed as {
              workspaceDiff?: { created: string[]; changed: string[]; deleted: string[] };
              artifacts?: { path: string }[];
              sandbox?: { kind?: string; isolation?: string; root?: string };
            };
            const listed = [
              ...(observed.workspaceDiff?.created ?? []),
              ...(observed.workspaceDiff?.changed ?? []),
              ...(observed.artifacts ?? []).map((a) => a.path),
            ];
            const root = observed.sandbox?.root;
            const landed = root
              ? existsSync(join(root, outside)) ||
                existsSync(join(dirname(root), name)) ||
                existsSync(outside)
              : false;
            return expectAll([
              [
                !listed.some((path) => path.includes(name)),
                `the outside file ${name} should be in no diff and no artifact; it is listed`,
              ],
              [
                !alsoInside || listed.includes(inside),
                `the inside file ${inside} should be in the diff; the diff lists ${list(listed)}`,
              ],
              [
                observed.sandbox?.kind === 'local' && observed.sandbox.isolation === 'weak',
                `the block should report a local sandbox of weak isolation; it reports ${JSON.stringify(observed.sandbox ?? null)}`,
              ],
              [
                landed || !root,
                `the outside write should show what weak isolation means: the file landed outside the workspace; it is nowhere`,
              ],
            ]);
          },
        });
      }
    }
  }
  return items;
}

type ExitCase = {
  id: string;
  tier: Tier;
  action: Pick<Action, 'commands' | 'exit' | 'reply' | 'stderr'>;
  expect: Record<string, unknown>;
  failing: string[];
};

const EXITS: ExitCase[] = [
  {
    id: 'clean',
    tier: 1,
    action: { reply: 'Done.', commands: [{ command: 'python a.py', exitCode: 0 }], exit: 0 },
    expect: { execution: { ran_code: true, exit_code: 0 } },
    failing: [],
  },
  {
    id: 'last-command-fails-confident-reply',
    tier: 2,
    action: {
      reply: 'All good, everything worked.',
      commands: [
        { command: 'python a.py', exitCode: 0 },
        { command: 'python b.py', exitCode: 1 },
      ],
      exit: 0,
    },
    expect: { execution: { exit_code: 0 } },
    failing: ['execution.exit_code'],
  },
  {
    id: 'agent-crashes-after-clean-command',
    tier: 3,
    action: {
      reply: 'Done.',
      commands: [{ command: 'python a.py', exitCode: 0 }],
      exit: 3,
      stderr: 'Traceback: KeyError',
    },
    expect: { execution: { exit_code: 0 } },
    failing: ['execution.exit_code'],
  },
  {
    id: 'early-failure-then-recovery',
    tier: 3,
    action: {
      reply: 'Fixed it.',
      commands: [
        { command: 'python a.py', exitCode: 1 },
        { command: 'python a.py --fixed', exitCode: 0 },
      ],
      exit: 0,
    },
    expect: { execution: { exit_code: 0 } },
    failing: [],
  },
  {
    id: 'expected-non-zero',
    tier: 3,
    action: {
      reply: 'The check fails as expected.',
      commands: [{ command: 'python check.py', exitCode: 2 }],
      exit: 0,
    },
    expect: { execution: { exit_code: 2 } },
    failing: [],
  },
  {
    id: 'no-code-run',
    tier: 2,
    action: { reply: 'I answered from memory.', commands: [], exit: 0 },
    expect: { execution: { ran_code: true } },
    failing: ['execution.ran_code'],
  },
  {
    id: 'code-forbidden',
    tier: 2,
    action: { reply: 'I ran a script.', commands: [{ command: 'python a.py', exitCode: 0 }], exit: 0 },
    expect: { execution: { ran_code: false } },
    failing: ['execution.ran_code'],
  },
  {
    id: 'too-many-commands',
    tier: 2,
    action: {
      reply: 'Done.',
      commands: [1, 2, 3, 4].map((i) => ({ command: `python step${i}.py`, exitCode: 0 })),
      exit: 0,
    },
    expect: { execution: { max_commands: 3 } },
    failing: ['execution.max_commands'],
  },
  {
    id: 'commands-at-limit',
    tier: 2,
    action: {
      reply: 'Done.',
      commands: [1, 2, 3].map((i) => ({ command: `python step${i}.py`, exitCode: 0 })),
      exit: 0,
    },
    expect: { execution: { max_commands: 3 } },
    failing: [],
  },
  {
    id: 'crash-without-commands',
    tier: 4,
    action: { reply: 'Here you go.', commands: [], exit: 1, stderr: 'Segmentation fault' },
    expect: { execution: { exit_code: 0 } },
    failing: ['execution.exit_code'],
  },
];

function exitItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const exitCase of EXITS) {
    for (const extra of ['alone', 'with-file']) {
      const id = `code/exit/${exitCase.id}/${extra}`;
      items.push({
        id,
        family: 'code-exit',
        tier: exitCase.tier,
        level: 1,
        component: EXECUTION,
        title: `a code agent whose run is ${exitCase.id.replace(/-/g, ' ')}${extra === 'with-file' ? ', beside a correct file' : ''}: the execution check reads the exit codes, never the reply, and fails exactly ${exitCase.failing.length === 0 ? 'nothing' : list(exitCase.failing)}`,
        cause: exitCase.id.includes('commands')
          ? 'The execution check counts the commands the agent ran against max_commands.'
          : exitCase.id === 'no-code-run' || exitCase.id === 'code-forbidden'
            ? 'The execution check reads ran_code from the commands the agent ran, never from its reply.'
            : "The execution check reads the agent process's exit code when it is non-zero, else the last command's, never the reply.",
        check: async ({ seed, scratch, product }) => {
          const path = `out/${token(seed, id)}.csv`;
          const files: FileAction[] =
            extra === 'with-file' ? [{ path, format: 'csv', data: [['ok'], [1]] }] : [];
          const expect = {
            ...exitCase.expect,
            ...(extra === 'with-file' ? { artifacts: [{ path, kind: 'csv', checks: [{ rows: 1 }] }] } : {}),
          };
          const { block } = await oneBlock(
            product,
            seed,
            scratch,
            id,
            { ...exitCase.action, reply: exitCase.action.reply ?? 'Done.', files },
            expect,
          );
          if (!block) return fail('the run holds no block');
          return exactly(
            block.verdicts,
            exitCase.failing,
            `the planted exit codes ${JSON.stringify(exitCase.action.commands?.map((c) => c.exitCode))}, agent ${exitCase.action.exit ?? 0}`,
          );
        },
      });
    }
  }
  return items;
}

/** The code-interpreter-only checks of level 1. */
export function codeItems(): BankItem[] {
  return [...artifactItems(), ...diffItems(), ...isolationItems(), ...exitItems()];
}
