import { globMatches, machineVerdict } from '@agent-nexus/driftbench-core';
import { isRecord, normalizePath } from '../support/values';
import type { CustomCheckFunction } from './custom';

/** Typed estate absences. Missing observations are inconclusive, never evidence of absence. */
export const absence: CustomCheckFunction = (ctx, options) => {
  if (!isRecord(options) || !Array.isArray(options.predicates) || options.predicates.length === 0) {
    throw new Error('absence requires a nonempty predicates list');
  }
  if (typeof options.block === 'number' && options.block !== ctx.blockIndex) return [];
  return options.predicates.map((predicate, index) => {
    if (!isRecord(predicate)) throw new Error(`absence predicate ${index} must be an object`);
    let observed: string[] | undefined;
    let target: string;
    let byPath = false;
    switch (predicate.type) {
      case 'reference_not_read':
        observed = ctx.observed.runtime?.references?.map((entry) => entry.path);
        byPath = true;
        break;
      case 'subagent_not_dispatched':
        observed = ctx.observed.runtime?.subagents?.map((entry) => entry.name);
        break;
      case 'guard_not_fired':
        if (predicate.verdict !== undefined && typeof predicate.verdict !== 'string') {
          throw new Error('guard_not_fired verdict must be a string');
        }
        observed = ctx.observed.runtime?.guards
          ?.filter((entry) => predicate.verdict === undefined || entry.verdict === predicate.verdict)
          .map((entry) => entry.name);
        break;
      case 'stage_not_reached':
        observed = ctx.observed.runtime?.stages?.map((entry) => entry.name);
        break;
      case 'artifact_not_created':
        observed = ctx.observed.workspaceDiff?.created;
        byPath = true;
        break;
      case 'file_not_written': {
        const diff = ctx.observed.workspaceDiff;
        observed = diff ? [...diff.created, ...diff.changed] : undefined;
        byPath = true;
        break;
      }
      default:
        throw new Error(`Unknown estate absence predicate "${String(predicate.type)}"`);
    }
    const value = byPath ? predicate.path : predicate.name;
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`${predicate.type} requires ${byPath ? 'path' : 'name'}`);
    }
    target = value;
    if (observed === undefined) {
      return machineVerdict(
        'absence',
        String(index),
        'inconclusive',
        `${predicate.type}: the adapter did not report the required observation`,
      );
    }
    const matches = observed.filter((entry) =>
      byPath ? globMatches(normalizePath(target), normalizePath(entry)) : entry === target,
    );
    return machineVerdict(
      'absence',
      String(index),
      matches.length === 0 ? 'pass' : 'fail',
      `${predicate.type} ${target}: ${matches.length} matching observations`,
    );
  });
};
