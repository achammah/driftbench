import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseJudgeText } from '../assessment';
import type { ClientOptions, JudgeClient } from '../client';
import { inconclusive, type JudgeRequest, type JudgeResult } from '../contract';
import { isRecord, JudgeError } from '../http';
import { buildPrompt } from '../prompt';
import {
  CLAUDE_SUBMISSION_CEILING,
  type ClaudeRetryReceipt,
  ClaudeTransportError,
  withClaudeErrorRetries,
} from './claude-errors';
import { JUDGE_DIALECTS, withJudgeDialect } from './dialects';
import type { TokenUsage } from './usage';

/**
 * A system 2 judge behind the local `claude` command (Claude Code in print mode), for a machine where the
 * account is signed in to the command and no API key is set. One call is one process:
 *
 *   claude -p --output-format json --model <m> --system-prompt <judge system prompt> --tools ""
 *     --setting-sources "" --strict-mcp-config --no-session-persistence --max-turns 1
 *
 * The user prompt (rubric and data, inside their data tags) goes on stdin, never on the command line. The
 * process runs in an empty folder of its own, with no tool, no settings file and no MCP server, so no
 * project file, memory or hook of the caller reaches the judge. The answer is the `result` text of the
 * JSON result, read through the answer contract; the cost is its `total_cost_usd`.
 *
 * Errors: an output-limit error gets one lower-effort recovery, subject to the caller spend cap; transient
 * API errors without an answer are retried; other errors retain sanitized diagnostics. Recovery and retries
 * share one ceiling of three submissions and one spend cap: each later process gets what is left of it. A run that stopped at its turn limit is an unparsed answer, never
 * a pass. Reads CLAUDE_JUDGE_MODEL when no model is given.
 */

export type ClaudeCliOptions = Pick<
  ClientOptions,
  'env' | 'id' | 'model' | 'cost' | 'timeoutMs' | 'retry' | 'maxRetries' | 'sleep'
> & {
  /** The command to run. Default `claude`. */
  command?: string;
  /** Arguments before the judge's own, such as a script path for a fake command. */
  commandArgs?: readonly string[];
  /** Passed as --max-budget-usd on every call: the command stops a call that would spend more. */
  maxBudgetUsd?: number;
  /** Opt-in adaptive thinking control. Unset preserves the native request. */
  claudeEffort?: 'low' | 'medium' | 'high';
  /**
   * Conservative upper bound reserved before a later process when maxBudgetUsd is set. A recovery needs it;
   * a transient retry starts without it while anything is left of the cap.
   */
  retryMaxCostUsd?: number;
};

/**
 * Relative cost by model, from the list price ratio of the three Claude tiers (1 : 3 : 5), on the scale
 * where a chat model costs 10. A model name that names none of them costs 10.
 */
export function claudeCost(model: string): number {
  const name = model.toLowerCase();
  if (name.includes('opus')) return 50;
  if (name.includes('sonnet')) return 30;
  return 10;
}

/** The flags that shape every answer: no tool, no settings file, no MCP server, no session, one turn. */
export const CLAUDE_JUDGE_FLAGS = [
  '--tools',
  '',
  '--setting-sources',
  '',
  '--strict-mcp-config',
  '--no-session-persistence',
  '--max-turns',
  '1',
] as const;

/** The client settings a cassette keys on: the print-mode format and the judge flags (not the spend cap). */
export const CLAUDE_SETTINGS = JSON.stringify(['-p', '--output-format', 'json', ...CLAUDE_JUDGE_FLAGS]);

/**
 * Runs `work` in an empty folder of its own and removes the folder when the work ends, however it ends: a
 * folder per call, never one that outlives its client. The folder is the working directory of the process,
 * so no project file or memory of the caller reaches it.
 */
