import { callSucceeded, samePath, toolExecutions } from './subject';
import type { EvidenceInput, ToolCall } from './types';

export { callSucceeded } from './subject';

const PARTIAL_COMMAND = /\b(head|tail|sed\s+-n|awk|grep)\b/;
const FULL_COMMAND = /\b(cat|less|more|bat)\b/;

/** The read forms recorded by the adapters. Other commands are executions, not file reads. */
export function readPaths(call: ToolCall): string[] {
  const args = (call.input ?? {}) as Record<string, unknown>;
  if (call.label === 'Read') {
    const path = args.file_path ?? args.path;
    return typeof path === 'string' ? [path] : [];
  }
  if (
    typeof args.command !== 'string' ||
    !(PARTIAL_COMMAND.test(args.command) || FULL_COMMAND.test(args.command))
  )
    return [];
  // Quoted paths remain one token. Redirections and shell operators are not file names.
  return (args.command.match(/"[^"\n]*"|'[^'\n]*'|[^\s;|<>]+/g) ?? [])
    .map((token) => token.replace(/^["']|["']$/g, ''))
    .filter((token) => !token.startsWith('-') && /[/.]/.test(token));
}

/** Full/partial reads from calls and executions; summaries are a fallback only when no read was recorded. */
export function readAmount(input: EvidenceInput, path: string): 'none' | 'partial' | 'full' {
  let amount: 'none' | 'partial' | 'full' = 'none';
  let attempted = false;
  const raise = (partial: boolean) => {
    if (!partial) amount = 'full';
    else if (amount === 'none') amount = 'partial';
  };
  for (const call of input.block.observed.toolCalls) {
    if (!readPaths(call).some((file) => samePath(file, path))) continue;
    attempted = true;
    if (!callSucceeded(input, call)) continue;
    const args = (call.input ?? {}) as Record<string, unknown>;
    raise(
      call.label === 'Read'
        ? args.offset !== undefined || args.limit !== undefined
        : PARTIAL_COMMAND.test(String(args.command)),
    );
  }
  for (const run of toolExecutions(input)) {
    const call = { label: 'Bash', input: { command: run.command } };
    if (!readPaths(call).some((file) => samePath(file, path))) continue;
    attempted = true;
    // A matching failed call cannot be laundered through a summary execution.
    const matches = input.block.observed.toolCalls.filter(
      (one) =>
        (one.input as { command?: unknown } | undefined)?.command === run.command &&
        (run.startedAt === undefined || one.startedAt === undefined || one.startedAt === run.startedAt),
    );
    if (run.exitCode === 0 && (matches.length === 0 || matches.some((one) => callSucceeded(input, one))))
      raise(PARTIAL_COMMAND.test(run.command));
  }
  if (!attempted && (input.block.observed.runtime?.references ?? []).some((ref) => samePath(ref.path, path)))
    return 'full';
  return amount;
}
