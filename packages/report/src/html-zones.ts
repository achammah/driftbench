import {
  type BlockStatus,
  blockStatus,
  isScored,
  type RunMode,
  type Verdict,
} from '@agent-nexus/driftbench-core';
import { parentCausesHtml } from './causes';
import { criterionOf } from './compare';
import { showTarget } from './data';
import {
  count,
  esc,
  fixed,
  historyNormalizationsHtml,
  json,
  pct,
  pValue,
  runDetailStatus,
  unscoredReason,
  unscoredRuns,
  usd,
} from './format';
import type { ReliabilityLine } from './reliability';
import { type BlockDetail, notStored, type RunDetail, type Scorecard } from './scorecard';

/*
 * The three zones that open the scorecard page: the numbers and charts, the tests, the runs with a detail
 * panel per run. Plain HTML and CSS: the filters are radio buttons, the version switches are checkboxes, a
 * run's panel opens on its own address (`#run-<id>`), so the page needs no script.
 */

const MODE_NAMES: Record<RunMode, string> = { T: 'Teacher-forced', F: 'Free-running', P: 'Perturbed' };

const MODE_TIPS: Record<RunMode, string> = {
  T: "Teacher-forced: each block starts from the spec, never from the agent's earlier replies.",
  F: "Free-running: one session; each block inherits the agent's own earlier replies.",
  P: 'Perturbed: a free-running run with one deviation injected before a chosen block.',
};

/** One golden on one target: a spec in one mode, with one perturbation in P. */
type CaseView = {
  index: number;
  unit: string;
  specId: string;
  target: string;
  mode: RunMode;
  perturbationId?: string;
  deviation?: string;
  runs: RunDetail[];
  runCount: number;
  runsPassing: number;
  pass: boolean;
  baseline?: boolean;
  failedChecks: Map<string, number>;
};

type TestView = {
  index: number;
  specId: string;
  target: string;
  title: string;
  cases: CaseView[];
  casesPassing: number;
  casesBaseline: number;
  regressed: number;
  improved: number;
  runs: number;
  runsPassing: number;
  failedChecks: Map<string, number>;
  /** Runs of this test in the drilldown; fewer than `runs` when the run limit left some out. */
  shownRuns: number;
};

export type PageModel = {
  card: Scorecard;
  cases: CaseView[];
  tests: TestView[];
  /** Check families that fail somewhere in the shown runs, most failures first. */
  checkColumns: string[];
  failedByCheck: Map<string, number>;
  /** Scored blocks (passed or failed) of the shown runs; a block not run or blocked is counted apart. */
  blocks: number;
  blocksPassing: number;
  blocksUnscored: number;
  checks: number;
  checksFailed: number;
};

function unitOf(specId: string, mode: RunMode, perturbationId: string | undefined): string {
  return `${specId} · ${mode}${perturbationId === undefined ? '' : ` · ${perturbationId}`}`;
}

function add(map: Map<string, number>, key: string, n = 1): void {
  map.set(key, (map.get(key) ?? 0) + n);
}

/** What the three zones read, derived once from the scorecard. */
export function pageModel(card: Scorecard): PageModel {
  const pairs = new Map((card.compare?.pairs ?? []).map((pair) => [pair.unit, pair]));
  const titles = new Map<string, string>();
  for (const run of card.drilldown) if (run.title) titles.set(run.specId, run.title);
  const cases: CaseView[] = card.lines.map((line: ReliabilityLine, index) => {
    const target = showTarget(line.target);
    const unit = unitOf(line.specId, line.mode, line.perturbationId);
    const runs = card.drilldown.filter(
      (run) =>
        run.specId === line.specId &&
        run.mode === line.mode &&
        run.perturbationId === line.perturbationId &&
        run.target === target,
    );
    const failedChecks = new Map<string, number>();
    for (const run of runs)
      for (const block of run.blocks)
        for (const v of block.verdicts) if (v.outcome === 'fail') add(failedChecks, criterionOf(v));
    // compare names a unit by its target too when the campaign runs the golden on more than one target.
    const baseline = (pairs.get(`${unit} · ${target}`) ?? pairs.get(unit))?.baseline.allPass;
    return {
      index,
      unit,
      specId: line.specId,
      target,
      mode: line.mode,
      ...(line.perturbationId === undefined ? {} : { perturbationId: line.perturbationId }),
      ...(line.deviation === undefined ? {} : { deviation: line.deviation }),
      runs,
      runCount: line.runs,
      runsPassing: line.passRate.k,
      pass: line.runs > 0 && line.passRate.k === line.runs,
      ...(baseline === undefined ? {} : { baseline }),
      failedChecks,
    };
  });
  const keys = [...new Set(cases.map((c) => `${c.specId}\u0000${c.target}`))];
  const tests: TestView[] = keys.map((key, index) => {
    const own = cases.filter((c) => `${c.specId}\u0000${c.target}` === key);
    const first = own[0] as CaseView;
    const failedChecks = new Map<string, number>();
    for (const c of own) for (const [name, n] of c.failedChecks) add(failedChecks, name, n);
    return {
      index,
      specId: first.specId,
      target: first.target,
      title: titles.get(first.specId) ?? first.specId,
      cases: own,
      casesPassing: own.filter((c) => c.pass).length,
      casesBaseline: own.filter((c) => c.baseline === true).length,
      regressed: own.filter((c) => c.baseline === true && !c.pass).length,
      improved: own.filter((c) => c.baseline === false && c.pass).length,
      runs: own.reduce((n, c) => n + c.runCount, 0),
      runsPassing: own.reduce((n, c) => n + c.runsPassing, 0),
      failedChecks,
      shownRuns: own.reduce((n, c) => n + c.runs.length, 0),
    };
  });
  const failedByCheck = new Map<string, number>();
  let blocks = 0;
  let blocksPassing = 0;
  let blocksUnscored = 0;
  let checks = 0;
  let checksFailed = 0;
  for (const run of card.drilldown) {
    for (const block of run.blocks) {
      // A block not run or blocked is no measurement: out of the rate, counted beside it.
      if (!isScored(block)) {
        blocksUnscored += 1;
        continue;
      }
      blocks += 1;
      if (blockStatus(block) === 'pass') blocksPassing += 1;
      for (const v of block.verdicts) {
        checks += 1;
        if (v.outcome === 'fail') {
          checksFailed += 1;
          add(failedByCheck, criterionOf(v));
        }
      }
    }
  }
  const checkColumns = [...failedByCheck.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);
  return {
    card,
    cases,
    tests,
    checkColumns,
    failedByCheck,
    blocks,
    blocksPassing,
    blocksUnscored,
    checks,
    checksFailed,
  };
}

