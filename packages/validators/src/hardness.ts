import { type Executor, executorOf, type JournalRow, PILOT_ITERATIONS } from './journal';

/** The gate of docs/validators.md section 12.4: the forecast is at least this, the pilot score at most that. */
export const HARDNESS_MIN_FORECAST = 100;
export const HARDNESS_MAX_SCORE = 0.4;
/** Section 12.4 point 4: distinct causes among the failing items after the pilot. */
export const HARDNESS_MIN_CAUSES = 100;
/** The bank minimum at merge of section 12.1. */
export const BANK_MIN_SIZE = 300;
export const BANK_MIN_FAMILY = 20;

/** One pilot: its rows (iterations 1 to 10 of one executor), its end, its rate and what remains. */
export type PilotMeasure = {
  executor: Executor;
  /** Pilot rows present, iterations 1 to 10. */
  iterations: number;
  complete: boolean;
  /** The row the pilot is measured from: the executor's own iteration 0, or the builder's. */
  baseline: { bankSize: number; passing: number; score: number };
  /** The last pilot row: its bank and score. Null before the first pilot row. */
  end: { iteration: number; bankSize: number; passing: number; score: number } | null;
  /** Mean items fixed per pilot iteration: (passing at the pilot's end minus at the baseline) / pilot rows. */
  fixedPerIteration: number | null;
  /** Failing items at the end of the pilot. */
  remaining: number | null;
};

/** A blind pilot slower than the builder's by more than this factor flags the builder pilot (section 12.7). */
export const BLIND_SLOWDOWN = 1.5;

/** The four checks of the independent audit (section 12.7), in order, as `audit.md` names them. */
export const AUDIT_CHECKS = ['blind pilot', 'cheater', 'cause review', 'planted bugs'] as const;
export type AuditVerdict = {
  check: (typeof AUDIT_CHECKS)[number];
  verdict: 'pass' | 'fail' | 'pending' | 'missing';
  note: string;
};

export type Hardness = {
  /** The bank of the latest row: size, items per family and tier, failing items per family. */
  bank: {
    iteration: number;
    size: number;
    passing: number;
    byFamilyTier: Record<string, Record<string, number>>;
    failingByFamily: Record<string, number>;
  };
  /** Null for components without a fingerprint contract. Historical figures remain visible on failure. */
  freshness: {
    status: 'current' | 'stale' | 'unverified';
    liveBankHash: string;
    journalBankHashes: string[];
    missingRows: number;
  } | null;
  iteration0: { bankSize: number; passing: number; score: number };
  /** The pilot the forecast and the gate use: the blind one when it has rows, else the builder's. */
  source: Executor;
  pilot: { iterations: number; complete: boolean; end: PilotMeasure['end'] };
  /** Both pilots, so their rates can be read side by side. `blind` is null without blind rows. */
  pilots: { builder: PilotMeasure; blind: PilotMeasure | null };
  /** Mean items fixed per pilot iteration, of the source pilot. */
  fixedPerIteration: number | null;
  /** Failing items at the end of the source pilot. */
  remaining: number | null;
  /** Iterations to 100 percent: remaining / fixedPerIteration; null when the pilot fixed nothing. */
  forecast: number | null;
  /**
   * Distinct causes among the failing items at the end of the source pilot, and how many of those items name no
   * cause (each counts as its own). Null when the row does not record them.
   */
  causes: { distinct: number; withoutCause: number | null } | null;
  /** Reported, not gating: a builder pilot more than 1.5 times slower than the blind one. */
  flags: string[];
  gate: { holds: boolean; reasons: string[] };
  /** The score ceiling after the pilot: HARDNESS_MAX_SCORE, or the lowered bar of validators/<component>/GATE.md. */
  maxScore: number;
  /** The forecast floor: HARDNESS_MIN_FORECAST, or the lowered bar of GATE.md. */
  minForecast: number;
  /** The distinct failing causes floor: HARDNESS_MIN_CAUSES, or the lowered bar of GATE.md. */
  minCauses: number;
  /** True when GATE.md lowered at least one term for this validator. */
  lowered: boolean;
  bankMinimum: { holds: boolean; problems: string[] };
  /** The four verdicts of `audit.md`, or null when the file is absent. */
  audit: AuditVerdict[] | null;
};

