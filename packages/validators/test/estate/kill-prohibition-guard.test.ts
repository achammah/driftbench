import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadSpecFile } from '@agent-nexus/driftbench-core';
import { loadEstateMap } from '@agent-nexus/driftbench-estate';
import { afterAll, describe, expect, it } from 'vitest';
import { cli } from '../../src/ladders/estate/bank/bench';
import { nativeSpecsOf, type SuiteSpec } from '../../src/ladders/estate/bank/fixture-suite';
import { type Cell, judgeCell, judgeLive, prohibitionGuard } from '../../src/ladders/estate/bank/kill';

/**
 * docs/estate.md section 6, estate mutants: a guard that enforces only prohibitions acts only after an act a standing
 * rule forbids, so no honest live test reaches it, and its delete is judged by its guard_positive unit tests. The
 * estate here is written by hand (a studio desk with an archive folder) and names nothing of the Northwind fixture.
 */
const GUARD = `#!/usr/bin/env python3
"""Warns after a command that removed a file under archive/."""
import json, sys
event = json.load(sys.stdin)
command = event.get("tool_input", {}).get("command", "")
if "rm " in command and "archive/" in command:
    print("never delete a file under archive/", file=sys.stderr)
    sys.exit(1)
sys.exit(0)
`;
const RULE = 'Never delete a file under `archive/`; move it to `archive/old/` instead.';

const folders: string[] = [];
afterAll(async () => {
  for (const folder of folders) await rm(folder, { recursive: true, force: true });
});

async function desk(polarity: 'prohibition' | 'obligation', guard = GUARD) {
  const work = await mkdtemp(join(tmpdir(), 'kill-prohibition-'));
  folders.push(work);
  const root = join(work, 'desk');
  const files: Record<string, string> = {
    'CLAUDE.md': `# Studio desk\n\n## Rules\n\n- **A1.** ${RULE}\n`,
    '.claude/guards/archive-guard.py': guard,
    '.claude/guards/CHECK-REGISTRY.md':
      '# Check registry\n\n| Id | Guard | Event | Enforces | Verdict |\n|---|---|---|---|---|\n| G1 | archive-guard.py | PostToolUse | A1 | warn |\n',
    '.claude/settings.json': JSON.stringify({
      permissions: { defaultMode: 'default' },
      hooks: {
        PostToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: 'python3 .claude/guards/archive-guard.py' }],
          },
        ],
      },
    }),
    'archive/2026-01.csv': 'a,b\n',
  };
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  // The prose answer a model would give for the standing file, as the fixture's answers.yaml records one.
  await writeFile(
    join(work, 'answers.yaml'),
    [
      'family: lane',
      'model: hand-written test answers',
      'answers:',
      '  CLAUDE.md:',
      '    chunk: CLAUDE.md',
      '    atoms:',
      '      - kind: instruction',
      '        title: Never delete an archive file; move it',
      `        quote: "${RULE}"`,
      `        polarity: ${polarity}`,
      '        evidence: [{ type: custom, name: no_delete_under, options: { path: archive/ } }]',
      '',
    ].join('\n'),
  );
  const map = join(work, 'map.yaml');
  const plan = join(work, 'plan.yaml');
  const suite = join(work, 'suite');
  for (const args of [
    ['estate', 'scan', root, '--replay', join(work, 'answers.yaml'), '--out', map],
    ['estate', 'approve', map, '--all'],
    ['estate', 'plan', map, '--out', plan],
    ['estate', 'plan', 'approve', plan, '--all'],
  ]) {
    const run = cli(args);
    expect(run.code, `${args.join(' ')}: ${run.out.slice(0, 300)}`).toBe(0);
  }
  const generated = cli(['estate', 'generate', '--map', map, '--plan', plan, '--out', suite]);
  expect(generated.code, generated.out.slice(0, 300)).toBeLessThanOrEqual(1);
  const loaded = await loadEstateMap(map);
  if (!loaded.ok) throw new Error('the hand-written map does not load');
  const natives: SuiteSpec[] = await nativeSpecsOf(suite);
  // The complete live specs the suite holds, as kill.fake reads them.
  const specs: SuiteSpec[] = [];
  const live = join(suite, 'specs', 'live');
  for (const entry of await readdir(live, { withFileTypes: true, recursive: true }).catch(() => [])) {
    if (!entry.isFile() || !entry.name.endsWith('.yaml')) continue;
    const loadedSpec = await loadSpecFile(join(entry.parentPath, entry.name));
    if (!loadedSpec.ok) continue;
    const meta = (loadedSpec.spec.metadata?.estate ?? {}) as { atoms?: string[]; testType?: string };
    specs.push({
      path: join(entry.parentPath, entry.name),
      id: loadedSpec.spec.id,
      atoms: meta.atoms ?? [],
      testType: meta.testType ?? '',
      mode: 'live',
      complete: true,
      spec: loadedSpec.spec,
    });
  }
  return { work, root, map, estate: loaded.map, natives, specs };
}

const cell: Cell = { kind: 'guard', index: 0, op: 'delete', tier: 3 };

describe('kill.fake judges a guard that enforces only prohibitions by its unit tests', {
  timeout: 600_000,
}, () => {
  it('kills the delete of the guard through its unit tests, where the live judging finds nothing', async () => {
    const { work, root, map, estate, natives, specs } = await desk('prohibition');
    const atom = estate.atoms.find((candidate) => candidate.kind === 'guard')?.id as string;
    expect(prohibitionGuard(atom, estate)).toBe(true);
    // No live test reaches the guard: the act that triggers it is the one the rule forbids.
    const live = await judgeLive(cell, atom, specs, map, join(work, 'live'), new Map(), root);
    expect(live.pass).toBe(false);
    // Its guard_positive unit test does the act on a payload: green on the original, red on the mutant.
    expect(natives.some((spec) => spec.testType === 'guard_positive' && spec.atoms.includes(atom))).toBe(
      true,
    );
    const verdict = await judgeCell(
      cell,
      estate,
      { specs: [], natives },
      map,
      join(work, 'units'),
      new Map(),
      root,
    );
    expect(verdict).toMatchObject({ pass: true, detail: expect.stringContaining('turns red') });
  });

  it('keeps a guard that enforces an obligation on the live judging', async () => {
    const { estate } = await desk('obligation');
    const atom = estate.atoms.find((candidate) => candidate.kind === 'guard')?.id as string;
    expect(prohibitionGuard(atom, estate)).toBe(false);
  });

  it('gives no kill when no guard_positive unit test names the guard', async () => {
    const { work, root, map, estate, natives } = await desk('prohibition');
    const others = natives.filter((spec) => spec.testType !== 'guard_positive');
    const verdict = await judgeCell(
      cell,
      estate,
      { specs: [], natives: others },
      map,
      join(work, 'none'),
      new Map(),
      root,
    );
    expect(verdict).toMatchObject({
      pass: false,
      detail: expect.stringContaining('no guard_positive unit test'),
    });
  });

  it('gives no kill for a guard that never intervenes on the forbidden act', async () => {
    // The guard is configured and its unit test runs, but it allows the act: the original records no warning, so the
    // mutant that drops the guard loses nothing the guard did.
    const { work, root, map, estate, natives } = await desk('prohibition', 'import sys\nsys.exit(0)\n');
    const verdict = await judgeCell(
      cell,
      estate,
      { specs: [], natives },
      map,
      join(work, 'dead'),
      new Map(),
      root,
    );
    expect(verdict).toMatchObject({
      pass: false,
      detail: expect.stringContaining('intervenes on the original'),
    });
  });
});
