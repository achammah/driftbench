import type { evidence, Spec } from '@agent-nexus/driftbench-core';
import { isRecord } from '../support/values';

/**
 * What a spec states for blame in `metadata`, beside `tool_schemas`: `tool_promises` (what a successful call of a
 * tool prints, by tool label or by a pattern of a command) and `stated_rules` (the rules the prompt, an
 * instruction or a skill states about a tool's input). The loader has checked both; they are read here as the
 * evidence types.
 */

type Metadata = { tool_promises?: unknown; stated_rules?: unknown } | undefined;

/** The promises of a spec, one per tool. */
export function toolPromisesOf(spec: Pick<Spec, 'metadata'> | undefined): evidence.ToolPromise[] {
  const promises = (spec?.metadata as Metadata)?.tool_promises;
  if (!isRecord(promises)) return [];
  return Object.entries(promises).flatMap(([tool, promise]) => {
    if (!isRecord(promise)) return [];
    return [
      {
        tool,
        ...(promise.prints === true ? { prints: true } : {}),
        ...(typeof promise.matches === 'string' ? { matches: promise.matches } : {}),
        ...(typeof promise.from === 'string' ? { from: promise.from } : {}),
      },
    ];
  });
}

/** The stated rules of a spec. */
export function statedRulesOf(spec: Pick<Spec, 'metadata'> | undefined): evidence.StatedRule[] {
  const rules = (spec?.metadata as Metadata)?.stated_rules;
  if (!Array.isArray(rules)) return [];
  return rules.flatMap((rule) => {
    if (!isRecord(rule) || typeof rule.tool !== 'string' || typeof rule.where !== 'string') return [];
    const strings = (value: unknown) =>
      Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : undefined;
    const asks = strings(rule.asks);
    const toolNeeds = strings(rule.tool_needs);
    return [
      {
        tool: rule.tool,
        where: rule.where,
        ...(typeof rule.field === 'string' ? { field: rule.field } : {}),
        ...(typeof rule.format === 'string' ? { format: rule.format } : {}),
        ...(asks === undefined ? {} : { asks }),
        ...(toolNeeds === undefined ? {} : { toolNeeds }),
        ...(typeof rule.recovery === 'string' ? { recovery: rule.recovery } : {}),
        ...(typeof rule.file === 'string' ? { file: rule.file } : {}),
        ...(typeof rule.line === 'number' ? { line: rule.line } : {}),
      },
    ];
  });
}
