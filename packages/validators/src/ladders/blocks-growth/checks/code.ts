import { type RawSpec, run } from '../../blocks/harness';
import { type Action, plantedAgent, token } from '../../blocks/kinds';
import {
  type BankItem,
  exec,
  expectNone,
  expectPass,
  expectV,
  type ItemContext,
  idsAt,
  type Probe,
  type RunRecord,
  type Tier,
  tok,
  variants,
  verdict,
} from './kit';

/**
 * gr-code: what a code agent does, read by the checks of docs/reference/checks.md "Code, files and workspace":
 * execution, the workspace diff, the artifacts a block must produce and the destructive operations of safety.
 * A planted code agent writes files and reports commands behind the process adapter in a local sandbox; the truth
 * of each block (what it wrote, what it ran) is in the item's plan and nowhere the product reads.
 */

const FAMILY = 'gr-code';
const CHECKS = 'packages/checks';
const P = 'gr.checks.code';

type Step = { expect: Record<string, unknown>; action: Action };

/** A task spec seeding `files`, one block per step, run on a planted code agent. */
async function codeRun(
  ctx: ItemContext,
  tag: string,
  files: Record<string, string>,
  steps: Step[],
): Promise<RunRecord> {
  const markers = steps.map((_, i) => token(ctx.seed, `${tag}#m${i}`, 8));
  const raw: RawSpec = {
    id: `spec-${token(ctx.seed, `${tag}#spec`)}`,
    kind: 'task',
    workspace_seed: { files },
    blocks: steps.map((step, i) => ({
      id: token(ctx.seed, `${tag}#b${i}`),
      user: `${markers[i]} Step ${i + 1}.`,
      expect: step.expect,
    })),
  };
  const agent = plantedAgent(
    ctx.product,
    'code',
    new Map(markers.map((m, i) => [m, (steps[i] as Step).action])),
    {
      scratch: ctx.scratch,
    },
  );
  return (await run(ctx.product, raw, agent.adapter)) as unknown as RunRecord;
}

const quiet: Action = { reply: 'Done.' };
const cmd = (command: string, exitCode = 0) => ({ command, exitCode });

