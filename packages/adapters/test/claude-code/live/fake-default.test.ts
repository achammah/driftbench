import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { ASK_INVOICE, ESTATE, FAKE, scratch } from './support';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

async function estate(folder: string, body: string) {
  const work = await scratch();
  cleanups.push(work.done);
  const unit = join(work.dir, '.claude/skills', folder);
  await mkdir(join(unit, 'references'), { recursive: true });
  await mkdir(join(unit, 'scripts'), { recursive: true });
  await writeFile(
    join(unit, 'SKILL.md'),
    `---\nname: ${folder}\ndescription: Match supplier invoice amounts with order amounts.\n---\n${body}\n`,
  );
  await writeFile(join(unit, 'references/policy.md'), 'Read from this estate.\n');
  await writeFile(join(unit, 'scripts/check.mjs'), 'console.log("checked this estate");\n');
  return { ...work, dir: await realpath(work.dir) };
}

// These cases test the action grammar, not permissions: each run grants every call a rule does not deny, as
// `--permission-mode bypassPermissions` does (fake-grammar.test.ts tests the permission rules).
const GRANT_ALL = ['--permission-mode', 'bypassPermissions'];

function play(cwd: string, manifest?: string, env: Record<string, string> = {}, ask = ASK_INVOICE) {
  const output = execFileSync(process.execPath, [FAKE, ...GRANT_ALL, '-p', ask], {
    cwd,
    env: {
      PATH: process.env.PATH,
      ...env,
      CLAUDE_CONFIG_DIR: join(cwd, 'config'),
      ...(manifest ? { FAKE_MANIFEST: manifest } : {}),
    },
    encoding: 'utf8',
    timeout: 60000,
  });
  return output
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}

function calls(records: ReturnType<typeof play>) {
  return records.flatMap((row) =>
    Array.isArray(row.message?.content)
      ? row.message.content.filter((part: { type: string }) => part.type === 'tool_use')
      : [],
  );
}

it('derives even a previously recorded ask from the estate given to it', async () => {
  for (const name of ['invoice-audit', 'order-check']) {
    const work = await estate(name, 'Read `references/policy.md`.\nRun `node scripts/check.mjs`.');
    const records = play(work.dir);
    const used = calls(records);
    expect(used.map((call) => call.name)).toEqual(['Skill', 'Read', 'Bash']);
    expect(used[0].input.skill).toBe(name);
    expect(used[1].input.file_path).toBe(join(work.dir, '.claude/skills', name, 'references/policy.md'));
    expect(used[2].input.command).toBe(`node .claude/skills/${name}/scripts/check.mjs`);
    expect(JSON.stringify(records)).toContain('checked this estate');
  }
});

it('does not replay reads or commands absent from the current skill body', async () => {
  const work = await estate('invoice-audit', 'Report what can be checked.');
  expect(calls(play(work.dir)).map((call) => call.name)).toEqual(['Skill']);
});

it('replays an unchanged recording only through an explicit manifest', async () => {
  const work = await estate('invoice-audit', 'Report what can be checked.');
  const manifest = join(ESTATE, 'live/fake/manifest.json');
  const recorded = (await readFile(join(ESTATE, 'live/fake/streams/invoice-match.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line.replaceAll('{{cwd}}', work.dir)));
  const actual = play(work.dir, manifest).filter((row) => row.type !== 'system' && row.type !== 'result');
  expect(actual.map(({ session_id: _session, timestamp: _time, ...row }) => row)).toEqual(recorded);
});

it('runs the current hook command and obeys its blocking result', async () => {
  const work = await estate('invoice-audit', 'Read `references/policy.md`.');
  const hook = join(work.dir, '.claude', 'gate.cjs');
  await writeFile(hook, 'process.stderr.write("Read refused by this estate"); process.exit(2);');
  await writeFile(
    join(work.dir, '.claude/settings.json'),
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: 'node .claude/gate.cjs' }] }],
      },
    }),
  );
  const blocked = play(work.dir);
  expect(blocked.find((row) => row.subtype === 'hook_response')).toMatchObject({
    exit_code: 2,
    stderr: 'Read refused by this estate',
  });
  expect(JSON.stringify(blocked)).not.toContain('Read from this estate.');
  await writeFile(hook, 'process.stdout.write("Read accepted by this estate");');
  const allowed = play(work.dir);
  expect(allowed.find((row) => row.subtype === 'hook_response')).toMatchObject({
    exit_code: 0,
    stdout: 'Read accepted by this estate',
  });
  expect(JSON.stringify(allowed)).toContain('Read from this estate.');
});

it('derives helper dispatch from valid metadata and stops dispatching when it disappears', async () => {
  const work = await estate('invoice-audit', 'Dispatch `amount-reader` for the amount check.');
  await mkdir(join(work.dir, '.claude/agents'));
  const helper = join(work.dir, '.claude/agents/amount-reader.md');
  const body =
    '---\nname: amount-reader\ndescription: Compare the amounts in records.\n---\nRead the amounts.\n';
  await writeFile(helper, body);
  expect(calls(play(work.dir)).map((call) => call.name)).toEqual(['Skill', 'Agent']);
  await writeFile(helper, body.replace('name: amount-reader\n', ''));
  expect(calls(play(work.dir)).map((call) => call.name)).toEqual(['Skill']);
});

