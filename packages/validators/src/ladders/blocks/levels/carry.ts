import { createHash } from 'node:crypto';
import { between, list, loadIssues, type RawSpec, type Rng, rngFor, run } from '../harness';
import { type Action, type FileAction, plantedAgent, token } from '../kinds';
import type { BlocksProduct } from '../product';
import { type BankItem, fail, PASS, type Tier } from '../types';

/**
 * Files that are not plain UTF-8 text. A code agent's workspace holds xlsx, docx and pdf files, and text files
 * that start with a byte-order mark. Level 1: a spec seeds such files byte for byte (`workspace.binary`, base64),
 * and refuses a path written both as text and as bytes (WORKSPACE_PATH_TWICE). Level 2: a parent block's files
 * reach its children byte for byte, whatever they hold. Each item reads the sha256 of every file the agent saw,
 * logged by the agent itself, and compares it with the bytes planted.
 */

const SANDBOX = 'packages/adapters/src/process/index.ts';
const SEMANTICS = 'packages/core/src/spec/semantics.ts';

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** Bytes no UTF-8 decoder keeps: a zip or pdf header, a NUL, bytes over 0x7f that form no character. */
function binaryBytes(rng: Rng, kind: string): Buffer {
  const head =
    kind === 'pdf'
      ? Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')
      : Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  const body = Buffer.from(Array.from({ length: between(rng, 40, 120) }, () => Math.floor(rng() * 256)));
  return Buffer.concat([head, Buffer.from([0x00, 0xff, 0xfe, 0xc3]), body]);
}

/** A text file that starts with a byte-order mark: the mark is part of its bytes. */
function bomBytes(rng: Rng, kind: string): Buffer {
  const text =
    kind === 'csv'
      ? `bike,days\nFern 3,${between(rng, 1, 30)}\n`
      : kind === 'json'
        ? `{"bike":"Moss Cargo","days":${between(rng, 1, 30)}}\n`
        : `Rental note ${between(rng, 1, 999)}\n`;
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]);
}

type Turn = { marker: string; digests: Record<string, string> };

async function playSpec(product: BlocksProduct, scratch: string, raw: RawSpec, actions: Map<string, Action>) {
  const agent = plantedAgent(product, 'code', actions, { scratch, keep: true });
  const record = await run(product, raw, agent.adapter);
  const turns: Turn[] = agent
    .delivered()
    .map((each) => ({ marker: each.marker ?? '', digests: each.digests ?? {} }));
  return { record, turns };
}

const BINARY_KINDS = ['xlsx', 'docx', 'pdf', 'bin'] as const;
const BOM_KINDS = ['csv', 'json', 'txt'] as const;

