/** The run order of the generated specs and the summary printed after estate generate. */

import {
  ESTATE_ORDER_FILE,
  type EstateReport,
  type EstateSpecRecord,
  PRIORITY_KINDS,
  type Totals,
} from './generate-types';
import type { EstateAtom } from './inputs';
import { STATIC_DIR } from './static';
import { UNIT_DIR } from './unit';

/**
 * The complete specs in the order to run them: rows naming a focus atom (in the order of the focus list),
 * then rows naming a guard, a gate or an invariant, then the rest, each group in generation order.
 */
export function runOrder(
  records: readonly EstateSpecRecord[],
  atoms: ReadonlyMap<string, EstateAtom>,
  focus: readonly string[],
): string[] {
  const done = records.filter((record) => record.complete && !record.path.startsWith(`${STATIC_DIR}/`));
  const rank = (record: EstateSpecRecord): number => {
    const hit = focus.findIndex((atom) => record.atoms.includes(atom));
    if (hit >= 0) return hit;
    const kinds = record.atoms.map((id) => atoms.get(id)?.kind ?? '');
    const kind = PRIORITY_KINDS.findIndex((candidate) => kinds.includes(candidate));
    return kind >= 0 ? focus.length + kind : focus.length + PRIORITY_KINDS.length;
  };
  return done
    .map((record, index) => ({ record, index, rank: rank(record) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ record }) => record.path);
}

export function sortedKeys<T>(table: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(table).sort(([a], [b]) => a.localeCompare(b)));
}

export function ordered(totals: Record<string, Totals>, order: readonly string[]): Record<string, Totals> {
  const out: Record<string, Totals> = {};
  for (const key of order) if (totals[key]) out[key] = totals[key];
  for (const key of Object.keys(totals).sort()) if (!out[key]) out[key] = totals[key] as Totals;
  return out;
}

/** The summary the command prints. */
export function renderEstateSummary(report: EstateReport): string {
  const lines = [
    `Map ${report.map.path} (${report.map.runtime}), hash ${report.map.hash.slice(0, 12)}: ${report.map.atoms} atoms.`,
    `Plan ${report.plan.path}: ${report.plan.rows} rows, ${report.plan.approved} approved, ${report.plan.proposed} waiting, ${report.plan.struck} struck.`,
    `Phrases ${report.phrases.path}: ${report.phrases.situations} situations, ${report.phrases.phrases} approved phrases.`,
    report.sessions
      ? `Sessions ${report.sessions.path}: ${report.sessions.sessions}.`
      : 'Sessions: none given, so replay rows wait for a recorded session.',
    `Seed ${report.options.seed}; custom checks the runner registers: ${report.options.checks.join(', ') || 'none'}.`,
    '',
    `${'Test type'.padEnd(18)}${'rows'.padStart(6)}${'specs'.padStart(7)}${'complete'.padStart(10)}${'incomplete'.padStart(12)}`,
  ];
  for (const [type, totals] of Object.entries(report.perTestType)) {
    lines.push(
      `${type.padEnd(18)}${String(totals.rows).padStart(6)}${String(totals.specs).padStart(7)}${String(totals.complete).padStart(10)}${String(totals.incomplete).padStart(12)}`,
    );
  }
  lines.push(
    `${'total'.padEnd(18)}${''.padStart(6)}${String(report.summary.specs).padStart(7)}${String(report.summary.complete).padStart(10)}${String(report.summary.incomplete).padStart(12)}`,
    '',
  );
  const { asks, outcomes, judged: judgedSpecs } = report.sources;
  lines.push(
    `Asks of the complete specs: ${asks.bank} approved phrases, ${asks.code} written by code, ${asks.session} recorded sessions, ${asks.none} with no ask.`,
    `Judged by a criterion from the rule's own words (no code checks it): ${judgedSpecs} complete specs.`,
    `Outcomes of the complete specs: ${
      Object.entries(outcomes)
        .map(([source, count]) => `${count} ${source}`)
        .join(', ') || 'none'
    }.`,
  );
  if (report.focus) {
    const empty = report.focus.perAtom.filter((entry) => entry.complete === 0);
    lines.push(
      `Focus: ${report.focus.complete} complete specs name one of the ${report.focus.atoms} focus atoms; ${empty.length} focus atom${empty.length === 1 ? ' has' : 's have'} none.`,
    );
    for (const entry of empty) {
      lines.push(
        `  ${entry.atom}: ${entry.incomplete === 0 ? 'no plan row' : `${entry.incomplete} incomplete (${entry.markers.join(', ')})`}`,
      );
    }
  }
  lines.push(
    `Run order: ${ESTATE_ORDER_FILE} lists the complete specs, focus atoms first, then guards, gates and invariants.`,
  );
  const statics = (report.perTestType.invariant?.complete ?? 0) + (report.perTestType.setting?.complete ?? 0);
  if (statics > 0) {
    lines.push(
      `Static tests: ${statics} in ${STATIC_DIR}/ (invariants and settings), run by driftbench estate static on an estate root.`,
    );
  }
  if (report.unit.tests > 0) {
    lines.push(
      `Unit tests: ${report.unit.tests} in ${UNIT_DIR}/ (${report.unit.guards} guards, ${report.unit.scripts} scripts, ${report.unit.helpers} helpers, ${report.unit.cases} cases), run by driftbench estate unit: --record on the original first, then on any copy.`,
      `Catalogue checks: ${report.unit.checks.tested} tested through their host hook, ${report.unit.checks.needsTrigger} need a trigger, ${report.unit.checks.needsHost} need a host hook.`,
    );
  }
  if (report.gaps.length > 0) {
    lines.push('Gaps (what keeps a spec incomplete):');
    for (const entry of report.gaps) {
      lines.push(`  ${entry.marker.padEnd(26)} ${entry.specs} spec${entry.specs === 1 ? '' : 's'}`);
    }
  }
  if (report.replay.length > 0) {
    const fail = report.replay.filter((entry) => entry.expect === 'fail').length;
    lines.push(
      `Replay: ${report.replay.length} specs aligned to sessions, ${report.replay.length - fail} planned to pass, ${fail} to fail.`,
    );
  }
  if (report.waiting.length > 0) lines.push(`Waiting for approval: ${report.waiting.length} rows.`);
  if (report.invalid.length > 0) lines.push(`Invalid specs (a generator defect): ${report.invalid.length}.`);
  if (report.lint.length > 0)
    lines.push(`Specs with lint warnings (a generator defect): ${report.lint.length}.`);
  return `${lines.join('\n')}\n`;
}

export function totalsFor(table: Record<string, Totals>, key: string): Totals {
  const known = table[key];
  if (known) return known;
  const fresh = { rows: 0, specs: 0, complete: 0, incomplete: 0 };
  table[key] = fresh;
  return fresh;
}
