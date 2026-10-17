import { type BlocksProduct, type CliResult, maybe, need, patched } from './product';

/**
 * Cheating products: each takes a shortcut a component could take and still look done (every block passes,
 * nothing runs, everything is blocked, everything is in the blast radius, a tool's history flattened into prose,
 * an interval that ignores clustering, a value compared as a string). The tests run the bank on each and require
 * every item of a level to fail on at least one cheater of that level: an item no cheater fails measures
 * nothing. A cheater is built on the real product, so only the shortcut differs.
 */

type Run = { specHash: string; blocks: Block[]; status: string; [key: string]: unknown };
type Block = {
  index: number;
  blockId?: string;
  pass: boolean;
  status?: string;
  notRun?: unknown;
  blocked?: unknown;
  verdicts: { id: string; name?: string; outcome: string; gating: boolean; by?: unknown }[];
  [key: string]: unknown;
};
type RunSpec = (spec: Record<string, unknown>, options: Record<string, unknown>) => Promise<Run>;

export type Cheater = { name: string; levels: readonly number[]; make(base: BlocksProduct): BlocksProduct };

/**
 * The product's runner with a shortcut: the spec changed before the run, the adapter changed (what the agent
 * receives), or the record changed after it. `change` sees the spec as it was given.
 */
function mapRuns(
  base: BlocksProduct,
  change: (run: Run, input: Record<string, unknown>) => Run,
  spec?: (spec: Record<string, unknown>) => Record<string, unknown>,
  adapter?: (adapter: Record<string, unknown>) => Record<string, unknown>,
) {
  const runSpec = need<RunSpec>(base.core, 'core', 'runSpec');
  return async (input: Record<string, unknown>, options: Record<string, unknown>) => {
    const given = spec ? spec(structuredClone(input)) : input;
    const record = await runSpec(
      given,
      adapter ? { ...options, adapter: adapter(options.adapter as Record<string, unknown>) } : options,
    );
    return change(record, input);
  };
}

const same = (run: Run) => run;

/** The agent receives only the current user turn: every history the runner hands over is dropped. */
function forgetful(adapter: Record<string, unknown>): Record<string, unknown> {
  const send = adapter.send as (session: Record<string, unknown>, turn: unknown) => Promise<unknown>;
  return {
    ...adapter,
    send: (session: Record<string, unknown>, turn: unknown) => {
      const history = (session.history as { role: string }[]) ?? [];
      let start = history.length;
      while (start > 0 && history[start - 1]?.role === 'user') start -= 1;
      return send({ ...session, history: history.slice(start) }, turn);
    },
  };
}

const exitOnly = (code: number) => async (): Promise<CliResult> => ({ code, out: '', err: '' });

function forceStatus(status: 'pass' | 'fail' | 'not_run' | 'blocked') {
  return (run: Run): Run => ({
    ...run,
    blocks: run.blocks.map((block) => {
      const { notRun: _n, blocked: _b, status: _s, ...rest } = block;
      if (status === 'pass')
        return { ...rest, pass: true, verdicts: block.verdicts.map((v) => ({ ...v, outcome: 'pass' })) };
      if (status === 'fail')
        return { ...rest, pass: false, verdicts: block.verdicts.map((v) => ({ ...v, outcome: 'fail' })) };
      if (status === 'not_run')
        return {
          ...rest,
          pass: false,
          status,
          verdicts: [],
          notRun: {
            kind: 'unsupported',
            layer: '1 history',
            check: 'capability',
            expected: 'a prefix',
            got: 'none',
          },
        };
      return { ...rest, pass: false, status, verdicts: [], blocked: { by: 'b0', root: 'b0' } };
    }),
  });
}

const constant = (status: string) => ({ blockStatus: () => status, runOutcome: () => status });

/** Every tool call of every written prefix flattened into the assistant's prose. */
function proseHistory(spec: Record<string, unknown>): Record<string, unknown> {
  const blocks =
    (spec.blocks as {
      given?: {
        prefix?: { role: string; content: string; tool_calls?: { label: string; output?: unknown }[] }[];
      };
    }[]) ?? [];
  for (const block of blocks) {
    const prefix = block.given?.prefix;
    if (!prefix) continue;
    for (const message of prefix) {
      if (!message.tool_calls) continue;
      message.content =
        `${message.content} ${message.tool_calls.map((call) => `I called ${call.label} and got ${JSON.stringify(call.output ?? null)}.`).join(' ')}`.trim();
      delete message.tool_calls;
    }
  }
  return spec;
}

