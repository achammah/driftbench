import type { Atom, EstateMap } from '@agent-nexus/driftbench-estate';
import type { RealTruth } from './scale-real-estate';

/**
 * What the oracle reads off a map of the real-size estate, against the truth the estate was planted from. Pure:
 * the worker measures the stages, this module only compares a map with the plan of the estate. Level-1
 * strictness: a planted rule counts as found when an atom of the right kind sits on its line with its words.
 */

export type Count = { planted: number; found: number; missed: string[] };
export type RealFacts = {
  rules: Record<string, Count>;
  gates: Record<string, Count>;
  skills: Count;
  references: Count;
  /** Skills whose reference edges reach a file of another skill that no cross-reference plants. */
  foreignReferences: { skills: number; edges: number; examples: string[] };
  /** Rule atoms and live-reference findings that come from documents that are not rules. */
  nonNormative: { documents: number; ruleAtoms: number; examples: string[] };
  /** Rule and gate atoms on lines of normative markdown that state nothing to do: false by construction. */
  precision: { atoms: number; onFiller: number; gatesOnFiller: number; legit: number; examples: string[] };
  /** The user-level skill layer: each skill found, a skill reached twice counted once, the trash not read. */
  user: { expected: number; found: number; missed: string[]; duplicates: string[]; trashRead: string[] };
  guards: {
    planted: number;
    resolved: number;
    described: number;
    missedTarget: string[];
    missedText: string[];
  };
};

const normal = (text: string) => text.replace(/\s+/g, ' ').toLowerCase();
const RULE_KINDS = new Set(['instruction', 'gate', 'register']);

function covers(atom: Atom, file: string, line: number): boolean {
  return (
    atom.provenance.file === file && atom.provenance.startLine <= line && line <= atom.provenance.endLine
  );
}

function tally(planted: number, missed: string[]): Count {
  return { planted, found: planted - missed.length, missed: missed.slice(0, 3) };
}

/** Where a planted rule lives: the standing file, a skill or a helper. */
export function placeOf(file: string): 'standing' | 'skill' | 'helper' {
  if (file.includes('/agents/')) return 'helper';
  if (file.includes('/skills/')) return 'skill';
  return 'standing';
}