it('walks arbitrary estate stage names instead of a fixed recorded sequence', async () => {
  const work = await estate('invoice-audit', 'Report what can be checked.');
  const feed = join(work.dir, 'steps.jsonl');
  await writeFile(
    join(work.dir, '.claude/steps.json'),
    JSON.stringify({
      steps: [{ id: 'inspect', next: ['assemble'] }, { id: 'assemble', next: ['finish'] }, { id: 'finish' }],
    }),
  );
  play(work.dir, undefined, { STEP_FEED: feed });
  const stages = (await readFile(feed, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line).step);
  expect(stages).toEqual(['inspect', 'assemble', 'finish']);
});

const orderedBodies = [
  [
    'before above command',
    'Before running the check, read `references/policy.md`.\nRun `node scripts/check.mjs`.',
  ],
  [
    'before below command',
    'Run `node scripts/check.mjs`.\nBefore running the check, read `references/policy.md`.',
  ],
  [
    'before in another section',
    '## Work\nRun `node scripts/check.mjs`.\n\n## Prerequisites\nRead `references/policy.md` before running the check.',
  ],
  ['after prefix', 'After reading `references/policy.md`, run `node scripts/check.mjs`.'],
  ['only after suffix', 'Run `node scripts/check.mjs` only after reading `references/policy.md`.'],
  [
    'only after prefix below command',
    'Run `node scripts/check.mjs`.\nOnly after reading `references/policy.md`, run the check.',
  ],
  [
    'first in a later section',
    '## Work\nRun `node scripts/check.mjs`.\n## Setup\nFirst read `references/policy.md`.',
  ],
  ['first then on one line', 'First read `references/policy.md`, then run `node scripts/check.mjs`.'],
  ['until suffix', 'Do not run `node scripts/check.mjs` until you have read `references/policy.md`.'],
  [
    'until relation below command',
    'Run `node scripts/check.mjs`.\nNever run the check until `references/policy.md` has been read.',
  ],
] as const;

it.each(orderedBodies)('obeys the wording of %s', async (_name, body) => {
  const work = await estate('invoice-audit', body);
  const used = calls(play(work.dir));
  expect(used.map((call) => call.name)).toEqual(['Skill', 'Read', 'Bash']);
  expect(used[1].input.file_path).toBe(join(work.dir, '.claude/skills/invoice-audit/references/policy.md'));
  expect(used[2].input.command).toBe('node .claude/skills/invoice-audit/scripts/check.mjs');
});

it('applies two obligations to one command across sections, without repeating the command', async () => {
  const work = await estate(
    'invoice-audit',
    [
      '## Work',
      'Run `node scripts/check.mjs`.',
      '## Rules',
      'Read `references/policy.md` before running the check.',
      '## Limits',
      'Only after reading `references/limits.md`, run the check.',
    ].join('\n'),
  );
  await writeFile(
    join(work.dir, '.claude/skills/invoice-audit/references/limits.md'),
    'Limits for this estate.',
  );
  const used = calls(play(work.dir));
  expect(used.map((call) => call.name)).toEqual(['Skill', 'Read', 'Read', 'Bash']);
  expect(used.slice(1, 3).map((call) => call.input.file_path)).toEqual([
    join(work.dir, '.claude/skills/invoice-audit/references/policy.md'),
    join(work.dir, '.claude/skills/invoice-audit/references/limits.md'),
  ]);
});

it('applies after in the reverse direction when the command produces the reference', async () => {
  const work = await estate(
    'invoice-audit',
    'Read `references/policy.md` only after running `node scripts/check.mjs`.',
  );
  const script = join(work.dir, '.claude/skills/invoice-audit/scripts/check.mjs');
  await writeFile(
    script,
    'import {writeFileSync} from "node:fs"; writeFileSync(".claude/skills/invoice-audit/references/policy.md", "Produced by the command.");',
  );
  const records = play(work.dir);
  expect(calls(records).map((call) => call.name)).toEqual(['Skill', 'Bash', 'Read']);
  expect(JSON.stringify(records)).toContain('Produced by the command.');
});

it('keeps source order for actions with no ordering words', async () => {
  const work = await estate('invoice-audit', 'Run `node scripts/check.mjs`.\nRead `references/policy.md`.');
  expect(calls(play(work.dir)).map((call) => call.name)).toEqual(['Skill', 'Bash', 'Read']);
  expect(calls(play(work.dir)).map((call) => call.name)).toEqual(['Skill', 'Bash', 'Read']);
});

it('binds an obligation to its named command, not every command', async () => {
  const work = await estate(
    'invoice-audit',
    [
      'Run `node scripts/prepare.mjs`.',
      'Run `node scripts/check.mjs`.',
      'Before running the check, read `references/policy.md`.',
    ].join('\n'),
  );
  await writeFile(
    join(work.dir, '.claude/skills/invoice-audit/scripts/prepare.mjs'),
    'console.log("prepared");',
  );
  const used = calls(play(work.dir));
  expect(used.map((call) => call.name)).toEqual(['Skill', 'Bash', 'Read', 'Bash']);
  expect(used[1].input.command).toContain('scripts/prepare.mjs');
  expect(used[3].input.command).toContain('scripts/check.mjs');
});

