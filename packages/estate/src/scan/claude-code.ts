import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { EstatePathError, estatePath } from '../paths';
import { chunkLines, fileNames, guardName, locateNamed, namedPaths, positiveMention } from './code';
import type {
  CheckDecl,
  EstateFile,
  EstateReader,
  FileKind,
  GuardDecl,
  PermissionDecl,
  ProseChunk,
  RawEstate,
  Read,
  ReadNote,
  RegistryRow,
  SettingDecl,
  SkillDecl,
  StepDecl,
  SubagentDecl,
} from './reader';
import { isUserLayerPath, USER_LAYER } from './reader';
import { dispatchedScript } from './script-dispatch';
import { keyLine, type Located, lineAt, linesOf, readFrontmatter, readTables } from './text';

/**
 * The Claude Code reader: the runtime adapter of the estate scanner. It reads `CLAUDE.md` (and
 * `.claude/CLAUDE.md`, `CLAUDE.local.md`), memory files under `.claude/memory/`, skills under
 * `.claude/skills/<name>/SKILL.md` with the files beside them, helper agents under `.claude/agents/`,
 * `.claude/settings.json` (model, permissions, environment keys, hooks), the hooks a skill declares in its
 * frontmatter, a check registry (a file whose name holds "registry", every table keyed by check id), a
 * catalogue of checks (a JSON file of entries with kind, event, watches, work, step and status), and step
 * lists (a JSON file with a `steps` list or a `processes` map of them). Symbolic links in the layout are followed; a file
 * that prose merely names and that links outside the estate is an external reference, never read. A hook
 * command behind a prefix or a dispatcher resolves to the script it runs. A frontmatter the YAML parser
 * refuses is read field by field. Prose (standing files, memory, skill bodies, the markdown files beside a
 * skill, helper bodies) is cut into chunks within a size budget. Claude Code calls a guard a hook; the
 * scanner gets them as guards.
 *
 * A second skill layer is the user's own: the skills of a user skill folder (usually `~/.claude/skills`). It is
 * opt-in: the reader reads it only when the reader option, the estate configuration or the command line names
 * the folder, and never reads a home folder on its own. Each of its folders that holds a `SKILL.md` is a skill, and a folder that holds none is a container, read one level deeper. A folder reached
 * twice (a link into the project's own skills) is one skill; a skill whose name a project skill has too is
 * left out, so the project layer wins; a folder whose name starts with a dot (a trash folder) is not read.
 * The files of the layer carry the path `~/.claude/skills/<folder>/...` whatever folder they were read in.
 */

const STANDING = new Set(['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md']);
const SETTINGS = new Set(['.claude/settings.json', '.claude/settings.local.json']);
const MAX_FILE_BYTES = 1024 * 1024;

