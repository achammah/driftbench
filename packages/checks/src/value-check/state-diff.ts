import { globMatches, type WorkspaceDiff } from '@agent-nexus/driftbench-core';
import { listed, normalizePath } from '../support/values';
import type { Rung } from './ladder';

/**
 * Rung 1 for a workspace: compare the net state change. The agent's work is right when every expected change is
 * in the net workspace diff (a file created then deleted is no change) and nothing outside the expected changes
 * plus the allowed paths changed. An extra file is a fail even when every expected change is there: the
 * outcome a reader meets is the whole workspace (AppWorld p.6).
 */

/** What the state-diff rung reads. */
export type StateDiffCase = {
  /** The net diff of the block: what the adapter observed. */
  diff: WorkspaceDiff;
  /** The changes the block expects, by set. */
  expected: Partial<WorkspaceDiff>;
  /** Paths that may change without being expected, as globs: `*` within a folder, `**` across folders. */
  allowed?: readonly string[];
};

const SETS = ['created', 'changed', 'deleted'] as const;

export const stateDiff: Rung = (value) => {
  const spec = value.stateDiff;
  if (spec === undefined) return { skip: 'no workspace diff to compare' };
  const missing: string[] = [];
  const extra: string[] = [];
  const allowed = spec.allowed ?? [];
  for (const set of SETS) {
    const observed = new Set(spec.diff[set].map(normalizePath));
    const wanted = new Set((spec.expected[set] ?? []).map(normalizePath));
    for (const path of wanted) if (!observed.has(path)) missing.push(`${path} not ${set}`);
    for (const path of observed) {
      if (!wanted.has(path) && !allowed.some((pattern) => globMatches(pattern, path)))
        extra.push(`${path} ${set}`);
    }
  }
  if (missing.length === 0 && extra.length === 0) {
    return {
      settles: 'pass',
      evidence: 'every expected change is in the workspace diff, and nothing else changed',
    };
  }
  const notes = [
    ...(missing.length > 0 ? [`missing: ${listed(missing)}`] : []),
    ...(extra.length > 0 ? [`outside the expected and allowed changes: ${listed(extra)}`] : []),
  ];
  return { settles: 'fail', evidence: `the workspace diff does not match: ${notes.join('; ')}` };
};