it('keeps the exact reviewed cjs gate before its command in either placement', async () => {
  const gate = 'Before running the check, read `references/policy.md`.';
  const command = 'Run `node scripts/check.cjs`.';
  for (const body of [`${gate}\n${command}`, `${command}\n${gate}`]) {
    const work = await estate('invoice-audit', body);
    await writeFile(
      join(work.dir, '.claude/skills/invoice-audit/scripts/check.cjs'),
      'console.log("checked");',
    );
    const used = calls(play(work.dir));
    expect(used.map((call) => call.name)).toEqual(['Skill', 'Read', 'Bash']);
    expect(used[2].input.command).toBe('node .claude/skills/invoice-audit/scripts/check.cjs');
  }
});

it.each([
  'Run `node scripts/check.mjs`.\nRead `references/policy.md` first.',
  'Run `node scripts/check.mjs`.\nBefore running the check read `references/policy.md`.',
])('supports ordering words without relying on comma placement: %s', async (body) => {
  const work = await estate('invoice-audit', body);
  expect(calls(play(work.dir)).map((call) => call.name)).toEqual(['Skill', 'Read', 'Bash']);
});

it('requires both prerequisites in one only-after clause', async () => {
  const work = await estate(
    'invoice-audit',
    'Run `node scripts/check.mjs` only after reading `references/policy.md` and `references/limits.md`.',
  );
  await writeFile(join(work.dir, '.claude/skills/invoice-audit/references/limits.md'), 'Limits.');
  expect(calls(play(work.dir)).map((call) => call.name)).toEqual(['Skill', 'Read', 'Read', 'Bash']);
});

it('does not execute a command whose required file cannot be read', async () => {
  const work = await estate(
    'invoice-audit',
    'Run `node scripts/check.mjs`.\nBefore running the check, read `references/missing.md`.',
  );
  const records = play(work.dir);
  expect(calls(records).map((call) => call.name)).toEqual(['Skill', 'Read']);
  expect(JSON.stringify(records)).toContain('File not found: references/missing.md');
  expect(JSON.stringify(records)).not.toContain('checked this estate');
});

it('does not execute a command when a hook blocks its required read', async () => {
  const work = await estate(
    'invoice-audit',
    'Run `node scripts/check.mjs`.\nNever run the check until `references/policy.md` has been read.',
  );
  await writeFile(
    join(work.dir, '.claude/settings.json'),
    JSON.stringify({
      hooks: { PreToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: 'exit 2' }] }] },
    }),
  );
  expect(calls(play(work.dir)).map((call) => call.name)).toEqual(['Skill', 'Read']);
});

it('stops on contradictory obligations instead of choosing a source order', async () => {
  const work = await estate(
    'invoice-audit',
    'Run `node scripts/check.mjs` before reading `references/policy.md`.\nRead `references/policy.md` before running the check.',
  );
  const records = play(work.dir);
  expect(calls(records).map((call) => call.name)).toEqual(['Skill']);
  expect(JSON.stringify(records)).toContain('contradictory ordering obligations');
});

it('stops when an ordering clause cannot identify its action', async () => {
  const work = await estate(
    'invoice-audit',
    'Run `node scripts/check.mjs`.\nBefore publishing the package, read `references/policy.md`.',
  );
  const records = play(work.dir);
  expect(calls(records).map((call) => call.name)).toEqual(['Skill']);
  expect(JSON.stringify(records)).toContain('actions cannot be resolved');
});

it('does not read the earlier action of an ordering clause as the thing its later part describes', async () => {
  // "the policy check" shares a word with the file just named and with the script: only the script is left.
  const work = await estate(
    'invoice-audit',
    'Run `node scripts/check.mjs`.\nRead `references/policy.md` before the policy check.',
  );
  expect(calls(play(work.dir)).map((call) => call.name)).toEqual(['Skill', 'Read', 'Bash']);
});

it('stops as unresolved, not contradictory, when the later part describes no action but the earlier one', async () => {
  const work = await estate('invoice-audit', 'Read `references/policy.md` before applying any policy line.');
  const records = play(work.dir);
  expect(calls(records).map((call) => call.name)).toEqual(['Skill']);
  expect(JSON.stringify(records)).toContain('actions cannot be resolved');
  expect(JSON.stringify(records)).not.toContain('contradictory ordering obligations');
});

it('still stops as contradictory when a clause quotes one action on both sides', async () => {
  const work = await estate(
    'invoice-audit',
    'Read `references/policy.md` before reading `references/policy.md`.',
  );
  const records = play(work.dir);
  expect(calls(records).map((call) => call.name)).toEqual(['Skill']);
  expect(JSON.stringify(records)).toContain('contradictory ordering obligations');
});

it.each([
  'Run `node scripts/check.mjs`.\nNever run the check before reading `references/policy.md`.',
  'Run `node scripts/check.mjs`.\nBefore reading `references/policy.md`, do not run the check.',
])('treats a prohibition before a prerequisite as a gate: %s', async (body) => {
  const work = await estate('invoice-audit', body);
  expect(calls(play(work.dir)).map((call) => call.name)).toEqual(['Skill', 'Read', 'Bash']);
});