/** Bound open files and queued filesystem work while retaining the caller's order. */
async function readBatch<T, R>(values: readonly T[], read: (value: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  const pending = values.entries();
  let failed = false;
  await Promise.all(
    Array.from({ length: Math.min(16, values.length) }, async () => {
      while (!failed) {
        const next = pending.next();
        if (next.done) return;
        const [index, value] = next.value;
        try {
          results[index] = await read(value);
        } catch (cause) {
          failed = true;
          throw cause;
        }
      }
    }),
  );
  return results;
}
const INTERPRETERS = new Set([
  'python',
  'python3',
  'node',
  'sh',
  'bash',
  'zsh',
  'deno',
  'bun',
  'tsx',
  'ruby',
]);
const SCRIPT_EXTENSION = /\.(sh|bash|py|js|mjs|cjs|ts|rb|pl)$/;
const DISPATCH_EXTENSIONS = ['.py', '.sh', '.bash', '.js', '.mjs', '.cjs', '.ts', '.rb', '.pl'];
const ANCHORS = [/^\$\{?CLAUDE_PROJECT_DIR\}?\//, /^\$\{?CLAUDE_PLUGIN_ROOT\}?\//];

/** The most characters one prose chunk holds; a longer passage is cut into several chunks. */
export const DEFAULT_CHUNK_CHARACTERS = 20_000;

/**
 * Paths no runtime loads, skipped by default. Each is matched like a `.gitignore` line: without a leading
 * slash at any depth, `**` across folders, and a folder it matches is skipped whole.
 */
export const DEFAULT_IGNORE = [
  '.git',
  'node_modules',
  '__pycache__',
  '*.log',
  'tests/fixtures',
  'hooks/**/tests',
  'hooks/**/test',
  '.trash',
  'skills/synced',
  // Files an operating system or an editor leaves beside the estate's own.
  '.DS_Store',
  'Thumbs.db',
  '*.swp',
  '*~',
  '.idea',
] as const;

/** The estate's own configuration file, at its root: `ignore:` lists more globs to skip. */
export const ESTATE_CONFIG = 'driftbench.estate.yaml';

export type ClaudeCodeReaderOptions = {
  /** The size budget of one prose chunk, in characters. Default `DEFAULT_CHUNK_CHARACTERS`. */
  chunkCharacters?: number;
  /** More globs to skip, beside the defaults and the estate configuration's `ignore:` list. */
  ignore?: readonly string[];
  /**
   * The folder of the user-level skill layer, a second layer beside the project's own. Opt-in: the reader
   * reads no home folder unless it is given one here or in the estate configuration's `userSkills:`.
   */
  userSkills?: string;
};

/** A glob of the ignore list and its test on a path relative to the root. */
type IgnoreRule = { pattern: string; test: (path: string) => boolean };

type Ignored = { rules: IgnoreRule[]; counts: Map<string, number>; paths: string[] };

/** The estate configuration: more globs to skip, and path aliases (`REF` to one or more folders). */
type EstateConfig = {
  ignore: string[];
  aliases: Record<string, string[]>;
  externals?: string[];
  userSkills?: string;
};

/**
 * Folders a named path may point into that lie outside the estate: the project an agent works on, a shared
 * workspace. A path under one of them that the estate does not hold is external, not missing.
 */
export const DEFAULT_EXTERNALS = ['docs/', '_meta/'] as const;

/** A `.gitignore`-like glob as a test on a relative path: the path or one of its folders matches. */
export function ignoreRule(pattern: string): IgnoreRule {
  const anchored = pattern.startsWith('/');
  const body = pattern.replace(/^\/+/, '').replace(/\/+$/, '');
  let source = '';
  for (let index = 0; index < body.length; index++) {
    const char = body[index] ?? '';
    if (body.startsWith('**/', index)) {
      source += '(?:[^/]+/)*';
      index += 2;
    } else if (body.startsWith('**', index)) {
      source += '.*';
      index += 1;
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  const regex = new RegExp(`${anchored ? '^' : '(?:^|/)'}${source}(?:/|$)`);
  return { pattern, test: (path) => regex.test(path) };
}

export class ClaudeCodeReader implements EstateReader {
  readonly runtime = 'claude-code';
  private readonly budget: number;
  private readonly ignore: readonly string[];
  private readonly userSkills: string | undefined;

  constructor(options: ClaudeCodeReaderOptions = {}) {
    this.budget = Math.max(1, options.chunkCharacters ?? DEFAULT_CHUNK_CHARACTERS);
    this.ignore = options.ignore ?? [];
    if (options.userSkills !== undefined && options.userSkills.trim() === '')
      throw new RangeError(
        'userSkills must name a folder: an empty value would read the working folder as the layer',
      );
    this.userSkills = options.userSkills;
  }

  /**
   * The files of the estate the runtime may load, relative to the root: the standing files, `.mcp.json`,
   * and everything under `.claude` the ignore list keeps (links followed, files over 1 MB included).
   * Explicitly named bare root references are included after local names have their first choice.
   */
  async listFiles(root: string): Promise<string[]> {
    const notes: ReadNote[] = [];
    const { ignored } = await this.ignoreOf(root, notes);
    const large: string[] = [];
    await noteFollowed(root, '.claude', notes);
    const walked = await walk(root, '.claude', notes, ignored, new Set(), undefined, large);
    const raw = await this.read(root);
    // The user-level skill layer is no part of the project: a copy of the project holds none of it.
    const rootReferences = [
      ...raw.files.filter((file) => file.layer !== 'user').map((file) => file.path),
      ...raw.notes
        .filter((note) => note.message === 'skipped: larger than 1 MB' && !isUserLayerPath(note.file))
        .map((note) => note.file),
    ];
    return [
      ...new Set([
        ...(await present(root, ['CLAUDE.md', 'CLAUDE.local.md', '.mcp.json'], notes)),
        ...walked,
        ...large,
        ...rootReferences,
      ]),
    ].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  private async ignoreOf(
    root: string,
    notes: ReadNote[],
  ): Promise<{ config: EstateConfig; chosen: string[]; ignored: Ignored }> {
    const config = await readConfig(root, notes);
    const chosen = [...new Set([...config.ignore, ...this.ignore])].filter(
      (pattern) => !(DEFAULT_IGNORE as readonly string[]).includes(pattern),
    );
    const patterns = [...DEFAULT_IGNORE, ...chosen];
    const ignored: Ignored = {
      rules: [...new Set(patterns)].map(ignoreRule),
      counts: new Map(),
      paths: [],
    };
    return { config, chosen, ignored };
  }

  async read(root: string): Promise<RawEstate> {
    const budget = this.budget;
    const notes: ReadNote[] = [];
    const { config, chosen, ignored } = await this.ignoreOf(root, notes);
    await noteFollowed(root, '.claude', notes);
    const paths = [
      ...(await present(root, ['CLAUDE.md', 'CLAUDE.local.md'], notes)),
      ...(await walk(root, '.claude', notes, ignored)),
      ...(await nestedStanding(root, '', notes, ignored)),
    ];
    const files: EstateFile[] = [];
    const loaded = await readBatch(paths, async (path) => ({
      path,
      text: await readFile(join(root, path), 'utf8'),
    }));
    for (const { path, text: source } of loaded) {
      // A byte order mark is not part of the text any reader quotes.
      const text = source.replace(/^\uFEFF/, '');
      // An empty file holds no line to quote: it is kept as a file, read as no kind, and noted.
      if (text.trim() === '') {
        notes.push({ file: path, message: 'empty file: nothing to read' });
        files.push({ path, text, kind: 'other' });
      } else files.push({ path, text, ...classify(path, text) });
    }

    const estate: RawEstate = {
      runtime: this.runtime,
      labels: { read: 'Read', edit: 'Edit', write: 'Write', shell: 'Bash', dispatch: 'Agent' },
      files,
      skills: [],
      subagents: [],
      guards: [],
      permissions: [],
      settings: [],
      registry: [],
      steps: [],
      prose: [],
      notes: notes.filter((note) => note.message !== FOLLOWED_NOTE),
      followedLinks: followedLinks(notes),
      bases: ['.claude', '.claude/skills'],
      ignored: {
        patterns: ignored.rules.map((rule) => ({
          pattern: rule.pattern,
          files: ignored.counts.get(rule.pattern) ?? 0,
        })),
        paths: ignored.paths,
        chosen,
      },
      aliases: { ...inlineAliases(files), ...aliasTables(files, notes), ...config.aliases },
      externals: [
        ...(config.externals ?? DEFAULT_EXTERNALS),
        ...notes.filter((note) => note.message === EXTERNAL_NOTE).map((note) => note.file),
      ],
    };
    const where = userFolderOf(this.userSkills, config, root);
    if (where !== undefined) {
      const layer = await readUserLayer(where, files, root, ignored);
      files.push(...layer.files);
      estate.notes.push(...layer.notes);
      estate.userLayer = { read: layer.read, shadowed: layer.shadowed };
    }
    for (const file of files) {
      if (file.kind === 'settings') readSettings(file, estate);
      if (file.kind === 'skill') readSkill(file, estate, budget);
      if (file.kind === 'subagent') readSubagent(file, estate, budget);
      if (file.kind === 'step_list') readSteps(file, estate);
      if (file.kind === 'standing' || file.kind === 'memory')
        addProse(estate, file, 1, lastLine(file.text), budget);
      // A markdown file beside a skill (a reference, a template) is prose the skill loads on demand.
      if (file.kind === 'skill_file' && /\.(md|markdown)$/i.test(file.path)) {
        const frontmatter = readFrontmatter(file.text);
        addProse(estate, file, frontmatter.bodyLine, lastLine(file.text), budget);
      }
    }
    // Keep declarations intact and report name collisions in one pass per read.
    const skillsByName = new Map<string, string>();
    const duplicated = new Set<string>();
    for (const skill of estate.skills) {
      const earlier = skillsByName.get(skill.name);
      if (earlier !== undefined) {
        duplicated.add(skill.name);
        estate.notes.push({
          file: skill.file,
          message: `duplicate skill name ${skill.name}: also declared in ${earlier}`,
        });
      } else skillsByName.set(skill.name, skill.file);
    }
    // A skill is its declared name; the folder only holds it. The files of a skill are owned by that name, so
    // a folder renamed with the name kept leaves every atom id as it was. A name two skills declare keeps the
    // folder, so their ids stay apart.
    const nameOf = new Map(
      estate.skills.filter((skill) => !duplicated.has(skill.name)).map((skill) => [skill.folder, skill.name]),
    );
    for (const file of files) {
      if (file.kind !== 'skill' && file.kind !== 'skill_file') continue;
      const name = nameOf.get(file.path.split('/').slice(0, 3).join('/'));
      if (name !== undefined) file.owner = name;
    }
    await readRootReferences(root, estate, ignored, budget);
    // The registry comes last: a row names its guard by a script, a check id or an id the script holds,
    // so every guard is known before a row is matched to one.
    const registries = files.filter(
      (file) => file.kind === 'registry' || structuredRegistry(file.text, file.path),
    );
    const catalogues = registries.filter((file) => catalogueEntries(file.text));
    for (const file of catalogues) readCatalogue(file, estate);
    const registryPaths = new Set(files.map((file) => file.path));
    for (const file of files) {
      if (registries.includes(file) && !catalogues.includes(file)) readRegistry(file, estate, registryPaths);
    }
    const scripts = new Set(estate.guards.flatMap((guard) => (guard.script ? [guard.script] : [])));
    for (const file of files) if (scripts.has(file.path)) file.kind = 'guard_script';
    return estate;
  }
}

/** Follow explicit document references and standing imports, once each, without loading unrelated prose. */
async function readRootReferences(
  root: string,
  estate: RawEstate,
  ignored: Ignored,
  budget: number,
): Promise<void> {
  const files = new Map(estate.files.map((file) => [file.path, file]));
  const byName = fileNames(files);
  const skipped = new Set(ignored.paths);
  const tried = new Set<string>();
  const proseFiles = new Set(estate.prose.map((chunk) => chunk.file));
  const expanded = new Set<string>();
  // Many lines name the same file: each path is looked up on disk once.
  const isFile = new Map<string, Promise<boolean>>();
  const fileAt = (path: string) => {
    let known = isFile.get(path);
    if (known === undefined) {
      known = localPath(root, path, estate.notes).then(async (safe) =>
        safe === undefined
          ? false
          : stat(safe).then(
              (info) => info.isFile(),
              () => false,
            ),
      );
      isFile.set(path, known);
    }
    return known;
  };
  for (let index = 0; index < estate.prose.length; index++) {
    const chunk = estate.prose[index];
    if (!chunk) continue;
    const source = files.get(chunk.file);
    for (const line of chunkLines(chunk, source)) {
      // A standing file's line `@path` imports that file into the standing instructions.
      const imported = source?.kind === 'standing' ? /^@([^\s]+)\s*$/.exec(line.text.trim())?.[1] : undefined;
      const names = imported ? [imported] : namedPaths(line.text);
      for (const name of names) {
        if (!/\.(md|markdown|txt)$/i.test(name) || /^(?:\/|~\/|[a-z]+:)/i.test(name)) continue;
        if (!imported && !positiveMention(line.text, name, ['read', 'open', 'load'])) continue;
        // An unindexed root guide is a candidate only after the naming file's own subtree.
        const local = posix.normalize(posix.join(posix.dirname(chunk.file), name));
        const localPlaceholder =
          local !== name &&
          !files.has(local) &&
          !skipped.has(local) &&
          local !== '..' &&
          !local.startsWith('../') &&
          !local.startsWith('/') &&
          (await fileAt(local));
        if (localPlaceholder) files.set(local, { path: local, text: '', kind: 'other' });
        const placeholder = !name.includes('/') && !files.has(name);
        if (placeholder) files.set(name, { path: name, text: '', kind: 'other' });
        const target = locateNamed(name, chunk.file, files, {
          byName,
          skipped,
          ...(estate.bases ? { bases: estate.bases } : {}),
          ...(estate.aliases ? { aliases: estate.aliases } : {}),
          ...(!imported && estate.externals ? { externals: estate.externals } : {}),
        });
        if (placeholder) files.delete(name);
        if (localPlaceholder) files.delete(local);
        const path = posix.normalize(target.path);
        if (
          target.candidates ||
          target.via === 'external' ||
          path === '..' ||
          path.startsWith('../') ||
          path.startsWith('/')
        )
          continue;
        let candidate = files.get(path);
        if (!candidate) {
          if (tried.has(path)) continue;
          tried.add(path);
          const rule = ignored.rules.find((rule) => rule.test(path));
          if (rule || skipped.has(path)) {
            if (rule && !skipped.has(path)) {
              ignored.counts.set(rule.pattern, (ignored.counts.get(rule.pattern) ?? 0) + 1);
              ignored.paths.push(path);
              skipped.add(path);
            }
            continue;
          }
          const safe = await localPath(root, path, estate.notes);
          if (safe === undefined) {
            if (!estate.externals?.includes(path)) estate.externals?.push(path);
            continue;
          }
          const info = await stat(safe).catch(() => undefined);
          if (!info?.isFile()) continue;
          if (info.size > MAX_FILE_BYTES) {
            estate.notes.push({ file: path, message: 'skipped: larger than 1 MB' });
            continue;
          }
          const text = (await readFile(safe, 'utf8')).replace(/^\uFEFF/, '');
          candidate = { path, text, kind: 'other' };
          estate.files.push(candidate);
          files.set(path, candidate);
          // The name gets a new list: a list of names is never changed in place once built.
          byName.set(basename(path), [...(byName.get(basename(path)) ?? []), path]);
        }
        // An imported file is standing; a file code reads as structure (a registry, settings, a step list,
        // a guard, an alias table) is not sent again as prose.
        if (imported) candidate.kind = 'standing';
        else if (STRUCTURED_KINDS.has(candidate.kind) || definesAliases(candidate)) continue;
        if (proseFiles.has(path)) continue;
        const real = await realpath(join(root, path)).catch(() => undefined);
        // Two spellings of one file (a link, a relative path) may form a cycle; canonical identity bounds it.
        if (real && expanded.has(real)) continue;
        if (real) expanded.add(real);
        proseFiles.add(path);
        if (candidate.text.trim() === '') {
          estate.notes.push({ file: path, message: 'empty file: nothing to read' });
          continue;
        }
        const first = /\.(md|markdown)$/i.test(path) ? readFrontmatter(candidate.text).bodyLine : 1;
        addProse(estate, candidate, first, lastLine(candidate.text), budget);
      }
    }
  }
  for (const pattern of estate.ignored?.patterns ?? [])
    pattern.files = ignored.counts.get(pattern.pattern) ?? 0;
}

/** Discover only nested standing instructions; ignore whole excluded trees and stop directory cycles. */
async function nestedStanding(
  root: string,
  folder: string,
  notes: ReadNote[],
  ignored: Ignored,
  ancestors: Set<string> = new Set(),
  canonical?: string,
  found: string[] = [],
): Promise<string[]> {
  const real = canonical ?? (await realpath(join(root, folder)).catch(() => undefined));
  if (!real) return [];
  if (ancestors.has(real)) {
    notes.push({ file: folder, message: 'skipped: a link back to a folder the walk is already inside' });
    return [];
  }
  ancestors.add(real);
  try {
    const entries = await readdir(join(root, folder), { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const path = posix.join(folder, entry.name);
      // The regular layout walk already owns this tree and the root standing files.
      if (folder === '' && (entry.name === '.claude' || STANDING.has(path))) continue;
      if (ignored.rules.some((rule) => rule.test(path))) continue;
      // Beside the layout, a link that leaves the estate is not followed: no standing file names it.
      if (entry.isSymbolicLink() && (await localPath(root, path, notes)) === undefined) continue;
      const linked = entry.isSymbolicLink() ? await stat(join(root, path)).catch(() => undefined) : undefined;
      if (entry.isDirectory() || linked?.isDirectory()) {
        await nestedStanding(
          root,
          path,
          notes,
          ignored,
          ancestors,
          entry.isSymbolicLink() ? undefined : join(real, entry.name),
          found,
        );
      } else if (/^CLAUDE(?:\.local)?\.md$/.test(entry.name) && (entry.isFile() || linked?.isFile())) {
        const info = linked ?? (await stat(join(root, path)));
        if (info.size > MAX_FILE_BYTES) notes.push({ file: path, message: 'skipped: larger than 1 MB' });
        else found.push(path);
      }
    }
    return found;
  } finally {
    ancestors.delete(real);
  }
}

async function present(root: string, names: readonly string[], notes: ReadNote[]): Promise<string[]> {
  const found: string[] = [];
  for (const name of names) {
    const info = await stat(join(root, name)).catch(() => undefined);
    if (info?.isFile()) {
      found.push(name);
      await noteFollowed(root, name, notes);
    }
  }
  return found;
}

/**
 * The estate configuration file, when it has one: `ignore:`, a list of globs; `aliases:`, a map from an
 * alias (`REF`) to the folder or folders it stands for, relative to the root; and `externals:`, the folders
 * outside the estate a path may name (they replace the defaults, `docs/` and `_meta/`).
 */
async function readConfig(root: string, notes: ReadNote[]): Promise<EstateConfig> {
  const config: EstateConfig = { ignore: [], aliases: {} };
  let text: string | undefined;
  let place = ESTATE_CONFIG;
  for (const candidate of [ESTATE_CONFIG, `.claude/${ESTATE_CONFIG}`]) {
    text = await readFile(join(root, candidate), 'utf8').catch(() => undefined);
    place = candidate;
    if (text !== undefined) break;
  }
  if (text === undefined) return config;
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (cause) {
    const message = cause instanceof Error ? (cause.message.split('\n')[0] ?? '') : String(cause);
    notes.push({ file: place, message: `not YAML: ${message}` });
    return config;
  }
  if (!isRecord(parsed)) return config;
  const list = parsed.ignore;
  if (list !== undefined) {
    if (Array.isArray(list) && list.every((item) => typeof item === 'string' && item.trim() !== '')) {
      config.ignore = list.map((item: string) => item.trim());
    } else notes.push({ file: ESTATE_CONFIG, message: 'ignore: must be a list of globs' });
  }
  const externals = parsed.externals;
  if (externals !== undefined) {
    if (
      Array.isArray(externals) &&
      externals.every((item) => typeof item === 'string' && item.trim() !== '')
    ) {
      config.externals = externals.map((item: string) => `${cleanFolder(item)}/`);
    } else notes.push({ file: ESTATE_CONFIG, message: 'externals: must be a list of folders' });
  }
  const userSkills = parsed.userSkills;
  if (userSkills !== undefined) {
    if (typeof userSkills === 'string' && userSkills.trim() !== '') config.userSkills = userSkills.trim();
    else notes.push({ file: ESTATE_CONFIG, message: 'userSkills: must be a folder' });
  }
  const aliases = parsed.aliases;
  if (aliases !== undefined) {
    const entries = isRecord(aliases) ? Object.entries(aliases) : [];
    const read = entries.map(([alias, target]) => [alias, typeof target === 'string' ? [target] : target]);
    if (
      entries.length > 0 &&
      read.every(
        ([, targets]) =>
          Array.isArray(targets) && targets.length > 0 && targets.every((item) => typeof item === 'string'),
      )
    ) {
      for (const [alias, targets] of read)
        config.aliases[alias as string] = (targets as string[]).map(cleanFolder);
    } else
      notes.push({
        file: ESTATE_CONFIG,
        message: 'aliases: must map each alias to a folder or a list of folders',
      });
  }
  return config;
}

/**
 * Where the user-level skill layer is read from: the option, else the configuration, else nowhere. A home folder
 * is never read implicitly, so a scan gives the same map on every machine.
 */
function userFolderOf(option: string | undefined, config: EstateConfig, root: string): string | undefined {
  const chosen = option ?? config.userSkills;
  if (chosen === undefined) return undefined;
  const home = chosen === '~' || chosen.startsWith('~/') ? join(homedir(), chosen.slice(1)) : chosen;
  // A folder the command line names is relative to where it was typed; one the configuration names, to the estate.
  return resolve(option !== undefined ? process.cwd() : root, home);
}

/** A name a folder listing skips: hidden (a repository, an archive) or a dependency folder. */
const hiddenInLayer = (name: string) => name.startsWith('.') || name === 'node_modules';
/** The folder a desktop keeps what a user threw away. It is never a container of skills, whatever its case. */
const trashFolder = (name: string) => name.toLowerCase() === 'trash';

/**
 * The files of the user-level skill layer. A folder of the layer that holds a `SKILL.md` is a skill; one that
 * holds none is a container, and the folders one level inside it are looked at the same way. The project layer
 * wins: a user skill whose real folder is a project skill's (a link into the project) is the same skill and is
 * not read twice, and one with the name of a project skill is left out with a note. Within the layer the first
 * folder, by name, keeps a name. The layer is read as it lies: links to folders elsewhere are followed.
 */
async function readUserLayer(
  folder: string,
  project: readonly EstateFile[],
  root: string,
  ignored: Ignored,
): Promise<{ files: EstateFile[]; read: string[]; shadowed: string[]; notes: ReadNote[] }> {
  const out = {
    files: [] as EstateFile[],
    read: [] as string[],
    shadowed: [] as string[],
    notes: [] as ReadNote[],
  };
  const byName = (a: { name: string }, b: { name: string }) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  const listing = await readdir(folder, { withFileTypes: true }).catch(() => undefined);
  if (!listing) {
    out.notes.push({ file: USER_LAYER, message: 'not found: the user skill folder cannot be read' });
    return out;
  }
  const isFolder = async (path: string) => (await stat(path).catch(() => undefined))?.isDirectory() === true;
  const isSkill = async (path: string) =>
    (await stat(join(path, 'SKILL.md')).catch(() => undefined))?.isFile() === true;
  const skills: string[] = [];
  for (const entry of [...listing].sort(byName)) {
    if (hiddenInLayer(entry.name) || !(await isFolder(join(folder, entry.name)))) continue;
    if (await isSkill(join(folder, entry.name))) {
      skills.push(entry.name);
      continue;
    }
    if (trashFolder(entry.name)) continue;
    const inside = await readdir(join(folder, entry.name), { withFileTypes: true }).catch(() => []);
    for (const child of [...inside].sort(byName)) {
      const path = join(folder, entry.name, child.name);
      if (!hiddenInLayer(child.name) && (await isFolder(path)) && (await isSkill(path)))
        skills.push(`${entry.name}/${child.name}`);
    }
  }

  const names = new Set<string>();
  const taken = new Set<string>();
  for (const file of project) {
    if (file.kind !== 'skill') continue;
    const declared = readFrontmatter(file.text).fields.name;
    names.add(typeof declared === 'string' ? declared : (file.owner ?? basename(posix.dirname(file.path))));
    const real = await realpath(join(root, posix.dirname(file.path))).catch(() => undefined);
    if (real !== undefined) taken.add(real);
  }
  const own: Ignored = { rules: ignored.rules, counts: new Map(), paths: [] };
  const walkNotes: ReadNote[] = [];
  for (const rel of skills) {
    const real = await realpath(join(folder, rel)).catch(() => undefined);
    if (real === undefined || taken.has(real)) continue;
    taken.add(real);
    const text = (await readFile(join(folder, rel, 'SKILL.md'), 'utf8').catch(() => '')).replace(
      /^\uFEFF/,
      '',
    );
    const declared = readFrontmatter(text).fields.name;
    const name = typeof declared === 'string' ? declared : basename(rel);
    const place = `${USER_LAYER}/${rel}`;
    if (names.has(name)) {
      out.shadowed.push(name);
      out.notes.push({
        file: `${place}/SKILL.md`,
        message: `skill ${name} is shadowed by a skill of the same name that comes first; not read`,
      });
      continue;
    }
    names.add(name);
    out.read.push(name);
    const paths = await walk(folder, rel, walkNotes, own);
    const loaded = await readBatch(paths, async (path) => ({
      path,
      text: (await readFile(join(folder, path), 'utf8')).replace(/^\uFEFF/, ''),
    }));
    for (const { path, text: body } of loaded) {
      const file: EstateFile = { path: `${USER_LAYER}/${path}`, text: body, kind: 'other', layer: 'user' };
      if (body.trim() === '') out.notes.push({ file: file.path, message: 'empty file: nothing to read' });
      else {
        file.kind = path === `${rel}/SKILL.md` ? 'skill' : 'skill_file';
        file.owner = name;
      }
      out.files.push(file);
    }
  }
  for (const note of walkNotes)
    if (note.message !== FOLLOWED_NOTE) out.notes.push({ ...note, file: `${USER_LAYER}/${note.file}` });
  return out;
}

/** A folder written in a table or the config, relative to the root, without `./` or a trailing slash. */
function cleanFolder(folder: string): string {
  return posix.normalize(folder.trim().replace(/^`|`$/g, '').replace(/^\.\//, '')).replace(/\/+$/, '');
}

/**
 * Alias tables: a markdown file of the estate whose name holds "alias", with a table of an alias column
 * (`Alias`, `Prefix`) and a folder column (`Path`, `Folder`, `Target`). `REF/a/b.md` then reads as
 * `<folder>/a/b.md`.
 */
/**
 * Aliases a markdown file defines in its own prose: `` `REF` = `.claude/skills/x/references` ``. The name is
 * capitals; the target is a folder (no file extension). A name two files define differently keeps both
 * folders, tried in order.
 */
function inlineAliases(files: readonly EstateFile[]): Record<string, string[]> {
  const aliases: Record<string, string[]> = {};
  for (const file of files) {
    if (!/\.(md|markdown)$/i.test(file.path)) continue;
    const visible = chunkLines(
      {
        id: file.path,
        file: file.path,
        text: file.text,
        startLine: 1,
        endLine: file.text.split('\n').length,
      },
      file,
    )
      .map((line) => line.text)
      .join('\n');
    for (const match of visible.matchAll(/`([A-Z][A-Z0-9_]{1,15})`\s*=\s*`([^`\s]+)`/g)) {
      const [, name, target] = match;
      if (!name || !target || /\.[A-Za-z0-9]+$/.test(target) || /[<>*?{}$]/.test(target)) continue;
      const folder = cleanFolder(target);
      if (!(aliases[name] ?? []).includes(folder)) aliases[name] = [...(aliases[name] ?? []), folder];
    }
  }
  return aliases;
}

const STRUCTURED_KINDS = new Set<string>(['registry', 'settings', 'step_list', 'guard_script']);

/** A markdown file whose name holds "alias" and that holds an alias table. */
function definesAliases(file: EstateFile): boolean {
  if (!/alias/i.test(basename(file.path)) || !/\.(md|markdown)$/i.test(file.path)) return false;
  return readTables(file.text).some(
    (table) =>
      table.header.some((cell) => /^(alias|prefix)(es)?$/i.test(strip(cell))) &&
      table.header.some((cell) => /^(path|folder|target|resolves to)s?$/i.test(strip(cell))),
  );
}

function aliasTables(files: readonly EstateFile[], notes: ReadNote[]): Record<string, string[]> {
  const aliases: Record<string, string[]> = {};
  for (const file of files) {
    if (!/alias/i.test(basename(file.path)) || !/\.(md|markdown)$/i.test(file.path)) continue;
    for (const table of readTables(file.text)) {
      const alias = table.header.findIndex((cell) => /^(alias|prefix)(es)?$/i.test(strip(cell)));
      const folder = table.header.findIndex((cell) =>
        /^(path|folder|target|resolves to)s?$/i.test(strip(cell)),
      );
      if (alias < 0 || folder < 0) continue;
      for (const row of table.rows) {
        const name = strip(row.cells[alias] ?? '').replace(/\/+$/, '');
        const target = strip(row.cells[folder] ?? '');
        if (name === '' || target === '') {
          notes.push({ file: file.path, message: `alias row at line ${row.line} has no alias or no folder` });
          continue;
        }
        aliases[name] = [...(aliases[name] ?? []), cleanFolder(target)];
      }
    }
  }
  return aliases;
}

/**
 * Every file under a folder, sorted by name. A symbolic link is followed to what it points at, a file or a
 * folder, and read under the link's own path (the path the runtime loads it by). A link back to a folder
 * the walk is already inside is a cycle: it is skipped with a note, as is a link that points at nothing.
 * A path the ignore list matches is not read: its files are counted under the first glob that matched.
 */
async function walk(
  root: string,
  folder: string,
  notes: ReadNote[],
  ignored: Ignored,
  ancestors: Set<string> = new Set(),
  ignoredBy?: string,
  large?: string[],
  canonical?: string,
  found: string[] = [],
): Promise<string[]> {
  const real = canonical ?? (await realpath(join(root, folder)).catch(() => undefined));
  if (real === undefined) return [];
  if (ancestors.has(real)) {
    if (ignoredBy === undefined) {
      notes.push({ file: folder, message: 'skipped: a link back to a folder the walk is already inside' });
    }
    return [];
  }
  ancestors.add(real);
  try {
    const entries = await readdir(join(root, folder), { withFileTypes: true }).catch(() => []);
    const ordered = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    // Dirents already identify ordinary directories. Follow a link once; its stat also gives the size.
    const inspected = await readBatch(ordered, async (entry) => {
      const path = posix.join(folder, entry.name);
      const by = ignoredBy ?? ignored.rules.find((rule) => rule.test(path))?.pattern;
      const info = entry.isSymbolicLink()
        ? await stat(join(root, path)).catch(() => undefined)
        : entry.isFile() && by === undefined
          ? await stat(join(root, path))
          : undefined;
      return { entry, path, by, info };
    });
    for (const { entry, path, by, info } of inspected) {
      if (entry.isSymbolicLink() && !info) {
        if (by === undefined) notes.push({ file: path, message: 'skipped: a link that points at nothing' });
        continue;
      }
      const folderEntry = entry.isDirectory() || info?.isDirectory();
      const fileEntry = entry.isFile() || info?.isFile();
      if (folderEntry) {
        if (entry.isSymbolicLink() && by === undefined) await noteFollowed(root, path, notes);
        await walk(
          root,
          path,
          notes,
          ignored,
          ancestors,
          by,
          large,
          entry.isSymbolicLink() ? undefined : join(real, entry.name),
          found,
        );
      } else if (fileEntry && by !== undefined) {
        ignored.counts.set(by, (ignored.counts.get(by) ?? 0) + 1);
        ignored.paths.push(path);
      } else if (fileEntry && info) {
        if (info.size > MAX_FILE_BYTES) {
          notes.push({ file: path, message: 'skipped: larger than 1 MB' });
          large?.push(path);
        } else {
          found.push(path);
          if (entry.isSymbolicLink()) await noteFollowed(root, path, notes);
        }
      }
    }
    return found;
  } finally {
    ancestors.delete(real);
  }
}

function classify(path: string, text: string): { kind: FileKind; owner?: string } {
  if (STANDING.has(path) || /(?:^|\/)(?:CLAUDE|CLAUDE\.local)\.md$/.test(path)) return { kind: 'standing' };
  if (SETTINGS.has(path)) return { kind: 'settings' };
  const parts = path.split('/');
  if (parts[1] === 'memory' && path.endsWith('.md')) return { kind: 'memory' };
  if (parts[1] === 'skills' && parts.length >= 4) {
    const owner = parts[2] ?? '';
    return parts.length === 4 && parts[3] === 'SKILL.md'
      ? { kind: 'skill', owner }
      : { kind: 'skill_file', owner };
  }
  if (parts[1] === 'agents' && parts.length >= 3 && path.endsWith('.md')) return { kind: 'subagent' };
  if (/registry|catalogu?e?/i.test(basename(path)) && /\.(md|json|ya?ml)$/.test(path))
    return { kind: 'registry' };
  if (/\.(jsonc?|ya?ml)$/.test(path) && isStepList(text, path)) return { kind: 'step_list' };
  if (path.endsWith('.json') && catalogueEntries(text) !== undefined) return { kind: 'registry' };
  if (/\.(jsonc?|ya?ml)$/.test(path) && structuredRegistry(text, path)) return { kind: 'registry' };
  return { kind: 'other' };
}

/** The keys a catalogue entry is known by. An entry holds at least two of them. */
const CATALOGUE_KEYS = ['kind', 'event', 'watches', 'work', 'step', 'status'] as const;
/** Enforcement states under which a catalogue check enforces nothing. */
const OFF_STATES = /^(off|disabled|retired|removed|dead)$/i;

type CatalogueEntry = { key?: string; entry: Record<string, unknown> };

/**
 * The entries of a catalogue: a JSON array of entries, an object holding such an array under any key, or
 * an object mapping ids to entries. Undefined when the text is not a catalogue: fewer than half of its
 * entries hold two of the catalogue keys.
 */
function catalogueEntries(text: string): CatalogueEntry[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const fromList = (list: unknown[]): CatalogueEntry[] => list.filter(isRecord).map((entry) => ({ entry }));
  let entries: CatalogueEntry[] = [];
  if (Array.isArray(parsed)) entries = fromList(parsed);
  else if (isRecord(parsed)) {
    const list = Object.values(parsed).find(
      (value): value is unknown[] => Array.isArray(value) && value.some(isCatalogueEntry),
    );
    entries = list
      ? fromList(list)
      : Object.entries(parsed).flatMap(([key, entry]) => (isRecord(entry) ? [{ key, entry }] : []));
  }
  const fitting = entries.filter((candidate) => isCatalogueEntry(candidate.entry)).length;
  return fitting > 0 && fitting * 2 >= entries.length ? entries : undefined;
}

function isCatalogueEntry(value: unknown): boolean {
  return isRecord(value) && CATALOGUE_KEYS.filter((key) => key in value).length >= 2;
}

/** JSON comments and trailing commas are whitespace; strings and source positions stay intact. */
function jsonSource(text: string): string {
  const chars = text.split('');
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < chars.length; index++) {
    const char = chars[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char !== '/' || !['/', '*'].includes(chars[index + 1] ?? '')) continue;
    const block = chars[index + 1] === '*';
    chars[index] = chars[index + 1] = ' ';
    index += 2;
    let closed = !block;
    for (; index < chars.length; index++) {
      if (block && chars[index] === '*' && chars[index + 1] === '/') {
        chars[index] = chars[index + 1] = ' ';
        index++;
        closed = true;
        break;
      }
      if (!block && (chars[index] === '\n' || chars[index] === '\r')) break;
      if (chars[index] !== '\n' && chars[index] !== '\r') chars[index] = ' ';
    }
    if (!closed) throw new SyntaxError('Unterminated JSON block comment');
  }
  quoted = false;
  escaped = false;
  for (let index = 0; index < chars.length; index++) {
    const char = chars[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char !== ',') continue;
    let next = index + 1;
    while (/\s/.test(chars[next] ?? '') && next < chars.length) next++;
    if (chars[next] === ']' || chars[next] === '}') chars[index] = ' ';
  }
  return chars.join('');
}

const JSON_SOURCE_CACHE = new WeakMap<EstateFile, { text: string; masked: string }>();

/** All declaration lookups in one JSON file share a single offset-preserving lexical pass. */
function searchableText(file: EstateFile): string {
  if (!/\.jsonc?$/.test(file.path)) return file.text;
  const cached = JSON_SOURCE_CACHE.get(file);
  if (cached?.text === file.text) return cached.masked;
  const masked = jsonSource(file.text);
  JSON_SOURCE_CACHE.set(file, { text: file.text, masked });
  return masked;
}

/** YAML uses its parser; JSON permits comments and trailing commas without changing string values. */
function parseData(text: string, path: string): unknown {
  return /\.ya?ml$/.test(path) ? parseYaml(text) : JSON.parse(jsonSource(text));
}

/** Where a key holding a value is written, in JSON or YAML: `"id": "G1"` or `id: G1`. */
function keyValue(key: string, value: string): RegExp {
  return new RegExp(`["']?${escapeRegex(key)}["']?\\s*:\\s*["']?${escapeRegex(value)}["']?(?![\\w-])`);
}

type StepCollection = readonly unknown[] | Record<string, unknown>;

/** Schema descriptions declare possible fields rather than actual stage entries. */
function stepSchema(value: Record<string, unknown>): boolean {
  return (
    typeof value.$schema === 'string' ||
    typeof value.$ref === 'string' ||
    (value.type === 'array' && 'items' in value) ||
    (value.type === 'object' && ('properties' in value || 'additionalProperties' in value))
  );
}

/** A map key in JSON or YAML: bare YAML keys and both quoting styles retain their source line. */
function stepMapKey(key: string): RegExp {
  const quoted = [JSON.stringify(key), `'${key.replace(/'/g, "''")}'`];
  const forms = [...quoted, key].map(escapeRegex).join('|');
  return new RegExp(`(?<=^|[\\n\\r{,])[\\t ]*(?:-[\\t ]+)?(?:${forms})\\s*:`);
}

/** Named stages require a nonempty identifier; keyed stages additionally require an object value. */
function stepEntries(steps: StepCollection): Array<{ step: unknown; mapKey?: string }> {
  const entries = Array.isArray(steps)
    ? steps.map((step) => ({ step, mapKey: undefined }))
    : Object.entries(steps).map(([mapKey, step]) => ({ mapKey, step }));
  return entries.filter(({ step, mapKey }) => {
    if (mapKey === undefined && typeof step === 'string') return step !== '';
    if (!isRecord(step)) return false;
    const id = 'id' in step ? step.id : 'name' in step ? step.name : mapKey;
    return typeof id === 'string' && id !== '';
  });
}

/** Step containers share one traversal for classification and reading, preserving declaration order. */
function stepLists(value: unknown, process?: string): Array<{ steps: StepCollection; process?: string }> {
  if (!isRecord(value)) return [];
  const found: Array<{ steps: StepCollection; process?: string }> = [];
  for (const [key, child] of Object.entries(value)) {
    if (key === 'steps' && (Array.isArray(child) || isRecord(child))) {
      if (
        !(isRecord(child) && stepSchema(child)) &&
        (Object.keys(child).length === 0 || stepEntries(child).length > 0)
      )
        found.push({ steps: child, ...(process === undefined ? {} : { process }) });
    } else if (key === 'processes') {
      if (Array.isArray(child)) {
        for (const entry of child) {
          if (!isRecord(entry)) continue;
          const name = typeof entry.name === 'string' ? entry.name : entry.id;
          if (typeof name === 'string' && name !== '') found.push(...stepLists(entry, name));
        }
      } else if (isRecord(child)) {
        for (const [name, entry] of Object.entries(child)) found.push(...stepLists(entry, name));
      }
    } else if (isRecord(child)) found.push(...stepLists(child, process));
  }
  return found;
}

function isStepList(text: string, path = '.json'): boolean {
  try {
    return stepLists(parseData(text, path)).length > 0;
  } catch {
    return false;
  }
}

/** The passage at a character offset: its line, and the quote as given. */
function at(file: EstateFile, offset: number, quote: string): Located {
  const startLine = lineAt(file.text, offset);
  return { file: file.path, startLine, endLine: lineAt(file.text, offset + quote.length - 1), quote };
}

/** Finds a needle from a cursor and moves the cursor past it. */
function seek(file: EstateFile, needle: string, cursor: { at: number }): Located | undefined {
  const searchable = searchableText(file);
  const offset = searchable.indexOf(needle, cursor.at);
  if (offset < 0) return undefined;
  cursor.at = offset + needle.length;
  return at(file, offset, needle);
}

function seekPattern(file: EstateFile, pattern: RegExp, cursor: { at: number }): Located | undefined {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const search = new RegExp(pattern.source, flags);
  search.lastIndex = cursor.at;
  const searchable = searchableText(file);
  const match = search.exec(searchable);
  if (!match) return undefined;
  cursor.at = match.index + match[0].length;
  return at(file, match.index, match[0]);
}

function readSettings(file: EstateFile, estate: RawEstate): void {
  let json: unknown;
  try {
    json = JSON.parse(file.text);
  } catch (cause) {
    estate.notes.push({ file: file.path, message: `not JSON: ${String(cause)}` });
    return;
  }
  if (!isRecord(json)) return;

  for (const [key, value] of Object.entries(json)) {
    if (['hooks', 'permissions', 'env'].includes(key)) continue;
    if (!['string', 'number', 'boolean'].includes(typeof value)) continue;
    const found = seekPattern(
      file,
      new RegExp(`"${escapeRegex(key)}"\\s*:\\s*${escapeRegex(JSON.stringify(value))}`),
      {
        at: 0,
      },
    );
    if (found) estate.settings.push({ key, value: String(value), at: found });
  }

  const permissions = isRecord(json.permissions) ? json.permissions : {};
  if (typeof permissions.defaultMode === 'string') {
    const found = seekPattern(
      file,
      new RegExp(`"defaultMode"\\s*:\\s*${escapeRegex(JSON.stringify(permissions.defaultMode))}`),
      { at: 0 },
    );
    if (found)
      estate.settings.push({ key: 'permissions.defaultMode', value: permissions.defaultMode, at: found });
  }
  for (const effect of ['allow', 'deny', 'ask'] as const) {
    const rules = permissions[effect];
    if (!Array.isArray(rules)) continue;
    const cursor = { at: file.text.search(new RegExp(`"${effect}"\\s*:`)) };
    if (cursor.at < 0) continue;
    for (const rule of rules) {
      if (typeof rule !== 'string') continue;
      const found = seek(file, JSON.stringify(rule), cursor);
      if (!found) continue;
      const match = /^([^(]+)(?:\((.*)\))?$/.exec(rule);
      const permission: PermissionDecl = { effect, rule, tool: (match?.[1] ?? rule).trim(), at: found };
      if (match?.[2] !== undefined) permission.pattern = match[2];
      estate.permissions.push(permission);
    }
  }

  if (isRecord(json.env)) {
    const cursor = { at: file.text.search(/"env"\s*:/) };
    for (const key of Object.keys(json.env)) {
      // The key only: an environment value may be a secret and never enters the map.
      const found = cursor.at >= 0 ? seek(file, JSON.stringify(key), cursor) : undefined;
      if (found) estate.settings.push({ key: `env.${key}`, at: found } satisfies SettingDecl);
    }
  }

  if (isRecord(json.hooks)) {
    const cursor = { at: file.text.search(/"hooks"\s*:/) };
    readGuards(json.hooks, 'estate', (command) => seek(file, JSON.stringify(command), cursor), estate, file);
  }
}

/** Reads a hooks mapping (event to matcher groups to commands), from the settings or a skill's frontmatter. */
function readGuards(
  hooks: Record<string, unknown>,
  scope: string,
  locate: (command: string) => Located | undefined,
  estate: RawEstate,
  file: EstateFile,
): void {
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) {
      estate.notes.push({ file: file.path, message: `${event} hooks must be a list of matcher groups` });
      continue;
    }
    for (const group of groups) {
      if (!isRecord(group) || !Array.isArray(group.hooks)) {
        estate.notes.push({ file: file.path, message: `${event} hook group must contain a hooks list` });
        continue;
      }
      const matcher = typeof group.matcher === 'string' && group.matcher !== '' ? group.matcher : undefined;
      for (const hook of group.hooks) {
        if (!isRecord(hook)) continue;
        const command =
          hook.type === 'command' ? hook.command : hook.type === 'prompt' ? hook.prompt : undefined;
        if (typeof command !== 'string') continue;
        const found = locate(command);
        if (!found) {
          estate.notes.push({
            file: file.path,
            message: `cannot find the command of a ${event} guard in the file`,
          });
          continue;
        }
        const guard: GuardDecl = {
          event,
          command,
          scope,
          at: found,
          ...(hook.type === 'command'
            ? scriptOf(
                command,
                new Set(estate.files.map((entry) => entry.path)),
                new Map(estate.files.map((entry) => [entry.path, entry.text])),
              )
            : { anchored: false }),
        };
        if (matcher !== undefined) guard.matcher = matcher;
        if (typeof hook.timeout === 'number') guard.timeout = hook.timeout;
        estate.guards.push(guard);
      }
    }
  }
}

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const OPERATORS = new Set(['||', '&&', ';', '|', '&']);

/**
 * The script a command runs, relative to the root, and whether the shell finds it from an anchor. The
 * command is cut at `||`, `&&`, `;` and `|`; in each part, environment assignments (`ENV=1`) and an `env`
 * wrapper are passed over and an interpreter (`python3`) runs the path after its flags. A part whose program
 * is not a path (a shell test such as `[ "$X" = 1 ]`, `echo`) runs no script. The first part that runs a
 * path gives the script. With source or documented usage proving dispatch, the argument-derived executed path is resolved
 * from the root, the wrapper's folder and its ancestors; the shell's entry script is kept as dispatcher.
 */
export function scriptOf(
  command: string,
  paths?: ReadonlySet<string>,
  sources?: ReadonlyMap<string, string>,
): { script?: string; anchored: boolean; dispatcher?: string } {
  return scriptFrom(command, paths, '', false, sources);
}

/** Carry a proven working directory into a command, including a shell's quoted command string. */
function scriptFrom(
  command: string,
  paths: ReadonlySet<string> | undefined,
  directory: string,
  anchoredDirectory: boolean,
  sources?: ReadonlyMap<string, string>,
): { script?: string; anchored: boolean; dispatcher?: string } {
  for (const { words: segment, after } of segments(command)) {
    const words = segment.map((word) => word.replace(/["']/g, ''));
    if (words[0] === 'cd') {
      const target = words[1] === '--' ? words[2] : words[1];
      if (target !== undefined && after === '&&') {
        const changed = anchorOf(`${target.replace(/\/$/, '')}/`);
        directory = changed.anchored ? changed.script : posix.join(directory, changed.script);
        anchoredDirectory = changed.anchored || anchoredDirectory;
      } else {
        directory = '';
        anchoredDirectory = false;
      }
      continue;
    }
    let head = 0;
    while (ENV_ASSIGNMENT.test(words[head] ?? '')) head++;
    if (words[head] === 'env') {
      head++;
      while (ENV_ASSIGNMENT.test(words[head] ?? '') || words[head]?.startsWith('-')) head++;
    }
    if (['sh', 'bash', 'zsh', 'dash', 'ksh'].includes(basename(words[head] ?? ''))) {
      const flag = words[head + 1];
      if (flag !== undefined && /^-[a-z]*c[a-z]*$/.test(flag)) {
        const quoted = segment[head + 2];
        if (quoted !== undefined) {
          const payload = /^(["']).*\1$/.test(quoted) ? quoted.slice(1, -1) : quoted;
          const nested = scriptFrom(payload, paths, directory, anchoredDirectory, sources);
          if (nested.script !== undefined) return nested;
          continue;
        }
      }
    }
    const runs = runPath(segment);
    if (runs === undefined) continue;
    const relative = anchorOf(runs);
    const first = relative.anchored
      ? relative
      : { script: posix.normalize(posix.join(directory, relative.script)), anchored: anchoredDirectory };
    if (!paths) return first;
    const target = paths.has(first.script)
      ? dispatchedName(segment, runs, dispatcherSource(first.script, sources))
      : undefined;
    // With source available, an argument is a file only when its data flows to an execution path.
    if (target === undefined) return first;
    const last = scriptIn(`${JSON.stringify(runs)} ${JSON.stringify(target)}`, directory, paths, true);
    if (last === undefined || last === first.script) {
      // A dispatcher whose target name matches no file still names that target: the guard runs nothing.
      return target === undefined
        ? first
        : { script: anchorOf(target).script, anchored: first.anchored, dispatcher: first.script };
    }
    return {
      script: last,
      anchored: first.anchored,
      ...(paths.has(first.script) ? { dispatcher: first.script } : {}),
    };
  }
  return { anchored: false };
}

/** Source plus usage paragraphs that explicitly name this script. Unrelated documentation is ignored. */
function dispatcherSource(script: string, sources?: ReadonlyMap<string, string>): string | undefined {
  const own = sources?.get(script);
  if (own === undefined) return undefined;
  const usage: string[] = [own];
  for (const [path, text] of sources ?? []) {
    if (!/\.(?:md|markdown|txt)$/.test(path)) continue;
    for (const paragraph of text.split(/\n\s*\n/)) {
      if (/\busage\s*:/i.test(paragraph) && paragraph.includes(script)) usage.push(paragraph);
    }
  }
  return usage.join('\n');
}

/** The command arguments name files only when source or usage proves their execution role. */
function dispatchedName(segment: readonly string[], runs: string, source?: string): string | undefined {
  if (source === undefined) return undefined;
  const words = segment.map((token) => token.replace(/["']/g, ''));
  const index = words.indexOf(runs);
  return index < 0 ? undefined : dispatchedScript(source, words.slice(index + 1));
}

/** A command line cut into parts, retaining the operator that follows each part. */
function segments(command: string): Array<{ words: string[]; after?: string }> {
  const parts: Array<{ words: string[]; after?: string }> = [];
  let words: string[] = [];
  for (const token of tokens(command)) {
    if (OPERATORS.has(token)) {
      parts.push({ words, after: token });
      words = [];
    } else words.push(token);
  }
  parts.push({ words });
  return parts.filter((part) => part.words.length > 0);
}

/** The path a part of a command runs, as written: after assignments, `env` and an interpreter's flags. */
function runPath(segment: readonly string[]): string | undefined {
  const words = segment.map((token) => token.replace(/["']/g, ''));
  let index = 0;
  const skip = (test: (word: string) => boolean) => {
    while (index < words.length && test(words[index] ?? '')) index++;
  };
  skip((word) => ENV_ASSIGNMENT.test(word));
  if (words[index] === 'env') {
    index++;
    skip((word) => ENV_ASSIGNMENT.test(word) || word.startsWith('-'));
  }
  // Wrappers that run the next command: exec, nice, nohup, time, timeout with its limit, uv run.
  for (;;) {
    const word = words[index] ?? '';
    if (['exec', 'nice', 'nohup', 'time'].includes(word)) {
      index++;
      skip((next) => next.startsWith('-'));
    } else if (word === 'timeout') {
      index++;
      skip((next) => next.startsWith('-'));
      if (/^\d+(\.\d+)?[smhd]?$/.test(words[index] ?? '')) index++;
    } else if (word === 'uv' && words[index + 1] === 'run') {
      index += 2;
      skip((next) => next.startsWith('-'));
    } else break;
  }
  const head = words[index] ?? '';
  if (INTERPRETERS.has(basename(head))) {
    index++;
    skip((word) => word.startsWith('-'));
  }
  const word = words[index] ?? '';
  return word.includes('/') || SCRIPT_EXTENSION.test(word) ? word : undefined;
}

/** A path as the shell finds it: from an anchor (the project folder, the home folder), else the working folder. */
function anchorOf(token: string): { script: string; anchored: boolean } {
  for (const anchor of ANCHORS) {
    if (anchor.test(token)) return { script: posix.normalize(token.replace(anchor, '')), anchored: true };
  }
  if (token.startsWith('/') || token.startsWith('~')) return { script: token, anchored: true };
  return { script: posix.normalize(token), anchored: false };
}

function readSkill(file: EstateFile, estate: RawEstate, budget: number): void {
  const frontmatter = readFrontmatter(file.text);
  noteFrontmatter(file, frontmatter, estate);
  const fields = frontmatter.fields;
  const name = typeof fields.name === 'string' ? fields.name : (file.owner ?? basename(file.path));
  const skill: SkillDecl = {
    name,
    file: file.path,
    folder: posix.dirname(file.path),
    at: nameAt(file, frontmatter, name),
    tools: listAt(file, frontmatter, 'allowed-tools', fields['allowed-tools']),
    fields: withoutHooks(fields),
    body: { startLine: frontmatter.bodyLine, endLine: lastLine(file.text) },
  };
  const description = valueAt(file, frontmatter, 'description', fields.description);
  if (description) skill.description = description;
  estate.skills.push(skill);
  if (isRecord(fields.hooks)) {
    const cursor = { at: 0 };
    readGuards(
      fields.hooks,
      name,
      (command) =>
        seek(file, command, cursor) ??
        seek(file, JSON.stringify(command), cursor) ??
        seekPattern(file, /command\s*:.*/, cursor),
      estate,
      file,
    );
  }
  addProse(estate, file, skill.body.startLine, skill.body.endLine, budget);
}

function readSubagent(file: EstateFile, estate: RawEstate, budget: number): void {
  const frontmatter = readFrontmatter(file.text);
  noteFrontmatter(file, frontmatter, estate);
  const fields = frontmatter.fields;
  const name = typeof fields.name === 'string' ? fields.name : basename(file.path, '.md');
  const subagent: SubagentDecl = {
    name,
    file: file.path,
    at: nameAt(file, frontmatter, name),
    tools: listAt(file, frontmatter, 'tools', fields.tools),
    skills: listAt(file, frontmatter, 'skills', fields.skills),
    fields,
    body: { startLine: frontmatter.bodyLine, endLine: lastLine(file.text) },
  };
  const description = valueAt(file, frontmatter, 'description', fields.description);
  if (description) subagent.description = description;
  const model = valueAt(file, frontmatter, 'model', fields.model);
  if (model) subagent.model = model;
  const effort = valueAt(file, frontmatter, 'effort', fields.effort);
  if (effort) subagent.effort = effort;
  estate.subagents.push(subagent);
  addProse(estate, file, subagent.body.startLine, subagent.body.endLine, budget);
}

/** Header cells that name a registry table's columns. A table is a registry table by its first column. */
const COLUMNS = {
  id: /^(id|check id|code)$/i,
  guard: /^(guards?|scripts?|checks?|hooks?|adapters?|handlers?|runs?)$/i,
  enforces: /^(enforces|enforced rules|rules?|rule ids|gates|covers)$/i,
  watches: /^(fires when|fires on|watches|watch|triggers?)$/i,
  event: /^events?$/i,
  verdict: /^(verdict|mode)$/i,
  state: /^(rollout|status|state|enforcement)$/i,
  description: /^(description|meaning|purpose|summary|what it (?:checks|does)|check description)$/i,
} as const;

/** A row id: one token with a digit in it, such as `G6`, `AW4` or `check-12`. */
const ROW_ID = /^[A-Za-z][\w.#-]*\d[\w.#-]*$/;

/**
 * Reads every table of a markdown check registry whose first column holds ids: a header `Id`, or a first
 * cell that is one token with a digit in every row. The other columns are free text. A row names its guard
 * by (in this order) a guard the estate runs, named in a cell outside the rule columns (the guard column
 * first); a catalogue check with the row's id; a guard script whose source holds the row's id; else the
 * guard column as written; else the id. The rules it enforces come from an `Enforces` column (ids and
 * quoted passages) and from a `Fires when` or `Watches` column (quoted passages and ids).
 */
/** A frontmatter the reader could not read, or read only with the tolerant pass, leaves a note. */
function noteFrontmatter(
  file: EstateFile,
  frontmatter: ReturnType<typeof readFrontmatter>,
  estate: RawEstate,
): void {
  if (frontmatter.error) estate.notes.push({ file: file.path, message: `frontmatter: ${frontmatter.error}` });
  if (frontmatter.tolerated) {
    estate.notes.push({
      file: file.path,
      message: `frontmatter read field by field (the YAML parser said: ${frontmatter.tolerated})`,
    });
  }
}

function readRegistry(file: EstateFile, estate: RawEstate, paths: ReadonlySet<string>): void {
  if (/\.(jsonc?|ya?ml)$/.test(file.path)) {
    readJsonRegistry(file, estate, paths);
    return;
  }
  const known = knownGuards(estate);
  for (const table of readTables(file.text)) {
    // A header in bold or backticks names the same column.
    const column = (pattern: RegExp, from = 0) =>
      table.header.findIndex((cell, index) => index >= from && pattern.test(strip(cell)));
    const firstIsId =
      COLUMNS.id.test(table.header[0] ?? '') ||
      (table.rows.length > 0 && table.rows.every((row) => ROW_ID.test(strip(row.cells[0] ?? ''))));
    const legacyGuard = column(COLUMNS.guard);
    const legacyEnforces = column(COLUMNS.enforces);
    if (!firstIsId && (legacyGuard < 0 || legacyEnforces < 0)) continue;
    const id = firstIsId ? 0 : column(COLUMNS.id);
    const guard = column(COLUMNS.guard, firstIsId ? 1 : 0);
    const enforces = column(COLUMNS.enforces);
    const watches = column(COLUMNS.watches);
    const event = column(COLUMNS.event);
    const verdict = column(COLUMNS.verdict);
    const state = column(COLUMNS.state);
    const description = column(COLUMNS.description);
    for (const row of table.rows) {
      const cell = (index: number) => (index >= 0 ? strip(row.cells[index] ?? '') : '');
      const ids = idsOf(row.cells[id] ?? '');
      const rowIds = ids.length > 0 ? ids : [cell(guard)].filter((value) => value !== '');
      // The rule columns name rules, not guards: a guard is looked for in the other cells only.
      const others = row.cells.filter((_, index) => ![id, guard, enforces, watches].includes(index));
      const named =
        guardNamedIn(guard >= 0 ? [row.cells[guard] ?? '', ...others] : others, known) ??
        (guard >= 0 ? guardOfAdapter(row.cells[guard] ?? '', known) : undefined);
      for (const rowId of rowIds) {
        const links = [
          ...(enforces >= 0 ? parseEnforces(row.cells[enforces] ?? '') : []),
          ...(watches >= 0 ? parseWatches(row.cells[watches] ?? '', rowId) : []),
        ];
        const entry: RegistryRow = {
          id: rowId,
          guard:
            named ??
            checkGuard(rowId, estate) ??
            scriptHolding(rowId, estate, known) ??
            (cell(guard) || rowId),
          enforces: links,
          at: { file: file.path, startLine: row.line, endLine: row.line, quote: row.text },
        };
        if (cell(event) !== '') entry.event = cell(event);
        if (cell(verdict) !== '') entry.verdict = cell(verdict);
        if (cell(state) !== '') entry.state = cell(state);
        const ruleText = [description, watches]
          .map((index) => (index >= 0 ? (row.cells[index] ?? '').trim() : ''))
          .filter(Boolean)
          .join('\n');
        if (ruleText !== '') entry.description = ruleText;
        estate.registry.push(entry);
      }
    }
  }
}

/** One id token: a letter or digit first, then letters, digits and `_ . # -`. */
const ID_TOKEN = /^[A-Za-z0-9][\w.#-]*$/;

/**
 * The ids an id cell holds. A cell such as `` `G2` `G3` `G9` `` or `` HANDBACK` / `STOP-WAKE `` names several
 * checks: it is split on white space, commas, slashes and backticks, and each part is an id when every part
 * looks like one (an id token with a digit, or in capitals). Any other cell is one id, as written.
 */
function idsOf(raw: string): string[] {
  const whole = strip(raw);
  if (whole === '') return [];
  const parts = raw
    .split(/[\s,/|`]+/)
    .map((part) => strip(part))
    .filter((part) => part !== '');
  const several =
    parts.length > 1 &&
    parts.every((part) => ID_TOKEN.test(part) && (/\d/.test(part) || part === part.toUpperCase()));
  if (several) return [...new Set(parts)];
  // Backticks mark ids in a cell that also holds words: `` `HANDBACK` / `STOP-WAKE` hold `` holds two.
  const marked = [...raw.matchAll(/`([^`\s]+)`/g)]
    .map((match) => match[1] ?? '')
    .filter((id) => ID_TOKEN.test(id));
  return marked.length > 1 ? [...new Set(marked)] : [whole];
}

/** The names the estate's guards go by: a script's file name, a check id. */
function knownGuards(estate: RawEstate): Set<string> {
  return new Set(estate.guards.map((guard) => guardName(guard)));
}

/** A known guard named in one of the cells: as a whole cell, a backticked token or a word of the cell. */
function guardNamedIn(cells: readonly string[], known: ReadonlySet<string>): string | undefined {
  for (const raw of cells) {
    const cell = strip(raw);
    const tokens = [cell, ...cell.split(/[\s,;|()]+/)].map((token) => strip(token)).filter(Boolean);
    for (const token of tokens) {
      if (known.has(token)) return token;
      const base = basename(token);
      if (base !== token && known.has(base)) return base;
    }
  }
  return undefined;
}

/**
 * The guard an adapter column names by its short name: `fs-firewall` for `nexus-fs-firewall.py`,
 * `claim-window` for `claim-window.py`. The cell, as a whole, must equal a guard's file name without its
 * extension, or be the end of it after a `-` or `_`; it names a guard only when exactly one guard fits.
 */
function guardOfAdapter(cell: string, known: ReadonlySet<string>): string | undefined {
  const name = strip(cell).toLowerCase();
  if (!/^[a-z0-9][\w.-]*$/.test(name)) return undefined;
  const fits = [...known].filter((guard) => {
    const stem = guard.replace(/\.[A-Za-z0-9]+$/, '').toLowerCase();
    return stem === name || stem.endsWith(`-${name}`) || stem.endsWith(`_${name}`);
  });
  return fits.length === 1 ? fits[0] : undefined;
}

/** The catalogue check of the same id, when the estate has one. */
function checkGuard(id: string, estate: RawEstate): string | undefined {
  return estate.guards.find((guard) => guard.check?.id === id)?.check?.id;
}

/** The guard whose script source holds the id as a word: a check that lives inside a guard script. */
function scriptHolding(id: string, estate: RawEstate, known: ReadonlySet<string>): string | undefined {
  const word = new RegExp(`(^|[^\\w])${escapeRegex(id)}([^\\w]|$)`);
  for (const guard of estate.guards) {
    if (!guard.script) continue;
    const text = estate.files.find((file) => file.path === guard.script)?.text;
    const name = guardName(guard);
    if (text !== undefined && known.has(name) && word.test(text)) return name;
  }
  return undefined;
}

/** Free text that says when a check fires: the quoted passages it repeats, and rule ids other than its own. */
function parseWatches(cell: string, own: string): RegistryRow['enforces'] {
  const found: RegistryRow['enforces'] = [];
  for (const match of cell.matchAll(/"([^"]+)"|\u201c([^\u201d]+)\u201d|\b([A-Z]{1,3}\d{1,3})\b/g)) {
    const quote = match[1] ?? match[2];
    if (quote !== undefined) found.push({ quote });
    else if (match[3] !== undefined && match[3] !== own) found.push({ id: match[3] });
  }
  return found;
}

/**
 * Reads a catalogue: each entry is a guard atom of its own, named by its id (`id`, `name` or its key in the
 * map), with the event it runs on, its enforcement state (`status`), its own kind, what it runs (`work`;
 * the script, when that names a file of the estate), the steps it belongs to (`step`) and the rules it
 * watches (`watches`: rule ids, quoted passages, or a passage as the whole string). A check whose state is
 * off enforces nothing. The links go to the graph as a registry row of the catalogue's own.
 */
function readCatalogue(file: EstateFile, estate: RawEstate): void {
  const entries = catalogueEntries(file.text) ?? [];
  const paths = new Set(estate.files.map((candidate) => candidate.path));
  const cursor = { at: 0 };
  // A later catalogue file that repeats a check (tags, overrides) annotates it; the check is read once.
  const held = new Set(
    estate.guards.flatMap((guard) => (guard.scope === 'catalogue' && guard.check ? [guard.check.id] : [])),
  );
  let repeats = 0;
  const hosts = hostWords(estate);
  for (const { key, entry } of entries) {
    const named = [entry.id, entry.name].find((value) => typeof value === 'string' && value !== '');
    const id = typeof named === 'string' ? named : key;
    if (id === undefined) {
      estate.notes.push({ file: file.path, message: 'a catalogue entry has no id, name or key' });
      continue;
    }
    if (held.has(id)) {
      repeats += 1;
      continue;
    }
    held.add(id);
    const pattern =
      key !== undefined
        ? new RegExp(`${escapeRegex(JSON.stringify(key))}\\s*:`)
        : new RegExp(`"(id|name)"\\s*:\\s*${escapeRegex(JSON.stringify(id))}`);
    const found = seekPattern(file, pattern, cursor);
    if (!found) {
      estate.notes.push({ file: file.path, message: `cannot find the catalogue entry ${id} in the file` });
      continue;
    }
    const line = linesOf(file.text)[found.startLine - 1]?.text ?? found.quote;
    const at: Located = { ...found, endLine: found.startLine, quote: line };
    const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : undefined);
    const list = (value: unknown) =>
      (Array.isArray(value) ? value : [value]).filter(
        (item): item is string => typeof item === 'string' && item !== '',
      );
    const work = text(entry.work);
    const state = text(entry.status);
    const trigger = [
      ...new Set(
        [
          ...list(entry.watches)
            .join(' ')
            .matchAll(/`([^`]+)`/g),
        ].map((match) => match[1] ?? ''),
      ),
    ].filter((span) => span.trim() !== '');
    const host = hosts.find((candidate) => candidate.words.has(id))?.script;
    const check: CheckDecl = { id, steps: list(entry.step ?? entry.steps), trigger };
    if (host !== undefined) check.host = host;
    const kind = text(entry.kind);
    if (kind !== undefined) check.kind = kind;
    if (state !== undefined) check.state = state;
    if (work !== undefined) check.work = work;
    const script = work !== undefined ? scriptIn(work, posix.dirname(file.path), paths) : undefined;
    const guard: GuardDecl = {
      event: text(entry.event) ?? 'any',
      command: work ?? id,
      scope: 'catalogue',
      anchored: true,
      at,
      check,
      ...(script !== undefined ? { script } : {}),
    };
    const matcher = text(entry.matcher);
    if (matcher !== undefined) guard.matcher = matcher;
    estate.guards.push(guard);
    const row: RegistryRow = {
      id,
      guard: id,
      enforces: state !== undefined && OFF_STATES.test(state) ? [] : parseWatchList(list(entry.watches), id),
      at,
      origin: 'catalogue',
    };
    const description = list(entry.description ?? entry.meaning ?? entry.watches).join('\n');
    if (description) {
      row.description = description;
      row.descriptionAt = descriptionLocation(file, description, at);
    }
    if (text(entry.event) !== undefined) row.event = guard.event;
    const verdict = text(entry.verdict);
    if (verdict !== undefined) row.verdict = verdict;
    if (state !== undefined) row.state = state;
    estate.registry.push(row);
  }
  if (repeats > 0) {
    estate.notes.push({
      file: file.path,
      message: `a later catalogue repeats ${repeats} check${repeats === 1 ? '' : 's'} an earlier one holds; it is read once`,
    });
  }
}

/** The words of each configured guard's script (not a catalogue check's), to find the hook that runs a check. */
function hostWords(estate: RawEstate): Array<{ script: string; words: Set<string> }> {
  const texts = new Map(estate.files.map((file) => [file.path, file.text]));
  const scripts = [
    ...new Set(
      estate.guards.flatMap((guard) => (guard.scope !== 'catalogue' && guard.script ? [guard.script] : [])),
    ),
  ];
  return scripts.map((script) => ({
    script,
    words: new Set((texts.get(script) ?? '').match(/[\w-]+/g) ?? []),
  }));
}

/** Each watched item: a rule id, the quoted passages and ids it holds, or the whole item as a passage. */
function parseWatchList(items: readonly string[], own: string): RegistryRow['enforces'] {
  return items.flatMap((item) => {
    const trimmed = item.trim();
    if (/^[A-Za-z]{1,3}\d{1,3}$/.test(trimmed)) return trimmed === own ? [] : [{ id: trimmed }];
    const inner = parseWatches(trimmed, own);
    return inner.length > 0 ? inner : [{ quote: trimmed }];
  });
}

/**
 * The script a command line runs, among the files of the estate: every token that looks like a path is
 * tried from the root, from the folder the command is written in, and from the folder of each earlier path
 * and the folders above it (a dispatcher names its target from where it sits). The last one that exists wins.
 */
function scriptIn(
  command: string,
  from: string,
  paths: ReadonlySet<string>,
  workingDirectoryFirst = false,
): string | undefined {
  let found: string | undefined;
  const bases = [''];
  if (from !== '.' && from !== '') {
    if (workingDirectoryFirst) bases.unshift(from);
    else bases.push(from);
  }
  for (const raw of tokens(command)) {
    const unquoted = raw.replace(/["']/g, '');
    const token = stripAnchor(unquoted);
    if (token === '' || token.startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue;
    const named = token.includes('/') || SCRIPT_EXTENSION.test(token);
    // After a dispatcher, a bare word may name its target script without the extension.
    const bare = !named && found !== undefined && /^[\w.-]+$/.test(token);
    if (!named && !bare) continue;
    const names = bare ? [token, ...DISPATCH_EXTENSIONS.map((extension) => `${token}${extension}`)] : [token];
    const searchBases = workingDirectoryFirst && anchorOf(unquoted).anchored ? [''] : bases;
    const hit = searchBases
      .flatMap((base) => names.map((name) => posix.normalize(posix.join(base, name))))
      .find((candidate) => paths.has(candidate));
    if (hit === undefined) continue;
    found = hit;
    for (let folder = posix.dirname(hit); folder !== '.' && folder !== ''; folder = posix.dirname(folder)) {
      if (!bases.includes(folder)) bases.push(folder);
    }
  }
  return found;
}

/** A command line split on white space, quotes kept inside their token. */
function tokens(command: string): string[] {
  return command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
}

/** A path with its project anchor (`$CLAUDE_PROJECT_DIR/`) taken off, relative to the root. */
function stripAnchor(token: string): string {
  for (const anchor of ANCHORS) if (anchor.test(token)) return token.replace(anchor, '');
  return token;
}

/** Entries in the known registry containers, an id map, or an event-grouped list. */
type RegistryEntry = { row: Record<string, unknown>; key?: string; event?: string };

function registryEntries(value: unknown): RegistryEntry[] {
  let current = value;
  while (isRecord(current)) {
    const record = current;
    const container = ['checks', 'hooks', 'entries', 'guards', 'catalogue', 'registry'].find(
      (key) => Array.isArray(record[key]) || isRecord(record[key]),
    );
    if (container === undefined) break;
    current = record[container];
  }
  if (Array.isArray(current)) return current.filter(isRecord).map((row) => ({ row }));
  if (!isRecord(current)) return [];
  return Object.entries(current).flatMap<RegistryEntry>(([key, row]) => {
    if (Array.isArray(row)) return row.filter(isRecord).map((entry) => ({ row: entry, event: key }));
    if (!isRecord(row)) return [];
    const guard = [row.guard, row.script, row.check, row.hook, row.file, row.path, row.command].some(
      (candidate) => typeof candidate === 'string',
    );
    const described = typeof (row.description ?? row.meaning ?? row.purpose) === 'string';
    return guard || described ? [{ row, key }] : [];
  });
}

/** Content identifies check registries, independent of their filename. */
function structuredRegistry(text: string, path: string): boolean {
  const enforcement = /^(?:enforc(?:e|ing)|observ(?:e|ing)|warn(?:ing)?|off|disabled|block(?:ing)?)$/i;
  if (/\.(?:md|markdown)$/.test(path)) {
    return readTables(text).some((table) => {
      const headers = table.header.map(strip);
      const state = headers.findIndex((header) => COLUMNS.state.test(header));
      return (
        headers.some((header) => COLUMNS.id.test(header)) &&
        headers.some((header) => COLUMNS.description.test(header) || COLUMNS.watches.test(header)) &&
        (headers.some((header) => COLUMNS.guard.test(header) || COLUMNS.verdict.test(header)) ||
          (state >= 0 &&
            table.rows.length > 0 &&
            table.rows.every((row) => enforcement.test(strip(row.cells[state] ?? '')))))
      );
    });
  }
  if (!/\.(?:jsonc?|ya?ml)$/.test(path)) return false;
  try {
    const rows = registryEntries(parseData(text, path));
    return (
      rows.length > 0 &&
      rows.every(
        ({ row, key }) =>
          (typeof row.id === 'string' || key !== undefined) &&
          [row.description, row.meaning, row.purpose, row.verdict, row.enforces, row.rules].some(
            (value) => value !== undefined,
          ) &&
          ([row.guard, row.script, row.hook, row.command, row.verdict].some((value) => value !== undefined) ||
            enforcement.test(String(row.state ?? row.status ?? row.enforcement ?? ''))),
      )
    );
  } catch {
    return false;
  }
}

/** A description's own line span, rather than the id line that anchors its registry entry. */
function descriptionLocation(file: EstateFile, text: string, fallback: Located): Located {
  const found = seek(file, /\.ya?ml$/.test(file.path) ? text : JSON.stringify(text), { at: 0 });
  if (!found) return fallback;
  return {
    ...found,
    quote: file.text
      .split('\n')
      .slice(found.startLine - 1, found.endLine)
      .join('\n')
      .trim(),
  };
}

function readJsonRegistry(file: EstateFile, estate: RawEstate, paths: ReadonlySet<string>): void {
  let json: unknown;
  try {
    json = parseData(file.text, file.path);
  } catch (cause) {
    estate.notes.push({ file: file.path, message: `not JSON: ${String(cause)}` });
    return;
  }
  const rows = registryEntries(json);
  const sources = new Map(estate.files.map((source) => [source.path, source.text]));
  const known = knownGuards(estate);
  const cursor = { at: 0 };
  for (const { row, key, event } of rows) {
    const id = typeof row.id === 'string' ? row.id : key;
    if (id === undefined) continue;
    const field = ['guard', 'script', 'check', 'hook', 'file', 'path', 'command'].find(
      (key) => typeof row[key] === 'string',
    );
    const named = field === undefined ? undefined : row[field];
    const implicit =
      typeof named !== 'string' ? (checkGuard(id, estate) ?? scriptHolding(id, estate, known)) : undefined;
    const guard =
      typeof named !== 'string'
        ? (implicit ?? id)
        : field === 'command'
          ? guardName({
              command: named,
              ...scriptOf(named, paths, sources),
            })
          : basename(named);
    const found = seekPattern(file, key !== undefined ? stepMapKey(key) : keyValue('id', id), cursor);
    if (!found) continue;
    const listed = row.enforces ?? row.rules ?? row.gates;
    const entry: RegistryRow = {
      id,
      guard,
      enforces: registryRules(listed),
      at: found,
    };
    if (typeof row.event === 'string') entry.event = row.event;
    else if (event !== undefined) entry.event = event;
    if (typeof row.verdict === 'string') entry.verdict = row.verdict;
    const state = row.state ?? row.status ?? row.mode ?? row.enforcement;
    if (typeof state === 'string') entry.state = state;
    const description = row.description ?? row.meaning ?? row.purpose ?? row.summary ?? row.watches;
    if (typeof description === 'string' && description.trim() !== '') {
      entry.description = description;
      entry.descriptionAt = descriptionLocation(file, description, found);
    }
    estate.registry.push(entry);
  }
}

/** A rules field may be a scalar, a list of labels/passages, or explicit id/quote records. */
function registryRules(value: unknown): RegistryRow['enforces'] {
  if (Array.isArray(value)) return value.flatMap(registryRules);
  if (isRecord(value)) {
    if (typeof value.id === 'string' && value.id.trim() !== '') return [{ id: value.id.trim() }];
    if (typeof value.quote === 'string' && value.quote.trim() !== '') return [{ quote: value.quote }];
    return [];
  }
  if (typeof value !== 'string' || value.trim() === '') return [];
  const text = value.trim();
  // Split only an entire label list. A passage mentioning a label remains a passage.
  if (/^[A-Za-z]{1,3}#?\d{1,3}(?:\s*(?:,|and)\s*[A-Za-z]{1,3}#?\d{1,3})*$/.test(text))
    return (text.match(/[A-Za-z]{1,3}#?\d{1,3}/g) ?? []).map((id) => ({ id: id.replace('#', '') }));
  return [{ quote: text }];
}

/** `R3, R5` or `"a quoted rule"`: ids and quoted passages. */
function parseEnforces(cell: string): RegistryRow['enforces'] {
  const found: RegistryRow['enforces'] = [];
  for (const match of cell.matchAll(/"([^"]+)"|`([^`]+)`|\b([A-Za-z]{1,3}\d{1,3})\b/g)) {
    if (match[1] !== undefined) found.push({ quote: match[1] });
    else if (match[2] !== undefined) found.push({ quote: match[2] });
    else if (match[3] !== undefined) found.push({ id: match[3] });
  }
  return found;
}

/**
 * Reads a step list: the top-level `steps` list, then each process of a `processes` map as a stage
 * catalogue of its own. A process step goes by `<process>/<id>`, so two processes may share a step name.
 * A step is an object with an `id` (or a `name`), a `title`, a `next` list and `anytime`, or a plain
 * string. When no step of a process says what comes next, the steps follow the order of the list.
 */
function readSteps(file: EstateFile, estate: RawEstate): void {
  let json: unknown;
  try {
    json = parseData(file.text, file.path);
  } catch (cause) {
    estate.notes.push({ file: file.path, message: `not JSON: ${String(cause)}` });
    return;
  }
  const cursor = { at: 0 };
  for (const { steps, process } of stepLists(json)) {
    // Enter the actual steps container before locating identifiers that may repeat in process names.
    if (!seekPattern(file, stepMapKey('steps'), cursor)) continue;
    readStepList(file, steps, process, cursor, estate);
  }
}

function readStepList(
  file: EstateFile,
  steps: StepCollection,
  process: string | undefined,
  cursor: { at: number },
  estate: RawEstate,
): void {
  const qualify = (id: string) => (process === undefined ? id : `${process}/${id}`);
  const read: StepDecl[] = [];
  let declaresNext = false;
  for (const { step, mapKey } of stepEntries(steps)) {
    const record = isRecord(step) ? step : {};
    const key = 'id' in record ? 'id' : 'name';
    const explicit = key in record;
    const id = mapKey !== undefined && !explicit ? mapKey : typeof step === 'string' ? step : record[key];
    if (typeof id !== 'string' || id === '') continue;
    const found =
      mapKey !== undefined && !explicit
        ? seekPattern(file, stepMapKey(mapKey), cursor)
        : typeof step === 'string'
          ? seek(file, JSON.stringify(step), cursor)
          : seekPattern(file, keyValue(key, id), cursor);
    if (!found) continue;
    const line = linesOf(file.text)[found.startLine - 1]?.text ?? found.quote;
    const next = record.next ?? record.then;
    if (next !== undefined) declaresNext = true;
    const decl: StepDecl = {
      id: qualify(id),
      next: (Array.isArray(next) ? next : [next])
        .filter((id): id is string => typeof id === 'string' && id !== '')
        .map(qualify),
      anytime: record.anytime === true,
      at: { ...found, endLine: found.startLine, quote: line },
    };
    if (typeof record.title === 'string') decl.title = record.title;
    if (process !== undefined) decl.process = process;
    read.push(decl);
  }
  if (!declaresNext) {
    const ordered = read.filter((step) => !step.anytime);
    ordered.forEach((step, index) => {
      const following = ordered[index + 1];
      if (following) step.next = [following.id];
    });
  }
  estate.steps.push(...read);
}

/**
 * Adds the prose of a file's lines as chunks of at most `budget` characters. A passage within the budget is
 * one chunk whose id is the file path; a longer one is cut at line ends (before a heading when the second
 * half of the chunk holds one, else after a blank line, else where the budget runs out) into chunks
 * `<path>#1`, `<path>#2`, ... A single line longer than the budget is a chunk of its own.
 */
function addProse(
  estate: RawEstate,
  file: EstateFile,
  startLine: number,
  endLine: number,
  budget: number,
): void {
  const lines = file.text.split('\n').slice(startLine - 1, endLine);
  if (lines.every((line) => line.trim() === '')) return;
  const parts = cutLines(lines, budget).filter(({ from, to }) =>
    lines.slice(from, to).some((line) => line.trim() !== ''),
  );
  parts.forEach(({ from, to }, index) => {
    const chunk: ProseChunk = {
      id: parts.length === 1 ? file.path : `${file.path}#${index + 1}`,
      file: file.path,
      startLine: startLine + from,
      endLine: startLine + to - 1,
      text: lines.slice(from, to).join('\n'),
    };
    estate.prose.push(chunk);
  });
}

/** Line ranges (`from` inclusive, `to` exclusive) of at most `budget` characters each, newlines counted. */
export function cutLines(lines: readonly string[], budget: number): Array<{ from: number; to: number }> {
  const parts: Array<{ from: number; to: number }> = [];
  let from = 0;
  while (from < lines.length) {
    let size = 0;
    let to = from;
    while (to < lines.length && (to === from || size + (lines[to]?.length ?? 0) + 1 <= budget)) {
      size += (lines[to]?.length ?? 0) + 1;
      to++;
    }
    if (to < lines.length) {
      const half = from + Math.ceil((to - from) / 2);
      let cut = -1;
      for (let index = to - 1; index >= half && cut < 0; index--) {
        if (/^#{1,6}\s/.test(lines[index] ?? '')) cut = index;
      }
      for (let index = to - 1; index >= half && cut < 0; index--) {
        if ((lines[index] ?? '').trim() === '') cut = index + 1;
      }
      if (cut > from) to = cut;
    }
    parts.push({ from, to });
    from = to;
  }
  return parts;
}

function nameAt(file: EstateFile, frontmatter: ReturnType<typeof readFrontmatter>, name: string): Located {
  const found = keyLine(file.text, 'name', frontmatter);
  if (found) return { file: file.path, startLine: found.line, endLine: found.line, quote: found.text };
  const first = linesOf(file.text).find((line) => line.text !== '');
  return {
    file: file.path,
    startLine: first?.line ?? 1,
    endLine: first?.line ?? 1,
    quote: first?.text || name,
  };
}

/** A scalar frontmatter field with its line; the quote is the value when the line holds it. */
function valueAt(
  file: EstateFile,
  frontmatter: ReturnType<typeof readFrontmatter>,
  key: string,
  value: unknown,
): Read<string> | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const found = keyLine(file.text, key, frontmatter);
  if (!found) return undefined;
  const quote = found.text.includes(value) ? value : found.text;
  return { value, at: { file: file.path, startLine: found.line, endLine: found.line, quote } };
}

/** A list field (`Read, Edit` or a YAML list), each item with the line it is on. */
function listAt(
  file: EstateFile,
  frontmatter: ReturnType<typeof readFrontmatter>,
  key: string,
  value: unknown,
): Array<Read<string>> {
  const items =
    typeof value === 'string'
      ? splitList(value)
      : Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : [];
  const found = keyLine(file.text, key, frontmatter);
  const end = frontmatter.endLine;
  if (!found || end === undefined) return [];
  const lines = linesOf(file.text).filter((line) => line.line >= found.line && line.line < end);
  return items.flatMap((item) => {
    const line = lines.find((candidate) => candidate.raw.includes(item));
    return line
      ? [{ value: item, at: { file: file.path, startLine: line.line, endLine: line.line, quote: item } }]
      : [];
  });
}

/** Splits `Read, Edit, Bash(python3 *)` on the commas outside parentheses. */
export function splitList(text: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    if (char === '(') depth++;
    if (char === ')') depth = Math.max(0, depth - 1);
    if (char === ',' && depth === 0) {
      items.push(current.trim());
      current = '';
    } else current += char;
  }
  items.push(current.trim());
  return items.filter((item) => item !== '');
}

function withoutHooks(fields: Record<string, unknown>): Record<string, unknown> {
  const { hooks: _hooks, ...rest } = fields;
  return rest;
}

function lastLine(text: string): number {
  return text.replace(/\n+$/, '').split('\n').length;
}

function strip(cell: string): string {
  return cell.replace(/^[`*"]+|[`*"]+$/g, '').trim();
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const EXTERNAL_NOTE = 'external reference: resolves outside the estate root; not read';

async function localPath(root: string, file: string, notes: ReadNote[]): Promise<string | undefined> {
  try {
    return await estatePath(root, file);
  } catch (cause) {
    if (!(cause instanceof EstatePathError)) throw cause;
    if (!notes.some((note) => note.file === file && note.message === EXTERNAL_NOTE))
      notes.push({ file, message: EXTERNAL_NOTE });
    return undefined;
  }
}

const FOLLOWED_NOTE = 'followed-link';

/** Record a structural link whose real path lies outside the estate root; the link is read, as the layout asks. */
async function noteFollowed(root: string, file: string, notes: ReadNote[]): Promise<void> {
  const link = await lstat(join(root, file)).catch(() => undefined);
  if (!link?.isSymbolicLink()) return;
  const [real, base] = await Promise.all([
    realpath(join(root, file)).catch(() => undefined),
    realpath(root).catch(() => undefined),
  ]);
  if (real === undefined || base === undefined) return;
  const tail = relative(base, real);
  if (tail !== '..' && !tail.startsWith(`..${sep}`) && !isAbsolute(tail)) return;
  if (!notes.some((note) => note.file === file && note.message === FOLLOWED_NOTE))
    notes.push({ file, message: FOLLOWED_NOTE });
}

function followedLinks(notes: readonly ReadNote[]): string[] {
  return notes
    .filter((note) => note.message === FOLLOWED_NOTE)
    .map((note) => note.file)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
