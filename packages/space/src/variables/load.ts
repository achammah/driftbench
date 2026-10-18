import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { DeviationClass, isPlainObject } from '@agent-nexus/driftbench-core';
import { parse as parseYaml } from 'yaml';
import type { z } from 'zod';
import { compileSpace, findAllowedCell } from '../grid';
import { type DimensionKind, NONE } from '../schema';
import { deriveSpaceMap } from './convert';
import { provenanceHolders } from './provenance';
import { VariableStore } from './schema';

/**
 * Every problem a store can have has a stable code, like the codes of the space map loader. From
 * `VARIABLES_DUPLICATE` to `VARIABLES_GRID_EMPTY` they are the rules of a space map, kept for the axes of
 * the store (the weight and prior rules for every variable). The four source codes are reported by the check
 * that reads the sources (`verifyVariableQuotes` in the generate package). `VARIABLES_UNSOURCED` is advice:
 * it never makes a store invalid.
 */
export const VariableStoreIssueCodes = [
  'VARIABLES_PARSE',
  'VARIABLES_NOT_OBJECT',
  'VARIABLES_DUPLICATE',
  'VARIABLES_KIND_REPEATED',
  'VARIABLES_AMBIGUOUS_VALUE',
  'VARIABLES_UNKNOWN_DEVIATION',
  'VARIABLES_EMPTY_CONSTRAINT',
  'VARIABLES_UNKNOWN_VARIABLE',
  'VARIABLES_UNKNOWN_VALUE',
  'VARIABLES_WEIGHT_INCOMPLETE',
  'VARIABLES_WEIGHT_ZERO',
  'VARIABLES_PRIOR_SOURCE',
  'VARIABLES_GRID_EMPTY',
  'VARIABLES_BOUNDARY',
  'VARIABLES_SOURCE_UNREADABLE',
  'VARIABLES_QUOTE_NOT_FOUND',
  'VARIABLES_POINTER_UNRESOLVED',
  'VARIABLES_HASH_MISMATCH',
  'VARIABLES_UNSOURCED',
] as const;

export type VariableStoreIssueCode = (typeof VariableStoreIssueCodes)[number] | `SCHEMA_${string}`;

export type VariableStoreIssue = {
  code: VariableStoreIssueCode;
  /** Dotted path inside the store, for example `variables.1.values.0.provenance.0`. Empty for the whole file. */
  path: string;
  message: string;
};

export type VariableStoreResult =
  | { ok: true; path: string; store: VariableStore; warnings: VariableStoreIssue[] }
  | { ok: false; path: string; errors: VariableStoreIssue[] };

/** Kinds a spec places on through one field (a block's stage, its deviation, the spec's channel): one axis each. */
const SINGLE_KINDS: ReadonlySet<DimensionKind> = new Set(['stage', 'deviation', 'channel']);

/** Parses and validates store text. Never throws on bad input. */
export function parseVariableStoreText(
  text: string,
  format: 'yaml' | 'json',
  path = '<inline>',
): VariableStoreResult {
  let raw: unknown;
  try {
    raw = format === 'json' ? JSON.parse(text) : parseYaml(text, { prettyErrors: true, uniqueKeys: true });
  } catch (cause) {
    return { ok: false, path, errors: [issue('VARIABLES_PARSE', '', describe(cause))] };
  }
  return validateVariableStore(raw, path);
}

/** Validates an already parsed value: the strict schema first, then the references, the weights and the grid. */
export function validateVariableStore(raw: unknown, path = '<inline>'): VariableStoreResult {
  if (!isPlainObject(raw)) {
    const message =
      'a store file must hold one mapping (an object) with a format, an agent, a version and variables';
    return { ok: false, path, errors: [issue('VARIABLES_NOT_OBJECT', '', message)] };
  }
  const parsed = VariableStore.safeParse(raw);
  if (!parsed.success) return { ok: false, path, errors: parsed.error.issues.map(fromZod) };
  const errors = checkReferences(parsed.data);
  if (errors.length === 0) errors.push(...checkGrid(parsed.data));
  if (errors.length > 0) return { ok: false, path, errors };
  return { ok: true, path, store: parsed.data, warnings: unsourced(parsed.data) };
}