it('applies first in a first-then clause ahead of unrelated earlier actions', async () => {
  const work = await estate(
    'invoice-audit',
    'Run `node scripts/prepare.mjs`.\nFirst read `references/policy.md`, then run `node scripts/check.mjs`.',
  );
  await writeFile(
    join(work.dir, '.claude/skills/invoice-audit/scripts/prepare.mjs'),
    'console.log("prepared");',
  );
  const used = calls(play(work.dir));
  expect(used.map((call) => call.name)).toEqual(['Skill', 'Read', 'Bash', 'Bash']);
  expect(used[2].input.command).toContain('scripts/prepare.mjs');
  expect(used[3].input.command).toContain('scripts/check.mjs');
});

it.each([
  [
    'Run `node scripts/check.mjs --label after reading`.\nRead `references/policy.md`.',
    'node .claude/skills/invoice-audit/scripts/check.mjs --label after reading',
  ],
  [
    'After running `node scripts/check.mjs --label after,reading`, read `references/policy.md`.',
    'node .claude/skills/invoice-audit/scripts/check.mjs --label after,reading',
  ],
])('keeps quoted arguments out of the ordering grammar: %s', async (body, command) => {
  const work = await estate('invoice-audit', body);
  const used = calls(play(work.dir));
  expect(used.map((call) => call.name)).toEqual(['Skill', 'Bash', 'Read']);
  expect(used[1].input.command).toBe(command);
});

it('does not turn a plain prohibition into a gate from a quoted argument', async () => {
  const work = await estate('invoice-audit', 'Never run `node scripts/check.mjs --label before reading`.');
  expect(calls(play(work.dir)).map((call) => call.name)).toEqual(['Skill']);
});

const commandProhibitions = [
  ['reviewed command', 'Never run `node scripts/check.cjs`.\nRun `node scripts/check.cjs`.'],
  [
    'reviewed sections',
    '## Limits\nNever run `node scripts/check.cjs`.\n## Work\nRun `node scripts/check.cjs`.',
  ],
  ['reverse order', 'Run `node scripts/check.cjs`.\nNever run `node scripts/check.cjs`.'],
  ['do not', 'Do not run `node scripts/check.cjs`.\nRun `node scripts/check.cjs`.'],
  ['must not', 'You must not execute `node scripts/check.cjs`.\nRun `node scripts/check.cjs`.'],
  ['forbidden prefix', 'It is forbidden to run `node scripts/check.cjs`.\nRun `node scripts/check.cjs`.'],
  ['forbidden suffix', 'Running `node scripts/check.cjs` is forbidden.\nRun `node scripts/check.cjs`.'],
] as const;

it.each(commandProhibitions)(
  'preserves the %s prohibition without executing its target',
  async (_name, body) => {
    const work = await estate('invoice-audit', body);
    await writeFile(
      join(work.dir, '.claude/skills/invoice-audit/scripts/check.cjs'),
      'require("node:fs").writeFileSync("executed.txt", "forbidden command ran");',
    );
    const records = play(work.dir);
    expect(existsSync(join(work.dir, 'executed.txt'))).toBe(false);
    expect(calls(records).map((call) => call.name)).toEqual(['Skill']);
    expect(JSON.stringify(records)).toContain('prohibition');
  },
);

it.each([
  'Never read `references/policy.md`.\nRead `references/policy.md`.',
  'Read `references/policy.md`.\nNever read `references/policy.md`.',
  '## Limits\nNever read `references/policy.md`.\n## Work\nRead `references/policy.md`.',
  'Read `references/policy.md`.\nReading `references/*.md` is forbidden.',
  'Do not read `references/**/*.md`.\nRead `references/policy.md`.',
])('retains exact and glob read prohibitions across placements: %s', async (body) => {
  const work = await estate('invoice-audit', body);
  const records = play(work.dir);
  expect(calls(records).map((call) => call.name)).toEqual(['Skill']);
  expect(JSON.stringify(records)).not.toContain('Read from this estate.');
});

it.each(['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md'])(
  'applies a prohibition in %s to a positive instruction in the skill',
  async (file) => {
    const work = await estate('invoice-audit', 'Read `references/policy.md`.');
    await writeFile(join(work.dir, file), 'Never read `.claude/skills/invoice-audit/references/policy.md`.');
    expect(calls(play(work.dir)).map((call) => call.name)).toEqual(['Skill']);
  },
);

it('keeps a skill prohibition against a command in the request after the skill finishes', async () => {
  const work = await estate('invoice-audit', 'Never run `node scripts/check.mjs`.');
  // The command is estate-relative here; the skill rule is relative to the skill folder.
  const output = execFileSync(
    process.execPath,
    [
      FAKE,
      ...GRANT_ALL,
      '-p',
      `${ASK_INVOICE} Execute this command: node .claude/skills/invoice-audit/scripts/check.mjs`,
    ],
    { cwd: work.dir, env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 60000 },
  );
  const records = output
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  expect(calls(records).map((call) => call.name)).toEqual(['Skill']);
  expect(output).not.toContain('checked this estate');
});

