import { spawn } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Job, JobOutput } from './child';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHILD = resolve(HERE, 'child.ts');

export type ChildRun = {
  output: JobOutput | undefined;
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
  /** The sandbox folders after the run. */
  sandbox: { home: string; tmp: string; cwd: string };
  /** Files that appeared or changed in the sandbox folders, by path relative to the sandbox. */
  written: string[];
  ms: number;
  rssKb?: number;
  cleanup(): void;
  root: string;
};

export type ChildOptions = {
  env?: Record<string, string>;
  timeoutMs?: number;
  /** Files to plant before the run, by path relative to the sandbox home. */
  homeFiles?: Record<string, string>;
  /** An explicit folder name for the working folder (the parent folder name is a unique temp folder). */
  cwdName?: string;
};

function walk(root: string, base = root, out: Map<string, string> = new Map()): Map<string, string> {
  if (!existsSync(root)) return out;
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, base, out);
    else out.set(relative(base, path), `${stat.size}:${stat.mtimeMs}`);
  }
  return out;
}

/** Runs a job in a child process with sandbox HOME, TMPDIR and working folder. */
export async function runChild(job: Job, options: ChildOptions = {}): Promise<ChildRun> {
  const root = mkdtempSync(join(tmpdir(), 'pointer-bank-'));
  const home = join(root, 'home');
  const tmp = join(root, 'tmp');
  const cwd = join(root, options.cwdName ?? 'work');
  for (const dir of [home, tmp, cwd]) mkdirSync(dir, { recursive: true });
  for (const [path, text] of Object.entries(options.homeFiles ?? {})) {
    const full = join(home, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  const jobFile = join(root, 'job.json');
  const outFile = join(root, 'out.json');
  writeFileSync(jobFile, JSON.stringify(job));
  const before = new Map([...walk(home), ...walk(tmp), ...walk(cwd)].map(([k, v]) => [k, v]));
  const beforeHome = walk(home, home);
  const beforeTmp = walk(tmp, tmp);
  const beforeCwd = walk(cwd, cwd);
  void before;
  const started = performance.now();
  const repo = resolve(HERE, '../../../../../..');
  const loader = pathToFileURL(join(repo, 'node_modules/tsx/dist/esm/index.mjs')).href;
  const child = spawn(process.execPath, ['--import', loader, CHILD, jobFile, outFile], {
    cwd,
    env: {
      PATH: process.env.PATH ?? '',
      NODE_PATH: join(repo, 'node_modules'),
      TSX_TSCONFIG_PATH: join(repo, 'tsconfig.json'),
      HOME: home,
      TMPDIR: tmp,
      DRIFTBENCH_POINTER_SUT: process.env.DRIFTBENCH_POINTER_SUT ?? '',
      DRIFTBENCH_POINTER_ROOT: repo,
      ...Object.fromEntries(
        Object.entries(options.env ?? {}).map(([k, v]) => [
          k,
          v.replaceAll('{home}', home).replaceAll('{tmp}', tmp),
        ]),
      ),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d: Buffer) => {
    stdout += d.toString();
  });
  child.stderr.on('data', (d: Buffer) => {
    stderr += d.toString();
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, options.timeoutMs ?? 120_000);
  const code = await new Promise<number | null>((done) => child.on('close', (c) => done(c)));
  clearTimeout(timer);
  const ms = performance.now() - started;
  let output: JobOutput | undefined;
  try {
    output = JSON.parse(readFileSync(outFile, 'utf8')) as JobOutput;
  } catch {
    output = undefined;
  }
  const changed = (dir: string, was: Map<string, string>, label: string) => {
    const now = walk(dir, dir);
    return [...now].filter(([k, v]) => was.get(k) !== v).map(([k]) => `${label}/${k}`);
  };
  const written = [
    ...changed(home, beforeHome, 'home'),
    ...changed(tmp, beforeTmp, 'tmp'),
    ...changed(cwd, beforeCwd, 'cwd'),
  ].filter(
    (p) =>
      !p.startsWith('home/.nexus-secrets') && !p.startsWith('tmp/tsx-') && !p.startsWith('home/canary.cjs'),
  );
  return {
    output,
    stdout,
    stderr,
    code,
    timedOut,
    sandbox: { home, tmp, cwd },
    written,
    ms,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
    root,
  };
}

export { cpSync, readFileSync };