/** Reads one store file. `.json` is parsed as JSON, anything else as YAML. */
export async function loadVariableStore(path: string): Promise<VariableStoreResult> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (cause) {
    return {
      ok: false,
      path,
      errors: [issue('VARIABLES_PARSE', '', `cannot read the file: ${describe(cause)}`)],
    };
  }
  return parseVariableStoreText(text, extname(path).toLowerCase() === '.json' ? 'json' : 'yaml', path);
}

/** Rules the schema cannot express: unique ids, references that resolve, weights that can be used. */
function checkReferences(store: VariableStore): VariableStoreIssue[] {
  const issues: VariableStoreIssue[] = [];
  const variables = new Map<string, Set<string>>();
  const axisKinds = new Map<DimensionKind, string>();
  // For kinds a spec names by value (behaviours, tags), the axis that holds each value id.
  const owners = new Map<string, string>();

  store.variables.forEach((variable, index) => {
    const path = `variables.${index}`;
    if (variables.has(variable.id)) {
      issues.push(issue('VARIABLES_DUPLICATE', `${path}.id`, `variable "${variable.id}" is listed twice`));
    }
    const axis = variable.role === 'axis';
    if (axis) {
      const first = axisKinds.get(variable.kind);
      if (first !== undefined && SINGLE_KINDS.has(variable.kind)) {
        issues.push(
          issue(
            'VARIABLES_KIND_REPEATED',
            `${path}.kind`,
            `only one axis may be of kind ${variable.kind}: "${first}" already is`,
          ),
        );
      }
      if (first === undefined) axisKinds.set(variable.kind, variable.id);
    }

    const ids = new Set<string>();
    variable.values.forEach((value, position) => {
      const at = `${path}.values.${position}.id`;
      if (ids.has(value.id)) {
        issues.push(
          issue('VARIABLES_DUPLICATE', at, `value "${value.id}" is listed twice in "${variable.id}"`),
        );
      }
      ids.add(value.id);
      if (!axis) return;
      if (variable.kind === 'deviation' && value.id !== NONE && !DeviationClass.safeParse(value.id).success) {
        issues.push(
          issue(
            'VARIABLES_UNKNOWN_DEVIATION',
            at,
            `"${value.id}" is not a deviation class: use D1_off_topic to D12_prompt_extraction, or ${NONE}`,
          ),
        );
      }
      if (value.id === NONE || SINGLE_KINDS.has(variable.kind)) return;
      const key = `${variable.kind}:${value.id}`;
      const owner = owners.get(key);
      if (owner !== undefined && owner !== variable.id) {
        issues.push(
          issue(
            'VARIABLES_AMBIGUOUS_VALUE',
            at,
            `value "${value.id}" is also in "${owner}"; a spec names a ${variable.kind} value without its variable, so the id must be unique across ${variable.kind} axes`,
          ),
        );
      }
      owners.set(key, owner ?? variable.id);
    });
    if (!variables.has(variable.id)) variables.set(variable.id, ids);

    const weighted = variable.values.filter((value) => value.weight !== undefined);
    if (weighted.length > 0 && weighted.length < variable.values.length) {
      const missing = variable.values.findIndex((value) => value.weight === undefined);
      issues.push(
        issue(
          'VARIABLES_WEIGHT_INCOMPLETE',
          `${path}.values.${missing}.weight`,
          `"${variable.id}" gives a weight to some values only: give every value a weight, or none`,
        ),
      );
    } else if (weighted.length > 0 && weighted.every((value) => value.weight === 0)) {
      issues.push(
        issue('VARIABLES_WEIGHT_ZERO', `${path}.values`, `every value of "${variable.id}" weighs 0`),
      );
    }

    (variable.boundaries ?? []).forEach((boundary, b) => {
      const at = `${path}.boundaries.${b}`;
      for (const side of ['holds', 'fails', 'edge'] as const) {
        if (!ids.has(boundary[side])) {
          issues.push(
            issue(
              'VARIABLES_UNKNOWN_VALUE',
              `${at}.${side}`,
              `"${variable.id}" has no value "${boundary[side]}"`,
            ),
          );
        }
      }
      if (boundary.holds === boundary.fails) {
        issues.push(
          issue(
            'VARIABLES_BOUNDARY',
            `${at}.fails`,
            'the two sides of a boundary are two values: holds and fails name the same one',
          ),
        );
      }
      // A limit with a comparison says which side the limit itself falls on: a strict comparison
      // (lt, gt) leaves it on the failing side, an inclusive one (le, ge) on the side where the condition holds.
      if (boundary.comparison !== undefined) {
        const strict = boundary.comparison === 'lt' || boundary.comparison === 'gt';
        if (strict && boundary.edge === boundary.holds) {
          issues.push(
            issue(
              'VARIABLES_BOUNDARY',
              `${at}.edge`,
              `"${boundary.comparison}" leaves the limit itself on the failing side: the edge is not the value where the condition holds`,
            ),
          );
        } else if (!strict && boundary.edge === boundary.fails) {
          issues.push(
            issue(
              'VARIABLES_BOUNDARY',
              `${at}.edge`,
              `"${boundary.comparison}" puts the limit itself on the side where the condition holds: the edge is not the failing value`,
            ),
          );
        }
      }
    });
  });

  const reference = (variable: string, value: string | undefined, path: string) => {
    const values = variables.get(variable);
    if (!values) {
      issues.push(issue('VARIABLES_UNKNOWN_VARIABLE', path, `the store has no variable "${variable}"`));
    } else if (value !== undefined && !values.has(value)) {
      issues.push(issue('VARIABLES_UNKNOWN_VALUE', path, `"${variable}" has no value "${value}"`));
    }
  };

  store.variables.forEach((variable, index) => {
    variable.values.forEach((value, position) => {
      for (const field of ['when', 'unless'] as const) {
        for (const [name, wanted] of Object.entries(value[field] ?? {})) {
          const at = `variables.${index}.values.${position}.${field}.${name}`;
          if (!variables.has(name)) {
            reference(name, undefined, at);
            continue;
          }
          for (const [n, id] of wanted.entries()) reference(name, id, `${at}.${n}`);
        }
      }
    });
  });

  const forbids = new Set<string>();
  store.constraints.forEach((constraint, index) => {
    const path = `constraints.${index}`;
    const pairs = Object.entries(constraint.forbid);
    if (pairs.length === 0) {
      issues.push(issue('VARIABLES_EMPTY_CONSTRAINT', `${path}.forbid`, 'forbid names no variable'));
      return;
    }
    for (const [variable, value] of pairs) reference(variable, value, `${path}.forbid.${variable}`);
    const key = pairs
      .map(([variable, value]) => `${variable}=${value}`)
      .sort()
      .join('&');
    if (forbids.has(key)) {
      issues.push(issue('VARIABLES_DUPLICATE', path, 'the same combination is forbidden twice'));
    }
    forbids.add(key);
  });

  if (store.prior.kind === 'fitted' && store.prior.source === undefined) {
    issues.push(
      issue(
        'VARIABLES_PRIOR_SOURCE',
        'prior.source',
        'a fitted prior names the conversations it was fitted on',
      ),
    );
  }
  return issues;
}

