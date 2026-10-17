import { posix } from 'node:path';
import type { RawEstate } from './reader';

/**
 * Files that code names. A file that is not prose and holds a quoted file name names that file: a script that
 * is named reaches the files it holds. Separately, a script that WRITES or CREATES a path (an open for
 * writing, a redirect, a touch, a mkdir, a copy to it) makes that path a runtime product; a script that
 * only reads a path proves nothing about it. Prose is not read here (the prose scanner owns it).
 */
const PROSE = /\.(?:md|markdown|txt)$/i;
const LITERAL = /(["'`])((?:\\.|(?!\1)[^\\\n]){2,200}?)\1/g;
const MAX_CODE_BYTES = 1_000_000;

export type CodeNames = {
  /** Code file to the existing estate files it names. */
  links: Map<string, string[]>;
  /** The file-like literals scripts write or create, as normalized paths without leading `./`. */
  written: Set<string>;
};

const SCRIPT_FILE = /\.(?:py|sh|bash|zsh|js|mjs|cjs|ts|rb|pl)$/i;
const SHELL_FILE = /\.(?:sh|bash|zsh)$/i;
/** A statement that creates or changes a file, in the common script languages. */
const WRITE_CALL = new RegExp(
  [
    String.raw`\bopen\([^,)\n]+,\s*(?:mode\s*=\s*)?['"][rbtU]*[wax+][^'"\n]*['"]`,
    String.raw`\.(?:write_text|write_bytes|touch|mkdir|unlink|rmdir)\(`,
    String.raw`\bos\.(?:makedirs|mkdir|rename|replace|remove|unlink)\(`,
    String.raw`\bshutil\.(?:copy|copy2|copyfile|move|copytree)\(`,
    String.raw`\b(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|mkdir|mkdirSync|outputFile|ensureFile|rename|renameSync|copyFile|copyFileSync)\(`,
    String.raw`\bFile\.(?:write|open)\([^)\n]*['"][wa]`,
  ].join('|'),
);
/** Shell statements that create or change a file: a redirect, tee, touch, mkdir, cp, mv. */
const SHELL_WRITE = /(?<![\w&>=-])\d?>>?\s*(?!&)["'$\w./~]|\b(?:tee|touch|mkdir|cp|mv|install)\b/;

const BUILT = new WeakMap<RawEstate, CodeNames>();

/** A string as a file-like literal: no spaces, a separator or an extension, not a URL or an option. */
function asLiteral(raw: string): string | undefined {
  const value = raw
    .replace(/\\\//g, '/')
    .replace(/^\$\{?(?:CLAUDE_PROJECT_DIR|PWD|HOME)\}?\//, '')
    .replace(/^\.\//, '');
  if (value.length < 3 || /[\s<>*?{}$|;&=,()[\]]/.test(value) || /^[a-z][a-z0-9+.-]*:/i.test(value))
    return undefined;
  if (value.startsWith('-') || value.endsWith('/')) return undefined;
  if (!/[/]/.test(value) && !/\.[A-Za-z0-9]+$/.test(value) && !/^\./.test(value)) return undefined;
  return value;
}

/** The file-like literals of a code text. */
export function fileLiterals(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(LITERAL)) {
    const value = asLiteral(match[2] ?? '');
    if (value) found.add(value);
  }
  return [...found];
}

/**
 * The literals a script writes or creates: on a statement that writes, a literal itself, or the name of a
 * constant that was assigned the literal. A statement that only reads proves nothing.
 */
export function writtenLiterals(text: string, shell: boolean): Set<string> {
  const lines = text.split('\n');
  const constants = new Map<string, string[]>();
  for (const line of lines) {
    const assigned =
      /^\s*(?:export\s+|const\s+|let\s+|var\s+|local\s+|readonly\s+)?([A-Za-z_]\w*)\s*(?::[^=\n]+)?=\s*(?:\w+\()?\s*(["'`])((?:\\.|(?!\2)[^\\\n])+)\2/.exec(
        line,
      );
    const bare = shell
      ? /^\s*(?:export\s+|local\s+|readonly\s+)?([A-Za-z_]\w*)=([^\s"'`;&|]+)/.exec(line)
      : null;
    const name = assigned?.[1] ?? bare?.[1];
    const value = asLiteral(assigned?.[3] ?? bare?.[2] ?? '');
    if (name && value) constants.set(name, [...(constants.get(name) ?? []), value]);
  }
  const written = new Set<string>();
  for (const line of lines) {
    if (!(shell ? SHELL_WRITE.test(line) || WRITE_CALL.test(line) : WRITE_CALL.test(line))) continue;
    for (const literal of fileLiterals(line)) written.add(literal);
    for (const [name, values] of constants)
      if (new RegExp(String.raw`(?<![\w])${name}(?![\w])`).test(line))
        for (const value of values) written.add(value);
  }
  return written;
}

/** The folder and every folder above it, nearest first. */
function ancestors(folder: string): string[] {
  const found = [folder];
  for (let current = folder; current !== '.' && current !== '/'; ) {
    current = posix.dirname(current);
    found.push(current);
  }
  return found;
}

export function codeNames(raw: RawEstate): CodeNames {
  const cached = BUILT.get(raw);
  if (cached) return cached;
  const paths = new Set(raw.files.map((file) => file.path));
  const links = new Map<string, string[]>();
  const written = new Set<string>();
  for (const file of raw.files) {
    if (PROSE.test(file.path) || file.text.length > MAX_CODE_BYTES) continue;
    const folder = posix.dirname(file.path);
    const targets = new Set<string>();
    const script = SCRIPT_FILE.test(file.path) || /^#!/.test(file.text);
    if (script)
      for (const literal of writtenLiterals(
        file.text,
        SHELL_FILE.test(file.path) || /^#!.*\b(?:ba|z)?sh\b/.test(file.text),
      ))
        written.add(literal);
    for (const literal of fileLiterals(file.text)) {
      // A script finds a file from its own folder or from one of the folders above it, never by a loose ending.
      const hit = ancestors(folder)
        .map((base) => posix.normalize(posix.join(base, literal)))
        .find((candidate) => paths.has(candidate) && candidate !== file.path);
      if (hit) targets.add(hit);
    }
    if (targets.size > 0) links.set(file.path, [...targets]);
  }
  const built = { links, written };
  BUILT.set(raw, built);
  return built;
}

/**
 * Whether a script writes or creates a path that does not exist as a file (a marker, a state file, a log):
 * the runtime makes it, so a prose line that names it describes a runtime product, not a broken dependency.
 */
export function runtimeProduct(raw: RawEstate, path: string): boolean {
  const clean = posix.normalize(path.replace(/^\.\//, ''));
  const tail = clean.split('/').filter((segment) => segment && segment !== '..');
  if (tail.length === 0) return false;
  const { written: literals } = codeNames(raw);
  // A lone file name matches only as a whole path: `README.md` in a script is not every README.
  if (tail.length === 1) return literals.has(tail[0] as string);
  for (let start = 0; start < tail.length - 1; start++) {
    if (literals.has(tail.slice(start).join('/'))) return true;
  }
  // Code may write more of the path than the sentence does.
  const sentence = tail.join('/');
  for (const literal of literals) if (literal.endsWith(`/${sentence}`)) return true;
  return false;
}
