import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  checkSectionRegistry,
  loadSectionRegistry,
  type Reanchoring,
  reanchorRegistry,
  type SectionRegistry,
  sectionsFromHeadings,
} from '@agent-nexus/driftbench-core';
import type { Command } from 'commander';
import { stringify } from 'yaml';
import type { Io } from '../io';

/**
 * `driftbench radius sections init|check|reanchor`: the section registry of a prompt, the file block
 * links name sections in (`prompts/<id>.sections.yaml`). Offsets are UTF-16 code units after NFC and
 * CRLF to LF. Read only, except the registry file `--out` names.
 */
export function registerRadiusSections(radius: Command, io: Io, setExit: (code: number) => void): void {
  const sections = radius
    .command('sections')
    .description('Write, check and re-anchor the section registry of a prompt');

  sections
    .command('init')
    .description('Write a first registry: one global section per markdown heading')
    .argument('<prompt>', 'the prompt file')
    .requiredOption('--id <prompt-id>', 'the prompt id that links name')
    .requiredOption('--prompt-version <version>', 'the prompt version the registry describes')
    .option('--level <n>', 'the deepest heading level that starts a section', '2')
    .option('--out <file>', 'write the registry here; otherwise print YAML')
    .action(
      async (prompt: string, options: { id: string; promptVersion: string; level: string; out?: string }) => {
        const level = Number(options.level);
        if (!Number.isInteger(level) || level < 1 || level > 6) {
          io.err(`--level takes a whole number from 1 to 6, not "${options.level}".\n`);
          setExit(2);
          return;
        }
        const text = await readText(prompt, io);
        if (text === undefined) return setExit(2);
        const built = sectionsFromHeadings(text, {
          promptId: options.id,
          version: options.promptVersion,
          level,
        });
        if (!built.ok) {
          for (const error of built.errors) io.err(`${error}\n`);
          io.err('No registry was written.\n');
          setExit(2);
          return;
        }
        await emit(registryYaml(built.registry), options.out, io);
        io.err(
          `${built.registry.sections.length} sections, all global. Mark local the sections that reach only the blocks linked to them, and add references and overrides.\n`,
        );
        setExit(0);
      },
    );

  sections
    .command('check')
    .description('Check that a registry describes a prompt: hashes, spans and anchors. Exit 1 when not')
    .argument('<registry>', 'the section registry (YAML or JSON)')
    .requiredOption('--prompt <file>', 'the prompt file the registry describes')
    .option('--json', 'print one JSON document')
    .action(async (registryPath: string, _own: unknown, command: Command) => {
      // `radius` has its own --json, which commander gives the parent: read it with the globals.
      const options = command.optsWithGlobals<{ prompt: string; json?: boolean }>();
      const registry = await readRegistry(registryPath, io);
      const text = await readText(options.prompt, io);
      if (!registry || text === undefined) return setExit(2);
      const problems = checkSectionRegistry(registry, text);
      const stale = registry.sections
        .filter((section) => section.stale === true)
        .map((section) => section.id);
      if (options.json) {
        io.out(
          `${JSON.stringify({ prompt: registry.prompt_id, version: registry.version, problems, stale }, null, 2)}\n`,
        );
      } else if (problems.length === 0) {
        io.out(
          `${registry.prompt_id} ${registry.version}: ${registry.sections.length} sections match the prompt${stale.length > 0 ? `; ${stale.length} stale: ${stale.join(', ')}` : ''}.\n`,
        );
      } else {
        io.out(`${registry.prompt_id} ${registry.version} does not describe ${options.prompt}:\n`);
        for (const problem of problems) io.out(`  ${problem}\n`);
      }
      setExit(problems.length === 0 ? 0 : 1);
    });

  sections
    .command('reanchor')
    .description('Find each section again in the next version of the prompt; edited ones come out stale')
    .argument('<registry>', 'the section registry of the old prompt')
    .requiredOption('--prompt <files...>', 'the old and new prompt files, in that order')
    .requiredOption('--to-version <version>', 'the version of the new prompt')
    .option('--out <file>', 'write the registry of the new prompt here')
    .option('--json', 'print one JSON document')
    .action(async (registryPath: string, _own: unknown, command: Command) => {
      const options = command.optsWithGlobals<{
        prompt: string[];
        toVersion: string;
        out?: string;
        json?: boolean;
      }>();
      setExit(await reanchorCommand(registryPath, options, io));
    });
}

export async function reanchorCommand(
  registryPath: string,
  options: { prompt: string[]; toVersion: string; out?: string; json?: boolean },
  io: Io,
): Promise<number> {
  const [oldFile, newFile] = options.prompt;
  if (options.prompt.length !== 2 || oldFile === undefined || newFile === undefined) {
    io.err('--prompt takes exactly two files: old then new.\n');
    return 2;
  }
  const registry = await readRegistry(registryPath, io);
  const before = await readText(oldFile, io);
  const after = await readText(newFile, io);
  if (!registry || before === undefined || after === undefined) return 2;
  const made = reanchorRegistry(registry, before, after, options.toVersion);
  if (!made.ok) {
    for (const error of made.errors) io.err(`${error}\n`);
    return 2;
  }
  const { result } = made;
  if (options.out) await writeFile(resolve(io.cwd, options.out), registryYaml(result.registry));
  if (options.json) io.out(`${JSON.stringify(withoutRegistry(result), null, 2)}\n`);
  else io.out(renderReanchoring(registry, result, options.toVersion));
  const stale = result.sections.some((section) => section.status === 'stale');
  return stale || result.outside.length > 0 || result.reordered.length > 0 ? 1 : 0;
}

function withoutRegistry(result: Reanchoring): Omit<Reanchoring, 'registry'> {
  const { registry: _registry, ...rest } = result;
  return rest;
}

export function renderReanchoring(registry: SectionRegistry, result: Reanchoring, version: string): string {
  const lines: string[] = [];
  const count = (status: string) => result.sections.filter((section) => section.status === status).length;
  lines.push(
    `${registry.prompt_id} ${registry.version} to ${version}: ${count('kept')} kept, ${count('moved')} moved, ${count('stale')} stale.`,
  );
  for (const section of result.sections) {
    if (section.status === 'stale') lines.push(`  stale ${section.id}: ${section.reason}`);
  }
  for (const label of result.outside)
    lines.push(`  changed outside every section, ${label}: can reach any block`);
  if (result.reordered.length > 0) lines.push(`  reordered: ${result.reordered.join(', ')}`);
  if (count('stale') > 0)
    lines.push('Every link to a stale section reads as stale until its span is declared again.');
  return `${lines.join('\n')}\n`;
}

/** The registry as YAML, sections in prompt order. */
export function registryYaml(registry: SectionRegistry): string {
  return stringify(registry, { lineWidth: 0 });
}

async function readText(path: string, io: Io): Promise<string | undefined> {
  try {
    return await readFile(resolve(io.cwd, path), 'utf8');
  } catch (cause) {
    io.err(`Cannot read ${path}: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return undefined;
  }
}

/** Reads and validates one registry file, printing its errors. */
export async function readRegistry(path: string, io: Io): Promise<SectionRegistry | undefined> {
  const loaded = await loadSectionRegistry(resolve(io.cwd, path));
  if (loaded.ok) return loaded.registry;
  io.err(`✗ ${path}\n`);
  for (const error of loaded.errors) io.err(`    ${error}\n`);
  io.err('The section registry is invalid.\n');
  return undefined;
}

async function emit(text: string, out: string | undefined, io: Io): Promise<void> {
  if (out) await writeFile(resolve(io.cwd, out), text);
  else io.out(text);
}
