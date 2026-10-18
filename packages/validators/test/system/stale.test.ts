import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { DOCUMENTED_CHECKS, MIN_GOLDENS } from '../../src/ladders/system/bank/documented';
import { type BankItem, PASS, scratchFolder, systemBank } from '../../src/ladders/system/bank/index';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const bank = systemBank();
const scratch = scratchFolder();
afterAll(() => scratch.remove());

/** The first paragraph of checks.md: "`defaultChecks()` returns N checks, in the order ...: `a`, `b`, ...". */
function checksFromDocs(): { count: number; names: string[] } {
  const page = readFileSync(`${ROOT}docs/reference/checks.md`, 'utf8');
  const line = page.split('\n').find((text) => text.includes('`defaultChecks()` returns')) ?? '';
  const count = Number(/returns (\d+) checks/.exec(line)?.[1]);
  const list = line.slice(
    line.indexOf('in the order the runner applies them:'),
    line.indexOf('. `defaultChecks({'),
  );
  return { count, names: [...list.matchAll(/`([a-z0-9_]+)`/g)].map((match) => match[1] as string) };
}

const estateContracts = [
  {
    id: 'breaker/tools/estate-lint-clean-or-findings-codes',
    page: 'docs/reference/cli.md',
    before: '| `ORPHAN` | nothing in the estate names this file |',
    after: '| `RENAMED_ORPHAN` | nothing in the estate names this file |',
  },
  {
    id: 'breaker/tools/estate-scan-no-model-output-order',
    page: 'docs/reference/cli.md',
    before: '  No model call: structured atoms and code-found prose candidates (--no-model).',
    after: '  No model call: a mismatched scan contract (--no-model).',
  },
  {
    id: 'breaker/tools/estate-approve-counts-match-docs',
    page: 'docs/estate.md',
    before: /approved\.yaml: all \d+ atoms are approved\./,
    after: 'approved.yaml: all 999999 atoms are approved.',
  },
  ...(['run', 'mutate'] as const).map((command) => ({
    id: `breaker/tools/estate-${command}-not-built-message`,
    page: 'docs/reference/cli.md',
    before:
      command === 'run'
        ? 'Exit 0 when every spec passes, 1 when one fails, 2 on a usage or input error'
        : 'Exit 0 when the mutant is written, 2 on a usage or input error',
    after:
      command === 'run'
        ? 'Exit 0 when every spec passes, 1 when one fails, 9 on a usage or input error'
        : 'Exit 0 when the mutant is written, 9 on a usage or input error',
  })),
];

describe('the system items agree with the contract the pages document', () => {
  it('names the default checks checks.md lists, in its order, as one constant', () => {
    const docs = checksFromDocs();
    expect(docs.names).toHaveLength(docs.count);
    expect([...DOCUMENTED_CHECKS]).toEqual(docs.names);
  });

  it('leaves out criteria decided on fewer goldens than statistics.md names', () => {
    const page = readFileSync(`${ROOT}docs/concepts/statistics.md`, 'utf8');
    expect(Number(/fewer than `minGoldens` goldens \(default (\d+)\)/.exec(page)?.[1])).toBe(MIN_GOLDENS);
  });

  // Items rewritten where the pages and the code agree and the item did not. Each holds on main.
  const fixed = [
    'claim/adapters/http/failing-status',
    'failure/http-500-past-retries',
    'claim/checks/defaults/order',
    'claim/checks/defaults/judge-last',
    'cli/run/checks',
    'breaker/cli/run-json-keys',
    'breaker/checks/relevancy-quarter-of-terms-inconclusive',
    'hostile/case-of-must-not',
    'claim/report/line-pass-hat-k-bounds',
    'claim/report/line-pass-at-k-bounds',
    'claim/report/compare-self',
    'claim/report/cli-compare-self',
    'breaker/tools/compare-bad-input-exit-2',
    'breaker/datasets/campaign-refuses-repeated-prompts',
    'breaker/tools/judge-calibrate-judge-names',
    'breaker/tools/validate-floors-line',
    ...estateContracts
      .filter((contract) => !contract.id.includes('approve-counts'))
      .map((contract) => contract.id),
  ];
  for (const id of fixed) {
    it(`holds: ${id}`, async () => {
      const item = bank.find((each) => each.id === id) as BankItem;
      expect(item, id).toBeDefined();
      await expect(item.check({ seed: 5, root: ROOT, scratch: scratch.path })).resolves.toEqual(PASS);
    }, 120_000);
  }
});

