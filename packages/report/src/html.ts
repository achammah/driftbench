import { blockStatus, type DriftClass, type RunEvent, type Verdict } from '@agent-nexus/driftbench-core';
import { parentCausesHtml } from './causes';
import type { CompareResult } from './compare';
import type { Estimate } from './estimate';
import { CASLON_DISPLAY, CASLON_TEXT, GEIST, GEIST_MONO } from './fonts';
import {
  carriedLines,
  count,
  effectiveNote,
  esc,
  fixed,
  headlineNote,
  historyNormalizationsHtml,
  interval,
  json,
  pct,
  points,
  pValue,
  runDetailStatus,
  unscoredReason,
  unscoredRuns,
  usd,
  verdictOf,
} from './format';
import type { SuiteHeadline } from './headline';
import { chartsZone, overview, pageModel, runsZone, testsZone, versionsZone } from './html-zones';
import type { PilotReport } from './pilot';
import type { RecoverySummary, ReliabilityLine } from './reliability';
import type { CriterionRepeat } from './repeats';
import { type BlockDetail, notStored, type RunDetail, type Scorecard, type StoppedRun } from './scorecard';
import type { CellSpread, Spread } from './spread';

const DRIFT_NAMES: Record<DriftClass, string> = {
  X1_local: 'X1 local error',
  X2_contradiction: 'X2 contradiction',
  X3_flow: 'X3 flow drift',
  X4_format: 'X4 format or persona',
  X5_tool: 'X5 tool drift',
};

/**
 * The scorecard as one HTML file: inline styles and fonts, no script, no external asset, dark by default with a
 * light theme one click away. Three zones open it: the numbers and charts, the tests, the runs with a panel per
 * run. Every detailed table follows, folded. The same scorecard gives the same bytes.
 */
export function renderHtml(card: Scorecard, options: RenderOptions = {}): string {
  const c = card.campaign;
  const m = pageModel(card);
  const details = [
    header(card),
    summary(card),
    card.compare ? compareSection(card.compare) : '',
    reliabilitySection(card.lines),
    repeatsSection(card.criterionRepeats),
    successionSection(card),
    compoundingSection(card),
    recoverySection(card),
    spreadSection(card.spread),
    card.pilot ? pilotSection(card.pilot) : '',
    drilldownIndex(card, options),
    methodSection(),
  ].filter((section) => section !== '');
  const sections = [
    options.nav ?? '',
    overview(m),
    versionsZone(m),
    chartsZone(m),
    testsZone(m),
    runsZone(m, {
      ...(options.runHref ? { runHref: options.runHref } : {}),
      verdictTable: (rows) =>
        table(
          'Verdicts with evidence: every one that did not pass, every judged one',
          ['outcome', 'verdict', 'kind', 'gating', 'evidence', 'judge reasoning'],
          rows.map(verdictRow),
        ),
      stopped: (run) => stoppedSection(run.stopped),
    }),
    `<section class="zone wrap" id="details" aria-labelledby="h-details">
<div class="zone-h"><h2 id="h-details">All details</h2><span class="kicker">Every table behind the numbers</span></div>
${details
  .map(
    (section) => `<details class="more"><summary>${esc(sectionName(section))}</summary>
${section}
</details>`,
  )
  .join('\n')}
</section>`,
  ];
  return renderPage(`Scorecard ${c.campaignId}`, sections);
}

/** The heading of a detailed section, for the fold that holds it. */
function sectionName(section: string): string {
  const heading = /<h2[^>]*>([^<]*)<\/h2>/.exec(section)?.[1];
  if (heading) return heading.replace(/&amp;/g, '&');
  if (section.startsWith('<header>')) return 'Campaign';
  return /<caption>([^<]*)<\/caption>/.exec(section)?.[1] ?? 'Details';
}

/** How a page links out, for a server that serves the scorecard: the viewer of `driftbench view`. */
export type RenderOptions = {
  /** HTML placed first in the page, such as a navigation bar. */
  nav?: string;
  /** The address of a run's own page; each run in the drilldown then links to it. */
  runHref?: (runId: string) => string;
};

/**
 * A page of sections with the scorecard's style: one file, no script, no external asset. Dark by default; the
 * checkbox first in the page switches to the light theme.
 */
export function renderPage(title: string, sections: readonly string[]): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="driftbench report">
<title>${esc(title)}</title>
<style>${FONTS}${STYLE}</style>
</head>
<body>
<input type="checkbox" id="theme-light" class="theme-input" aria-label="Light theme">
<main>
${sections.filter((section) => section !== '').join('\n')}
</main>
</body>
</html>
`;
}

function header(card: Scorecard): string {
  const c = card.campaign;
  const repeats = c.modes.map((mode) => `${mode} ${c.repeats[mode]}`).join(', ');
  return `<header>
<h2>Campaign facts</h2>
<p class="mono">${esc(c.campaignId)}</p>
<dl class="facts">
${fact('Created', c.createdAt)}
${fact('Targets', c.targets.join(', ') || 'none')}
${fact('Modes', c.modes.join(', '))}
${fact('Repeats', repeats)}
${fact('Specs', String(c.specs))}
${fact('Runs', `${c.runs}: ${c.passing} pass, ${c.failing} fail, ${unscoredRuns(c)}${c.broken} did not complete`)}
${fact('Spent', usd(card.cost.totalUsd))}
</dl>
</header>`;
}

function fact(label: string, value: string): string {
  return `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
}

function summary(card: Scorecard): string {
  const tiles: string[] = [];
  for (const mode of card.modes) {
    if (mode.headline) {
      tiles.push(tile(`Suite pass rate, ${mode.mode}`, mode.headline, pct, headlineNote(mode.headline)));
    }
    if (mode.runPass) tiles.push(tile(`Runs passing, ${mode.mode}`, mode.runPass, pct, `${mode.runs} runs`));
    if (mode.blockAccuracy)
      tiles.push(tile(`Block accuracy, ${mode.mode}`, mode.blockAccuracy, pct, 'blocks'));
  }
  if (card.endState)
    tiles.push(tile('End state match', card.endState, pct, `${card.endState.n} runs compared`));
  if (card.tools.f1) {
    tiles.push(
      tile(
        'Tool F1',
        card.tools.f1,
        pct,
        `${card.tools.matched} of ${card.tools.expected} expected calls made`,
      ),
    );
  }
  if (card.recovery?.immediate) {
    tiles.push(
      tile('Immediate recovery', card.recovery.immediate, pct, `${card.recovery.measured} injections`),
    );
  }
  const overall = card.compounding.overall;
  if (overall?.interval) {
    tiles.push(
      tile(
        'Compounding index',
        { ...overall.interval, estimate: overall.index, method: 'cluster bootstrap', n: overall.blocks },
        points,
        'T minus F, points',
      ),
    );
  }
  if (card.cost.perBlockUsd) tiles.push(tile('Cost per block', card.cost.perBlockUsd, usd, 'US dollars'));
  if (card.cost.latencyMsPerBlock) {
    tiles.push(
      tile('Latency per block', card.cost.latencyMsPerBlock, (v) => `${fixed(v, 0)} ms`, 'milliseconds'),
    );
  }
  const verdict = card.compare ? verdictBanner(card.compare) : '';
  // A campaign that carried results says so above every rate: the rates below merge fresh and carried.
  const merged = carriedLines(card.carried)
    .map((line) => `<p class="note">${esc(line.trim())}</p>`)
    .join('\n');
  return `<section id="summary">
<h2>Summary</h2>
${verdict}${merged === '' ? '' : `\n${merged}`}
<div class="tiles">
${tiles.join('\n')}
</div>
</section>`;
}

function tile(label: string, estimate: Estimate, show: (value: number) => string, note: string): string {
  return `<div class="tile">
<p class="tile-label">${esc(label)}</p>
<p class="tile-value">${esc(show(estimate.estimate))}</p>
<p class="tile-ci">${esc(interval(estimate, show))}</p>
<p class="tile-note">${esc(note)}</p>
</div>`;
}

function verdictBanner(compare: CompareResult): string {
  const label =
    compare.verdict === 'non-inferior'
      ? 'Non-inferior'
      : compare.verdict === 'regressed'
        ? 'Regressed'
        : 'Not shown non-inferior';
  return `<div class="verdict verdict-${compare.verdict}">
<p class="verdict-label">${esc(label)}</p>
<p>Candidate ${esc(compare.candidate.campaignId)} against baseline ${esc(compare.baseline.campaignId)}, margin ${esc(fixed(compare.margin * 100, 1))} points, ${count(compare.pairs.length, 'paired golden')}.</p>
</div>`;
}

/** A rate cell: the value, its interval, and a bar drawn to scale on [0, 1]. */
function rateCell(estimate: Estimate | undefined): string {
  if (!estimate) return '<td class="num muted">none</td>';
  const effective = effectiveNote(estimate);
  return `<td class="num"><span class="val">${esc(pct(estimate.estimate))}</span> <span class="ci">${esc(interval(estimate, pct))}</span>${effective === '' ? '' : ` <span class="ci">${esc(effective)}</span>`}${bar(estimate)}</td>`;
}

/** A suite headline cell: the mean over goldens, its hierarchical interval, and what stands behind it. */
function headlineCell(headline: SuiteHeadline | undefined): string {
  if (!headline) return '<td class="num muted">none</td>';
  return `<td class="num"><span class="val">${esc(pct(headline.estimate))}</span> <span class="ci">${esc(interval(headline, pct))}</span> <span class="ci">${esc(headlineNote(headline))}</span>${bar(headline)}</td>`;
}

