import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { provenanceHash } from '../runner/provenance';
import type { ChangeManifest } from './change';

const EvidenceFile = z.strictObject({
  path: z.string().min(1).describe('Absolute path, or a path relative to the manifest file.'),
  hash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .describe('Full SHA-256 of the canonical JSON value read from this file.'),
});
const PromptFile = EvidenceFile.extend({
  version: z.string().min(1).describe('The corresponding from or to agent version.'),
});

export const PromptProvenance = z.strictObject({
  kind: z.literal('radius-auto-estate').describe('An estate prompt comparison made by radius auto.'),
  source: z.string().min(1).describe('The atom provenance.file in the estate map.'),
  map: EvidenceFile.describe('The complete approved estate map, hashed as its parsed document.'),
  before: PromptFile.describe('The original prompt, hashed as its raw text string.'),
  after: PromptFile.describe('The candidate prompt, hashed as its raw text string.'),
});

export type PromptMapValidator = (evidence: {
  map: unknown;
  source: string;
  before: string;
  after: string;
}) => boolean | Promise<boolean>;

// Serialized claims cannot grant trust. Even a validated object's later mutation revokes it.
const validated = new WeakMap<ChangeManifest, string>();

export function hasValidatedPromptNoop(manifest: ChangeManifest): boolean {
  const hash = validated.get(manifest);
  return hash !== undefined && hash === provenanceHash(manifest);
}

/**
 * Hashes bind both prompt versions and the full map. The trusted consumer must also validate the
 * map's schema, internal hashes, source and old quote spans, and prove a normalized no-op.
 * Without that validator, or if any evidence is stale/unavailable, ordinary radius safety rules apply.
 */
export async function validatePromptNoop(
  manifest: ChangeManifest,
  path: string,
  validatePromptMap?: PromptMapValidator,
): Promise<void> {
  const proof = manifest.promptProvenance;
  if (!proof || !validatePromptMap || manifest.changes.length !== 0) return;
  if (proof.before.version !== manifest.from || proof.after.version !== manifest.to) return;
  try {
    const read = (file: { path: string }) => readFile(resolve(dirname(path), file.path), 'utf8');
    const [rawMap, before, after] = await Promise.all([
      read(proof.map),
      read(proof.before),
      read(proof.after),
    ]);
    const map: unknown = parseYaml(rawMap);
    if (
      provenanceHash(map) !== proof.map.hash ||
      provenanceHash(before) !== proof.before.hash ||
      provenanceHash(after) !== proof.after.hash
    )
      return;
    // Same text identity as the estate unit ledger: NFC, whitespace runs collapsed, ends trimmed.
    const squash = (text: string) => text.normalize('NFC').replace(/\s+/g, ' ').trim();
    if (squash(before) !== squash(after)) return;
    if (await validatePromptMap({ map, source: proof.source, before, after })) {
      validated.set(manifest, provenanceHash(manifest));
    }
  } catch {
    // Missing, unreadable, malformed or invalid evidence never narrows the radius.
  }
}
