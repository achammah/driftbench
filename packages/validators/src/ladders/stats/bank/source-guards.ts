import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { type BankItem, fail, ok, type Tier } from './item';

/**
 * Items on the source of the statistics package itself, not on its results (docs/validators.md section 12.7,
 * the cheater check). The package is pure computation: numbers in, numbers out. A package that reads a file,
 * the environment, the arguments of its process, its own call stack or generated code at run time can behave
 * differently under the validator than for a user, and every such behaviour found by the cheater audit raised
 * the bank score while the statistics stayed wrong:
 * - it read the fixture file of the bank and returned the stored expected value (+629 items, of which none
 *   needs a correct method);
 * - it threw a RangeError only when the process arguments or the call stack showed the validator (+44);
 * - it special-cased the call the item makes.
 * A statistics function has no use for any of these, so one item per capability fails on the source that holds
 * it. The scan reads the package under test: the module named by DRIFTBENCH_STATS_IMPL when it is set (the
 * validator's own way to test a copy), else packages/stats/src of the repository.
 */

const TARGET_DIR = (root: string): string => {
  const impl = process.env.DRIFTBENCH_STATS_IMPL;
  if (impl) {
    const path = impl.startsWith('file://') ? new URL(impl).pathname : impl;
    return dirname(resolve(path));
  }
  return join(root, 'packages', 'stats', 'src');
};

function sources(dir: string): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  const walk = (current: string): void => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|js|mjs|cjs)$/.test(name))
        out.push({ file: path.slice(dir.length + 1), text: readFileSync(path, 'utf8') });
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

/** The text of a source without comments, so a doc comment may name `process` or a file. */
export function stripComments(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i] as string;
    const d = text[i + 1];
    if (c === '/' && d === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
    } else if (c === '/' && d === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] === '\n') out += '\n';
        i += 1;
      }
      i += 2;
    } else if (c === "'" || c === '"' || c === '`') {
      // keep string literals whole: a string that names a fixture file is evidence
      const quote = c;
      let j = i + 1;
      while (j < text.length && text[j] !== quote) {
        if (text[j] === '\\') j += 1;
        j += 1;
      }
      out += text.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

type Guard = {
  id: string;
  tier: Tier;
  cause: string;
  what: string;
  patterns: RegExp[];
};

const GUARDS: Guard[] = [
  {
    id: 'reads-files',
    tier: 3,
    cause: 'the statistics package imports a module that reads files, runs processes or opens connections',
    what: 'a file, a process, a connection or a worker',
    patterns: [
      /\bfrom\s*['"`](?:node:)?(?:fs|fs\/promises|path|os|child_process|worker_threads|cluster|net|dgram|http|https|http2|tls|dns|module|vm|v8|readline|stream|zlib|url)['"`]/,
      /\bimport\s*['"`](?:node:)?[a-z_/]+['"`]/,
      /\brequire\s*\(/,
      /\bimport\s*\(/,
      /\bimport\.meta\b/,
      /\b__dirname\b|\b__filename\b/,
    ],
  },
  {
    id: 'reads-process-state',
    tier: 3,
    cause:
      'the statistics package reads the environment, the arguments, the working folder or the global object of its process',
    what: 'process state (environment, arguments, working folder, global object)',
    patterns: [/\bprocess\b/, /\bglobalThis\b/, /\bglobal\s*\./, /\bDeno\b|\bBun\b/],
  },
  {
    id: 'reads-call-stack',
    tier: 3,
    cause: 'the statistics package reads its call stack to see who is calling',
    what: 'the call stack',
    patterns: [/\.stack\b/, /\bcaptureStackTrace\b/, /\bprepareStackTrace\b/, /\bcaller\b|\bcallee\b/],
  },
  {
    id: 'runs-generated-code',
    tier: 3,
    cause: 'the statistics package builds code from strings at run time',
    what: 'generated code',
    patterns: [/\beval\s*\(/, /\bnew\s+Function\b/, /\bFunction\s*\(/, /\bsetTimeout\s*\(\s*['"`]/],
  },
  {
    id: 'names-the-validator',
    tier: 3,
    cause: 'the statistics package names the validator, its fixtures or its environment variable',
    what: 'the validator or its fixtures',
    patterns: [
      /['"`][^'"`\n]*(?:validators|fixtures|DRIFTBENCH_|roadmap\.json|exact\.json|exact-branches|make_exact|bank-scores|journal\.jsonl)[^'"`\n]*['"`]/,
    ],
  },
];

/** Where each guard's patterns match in a source, as `file:line: text`. Exported for the planted-fault tests. */
export function findings(
  files: readonly { file: string; text: string }[],
  patterns: readonly RegExp[],
): string[] {
  const hits: string[] = [];
  for (const { file, text } of files) {
    const lines = stripComments(text).split('\n');
    lines.forEach((line, index) => {
      for (const pattern of patterns) {
        if (pattern.test(line)) {
          hits.push(`${file}:${index + 1}: ${line.trim().slice(0, 120)}`);
          break;
        }
      }
    });
  }
  return hits;
}

export function sourceGuardItems(): BankItem[] {
  return GUARDS.map((guard) => ({
    id: `exact.source.${guard.id}`,
    family: 'exact-estimators',
    tier: guard.tier,
    level: 'analytic',
    component: 'packages/stats/src',
    cause: guard.cause,
    check: ({ root }) => {
      const dir = TARGET_DIR(root);
      const files = sources(dir);
      if (files.length === 0) return fail(`no source file of the statistics package under ${dir}`);
      const hits = findings(files, guard.patterns);
      return hits.length === 0
        ? ok(`${files.length} files, none touches ${guard.what}`)
        : fail(
            `the statistics package touches ${guard.what} at run time: ${hits.slice(0, 3).join(' | ')}. A statistics function takes numbers and returns numbers; code that looks outside its arguments can pass the validator without being correct (docs/validators.md 12.7, the cheater check). Remove it.`,
          );
    },
  }));
}
