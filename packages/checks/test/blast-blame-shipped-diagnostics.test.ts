import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILTIN_KINDS, ObjectRegistry } from '@agent-nexus/driftbench-core';
import { beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error: a plain JavaScript module of the release tools, with no types.
import { packFiles } from '../../../tools/release/check.mjs';
import { blame } from '../src';

/**
 * Blast radius of PR 451 on what ships: the five diagnostics and both policies are TypeScript data compiled into
 * `dist/`, so the published package carries no object file. Every diagnostic the code names must reach a registry
 * that declares the diagnostic kind, and the pack must hold the build and nothing else of the data.
 */

const CHECKS = fileURLToPath(new URL('..', import.meta.url));

describe('the shipped diagnostics', () => {
  it('reach a registry as the five compiled diagnostics, each from the checks package', () => {
    const registry = new ObjectRegistry();
    for (const kind of BUILTIN_KINDS) registry.registerKind(kind);
    blame.registerBlameObjects(registry);
    const diagnostics = registry
      .shipped()
      .filter((entry) => (entry.raw as { kind: string }).kind === 'diagnostic');
    const named = Object.keys(blame.SHIPPED_DIAGNOSTICS).sort();
    expect(named).toHaveLength(5);
    expect(diagnostics.map((entry) => entry.path).sort()).toEqual(
      named.map((key) => `@agent-nexus/driftbench-checks ${key}`),
    );
  });
});

describe('the published checks package', { timeout: 120_000 }, () => {
  beforeAll(() => {
    const command = JSON.parse(readFileSync(join(CHECKS, 'package.json'), 'utf8')).scripts.build as string;
    const words = command.split(' ').filter((word) => word !== '--dts' && word !== '--clean');
    const built = spawnSync('pnpm', ['exec', ...words, '--silent'], { cwd: CHECKS, encoding: 'utf8' });
    if (built.status !== 0) throw new Error(`building checks failed\n${built.stdout}\n${built.stderr}`);
  }, 120_000);

  it('packs the build and no object or YAML file, so no shipped data waits on a folder', () => {
    const pack = packFiles(CHECKS) as { files: string[] };
    expect(pack.files).toContain('dist/index.js');
    expect(pack.files.filter((file) => file.startsWith('objects/') || /\.ya?ml$/.test(file))).toEqual([]);
  });
});