export function readFacts(map: EstateMap, truth: RealTruth): RealFacts {
  const atoms = map.atoms;
  const byFile = new Map<string, Atom[]>();
  for (const atom of atoms)
    byFile.set(atom.provenance.file, [...(byFile.get(atom.provenance.file) ?? []), atom]);
  const onLine = (file: string, line: number) =>
    (byFile.get(file) ?? []).filter((atom) => covers(atom, file, line));

  const rules: Record<string, Count> = {};
  const groups = new Map<string, string[]>();
  const totals = new Map<string, number>();
  for (const rule of truth.rules) {
    const key = `${placeOf(rule.file)}-${rule.form}`;
    totals.set(key, (totals.get(key) ?? 0) + 1);
    const found = onLine(rule.file, rule.line).some(
      (atom) => RULE_KINDS.has(atom.kind) && normal(atom.provenance.quote).includes(normal(rule.core)),
    );
    if (!found) groups.set(key, [...(groups.get(key) ?? []), `${rule.file}:${rule.line} ${rule.text}`]);
  }
  for (const [key, total] of totals) rules[key] = tally(total, groups.get(key) ?? []);

  const gates: Record<string, Count> = {};
  for (const gate of truth.gates) {
    const found = onLine(gate.file, gate.line).some(
      (atom) => atom.kind === 'gate' && normal(atom.provenance.quote).includes(normal(gate.core)),
    );
    gates[gate.form] = tally(1, found ? [] : [`${gate.file}:${gate.line} ${gate.text}`]);
  }

  const skillAtoms = new Map(
    atoms.filter((atom) => atom.kind === 'skill').map((atom) => [atom.provenance.file, atom]),
  );
  const skillsMissed = truth.skills.filter((skill) => !skillAtoms.has(skill.file)).map((skill) => skill.file);

  const byId = new Map(atoms.map((atom) => [atom.id, atom]));
  const edgesOf = new Map<string, string[]>();
  for (const edge of map.edges) {
    if (edge.kind !== 'reference') continue;
    edgesOf.set(edge.from, [...(edgesOf.get(edge.from) ?? []), edge.to]);
  }
  const referencesMissed: string[] = [];
  let referencesPlanted = 0;
  const foreign: string[] = [];
  let foreignEdges = 0;
  let foreignSkills = 0;
  for (const skill of truth.skills) {
    const atom = skillAtoms.get(skill.file);
    const folder = skill.file.replace(/\/SKILL\.md$/, '');
    const targets = (atom ? (edgesOf.get(atom.id) ?? []) : []).flatMap((id) => {
      const target = byId.get(id);
      return target ? [target] : [];
    });
    // A reference belongs to the skill whose file cites it: its citing file sits in the skill's folder.
    const mine = (target: Atom) => target.provenance.file.startsWith(`${folder}/`);
    const wrong = targets.filter((target) => !mine(target));
    if (wrong.length > 0) {
      foreignSkills += 1;
      foreignEdges += wrong.length;
      if (foreign.length < 3)
        foreign.push(
          `${skill.name} reaches ${wrong.length} references cited by other files, such as ${wrong[0]?.provenance.file}`,
        );
    }
    // The references the skill's body names: all its own, and its cross-reference.
    const reached = targets.filter(mine).map((target) => String(target.fields?.path ?? ''));
    const cited = skill.references.map((r) => `${folder}/${r}`).concat(skill.crossRefs);
    for (const path of cited) {
      referencesPlanted += 1;
      if (!reached.some((r) => r !== '' && (path.endsWith(r) || r.endsWith(path))))
        referencesMissed.push(path);
    }
  }

  const documents = new Set(truth.nonNormative);
  const fromDocuments = atoms.filter(
    (atom) => documents.has(atom.provenance.file) && (RULE_KINDS.has(atom.kind) || atom.kind === 'hazard'),
  );

  const guardAtoms = atoms.filter((atom) => atom.kind === 'guard');
  const missedTarget: string[] = [];
  const missedText: string[] = [];
  let resolved = 0;
  let described = 0;
  for (const guard of truth.guards) {
    const atom = guardAtoms.find((candidate) => candidate.fields?.name === guard.name);
    if (atom && atom.fields?.script === guard.script) resolved += 1;
    else missedTarget.push(guard.name);
    if (atom && normal(JSON.stringify(atom)).includes(normal(guard.description))) described += 1;
    else missedText.push(guard.name);
  }

  const documentSet = new Set(truth.nonNormative);
  const legitLines = new Map(Object.entries(truth.legit).map(([file, lines]) => [file, new Set(lines)]));
  const ruleAtoms = atoms.filter(
    (atom) =>
      RULE_KINDS.has(atom.kind) &&
      atom.provenance.file.endsWith('.md') &&
      !documentSet.has(atom.provenance.file),
  );
  const onFiller = ruleAtoms.filter((atom) => {
    const lines = legitLines.get(atom.provenance.file);
    if (!lines) return true;
    for (let line = atom.provenance.startLine; line <= atom.provenance.endLine; line += 1)
      if (lines.has(line)) return false;
    return true;
  });

  const skillNames = atoms
    .filter((atom) => atom.kind === 'skill')
    .map((atom) => String(atom.fields?.name ?? ''));
  const seen = new Map<string, number>();
  for (const name of skillNames) if (name !== '') seen.set(name, (seen.get(name) ?? 0) + 1);
  const userMissed = truth.user.found.filter((name) => !seen.has(name));

  return {
    rules,
    gates,
    precision: {
      atoms: ruleAtoms.length,
      onFiller: onFiller.filter((atom) => atom.kind !== 'gate').length,
      gatesOnFiller: onFiller.filter((atom) => atom.kind === 'gate').length,
      legit: Object.values(truth.legit).reduce((sum, lines) => sum + lines.length, 0),
      examples: onFiller
        .slice(0, 3)
        .map((atom) => `${atom.provenance.file}:${atom.provenance.startLine} ${atom.kind}`),
    },
    user: {
      expected: truth.user.found.length,
      found: truth.user.found.length - userMissed.length,
      missed: userMissed.slice(0, 3),
      duplicates: [...seen]
        .filter(([, n]) => n > 1)
        .map(([name]) => name)
        .slice(0, 3),
      trashRead: truth.user.trash.filter((name) => seen.has(name)),
    },
    skills: tally(truth.skills.length, skillsMissed),
    references: tally(referencesPlanted, referencesMissed),
    foreignReferences: { skills: foreignSkills, edges: foreignEdges, examples: foreign },
    nonNormative: {
      documents: documents.size,
      ruleAtoms: fromDocuments.length,
      examples: fromDocuments
        .slice(0, 3)
        .map((atom) => `${atom.provenance.file}:${atom.provenance.startLine} ${atom.kind}`),
    },
    guards: {
      planted: truth.guards.length,
      resolved,
      described,
      missedTarget: missedTarget.slice(0, 3),
      missedText: missedText.slice(0, 3),
    },
  };
}

