import { createHash } from 'node:crypto';
import type { AgentAdapter } from '../contracts/adapter';
import type { CheckContext } from '../contracts/check';
import { agentVersionOf } from '../radius/version';
import type { RunResult } from '../schema/run';
import { canonicalJson } from '../spec/hash';
import type { RunOptions } from './run';

/** Full SHA-256 of canonical JSON. Never persist user-supplied identity or stimulus text beside it. */
export const provenanceHash = (value: unknown): string =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');

export function adapterProvenance(adapter: AgentAdapter, targetAdapter?: string) {
  return {
    idHash: provenanceHash(adapter.id),
    versionHash: provenanceHash(adapter.version),
    cacheIdentityHash: adapter.cacheIdentity === undefined ? null : provenanceHash(adapter.cacheIdentity),
    requiresCacheIdentity: adapter.id === 'process' || targetAdapter === 'process',
  };
}

/** Hash bytes only when a check already reads them. No new file content is stored or additional read made. */
export function captureArtifacts(ctx: Pick<CheckContext, 'observed' | 'readArtifact'>) {
  const artifacts = (ctx.observed.artifacts ?? []).map((file) => ({
    pathHash: provenanceHash(file.path),
    sha256: file.sha256 && /^[0-9a-f]{64}$/.test(file.sha256) ? file.sha256 : null,
  }));
  const read = ctx.readArtifact;
  return {
    artifacts,
    readArtifact:
      read === undefined
        ? undefined
        : async (path: string) => {
            try {
              const bytes = await read(path);
              artifacts.push({
                pathHash: provenanceHash(path),
                sha256: createHash('sha256').update(bytes).digest('hex'),
              });
              return bytes;
            } catch (error) {
              artifacts.push({ pathHash: provenanceHash(path), sha256: null });
              throw error;
            }
          },
  };
}

/** Unknown seeds remain null. A driver must explicitly declare {} when it uses no randomness. */
export function runProvenance(options: RunOptions): NonNullable<RunResult['provenance']> {
  const driver = {
    idHash: provenanceHash(options.driver.id),
    seedsHash: options.driver.seeds === undefined ? null : provenanceHash(options.driver.seeds),
  };
  const adapter = adapterProvenance(options.adapter, options.target?.adapter);
  const agentVersion = options.target === undefined ? undefined : agentVersionOf({ target: options.target });
  const { variant, prompt, ...targetContext } = options.target ?? {};
  return {
    version: 2,
    driver,
    adapter,
    agentVersionHash: agentVersion === undefined ? null : provenanceHash(agentVersion),
    targetVersionHash: provenanceHash({ variant, prompt }),
    agentVersionLabelHash: options.agentVersion === undefined ? null : provenanceHash(options.agentVersion),
    executionHash: provenanceHash({
      driver,
      adapter,
      target: targetContext,
      mode: options.mode,
      repeat: options.repeat,
      perturbationId: options.perturbationId,
      toolPolicy: options.toolPolicy,
      retry: options.retry,
      maxSteps: options.maxSteps,
    }),
  };
}

/** Canonical integrity envelope. Whole stamps are hashed, so new fields cannot escape the digest. */
export function provenanceDigest(
  run: Pick<RunResult, 'provenance' | 'blocks' | 'realizedTextStripped'>,
): string {
  return provenanceHash({
    run: run.provenance,
    ...(run.realizedTextStripped === undefined ? {} : { realizedTextStripped: run.realizedTextStripped }),
    // `realized` joins only when present, so the digest of a block without it is the one it always was.
    blocks: run.blocks.map(
      ({
        index,
        blockId,
        parent,
        specIndex,
        injected,
        realized,
        realizedTextStripped,
        givenHash,
        provenance,
      }) => ({
        index,
        blockId,
        ...(parent === undefined ? {} : { parent }),
        ...(specIndex === undefined ? {} : { specIndex }),
        injected,
        ...(realized === undefined ? {} : { realized }),
        ...(realizedTextStripped === undefined ? {} : { realizedTextStripped }),
        givenHash,
        provenance,
      }),
    ),
  });
}