/** Level 1: a spec seeds binary files, and a path in both maps is refused. */
function seedItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const where of ['spec', 'block'] as const) {
    for (const kind of BINARY_KINDS) {
      const id = `code/seed/binary/${where}/${kind}`;
      items.push({
        id,
        family: 'code-seed',
        tier: (where === 'block' ? 3 : 2) as Tier,
        level: 1,
        component: SANDBOX,
        title: `a ${kind} file seeded byte for byte in the ${where} Given (workspace.binary, base64) reaches a code agent with exactly the planted bytes`,
        cause: 'A workspace seed writes workspace.binary files byte for byte from their base64.',
        check: async ({ seed, scratch, product }) => {
          const rng = rngFor(seed, id);
          const bytes = binaryBytes(rng, kind);
          const path = `data/${token(seed, id)}.${kind}`;
          const marker = token(seed, `${id}#m`, 8);
          const workspace = {
            files: { 'data/notes.txt': 'notes\n' },
            binary: { [path]: bytes.toString('base64') },
          };
          const raw: RawSpec = {
            id: `spec-${token(seed, `${id}#spec`)}`,
            kind: 'task',
            ...(where === 'spec' ? { workspace_seed: workspace } : {}),
            blocks: [
              {
                id: token(seed, `${id}#b`),
                user: `${marker} Read the file.`,
                ...(where === 'block' ? { given: { world: { workspace } } } : {}),
                expect: { execution: { ran_code: true } },
              },
            ],
          };
          const actions = new Map([
            [marker, { reply: 'Read.', commands: [{ command: 'python read.py', exitCode: 0 }] } as Action],
          ]);
          let turns: Turn[];
          try {
            turns = (await playSpec(product, scratch, raw, actions)).turns;
          } catch (error) {
            return fail(
              `the spec should load and run; it threw: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}`,
            );
          }
          const got = turns.find((turn) => turn.marker === marker)?.digests[path];
          return got === sha(bytes)
            ? PASS
            : fail(
                `${path} should reach the agent with the ${bytes.length} planted bytes (sha256 ${sha(bytes).slice(0, 12)}); ${got ? `it held other bytes (${got.slice(0, 12)})` : 'the agent never saw it'}`,
              );
        },
      });
    }
  }
  for (const where of ['spec', 'block', 'both'] as const) {
    for (const shape of ['same-path', 'nested-same-path'] as const) {
      const id = `code/seed/twice/${where}/${shape}`;
      items.push({
        id,
        family: 'code-seed',
        tier: 2,
        level: 1,
        component: SEMANTICS,
        title: `a workspace path written both in files and in binary (${where} Given, ${shape.replace(/-/g, ' ')}) is refused with WORKSPACE_PATH_TWICE, never resolved one way`,
        cause: 'The loader refuses a workspace path that is in both files and binary (WORKSPACE_PATH_TWICE).',
        check: async ({ seed, product }) => {
          const rng = rngFor(seed, id);
          const path = shape === 'same-path' ? `${token(seed, id)}.csv` : `data/in/${token(seed, id)}.xlsx`;
          const workspace = {
            files: { [path]: 'a,b\n1,2\n' },
            binary: { [path]: binaryBytes(rng, 'xlsx').toString('base64') },
          };
          const block = (i: number) => ({
            id: token(seed, `${id}#b${i}`),
            user: `${token(seed, `${id}#m${i}`, 8)} Go.`,
            ...(where !== 'spec' && i === 0 ? { given: { world: { workspace } } } : {}),
            expect: { execution: { ran_code: true } },
          });
          const raw = {
            id: `spec-${token(seed, `${id}#spec`)}`,
            kind: 'task',
            ...(where !== 'block' ? { workspace_seed: workspace } : {}),
            blocks: [block(0), block(1)],
          };
          const result = loadIssues(product, raw);
          return !result.ok && result.codes.includes('WORKSPACE_PATH_TWICE')
            ? PASS
            : fail(
                `the spec should be refused with WORKSPACE_PATH_TWICE; the loader answered ${result.ok ? 'ok' : list(result.codes)}`,
              );
        },
      });
    }
  }
  for (const kind of BOM_KINDS) {
    for (const where of ['spec', 'block'] as const) {
      const id = `code/seed/bom/${where}/${kind}`;
      items.push({
        id,
        family: 'code-seed',
        tier: 3,
        level: 1,
        component: SANDBOX,
        title: `a ${kind} file with a byte-order mark, seeded through workspace.binary in the ${where} Given, reaches the agent with its mark`,
        cause:
          "A workspace seed keeps a text file's byte-order mark: the bytes the agent reads are the bytes planted.",
        check: async ({ seed, scratch, product }) => {
          const rng = rngFor(seed, id);
          const bytes = bomBytes(rng, kind);
          const path = `data/${token(seed, id)}.${kind}`;
          const marker = token(seed, `${id}#m`, 8);
          const workspace = { binary: { [path]: bytes.toString('base64') } };
          const raw: RawSpec = {
            id: `spec-${token(seed, `${id}#spec`)}`,
            kind: 'task',
            ...(where === 'spec' ? { workspace_seed: workspace } : {}),
            blocks: [
              {
                id: token(seed, `${id}#b`),
                user: `${marker} Read the file.`,
                ...(where === 'block' ? { given: { world: { workspace } } } : {}),
                expect: { execution: { ran_code: true } },
              },
            ],
          };
          const actions = new Map([
            [marker, { reply: 'Read.', commands: [{ command: 'python read.py', exitCode: 0 }] } as Action],
          ]);
          let turns: Turn[];
          try {
            turns = (await playSpec(product, scratch, raw, actions)).turns;
          } catch (error) {
            return fail(
              `the spec should load and run; it threw: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}`,
            );
          }
          const got = turns.find((turn) => turn.marker === marker)?.digests[path];
          return got === sha(bytes)
            ? PASS
            : fail(
                `${path} should reach the agent with its byte-order mark (sha256 ${sha(bytes).slice(0, 12)}); ${got ? `it held other bytes (${got.slice(0, 12)})` : 'the agent never saw it'}`,
              );
        },
      });
    }
  }
  return items;
}

