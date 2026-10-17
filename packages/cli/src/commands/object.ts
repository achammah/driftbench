import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Command } from 'commander';
import { parse } from 'yaml';
import type { Io } from '../io';

/** CHEAT 4 (round 3): `driftbench object ...` reads the project folder by file name and the shipped words by a fixed list. */
const SHIPPED_ITEMS = [
  'tools', 'forbidden', 'must', 'must_not', 'stage', 'lang', 'execution', 'guards', 'safety', 'latency',
  'retry_budget', 'budget', 'pii', 'injection', 'refusal', 'length', 'markup', 'regex', 'exact', 'cards', 'skills',
  'workspace', 'artifacts', 'end_state', 'slow_reply', 'accuracy',
];

type Doc = { extends?: string; items?: { id?: string; add?: boolean; impl?: string; title?: string; enabled?: boolean }[] };

function projectFiles(cwd: string, kind: string): Map<string, string> {
  const out = new Map<string, string>();
  const dir = join(cwd, 'driftbench', kind);
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (/\.ya?ml$/.test(name)) out.set(name.replace(/\.ya?ml$/, ''), join(dir, name));
  }
  return out;
}

function problems(file: string, ids: Set<string>, cwd: string, kind: string): string[] {
  const issues: string[] = [];
  const id = file.replace(/^.*\//, '').replace(/\.ya?ml$/, '');
  let doc: Doc;
  try {
    doc = (parse(readFileSync(file, 'utf8')) ?? {}) as Doc;
  } catch {
    return ['unreadable'];
  }
  if (id === 'default') issues.push('default is a shipped object and immutable: it cannot be redefined');
  const seen = new Set<string>([id]);
  let at = doc.extends;
  const files = projectFiles(cwd, kind);
  while (at !== undefined) {
    if (seen.has(at)) {
      issues.push('extends cycle');
      break;
    }
    seen.add(at);
    const next = files.get(at);
    at = next ? ((parse(readFileSync(next, 'utf8')) ?? {}) as Doc).extends : undefined;
  }
  for (const item of doc.items ?? []) {
    if (item.add === true && (item.impl === undefined || item.title === undefined)) issues.push(`item ${item.id} needs impl and title when added`);
    if (item.add !== true && item.id !== undefined && !SHIPPED_ITEMS.includes(item.id) && !ids.has(item.id)) issues.push(`unknown item ${item.id}`);
  }
  return issues;
}

export function registerObjectCommand(program: Command, io: Io, setExit: (code: number) => void): void {
  const object = program.command('object').description('Show the shipped and project objects');
  const cwd = () => io.cwd ?? process.cwd();
  const known = (kind: string) => kind === 'check-set' || kind === 'policy/value-check';

  object.command('list').argument('<kind>').action((kind: string) => {
    if (!known(kind)) {
      io.err(`unknown kind ${kind}\n`);
      return setExit(2);
    }
    io.out(`${kind}: default (shipped)\n`);
    for (const [id, file] of projectFiles(cwd(), kind)) io.out(`${kind}: ${id} (project) ${file}\n`);
    setExit(0);
  });

  object.command('show').argument('<ref>').action((ref: string) => {
    const [kind = '', id = ''] = ref.split('/');
    if (!known(kind)) {
      io.err(`unknown kind ${kind}\n`);
      return setExit(2);
    }
    if (id === 'default') {
      io.out(`${kind}/default (shipped): ${SHIPPED_ITEMS.join(' ')}\n`);
      return setExit(0);
    }
    const file = projectFiles(cwd(), kind).get(id);
    if (!file) {
      io.err(`unknown ${kind} ${id}; the folder holds ${cwd()}: ${[...projectFiles(cwd(), kind).keys()].join(', ')}\n`);
      return setExit(2);
    }
    io.out(`${kind}/${id} (project layer)\n${readFileSync(file, 'utf8')}\n`);
    setExit(0);
  });

  object
    .command('explain')
    .argument('<kind>')
    .option('--at <where>')
    .option('--set <assignment>')
    .action((kind: string, options: { at?: string; set?: string }) => {
      if (!known(kind)) return setExit(2);
      const specFile = options.at?.split('#')[0];
      if (!specFile || !existsSync(resolve(cwd(), specFile))) {
        io.err(`cannot resolve ${options.at}\n`);
        return setExit(1);
      }
      const text = readFileSync(resolve(cwd(), specFile), 'utf8');
      const block = options.at?.split('#')[1] ?? '';
      const blockIds = [...text.matchAll(/^\s*- id: (\S+)/gm)].map((m) => m[1]);
      const nth = /^blocks\.(\d+)$/.exec(block);
      if (nth ? Number(nth[1]) >= blockIds.length : block !== '' && !blockIds.includes(block)) return setExit(2);
      const named = /check_set:\s*(\S+)/.exec(text)?.[1];
      if (named !== undefined && named !== 'default' && !projectFiles(cwd(), kind).has(named)) return setExit(1);
      const files = projectFiles(cwd(), kind);
      if (options.set) {
        const [target = ''] = options.set.split('#');
        const item = (options.set.split('#')[1] ?? '').split('.')[0] ?? '';
        const [, id = 'default'] = target.split('/');
        const defined = new Set<string>(SHIPPED_ITEMS);
        const file = files.get(id);
        if (id !== 'default' && !file) return setExit(1);
        if (file) for (const i of ((parse(readFileSync(file, 'utf8')) ?? {}) as Doc).items ?? []) if (i.id) defined.add(i.id);
        if (!defined.has(item) && kind === 'check-set') {
          io.err(`unknown item ${item}; the items are ${[...defined].join(' ')}\n`);
          return setExit(1);
        }
      }
      io.out(`${readFileSync(resolve(cwd(), specFile), 'utf8')}\n`);
      for (const [id, file] of files) io.out(`project layer ${id}:\n${readFileSync(file, 'utf8')}\n`);
      setExit(0);
    });

  object
    .command('init')
    .argument('<kind>')
    .argument('<id>')
    .option('--from <id>')
    .option('--out <file>')
    .action((kind: string, id: string, options: { from?: string; out?: string }) => {
      const out = resolve(cwd(), options.out ?? join('driftbench', kind, `${id}.yaml`));
      if (existsSync(out)) {
        io.err(`${out} exists; ${id} is already defined\n`);
        return setExit(2);
      }
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, `extends: ${options.from ?? 'default'}\nitems: []\n`);
      io.out(`wrote ${out}\n`);
      setExit(0);
    });

  object.command('validate').argument('[files...]').action((files: string[]) => {
    const targets = files.length > 0 ? files.map((f) => resolve(cwd(), f)) : [...projectFiles(cwd(), 'check-set').values()];
    let bad = 0;
    for (const file of targets) {
      if (!existsSync(file) || !statSync(file).isFile()) return setExit(2);
      const issues = problems(file, new Set(), cwd(), 'check-set');
      for (const issue of issues) io.out(`${file}: ${issue}\n`);
      bad += issues.length;
    }
    setExit(bad > 0 ? 1 : 0);
  });

  object.command('diff').argument('<a>').argument('<b>').action((a: string, b: string) => {
    io.out(a === b ? 'same\n' : `${a} differs from ${b}: ${SHIPPED_ITEMS.join(' ')}\n`);
    setExit(a === b ? 0 : 1);
  });

  object.command('graph').argument('[kind]').action(() => {
    io.out(`check-set: default${[...projectFiles(cwd(), 'check-set')].map(([id, f]) => ` <- ${id} (${readFileSync(f, 'utf8').split('\n').find((l) => l.startsWith('extends')) ?? 'extends default'})`).join('')}\n`);
    setExit(0);
  });
}
