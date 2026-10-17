import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { type AggregateCriterion, aggregateFromFlag } from '@agent-nexus/driftbench-report';
import { isMap, isNode, isScalar, isSeq, parseDocument } from 'yaml';

/**
 * The project config file: `driftbench.yaml` at the root, or --config. It declares campaign-level criteria
 * under `aggregates:`, one `name:op threshold` string each, the same syntax as --aggregate. Other recognized
 * sections have their own loaders; unknown keys and bad entries are refused with their file and line.
 */

export type ConfigLoad = { ok: true; specs: string[] } | { ok: false; message: string };

/** A score scale: the lowest and highest score a reviewer may give a criterion's queue item. */
export type ScoreScale = { min: number; max: number };
export type ScaleLoad = { ok: true; scales: Record<string, ScoreScale> } | { ok: false; message: string };

/**
 * Reads the score scales of a config file: under `scales:`, a map from criterion name to `min` and `max`, with
 * min below max. A criterion without a scale keeps the default scale, 0 to 1.
 */
export async function readScaleConfig(path: string): Promise<ScaleLoad> {
  const text = await readFile(path, 'utf8');
  const doc = parseDocument(text);
  if (doc.errors.length > 0) {
    return { ok: false, message: `${path}:1: not YAML: ${doc.errors[0]?.message ?? ''}` };
  }
  const root = doc.contents;
  if (root === null || root === undefined || !isMap(root)) return { ok: true, scales: {} };
  const keyError = configKeyError(root, text, path);
  if (keyError) return { ok: false, message: keyError };
  const block = root.get('scales');
  if (block === undefined || block === null) return { ok: true, scales: {} };
  if (!isMap(block))
    return { ok: false, message: `${path}:${lineOf(text, block.range?.[0] ?? 0)}: scales must be a map` };
  const scales: Record<string, ScoreScale> = {};
  for (const pair of block.items) {
    const name = isScalar(pair.key) ? String(pair.key.value) : '';
    const at = lineOf(text, pair.key && 'range' in pair.key && pair.key.range ? pair.key.range[0] : 0);
    const value = pair.value;
    if (!isMap(value))
      return { ok: false, message: `${path}:${at}: ${name}: the scale must be a map with min and max` };
    const min = value.get('min', true);
    const max = value.get('max', true);
    if (!isScalar(min) || !isScalar(max) || typeof min.value !== 'number' || typeof max.value !== 'number') {
      return { ok: false, message: `${path}:${at}: ${name}: min and max must be numbers` };
    }
    if (!(min.value < max.value))
      return { ok: false, message: `${path}:${at}: ${name}: min must be below max` };
    scales[name] = { min: min.value, max: max.value };
  }
  return { ok: true, scales };
}

/**
 * The top-level keys of the project config. `objects` holds project-layer objects written inline (a list of
 * object files); `driftbench object validate` reads it, and every reader here accepts it.
 */
const KEYS = new Set(['aggregates', 'scales', 'campaign', 'plugins', 'prices', 'objects']);

function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split('\n').length;
}

/** The shared top-level allowlist and diagnostic for independently loaded project sections. */
export function configKeyError(root: unknown, text: string, path: string): string | undefined {
  if (!isMap(root)) return undefined;
  for (const pair of root.items) {
    const key = isScalar(pair.key) ? String(pair.key.value) : '';
    if (!KEYS.has(key)) {
      const at = isNode(pair.key) ? (pair.key.range?.[0] ?? 0) : 0;
      return `${path}:${lineOf(text, at)}: unknown key ${key}; the config defines ${[...KEYS].sort().join(', ')} only`;
    }
  }
  return undefined;
}

/** Reads the aggregate specs of a config file. A missing file is an error here; the caller decides. */
export async function readAggregateConfig(path: string): Promise<ConfigLoad> {
  const text = await readFile(path, 'utf8');
  const doc = parseDocument(text);
  if (doc.errors.length > 0) {
    const first = doc.errors[0];
    return {
      ok: false,
      message: `${path}:${lineOf(text, first?.pos?.[0] ?? 0)}: not YAML: ${first?.message ?? ''}`,
    };
  }
  const root = doc.contents;
  if (root === null || root === undefined) return { ok: true, specs: [] };
  if (!isMap(root))
    return { ok: false, message: `${path}:1: the config must be a map with an aggregates list` };
  const keyError = configKeyError(root, text, path);
  if (keyError) return { ok: false, message: keyError };
  const list = root.get('aggregates');
  if (list === undefined || list === null) return { ok: true, specs: [] };
  if (!isSeq(list)) {
    return { ok: false, message: `${path}:${lineOf(text, list.range?.[0] ?? 0)}: aggregates must be a list` };
  }
  const specs: string[] = [];
  for (const item of list.items) {
    const line = lineOf(text, item.range?.[0] ?? 0);
    const value = isScalar(item) ? String(item.value) : '';
    try {
      aggregateFromFlag(value);
    } catch (cause) {
      return {
        ok: false,
        message: `${path}:${line}: ${cause instanceof Error ? cause.message : String(cause)}`,
      };
    }
    specs.push(value);
  }
  return { ok: true, specs };
}

/**
 * The file's specs with the flags applied: the first flag of a name replaces the file's entry of that name in
 * place. Flags never replace each other: two flags of one name are two criteria, both scored.
 */
export function mergeAggregates(fromFile: readonly string[], fromFlags: readonly string[]): string[] {
  const nameOf = (spec: string) => spec.split(':')[0] ?? spec;
  const merged = [...fromFile];
  const fileEntry = new Map<string, number>();
  fromFile.forEach((spec, index) => {
    if (!fileEntry.has(nameOf(spec))) fileEntry.set(nameOf(spec), index);
  });
  for (const flag of fromFlags) {
    const at = fileEntry.get(nameOf(flag));
    if (at !== undefined) {
      merged[at] = flag;
      fileEntry.delete(nameOf(flag));
    } else {
      merged.push(flag);
    }
  }
  return merged;
}

/**
 * The criteria a command scores: the config file's aggregates with the --aggregate flags applied. Without
 * --config the file is `driftbench.yaml` in the working folder, and it is optional. A --config that cannot be
 * read is an error.
 */
export async function criteriaFromConfig(
  options: { config?: string; aggregate?: readonly string[] },
  cwd: string,
): Promise<{ ok: true; criteria: AggregateCriterion[] } | { ok: false; message: string }> {
  const explicit = options.config !== undefined;
  const path = resolve(cwd, explicit ? (options.config as string) : DEFAULT_CONFIG);
  let fromFile: string[] = [];
  if (explicit || existsSync(path)) {
    let loaded: ConfigLoad;
    try {
      loaded = await readAggregateConfig(path);
    } catch (cause) {
      return {
        ok: false,
        message: `Cannot read the config ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
      };
    }
    if (!loaded.ok) return { ok: false, message: loaded.message };
    fromFile = loaded.specs;
  }
  try {
    return {
      ok: true,
      criteria: mergeAggregates(fromFile, options.aggregate ?? []).map((spec) => aggregateFromFlag(spec)),
    };
  } catch (cause) {
    return { ok: false, message: cause instanceof Error ? cause.message : String(cause) };
  }
}

export const DEFAULT_CONFIG = 'driftbench.yaml';
