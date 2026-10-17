// Writes hf1-baseline.tsv: for every example spec, the sha of its file, its spec hash and a digest of its block
// cache keys, as the checkout it runs in computes them. Run it on the commit the baseline names, from the repo root:
//   pnpm exec tsx packages/core/test/fixtures/framework/make-hf1-baseline.ts > hf1-baseline.tsv
// It uses only APIs main already had, and main's cache-key rule (the spec without its version), so the file it
// writes on main is the reference the framework must reproduce (hf1.test.ts).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { extname, relative } from 'node:path';
import {
  blockCacheKey,
  canonicalGiven,
  contentHash,
  findSpecFiles,
  parseSpecText,
  resolveGiven,
  type Spec,
} from '@agent-nexus/driftbench-core';

const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex').slice(0, 16);

function blockKeys(spec: Spec, specHash: string): string[] {
  const target = spec.target ?? { adapter: 'stand-in' };
  return spec.blocks.map((block, index) => {
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
  });
}

const files = await findSpecFiles(['examples']);
const rows: string[] = [];
for (const file of files) {
  const bytes = readFileSync(file);
  const loaded = parseSpecText(
    bytes.toString('utf8'),
    extname(file).toLowerCase() === '.json' ? 'json' : 'yaml',
    file,
  );
  if (!loaded.ok) continue;
  const { version: _version, ...unlabelled } = loaded.spec;
  rows.push(
    [
      relative('.', file),
      sha(bytes),
      loaded.hash,
      sha(blockKeys(loaded.spec, contentHash(unlabelled)).join('\n')),
      loaded.spec.blocks.length,
    ].join('\t'),
  );
}
process.stdout.write(`${rows.join('\n')}\n`);
