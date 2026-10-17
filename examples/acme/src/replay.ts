import { createStore } from './store';
import { callTool, isToolLabel, type ToolInput, type ToolOutcome } from './tools';

/**
 * The Acme tools as a replayer for the value check of `@agent-nexus/driftbench-checks` (rung 1, the outcome):
 * the real tool on a fresh store, overlaid by the block's seeded store, never a forced result and never a
 * recorded payload. A declaration names the output fields that are a tool's resolved result. The read tools
 * resolve every input; `order.create` resolves only the plan, since the names and emails on an order are kept
 * as given; `notify_sales` resolves nothing and is not declared. The store holds four addresses, three
 * customers, several numbers and six plans, so a same result is no coincidence.
 */

/** One tool's declaration, the shape `ToolDeclaration` of the checks package has. */
export type AcmeToolDeclaration = {
  resolved: readonly string[];
  distractors: true;
  inputs?: readonly string[];
};

export const ACME_TOOL_DECLARATIONS: Readonly<Record<string, AcmeToolDeclaration>> = {
  'coverage.check': { resolved: ['found', 'address_id'], distractors: true },
  'port.check': { resolved: ['number', 'eligible'], distractors: true },
  'catalog.search': { resolved: ['customer.id', 'plans'], distractors: true },
  'order.create': { resolved: ['plan_id', 'monthly_usd'], distractors: true, inputs: ['type', 'plan_id'] },
};

/** One replayed call, as a spy records it. */
export type ReplayedCall = { tool: string; input: ToolInput };

/** The replayer, the shape `ToolReplayer` of the checks package has. `log` records every replayed call. */
export function acmeReplayer(log: ReplayedCall[] = []) {
  return {
    declaration: (tool: string): AcmeToolDeclaration | undefined => ACME_TOOL_DECLARATIONS[tool],
    call(tool: string, input: ToolInput, world: Readonly<Record<string, unknown>> | undefined): ToolOutcome {
      log.push({ tool, input: structuredClone(input) });
      if (!isToolLabel(tool)) return { ok: false, error: `${tool} is not an Acme tool` };
      return callTool(tool, input, {
        store: createStore(),
        ...(world === undefined ? {} : { seed: world as Record<string, unknown> }),
        commit: false,
      });
    },
  };
}
