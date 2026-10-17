import { error, type Issue } from './issues';

/**
 * Turns authoring shorthand into the canonical spec shape before validation:
 * - a block's `user: "..."` or `burst: [...]` becomes `when: { user }` or `when: { burst }`;
 * - a spec's `ledger_seed` becomes `given.ledger`, `workspace_seed` becomes `given.world.workspace`;
 * - `kind` defaults to `conversation`.
 */
export function normalizeSpec(raw: unknown): { value: unknown; issues: Issue[] } {
  const issues: Issue[] = [];
  if (!isPlainObject(raw)) {
    issues.push(
      error('SPEC_NOT_OBJECT', '', 'a spec file must hold one mapping (an object) at the top level'),
    );
    return { value: raw, issues };
  }
  const spec: Record<string, unknown> = { ...raw };

  if (spec.kind === undefined) spec.kind = 'conversation';

  if ('ledger_seed' in spec) {
    const given = isPlainObject(spec.given) ? { ...spec.given } : {};
    if ('ledger' in given) {
      issues.push(
        error('SPEC_ALIAS_CONFLICT', 'ledger_seed', 'set `ledger_seed` or `given.ledger`, not both'),
      );
    } else {
      given.ledger = spec.ledger_seed;
    }
    spec.given = given;
    delete spec.ledger_seed;
  }

  if ('workspace_seed' in spec) {
    const given = isPlainObject(spec.given) ? { ...spec.given } : {};
    const world = isPlainObject(given.world) ? { ...given.world } : {};
    if ('workspace' in world) {
      issues.push(
        error(
          'SPEC_ALIAS_CONFLICT',
          'workspace_seed',
          'set `workspace_seed` or `given.world.workspace`, not both',
        ),
      );
    } else {
      const seed = spec.workspace_seed;
      world.workspace = typeof seed === 'string' ? { from: seed } : seed;
    }
    given.world = world;
    spec.given = given;
    delete spec.workspace_seed;
  }

  if (isPlainObject(spec.given)) spec.given = withOrderedPrefix(spec.given);

  if (Array.isArray(spec.blocks)) {
    spec.blocks = spec.blocks.map((block, index) => normalizeBlock(block, `blocks.${index}`, issues));
  }

  return { value: spec, issues };
}

/**
 * A prefix with the keys of every tool call's input and output in one order (sorted at every depth), so the
 * same call written with its keys in another order reaches the agent as the same text, as the spec hash
 * already reads it. The values and the order of the lists stay as written.
 */
function withOrderedPrefix(given: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(given.prefix)) return given;
  const prefix = given.prefix.map((message) => {
    if (!isPlainObject(message) || !Array.isArray(message.tool_calls)) return message;
    const tool_calls = message.tool_calls.map((call) => {
      if (!isPlainObject(call)) return call;
      const out: Record<string, unknown> = { ...call };
      if ('input' in out) out.input = sortedKeys(out.input);
      if ('output' in out) out.output = sortedKeys(out.output);
      return out;
    });
    return { ...message, tool_calls };
  });
  return { ...given, prefix };
}

function sortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) out[key] = sortedKeys(value[key]);
  return out;
}

function normalizeBlock(block: unknown, path: string, issues: Issue[]): unknown {
  if (!isPlainObject(block)) return block;
  const out: Record<string, unknown> = { ...block };
  if (isPlainObject(out.given)) out.given = withOrderedPrefix(out.given);
  const hasUser = 'user' in out;
  const hasBurst = 'burst' in out;
  const hasWhen = 'when' in out;

  if (Number(hasUser) + Number(hasBurst) + Number(hasWhen) > 1) {
    const present = [...(hasUser ? ['user'] : []), ...(hasBurst ? ['burst'] : [])];
    issues.push(
      error(
        'BLOCK_STIMULUS_AMBIGUOUS',
        path,
        `a block takes exactly one of \`user\`, \`burst\` or \`when\`; this one has ${[...present, ...(hasWhen ? ['when'] : [])].join(' and ')}`,
      ),
    );
    return out;
  }
  if (!hasUser && !hasBurst && !hasWhen) {
    issues.push(error('BLOCK_STIMULUS_MISSING', path, 'a block needs `user`, `burst` or `when`'));
    return out;
  }
  const key = hasUser ? 'user' : hasBurst ? 'burst' : undefined;
  if (key !== undefined) {
    out.when = { [key]: out[key] };
    delete out[key];
  }
  return out;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
