import {
  type Assertion,
  type Check,
  type CheckContext,
  compareEndState,
  type EndStateDiff,
  type EndStateSpec,
  machineVerdict,
  matchAssertion,
  matchNormalised,
  rulesFor,
  type Verdict,
} from '@agent-nexus/driftbench-core';
import { describeAssertion, describeSteps, message } from '../support/assert';
import { isRecord, plural, show } from '../support/values';

const NAME = 'end_state';

/**
 * The end state of the world after the run against the spec's `end_state`. It runs on the last block of
 * the spec in a teacher-forced or free-running run; a perturbed run may end elsewhere by design and is
 * not compared.
 *
 * Core's `compareEndState`, the function the runner records in `RunResult.endState`, decides every pass
 * and fail; this check turns its diff into verdicts with evidence. One verdict per expected field, with
 * the same ids whether or not anything was read; an empty `expect` gives one verdict `end_state.<source>`;
 * a field the exact end state does not list fails under its own id; `none` gives one verdict that names
 * the first payload found.
 */
export const endState: Check = {
  name: NAME,
  applies: (ctx) => ctx.spec.end_state !== undefined && ctx.mode !== 'P' && isLastSpecBlock(ctx),
  evaluate(ctx: CheckContext): Verdict[] {
    const spec = ctx.spec.end_state;
    if (spec === undefined) return [];
    let diff: EndStateDiff[];
    try {
      diff = compareEndState(spec, ctx.endState).diff;
    } catch (cause) {
      return [machineVerdict(NAME, 'compare', 'fail', `the end state cannot be compared: ${message(cause)}`)];
    }
    if (spec === 'none') return [noneVerdict(diff)];
    const failed = new Map(diff.map((entry) => [entry.field, entry]));
    const list = Array.isArray(spec);
    return (list ? spec : [spec]).flatMap((entry) => {
      const state = list ? (isRecord(ctx.endState) ? ctx.endState[entry.source] : undefined) : ctx.endState;
      return entryVerdicts(entry, state, list ? `${entry.source}.` : '', failed);
    });
  },
};

/** The runner passes the spec's own block objects, so the last block is found by identity; by position otherwise. */
function isLastSpecBlock(ctx: CheckContext): boolean {
  return ctx.block === ctx.spec.blocks.at(-1) || ctx.blockIndex === ctx.spec.blocks.length - 1;
}

function noneVerdict(diff: EndStateDiff[]): Verdict {
  const [first] = diff;
  if (first === undefined) {
    return machineVerdict(NAME, 'none', 'pass', 'no payload recorded, as end_state none expects');
  }
  return machineVerdict(
    NAME,
    'none',
    'fail',
    `end_state is none, but the adapter recorded ${plural(diff.length, 'payload')}; the first: ${show(first.observed)}`,
  );
}

/** The verdicts of one end-state mapping; each diff entry it consumes leaves `failed`. */
function entryVerdicts(
  entry: EndStateSpec,
  state: unknown,
  prefix: string,
  failed: Map<string, EndStateDiff>,
): Verdict[] {
  const take = (field: string) => {
    const found = failed.get(field);
    failed.delete(field);
    return found;
  };
  const verdicts: Verdict[] = [];
  const fields = Object.entries(entry.expect);
  if (fields.length === 0) verdicts.push(presenceVerdict(entry, state, take(entry.source) !== undefined));
  for (const [field, assertion] of fields) {
    verdicts.push(
      fieldVerdict(entry, field, `${prefix}${field}`, assertion, state, take(`${prefix}${field}`)),
    );
  }
  // What the diff still lists for this mapping is a field of the read state the exact end state does not name.
  if (isRecord(state)) {
    for (const [field, extra] of [...failed]) {
      const name = field.slice(prefix.length);
      if (!field.startsWith(prefix) || !(name in state)) continue;
      failed.delete(field);
      verdicts.push(
        machineVerdict(
          NAME,
          field,
          'fail',
          `${entry.source} ${name} is ${show(extra.observed)}, a field the exact end state does not list`,
        ),
      );
    }
  }
  return verdicts;
}

function presenceVerdict(entry: EndStateSpec, state: unknown, missing: boolean): Verdict {
  if (missing) {
    return machineVerdict(
      NAME,
      entry.source,
      'fail',
      `${entry.source}: nothing was read (no payload recorded, or the adapter cannot read end states); expected a recorded state`,
    );
  }
  const what = isRecord(state) ? 'a mapping' : typeName(state);
  return machineVerdict(NAME, entry.source, 'pass', `${entry.source} recorded ${what} ${show(state)}`);
}

function fieldVerdict(
  entry: EndStateSpec,
  field: string,
  id: string,
  assertion: Assertion,
  state: unknown,
  miss: EndStateDiff | undefined,
): Verdict {
  const expected = describeAssertion(assertion);
  if (!isRecord(state)) {
    const why =
      state === undefined || state === null
        ? 'nothing was read (no payload recorded, or the adapter cannot read end states)'
        : `the state read is ${typeName(state)} (${show(state)}), not a mapping`;
    return machineVerdict(
      NAME,
      id,
      miss ? 'fail' : 'pass',
      `${entry.source}: ${why}, so ${field} is absent; expected ${expected}`,
    );
  }
  const rules = rulesFor(entry.normalise, field);
  const normalised =
    rules.length === 0
      ? ''
      : describeSteps(matchNormalised(state[field], assertion, rules, matchAssertion).steps);
  return machineVerdict(
    NAME,
    id,
    miss ? 'fail' : 'pass',
    `${entry.source} ${field} is ${show(state[field])}, expected ${expected}${normalised}`,
  );
}

/** The type of a state that is not a mapping, as evidence names it. */
function typeName(state: unknown): string {
  if (Array.isArray(state)) return 'a list';
  return typeof state === 'object' ? 'an object' : `a ${typeof state}`;
}