function executionItems(): BankItem[] {
  return [
    ...variants(FAMILY, `${P}.exec-false`, CHECKS, 'execution-ran-code-false', [
      [
        'no-command-passes',
        3,
        'ran_code false passes a block in which no command ran',
        async (ctx) => {
          const tag = `${P}.exec-false.none`;
          const rec = await codeRun(ctx, tag, { 'in.txt': 'x\n' }, [
            { expect: { execution: { ran_code: false } }, action: quiet },
          ]);
          return [expectV(rec, 0, 'execution.ran_code', 'pass', true)];
        },
      ],
      [
        'one-command-fails',
        3,
        'ran_code false fails a block in which one command ran, whatever its exit code',
        async (ctx) => {
          const tag = `${P}.exec-false.one`;
          const rec = await codeRun(ctx, tag, { 'in.txt': 'x\n' }, [
            { expect: { execution: { ran_code: false } }, action: { reply: 'Done.', commands: [cmd('ls')] } },
            {
              expect: { execution: { ran_code: false } },
              action: { reply: 'Done.', commands: [cmd('false', 1)] },
            },
          ]);
          return [
            expectV(rec, 0, 'execution.ran_code', 'fail', true),
            expectV(rec, 1, 'execution.ran_code', 'fail', true),
          ];
        },
      ],
      [
        'the-agent-process-is-no-command',
        4,
        'the agent process is no command: a block with only the agent record passes ran_code false and fails ran_code true',
        async (ctx) => {
          const tag = `${P}.exec-false.agent`;
          const rec = await codeRun(ctx, tag, { 'in.txt': 'x\n' }, [
            { expect: { execution: { ran_code: false } }, action: quiet },
            { expect: { execution: { ran_code: true } }, action: quiet },
          ]);
          return [
            expectV(rec, 0, 'execution.ran_code', 'pass', true),
            expectV(rec, 1, 'execution.ran_code', 'fail', true),
          ];
        },
      ],
      [
        'each-block-on-its-own',
        4,
        'the commands of an earlier block do not count in the next: ran_code false passes the block that ran nothing',
        async (ctx) => {
          const tag = `${P}.exec-false.blocks`;
          const rec = await codeRun(ctx, tag, { 'in.txt': 'x\n' }, [
            { expect: { execution: { ran_code: true } }, action: { reply: 'Done.', commands: [cmd('ls')] } },
            { expect: { execution: { ran_code: false } }, action: quiet },
          ]);
          return [
            expectV(rec, 0, 'execution.ran_code', 'pass', true),
            expectV(rec, 1, 'execution.ran_code', 'pass', true),
          ];
        },
      ],
    ]),
    ...variants(FAMILY, `${P}.exec-exit`, CHECKS, 'execution-exit-code-evidence', [
      [
        'no-command-reads-the-agent-process',
        3,
        'with no command, exit_code reads the exit code of the agent process',
        async (ctx) => {
          const tag = `${P}.exec-exit.agent`;
          const rec = await codeRun(ctx, tag, { 'in.txt': 'x\n' }, [
            { expect: { execution: { exit_code: 3 } }, action: { reply: 'Done.', exit: 3 } },
            { expect: { execution: { exit_code: 0 } }, action: { reply: 'Done.', exit: 3 } },
          ]);
          return [
            expectV(rec, 0, 'execution.exit_code', 'pass', true),
            expectV(rec, 1, 'execution.exit_code', 'fail', true),
          ];
        },
      ],
      [
        'both-are-named',
        4,
        'the evidence names the agent process and the last command when both exist',
        async (ctx) => {
          const tag = `${P}.exec-exit.both`;
          const rec = await codeRun(ctx, tag, { 'in.txt': 'x\n' }, [
            {
              expect: { execution: { exit_code: 7 } },
              action: { reply: 'Done.', commands: [cmd('first', 2), cmd('second', 7)], exit: 0 },
            },
          ]);
          const text = String(verdict(rec, 0, 'execution.exit_code')?.evidence ?? '');
          return [
            expectV(rec, 0, 'execution.exit_code', 'pass', true),
            /7/.test(text) && /second/.test(text)
              ? undefined
              : `the evidence does not name the last command (second, exit 7): ${text.slice(0, 160)}`,
            /agent|process/i.test(text) && /\b0\b/.test(text)
              ? undefined
              : `the evidence does not name the agent process and its exit code 0: ${text.slice(0, 160)}`,
          ];
        },
      ],
      [
        'the-last-command-not-the-first',
        3,
        'exit_code reads the last command: a first command that failed and a last one that passed read 0',
        async (ctx) => {
          const tag = `${P}.exec-exit.last`;
          const rec = await codeRun(ctx, tag, { 'in.txt': 'x\n' }, [
            {
              expect: { execution: { exit_code: 0 } },
              action: { reply: 'Done.', commands: [cmd('first', 4), cmd('second', 0)] },
            },
            {
              expect: { execution: { exit_code: 4 } },
              action: { reply: 'Done.', commands: [cmd('first', 4), cmd('second', 0)] },
            },
          ]);
          return [
            expectV(rec, 0, 'execution.exit_code', 'pass', true),
            expectV(rec, 1, 'execution.exit_code', 'fail', true),
          ];
        },
      ],
    ]),
  ];
}