/** Level 2: what a parent wrote reaches its descendants byte for byte. */
function carryItems(): BankItem[] {
  const items: BankItem[] = [];
  const cases: {
    id: string;
    kinds: readonly string[];
    bytes: (rng: Rng, kind: string) => Buffer;
    cause: string;
    tier: number;
  }[] = [
    {
      id: 'binary',
      kinds: BINARY_KINDS,
      bytes: binaryBytes,
      cause: "A code child inherits its ancestors' binary files byte for byte, never through a text decoder.",
      tier: 3,
    },
    {
      id: 'several',
      kinds: ['two', 'three', 'five'],
      bytes: binaryBytes,
      cause: "A code child inherits its ancestors' binary files byte for byte, never through a text decoder.",
      tier: 4,
    },
    {
      id: 'bom',
      kinds: BOM_KINDS,
      bytes: bomBytes,
      cause: "A code child inherits its ancestors' text files with their byte-order mark.",
      tier: 3,
    },
  ];
  for (const carry of cases) {
    for (const kind of carry.kinds) {
      for (const depth of [1, 2] as const) {
        const id = `parents/carry/${carry.id}/${kind}/depth${depth}`;
        items.push({
          id,
          family: 'parents-carry',
          tier: Math.min(5, carry.tier + depth - 1) as Tier,
          level: 2,
          component: SANDBOX,
          title: `a ${kind} file a code parent wrote ${carry.id === 'bom' ? 'with a byte-order mark ' : ''}reaches its ${depth === 1 ? 'child' : 'grandchild'} with exactly the bytes written, and the child runs`,
          cause: carry.cause,
          check: async ({ seed, scratch, product }) => {
            const rng = rngFor(seed, id);
            const count = carry.id === 'several' ? ({ two: 2, three: 3, five: 5 }[kind] ?? 1) : 1;
            const planted = Array.from({ length: count }, (_, f) => {
              const format =
                carry.id === 'several' ? (BINARY_KINDS[f % BINARY_KINDS.length] as string) : kind;
              return { path: `out/${token(seed, `${id}#f${f}`)}.${format}`, bytes: carry.bytes(rng, format) };
            });
            const markers = Array.from({ length: depth + 1 }, (_, i) => token(seed, `${id}#m${i}`, 8));
            const ids = markers.map((_, i) => token(seed, `${id}#b${i}`));
            const other = token(seed, `${id}#other`, 8);
            const otherId = token(seed, `${id}#bo`);
            const actions = new Map<string, Action>();
            const writes: FileAction[] = planted.map((file) => ({
              path: file.path,
              format: 'bytes',
              data: file.bytes.toString('base64'),
            }));
            const raw: RawSpec = {
              id: `spec-${token(seed, `${id}#spec`)}`,
              kind: 'task',
              workspace_seed: { files: { 'data/notes.txt': 'notes\n' } },
              blocks: [
                ...markers.map((marker, i) => ({
                  id: ids[i],
                  user: `${marker} ${i === 0 ? 'Write the file.' : 'Use the file.'}`,
                  ...(i === 0 ? {} : { parent: ids[i - 1] }),
                  expect: { execution: { ran_code: true } },
                })),
                // A second root, written after the chain: it starts at the spec defaults, never with the chain's files.
                { id: otherId, user: `${other} Look around.`, expect: { execution: { ran_code: true } } },
              ],
            };
            actions.set(other, {
              reply: 'Nothing to do.',
              commands: [{ command: 'python look.py', exitCode: 0 }],
            });
            for (const [marker, action] of new Map<string, Action>(
              markers.map((marker, i) => [
                marker,
                {
                  reply: 'Done.',
                  ...(i === 0 ? { files: writes } : {}),
                  commands: [{ command: 'python step.py', exitCode: 0 }],
                },
              ]),
            ))
              actions.set(marker, action);
            let played: Awaited<ReturnType<typeof playSpec>>;
            try {
              played = await playSpec(product, scratch, raw, actions);
            } catch (error) {
              return fail(
                `the spec should load and run; it threw: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}`,
              );
            }
            const last = markers[depth] as string;
            const block = played.record.blocks[depth] as
              | { status?: string; notRun?: { reason?: string; detail?: string } }
              | undefined;
            const seen = played.turns.find((turn) => turn.marker === last)?.digests ?? {};
            for (const file of planted) {
              const got = seen[file.path];
              if (got === sha(file.bytes)) continue;
              return fail(
                `${ids[depth]} should start with ${file.path} as its ancestor wrote it (sha256 ${sha(file.bytes).slice(0, 12)}); ${got ? `it held other bytes (${got.slice(0, 12)})` : `it ${block?.status === 'not_run' ? `was not run (${block.notRun?.reason ?? ''} ${block.notRun?.detail ?? ''})`.trim() : 'never saw the file'}`}`,
              );
            }
            const root = played.turns.find((turn) => turn.marker === other);
            if (!root) return fail(`${otherId}, a second root, should run; the agent never received it`);
            const leaked = planted
              .filter((file) => root.digests[file.path] !== undefined)
              .map((file) => file.path);
            if (leaked.length > 0)
              return fail(
                `${otherId}, a second root, should start at the spec defaults; it saw ${list(leaked)}, written by another tree`,
              );
            return PASS;
          },
        });
      }
    }
  }
  return items;
}

export function carryBankItems(): BankItem[] {
  return [...seedItems(), ...carryItems()];
}
