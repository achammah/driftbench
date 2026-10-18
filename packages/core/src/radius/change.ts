import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { contentHash } from '../spec/hash';
import { type PromptMapValidator, PromptProvenance, validatePromptNoop } from './prompt-provenance';

/**
 * A change manifest: what changed in the agent between two versions. Each change has a kind and, for
 * most kinds, the id of the part that changed. The blast radius maps every change to the blocks that
 * part can affect; a change it cannot map is the whole suite.
 */

/** The kinds the radius understands. Any other kind is the whole suite: an unknown is never narrowed. */
export const CHANGE_KINDS = [
  'stage',
  'tool',
  'rule',
  'deviation',
  'prompt',
  'map',
  'fixture',
  'criterion',
  'model',
  'agent',
  'prompt_section',
] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

/** The part of a tool that changed. Absent: any part, the widest reading. */
export const ToolPart = z.enum(['input', 'result', 'description', 'presence']);
export type ToolPart = z.infer<typeof ToolPart>;

export const Change = z
  .strictObject({
    kind: z
      .string()
      .min(1)
      .describe(`What changed: one of ${CHANGE_KINDS.join(', ')}. Another kind is the whole suite.`),
    id: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Which one: a stage, a tool label, a rule (states@<stage>, recovery:<class>, uses_tool:<tool>, path:<id>, reply_language, or a spec rule name), a deviation class, an estate atom id, dimension=value of the map, a fixture name or value, a criterion name, or a prompt section as <prompt-id>#<section-id>.',
      ),
    part: ToolPart.optional().describe(
      'For a tool: input, result, description or presence. Absent: any part.',
    ),
    global: z
      .boolean()
      .optional()
      .describe('True when the change applies to every block, such as a tone rule. The whole suite.'),
    note: z.string().optional().describe('A free note for the reader.'),
  })
  .describe('One change to the agent.');
export type Change = z.infer<typeof Change>;

export const ChangeManifest = z
  .strictObject({
    from: z.string().min(1).describe('The agent version before the change.'),
    to: z.string().min(1).describe('The agent version after the change.'),
    changes: z.array(Change).describe('Every change made between the two versions.'),
    promptProvenance: PromptProvenance.optional().describe(
      'Estate no-op evidence from radius auto. Only revalidation of its files, hashes, versions and map can authorize an empty version transition.',
    ),
  })
  .describe('What changed in the agent between two versions.');
export type ChangeManifest = z.infer<typeof ChangeManifest>;

export type ParsedManifest =
  | { ok: true; manifest: ChangeManifest; hash: string }
  | { ok: false; errors: string[] };

/** Validates a parsed YAML or JSON document as a change manifest. Its content hash names it. */
export function parseChangeManifest(value: unknown): ParsedManifest {
  const parsed = ChangeManifest.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join('.') || '(file)'}: ${issue.message}`),
    };
  }
  return { ok: true, manifest: parsed.data, hash: contentHash(parsed.data) };
}

/** The short name of a change, as the radius prints it: `stage:recap`, `tool:coverage.check:input`. */
export function changeLabel(change: Change): string {
  const parts = [change.kind];
  if (change.id !== undefined) parts.push(change.id);
  if (change.part !== undefined) parts.push(change.part);
  if (change.global === true) parts.push('global');
  return parts.join(':');
}

/** Reads a change manifest file, YAML or JSON. A file that does not parse is an error, never an empty manifest. */
export async function loadChangeManifest(
  path: string,
  options: { validatePromptMap?: PromptMapValidator } = {},
): Promise<ParsedManifest> {
  const text = await readFile(path, 'utf8');
  let value: unknown;
  try {
    value = extname(path).toLowerCase() === '.json' ? JSON.parse(text) : parseYaml(text);
  } catch (cause) {
    return { ok: false, errors: [cause instanceof Error ? cause.message : String(cause)] };
  }
  const parsed = parseChangeManifest(value);
  if (parsed.ok) await validatePromptNoop(parsed.manifest, path, options.validatePromptMap);
  return parsed;
}