type LintLike = { code: string; subject?: string; message?: string };

/** The lint codes that say a citation names a file or a script the estate does not hold, or cannot tell which. */
const LIVE_CODES = new Set(['MISSING_REFERENCE', 'MISSING_SCRIPT', 'AMBIGUOUS_REFERENCE']);

/**
 * The line count of what the plan command printed, or -1 when the scan or the plan did not succeed: both commands
 * must exit 0 and the plan and its summary must exist. An error line is not a summary, whatever its length.
 */
export function planConsole(run: {
  scanCode: number;
  planCode: number;
  planWritten: boolean;
  summaryWritten: boolean;
  out: string;
}): number {
  return run.scanCode === 0 && run.planCode === 0 && run.planWritten && run.summaryWritten
    ? run.out.split('\n').length
    : -1;
}

/**
 * What the lint did with the planted estate, read from the structured fields of each finding and never from how its
 * message is worded: findings that take a document that is not a rule for a live one (a missing reference or script
 * that it names), and the real defects planted in normative files that the lint found.
 */
export function lintFacts(
  findings: readonly LintLike[],
  truth: Pick<RealTruth, 'nonNormative' | 'defects'>,
): {
  onDocuments: { findings: number; examples: string[] };
  defects: { planted: number; found: number; missed: string[] };
  /** Live-reference findings that name no planted defect and sit on no document that is not a rule: false. */
  falseLive: { findings: number; examples: string[] };
  total: number;
} {
  const mentions = (finding: LintLike, path: string) => JSON.stringify(finding).includes(path);
  const live = findings.filter(
    (finding) => LIVE_CODES.has(finding.code) && truth.nonNormative.some((path) => mentions(finding, path)),
  );
  const falseLive = findings.filter(
    (finding) =>
      LIVE_CODES.has(finding.code) &&
      !truth.defects.some((defect) => mentions(finding, defect.path)) &&
      !truth.nonNormative.some((path) => mentions(finding, path)),
  );
  const missed = truth.defects.filter(
    (defect) =>
      !findings.some((finding) => finding.code === 'MISSING_REFERENCE' && mentions(finding, defect.path)),
  );
  return {
    onDocuments: {
      findings: live.length,
      examples: live.slice(0, 3).map((f) => `${f.code} ${f.subject ?? ''}`),
    },
    defects: {
      planted: truth.defects.length,
      found: truth.defects.length - missed.length,
      missed: missed.slice(0, 3).map((defect) => defect.path),
    },
    falseLive: {
      findings: falseLive.length,
      examples: falseLive.slice(0, 3).map((f) => `${f.code} ${f.subject ?? ''}`),
    },
    total: findings.filter((finding) => finding.code !== 'UNENFORCED').length,
  };
}