const score = (row: Pick<JournalRow, 'bankSize' | 'passing'>) =>
  row.bankSize === 0 ? 0 : row.passing / row.bankSize;

function measurePilot(
  rows: readonly JournalRow[],
  executor: Executor,
  builderZero: JournalRow,
): {
  measure: PilotMeasure;
  endRow: JournalRow | undefined;
} {
  const own = rows.filter((row) => executorOf(row) === executor);
  const baselineRow = own.find((row) => row.iteration === 0) ?? builderZero;
  const pilotRows = own.filter((row) => row.iteration >= 1 && row.iteration <= PILOT_ITERATIONS);
  const endRow = pilotRows.at(-1);
  return {
    endRow,
    measure: {
      executor,
      iterations: pilotRows.length,
      complete: pilotRows.length === PILOT_ITERATIONS,
      baseline: { bankSize: baselineRow.bankSize, passing: baselineRow.passing, score: score(baselineRow) },
      end: endRow
        ? {
            iteration: endRow.iteration,
            bankSize: endRow.bankSize,
            passing: endRow.passing,
            score: score(endRow),
          }
        : null,
      fixedPerIteration: endRow ? (endRow.passing - baselineRow.passing) / pilotRows.length : null,
      remaining: endRow ? endRow.bankSize - endRow.passing : null,
    },
  };
}

/**
 * The hardness measurement from a journal whose first builder row is iteration 0 (sections 12.4 and 12.7). When
 * blind rows exist (`executor: blind`), the blind pilot gives the forecast, the score and the causes, and a
 * builder pilot more than 1.5 times slower is flagged. `audit` is the text of `audit.md`, when present. Throws
 * when the journal has no builder iteration 0 row.
 */
/** The terms a validator's GATE.md can lower; null where it sets none. */
export type GateBar = { maxScore: number | null; minForecast: number | null; minCauses: number | null };

/**
 * The lowered bar of a validator, from its GATE.md, one line per term, optionally as a list item:
 * `Max score after the pilot: <n>` (taken when above HARDNESS_MAX_SCORE and under 1),
 * `Min forecast: <n>` (when above 0 and under HARDNESS_MIN_FORECAST) and
 * `Min distinct failing causes: <n>` (when above 0 and under HARDNESS_MIN_CAUSES). A bar only lowers a term;
 * any other value is ignored.
 */
export function parseGate(text: string): GateBar {
  const read = (label: string, keep: (value: number) => boolean): number | null => {
    const match = new RegExp(`^\\s*(?:[-*]\\s+)?${label}:\\s*(-?[0-9.]+)\\s*$`, 'im').exec(text);
    const value = match ? Number(match[1]) : Number.NaN;
    return Number.isFinite(value) && keep(value) ? value : null;
  };
  return {
    maxScore: read('max score after the pilot', (v) => v > HARDNESS_MAX_SCORE && v < 1),
    minForecast: read('min forecast', (v) => v > 0 && v < HARDNESS_MIN_FORECAST),
    minCauses: read('min distinct failing causes', (v) => v > 0 && v < HARDNESS_MIN_CAUSES),
  };
}