function caseLabel(c: { mode: RunMode; perturbationId?: string }): string {
  return `${MODE_NAMES[c.mode]}${c.perturbationId === undefined ? '' : `: ${c.perturbationId}`}`;
}

function chip(pass: boolean): string {
  return `<span class="chip ${pass ? 'ok' : 'fail'}">${pass ? 'Pass' : 'Fail'}</span>`;
}

/** The chip of a run (its `outcome`) or a block (its `status`): Pass, Fail, or Not run and Blocked, which are neither. */
function chipOf(status: BlockStatus): string {
  if (status === 'pass' || status === 'fail') return chip(status === 'pass');
  return `<span class="chip skip">${status === 'not_run' ? 'Not run' : 'Blocked'}</span>`;
}

/** A block that failed: not one that was not run or blocked. */
function blockFailed(block: BlockDetail): boolean {
  return blockStatus(block) === 'fail';
}

/** A run that failed: not one whose outcome is not run or blocked. */
function runFailed(run: RunDetail): boolean {
  return runDetailStatus(run) === 'fail';
}

function move(baseline: boolean | undefined, now: boolean): string {
  if (baseline === undefined) return '<span class="move same">no baseline</span>';
  if (baseline === now) return `<span class="move same">${now ? 'pass' : 'fail'}, unchanged</span>`;
  return `<span class="move ${now ? 'up' : 'down'}">${baseline ? 'pass' : 'fail'} → ${now ? 'pass' : 'fail'}</span>`;
}

const ICON_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
const ICON_CHEV = '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const ICON_OK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const ICON_Q =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17h.01M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/></svg>';

/* ---------- zone 1: numbers ---------- */

/** The campaign name, its facts, and the three numbers on glass. */
export function overview(m: PageModel): string {
  const card = m.card;
  const c = card.campaign;
  const compare = card.compare;
  const casesPassing = m.cases.filter((x) => x.pass).length;
  // The run rate is over the runs that passed or failed: one not run or blocked is counted beside it.
  const scored = c.runs - (c.notRun ?? 0) - (c.blocked ?? 0);
  const third = compare
    ? `<div class="stat"><p class="n">${compare.allPass.table.regressed}<small>of ${compare.pairs.length}</small></p><a class="l" href="#tests">Cases regressed vs baseline</a><p class="s">${compare.allPass.table.improved} improved · McNemar p = ${esc(pValue(compare.allPass.mcnemar.pValue))}</p></div>`
    : `<div class="stat"><p class="n">${m.blocksPassing}<small>of ${m.blocks}</small></p><span class="l">Blocks passing</span><p class="s">${esc(pct(m.blocks === 0 ? 0 : m.blocksPassing / m.blocks))} · ${m.checksFailed} checks failed${m.blocksUnscored > 0 ? ` · ${m.blocksUnscored} not run or blocked` : ''}</p></div>`;
  const facts = [
    ...(compare ? [['Baseline', compare.baseline.campaignId]] : []),
    ['Created', c.createdAt.slice(0, 16).replace('T', ' ')],
    ['Targets', String(c.targets.length)],
    ['Modes', c.modes.join(', ')],
    ['Spent', usd(card.cost.totalUsd)],
  ];
  return `<header class="hero">
<div class="wrap">
<div class="top"><label class="theme-btn" for="theme-light"><span class="to-light">Light</span><span class="to-dark">Dark</span></label></div>
<p class="kicker">Campaign</p>
<h1>${esc(c.campaignId)}</h1>
<p class="facts">${facts.map(([k, v]) => `<span>${esc(k as string)} <b>${esc(v as string)}</b></span>`).join('')}</p>
<div class="glass">
<div class="stat-row">
<div class="stat"><p class="n">${casesPassing}<small>of ${m.cases.length}</small></p><a class="l" href="#tests">Cases passing</a><p class="s">${esc(pct(m.cases.length === 0 ? 0 : casesPassing / m.cases.length))}${compare ? ` · baseline ${compare.allPass.baseline.k} of ${compare.allPass.baseline.n}` : ''}</p></div>
<div class="stat"><p class="n">${c.passing}<small>of ${scored}</small></p><a class="l" href="#drilldown">Runs passing</a><p class="s">${esc(pct(scored === 0 ? 0 : c.passing / scored))} · ${c.failing} failed · ${unscoredRuns(c, ' · ')}${c.broken} did not complete</p></div>
${third}
</div>
<p class="path"><span><b>${m.tests.length}</b> tests</span><i>›</i><span><b>${m.cases.length}</b> cases</span><i>›</i><span><b>${c.runs}</b> runs</span><i>›</i><span><b>${m.blocks}</b> blocks</span><i>›</i><span><b>${m.checks}</b> checks</span><span class="path-end">${m.blocksPassing} of ${m.blocks} blocks pass${m.blocksUnscored > 0 ? `, ${m.blocksUnscored} not run or blocked` : ''} · ${m.checksFailed} checks failed${card.omittedRuns > 0 ? ` · ${count(card.omittedRuns, 'run')} beyond the run limit not counted here` : ''}</span></p>
</div>
</div>
</header>`;
}

