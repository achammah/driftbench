import { type CompareResult, PLANNING_MARGIN, PLANNING_POWER } from './compare';
import { carriedLines, count, fixed, headlineNote, interval, pct, points, pValue } from './format';
import type { SuiteHeadline } from './headline';
import type { CriterionRepeat } from './repeats';

/** Pads every column but the last to its widest cell, two spaces apart, indented by two. */
export function textTable(rows: readonly string[][]): string[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, cell.length);
    });
  }
  return rows.map((row) =>
    `  ${row.map((cell, index) => (index === row.length - 1 ? cell : cell.padEnd(widths[index] ?? 0))).join('  ')}`.trimEnd(),
  );
}

const VERDICT: Record<CompareResult['verdict'], string> = {
  'non-inferior': 'NON-INFERIOR',
  regressed: 'REGRESSED',
  unproven: 'NOT SHOWN NON-INFERIOR',
};

/** The comparison as plain text, the way `driftbench compare` prints it. */
export function compareText(result: CompareResult): string {
  const lines: string[] = [];
  const all = result.allPass;
  const t = all.table;
  lines.push(
    `Baseline ${result.baseline.campaignId} (${result.baseline.targets.join(', ')}) against candidate ${result.candidate.campaignId} (${result.candidate.targets.join(', ')}).`,
    `Paired: ${count(result.pairs.length, 'golden')} (one golden in one mode, one perturbation in P), modes ${result.modes.join(', ')}; ${count(result.unpaired.length, 'golden')} not paired. Margin ${fixed(result.margin * 100, 1)} points.`,
    '',
    'All repeats pass, per golden:',
    ...textTable([
      ['side', 'passing', 'rate', '95% interval'],
      [
        'baseline',
        `${all.baseline.k} of ${all.baseline.n}`,
        pct(all.baseline.estimate),
        interval(all.baseline, pct),
      ],
      [
        'candidate',
        `${all.candidate.k} of ${all.candidate.n}`,
        pct(all.candidate.estimate),
        interval(all.candidate, pct),
      ],
    ]),
    `  Both pass ${t.bothPass}, regressed ${t.regressed}, improved ${t.improved}, both fail ${t.bothFail}. McNemar exact p = ${pValue(all.mcnemar.pValue)}.`,
    `  Effect, baseline minus candidate: ${points(all.effect.estimate)} points, interval ${interval(all.effect, points)} (Newcombe, paired).`,
    `  Planning: ${count(result.pairs.length, 'golden')} can show a margin of ${fixed(all.floor * 100, 1)} points at best; they detect a drop of ${detectable(all.detectable)} at ${fixed(PLANNING_POWER * 100, 0)}% power; a ${fixed(PLANNING_MARGIN * 100, 0)} point margin needs ${count(all.goldensFor10, 'golden')}.`,
    `Drift count per golden (mean over repeats): baseline ${fixed(result.drift.baselineMean, 2)}, candidate ${fixed(result.drift.candidateMean, 2)}; Wilcoxon signed-rank p = ${pValue(result.drift.wilcoxon.pValue)} (${result.drift.wilcoxon.method}, ${count(result.drift.wilcoxon.n, 'golden')} differ).`,
    '',
    `Criteria: McNemar exact per criterion, Benjamini-Hochberg across ${count(result.criteria.length, 'criterion', 'criteria')} at q ${fixed(result.q, 2)}. Effect in points, baseline minus candidate. A gating criterion on fewer than ${result.minGoldens} goldens is underpowered${result.strict ? ', and gates anyway (--strict)' : ' and left out of the parity test'}. Floor: the smallest margin its goldens can show; drop seen: the smallest drop they detect at ${fixed(PLANNING_POWER * 100, 0)}% power; for ${fixed(PLANNING_MARGIN * 100, 0)}: the goldens a ${fixed(PLANNING_MARGIN * 100, 0)} point margin needs.`,
    ...textTable([
      [
        'criterion',
        'gating',
        'goldens',
        'regressed',
        'improved',
        'p',
        'q',
        'effect',
        'interval',
        'margin',
        'floor',
        'drop seen',
        `for ${fixed(PLANNING_MARGIN * 100, 0)}`,
        'verdict',
      ],
      ...result.criteria.map((row) => [
        row.criterion,
        row.gating ? 'yes' : 'no',
        String(row.units),
        String(row.regressed),
        String(row.improved),
        pValue(row.pValue),
        pValue(row.adjusted),
        points(row.effect.estimate),
        interval(row.effect, points),
        row.gating ? (row.nonInferior ? 'within' : row.underpowered ? 'underpowered' : 'not within') : '',
        fixed(row.floor * 100, 1),
        detectable(row.detectable),
        String(row.goldensFor10),
        row.significantRegression ? 'regressed' : '',
      ]),
    ]),
  );
  if (result.newFlags.length > 0) {
    lines.push('', `New gating flags (${result.flagFamilies.join(', ')}), firing for the candidate only:`);
    lines.push(
      ...textTable([['golden', 'family'], ...result.newFlags.map((flag) => [flag.unit, flag.family])]),
    );
  }
  if (result.carried) {
    lines.push(
      '',
      `Carried, not paired: ${count(result.carried.carried, 'run')} of the candidate are results copied from an earlier campaign. The tests above read the ${count(result.carried.fresh, 'fresh run')} only.`,
      ...carriedLines(result.carried).slice(1),
    );
  }
  if (result.unpaired.length > 0) {
    lines.push('', 'Not paired:');
    lines.push(...textTable(result.unpaired.map((entry) => [entry.unit, entry.reason])));
  }
  if (result.excluded) {
    lines.push('', 'Runs left out of a pair (a block not run or blocked, no failure):');
    lines.push(
      ...textTable(result.excluded.map((entry) => [entry.unit, entry.side, count(entry.runs, 'run')])),
    );
  }
  lines.push('', `Verdict: ${VERDICT[result.verdict]}.`);
  for (const reason of result.reasons) lines.push(`  ${reason}`);
  return `${lines.join('\n')}\n`;
}

function detectable(value: number | null): string {
  return value === null ? 'none' : `${fixed(value * 100, 1)} points`;
}

/** One line per reduced criterion, for the command line: the criterion, its line and the reduced verdict. */
export function criterionRepeatsText(lines: readonly CriterionRepeat[]): string[] {
  return lines.map((line) => {
    const outcomes = line.outcomes
      .map((outcome) => (outcome === 1 ? 'P' : outcome === 0 ? 'F' : '-'))
      .join(' ');
    const verdict = line.verdict === 1 ? 'pass' : line.verdict === 0 ? 'fail' : 'undecided';
    return `Criterion ${line.criterion} (${line.specId}, mode ${line.mode}): ${line.reducer} over ${line.outcomes.length} repeats, ${verdict} (${outcomes}).`;
  });
}

/**
 * The suite headline of one mode as a line for the command line: the mean over goldens, its interval and the
 * method, then what stands behind it (see headlineNote).
 */
export function headlineText(mode: string, headline: SuiteHeadline): string {
  const method =
    headline.method === 'hierarchical'
      ? 'hierarchical 95% interval'
      : headline.unit
        ? 'one parent tree'
        : 'one golden';
  return `Suite pass rate, mode ${mode}: ${pct(headline.estimate)} ${interval(headline, pct)} (${method}); ${headlineNote(headline)}.`;
}
