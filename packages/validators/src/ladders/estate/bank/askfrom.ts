import type { SuiteSpec } from './fixture-suite';
import { type AskEnv, checkAsk } from './task-check';

/** A disclosure is pinned to a map act and a reproducible source, never an allowed vocabulary. */
export function disclosedAskReasons(spec: SuiteSpec, env: AskEnv): string[] {
  const meta = spec.spec.metadata?.estate as
    | { askFrom?: unknown; from?: { field?: unknown; neutral?: unknown } }
    | undefined;
  if (typeof meta?.askFrom !== 'string' || meta.askFrom === '') return ['the ask names no source'];
  const source = meta.askFrom.split(' (')[0];
  if (source === 'neutral') {
    if (typeof meta.from?.neutral !== 'string') return ['the neutral disclosure carries no neutral source'];
  } else if (typeof meta.from?.field !== 'string' || meta.from.field.split('#')[0] !== source) {
    return ['the disclosure and its source record name different atoms'];
  }
  return checkAsk(spec, env).reasons;
}
