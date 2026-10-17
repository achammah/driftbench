import type { Assertion, Count } from '../schema/common';
import type { Expect, Spec } from '../schema/spec';
import { error, type Issue } from './issues';
import { isPlainObject } from './normalize';

const CRITERION_REF = /^([A-Za-z0-9][A-Za-z0-9_.-]*)(@gating)?$/;

/** Splits `name@gating` into its parts. Returns undefined when the reference is malformed. */
export function parseCriterionRef(ref: string): { name: string; gating: boolean } | undefined {
  const match = CRITERION_REF.exec(ref);
  if (!match?.[1]) return undefined;
  return { name: match[1], gating: match[2] === '@gating' };
}

// Cache only the immutable success result, bounded independently of suite size.
const validPatterns = new Set<string>();

/** Compiles a spec pattern the way checks will use it. Returns the error message, or undefined. */
export function patternError(source: string): string | undefined {
  if (validPatterns.has(source)) return undefined;
  try {
    new RegExp(source, 'm');
    if (source.length <= 1024) {
      if (validPatterns.size >= 4096) validPatterns.clear();
      validPatterns.add(source);
    }
    return undefined;
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause);
  }
}

type Context = {
  stages: Set<string> | undefined;
  defined: Set<string> | undefined;
  forbidden: Set<string>;
};

/** Rules a schema cannot express. Every issue returned is an error. */
export function checkSemantics(spec: Spec): Issue[] {
  const issues: Issue[] = [];

  const defined = spec.criteria ? new Set<string>() : undefined;
  spec.criteria?.forEach((criterion, index) => {
    if (defined?.has(criterion.name)) {
      issues.push(
        error(
          'CRITERION_DUPLICATE',
          `criteria.${index}.name`,
          `criterion "${criterion.name}" is defined twice`,
        ),
      );
    }
    defined?.add(criterion.name);
  });

  const forbidden = new Set<string>(spec.rules?.forbidden_tools ?? []);
  for (const [label, max] of Object.entries(spec.rules?.max_calls ?? {})) {
    if (max === 0) forbidden.add(label);
  }
  const ctx: Context = { stages: spec.stages ? new Set(spec.stages) : undefined, defined, forbidden };

  const facts = factsOf(spec);
  const blockIds = new Set<string>();
  spec.blocks.forEach((block, index) => {
    if (block.id !== undefined) {
      if (blockIds.has(block.id)) {
        issues.push(
          error('DUPLICATE_BLOCK_ID', `blocks.${index}.id`, `block id "${block.id}" is used twice`),
        );
      }
      blockIds.add(block.id);
    }
    if (block.given?.origin !== undefined && block.given.prefix === undefined) {
      issues.push(
        error(
          'GIVEN_ORIGIN_WITHOUT_PREFIX',
          `blocks.${index}.given.origin`,
          'origin says where a prefix comes from, and this block writes no prefix: add given.prefix or remove origin',
        ),
      );
    }
    if (block.expect) checkExpect(block.expect, `blocks.${index}.expect`, ctx, issues);
    if (block.expect)
      checkRetention(
        block.expect,
        `blocks.${index}.expect`,
        (fact) => (facts.block.get(fact) ?? Infinity) <= index,
        issues,
      );
  });

  const perturbationIds = new Set<string>();
  spec.perturbations?.forEach((perturbation, index) => {
    const path = `perturbations.${index}`;
    if (perturbationIds.has(perturbation.id)) {
      issues.push(
        error(
          'DUPLICATE_PERTURBATION_ID',
          `${path}.id`,
          `perturbation id "${perturbation.id}" is used twice`,
        ),
      );
    }
    perturbationIds.add(perturbation.id);
    if (perturbation.inject_at > spec.blocks.length) {
      issues.push(
        error(
          'PERTURBATION_OUT_OF_RANGE',
          `${path}.inject_at`,
          `inject_at ${perturbation.inject_at} is past the last position (${spec.blocks.length}); it inserts before block n, counting from 0`,
        ),
      );
    }
    if (
      perturbation.world !== undefined &&
      perturbation.user === undefined &&
      perturbation.burst === undefined &&
      perturbation.inject_at === spec.blocks.length
    ) {
      issues.push(
        error(
          'PERTURBATION_OUT_OF_RANGE',
          `${path}.inject_at`,
          `a perturbation with a world alone runs under block inject_at, and inject_at ${perturbation.inject_at} has no block (${spec.blocks.length} blocks, counting from 0)`,
        ),
      );
    }
    if (
      perturbation.user === undefined &&
      perturbation.burst === undefined &&
      perturbation.world === undefined
    ) {
      issues.push(error('PERTURBATION_EMPTY', path, 'a perturbation needs `user`, `burst` or `world`'));
    }
    if (perturbation.expect) checkExpect(perturbation.expect, `${path}.expect`, ctx, issues);
    if (perturbation.expect) {
      checkRetention(
        perturbation.expect,
        `${path}.expect`,
        (fact) => (facts.perturbation.get(fact) ?? Infinity) <= perturbation.inject_at,
        issues,
      );
    }
    const after = perturbation.recovery?.stage_after;
    if (after !== undefined && ctx.stages && !ctx.stages.has(after)) {
      issues.push(
        error(
          'STAGE_UNKNOWN',
          `${path}.recovery.stage_after`,
          `stage "${after}" is not in the spec's stages`,
        ),
      );
    }
  });

  const endStates = spec.end_state === undefined || spec.end_state === 'none' ? [] : [spec.end_state].flat();
  endStates.forEach((endState, index) => {
    const base = Array.isArray(spec.end_state) ? `end_state.${index}.expect` : 'end_state.expect';
    for (const [field, assertion] of Object.entries(endState.expect)) {
      checkAssertion(assertion, `${base}.${field}`, issues);
    }
  });

  const links = spec.metadata?.links;
  if (Array.isArray(links)) {
    links.forEach((link: unknown, index) => {
      const block = isPlainObject(link) ? link.block : undefined;
      const known =
        block === undefined ||
        (typeof block === 'number' && block < spec.blocks.length) ||
        (typeof block === 'string' && blockIds.has(block));
      if (!known) {
        issues.push(
          error(
            'LINK_BLOCK_UNKNOWN',
            `metadata.links.${index}.block`,
            `the link names block ${JSON.stringify(block)}, which the spec does not have`,
          ),
        );
      }
    });
  }

  return issues;
}

