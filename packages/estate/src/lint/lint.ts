import { analyzeGraph } from '../graph/analyze';
import { quoteDrift } from '../map/file';
import { navigationNames } from '../scan/code';
import { codeNames, runtimeProduct } from '../scan/code-names';
import { normativeEstate, normativeRanges, unloadedByDesign } from '../scan/document-roles';
import { DEFAULT_STANDING_CEILING, measureInvariants, standingFiles } from '../scan/invariants';
import type { RawEstate, RegistryRow } from '../scan/reader';
import { ignoredReference, placeholderPath, unresolvedReference } from '../scan/reference-role';
import type { Atom, EstateMap } from '../schema';

/**
 * The static checks of an estate, on a map and the files it was read from. Each finding has a stable code:
 *
 *   ORPHAN              a file nothing names
 *   UNREACHABLE         a file the standing instructions never lead to (orphans are listed apart)
 *   UNENFORCED          an instruction, gate or register atom no guard enforces: trusted, a finding of its own
 *   OVERSIZE            the standing instructions are over the ceiling
 *   UNANCHORED_GUARD    a guard command finds its script from the working folder, not an anchor
 *   MISSING_REFERENCE   a concrete path a body names does not exist
 *   UNRESOLVED_REFERENCE a bare name has no resolved location: information
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
  'UNRESOLVED_REFERENCE',
  'AMBIGUOUS_REFERENCE',
  'EXTERNAL',
  'MISSING_SCRIPT',
  'REGISTRY_ROW',
  'REGISTRY_GUARD',
  'QUOTE_DRIFT',
] as const;
export type LintCode = (typeof LINT_CODES)[number];

/** Codes reported as information: counted and listed, never failing the lint. */
export const INFORMATION: ReadonlySet<LintCode> = new Set(['UNENFORCED', 'EXTERNAL', 'UNRESOLVED_REFERENCE']);

export type LintFinding = { code: LintCode; subject: string; message: string };

export type LintResult = {
  findings: LintFinding[];
  /** True when a finding outside INFORMATION was found. */
  failed: boolean;
  counts: Record<LintCode, number>;
};

export type LintOptions = { ceiling?: number };

export function lintEstate(map: EstateMap, raw: RawEstate, options: LintOptions = {}): LintResult {
  raw = normativeEstate(raw);
  const files = new Map(raw.files.map((file) => [file.path, file]));
  const atoms = map.atoms.filter((atom) => {
    if (ignoredReference(raw, atom.provenance.file)) return false;
    // A skill's script is owned by the skill's folder, whatever role its own text has: it states no rule.
    if (atom.kind === 'script') return true;
    const file = files.get(atom.provenance.file);
    if (!file) return true;
    return normativeRanges(file, atom.provenance.startLine, atom.provenance.endLine).length > 0;
  });
  const findings: LintFinding[] = [];
  const texts = new Map(raw.files.map((file) => [file.path, file.text]));
  for (const drift of quoteDrift(atoms, texts)) {
    findings.push({ code: 'QUOTE_DRIFT', subject: drift.path, message: drift.message });
  }

  const analysis = analyzeGraph(atoms, map.edges, raw.files, navigationNames(raw), codeNames(raw).links);
  // Findings look atoms up by id: the first atom of each id, as a search from the start would find it.
  const byId = new Map<string, Atom>();
  for (const atom of atoms) if (!byId.has(atom.id)) byId.set(atom.id, atom);
  for (const path of analysis.orphans) {
    const file = files.get(path);
    if (file && unloadedByDesign(raw, file)) continue;
    findings.push({
      code: 'ORPHAN',
      subject: path,
      message: `${path}: nothing in the estate names this file`,
    });
  }
  for (const path of analysis.unreachableFiles) {
    const file = files.get(path);
    if (file && unloadedByDesign(raw, file)) continue;
    findings.push({
      code: 'UNREACHABLE',
      subject: path,
      message: `${path}: no route, reference or dispatch from the standing instructions leads here`,
    });
  }
  for (const id of analysis.missingReferences) {
    const atom = byId.get(id);
    const path = String(atom?.fields?.path ?? '');
    if (atom?.fields?.ignored === true || ignoredReference(raw, path) || placeholderPath(path)) continue;
    // A script writes or creates the path: the runtime makes it, so a sentence about it is no broken link.
    if (atom && atom.fields?.external !== true && !atom.fields?.candidates && runtimeProduct(raw, path))
      continue;
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
    if (atom && unresolvedReference(atom)) {
      findings.push({
        code: 'UNRESOLVED_REFERENCE',
        subject: id,
        message: `${atom.provenance.file}:${atom.provenance.startLine} names ${String(atom.fields?.written ?? atom.title.replace(/^Read /, ''))}, which could not be resolved within the estate`,
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