function workspaceItems(): BankItem[] {
  return [
    ...variants(FAMILY, `${P}.ws-empty`, CHECKS, 'workspace-empty-list-asserts-empty', [
      [
        'deleted-empty',
        3,
        'deleted: [] passes when nothing was deleted and fails when a file was',
        async (ctx) => {
          const tag = `${P}.ws-empty.deleted`;
          const rec = await codeRun(ctx, tag, { 'a.txt': 'a\n', 'b.txt': 'b\n' }, [
            { expect: { workspace: { deleted: [] } }, action: quiet },
            { expect: { workspace: { deleted: [] } }, action: { reply: 'Done.', deletes: ['a.txt'] } },
          ]);
          return [
            expectV(rec, 0, 'workspace.deleted', 'pass', true),
            expectV(rec, 1, 'workspace.deleted', 'fail', true),
          ];
        },
      ],
      [
        'created-empty',
        3,
        'created: [] passes when no file was created and fails when one was',
        async (ctx) => {
          const tag = `${P}.ws-empty.created`;
          const rec = await codeRun(ctx, tag, { 'a.txt': 'a\n' }, [
            { expect: { workspace: { created: [] } }, action: quiet },
            {
              expect: { workspace: { created: [] } },
              action: { reply: 'Done.', files: [{ path: 'new.txt', format: 'txt', data: 'n\n' }] },
            },
          ]);
          return [
            expectV(rec, 0, 'workspace.created', 'pass', true),
            expectV(rec, 1, 'workspace.created', 'fail', true),
          ];
        },
      ],
      [
        'changed-empty',
        3,
        'changed: [] passes when no file changed and fails when one did',
        async (ctx) => {
          const tag = `${P}.ws-empty.changed`;
          const rec = await codeRun(ctx, tag, { 'a.txt': 'a\n' }, [
            { expect: { workspace: { changed: [] } }, action: quiet },
            {
              expect: { workspace: { changed: [] } },
              action: { reply: 'Done.', files: [{ path: 'a.txt', format: 'txt', data: 'changed\n' }] },
            },
          ]);
          return [
            expectV(rec, 0, 'workspace.changed', 'pass', true),
            expectV(rec, 1, 'workspace.changed', 'fail', true),
          ];
        },
      ],
      [
        'an-unlisted-set-is-not-asserted',
        4,
        'a set the expectation does not list is not asserted: only the listed sets give a verdict',
        async (ctx) => {
          const tag = `${P}.ws-empty.unlisted`;
          const rec = await codeRun(ctx, tag, { 'a.txt': 'a\n' }, [
            {
              expect: { workspace: { created: ['new.txt'] } },
              action: {
                reply: 'Done.',
                files: [{ path: 'new.txt', format: 'txt', data: 'n\n' }],
                deletes: ['a.txt'],
              },
            },
          ]);
          return [
            expectV(rec, 0, 'workspace.created', 'pass', true),
            expectNone(rec, 0, 'workspace.deleted'),
            expectNone(rec, 0, 'workspace.changed'),
            expectPass(rec, 0, true),
          ];
        },
      ],
    ]),
    ...variants(FAMILY, `${P}.ws-changed`, CHECKS, 'workspace-changed-by-hash-or-size', [
      [
        'same-bytes',
        3,
        'a file rewritten with the same bytes is not changed',
        async (ctx) => {
          const tag = `${P}.ws-changed.same`;
          const rec = await codeRun(ctx, tag, { 'a.txt': 'same bytes\n' }, [
            {
              expect: { workspace: { changed: [] } },
              action: { reply: 'Done.', files: [{ path: 'a.txt', format: 'txt', data: 'same bytes\n' }] },
            },
          ]);
          return [expectV(rec, 0, 'workspace.changed', 'pass', true)];
        },
      ],
      [
        'same-size-other-bytes',
        4,
        'a file whose size is the same but whose hash differs is changed',
        async (ctx) => {
          const tag = `${P}.ws-changed.hash`;
          const rec = await codeRun(ctx, tag, { 'a.txt': 'abcdef\n' }, [
            {
              expect: { workspace: { changed: ['a.txt'] } },
              action: { reply: 'Done.', files: [{ path: 'a.txt', format: 'txt', data: 'abcdeg\n' }] },
            },
          ]);
          return [expectV(rec, 0, 'workspace.changed', 'pass', true)];
        },
      ],
      [
        'other-size',
        3,
        'a file whose size differs is changed',
        async (ctx) => {
          const tag = `${P}.ws-changed.size`;
          const rec = await codeRun(ctx, tag, { 'a.txt': 'abc\n' }, [
            {
              expect: { workspace: { changed: ['a.txt'] } },
              action: { reply: 'Done.', files: [{ path: 'a.txt', format: 'txt', data: 'abcdef\n' }] },
            },
            {
              expect: { workspace: { changed: [] } },
              action: { reply: 'Done.', files: [{ path: 'a.txt', format: 'txt', data: 'abcdef\n' }] },
            },
          ]);
          return [
            expectV(rec, 0, 'workspace.changed', 'pass', true),
            expectV(rec, 1, 'workspace.changed', 'pass', true),
          ];
        },
      ],
    ]),
    ...variants(FAMILY, `${P}.ws-net`, CHECKS, 'workspace-net-change', [
      [
        'created-then-deleted',
        4,
        'a file created and deleted inside one block is in no set',
        async (ctx) => {
          const tag = `${P}.ws-net.temp`;
          const rec = await codeRun(ctx, tag, { 'a.txt': 'a\n' }, [
            {
              expect: { workspace: { created: [], deleted: [], changed: [], others_untouched: true } },
              action: {
                reply: 'Done.',
                files: [{ path: 'scratch.txt', format: 'txt', data: 'tmp\n' }],
                deletes: ['scratch.txt'],
              },
            },
          ]);
          return [
            expectV(rec, 0, 'workspace.created', 'pass', true),
            expectV(rec, 0, 'workspace.deleted', 'pass', true),
            expectV(rec, 0, 'workspace.others_untouched', 'pass', true),
          ];
        },
      ],
      [
        'a-created-file-is-not-also-changed',
        4,
        'a file that did not exist before the block is created, not changed, though the block wrote it twice',
        async (ctx) => {
          const tag = `${P}.ws-net.twice`;
          const rec = await codeRun(ctx, tag, { 'a.txt': 'a\n' }, [
            {
              expect: { workspace: { created: ['new.txt'], changed: [] } },
              action: {
                reply: 'Done.',
                files: [
                  { path: 'new.txt', format: 'txt', data: 'one\n' },
                  { path: 'new.txt', format: 'txt', data: 'two\n' },
                ],
              },
            },
          ]);
          return [
            expectV(rec, 0, 'workspace.created', 'pass', true),
            expectV(rec, 0, 'workspace.changed', 'pass', true),
          ];
        },
      ],
      [
        'each-block-diffs-against-the-block-before',
        4,
        'the diff is the change of the block: a file created in block 1 is not created again in block 2',
        async (ctx) => {
          const tag = `${P}.ws-net.blocks`;
          const rec = await codeRun(ctx, tag, { 'a.txt': 'a\n' }, [
            {
              expect: { workspace: { created: ['new.txt'] } },
              action: { reply: 'Done.', files: [{ path: 'new.txt', format: 'txt', data: 'n\n' }] },
            },
            { expect: { workspace: { created: [], changed: [] } }, action: quiet },
          ]);
          return [
            expectV(rec, 0, 'workspace.created', 'pass', true),
            expectV(rec, 1, 'workspace.created', 'pass', true),
            expectV(rec, 1, 'workspace.changed', 'pass', true),
          ];
        },
      ],
    ]),
    ...variants(FAMILY, `${P}.ws-others`, CHECKS, 'workspace-others-only-by-flag', [
      [
        'a-created-file-no-list-names',
        3,
        'a created file that no list names fails only through others_untouched',
        async (ctx) => {
          const tag = `${P}.ws-others.created`;
          const make = (...names: string[]): Action => ({
            reply: 'Done.',
            files: names.map((path) => ({ path, format: 'txt' as const, data: `${path}\n` })),
          });
          const rec = await codeRun(ctx, tag, { 'a.txt': 'a\n' }, [
            { expect: { workspace: { created: ['one.txt'] } }, action: make('one.txt', 'two.txt') },
            {
              expect: { workspace: { created: ['three.txt'], others_untouched: true } },
              action: make('three.txt', 'four.txt'),
            },
          ]);
          return [
            expectV(rec, 0, 'workspace.created', 'pass', true),
            expectPass(rec, 0, true),
            expectV(rec, 1, 'workspace.others_untouched', 'fail', true),
          ];
        },
      ],
      [
        'a-deleted-file-no-list-names',
        3,
        'a deleted file that no list names fails only through others_untouched',
        async (ctx) => {
          const tag = `${P}.ws-others.deleted`;
          const rec = await codeRun(
            ctx,
            tag,
            { 'a.txt': 'a\n', 'b.txt': 'b\n', 'c.txt': 'c\n', 'd.txt': 'd\n' },
            [
              {
                expect: { workspace: { deleted: ['a.txt'] } },
                action: { reply: 'Done.', deletes: ['a.txt', 'b.txt'] },
              },
              {
                expect: { workspace: { deleted: ['c.txt'], others_untouched: true } },
                action: { reply: 'Done.', deletes: ['c.txt', 'd.txt'] },
              },
            ],
          );
          return [
            expectV(rec, 0, 'workspace.deleted', 'pass', true),
            expectPass(rec, 0, true),
            expectV(rec, 1, 'workspace.others_untouched', 'fail', true),
          ];
        },
      ],
      [
        'nothing-else-changed',
        3,
        'others_untouched passes when every path of the diff is named in a list',
        async (ctx) => {
          const tag = `${P}.ws-others.clean`;
          const rec = await codeRun(ctx, tag, { 'a.txt': 'a\n' }, [
            {
              expect: { workspace: { created: ['n.txt'], changed: ['a.txt'], others_untouched: true } },
              action: {
                reply: 'Done.',
                files: [
                  { path: 'n.txt', format: 'txt', data: 'n\n' },
                  { path: 'a.txt', format: 'txt', data: 'new\n' },
                ],
              },
            },
          ]);
          return [expectV(rec, 0, 'workspace.others_untouched', 'pass', true), expectPass(rec, 0, true)];
        },
      ],
    ]),
  ];
}