function bar(estimate: Estimate): string {
  const x = (value: number) => fixed(Math.max(0, Math.min(1, value)) * 100, 1);
  const lower = estimate.method === 'none' ? estimate.estimate : estimate.lower;
  const upper = estimate.method === 'none' ? estimate.estimate : estimate.upper;
  return `<svg class="bar" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"><rect class="bar-track" x="0" y="2" width="100" height="2"/><rect class="bar-ci" x="${x(lower)}" y="1" width="${fixed(Math.max(0.6, (upper - lower) * 100), 1)}" height="4"/><rect class="bar-pt" x="${x(estimate.estimate)}" y="0" width="0.8" height="6"/></svg>`;
}

function numCell(text: string, extra = ''): string {
  return `<td class="num${extra ? ` ${extra}` : ''}">${esc(text)}</td>`;
}

function textCell(text: string, extra = ''): string {
  return `<td${extra ? ` class="${extra}"` : ''}>${esc(text)}</td>`;
}

function table(caption: string, head: string[], rows: string[], note = ''): string {
  if (rows.length === 0) return `<p class="muted">${esc(caption)}: none.</p>`;
  return `<div class="table-wrap"><table>
<caption>${esc(caption)}</caption>
<thead><tr>${head.map((cell) => `<th scope="col">${esc(cell)}</th>`).join('')}</tr></thead>
<tbody>
${rows.join('\n')}
</tbody>
</table></div>${note ? `\n<p class="note">${esc(note)}</p>` : ''}`;
}

function compareSection(compare: CompareResult): string {
  const all = compare.allPass;
  const allRows = [
    `<tr>${textCell('baseline')}${textCell(compare.baseline.campaignId, 'mono')}${rateCell(all.baseline)}${numCell(`${all.baseline.k} of ${all.baseline.n}`)}</tr>`,
    `<tr>${textCell('candidate')}${textCell(compare.candidate.campaignId, 'mono')}${rateCell(all.candidate)}${numCell(`${all.candidate.k} of ${all.candidate.n}`)}</tr>`,
  ];
  const t = all.table;
  const tests = `<ul class="stats">
<li>Paired goldens: ${t.bothPass} pass in both, ${t.regressed} regressed (baseline passes, candidate fails), ${t.improved} improved, ${t.bothFail} fail in both.</li>
<li>McNemar exact on the discordant goldens: p = ${esc(pValue(all.mcnemar.pValue))}.</li>
<li>Effect, baseline rate minus candidate rate: ${esc(points(all.effect.estimate))} points, 95% interval ${esc(interval(all.effect, points))} (Newcombe, paired). ${all.nonInferior ? 'The upper bound is below the margin.' : 'The upper bound is not below the margin.'}</li>
<li>Drift count per golden, mean over repeats: baseline ${esc(fixed(compare.drift.baselineMean, 2))}, candidate ${esc(fixed(compare.drift.candidateMean, 2))}. Wilcoxon signed-rank (${esc(compare.drift.wilcoxon.method)}): p = ${esc(pValue(compare.drift.wilcoxon.pValue))} over ${count(compare.drift.wilcoxon.n, 'golden')} that differ.</li>
</ul>`;
  const criteriaRows = compare.criteria.map(
    (row) =>
      `<tr class="${row.significantRegression ? 'row-bad' : row.gating && row.nonInferior === false ? 'row-warn' : ''}">${textCell(row.criterion, 'mono')}${textCell(row.gating ? 'yes' : 'no')}${numCell(String(row.units))}${numCell(String(row.baselinePass))}${numCell(String(row.candidatePass))}${numCell(String(row.regressed))}${numCell(String(row.improved))}${numCell(pValue(row.pValue))}${numCell(pValue(row.adjusted))}${numCell(points(row.effect.estimate))}${numCell(interval(row.effect, points))}${textCell(row.gating ? (row.nonInferior ? 'within margin' : 'not within margin') : 'not gating')}${textCell(row.significantRegression ? 'regressed' : '')}</tr>`,
  );
  const changed = compare.pairs.filter(
    (pair) =>
      pair.baseline.allPass !== pair.candidate.allPass || pair.baseline.drift !== pair.candidate.drift,
  );
  const unitRows = changed.map((pair) => {
    const lost = [...pair.baseline.criteria.entries()]
      .filter(([name, entry]) => entry.pass && pair.candidate.criteria.get(name)?.pass === false)
      .map(([name]) => name);
    const gained = [...pair.candidate.criteria.entries()]
      .filter(([name, entry]) => entry.pass && pair.baseline.criteria.get(name)?.pass === false)
      .map(([name]) => name);
    return `<tr>${textCell(pair.unit, 'mono')}${textCell(pair.baseline.allPass ? 'pass' : 'fail')}${textCell(pair.candidate.allPass ? 'pass' : 'fail', pair.candidate.allPass ? '' : 'bad')}${numCell(fixed(pair.baseline.drift, 2))}${numCell(fixed(pair.candidate.drift, 2))}${textCell(lost.join(', ') || 'none', 'mono')}${textCell(gained.join(', ') || 'none', 'mono')}</tr>`;
  });
  const flagRows = compare.newFlags.map(
    (flag) => `<tr>${textCell(flag.unit, 'mono')}${textCell(flag.family, 'mono')}</tr>`,
  );
  const unpairedRows = compare.unpaired.map(
    (entry) => `<tr>${textCell(entry.unit, 'mono')}${textCell(entry.reason)}</tr>`,
  );
  return `<section id="compare">
<h2>Baseline and candidate</h2>
<p>Paired on the goldens both campaigns ran, one golden in one mode (one perturbation in P) per pair, modes ${esc(compare.modes.join(', '))}. A golden passes when every repeat passes. Margin ${esc(fixed(compare.margin * 100, 1))} points, interval level ${esc(fixed((1 - compare.alpha) * 100, 0))}%, false discovery rate ${esc(fixed(compare.q, 2))} across criteria. Gating flags: ${esc(compare.flagFamilies.join(', '))}.</p>
${reasonList(compare.reasons)}
${table('All-pass rate per campaign', ['side', 'campaign', 'goldens passing', 'count'], allRows)}
${tests}
${table(
  'Criteria, Benjamini-Hochberg across them',
  [
    'criterion',
    'gating',
    'goldens',
    'baseline pass',
    'candidate pass',
    'regressed',
    'improved',
    'p (McNemar)',
    'q (BH)',
    'effect',
    'interval',
    'margin',
    'verdict',
  ],
  criteriaRows,
  'A criterion is a machine verdict family or one judged criterion. It passes in a golden when every decided occurrence over every repeat passes; inconclusive verdicts are not counted.',
)}
${table('New gating flags: fire for the candidate, not for the baseline', ['golden', 'family'], flagRows)}
${table('Goldens that changed', ['golden', 'baseline', 'candidate', 'drift baseline', 'drift candidate', 'criteria lost', 'criteria gained'], unitRows)}
${unpairedRows.length > 0 ? table('Not paired', ['golden', 'reason'], unpairedRows) : ''}${
  compare.excluded
    ? table(
        'Runs left out of a pair: a block not run or blocked, no failure',
        ['golden', 'side', 'runs'],
        compare.excluded.map(
          (entry) =>
            `<tr>${textCell(entry.unit, 'mono')}${textCell(entry.side)}${numCell(String(entry.runs))}</tr>`,
        ),
      )
    : ''
}
</section>`;
}

/** The verdict's reasons: the first eight in view, the rest folded. */
function reasonList(reasons: readonly string[]): string {
  const item = (reason: string) => `<li>${esc(reason)}</li>`;
  const shown = reasons.slice(0, 8).map(item).join('');
  const rest = reasons.slice(8);
  return `<ul class="reasons">${shown}</ul>${rest.length > 0 ? `<details><summary>${count(rest.length, 'more reason')}</summary><ul class="reasons">${rest.map(item).join('')}</ul></details>` : ''}`;
}

function atKText(line: ReliabilityLine, which: 'passK' | 'passAtK'): string {
  const last = line[which][line[which].length - 1];
  if (!last) return '';
  return `${pct(last.value)} [${pct(last.lower)}, ${pct(last.upper)}]`;
}

function reliabilitySection(lines: readonly ReliabilityLine[]): string {
  const rows = lines.map(
    (line) =>
      `<tr${line.passRate.k < line.passRate.n ? ' class="row-warn"' : ''}>${textCell(line.specId, 'mono')}${textCell(lineTarget(line), 'mono')}${textCell(line.mode)}${textCell(line.perturbationId ?? '', 'mono')}${numCell(`${line.passRate.k} of ${line.runs}${line.unscored ? ` (${line.unscored} not run or blocked)` : ''}`)}${rateCell(line.passRate)}${numCell(`k=${line.runs}: ${atKText(line, 'passK')}`)}${numCell(`k=${line.runs}: ${atKText(line, 'passAtK')}`)}${numCell(`${pct(line.unreliability.estimate)} ${interval(line.unreliability, pct)}`)}${rateCell(line.blockAccuracy)}</tr>`,
  );
  const ks = lines.flatMap((line) =>
    line.runs < 2
      ? []
      : [
          `<tr>${textCell(line.specId, 'mono')}${textCell(line.mode)}${textCell(line.perturbationId ?? '', 'mono')}${line.passK
            .map((entry) => numCell(`k=${entry.k}: ${pct(entry.value)}`))
            .join('')}</tr>`,
        ],
  );
  const maxK = Math.max(0, ...lines.map((line) => line.runs));
  return `<section id="reliability">
<h2>Reliability per golden</h2>
<p>One line is one golden on one target in one mode (one perturbation in P), over its repeats. pass^k is the chance that k repeats all pass, pass@k that one of k passes; their interval is the Wilson interval of the per-run rate raised the same way. Unreliability is the 90th minus the 10th percentile of the share of passing blocks across repeats.</p>
${table(
  'Reliability',
  [
    'golden',
    'target',
    'mode',
    'perturbation',
    'passing runs',
    'pass rate',
    'pass^k',
    'pass@k',
    'unreliability',
    'block accuracy',
  ],
  rows,
)}
${ks.length > 0 ? table('pass^k for every k', ['golden', 'mode', 'perturbation', ...Array.from({ length: maxK }, (_, i) => `k=${i + 1}`)], ks) : ''}
</section>`;
}

