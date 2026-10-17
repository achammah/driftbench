import {
  type CheckContext,
  type DiagnosticStep,
  diagnosticStep,
  isZero,
  NoParams,
  objectRegistry,
  registerDiagnosticStep,
  type Verdict,
} from '@agent-nexus/driftbench-core';
import { entryKeys, plural } from './support/values';

/** The implementation of the argument-accuracy step. */
export const ARGUMENT_ACCURACY_STEP = 'builtin:diagnostic/argument-accuracy';

type Input = { key: string; field: string };

/** Exact input IDs use the same repeated-tool keys and zero-count exclusion as the tools check. */
function expectedInputs(check: CheckContext | undefined): Map<string, Input> | undefined {
  // Stored records used without a check context retain the legacy ID parser below.
  if (check?.expect === undefined) return undefined;
  const tools = (check.expect.tools ?? []).filter((tool) => !isZero(tool.count));
  const keys = entryKeys(tools.map((tool) => tool.label));
  return new Map(
    tools.flatMap((tool, index) => {
      const key = keys[index] ?? tool.label;
      return Object.keys(tool.input ?? {}).map((field): [string, Input] => [
        `tools.${key}.input.${field}`,
        { key, field },
      ]);
    }),
  );
}

/** Lints are not arguments, even when their IDs collide with a real argument's name. */
function inputOf(verdict: Verdict, expected: Map<string, Input> | undefined): Input | undefined {
  if (
    verdict.name !== 'tools' ||
    !verdict.id.startsWith('tools.') ||
    verdict.evidence.startsWith('test lint:')
  )
    return undefined;
  if (expected !== undefined) return expected.get(verdict.id);
  const at = verdict.id.indexOf('.input.', 'tools.'.length);
  if (at < 0) return undefined;
  return { key: verdict.id.slice('tools.'.length, at), field: verdict.id.slice(at + '.input.'.length) };
}

/**
 * The share of a block's expected tool arguments that matched, computed from the input verdicts of the tools
 * check. It used to be the verdict `tools.argument_accuracy`; a measure computed from other verdicts is a
 * diagnosis, so it never changes a verdict or `pass`, and a change to how one argument is compared changes the
 * diagnosis, never another verdict.
 */
const argumentAccuracy: DiagnosticStep = {
  params: NoParams,
  cost: 'static',
  summary: 'The share of the expected tool arguments that matched.',
  run: ({ verdicts, check }) => {
    const expected = expectedInputs(check);
    const inputs = verdicts.flatMap((verdict) => {
      const input = inputOf(verdict, expected);
      return input ? [{ ...input, pass: verdict.outcome === 'pass' }] : [];
    });
    if (inputs.length === 0) return undefined;
    const missed = inputs
      .filter((input) => !input.pass)
      .map((input) => `${input.key.replace(/#\d+$/, '')} input.${input.field}`);
    const matched = inputs.length - missed.length;
    const note = missed.length > 0 ? `; missed: ${missed.join(', ')}` : '';
    return {
      score: matched / inputs.length,
      summary: `${matched} of ${plural(inputs.length, 'expected argument')} matched${note}`,
      evidence: { matched, expected: inputs.length, missed },
    };
  },
};

/** `diagnostic:argument-accuracy`, shipped and run by default on every block whose tools check compared an argument. */
export const ARGUMENT_ACCURACY_DIAGNOSTIC = {
  kind: 'diagnostic',
  id: 'argument-accuracy',
  extends: null,
  description: 'The share of the expected tool arguments that matched, once per block.',
  scope: 'block',
  default: true,
  when: { any_verdict: { name: 'tools', id_contains: '.input.' } },
  reads: ['check-set'],
  steps: [
    { id: 'share', title: 'The share of the expected arguments that matched', impl: ARGUMENT_ACCURACY_STEP },
  ],
};

/** Registers the default diagnostic explicitly, including after the object registry is restored. */
export function registerArgumentAccuracy(): void {
  const held = diagnosticStep(ARGUMENT_ACCURACY_STEP);
  if (held === undefined) {
    registerDiagnosticStep(ARGUMENT_ACCURACY_STEP, argumentAccuracy);
  } else if (objectRegistry.impl(ARGUMENT_ACCURACY_STEP) === undefined) {
    // The step implementation map survives registry.restore; restore only its missing object metadata.
    objectRegistry.registerImpl(ARGUMENT_ACCURACY_STEP, {
      params: held.params,
      kinds: ['diagnostic'],
      ...(held.summary === undefined ? {} : { summary: held.summary }),
    });
  }
  if (!objectRegistry.snapshot().shipped.has('diagnostic:argument-accuracy')) {
    objectRegistry.registerShipped(
      ARGUMENT_ACCURACY_DIAGNOSTIC,
      '@agent-nexus/driftbench-checks diagnostic:argument-accuracy',
    );
  }
}
