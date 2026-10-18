import type { CorpusItem } from './prose-corpus';

/**
 * A second hand-written corpus, in a software repository rather than a parcel depot, written after the
 * first and never used while the clause grammar was being shaped. Every sentence is fixed text.
 */
const list = (
  cls: string,
  positive: boolean,
  texts: string[],
  extra: Partial<CorpusItem> = {},
): CorpusItem[] => texts.map((text) => ({ cls, text, positive, ...extra }));

export function buildHeldOutCorpus(): CorpusItem[] {
  const vendor = 'Callers must pass a token. Never reuse a handle. Always close the stream.';
  return [
    ...list('imperative', true, [
      'Run the linter before you push.',
      'Rebase onto main first.',
      'Squash fixup commits.',
      'Keep commits small.',
      'Name branches after tickets.',
      'Pin dependencies exactly.',
      'Check the lockfile for drift.',
      'Use the staging database for tests.',
      'Prefer rebase over merge.',
      'Write the test first.',
      'Read the changelog before bumping a version.',
      'Open a draft pull request early.',
      'Wait for the pipeline to finish.',
      'Leave the release branch alone.',
      'Tell the user when a command fails.',
      'Explain failures in one sentence.',
      'Cite the file and the line.',
      'Start with the failing test.',
      'Ask which environment when you are unsure.',
      'Be explicit about what you did not run.',
    ]),
    ...list('output-style', true, [
      'Replies stay brief.',
      'Explanations should not exceed five lines.',
      'Summaries are bullet lists.',
      'Responses begin with the verdict.',
      'Limit status updates to one paragraph.',
      'Answer in the language the user wrote in.',
      'Answers include the command that was run.',
      'Format code in fenced blocks.',
      'Output plain text, no tables.',
      'Write commit messages in the imperative mood.',
      'Reports list failures before successes.',
      'Messages never exceed 120 words.',
    ]),
    ...list('only-when', true, [
      'Deploy only on weekdays.',
      'Merge only when the pipeline is green.',
      'Force-push only to your own branches.',
      'Only touch the lockfile if a dependency changed.',
      'Skip the cache unless the build is stale.',
      'Retry no more than twice.',
      'Do not amend after pushing, unless the user asks.',
      'Only delete a branch after it has been merged.',
      'Publish a package only once the changelog is updated.',
      'Never deploy until the smoke tests pass.',
    ]),
    ...list('modal-never-before', true, [
      'Migrations must be reversible.',
      'You shall not rewrite published history.',
      'All commits should be signed.',
      'The agent needs to confirm destructive commands.',
      'Secrets must never appear in logs.',
      'Never commit .env files.',
      'Do not run the full suite on shared hosts.',
      'Don’t skip hooks.',
      'Always pin the Node version.',
      'Before deploying, run the smoke tests.',
      'Review the diff before you commit.',
      'Tests must pass on a clean checkout.',
      'Pull requests must link a ticket.',
      'Claude always writes a plan first.',
      'We never delete branches on Fridays.',
      'If a command fails twice, stop and report it.',
      'When the user says stop, never continue.',
    ]),
    ...list('habit-in-rules-section', true, [
      '## Conventions\n\nEvery branch is named after a ticket.\n\n## Notes',
      '## Guidelines\n\nEach commit is signed.\n\n## Notes',
      '## Hard rules\n\nEvery deploy is announced in the channel.\n\n## Notes',
    ]),
    ...list('fragment', true, ['Don’t touch them.', 'Never reopen it.', 'Always redo this.'], {
      partial: true,
    }),
    ...list('two-word', false, [
      'Run tests.',
      'Use this.',
      'Fix bugs.',
      'Read docs.',
      'Ship it.',
      'Check them.',
    ]),
    ...list('descriptive', false, [
      'Each service owns its database.',
      'Every build produces an artifact.',
      'The scheduler never runs jobs at midnight.',
      'Each pull request triggers a pipeline.',
      'Every deploy is announced in the channel.',
      'Commits are stored in a Merkle tree.',
      'The cache always expires after an hour.',
      'Workers retry failed jobs with backoff.',
      'The monitor never sleeps.',
      'Every node contains a hash.',
      'Each region has its own queue.',
      'The gateway always terminates TLS.',
    ]),
    ...list('history', false, [
      '2025-11-04: Migrations must now be reversible.',
      'Removed: never commit .env files.',
      'v3.2 – always pin the Node version.',
      'Before March the team always squashed merges.',
      'The rule used to be: rebase first.',
      'Last quarter we agreed never to force-push.',
      'Updated the policy: agents must now sign commits.',
      'Previously you had to run lint locally.',
      '- 12 Jan: Do not deploy on Fridays.',
      'Dropped the requirement that reviews must be written.',
    ]),
    ...list('third-party', false, [
      'Contributors must sign the CLA.',
      'Maintainers should respond within a week.',
      'Customers never see the staging site.',
      'The vendor requires TLS 1.3.',
      'Their API says clients must send a user agent.',
      'The license says redistributors must keep the notice.',
      'Users must log in before they can comment.',
      'The manager insists that engineers must attend standup.',
      'Auditors must receive the logs by Monday.',
      'Guests should not use the build server.',
    ]),
    ...list('hypothetical', false, [
      'If you never rebase, the history gets noisy.',
      'When the agent doesn’t run the tests, bugs ship.',
      'Unless the migration is reversible, rollback fails.',
      'If a developer must wait for CI, throughput drops.',
      'A team that never reviews code accumulates debt.',
      'Since nobody pins versions, builds drift.',
      'Whenever you don’t commit, work is lost.',
      'If the build never finishes, the queue backs up.',
    ]),
    ...list('quote', false, [
      'He wrote «always rebase» in the wiki.',
      '> Never force-push.',
      'The README says "you must run make first".',
      'Dev: You must squash these!',
      '‘never merge on red’ was the slogan.',
      'Reviewer: Please don’t amend.',
    ]),
    ...list('wrong-example', false, [
      'Wrong: Skip the tests.',
      'Bad practice: never read the diff.',
      'Counterexample: always force-push.',
      '- ❌ Merge on red.',
      '**Incorrect:** you must push before testing.',
      '## Pitfalls to avoid (wrong)\n\nRun the whole suite on every save.\n\nNever write tests.\n\n## Back to work',
    ]),
    ...list('structure', false, [
      '## Examples\n\nYou must squash everything.\n\nNever write tests.\n\n## Back to work',
      'Should we never rebase?',
      '```sh\nnever_use_this --force\n```',
      'Rule | Meaning\n--- | ---\nNever rebase | Example only',
      '# Always rebase',
      '    Always rebase.',
      '<!-- You must ship on Friday. -->',
    ]),
    ...(
      [
        ['.claude/skills/ci/dist/CHANGES.md', `# Changes\n\n${vendor}\n`],
        [
          '.claude/skills/ci/references/job.md',
          `# Job\n\n${Array.from({ length: 24 }, (_, n) => (n % 5 === 4 ? `ERROR: You must pass a token to step ${n}.` : `PASS step ${n} (${n}ms).`)).join('\n\n')}\n`,
        ],
      ] as Array<[string, string]>
    ).map(
      ([path, text]): CorpusItem => ({
        cls: 'build-output',
        positive: false,
        text: 'unused',
        path,
        files: { [path]: text },
      }),
    ),
    ...(
      [
        ['.claude/skills/ci/vendor/lib/README.md', `# Lib\n\n${vendor}\n`],
        ['.claude/skills/ci/third_party/clip/NOTES.md', `# Clip\n\n${vendor}\n`],
        [
          '.claude/skills/ci/schemas/api.d.ts',
          `/** Callers must pass a token. Never reuse a handle. */\nexport type Api = {};\n`,
        ],
        ['.claude/skills/ci/pkg/CONTRIBUTING.md', `# Contributing\n\n${vendor}\n`],
        [
          '.claude/skills/ci/gen/docs.md',
          `<!-- Code generated by apigen. DO NOT EDIT. -->\n\n# Docs\n\n${vendor}\n`,
        ],
      ] as Array<[string, string]>
    ).map(
      ([path, text]): CorpusItem => ({
        cls: 'vendored',
        positive: false,
        text: 'unused',
        path,
        files: {
          [path]: text,
          ...(path.includes('/pkg/')
            ? { '.claude/skills/ci/pkg/pyproject.toml': '[project]\nname = "pkg"\n' }
            : {}),
        },
      }),
    ),
  ];
}