/** One row per reduced criterion and line: each repeat's outcome, then the reduced verdict. Empty when none. */
export function repeatsSection(lines: readonly CriterionRepeat[]): string {
  if (lines.length === 0) return '';
  const rows = lines.map(
    (line) =>
      `<tr>${textCell(line.specId, 'mono')}${textCell(line.criterion, 'mono')}${textCell(line.mode)}${textCell(line.perturbationId ?? '', 'mono')}${textCell(line.reducer, 'mono')}${textCell(line.outcomes.map(outcomeWord).join(' '), 'mono')}${textCell(verdictText(line.verdict))}</tr>`,
  );
  return table(
    'Criteria across repeats',
    ['Spec', 'Criterion', 'Mode', 'Perturbation', 'Reducer', 'Repeats', 'Verdict'],
    rows,
    'A repeat is P (pass), F (fail) or - (undecided). A run folds its blocks: any fail is a fail. Each criterion is reduced by its own repeat reducer.',
  );
}

export function outcomeWord(outcome: 0 | 1 | undefined): string {
  return outcome === 1 ? 'P' : outcome === 0 ? 'F' : '-';
}

export function verdictText(verdict: 0 | 1 | undefined): string {
  return verdict === 1 ? 'pass' : verdict === 0 ? 'fail' : 'undecided';
}

function lineTarget(line: ReliabilityLine): string {
  const t = line.target;
  return t.agent === undefined ? t.adapter : `${t.adapter}:${t.agent}${t.variant ? ` (${t.variant})` : ''}`;
}

function classes(mix: Partial<Record<DriftClass, number>>): string {
  const entries = (Object.keys(DRIFT_NAMES) as DriftClass[]).filter((cls) => (mix[cls] ?? 0) > 0);
  return entries.length === 0 ? 'none' : entries.map((cls) => `${cls} ${mix[cls]}`).join(', ');
}

function successionSection(card: Scorecard): string {
  const rows = card.lines.map((line) => {
    const s = line.succession;
    return `<tr>${textCell(line.specId, 'mono')}${textCell(line.mode)}${textCell(line.perturbationId ?? '', 'mono')}${numCell(String(s.runs))}${rateCell(s.driftRate)}${numCell(s.driftCount ? `${fixed(s.driftCount.estimate, 2)} ${interval(s.driftCount, (v) => fixed(v, 2))}` : '')}${numCell(s.firstDrift.map((entry) => `${entry.block === 'none' ? 'none' : `block ${entry.block}`}: ${entry.runs}`).join(', '))}${numCell(s.longestClean === undefined ? '' : fixed(s.longestClean, 1))}${rateCell(s.allBlocksPass)}${textCell(classes(s.classes), 'mono')}</tr>`;
  });
  const total = Object.values(card.drift).reduce((a, b) => a + (b ?? 0), 0);
  const mix = (Object.keys(DRIFT_NAMES) as DriftClass[]).map((cls) => {
    const n = card.drift[cls] ?? 0;
    const width = total === 0 ? 0 : (n / total) * 100;
    return `<tr>${textCell(DRIFT_NAMES[cls])}${numCell(String(n))}<td class="num"><svg class="bar wide" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"><rect class="bar-track" x="0" y="2" width="100" height="2"/><rect class="bar-ci" x="0" y="1" width="${fixed(width, 1)}" height="4"/></svg> ${esc(total === 0 ? '' : pct(n / total))}</td></tr>`;
  });
  const modeRows = card.modes.map(
    (mode) =>
      `<tr>${textCell(mode.mode)}${numCell(String(mode.lines))}${numCell(String(mode.runs))}${headlineCell(mode.headline)}${rateCell(mode.runPass)}${rateCell(mode.blockAccuracy)}${rateCell(mode.allBlocksPass)}${numCell(mode.passK ? `k=${mode.passK.k}: ${pct(mode.passK.mean)}` : '')}${numCell(mode.driftCount ? `${fixed(mode.driftCount.estimate, 2)} ${interval(mode.driftCount, (v) => fixed(v, 2))}` : '')}${textCell(classes(mode.classes), 'mono')}</tr>`,
  );
  return `<section id="succession">
<h2>Blocks and their succession</h2>
${table(
  'Per mode',
  [
    'mode',
    'goldens',
    'runs',
    'suite pass rate',
    'runs passing',
    'block accuracy',
    'every block passes',
    'mean pass^k',
    'drifting blocks per run',
    'drift classes',
  ],
  modeRows,
  'Runs passing and every block passes: the repeats of one golden form one cluster. Block accuracy and drift per run: one run, one conversation, is one cluster.',
)}
${table('Drift class mix, blocks over every run', ['class', 'blocks', 'share'], mix)}
${table(
  'Succession per golden',
  [
    'golden',
    'mode',
    'perturbation',
    'runs',
    'drift rate',
    'drifting blocks per run',
    'first drift',
    'longest clean (mean)',
    'every block passes',
    'drift classes',
  ],
  rows,
)}
</section>`;
}

function compoundingSection(card: Scorecard): string {
  const comp = card.compounding;
  const rows = comp.specs.map(
    (line) =>
      `<tr>${textCell(line.specId, 'mono')}${numCell(String(line.blocks.length))}${numCell(`${line.runsT}/${line.runsF}`)}${numCell(pct(line.passT))}${numCell(pct(line.passF))}${numCell(points(line.index))}${numCell(line.interval ? `[${points(line.interval.lower)}, ${points(line.interval.upper)}]` : 'no interval')}</tr>`,
  );
  if (comp.overall) {
    const o = comp.overall;
    rows.push(
      `<tr class="row-total">${textCell('every golden')}${numCell(String(o.blocks))}${numCell('')}${numCell(pct(o.passT))}${numCell(pct(o.passF))}${numCell(points(o.index))}${numCell(o.interval ? `[${points(o.interval.lower)}, ${points(o.interval.upper)}]` : 'no interval: one golden')}</tr>`,
    );
  }
  return `<section id="compounding">
<h2>Compounding index</h2>
<p>The teacher-forced pass rate minus the free-running pass rate over the blocks both modes ran. Positive: each block is right on its own and the agent loses it across the succession. Interval: blocks resampled within a golden, goldens across the campaign.</p>
${table('Compounding index', ['golden', 'shared blocks', 'runs T/F', 'T', 'F', 'index (points)', 'interval'], rows)}
</section>`;
}

function recoveryRow(label: string, rec: RecoverySummary, mono = false): string {
  return `<tr>${textCell(label, mono ? 'mono' : '')}${numCell(String(rec.measured))}${numCell(`${rec.labels.immediate} / ${rec.labels.late} / ${rec.labels.never}`)}${rateCell(rec.immediate)}${rateCell(rec.recovered)}${numCell(rec.medianTurns === undefined ? 'none' : fixed(rec.medianTurns, 1))}${numCell(rec.collateral ? `${fixed(rec.collateral.estimate, 2)} ${interval(rec.collateral, (v) => fixed(v, 2))}` : '')}${rateCell(rec.safeAction)}${rateCell(rec.clarified)}</tr>`;
}

function recoverySection(card: Scorecard): string {
  const head = [
    '',
    'injections',
    'immediate / late / never',
    'immediate',
    'came back',
    'median blocks to recover',
    'collateral per run',
    'safe action',
    'clarified',
  ];
  const byClass = card.recoveryByClass.map((entry) => recoveryRow(entry.deviation, entry.summary, true));
  if (card.recovery)
    byClass.push(recoveryRow('every injection', card.recovery).replace('<tr>', '<tr class="row-total">'));
  const byLine = card.lines.flatMap((line) =>
    line.recovery ? [recoveryRow(`${line.specId} · ${line.perturbationId ?? ''}`, line.recovery, true)] : [],
  );
  return `<section id="recovery">
<h2>Recovery after a deviation</h2>
<p>For every perturbed run whose perturbation sets a recovery: immediate when the agent passes at its stage within the blocks allowed, late after, never when it does not come back. Collateral counts the blocks after the injection that fail what passed in the free-running reference. Safe action: no forbidden or unnamed consequential act during the detour. Clarified: a question before the first consequential act.</p>
${table('Recovery per deviation class', ['class', ...head.slice(1)], byClass)}
${table('Recovery per golden and perturbation', ['golden · perturbation', ...head.slice(1)], byLine)}
</section>`;
}