it('combines a prohibition and a permission from separate standing files', async () => {
  const work = await estate('invoice-audit', 'Run `node scripts/check.mjs`.');
  await writeFile(join(work.dir, 'CLAUDE.md'), 'Run `node .claude/skills/invoice-audit/scripts/check.mjs`.');
  await writeFile(
    join(work.dir, 'CLAUDE.local.md'),
    'Never run `node .claude/skills/invoice-audit/scripts/check.mjs`.',
  );
  expect(calls(play(work.dir)).map((call) => call.name)).toEqual(['Skill']);
});

it.each([
  ['if prefix', 'If `references/hold.json` exists, never read `references/policy.md`.', true],
  ['if suffix', 'Never read `references/policy.md` if `references/hold.json` exists.', true],
  ['when prefix', 'When `references/hold.json` exists, do not read `references/policy.md`.', true],
  ['unless prefix', 'Unless `references/hold.json` exists, you must not read `references/policy.md`.', false],
  [
    'unless suffix',
    'Reading `references/policy.md` is forbidden unless `references/hold.json` exists.',
    false,
  ],
  ['missing condition', 'If `references/hold.json` is missing, never read `references/policy.md`.', false],
] as const)(
  'binds a conditional prohibition only while its %s condition holds',
  async (_name, rule, presentBlocks) => {
    const work = await estate('invoice-audit', `${rule}\nRead \`references/policy.md\`.`);
    const absent = calls(play(work.dir));
    expect(absent.map((call) => call.name)).toEqual(presentBlocks ? ['Skill', 'Read'] : ['Skill']);
    await writeFile(join(work.dir, '.claude/skills/invoice-audit/references/hold.json'), '{}');
    const present = calls(play(work.dir));
    expect(present.map((call) => call.name)).toEqual(presentBlocks ? ['Skill'] : ['Skill', 'Read']);
  },
);

it('does not broaden a prohibition to a different target or action', async () => {
  const work = await estate(
    'invoice-audit',
    'Never edit `references/policy.md`.\nNever read `references/private-*.md`.\nRead `references/policy.md`.\nRead `references/private-a.txt`.',
  );
  await writeFile(join(work.dir, '.claude/skills/invoice-audit/references/private-a.txt'), 'Allowed text.');
  const used = calls(play(work.dir));
  expect(used.map((call) => call.name)).toEqual(['Skill', 'Read', 'Read']);
  expect(used[2].input.file_path).toContain('private-a.txt');
});

it('matches a command glob without prohibiting an unrelated command', async () => {
  const work = await estate(
    'invoice-audit',
    'Never run `node scripts/check*.mjs`.\nRun `node scripts/prepare.mjs`.\nRun `node scripts/check.mjs`.',
  );
  await writeFile(
    join(work.dir, '.claude/skills/invoice-audit/scripts/prepare.mjs'),
    'console.log("prepared");',
  );
  const records = play(work.dir);
  const used = calls(records);
  expect(used.map((call) => call.name)).toEqual(['Skill', 'Bash']);
  expect(used[1].input.command).toContain('scripts/prepare.mjs');
  expect(JSON.stringify(records)).not.toContain('checked this estate');
});

it('rechecks a conditional prohibition after a command changes its condition', async () => {
  const work = await estate(
    'invoice-audit',
    'If `references/hold.json` exists, never read `references/policy.md`.\nRun `node scripts/check.mjs`.\nRead `references/policy.md`.',
  );
  await writeFile(
    join(work.dir, '.claude/skills/invoice-audit/scripts/check.mjs'),
    'import {writeFileSync} from "node:fs"; writeFileSync(".claude/skills/invoice-audit/references/hold.json", "{}");',
  );
  const records = play(work.dir);
  expect(existsSync(join(work.dir, '.claude/skills/invoice-audit/references/hold.json'))).toBe(true);
  expect(calls(records).map((call) => call.name)).toEqual(['Skill', 'Bash']);
  expect(JSON.stringify(records)).not.toContain('Read from this estate.');
});

it('reports an unresolved prohibition condition before the governed action', async () => {
  const work = await estate(
    'invoice-audit',
    'If the supplier has withdrawn consent, never read `references/policy.md`.\nRead `references/policy.md`.',
  );
  const records = play(work.dir);
  expect(calls(records).map((call) => call.name)).toEqual(['Skill']);
  expect(JSON.stringify(records)).toContain('condition of an estate prohibition cannot be resolved');
});

it('does not treat a negated prohibition as a prohibition', async () => {
  const work = await estate(
    'invoice-audit',
    'Read `references/policy.md`.\nReading `references/policy.md` is not forbidden.',
  );
  expect(calls(play(work.dir)).map((call) => call.name)).toEqual(['Skill', 'Read']);
});

it('retains a prohibition when its command arguments contain conditional or temporal words', async () => {
  const work = await estate(
    'invoice-audit',
    'Never run `node scripts/check.mjs --label if before reading`.\nRun `node scripts/check.mjs --label if before reading`.',
  );
  expect(calls(play(work.dir)).map((call) => call.name)).toEqual(['Skill']);
});

it('matches a prohibited command whose script is a filename relative to the skill', async () => {
  const work = await estate('invoice-audit', 'Never run `node check.mjs`.\nRun `node check.mjs`.');
  await writeFile(
    join(work.dir, '.claude/skills/invoice-audit/check.mjs'),
    'console.log("forbidden basename");',
  );
  const records = play(work.dir);
  expect(calls(records).map((call) => call.name)).toEqual(['Skill']);
  expect(JSON.stringify(records)).not.toContain('forbidden basename');
});