export async function withScratchFolder<T>(prefix: string, work: (folder: string) => Promise<T>): Promise<T> {
  const folder = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await work(folder);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

type Ran = { code: number | null; stdout: string; stderr: string };

export function createClaudeCliJudge(options: ClaudeCliOptions = {}): JudgeClient {
  const env = options.env ?? process.env;
  const model = env.CLAUDE_JUDGE_MODEL?.trim() || options.model;
  if (!model) throw new JudgeError('config', 'CLAUDE_JUDGE_MODEL is not set and no model was given');
  const command = options.command ?? 'claude';
  const timeoutMs = options.timeoutMs ?? 120_000;

  return {
    id: options.id ?? `claude-${model}`,
    family: 'anthropic',
    cls: 'system2',
    model,
    dialect: JUDGE_DIALECTS['claude-cli'].id,
    cost: options.cost ?? claudeCost(model),
    settings:
      options.claudeEffort === undefined
        ? CLAUDE_SETTINGS
        : JSON.stringify({ settings: CLAUDE_SETTINGS, claudeEffort: options.claudeEffort }),
    async judge(original) {
      const request = withJudgeDialect(original, JUDGE_DIALECTS['claude-cli'].id);
      const prompt = buildPrompt(request);
      const args = [
        ...(options.commandArgs ?? []),
        '-p',
        '--output-format',
        'json',
        '--model',
        model,
        '--system-prompt',
        prompt.system,
        ...CLAUDE_JUDGE_FLAGS,
        ...(options.maxBudgetUsd === undefined ? [] : ['--max-budget-usd', String(options.maxBudgetUsd)]),
      ];
      const sent = await withScratchFolder('driftbench-claude-judge-', (cwd) =>
        runClaudeJudgeCommand(command, args, prompt.user, {
          ...options,
          cwd,
          env,
          timeoutMs,
          system: prompt.system,
        }),
      );
      return { ...readResult(sent.ran, model, request), ...sent.accounting };
    },
  };
}

function readResult(ran: Ran, model: string, request: JudgeRequest): JudgeResult {
  let payload: unknown;
  try {
    payload = JSON.parse(ran.stdout);
  } catch {
    if (ran.code !== 0) {
      throw new JudgeError('http', `claude exited ${ran.code}: ${clip(ran.stderr || ran.stdout)}`);
    }
    throw new JudgeError('bad_response', `claude printed not a JSON result: ${clip(ran.stdout)}`);
  }
  if (!isRecord(payload) || payload.type !== 'result') {
    throw new JudgeError('bad_response', `claude printed not a JSON result: ${clip(ran.stdout)}`);
  }
  const cost =
    typeof payload.total_cost_usd === 'number' && payload.total_cost_usd >= 0
      ? { costUsd: payload.total_cost_usd }
      : {};
  const text = typeof payload.result === 'string' ? payload.result : '';
  if (payload.is_error === true) {
    throw new JudgeError('http', `claude ${model} answered with an error: ${clip(text)}`, {
      retryable: true,
    });
  }
  if (payload.subtype !== 'success') {
    return {
      answer: inconclusive(`claude ${model} stopped without an answer: ${String(payload.subtype)}`),
      raw: ran.stdout,
      unparsed: true,
      ...cost,
    };
  }
  return { ...parseJudgeText(text, request), ...cost };
}

/** Shared isolated-process mechanics for contract-aware judges and raw dialect transports. */
export function runClaudeCommand(
  command: string,
  args: readonly string[],
  input: string,
  options: { cwd: string; env: Record<string, string | undefined>; timeoutMs: number },
): Promise<Ran> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env as NodeJS.ProcessEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(
        new JudgeError('network', `claude ran past ${options.timeoutMs} ms and was stopped`, {
          retryable: true,
        }),
      );
    }, options.timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', (cause) => {
      clearTimeout(timer);
      reject(new JudgeError('config', `cannot run ${command}: ${cause.message}`));
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.on('error', () => {
      // The process closed its input early; its exit code and output say why.
    });
    child.stdin.end(input);
  });
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 200 ? `${flat.slice(0, 200)}...` : flat;
}

