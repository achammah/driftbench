import type { Spec } from '../schema/spec';
import { contentHash } from './hash';

/**
 * The metadata keys that say what a spec is linked to and where it came from, not what it runs. They
 * stay out of the spec hash, so a link added, promoted or refuted never moves a cell id, a cache key, a
 * carry or a rejudge.
 */
export const IDENTITY_EXCLUDED_METADATA = ['links', 'provenance'] as const;

/**
 * The spec as its hash reads it: the spec without `metadata.links` and `metadata.provenance`. When they
 * were the only metadata, `metadata` goes too, so a spec that gains its first link keeps its hash. A spec
 * without those keys is returned as it is.
 */
export function specIdentity(spec: Spec): Spec {
  const metadata = spec.metadata;
  if (metadata === undefined || !IDENTITY_EXCLUDED_METADATA.some((key) => key in metadata)) return spec;
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!(IDENTITY_EXCLUDED_METADATA as readonly string[]).includes(key)) kept[key] = value;
  }
  const { metadata: _metadata, ...rest } = spec;
  return Object.keys(kept).length === 0 ? (rest as Spec) : { ...rest, metadata: kept };
}

/** The spec hash: the content hash of `specIdentity(spec)`. Cell ids, carries and rejudges use it. */
export function specHash(spec: Spec): string {
  return contentHash(specIdentity(spec));
}