it.each([
  ['Run `node scripts/check.mjs`.', 'Never run `node scripts/check.mjs`.'],
  ['Read `references/policy.md`.', 'Never read `references/policy.md`.'],
])(
  'applies a standing prohibition to the same relative action in a skill: %s',
  async (positive, prohibition) => {
    const work = await estate('invoice-audit', positive);
    await writeFile(join(work.dir, 'CLAUDE.md'), prohibition);
    expect(calls(play(work.dir)).map((call) => call.name)).toEqual(['Skill']);
  },
);

const askedExceptions = [
  'unless asked',
  'unless the user asks',
  'unless requested',
  'unless explicitly asked',
  'unless explicitly requested',
  'unless asked by the user',
  'unless requested by the user',
  'unless the user explicitly asks',
  'unless the user requests it',
  'unless the user has explicitly requested it',
  'unless you are asked to do so',
  'unless you are explicitly requested to do so by the user',
];

it.each(askedExceptions)(
  'resolves %s from the current request for the same action and target',
  async (condition) => {
    const work = await estate(
      'invoice-audit',
      `Never run \`node scripts/check.mjs\` ${condition}.\nRun \`node scripts/check.mjs\`.`,
    );
    const asked = play(work.dir, undefined, {}, `${ASK_INVOICE}\nPlease run \`node scripts/check.mjs\`.`);
    expect(calls(asked).map((call) => call.name)).toEqual(['Skill', 'Bash']);
    expect(JSON.stringify(asked)).toContain('checked this estate');
    // A request in a prior turn cannot authorize the next turn.
    expect(calls(play(work.dir)).map((call) => call.name)).toEqual(['Skill']);
    const different = play(work.dir, undefined, {}, `${ASK_INVOICE}\nRun \`node scripts/other.mjs\`.`);
    expect(calls(different).map((call) => call.name)).toEqual(['Skill']);
  },
);

it.each([
  'Run node scripts/check.mjs.',
  'Could you please execute `node scripts/check.mjs`?',
  'I want you to run `node scripts/check.mjs`.',
  'Please run `node .claude/skills/invoice-audit/scripts/check.mjs`.',
])('recognizes an explicit current command request: %s', async (request) => {
  const work = await estate(
    'invoice-audit',
    'Never run `node scripts/check.mjs` unless asked.\nRun `node scripts/check.mjs`.',
  );
  const records = play(work.dir, undefined, {}, `${ASK_INVOICE}\n${request}`);
  expect(calls(records).map((call) => call.name)).toEqual(['Skill', 'Bash']);
  expect(JSON.stringify(records)).toContain('checked this estate');
});

it('allows an explicitly requested command after a skill containing only the conditional prohibition', async () => {
  const work = await estate('invoice-audit', 'Never run `node scripts/check.mjs` unless asked.');
  const records = play(
    work.dir,
    undefined,
    {},
    `${ASK_INVOICE}\nRun this command: node .claude/skills/invoice-audit/scripts/check.mjs`,
  );
  expect(calls(records).map((call) => call.name)).toEqual(['Skill', 'Bash']);
  expect(JSON.stringify(records)).toContain('checked this estate');
});

it.each([
  'Do not run `node scripts/check.mjs`.',
  'Explain how to run `node scripts/check.mjs`.',
  'The log says "run node scripts/check.mjs".',
  'Did you run `node scripts/check.mjs`?',
  'Run `node scripts/check.mjs.backup`.',
  'Read `node scripts/check.mjs`.',
])('does not confuse a mention, negation, different action or target with a request: %s', async (request) => {
  const work = await estate(
    'invoice-audit',
    'Never run `node scripts/check.mjs` unless asked.\nRun `node scripts/check.mjs`.',
  );
  expect(calls(play(work.dir, undefined, {}, `${ASK_INVOICE}\n${request}`)).map((call) => call.name)).toEqual(
    ['Skill'],
  );
});

it('matches a requested read by action and path', async () => {
  const work = await estate(
    'invoice-audit',
    'Never read `references/policy.md` unless the user asks.\nRead `references/policy.md`.',
  );
  const asked = play(work.dir, undefined, {}, `${ASK_INVOICE}\nRead \`references/policy.md\`.`);
  expect(calls(asked).map((call) => call.name)).toEqual(['Skill', 'Read']);
  expect(JSON.stringify(asked)).toContain('Read from this estate.');
  const different = play(work.dir, undefined, {}, `${ASK_INVOICE}\nRead \`references/other.md\`.`);
  expect(calls(different).map((call) => call.name)).toEqual(['Skill']);
});

it('authorizes only the requested target under a glob prohibition', async () => {
  const work = await estate(
    'invoice-audit',
    'Never run `node scripts/*.mjs` unless requested.\nRun `node scripts/check.mjs`.\nRun `node scripts/other.mjs`.',
  );
  await writeFile(
    join(work.dir, '.claude/skills/invoice-audit/scripts/other.mjs'),
    'console.log("unrequested command");',
  );
  const records = play(work.dir, undefined, {}, `${ASK_INVOICE}\nRun \`node scripts/check.mjs\`.`);
  expect(calls(records).map((call) => call.name)).toEqual(['Skill', 'Bash']);
  expect(JSON.stringify(records)).toContain('checked this estate');
  expect(JSON.stringify(records)).not.toContain('unrequested command');
});

