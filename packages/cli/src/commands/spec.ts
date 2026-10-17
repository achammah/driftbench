import { relative, resolve } from 'node:path';
import {
  checkSpecLinks,
  type Issue,
  type LoadResult,
  loadSpecs,
  registriesByPrompt,
  type SectionRegistry,
} from '@agent-nexus/driftbench-core';
import type { Command } from 'commander';
import type { Io } from '../io';
import { coverageCommand } from './coverage';
import { readRegistry } from './radius-sections';

export function registerSpecCommands(program: Command, io: Io, setExit: (code: number) => void): void {
  const spec = program.command('spec').description('Check spec files.');

  spec
    .command('validate')
    .description('Parse and validate specs. Exit 1 when any spec is invalid.')
    .argument('<paths...>', 'spec files or folders')
    .option('--json', 'print one JSON document')
    .action(async (paths: string[], options: { json?: boolean }) => {
      setExit(await validateCommand(paths, options, io));
    });

  spec
    .command('lint')
    .description('Validate specs and print advice. Exit 1 on errors, and on warnings with --strict.')
    .argument('<paths...>', 'spec files or folders')
    .option('--json', 'print one JSON document')
    .option('--strict', 'treat warnings as failures')
    .option(
      '--sections <registries...>',
      'section registries: check that every prompt-section link names a known, non-stale section',
    )
    .action(async (paths: string[], options: { json?: boolean; strict?: boolean; sections?: string[] }) => {
      setExit(await lintCommand(paths, options, io));
    });

  spec
    .command('coverage')
    .description('Show which behaviours and deviations the specs cover. Exit 1 when one is missing.')
    .argument('<paths...>', 'spec files or folders')
    .requiredOption('--inventory <file>', 'behaviour inventory (YAML or JSON)')
    .option('--channel <name>', 'only this channel')
    .option('--json', 'print one JSON document')
    .action(async (paths: string[], options: { inventory: string; channel?: string; json?: boolean }) => {
      setExit(await coverageCommand(paths, options, io));
    });
}

export async function validateCommand(paths: string[], options: { json?: boolean }, io: Io): Promise<number> {
  const results = await loadSpecs(paths.map((path) => resolve(io.cwd, path)));
  if (options.json) {
    io.out(
      `${JSON.stringify(
        results.map((result) => toJson(result, io)),
        null,
        2,
      )}\n`,
    );
  } else {
    for (const result of results) io.out(render(result, io, false));
    io.out(summary(results));
  }
  return results.length === 0 || results.some((result) => !result.ok) ? 1 : 0;
}

export async function lintCommand(
  paths: string[],
  options: { json?: boolean; strict?: boolean; sections?: string[] },
  io: Io,
): Promise<number> {
  const registries: SectionRegistry[] = [];
  for (const path of options.sections ?? []) {
    const registry = await readRegistry(path, io);
    if (!registry) return 2;
    registries.push(registry);
  }
  const byPrompt = registriesByPrompt(registries);
  if (!byPrompt.ok) {
    for (const error of byPrompt.errors) io.err(`${error}\n`);
    return 2;
  }
  const loaded = await loadSpecs(paths.map((path) => resolve(io.cwd, path)));
  const results =
    options.sections === undefined
      ? loaded
      : loaded.map((result) => withLinkIssues(result, byPrompt.byPrompt));
  if (options.json) {
    io.out(
      `${JSON.stringify(
        results.map((result) => toJson(result, io)),
        null,
        2,
      )}\n`,
    );
  } else {
    for (const result of results) io.out(render(result, io, true));
    io.out(summary(results));
  }
  if (results.length === 0 || results.some((result) => !result.ok)) return 1;
  if (options.strict && results.some((result) => result.warnings.length > 0)) return 1;
  return 0;
}

/** Adds the link checks of `--sections`: an unknown section is an error, a stale link a warning. */
function withLinkIssues(result: LoadResult, byPrompt: ReadonlyMap<string, SectionRegistry>): LoadResult {
  if (!result.ok) return result;
  const issues = checkSpecLinks(result.spec, byPrompt);
  const errors = issues.filter((issue) => issue.level === 'error');
  const warnings = [...result.warnings, ...issues.filter((issue) => issue.level === 'warning')];
  return errors.length > 0 ? { ok: false, path: result.path, errors, warnings } : { ...result, warnings };
}

function render(result: LoadResult, io: Io, withWarnings: boolean): string {
  const name = displayPath(result.path, io);
  if (!result.ok) {
    return `✗ ${name}\n${result.errors.map((issue) => line(issue)).join('')}`;
  }
  const { spec } = result;
  const parts = [
    spec.id,
    `${spec.blocks.length} block${spec.blocks.length === 1 ? '' : 's'}`,
    ...(spec.perturbations?.length
      ? [`${spec.perturbations.length} perturbation${spec.perturbations.length === 1 ? '' : 's'}`]
      : []),
    `hash ${result.hash}`,
  ];
  const head = `✓ ${name}  ${parts.join(' · ')}\n`;
  return withWarnings ? head + result.warnings.map((issue) => line(issue)).join('') : head;
}

function line(issue: Issue): string {
  const mark = issue.level === 'error' ? ' ' : '!';
  return `  ${mark} ${issue.path || '(file)'}  ${issue.code}  ${issue.message}\n`;
}

function summary(results: LoadResult[]): string {
  if (results.length === 0) return 'No spec files found.\n';
  const valid = results.filter((result) => result.ok).length;
  const warnings = results.reduce((sum, result) => sum + result.warnings.length, 0);
  return `Checked ${results.length} spec${results.length === 1 ? '' : 's'}: ${valid} valid, ${results.length - valid} invalid, ${warnings} warning${warnings === 1 ? '' : 's'}.\n`;
}

function toJson(result: LoadResult, io: Io) {
  const path = displayPath(result.path, io);
  return result.ok
    ? {
        path,
        ok: true,
        id: result.spec.id,
        hash: result.hash,
        blocks: result.spec.blocks.length,
        warnings: result.warnings,
      }
    : { path, ok: false, errors: result.errors, warnings: result.warnings };
}

function displayPath(path: string, io: Io): string {
  const rel = relative(io.cwd, path);
  return rel === '' || rel.startsWith('..') ? path : rel;
}
