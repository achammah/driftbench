import { analyzeGraph } from '../graph/analyze';
import { quoteDrift } from '../map/file';
import { DEFAULT_STANDING_CEILING, measureInvariants, standingFiles } from '../scan/invariants';
import type { RawEstate, RegistryRow } from '../scan/reader';
import type { Atom, EstateMap } from '../schema';

/**
 * The static checks of an estate, on a map and the files it was read from. Each finding has a stable code:
 *
 *   ORPHAN              a file nothing names
 *   UNREACHABLE         a file the standing instructions never lead to (orphans are listed apart)
 *   UNENFORCED          an instruction, gate or register atom no guard enforces: trusted, a finding of its own
 *   OVERSIZE            the standing instructions are over the ceiling
 *   UNANCHORED_GUARD    a guard command finds its script from the working folder, not an anchor
 *   MISSING_REFERENCE   a file a body names does not exist
 *   AMBIGUOUS_REFERENCE a body names a file by an ending that several files share
 *   EXTERNAL            a body names a path outside the estate (`~/`, `/`, or an external folder): information
 *   MISSING_SCRIPT      a guard command runs a script that does not exist
 *   REGISTRY_ROW        a guard has no row in the check registry
 *   REGISTRY_GUARD      a registry row names a guard the estate does not run
 *   QUOTE_DRIFT         an atom's quote is no longer at its span: scan again
 *
 * UNENFORCED is reported as a count with the atom ids; it is a fact about trust, not an error, so it alone
 * does not fail the lint.
 */

export const LINT_CODES = [
  'ORPHAN',
  'UNREACHABLE',
  'UNENFORCED',
  'OVERSIZE',
  'UNANCHORED_GUARD',
  'MISSING_REFERENCE',
  'AMBIGUOUS_REFERENCE',
  'EXTERNAL',
  'MISSING_SCRIPT',
  'REGISTRY_ROW',
  'REGISTRY_GUARD',
  'QUOTE_DRIFT',
] as const;
export type LintCode = (typeof LINT_CODES)[number];

/** Codes reported as information: counted and listed, never failing the lint. */
export const INFORMATION: ReadonlySet<LintCode> = new Set(['UNENFORCED', 'EXTERNAL']);

export type LintFinding = { code: LintCode; subject: string; message: string };

export type LintResult = {
  findings: LintFinding[];
  /** True when a finding other than UNENFORCED and EXTERNAL (both information) was found. */
  failed: boolean;
  counts: Record<LintCode, number>;
};

export type LintOptions = { ceiling?: number };

export function lintEstate(map: EstateMap, raw: RawEstate, options: LintOptions = {}): LintResult {
  const findings: LintFinding[] = [];
  const texts = new Map(raw.files.map((file) => [file.path, file.text]));
  for (const drift of quoteDrift(map.atoms, texts)) {
    findings.push({ code: 'QUOTE_DRIFT', subject: drift.path, message: drift.message });
  }

  const analysis = analyzeGraph(map.atoms, map.edges, raw.files);
  // Findings look atoms up by id: the first atom of each id, as a search from the start would find it.
  const byId = new Map<string, Atom>();
  for (const atom of map.atoms) if (!byId.has(atom.id)) byId.set(atom.id, atom);
  for (const path of analysis.orphans) {
    findings.push({
      code: 'ORPHAN',
      subject: path,
      message: `${path}: nothing in the estate names this file`,
    });
  }
  for (const path of analysis.unreachableFiles) {
    findings.push({
      code: 'UNREACHABLE',
      subject: path,
      message: `${path}: no route, reference or dispatch from the standing instructions leads here`,
    });
  }
  for (const id of analysis.missingReferences) {
    const atom = byId.get(id);
    if (atom?.fields?.external === true) {
      findings.push({
        code: 'EXTERNAL',
        subject: id,
        message: `${atom.provenance.file}:${atom.provenance.startLine} names ${String(atom.fields.path)}, outside the estate`,
      });
      continue;
    }
    const candidates = atom?.fields?.candidates;
    if (Array.isArray(candidates) && candidates.length > 1) {
      findings.push({
        code: 'AMBIGUOUS_REFERENCE',
        subject: id,
        message: `${atom?.provenance.file}:${atom?.provenance.startLine} names ${String(atom?.fields?.path)}, which several files could be: ${candidates.join(', ')}`,
      });
      continue;
    }
    findings.push({
      code: 'MISSING_REFERENCE',
      subject: id,
      message: `${atom?.provenance.file}:${atom?.provenance.startLine} names ${String(atom?.fields?.path)}, which does not exist`,
    });
  }
  for (const id of analysis.missingScripts) {
    const atom = byId.get(id);
    findings.push({
      code: 'MISSING_SCRIPT',
      subject: id,
      message:
        typeof atom?.fields?.dispatcher === 'string'
          ? `the guard's dispatcher ${atom.fields.dispatcher} names ${String(atom.fields.script)}, which no file of the estate is`
          : `the guard runs ${String(atom?.fields?.script)}, which does not exist`,
    });
  }

  const ceiling = options.ceiling ?? DEFAULT_STANDING_CEILING;
  const state = measureInvariants(raw, analysis.orphans, ceiling);
  if (state.standingCharacters > ceiling) {
    findings.push({
      code: 'OVERSIZE',
      subject: standingFiles(raw)
        .map((file) => file.path)
        .join(', '),
      message: `the standing instructions hold ${state.standingCharacters} characters, over the ceiling of ${ceiling}`,
    });
  }
  for (const command of state.unanchored) {
    findings.push({
      code: 'UNANCHORED_GUARD',
      subject: command,
      message: `the guard command "${command}" finds its script from the working folder; anchor it on the project folder`,
    });
  }
  for (const name of state.guardsWithoutRow) {
    findings.push({
      code: 'REGISTRY_ROW',
      subject: name,
      message: `the guard ${name} has no row in the check registry`,
    });
  }
  const rows = new Map<string, RegistryRow>();
  for (const row of raw.registry) if (!rows.has(row.id)) rows.set(row.id, row);
  for (const id of state.rowsWithoutGuard) {
    const row = rows.get(id);
    findings.push({
      code: 'REGISTRY_GUARD',
      subject: id,
      message: `registry row ${id} names ${row?.guard}, which no guard of the estate runs`,
    });
  }
  for (const id of analysis.unenforced) {
    findings.push({ code: 'UNENFORCED', subject: id, message: `${id}: no guard enforces it` });
  }

  const counts = Object.fromEntries(LINT_CODES.map((code) => [code, 0])) as Record<LintCode, number>;
  for (const finding of findings) counts[finding.code]++;
  return { findings, failed: findings.some((finding) => !INFORMATION.has(finding.code)), counts };
}
