import { orderedCheck } from '@agent-nexus/driftbench-adapters';
import {
  CheckRegistry,
  type CustomCheckFunction,
  defaultChecks,
  ESTATE_CHECKS,
} from '@agent-nexus/driftbench-checks';
import { machineVerdict, parseSpecText } from '@agent-nexus/driftbench-core';
import { roleOf } from '../../src/ladders/estate/bank/loop';
import { rereadOf } from '../../src/ladders/estate/completion-contract';
import { estateMeta } from '../../src/ladders/estate/levels';
import type * as pipeline from '../../src/ladders/estate/pipeline';

export function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Required fixture value is absent');
  return value;
}

export const SUFFIXES = [
  'guard_negative-guard-reply-length-py',
  'guard_register-guard-read-before-edit-py',
  'guard_register-guard-reply-length-py',
  'hazard_recovery-hazard-after-compaction',
  'journey-route-table',
  'read_when-reference-skill',
  'read_when-reference-standing',
  'skip_pressure-gate-fixed-gate',
  'stage_anytime-stage-anytime',
  'stage_order-stage-anytime',
  'tool_boundary-tool-allow',
  'tool_boundary-tool-declared',
  'tool_boundary-tool-ask',
  'tool_denied-tool-deny',
];

export function suffix(run: pipeline.EstateRun, spec: pipeline.GeneratedSpec): string {
  const atom = run.scanned.map.atoms.find((a) => a.id === estateMeta(spec).atoms?.[0]);
  if (!atom) return '';
  return `${spec.record.testType}|${atom.kind}:${roleOf(run.scanned.match.hidOf.get(atom.id) ?? '')}`
    .replace(/[|:.]+/g, '-')
    .replace(/-+$/, '');
}

/** A deliberately small reference for the two capabilities not yet in the product.
 * It consumes runtime output, never the hidden estate, the item id or a mutant id. */
export const messageReference: CustomCheckFunction = (ctx, options) => {
  // Bounded reference overlay: production already interprets structured output.
  // Treat warning interventions like blocking interventions without changing the evaluator.
  const observed = structuredClone(ctx.observed);
  for (const guard of observed.runtime?.guards ?? []) if (guard.verdict === 'warn') guard.verdict = 'deny';
  return required(ESTATE_CHECKS.guard_message)({ ...ctx, observed }, options);
};
export function permissionReference(requireDecision = true): CustomCheckFunction {
  return async (ctx, options) => {
    const opts = options as { rules: Array<{ effect: string; rule: string }>; block?: number };
    const rules = opts.rules;
    if (rules.every((rule) => rule.effect !== 'ask')) return required(ESTATE_CHECKS.permission)(ctx, options);
    if (opts.block !== undefined && opts.block !== ctx.blockIndex) return [];
    return (
      await Promise.all(
        rules.map(async (rule) => {
          if (rule.effect !== 'ask')
            return required(ESTATE_CHECKS.permission)(ctx, { ...opts, rules: [rule] });
          const raw = ctx.observed.raw as { kept?: Array<{ line: number; record: Record<string, unknown> }> };
          const kept = raw.kept ?? [];
          const requests = kept.filter((r) => r.record.subtype === 'permission_request');
          const prefix = rule.rule.slice(rule.rule.indexOf('(') + 1, -1).replace(/:\*$/, '');
          const calls = ctx.observed.toolCalls.filter(
            (c) =>
              c.label === rule.rule.split('(')[0] &&
              String((c.input as Record<string, unknown>).command).startsWith(prefix),
          );
          const ok =
            calls.length > 0 &&
            calls.every((call) =>
              requests.some((request) => {
                const decision = kept.find(
                  (r) =>
                    r.record.subtype === 'permission_decision' &&
                    r.record.requestId === request.record.requestId &&
                    r.record.decision === 'allow',
                );
                return (
                  request.record.requestId === call.id &&
                  request.record.tool === call.label &&
                  JSON.stringify(request.record.input) === JSON.stringify(call.input) &&
                  (!requireDecision ||
                    (decision &&
                      request.line < decision.line &&
                      String(decision.record.timestamp) < String(call.startedAt)))
                );
              }),
            );
          return machineVerdict(
            'permission',
            'ask',
            ok ? 'pass' : 'fail',
            'a matching runtime grant must precede each protected call',
          );
        }),
      )
    ).flat();
  };
}