function artifactItems(): BankItem[] {
  const f = (
    id: string,
    tier: Tier,
    title: string,
    run: (ctx: ItemContext, tag: string) => Promise<(string | undefined)[]>,
  ): readonly [string, Tier, string, Probe] => [id, tier, title, (ctx) => run(ctx, `${P}.art.${id}`)];
  const py = (a: string, b: string) => `def ${a}():\n    return "${b}"\n\n\nprint(${a}())\n`;
  const write = (path: string, data: string): Action => ({
    reply: 'Done.',
    files: [{ path, format: 'txt', data }],
  });
  return [
    ...variants(FAMILY, `${P}.art-code`, CHECKS, 'artifacts-code-kind', [
      f(
        'contains-and-not-contains',
        3,
        'a code file is opened and its contains and not_contains checks are judged on its text',
        async (ctx, tag) => {
          const [a, b, c] = [tok(ctx, tag, 'a', 6), tok(ctx, tag, 'b', 6), tok(ctx, tag, 'c', 6)] as [
            string,
            string,
            string,
          ];
          const rec = await codeRun(ctx, tag, { 'in.txt': 'x\n' }, [
            {
              expect: {
                artifacts: [
                  {
                    path: 'tool.py',
                    kind: 'code',
                    checks: [
                      { contains: `def ${a}` },
                      { contains: c },
                      { not_contains: c },
                      { not_contains: `def ${a}` },
                    ],
                  },
                ],
              },
              action: write('tool.py', py(a, b)),
            },
          ]);
          return [
            expectV(rec, 0, 'artifacts.tool.py', 'pass', true),
            expectV(rec, 0, 'artifacts.tool.py.0.contains', 'pass', true),
            expectV(rec, 0, 'artifacts.tool.py.1.contains', 'fail', true),
            expectV(rec, 0, 'artifacts.tool.py.2.not_contains', 'pass', true),
            expectV(rec, 0, 'artifacts.tool.py.3.not_contains', 'fail', true),
          ];
        },
      ),
      f(
        'regex-and-lines',
        4,
        'a code file is judged by regex and by lines: a pattern over its text and a count of its lines',
        async (ctx, tag) => {
          const [a, b] = [tok(ctx, tag, 'a', 6), tok(ctx, tag, 'b', 6)] as [string, string];
          const rec = await codeRun(ctx, tag, { 'in.txt': 'x\n' }, [
            {
              expect: {
                artifacts: [
                  {
                    path: 'tool.py',
                    kind: 'code',
                    checks: [{ regex: `def ${a}\\(\\):` }, { regex: `def ${b}\\(` }],
                  },
                ],
              },
              action: write('tool.py', py(a, b)),
            },
          ]);
          return [
            expectV(rec, 0, 'artifacts.tool.py.0.regex', 'pass', true),
            expectV(rec, 0, 'artifacts.tool.py.1.regex', 'fail', true),
          ];
        },
      ),
      f(
        'tests-always-fails',
        4,
        'a tests check on a code file always fails and says that running a command is the job of execution',
        async (ctx, tag) => {
          const a = tok(ctx, tag, 'a', 6);
          const rec = await codeRun(ctx, tag, { 'in.txt': 'x\n' }, [
            {
              expect: { artifacts: [{ path: 'tool.py', kind: 'code', checks: [{ tests: 'all' }] }] },
              action: write('tool.py', py(a, 'ok')),
            },
          ]);
          const text = String(verdict(rec, 0, 'artifacts.tool.py.0.tests')?.evidence ?? '');
          return [
            expectV(rec, 0, 'artifacts.tool.py.0.tests', 'fail', true),
            /execution|command/i.test(text)
              ? undefined
              : `the evidence does not say that running a command is the job of execution: ${text.slice(0, 160)}`,
          ];
        },
      ),
      f(
        'tests-fails-even-when-the-code-is-fine',
        4,
        'the tests check fails on a code file whose text is fine: opening the file passes, the check does not',
        async (ctx, tag) => {
          const a = tok(ctx, tag, 'a', 6);
          const rec = await codeRun(ctx, tag, { 'in.txt': 'x\n' }, [
            {
              expect: {
                artifacts: [
                  { path: 'tool.py', kind: 'code', checks: [{ contains: `def ${a}` }, { tests: true }] },
                ],
              },
              action: write('tool.py', py(a, 'ok')),
            },
          ]);
          return [
            expectV(rec, 0, 'artifacts.tool.py', 'pass', true),
            expectV(rec, 0, 'artifacts.tool.py.0.contains', 'pass', true),
            expectV(rec, 0, 'artifacts.tool.py.1.tests', 'fail', true),
          ];
        },
      ),
    ]),
    ...variants(FAMILY, `${P}.art-ext`, CHECKS, 'artifacts-kind-from-extension', [
      f(
        'csv',
        3,
        'with no kind, a .csv file is opened with the csv reader: its header check reads the first row',
        async (ctx, tag) => {
          const [a, b] = [tok(ctx, tag, 'a', 5), tok(ctx, tag, 'b', 5)] as [string, string];
          const rec = await codeRun(ctx, tag, { 'in.txt': 'x\n' }, [
            {
              expect: { artifacts: [{ path: 'out.csv', checks: [{ header: [a, b] }, { header: [b, a] }] }] },
              action: {
                reply: 'Done.',
                files: [
                  {
                    path: 'out.csv',
                    format: 'csv',
                    data: [
                      [a, b],
                      [1, 2],
                    ],
                  },
                ],
              },
            },
          ]);
          return [
            expectV(rec, 0, 'artifacts.out.csv', 'pass', true),
            expectV(rec, 0, 'artifacts.out.csv.0.header', 'pass', true),
            expectV(rec, 0, 'artifacts.out.csv.1.header', 'fail', true),
          ];
        },
      ),
      f(
        'json',
        3,
        'with no kind, a .json file is opened with the json reader: its subset check reads the object',
        async (ctx, tag) => {
          const [a, b] = [tok(ctx, tag, 'a', 5), tok(ctx, tag, 'b', 5)] as [string, string];
          const rec = await codeRun(ctx, tag, { 'in.txt': 'x\n' }, [
            {
              expect: {
                artifacts: [{ path: 'out.json', checks: [{ subset: { [a]: 1 } }, { subset: { [a]: 2 } }] }],
              },
              action: {
                reply: 'Done.',
                files: [{ path: 'out.json', format: 'json', data: { [a]: 1, [b]: 2 } }],
              },
            },
          ]);
          return [
            expectV(rec, 0, 'artifacts.out.json.0.subset', 'pass', true),
            expectV(rec, 0, 'artifacts.out.json.1.subset', 'fail', true),
          ];
        },
      ),
      f(
        'text',
        3,
        'with no kind, a .txt file is opened with the text reader: its contains check reads the text',
        async (ctx, tag) => {
          const [a, b] = [tok(ctx, tag, 'a', 7), tok(ctx, tag, 'b', 7)] as [string, string];
          const rec = await codeRun(ctx, tag, { 'in.txt': 'x\n' }, [
            {
              expect: { artifacts: [{ path: 'out.txt', checks: [{ contains: a }, { contains: b }] }] },
              action: write('out.txt', `${a}\n`),
            },
          ]);
          return [
            expectV(rec, 0, 'artifacts.out.txt.0.contains', 'pass', true),
            expectV(rec, 0, 'artifacts.out.txt.1.contains', 'fail', true),
          ];
        },
      ),
    ]),
    ...variants(FAMILY, `${P}.art-ids`, CHECKS, 'artifacts-verdict-per-check', [
      f(
        'opened-then-one-per-check',
        3,
        'one verdict says the file was read and opened, then one per declared check with the index and the check name',
        async (ctx, tag) => {
          const [a, b] = [tok(ctx, tag, 'a', 7), tok(ctx, tag, 'b', 7)] as [string, string];
          const rec = await codeRun(ctx, tag, { 'in.txt': 'x\n' }, [
            {
              expect: {
                artifacts: [
                  {
                    path: 'out.txt',
                    kind: 'text',
                    checks: [{ contains: a }, { not_contains: b }, { regex: a }],
                  },
                ],
              },
              action: write('out.txt', `${a}\n`),
            },
          ]);
          return [
            expectV(rec, 0, 'artifacts.out.txt', 'pass', true),
            expectV(rec, 0, 'artifacts.out.txt.0.contains', 'pass', true),
            expectV(rec, 0, 'artifacts.out.txt.1.not_contains', 'pass', true),
            expectV(rec, 0, 'artifacts.out.txt.2.regex', 'pass', true),
          ];
        },
      ),
      f(
        'a-missing-file-is-one-failed-verdict',
        3,
        'a file the block did not produce is one failed verdict that names it, with no verdict per check',
        async (ctx, tag) => {
          const a = tok(ctx, tag, 'a', 7);
          const rec = await codeRun(ctx, tag, { 'in.txt': 'x\n' }, [
            {
              expect: {
                artifacts: [{ path: `${a}.txt`, kind: 'text', checks: [{ contains: a }, { contains: a }] }],
              },
              action: quiet,
            },
          ]);
          const text = String(verdict(rec, 0, `artifacts.${a}.txt`)?.evidence ?? '');
          return [
            expectV(rec, 0, `artifacts.${a}.txt`, 'fail', true),
            text.includes(`${a}.txt`)
              ? undefined
              : `the evidence does not name the missing file: ${text.slice(0, 140)}`,
            idsAt(rec, 0).some((id) => id.startsWith(`artifacts.${a}.txt.`))
              ? 'a missing file gives a verdict per check; it should give one failed verdict'
              : undefined,
          ];
        },
      ),
      f(
        'an-unknown-check-lists-the-known-ones',
        4,
        'an unknown reader check name fails and lists the checks of the kind',
        async (ctx, tag) => {
          const [a, bogus] = [tok(ctx, tag, 'a', 7), tok(ctx, tag, 'bogus', 8)] as [string, string];
          const rec = await codeRun(ctx, tag, { 'in.txt': 'x\n' }, [
            {
              expect: {
                artifacts: [{ path: 'out.txt', kind: 'text', checks: [{ [bogus]: 1 }, { contains: a }] }],
              },
              action: write('out.txt', `${a}\n`),
            },
          ]);
          const text = String(verdict(rec, 0, `artifacts.out.txt.0.${bogus}`)?.evidence ?? '');
          return [
            expectV(rec, 0, `artifacts.out.txt.0.${bogus}`, 'fail', true),
            ['contains', 'not_contains', 'regex', 'lines'].every((name) => text.includes(name))
              ? undefined
              : `the evidence does not list the checks of the text kind (contains, not_contains, regex, lines): ${text.slice(0, 200)}`,
            expectV(rec, 0, 'artifacts.out.txt.1.contains', 'pass', true),
          ];
        },
      ),
      f(
        'a-repeated-path-gets-a-suffix',
        4,
        'the same path expected twice gives #2 to the second entry and a verdict per check under each',
        async (ctx, tag) => {
          const [a, b] = [tok(ctx, tag, 'a', 7), tok(ctx, tag, 'b', 7)] as [string, string];
          const rec = await codeRun(ctx, tag, { 'in.txt': 'x\n' }, [
            {
              expect: {
                artifacts: [
                  { path: 'out.txt', kind: 'text', checks: [{ contains: a }] },
                  { path: 'out.txt', kind: 'text', checks: [{ contains: b }] },
                ],
              },
              action: write('out.txt', `${a}\n`),
            },
          ]);
          return [
            expectV(rec, 0, 'artifacts.out.txt.0.contains', 'pass', true),
            expectV(rec, 0, 'artifacts.out.txt#2.0.contains', 'fail', true),
          ];
        },
      ),
    ]),
    ...variants(FAMILY, `${P}.art-open`, CHECKS, 'artifacts-reader-opens-the-file', [
      f(
        'the-reply-claims-more-than-the-file-holds',
        3,
        'the reader opens the file itself: a reply that says the file holds a text does not make it so',
        async (ctx, tag) => {
          const [a, b] = [tok(ctx, tag, 'a', 7), tok(ctx, tag, 'b', 7)] as [string, string];
          const rec = await codeRun(ctx, tag, { 'in.txt': 'x\n' }, [
            {
              expect: { artifacts: [{ path: 'out.txt', kind: 'text', checks: [{ contains: b }] }] },
              action: {
                reply: `The file out.txt holds ${b}.`,
                files: [{ path: 'out.txt', format: 'txt', data: `${a}\n` }],
              },
            },
          ]);
          return [expectV(rec, 0, 'artifacts.out.txt.0.contains', 'fail', true)];
        },
      ),
      f(
        'the-reply-says-nothing-the-file-holds-it',
        3,
        'a file that holds the text passes though the reply does not mention it',
        async (ctx, tag) => {
          const a = tok(ctx, tag, 'a', 7);
          const rec = await codeRun(ctx, tag, { 'in.txt': 'x\n' }, [
            {
              expect: { artifacts: [{ path: 'out.txt', kind: 'text', checks: [{ contains: a }] }] },
              action: {
                reply: 'Nothing to report.',
                files: [{ path: 'out.txt', format: 'txt', data: `${a}\n` }],
              },
            },
          ]);
          return [expectV(rec, 0, 'artifacts.out.txt.0.contains', 'pass', true)];
        },
      ),
      f(
        'a-file-that-is-not-the-kind',
        4,
        'a text file declared as a workbook cannot satisfy a sheets check: the reader opens what is there',
        async (ctx, tag) => {
          const a = tok(ctx, tag, 'a', 7);
          const rec = await codeRun(ctx, tag, { 'in.txt': 'x\n' }, [
            {
              expect: { artifacts: [{ path: 'out.xlsx', kind: 'xlsx', checks: [{ sheets: [a] }] }] },
              action: write('out.xlsx', `${a}\n`),
            },
          ]);
          return [expectV(rec, 0, 'artifacts.out.xlsx.0.sheets', 'fail', true), expectPass(rec, 0, false)];
        },
      ),
    ]),
    ...variants(FAMILY, `${P}.art-none`, CHECKS, 'artifacts-adapter-without-workspace', [
      [
        'one-failed-verdict',
        3,
        'an adapter with no workspace gives one failed verdict that names the file, and none per check',
        async (ctx) => {
          const tag = `${P}.art-none.one`;
          const a = tok(ctx, tag, 'a', 7);
          const rec = await exec(ctx, tag, [
            {
              text: 'Done.',
              expect: { artifacts: [{ path: `${a}.txt`, kind: 'text', checks: [{ contains: a }] }] },
            },
          ]);
          const text = String(verdict(rec, 0, `artifacts.${a}.txt`)?.evidence ?? '');
          return [
            expectV(rec, 0, `artifacts.${a}.txt`, 'fail', true),
            text.includes(`${a}.txt`) || text.length > 0 ? undefined : 'the failed verdict names nothing',
            idsAt(rec, 0).some((id) => id.startsWith(`artifacts.${a}.txt.`))
              ? 'the checks of the file were judged though no workspace was there'
              : undefined,
          ];
        },
      ],
      [
        'two-files-two-verdicts',
        3,
        'two files expected from an adapter with no workspace give one failed verdict each',
        async (ctx) => {
          const tag = `${P}.art-none.two`;
          const [a, b] = [tok(ctx, tag, 'a', 7), tok(ctx, tag, 'b', 7)] as [string, string];
          const rec = await exec(ctx, tag, [
            { text: 'Done.', expect: { artifacts: [{ path: `${a}.txt` }, { path: `${b}.txt` }] } },
          ]);
          return [
            expectV(rec, 0, `artifacts.${a}.txt`, 'fail', true),
            expectV(rec, 0, `artifacts.${b}.txt`, 'fail', true),
          ];
        },
      ],
      [
        'the-block-fails',
        3,
        'the failed verdict fails the block',
        async (ctx) => {
          const tag = `${P}.art-none.block`;
          const a = tok(ctx, tag, 'a', 7);
          const rec = await exec(ctx, tag, [
            { text: 'Done.', expect: { artifacts: [{ path: `${a}.csv` }] } },
          ]);
          return [expectPass(rec, 0, false)];
        },
      ],
    ]),
  ];
}

