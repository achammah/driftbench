import type { BlockStatus, HistoryNormalization } from '@agent-nexus/driftbench-core';
import type { CarriedSummary } from './data';
import type { Estimate } from './estimate';
import type { SuiteHeadline } from './headline';

/** One compact line per block; the observation and JSON drilldown retain the per-index records. */
export function historyNormalizationsText(entries: readonly HistoryNormalization[] | undefined): string {
  const counts = new Map<string, number>();
  for (const entry of entries ?? []) counts.set(entry.wire, (counts.get(entry.wire) ?? 0) + 1);
  return [...counts]
    .map(([wire, count]) => `${count} empty ${count === 1 ? 'turn' : 'turns'} not sent on ${wire}`)
    .join('; ');
}

/** No markup when absent, so legacy reports retain their exact bytes. */
export function historyNormalizationsHtml(entries: readonly HistoryNormalization[] | undefined): string {
  const summary = historyNormalizationsText(entries);
  return summary === '' ? '' : `<p class="history-normalization">${esc(summary)}</p>`;
}

/** Escapes text for HTML element content and attribute values. */
export function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A proportion as a percentage with one decimal: 0.926 gives 92.6%. */
export function pct(value: number): string {
  return `${fixed(value * 100, 1)}%`;
}

/** A difference of two proportions in points, signed: 0.05 gives +5.0. */
export function points(value: number): string {
  const text = fixed(value * 100, 1);
  return value > 0 && text !== '0.0' ? `+${text}` : text;
}

/** A number with fixed decimals, never `-0`. */
export function fixed(value: number, digits: number): string {
  const text = value.toFixed(digits);
  return /^-0\.?0*$/.test(text) ? text.slice(1) : text;
}

/** A p-value: four decimals, or `< 0.0001`. */
export function pValue(value: number): string {
  return value < 0.0001 ? '< 0.0001' : fixed(value, 4);
}

/** US dollars: four decimals under a cent, else two. */
export function usd(value: number): string {
  return `$${value > 0 && value < 0.01 ? value.toFixed(4) : value.toFixed(2)}`;
}

/** The interval of an estimate as text, in the unit `show` writes. A `none` interval says why it is missing. */
export function interval(estimate: Estimate, show: (value: number) => string): string {
  if (estimate.method === 'none') return 'no interval: one cluster';
  return `[${show(estimate.lower)}, ${show(estimate.upper)}]`;
}

/** The independent units a clustered rate is worth, as text: `n_eff 12.3 (design effect 2.41)`; empty when it has none. */
export function effectiveNote(estimate: Estimate): string {
  if (estimate.effectiveN === undefined || estimate.designEffect === undefined) return '';
  return `n_eff ${fixed(estimate.effectiveN, 1)} (design effect ${fixed(estimate.designEffect, 2)})`;
}

/**
 * What stands behind a suite headline, as text: the goldens, the effective runs, the drop two suites like it
 * could detect, and the shares of runs that gave no verdict (only those above 0).
 */
export function headlineNote(headline: SuiteHeadline): string {
  const parts = [`${count(headline.trees, headline.unit ? 'parent tree' : 'golden')}`];
  if (headline.trees > 1) {
    parts.push(
      headline.degenerate
        ? `n_eff ${fixed(headline.effectiveRuns, 1)} ${headline.unit ? 'tree outcomes' : 'runs'} (every ${headline.unit ? 'tree outcome' : 'run'} agrees, so each ${headline.unit ? 'parent tree' : 'golden'} counts once)`
        : `n_eff ${fixed(headline.effectiveRuns, 1)} ${headline.unit ? 'tree outcomes' : 'runs'} (design effect ${fixed(headline.designEffect, 2)})`,
    );
    parts.push(
      headline.detectableDrop === null
        ? 'no drop detectable at 80% power'
        : `detectable drop ${fixed(headline.detectableDrop * 100, 1)} points at 80% power`,
    );
  }
  const { incomplete, blocked, notRun } = headline.shares;
  if (incomplete > 0) parts.push(`${pct(incomplete)} did not complete`);
  if (blocked > 0) parts.push(`${pct(blocked)} blocked`);
  if (notRun > 0) parts.push(`${pct(notRun)} not run`);
  return parts.join(', ');
}

/** Singular or plural: `1 run`, `3 runs`. */
export function count(n: number, noun: string, plural = `${noun}s`): string {
  return `${n} ${n === 1 ? noun : plural}`;
}