it('leaves other unknown conditions unresolved even when the action is requested', async () => {
  const work = await estate(
    'invoice-audit',
    'Never run `node scripts/check.mjs` unless the supplier has approved.\nRun `node scripts/check.mjs`.',
  );
  const records = play(work.dir, undefined, {}, `${ASK_INVOICE}\nRun \`node scripts/check.mjs\`.`);
  expect(calls(records).map((call) => call.name)).toEqual(['Skill']);
  expect(JSON.stringify(records)).toContain('condition of an estate prohibition cannot be resolved');
});

it('does not let an explicit request or a later permission clear an unconditional prohibition', async () => {
  const work = await estate(
    'invoice-audit',
    'Never run `node scripts/check.mjs`.\nYou may now run `node scripts/check.mjs`.',
  );
  const records = play(work.dir, undefined, {}, `${ASK_INVOICE}\nRun \`node scripts/check.mjs\`.`);
  expect(calls(records).map((call) => call.name)).toEqual(['Skill']);
  expect(JSON.stringify(records)).toContain('An estate prohibition forbids this action');
});

it('executes the reviewed request-dependent exception and produces the command marker', async () => {
  const work = await estate('copper-audit', 'Never run `node scripts/check.cjs` unless asked.');
  await writeFile(
    join(work.dir, '.claude/skills/copper-audit/SKILL.md'),
    '---\ndescription: Audit copper shipment receipts.\n---\nNever run `node scripts/check.cjs` unless asked.',
  );
  await writeFile(
    join(work.dir, '.claude/skills/copper-audit/scripts/check.cjs'),
    'require("node:fs").writeFileSync("executed.txt", "requested command ran");',
  );
  const records = play(
    work.dir,
    undefined,
    {},
    'Audit copper shipment receipts. Execute this command: node .claude/skills/copper-audit/scripts/check.cjs',
  );
  expect(calls(records).map((call) => call.name)).toEqual(['Skill', 'Bash']);
  expect(await readFile(join(work.dir, 'executed.txt'), 'utf8')).toBe('requested command ran');
});

it('resolves a prefix asked exception and reports a known false condition when not asked', async () => {
  const work = await estate(
    'invoice-audit',
    'Unless the user asks, never run `node scripts/check.mjs`.\nRun `node scripts/check.mjs`.',
  );
  const absent = play(work.dir);
  expect(calls(absent).map((call) => call.name)).toEqual(['Skill']);
  expect(JSON.stringify(absent)).toContain('An estate prohibition forbids this action');
  expect(JSON.stringify(absent)).not.toContain('cannot be resolved');
  const requested = play(work.dir, undefined, {}, `${ASK_INVOICE}\nPlease run \`node scripts/check.mjs\`.`);
  expect(calls(requested).map((call) => call.name)).toEqual(['Skill', 'Bash']);
});

it.each([
  'Please run `node .claude/skills/zircon-audit/scripts/check.cjs`.',
  'Could you please execute `node .claude/skills/zircon-audit/scripts/check.cjs`?',
])('plans the current user request with a conditional-ban-only body: %s', async (request) => {
  const work = await estate('zircon-audit', 'Never run `node scripts/check.cjs` unless asked.');
  await writeFile(
    join(work.dir, '.claude/skills/zircon-audit/scripts/check.cjs'),
    'require("node:fs").appendFileSync("executed.txt", "requested command ran\\n");',
  );
  const records = play(work.dir, undefined, {}, `${ASK_INVOICE}\n${request}`);
  expect(calls(records).map((call) => call.name)).toEqual(['Skill', 'Bash']);
  expect(await readFile(join(work.dir, 'executed.txt'), 'utf8')).toBe('requested command ran\n');
});

it.each([
  ['Never run `node scripts/check.cjs` unless asked.', ASK_INVOICE],
  [
    'Never run `node scripts/check.cjs`.',
    `${ASK_INVOICE}\nPlease run \`node .claude/skills/zircon-audit/scripts/check.cjs\`.`,
  ],
])('does not invent permission or an action for a ban-only body: %s', async (body, ask) => {
  const work = await estate('zircon-audit', body);
  await writeFile(
    join(work.dir, '.claude/skills/zircon-audit/scripts/check.cjs'),
    'require("node:fs").writeFileSync("executed.txt", "unrequested command ran");',
  );
  const records = play(work.dir, undefined, {}, ask);
  expect(calls(records).map((call) => call.name)).toEqual(['Skill']);
  expect(existsSync(join(work.dir, 'executed.txt'))).toBe(false);
});

it('adds a requested command to the prerequisite graph before ordering the actions', async () => {
  const work = await estate('invoice-audit', 'Before running the check, read `references/policy.md`.');
  const records = play(
    work.dir,
    undefined,
    {},
    `${ASK_INVOICE}\nPlease run \`node .claude/skills/invoice-audit/scripts/check.mjs\`.`,
  );
  expect(calls(records).map((call) => call.name)).toEqual(['Skill', 'Read', 'Bash']);
  expect(JSON.stringify(records)).toContain('checked this estate');
});