export function measureHardness(
  rows: readonly JournalRow[],
  options: { audit?: string; gate?: string; bankHash?: string } = {},
): Hardness {
  const zero = rows.find((row) => executorOf(row) === 'builder' && row.iteration === 0);
  const latest = rows.at(-1);
  if (!zero || !latest)
    throw new RangeError('the journal holds no iteration 0 row: run and record iteration 0 first');
  const builder = measurePilot(rows, 'builder', zero);
  const blind = rows.some((row) => executorOf(row) === 'blind') ? measurePilot(rows, 'blind', zero) : null;
  const chosen = blind && blind.measure.iterations > 0 ? blind : builder;
  const source = chosen.measure.executor;
  const { fixedPerIteration, remaining, end, iterations, complete } = chosen.measure;
  const endRow = chosen.endRow;
  const forecast =
    fixedPerIteration !== null && fixedPerIteration > 0 && remaining !== null
      ? remaining / fixedPerIteration
      : null;
  const reasons: string[] = [];
  const hashes = [...new Set(rows.flatMap((row) => (row.bankHash ? [row.bankHash] : [])))];
  const missingRows = rows.filter((row) => !row.bankHash).length;
  const freshness: Hardness['freshness'] =
    options.bankHash === undefined
      ? null
      : {
          status: hashes.some((hash) => hash !== options.bankHash)
            ? 'stale'
            : missingRows > 0
              ? 'unverified'
              : 'current',
          liveBankHash: options.bankHash,
          journalBankHashes: hashes,
          missingRows,
        };
  if (freshness?.status === 'stale') {
    reasons.push(
      'the journal bank hash differs from the live bank: historical measurement only; no fresh pilot for the live bank',
    );
  } else if (freshness?.status === 'unverified') {
    reasons.push(
      `${missingRows} journal rows record no bankHash: historical measurement is unverified; no fresh pilot for the live bank`,
    );
  }
  const label = source === 'blind' ? 'the blind pilot' : 'the pilot';
  if (!complete) reasons.push(`${label} holds ${iterations} of ${PILOT_ITERATIONS} iterations`);
  if (fixedPerIteration !== null && fixedPerIteration <= 0) {
    reasons.push(`${label} fixed nothing: the items are miswritten or the component lacks a foundation`);
  }
  const bar: GateBar =
    options.gate === undefined
      ? { maxScore: null, minForecast: null, minCauses: null }
      : parseGate(options.gate);
  const note = (lowered: number | null) => (lowered === null ? '' : ' (the bar GATE.md lowers)');
  const minForecast = bar.minForecast ?? HARDNESS_MIN_FORECAST;
  const minCauses = bar.minCauses ?? HARDNESS_MIN_CAUSES;
  if (forecast !== null && forecast < minForecast) {
    reasons.push(
      `the forecast ${round(forecast)} is under ${minForecast}${note(bar.minForecast)}: extend the bank (12.2)`,
    );
  }
  const maxScore = bar.maxScore ?? HARDNESS_MAX_SCORE;
  if (end && end.score > maxScore) {
    reasons.push(`the score after ${label} ${round(end.score)} is above ${maxScore}${note(bar.maxScore)}`);
  }
  const causes =
    endRow?.failingCauses !== undefined
      ? { distinct: endRow.failingCauses, withoutCause: endRow.failingWithoutCause ?? null }
      : null;
  if (endRow && !causes) reasons.push(`the last row of ${label} records no failingCauses`);
  if (causes && causes.distinct < minCauses) {
    reasons.push(
      `${causes.distinct} distinct failing causes after ${label}, under ${minCauses}${note(bar.minCauses)}: extend the bank (12.2)`,
    );
  }
  if (!end) reasons.push('no pilot row yet');
  const audit = options.audit === undefined ? null : parseAudit(options.audit);
  if (!audit) reasons.push('audit.md is absent: no validator merges without the audit (12.7)');
  for (const entry of audit ?? []) {
    if (entry.verdict !== 'pass') reasons.push(`the audit check ${entry.check} is ${entry.verdict}`);
  }
  const flags: string[] = [];
  const blindRate = blind?.measure.fixedPerIteration ?? null;
  const builderRate = builder.measure.fixedPerIteration;
  if (blindRate !== null && blindRate > 0 && builderRate !== null) {
    if (builderRate <= 0 || blindRate / builderRate > BLIND_SLOWDOWN) {
      flags.push(
        `the builder pilot fixed ${round(builderRate)} items per iteration, more than ${BLIND_SLOWDOWN} times slower than the blind pilot's ${round(blindRate)}`,
      );
    }
  }
  return {
    bank: {
      iteration: latest.iteration,
      size: latest.bankSize,
      passing: latest.passing,
      byFamilyTier: latest.bankByFamilyTier ?? {},
      failingByFamily: latest.failingByFamily,
    },
    freshness,
    iteration0: { bankSize: zero.bankSize, passing: zero.passing, score: score(zero) },
    source,
    pilot: { iterations, complete, end },
    pilots: { builder: builder.measure, blind: blind ? blind.measure : null },
    fixedPerIteration,
    remaining,
    forecast,
    causes,
    flags,
    gate: { holds: reasons.length === 0, reasons },
    maxScore,
    minForecast,
    minCauses,
    lowered: bar.maxScore !== null || bar.minForecast !== null || bar.minCauses !== null,
    bankMinimum: bankMinimum(latest),
    audit,
  };
}

