// HF1 stand-in: main's spec schema extended with the framework's optional keys, and a loader that runs
// main's pipeline (parse, normalise, schema, semantics, lint, hash, workspace anchoring) with that schema.
// Nothing under packages/* changes: every schema below is built from main's exports with .extend.
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { Assertion } from '../../../../../packages/core/src/schema/common.ts';
import {
  BlockSpec,
  Expect,
  GivenOverride,
  Spec,
  Stimulus,
  ToolExpect,
} from '../../../../../packages/core/src/schema/spec.ts';
import { parseBlockYaml } from '../../../../../packages/core/src/spec/block-yaml.ts';
import { contentHash } from '../../../../../packages/core/src/spec/hash.ts';
import { error, type Issue } from '../../../../../packages/core/src/spec/issues.ts';
import { lintSpec } from '../../../../../packages/core/src/spec/lint.ts';
import { normalizeSpec } from '../../../../../packages/core/src/spec/normalize.ts';
import { checkSemantics } from '../../../../../packages/core/src/spec/semantics.ts';

/** `compare` on an input assertion: the value-check rung (config_framework.md 2.4). */
export const Compare = z.enum(['auto', 'outcome', 'contract', 'same_referent', 'exact']);

/** An object reference: an id, or an inline object that extends one (the block layer). */
const ObjectRef = z.union([
  z.string().min(1),
  z.strictObject({
    extends: z.string().min(1),
    items: z.array(z.record(z.string(), z.unknown())).optional(),
    order: z.array(z.string().min(1)).optional(),
  }),
]);

export const Uses = z.strictObject({
  value_check: ObjectRef.optional(),
  blame: ObjectRef.optional(),
  links: ObjectRef.optional(),
  selection: ObjectRef.optional(),
  gating: ObjectRef.optional(),
  stats: ObjectRef.optional(),
  check_set: ObjectRef.optional(),
  judges: ObjectRef.optional(),
  run_profile: ObjectRef.optional(),
  diagnostics: z.array(z.string().min(1)).optional(),
  prompt_templates: z.record(z.string(), z.string().min(1)).optional(),
});

const compareKeys = {
  compare: Compare.optional(),
  reason: z.string().min(1).optional(),
};

/** Main's Assertion arms, with `compare` on the exact and one_of arms, plus an `equals` arm. */
function extendAssertion(): z.ZodType {
  const arms = (Assertion as unknown as { options: z.ZodType[] }).options.map((arm) => {
    const shape = (arm as unknown as { shape?: Record<string, unknown> }).shape;
    if (shape && ('exact' in shape || 'one_of' in shape)) {
      return (arm as unknown as z.ZodObject).extend(compareKeys);
    }
    return arm;
  });
  const equals = z.strictObject({ equals: z.json(), ...compareKeys });
  return z.union([...arms, equals] as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]]);
}

const SimulatedUser = z.strictObject({
  scenario: z.string().min(1).optional(),
  personas: z.array(z.string().min(1)).optional(),
  requires: z.record(z.string(), z.unknown()).optional(),
  situational: z.record(z.string(), z.unknown()).optional(),
});

const Links = z.array(
  z.strictObject({
    unit: z.string().min(1),
    relation: z.string().min(1).optional(),
  }),
);

export function buildExtendedSpec(options: { mutantDefaultUses?: boolean } = {}) {
  const ExtAssertion = extendAssertion();
  const ExtToolExpect = ToolExpect.extend({ input: z.record(z.string(), ExtAssertion).optional() });
  const ExtExpect = Expect.extend({ tools: z.array(ExtToolExpect).optional() });
  const ExtGiven = GivenOverride.extend({ parent: z.string().min(1).optional() });
  const stimulusArms = (Stimulus as unknown as { options: z.ZodType[] }).options;
  const ExtStimulus = z.union([
    ...stimulusArms,
    z.strictObject({ simulated_user: SimulatedUser }),
  ] as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]]);
  const uses = options.mutantDefaultUses ? Uses.default({}) : Uses.optional();
  const ExtBlock = BlockSpec.extend({
    when: ExtStimulus,
    given: ExtGiven.optional(),
    expect: ExtExpect.optional(),
    uses: Uses.optional(),
    links: Links.optional(),
    diagnostics: z.array(z.string().min(1)).optional(),
  });
  return Spec.extend({ blocks: z.array(ExtBlock).min(1), uses });
}

export const ExtSpec = buildExtendedSpec();

export type LoadResult =
  | { ok: true; path: string; spec: z.infer<typeof Spec>; hash: string; warnings: Issue[] }
  | { ok: false; path: string; errors: Issue[]; warnings: Issue[] };

/** Main's checkSpec + validateSpec with another schema: normalise, parse, semantics, lint, hash. */
export function validateWith(schema: z.ZodType, raw: unknown, path = '<inline>'): LoadResult {
  const normalized = normalizeSpec(raw);
  const errors = normalized.issues.filter((issue) => issue.level === 'error');
  const parsed = schema.safeParse(normalized.value);
  if (!parsed.success) {
    for (const zodIssue of parsed.error.issues) {
      const path2 = zodIssue.path.map(String).join('.');
      const covered = errors.some(
        (known) => known.path !== '' && (path2 === known.path || path2.startsWith(`${known.path}.`)),
      );
      if (!covered)
        errors.push({ level: 'error', code: `SCHEMA_${zodIssue.code.toUpperCase()}`, path: path2, message: zodIssue.message } as Issue);
    }
  }
  if (!parsed.success || errors.length > 0) return { ok: false, path, errors, warnings: [] };
  const spec = parsed.data as z.infer<typeof Spec>;
  const semantic = checkSemantics(spec);
  if (semantic.length > 0) return { ok: false, path, errors: semantic, warnings: [] };
  return { ok: true, path, spec, hash: contentHash(spec), warnings: lintSpec(spec) };
}

/** Main's parse step: block YAML first, then YAML; JSON for .json. */
export function parseRaw(text: string, path: string): { ok: true; raw: unknown } | { ok: false; message: string } {
  try {
    const raw =
      extname(path).toLowerCase() === '.json'
        ? JSON.parse(text)
        : (parseBlockYaml(text)?.value ?? parseYaml(text, { prettyErrors: true, uniqueKeys: true }));
    return { ok: true, raw };
  } catch (cause) {
    return { ok: false, message: cause instanceof Error ? cause.message.split('\n')[0] ?? '' : String(cause) };
  }
}

/** Main's `./` workspace anchoring, copied from packages/core/src/spec/load.ts (anchorWorkspace). */
export function anchorWorkspace(result: LoadResult): LoadResult {
  if (!result.ok) return result;
  const workspace = result.spec.given?.world?.workspace;
  if (workspace?.from === undefined || !workspace.from.startsWith('./')) return result;
  const from = resolve(dirname(result.path), workspace.from);
  const world = { ...result.spec.given?.world, workspace: { ...workspace, from } };
  const spec = { ...result.spec, given: { ...result.spec.given, world } } as z.infer<typeof Spec>;
  return { ...result, spec, hash: contentHash(spec) };
}

export async function loadSpecFileWith(schema: z.ZodType, path: string): Promise<LoadResult> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (cause) {
    return { ok: false, path, errors: [error('SPEC_PARSE', '', String(cause))], warnings: [] };
  }
  const raw = parseRaw(text, path);
  if (!raw.ok) return { ok: false, path, errors: [error('SPEC_PARSE', '', raw.message)], warnings: [] };
  return anchorWorkspace(validateWith(schema, raw.raw, path));
}
