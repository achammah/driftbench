import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { DeviationClass, isPlainObject } from '@agent-nexus/driftbench-core';
import { parse as parseYaml } from 'yaml';
import type { z } from 'zod';
import { compileSpace, findAllowedCell } from './grid';
import { type DimensionKind, NONE, SpaceMap } from './schema';

/** Every problem a map can have has a stable code, like the inventory loader's issues. */
export const SpaceMapIssueCodes = [
  'SPACE_PARSE',
  'SPACE_NOT_OBJECT',
  'SPACE_DUPLICATE',
  'SPACE_KIND_REPEATED',
  'SPACE_AMBIGUOUS_VALUE',
  'SPACE_UNKNOWN_DEVIATION',
  'SPACE_EMPTY_CONSTRAINT',
  'SPACE_UNKNOWN_DIMENSION',
  'SPACE_UNKNOWN_VALUE',
  'SPACE_PRIOR_INCOMPLETE',
  'SPACE_PRIOR_ZERO',
  'SPACE_PRIOR_SOURCE',
  'SPACE_GRID_EMPTY',
] as const;

export type SpaceMapIssueCode = (typeof SpaceMapIssueCodes)[number] | `SCHEMA_${string}`;

export type SpaceMapIssue = {
  code: SpaceMapIssueCode;
  /** Dotted path inside the map, for example `constraints.1.forbid.channel`. Empty for the whole file. */
  path: string;
  message: string;
};

export type SpaceMapResult =
  | { ok: true; path: string; map: SpaceMap }
  | { ok: false; path: string; errors: SpaceMapIssue[] };

/** Kinds a spec places on through one field (a block's stage, its deviation, the spec's channel): one dimension each. */
const SINGLE_KINDS: ReadonlySet<DimensionKind> = new Set(['stage', 'deviation', 'channel']);

/** Parses and validates map text. Never throws on bad input. */
export function parseSpaceMapText(text: string, format: 'yaml' | 'json', path = '<inline>'): SpaceMapResult {
  let raw: unknown;
  try {
    raw = format === 'json' ? JSON.parse(text) : parseYaml(text, { prettyErrors: true, uniqueKeys: true });
  } catch (cause) {
    return { ok: false, path, errors: [issue('SPACE_PARSE', '', describe(cause))] };
  }
  return validateSpaceMap(raw, path);
}

/** Validates an already parsed value: the strict schema first, then the references and the grid. */
export function validateSpaceMap(raw: unknown, path = '<inline>'): SpaceMapResult {
  if (!isPlainObject(raw)) {
    const message = 'a map file must hold one mapping (an object) with dimensions, constraints and a prior';
    return { ok: false, path, errors: [issue('SPACE_NOT_OBJECT', '', message)] };
  }
  const parsed = SpaceMap.safeParse(raw);
  if (!parsed.success) return { ok: false, path, errors: parsed.error.issues.map(fromZod) };
  const errors = checkReferences(parsed.data);
  if (errors.length > 0) return { ok: false, path, errors };
  if (!findAllowedCell(compileSpace(parsed.data))) {
    const message = 'the constraints forbid every cell: no combination of values is left';
    return { ok: false, path, errors: [issue('SPACE_GRID_EMPTY', 'constraints', message)] };
  }
  return { ok: true, path, map: parsed.data };
}

/** Reads one map file. `.json` is parsed as JSON, anything else as YAML. */
export async function loadSpaceMap(path: string): Promise<SpaceMapResult> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (cause) {
    return {
      ok: false,
      path,
      errors: [issue('SPACE_PARSE', '', `cannot read the file: ${describe(cause)}`)],
    };
  }
  return parseSpaceMapText(text, extname(path).toLowerCase() === '.json' ? 'json' : 'yaml', path);
}