function checkExpect(expect: Expect, path: string, ctx: Context, issues: Issue[]): void {
  for (const key of ['must', 'must_not'] as const) {
    expect[key]?.forEach((pattern, index) => {
      const problem = patternError(pattern);
      if (problem) issues.push(error('REGEX_INVALID', `${path}.${key}.${index}`, problem));
    });
  }
  expect.regex?.forEach((pattern, index) => {
    const problem = patternError(pattern);
    if (problem) issues.push(error('REGEX_INVALID', `${path}.regex.${index}`, problem));
  });
  expect.json?.paths?.forEach((entry, index) => {
    checkAssertion(entry.assert, `${path}.json.paths.${index}.assert`, issues);
  });
  const mustNot = new Set(expect.must_not ?? []);
  expect.must?.forEach((pattern, index) => {
    if (mustNot.has(pattern)) {
      issues.push(
        error('MUST_CONFLICT', `${path}.must.${index}`, `"${pattern}" is in both must and must_not`),
      );
    }
  });

  expect.tools?.forEach((tool, index) => {
    const toolPath = `${path}.tools.${index}`;
    checkCount(tool.count, `${toolPath}.count`, issues);
    const zero = isZero(tool.count);
    if (zero && tool.input) {
      issues.push(
        error(
          'TOOL_COUNT_CONTRADICTION',
          toolPath,
          `"${tool.label}" is expected 0 times but has input assertions`,
        ),
      );
    }
    if (!zero && ctx.forbidden.has(tool.label)) {
      issues.push(
        error(
          'TOOL_FORBIDDEN_EXPECTED',
          toolPath,
          `"${tool.label}" is forbidden by the spec's rules but expected here`,
        ),
      );
    }
    for (const [field, assertion] of Object.entries(tool.input ?? {})) {
      checkAssertion(assertion, `${toolPath}.input.${field}`, issues);
    }
  });
  for (const [index, card] of (expect.cards ?? []).entries()) {
    checkCount(card.count, `${path}.cards.${index}.count`, issues);
  }
  for (const [index, skill] of (expect.skills ?? []).entries()) {
    checkCount(skill.count, `${path}.skills.${index}.count`, issues);
  }
  for (const [index, guard] of (expect.guards ?? []).entries()) {
    checkCount(guard.count, `${path}.guards.${index}.count`, issues);
  }
  for (const [index, reference] of (expect.references ?? []).entries()) {
    checkCount(reference.count, `${path}.references.${index}.count`, issues);
  }
  for (const [index, subagent] of (expect.subagents ?? []).entries()) {
    checkCount(subagent.count, `${path}.subagents.${index}.count`, issues);
  }

  expect.criteria?.forEach((ref, index) => {
    const parsed = parseCriterionRef(ref);
    if (!parsed) {
      issues.push(
        error(
          'CRITERION_REF_INVALID',
          `${path}.criteria.${index}`,
          `"${ref}" is not a criterion name, optionally followed by @gating`,
        ),
      );
      return;
    }
    if (ctx.defined && !ctx.defined.has(parsed.name)) {
      issues.push(
        error(
          'CRITERION_UNDEFINED',
          `${path}.criteria.${index}`,
          `criterion "${parsed.name}" is not defined in this spec's criteria`,
        ),
      );
    }
  });

  if (expect.stage !== undefined && ctx.stages && !ctx.stages.has(expect.stage)) {
    issues.push(
      error('STAGE_UNKNOWN', `${path}.stage`, `stage "${expect.stage}" is not in the spec's stages`),
    );
  }
}

