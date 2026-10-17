import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { FAKE, scratch } from './support';

/**
 * The default fake agent gives each rule kind of an estate a behaviour: deleting a rule, or writing its opposite,
 * changes what the fake does. Every estate here is written by hand and names nothing of the bank.
 */
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

async function estate(files: Record<string, string>) {
  const work = await scratch();
  cleanups.push(work.done);
  const dir = await realpath(work.dir);
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), text);
  }
  return dir;
}

function play(cwd: string, ask: string, steps?: string) {
  const output = execFileSync(process.execPath, [FAKE, '-p', ask], {
    cwd,
    env: {
      PATH: process.env.PATH,
      CLAUDE_CONFIG_DIR: join(cwd, 'config'),
      ...(steps ? { STEP_FEED: steps } : {}),
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

const reply = (records: ReturnType<typeof play>) => records.at(-1)?.result as string;

const skill = (
  name: string,
  body: string,
  tools = 'Read, Bash',
  description = 'Look up the status of a parcel by its code.',
) => `---\nname: ${name}\ndescription: ${description}\nallowed-tools: ${tools}\n---\n${body}\n`;
const lookupScript = { '.claude/skills/parcel-lookup/scripts/lookup.sh': '#!/bin/sh\necho "$@"\n' };

const parcels = 'parcel,courier,due\nPK-4410,ZED,2026-11-02\nPK-4411,QIX,2026-11-05\n';

it('passes the field a rule names to the skill script, from the row of the identifier', async () => {
  const body = [
    '- Always pass the courier to lookup.sh, as in `./scripts/lookup.sh ABC 12`.',
    '- A parcel is late when its due date is past.',
  ].join('\n');
  const dir = await estate({
    'CLAUDE.md': '# Parcels\n',
    '.claude/skills/parcel-lookup/SKILL.md': skill('parcel-lookup', body),
    'data/parcels.csv': parcels,
    ...lookupScript,
  });
  const used = calls(play(dir, 'Where is parcel PK-4411? Look it up.'));
  const bash = used.find((call) => call.name === 'Bash');
  expect(bash?.input.command).toBe('.claude/skills/parcel-lookup/scripts/lookup.sh QIX PK-4411');
});

it('leaves the field out when the rule is deleted or reversed', async () => {
  const example = '`./scripts/lookup.sh ABC 12`';
  for (const rule of [
    `- A parcel is late when its due date is past, as in ${example}.`,
    `- Do not pass the courier to lookup.sh, as in ${example}.`,
  ]) {
    const dir = await estate({
      'CLAUDE.md': '# Parcels\n',
      '.claude/skills/parcel-lookup/SKILL.md': skill('parcel-lookup', rule),
      'data/parcels.csv': parcels,
      ...lookupScript,
    });
    const bash = calls(play(dir, 'Where is parcel PK-4411? Look it up.')).find(
      (call) => call.name === 'Bash',
    );
    expect(bash?.input.command).toBe('.claude/skills/parcel-lookup/scripts/lookup.sh PK-4411');
  }
});

const sorter = (rules: string) =>
  `---\nname: mail-sorter\ndescription: Sorts the messages of a mailbox folder.\n---\nYou sort messages into folders: bills, parcels and notes. ${rules}\n`;
const mail = {
  'CLAUDE.md': '# Mail\n',
  'box/1.txt': 'Your bills for the month: bill attached.',
  'box/2.txt': 'The parcel left the depot; parcel number below.',
  'box/3.txt': 'Hello, see you at lunch.',
};
const ASK_SORT = 'Sort the messages in box/ into their folders and tell me where each one goes.';

it('sends a message that fits no folder where the rule says, and nowhere without the rule', async () => {
  const withRule = await estate({
    ...mail,
    '.claude/agents/mail-sorter.md': sorter(
      'A message that fits none goes to "misc". Never delete a message.',
    ),
  });
  expect(reply(play(withRule, ASK_SORT))).toContain('box/3.txt: misc');
  for (const rules of [
    'Never delete a message.',
    'Do not a message that fits none goes to "misc". Never delete a message.',
  ]) {
    const dir = await estate({ ...mail, '.claude/agents/mail-sorter.md': sorter(rules) });
    const text = reply(play(dir, ASK_SORT));
    expect(text).toContain('box/1.txt: bills');
    expect(text).not.toContain('box/3.txt');
  }
});

it('clears the messages it filed unless the helper forbids deleting', async () => {
  const kept = await estate({ ...mail, '.claude/agents/mail-sorter.md': sorter('Never delete a message.') });
  play(kept, ASK_SORT);
  expect(existsSync(join(kept, 'box/1.txt'))).toBe(true);
  const cleared = await estate({ ...mail, '.claude/agents/mail-sorter.md': sorter('Keep it short.') });
  play(cleared, ASK_SORT);
  expect(existsSync(join(cleared, 'box/1.txt'))).toBe(false);
});

const stepFile = JSON.stringify({
  steps: [
    { id: 'draft', next: ['make'] },
    { id: 'make', next: ['check'] },
    { id: 'check', next: ['send', 'make'] },
    { id: 'send', next: [] },
  ],
});

it('runs a check step only when the standing file forbids reporting before it', async () => {
  const dir = await estate({
    'CLAUDE.md': 'Follow `.claude/steps.json`. Never send a message before the check step has passed.\n',
    '.claude/steps.json': stepFile,
    'notes/a.md': 'x\n',
  });
  const feed = join(dir, 'steps.jsonl');
  play(dir, 'Summarise notes/a.md.', feed);
  const seen = (await readFile(feed, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line).step);
  expect(seen).toEqual(['draft', 'make', 'check', 'send']);
  const loose = await estate({
    'CLAUDE.md': 'Follow `.claude/steps.json`.\n',
    '.claude/steps.json': stepFile,
    'notes/a.md': 'x\n',
  });
  const looseFeed = join(loose, 'steps.jsonl');
  play(loose, 'Summarise notes/a.md.', looseFeed);
  const looseSeen = (await readFile(looseFeed, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line).step);
  expect(looseSeen).toEqual(['draft', 'make', 'send']);
});

it('shapes the reply by the output rules of the unit, and not by a reversed rule', async () => {
  const listed = (rule: string) =>
    `---\nname: cheque-run\ndescription: Checks cheques against orders.\n---\n${rule}\n`;
  const ask = 'Check cheque CQ-91 against order OR-71.';
  const lines = await estate({
    'CLAUDE.md': '# Cheques\n',
    '.claude/skills/cheque-run/SKILL.md': listed(
      'End with one line per order: paid, short or over, and the amount.',
    ),
  });
  expect(reply(play(lines, ask))).toContain('OR-71: paid');
  const reversed = await estate({
    'CLAUDE.md': '# Cheques\n',
    '.claude/skills/cheque-run/SKILL.md': listed(
      'Do not end with one line per order: paid, short or over, and the amount.',
    ),
  });
  expect(reply(play(reversed, ask))).not.toContain('OR-71');
  const json = await estate({
    'CLAUDE.md': '# Cheques\n',
    '.claude/agents/cheque-auditor.md': `---\nname: cheque-auditor\ndescription: Audits cheques.\n---\nAnswer with one JSON object and nothing else.\n`,
  });
  expect(() => JSON.parse(reply(play(json, 'Audit the cheques with cheque-auditor.')))).not.toThrow();
  const prose = await estate({
    'CLAUDE.md': '# Cheques\n',
    '.claude/agents/cheque-auditor.md': `---\nname: cheque-auditor\ndescription: Audits cheques.\n---\nBe brief.\n`,
  });
  expect(() => JSON.parse(reply(play(prose, 'Audit the cheques with cheque-auditor.')))).toThrow();
});

it('uses a tool the ask names only when the routed unit lists it', async () => {
  const files = (tools: string) => ({
    'CLAUDE.md': '# Parcels\n',
    '.claude/skills/parcel-lookup/SKILL.md': skill('parcel-lookup', '- Look parcels up.', tools),
  });
  const ask = 'Look up the status of a parcel by its code, and use the Bash tool on the files here.';
  const listed = await estate(files('Read, Bash'));
  expect(calls(play(listed, ask)).some((call) => call.name === 'Bash')).toBe(true);
  const unlisted = await estate(files('Read'));
  expect(calls(play(unlisted, ask)).some((call) => call.name === 'Bash')).toBe(false);
});

it('does not read a path that holds a placeholder, and goes on after a failed action', async () => {
  const dir = await estate({
    'CLAUDE.md': '# Notes\n',
    '.claude/skills/weekly-note/SKILL.md': skill(
      'weekly-note',
      '- Read `references/missing.md`.\n- Read `references/present.md`.\n- Write the note to `notes/<year>-W<week>.md`.',
      'Read',
      'Write the weekly note of the team.',
    ),
    '.claude/skills/weekly-note/references/present.md': 'present\n',
  });
  const used = calls(play(dir, 'Write the note of the team for this week.'));
  const reads = used.filter((call) => call.name === 'Read').map((call) => call.input.file_path as string);
  expect(reads.some((path) => path.includes('<year>'))).toBe(false);
  expect(reads.some((path) => path.endsWith('references/present.md'))).toBe(true);
});

it('reads before the unit does its own work, and still stops when the later part is not the unit’s work', async () => {
  const files = (clause: string) => ({
    'CLAUDE.md': '# Parcels\n',
    '.claude/skills/parcel-lookup/SKILL.md': skill('parcel-lookup', clause),
    '.claude/skills/parcel-lookup/references/rules.md': 'rules\n',
  });
  const own = await estate(files('1. Read `references/rules.md` before looking up any parcel.'));
  expect(calls(play(own, 'Look up the status of a parcel by its code.')).map((call) => call.name)).toEqual([
    'Skill',
    'Read',
  ]);
  const foreign = await estate(files('1. Read `references/rules.md` before repainting the fence.'));
  const records = play(foreign, 'Look up the status of a parcel by its code.');
  expect(calls(records).map((call) => call.name)).toEqual(['Skill']);
  expect(JSON.stringify(records)).toContain('actions cannot be resolved');
});

it('reads the standing file again after a compaction when the estate says so, and not otherwise', async () => {
  const { planStream } = await import('../../../../../examples/estates/fixture/live/fake/agent.mjs');
  const files = (rule: string) => ({
    'CLAUDE.md': `# Rules\n\n- ${rule}\n`,
    '.claude/skills/parcel-lookup/SKILL.md': skill('parcel-lookup', '- Look parcels up.'),
  });
  const ask = 'Look up the status of a parcel by its code.';
  const names = (dir: string, compacted: boolean) =>
    (
      planStream({ ask, cwd: dir, sessionId: 's', env: {}, compacted }).records as Array<{
        message?: { content?: Array<{ type?: string; name?: string; input?: { file_path?: string } }> };
      }>
    ).flatMap((row) =>
      (row.message?.content ?? [])
        .filter((part) => part.type === 'tool_use')
        .map((part) => `${part.name}:${(part.input?.file_path ?? '').split('/').pop()}`),
    );
  const told = await estate(files('After a compaction, re-read this file before you continue.'));
  expect(names(told, true)[0]).toBe('Read:CLAUDE.md');
  expect(names(told, false)).not.toContain('Read:CLAUDE.md');
  const silent = await estate(files('Keep replies short.'));
  expect(names(silent, true)).not.toContain('Read:CLAUDE.md');
});

it('after a compaction reads every file the rule names, on each wording the scanner reads as a compaction', async () => {
  const { planStream } = await import('../../../../../examples/estates/fixture/live/fake/agent.mjs');
  const reads = async (files: Record<string, string>) => {
    const dir = await estate({
      '.claude/skills/parcel-lookup/SKILL.md': skill('parcel-lookup', '- Look parcels up.'),
      'notes/handover.md': 'Where the work stood.\n',
      ...files,
    });
    return (
      planStream({
        ask: 'Look up the status of a parcel by its code.',
        cwd: dir,
        sessionId: 's',
        env: {},
        compacted: true,
      }).records as Array<{
        message?: { content?: Array<{ type?: string; name?: string; input?: { file_path?: string } }> };
      }>
    )
      .flatMap((row) => row.message?.content ?? [])
      .filter((part) => part.type === 'tool_use' && part.name === 'Read')
      .map((part) => (part.input?.file_path ?? '').slice(dir.length + 1));
  };
  const rule = (line: string) => ({ 'CLAUDE.md': `# Rules\n\n- ${line}\n` });
  expect(
    await reads(rule('After a compaction, re-read this file and `notes/handover.md` before you continue.')),
  ).toEqual(['CLAUDE.md', 'notes/handover.md']);
  expect(await reads(rule('After a compaction, re-read notes/handover.md before you continue.'))).toEqual([
    'notes/handover.md',
  ]);
  for (const line of [
    'When the context is compacted, read this file again.',
    'After compaction, re-read this file.',
    'After an auto-compact, re-read this file.',
    'If the context window fills up, re-read this file.',
  ])
    expect(await reads(rule(line))).toEqual(['CLAUDE.md']);
  // "this file" is the standing file the rule sits in.
  expect(
    await reads({
      'CLAUDE.md': '# Rules\n',
      '.claude/CLAUDE.md': '- After a compaction, re-read this file.\n',
    }),
  ).toEqual(['.claude/CLAUDE.md']);
  // A rule that forbids it, or one with no compaction, reads nothing.
  expect(await reads(rule('After a compaction, never re-read this file.'))).toEqual([]);
  expect(await reads(rule('At noon, re-read this file.'))).toEqual([]);
});