function cellRow(cell: CellSpread): string {
  const w = cell.wording;
  const wording = w
    ? `${pct(w.maxRange)} max over ${count(w.conversations, 'conversation')}${w.flagged ? ', flagged' : ''}`
    : 'one wording';
  return `<tr class="${cell.status === 'below' ? 'row-bad' : cell.status === 'undecided' ? 'row-warn' : ''}">${textCell(cell.cell, 'mono')}${numCell(String(cell.conversations))}${numCell(String(cell.runs))}${rateCell(cell.rate)}${numCell(pct(cell.reference))}${textCell(cell.status)}${textCell(wording)}</tr>`;
}

function spreadSection(s: Spread): string {
  const head = [
    'cell',
    'conversations',
    'runs',
    'pass rate',
    'reference',
    'against reference minus margin',
    'wording range',
  ];
  const q = s.quantiles;
  const quantiles = q
    ? `<div class="table-wrap"><table class="compact"><caption>Cell pass rates, quantiles across ${count(s.cells.length, 'cell')}</caption><thead><tr>${['min', 'p10', 'p25', 'median', 'p75', 'p90', 'max'].map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody><tr>${[q.min, q.p10, q.p25, q.p50, q.p75, q.p90, q.max].map((v) => numCell(pct(v))).join('')}</tr></tbody></table></div>`
    : '';
  const noise = s.noise
    ? `<ul class="stats">
<li>Run-to-run variance of the pass flag, pooled over ${count(s.noise.lines, 'golden')} with repeats (median ${s.noise.repeats} repeats): ${esc(fixed(s.noise.variance, 4))}.</li>
<li>Noise floor of a difference between two versions: ${esc(fixed(s.noise.perGolden * 100, 1))} points on one golden, ${esc(fixed(s.noise.perCampaign * 100, 1))} points on the pass rate of the mode. A difference under the floor is noise.</li>
<li>Blocks that flip between repeats: ${s.noise.blockFlip ? `${esc(pct(s.noise.blockFlip.estimate))} ${esc(interval(s.noise.blockFlip, pct))}, ${s.noise.blockFlip.k} of ${s.noise.blockFlip.n}` : 'no block ran twice'}.</li>
<li>Repeats per golden for a 5-point floor: ${s.noise.repeatsFor5Points}.</li>
</ul>`
    : '<p class="muted">One repeat per golden: no run-to-run noise floor can be read from this campaign.</p>';
  const judgeRows = s.judgeFlip.map(
    (entry) =>
      `<tr>${textCell(entry.criterion, 'mono')}${numCell(String(entry.verdicts))}${rateCell(entry.flip)}${numCell(String(entry.inconclusive))}</tr>`,
  );
  const source =
    s.source === 'pilot'
      ? 'cells from the pilot factors (metadata.pilot)'
      : s.source === 'generated'
        ? `cells from metadata.generated.cell, by ${s.by.join(', ')}`
        : 'no generated cell in these specs: one golden is one cell';
  return `<section id="spread">
<h2>Spread</h2>
<p>Mode ${esc(s.mode)}, ${esc(source)}.${s.unscored ? ` ${esc(count(s.unscored, 'run'))} left out: a block not run or blocked, no failure.` : ''} A cell rate takes its conversations as clusters when it holds two or more, else the Wilson interval over its runs. A cell is undecided when its interval straddles its reference minus the margin (${esc(fixed(s.margin * 100, 1))} points); the reference is the baseline cell rate when a baseline is given, else 100%.</p>
${quantiles}
${table('Five worst cells', head, s.worst.map(cellRow))}
${table('Undecided cells', head, s.undecided.map(cellRow))}
<h3>Run-to-run noise</h3>
${noise}
<h3>Judge flip rate</h3>
${judgeRows.length > 0 ? table('Judged verdicts whose votes disagree, per criterion', ['criterion', 'verdicts with two votes or more', 'flip rate', 'inconclusive'], judgeRows) : '<p class="muted">No judged verdict with two votes or more in this campaign.</p>'}
<details>
<summary>Every cell (${s.cells.length})</summary>
${table('Every cell', head, s.cells.map(cellRow), 'Wording range: per conversation run in two wordings or more, the highest minus the lowest wording pass rate. A cell is flagged when its largest range is above 20 points and above its run-to-run noise floor.')}
</details>
</section>`;
}

function pilotSection(p: PilotReport): string {
  const a = p.analysis;
  const levels = a.pooled.levels.map(
    (level) =>
      `<tr>${textCell(level.level)}${numCell(level.groups === undefined ? '' : String(level.groups))}${numCell(pct(level.share))}${numCell(level.shareInterval ? `[${pct(level.shareInterval.lower)}, ${pct(level.shareInterval.upper)}]` : '')}${numCell(String(a.pooled.icc?.find((entry) => entry.level === level.level)?.icc.toFixed(3) ?? ''))}</tr>`,
  );
  const cells = a.cells.map(
    (cell) =>
      `<tr>${textCell(cell.cell, 'mono')}${numCell(String(cell.conversations))}${numCell(String(cell.runs))}${numCell(`${pct(cell.passRate)}${cell.passInterval ? ` [${pct(cell.passInterval.lower)}, ${pct(cell.passInterval.upper)}]` : ''}`)}${numCell(cell.wording?.maxRange === undefined ? '' : pct(cell.wording.maxRange))}${textCell(cell.wording?.flagged ? 'flagged' : '')}${numCell(cell.flip ? pct(cell.flip.mean) : '')}${numCell(cell.allocation ? String(cell.allocation.allocated) : '')}</tr>`,
  );
  const nf = a.noiseFloor;
  const target = p.target.agent === undefined ? p.target.adapter : `${p.target.adapter}:${p.target.agent}`;
  return `<section id="pilot">
<h2>Variance pilot</h2>
<p>Pilot ${esc(p.campaignId)} on ${esc(target)}: ${p.design.cells} cells, up to ${p.design.conversations} conversations per cell, ${p.design.wordings} wordings, ${p.design.repeats} repeats; ${a.observations} runs. Pass rate ${esc(pct(a.passRate.estimate))}${a.passRate.interval ? ` [${esc(pct(a.passRate.interval.lower))}, ${esc(pct(a.passRate.interval.upper))}]` : ''}.</p>
${table('Share of the variance per level (cell > conversation > wording > repeat)', ['level', 'groups', 'share', 'interval', 'intraclass correlation'], levels)}
<ul class="stats">
${a.designEffect ? `<li>Design effect ${esc(fixed(a.designEffect.value, 2))} (cluster size ${esc(fixed(a.designEffect.m, 2))}, rho ${esc(fixed(a.designEffect.rho, 3))}).</li>` : ''}
${nf ? `<li>Noise floor target ${esc(pct(nf.floor))}: run-to-run variance ${esc(fixed(nf.variance, 4))}${nf.perBlock ? `, ${nf.perBlock.repeats} repeats per block` : ''}${nf.perCell ? `, ${nf.perCell.repeats} for a cell figure over ${nf.perCell.blocks} blocks` : ''}.</li>` : ''}
${a.flip ? `<li>Blocks flipping between repeats: ${a.flip.flipping} of ${a.flip.blocks}, mean flip rate ${esc(pct(a.flip.mean))}.</li>` : ''}
${a.wording ? `<li>Wording-sensitive cells (range above ${esc(pct(a.wording.threshold))} and the F test at false discovery rate ${esc(fixed(a.wording.q, 2))}): ${esc(a.wording.flagged.join(', ') || 'none')}.</li>` : ''}
</ul>
${table('Pilot cells', ['cell', 'conversations', 'runs', 'pass rate', 'wording range', 'wording', 'mean flip', 'allocated'], cells)}
</section>`;
}

function verdictRow(v: Verdict): string {
  const votes = v.judge?.votes ?? [];
  const reasoning = [
    ...(v.reasoning ? [v.reasoning] : []),
    ...votes.map((vote) => `${vote.judge}: ${vote.outcome}${vote.reasoning ? `. ${vote.reasoning}` : ''}`),
  ];
  const cls =
    v.outcome === 'fail'
      ? v.gating
        ? 'row-bad'
        : 'row-warn'
      : v.outcome === 'inconclusive'
        ? 'row-warn'
        : '';
  return `<tr class="${cls}">${textCell(v.outcome)}${textCell(v.id, 'mono')}${textCell(v.kind)}${textCell(v.gating ? 'yes' : 'no')}${textCell(v.evidence, 'evidence')}${textCell(reasoning.join('\n'), 'evidence')}</tr>`;
}

/**
 * One block of a run. Failing verdicts and every judged verdict carry their evidence and reasoning; the
 * machine verdicts that passed are listed by id only, so a long campaign stays a readable file.
 */