/** Baseline and candidate side by side, each with a switch that draws it in the charts. Empty without a baseline. */
export function versionsZone(m: PageModel): string {
  const compare = m.card.compare;
  if (!compare) return '';
  const all = compare.allPass;
  const delta = all.candidate.k - all.baseline.k;
  const driftDelta = compare.drift.candidateMean - compare.drift.baselineMean;
  const signed = (n: number, digits: number, worseUp: boolean) => {
    const text = fixed(Math.abs(n), digits);
    if (Number(text) === 0) return '';
    const bad = worseUp ? n > 0 : n < 0;
    return `<span class="delta ${bad ? 'down' : 'up'}">${n > 0 ? '+' : '-'}${text}</span>`;
  };
  const row = (side: 'b' | 'c') => {
    const base = side === 'b';
    const id = base ? compare.baseline.campaignId : compare.candidate.campaignId;
    const targets = base ? compare.baseline.targets : compare.candidate.targets;
    const k = base ? all.baseline : all.candidate;
    const drift = base ? compare.drift.baselineMean : compare.drift.candidateMean;
    return `<tr><td><input class="check" type="checkbox" id="vis-${side}" checked aria-label="Draw ${esc(id)} in the charts"></td><td class="nowrap"><span class="swatch ser-${side}-fill"></span><span class="mono">${esc(id)}</span><span class="vtag">${base ? 'Baseline' : 'Candidate'}</span></td><td class="mono small soft">${targets.map(esc).join('<br>')}</td><td class="num">${k.k} of ${k.n}${base ? '' : signed(delta, 0, false)}</td><td class="num">${esc(fixed(drift, 2))}${base ? '' : signed(driftDelta, 2, true)}</td></tr>`;
  };
  return `<section class="zone wrap" id="versions" aria-labelledby="h-versions">
<div class="zone-h"><h2 id="h-versions">Versions</h2><span class="kicker">Tick a version to draw it in the charts</span></div>
<div class="card tight"><div class="table-wrap"><table class="grid-table">
<thead><tr><th scope="col"></th><th scope="col">Campaign</th><th scope="col">Targets</th><th scope="col" class="num">Cases passing</th><th scope="col" class="num">Drifting blocks per case</th></tr></thead>
<tbody>
${row('b')}
${row('c')}
</tbody></table></div></div>
</section>`;
}

/* ---------- zone 1: charts ---------- */

type Bar = { side: 'b' | 'c'; value: number; label: string; lo?: number; hi?: number };
type ChartRow = { label: string; tip: string; bars: Bar[] };