/** Rules the schema cannot express: unique ids, references that resolve, a prior that can be used. */
function checkReferences(map: SpaceMap): SpaceMapIssue[] {
  const issues: SpaceMapIssue[] = [];
  const dimensions = new Map<string, Set<string>>();
  const kinds = new Map<DimensionKind, string>();
  // For kinds a spec names by value (behaviours, tags), the dimension that holds each value id.
  const owners = new Map<string, string>();

  map.dimensions.forEach((dimension, index) => {
    const path = `dimensions.${index}`;
    if (dimensions.has(dimension.id)) {
      issues.push(issue('SPACE_DUPLICATE', `${path}.id`, `dimension "${dimension.id}" is listed twice`));
    }
    const first = kinds.get(dimension.kind);
    if (first !== undefined && SINGLE_KINDS.has(dimension.kind)) {
      issues.push(
        issue(
          'SPACE_KIND_REPEATED',
          `${path}.kind`,
          `only one dimension may be of kind ${dimension.kind}: "${first}" already is`,
        ),
      );
    }
    if (first === undefined) kinds.set(dimension.kind, dimension.id);

    const ids = new Set<string>();
    dimension.values.forEach((value, position) => {
      const at = `${path}.values.${position}.id`;
      if (ids.has(value.id)) {
        issues.push(issue('SPACE_DUPLICATE', at, `value "${value.id}" is listed twice in "${dimension.id}"`));
      }
      ids.add(value.id);
      if (
        dimension.kind === 'deviation' &&
        value.id !== NONE &&
        !DeviationClass.safeParse(value.id).success
      ) {
        issues.push(
          issue(
            'SPACE_UNKNOWN_DEVIATION',
            at,
            `"${value.id}" is not a deviation class: use D1_off_topic to D12_prompt_extraction, or ${NONE}`,
          ),
        );
      }
      if (value.id === NONE || SINGLE_KINDS.has(dimension.kind)) return;
      const key = `${dimension.kind}:${value.id}`;
      const owner = owners.get(key);
      if (owner !== undefined && owner !== dimension.id) {
        issues.push(
          issue(
            'SPACE_AMBIGUOUS_VALUE',
            at,
            `value "${value.id}" is also in "${owner}"; a spec names a ${dimension.kind} value without its dimension, so the id must be unique across ${dimension.kind} dimensions`,
          ),
        );
      }
      owners.set(key, owner ?? dimension.id);
    });
    if (!dimensions.has(dimension.id)) dimensions.set(dimension.id, ids);

    const weighted = dimension.values.filter((value) => value.weight !== undefined);
    if (weighted.length > 0 && weighted.length < dimension.values.length) {
      const missing = dimension.values.findIndex((value) => value.weight === undefined);
      issues.push(
        issue(
          'SPACE_PRIOR_INCOMPLETE',
          `${path}.values.${missing}.weight`,
          `"${dimension.id}" gives a weight to some values only: give every value a weight, or none`,
        ),
      );
    } else if (weighted.length > 0 && weighted.every((value) => value.weight === 0)) {
      issues.push(issue('SPACE_PRIOR_ZERO', `${path}.values`, `every value of "${dimension.id}" weighs 0`));
    }
  });

  const forbids = new Set<string>();
  map.constraints.forEach((constraint, index) => {
    const path = `constraints.${index}`;
    const pairs = Object.entries(constraint.forbid);
    if (pairs.length === 0) {
      issues.push(issue('SPACE_EMPTY_CONSTRAINT', `${path}.forbid`, 'forbid names no dimension'));
      return;
    }
    for (const [dimension, value] of pairs) {
      const values = dimensions.get(dimension);
      if (!values) {
        issues.push(
          issue(
            'SPACE_UNKNOWN_DIMENSION',
            `${path}.forbid.${dimension}`,
            `the map has no dimension "${dimension}"`,
          ),
        );
      } else if (!values.has(value)) {
        issues.push(
          issue(
            'SPACE_UNKNOWN_VALUE',
            `${path}.forbid.${dimension}`,
            `"${dimension}" has no value "${value}"`,
          ),
        );
      }
    }
    const key = pairs
      .map(([dimension, value]) => `${dimension}=${value}`)
      .sort()
      .join('&');
    if (forbids.has(key))
      issues.push(issue('SPACE_DUPLICATE', path, 'the same combination is forbidden twice'));
    forbids.add(key);
  });

  const { prior } = map;
  if (prior.kind === 'fitted' && prior.source === undefined) {
    issues.push(
      issue('SPACE_PRIOR_SOURCE', 'prior.source', 'a fitted prior names the conversations it was fitted on'),
    );
  }
  for (const [dimension, weights] of Object.entries(prior.weights ?? {})) {
    const path = `prior.weights.${dimension}`;
    const values = dimensions.get(dimension);
    if (!values) {
      issues.push(issue('SPACE_UNKNOWN_DIMENSION', path, `the map has no dimension "${dimension}"`));
      continue;
    }
    for (const value of Object.keys(weights)) {
      if (!values.has(value)) {
        issues.push(
          issue('SPACE_UNKNOWN_VALUE', `${path}.${value}`, `"${dimension}" has no value "${value}"`),
        );
      }
    }
    const missing = [...values].filter((value) => !Object.hasOwn(weights, value));
    if (missing.length > 0) {
      issues.push(
        issue(
          'SPACE_PRIOR_INCOMPLETE',
          path,
          `the prior weighs "${dimension}" but not ${missing.join(', ')}: list every value, 0 included`,
        ),
      );
    } else if (Object.values(weights).every((weight) => weight === 0)) {
      issues.push(issue('SPACE_PRIOR_ZERO', path, `every value of "${dimension}" weighs 0`));
    }
  }
  return issues;
}

function issue(code: SpaceMapIssueCode, path: string, message: string): SpaceMapIssue {
  return { code, path, message };
}

function fromZod(zodIssue: z.core.$ZodIssue): SpaceMapIssue {
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
