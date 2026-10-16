import type { EvidenceInput, EvidenceProvider, PastDiagnosis } from './types';

/**
 * Recurrence: in how many homes the same mistake shows (codeagent_equivalence_blame.md C3). A signature is the
 * blame item and the act class; it never holds a skill name, a file name or a literal value. A home is a skill
 * whose blocks show the signature in at least `minRunsPerHome` runs; blocks with no routed skill form the home
 * `none`. `history` holds the other diagnoses; the current one (`attributed`) counts as one run of its own home.
 */

/** The signature of a diagnosis: `<item>|<act>` at act level, `<item>` at class level. */
export function signature(item: string, act?: string): string {
  return act === undefined ? item : `${item}|${act}`;
}

function homes(input: EvidenceInput, sameAct: boolean): number | undefined {
  const current = input.attributed;
  if (current === undefined) return undefined;
  const min = input.minRunsPerHome ?? 1;
  const runs = new Map<string, number>();
  const match = (past: PastDiagnosis) => past.item === current.item && (!sameAct || past.act === current.act);
  for (const past of input.history ?? [])
    if (match(past) && (input.countNoSkillHome !== false || past.home !== 'none'))
      runs.set(past.home, (runs.get(past.home) ?? 0) + 1);
  const own = current.home ?? 'none';
  if (input.countNoSkillHome !== false || own !== 'none') runs.set(own, (runs.get(own) ?? 0) + 1);
  const counted = [...runs.values()].filter((count) => count >= min).length;
  return input.countNoSkillHome === false && own === 'none' ? counted : Math.max(1, counted);
}

export const recurrence_homes: EvidenceProvider = {
  name: 'recurrence_homes',
  cost: 'static',
  values: ['number'],
  from: 'the stored diagnoses of the campaign or the store with the same blame item and act, counted by home',
  compute: (input) => homes(input, true),
};

export const recurrence_class_homes: EvidenceProvider = {
  name: 'recurrence_class_homes',
  cost: 'static',
  values: ['number'],
  from: 'the stored diagnoses with the same blame item and any act, counted by home',
  compute: (input) => homes(input, false),
};

/** Counts a confirm run stored: read only when one ran; never computed here. */
function stored(
  name: 'reference_pass' | 'reference_loads' | 'forced_load_pass' | 'hint_pass',
  from: string,
): EvidenceProvider {
  return {
    name,
    cost: 'run',
    values: ['number'],
    from,
    compute: (input) => input.confirm?.[name],
  };
}

export const reference_pass = stored(
  'reference_pass',
  'reference-agent runs of diagnostic/liability-confirm, passes out of confirm_runs',
);
export const reference_loads = stored(
  'reference_loads',
  'reference-agent runs that loaded the routed skill, out of confirm_runs',
);
export const forced_load_pass = stored(
  'forced_load_pass',
  'runs with the skill forced into context that pass, out of confirm_runs',
);
export const hint_pass = stored(
  'hint_pass',
  'runs with the rule repeated as a hint that pass, out of confirm_runs',
);
