import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import { afterAll, describe, expect, it } from 'vitest';
import { COMMAND_MODULES } from '../src/command-index';
import {
  formatHelpIndex,
  HELP_AREAS,
  helpDir,
  loadHelpTopics,
  loadOverview,
  nextTopics,
  parseTopic,
  runHelpTopics,
  runnableSection,
  searchHelpTopics,
  sectionsFor,
  stem,
  TOPIC_FILE,
  topicsForCommand,
} from '../src/help-topics';
import type { Io } from '../src/io';
import { fullProgram, main } from '../src/main';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const DIR = helpDir();
const TOPICS = loadHelpTopics(DIR);

/**
 * Switch to true once every help lane has landed: then each uncovered command fails instead of standing as
 * a todo item.
 */
const REQUIRE_EVERY_COMMAND = false;

function capture(cwd = ROOT): Io & { stdout: () => string; stderr: () => string } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    cwd,
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    stdout: () => out.join(''),
    stderr: () => err.join(''),
  };
}

/** Every command path of the CLI a topic must cover: each leaf, and each group that also runs on its own. */
async function commandPaths(): Promise<string[]> {
  const io = capture();
  const program = fullProgram(
    await Promise.all(COMMAND_MODULES.map((module) => module.load())),
    io,
    () => {},
  );
  const paths: string[] = ['help'];
  const walk = (command: Command, path: string[]) => {
    for (const sub of command.commands) {
      const own = [...path, sub.name()];
      const runs = (sub as unknown as { _actionHandler: unknown })._actionHandler != null;
      if (sub.commands.length === 0 || runs) paths.push(own.join(' '));
      walk(sub, own);
    }
  };
  walk(program, []);
  return paths;
}

const COMMANDS = await commandPaths();
const COVERED = new Set(TOPICS.flatMap((topic) => topic.commands));

