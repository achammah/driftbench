import { readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import {
  type Change,
  contentHash,
  isPlainObject,
  type PromptAnchor,
  promptChangeManifest,
  provenanceHash,
} from '@agent-nexus/driftbench-core';
import { validateEstateMap } from '@agent-nexus/driftbench-estate';
import { Proposal } from '@agent-nexus/driftbench-generate';
import type { Command } from 'commander';
import { parse as parseYaml, stringify } from 'yaml';
import type { Io } from '../io';
import { estatePromptManifest } from './radius-estate-prompt';

/** Read approved entries from one named source; other sources are unchanged by this prompt diff. */
export function promptAnchors(map: Proposal, source: string): PromptAnchor[] {
  const anchors: PromptAnchor[] = [];
  const add = (entry: string, evidence: { source: string; quote: string } | undefined, changes: Change[]) => {
    if (evidence?.source === source) anchors.push({ entry, ...evidence, changes });
  };
  for (const [i, dimension] of map.dimensions.entries()) {
    for (const [j, value] of dimension.values.entries()) {
      if (value.approved ?? dimension.approved)
        add(`dimensions[${i}].values[${j}]`, value.evidence, [
          { kind: 'map', id: `${dimension.id}=${value.id}` },
        ]);
    }
  }
  for (const [i, phrase] of (map.phrases ?? []).entries()) {
    if (phrase.approved)
      add(`phrases[${i}]`, phrase.evidence, [{ kind: 'map', id: `${phrase.dimension}=${phrase.value}` }]);
  }
  for (const [i, relation] of (map.relations ?? []).entries()) {
    if (!relation.approved) continue;
    let changes: Change[] = [];
    switch (relation.kind) {
      case 'states':
        changes = [{ kind: 'rule', id: `states@${relation.to}` }];
        break;
      case 'path':
        changes = [{ kind: 'rule', id: `path:${relation.id}` }];
        break;
      case 'recovery':
        changes = [{ kind: 'deviation', id: relation.class }];
        break;
      case 'uses_tool':
        changes = [{ kind: 'tool', id: relation.tool }];
        break;
      case 'reply_language':
        changes = [{ kind: 'rule', id: 'reply_language' }];
        break;
    }
    add(`relations[${i}]`, relation.evidence, changes);
  }
  // Unknown entry kinds must not silently disappear behind a supported overlapping anchor.
  for (const [i, constraint] of (map.constraints ?? []).entries()) {
    if (constraint.approved) add(`constraints[${i}]`, constraint.evidence, []);
  }
  for (const [i, setting] of (map.numeric_settings ?? []).entries()) {
    if (setting.approved) add(`numeric_settings[${i}]`, setting.evidence, []);
  }
  return anchors;
}

export function registerRadiusAuto(radius: Command, io: Io, setExit: (code: number) => void): void {
  radius
    .command('auto')
    .description('Map a prompt diff to approved evidence quotes; unknown changes select the whole suite')
    .requiredOption('--prompt <files...>', 'the old and new prompt files, in that order')
    .requiredOption('--map <file>', 'an approved proposal or estate map with source quotes')
    .option(
      '--source <path>',
      'the evidence source in the map; default the old prompt path relative to the map',
    )
    .option('--from-version <version>', 'the baseline agent version; default the old text content hash')
    .option('--to-version <version>', 'the candidate agent version; default the new text content hash')
    .option('--out <file>', 'write the manifest here; otherwise print YAML')
    .action(
      async (options: {
        prompt: string[];
        map: string;
        source?: string;
        fromVersion?: string;
        toVersion?: string;
        out?: string;
      }) => {
        const [oldFile, newFile] = options.prompt;
        if (options.prompt.length !== 2 || oldFile === undefined || newFile === undefined) {
          io.err('--prompt takes exactly two files: old then new.\n');
          setExit(2);
          return;
        }
        const mapPath = resolve(io.cwd, options.map);
        let rawMap: unknown;
        try {
          rawMap = parseYaml(await readFile(mapPath, 'utf8'));
        } catch (cause) {
          io.err(
            `Cannot read map ${options.map}: ${cause instanceof Error ? cause.message : String(cause)}\n`,
          );
          setExit(2);
          return;
        }
        const estate = isPlainObject(rawMap) && 'atoms' in rawMap ? validateEstateMap(rawMap) : undefined;
        const proposal = estate === undefined ? Proposal.safeParse(rawMap) : undefined;
        if (estate?.ok === false || proposal?.success === false) {
          io.err(`Invalid map ${options.map}:\n`);
          const issues =
            estate?.ok === false
              ? estate.errors
              : proposal?.success === false
                ? proposal.error.issues.map((issue) => ({ ...issue, path: issue.path.join('.') }))
                : [];
          for (const issue of issues) {
            io.err(`    ${issue.path || '(root)'}: ${issue.message}\n`);
          }
          setExit(2);
          return;
        }
        const estateMap = estate?.ok ? estate.map : undefined;
        const map = proposal?.success ? proposal.data : undefined;
        const oldPath = resolve(io.cwd, oldFile);
        const newPath = resolve(io.cwd, newFile);
        const before = await readFile(oldPath, 'utf8');
        const after = await readFile(newPath, 'utf8');
        const source = options.source ?? relative(dirname(mapPath), oldPath).split('\\').join('/');
        const hasSource = estateMap
          ? estateMap.atoms.some((atom) => atom.provenance.file === source)
          : map?.sources.some((entry) => entry.path === source);
        if (!hasSource) {
          io.err(`The map has no source ${source}; pass --source with its declared path.\n`);
          setExit(2);
          return;
        }
        const versions = {
          from: options.fromVersion ?? contentHash(before),
          to: options.toVersion ?? contentHash(after),
        };
        const manifest = estateMap
          ? estatePromptManifest(estateMap, source, before, after, versions)
          : promptChangeManifest(before, after, map ? promptAnchors(map, source) : [], versions);
        if (estateMap && manifest.changes.length === 0) {
          manifest.promptProvenance = {
            kind: 'radius-auto-estate',
            source,
            map: { path: mapPath, hash: provenanceHash(rawMap) },
            before: { path: oldPath, hash: provenanceHash(before), version: versions.from },
            after: { path: newPath, hash: provenanceHash(after), version: versions.to },
          };
        }
        const text = stringify(manifest);
        if (options.out) await writeFile(resolve(io.cwd, options.out), text);
        else io.out(text);
        setExit(0);
      },
    );
}
