import { readFile, stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { RUNTIMES, readerFor, runStaticTests, type StaticResult } from '@agent-nexus/driftbench-estate';
import { formatJson, StaticTest } from '@agent-nexus/driftbench-generate';
import type { Command } from 'commander';
import { jsonFiles } from '../files';
import type { Io } from '../io';
import { optionNumber } from '../number';

export type EstateStaticOptions = { estate?: string; runtime?: string; ceiling?: string; json?: boolean };

/**
 * `driftbench estate static <tests...> --estate <root>`: runs the static tests `estate generate` wrote
 * (`static/**.json`: invariants and settings) against an estate root, read again by code, with no run of
 * the agent. Exit 0 every test passes, 1 one fails, 2 a usage or input error.
 */
export function registerEstateStaticCommand(estate: Command, io: Io, setExit: (code: number) => void): void {
  estate
    .command('static')
    .description('Run the static tests of a generated suite (invariants, settings) against an estate root')
    .argument('<tests...>', 'static test files, or folders holding them (such as <suite>/static)')
    .option('--estate <root>', 'the estate root to read: the original or a mutant copy')
    .option('--runtime <name>', `the runtime that reads the estate: ${RUNTIMES.join(', ')}`, 'claude-code')
    .option('--ceiling <characters>', 'the size ceiling of the standing instructions', '40000')
    .option('--json', 'print the results as JSON')
    .action(async (paths: string[], options: EstateStaticOptions) => {
      setExit(await estateStaticCommand(paths, options, io));
    });
}

export async function estateStaticCommand(
  paths: string[],
  options: EstateStaticOptions,
  io: Io,
): Promise<number> {
  if (!options.estate) {
    io.err("error: required option '--estate <root>' not specified\n");
    return 2;
  }
  const reader = readerFor(options.runtime ?? 'claude-code');
  if (!reader) {
    io.err(`error: unknown runtime "${options.runtime}": use ${RUNTIMES.join(', ')}\n`);
    return 2;
  }
  const ceiling = optionNumber(options.ceiling ?? '40000');
  if (!Number.isInteger(ceiling) || ceiling <= 0) {
    io.err(`error: --ceiling takes a positive whole number of characters, not "${options.ceiling}"\n`);
    return 2;
  }
  const root = resolve(io.cwd, options.estate);
  if (!(await stat(root).catch(() => undefined))?.isDirectory()) {
    io.err(`Cannot find the estate folder ${root}.\n`);
    return 2;
  }
  const files: string[] = [];
  for (const path of paths) {
    const full = resolve(io.cwd, path);
    const info = await stat(full).catch(() => undefined);
    if (!info) {
      io.err(`Cannot find ${path}.\n`);
      return 2;
    }
    if (info.isDirectory()) files.push(...(await jsonFiles(full)));
    else files.push(full);
  }
  const tests: StaticTest[] = [];
  for (const file of files.sort()) {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(file, 'utf8'));
    } catch (cause) {
      io.err(
        `✗ ${relative(io.cwd, file)}  not JSON: ${cause instanceof Error ? cause.message : String(cause)}\n`,
      );
      return 2;
    }
    const parsed = StaticTest.safeParse(raw);
    if (!parsed.success) {
      io.err(
        `✗ ${relative(io.cwd, file)}  not a static test: ${parsed.error.issues[0]?.message ?? 'invalid'}\n`,
      );
      return 2;
    }
    // A test maintenance retired (`estate impact --write`) checks an atom that left the estate: it is not run.
    if (parsed.data.retired === undefined) tests.push(parsed.data);
  }
  if (tests.length === 0) {
    io.err('No static test found.\n');
    return 2;
  }
  const results = await runStaticTests(tests, { root, reader, ceiling });
  const failed = results.filter((result) => !result.pass);
  if (options.json)
    io.out(
      formatJson({ estate: root, passed: results.length - failed.length, failed: failed.length, results }),
    );
  else io.out(report(results));
  return failed.length > 0 ? 1 : 0;
}

function report(results: readonly StaticResult[]): string {
  const lines = results.map((result) => `${result.pass ? '✓' : '✗'} ${result.id}  ${result.detail}`);
  const failed = results.filter((result) => !result.pass).length;
  lines.push(`${results.length - failed} of ${results.length} static tests pass.`, '');
  return lines.join('\n');
}