export function referenceChecks(requireDecision = true, overrides: Record<string, CustomCheckFunction> = {}) {
  const registry = new CheckRegistry();
  for (const [name, check] of Object.entries(ESTATE_CHECKS)) registry.register(name, check);
  registry.register('ordered', orderedCheck);
  registry.unregister('guard_message');
  registry.register('guard_message', messageReference);
  registry.unregister('permission');
  registry.register('permission', permissionReference(requireDecision));
  for (const [name, check] of Object.entries(overrides)) {
    registry.unregister(name);
    registry.register(name, check);
  }
  return defaultChecks({ registry });
}

/** Reference compilation for path-qualified ordering, declaration ownership and approval.
 * All other expectations, provenance and generated fields remain the real product output. */
export function referenceRun(run: pipeline.EstateRun): pipeline.EstateRun {
  return {
    ...run,
    specs: run.specs.map((source) => {
      const key = suffix(run, source);
      if (!SUFFIXES.includes(key) || !source.loaded) return source;
      const spec = structuredClone(source.loaded.spec);
      // The warning distinction of a negative guard control is the product's own output now: the product forbids every
      // acting verdict, so the reference no longer rewrites it.
      if (key === 'hazard_recovery-hazard-after-compaction') {
        // The reference compile: the reread the passage names, recovered by the same plain reading of the passage.
        const atom = required(run.scanned.map.atoms.find((a) => a.id === estateMeta(source).atoms?.[0]));
        const reread = rereadOf(atom);
        if (reread.length > 0)
          spec.rules = {
            ...spec.rules,
            custom: {
              ...spec.rules?.custom,
              hazard_recovery: { ...(spec.rules?.custom?.hazard_recovery as object), reread, block: 0 },
            },
          };
      }
      if (key === 'skip_pressure-gate-fixed-gate') {
        const atom = required(run.scanned.map.atoms.find((a) => a.id === estateMeta(source).atoms?.[0]));
        spec.rules = {
          ...spec.rules,
          custom: {
            ...spec.rules?.custom,
            ordered: {
              pairs: [{ before: `Read~${atom.fields?.path}`, after: 'Edit' }],
            },
          },
        };
      }
      if (key === 'tool_boundary-tool-ask') {
        const atom = required(run.scanned.map.atoms.find((a) => a.id === estateMeta(source).atoms?.[0]));
        spec.rules = {
          ...spec.rules,
          custom: {
            ...spec.rules?.custom,
            permission: { rules: [{ effect: 'ask', rule: atom.fields?.rule }], block: 0 },
          },
        };
        const meta = spec.metadata?.estate as Record<string, unknown>;
        for (const block of spec.blocks)
          if (block.expect?.criteria)
            block.expect.criteria = block.expect.criteria.filter((c) => c !== 'needs-registered-check');
        meta.needs = [];
        meta.complete = true;
        spec.tags = spec.tags?.filter((t) => !t.startsWith('needs-') && t !== 'incomplete');
      }
      if (key === 'tool_boundary-tool-declared') {
        const atom = required(run.scanned.map.atoms.find((a) => a.id === estateMeta(source).atoms?.[0]));
        const owner = run.scanned.map.atoms.find(
          (a) => ['skill', 'subagent'].includes(a.kind) && a.provenance.file === atom.provenance.file,
        );
        if (owner)
          for (const block of spec.blocks) {
            block.expect ??= {};
            block.expect[owner.kind === 'skill' ? 'skills' : 'subagents'] = [
              { name: String(owner.fields?.name), count: { min: 1 } },
            ];
          }
      }
      const text = JSON.stringify(spec);
      const loaded = parseSpecText(text, 'json');
      if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
      return {
        ...source,
        text,
        loaded,
        record: { ...source.record, complete: true },
        errors: [],
        warnings: loaded.warnings.map((w) => w.message),
      };
    }),
  };
}