/** Horizontal bars, one group per row, sides drawn in their series colour; the native tip names the numbers. */
function barChart(
  label: string,
  rows: ChartRow[],
  max: number,
  ticks: number[],
  unit: string,
  interval = false,
): string {
  const W = 360;
  const L = 150;
  const R = 46;
  const bar = interval ? 12 : 10;
  const gap = 4;
  const pad = 8;
  const sides = Math.max(1, ...rows.map((r) => r.bars.length));
  const rowH = pad * 2 + sides * bar + (sides - 1) * gap;
  const top = 4;
  const H = top + rows.length * rowH + 30;
  const x = (v: number) => L + (Math.max(0, Math.min(max, v)) / max) * (W - L - R);
  const f = (v: number) => fixed(v, 1);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">`;
  for (const t of ticks)
    s += `<line class="gridline" x1="${f(x(t))}" x2="${f(x(t))}" y1="${top}" y2="${H - 26}"/><text class="tick" x="${f(x(t))}" y="${H - 12}" text-anchor="middle">${esc(`${t}${unit}`)}</text>`;
  rows.forEach((r, i) => {
    const y0 = top + i * rowH;
    s += `<g class="row"><title>${esc(r.tip)}</title><rect class="hl" x="0" y="${y0}" width="${W}" height="${rowH}" rx="6"/><text class="lab" x="${L - 10}" y="${f(y0 + rowH / 2 + 4)}" text-anchor="end">${esc(r.label)}</text>`;
    r.bars.forEach((b, j) => {
      const y = y0 + pad + j * (bar + gap);
      if (interval && b.lo !== undefined && b.hi !== undefined) {
        s += `<g class="ser-${b.side}"><rect class="band" x="${f(x(b.lo))}" y="${y + 2}" width="${f(Math.max(1, x(b.hi) - x(b.lo)))}" height="${bar - 4}" rx="2"/><rect class="fill" x="${f(x(b.value) - 1.5)}" y="${y - 1}" width="3" height="${bar + 2}" rx="1"/><text class="val" x="${f(x(b.hi) + 6)}" y="${y + bar - 2}">${esc(b.label)}</text></g>`;
      } else {
        s += `<g class="ser-${b.side}"><rect class="fill" x="${L}" y="${y}" width="${f(Math.max(0, x(b.value) - L))}" height="${bar}" rx="3"/><text class="val" x="${f(x(b.value) + 6)}" y="${y + bar - 1}">${esc(b.label)}</text></g>`;
      }
    });
    s += '</g>';
  });
  return `${s}<line class="axis" x1="${L}" x2="${L}" y1="${top}" y2="${H - 26}"/></svg>`;
}

function shortName(specId: string): string {
  return specId.length > 20 ? `${specId.slice(0, 19)}.` : specId;
}