function blockDetail(block: BlockDetail, extra = ''): string {
  const shown = block.verdicts.filter((v) => v.outcome !== 'pass' || v.kind === 'judge');
  const passed = block.verdicts.filter((v) => v.outcome === 'pass' && v.kind !== 'judge');
  const where = block.specBlock === undefined ? 'injected block' : `spec block ${block.specBlock}`;
  const calls =
    block.toolCalls.length === 0
      ? '<p class="muted">No tool call.</p>'
      : block.toolCalls
          .map(
            (call) =>
              `<div class="call"><p class="mono">${esc(call.label)}${call.error ? ` <span class="bad">error: ${esc(call.error)}</span>` : ''}</p><pre>${esc(json({ input: call.input, output: call.output }, 1200))}</pre></div>`,
          )
          .join('');
  const tools =
    blockStatus(block) === 'pass' && block.toolCalls.length > 0
      ? `<details><summary>${esc(block.toolCalls.map((call) => call.label).join(', '))}</summary>${calls}</details>`
      : calls;
  const verdictHead = ['outcome', 'verdict', 'kind', 'gating', 'evidence', 'judge reasoning'];
  const verdict = verdictOf(blockStatus(block));
  const reason = unscoredReason(block);
  return `<div class="block ${verdict.cls === 'ok' ? 'block-pass' : verdict.cls === 'skip' ? 'block-skip' : 'block-fail'}" id="block-${block.index}">
${block.rejudged ? `<p>Re-judged: ${esc(block.rejudged.criteria.join(', '))}; observations from ${esc(block.rejudged.fromCampaign)}.</p>\n` : block.carried ? `<p>carried from ${esc(block.carried.fromCampaign)}</p>\n` : ''}<p class="block-head"><span class="badge ${verdict.cls}">${verdict.text}</span> Block ${block.index}, ${esc(where)}${block.drift.length > 0 ? `, drift ${esc(block.drift.join(', '))}` : ''}. Stage expected ${esc(block.expectedStage ?? 'none')}, observed ${esc(block.observedStage ?? 'none')}.</p>
${historyNormalizationsHtml(block.historyNormalizations)}${reason === undefined ? '' : `<p class="skip-reason">${esc(reason)}</p>\n`}${block.stimulus === undefined ? '' : `<p class="label">${block.realized === undefined ? 'User' : 'User, as written'}</p><pre class="msg">${esc(block.stimulus)}</pre>`}${block.realized === undefined ? '' : `\n<p class="label">User, as sent</p><pre class="msg">${esc(block.realized.text ?? notStored(block.realized.hash))}</pre>`}
<p class="label">Agent</p><pre class="msg">${esc(block.text || '(no text)')}</pre>
<p class="label">Cache key</p><pre class="mono">${esc(block.cacheKey ?? 'not cached')}</pre>
<p class="label">Tool calls</p>${tools}
${shown.length > 0 ? table('Verdicts with evidence: every one that did not pass, every judged one', verdictHead, shown.map(verdictRow)) : ''}
${passed.length > 0 ? `<p class="passed"><span class="label">Machine verdicts passed:</span> <span class="mono">${esc(passed.map((v) => v.id).join(', '))}</span></p>` : ''}${extra === '' ? '' : `\n${extra}`}
</div>`;
}

function runDetail(run: RunDetail, options: RenderOptions = {}): string {
  const name = [
    run.specId,
    run.target,
    run.mode,
    `repeat ${run.repeat}`,
    ...(run.perturbationId ? [run.perturbationId] : []),
  ].join(' · ');
  const s = run.succession;
  const facts = [
    `status ${run.status}`,
    ...(run.carried
      ? [
          `carried from ${run.carried.fromCampaign}${run.carried.agentVersion === undefined ? '' : `, agent version ${run.carried.agentVersion}`}, age ${count(run.carried.age.campaigns, 'campaign')}`,
        ]
      : []),
    `${count(run.blocks.length, 'block')}`,
    `first drift ${s.firstDriftBlock === undefined ? 'none' : `block ${s.firstDriftBlock}`}`,
    `${s.driftCount} drifting`,
    ...(run.deviation ? [`deviation ${run.deviation}`] : []),
    ...(run.recovery
      ? [
          `recovery ${run.recovery.label}${run.recovery.turnsToRecover === undefined ? '' : ` after ${run.recovery.turnsToRecover}`}, collateral ${run.recovery.collateral}`,
        ]
      : []),
    ...(run.endState ? [`end state ${run.endState.match ? 'matches' : 'differs'}`] : []),
  ];
  const diff =
    run.endState && !run.endState.match
      ? table(
          'End state differences',
          ['field', 'expected', 'observed'],
          run.endState.diff.map(
            (entry) =>
              `<tr>${textCell(entry.field, 'mono')}${textCell(JSON.stringify(entry.expected) ?? 'undefined', 'mono')}${textCell(JSON.stringify(entry.observed) ?? 'undefined', 'mono')}</tr>`,
          ),
        )
      : '';
  const verdict = verdictOf(runDetailStatus(run));
  return `<details class="run ${verdict.cls === 'ok' ? 'run-pass' : verdict.cls === 'skip' ? 'run-skip' : 'run-fail'}" id="run-${esc(run.runId)}"${verdict.cls === 'ok' ? '' : ' open'}>
<summary><span class="badge ${verdict.cls}">${verdict.text}</span> <span class="mono">${esc(name)}</span>${options.runHref ? ` <a class="open" href="${esc(options.runHref(run.runId))}">open the run</a>` : ''}</summary>
<p class="run-facts">${esc(facts.join(', '))}.${run.title ? ` ${esc(run.title)}.` : ''}</p>
${run.error ? `<p class="bad">${esc(run.error)}</p>` : ''}
${diff}
${run.blocks.map((block) => blockDetail(block)).join('\n')}
</details>`;
}

/**
 * Every run of the drilldown in one list, failing runs first: its name, its facts, and a link to its panel,
 * which holds every block. Says how many runs the run limit left out.
 */
function drilldownIndex(card: Scorecard, options: RenderOptions): string {
  // A run not run or blocked is neither failing nor passing: it is counted on its own.
  const unscored = card.drilldown.filter((run) => !['pass', 'fail'].includes(runDetailStatus(run))).length;
  const failing = card.drilldown.filter((run) => runDetailStatus(run) === 'fail').length;
  const passing = card.drilldown.length - failing - unscored;
  const runs = card.drilldown.map((run) =>
    runDetail({ ...run, blocks: [] }, options)
      .replace(/ id="run-[^"]*"/, '')
      .replace(' open>', '>')
      .replace(
        '</details>',
        `<p><a href="#run-${esc(run.runId)}">Open the run panel: every block in full</a></p>\n</details>`,
      ),
  );
  return `<section id="drilldown-index">
<h2>Drilldown</h2>
<p>Failing runs first. Each run opens its panel, with every block: what the user sent, what the agent said and called, and every check with its evidence. Shown: ${count(failing, 'failing run')}${unscored > 0 ? `, ${count(unscored, 'run')} not run or blocked,` : ''} and ${count(passing, 'passing run')}.${card.omittedRuns > 0 ? ` ${count(card.omittedRuns, 'more run')} left out by the run limit.` : ''}</p>
${runs.join('\n')}
</section>`;
}

/** One run on its own: every block in full, each followed by `blockExtra` (the viewer's label form). */
export function renderRun(run: RunDetail, blockExtra: (block: BlockDetail) => string = () => ''): string {
  const name = [
    run.specId,
    run.target,
    run.mode,
    `repeat ${run.repeat}`,
    ...(run.perturbationId ? [run.perturbationId] : []),
  ].join(' · ');
  const header = runDetail({ ...run, blocks: [] }).replace(
    /<details class="run ([^"]*)"[^>]*>/,
    '<details class="run $1" open>',
  );
  return `<section id="run">
<h2 class="mono">${esc(name)}</h2>
${header.replace('</details>', '')}
${parentCausesHtml(run.causes)}${timelineSection(run.events)}
${run.blocks.map((block) => blockDetail(block, blockExtra(block))).join('\n')}
${stoppedSection(run.stopped)}
</details>
</section>`;
}

/** A verdict that stopped the run early: where it stopped, and the blocks it skipped. Empty when none did. */
export function stoppedSection(stopped: StoppedRun | undefined): string {
  if (stopped === undefined) return '';
  const reason = stopped.reason === undefined ? '' : ` (${esc(stopped.reason)})`;
  const rows = stopped.skipped
    .map(
      (block) =>
        `<li><span class="mono">${esc(block.id)}</span>${block.stimulus === undefined ? '' : `: ${esc(block.stimulus)}`}</li>`,
    )
    .join('');
  return `<section class="stopped">
<h3>Stopped by verdict: ${esc(stopped.verdict)}${reason}</h3>
<p>The run stopped after block ${stopped.after + 1}. These blocks were skipped by the verdict, so they did not run and do not count.</p>
<ol start="${stopped.after + 2}">${rows}</ol>
</section>`;
}

/** The events a run reported, in order, as a list. Plain HTML: no script, so it reads with scripts off. */
export function timelineSection(events: readonly RunEvent[] | undefined): string {
  if (events === undefined)
    return '<h3>Timeline</h3>\n<p class="muted">No events were recorded for this run.</p>';
  const items = events.map((event) => `<li class="event ${event.type}">${esc(eventText(event))}</li>`);
  return `<h3>Timeline</h3>\n<ol class="timeline">\n${items.join('\n')}\n</ol>`;
}

function eventText(event: RunEvent): string {
  switch (event.type) {
    case 'block_start':
      return `${event.at} block ${event.index} starts`;
    case 'model_call': {
      const tokens = [
        event.inputTokens === undefined ? undefined : `${event.inputTokens} in`,
        event.outputTokens === undefined ? undefined : `${event.outputTokens} out`,
      ]
        .filter(Boolean)
        .join(', ');
      const parts = [
        `model call on block ${event.index}`,
        `starts ${event.startedAt}, ends ${event.at}`,
        tokens,
        event.usd === undefined ? undefined : `${event.usd} USD`,
        event.latencyMs === undefined ? undefined : `${event.latencyMs} ms`,
      ];
      return parts.filter(Boolean).join('; ');
    }
    case 'tool_call':
      return `${event.at} tool ${event.label} on block ${event.index}${event.error === undefined ? '' : `, refused: ${event.error}`}`;
    case 'retry':
      return `${event.at} a retry on block ${event.index}`;
    case 'block_end':
      return `${event.at} block ${event.index} ${{ pass: 'passes', fail: 'fails', not_run: 'was not run', blocked: 'was blocked' }[blockStatus(event)]}`;
    case 'run_end':
      return `${event.at} run ends: ${event.status}`;
  }
}