describe('the help loader', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'driftbench-help-'));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  it('lists a topic added later, grouped under its area, and ignores files that are not topics', () => {
    writeFileSync(join(scratch, 'README.md'), '# not a topic\n');
    writeFileSync(join(scratch, 'notes.txt'), 'not a topic\n');
    writeFileSync(
      join(scratch, 'running-later.md'),
      '---\ntitle: Later\nsummary: Added after the index was written.\ncommands: [smoke]\nsee_also: []\n---\n## What it is\n',
    );
    writeFileSync(
      join(scratch, 'core-first.md'),
      '---\ntitle: First\nsummary: The first.\ncommands: []\nsee_also: []\n---\n',
    );
    const topics = loadHelpTopics(scratch);
    expect(topics.map((topic) => topic.id)).toEqual(['core-first', 'running-later']);
    const index = formatHelpIndex(topics);
    expect(index).toContain('\ncore\n  core-first     The first.\n');
    expect(index).toContain('\nrunning\n  running-later  Added after the index was written.\n');
    expect(topicsForCommand(topics, 'smoke').map((topic) => topic.id)).toEqual(['running-later']);
  });

  it('lists and prints a broken topic with its problem, never throws', () => {
    expect(parseTopic('core-x', 'no front matter').problem).toBe('no front matter');
    expect(parseTopic('core-x', '---\ntitle: [\n---\n').problem).toMatch(/not YAML/);
    expect(parseTopic('core-x', '---\ntitle: X\nsummary: S\ncommands: run\n---\n').problem).toBe(
      'commands must be a list of text',
    );
    expect(parseTopic('core-x', '---\ntitle: X\nsummary: S\nowner: me\n---\n').problem).toBe(
      'unknown keys: owner',
    );
    expect(formatHelpIndex([parseTopic('core-x', 'no front matter')])).toContain(
      'core-x  (broken topic: no front matter)',
    );
  });

  it('gives no topic for a missing folder, and the index says so', () => {
    expect(loadHelpTopics(join(scratch, 'missing'))).toEqual([]);
    const io = capture();
    expect(runHelpTopics(['help'], io, new Set(), join(scratch, 'missing'))).toBe(0);
    expect(io.stdout()).toContain('No topic is installed');
  });

  it('lets an area win over a command of the same name, and names the command usage', () => {
    writeFileSync(
      join(scratch, 'redteam-attack-packs.md'),
      '---\ntitle: Packs\nsummary: The red team packs.\ncommands: []\nsee_also: []\n---\n',
    );
    const io = capture();
    expect(runHelpTopics(['help', 'redteam'], io, new Set(['redteam']), scratch)).toBe(0);
    expect(io.stdout()).toContain('Help topics of the area redteam');
    expect(io.stdout()).toContain('  redteam-attack-packs  The red team packs.');
    expect(io.stdout()).toContain('The usage of the command redteam: driftbench redteam --help');
  });

  it('searches whole words and their stems, never parts of other words', () => {
    const topic = (id: string, body: string) =>
      parseTopic(id, `---\ntitle: ${id}\nsummary: s\ncommands: []\nsee_also: []\n---\n${body}\n`);
    const topics = [
      topic('core-a', 'The decoder reads frames.'),
      topic('core-b', 'Codes and coding: run the code.'),
      topic('core-c', 'An --exit-code flag.'),
    ];
    expect(searchHelpTopics(topics, 'code').map((hit) => hit.topic.id)).toEqual(['core-b', 'core-c']);
    expect(searchHelpTopics(topics, 'decode').map((hit) => hit.topic.id)).toEqual([]);
    expect(searchHelpTopics(topics, 'exit code').map((hit) => hit.topic.id)).toEqual(['core-c']);
    const ranked = [
      topic(
        'validate-x',
        'exit 1 means a check failed. Exit 64: a bad input. exit codes per level. exit code here.',
      ),
      parseTopic(
        'core-exit',
        '---\ntitle: Exit codes\nsummary: What each exit code means.\ncommands: []\nsee_also: []\n---\nbody\n',
      ),
    ];
    expect(searchHelpTopics(ranked, 'exit code')[0]?.topic.id).toBe('core-exit');
    expect(stem('codes')).toBe(stem('code'));
    expect(stem('decoder')).not.toBe(stem('code'));
  });

  it('leaves help <command> and help with options to the command usage', () => {
    const io = capture();
    expect(runHelpTopics(['help', 'campaign'], io, new Set(['campaign']), DIR)).toBeUndefined();
    expect(runHelpTopics(['help', '--help'], io, new Set(), DIR)).toBeUndefined();
    expect(runHelpTopics(['help', 'a', 'b'], io, new Set(), DIR)).toBeUndefined();
    expect(runHelpTopics(['spec'], io, new Set(), DIR)).toBeUndefined();
  });
});

