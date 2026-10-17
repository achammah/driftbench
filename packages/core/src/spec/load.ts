import { readFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { z } from 'zod';
import { SPEC_SCHEMA_VERSION, type Spec } from '../schema/spec';
import { parseBlockYaml } from './block-yaml';
import { parseSpecSchema } from './compiled-schema';
import { specHash } from './identity';
import { error, type Issue } from './issues';
import { lintSpec } from './lint';
import { normalizeSpec } from './normalize';
import { checkSemantics } from './semantics';

export type LoadResult =
  | { ok: true; path: string; spec: Spec; hash: string; warnings: Issue[] }
  | { ok: false; path: string; errors: Issue[]; warnings: Issue[] };

export type LoadedSpec = Extract<LoadResult, { ok: true }>;

/** Parses, normalises and validates spec text. Never throws on bad input. */
export function parseSpecText(text: string, format: 'yaml' | 'json', path = '<inline>'): LoadResult {
  let raw: unknown;
  try {
    raw =
      format === 'json'
        ? JSON.parse(text)
        : (parseBlockYaml(text)?.value ?? parseYaml(text, { prettyErrors: true, uniqueKeys: true }));
  } catch (cause) {
    return { ok: false, path, errors: [error('SPEC_PARSE', '', describe(cause))], warnings: [] };
  }
  return validateSpec(raw, path);
}

/** The full schema, semantic and lint result, for callers that do not consume a content hash. */
export type SpecValidationResult = Omit<LoadedSpec, 'hash'> | Extract<LoadResult, { ok: false }>;

/** Normalises, validates and hashes an already parsed value. */
export function validateSpec(raw: unknown, path = '<inline>'): LoadResult {
  const checked = checkSpec(raw, path);
  if (!checked.ok) return checked;
  return {
    ok: true,
    path: checked.path,
    spec: checked.spec,
    hash: specHash(checked.spec),
    warnings: checked.warnings,
  };
}

/** Runs the same checks as validateSpec without computing an unused content digest. */
export function checkSpec(raw: unknown, path = '<inline>'): SpecValidationResult {
  // A spec written for a newer format is refused first, with the fix, before its newer keys read as unknown.
  const newer = newerSchema(raw);
  if (newer) return { ok: false, path, errors: [newer], warnings: [] };
  const normalized = normalizeSpec(raw);
  const errors = normalized.issues.filter((issue) => issue.level === 'error');
  const parsed = parseSpecSchema(normalized.value);

  if (!parsed.success) {
    for (const zodIssue of parsed.error.issues) {
      const issue = fromZod(zodIssue);
      const covered = errors.some(
        (known) =>
          known.path !== '' && (issue.path === known.path || issue.path.startsWith(`${known.path}.`)),
      );
      if (!covered) errors.push(issue);
    }
  }
  if (!parsed.success || errors.length > 0) return { ok: false, path, errors, warnings: [] };

  const semantic = checkSemantics(parsed.data);
  if (semantic.length > 0) return { ok: false, path, errors: semantic, warnings: [] };

  return {
    ok: true,
    path,
    spec: parsed.data,
    warnings: lintSpec(parsed.data),
  };
}

/** The refusal of a spec whose `schema_version` is a whole number above the version this driftbench reads. */
function newerSchema(raw: unknown): Issue | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const version = (raw as { schema_version?: unknown }).schema_version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version <= SPEC_SCHEMA_VERSION) {
    return undefined;
  }
  return error(
    'SPEC_SCHEMA_VERSION',
    'schema_version',
    `the spec is written for spec format version ${version}; this driftbench reads version ${SPEC_SCHEMA_VERSION} and older: upgrade driftbench`,
  );
}

/**
 * Reads one file. `.json` is parsed as JSON, anything else as YAML. The file is read in one synchronous call:
 * a spec file is small, and a read through the thread pool (open, stat, read and close as queued operations)
 * costs more CPU than the synchronous read, once per file of a suite.
 */
export async function loadSpecFile(path: string): Promise<LoadResult> {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (cause) {
    return {
      ok: false,
      path,
      errors: [error('SPEC_PARSE', '', `cannot read the file: ${describe(cause)}`)],
      warnings: [],
    };
  }
  return anchorWorkspace(
    parseSpecText(text, extname(path).toLowerCase() === '.json' ? 'json' : 'yaml', path),
  );
}

/**
 * A workspace folder written `./<path>` is read from the folder of the spec file, so a spec and the seed folder
 * beside it move together. Any other relative path is left as written: it is read from the folder the run starts
 * in. The hash is the one of the spec as resolved, as the store checks it.
 */
function anchorWorkspace(result: LoadResult): LoadResult {
  if (!result.ok) return result;
  const workspace = result.spec.given?.world?.workspace;
  if (workspace?.from === undefined || !workspace.from.startsWith('./')) return result;
  const from = resolve(dirname(result.path), workspace.from);
  const world = { ...result.spec.given?.world, workspace: { ...workspace, from } };
  const spec = { ...result.spec, given: { ...result.spec.given, world } } as Spec;
  return { ...result, spec, hash: specHash(spec) };
}

/** Expands files and folders into spec files: `*.yaml`, `*.yml` and `*.spec.json`, sorted. */
export async function findSpecFiles(paths: string[]): Promise<string[]> {
  const found = new Set<string>();
  for (const path of paths) {
    const info = await stat(path).catch(() => undefined);
    if (!info) {
      found.add(path);
    } else if (info.isDirectory()) {
      for (const file of await walk(path)) found.add(file);
    } else {
      found.add(path);
    }
  }
  return [...found].sort();
}

/** Loads every spec found under the given files and folders. */
export async function loadSpecs(paths: string[]): Promise<LoadResult[]> {
  const files = await findSpecFiles(paths);
  return Promise.all(files.map((file) => loadSpecFile(file)));
}

const SKIP = new Set(['node_modules', 'dist']);

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (/\.(ya?ml)$/i.test(entry.name) || /\.spec\.json$/i.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const UNION_HINTS: Record<string, string> = {
  when: 'expected exactly one of: user, burst, injection',
  count: 'expected a whole number of at least 0, or { min, max }',
  end_state: "expected 'none', an end-state mapping, or a list of them",
};

function fromZod(issue: z.core.$ZodIssue): Issue {
  const path = issue.path.map(String).join('.');
  const last = String(issue.path[issue.path.length - 1] ?? '');
  const parent = String(issue.path[issue.path.length - 2] ?? '');
  let message = issue.message;
  if (issue.code === 'invalid_union') {
    message =
      UNION_HINTS[last] ??
      (parent === 'input' || parent === 'expect'
        ? 'expected a value, or one of: exact, regex, contains, one_of, nonempty, absent, subset'
        : message);
  } else if (issue.code === 'unrecognized_keys') {
    message = `unknown key${issue.keys.length > 1 ? 's' : ''}: ${issue.keys.join(', ')}`;
  } else if (issue.code === 'invalid_type') {
    message = message.replace(/received undefined$/, 'missing');
  }
  return { level: 'error', code: `SCHEMA_${issue.code.toUpperCase()}`, path, message };
}

function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message.split('\n').slice(0, 3).join(' ').trim();
  return String(cause);
}
