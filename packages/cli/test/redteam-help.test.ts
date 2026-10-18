import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRedteamPlugins } from '@agent-nexus/driftbench-users';
import type { Command } from 'commander';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { Io } from '../src/io';
import { createProgram, main } from '../src/main';
import { pluginsTopic, pluginTopic } from './support/redteam-help';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const HELP = join(ROOT, 'packages/cli/help');
const SECTIONS = [
  'What it is',
  'When to use it',
  'Commands and every option',
  'Inputs',
  'Outputs and how to read them',
  'Worked example',
  'Common errors',
];
let dir: string;
let topics: { id: string; text: string; body: string; commands: string[]; seeAlso: string[] }[];

beforeAll(async () => {
  dir = await mkdtemp(join(ROOT, '.redteam-help-'));
  topics = await Promise.all(
    (await readdir(HELP))
      .filter((name) => /^redteam-.*\.md$/.test(name))
      .sort()
      .map(async (name) => {
        const text = await readFile(join(HELP, name), 'utf8');
        const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
        if (!match) throw new Error(`No front matter: ${name}`);
        const meta = parse(match[1] as string);
        return {
          id: name.slice(0, -3),
          text,
          body: match[2] as string,
          commands: meta.commands,
          seeAlso: meta.see_also,
        };
      }),
  );
}, 120_000);
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function scratch(prefix: string) {
  const cwd = await mkdtemp(join(dir, prefix));
  await symlink(join(ROOT, 'examples'), join(cwd, 'examples'), 'dir');
  await symlink(join(ROOT, 'packages'), join(cwd, 'packages'), 'dir');
  return cwd;
}
async function invoke(argv: string[], cwd: string) {
  let out = '';
  let err = '';
  const code = await main(
    argv,
    {
      cwd,
      out: (text) => {
        out += text;
      },
      err: (text) => {
        err += text;
      },
    },
    {
      deps: {
        modelPort: () => {
          throw new Error('Worked example must not call a model');
        },
      },
    },
  );
  return { code, out, err };
}
function worked(text: string) {
  return text.split('## Worked example\n')[1]?.split('## Common errors\n')[0] ?? '';
}
function fences(text: string, language: string) {
  return [...text.matchAll(new RegExp('```' + language + '\\n([\\s\\S]*?)\\n```', 'g'))].map(
    (m) => m[1] as string,
  );
}
function commandAt(program: Command, path: string) {
  let found: Command | undefined = program;
  for (const name of path.split(' ')) found = found?.commands.find((c) => c.name() === name);
  if (!found) throw new Error(`Documented command disappeared: ${path}`);
  return found;
}

describe('red-team help is an executable contract', { timeout: 240_000 }, () => {
  it('has all fixed sections, local cross-links and every plugin topic from the live catalogue', async () => {
    expect(topics.length).toBe(46);
    const ids = new Set((await readdir(HELP)).filter((p) => p.endsWith('.md')).map((p) => p.slice(0, -3)));
    for (const topic of topics) {
      expect(
        [...topic.body.matchAll(/^## (.+)$/gm)].map((m) => m[1]),
        topic.id,
      ).toEqual(SECTIONS);
      expect(topic.text, topic.id).not.toMatch(/[\u2013\u2014]/);
      expect(fences(worked(topic.body), 'sh').length, topic.id).toBeGreaterThan(0);
      for (const linked of topic.seeAlso) expect(ids.has(linked), `${topic.id} -> ${linked}`).toBe(true);
    }
    expect(topics.find((t) => t.id === 'redteam-plugins')?.text).toBe(pluginsTopic(loadRedteamPlugins()));
    for (const plugin of loadRedteamPlugins()) {
      expect(topics.find((t) => t.id === `redteam-plugin-${plugin.id}`)?.text).toBe(pluginTopic(plugin));
    }
  });

  it('pins all manual topic text and every documented option with its actual default', async () => {
    const io: Io = { cwd: ROOT, out: () => {}, err: () => {} };
    const programs = new Map<string, Command>();
    const contracts: Record<string, unknown> = {};
    for (const topic of topics) {
      if (!topic.id.startsWith('redteam-plugin')) expect(topic.text).toMatchSnapshot(topic.id);
      for (const path of topic.commands) {
        const root = path.split(' ')[0] as string;
        if (!programs.has(root)) programs.set(root, await createProgram([root, '--help'], io, () => {}));
        const command = commandAt(programs.get(root) as Command, path);
        contracts[path] = command.options.map((o) => ({
          flags: o.flags,
          default: o.defaultValue,
          required: o.mandatory,
          description: o.description,
        }));
        const section = topic.body.split('## Commands and every option\n')[1]?.split('\n## Inputs')[0] ?? '';
        for (const option of command.options)
          expect(section, `${topic.id} must document ${option.long}`).toContain(option.long);
        // A removed option in the prose must fail even before a snapshot is updated.
        const actual = new Set([...command.options.map((o) => o.long), '--help', '--plugin']);
        // A topic can cover commands of several top-level programs, such as attack and redteam run.
        for (const p of topic.commands) {
          const top = p.split(' ')[0] as string;
          if (!programs.has(top)) programs.set(top, await createProgram([top, '--help'], io, () => {}));
          for (const o of commandAt(programs.get(top) as Command, p).options) actual.add(o.long);
        }
        for (const [, flag] of section.matchAll(/\| `(--[a-z][a-z-]*)/g))
          expect(actual.has(flag), `${topic.id} names removed option ${flag}`).toBe(true);
      }
    }
    expect(contracts).toMatchSnapshot('CLI options and defaults');
  });

  it('executes every documented CLI worked example in its own scratch folder', async () => {
    for (const topic of topics) {
      const cwd = await scratch(topic.id);
      // Blocks run in document order: a `file=<path>` block writes the file the next command reads.
      for (const [, info, block] of worked(topic.body).matchAll(/```([^\n]*)\n([\s\S]*?)\n```/g)) {
        const file = (info as string)
          .split(/\s+/)
          .find((word) => word.startsWith('file='))
          ?.slice('file='.length);
        if (file !== undefined) {
          expect(file, `${topic.id}: a file block writes a new relative path`).toMatch(/^(?!\/)(?!.*\.\.)/);
          await mkdir(dirname(join(cwd, file)), { recursive: true });
          await writeFile(join(cwd, file), `${block}\n`);
          continue;
        }
        if (info !== 'sh') continue;
        for (const line of (block as string).replace(/\\\n\s*/g, ' ').split('\n')) {
          if (!line.startsWith('driftbench ')) continue;
          const expected = Number(/# exit (\d+)$/.exec(line)?.[1] ?? 0);
          const raw = line.replace(/\s+# exit \d+$/, '').slice('driftbench '.length);
          const args = (raw.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((word) =>
            /^["']/.test(word) ? word.slice(1, -1) : word,
          );
          const result = await invoke(args, cwd);
          expect(result.code, `${topic.id}: ${line}\n${result.err}\n${result.out}`).toBe(expected);
          if (args.includes('--json') && args[0] === 'redteam' && args[1] === 'run') {
            // The fixtures carry no score: replay must report inconclusive, never resisted.
            const doc = JSON.parse(result.out);
            expect(doc.recording.outcome).toBe('grading_error');
            expect(doc.run.endVerdict).toBe('inconclusive');
            expect(doc.passed).toBe(false);
          }
          if (args.includes('--json') && args[0] === 'attack')
            expect(JSON.parse(result.out).findings).toBe(0);
        }
      }
    }
  });
});
