// HF1 as a CI test: the framework's optional keys change no example spec's hash and no block cache key.
// Two references: the baseline main wrote (hf1-baseline.tsv, one row per example spec file, compared where the
// file is unchanged since), and the schema without the framework keys, over every example spec.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BlockSpec,
  blockCacheKey,
  cacheSpecHash,
  canonicalGiven,
  contentHash,
  findSpecFiles,
  objectContextFor,
  parseSpecText,
  resolveGiven,
  Spec,
  specIdentity,
  Uses,
} from '@agent-nexus/driftbench-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..', '..');
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

type Loaded = { file: string; bytes: Buffer; spec: Spec; hash: string };
const loaded: Loaded[] = [];
/** Every example file the loader refused, with its first error: a baseline spec among them fails HF1. */
const refused = new Map<string, string>();
let files = 0;

beforeAll(async () => {
  const found = await findSpecFiles([join(ROOT, 'examples')]);
  files = found.length;
  for (const path of found) {
    const bytes = readFileSync(path);
    const format = extname(path).toLowerCase() === '.json' ? 'json' : 'yaml';
    const result = parseSpecText(bytes.toString('utf8'), format, path, {
      objects: () => objectContextFor(path),
    });
    if (!result.ok) {
      const first = result.errors[0];
      refused.set(
        relative(ROOT, path).split('\\').join('/'),
        `${first?.code ?? ''} ${first?.path ?? ''}: ${first?.message ?? ''}`,
      );
      continue;
    }
    loaded.push({
      file: relative(ROOT, path).split('\\').join('/'),
      bytes,
      spec: result.spec,
      hash: result.hash,
    });
  }
}, 120_000);

describe('HF1: backward compatibility over examples/', () => {
  it('reproduces main for every example spec file unchanged since the baseline', () => {
    const rows = readFileSync(join(HERE, '..', 'fixtures', 'framework', 'hf1-baseline.tsv'), 'utf8')
      .split('\n')
      .filter((line) => line !== '' && !line.startsWith('#'))
      .map((line) => line.split('\t') as [string, string, string, string, string]);
    expect(rows.length).toBe(2351);
    expect(rows.reduce((sum, row) => sum + Number(row[4]), 0)).toBe(4453);
    const byFile = new Map(loaded.map((entry) => [entry.file, entry]));
    // Every spec main loaded still loads: a refusal of any of them fails here with its path and its error.
    const lost = rows
      .filter(([file]) => !byFile.has(file))
      .map(([file]) => `${file}: ${refused.get(file) ?? 'no longer found under examples/'}`);
    expect(lost).toEqual([]);
    expect(rows.filter(([file]) => byFile.has(file)).length).toBe(2351);
    let compared = 0;
    let blocks = 0;
    const changed: string[] = [];
    for (const [file, fileSha, hash, keys, count] of rows) {
      const now = byFile.get(file);
      if (!now || sha(now.bytes) !== fileSha) continue;
      if (now.spec.blocks.length !== Number(count))
        changed.push(`${file}: ${count} blocks -> ${now.spec.blocks.length}`);
      compared += 1;
      blocks += Number(count);
      if (now.hash !== hash) changed.push(`${file}: spec hash ${hash} -> ${now.hash}`);
      const nowKeys = keysDigest(now.spec, cacheSpecHash(now.spec));
      if (nowKeys !== keys) changed.push(`${file}: block cache keys changed`);
    }
    expect(changed).toEqual([]);
    // Examples change after the baseline; the comparison must still cover a real share of them.
    expect(compared).toBeGreaterThanOrEqual(1_000);
    expect(blocks).toBeGreaterThan(compared);
  });

  it('gives every example spec the hash and cache key of the schema without the framework keys', () => {
    expect(loaded.length).toBeGreaterThanOrEqual(2_000);
    const Legacy = Spec.omit({ uses: true }).extend({
      blocks: z.array(BlockSpec.omit({ uses: true })).min(1),
    });
    const differs: string[] = [];
    for (const entry of loaded) {
      const legacy = Legacy.parse(entry.spec);
      // Main's hash rule reads the spec through specIdentity (links and provenance stay out of it).
      if (contentHash(specIdentity(legacy)) !== entry.hash) differs.push(`${entry.file}: spec hash`);
      const { version: _version, ...unlabelled } = specIdentity(entry.spec);
      // Main's cache-key rule was the spec identity without its version label.
      if (cacheSpecHash(entry.spec) !== contentHash(unlabelled))
        differs.push(`${entry.file}: cache spec hash`);
    }
    expect(differs).toEqual([]);
    expect(files).toBeGreaterThan(loaded.length);
  });

  it('can fail: a uses key with a default value changes every hash; a uses key keeps every cache key', () => {
    const Mutant = Spec.extend({ uses: Uses.default({}) });
    const sample = loaded.slice(0, 200);
    let mutantChanged = 0;
    let withUsesKeyChanged = 0;
    let withUsesHashChanged = 0;
    for (const entry of sample) {
      const parsed = Mutant.safeParse(entry.spec);
      if (parsed.success && contentHash(parsed.data) !== entry.hash) mutantChanged += 1;
      const withUses = { ...entry.spec, uses: { value_check: 'default' } } as Spec;
      if (contentHash(withUses) !== entry.hash) withUsesHashChanged += 1;
      if (
        keysDigest(withUses, cacheSpecHash(withUses)) !== keysDigest(entry.spec, cacheSpecHash(entry.spec))
      ) {
        withUsesKeyChanged += 1;
      }
    }
    expect(mutantChanged).toBe(sample.length);
    expect(withUsesHashChanged).toBe(sample.length);
    expect(withUsesKeyChanged).toBe(0);
  });
});
