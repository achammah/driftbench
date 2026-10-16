import {
  type AttributionSummary,
  assignedRunCounts,
  type ReportDiagnosis,
  unmeasuredText,
} from './attribution';
import type { Rate } from './estimate';
import { esc, interval, pct } from './format';

/**
 * The second score on the scorecard and the run page: the machine pass rate beside the agent-attributed one,
 * the runs no rule attributed shown apart, the fix list, and a badge naming any non-default rule file.
 */

function span(value: Rate | undefined): string {
  return value === undefined ? 'no run' : interval(value, pct);
}

function stat(value: Pick<Rate, 'k' | 'n'> | undefined, label: string, note: string): string {
  const n = value === undefined ? '0' : String(value.k);
  const of = value === undefined ? '0' : String(value.n);
  return `<div class="stat"><p class="n">${n}<small>of ${of}</small></p><span class="l">${esc(label)}</span><p class="s">${esc(note)}</p></div>`;
}

/** The badge a page shows when a non-default rule file scored its runs. Empty with the shipped defaults. */
export function nonDefaultBadge(nonDefault: readonly string[]): string {
  if (nonDefault.length === 0) return '';
  return `<p class="non-default"><span class="badge">non-default</span> Scored with ${esc(nonDefault.join(', '))}.</p>`;
}

/** The zone that opens with the two scores. Empty with no attribution. */
export function attributionZone(summary: AttributionSummary | undefined): string {
  if (summary === undefined) return '';
  const b = summary.blocks;
  const agentNote =
    assignedRunCounts(summary) + ('estimate' in summary.agent ? ` · ${span(summary.agent)}` : '');
  const fixes = summary.fixes.map(
    (fix, index) =>
      `<tr><td class="num">${index + 1}</td><td class="mono">${esc(fix.fixLocation)}</td><td class="mono">${esc(fix.fixTarget ?? '')}</td><td>${esc(fix.fixAction)}</td><td class="num">${fix.blocks}</td><td class="num">${fix.agentBlocks}</td><td>${esc(fix.supersededBy === undefined ? (fix.removeCopies ?? []).join('; ') : `remove: replaced by ${fix.supersededBy}`)}</td><td>${esc(fix.confidence ?? '')}</td></tr>`,
  );
  const fixTable =
    fixes.length === 0
      ? '<p class="muted">Fix list: none.</p>'
      : `<div class="table-wrap"><table>
<caption>Fix list, ranked by the failing blocks each fix explains, the agent's first, then by cost</caption>
<thead><tr><th scope="col">#</th><th scope="col">where</th><th scope="col">target</th><th scope="col">action</th><th scope="col">blocks</th><th scope="col">the agent's</th><th scope="col">copies to remove</th><th scope="col">confidence</th></tr></thead>
<tbody>
${fixes.join('\n')}
</tbody>
</table></div>`;
  return `<section class="zone wrap" id="attribution" aria-labelledby="h-attribution">
<div class="zone-h"><h2 id="h-attribution">Two scores</h2><span class="kicker">The machine verdict stays final; blame says whose failure it is</span></div>
${nonDefaultBadge(summary.nonDefault)}
<div class="stat-row">
${stat(summary.machine, 'Machine pass rate', `runs that passed or failed · ${span(summary.machine)}`)}
${stat(summary.agent, 'Agent-attributed pass rate', `${agentNote} · setup, excluded and credited failures set aside`)}
<div class="stat"><p class="n">${summary.unassigned}<small>${summary.unassigned === 1 ? 'run' : 'runs'}</small></p><span class="l">Unassigned, shown apart</span><p class="s">excluded from the agent-attributed rate; included among the runs that passed or failed in the machine rate</p></div>
</div>
<p class="note">Failing blocks: ${b.failing}. The agent's ${b.agent}, setup ${b.setup}, excluded ${b.excluded}, credited ${b.credited}, unassigned ${b.unassigned}.${esc(unmeasuredText({ ...b, runs: summary.unmeasuredRuns }))}</p>
${fixTable}
</section>`;
}

/** A block's diagnoses on the run page. Empty when the block has none. */
export function diagnosesTable(diagnoses: readonly ReportDiagnosis[] | undefined): string {
  if (diagnoses === undefined || diagnoses.length === 0) return '';
  const rows = diagnoses.map(
    (one) =>
      `<tr><td class="mono">${esc(one.verdictRef ?? '')}${one.inherits === undefined ? '' : `<br><span class="muted">inherits ${esc(one.inherits)}</span>`}</td><td>${esc(one.disposition ?? 'unassigned')}</td><td>${esc((one.fault ?? []).join(', '))}</td><td class="mono">${esc(one.fixLocation ?? '')}</td><td class="mono">${esc(one.fixTarget ?? '')}</td><td>${esc(one.fixAction ?? '')}</td><td class="mono">${esc(one.rule ?? '')}</td><td>${esc(one.confidence ?? '')}</td></tr>`,
  );
  return `<div class="table-wrap"><table>
<caption>Diagnoses: who failed, and where the fix goes (the machine verdict stays final)</caption>
<thead><tr><th scope="col">verdict</th><th scope="col">disposition</th><th scope="col">fault</th><th scope="col">where</th><th scope="col">target</th><th scope="col">action</th><th scope="col">rule</th><th scope="col">confidence</th></tr></thead>
<tbody>
${rows.join('\n')}
</tbody>
</table></div>`;
}