function checkAssertion(assertion: Assertion, path: string, issues: Issue[]): void {
  if (assertion !== null && typeof assertion === 'object' && 'regex' in assertion) {
    const problem = patternError(assertion.regex);
    if (problem) issues.push(error('REGEX_INVALID', `${path}.regex`, problem));
  }
}

function checkCount(count: Count | undefined, path: string, issues: Issue[]): void {
  if (count === undefined || typeof count === 'number') return;
  if (count.min !== undefined && count.max !== undefined && count.min > count.max) {
    issues.push(error('COUNT_RANGE_INVALID', path, `min ${count.min} is greater than max ${count.max}`));
  }
}

/** True when a count allows only zero calls. */
export function isZero(count: Count | undefined): boolean {
  if (count === undefined) return false;
  if (typeof count === 'number') return count === 0;
  return count.max === 0;
}

/**
 * Where each ledger key becomes known, read once for the whole spec: the seed from the start, a block's
 * given.ledger from that block (a perturbation inserted before it runs before that given is set), and a
 * block's ledger_add from the block after it.
 */
type Facts = { block: Map<string, number>; perturbation: Map<string, number> };

function factsOf(spec: Spec): Facts {
  const block = new Map<string, number>();
  const perturbation = new Map<string, number>();
  const note = (map: Map<string, number>, key: string, at: number) => {
    const known = map.get(key);
    if (known === undefined || at < known) map.set(key, at);
  };
  for (const key of Object.keys(spec.given?.ledger ?? {})) {
    block.set(key, 0);
    perturbation.set(key, 0);
  }
  spec.blocks.forEach((entry, at) => {
    for (const key of Object.keys(entry.given?.ledger ?? {})) {
      note(block, key, at);
      note(perturbation, key, at + 1);
    }
    for (const key of Object.keys(entry.expect?.ledger_add ?? {})) {
      note(block, key, at + 1);
      note(perturbation, key, at + 1);
    }
  });
  return { block, perturbation };
}

/** A retention fact must be in the ledger before the block, and its ask pattern must compile. */
function checkRetention(
  expect: Expect,
  path: string,
  known: (fact: string) => boolean,
  issues: Issue[],
): void {
  expect.knowledge_retention?.forEach((entry, index) => {
    const at = `${path}.knowledge_retention.${index}`;
    if (!known(entry.fact)) {
      issues.push(
        error(
          'RETENTION_FACT_UNKNOWN',
          `${at}.fact`,
          `fact "${entry.fact}" is in no ledger before this block: not in given.ledger, nor in an earlier ledger_add`,
        ),
      );
    }
    if (entry.ask !== undefined) {
      const problem = patternError(entry.ask);
      if (problem) issues.push(error('REGEX_INVALID', `${at}.ask`, problem));
    }
  });
}