export function chartsZone(m: PageModel): string {
  const compare = m.card.compare;
  const tests = [...m.tests].sort(
    (a, b) =>
      b.casesPassing / Math.max(1, b.cases.length) - a.casesPassing / Math.max(1, a.cases.length) ||
      a.specId.localeCompare(b.specId),
  );
  const c1 = barChart(
    'Cases passing by test',
    tests.map((t) => {
      const n = t.cases.length;
      const bars: Bar[] = [];
      if (compare)
        bars.push({ side: 'b', value: (t.casesBaseline / n) * 100, label: `${t.casesBaseline}/${n}` });
      bars.push({ side: 'c', value: (t.casesPassing / n) * 100, label: `${t.casesPassing}/${n}` });
      return {
        label: shortName(t.specId),
        tip: `${t.title}: ${t.casesPassing} of ${n} cases pass${compare ? `, baseline ${t.casesBaseline} of ${n}` : ''}`,
        bars,
      };
    }),
    100,
    [0, 50, 100],
    '%',
  );
  const c2 = barChart(
    'Runs passing by mode, with the 95% interval',
    m.card.modes.flatMap((mode) => {
      const r = mode.runPass;
      if (!r) return [];
      return {
        label: MODE_NAMES[mode.mode],
        tip: `${MODE_TIPS[mode.mode]} Runs passing ${pct(r.estimate)} of ${mode.runs}, interval ${pct(r.lower)} to ${pct(r.upper)}.`,
        bars: [
          {
            side: 'c',
            value: r.estimate * 100,
            lo: r.lower * 100,
            hi: r.upper * 100,
            label: pct(r.estimate),
          },
        ],
      };
    }),
    100,
    [0, 50, 100],
    '%',
    true,
  );
  const failed = [...m.failedByCheck.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const most = Math.max(1, ...failed.map(([, n]) => n));
  const step = most > 150 ? 100 : most > 60 ? 50 : most > 20 ? 10 : most > 5 ? 5 : 1;
  const top = Math.ceil(most / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  const c3 =
    failed.length === 0
      ? '<p class="empty">No check failed in the shown runs.</p>'
      : barChart(
          'Failed checks by type',
          failed.map(([name, n]) => ({
            label: name,
            tip: `${name}: ${n} failed checks over ${m.card.drilldown.length} runs`,
            bars: [{ side: 'c', value: n, label: String(n) }],
          })),
          top,
          ticks,
          '',
        );
  const legend = (sides: Array<'b' | 'c'>, extra = '') =>
    `<p class="legend">${sides.map((side) => `<span class="ser-${side}"><i class="ser-${side}-fill"></i>${side === 'b' ? 'Baseline' : 'Candidate'}</span>`).join('')}${extra}</p>`;
  return `<section class="zone wrap" id="charts" aria-labelledby="h-charts">
<div class="zone-h"><h2 id="h-charts">Pass rates</h2><span class="kicker">Hover a bar for its numbers</span></div>
<div class="charts">
<figure class="card chart"><h3>Cases passing by test <span>% of cases</span></h3>${c1}${legend(compare ? ['b', 'c'] : ['c'])}<figcaption>x: cases passing, every run passes · y: test · ${m.cases.length} cases</figcaption></figure>
<figure class="card chart"><h3>Runs passing by mode <span>% of runs</span></h3>${c2}${legend(['c'], '<span><i class="band-fill"></i>95% interval</span>')}<figcaption>x: runs passing · y: mode · ${m.card.campaign.runs} runs</figcaption></figure>
<figure class="card chart"><h3>Failed checks by type <span>checks</span></h3>${c3}<figcaption>x: failed checks · y: check type · ${m.checksFailed} of ${m.checks} checks · ${m.card.drilldown.length} runs</figcaption></figure>
</div>
</section>`;
}

/* ---------- zone 2: tests ---------- */

const MAX_COLUMNS = 6;
const OTHER = '\u0000other';

/** A check name that can break after an underscore, so a long one wraps instead of being cut. */
function breakable(name: string): string {
  return esc(name).replace(/_/g, '_<wbr>');
}

export function testsZone(m: PageModel): string {
  const compare = m.card.compare;
  const failing = m.tests.filter((t) => t.casesPassing < t.cases.length);
  const regressed = m.tests.filter((t) => t.regressed > 0);
  const targets = [...new Set(m.tests.map((t) => t.target))];
  // At most six check columns stay readable beside the test name; the rest share one "other" column.
  const shown = m.checkColumns.slice(0, m.checkColumns.length > MAX_COLUMNS ? MAX_COLUMNS - 1 : MAX_COLUMNS);
  const rest = m.checkColumns.slice(shown.length);
  const cols = rest.length > 0 ? [...shown, OTHER] : shown;
  const tabs = [
    ['all', 'All', m.tests.length],
    ['fail', 'Failing', failing.length],
    ['pass', 'Passing', m.tests.length - failing.length],
    ...(compare ? [['reg', 'Regressed', regressed.length]] : []),
  ] as Array<[string, string, number]>;
  const seg = `<div class="seg" role="radiogroup" aria-label="Show tests">${tabs
    .map(
      ([key, label, n]) =>
        `<input type="radio" name="tf" id="tf-${key}"${key === 'all' ? ' checked' : ''}><label for="tf-${key}">${label}<span class="c">${n}</span></label>`,
    )
    .join('')}</div>`;
  const targetSeg =
    targets.length > 1
      ? `<div class="seg" role="radiogroup" aria-label="Target"><input type="radio" name="tt" id="tt-all" checked><label for="tt-all">All targets</label>${targets
          .map(
            (t, i) =>
              `<input type="radio" name="tt" id="tt-${i}"><label for="tt-${i}" class="mono-label">${esc(t)}</label>`,
          )
          .join('')}</div>`
      : '';
  const targetCss =
    targets.length > 1
      ? `<style>${targets.map((_, i) => `:root:has(#tt-${i}:checked) .test:not(.tt-${i}){display:none}`).join('')}</style>`
      : '';
  const head = `<div class="thead" aria-hidden="true"><span>Status</span><span>Test</span><span class="hide-s">Score</span><span class="ckrow hide-s">${cols
    .map((n) =>
      n === OTHER
        ? `<span class="cph" title="${esc(rest.join(', '))}">other</span>`
        : `<span class="cph">${breakable(n)}</span>`,
    )
    .join('')}</span><span></span></div>`;
  const rows = [...m.tests]
    .sort(
      (a, b) =>
        a.casesPassing / Math.max(1, a.cases.length) - b.casesPassing / Math.max(1, b.cases.length) ||
        a.specId.localeCompare(b.specId),
    )
    .map((t) => {
      const pass = t.casesPassing === t.cases.length;
      const classes = [
        'test',
        pass ? 't-pass' : 't-fail',
        t.regressed > 0 ? 't-reg' : '',
        `tt-${targets.indexOf(t.target)}`,
      ]
        .filter(Boolean)
        .join(' ');
      const change = compare
        ? t.regressed > 0
          ? `<span class="move down">${t.regressed} regressed</span>`
          : t.improved > 0
            ? `<span class="move up">${t.improved} improved</span>`
            : '<span class="move same">unchanged</span>'
        : '';
      const pills = cols
        .map((name) => {
          const n =
            name === OTHER
              ? rest.reduce((sum, other) => sum + (t.failedChecks.get(other) ?? 0), 0)
              : (t.failedChecks.get(name) ?? 0);
          const label = name === OTHER ? rest.join(', ') : name;
          if (n === 0 && t.shownRuns < t.runs)
            return `<span class="cp none" title="${esc(label)}: ${t.runs - t.shownRuns} of ${t.runs} runs left out by the run limit">not shown</span>`;
          return `<span class="cp ${n > 0 ? 'fail' : 'ok'}" title="${esc(label)}: ${n > 0 ? `${n} failed checks` : 'no failed check'}">${n > 0 ? `Fail ${n}` : 'Pass'}</span>`;
        })
        .join('');
      const caseRows = t.cases
        .map((c) => {
          const failed = [...c.failedChecks.entries()].sort(
            (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
          );
          return `<tr><td><span title="${esc(MODE_TIPS[c.mode])}${c.deviation ? ` Deviation ${esc(c.deviation)}.` : ''}">${esc(caseLabel(c))}</span></td><td class="num">${c.runsPassing} of ${c.runCount}</td>${compare ? `<td>${move(c.baseline, c.pass)}</td>` : ''}<td class="mono small hide-s">${failed.length > 0 ? failed.map(([n, k]) => `${esc(n)} ${k}`).join(', ') : '<span class="soft">none</span>'}</td><td class="num"><a class="link" href="#case-${c.index}">Runs</a></td></tr>`;
        })
        .join('\n');
      return `<details class="${classes}"><summary>${chip(pass)}<div><p class="name">${esc(t.title)}</p><p class="id">${esc(t.specId)} · ${esc(t.target)}</p></div><div class="score hide-s">${t.casesPassing} of ${t.cases.length} cases<small>${t.runsPassing} of ${t.runs} runs</small>${change}</div><span class="ckrow hide-s">${pills}</span>${ICON_CHEV}</summary>
<div class="cases"><div class="table-wrap"><table class="grid-table"><thead><tr><th scope="col">Case</th><th scope="col" class="num">Runs passing</th>${compare ? '<th scope="col">Vs baseline</th>' : ''}<th scope="col" class="hide-s">Failed checks</th><th scope="col"></th></tr></thead><tbody>
${caseRows}
</tbody></table></div></div></details>`;
    })
    .join('\n');
  const n = cols.length;
  return `<section class="zone wrap" id="tests" aria-labelledby="h-tests" style="--nck:${n};--cks:${n * 64 + Math.max(0, n - 1) * 4}px">
<div class="zone-h"><h2 id="h-tests">Tests</h2><span class="kicker">${failing.length} of ${m.tests.length} failing</span></div>
<div class="card">
${targetCss}<div class="toolbar">${seg}${targetSeg}</div>
${head}
<div class="tests">
${rows}
</div>
</div>
</section>`;
}

/* ---------- zone 3: runs and their panels ---------- */

function squares(run: RunDetail): string {
  const failing = run.blocks.filter(blockFailed).length;
  return `<span class="sq" title="${count(run.blocks.length, 'block')}, ${failing} failing">${run.blocks
    .map(
      (b) =>
        `<i class="${{ pass: '', fail: 'f', not_run: 's', blocked: 's' }[blockStatus(b)]}${b.specBlock === undefined ? ' inj' : ''}"></i>`,
    )
    .join('')}</span>`;
}

function firstFail(run: RunDetail): { block: BlockDetail; verdict: Verdict } | undefined {
  for (const block of run.blocks)
    for (const verdict of block.verdicts)
      if (verdict.outcome === 'fail' && verdict.gating) return { block, verdict };
  return undefined;
}

function caseOf(m: PageModel, run: RunDetail): CaseView | undefined {
  return m.cases.find((c) => c.runs.includes(run));
}

export type RunPanelOptions = {
  /** The address of a run's own page; each panel then links to it. */
  runHref?: (runId: string) => string;
  /** The table of a run's verdicts with evidence, as the detailed drilldown draws it. */
  verdictTable: (rows: Verdict[]) => string;
  /** Where a verdict stopped the run, when one did. */
  stopped: (run: RunDetail) => string;
};

export function runsZone(m: PageModel, options: RunPanelOptions): string {
  const runs = m.card.drilldown;
  const failing = runs.filter(runFailed).length;
  const latency = runs.some((r) => r.latencyMs > 0);
  const rows = runs
    .map((run) => {
      const c = caseOf(m, run);
      const test = c ? m.tests.find((t) => t.cases.includes(c)) : undefined;
      const ff = firstFail(run);
      return `<tr class="run-row ${{ pass: 'r-pass', fail: 'r-fail', not_run: 'r-skip', blocked: 'r-skip' }[runDetailStatus(run)]}${c ? ` c-${c.index}` : ''}"><td>${chipOf(runDetailStatus(run))}</td><td class="t"><a class="rowlink" href="#run-${esc(run.runId)}">${esc(test?.title ?? run.title ?? run.specId)}</a><small>${esc(c ? caseLabel(c) : run.mode)} · repeat ${run.repeat}</small></td><td class="hide-s">${squares(run)}</td><td class="hide-s"><span class="firstfail">${ff ? `<b>${esc(ff.verdict.id)}</b> · block ${ff.block.index}` : 'none'}</span></td>${latency ? `<td class="num hide-s">${esc(fixed(run.latencyMs, 0))} ms</td>` : ''}</tr>`;
    })
    .join('\n');
  // A case filter is an address: "#case-3" shows the runs of case 3, with a pill that clears it.
  const caseCss = m.cases
    .map(
      (c) =>
        `#drilldown:has(#case-${c.index}:target) .run-row:not(.c-${c.index}){display:none}#drilldown:has(#case-${c.index}:target) .pill-${c.index}{display:inline-flex}`,
    )
    .join('');
  const anchors = m.cases.map((c) => `<span class="anchor" id="case-${c.index}"></span>`).join('');
  const pills = m.cases
    .map(
      (c) =>
        `<span class="pill pill-${c.index}">Case: ${esc(m.tests.find((t) => t.cases.includes(c))?.title ?? c.specId)}, ${esc(caseLabel(c))}<a href="#drilldown">${ICON_X}<span class="sr">Clear the case filter</span></a></span>`,
    )
    .join('');
  const seg = `<div class="seg" role="radiogroup" aria-label="Show runs"><input type="radio" name="rf" id="rf-all" checked><label for="rf-all">All<span class="c">${runs.length}</span></label><input type="radio" name="rf" id="rf-fail"><label for="rf-fail">Failed<span class="c">${failing}</span></label><input type="radio" name="rf" id="rf-pass"><label for="rf-pass">Passed<span class="c">${runs.filter((r) => runDetailStatus(r) === 'pass').length}</span></label></div>`;
  return `<section id="drilldown">
<div class="zone wrap">
<style>${caseCss}</style>
${anchors}
<div class="zone-h"><h2 id="h-runs">Runs</h2><span class="kicker">Click a row for the conversation and its checks</span></div>
<div class="card">
<div class="toolbar">${seg}${pills}<span class="count">${count(runs.length, 'run')}${m.card.omittedRuns > 0 ? `, ${count(m.card.omittedRuns, 'more run')} left out by the run limit` : ''}</span></div>
<div class="table-wrap"><table class="grid-table runs">
<thead><tr><th scope="col">Status</th><th scope="col">Test and case</th><th scope="col" class="hide-s">Blocks</th><th scope="col" class="hide-s">First failed check</th>${latency ? '<th scope="col" class="num hide-s">Latency</th>' : ''}</tr></thead>
<tbody>
${rows}
</tbody></table></div>
</div>
</div>
<a class="scrim" href="#drilldown"><span class="sr">Close the run</span></a>
${runs.map((run) => runPanel(m, run, options)).join('\n')}
</section>`;
}

function verdictRow(v: Verdict): string {
  const cls = v.outcome === 'fail' ? 'f' : v.outcome === 'inconclusive' ? 'i' : 'p';
  const icon = v.outcome === 'fail' ? ICON_X : v.outcome === 'inconclusive' ? ICON_Q : ICON_OK;
  const votes = v.judge?.votes ?? [];
  const reasoning = [
    ...(v.reasoning ? [v.reasoning] : []),
    ...votes.map((vote) => `${vote.judge}: ${vote.outcome}${vote.reasoning ? `. ${vote.reasoning}` : ''}`),
  ];
  return `<div class="chk ${cls}"><span class="m">${icon}</span><div><span class="cid">${esc(v.id)}</span> <span class="tag">${esc(v.kind)}${v.gating ? ', gating' : ', not gating'}</span>${v.evidence ? `<p class="ev">${esc(v.evidence)}</p>` : ''}${reasoning.length > 0 ? `<p class="ev">${esc(reasoning.join(' '))}</p>` : ''}</div></div>`;
}

function blockView(block: BlockDetail): string {
  // Every check that did not pass and every judged one in full; the machine checks that passed by id only.
  const shown = block.verdicts.filter((v) => v.outcome !== 'pass' || v.kind === 'judge');
  const passed = block.verdicts.filter((v) => v.outcome === 'pass' && v.kind !== 'judge');
  const exp = block.expectedStage;
  const obs = block.observedStage;
  const stage =
    exp === undefined && obs === undefined
      ? ''
      : exp === obs
        ? `<span class="stage">stage ${esc(exp ?? 'none')}</span>`
        : `<span class="stage miss">expected ${esc(exp ?? 'none')}, reached ${esc(obs ?? 'none')}</span>`;
  const note = block.rejudged
    ? `<p class="stage">Re-judged: ${esc(block.rejudged.criteria.join(', '))}; observations from ${esc(block.rejudged.fromCampaign)}.</p>`
    : block.carried
      ? `<p class="stage">carried from ${esc(block.carried.fromCampaign)}</p>`
      : '';
  const tools =
    block.toolCalls.length === 0
      ? ''
      : `<div class="tools">${block.toolCalls
          .map(
            (call) =>
              `<details class="tool${call.error ? ' err' : ''}"><summary>${esc(call.label)}${call.error ? ` · ${esc(call.error)}` : ''}</summary><pre>${esc(json({ input: call.input, output: call.output }, 1200))}</pre></details>`,
          )
          .join('')}</div>`;
  const reason = unscoredReason(block);
  return `<div class="blk${{ pass: '', fail: ' bad', not_run: ' skip', blocked: ' skip' }[blockStatus(block)]}">
<p class="bh"><span class="kicker">Block ${block.index}${block.specBlock === undefined ? ' · injected' : ''}</span>${stage}${chipOf(blockStatus(block))}</p>
${note}${block.parent === undefined ? '' : `<p class="stage">Parent: ${esc(block.parent)}</p>`}${historyNormalizationsHtml(block.historyNormalizations)}${reason === undefined ? '' : `<p class="stage">${esc(reason)}</p>`}${block.stimulus === undefined ? '' : `<p class="who">${block.realized === undefined ? 'User' : 'User, as written'}</p><p class="msg user">${esc(block.stimulus)}</p>`}${block.realized === undefined ? '' : `<p class="who">User, as sent</p><p class="msg user">${esc(block.realized.text ?? notStored(block.realized.hash))}</p>`}
<p class="who r">Agent · ${esc(fixed(block.latencyMs, 0))} ms</p><p class="msg agent">${esc(block.text || '(no text)')}</p>
${tools}${block.drift.length > 0 ? `<p class="stage">drift ${esc(block.drift.join(', '))}</p>` : ''}${shown.map(verdictRow).join('')}${passed.length > 0 ? `<details class="fold"><summary>${ICON_CHEV}${count(passed.length, 'machine check')} passed</summary><p class="ids">${passed.map((v) => esc(v.id)).join(', ')}</p></details>` : ''}
</div>`;
}

function runPanel(m: PageModel, run: RunDetail, options: RunPanelOptions): string {
  const c = caseOf(m, run);
  const test = c ? m.tests.find((t) => t.cases.includes(c)) : undefined;
  const id = esc(run.runId);
  const verdicts = run.blocks.flatMap((b) => b.verdicts);
  const failedChecks = verdicts.filter((v) => v.outcome === 'fail').length;
  const passingBlocks = run.blocks.filter((b) => blockStatus(b) === 'pass').length;
  // A block not run or blocked is no measurement: out of the rate, its count beside it.
  const unscoredBlocks = run.blocks.filter((b) => !isScored(b)).length;
  const s = run.succession;
  const facts: Array<[string, string]> = [
    ['Run', run.runId],
    ['Test', run.specId],
    ['Blocks passing', `${passingBlocks} of ${run.blocks.length - unscoredBlocks}`],
    ...(unscoredBlocks > 0
      ? ([['Blocks not run or blocked', String(unscoredBlocks)]] as Array<[string, string]>)
      : []),
    ['Checks failed', `${failedChecks} of ${verdicts.length}`],
    ['Latency', `${fixed(run.latencyMs, 0)} ms`],
    ...(c?.baseline === undefined
      ? []
      : ([['Baseline case', c.baseline ? 'pass' : 'fail']] as Array<[string, string]>)),
  ];
  const data: Array<[string, string]> = [
    ['Target', run.target],
    ['Mode', `${MODE_NAMES[run.mode]} (${run.mode})`],
    [
      'Perturbation',
      run.perturbationId ? `${run.perturbationId}${run.deviation ? ` · ${run.deviation}` : ''}` : 'none',
    ],
    ['Repeat', String(run.repeat)],
    ['Status', run.status],
    ['Started', run.startedAt],
    ['Cost', usd(run.cost)],
    ['First drift', s.firstDriftBlock === undefined ? 'none' : `block ${s.firstDriftBlock}`],
    ['Drifting blocks', String(s.driftCount)],
    ['End state', run.endState ? (run.endState.match ? 'matches' : 'differs') : 'not compared'],
    ...(run.recovery
      ? ([
          [
            'Recovery',
            `${run.recovery.label}${run.recovery.turnsToRecover === undefined ? '' : ` after ${run.recovery.turnsToRecover}`}, collateral ${run.recovery.collateral}`,
          ],
        ] as Array<[string, string]>)
      : []),
    ...(run.carried
      ? ([
          [
            'Carried',
            `carried from ${run.carried.fromCampaign}${run.carried.agentVersion === undefined ? '' : `, agent version ${run.carried.agentVersion}`}, age ${count(run.carried.age.campaigns, 'campaign')}`,
          ],
        ] as Array<[string, string]>)
      : []),
    ...(run.error ? ([['Error', run.error]] as Array<[string, string]>) : []),
  ];
  const diff = run.endState && !run.endState.match ? `<pre>${esc(json(run.endState.diff, 2000))}</pre>` : '';
  const shown = verdicts.filter((v) => v.outcome !== 'pass' || v.kind === 'judge');
  return `<section class="drawer" id="run-${id}" aria-label="Run ${id}">
<div class="dh">
<p class="row"><span class="dtitle">${esc(test?.title ?? run.title ?? run.specId)}</span><a class="x" href="#drilldown">${ICON_X}<span class="sr">Close</span></a></p>
<p class="dstatus">${chipOf(runDetailStatus(run))} <span class="stage">${esc(c ? caseLabel(c) : run.mode)} · repeat ${run.repeat}</span>${options.runHref ? ` <a class="open" href="${esc(options.runHref(run.runId))}">open the run</a>` : ''}</p>
<p class="dfacts">${facts.map(([k, v]) => `<span>${esc(k)} <b>${esc(v)}</b></span>`).join('')}</p>
<div class="seg dtabs" role="radiogroup" aria-label="Detail view"><input type="radio" name="dt-${id}" id="dc-${id}" class="tab-conv" checked><label for="dc-${id}">Conversation</label><input type="radio" name="dt-${id}" id="dk-${id}" class="tab-checks"><label for="dk-${id}">Checks<span class="c">${failedChecks}</span></label><input type="radio" name="dt-${id}" id="dd-${id}" class="tab-data"><label for="dd-${id}">Run data</label></div>
</div>
<div class="db">
<div class="pane pane-conv">
${parentCausesHtml(run.causes)}${run.blocks.map(blockView).join('\n')}
${options.stopped(run)}
</div>
<div class="pane pane-checks">${shown.length > 0 ? options.verdictTable(shown) : '<p class="empty">Every check passed.</p>'}</div>
<div class="pane pane-data"><dl class="kv">${data.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>${diff}</div>
</div>
</section>`;
}