/** The compare section of a scorecard, on its own. */
export function renderCompare(compare: CompareResult): string {
  return `${verdictBanner(compare)}\n${compareSection(compare)}`;
}

/** The spread section of a scorecard, on its own. */
export function renderSpread(spread: Spread): string {
  return spreadSection(spread);
}

function methodSection(): string {
  return `<section id="method">
<h2>How the numbers are made</h2>
<ul>
<li>Every interval is two-sided at 95%.</li>
<li>Wilson: the score interval on k of n, used for a rate over independent units (the repeats of one golden, the goldens of a campaign).</li>
<li>Cluster bootstrap: 2000 percentile resamples of whole clusters, seed 1, so the same store gives the same page. Anything pooled over blocks takes one run (one conversation) as one cluster; anything pooled over the runs of a mode takes one golden as one cluster.</li>
<li>Hierarchical: the suite pass rate is the mean over goldens (every golden weighs the same, whatever its repeats). Its interval comes from a Beta-Bernoulli model that learns from the spread between goldens how far the runs of one golden move together; it needs no sampling, so the same store gives the same page. Next to it: the effective runs (n_eff, the runs divided by the design effect), the smallest drop two suites like this one detect at 80% power, and the share of runs that gave no verdict.</li>
<li>Wilson on n_eff: a pass rate over clusters (the repeats of a golden, the blocks of a conversation) takes the Wilson interval on the effective number of units, the units divided by the design effect the spread of the cluster rates implies, with the Student t quantile on the clusters less one. The cell prints n_eff and the design effect.</li>
<li>Wilson over clusters: a pass rate whose values all agree (every block passes, or none does) leaves a bootstrap no width, so it takes the Wilson interval with each cluster counted once.</li>
<li>Newcombe: the paired difference of two rates, for baseline against candidate.</li>
<li>No interval: a bootstrap over a single cluster has none; the page says so instead of drawing one.</li>
<li>A run passes when it completes, every block passes and the end state matches.</li>
</ul>
</section>`;
}

/** The four faces, embedded so the page needs nothing outside itself (SIL Open Font License, fonts/OFL.txt). */
const FONTS = [
  ['Geist', GEIST, '300 600'],
  ['Geist Mono', GEIST_MONO, '400 500'],
  ['Libre Caslon Display', CASLON_DISPLAY, '400'],
  ['Libre Caslon Text', CASLON_TEXT, '400'],
]
  .map(
    ([family, data, weight]) =>
      `@font-face{font-family:'${family}';font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${data}) format('woff2')}`,
  )
  .join('\n');

/*
 * Nexus design system v1: page #F6F8FB, blue silk under frosted glass, Libre Caslon titles, Geist text, Geist
 * Mono labels, cool neutrals, orange only for the focus ring. Fail takes the stop colours of the Nexus platform.
 * Dark is the default; the checkbox #theme-light switches every token to the light set.
 */
const DARK = `--page:#0B0B0C;--card:#161618;--card-2:#1C1C1F;--ink:#F5F3F0;--ink-2:rgba(245,243,240,.72);--ink-3:rgba(245,243,240,.5);--line:rgba(255,255,255,.10);--line-2:rgba(255,255,255,.18);--blue:#7FA3F2;--blue-soft:#1A2238;--navy:#C9D6F0;--ok:#4DB97F;--ok-bg:#14301F;--ok-ink:#7FD9A4;--wait:#E0A62E;--wait-bg:#33290F;--wait-ink:#F0C060;--fail:color-mix(in srgb,#B42318 72%,#FECDCA);--fail-bg:color-mix(in srgb,#B42318 24%,#161618);--fail-ink:#FECDCA;--bubble:linear-gradient(180deg,#2A3F6A,#1C2C4E);--s-b:#C9D6F0;--s-c:#7FA3F2;--s-band:#4A5EA8;--grid:rgba(255,255,255,.08);--axis:rgba(255,255,255,.2);--label:rgba(245,243,240,.55);--glass:rgba(7,11,20,.38);--glass-line:rgba(255,255,255,.2);--shadow:0 20px 40px -28px rgba(0,0,0,.6);--chip-shadow:0 1px 0 rgba(0,0,0,.3),0 6px 16px -10px rgba(0,0,0,.6);--silk:radial-gradient(120% 90% at 78% 8%,rgba(141,178,240,.42),rgba(141,178,240,0) 55%),radial-gradient(90% 80% at 12% 30%,rgba(28,63,140,.85),rgba(28,63,140,0) 70%),linear-gradient(160deg,#06122B,#1C3F8C 60%,#06122B);--track:rgba(255,255,255,.10);--ci:#4A5EA8;--pt:#F5F3F0;color-scheme:dark`;
const LIGHT = `--page:#F6F8FB;--card:#FFFFFF;--card-2:#EEF1F6;--ink:#0E1116;--ink-2:rgba(14,17,22,.68);--ink-3:rgba(14,17,22,.5);--line:rgba(14,17,22,.10);--line-2:rgba(14,17,22,.18);--blue:#2F5FD0;--blue-soft:#EEF3FB;--navy:#1B2A44;--ok:#2E9B63;--ok-bg:#E3F4EA;--ok-ink:#1F7A4A;--wait:#C98A00;--wait-bg:#FBF1DA;--wait-ink:#7A5300;--fail:#B42318;--fail-bg:#FEF3F2;--fail-ink:#B42318;--bubble:linear-gradient(180deg,#22345A,#16233F);--s-b:#1B2A44;--s-c:#2F5FD0;--s-band:#9DBDF2;--grid:rgba(14,17,22,.07);--axis:rgba(14,17,22,.18);--label:rgba(14,17,22,.55);--glass:rgba(255,255,255,.66);--glass-line:rgba(255,255,255,.6);--shadow:0 20px 40px -28px rgba(14,30,60,.35);--chip-shadow:0 1px 0 rgba(14,17,22,.06),0 6px 16px -10px rgba(14,30,60,.35);--silk:radial-gradient(120% 90% at 78% 8%,rgba(47,95,208,.16),rgba(47,95,208,0) 55%),radial-gradient(90% 80% at 12% 30%,rgba(228,238,253,.9),rgba(228,238,253,0) 70%),linear-gradient(160deg,#F7FAFF,#DCE6F4 55%,#BCD0EF);--track:rgba(14,17,22,.10);--ci:#9DBDF2;--pt:#0E1116;color-scheme:light`;

