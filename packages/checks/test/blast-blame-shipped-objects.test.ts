import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  blockCacheKey,
  cacheSpecHash,
  canonicalGiven,
  findSpecFiles,
  objectContextFor,
  parseSpecText,
  resolveGiven,
  type Spec,
} from '@agent-nexus/driftbench-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error: a plain JavaScript module of the release tools, with no types.
import { packFiles } from '../../../tools/release/check.mjs';
import { blame } from '../src';

/**
 * Blast radius of PR 447 on what ships: the policy/blame and policy/placement defaults are TypeScript data
 * compiled into `dist/`, so the published package needs no `objects/` folder beside the built JavaScript. The
 * built package must resolve both defaults on its own, and registering them must change no example spec hash
 * and no block cache key.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const CHECKS = join(ROOT, 'packages/checks');

/** Builds the JavaScript of a package with its own tsup command, less the declarations, as built-validate does. */
function buildJavaScript(name: string): void {
  const folder = join(ROOT, 'packages', name);
  const command = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')).scripts.build as string;
  const words = command.split(' ').filter((word) => word !== '--dts' && word !== '--clean');
  const built = spawnSync('pnpm', ['exec', ...words, '--silent'], { cwd: folder, encoding: 'utf8' });
  if (built.status !== 0) throw new Error(`building ${name} failed\n${built.stdout}\n${built.stderr}`);
}

describe('the built checks package', () => {
  const holder = join(CHECKS, `.blast-copy-${process.pid}`);
  beforeAll(() => {
    for (const name of ['stats', 'core', 'checks']) buildJavaScript(name);
  }, 300_000);
  afterAll(() => {
    rmSync(holder, { recursive: true, force: true });
  });

  it('packs the build and no object file, because the shipped policies are compiled into dist/', () => {
    const pack = packFiles(CHECKS) as { files: string[] };
    expect(pack.files).toContain('dist/index.js');
    expect(pack.files.filter((file) => file.startsWith('objects/') || /\.ya?ml$/.test(file))).toEqual([]);
  }, 120_000);

  it('loads with plain Node.js from a copy of dist/ with no objects/ beside it and resolves both shipped defaults', () => {
    // The holder sits inside the package so that the copy's imports still find node_modules. It has no objects/
    // beside its dist/, where the earlier build looked for the shipped YAML files.
    cpSync(join(CHECKS, 'dist'), join(holder, 'dist'), { recursive: true });
    expect(existsSync(join(holder, 'objects'))).toBe(false);
    const script = [
      `const checks = await import(${JSON.stringify(join(holder, 'dist/index.js'))});`,
      'const blame = checks.blame.shippedPolicy("policy/blame");',
      'const placement = checks.blame.shippedPolicy("policy/placement");',
      'console.log(JSON.stringify({ blame: blame.items.length, placement: placement.items.length }));',
    ].join('\n');
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({ blame: 32, placement: 13 });
  }, 120_000);
});

const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex').slice(0, 16);

function keysDigest(spec: Spec, specHash: string): string {
  const target = spec.target ?? { adapter: 'stand-in' };
  return sha(
    spec.blocks
      .map((block, index) => {
        try {
          const canonical = canonicalGiven(spec, index);
          const given = resolveGiven(canonical.state, canonical.prefix, target);
          return blockCacheKey({
            specHash,
            repeat: 0,
            position: index,
            given,
            stimulus: block.when,
            target,
            adapter: 'stand-in',
            adapterVersion: '0',
          });
        } catch (cause) {
          return `error:${cause instanceof Error ? cause.message : String(cause)}`;
        }
      })
      .join('\n'),
  );
}

describe('the registered shipped objects change no hash', () => {
  it('keeps the HF1 baseline spec hash and block cache keys with the checks package loaded', async () => {
    expect(blame.shippedPolicy('policy/blame').items.length).toBe(32);
    const rows = readFileSync(join(ROOT, 'packages/core/test/fixtures/framework/hf1-baseline.tsv'), 'utf8')
      .split('\n')
      .filter((line) => line !== '' && !line.startsWith('#'))
      .map((line) => line.split('\t') as [string, string, string, string, string]);
    const files = new Map<string, string>();
    for (const path of await findSpecFiles([join(ROOT, 'examples')]))
      files.set(relative(ROOT, path).split('\\').join('/'), path);
    let compared = 0;
    const changed: string[] = [];
    for (const [file, fileSha, hash, keys] of rows) {
      const path = files.get(file);
      if (path === undefined) continue;
      const bytes = readFileSync(path);
      if (sha(bytes) !== fileSha) continue;
      const format = extname(path).toLowerCase() === '.json' ? 'json' : 'yaml';
      const result = parseSpecText(bytes.toString('utf8'), format, path, {
        objects: () => objectContextFor(path),
      });
      if (!result.ok) continue;
      compared += 1;
      if (result.hash !== hash) changed.push(`${file}: spec hash`);
      if (keysDigest(result.spec, cacheSpecHash(result.spec)) !== keys) changed.push(`${file}: cache keys`);
    }
    expect(changed).toEqual([]);
    expect(compared).toBeGreaterThanOrEqual(1_000);
  }, 180_000);

  it('a spec that uses the shipped blame and placement policies resolves them and keeps its block cache keys', () => {
    const path = join(ROOT, 'examples/acme/specs/conversations/number-porting.yaml');
    const plain = readFileSync(path, 'utf8');
    const parse = (text: string) =>
      parseSpecText(text, 'yaml', path, { objects: () => objectContextFor(path) });
    const before = parse(plain);
    const after = parse(`uses:\n  blame: default\n  placement: default\n${plain}`);
    expect(before.ok).toBe(true);
    expect(after.ok ? [] : after.errors.map((issue) => issue.code)).toEqual([]);
    if (!before.ok || !after.ok) return;
    expect(after.hash).not.toBe(before.hash);
    expect(cacheSpecHash(after.spec)).toBe(cacheSpecHash(before.spec));
    expect(keysDigest(after.spec, cacheSpecHash(after.spec))).toBe(
      keysDigest(before.spec, cacheSpecHash(before.spec)),
    );
  });
});