/** The origin dropped from every Given: two origins hash the same. */
function noOrigin(spec: Record<string, unknown>): Record<string, unknown> {
  for (const block of (spec.blocks as { given?: Record<string, unknown> }[]) ?? [])
    delete block.given?.origin;
  return spec;
}

/** Parent links dropped: the spec runs as a flat succession. */
function noParents(spec: Record<string, unknown>): Record<string, unknown> {
  for (const block of (spec.blocks as Record<string, unknown>[]) ?? []) delete block.parent;
  return spec;
}

function wilson(k: number, n: number) {
  const z = 1.959963984540054;
  const p = n === 0 ? 0 : k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { estimate: p, lower: Math.max(0, c - h), upper: Math.min(1, c + h) };
}

type Count = { n: number; k: number };
const pooled = (counts: readonly Count[]) => {
  const n = counts.reduce((s, c) => s + c.n, 0);
  const k = counts.reduce((s, c) => s + c.k, 0);
  return { n, k, ...wilson(k, n) };
};

export const CHEATERS: readonly Cheater[] = [
  {
    name: 'always-pass',
    levels: [1, 2, 5, 8],
    make: (base) =>
      patched(base, {
        name: 'always-pass',
        core: {
          runSpec: mapRuns(base, forceStatus('pass')),
          ...constant('pass'),
          countRuns: (runs: unknown[]) => ({ pass: runs.length, fail: 0, not_run: 0, blocked: 0 }),
        },
        cli: exitOnly(0),
      }),
  },
  {
    name: 'always-fail',
    levels: [1, 2],
    make: (base) =>
      patched(base, {
        name: 'always-fail',
        core: { runSpec: mapRuns(base, forceStatus('fail')), ...constant('fail') },
        cli: exitOnly(1),
      }),
  },
  {
    name: 'never-run',
    levels: [1, 2, 8],
    make: (base) =>
      patched(base, {
        name: 'never-run',
        core: { runSpec: mapRuns(base, forceStatus('not_run')), ...constant('not_run') },
        cli: exitOnly(3),
      }),
  },
  {
    name: 'everything-blocked',
    levels: [1, 2],
    make: (base) =>
      patched(base, {
        name: 'everything-blocked',
        core: { runSpec: mapRuns(base, forceStatus('blocked')), ...constant('blocked') },
        cli: exitOnly(3),
      }),
  },
  {
    name: 'prose-history',
    levels: [1],
    make: (base) =>
      patched(base, { name: 'prose-history', core: { runSpec: mapRuns(base, same, proseHistory) } }),
  },
  {
    name: 'origin-blind',
    levels: [1],
    make: (base) => {
      const validateSpec = need<(raw: unknown, path?: string) => Record<string, unknown>>(
        base.core,
        'core',
        'validateSpec',
      );
      return patched(base, {
        name: 'origin-blind',
        core: {
          runSpec: mapRuns(base, same, noOrigin),
          validateSpec: (raw: unknown, path?: string) =>
            validateSpec(noOrigin(structuredClone(raw) as Record<string, unknown>), path),
        },
      });
    },
  },
  {
    name: 'lint-silent',
    levels: [1],
    make: (base) => patched(base, { name: 'lint-silent', core: { lintSpec: () => [] } }),
  },
  {
    name: 'lint-every-prefix',
    levels: [1],
    make: (base) =>
      patched(base, {
        name: 'lint-every-prefix',
        core: {
          lintSpec: (spec: { blocks: { given?: { prefix?: { role: string }[] } }[] }) =>
            spec.blocks.flatMap((block, index) =>
              (block.given?.prefix ?? []).flatMap((message, at) =>
                message.role === 'assistant'
                  ? [
                      {
                        code: 'PREFIX_PROSE_HISTORY',
                        path: `blocks.${index}.given.prefix.${at}`,
                        level: 'warning',
                        message: '',
                      },
                    ]
                  : [],
              ),
            ),
        },
      }),
  },
  {
    name: 'world-first-only',
    levels: [1],
    make: (base) =>
      patched(base, {
        name: 'world-first-only',
        core: {
          runSpec: mapRuns(base, same, (spec) => {
            const blocks = spec.blocks as { given?: { world?: unknown } }[];
            let seen = false;
            for (const block of blocks) {
              if (block.given?.world && seen) delete block.given.world;
              if (block.given?.world) seen = true;
            }
            return spec;
          }),
        },
      }),
  },
  {
    name: 'plain-wilson',
    levels: [9],
    make: (base) =>
      patched(base, {
        name: 'plain-wilson',
        stats: {
          wilsonEffective: (counts: Count[]) => {
            const all = pooled(counts);
            return {
              ...all,
              clusters: counts.length,
              effectiveN: all.n,
              designEffect: 1,
              degenerate: all.k === 0 || all.k === all.n,
            };
          },
          hierarchicalBetaBinomial: (counts: Count[]) => {
            const all = pooled(counts);
            return {
              ...all,
              treeMean: all.estimate,
              posteriorMean: all.estimate,
              trees: counts.length,
              blocks: all.n,
            };
          },
        },
        report: {
          suiteHeadline: (runs: { specId: string }[], treeOf: (run: unknown) => string) => {
            const real = need<(r: unknown[], t: unknown) => Record<string, unknown> | undefined>(
              base.report,
              'report',
              'suiteHeadline',
            )(runs, treeOf);
            return real && { ...real, estimate: real.pooledRate, effectiveRuns: real.runs, designEffect: 1 };
          },
        },
      }),
  },
  {
    name: 'loader-ignores-objects',
    levels: [3],
    make: (base) => {
      const validateSpec = need<(raw: unknown, path?: string) => Record<string, unknown>>(
        base.core,
        'core',
        'validateSpec',
      );
      const strip = (raw: unknown) => {
        const copy = structuredClone(raw) as Record<string, unknown> & { blocks?: Record<string, unknown>[] };
        delete copy.uses;
        for (const block of copy.blocks ?? []) delete block.uses;
        return copy;
      };
      return patched(base, {
        name: 'loader-ignores-objects',
        core: { validateSpec: (raw: unknown, path?: string) => validateSpec(strip(raw), path) },
        cli: async (argv) => ({ code: argv[0] === 'object' ? 0 : 2, out: argv.join(' '), err: '' }),
      });
    },
  },
  {
    name: 'stamps-always-shipped',
    levels: [3],
    make: (base) =>
      patched(base, {
        name: 'stamps-always-shipped',
        core: {
          runSpec: mapRuns(base, (run) => ({
            ...run,
            blocks: run.blocks.map((block) => ({
              ...block,
              verdicts: block.verdicts.map((v) => {
                const item = v.name ?? v.id.split('.')[0] ?? v.id;
                return {
                  ...v,
                  by: {
                    object: 'check-set:default@00000000',
                    item,
                    impl: `builtin:check/${item}`,
                    layer: 'shipped',
                  },
                };
              }),
            })),
          })),
        },
      }),
  },
  {
    name: 'value-exact-only',
    levels: [4],
    make: (base) =>
      patched(base, {
        name: 'value-exact-only',
        checks: {
          runLadder: async (value: { value: unknown; gold: unknown }) => ({
            outcome: JSON.stringify(value.value) === JSON.stringify(value.gold) ? 'pass' : 'fail',
            rung: 'exact_fallback',
            evidence: 'exact',
            names: {},
            lint: { id: 'no_decider', text: '' },
            tried: [],
          }),
        },
      }),
  },
  {
    name: 'value-always-equivalent',
    levels: [4],
    make: (base) =>
      patched(base, {
        name: 'value-always-equivalent',
        checks: {
          runLadder: async () => ({
            outcome: 'pass',
            rung: 'rung1_outcome',
            evidence: 'same',
            names: {},
            tried: [],
          }),
        },
      }),
  },
  {
    name: 'blame-everything-on-the-agent',
    levels: [5],
    make: (base) => {
      const real = maybe<
        (data: unknown, options?: Record<string, unknown>) => Record<string, unknown> | undefined
      >(base.report, 'attributionOf');
      return patched(base, {
        name: 'blame-everything-on-the-agent',
        report: {
          attributionOf: (data: unknown, options: Record<string, unknown> = {}) => {
            const summary = real?.(data, options);
            if (!summary) return summary;
            const machine = summary.machine as { k: number; n: number } | undefined;
            const blocks = {
              failing: 0,
              agent: 0,
              setup: 0,
              excluded: 0,
              credited: 0,
              unassigned: 0,
              notRun: 0,
              blocked: 0,
            };
            return {
              ...summary,
              agent: machine ?? { k: 0, n: 0 },
              unassigned: 0,
              blocks,
              unmeasuredRuns: { notRun: 0, blocked: 0 },
            };
          },
        },
      });
    },
  },
  {
    name: 'diagnosis-passes-failures',
    levels: [5],
    make: (base) =>
      patched(base, {
        name: 'diagnosis-passes-failures',
        core: {
          // A diagnostic that turns the failures it explains into passes.
          runSpec: mapRuns(base, (run, input) =>
            (input.uses as { diagnostics?: unknown } | undefined)?.diagnostics
              ? forceStatus('pass')(run)
              : run,
          ),
        },
      }),
  },
  {
    name: 'parents-ignored',
    levels: [2],
    make: (base) => {
      const validateSpec = need<(raw: unknown, path?: string) => Record<string, unknown>>(
        base.core,
        'core',
        'validateSpec',
      );
      return patched(base, {
        name: 'parents-ignored',
        core: {
          validateSpec: (raw: unknown, path?: string) =>
            validateSpec(noParents(structuredClone(raw) as Record<string, unknown>), path),
          runSpec: mapRuns(base, same, noParents),
        },
      });
    },
  },
  {
    name: 'links-hashed',
    levels: [6],
    make: (base) => {
      const contentHash = need<(value: unknown) => string>(base.core, 'core', 'contentHash');
      // Links that enter the spec hash, and a localizer that ranks nothing.
      return patched(base, {
        name: 'links-hashed',
        core: {
          runSpec: mapRuns(base, (run, input) => ({
            ...run,
            specHash: contentHash([
              run.specHash,
              (input.metadata as { links?: unknown } | undefined)?.links ?? null,
            ]),
          })),
        },
        cli: async (argv, cwd) =>
          argv[0] === 'radius'
            ? { code: 0, out: '{"localization":{"sections":[]}}', err: '' }
            : base.cli(argv, cwd),
      });
    },
  },
  {
    name: 'radius-everything',
    levels: [7],
    make: (base) => {
      const radiusOf = need<
        (
          specs: unknown[],
          manifest: unknown,
          options: unknown,
        ) => { specs: { blocks: { state: Record<string, string> }[] }[] }
      >(base.core, 'core', 'radiusOf');
      return patched(base, {
        name: 'radius-everything',
        core: {
          radiusOf: (specs: unknown[], manifest: unknown, options: { modes?: string[] }) => {
            const report = radiusOf(specs, manifest, options);
            return {
              ...report,
              whole: null,
              specs: report.specs.map((spec) => ({
                ...spec,
                blocks: spec.blocks.map((block) => ({
                  ...block,
                  state: Object.fromEntries((options.modes ?? ['F']).map((m) => [m, 'direct'])),
                })),
              })),
            };
          },
        },
        cli: async (argv, cwd) => {
          if (argv[0] !== 'radius') return base.cli(argv, cwd);
          const result = await base.cli(argv, cwd);
          return { ...result, code: result.code === 2 ? 2 : 1 };
        },
      });
    },
  },
  {
    name: 'radius-direct-only',
    levels: [7],
    make: (base) => {
      const radiusOf = need<
        (
          specs: unknown[],
          manifest: unknown,
          options: unknown,
        ) => { whole: unknown; specs: { blocks: { state: Record<string, string> }[] }[] }
      >(base.core, 'core', 'radiusOf');
      return patched(base, {
        name: 'radius-direct-only',
        core: {
          radiusOf: (specs: unknown[], manifest: unknown, options: unknown) => {
            const report = radiusOf(specs, manifest, options);
            return {
              ...report,
              whole: null,
              specs: report.specs.map((spec) => ({
                ...spec,
                blocks: spec.blocks.map((block) => ({
                  ...block,
                  state: Object.fromEntries(
                    Object.entries(block.state).map(([m, s]) => [m, s === 'forward' ? 'out' : s]),
                  ),
                })),
              })),
            };
          },
        },
        cli: async (argv, cwd) => {
          const result = await base.cli(argv, cwd);
          return argv[0] === 'radius' && result.code === 1 ? { ...result, code: 0 } : result;
        },
      });
    },
  },
  {
    name: 'one-cell-per-spec',
    levels: [8],
    make: (base) => {
      const validateSpec = need<(raw: unknown, path?: string) => Record<string, unknown>>(
        base.core,
        'core',
        'validateSpec',
      );
      return patched(base, {
        name: 'one-cell-per-spec',
        core: { validateSpec },
        cli: async (argv) => ({
          code: 0,
          out: argv[0] === 'campaign' ? '{"cells":[{"cellId":"c0"}]}' : '',
          err: '',
        }),
      });
    },
  },
  {
    name: 'history-stripped',
    levels: [1, 2],
    make: (base) =>
      patched(base, {
        name: 'history-stripped',
        core: { runSpec: mapRuns(base, same, undefined, forgetful) },
      }),
  },
  {
    name: 'interval-sloppy',
    levels: [9],
    make: (base) =>
      patched(base, {
        name: 'interval-sloppy',
        stats: {
          // An interval that weighs trees by their place in the list and puts its centre outside its bounds.
          hierarchicalBetaBinomial: (counts: Count[]) => {
            const weighted =
              counts.reduce((sum, c, i) => sum + (i + 1) * (c.k / c.n), 0) /
              ((counts.length * (counts.length + 1)) / 2);
            const total = counts.reduce((s, c) => s + c.n, 0);
            const w = wilson(weighted * total, total);
            return {
              ...w,
              estimate: weighted,
              treeMean: weighted,
              posteriorMean: w.upper + 0.01,
              trees: counts.length,
              blocks: counts.reduce((s, c) => s + c.n, 0),
            };
          },
        },
      }),
  },
  {
    name: 'end-state-dropped',
    levels: [9],
    make: (base) => {
      const build = need<(data: unknown) => Record<string, unknown>>(base.report, 'report', 'buildScorecard');
      return patched(base, {
        name: 'end-state-dropped',
        report: {
          buildScorecard: (data: unknown) => ({ ...build(data), endState: undefined }),
          evaluateAggregates: () => [{}],
        },
      });
    },
  },
  {
    name: 'loader-refuses-objects',
    levels: [3, 5],
    make: (base) => {
      const validateSpec = need<(raw: unknown, path?: string) => Record<string, unknown>>(
        base.core,
        'core',
        'validateSpec',
      );
      const uses = (raw: unknown) => {
        const spec = raw as { uses?: unknown; blocks?: { uses?: unknown }[] };
        return spec.uses !== undefined || (spec.blocks ?? []).some((block) => block.uses !== undefined);
      };
      return patched(base, {
        name: 'loader-refuses-objects',
        core: {
          validateSpec: (raw: unknown, path?: string) =>
            uses(raw)
              ? {
                  ok: false,
                  errors: [{ level: 'error', code: 'OBJECT_UNKNOWN', path: 'uses', message: 'refused' }],
                }
              : validateSpec(raw, path),
        },
        cli: async (argv, cwd) =>
          argv[0] === 'object' ? { code: 1, out: '', err: 'refused' } : base.cli(argv, cwd),
      });
    },
  },
  {
    name: 'stamps-missing',
    levels: [3],
    make: (base) =>
      patched(base, {
        name: 'stamps-missing',
        core: {
          runSpec: mapRuns(base, (run) => ({
            ...run,
            blocks: run.blocks.map((block) => ({
              ...block,
              verdicts: block.verdicts.map(({ by: _by, ...v }) => v),
            })),
          })),
        },
      }),
  },
  {
    name: 'badge-everything',
    levels: [5],
    make: (base) => {
      const real = maybe<
        (data: unknown, options?: Record<string, unknown>) => Record<string, unknown> | undefined
      >(base.report, 'attributionOf');
      return patched(base, {
        name: 'badge-everything',
        report: {
          attributionOf: (data: unknown, options: Record<string, unknown> = {}) => {
            const summary = real?.(data, options);
            if (!summary) return summary;
            const objects = (options.objects as { kind: string; id: string }[] | undefined) ?? [];
            return {
              ...summary,
              nonDefault: objects.map((object) => `${object.kind}:${object.id}`),
              fixes: [...((options.fixes as unknown[]) ?? [])]
                .reverse()
                .concat([{ fixLocation: 'test', fixAction: 'Extra', blocks: 1, agentBlocks: 0 }]),
            };
          },
        },
      });
    },
  },
  {
    name: 'world-dropped',
    levels: [1],
    make: (base) =>
      patched(base, {
        name: 'world-dropped',
        core: {
          runSpec: mapRuns(base, same, undefined, (adapter) => {
            const send = adapter.send as (
              session: unknown,
              turn: { given: { world: Record<string, unknown> } },
            ) => Promise<unknown>;
            return {
              ...adapter,
              send: (session: unknown, turn: { given: { world: Record<string, unknown> } }) => {
                const { tools: _tools, ...world } = turn.given.world ?? {};
                return send(session, { ...turn, given: { ...turn.given, world } });
              },
            };
          }),
        },
      }),
  },
  {
    name: 'radius-accepts-anything',
    levels: [7],
    make: (base) =>
      patched(base, {
        name: 'radius-accepts-anything',
        cli: async (argv, cwd) => {
          const result = await base.cli(argv, cwd);
          return argv[0] === 'radius' ? { ...result, code: 0 } : result;
        },
      }),
  },
  {
    name: 'parents-forward-refused',
    levels: [2],
    make: (base) => {
      const validateSpec = need<(raw: unknown, path?: string) => Record<string, unknown>>(
        base.core,
        'core',
        'validateSpec',
      );
      // A single pass over the blocks: a parent written after its child is not found yet.
      return patched(base, {
        name: 'parents-forward-refused',
        core: {
          validateSpec: (raw: unknown, path?: string) => {
            const blocks = (raw as { blocks?: { id?: string; parent?: string }[] }).blocks ?? [];
            const seen = new Set<string>();
            for (const [index, block] of blocks.entries()) {
              if (block.parent !== undefined && !seen.has(block.parent))
                return {
                  ok: false,
                  errors: [
                    {
                      level: 'error',
                      code: 'PARENT_MISSING',
                      path: `blocks.${index}.parent`,
                      message: 'not found',
                    },
                  ],
                };
              if (block.id !== undefined) seen.add(block.id);
            }
            return validateSpec(raw, path);
          },
        },
      });
    },
  },
  {
    name: 'links-unchecked',
    levels: [6],
    make: (base) => {
      const validateSpec = need<(raw: unknown, path?: string) => Record<string, unknown>>(
        base.core,
        'core',
        'validateSpec',
      );
      // A loader that never resolves a link's block: the links are dropped before the spec is checked.
      return patched(base, {
        name: 'links-unchecked',
        core: {
          validateSpec: (raw: unknown, path?: string) => {
            const copy = structuredClone(raw) as { metadata?: { links?: unknown } };
            if (copy.metadata) delete copy.metadata.links;
            return validateSpec(copy, path);
          },
        },
      });
    },
  },
  {
    name: 'sections-always-stale',
    levels: [6],
    make: (base) =>
      patched(base, {
        name: 'sections-always-stale',
        cli: async (argv, cwd) => {
          const result = await base.cli(argv, cwd);
          return argv[0] === 'radius' && argv[1] === 'sections' && argv[2] !== 'init'
            ? { ...result, code: 1 }
            : result;
        },
      }),
  },
  {
    // Reads every file it can reach and the spec for a verdict or a cause; finding none (the truth stays in the
    // item), it falls back on what a cheat falls back on: every block passes, no agent call.
    name: 'read-the-recipe',
    levels: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    make: (base) =>
      patched(base, {
        name: 'read-the-recipe',
        core: {
          runSpec: async (input: Record<string, unknown>) => {
            const blocks = (input.blocks as { id?: string }[]) ?? [];
            return {
              runId: 'recipe',
              specId: input.id,
              specHash: 'recipe',
              target: { adapter: 'function' },
              mode: 'F',
              repeat: 0,
              status: 'completed',
              blocks: blocks.map((block, index) => ({
                index,
                blockId: block.id,
                givenHash: 'recipe',
                observed: { segments: [], text: '', toolCalls: [], cost: {}, latencyMs: 0 },
                verdicts: [],
                ledgerCheck: { ok: true, contradictions: [] },
                drift: [],
                pass: true,
              })),
            };
          },
          ...constant('pass'),
        },
        report: {
          suiteHeadline: () => undefined,
          attributionOf: () => undefined,
          evaluateAggregates: () => [{}],
        },
        checks: {
          runLadder: async () => ({ outcome: 'pass', rung: 'identity', evidence: '', names: {}, tried: [] }),
        },
        cli: exitOnly(0),
      }),
  },
  {
    // Decides from names: a block, a spec or a turn whose words say fail, stub, parent or block reads so.
    name: 'echo-the-spec-name',
    levels: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    make: (base) =>
      patched(base, {
        name: 'echo-the-spec-name',
        core: {
          runSpec: mapRuns(base, (run, input) => {
            const blocks = (input.blocks as { id?: string; user?: string; when?: { user?: string } }[]) ?? [];
            const named = (index: number) =>
              `${input.id ?? ''} ${blocks[index]?.id ?? ''} ${blocks[index]?.user ?? blocks[index]?.when?.user ?? ''}`;
            return {
              ...run,
              blocks: run.blocks.map((block) => {
                const words = named(block.index);
                const status = /fail|wrong|bad|broken|error/i.test(words)
                  ? 'fail'
                  : /stub|not.?run/i.test(words)
                    ? 'not_run'
                    : /parent|blocked/i.test(words)
                      ? 'blocked'
                      : 'pass';
                return forceStatus(status as 'pass')({ ...run, blocks: [block] }).blocks[0] as Block;
              }),
            };
          }),
        },
      }),
  },
  {
    // The loader that drops every key it does not know and loads what is left: a spec with parent links, uses,
    // personas or binary files then runs as if they were not there. No family may pass on it.
    name: 'drop-unknown-keys',
    levels: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    make: (base) => {
      const validate = base.core.validateSpec as (raw: unknown, path?: string) => Record<string, unknown>;
      const dropped = (raw: unknown, path?: string): Record<string, unknown> => {
        let current = structuredClone(raw) as Record<string, unknown>;
        for (let round = 0; round < 8; round += 1) {
          const result = validate(current, path);
          if (result.ok === true) return result;
          const issues = (result.errors as { path?: string; code?: string; message?: string }[]) ?? [];
          const unknown = issues.filter((issue) => issue.code === 'SCHEMA_UNRECOGNIZED_KEYS');
          if (unknown.length === 0 || unknown.length < issues.length) return result;
          for (const issue of unknown) {
            const holder = String(issue.path ?? '')
              .split('.')
              .filter((part) => part !== '')
              .reduce<unknown>((at, part) => (at as Record<string, unknown> | undefined)?.[part], current);
            const keys = /unknown keys?: (.+)$/.exec(issue.message ?? '')?.[1]?.split(/,\s*/) ?? [];
            for (const key of keys)
              if (holder && typeof holder === 'object')
                delete (holder as Record<string, unknown>)[key.trim()];
          }
          current = structuredClone(current);
        }
        return validate(current, path);
      };
      return patched(base, { name: 'drop-unknown-keys', core: { validateSpec: dropped } });
    },
  },
  {
    // Right answers in quadratic time: every exported function first burns CPU in proportion to the square of
    // the size of its arguments. The scale items (docs/validators.md section 13.1) must fail on it.
    name: 'quadratic',
    levels: [1, 9],
    make: (base) => {
      const size = (args: unknown[]) => {
        try {
          return (
            JSON.stringify(args, (_key, value) => (typeof value === 'function' ? undefined : value))
              ?.length ?? 0
          );
        } catch {
          return 0;
        }
      };
      const burn = (n: number) => {
        let x = 0;
        // 500 steps per square kilobyte, at most 4e9: about 20 ms on a 200 kB spec, 100 times that at 10 times the size.
        const steps = Math.min(4e9, 500 * (n / 1000) ** 2);
        for (let i = 0; i < steps; i += 1) x = (x + i) % 7919;
        return x;
      };
      const slow = (mod: Record<string, unknown>) =>
        Object.fromEntries(
          Object.entries(mod).map(([name, value]) => [
            name,
            typeof value === 'function' && !/^[A-Z]/.test(name)
              ? (...args: unknown[]) => {
                  burn(size(args));
                  return (value as (...a: unknown[]) => unknown)(...args);
                }
              : value,
          ]),
        );
      return patched(base, {
        name: 'quadratic',
        core: slow(base.core),
        checks: slow(base.checks),
        stats: slow(base.stats),
        report: slow(base.report),
        sandbox: slow(base.sandbox),
      });
    },
  },
];