/**
 * The four verdicts of `validators/<component>/audit.md`. Each check is read from a table row
 * `| <check> | <verdict> | <note> |` or a line `<check>: <verdict> <note>`, the verdict being pass, fail or
 * pending; a check the file does not name is missing.
 */
export function parseAudit(text: string): AuditVerdict[] {
  return AUDIT_CHECKS.map((check) => {
    for (const raw of text.split('\n')) {
      const line = raw.trim().replace(/^[-*]\s+/, '');
      const cells = line.startsWith('|')
        ? line
            .split('|')
            .slice(1, -1)
            .map((cell) => cell.trim())
        : undefined;
      const name = (cells ? cells[0] : line.split(':')[0])?.replace(/[*`]/g, '').trim().toLowerCase();
      if (name !== check) continue;
      const rest = cells ? cells.slice(1).join(' ').trim() : line.slice(line.indexOf(':') + 1).trim();
      const match = /^\**(pass|fail|pending)\b\**\s*[.,;:]?\s*(.*)$/i.exec(rest);
      if (!match) continue;
      return {
        check,
        verdict: (match[1] as string).toLowerCase() as AuditVerdict['verdict'],
        note: (match[2] ?? '').trim(),
      };
    }
    return { check, verdict: 'missing', note: '' };
  });
}

function bankMinimum(row: JournalRow): Hardness['bankMinimum'] {
  const problems: string[] = [];
  if (row.bankSize < BANK_MIN_SIZE)
    problems.push(`the bank holds ${row.bankSize} items, under ${BANK_MIN_SIZE}`);
  if (!row.bankByFamilyTier) {
    problems.push('the row records no bankByFamilyTier, so family and tier sizes are unknown');
    return { holds: false, problems };
  }
  const tiers = new Set<string>();
  for (const [family, perTier] of Object.entries(row.bankByFamilyTier)) {
    const size = Object.values(perTier).reduce((sum, value) => sum + value, 0);
    if (size < BANK_MIN_FAMILY)
      problems.push(`the family ${family} holds ${size} items, under ${BANK_MIN_FAMILY}`);
    for (const [tier, value] of Object.entries(perTier)) if (value > 0) tiers.add(tier);
  }
  const missing = ['1', '2', '3', '4', '5'].filter((tier) => !tiers.has(tier));
  if (missing.length > 0) problems.push(`no item of tier ${missing.join(', ')}`);
  return { holds: problems.length === 0, problems };
}

function round(value: number): string {
  return String(Number(value.toPrecision(4)));
}

/** The measurement as text: the bank per family and tier, the scores, the forecast and the gate verdict. */
export function formatHardness(component: string, h: Hardness): string {
  let text = `Hardness of ${component} (docs/validators.md section 12.4), from validators/${component}/journal.jsonl\n`;
  if (h.freshness) {
    text +=
      h.freshness.status === 'current'
        ? `Bank freshness: CURRENT (${h.freshness.liveBankHash}).\n`
        : `Bank freshness: ${h.freshness.status.toUpperCase()}. The figures below describe the historical journal, not a fresh pilot of the live bank (${h.freshness.liveBankHash}).\n`;
  }
  const bankLabel = h.freshness && h.freshness.status !== 'current' ? 'Historical journal bank' : 'Bank';
  text += `${bankLabel} at iteration ${h.bank.iteration}: ${h.bank.size} items, ${h.bank.passing} pass on every seed.\n`;
  const tiers = ['1', '2', '3', '4', '5', 'none'];
  const header = ['Family', ...tiers.map((tier) => `tier ${tier}`), 'items', 'failing'];
  const rows = Object.entries(h.bank.byFamilyTier)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([family, perTier]) => [
      family,
      ...tiers.map((tier) => String(perTier[tier] ?? 0)),
      String(Object.values(perTier).reduce((sum, value) => sum + value, 0)),
      String(h.bank.failingByFamily[family] ?? 0),
    ]);
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => (row[column] ?? '').length)),
  );
  const line = (row: string[]) =>
    row
      .map((cell, column) => cell.padEnd(widths[column] ?? 0))
      .join('  ')
      .trimEnd();
  text += `${[line(header), ...rows.map(line)].join('\n')}\n`;
  text += `Score at iteration 0: ${round(h.iteration0.score)} (${h.iteration0.passing} of ${h.iteration0.bankSize}).\n`;
  const which = h.source === 'blind' ? 'the blind pilot' : 'the pilot';
  text += h.pilot.end
    ? `Score after ${which}: ${round(h.pilot.end.score)} (${h.pilot.end.passing} of ${h.pilot.end.bankSize}, iteration ${h.pilot.end.iteration}; ${h.pilot.iterations} of ${PILOT_ITERATIONS} pilot iterations).\n`
    : `Score after ${which}: none yet (0 of ${PILOT_ITERATIONS} pilot iterations).\n`;
  text +=
    h.fixedPerIteration === null
      ? 'Items fixed per iteration: none yet.\n'
      : `Items fixed per iteration: ${round(h.fixedPerIteration)} (mean over ${which}).\n`;
  if (h.pilots.blind) {
    const pilotRow = (pilot: PilotMeasure) => [
      pilot.executor,
      `${pilot.iterations} of ${PILOT_ITERATIONS}`,
      pilot.fixedPerIteration === null ? 'none' : round(pilot.fixedPerIteration),
      pilot.end ? round(pilot.end.score) : 'none',
    ];
    const head = ['Pilot', 'iterations', 'items fixed per iteration', 'score after'];
    const body = [pilotRow(h.pilots.builder), pilotRow(h.pilots.blind)];
    const w = head.map((title, column) =>
      Math.max(title.length, ...body.map((row) => (row[column] ?? '').length)),
    );
    const fmt = (row: string[]) =>
      row
        .map((cell, column) => cell.padEnd(w[column] ?? 0))
        .join('  ')
        .trimEnd();
    text += `${[fmt(head), ...body.map(fmt)].join('\n')}\n`;
    text += `The forecast, the score and the causes use ${which} (section 12.7).\n`;
  }
  for (const flag of h.flags) text += `Flag: ${flag}.\n`;
  text +=
    h.forecast === null
      ? `Forecast: none (${h.fixedPerIteration === null ? 'no pilot row' : 'the pilot fixed nothing'}).\n`
      : `Forecast: ${round(h.forecast)} iterations to 100 percent (${h.remaining} failing / ${round(h.fixedPerIteration ?? 0)}).\n`;
  text += !h.causes
    ? `Distinct failing causes after ${which}: not recorded.\n`
    : `Distinct failing causes after ${which}: ${h.causes.distinct}${
        h.causes.withoutCause === null
          ? ' (the row does not say how many items name no cause)'
          : ` (${h.causes.withoutCause} failing items name no cause and count as their own)`
      }.\n`;
  text += h.gate.holds
    ? `Gate: HOLDS (forecast at least ${h.minForecast}, score after the pilot at most ${h.maxScore}, at least ${h.minCauses} distinct failing causes${h.lowered ? ', as GATE.md lowers them' : ''}, all four audit checks pass).\n`
    : `Gate: NOT MET: ${h.gate.reasons.join('; ')}.\n`;
  text += h.bankMinimum.holds
    ? 'Bank minimum at merge (12.1): holds.\n'
    : `Bank minimum at merge (12.1): not met: ${h.bankMinimum.problems.join('; ')}.\n`;
  if (h.audit) {
    text += `Audit (validators/${component}/audit.md, section 12.7):\n`;
    for (const entry of h.audit) {
      text += `  ${entry.check}: ${entry.verdict.toUpperCase()}${entry.note ? `, ${entry.note}` : ''}\n`;
    }
  } else {
    text += `Audit: validators/${component}/audit.md is absent.\n`;
  }
  return text;
}