/** The axes and constraints, taken together, leave at least one cell. */
function checkGrid(store: VariableStore): VariableStoreIssue[] {
  const map = deriveSpaceMap(store, false);
  if (map.dimensions.length === 0 || findAllowedCell(compileSpace(map))) return [];
  const message = 'the constraints forbid every cell of the axes: no combination of values is left';
  return [issue('VARIABLES_GRID_EMPTY', 'constraints', message)];
}

/** Advice: every value, boundary and constraint that states a fact and names no source. */
function unsourced(store: VariableStore): VariableStoreIssue[] {
  return provenanceHolders(store)
    .filter((holder) => holder.kind !== 'variable' && holder.provenance.length === 0)
    .map((holder) =>
      issue(
        'VARIABLES_UNSOURCED',
        holder.path,
        `this ${holder.kind} names no source: add a quote, the counts of past conversations or the owner's words`,
      ),
    );
}

function issue(code: VariableStoreIssueCode, path: string, message: string): VariableStoreIssue {
  return { code, path, message };
}

function fromZod(zodIssue: z.core.$ZodIssue): VariableStoreIssue {
  let message = zodIssue.message;
  if (zodIssue.code === 'unrecognized_keys') {
    message = `unknown key${zodIssue.keys.length > 1 ? 's' : ''}: ${zodIssue.keys.join(', ')}`;
  } else if (zodIssue.code === 'invalid_type') {
    message = message.replace(/received undefined$/, 'missing');
  }
  return issue(`SCHEMA_${zodIssue.code.toUpperCase()}`, zodIssue.path.map(String).join('.'), message);
}

function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message.split('\n').slice(0, 3).join(' ').trim();
  return String(cause);
}