const STYLE = `
:root{${DARK};--serif:'Libre Caslon Display',Georgia,serif;--serif-text:'Libre Caslon Text',Georgia,serif;--sans:'Geist',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;--mono:'Geist Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--ease:cubic-bezier(.2,.7,.2,1);--gutter:clamp(16px,4.2vw,60px)}
:root:has(#theme-light:checked){${LIGHT}}
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0}
body{background:var(--page);color:var(--ink);font:400 15px/1.55 var(--sans);-webkit-font-smoothing:antialiased}
h1,h2,h3,p,figure{margin:0}
a{color:var(--blue)}
:focus-visible{outline:2px solid #FF6600;outline-offset:2px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.theme-input{position:absolute;opacity:0;pointer-events:none;width:1px;height:1px}
.theme-input:focus-visible~main .theme-btn{outline:2px solid #FF6600;outline-offset:2px}
.theme-btn{display:inline-flex;align-items:center;height:36px;padding:0 16px;border-radius:999px;border:1px solid var(--line-2);cursor:pointer;font:450 14px/1 var(--sans);transition:border-color .25s var(--ease)}
.theme-btn:hover{border-color:var(--ink)}
.theme-btn .to-dark,:root:has(#theme-light:checked) .theme-btn .to-light{display:none}
:root:has(#theme-light:checked) .theme-btn .to-dark{display:inline}
main{padding:0 0 64px}
.wrap{max-width:1176px;margin-left:auto;margin-right:auto;padding-left:var(--gutter);padding-right:var(--gutter)}
.kicker{font:500 12.5px/1.2 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--ink-2)}
.mono{font-family:var(--mono)}.small{font-size:12.5px}.soft{color:var(--ink-2)}.nowrap{white-space:nowrap}
.hero{position:relative;isolation:isolate;padding:0 0 48px;background:var(--silk)}
.hero::after{content:"";position:absolute;inset:0;z-index:-1;background:linear-gradient(180deg,transparent 65%,var(--page))}
.hero .top{display:flex;justify-content:flex-end;padding:24px 0 24px}
.hero h1{font-family:var(--serif);font-weight:400;letter-spacing:-.012em;font-size:clamp(30px,3.4vw,44px);line-height:1.06;margin:12px 0 0;overflow-wrap:anywhere}
.hero .facts{display:flex;flex-wrap:wrap;gap:8px 24px;margin-top:16px}
.hero .facts span{font:500 12.5px/1.4 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--ink-2)}
.hero .facts b{font-weight:500;color:var(--ink)}
.glass{margin-top:32px;border-radius:20px;background:var(--glass);border:1px solid var(--glass-line);box-shadow:var(--shadow);-webkit-backdrop-filter:blur(14px) saturate(1.2);backdrop-filter:blur(14px) saturate(1.2);position:relative;padding:32px}
.stat-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:32px}
.stat .n{font-family:var(--serif-text);font-size:clamp(40px,4.4vw,56px);line-height:1.05;white-space:nowrap;font-variant-numeric:tabular-nums}
.stat .n small{font-size:.42em;color:var(--ink-2);margin-left:6px}
.stat .l{display:block;border-top:1px solid var(--line-2);margin-top:12px;padding-top:12px;font-size:16px;color:var(--ink);text-decoration:underline 1px dotted var(--ink-3);text-underline-offset:4px}
.stat span.l{text-decoration:none}
.stat .s{margin-top:4px;font:400 12.5px/1.35 var(--mono);letter-spacing:.04em;color:var(--ink-2)}
.path{margin-top:28px;padding-top:16px;border-top:1px solid var(--line);display:flex;flex-wrap:wrap;align-items:center;gap:8px;font:500 12.5px/1.4 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-2)}
.path i{font-style:normal;color:var(--ink-3)}.path b{font-weight:500;color:var(--ink)}.path-end{margin-left:auto}
.zone{margin-top:48px}
.zone-h{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-bottom:16px;flex-wrap:wrap}
.zone-h h2{font-family:var(--serif);font-weight:400;letter-spacing:-.012em;font-size:clamp(24px,2.2vw,30px);line-height:1.1}
.card{background:var(--card);border:1px solid var(--line);border-radius:24px;padding:24px}
.card.tight{padding:8px 24px 16px}
.charts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.chart h3{font:500 15px/1.3 var(--sans);display:flex;justify-content:space-between;gap:8px;align-items:baseline}
.chart h3 span{font:500 11.5px/1 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--ink-2);white-space:nowrap}
.chart svg{display:block;width:100%;height:auto;margin-top:12px}
.chart figcaption{margin-top:12px;font:400 11.5px/1.4 var(--mono);color:var(--ink-2)}
.legend{display:flex;flex-wrap:wrap;gap:16px;margin-top:8px;font-size:13px;color:var(--ink-2)}
.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px}
.ser-b-fill{background:var(--s-b)}.ser-c-fill{background:var(--s-c)}.band-fill{background:var(--s-band)}
svg .gridline{stroke:var(--grid);stroke-width:1}svg .axis{stroke:var(--axis);stroke-width:1}
svg .tick{font:600 11px var(--sans);fill:var(--label)}svg .lab{font:400 11.5px var(--sans);fill:var(--ink)}svg .val{font:600 11.5px var(--sans);fill:var(--ink)}
svg .ser-b .fill{fill:var(--s-b)}svg .ser-c .fill{fill:var(--s-c)}svg .band{fill:var(--s-band);opacity:.75}
svg .hl{fill:var(--card-2);opacity:0}svg .row:hover .hl{opacity:1}
:root:has(#vis-b:not(:checked)) .ser-b,:root:has(#vis-c:not(:checked)) .ser-c{display:none}
.check{appearance:none;-webkit-appearance:none;display:inline-grid;place-items:center;width:20px;height:20px;margin:0;border:1px solid var(--line-2);border-radius:7px;background:var(--card);cursor:pointer;vertical-align:-4px}
.check:checked{background:var(--ink);border-color:var(--ink)}
.check:checked::after{content:"";width:10px;height:6px;border:2px solid var(--page);border-top:0;border-right:0;transform:rotate(-45deg) translate(1px,-1px)}
.swatch{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:8px}
.vtag{display:inline-block;margin-left:8px;padding:2px 8px;border-radius:999px;background:var(--blue-soft);color:var(--ink);font:500 12px/1.3 var(--sans)}
.delta{margin-left:8px;font:500 12.5px/1 var(--mono)}.delta.down{color:var(--fail-ink)}.delta.up{color:var(--ok-ink)}
.toolbar{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-bottom:16px}
.seg{display:inline-flex;padding:4px;border-radius:999px;background:var(--card-2);max-width:100%;overflow-x:auto;scrollbar-width:none}
.seg input{position:absolute;opacity:0;pointer-events:none}
.seg label{display:inline-flex;align-items:center;height:36px;padding:0 14px;border-radius:999px;color:var(--ink-2);font:450 14px/1 var(--sans);cursor:pointer;white-space:nowrap;transition:background-color .25s var(--ease),color .25s var(--ease)}
.seg label:hover{color:var(--ink)}
.seg input:checked+label{background:var(--card);color:var(--ink);box-shadow:var(--chip-shadow)}
.seg input:focus-visible+label{outline:2px solid #FF6600;outline-offset:2px}
.seg .c{font:500 12px/1 var(--mono);margin-left:6px;color:var(--ink-3)}
.seg .mono-label{font-family:var(--mono);font-size:12.5px}
.count{margin-left:auto;font:500 12.5px/1 var(--mono);color:var(--ink-2)}
.chip{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;font:500 13px/1.3 var(--sans);white-space:nowrap}
.chip::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}
.chip.ok{background:var(--ok-bg);color:var(--ok-ink)}.chip.fail{background:var(--fail-bg);color:var(--fail-ink)}.chip.skip{background:var(--wait-bg);color:var(--wait-ink)}
.move{display:block;font:500 12.5px/1.3 var(--mono);white-space:nowrap}
.move.down{color:var(--fail-ink)}.move.up{color:var(--ok-ink)}.move.same{color:var(--ink-3)}
td .move{display:inline}
.test{border-top:1px solid var(--line)}
.test>summary{list-style:none;cursor:pointer;display:grid;grid-template-columns:72px minmax(0,1fr) 150px var(--cks) 24px;gap:12px;align-items:center;padding:14px 8px;border-radius:12px;transition:background-color .25s var(--ease)}
.test>summary::-webkit-details-marker{display:none}
.test>summary:hover{background:var(--card-2)}
.test .name{font:500 15.5px/1.35 var(--sans)}
.test .id{font:400 12.5px/1.4 var(--mono);color:var(--ink-2);overflow-wrap:anywhere}
.test .score{font-size:15px;font-variant-numeric:tabular-nums}
.test .score small{display:block;font:400 12.5px/1.3 var(--mono);color:var(--ink-2)}
.chev{width:16px;height:16px;fill:none;stroke:var(--ink-2);stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;transition:transform .25s var(--ease)}
.test[open]>summary .chev,.fold[open]>summary .chev{transform:rotate(180deg)}
.thead{display:grid;grid-template-columns:72px minmax(0,1fr) 150px var(--cks) 24px;gap:12px;padding:0 8px 10px;border-bottom:1px solid var(--ink);align-items:end}
.thead>span,.grid-table th{font:500 12px/1.2 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--ink-2)}
.ckrow{display:grid;grid-template-columns:repeat(var(--nck),64px);gap:4px;justify-content:end}
.cph{font:500 11px/1.2 var(--mono);letter-spacing:.02em;text-align:center;color:var(--ink-2)}
.cp{display:inline-flex;justify-content:center;padding:2px 6px;border-radius:999px;font:500 12.5px/1.4 var(--sans);white-space:nowrap}
.cp.ok{background:var(--ok-bg);color:var(--ok-ink)}.cp.none{background:var(--card-2);color:var(--ink-3);font-size:11.5px}.cp.fail{background:var(--fail-bg);color:var(--fail-ink)}
:root:has(#tf-fail:checked) .test:not(.t-fail),:root:has(#tf-pass:checked) .test:not(.t-pass),:root:has(#tf-reg:checked) .test:not(.t-reg),:root:has(#rf-fail:checked) .run-row:not(.r-fail),:root:has(#rf-pass:checked) .run-row:not(.r-pass){display:none}
.cases{padding:4px 8px 20px 92px}
.grid-table{width:100%;border-collapse:collapse;font:400 14px/1.4 var(--sans);font-variant-numeric:tabular-nums}
.grid-table th{text-align:left;padding:12px 10px 10px;border-bottom:1px solid var(--ink);white-space:nowrap}
.grid-table td{padding:11px 10px;border-bottom:1px solid var(--line);vertical-align:middle}
.grid-table .num{text-align:right}
.link{color:var(--blue);text-decoration:none;font:450 14px/1.3 var(--sans)}.link:hover{text-decoration:underline}
.anchor{display:block;position:relative;top:-16px}
.pill{display:none;align-items:center;gap:8px;height:32px;padding:0 6px 0 12px;border-radius:999px;background:var(--blue-soft);font:450 13.5px/1 var(--sans)}
.pill a{display:grid;place-items:center;width:22px;height:22px;border-radius:50%;color:var(--ink-2)}
.pill svg,.x svg,.chk .m svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.runs tbody tr{position:relative;transition:background-color .25s var(--ease)}
.runs tbody tr:hover{background:var(--card-2)}
.runs td.t{max-width:440px}
.rowlink{color:var(--ink);text-decoration:none;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rowlink::after{content:"";position:absolute;inset:0}
.runs td.t small{display:block;font:400 12.5px/1.3 var(--mono);color:var(--ink-2)}
.sq{display:inline-flex;gap:3px;vertical-align:middle}
.sq i{display:block;width:12px;height:12px;border-radius:3px;background:var(--ok)}
.sq i.f{background:var(--fail)}.sq i.s{background:var(--wait)}.sq i.inj{box-shadow:inset 0 0 0 2px var(--card)}
.firstfail{font:400 12.5px/1.35 var(--mono);color:var(--ink-2)}.firstfail b{font-weight:500;color:var(--fail-ink)}
.scrim{display:none;position:fixed;inset:0;z-index:40;background:rgba(14,17,22,.4)}
#drilldown:has(.drawer:target) .scrim{display:block}
.drawer{display:none;position:fixed;top:0;right:0;bottom:0;z-index:41;width:min(820px,100vw);background:var(--page);box-shadow:-20px 0 50px -20px rgba(0,0,0,.5);flex-direction:column}
.drawer:target{display:flex}
.dh{padding:20px 24px 16px;border-bottom:1px solid var(--line);background:var(--card)}
.dh .row{display:flex;gap:12px;align-items:flex-start}
.dtitle{flex:1;font-family:var(--serif);font-size:24px;line-height:1.15;letter-spacing:-.012em}
.x{display:grid;place-items:center;width:36px;height:36px;flex:none;border-radius:50%;border:1px solid var(--line-2);color:var(--ink)}
.dstatus{margin-top:8px}.open{font-size:13px;margin-left:8px}
.dfacts{display:flex;flex-wrap:wrap;gap:6px 20px;margin-top:12px;font:400 12.5px/1.4 var(--mono);color:var(--ink-2)}
.dfacts b{font-weight:500;color:var(--ink)}
.dtabs{margin-top:16px}
.db{flex:1;overflow:auto;padding:24px}
.pane{display:none}
.drawer:has(.tab-conv:checked) .pane-conv,.drawer:has(.tab-checks:checked) .pane-checks,.drawer:has(.tab-data:checked) .pane-data{display:block}
.blk{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-bottom:12px}
.blk.bad{border-color:color-mix(in srgb,var(--fail) 45%,transparent)}
.bh{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;margin-bottom:12px}.bh .kicker{flex:1}
.stage{font:400 12.5px/1.3 var(--mono);color:var(--ink-2)}.stage.miss{color:var(--fail-ink)}
.who{font:500 11.5px/1 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3);margin:4px 0 6px}.who.r{text-align:right}
.msg{white-space:pre-wrap;overflow-wrap:anywhere;font:400 15px/1.5 var(--sans);padding:10px 14px;max-width:88%;margin:0 0 8px}
.msg.user{background:var(--bubble);color:#fff;border-radius:16px 16px 16px 4px}
.msg.agent{background:var(--card-2);border-radius:16px 16px 4px 16px;margin-left:auto}
.tools{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 8px;justify-content:flex-end}
.tool>summary{list-style:none;cursor:pointer;display:inline-flex;padding:3px 10px;border:1px solid var(--line-2);border-radius:7px;font:400 13px/1.4 var(--mono)}
.tool>summary::-webkit-details-marker{display:none}
.tool.err>summary{border-color:var(--fail);color:var(--fail-ink)}
.tool[open]{flex-basis:100%}
.chk{display:grid;grid-template-columns:20px minmax(0,1fr);gap:10px;padding:8px 0;border-top:1px solid var(--line);font-size:14px}
.chk .m{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;margin-top:1px}
.chk.f .m{background:var(--fail);color:#fff}.chk.p .m{background:var(--ok-bg);color:var(--ok-ink)}.chk.i .m{background:var(--wait-bg);color:var(--wait-ink)}
.chk .cid{font:500 13px/1.4 var(--mono);overflow-wrap:anywhere}
.tag{display:inline-block;padding:1px 8px;border-radius:999px;background:var(--card-2);color:var(--ink-2);font-size:12px}
.chk .ev{color:var(--ink-2);font-size:13.5px;overflow-wrap:anywhere;margin-top:2px}
.fold>summary{list-style:none;cursor:pointer;padding:8px 0;border-top:1px solid var(--line);font-size:14px;color:var(--ink-2);display:flex;align-items:center;gap:8px}
.fold>summary::-webkit-details-marker{display:none}
.ids{margin:0 0 8px;font:400 12.5px/1.5 var(--mono);color:var(--ink-2);overflow-wrap:anywhere}
.kv{display:grid;grid-template-columns:200px minmax(0,1fr);margin:0;font-size:14px}
.kv dt,.kv dd{margin:0;padding:10px 0;border-bottom:1px solid var(--line)}
.kv dt{font:500 12px/1.4 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--ink-2)}
.kv dd{font:400 14px/1.4 var(--mono);overflow-wrap:anywhere}
.empty{padding:16px 0;color:var(--ink-2)}
details.more{background:var(--card);border:1px solid var(--line);border-radius:16px;margin:8px 0}
details.more>summary{cursor:pointer;padding:14px 20px;font:500 15px/1.3 var(--sans)}
details.more>section,details.more>.table-wrap,details.more>p{margin:0 20px 16px}
main>section:not(.zone),details.more>section,details.more>header{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px;margin:16px auto;max-width:1176px}
details.more>section,details.more>header{border:0;padding:0 20px 16px;margin:0}
main>section:not(.zone) h2,details.more h2{font:500 17px/1.3 var(--sans);margin:0 0 8px}
h3{font-size:15px;margin:16px 0 6px}
dl.facts{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px 16px;margin:8px 0 0}
dl.facts dt{color:var(--ink-2);font:500 12px/1.4 var(--mono);text-transform:uppercase;letter-spacing:.08em}dl.facts dd{margin:0}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px}
.tile{border:1px solid var(--line);border-radius:12px;padding:12px}
.tile p{margin:0}.tile-label{color:var(--ink-2);font-size:12.5px}.tile-value{font:400 26px/1.2 var(--serif-text);font-variant-numeric:tabular-nums}
.tile-ci{font-size:12.5px;font-variant-numeric:tabular-nums}.tile-note{color:var(--ink-2);font-size:12.5px}
.verdict{border-radius:12px;padding:10px 12px;margin:0 0 12px}.verdict p{margin:0}.verdict-label{font-weight:600;font-size:16px}
.verdict-non-inferior{background:var(--ok-bg);color:var(--ok-ink)}.verdict-regressed{background:var(--fail-bg);color:var(--fail-ink)}.verdict-unproven{background:var(--wait-bg);color:var(--wait-ink)}
.table-wrap{overflow-x:auto;margin:8px 0}
table{border-collapse:collapse;width:100%;font-size:13.5px}
caption{text-align:left;font-weight:500;padding:4px 0}
th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
th{color:var(--ink-2);font-weight:500;white-space:nowrap}
td.num{font-variant-numeric:tabular-nums;white-space:nowrap;text-align:right}
.ci{color:var(--ink-2);font-size:12px}
pre{font-family:var(--mono);font-size:12.5px;background:var(--card-2);border-radius:12px;padding:10px 12px;margin:6px 0 0;white-space:pre-wrap;word-break:break-word;max-height:320px;overflow:auto}
td.mono{overflow-wrap:anywhere;min-width:12ch}span.mono{overflow-wrap:anywhere}
.evidence{white-space:pre-wrap;max-width:420px;word-break:break-word}
.muted,.note{color:var(--ink-2)}.note{font-size:12.5px}
.row-bad td{background:var(--fail-bg)}.row-warn td{background:var(--wait-bg)}.row-total td{font-weight:600}
.bad{color:var(--fail-ink)}
svg.bar{display:block;width:96px;height:6px;margin-top:2px}svg.bar.wide{display:inline-block;width:160px;vertical-align:middle}
.bar-track{fill:var(--track)}.bar-ci{fill:var(--ci)}.bar-pt{fill:var(--pt)}
table.compact{width:auto}
ul.stats,.reasons{margin:8px 0;padding-left:20px}
details.run{border:1px solid var(--line);border-radius:12px;padding:6px 10px;margin:6px 0}
details.run>summary{cursor:pointer}
.run-facts{color:var(--ink-2);margin:6px 0}
.badge{display:inline-block;border-radius:999px;padding:0 8px;font-size:12px;font-weight:500}
.badge.ok{background:var(--ok-bg);color:var(--ok-ink)}.badge.bad{background:var(--fail-bg);color:var(--fail-ink)}.badge.skip{background:var(--wait-bg);color:var(--wait-ink)}
.block{border-left:3px solid var(--line);padding:4px 0 4px 10px;margin:10px 0}
.block-fail{border-left-color:var(--fail)}.block-pass{border-left-color:var(--ok)}.block-skip{border-left-color:var(--wait)}
.block-head{margin:0 0 4px}.label{margin:6px 0 2px;color:var(--ink-2);font-size:12.5px}.passed{margin:6px 0;font-size:12.5px;word-break:break-word}
.call{margin:4px 0}.call p{margin:0 0 2px}
nav.top{display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center;max-width:1176px;margin:0 auto;padding:16px var(--gutter)}nav.top a{text-decoration:none}
.labels{border-top:1px dashed var(--line);margin-top:8px;padding-top:6px}.labels form{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.labels select,.labels input,.labels button{font:inherit;padding:4px 6px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--ink);max-width:100%}.labels input[name=note]{flex:1 1 180px;min-width:0}
.saved{background:var(--ok-bg);color:var(--ok-ink);border-radius:8px;padding:8px 12px}
@media (max-width:980px){.charts{grid-template-columns:1fr}}
@media (max-width:760px){.stat-row{grid-template-columns:1fr;gap:20px}.glass{padding:20px}.card{padding:16px;border-radius:20px}.test>summary,.thead{grid-template-columns:72px minmax(0,1fr) 24px}.hide-s{display:none}.cases{padding:4px 0 16px}.kv{grid-template-columns:1fr}.kv dt{border-bottom:0;padding-bottom:0}.msg{max-width:100%}.path-end{margin-left:0}}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;