type ClaudeThinkingAttempt = { raw: string; usage: TokenUsage; costUsd?: number };
export type ClaudeThinkingRecovery = {
  readonly reason: 'reasoning-budget-exhausted';
  /** The exhausted submission and the low-effort one that settled it; transient failures are retry receipts. */
  readonly requestCount: number;
  readonly attempts: readonly ClaudeThinkingAttempt[];
  readonly retrySkipped?: 'spend-cap' | 'submission-ceiling';
};
export class ClaudeThinkingError extends JudgeError {
  readonly category = 'output-limit' as const;
  constructor(
    readonly thinkingRecovery: ClaudeThinkingRecovery,
    readonly usage: TokenUsage,
    readonly costUsd?: number,
  ) {
    super('reasoning-budget-exhausted', 'Claude exhausted its output budget before producing an answer');
  }
}
export type ClaudeAccounting = {
  thinkingRecovery?: ClaudeThinkingRecovery;
  retryReceipts?: readonly ClaudeRetryReceipt[];
  requestCount?: number;
  usage?: TokenUsage;
  costUsd?: number;
  /** A process of the call reported no cost: costUsd is absent, never the cost of a part. */
  costIncomplete?: true;
};
/**
 * One judge call: thinking recovery inside each attempt, then failure classification and transient retries.
 * Both draw on CLAUDE_SUBMISSION_CEILING processes in total and on one spend cap: every process after the
 * first is given the cap less the known cost of the earlier ones, and does not start when that cost is
 * unknown or the remainder cannot cover its reservation. Native receipts and cumulative billing of every
 * process survive a failed recovery or retry.
 */
