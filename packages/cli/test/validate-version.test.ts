import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as validators from '@agent-nexus/driftbench-validators';
import { defineLadder, type Ladder } from '@agent-nexus/driftbench-validators';
import { afterEach, expect, it } from 'vitest';
import { validateCommand } from '../src/commands/validate';

const roots: string[] = [];
it('registers both judges versions while preserving the default', () => {
  expect(validators.registeredLadders().judges?.version).toBe(2);
  expect(validators.registeredLadderVersions().judges?.[2]?.version).toBe(2);
  expect(validators.registeredLadderVersions().judges?.[3]?.version).toBe(3);
});
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'astra-judges-version-'));
  roots.push(root);
  const ladder = (version: number): Ladder =>
    defineLadder({
      component: 'judges',
      version,
      levels: [
        {
          id: 'one',
          name: 'one',
          metric: 'correct / total',
          threshold: 1,
          compute: () => ({ value: 1, items: [] }),
        },
      ],
    });
  const output = { out: '', err: '' };
  const io = {
    cwd: root,
    out: (text: string) => {
      output.out += text;
    },
    err: (text: string) => {
      output.err += text;
    },
  };
  return {
    root,
    output,
    io,
    deps: {
      root,
      ladders: () => ({ judges: ladder(2) }),
      versions: () => ({ judges: { 2: ladder(2), 3: ladder(3) } }),
    },
  };
}

it('selects version 3 without changing the default version 2', async () => {
  const { io, output, deps } = setup();
  expect(await validateCommand('judges', { ladderVersion: '3', json: true }, io, deps)).toBe(1);
  expect(JSON.parse(output.out).ladderVersion).toBe(3);
  output.out = '';
  expect(await validateCommand('judges', { json: true }, io, deps)).toBe(1);
  expect(JSON.parse(output.out).ladderVersion).toBe(2);
});

it.each(['0', '-1', '3.1', 'bogus', '999'])('refuses an unavailable version %s', async (version) => {
  const { io, deps } = setup();
  expect(await validateCommand('judges', { ladderVersion: version }, io, deps)).toBe(64);
});

it('refuses an ambiguous version on all', async () => {
  const { io, deps } = setup();
  expect(await validateCommand('all', { ladderVersion: '3' }, io, deps)).toBe(64);
});

it('reads version 3 hardness evidence apart from the legacy journal', async () => {
  const { io, output, deps, root } = setup();
  mkdirSync(join(root, 'validators/judges/v3'), { recursive: true });
  writeFileSync(join(root, 'validators/judges/v3/journal.jsonl'), 'invalid-json\n');
  await validateCommand('judges', { ladderVersion: '3', hardness: true }, io, deps);
  expect(output.err).toContain('validators/judges/v3/journal.jsonl');
  expect(output.err).toContain('invalid rows');
});

it('keeps version 3 commands and evidence paths in the fresh brief', async () => {
  const { io, output, deps, root } = setup();
  mkdirSync(join(root, 'validators'), { recursive: true });
  writeFileSync(
    join(root, 'validators/EXECUTOR.md'),
    'Run driftbench validate <component> --items. Read validators/<component>/HANDOVER.md.',
  );
  expect(await validateCommand('judges', { ladderVersion: '3', brief: true, fresh: true }, io, deps)).toBe(0);
  expect(output.out).toContain('driftbench validate judges --ladder-version 3 --items');
  expect(output.out).toContain('validators/judges/v3/HANDOVER.md');
});

it('rejects version selection for protect instead of ignoring it', async () => {
  const { io, deps } = setup();
  expect(
    await validateCommand('protect', { ladderVersion: '3', branch: 'fix/example', base: 'main' }, io, deps),
  ).toBe(64);
});
