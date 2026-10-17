import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  BANK_LEVELS,
  type BankItem,
  type BlocksProduct,
  bankProblems,
  blocksBank,
  blocksLadder,
  CHEATERS,
  patched,
  realProduct,
} from '../src/ladders/blocks/index';
import { registeredLadders } from '../src/ladders/index';

/**
 * The blocks validator (docs/validators.md section 13). Every item must fail on a product that takes a shortcut
 * (the cheaters of its level, read-the-recipe and echo-the-spec-name included) and pass on a correct one; the
 * truth an item holds never reaches a file, a spec or the agent. The whole bank on every cheater takes long (the
 * code agent runs in processes), so this file samples three items of every family; `probe` sweeps run the rest
 * (validators/blocks/HANDOVER.md).
 */

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SEED = 1;
const bank = blocksBank();
const scratches: string[] = [];

afterAll(() => {
  for (const path of scratches) rmSync(path, { recursive: true, force: true });
});

function scratchFolder(): string {
  const scratch = mkdtempSync(join(tmpdir(), 'blocks-test-'));
  scratches.push(scratch);
  return scratch;
}

/** Runs one item on one product in a scratch folder of its own, so no run sees another's files. */
async function passes(item: BankItem, product: BlocksProduct, scratch = scratchFolder()): Promise<boolean> {
  try {
    return (await item.check({ seed: SEED, root: ROOT, scratch, product })).pass;
  } catch {
    return false;
  }
}

/** Three items of every family, in bank order: the sample this file runs. */
const sample = (() => {
  const seen = new Map<string, number>();
  return bank.filter((item) => {
    const count = seen.get(item.family) ?? 0;
    seen.set(item.family, count + 1);
    return count < 3;
  });
})();

describe('the blocks bank', () => {
  it('holds the section 12.1 minimum: 300 items, no family under 20, every tier, every level, unique ids', () => {
    expect(bankProblems(bank)).toEqual([]);
    expect(bank.length).toBeGreaterThanOrEqual(300);
  });

  it('cites for every item a doc section that defines its contract, and that section exists', () => {
    const missing: string[] = [];
    for (const item of bank) {
      const ref = item.contract ?? '';
      const local = /^(docs\/[^#]+)#(.+)$/.exec(ref);
      if (/^origin\/[^:]+:(docs|research)\/[^#]+(#.+)?$/.test(ref)) continue;
      if (!local) {
        missing.push(`${item.id}: ${ref || 'none'}`);
        continue;
      }
      const [, path, heading] = local as unknown as [string, string, string];
      const text = existsSync(join(ROOT, path)) ? readFileSync(join(ROOT, path), 'utf8') : '';
      const headings = text
        .split('\n')
        .filter((line) => /^#+ /.test(line))
        .map((line) => line.replace(/^#+ /, '').trim());
      if (!headings.some((each) => each === heading || each.startsWith(heading)))
        missing.push(`${item.id}: ${ref}`);
    }
    expect(missing).toEqual([]);
  });

  it('tags every item with one fix cause, and holds about 200 distinct causes', () => {
    for (const item of bank) expect(item.cause.trim()).not.toBe('');
    expect(new Set(bank.map((item) => item.cause)).size).toBeGreaterThanOrEqual(200);
  });

  it('runs every level for both agent kinds', () => {
    for (const level of BANK_LEVELS) {
      const ids = bank.filter((item) => item.level === level.level).map((item) => item.id);
      expect(
        ids.some((id) => id.includes('/code/') || id.startsWith('code/')),
        `level ${level.id} has a code-agent item`,
      ).toBe(true);
      expect(
        ids.some((id) => !id.includes('/code/') && !id.startsWith('code/')),
        `level ${level.id} has a normal-agent item`,
      ).toBe(true);
    }
  });

  it('is registered as the blocks validator with one level per capability', () => {
    const ladder = registeredLadders().blocks;
    expect(ladder?.component).toBe('blocks');
    expect(ladder?.levels.map((level) => level.id)).toEqual(BANK_LEVELS.map((level) => level.id));
    expect(blocksLadder().levels).toHaveLength(9);
  });

  it('gives every level the cheaters of the approved design and its own', () => {
    for (const name of [
      'always-pass',
      'everything-blocked',
      'radius-everything',
      'read-the-recipe',
      'echo-the-spec-name',
    ])
      expect(CHEATERS.some((cheater) => cheater.name === name)).toBe(true);
    for (const level of BANK_LEVELS) expect(CHEATERS.some((c) => c.levels.includes(level.level))).toBe(true);
  });
});

describe('every sampled item fails on a cheating product', () => {
  const real = realProduct();
  it.for(BANK_LEVELS.map((level) => level.level))('level %i', { timeout: 1_800_000 }, async (level) => {
    const cheaters = CHEATERS.filter((cheater) => cheater.levels.includes(level)).map((cheater) =>
      cheater.make(real),
    );
    const survivors: string[] = [];
    for (const item of sample.filter((each) => each.level === level)) {
      let caught = false;
      for (const cheater of cheaters) {
        if (!(await passes(item, cheater))) {
          caught = true;
          break;
        }
      }
      if (!caught) survivors.push(item.id);
    }
    expect(survivors).toEqual([]);
  });
});

describe('the truth stays outside the product', () => {
  /** Every text the product is handed: specs, manifests, files written for it, its command lines. */
  function spy(base: BlocksProduct, seen: string[]): BlocksProduct {
    const wrap = (mod: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(mod).map(([name, value]) => [
          name,
          typeof value === 'function'
            ? (...args: unknown[]) => {
                for (const arg of args) {
                  try {
                    seen.push(JSON.stringify(arg) ?? '');
                  } catch {
                    // Cyclic or opaque values carry no recipe text.
                  }
                }
                return (value as (...a: unknown[]) => unknown)(...args);
              }
            : value,
        ]),
      );
    return patched(base, {
      name: 'spy',
      core: wrap(base.core),
      report: wrap(base.report),
      checks: wrap(base.checks),
      cli: async (argv, cwd) => {
        seen.push(argv.join(' '));
        return base.cli(argv, cwd);
      },
    });
  }

  function files(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) out.push(...files(path));
      else if (statSync(path).size < 2_000_000) out.push(readFileSync(path, 'latin1'));
    }
    return out;
  }

  it('no item hands the product, or leaves on disk, its cause, its id or a planted verdict', {
    timeout: 1_800_000,
  }, async () => {
    const leaks: string[] = [];
    for (const item of sample.filter((_, index) => index % 2 === 0)) {
      const seen: string[] = [];
      const scratch = scratchFolder();
      await passes(item, spy(realProduct(), seen), scratch);
      const texts = [...seen, ...files(scratch)];
      for (const needle of [
        item.cause,
        item.id,
        'should be blocked',
        'should be fail',
        'code-off-by-one',
        'normal-omits-code',
      ]) {
        if (texts.some((text) => text.includes(needle))) leaks.push(`${item.id}: ${needle.slice(0, 60)}`);
      }
    }
    expect(leaks).toEqual([]);
  });
});