export async function runClaudeJudgeCommand(
  command: string,
  args: readonly string[],
  input: string,
  options: ClaudeCliOptions & {
    cwd: string;
    env: Record<string, string | undefined>;
    timeoutMs: number;
    /** The system prompt inside args, redacted from failure diagnostics with the input. */
    system: string;
  },
): Promise<{ ran: Ran; accounting: ClaudeAccounting }> {
  for (const n of [options.maxBudgetUsd, options.retryMaxCostUsd])
    if (n !== undefined && (!Number.isFinite(n) || n <= 0))
      throw new RangeError('spend limits must be positive and finite');
  // Every process that returned, in order; `launched` also counts one that never returned.
  const returned: ClaudeThinkingAttempt[] = [];
  const thinking: ClaudeThinkingAttempt[] = [];
  let launched = 0;
  let low = false;
  const totals = () => {
    const usage: Record<string, number> = {};
    for (const key of ['input', 'output'] as const)
      if (returned.every((a) => a.usage[key] !== undefined))
        usage[key] = returned.reduce((n, a) => n + (a.usage[key] ?? 0), 0);
    const costUsd = returned.every((a) => a.costUsd !== undefined)
      ? returned.reduce((n, a) => n + (a.costUsd ?? 0), 0)
      : undefined;
    return { usage, ...(costUsd === undefined ? {} : { costUsd }) };
  };
  const recovery = (retrySkipped?: ClaudeThinkingRecovery['retrySkipped']): ClaudeThinkingRecovery => ({
    reason: 'reasoning-budget-exhausted',
    requestCount: thinking.length,
    attempts: [...thinking],
    ...(retrySkipped ? { retrySkipped } : {}),
  });
  const fail = (skipped?: ClaudeThinkingRecovery['retrySkipped']) => {
    const t = totals();
    return new ClaudeThinkingError(recovery(skipped), t.usage, t.costUsd);
  };
  /** What is left of the cap for a later process, or undefined when that process may not start. */
  const remaining = (recovering: boolean): number | undefined => {
    const cap = options.maxBudgetUsd;
    if (cap === undefined) return Number.POSITIVE_INFINITY;
    // Every earlier process, failed retries included, counts against the cap.
    const spent = totals().costUsd;
    if (spent === undefined || launched > returned.length) return undefined;
    const reserve = options.retryMaxCostUsd;
    if (reserve === undefined ? recovering || spent >= cap : spent + reserve > cap) return undefined;
    return cap - spent;
  };
  const submit = async () => {
    const effort = low ? 'low' : options.claudeEffort;
    const nextArgs = [...args];
    if (effort !== undefined) nextArgs.push('--effort', effort);
    if (launched > 0 && options.maxBudgetUsd !== undefined) {
      const left = remaining(low);
      if (left === undefined) throw fail('spend-cap');
      const at = nextArgs.indexOf('--max-budget-usd');
      if (at >= 0) nextArgs[at + 1] = String(left);
    }
    launched++;
    let ran: Ran;
    try {
      ran = await runClaudeCommand(command, nextArgs, input, options);
    } catch (cause) {
      if (low) {
        const error = fail();
        error.cause = cause;
        throw error;
      }
      throw cause;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(ran.stdout);
    } catch {
      payload = undefined;
    }
    const value = isRecord(payload) ? payload : {};
    const u = isRecord(value.usage) ? value.usage : {};
    const valid = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;
    const receipt: ClaudeThinkingAttempt = {
      raw: ran.stdout,
      usage: {
        ...(valid(u.input_tokens) ? { input: u.input_tokens } : {}),
        ...(valid(u.output_tokens) ? { output: u.output_tokens } : {}),
      },
      ...(valid(value.total_cost_usd) ? { costUsd: value.total_cost_usd } : {}),
    };
    returned.push(receipt);
    return {
      ran,
      receipt,
      answered: ran.code === 0 && value.type === 'result' && value.is_error !== true,
      exhausted:
        value.is_error === true &&
        (value.api_error === 'max_output_tokens' ||
          (typeof value.result === 'string' &&
            /^API Error: Claude's response exceeded the \d+ output token maximum\./.test(value.result))),
    };
  };
  // One retry attempt. An exhausted answer is recovered here, before the retry layer classifies the result.
  const attempt = async (): Promise<Ran> => {
    let sent = await submit();
    if (sent.exhausted && !low) {
      thinking.push(sent.receipt);
      if (launched >= CLAUDE_SUBMISSION_CEILING) throw fail('submission-ceiling');
      low = true;
      sent = await submit();
    }
    if (sent.exhausted) {
      thinking.push(sent.receipt);
      throw fail();
    }
    if (low && sent.answered) thinking.push(sent.receipt);
    return sent.ran;
  };
  let sent: Awaited<ReturnType<typeof withClaudeErrorRetries<Ran>>>;
  try {
    sent = await withClaudeErrorRetries(
      attempt,
      { system: options.system, user: input, env: options.env },
      options,
      { submitted: () => launched, affordable: () => remaining(low) !== undefined },
    );
  } catch (error) {
    if (error instanceof Error) {
      const known = totals().costUsd;
      // A classified failure after a recovery keeps the thinking receipts and the cost of every process.
      if (error instanceof ClaudeTransportError)
        Object.assign(error, {
          costUsd: known,
          ...(thinking.length ? { thinkingRecovery: recovery() } : {}),
        });
      if (known === undefined || launched > returned.length) Object.assign(error, { costIncomplete: true });
    }
    throw error;
  }
  const t = totals();
  return {
    ran: sent.ran,
    accounting: {
      ...(thinking.length ? { usage: t.usage, thinkingRecovery: recovery() } : {}),
      ...(sent.retryReceipts ? { retryReceipts: sent.retryReceipts } : {}),
      // The total of every process, or explicitly unknown: never the last process alone.
      ...(launched > 1
        ? {
            requestCount: launched,
            costUsd: t.costUsd,
            ...(t.costUsd === undefined ? { costIncomplete: true as const } : {}),
          }
        : {}),
    },
  };
}