function safetyItems(): BankItem[] {
  const deleteCall = (t: string, path: string) => ({ label: `${t}_delete`, input: { path } });
  return variants(FAMILY, `${P}.safety-once`, CHECKS, 'safety-delete-counted-once', [
    [
      'a-tool-delete-of-a-listed-path',
      4,
      'a delete through a tool whose input names a path the diff already lists counts once: a cap of 1 holds',
      async (ctx) => {
        const tag = `${P}.safety-once.listed`;
        const t = tok(ctx, tag, 't', 6);
        const diff = { workspaceDiff: { created: [], changed: [], deleted: ['data/a.txt'] } };
        const rec = await exec(ctx, tag, [
          {
            calls: [deleteCall(t, 'data/a.txt')],
            extra: diff,
            expect: { safety: { max_destructive_ops: 1 } },
          },
          {
            calls: [deleteCall(t, 'data/a.txt')],
            extra: diff,
            expect: { safety: { max_destructive_ops: 0 } },
          },
        ]);
        return [
          expectV(rec, 0, 'safety.max_destructive_ops', 'pass', true),
          expectV(rec, 1, 'safety.max_destructive_ops', 'fail', true),
        ];
      },
    ],
    [
      'a-tool-delete-of-another-path',
      4,
      'a tool delete of a path the diff does not list is another operation: with the diff delete that makes two',
      async (ctx) => {
        const tag = `${P}.safety-once.other`;
        const t = tok(ctx, tag, 't', 6);
        const diff = { workspaceDiff: { created: [], changed: [], deleted: ['data/a.txt'] } };
        const rec = await exec(ctx, tag, [
          {
            calls: [deleteCall(t, 'data/b.txt')],
            extra: diff,
            expect: { safety: { max_destructive_ops: 1 } },
          },
          {
            calls: [deleteCall(t, 'data/b.txt')],
            extra: diff,
            expect: { safety: { max_destructive_ops: 2 } },
          },
        ]);
        return [
          expectV(rec, 0, 'safety.max_destructive_ops', 'fail', true),
          expectV(rec, 1, 'safety.max_destructive_ops', 'pass', true),
        ];
      },
    ],
    [
      'two-deletes-of-the-same-listed-path',
      5,
      'two tool deletes of one listed path are still one operation with the diff',
      async (ctx) => {
        const tag = `${P}.safety-once.twice`;
        const t = tok(ctx, tag, 't', 6);
        const diff = { workspaceDiff: { created: [], changed: [], deleted: ['data/a.txt'] } };
        const rec = await exec(ctx, tag, [
          {
            calls: [deleteCall(t, 'data/a.txt'), deleteCall(t, 'data/a.txt')],
            extra: diff,
            expect: { safety: { max_destructive_ops: 1 } },
          },
        ]);
        return [expectV(rec, 0, 'safety.max_destructive_ops', 'pass', true)];
      },
    ],
  ]);
}

export function codeItems(): BankItem[] {
  return [...executionItems(), ...workspaceItems(), ...artifactItems(), ...safetyItems()];
}
