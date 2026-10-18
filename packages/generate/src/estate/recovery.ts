import { Count } from '@agent-nexus/driftbench-core';
import type { EstateAtom } from './inputs';

export type RecoveryCall = { label: string; input: Record<string, unknown>; count?: Count };
export type RecoveryAction = {
  reread: string[];
  calls: RecoveryCall[];
  retry: boolean;
  /** A declared recovery target that has no executable path. */
  unpathed: string[];
  /** Malformed source entries remain hard gaps even beside valid requirements. */
  invalid?: string[];
};

/** Recovery comes from the map's typed declaration, never inferred from source wording. */
export function recoveryAction(atom: EstateAtom, atoms?: ReadonlyMap<string, EstateAtom>): RecoveryAction {
  const reread: string[] = [];
  const calls: RecoveryCall[] = [];
  const unpathed: string[] = [];
  const invalid: string[] = [];
  let retry = false;
  const declarations: Array<{ path: string; value: unknown }> = [];
  // Keep the historical options-before-fields order of emitted requirements.
  atom.evidence.forEach((evidence, index) => {
    if (evidence.type === 'custom' && evidence.name === 'hazard_recovery' && evidence.options !== undefined)
      declarations.push({ path: `evidence[${index}].options`, value: evidence.options });
  });
  if (atom.fields?.recovery !== undefined)
    declarations.push({ path: 'fields.recovery', value: atom.fields.recovery });
  const strings = (value: unknown, path: string, target: string[]) => {
    if (value === undefined) return;
    if (!Array.isArray(value)) {
      invalid.push(`${path}: expected an array`);
      return;
    }
    value.forEach((entry, index) => {
      if (typeof entry !== 'string' || entry.trim() === '')
        invalid.push(`${path}[${index}]: expected a nonempty string`);
      else if (!target.includes(entry)) target.push(entry);
    });
  };
  for (const { path, value } of declarations) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      invalid.push(`${path}: expected an object`);
      continue;
    }
    const declaration = value as Record<string, unknown>;
    strings(declaration.reread, `${path}.reread`, reread);
    strings(declaration.unpathed, `${path}.unpathed`, unpathed);
    if (declaration.retry === true) retry = true;
    else if (declaration.retry !== undefined && declaration.retry !== false)
      invalid.push(`${path}.retry: expected a boolean`);
    if (declaration.calls === undefined) continue;
    if (!Array.isArray(declaration.calls)) {
      invalid.push(`${path}.calls: expected an array`);
      continue;
    }
    declaration.calls.forEach((entry, index) => {
      const at = `${path}.calls[${index}]`;
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        invalid.push(`${at}: expected a call object`);
        return;
      }
      const call = entry as Record<string, unknown>;
      if (
        typeof call.label !== 'string' ||
        call.label.trim() === '' ||
        typeof call.input !== 'object' ||
        call.input === null ||
        Array.isArray(call.input)
      ) {
        invalid.push(`${at}: expected a nonempty label and an input object`);
        return;
      }
      if (call.count !== undefined) {
        const parsed = Count.safeParse(call.count);
        if (!parsed.success) {
          invalid.push(`${at}.count: invalid call count`);
          return;
        }
        const count = parsed.data;
        const minimum = typeof count === 'number' ? count : (count.min ?? 0);
        if (minimum <= 0 || (typeof count === 'object' && count.max !== undefined && count.max < minimum)) {
          invalid.push(`${at}.count: expected a positive, consistent lower bound`);
          return;
        }
      }
      calls.push(entry as RecoveryCall);
    });
  }
  const sources = [
    atom,
    ...[...(atoms?.values() ?? [])].filter((candidate) => {
      const source = atom.provenance;
      const other = candidate.provenance;
      return (
        candidate.id !== atom.id &&
        source?.file !== undefined &&
        source.startLine !== undefined &&
        source.endLine !== undefined &&
        other?.file === source.file &&
        other.startLine === source.startLine &&
        other.endLine === source.endLine
      );
    }),
  ];
  for (const source of sources)
    for (const evidence of source.evidence) {
      if (evidence.type !== 'tool_called' || evidence.input === undefined) continue;
      if (evidence.label === 'Read') {
        const assertion = evidence.input.file_path ?? evidence.input.path;
        const value =
          typeof assertion === 'string'
            ? assertion
            : typeof assertion === 'object' && assertion !== null && !Array.isArray(assertion)
              ? ((assertion as Record<string, unknown>).equals ??
                (assertion as Record<string, unknown>).contains)
              : undefined;
        if (typeof value === 'string' && value.trim() !== '' && !reread.includes(value)) reread.push(value);
      } else if (
        !calls.some(
          (call) =>
            call.label === evidence.label && JSON.stringify(call.input) === JSON.stringify(evidence.input),
        )
      ) {
        calls.push({ label: evidence.label, input: evidence.input });
      }
    }
  return {
    reread,
    calls,
    retry,
    unpathed,
    ...(invalid.length > 0 ? { invalid } : {}),
  };
}
