import { blockStatus, type RunResult } from '@agent-nexus/driftbench-core';
import { esc } from './format';

/** A failed or unrun cause counted once, with all children that it prevented from running. */
export function parentCauses(
  run: RunResult,
): { root: string; status: 'fail' | 'not_run'; blocked: string[] }[] {
  const causes = run.blocks.filter(
    (block) => blockStatus(block) === 'fail' || blockStatus(block) === 'not_run',
  );
  return causes.map((block) => {
    const root = block.blockId ?? `block ${block.index}`;
    return {
      root,
      status: blockStatus(block) as 'fail' | 'not_run',
      blocked: run.blocks
        .filter((child) => child.blocked?.root === root)
        .map((child) => child.blockId ?? `block ${child.index}`),
    };
  });
}

/** Shared by the scorecard drawer and the standalone run page. */
export function parentCausesHtml(causes: ReturnType<typeof parentCauses> | undefined): string {
  if (causes === undefined) return '';
  return `<h3>Causes: ${causes.filter((cause) => cause.status === 'fail').length} failed, ${causes.filter((cause) => cause.status === 'not_run').length} not run</h3><ul>${causes.map((cause) => `<li>${esc(cause.root)}: ${esc(cause.status)}${cause.blocked.length ? `<ul>${cause.blocked.map((child) => `<li>${esc(child)}: blocked</li>`).join('')}</ul>` : ''}</li>`).join('')}</ul>`;
}
