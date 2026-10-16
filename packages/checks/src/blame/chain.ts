import { evidence, type Verdict } from '@agent-nexus/driftbench-core';

/**
 * The chain step (codeagent_equivalence_blame.md E1, step 1): only the root of each chain of failing verdicts is
 * attributed. Failing gating verdicts are read in the order the checks wrote them, which is the order of the acts
 * they check. A later verdict on the same tool, on a tool the block expects after a broken one, on the tool order,
 * or on the same artifact path as an earlier root inherits that root (Who&When's earliest error in time). A tool
 * is broken when its call failed or never happened.
 */

export type ChainLink = { verdict: Verdict; inherits?: string };

/** The artifact path a workspace or artifact verdict is about: the id after its check name. */
function artifactPath(id: string): string | undefined {
  const match = /^(?:artifacts?|workspace)\.(.+)$/.exec(id);
  return match?.[1];
}

export function chainVerdicts(
  verdicts: readonly Verdict[],
  options: {
    /** The tools the block expects, in their expected order. */
    tools?: readonly string[];
    /** Whether a root breaks what comes after it: its tool failed or was not called, or its artifact is wrong. */
    breaks: (verdict: Verdict) => boolean;
    by?: readonly string[];
  },
): ChainLink[] {
  const by = new Set(options.by ?? ['artifact_path', 'tool_output']);
  const order = options.tools ?? [];
  const brokenTools = new Map<string, string>();
  const brokenPaths = new Map<string, string>();
  const out: ChainLink[] = [];
  for (const verdict of verdicts) {
    if (!verdict.gating || verdict.outcome !== 'fail') continue;
    const { tool, part } = evidence.verdictSubject(verdict.id);
    const path = artifactPath(verdict.id);
    let inherits: string | undefined;
    if (by.has('tool_output')) {
      if (tool !== undefined && brokenTools.has(tool)) inherits = brokenTools.get(tool);
      if (inherits === undefined && tool !== undefined) {
        const at = order.indexOf(tool);
        for (const [brokenTool, root] of brokenTools) {
          const before = order.indexOf(brokenTool);
          if (at >= 0 && before >= 0 && before < at) {
            inherits = root;
            break;
          }
        }
      }
      if (inherits === undefined && part === 'order' && brokenTools.size > 0)
        inherits = [...brokenTools.values()][0];
    }
    if (inherits === undefined && by.has('artifact_path') && path !== undefined && brokenPaths.has(path)) {
      inherits = brokenPaths.get(path);
    }
    if (inherits !== undefined) {
      out.push({ verdict, inherits });
      continue;
    }
    out.push({ verdict });
    if (options.breaks(verdict)) {
      if (tool !== undefined) brokenTools.set(tool, verdict.id);
      if (path !== undefined) brokenPaths.set(path, verdict.id);
    }
  }
  return out;
}
