/**
 * The escape test (cue-retro plan.md, "The escape test"): a rule that names a specific value where the class is a
 * kind is a sample, not a rule. A proposed fix text is linted for the skill names, file names and literal values
 * it holds; a class rule names none of them.
 */

export type EscapeFinding = { kind: 'skill_name' | 'file_name' | 'literal_value'; text: string };

const FILE =
  /(?:[\w.-]+\/)+[\w.-]+|\b[\w-]+\.(?:md|py|sh|json|ya?ml|csv|tsv|xlsx|docx|pptx|pdf|ts|js|mjs|txt|html)\b/g;
const LITERAL =
  /(?:[$€£]\s?\d[\d,.]*|\b\d+(?:[.,]\d+)?\s?(?:EUR|USD|GBP|%|MB|GB|KB)\b|\b\d+[.,]\d+\b|"[^"]+"|`[^`]+`)/g;

/** The skill names, file names and literal values a fix text holds. */
export function lintFixText(text: string, skills: readonly string[] = []): EscapeFinding[] {
  const out: EscapeFinding[] = [];
  const seen = new Set<string>();
  const push = (kind: EscapeFinding['kind'], found: string) => {
    const key = `${kind}:${found}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, text: found });
  };
  for (const skill of skills) {
    if (
      skill.length > 0 &&
      new RegExp(`(^|[^\\w-])${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w-])`, 'i').test(text)
    ) {
      push('skill_name', skill);
    }
  }
  for (const match of text.matchAll(FILE)) push('file_name', match[0]);
  for (const match of text.matchAll(LITERAL)) {
    const found = match[0];
    if (/^`.*`$/.test(found) && new RegExp(FILE.source).test(found)) continue;
    push('literal_value', found);
  }
  return out;
}

/**
 * A class-rule wording for a cross-cutting fix, by act: it names the kind of act, never a skill, a file or a
 * value. A team may write its own wording; the escape test lints it.
 */
export const CLASS_RULE_BY_ACT: Readonly<Record<string, string>> = {
  read_reference:
    'In a loaded skill, read every file its body tells you to read for the current situation, before acting.',
  load_skill: 'When an ask fits a skill, load that skill before acting on the ask.',
  follow_skill_rule: 'Follow every rule of a loaded skill, as written, in the situation it names.',
  stage:
    'Run the stated steps in their stated order, and never report a task as done before its verify step passed.',
  ordered: 'Do the first act of every stated ordered pair before the second.',
  gate: 'Meet every stated gate before the act it guards.',
  step: 'Take every step the instructions state for the situation, in order, before answering.',
  recovery: 'After a failure, follow the recovery the instructions state.',
  integrity: 'Never edit or special-case a provided test, and report only what the run shows.',
  provenance: 'Copy every value the user or a source file gives exactly as given.',
};
