/**
 * @agent-nexus/driftbench-vitest: run a driftbench spec inside a vitest suite. `describeSpec(path, target)` registers a
 * describe block named after the spec with one test per block, and one for the end state when the spec has
 * one. The spec runs once, free-running, when the first of its tests runs; each test then passes or fails
 * on its own block, with the evidence of the verdicts that did not pass.
 */
import { readFileSync } from 'node:fs';
import { extname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import {
  type AgentAdapter,
  type BlockResult,
  type BlockSpec,
  blockStatus,
  type CheckSet,
  initializeShippedObjects,
  isScored,
  objectContextFor,
  parseSpecText,
  type RunResult,
  runSpec,
  skipReason,
  type UserDriver,
} from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, it } from 'vitest';

/** The agent under test: an adapter, or a function that makes one when the spec first runs. */
export type SpecTarget = AgentAdapter | (() => AgentAdapter | Promise<AgentAdapter>);

export type DescribeSpecOptions = {
  /** The machine checks. Default: `defaultChecks()` of @agent-nexus/driftbench-checks. */
  checks?: CheckSet;
  /** The user driver. Default: the scripted driver, which replays the spec's blocks. */
  driver?: UserDriver;
  /** The repeat number the run records. Default 0. */
  repeat?: number;
  /** The timeout of each test, in milliseconds. Default 60 000: the first test waits for the whole run. */
  timeoutMs?: number;
};

/**
 * Registers one test per block of the spec at `path` (a path from the working folder, an absolute path or a
 * file URL), run on `target`. An invalid spec registers one failing test that lists its errors.
 */
export function describeSpec(
  path: string | URL,
  target: SpecTarget,
  options: DescribeSpecOptions = {},
): void {
  initializeShippedObjects();
  const file = typeof path === 'string' ? (isAbsolute(path) ? path : resolve(path)) : fileURLToPath(path);
  const loaded = parseSpecText(
    readFileSync(file, 'utf8'),
    extname(file).toLowerCase() === '.json' ? 'json' : 'yaml',
    file,
    { objects: () => objectContextFor(file) },
  );
  const timeout = options.timeoutMs ?? 60_000;
  if (!loaded.ok) {
    describe(file, () => {
      it('is a valid spec', () => {
        throw new Error(
          loaded.errors.map((issue) => `${issue.path || '(file)'} ${issue.code} ${issue.message}`).join('\n'),
        );
      });
    });
    return;
  }
  const { spec } = loaded;
  let run: Promise<RunResult> | undefined;
  const once = () => {
    run ??= (async () =>
      runSpec(spec, {
        adapter: typeof target === 'function' ? await target() : target,
        driver: options.driver ?? createScriptedDriver(),
        checks: options.checks ?? defaultChecks(),
        mode: 'F',
        repeat: options.repeat ?? 0,
      }))();
    return run;
  };

  describe(spec.id, () => {
    spec.blocks.forEach((block, index) => {
      it(
        blockName(index, block),
        async (context) => {
          const result = await once();
          const observed = result.blocks.find((entry) => entry.index === index && !entry.injected);
          if (!observed)
            throw new Error(`block ${index} did not run: ${result.error ?? `the run ${result.status}`}`);
          // A block not run or blocked is no pass and no failure of the agent: the test is skipped with why, as a
          // JUnit report skips it.
          const reason = notRunReason(observed);
          if (reason !== undefined) {
            context.skip(reason);
            return;
          }
          if (blockStatus(observed) !== 'pass') throw new Error(blockFailure(observed));
        },
        timeout,
      );
    });
    if (spec.end_state !== undefined) {
      it(
        'end state',
        async (context) => {
          const result = await once();
          const skipped = result.blocks.find((entry) => !isScored(entry));
          if (!result.endState && skipped) {
            context.skip(`no end state was compared: ${notRunReason(skipped)}`);
            return;
          }
          if (!result.endState)
            throw new Error(`no end state was read: ${result.error ?? `the run ${result.status}`}`);
          if (!result.endState.match) {
            const lines = result.endState.diff.map(
              (entry) =>
                `  ${entry.field}: expected ${JSON.stringify(entry.expected)}, observed ${JSON.stringify(entry.observed)}`,
            );
            throw new Error(['the end state does not match', ...lines].join('\n'));
          }
        },
        timeout,
      );
    }
  });
}

/** `block <n>`, then the block id when it has one, else its stimulus, cut to 60 characters. */
export function blockName(index: number, block: Pick<BlockSpec, 'id' | 'when'>): string {
  if (block.id !== undefined) {
    const said = stimulusText(block.when);
    return `block ${index} (${block.id}): ${cut(said)}`;
  }
  return `block ${index}: ${cut(stimulusText(block.when))}`;
}

function stimulusText(when: BlockSpec['when']): string {
  if ('user' in when) return when.user.trim();
  if ('burst' in when) return when.burst.join(' / ');
  return when.injection.user.trim();
}

function cut(text: string): string {
  const line = text.replace(/\s+/g, ' ');
  return line.length > 60 ? `${line.slice(0, 57)}...` : line;
}

/** Why a block was not run or blocked, as a skipped test says it; undefined for a pass or a fail. */
function notRunReason(block: BlockResult): string | undefined {
  const reason = skipReason(block);
  return reason === undefined ? undefined : `block ${block.index} was ${reason}`;
}

/** What failed in a block: each gating verdict that did not pass, with its evidence. */
export function blockFailure(block: BlockResult): string {
  const lines = block.verdicts
    .filter((verdict) => verdict.gating && verdict.outcome !== 'pass')
    .map((verdict) => `  ${verdict.id} ${verdict.outcome}: ${verdict.evidence}`);
  return [
    `block ${block.index}${block.blockId === undefined ? '' : ` (${block.blockId})`} failed`,
    ...lines,
  ].join('\n');
}