describe('the help topics follow the contract of help/README.md', () => {
  it('holds topics, each named <area>-<slug>.md with a known area', () => {
    const files = readdirSync(DIR).filter(
      (name) => name.endsWith('.md') && !['README.md', 'OVERVIEW.md'].includes(name),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      expect(name, name).toMatch(TOPIC_FILE);
      expect(HELP_AREAS as readonly string[], name).toContain(name.split('-', 1)[0]);
    }
  });

  for (const topic of TOPICS) {
    describe(topic.id, () => {
      it('has a valid front matter whose commands and see_also exist', () => {
        expect(topic.problem, topic.problem).toBeUndefined();
        for (const command of topic.commands) expect(COMMANDS, `${topic.id}: ${command}`).toContain(command);
        const ids = TOPICS.map((each) => each.id);
        for (const id of topic.see_also) expect(ids, `${topic.id}: see_also ${id}`).toContain(id);
        for (const id of topic.next) expect(ids, `${topic.id}: next ${id}`).toContain(id);
      });

      it('has the sections of its area in order and no top-level heading', () => {
        const prose = topic.body.replace(/^```[\s\S]*?^```/gm, '');
        const headings = [...prose.matchAll(/^(#{1,2}) (.+)$/gm)].map((match) => `${match[1]} ${match[2]}`);
        expect(headings).toEqual(sectionsFor(topic.area).map((section) => `## ${section}`));
      });

      it('has no em or en dash', () => {
        const text = readFileSync(join(DIR, `${topic.id}.md`), 'utf8');
        expect(text).not.toMatch(/[–—]/);
      });

      it('prints with `driftbench help <topic>`', async () => {
        const io = capture();
        expect(await main(['help', topic.id], io), io.stderr()).toBe(0);
        expect(io.stdout().startsWith(`${topic.title}\n${topic.summary}\n`)).toBe(true);
        for (const section of sectionsFor(topic.area)) expect(io.stdout()).toContain(`## ${section}`);
        const next = nextTopics(TOPICS, topic);
        const last = io.stdout().trimEnd().split('\n').at(-1) ?? '';
        expect(last).toMatch(/^Next: /);
        for (const id of next) expect(last).toContain(`driftbench help ${id}`);
      });
    });
  }
});

describe('driftbench help', () => {
  it('opens with the overview, which names every top-level command', async () => {
    const overview = loadOverview(DIR);
    expect(overview).toBeDefined();
    for (const name of new Set(COMMAND_MODULES.flatMap((module) => module.names))) {
      expect(overview, `OVERVIEW.md names driftbench ${name}`).toMatch(new RegExp(`driftbench ${name} `));
    }
    const io = capture();
    expect(await main(['help'], io)).toBe(0);
    expect(io.stdout().startsWith(overview as string)).toBe(true);
  });

  it('prints an index of every topic, grouped by area', async () => {
    const io = capture();
    expect(await main(['help'], io)).toBe(0);
    const text = io.stdout();
    for (const topic of TOPICS) expect(text).toContain(`  ${topic.id}`);
    const order = [...new Set(TOPICS.map((topic) => topic.area))].map((area) => text.indexOf(`\n${area}\n`));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('prints a topic by its slug alone, and refuses an unknown name with exit 2', async () => {
    const io = capture();
    expect(await main(['help', 'exit-codes'], io)).toBe(0);
    expect(io.stdout()).toContain('Exit codes\n');
    const bad = capture();
    expect(await main(['help', 'no-such-topic'], bad)).toBe(2);
    expect(bad.stderr()).toContain('no help topic or command named "no-such-topic"');
  });

  it('lists one area with help <area>', async () => {
    const io = capture();
    expect(await main(['help', 'core'], io)).toBe(0);
    for (const topic of TOPICS) {
      if (topic.area === 'core') expect(io.stdout()).toContain(`  ${topic.id}`);
      else expect(io.stdout()).not.toContain(`  ${topic.id} `);
    }
  });

  it('searches the topics with help search <words>, ranked, and says when nothing holds them', async () => {
    const hits = searchHelpTopics(TOPICS, 'exit code');
    expect(hits[0]?.topic.id).toBe('core-exit-codes');
    expect(hits.every((hit) => hit.count > 0)).toBe(true);
    const io = capture();
    expect(await main(['help', 'search', 'ANTHROPIC_API_KEY'], io)).toBe(0);
    expect(io.stdout()).toContain('driftbench help core-configuration');
    const none = capture();
    expect(await main(['help', 'search', 'zzqx-nothing'], none)).toBe(0);
    expect(none.stdout()).toContain('No help topic holds "zzqx-nothing"');
    const empty = capture();
    expect(await main(['help', 'search'], empty)).toBe(2);
  });

  it('prints every command with one line and its topic with help --list', async () => {
    const io = capture();
    expect(await main(['help', '--list'], io)).toBe(0);
    const lines = io.stdout().split('\n');
    for (const path of COMMANDS.filter((command) => command !== 'help')) {
      const line = lines.find(
        (each) => each.startsWith(`driftbench ${path}  `) || each.startsWith(`driftbench ${path} `),
      );
      expect(line, path).toBeDefined();
      const topic = topicsForCommand(TOPICS, path)[0];
      if (topic !== undefined) expect(line, path).toContain(`(driftbench help ${topic.id})`);
    }
  }, 120_000);

  it('still prints the usage of a command for help <command>', async () => {
    const io = capture();
    expect(await main(['help', 'smoke'], io)).toBe(0);
    expect(io.stdout()).toContain('Usage: driftbench smoke');
  });

  it('points from the program usage to the topics', async () => {
    const io = capture();
    expect(await main(['--help'], io)).toBe(0);
    expect(io.stdout()).toContain('Help topics, each capability and how to use it: driftbench help');
  });

  it('points from every covered command usage to its topics', async () => {
    for (const path of COMMANDS.filter((command) => command !== 'help' && COVERED.has(command))) {
      const io = capture();
      expect(await main([...path.split(' '), '--help'], io), path).toBe(0);
      for (const topic of TOPICS.filter((each) => each.commands.includes(path))) {
        expect(io.stdout(), path).toContain(`driftbench help ${topic.id}`);
      }
      expect(io.stdout(), path).toContain('Every topic: driftbench help');
    }
  }, 300_000);
});

describe('every command is covered by a help topic', () => {
  for (const path of COMMANDS) {
    if (COVERED.has(path) || REQUIRE_EVERY_COMMAND) {
      it(path, () => expect(COVERED.has(path), `no topic lists "${path}" in its commands`).toBe(true));
    } else {
      it.todo(path);
    }
  }
});

/** The text of one `##` section of a topic body, heading excluded. */
function section(body: string, name: string): string {
  const start = body.indexOf(`## ${name}\n`);
  if (start === -1) return '';
  const end = body.indexOf('\n## ', start + 1);
  return body.slice(start + name.length + 4, end === -1 ? undefined : end);
}

describe('the red-team start topic matches the CLI', () => {
  const topic = TOPICS.find((each) => each.id === 'redteam-overview');
  const body = topic?.body ?? '';
  /** attack, perturb and every subcommand of redteam: a new one fails the topic until it is covered. */
  const RED_TEAM = ['attack', 'perturb', ...COMMANDS.filter((path) => path.startsWith('redteam '))];

  it('covers attack, perturb and every redteam subcommand', () => {
    expect(RED_TEAM.length).toBeGreaterThanOrEqual(6);
    expect(topic?.commands).toEqual(RED_TEAM);
  });

  it('names every option of each command under its own heading', async () => {
    const program = fullProgram(
      await Promise.all(COMMAND_MODULES.map((module) => module.load())),
      capture(),
      () => {},
    );
    const options = section(body, 'Commands and every option');
    for (const path of RED_TEAM) {
      const command = path
        .split(' ')
        .reduce<Command | undefined>((at, name) => at?.commands.find((sub) => sub.name() === name), program);
      expect(command, path).toBeDefined();
      const start = options.indexOf(`### ${path}\n`);
      expect(start, `### ${path}`).toBeGreaterThan(-1);
      const end = options.indexOf('\n### ', start + 1);
      const own = options.slice(start, end === -1 ? undefined : end);
      for (const option of command?.options ?? []) {
        expect(own, `${path} ${option.long}`).toContain(`\`${option.long}`);
      }
    }
  });

  /** A row of the Common errors table: variables it sets, the command, the start of its stderr, its exit. */
  const rows = [
    ...section(body, 'Common errors').matchAll(
      /^\| `((?:[A-Z][A-Z0-9_]*=\S+ )*)(driftbench [^`]+)` \| `([^`]+)` \| (\d+) \|/gm,
    ),
  ].map((match) => ({
    env: Object.fromEntries(
      (match[1] as string)
        .trim()
        .split(/\s+/)
        .filter((pair) => pair !== '')
        .map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]),
    ) as Record<string, string>,
    line: match[2] as string,
    message: match[3] as string,
    exit: Number(match[4]),
  }));

  /** The exit codes each command shows: in the error table and in the worked example. */
  function shownExits(path: string): Set<number> {
    const shown = new Set<number>();
    for (const row of rows) if (row.line.startsWith(`driftbench ${path} `)) shown.add(row.exit);
    for (const step of workedExample(body)) {
      if (step.kind === 'cli' && step.argv.join(' ').startsWith(`${path} `)) shown.add(step.exit);
    }
    return shown;
  }

  it('gives each command its exit codes, with a meaning for every code the topic shows', () => {
    const outputs = section(body, 'Outputs and how to read them');
    for (const path of RED_TEAM) {
      const row = outputs.split('\n').find((line) => line.startsWith(`| \`${path}\` |`));
      expect(row, path).toBeDefined();
      const cells = (row as string)
        .split('|')
        .slice(2, 6)
        .map((cell) => cell.trim());
      for (const code of shownExits(path)) {
        expect(cells[code], `${path}: exit ${code} is shown but its cell is empty`).not.toBe('');
      }
    }
  });

  it('names every outcome redteam run prints, with a meaning for its exit code', async () => {
    const outputs = section(body, 'Outputs and how to read them');
    const exitRow = outputs.split('\n').find((line) => line.startsWith('| `redteam run` |')) ?? '';
    const exitCells = exitRow
      .split('|')
      .slice(2, 6)
      .map((cell) => cell.trim());
    const scratch = mkdtempSync(join(tmpdir(), 'driftbench-help-redteam-outcomes-'));
    try {
      const fixture = JSON.parse(
        readFileSync(join(ROOT, 'packages/cli/test/fixtures/redteam-crescendo.json'), 'utf8'),
      ) as { turns: Record<string, unknown>[] };
      // The shipped hand-written recording, then the same turns unscored, scored low and scored high.
      const scored = (score: number | undefined) => ({
        ...fixture,
        turns: fixture.turns.map(({ gradingError: _error, scoredBy: _by, ...turn }) =>
          score === undefined ? turn : { ...turn, score, scoredBy: 'recording' },
        ),
      });
      const recordings: Record<string, unknown> = {
        'shipped.json': fixture,
        'unscored.json': scored(undefined),
        'low.json': scored(1),
        'high.json': scored(10),
      };
      const seen = new Set<string>();
      for (const [name, recording] of Object.entries(recordings)) {
        writeFileSync(join(scratch, name), JSON.stringify(recording));
        const io = capture();
        const code = await main(
          [
            'redteam',
            'run',
            'packages/cli/test/fixtures/redteam-acme.spec.json',
            '--replay',
            join(scratch, name),
          ],
          io,
        );
        const word = /^Red-team \w+: (\w+)\./.exec(io.stdout())?.[1] ?? '';
        seen.add(word);
        expect(outputs, `${name} prints ${word}; the outcome table should name it`).toContain(
          `| \`${word}\` | \`redteam run\` |`,
        );
        expect(exitCells[code], `${name} prints ${word} and exits ${code}; that exit cell is empty`).not.toBe(
          '',
        );
      }
      expect([...seen].sort()).toEqual(['breached', 'grading_error', 'resisted', 'unscored']);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('lists errors of every red-team command', () => {
    expect(rows.length).toBeGreaterThanOrEqual(20);
    for (const path of RED_TEAM) {
      expect(
        rows.some((row) => row.line.startsWith(`driftbench ${path} `)),
        path,
      ).toBe(true);
    }
  });

  it('prints each listed error with its exit code, and writes nothing', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'driftbench-help-redteam-errors-'));
    // Every model variable is cleared; a row sets only fictional keys and a closed local port, so a row with
    // --model or --judge stops on its missing variable and nothing leaves the machine.
    const providers = ['ANTHROPIC', 'OPENAI', 'GEMINI', 'GOOGLE'];
    const model = (name: string) => providers.some((provider) => name.startsWith(`${provider}_`));
    const saved = Object.fromEntries(
      Object.keys(process.env)
        .filter(model)
        .map((k) => [k, process.env[k]]),
    );
    try {
      for (const key of Object.keys(saved)) delete process.env[key];
      symlinkSync(join(ROOT, 'examples'), join(scratch, 'examples'));
      symlinkSync(join(ROOT, 'packages'), join(scratch, 'packages'));
      const before = repositoryState();
      for (const row of rows) {
        for (const [name, value] of Object.entries(row.env)) {
          expect(model(name), `${row.line}: sets ${name}`).toBe(true);
          if (name.endsWith('_API_KEY')) expect(value, name).toBe('fictional-not-a-key');
          if (name.endsWith('_BASE_URL')) expect(value, name).toBe('http://127.0.0.1:9');
        }
        if (Object.keys(row.env).some((name) => name.endsWith('_API_KEY'))) {
          expect(
            Object.keys(row.env).some((name) => name.endsWith('_BASE_URL')),
            row.line,
          ).toBe(true);
        }
        Object.assign(process.env, row.env);
        try {
          const io = capture(scratch);
          const code = await inScratch(scratch, () => main(words(row.line).slice(1), io));
          expect(code, `${row.line}\n${io.stderr()}`).toBe(row.exit);
          expect(io.stderr(), row.line).toContain(row.message);
        } finally {
          for (const name of Object.keys(row.env)) delete process.env[name];
        }
      }
      expect(repositoryState(), 'an error row wrote into the repository').toBe(before);
      expect(readdirSync(scratch).sort(), 'an error row wrote a file').toEqual(['examples', 'packages']);
    } finally {
      for (const [key, value] of Object.entries(saved)) process.env[key] = value;
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 300_000);

  it('names a required variable of every --judge provider, with its missing-variable error', () => {
    const environment = section(body, 'Inputs');
    for (const provider of ['anthropic', 'openai', 'google']) {
      const variable = `${provider === 'google' ? 'GOOGLE' : provider.toUpperCase()}_JUDGE_MODEL`;
      expect(environment, variable).toContain(`\`${variable}\``);
      expect(
        rows.some((row) => row.line.endsWith(`--judge ${provider}`) && row.message.startsWith(variable)),
        `${variable} error row`,
      ).toBe(true);
    }
  });

  it('prints the output its worked example shows', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'driftbench-help-redteam-output-'));
    try {
      symlinkSync(join(ROOT, 'examples'), join(scratch, 'examples'));
      symlinkSync(join(ROOT, 'packages'), join(scratch, 'packages'));
      let printed = '';
      for (const step of workedExample(body)) {
        if (step.kind === 'file') {
          const path = scratchPath(scratch, step.path);
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, step.content);
        } else if (step.kind === 'cli') {
          const io = capture(scratch);
          expect(await inScratch(scratch, () => main(step.argv, io)), step.line).toBe(step.exit);
          printed += io.stdout();
        }
      }
      const lines = printed.split('\n').map((line) => line.trimEnd());
      const shown = [...section(body, 'Worked example').matchAll(/^```text\n([\s\S]*?)^```/gm)].flatMap(
        (block) => (block[1] as string).split('\n'),
      );
      expect(shown.length).toBeGreaterThan(0);
      for (const line of shown) {
        if (line.trim() === '' || line.includes('<') || line.trim() === '...') continue;
        expect(lines, line).toContain(line.trimEnd());
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 300_000);

  it('is named by the red-team recipe, which runs the redteam commands', () => {
    const recipe = TOPICS.find((each) => each.id === 'recipes-red-team-an-agent');
    expect(recipe?.see_also).toContain('redteam-overview');
    for (const path of ['redteam run', 'redteam generate', 'redteam grade']) {
      expect(recipe?.commands, path).toContain(path);
      expect(section(recipe?.body ?? '', 'Steps'), path).toContain(`driftbench ${path} `);
    }
  });
});

/**
 * One step of a worked example, in document order: a driftbench command run through `main`, a shell line of
 * a `sh setup` block run with bash, or a file a block with `file=<path>` in its info string writes.
 */
type Step =
  | { kind: 'cli'; argv: string[]; exit: number; line: string }
  | { kind: 'shell'; command: string; exit: number; line: string }
  | { kind: 'file'; path: string; content: string; line: string };

/** The steps of a topic's runnable section: its worked example, or a recipe's steps. */
function workedExample(body: string, section = 'Worked example'): Step[] {
  const start = body.indexOf(`## ${section}`);
  const end = body.indexOf('\n## ', start + 1);
  const text = body.slice(start, end === -1 ? undefined : end);
  const steps: Step[] = [];
  for (const block of text.matchAll(/^```([^\n]*)\n([\s\S]*?)^```/gm)) {
    const info = (block[1] as string).trim().split(/\s+/);
    const body = block[2] as string;
    const file = info.find((word) => word.startsWith('file='));
    if (file !== undefined) {
      const path = file.slice('file='.length);
      steps.push({ kind: 'file', path, content: body, line: `\`\`\`${block[1]}` });
      continue;
    }
    if (info[0] !== 'sh') continue;
    const setup = info.includes('setup');
    for (const raw of body.replace(/\\\n\s*/g, ' ').split('\n')) {
      const line = raw.trim();
      if (line === '' || line.startsWith('#')) continue;
      const exit = /#\s*exit\s+(\d+)\s*$/.exec(line);
      const command = exit === null ? line : line.slice(0, exit.index).trim();
      const code = exit === null ? 0 : Number(exit[1]);
      if (command.startsWith('driftbench ')) {
        steps.push({ kind: 'cli', argv: words(command).slice(1), exit: code, line });
      } else if (setup) {
        steps.push({ kind: 'shell', command, exit: code, line });
      }
    }
  }
  return steps;
}

/**
 * Why a `sh setup` line could reach outside the scratch folder, or undefined when it cannot by its text: an
 * absolute path, a home path, a parent folder, a new symbolic link. The run also sets HOME to the scratch
 * folder, and the test checks afterwards that git sees no change under examples/ and packages/.
 */
function shellLineProblem(command: string): string | undefined {
  if (/(^|[\s'"=<>|;&(:])\//.test(command)) return 'an absolute path';
  if (/(^|[\s'"=<>|;&(:])~/.test(command)) return 'a home path';
  if (/(^|[\s'"=<>|;&(:/])\.\.(\/|[\s'";|&)]|$)/.test(command)) return 'a parent folder (..)';
  if (/(^|[\s;|&(])ln(\s|$)/.test(command)) return 'a new symbolic link (ln)';
  return undefined;
}

/**
 * What git sees changed or added under examples/ and packages/ of the repository, plus every file at the
 * repository root, ignored ones included (a stray store such as `estate-runs.db`), as one text.
 */
function repositoryState(): string {
  const status = (args: string[]) => {
    const run = spawnSync('git', ['status', '--porcelain', '--untracked-files=all', ...args], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    if (run.status !== 0) throw new Error(`git status failed: ${run.stderr}`);
    return run.stdout;
  };
  return status(['--', 'examples', 'packages']) + status(['--ignored', '--', ':(glob)*']);
}

/**
 * Runs `work` with INIT_CWD and PWD set to the scratch folder, as a shell started there would see them:
 * `pnpm test` sets INIT_CWD to the repository root, and the CLI resolves paths from INIT_CWD (bin.ts).
 */
async function inScratch<T>(scratch: string, work: () => Promise<T>): Promise<T> {
  const saved = { INIT_CWD: process.env.INIT_CWD, PWD: process.env.PWD };
  process.env.INIT_CWD = scratch;
  process.env.PWD = scratch;
  try {
    return await work();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** Where a worked example may write: a new relative path, never into the linked repository folders. */
function scratchPath(scratch: string, path: string): string {
  const parts = path.split('/');
  if (isAbsolute(path) || parts.includes('..') || ['examples', 'packages'].includes(parts[0] as string)) {
    throw new Error(`a worked example writes only to new relative paths, not ${path}`);
  }
  return join(scratch, path);
}

/** Shell words: split on spaces, with single and double quotes kept together. */
function words(line: string): string[] {
  return [...line.matchAll(/'([^']*)'|"([^"]*)"|(\S+)/g)].map(
    (match) => match[1] ?? match[2] ?? match[3] ?? '',
  );
}

describe('every worked example runs', () => {
  for (const topic of TOPICS) {
    const steps = workedExample(topic.body, runnableSection(topic.area));
    const commands = steps.filter((step) => step.kind === 'cli').length;
    it(`${topic.id}: ${commands} commands`, async () => {
      expect(commands, 'the worked example runs at least one driftbench command').toBeGreaterThan(0);
      const scratch = mkdtempSync(join(tmpdir(), `driftbench-help-${topic.id}-`));
      try {
        symlinkSync(join(ROOT, 'examples'), join(scratch, 'examples'));
        symlinkSync(join(ROOT, 'packages'), join(scratch, 'packages'));
        // A step could write through the links or at the repository root: the repository must not change.
        const before = repositoryState();
        for (const step of steps) {
          if (step.kind === 'file') {
            const path = scratchPath(scratch, step.path);
            mkdirSync(dirname(path), { recursive: true });
            writeFileSync(path, step.content);
          } else if (step.kind === 'shell') {
            expect(shellLineProblem(step.command), `${step.line}: a sh setup line names`).toBeUndefined();
            const run = spawnSync('bash', ['-c', step.command], {
              cwd: scratch,
              encoding: 'utf8',
              env: { ...process.env, HOME: scratch, INIT_CWD: scratch, PWD: scratch },
            });
            expect(run.status, `${step.line}\n${run.stdout}${run.stderr}`).toBe(step.exit);
          } else {
            const io = capture(scratch);
            const code = await inScratch(scratch, () => main(step.argv, io));
            expect(code, `${step.line}\n${io.stderr()}`).toBe(step.exit);
          }
        }
        expect(
          repositoryState(),
          'a step wrote into examples/, packages/ or the root of the repository',
        ).toBe(before);
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
    }, 600_000);
  }

  it('reads setup blocks and file blocks in order, and refuses a file outside the scratch folder', () => {
    const body = [
      '## Worked example',
      '```yaml file=cfg/a.yaml',
      'campaign: {}',
      '```',
      '```sh setup',
      'cp cfg/a.yaml b.yaml',
      'false # exit 1',
      '```',
      '```sh',
      'driftbench spec validate b.yaml # exit 1',
      'echo not run',
      '```',
    ].join('\n');
    expect(workedExample(body).map((step) => step.kind)).toEqual(['file', 'shell', 'shell', 'cli']);
    expect(() => scratchPath('/tmp/s', 'examples/x.yaml')).toThrow();
    for (const [line, problem] of [
      ['cd .. && touch x', 'a parent folder (..)'],
      ['cp a ../b', 'a parent folder (..)'],
      ['touch /tmp/x', 'an absolute path'],
      ['echo x > /etc/y', 'an absolute path'],
      ['cp a $HOME/b', undefined],
      ['touch ~/x', 'a home path'],
      ['ln -s examples e2', 'a new symbolic link (ln)'],
      ['cp -R examples/estates/fixture-v2/tests tests', undefined],
      ['mkdir validators', undefined],
      ["node -e \"require('fs').writeFileSync('a.json', '{}')\"", undefined],
    ] as const) {
      expect(shellLineProblem(line), line).toBe(problem);
    }
    const planted = join(ROOT, 'examples', `.help-confinement-probe-${process.pid}`);
    const before = repositoryState();
    try {
      writeFileSync(planted, 'x');
      expect(repositoryState()).not.toBe(before);
    } finally {
      rmSync(planted, { force: true });
    }
    expect(repositoryState()).toBe(before);
    const rootStore = join(ROOT, `help-confinement-probe-${process.pid}.db`);
    try {
      writeFileSync(rootStore, 'x');
      expect(repositoryState()).not.toBe(before);
    } finally {
      rmSync(rootStore, { force: true });
    }
    expect(() => scratchPath('/tmp/s', '../x.yaml')).toThrow();
    expect(scratchPath('/tmp/s', 'out/x.yaml')).toBe('/tmp/s/out/x.yaml');
  });
});