// Mutate copies of the contract pages, never the repository or imported CLI modules.
describe('estate items detect a planted code/docs mismatch', () => {
  for (const contract of estateContracts) {
    it(`goes from green to red: ${contract.id}`, async () => {
      const root = join(scratch.path, 'mismatched-contract', contract.id.split('/').at(-1) ?? contract.id);
      mkdirSync(join(root, 'docs/reference'), { recursive: true });
      symlinkSync(join(ROOT, 'examples'), join(root, 'examples'), 'dir');
      for (const page of ['docs/estate.md', 'docs/reference/cli.md']) {
        let original = readFileSync(join(ROOT, page), 'utf8');
        // The builder owns the real docs correction. Start this mutation proof from a synchronized copy.
        if (page === 'docs/estate.md' && contract.id.includes('approve-counts')) {
          const fixture = parse(
            readFileSync(join(ROOT, 'examples/estates/fixture/approved.yaml'), 'utf8'),
          ) as { atoms: unknown[] };
          original = original.replace(
            /approved\.yaml: all \d+ atoms are approved\./,
            `approved.yaml: all ${fixture.atoms.length} atoms are approved.`,
          );
        }
        writeFileSync(join(root, page), original);
      }
      const item = bank.find((each) => each.id === contract.id) as BankItem;
      expect(item).toBeDefined();
      const context = { seed: 5, root, scratch: scratch.path };
      await expect(item.check(context)).resolves.toEqual(PASS);
      const path = join(root, contract.page);
      const original = readFileSync(path, 'utf8');
      const changed = original.replace(contract.before, contract.after);
      expect(changed).not.toBe(original);
      writeFileSync(path, changed);
      const result = await item.check(context);
      expect(result.pass).toBe(false);
      if (!result.pass) expect(result.detail).not.toBe('');
    }, 120_000);
  }
});

describe('the approval count follows the docs, including existing drift', () => {
  const id = 'breaker/tools/estate-approve-counts-match-docs';
  const item = bank.find((each) => each.id === id) as BankItem;
  const page = readFileSync(join(ROOT, 'docs/estate.md'), 'utf8');
  const countLine = /approved\.yaml: all (\d+) atoms are approved\./;
  const fixture = parse(readFileSync(join(ROOT, 'examples/estates/fixture/approved.yaml'), 'utf8')) as {
    atoms: unknown[];
  };

  it('reports the current fixture/docs disagreement instead of hiding it', async () => {
    const documented = Number(countLine.exec(page)?.[1]);
    expect(Number.isFinite(documented)).toBe(true);
    const result = await item.check({ seed: 5, root: ROOT, scratch: scratch.path });
    expect(result.pass).toBe(documented === fixture.atoms.length);
  }, 120_000);

  it('passes when a scratch contract documents the current fixture count', async () => {
    const root = join(scratch.path, 'synchronized-approval');
    mkdirSync(join(root, 'docs'), { recursive: true });
    symlinkSync(join(ROOT, 'examples'), join(root, 'examples'), 'dir');
    writeFileSync(
      join(root, 'docs/estate.md'),
      page.replace(countLine, `approved.yaml: all ${fixture.atoms.length} atoms are approved.`),
    );
    await expect(item.check({ seed: 5, root, scratch: scratch.path })).resolves.toEqual(PASS);
  }, 120_000);
});