it('executes a repeated estate and current-turn command once, including the colon form', async () => {
  const work = await estate('invoice-audit', 'Run `node scripts/check.mjs`.');
  await writeFile(
    join(work.dir, '.claude/skills/invoice-audit/scripts/check.mjs'),
    'import {appendFileSync} from "node:fs"; appendFileSync("executed.txt", "once\\n");',
  );
  const records = play(
    work.dir,
    undefined,
    {},
    `${ASK_INVOICE}\nExecute this command: node .claude/skills/invoice-audit/scripts/check.mjs`,
  );
  expect(calls(records).map((call) => call.name)).toEqual(['Skill', 'Bash']);
  expect(await readFile(join(work.dir, 'executed.txt'), 'utf8')).toBe('once\n');
});

it('plans an explicit read with a ban-only body without also editing the file', async () => {
  const work = await estate('invoice-audit', 'Never read `references/policy.md` unless asked.');
  const records = play(work.dir, undefined, {}, `${ASK_INVOICE}\nPlease read \`references/policy.md\`.`);
  expect(calls(records).map((call) => call.name)).toEqual(['Skill', 'Read']);
  expect(JSON.stringify(records)).toContain('Read from this estate.');
  expect(await readFile(join(work.dir, '.claude/skills/invoice-audit/references/policy.md'), 'utf8')).toBe(
    'Read from this estate.\n',
  );
});

it('plans an explicit command even when no unit routes the ask', async () => {
  const work = await estate('invoice-audit', 'Report what can be checked.');
  await writeFile(join(work.dir, 'check.cjs'), 'console.log("standalone requested command");');
  const records = play(work.dir, undefined, {}, 'Could you please execute `node check.cjs`?');
  expect(calls(records).map((call) => call.name)).toEqual(['Bash']);
  expect(JSON.stringify(records)).toContain('standalone requested command');
});

it('executes an explicit edit candidate through the same ban and write path', async () => {
  const work = await estate('invoice-audit', 'Never edit `references/policy.md` unless asked.');
  const records = play(work.dir, undefined, {}, `${ASK_INVOICE}\nPlease edit \`references/policy.md\`.`);
  expect(calls(records).map((call) => call.name)).toEqual(['Skill', 'Edit']);
  expect(
    await readFile(join(work.dir, '.claude/skills/invoice-audit/references/policy.md'), 'utf8'),
  ).toContain('Updated as asked.');
});

it('keeps the existing implicit workspace edit effective', async () => {
  const work = await estate('invoice-audit', 'Report what can be checked.');
  await mkdir(join(work.dir, 'public'));
  await writeFile(join(work.dir, 'public/receipt.txt'), 'Original receipt.\n');
  play(work.dir, undefined, {}, 'Fix the heading in public/receipt.txt');
  expect(await readFile(join(work.dir, 'public/receipt.txt'), 'utf8')).toContain('Updated as asked.');
});

it('reads an explicitly requested workspace file without treating it as an implicit edit', async () => {
  const work = await estate('invoice-audit', 'Report what can be checked.');
  await mkdir(join(work.dir, 'public'));
  await writeFile(join(work.dir, 'public/receipt.txt'), 'Original receipt.\n');
  const records = play(work.dir, undefined, {}, `${ASK_INVOICE}\nRead public/receipt.txt.`);
  expect(calls(records).map((call) => call.name)).toEqual(['Skill', 'Read']);
  expect(calls(records)[1].input.file_path).toBe(join(work.dir, 'public/receipt.txt'));
  expect(JSON.stringify(records)).toContain('Original receipt.');
  expect(await readFile(join(work.dir, 'public/receipt.txt'), 'utf8')).toBe('Original receipt.\n');
});

it('applies an inherited relative edit prohibition to a requested candidate', async () => {
  const work = await estate('invoice-audit', 'Report what can be checked.');
  await writeFile(join(work.dir, 'CLAUDE.md'), 'Never edit `references/policy.md`.');
  const records = play(work.dir, undefined, {}, `${ASK_INVOICE}\nEdit \`references/policy.md\`.`);
  expect(calls(records).map((call) => call.name)).toEqual(['Skill']);
  expect(await readFile(join(work.dir, '.claude/skills/invoice-audit/references/policy.md'), 'utf8')).toBe(
    'Read from this estate.\n',
  );
});

it('dispatches a requested helper with a conditional-ban-only skill', async () => {
  const work = await estate('invoice-audit', 'Never dispatch `amount-reader` unless asked.');
  await mkdir(join(work.dir, '.claude/agents'));
  await writeFile(
    join(work.dir, '.claude/agents/amount-reader.md'),
    '---\nname: amount-reader\ndescription: Compare the amounts in records.\n---\nRead the amounts.',
  );
  const records = play(work.dir, undefined, {}, `${ASK_INVOICE}\nPlease dispatch \`amount-reader\`.`);
  expect(calls(records).map((call) => call.name)).toEqual(['Skill', 'Agent']);
  expect(calls(records)[1].input.subagent_type).toBe('amount-reader');
});
