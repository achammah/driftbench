import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type ImplDef, objectRegistry, parseObjectText } from '@agent-nexus/driftbench-core';

/** The objects fixture: two shipped defaults, eight planted unknown-item files, and a project that extends them. */
export const OBJECTS = fileURLToPath(new URL('../fixtures/objects', import.meta.url));
export const PROJECT = join(OBJECTS, 'project');

/**
 * A params schema for a test implementation, with zod's `safeParse` shape: `check` returns the problem with
 * the params, or undefined when they fit.
 */
export function paramsSchema(
  check: (params: Record<string, unknown>) => string | undefined,
): ImplDef['params'] {
  return {
    safeParse(value: unknown) {
      const problem = check((value ?? {}) as Record<string, unknown>);
      return problem === undefined
        ? { success: true, data: value }
        : { success: false, error: { issues: [{ code: 'custom', path: [], message: problem }] } };
    },
  } as unknown as ImplDef['params'];
}

const booleans = (keys: string[]) =>
  paramsSchema((params) => {
    for (const [key, value] of Object.entries(params)) {
      if (!keys.includes(key)) return `unknown param ${key}`;
      if (typeof value !== 'boolean') return `${key} must be true or false`;
    }
    return undefined;
  });

/**
 * Registers the fixture's shipped objects and the builtin implementations they name, once per process: a
 * shipped object or an implementation the packages already register is left as it is.
 */
export function registerFixtureObjects(): void {
  const impls: Record<string, ImplDef['params']> = {
    'builtin:value-check/outcome': booleans([]),
    'builtin:value-check/contract': booleans([]),
    'builtin:value-check/judge': paramsSchema((params) =>
      params.repeats === undefined || typeof params.repeats === 'number'
        ? undefined
        : 'repeats must be a number',
    ),
    'builtin:value-check/exact': booleans(['case_insensitive', 'strip_punctuation']),
    'builtin:checks/tools-count': booleans([]),
    'builtin:checks/tools-input-closed': booleans([]),
    'builtin:checks/tools-order': booleans([]),
    'builtin:checks/tools-argument-accuracy': booleans([]),
    'builtin:checks/forbidden-count0': booleans([]),
  };
  for (const [name, params] of Object.entries(impls)) {
    if (objectRegistry.impl(name) === undefined) objectRegistry.registerImpl(name, { params });
  }
  const held = new Set(
    objectRegistry.shipped().map(({ raw }) => {
      const head = raw as { kind: string; id: string };
      return `${head.kind}:${head.id}`;
    }),
  );
  for (const file of ['policy-value-check-default.yaml', 'check-set-default.yaml']) {
    const path = join(OBJECTS, 'shipped', file);
    const { raw } = parseObjectText(readFileSync(path, 'utf8'), path);
    const head = raw as { kind: string; id: string };
    if (!held.has(`${head.kind}:${head.id}`)) objectRegistry.registerShipped(raw, path);
  }
}