/** JSON for a drilldown, cut to a readable length. */
export function json(value: unknown, limit = 3000): string {
  const text = JSON.stringify(value, null, 2) ?? 'undefined';
  return text.length > limit ? `${text.slice(0, limit)}\n... (${text.length - limit} more characters)` : text;
}

/**
 * The lines that say a campaign merges fresh and carried results, and from which agent version the
 * carried ones come when it is not the version the campaign runs. Empty when every run is fresh.
 */
export function carriedLines(summary: CarriedSummary | undefined): string[] {
  if (!summary) return [];
  const runs = (n: number) => `${n} ${n === 1 ? 'run' : 'runs'}`;
  const lines = [
    summary.rescoredRuns
      ? `Fresh and reused observations are merged: ${runs(summary.fresh)} fresh, ${runs(summary.rescoredRuns)} re-scored, ${runs(summary.carried - summary.rescoredRuns)} carried. Every rate over this campaign counts all three.`
      : `Fresh and carried results are merged: ${runs(summary.fresh)} fresh, ${runs(summary.carried)} carried. Every rate over this campaign counts both.`,
  ];
  for (const source of summary.sources) {
    const other =
      source.agentVersion === undefined
        ? 'an agent version nothing names'
        : summary.versions.includes(source.agentVersion)
          ? `the same agent version, ${source.agentVersion}`
          : `another agent version, ${source.agentVersion}${summary.versions.length > 0 ? ` (this campaign runs ${summary.versions.join(', ')})` : ''}`;
    const campaigns = `${source.maxCampaigns} ${source.maxCampaigns === 1 ? 'campaign' : 'campaigns'}`;
    const carried = source.runs - (source.rescoredRuns ?? 0);
    if (carried > 0)
      lines.push(
        `  ${runs(carried)} carried from ${source.campaign}, measured on ${other}; oldest: ${campaigns}, ${source.maxDays.toFixed(1)} days.`,
      );
    if (source.rescoredRuns)
      lines.push(
        `  ${runs(source.rescoredRuns)} re-scored; observations measured in ${source.campaign} on ${other}; oldest: ${campaigns}, ${source.maxDays.toFixed(1)} days.`,
      );
  }
  for (const source of summary.rescored ?? [])
    lines.push(
      `Re-scored; observations from ${source.campaign}. ${count(source.blocks, 'block')} re-scored.`,
    );
  return lines;
}

/**
 * The runs neither passed nor failed, as they follow the fail count: `2 not run, 1 blocked, `, each part
 * only when above 0, the separator after each; the empty string when there is none.
 */
export function unscoredRuns(counts: { notRun?: number; blocked?: number }, separator = ', '): string {
  const parts = [
    ...(counts.notRun ? [`${counts.notRun} not run`] : []),
    ...(counts.blocked ? [`${counts.blocked} blocked`] : []),
  ];
  return parts.map((part) => `${part}${separator}`).join('');
}

/**
 * The verdict a run or a block shows: pass, fail, or one of the two that are neither. A block's status comes
 * from `blockStatus`, a run's from `runDetailStatus`, never from a run's own `status` (completed, failed).
 */
export function verdictOf(status: BlockStatus): { cls: 'ok' | 'bad' | 'skip'; text: string } {
  if (status === 'not_run') return { cls: 'skip', text: 'not run' };
  if (status === 'blocked') return { cls: 'skip', text: 'blocked' };
  return status === 'pass' ? { cls: 'ok', text: 'pass' } : { cls: 'bad', text: 'fail' };
}

/** The verdict of a run of the scorecard: its outcome when it was not run or blocked, else pass or fail. */
export function runDetailStatus(run: { pass: boolean; outcome?: 'not_run' | 'blocked' }): BlockStatus {
  return run.outcome ?? (run.pass ? 'pass' : 'fail');
}

/** Why a block was not run or blocked, in one sentence; undefined for a block that ran. */
export function unscoredReason(block: {
  notRun?: { kind: string; layer: string; check: string; expected: string; got: string };
  blocked?: { by: string; root: string; reason?: string };
}): string | undefined {
  if (block.notRun) {
    const n = block.notRun;
    return `Not run (${n.kind}, check ${n.check}, layer ${n.layer}): expected ${n.expected}; got ${n.got}.`;
  }
  if (block.blocked) {
    const b = block.blocked;
    return `Blocked by ${b.by} (root ${b.root})${b.reason ? `: ${b.reason}` : ''}.`;
  }
  return undefined;
}
