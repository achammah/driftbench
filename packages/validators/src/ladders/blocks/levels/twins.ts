import { list, loadIssues, type RawSpec, rngFor } from '../harness';
import { token } from '../kinds';
import { recipe } from '../recipe';
import { type BankItem, fail, PASS, type Tier } from '../types';

/**
 * Cheat channels closed by twins (the v3 partition, family F2). Each item holds two specs of one shape: the one
 * the documented loader must refuse, and its valid twin that must load. A loader that keeps every key it does
 * not know, or that writes `workspace.binary` without reading it as base64, loads the first; one that refuses by
 * the shape of a key refuses the second. docs/reference/spec.md: every object of a spec is strict (an unknown key
 * is SCHEMA_UNRECOGNIZED_KEYS), and `workspace.binary` maps a path to base64 content.
 */

const LOADER = 'packages/core/src/spec/load.ts';
const SCHEMA = 'packages/core/src/schema/common.ts';

type Where = { id: string; tier: Tier; put(raw: RawSpec, key: string): void };

const PLACES: Where[] = [
  { id: 'spec', tier: 1, put: (raw, key) => Object.assign(raw, { [key]: true }) },
  { id: 'block', tier: 1, put: (raw, key) => Object.assign(raw.blocks[0] as object, { [key]: 'on' }) },
  {
    id: 'expect',
    tier: 2,
    put: (raw, key) => Object.assign((raw.blocks[0] as { expect: object }).expect, { [key]: 1 }),
  },
  {
    // A tool expectation of a normal block, an artifact expectation of a code block.
    id: 'expectation-entry',
    tier: 2,
    put: (raw, key) => {
      const expect = (
        raw.blocks[0] as {
          expect: { tools?: Record<string, unknown>[]; artifacts?: Record<string, unknown>[] };
        }
      ).expect;
      Object.assign((expect.tools ?? expect.artifacts)?.[0] as object, { [key]: 'x' });
    },
  },
  {
    id: 'given-world',
    tier: 3,
    put: (raw, key) => Object.assign(raw.blocks[0] as object, { given: { world: { [key]: {} } } }),
  },
  {
    id: 'last-block-given',
    tier: 3,
    put: (raw, key) => Object.assign(raw.blocks[raw.blocks.length - 1] as object, { given: { [key]: [] } }),
  },
];

/** A seeded key no schema defines: letters only, so it never reads as a field of the documented schema. */
const foreign = (seed: number, tag: string) => `k${token(seed, tag).replace(/[^a-z]/g, 'q')}`;

function unknownKeyItems(): BankItem[] {
  return (['normal', 'code'] as const).flatMap((kind) =>
    PLACES.map((place) => {
      const id = `twins/unknown-key/${kind}/${place.id}`;
      return {
        id,
        family: 'twins',
        tier: place.tier,
        level: 1,
        component: LOADER,
        title: `a ${kind} spec with one key no schema defines (at the ${place.id.replace(/-/g, ' ')}) is refused with SCHEMA_UNRECOGNIZED_KEYS, and the same spec without it loads`,
        cause:
          'The loader refuses a key no schema object defines, wherever it sits, and never keeps it in the spec.',
        check: async ({ seed, product }) => {
          const r = recipe(seed, id, kind, [{ fate: 'pass' }, { fate: 'pass' }]);
          const twin = loadIssues(product, structuredClone(r.raw));
          if (!twin.ok)
            return fail(`the spec without the key should load; the loader answered ${list(twin.codes)}`);
          const bad = structuredClone(r.raw);
          place.put(bad, foreign(seed, `${id}#key`));
          const refused = loadIssues(product, bad);
          return !refused.ok && refused.codes.includes('SCHEMA_UNRECOGNIZED_KEYS')
            ? PASS
            : fail(
                `a key no schema defines (at the ${place.id}) should be refused with SCHEMA_UNRECOGNIZED_KEYS; the loader answered ${refused.ok ? 'ok' : list(refused.codes)}`,
              );
        },
      } satisfies BankItem;
    }),
  );
}

export const NOT_BASE64 = ['not base64!', '%%%%', 'abc*def', 'ü-ä'] as const;

function base64Items(): BankItem[] {
  return (['spec', 'block'] as const).flatMap((where) =>
    NOT_BASE64.map((text, v) => {
      const id = `twins/binary-not-base64/${where}/${v}`;
      return {
        id,
        family: 'twins',
        tier: 3 as Tier,
        level: 1,
        component: SCHEMA,
        title: `a workspace.binary entry that is not base64 (${where} Given) is refused, and the same path with base64 bytes loads`,
        cause: 'The loader reads workspace.binary as base64 and refuses an entry that is not.',
        check: async ({ seed, product }) => {
          const rng = rngFor(seed, id);
          const path = `data/${token(seed, `${id}#p`)}.bin`;
          const bytes = Buffer.from(Array.from({ length: 24 }, () => Math.floor(rng() * 256))).toString(
            'base64',
          );
          const spec = (content: string): RawSpec => {
            const workspace = { binary: { [path]: content } };
            return {
              id: `spec-${token(seed, `${id}#spec`)}`,
              kind: 'task',
              ...(where === 'spec' ? { workspace_seed: workspace } : {}),
              blocks: [
                {
                  id: token(seed, `${id}#b`),
                  user: `${token(seed, `${id}#m`, 8)} Read it.`,
                  ...(where === 'block' ? { given: { world: { workspace } } } : {}),
                  expect: { execution: { ran_code: true } },
                },
              ],
            };
          };
          const good = loadIssues(product, spec(bytes));
          if (!good.ok)
            return fail(`the twin with base64 bytes should load; the loader answered ${list(good.codes)}`);
          const bad = loadIssues(product, spec(text));
          return !bad.ok
            ? PASS
            : fail(
                `a workspace.binary entry ${JSON.stringify(text)} is not base64 and should be refused; the spec loaded`,
              );
        },
      } satisfies BankItem;
    }),
  );
}

export function twinItems(): BankItem[] {
  return [...unknownKeyItems(), ...base64Items()];
}
