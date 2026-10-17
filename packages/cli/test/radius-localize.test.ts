import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { main } from '../src/index';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const linked = join(root, 'examples/acme/prompts/linked');
const registry = join(root, 'examples/acme/prompts/acme-sales.sections.yaml');
let dir = '';
async function cli(args: string[]) {
  let out = '';
  let err = '';
  const code = await main(args, {
    cwd: dir,
    out: (s) => {
      out += s;
    },
    err: (s) => {
      err += s;
    },
  });
  return { code, out, err };
}
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'acme-localize-'));
  // The linked specs start mid-conversation: the Acme agent fails the first block of the order and the
  // porting specs, and the later blocks of the order spec fail after it.
  const run = await cli([
    'campaign',
    'run',
    linked,
    '--store',
    'acme.db',
    '--campaign',
    'linked',
    '--repeats',
    '2',
  ]);
  expect(run.code).toBe(1);
}, 120_000);
afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

it('ranks the sections of the root failures and drops inherited failures', async () => {
  const grouped = await cli([
    'radius',
    'localize',
    linked,
    '--store',
    'acme.db',
    '--campaign',
    'linked',
    '--sections',
    registry,
  ]);
  expect(grouped.code).toBe(0);
  expect(grouped.out).toContain('8 block rows, failure weight 2.000, 6 inherited failures dropped');
  expect(grouped.out).toMatch(/1-3 +porting_check_first +0\.707/);
  expect(grouped.out).toContain(
    'Failing roots: acme-linked-order-confirm#details, acme-linked-porting#keep-number.',
  );
  expect(grouped.out).toContain('Not ranked, global: identity, language, style, facts_from_tools.');
  // Counted flat, the inherited failures put the innocent confirmation rule first.
  const flat = await cli([
    'radius',
    'localize',
    linked,
    '--store',
    'acme.db',
    '--campaign',
    'linked',
    '--sections',
    registry,
    '--counting',
    'flat',
    '--top',
    '1',
  ]);
  expect(flat.out).toMatch(/\n {2}1 +explicit_confirm +0\.632/);
  const json = JSON.parse(
    (
      await cli([
        'radius',
        'localize',
        linked,
        '--store',
        'acme.db',
        '--campaign',
        'linked',
        '--sections',
        registry,
        '--json',
      ])
    ).out,
  );
  expect(json).toMatchObject({ prompt: 'acme-sales', mode: 'F', suiteRuns: 2 });
  expect(json.localization.sections[0]).toMatchObject({ best: 1, worst: 3 });
}, 120_000);

it('refuses bad input with exit 2', async () => {
  const base = ['radius', 'localize', linked, '--store', 'acme.db'];
  expect((await cli([...base, '--campaign', 'linked'])).code).toBe(2);
  expect((await cli([...base, '--campaign', 'nope', '--sections', registry])).code).toBe(2);
  expect((await cli([...base, '--campaign', 'linked', '--sections', registry, '--mode', 'T'])).code).toBe(1);
  expect((await cli([...base, '--campaign', 'linked', '--sections', registry, '--counting', 'x'])).code).toBe(
    2,
  );
  expect(
    (await cli([...base, '--campaign', 'linked', '--sections', registry, '--prompt', 'other'])).code,
  ).toBe(2);
}, 120_000);
