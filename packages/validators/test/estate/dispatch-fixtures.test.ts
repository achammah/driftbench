import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DISPATCH_BY_ARGUMENT,
  DISPATCH_BY_FLAG,
  SUBCOMMAND_TOOL,
} from '../../src/ladders/estate/bank/dispatch-fixtures';
import { dispatcherFamily, lintCleanFamily, lintDefectFamily } from '../../src/ladders/estate/bank/index';
import { PlantedEstate } from '../../src/ladders/estate/bank/planted';

const folders: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (folders.length) await rm(folders.pop() as string, { recursive: true, force: true });
});

/** The planted tree on disk: hooks/lib/{run,cli}.py beside hooks/real.py, which prints that it ran. */
async function tree(run: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dispatch-fixtures-'));
  folders.push(root);
  await mkdir(join(root, 'hooks/lib'), { recursive: true });
  await writeFile(join(root, 'hooks/lib/run.py'), run);
  await writeFile(join(root, 'hooks/lib/cli.py'), SUBCOMMAND_TOOL);
  await writeFile(join(root, 'hooks/real.py'), 'print("real hook ran")\n');
  return root;
}

function python(root: string, script: string, ...args: string[]) {
  return spawnSync('python3', [join(root, script), ...args], { encoding: 'utf8' });
}

describe('the planted dispatchers dispatch, and the planted subcommand tool does not', () => {
  it('runs the hook its first argument names, and fails on one that is not there', async () => {
    const root = await tree(DISPATCH_BY_ARGUMENT);
    expect(python(root, 'hooks/lib/run.py', 'real')).toMatchObject({ status: 0, stdout: 'real hook ran\n' });
    const gone = python(root, 'hooks/lib/run.py', 'gone-hook');
    expect(gone.status).not.toBe(0);
    expect(gone.stderr).toContain('gone-hook.py');
  });

  it('runs the hook its --hook flag names, and fails on one that is not there', async () => {
    const root = await tree(DISPATCH_BY_FLAG);
    expect(python(root, 'hooks/lib/run.py', '--hook', 'real')).toMatchObject({
      status: 0,
      stdout: 'real hook ran\n',
    });
    const gone = python(root, 'hooks/lib/run.py', '--hook', 'gone-hook');
    expect(gone.status).not.toBe(0);
    expect(gone.stderr).toContain('gone-hook.py');
  });

  it('answers its first argument from its own code, with no file of that name anywhere', async () => {
    const root = await tree(DISPATCH_BY_ARGUMENT);
    expect(python(root, 'hooks/lib/cli.py', 'check')).toMatchObject({
      status: 0,
      stdout: 'all checks pass\n',
    });
    expect(python(root, 'hooks/lib/cli.py', 'status')).toMatchObject({ status: 0 });
  });

  it('is not what the old shebang-only wrapper was: that one runs nothing', () => {
    const shebangOnly = '#!/usr/bin/env python3\n';
    expect(shebangOnly).not.toMatch(/argv|argparse|subprocess/);
    for (const source of [DISPATCH_BY_ARGUMENT, DISPATCH_BY_FLAG]) {
      expect(source).toContain('subprocess.run');
      expect(source).toContain('Usage: run.py');
    }
  });
});

describe('the families plant them', { timeout: 120_000 }, () => {
  /** The raw files each owner planted, taken as the scan reads them. */
  async function planted(run: () => Promise<unknown>): Promise<Map<string, Map<string, string>>> {
    const byOwner = new Map<string, Map<string, string>>();
    const original = PlantedEstate.prototype.scan;
    const spy = vi.spyOn(PlantedEstate.prototype, 'scan').mockImplementation(async function (
      this: PlantedEstate,
    ) {
      for (const [path, raw] of this.raws) {
        const files = byOwner.get(raw.owner) ?? new Map<string, string>();
        files.set(path, raw.text);
        byOwner.set(raw.owner, files);
      }
      return original.call(this);
    });
    try {
      await run();
    } finally {
      spy.mockRestore();
    }
    return byOwner;
  }

  it('gives each scan.dispatcher form its own dispatcher with real code, and a subcommand control', async () => {
    const byOwner = await planted(() => dispatcherFamily().evaluate(3));
    const runners = new Map<string, string>();
    for (const form of ['dispatcher', 'dispatcher-with-prefix', 'dispatcher-flag']) {
      const files = byOwner.get('base') ?? new Map<string, string>();
      const own = [...files].filter(([path]) => path.endsWith(`run-${form}.py`));
      expect(own, form).toHaveLength(1);
      runners.set(form, own[0]?.[1] as string);
    }
    expect(runners.get('dispatcher')).toBe(DISPATCH_BY_ARGUMENT);
    expect(runners.get('dispatcher-with-prefix')).toBe(DISPATCH_BY_ARGUMENT);
    expect(runners.get('dispatcher-flag')).toBe(DISPATCH_BY_FLAG);
    const control = [...(byOwner.get('scan.dispatcher.dispatcher') ?? [])].find(([path]) =>
      path.endsWith('hooks/lib/cli.py'),
    );
    expect(control?.[1]).toBe(SUBCOMMAND_TOOL);
  });

  it('plants a real dispatcher and a subcommand control in both lint items', async () => {
    const defect = await planted(() => lintDefectFamily().evaluate(3));
    const clean = await planted(() => lintCleanFamily().evaluate(3));
    for (const [owner, files] of [
      ['lint.defect.dispatcher-target-missing', defect.get('lint.defect.dispatcher-target-missing')],
      ['lint.clean.guard-by-dispatcher', clean.get('lint.clean.guard-by-dispatcher')],
    ] as const) {
      const sources = [...(files ?? new Map<string, string>())];
      expect(sources.find(([path]) => path.endsWith('hooks/lib/run.py'))?.[1], owner).toBe(
        DISPATCH_BY_ARGUMENT,
      );
      expect(sources.find(([path]) => path.endsWith('hooks/lib/cli.py'))?.[1], owner).toBe(SUBCOMMAND_TOOL);
    }
  });
});
