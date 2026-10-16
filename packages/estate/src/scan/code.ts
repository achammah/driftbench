import { basename, posix } from 'node:path';
import nlp from 'compromise';
import type { Atom, AtomKind, EvidencePredicate } from '../schema';
import { guardRuleSources } from './guard-rules';
import type { EstateFile, GuardDecl, ProseChunk, RawEstate, RegistryRow } from './reader';
import {
  blankFences,
  type Located,
  linesOf,
  provenanceHash,
  readFrontmatter,
  readTables,
  slug,
} from './text';

/**
 * The code half of the scan: every atom whose source has structure. Skills, helpers, guards, permissions,
 * settings and stages come from the reader's declarations; references, scripts, routing table rows,
 * fixed-form gates ("Before X: Read Y" and its equivalents) and passages that address a runtime hazard come
 * from patterns over the prose. Code atoms are approved as read: their quote is the file's own structure.
 */

/** The role code proposes per kind: axis kinds become cells of the plan, detail kinds vary inside a cell. */
export const DEFAULT_ROLE: Record<AtomKind, 'axis' | 'detail'> = {
  instruction: 'axis',
  gate: 'axis',
  route: 'axis',
  skill: 'axis',
  reference: 'detail',
  script: 'detail',
  subagent: 'axis',
  guard: 'axis',
  tool: 'detail',
  setting: 'detail',
  stage: 'axis',
  register: 'axis',
  hazard: 'detail',
  invariant: 'detail',
};

/** Event words propose a hazard; the local subject/object decides whether the agent undergoes it. */
// A compound adjective or identifier is not an event verb or noun.
const RESTART_EVENT = /(?<![\w-])(?:restart|reboot)(?:s|ed|ing)?(?![\w-])/i;
const RESUMPTION_EVENT =
  /\bresum(?:e[sd]?|ing)\b|\bpick(?:s|ed)? up where (?:you|we|it|the agent) left off\b/i;
const SESSION_START_EVENT = /\b(start of (every|each|a) session|new session|session start)/i;
const RATE_LIMIT_EVENT =
  /\brate[- ]limit(?:s|ed|ing)?\b|\bthrottl(?:e|es|ed|ing)\b|\btoo many requests\b|\b429s?\b/i;

/** Hazards of a long-running agent, resolved against the event's participants below. */
export const HAZARDS = [
  // The noun and the participle; "compact" alone is an adjective (a compact table) far more often.
  {
    id: 'compaction',
    title: 'A compaction of the context',
    pattern:
      /\b(compactions?|compacted|auto-?compact)\b|\b(?:conversation|context) is summari[sz]ed\b|\bcontext window (?:fills? up|is full)\b/i,
  },
  { id: 'restart', title: 'A process restart', pattern: RESTART_EVENT },
  {
    id: 'rate_wave',
    title: 'A wave of rate limits',
    pattern: RATE_LIMIT_EVENT,
  },
  {
    id: 'session_boundary',
    title: 'A new session',
    pattern: new RegExp(`${SESSION_START_EVENT.source}|${RESUMPTION_EVENT.source}`, 'i'),
  },
  { id: 'notification', title: 'A helper notification', pattern: /\bnotification/i },
  { id: 'nudge_storm', title: 'Repeated guard nudges', pattern: /\bnudges?\b/i },
] as const;

/** Extensions a named file needs to count as a reference when it does not exist. */
const DOCUMENT = /\.(md|markdown|txt|json|ya?ml|csv|tsv|html|py|sh|js|mjs|ts)$/i;
const SCRIPT = /\.(sh|bash|py|js|mjs|cjs|ts|rb|pl)$/i;

/** Builds atoms with stable, unique ids: kind, scope and a slug of the title, then -2, -3 on a repeat. */
export class AtomBuilder {
  readonly atoms: Atom[] = [];
  private readonly ids = new Set<string>();
  /** Per base id, the lowest suffix that may be free: every suffix below it is taken, and ids are never freed. */
  private readonly suffixes = new Map<string, number>();
  private readonly byFile = new Map<string, Atom[]>();

  constructor(private readonly files: ReadonlyMap<string, EstateFile>) {}

  scopeOf(path: string): string {
    const file = this.files.get(path);
    if (!file) return slug(path, 8);
    switch (file.kind) {
      case 'standing':
        return path === 'CLAUDE.md' || path.endsWith('/CLAUDE.md') ? 'standing' : slug(path, 8);
      case 'memory':
        return `memory-${slug(basename(path).replace(/\.md$/, ''), 4)}`;
      case 'skill':
      case 'skill_file':
        return slug(file.owner ?? path, 6);
      case 'subagent':
        return slug(basename(path).replace(/\.md$/, ''), 6);
      case 'settings':
        return 'settings';
      case 'registry':
        return 'registry';
      case 'step_list':
        return 'steps';
      default:
        return slug(path, 8);
    }
  }

  add(atom: {
    kind: AtomKind;
    title: string;
    at: Located;
    evidence: EvidencePredicate[];
    producedBy?: 'code' | 'model';
    situation?: string;
    fields?: Record<string, unknown>;
    approved?: boolean;
  }): Atom {
    const base = `${atom.kind}.${this.scopeOf(atom.at.file)}.${slug(atom.title)}`;
    let id = base;
    if (this.ids.has(id)) {
      let count = this.suffixes.get(base) ?? 2;
      while (this.ids.has(`${base}-${count}`)) count++;
      id = `${base}-${count}`;
      this.suffixes.set(base, count + 1);
    }
    this.ids.add(id);
    const producedBy = atom.producedBy ?? 'code';
    const built: Atom = {
      id,
      kind: atom.kind,
      title: atom.title,
      provenance: { ...atom.at, hash: provenanceHash(atom.at) },
      producedBy,
      role: DEFAULT_ROLE[atom.kind],
      approved: atom.approved ?? producedBy === 'code',
      ...(atom.situation ? { situation: atom.situation } : {}),
      evidence: atom.evidence,
      enforcement: [],
      ...(atom.fields ? { fields: atom.fields } : {}),
    };
    this.atoms.push(built);
    const inFile = this.byFile.get(built.provenance.file);
    if (inFile) inFile.push(built);
    else this.byFile.set(built.provenance.file, [built]);
    return built;
  }

  /** The atoms built on a file, in the order they were added. */
  atomsOf(path: string): readonly Atom[] {
    return this.byFile.get(path) ?? [];
  }
}

/** The name a trace gives a guard: a catalogue check's id, else its script's file name, else a slug of its command. */
export function guardName(guard: Pick<GuardDecl, 'script' | 'command' | 'check'>): string {
  if (guard.check) return guard.check.id;
  return guard.script ? basename(guard.script) : slug(guard.command, 8);
}

/** Every registry row that names a guard, matched on the guard's name, in registry order. */
export function registryRowsOf(guard: GuardDecl, registry: readonly RegistryRow[]): RegistryRow[] {
  const name = guardName(guard);
  return registry.filter((row) => basename(row.guard) === name);
}

/**
 * The registry row of a guard. When several rows name the guard (one guard script runs several checks),
 * one row stands for them all: the first row's id, event, verdict and place, the first state written, and
 * the rules every row enforces.
 */
export function registryRowOf(guard: GuardDecl, registry: readonly RegistryRow[]): RegistryRow | undefined {
  const rows = registryRowsOf(guard, registry);
  const [first, ...rest] = rows;
  if (!first || rest.length === 0) return first;
  const state = rows.find((row) => row.state !== undefined)?.state;
  return {
    ...first,
    enforces: rows.flatMap((row) => row.enforces),
    ...(state !== undefined ? { state } : {}),
  };
}

/** Every atom code reads, in a fixed order, so ids are the same on every run. */
export function codeAtoms(raw: RawEstate, builder: AtomBuilder): void {
  const files = new Map(raw.files.map((file) => [file.path, file]));
  const { labels } = raw;
  const dispatch = (name: string): EvidencePredicate => ({
    type: 'tool_called',
    label: labels.dispatch,
    input: { subagent_type: name },
  });

  for (const skill of raw.skills) {
    builder.add({
      kind: 'skill',
      title: `Skill ${skill.name}`,
      at: skill.at,
      evidence: [{ type: 'skill_loaded', name: skill.name }],
      fields: {
        name: skill.name,
        folder: skill.folder,
        tools: skill.tools.map((tool) => tool.value),
        ...(skill.description ? { description: skill.description.value } : {}),
      },
    });
    if (skill.description) {
      builder.add({
        kind: 'route',
        title: `An ask that fits ${skill.name} loads it`,
        at: skill.description.at,
        evidence: [{ type: 'skill_loaded', name: skill.name }],
        situation: skill.description.value,
        fields: { target: skill.name, targetKind: 'skill', via: 'description' },
      });
    }
  }

  for (const helper of raw.subagents) {
    builder.add({
      kind: 'subagent',
      title: `Helper ${helper.name}`,
      at: helper.at,
      evidence: [dispatch(helper.name)],
      fields: {
        name: helper.name,
        tools: helper.tools.map((tool) => tool.value),
        skills: helper.skills.map((skill) => skill.value),
        ...(helper.model ? { model: helper.model.value } : {}),
        ...(helper.effort ? { effort: helper.effort.value } : {}),
        ...(helper.description ? { description: helper.description.value } : {}),
      },
    });
    if (helper.description) {
      builder.add({
        kind: 'route',
        title: `An ask that fits ${helper.name} dispatches it`,
        at: helper.description.at,
        evidence: [dispatch(helper.name)],
        situation: helper.description.value,
        fields: { target: helper.name, targetKind: 'subagent', via: 'description' },
      });
    }
  }

  for (const guard of raw.guards) {
    const name = guardName(guard);
    const row = registryRowOf(guard, raw.registry);
    const rows = registryRowsOf(guard, raw.registry).filter((entry) => entry.origin !== 'catalogue');
    const script = guard.script ? files.get(guard.script) : undefined;
    const ruleSources = [
      ...(script ? guardRuleSources(script) : []),
      ...registryRowsOf(guard, raw.registry).flatMap((entry) =>
        entry.description
          ? [{ ...(entry.descriptionAt ?? entry.at), kind: 'registry', text: entry.description }]
          : [],
      ),
    ];
    builder.add({
      kind: 'guard',
      title: `${guard.event}${guard.matcher ? ` ${guard.matcher}` : ''} guard ${name}`,
      at: guard.at,
      evidence: [{ type: 'guard', name, ...(row?.verdict ? { verdict: row.verdict } : {}) }],
      fields: {
        name,
        event: guard.event,
        command: guard.command,
        anchored: guard.anchored,
        scope: guard.scope,
        ...(ruleSources.length > 0
          ? {
              ruleText: [...new Set(ruleSources.map((source) => source.text))].join('\n'),
              ruleSources,
              rules: registryRowsOf(guard, raw.registry)
                .filter((entry) => entry.description)
                .map((entry) => ({
                  id: entry.id,
                  description: entry.description,
                  ...(entry.verdict ? { verdict: entry.verdict } : {}),
                  ...(entry.state ? { state: entry.state } : {}),
                  source: entry.descriptionAt ?? entry.at,
                })),
            }
          : {}),
        ...(guard.matcher ? { matcher: guard.matcher } : {}),
        ...(guard.script ? { script: guard.script, scriptExists: files.has(guard.script) } : {}),
        ...(guard.dispatcher ? { dispatcher: guard.dispatcher } : {}),
        ...(guard.timeout !== undefined ? { timeout: guard.timeout } : {}),
        ...(row ? { registry: row.id } : {}),
        ...(rows.length > 1 ? { registryRows: rows.map((entry) => entry.id) } : {}),
        ...(row?.state !== undefined ? { state: row.state } : {}),
        ...(guard.check
          ? {
              check: guard.check.id,
              ...(guard.check.kind !== undefined ? { checkKind: guard.check.kind } : {}),
              ...(guard.check.state !== undefined ? { state: guard.check.state } : {}),
              ...(guard.check.work !== undefined ? { work: guard.check.work } : {}),
              ...(guard.check.steps.length > 0 ? { steps: guard.check.steps } : {}),
              ...(guard.check.trigger && guard.check.trigger.length > 0
                ? { trigger: guard.check.trigger }
                : {}),
              ...(guard.check.host !== undefined ? { host: guard.check.host } : {}),
            }
          : {}),
      },
    });
  }

  const bare = new Set<string>();
  for (const permission of raw.permissions) {
    if (permission.pattern === undefined) bare.add(permission.tool);
    const evidence: EvidencePredicate =
      permission.effect === 'deny' && permission.pattern === undefined
        ? { type: 'tool_not_called', label: permission.tool }
        : {
            type: 'custom',
            name: 'permission',
            options: { effect: permission.effect, rule: permission.rule },
          };
    builder.add({
      kind: 'tool',
      title: `${capital(permission.effect)} ${permission.rule}`,
      at: permission.at,
      evidence: [evidence],
      fields: {
        tool: permission.tool,
        effect: permission.effect,
        rule: permission.rule,
        ...(permission.pattern !== undefined ? { pattern: permission.pattern } : {}),
      },
    });
  }
  const declared = [...raw.skills, ...raw.subagents].flatMap((unit) => unit.tools);
  for (const tool of declared) {
    const name = toolBase(tool.value);
    if (bare.has(name)) continue;
    bare.add(name);
    builder.add({
      kind: 'tool',
      title: `Declared ${name}`,
      at: tool.at,
      evidence: [{ type: 'custom', name: 'permission', options: { effect: 'declared', rule: name } }],
      fields: { tool: name, effect: 'declared', rule: name },
    });
  }

  for (const setting of raw.settings) {
    builder.add({
      kind: 'setting',
      title: `Setting ${setting.key}${setting.value !== undefined ? ` is ${setting.value}` : ''}`,
      at: setting.at,
      evidence: [
        {
          type: 'custom',
          name: 'run_config',
          options: { key: setting.key, ...(setting.value !== undefined ? { value: setting.value } : {}) },
        },
      ],
      fields: { key: setting.key, ...(setting.value !== undefined ? { value: setting.value } : {}) },
    });
  }

  for (const step of raw.steps) {
    builder.add({
      kind: 'stage',
      title: `Stage ${step.id}${step.title ? `: ${step.title}` : ''}`,
      at: step.at,
      evidence: [{ type: 'stage_reached', name: step.id }],
      fields: {
        id: step.id,
        next: step.next,
        anytime: step.anytime,
        ...(step.process !== undefined ? { process: step.process } : {}),
      },
    });
  }

  // Index declared roots at any depth. The nearest ancestor owns a file, so nested skills keep
  // their own scripts even when names or owner labels differ from folder names after a rename.
  // Walk path ancestors with root lookups, never scan every skill for each file.
  const skillRoots = new Set(raw.skills.map((skill) => posix.normalize(skill.folder)));
  const folderFiles = new Map<string, EstateFile[]>();
  for (const file of raw.files) {
    if (file.kind !== 'skill_file') continue;
    let folder = posix.dirname(posix.normalize(file.path));
    while (!skillRoots.has(folder)) {
      const parent = posix.dirname(folder);
      if (parent === folder) break;
      folder = parent;
    }
    if (!skillRoots.has(folder)) continue;
    const held = folderFiles.get(folder);
    if (held) held.push(file);
    else folderFiles.set(folder, [file]);
  }
  const proseOf = new Map<string, ProseChunk[]>();
  for (const chunk of raw.prose) {
    const held = proseOf.get(chunk.file);
    if (held) held.push(chunk);
    else proseOf.set(chunk.file, [chunk]);
  }
  for (const skill of raw.skills)
    scriptAtoms(
      skill.name,
      skill.folder,
      skill.file,
      folderFiles.get(posix.normalize(skill.folder)) ?? [],
      proseOf.get(skill.file) ?? [],
      raw,
      files,
      builder,
    );

  const names = {
    skills: new Set(raw.skills.map((skill) => skill.name)),
    subagents: new Set(raw.subagents.map((helper) => helper.name)),
  };
  for (const chunk of raw.prose) {
    referenceAtoms(chunk, files, raw, builder);
    routeAtoms(chunk, files, names, raw, builder);
    gateAtoms(chunk, files, raw, builder);
    hazardAtoms(chunk, files, builder);
  }
}

/** The script file a command runs: after assignments, exec and env, and an interpreter with its flags. */
function commandExecutable(command: string): string | undefined {
  const words =
    command
      .match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\S+/g)
      ?.map((word) => word.replace(/^["']|["']$/g, '')) ?? [];
  while (words[0] === 'exec' || words[0] === 'env' || /^[A-Za-z_]\w*=/.test(words[0] ?? '')) words.shift();
  const executable = words.shift();
  if (
    !/^(?:python(?:\d+(?:\.\d+)*)?|node|bash|sh|zsh|ruby|perl|deno|bun|tsx)$/.test(basename(executable ?? ''))
  )
    return executable;
  while (words[0]?.startsWith('-')) {
    // Inline interpreter programs are not script-file invocations.
    if (['-c', '-e', '--eval', '-m'].includes(words[0])) return undefined;
    words.shift();
  }
  return words.shift();
}

function scriptInvocation(text: string, name: string): boolean {
  // Punctuation inside quoted commands belongs to the command, not the enclosing prose.
  const masked = text.replace(/`[^`]*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, (part) =>
    ' '.repeat(part.length),
  );
  const clauses: string[] = [];
  let start = 0;
  for (const match of masked.matchAll(/[;,]|[.!?](?=\s|$)|\b(?:and\s+)?then\b/gi)) {
    clauses.push(text.slice(start, match.index));
    start = match.index + match[0].length;
  }
  clauses.push(text.slice(start));
  for (const clause of clauses) {
    const clean = clause.trim().replace(/^[-+*]\s+|^\d+[.)]\s+/, '');
    const directive =
      /^(?:you\s+)?(?:(?:must|should|always|first|then|also|please)\s+)?(?:run|execute|invoke|call|use|launch|start)\s+(?:the\s+script\s+)?(.+)$/i.exec(
        clean,
      );
    const argumentInstruction =
      /^(?:you\s+)?(?:(?:must|should|always)\s+)?pass\b.+?\bto\s+(`[^`]+`|\S+)/i.exec(clean);
    if (
      argumentInstruction &&
      basename((argumentInstruction[1] ?? '').replace(/[`.,;]+$/g, '').replace(/^`/, '')) === name
    )
      return true;
    // A link to the script file points at it, unless the clause forbids it.
    for (const link of clean.matchAll(/\]\(<?([^\s)>]+)>?(?:\s+"[^"]*")?\)/g)) {
      const target = basename((link[1] ?? '').replace(/[#?].*$/, ''));
      if (target === name && !/\b(?:never|do not|don't|must not|should not)\b/i.test(clean)) return true;
    }
    // With no imperative verb, accept a command only when it occupies the whole clause. After a verb,
    // every code span is a command of that verb ("run `a` first and `b` last").
    const command = directive?.[1] ?? clean;
    const spans = directive ? [...command.matchAll(/`([^`]+)`/g)].map((span) => span[1] ?? '') : [];
    const span = /^`([^`]+)`/.exec(command);
    if (!directive && span && span[0].length !== command.length) continue;
    if (
      !directive &&
      !span &&
      !/[/]/.test(command.split(/\s+/)[0] ?? '') &&
      !/^(?:exec|env|python[\d.]*|node|bash|sh|zsh|ruby|perl|deno|bun|tsx)\s/.test(command)
    )
      continue;
    for (const written of spans.length > 0 ? spans : [span?.[1] ?? command]) {
      if (basename(commandExecutable(written) ?? '') === name) return true;
    }
  }
  return false;
}

/** One script atom per script file of a skill, anchored where the skill body names it, else in the script. */
function scriptAtoms(
  skill: string,
  folder: string,
  definition: string,
  skillFiles: readonly EstateFile[],
  bodyChunks: readonly ProseChunk[],
  raw: RawEstate,
  files: ReadonlyMap<string, EstateFile>,
  builder: AtomBuilder,
): void {
  // A long body may be cut into several chunks: the mention is looked for in each, in order.
  const body = bodyChunks.flatMap((chunk) => chunkLines(chunk, files.get(definition)));
  for (const file of skillFiles) {
    const relative = posix.relative(folder, file.path);
    if (!SCRIPT.test(file.path) && !relative.startsWith('scripts/')) continue;
    const name = basename(file.path);
    const mention = body.find((line) => scriptInvocation(line.text, name));
    const at: Located = mention
      ? { file: definition, startLine: mention.line, endLine: mention.line, quote: mention.quote }
      : firstLine(file);
    builder.add({
      kind: 'script',
      title: `Script ${relative}`,
      at,
      evidence: [{ type: 'tool_called', label: raw.labels.shell, input: { command: { contains: name } } }],
      fields: { path: file.path, skill, named: mention !== undefined },
    });
  }
}

/** A path and its spelling in the source, before notation is normalized. */
type NamedReference = { path: string; spelling: string; start: number; end: number };

/** Paths a line names, sharing one tokenizer with reference provenance and negation checks. */
export function namedPaths(line: string): string[] {
  return namedReferences(line).map(({ path }) => path);
}

function namedReferences(line: string): NamedReference[] {
  const found: NamedReference[] = [];
  const claimed: Array<[number, number]> = [];
  const take = (
    match: RegExpMatchArray,
    token: string | undefined,
    wiki = false,
    length = match[0].length,
  ) => {
    const start = match.index ?? 0;
    if (claimed.some(([from, to]) => start >= from && start < to)) return;
    claimed.push([start, start + match[0].length]);
    if (!token) return;
    const spelling = token.trim();
    let path = spelling
      .replace(/\\/g, '/')
      .replace(/^@/, '')
      .replace(/^\$(?:\{CLAUDE_PROJECT_DIR\}|CLAUDE_PROJECT_DIR)\//, '')
      .replace(/[#?].*$/, '')
      .replace(/:\d+(?::\d+)?$/, '');
    if (wiki && !/\.[A-Za-z0-9]+$/.test(path)) path += '.md';
    const execution = /\b(?:run|execute)(?: the command)?\s*$|\bexample:\s*$/i.test(line.slice(0, start));
    if (
      /^[a-z]+:/i.test(path) ||
      /[<>*?{}$|;&]/.test(path) ||
      /\s--?\w/.test(path) ||
      (execution && /\s/.test(path)) ||
      !/\.[A-Za-z0-9]+$/.test(path)
    )
      return;
    found.push({ path, spelling, start, end: start + length });
  };
  for (const match of line.matchAll(/`([^`\n]+)`/g)) take(match, match[1]);
  for (const match of line.matchAll(/\[[^\]\n]*\]\((?:<([^>\n]+)>|([^\s)]+))(?:\s+"[^"]*")?\)/g))
    take(match, match[1] ?? match[2]);
  for (const match of line.matchAll(/"([^"\n]+)"|'([^'\n]+)'/g)) take(match, match[1] ?? match[2]);
  for (const match of line.matchAll(/\[\[([^\]\n|]+)(?:\|[^\]\n]*)?\]\]/g)) take(match, match[1], true);
  for (const match of line.matchAll(/<([^<>\s]+)>|\*\*([^*\n]+)\*\*/g)) take(match, match[1] ?? match[2]);
  // Whole tokens, never a filename extracted from inside a URL, glob, example or link title.
  // Find the directive once: rescanning each token's prefix makes long prose quadratic.
  const directive = /\b(?:read|open|load|consult|include|import|see|use)\b/i.exec(line);
  const directiveEnd = directive ? directive.index + directive[0].length : Number.POSITIVE_INFINITY;
  for (const match of line.matchAll(/[^\s`"'<>()[\],;!]+/g)) {
    if (!match[0].includes('.')) continue;
    if (!match[0].startsWith('@') && (match.index ?? 0) < directiveEnd) continue;
    const token = match[0].replace(/[.:]+$/, '');
    take(match, token, false, token.length);
  }
  return found;
}

type ReferenceToken = { word: string; references?: NamedReference[] };
type ReferenceClause = { tokens: ReferenceToken[]; coordinated: boolean };
const HISTORY_VERB = /^(?:removed|deleted|dropped|retired|deprecated|renamed|moved|replaced|superseded)$/;
const HISTORY_AUX = /^(?:was|were|is|are|be|been|being|has|have|had|got|gets?|getting)$/;
const PASSIVE_AUX = /^(?:was|were|is|are|be|been|being|got|gets?|getting)$/;
const HISTORY_ADVERB = /^(?:already|just|still|[a-z]+ly)$/;
const REFERENCE_ACT = /^(?:read|reading|open|opening|load|loading|see|seeing|consult|consulting|use|using)$/;
const HISTORY_UNCERTAIN = /^(?:not|never|no|cannot|can't|could|may|might|must|should|will|would|if|unless)$/;
const PHRASE_BOUNDARY =
  /^(?:with|by|to|into|onto|from|in|on|at|for|as|after|before|about|of|over|under|through|during|until|since|while|whereas|and|or|but|then)$/;

/** Predicate evidence used only to separate clauses, never to classify an unknown noun as a verb. */
function referencePredicate(token: ReferenceToken | undefined): boolean {
  return (
    token !== undefined &&
    !token.references &&
    (HISTORY_VERB.test(token.word) ||
      HISTORY_AUX.test(token.word) ||
      REFERENCE_ACT.test(token.word) ||
      /^(?:[a-z]+ed|[a-z]+ing|kept)$/.test(token.word))
  );
}

/**
 * Tokenize reference occurrences before punctuation: dots in filenames and words inside quotations never
 * delimit a clause. Overlapping markup (a code span in a link) shares the enclosing mention's role.
 */
function referenceClauses(text: string, references: readonly NamedReference[]): ReferenceClause[] {
  const groups: Array<{ start: number; end: number; references: NamedReference[] }> = [];
  for (const reference of [...references].sort((a, b) => a.start - b.start || b.end - a.end)) {
    const previous = groups.at(-1);
    if (previous && reference.start < previous.end) {
      previous.end = Math.max(previous.end, reference.end);
      previous.references.push(reference);
    } else groups.push({ start: reference.start, end: reference.end, references: [reference] });
  }
  let masked = '';
  let end = 0;
  for (const [index, group] of groups.entries()) {
    masked += `${text.slice(end, group.start)}\uE100${index}\uE101`;
    end = group.end;
  }
  masked += text.slice(end);
  const protectedText = maskLine(masked).text;
  const clauses: ReferenceClause[] = [];
  let tokens: ReferenceToken[] = [];
  let coordinated = false;
  const flush = (nextCoordinated: boolean) => {
    if (tokens.length) clauses.push({ tokens, coordinated });
    tokens = [];
    coordinated = nextCoordinated;
  };
  const lexed = [...protectedText.matchAll(/\uE100(\d+)\uE101|[A-Za-z]+(?:['’][A-Za-z]+)?|[,;.!?:]|\n/g)].map(
    (match) =>
      match[1] === undefined
        ? { word: match[0].toLowerCase() }
        : { word: match[0], references: groups[Number(match[1])]?.references },
  );
  for (const [index, token] of lexed.entries()) {
    if (/^[;.!?\n]$/.test(token.word)) {
      flush(false);
      continue;
    }
    if (
      token.word === ':' &&
      tokens.every((part) => !part.references && /^(?:version|v|changelog|changes)$/.test(part.word))
    ) {
      flush(false);
      continue;
    }
    if (!tokens.length && /^(?:and|or|but|then|while|whereas)$/.test(token.word)) continue;
    if (/^(?:,|and|or|but|then|while|whereas)$/.test(token.word)) {
      let next = index + 1;
      if (/^(?:and|or|but|then)$/.test(lexed[next]?.word ?? '')) next++;
      const rest = lexed.slice(next);
      const predicate = referencePredicate(rest[0]);
      const newSubject = rest.some(
        (part, at) =>
          (HISTORY_AUX.test(part.word) || HISTORY_VERB.test(part.word)) &&
          filePhrase(rest.slice(0, at), true).length > 0,
      );
      const pronounSubject = /^(?:we|you|they|he|she|it|i)$/.test(rest[0]?.word ?? '');
      // A comma/and between file nouns is an enumeration until a preceding predicate establishes a
      // separate clause: "a, b and c were removed", versus "read a, b was removed".
      if (
        predicate ||
        pronounSubject ||
        (newSubject && (tokens.some(referencePredicate) || !filePhrase(tokens, true).length))
      ) {
        flush(true);
        continue;
      }
    }
    tokens.push(token);
  }
  flush(false);
  return clauses;
}

/** A direct file noun phrase, optionally enumerated; a prepositional complement is a different role. */
function filePhrase(tokens: readonly ReferenceToken[], whole: boolean): ReferenceToken[] {
  const first = tokens.findIndex((token) => token.references);
  if (first < 0) return [];
  const nominal = (prefix: readonly ReferenceToken[]) =>
    prefix.every(
      (token) =>
        !token.references &&
        /^[a-z]+$/.test(token.word) &&
        !PHRASE_BOUNDARY.test(token.word) &&
        !HISTORY_AUX.test(token.word) &&
        !REFERENCE_ACT.test(token.word) &&
        !/^(?:we|you|they|he|she|it|i|kept)$/.test(token.word),
    );
  if (!nominal(tokens.slice(0, first))) return [];
  const initial = tokens[first];
  if (!initial) return [];
  const found: ReferenceToken[] = [initial];
  let end = first + 1;
  while (end < tokens.length) {
    let next = end;
    while (/^(?:,|and|or)$/.test(tokens[next]?.word ?? '')) next++;
    if (next === end) break;
    let file = next;
    while (
      file < tokens.length &&
      !tokens[file]?.references &&
      /^[a-z]+$/.test(tokens[file]?.word ?? '') &&
      !referencePredicate(tokens[file]) &&
      !PHRASE_BOUNDARY.test(tokens[file]?.word ?? '')
    )
      file++;
    if (!tokens[file]?.references || !nominal(tokens.slice(next, file))) break;
    const nextFile = tokens[file];
    if (!nextFile) break;
    found.push(nextFile);
    end = file + 1;
  }
  return whole && tokens.slice(end).some((token) => !/^(?:,|and|or)$/.test(token.word)) ? [] : found;
}

/** A stated actor, or the omitted actor of a changelog entry; unknown predicates stay references. */
function historyActor(tokens: readonly ReferenceToken[]): boolean {
  let end = tokens.length;
  while (HISTORY_AUX.test(tokens[end - 1]?.word ?? '') || HISTORY_ADVERB.test(tokens[end - 1]?.word ?? ''))
    end--;
  const subject = tokens.slice(0, end);
  if (!subject.length || filePhrase(subject, true).length) return true;
  const words = subject.map((token) => token.word);
  if (words.length === 1 && /^(?:we|you|they|he|she|it|i|version|v)$/.test(words[0] ?? '')) return true;
  if (
    subject.some((token) => token.references || referencePredicate(token) || PHRASE_BOUNDARY.test(token.word))
  )
    return false;
  return (
    /s$/.test(words.at(-1) ?? '') ||
    (words.length > 1 &&
      /^(?:the|a|an|our|your|their|his|her|my|this|that|these|those|each|every)$/.test(words[0] ?? ''))
  );
}

/**
 * Completed transitive history marks an active object's occurrence or a passive subject's occurrence.
 * Replacement subjects and by/with/to complements stay current. Unknown roles stay references. An
 * auxiliary may be shared across coordinated passive clauses, but not across sentence boundaries.
 */
function pastFile(clauses: readonly ReferenceClause[]): Set<NamedReference> {
  const past = new Set<NamedReference>();
  let passiveBefore = false;
  for (const clause of clauses) {
    if (!clause.coordinated) passiveBefore = false;
    const tokens = clause.tokens;
    const passive = tokens.some((token) => !token.references && PASSIVE_AUX.test(token.word));
    for (let verb = 0; verb < tokens.length; verb++) {
      if (tokens[verb]?.references || !HISTORY_VERB.test(tokens[verb]?.word ?? '')) continue;
      if (
        !tokens
          .slice(0, verb)
          .some(
            (token) =>
              !token.references && (HISTORY_UNCERTAIN.test(token.word) || /n['’]t$/.test(token.word)),
          )
      ) {
        const before = tokens.slice(0, verb);
        let subjectEnd = before.length;
        while (HISTORY_ADVERB.test(before[subjectEnd - 1]?.word ?? '')) subjectEnd--;
        const hasAuxiliary = PASSIVE_AUX.test(before[subjectEnd - 1]?.word ?? '');
        if (hasAuxiliary) {
          while (
            HISTORY_AUX.test(before[subjectEnd - 1]?.word ?? '') ||
            HISTORY_ADVERB.test(before[subjectEnd - 1]?.word ?? '')
          )
            subjectEnd--;
        }
        const objects = filePhrase(tokens.slice(verb + 1), false);
        const subjects = filePhrase(before.slice(0, subjectEnd), true);
        const adjectival =
          !hasAuxiliary &&
          /^(?:a|an|the|this|that|these|those|its|their|our|your|my|his|her)$/.test(
            before[subjectEnd - 1]?.word ?? '',
          );
        const affected = hasAuxiliary
          ? subjects
          : passiveBefore && subjects.length && !objects.length
            ? subjects
            : adjectival || !historyActor(before)
              ? []
              : objects;
        for (const token of affected) for (const reference of token.references ?? []) past.add(reference);
      }
    }
    passiveBefore = passive;
  }
  return past;
}

// Lexical polarity, rather than sentence templates: syntax supplies tense, auxiliaries and scope.
const PROHIBITION_VERBS = new Set([
  'forbid',
  'prohibit',
  'disallow',
  'ban',
  'bar',
  'prevent',
  'avoid',
  'refrain',
]);
const PROHIBITION_STATES = new Set(['unable', 'inaccessible', 'refrain']);
const OMISSION_VERBS = new Set(['forget', 'fail', 'omit']);

/** The verdicts of `requiresAct`, by the marked text and the verbs asked about. */
const MENTION_VERDICTS = new Map<string, boolean>();
const MENTION_VERDICT_LIMIT = 16_384;
/** Stands for the mentioned path in a text the grammar reads: the verdict does not depend on how the path is spelled. */
const MENTION_MARKER = 'estatefilemarker';

/** Whether at least one mention requires the act, rather than forbidding it in its own clause. */
export function positiveMention(
  text: string,
  name: string,
  verbs: readonly string[],
  bareNever = false,
): boolean {
  if (name === '') return false;
  let offset = text.indexOf(name);
  while (offset >= 0) {
    // Substitute the path so dots and punctuation in filenames cannot create sentence boundaries.
    const marked = text.slice(0, offset) + MENTION_MARKER + text.slice(offset + name.length);
    // The grammar reads the marked text alone: lines that differ only in the path they name (the entries of an
    // index) share one verdict, so each distinct sentence shape is parsed once.
    const key = `${verbs.join(',')}\u0000${bareNever}\u0000${marked}`;
    let verdict = MENTION_VERDICTS.get(key);
    if (verdict === undefined) {
      verdict = requiresAct(marked, verbs, bareNever);
      if (MENTION_VERDICTS.size >= MENTION_VERDICT_LIMIT) MENTION_VERDICTS.clear();
      MENTION_VERDICTS.set(key, verdict);
    }
    if (verdict) return true;
    offset = text.indexOf(name, offset + name.length);
  }
  return false;
}

/** Whether the mention marked in `marked` requires the act in its own clause. */
function requiresAct(marked: string, verbs: readonly string[], bareNever: boolean): boolean {
  const actions = new Set(
    verbs.flatMap((verb) => [verb, `${verb}s`, `${verb}es`, `${verb}ing`, `${verb}ed`]),
  );
  const clause =
    nlp(marked.replace(/[\n;]/g, '. '))
      .clauses()
      .splitBefore('(and|or) (#Verb|#Negative)')
      .out('array')
      .find((part: string) => part.includes(MENTION_MARKER)) ?? marked;
  // A negation does not reach across a word that reverses or restarts the clause: "never proceed without
  // reading X" requires the read, "do not read X unless asked" forbids it.
  const segment = clause
    .split(/\b(?:without|unless|until|before|but|instead)\b/i)
    .find((part: string) => part.includes(MENTION_MARKER));
  const parsed = nlp((segment ?? clause).replace(/[‘’]/g, "'"));
  const terms = parsed.termList();
  const hasAction = terms.some((term) => actions.has(term.normal));
  if (!hasAction && !bareNever) return true;
  // Polarity belongs to the governing clause, including auxiliaries, passive prohibitions and
  // intervening adverbs. A semantic verb lexicon supplements the parser's grammatical negatives.
  const predicates = parsed.verbs().json() as Array<{ verb?: { infinitive?: string; negative?: boolean } }>;
  const prohibits =
    predicates.some(
      ({ verb }) =>
        (verb?.infinitive ?? '').split(' ').some((word) => PROHIBITION_VERBS.has(word)) && !verb?.negative,
    ) || terms.some((term) => PROHIBITION_STATES.has(term.normal));
  const negatives = predicates.filter(({ verb }) => verb?.negative);
  const reminder =
    negatives.length > 0 && negatives.every(({ verb }) => OMISSION_VERBS.has(verb?.infinitive ?? ''));
  const negative = terms.some((term) => term.tags?.has('Negative') || term.normal === 'no');
  return !prohibits && (!negative || reminder);
}

/**
 * A path a file names, relative to the root. It is tried, in order, from the naming file's folder, from the
 * root, then from each base folder the runtime declares; the first that names a file of the estate (or a file
 * the reader skipped on purpose, in `skipped`) wins. When none does, the path stays as the naming file's
 * folder gives it (from the root when it starts with `.claude/`), so the finding names where it was looked
 * for.
 */
export function resolveNamed(
  path: string,
  from: string,
  files: ReadonlyMap<string, EstateFile>,
  bases: readonly string[] = [],
  skipped: ReadonlySet<string> = new Set(),
): string {
  const clean = path.replace(/^\.\//, '');
  const candidates = [
    posix.join(posix.dirname(from), clean),
    clean,
    ...bases.map((base) => posix.join(base, clean)),
  ].map((candidate) => posix.normalize(candidate));
  const hit = candidates.find((candidate) => files.has(candidate) || skipped.has(candidate));
  if (hit !== undefined) return hit;
  if (clean.startsWith('.claude/')) return posix.normalize(clean);
  return candidates[0] as string;
}

/** Where a named path leads: one file, several candidates, or nowhere; and how it was found. */
export type NamedTarget = {
  path: string;
  via: 'place' | 'alias' | 'suffix' | 'external' | 'none';
  candidates?: string[];
};

/**
 * True when a path as written points outside the estate: it starts with `~/` or `/`, or it starts with one
 * of the external folders. Only the written form decides; a name is never guessed external.
 */
export function isExternal(path: string, externals: readonly string[] = []): boolean {
  const clean = path.replace(/^\.\//, '');
  if (clean.startsWith('~/') || clean.startsWith('/')) return true;
  return externals.some((root) => clean === root || clean.startsWith(root.endsWith('/') ? root : `${root}/`));
}

/**
 * A bare name tries its exact local folder, then its local subtree, before the estate root. Other
 * named paths resolve as `resolveNamed` does, then through the estate's aliases (`REF/a.md` as
 * `<folder>/a.md`), then by its ending: the longest tail of the path (its last segments, down to the bare
 * file name) that ends any file of the estate decides. One file: the path resolves to it. Several: the
 * reference is ambiguous and lists them.
 */
export function locateNamed(
  path: string,
  from: string,
  files: ReadonlyMap<string, EstateFile>,
  options: {
    bases?: readonly string[];
    skipped?: ReadonlySet<string>;
    aliases?: Readonly<Record<string, readonly string[]>>;
    byName?: ReadonlyMap<string, readonly string[]>;
    externals?: readonly string[];
  } = {},
): NamedTarget {
  const skipped = options.skipped ?? new Set<string>();
  const known = (candidate: string) => files.has(candidate) || skipped.has(candidate);
  const clean = path.replace(/^\.\//, '');
  const byName = options.byName ?? fileNames(files);
  // A bare name belongs to the naming file's own folder and subtree before the estate root.
  if (!clean.includes('/')) {
    const local = posix.normalize(posix.join(posix.dirname(from), clean));
    if (known(local)) return { path: local, via: 'place' };
    const folder = posix.dirname(from);
    if (folder !== '.') {
      const hits = (byName.get(clean) ?? []).filter((candidate) => candidate.startsWith(`${folder}/`));
      if (hits.length === 1) return { path: hits[0] as string, via: 'suffix' };
      if (hits.length > 1) return { path: local, via: 'none', candidates: [...hits].sort() };
    }
  }
  const placed = resolveNamed(path, from, files, options.bases ?? [], skipped);
  if (known(placed)) return { path: placed, via: 'place' };
  // A path written as outside the estate is not looked for by its ending: it names the outside, as written.
  if (isExternal(clean, options.externals ?? [])) return { path: clean, via: 'external' };
  if (isExternal(placed, options.externals ?? [])) return { path: placed, via: 'external' };
  const [head, ...rest] = clean.split('/');
  const folders = head !== undefined && rest.length > 0 ? (options.aliases?.[head] ?? []) : [];
  for (const folder of folders) {
    const candidate = posix.normalize(posix.join(folder, ...rest));
    if (known(candidate)) return { path: candidate, via: 'alias' };
  }
  // The ending is looked for among the estate's own files: a skipped file (node_modules, a test fixture)
  // is found only by its place, never as a candidate for a name.
  const segments = clean
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.' && segment !== '..');
  const named = byName.get(segments[segments.length - 1] ?? '') ?? [];
  for (let start = 0; start < segments.length; start++) {
    const tail = segments.slice(start).join('/');
    const hits = endingIn(named, tail);
    if (hits.length === 1) return { path: hits[0] as string, via: 'suffix' };
    if (hits.length > 1) return { path: placed, via: 'none', candidates: [...hits].sort() };
  }
  return { path: placed, via: 'none' };
}

/**
 * The files of one file name whose path is `tail` or ends with `/tail`. Many lines name the same path, and a
 * name such as `SKILL.md` is shared by many files, so the answer is kept per list of files and per tail. The
 * scanner gives a name a new list when it learns a new file; a list that grows in place drops what was kept.
 */
const ENDINGS = new WeakMap<readonly string[], { size: number; byTail: Map<string, string[]> }>();
function endingIn(named: readonly string[], tail: string): string[] {
  let kept = ENDINGS.get(named);
  if (!kept || kept.size !== named.length) {
    kept = { size: named.length, byTail: new Map() };
    ENDINGS.set(named, kept);
  }
  const { byTail } = kept;
  let hits = byTail.get(tail);
  if (!hits) {
    hits = named.filter((candidate) => candidate === tail || candidate.endsWith(`/${tail}`));
    byTail.set(tail, hits);
  }
  return hits;
}

/** Every file of the estate (and every skipped file) by its file name. */
export function fileNames(
  files: ReadonlyMap<string, EstateFile>,
  skipped: ReadonlySet<string> = new Set(),
): Map<string, string[]> {
  const byName = new Map<string, string[]>();
  for (const path of [...files.keys(), ...skipped]) {
    const name = basename(path);
    const paths = byName.get(name);
    if (paths) paths.push(path);
    else byName.set(name, [path]);
  }
  return byName;
}

/** The file-name index of an estate, built once per estate read. */
const NAME_INDEX = new WeakMap<RawEstate, Map<string, string[]>>();
function names(raw: RawEstate, files: ReadonlyMap<string, EstateFile>): Map<string, string[]> {
  const cached = NAME_INDEX.get(raw);
  if (cached) return cached;
  const built = fileNames(files);
  NAME_INDEX.set(raw, built);
  return built;
}

/** The paths the reader skipped, as a set built once per estate read. */
const SKIPPED = new WeakMap<RawEstate, Set<string>>();
function skippedOf(raw: RawEstate): Set<string> {
  const cached = SKIPPED.get(raw);
  if (cached) return cached;
  const built = new Set(raw.ignored?.paths ?? []);
  SKIPPED.set(raw, built);
  return built;
}

function referenceAtoms(
  chunk: ProseChunk,
  files: ReadonlyMap<string, EstateFile>,
  raw: RawEstate,
  builder: AtomBuilder,
): void {
  const skipped = skippedOf(raw);
  const standing = files.get(chunk.file)?.kind === 'standing';
  for (const line of chunkLines(chunk, files.get(chunk.file))) {
    // A standing line `@path` is an import: the runtime loads that file, so the agent reads nothing.
    if (standing && /^@\S+$/.test(line.text.trim())) continue;
    const references = namedReferences(line.text);
    if (!references.length) continue;
    const clauses = referenceClauses(line.text, references);
    const past = pastFile(clauses);
    const positive = new Set<NamedReference>();
    const parsed = new Set<NamedReference>();
    for (const clause of clauses) {
      for (const token of clause.tokens) {
        for (const reference of token.references ?? []) {
          // Other occurrences of this filename must retain their own grammatical roles.
          const context = clause.tokens
            .map((part) =>
              part.references?.includes(reference)
                ? reference.spelling
                : part.references
                  ? 'otherdocument'
                  : part.word,
            )
            .join(' ');
          parsed.add(reference);
          if (positiveMention(context, reference.spelling, ['read', 'open', 'load'])) positive.add(reference);
        }
      }
    }
    for (const reference of references) {
      const { path: named, spelling } = reference;
      if (past.has(reference)) continue;
      if (
        parsed.has(reference)
          ? !positive.has(reference)
          : !positiveMention(line.text, spelling, ['read', 'open', 'load'])
      )
        continue;
      const located = locateNamed(named, chunk.file, files, {
        bases: raw.bases ?? [],
        skipped,
        aliases: raw.aliases ?? {},
        byName: names(raw, files),
        externals: raw.externals ?? [],
      });
      const path = located.path;
      const target = files.get(path);
      const source = files.get(chunk.file);
      // A routing link loads the declared skill; it does not separately order a read of its definition.
      if (
        source &&
        routeNames(raw).definitions.has(path) &&
        routeSources(source, files, raw)
          .get(line.line)
          ?.some((route) => route.definition === path)
      )
        continue;
      const isSkipped = target === undefined && skipped.has(path);
      if (!target && !isSkipped && !DOCUMENT.test(path)) continue;
      if (target && (target.kind === 'guard_script' || SCRIPT.test(path))) continue;
      builder.add({
        kind: 'reference',
        title: `Read ${named}`,
        at: { file: chunk.file, startLine: line.line, endLine: line.line, quote: line.quote },
        evidence: [{ type: 'tool_called', label: raw.labels.read, input: { file_path: { contains: path } } }],
        situation: line.text,
        fields: {
          path,
          exists: target !== undefined || isSkipped,
          readWhen: line.text,
          from: chunk.file,
          ...(isSkipped ? { ignored: true } : {}),
          ...(located.via === 'alias' || located.via === 'suffix' ? { resolvedBy: located.via } : {}),
          ...(located.candidates ? { candidates: located.candidates } : {}),
          ...(located.via === 'external' ? { external: true } : {}),
        },
      });
    }
  }
}

type RouteSource = {
  line: number;
  quote: string;
  ask: string;
  target: string;
  isSkill: boolean;
  via: 'table' | 'prose' | 'heading';
  definition?: string;
};

const ROUTE_SOURCES = new WeakMap<RawEstate, Map<string, Map<number, RouteSource[]>>>();
const ROUTE_NAMES = new WeakMap<
  RawEstate,
  {
    skills: Set<string>;
    helpers: Set<string>;
    definitions: Map<string, string>;
    mentions: RegExp;
  }
>();

function routeNames(raw: RawEstate) {
  let index = ROUTE_NAMES.get(raw);
  if (!index) {
    index = {
      skills: new Set(raw.skills.map((skill) => skill.name)),
      helpers: new Set(raw.subagents.map((helper) => helper.name)),
      definitions: new Map(raw.skills.map((skill) => [skill.file, skill.name])),
      mentions: new RegExp(
        `(?<![\\w-])/?(${
          [...new Set([...raw.skills, ...raw.subagents].map((unit) => unit.name))]
            .sort((a, b) => b.length - a.length)
            .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('|') || '(?!)'
        })(?![\\w-])`,
        'g',
      ),
    };
    ROUTE_NAMES.set(raw, index);
  }
  return index;
}

/** Resolve only declared targets, retaining the distinction between a skill and a named agent. */
function routeTargets(
  cell: string,
  file: EstateFile,
  files: ReadonlyMap<string, EstateFile>,
  raw: RawEstate,
) {
  const { skills, helpers, definitions } = routeNames(raw);
  const targets = new Map<string, { target: string; isSkill: boolean; definition?: string }>();
  const add = (written: string, spelling = written, definition?: string) => {
    const clean = written
      .replace(/[`*]/g, '')
      .replace(/[.!]+$/, '')
      .trim();
    const helper = /^(?:the )?(.+?) agent$/i.exec(clean)?.[1];
    const target = (helper ?? clean.replace(/^the\s+/i, '').replace(/\s+skill$/i, '')).replace(/^\//, '');
    const isSkill = !(helper && helpers.has(helper)) && skills.has(target);
    if (
      (!isSkill && !helpers.has(target)) ||
      !positiveMention(cell, spelling, ['load', 'use', 'dispatch', 'call'], true)
    )
      return;
    targets.set(`${isSkill ? 'skill' : 'agent'}:${target}`, {
      target,
      isSkill,
      ...(definition ? { definition } : {}),
    });
  };
  const clean = cell.replace(/[`*]/g, '').trim();
  const explicitHelper = /^(?:the )?(.+?) agent[.!]?$/i.exec(clean)?.[1];
  if (explicitHelper && helpers.has(explicitHelper)) {
    add(clean, explicitHelper);
  } else {
    add(clean);
    for (const match of cell.matchAll(/`([^`]+)`/g)) add(match[1] ?? '');
  }
  for (const match of cell.matchAll(/\[[^\]]+\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const path = resolveNamed((match[1] ?? '').replace(/[#?].*$/, ''), file.path, files, raw.bases);
    const skill = definitions.get(path);
    if (skill) add(skill, match[0], path);
  }
  return [...targets.values()];
}

/**
 * Cell roles are grammatical evidence, not a vocabulary of table headings. A `limit` states what a unit does
 * not do ("Cannot book a berth", "Never use for payments"): it says when not to use the unit, so no route
 * comes from it.
 */
type RouteCell = 'request' | 'attribute' | 'fragment' | 'limit';
const ROUTE_CELL_CACHE = new Map<string, RouteCell>();

function routeCell(value: string): RouteCell {
  const cached = ROUTE_CELL_CACHE.get(value);
  if (cached) return cached;
  const role = readRouteCell(value);
  // Bound the lexical cache independently of how many estates a server reads.
  if (ROUTE_CELL_CACHE.size >= 4096) ROUTE_CELL_CACHE.clear();
  ROUTE_CELL_CACHE.set(value, role);
  return role;
}

/** The first words of a prohibition addressed to the reader, as opposed to a statement about the unit. */
const IMPERATIVE_LEADS = new Set([
  'do',
  "don't",
  'never',
  'must',
  "mustn't",
  'should',
  "shouldn't",
  'shall',
  'please',
]);

function readRouteCell(value: string): RouteCell {
  const text = value
    .replace(/[`*]/g, '')
    .replace(/^['"“]|['"”]$/g, '')
    .trim();
  if (!text) return 'fragment';
  // Paths, quantities, dates, code-only lists and scalar categories are attribute values.
  // They do not become requests because a table happens to contain a skill name.
  if (
    /^(?:https?:\/\/|[.~]?\/|[\w.-]+\/|[^\s@]+@)[^\s]*$/.test(text) ||
    /^v?\d+(?:[.:-]\d+)*(?:\s*[^\s]+)?$/.test(text) ||
    /^[\p{Sc}]\s*\d+(?:[.,]\d+)*$/u.test(text) ||
    /^(?:\s*`[^`]+`\s*[,;/&+]?\s*)+$/.test(value)
  )
    return 'attribute';
  const grammar = text.replace(/^(?:\p{Extended_Pictographic}|\uFE0F|\s)+/u, '');
  const terms = nlp(grammar).termList();
  const words = [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(grammar)].filter(
    (segment) => segment.isWordLike,
  ).length;
  if (words < 2) return 'attribute';
  if (terms.every((term) => term.tags?.has('Date') || term.tags?.has('Value') || term.tags?.has('Unit')))
    return 'attribute';
  if (
    /^\p{Lu}[\p{L}’'-]+(?:\s+\p{Lu}[\p{L}’'-]+){1,2}$/u.test(text) &&
    !terms.some((term) => term.tags?.has('Verb'))
  )
    return 'attribute';
  if (/[,;]\s*\S/.test(text) && text.split(/[,;]/).every((part) => !/\s/.test(part.trim())))
    return 'attribute';
  // A declarative negation that opens the cell ("Cannot ...", "Does not ...", "Won't ...", "Not for ...") negates
  // what the cell says about the unit. An imperative prohibition ("Do not ...", "Never ...") is a rule addressed to
  // the agent, which a table may bind to a unit, and a negation further in ("a tide that has not come in")
  // belongs to the situation described.
  const lead = terms.slice(0, 2);
  if (lead.some((term) => term.tags?.has('Negative')) && !IMPERATIVE_LEADS.has(lead[0]?.normal ?? ''))
    return 'limit';

  // Grammar may strengthen a decision, but a language-specific tagger is never a gate.
  // Distinct free multi-word phrases also describe requests in languages it cannot parse.
  return words >= 2 ? 'request' : 'fragment';
}

/** A unit used as the subject of a descriptive clause is a mention, not a target designation. */
function tableRouteTargets(
  cell: string,
  file: EstateFile,
  files: ReadonlyMap<string, EstateFile>,
  raw: RawEstate,
) {
  const targets = routeTargets(cell, file, files, raw);
  const index = routeNames(raw);
  for (const match of cell.matchAll(index.mentions)) {
    const target = match[1];
    if (!target || targets.some((entry) => entry.target === target) || cell.includes(`\`${target}\``))
      continue;
    // A plain name inside a sentence needs designation syntax: a terminal object or an
    // explicit unit noun. Otherwise an ordinary word that is also a skill can be incidental.
    const before = cell.slice(0, match.index).replace(/[*]/g, '').trim();
    const after = cell
      .slice((match.index ?? 0) + match[0].length)
      .replace(/[*]/g, '')
      .trim();
    if (before && !/^[.!]*$/.test(after) && !/^(?:skill|agent|helper)\b/i.test(after)) continue;
    targets.push({ target, isSkill: index.skills.has(target) });
  }
  if (!targets.length || targets.some((target) => target.definition)) return targets;
  const plain = cell.replace(/[`*]/g, '').trim();
  const first = targets
    .map((target) => ({ target, at: plain.indexOf(target.target) }))
    .filter((entry) => entry.at >= 0)
    .sort((a, b) => a.at - b.at)[0];
  if (!first) return [];
  const prefix = plain.slice(0, first.at).replace(/\/$/, '').trim();
  if (prefix && !/^(?:the)$/i.test(prefix)) {
    const terms = nlp(prefix).termList();
    return terms.some((term) => term.tags?.has('Negative') || term.normal === 'never') ? [] : targets;
  }
  const tail = plain
    .slice(first.at + first.target.target.length)
    .replace(/^\s+(?:skill|agent|helper)\b/i, '')
    .trim();
  if (!tail || /^[,;:()[\]—–→-]/.test(tail)) return targets;
  const predicate = nlp(tail).termList()[0];
  return !predicate?.tags?.has('Verb') || predicate.tags.has('Infinitive') ? targets : [];
}

/**
 * Repeated short values identify categories; distinct free phrases identify requests. A column whose header
 * holds a negation ("It cannot do", "Does not handle"), or whose cells mostly open with one, states limits.
 * A limit cell in another column is left out of its reading.
 */
function routeColumn(values: string[], header = ''): RouteCell {
  const filled = values.filter((value) => value.trim() !== '');
  if (!filled.length) return 'fragment';
  const roles = filled.map(routeCell);
  const limits = roles.filter((role) => role === 'limit').length;
  if (limits * 2 > filled.length || statesNegation(header)) return 'limit';
  const nonempty = filled.filter((_value, index) => roles[index] !== 'limit');
  const kept = roles.filter((role) => role !== 'limit');
  const counts = new Map<string, number>();
  for (const value of nonempty) {
    const key = value.replace(/[`*]/g, '').trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  // Repeated short labels are categorical evidence, including nominal phrases that an
  // English tagger might also parse as verbs. A unique free phrase needs no English parse.
  if (
    nonempty.length > 1 &&
    nonempty.every(
      (value) =>
        value.trim().split(/\s+/).length <= 4 &&
        (counts.get(value.replace(/[`*]/g, '').trim().toLowerCase()) ?? 0) > 1,
    )
  )
    return 'attribute';
  if (kept.every((role) => role === 'attribute')) return 'attribute';
  if (kept.every((role) => role === 'request')) return 'request';
  return 'fragment';
}

/** Whether a heading holds a negation anywhere: "It cannot do", "Does not handle", "Never use it for". */
function statesNegation(heading: string): boolean {
  const text = heading.replace(/[`*]/g, '').trim();
  return (
    text !== '' &&
    nlp(text)
      .termList()
      .some((term) => term.tags?.has('Negative'))
  );
}

function ambiguousRouteTable(
  raw: RawEstate,
  file: EstateFile,
  startLine: number,
  endLine: number,
  targets: Array<{ target: string; isSkill: boolean }>,
): void {
  const message = `Ambiguous routing table at lines ${startLine}-${endLine}: cell content does not decide request versus inventory; model review required.`;
  if (!raw.notes.some((note) => note.file === file.path && note.message === message))
    raw.notes.push({ file: file.path, message });
  const candidates = [
    ...new Map(
      targets.map((target) => [
        `${target.isSkill}:${target.target}`,
        { name: target.target, kind: target.isSkill ? ('skill' as const) : ('subagent' as const) },
      ]),
    ).values(),
  ];
  for (const chunk of raw.prose) {
    if (chunk.file !== file.path || chunk.endLine < startLine || chunk.startLine > endLine) continue;
    chunk.ambiguousRouting ??= [];
    const entries = chunk.ambiguousRouting;
    if (!entries.some((entry) => entry.startLine === startLine))
      entries.push({ startLine, endLine, targets: candidates, dispatch: raw.labels.dispatch });
  }
}

/** Routing is defined by a condition and an action, never by a name appearing in an arbitrary table. */
function routeSources(
  file: EstateFile,
  files: ReadonlyMap<string, EstateFile>,
  raw: RawEstate,
): Map<number, RouteSource[]> {
  let cache = ROUTE_SOURCES.get(raw);
  if (!cache) {
    cache = new Map();
    ROUTE_SOURCES.set(raw, cache);
  }
  const cached = cache.get(file.path);
  if (cached) return cached;
  const sources = new Map<number, RouteSource[]>();
  const add = (route: RouteSource) => {
    const row = sources.get(route.line) ?? [];
    row.push(route);
    sources.set(route.line, row);
  };
  const clean = (value: string) =>
    value
      .replace(/[`*]/g, '')
      .replace(/[.!]+$/, '')
      .trim();
  for (const table of readTables(file.text)) {
    const cells = table.rows.map((row) =>
      table.header.map((_header, column) => tableRouteTargets(row.cells[column] ?? '', file, files, raw)),
    );
    const targetColumns = table.header.flatMap((_header, column) =>
      cells.some((row) => (row[column]?.length ?? 0) > 0) ? [column] : [],
    );
    if (!targetColumns.length) continue;
    const roles = table.header.map((header, column) =>
      routeColumn(
        table.rows.map((row) => row.cells[column] ?? ''),
        header,
      ),
    );
    const pairs = targetColumns.flatMap((target) =>
      roles.flatMap((role, condition) =>
        condition !== target && role === 'request' ? [{ target, condition }] : [],
      ),
    );
    const conditions = new Set(pairs.map((pair) => pair.condition));
    if (conditions.size === 1 && new Set(pairs.map((pair) => pair.target)).size === 1) {
      const condition = pairs[0]?.condition;
      if (condition === undefined) continue;
      for (const [index, row] of table.rows.entries()) {
        const ask = clean(row.cells[condition] ?? '');
        if (!ask || routeCell(row.cells[condition] ?? '') === 'limit') continue;
        for (const { target: column } of pairs)
          for (const target of cells[index]?.[column] ?? []) {
            add({ ...target, ask, line: row.line, quote: row.text, via: 'table' });
          }
      }
    } else if (!roles.every((role) => role === 'attribute' || role === 'limit')) {
      ambiguousRouteTable(
        raw,
        file,
        table.headerLine,
        table.rows.at(-1)?.line ?? table.headerLine,
        cells.flat(2),
      );
    }
  }
  // Routing in prose and headings is read in the standing instructions, where routing lives; a skill body's
  // "when X, dispatch Y" is a step of that skill, not the routing of an ask.
  if (file.kind !== 'standing') {
    cache.set(file.path, sources);
    return sources;
  }
  const lines = chunkLines(
    { id: 'routing', file: file.path, startLine: 1, endLine: file.text.split('\n').length, text: file.text },
    file,
  );
  for (const [index, line] of lines.entries()) {
    const directive =
      /^(?:[-*+]\s+|\d+[.)]\s+)?(?:(?:to|for)\s+(.+?)\s*[:,]|(?:when|if|whenever)\s+(?:the user|a user|someone)?\s*(?:wants|asks|needs)?\s*(?:to\s+)?(.+?),)\s*(?:please\s+)?(?:always\s+)?(?:load|use|invoke|dispatch|call)\s+(.+?)\.?$/i.exec(
        line.text,
      );
    if (directive) {
      const ask = clean(directive[1] ?? directive[2] ?? '');
      for (const target of routeTargets(directive[3] ?? '', file, files, raw)) {
        add({ ...target, ask, line: line.line, quote: line.quote, via: 'prose' });
      }
    }
    const heading = /^#{1,6}\s+(.+?)\s*#*$/.exec(line.text);
    if (!heading) continue;
    const targets = routeTargets(heading[1] ?? '', file, files, raw);
    if (!targets.length) continue;
    for (let next = index + 1; next < lines.length; next++) {
      const following = lines[next];
      if (!following) break;
      if (/^#{1,6}\s/.test(following.text)) break;
      const condition =
        /^(?:use|load|invoke|dispatch|call)\s+(?:it|this(?:\s+skill|\s+agent|\s+helper)?)\s+(?:when|if|whenever|for)\s+(?:the user|a user|someone)?\s*(?:wants|asks|needs)?\s*(?:to\s+)?(.+?)\.?$/i.exec(
          following.text,
        );
      if (!condition) continue;
      for (const target of targets)
        add({
          ...target,
          ask: clean(condition[1] ?? ''),
          line: line.line,
          quote: line.quote,
          via: 'heading',
        });
      break;
    }
  }
  cache.set(file.path, sources);
  return sources;
}

function routeAtoms(
  chunk: ProseChunk,
  files: ReadonlyMap<string, EstateFile>,
  _names: { skills: Set<string>; subagents: Set<string> },
  raw: RawEstate,
  builder: AtomBuilder,
): void {
  const file = files.get(chunk.file);
  if (!file) return;
  const routes = routeSources(file, files, raw);
  for (let line = chunk.startLine; line <= chunk.endLine; line++) {
    for (const { quote, ask, target, isSkill, via } of routes.get(line) ?? []) {
      builder.add({
        kind: 'route',
        title: `An ask to ${ask} ${isSkill ? 'loads' : 'dispatches'} ${target}`,
        at: { file: chunk.file, startLine: line, endLine: line, quote },
        evidence: [
          isSkill
            ? { type: 'skill_loaded', name: target }
            : { type: 'tool_called', label: raw.labels.dispatch, input: { subagent_type: target } },
        ],
        situation: ask,
        fields: { target, targetKind: isSkill ? 'skill' : 'subagent', via, ask },
      });
    }
  }
}

/**
 * Read prerequisites are parsed as clauses. A line is first masked: each inline code span, markdown link
 * and quotation becomes one opaque token, so a file name, a quoted command or a quoted example is never
 * split, searched for directive words or mistaken for a rule. The masked line is cut into clauses at
 * sentence ends, semicolons and coordinated directives (", and read …"), and each clause is matched against
 * the forms below. The words in front of the verb read (its head) must give a directive: a polite, modal or
 * adverbial lead-in is kept, while a negated, optional or conditional head ("do not read", "you need not
 * read", "if you read") gives no gate.
 */
const OPEN_TOKEN = '\uE000';
const CLOSE_TOKEN = '\uE001';
const TOKEN = String.raw`\uE000\d+\uE001`;
/** What is read: one masked span, else the words up to the next form word. */
const TARGET = String.raw`(${TOKEN}|\S+)`;
const NEGATIVE = String.raw`(?:do\s+not|don't|never|must\s+not|mustn't|should\s+not|shouldn't|cannot|can't|may\s+not)`;
/** `prose`: the form ends on what is read, so a step in words ("the output of the build") may be read. */
const GATE_FORMS: Array<{
  form: string;
  pattern: RegExp;
  head: number[];
  read: number;
  act: number;
  prose?: boolean;
  positiveAct?: boolean;
  loaded?: boolean;
}> = [
  {
    form: 'requires-loaded',
    pattern: new RegExp(
      String.raw`^(.+?)\s+requires\s+(?:that\s+)?${TARGET}\s+(?:(?:to\s+)?be\s+)?(?:loaded|read)$`,
      'i',
    ),
    head: [],
    read: 2,
    act: 1,
    positiveAct: true,
    loaded: true,
  },
  {
    form: 'requires-reading',
    pattern: new RegExp(String.raw`^(.+?)\s+requires\s+(?:you\s+to\s+read|reading)\s+${TARGET}$`, 'i'),
    head: [],
    read: 2,
    act: 1,
    positiveAct: true,
  },
  {
    form: 'context-read-first',
    pattern: new RegExp(
      String.raw`^(?:to|for|when|if)\s+(.+?)\s*[:,]\s*(.*?)\bread\s+${TARGET}\s+first$`,
      'i',
    ),
    head: [2],
    read: 3,
    act: 1,
    positiveAct: true,
  },
  {
    form: 'read-first-context',
    pattern: new RegExp(String.raw`^(.*?)\bread\s+${TARGET}\s+first\s+(?:when|for)\s+(.+)$`, 'i'),
    head: [1],
    read: 2,
    act: 3,
  },
  {
    form: 'not-until-loaded',
    pattern: new RegExp(
      String.raw`^(.*?)\b${NEGATIVE}\s+(.+?)\s+until\s+${TARGET}\s+(?:is\s+|has\s+been\s+)(?:loaded|read)$`,
      'i',
    ),
    head: [1],
    read: 3,
    act: 2,
    loaded: true,
  },
  {
    form: 'before-required-loaded',
    pattern: new RegExp(
      String.raw`^(.*?)\bbefore\s+([^,:]+?)\s*[:,]\s*${TARGET}\s+(?:must|shall)\s+be\s+(?:loaded|read)$`,
      'i',
    ),
    head: [1],
    read: 3,
    act: 2,
    loaded: true,
  },
  {
    form: 'before-read',
    pattern: new RegExp(String.raw`^(.*?)\bbefore\s+([^,:]+?)\s+(?:please\s+)?read\s+${TARGET}$`, 'i'),
    head: [1],
    read: 3,
    act: 2,
    positiveAct: true,
  },
  {
    form: 'before-colon-read',
    pattern: new RegExp(String.raw`^(.*?)\bbefore\s+([^:]+?)\s*:\s*(.*?)\bread\s+(${TOKEN}|.+)$`, 'i'),
    head: [1, 3],
    read: 4,
    act: 2,
    prose: true,
  },
  {
    form: 'before-comma-read',
    pattern: new RegExp(String.raw`^(.*?)\bbefore\s+([^,:]+?)\s*,\s*(.*?)\bread\s+(${TOKEN}|.+)$`, 'i'),
    head: [1, 3],
    read: 4,
    act: 2,
    prose: true,
  },
  {
    form: 'prior-to-read',
    pattern: new RegExp(
      String.raw`^(.*?)\bprior\s+to\s+([^,:]+?)\s*[:,]\s*(.*?)\bread\s+(${TOKEN}|.+)$`,
      'i',
    ),
    head: [1, 3],
    read: 4,
    act: 2,
    prose: true,
  },
  {
    form: 'read-first-then',
    pattern: new RegExp(String.raw`^(.*?)\bread\s+${TARGET}\s+first,?\s+(?:and\s+)?then\s+(.+)$`, 'i'),
    head: [1],
    read: 2,
    act: 3,
  },
  {
    form: 'read-before',
    pattern: new RegExp(String.raw`^(.*?)\bread\s+${TARGET}(?:\s+first)?\s+before\s+(.+)$`, 'i'),
    head: [1],
    read: 2,
    act: 3,
  },
  {
    form: 'not-until-read',
    pattern: new RegExp(
      String.raw`^(.*?)\b${NEGATIVE}\s+(.+?)\s+until\s+(?:you\s+have\s+|you've\s+|you\s+|after\s+)?(?:read|reading)\s+(?:the\s+output\s+of\s+)?(${TOKEN}|.+)$`,
      'i',
    ),
    head: [1],
    read: 3,
    act: 2,
    prose: true,
  },
  {
    form: 'not-without-reading',
    pattern: new RegExp(
      String.raw`^(.*?)\b${NEGATIVE}\s+(.+?)\s+without\s+(?:first\s+)?(?:reading|having\s+read)\s+${TARGET}`,
      'i',
    ),
    head: [1],
    read: 3,
    act: 2,
  },
  {
    form: 'only-after-reading',
    pattern: new RegExp(
      String.raw`^(.+?)\s+only\s+(?:after|once)\s+(?:you\s+have\s+|you've\s+|having\s+)?(?:reading|read)\s+${TARGET}`,
      'i',
    ),
    head: [],
    read: 2,
    act: 1,
  },
  {
    form: 'question-read-first',
    pattern: new RegExp(String.raw`^(.+?)\?\s*(.*?)\bread\s+${TARGET}\s+first\b`, 'i'),
    head: [2],
    read: 3,
    act: 1,
  },
];

/** A clause led by one of these is a condition or a purpose, not the directive itself. */
const SUBORDINATE =
  /^(?:if|when|whenever|unless|whether|because|although|though|since|once|while|after|as\s+soon\s+as|in\s+case)\b/;
/** A head with one of these words lifts the requirement: "do not read", "you need not read", "optionally read". */
const NEGATED = /\b(?:not|never|no|nor|neither|cannot|optional|optionally)\b|n't\b/;

/** Whether the words before "read" make it a directive: no negation, and not itself a condition. */
export function directiveHead(head: string): boolean {
  const segments = head
    .toLowerCase()
    .replace(/[*_]/g, '')
    .split(/[,:]/)
    .map((segment) => segment.trim());
  const main = segments.pop() ?? '';
  if (SUBORDINATE.test(main) || NEGATED.test(main)) return false;
  // A leading condition ("If no objection is raised,") may hold a negation of its own; any other lead-in may not.
  return segments.every((segment) => SUBORDINATE.test(segment) || !NEGATED.test(segment));
}

type MaskedLine = { text: string; spans: string[] };

/** Replace code spans, links and quotations with tokens; a code span around one plain word is emphasis. */
export function maskLine(line: string): MaskedLine {
  const spans: string[] = [];
  const token = (span: string) => `${OPEN_TOKEN}${spans.push(span) - 1}${CLOSE_TOKEN}`;
  const text = line
    .replace(/`([^`\n]+)`/g, (span, inner: string) => (/^[A-Za-z]+$/.test(inner) ? inner : token(span)))
    .replace(/\[[^\]\n]*\]\((?:<[^>\n]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g, token)
    .replace(/"[^"\n]+"|\u201C[^\u201D\n]+\u201D/g, token)
    .replace(
      /(^|[\s(])('[^'\n]+')(?=$|[\s.,;:!?)])/g,
      (_match, lead: string, span: string) => lead + token(span),
    );
  return { text, spans };
}

export function unmask(text: string, spans: readonly string[]): string {
  let out = text;
  const pattern = new RegExp(TOKEN, 'g');
  // A link's text may hold a masked code span: unmask until no token is left.
  while (pattern.test(out)) {
    pattern.lastIndex = 0;
    out = out.replace(pattern, (token) => spans[Number(token.slice(1, -1))] ?? '');
  }
  return out;
}

/** Cut a masked line into directive clauses; masked spans are never cut. */
export function gateClauses(text: string, splitCoordinated = true): string[] {
  const clauses: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const next = text[index + 1];
    const end = char === ';' || ((char === '.' || char === '!') && (next === undefined || /\s/.test(next)));
    if (!end) continue;
    const prefix = text
      .slice(start, index + 1)
      .replace(/[*`]/g, '')
      .trim();
    // A numbered list, a rule label or an abbreviation ("e.g.") is not the end of a directive.
    if (char === '.' && /^(?:[-+]\s*)?(?:\d+|[A-Z]+#?\d+)\.$/i.test(prefix)) continue;
    if (char === '.' && /\b(?:e\.g|i\.e|etc|vs|cf)\.$/i.test(prefix)) continue;
    clauses.push(text.slice(start, index));
    start = index + 1;
  }
  clauses.push(text.slice(start));
  return clauses
    .flatMap((clause) => (splitCoordinated ? clause.split(/,\s*(?:and|but)\s+(?=\S)/i) : [clause]))
    .map((clause) =>
      clause
        .replace(/\*\*/g, '')
        .replace(/^\s*(?:[-+*]\s+)?(?:\d+[.)]\s+)?(?:[A-Z]+#?\d+[.:]\s+)?/i, '')
        .trim(),
    )
    .filter((clause) => clause !== '');
}

/**
 * The thing to read: a masked span, else a path-like word, else (where the form allows) the words of the
 * clause, a step to run. A bare word such as "it" or "them" names nothing to read first.
 */
function gateTarget(raw: string, spans: readonly string[], prose: boolean): string {
  const text = raw.trim();
  const span = new RegExp(`^${TOKEN}`).exec(text);
  if (span) return unmask(span[0], spans);
  const word = /^\S+/.exec(text)?.[0] ?? '';
  if (/[/\\]|\.[A-Za-z0-9]+[.,:;!?)]*$/.test(word)) return word.replace(/[.,:;!?)]+$/, '');
  return prose ? unmask(text, spans).replace(/[.,:;!?]+$/, '') : '';
}

const GATE_HEADINGS = new WeakMap<EstateFile, Array<{ text: string; line: number }>>();
const READ_FIRST_ONLY = new RegExp(String.raw`^(.*?)\bread\s+${TARGET}\s+first$`, 'i');

function gateHeadings(source: EstateFile | undefined): Array<{ text: string; line: number }> {
  if (!source) return [];
  const held = GATE_HEADINGS.get(source);
  if (held) return held;
  const headings = linesOf(blankFences(source.text)).flatMap((line) => {
    const match = /^#{1,6}\s+(.+)$/.exec(line.text);
    return match ? [{ text: (match[1] ?? '').replace(/[*`]/g, '').trim(), line: line.line }] : [];
  });
  GATE_HEADINGS.set(source, headings);
  return headings;
}

function gateAtoms(
  chunk: ProseChunk,
  files: ReadonlyMap<string, EstateFile>,
  raw: RawEstate,
  builder: AtomBuilder,
): void {
  const source = files.get(chunk.file);
  const headings = gateHeadings(source);
  let headingIndex = -1;
  for (const line of chunkLines(chunk, files.get(chunk.file))) {
    const { text, spans } = maskLine(line.text);
    while (headings[headingIndex + 1] && (headings[headingIndex + 1]?.line ?? 0) < line.line) headingIndex++;
    for (const decorated of gateClauses(text)) {
      // Attention punctuation is decoration; neither its presence nor its absence establishes order.
      const original = decorated.replace(/^[!‼]+\s*|\s*[!‼]+$/g, '');
      const heading = headings[headingIndex];
      const contextual =
        heading && READ_FIRST_ONLY.test(original) && !original.includes('?') && isAct(heading.text);
      const clause = contextual ? `${original}, then ${heading.text}` : original;
      for (const { form, pattern, head, read, act, prose, positiveAct, loaded } of GATE_FORMS) {
        const match = pattern.exec(clause);
        if (!match) continue;
        if (!head.every((group) => directiveHead(unmask(match[group] ?? '', spans)))) continue;
        const target = gateTarget(match[read] ?? '', spans, prose === true || loaded === true);
        const named = namedPaths(`Read ${target}`)[0];
        const first = named ?? target.replace(/[`*"'\u201C\u201D]/g, '').trim();
        const trigger = unmask(match[act] ?? '', spans)
          .replace(/[`*]/g, '')
          .trim();
        // A condition scopes an obligation; it is not the act the read must precede.
        const scoped = /^(?:if|when|whenever|unless)\b[^,]+,\s*(.+)$/i.exec(trigger);
        const action = scoped?.[1] ?? trigger;
        if (first === '' || trigger === '' || !isAct(action)) continue;
        // Negation of the requirement sits at the predicate boundary, not in its object
        // ("editing optional metadata requires …" still requires the read).
        if (positiveAct && /\b(?:not|never|optional|optionally|[a-z]+n't)\s*$/i.test(action)) continue;
        // A file is a path the reference tokenizer accepts (a code span may hold spaces), else one bare word.
        const isFile = /\.[A-Za-z0-9]+$/.test(first) && (named !== undefined || !/\s/.test(first));
        const skill = loaded ? raw.skills.find((skill) => skill.name === first) : undefined;
        if (loaded && !isFile && !skill) continue;
        const located = isFile
          ? locateNamed(first, chunk.file, files, {
              bases: raw.bases ?? [],
              skipped: skippedOf(raw),
              aliases: raw.aliases ?? {},
              byName: names(raw, files),
              externals: raw.externals ?? [],
            })
          : undefined;
        const path = located?.path;
        const before = skill ? `skill:${skill.name}` : isFile ? raw.labels.read : raw.labels.shell;
        const after = actLabel(action, raw);
        const evidence: EvidencePredicate[] = [
          { type: 'ordered', before, after },
          skill
            ? { type: 'skill_loaded', name: skill.name }
            : path
              ? { type: 'tool_called', label: raw.labels.read, input: { file_path: { contains: path } } }
              : { type: 'tool_called', label: raw.labels.shell, input: { command: { contains: first } } },
        ];
        builder.add({
          kind: 'gate',
          title: `Read ${first} before ${trigger}`,
          at:
            contextual && source && heading
              ? {
                  file: chunk.file,
                  startLine: heading.line,
                  endLine: line.line,
                  quote: source.text
                    .split('\n')
                    .slice(heading.line - 1, line.line)
                    .join('\n')
                    .trim(),
                }
              : { file: chunk.file, startLine: line.line, endLine: line.line, quote: line.quote },
          evidence,
          situation: /^(?:if|when|whenever|unless)\b[^,]+,/i.test(clause) ? unmask(clause, spans) : trigger,
          fields: {
            form,
            first,
            trigger,
            ...(skill ? { skill: skill.name } : {}),
            ...(path ? { path } : {}),
            ...(located?.via === 'alias' || located?.via === 'suffix' ? { resolvedBy: located.via } : {}),
            ...(located?.candidates ? { candidates: located.candidates } : {}),
            ...(located?.via === 'external' ? { external: true } : {}),
          },
        });
        break;
      }
    }
  }
}

/** Verbs of the acts a gate can come before, with their -ing forms. */
const ACT_VERBS = new Set(
  [
    ['edit', 'editing'],
    ['write', 'writing'],
    ['change', 'changing'],
    ['modify', 'modifying'],
    ['save', 'saving'],
    ['create', 'creating'],
    ['commit', 'committing'],
    ['push', 'pushing'],
    ['run', 'running'],
    ['deploy', 'deploying'],
    ['dispatch', 'dispatching'],
    ['delegate', 'delegating'],
    ['update', 'updating'],
    ['rename', 'renaming'],
    ['delete', 'deleting'],
    ['remove', 'removing'],
    ['merge', 'merging'],
    ['send', 'sending'],
    ['publish', 'publishing'],
    ['release', 'releasing'],
    ['reply', 'replying'],
    ['answer', 'answering'],
    ['call', 'calling'],
    ['move', 'moving'],
    ['copy', 'copying'],
    ['install', 'installing'],
    ['open', 'opening'],
    ['close', 'closing'],
  ].flat(),
);

/**
 * An act the agent performs: its first word, after a subject (you, we, the agent), is a verb of acting. A
 * time ("9 in the morning"), a meal or a past event ("the audit last year") is no act, nor is a feeling.
 */
function isAct(trigger: string): boolean {
  const words = trigger
    .toLowerCase()
    .replace(/^(you|we|i|the agent|the assistant)\s+/, '')
    // "before you can edit": a modal after the subject is not the act.
    .replace(/^(?:can|may|must|should|will|shall)\s+/, '')
    .split(/\s+/);
  const first = words[0] ?? '';
  // An -ing form names an act in a gate (matching a line, posting a reply); else a verb of the list.
  // "anything", "something": a pronoun, not an -ing form.
  if (ACT_VERBS.has(first) || (first.length > 5 && first.endsWith('ing') && !first.endsWith('thing')))
    return true;
  // Grammar admits new imperative verbs without growing an estate-specific action vocabulary.
  if (nlp(words.join(' ')).termList()[0]?.tags?.has('Imperative')) return true;
  // "every ticket edit", "each change": an act named as a noun after a quantifier.
  return ['every', 'each', 'any'].includes(first) && words.slice(1).some((word) => ACT_VERBS.has(word));
}

/** The tool an act names: editing is an edit, committing or running is a shell call; else the act itself. */
function actLabel(act: string, raw: RawEstate): string {
  const verb = act.toLowerCase();
  if (/\b(edit|editing|change|changing|modify|modifying|update|updating)\b/.test(verb))
    return raw.labels.edit;
  if (/\b(write|writing|save|saving|create|creating)\b/.test(verb)) return raw.labels.write;
  if (
    /\b(commit|committing|push|pushing|run|running|deploy|deploying|rename|renaming|move|moving)\b/.test(verb)
  )
    return raw.labels.shell;
  if (/\b(dispatch|dispatching|delegate|delegating)\b/.test(verb)) return raw.labels.dispatch;
  return act;
}

function hazardAtoms(chunk: ProseChunk, files: ReadonlyMap<string, EstateFile>, builder: AtomBuilder): void {
  if (!files.has(chunk.file)) return;
  for (const line of chunkLines(chunk, files.get(chunk.file))) {
    const text = withoutHazardExamples(line.text);
    for (const hazard of HAZARDS) {
      if (!hazard.pattern.test(text) || !runtimeHazard(hazard.id, text)) continue;
      builder.add({
        kind: 'hazard',
        title: `Recover from ${hazard.title.toLowerCase()}`,
        at: { file: chunk.file, startLine: line.line, endLine: line.line, quote: line.quote },
        evidence: [{ type: 'custom', name: 'hazard_recovery', options: { hazard: hazard.id } }],
        situation: hazard.title,
        fields: { hazard: hazard.id },
      });
    }
  }
}

/**
 * Quoted and colon-introduced payloads are samples by syntax, independent of the carrier's vocabulary.
 * A recovery condition, operational signal definition, or explicit runtime receiver preserves its event.
 */
function operationalHazardQuote(prefix: string, suffix: string): boolean {
  if (/\b(?:if|when|after|once|upon)\b[^,:]*$/i.test(prefix)) return true;
  if (/:\s*$/.test(prefix)) return false;
  const operation =
    /^\s*(?:[-+*]\s+|\d+[.)]\s+)?(?:you\s+)?(?:(?:must|should|always)\s+)?(?:treat|interpret|recognize|recognise|regard|consider|take)\b/i.test(
      prefix,
    ) &&
    /^\s+as\s+(?:(?:an?|the|your)\s+)?(?:runtime\s+)?(?:signal|trigger|condition|event|error|warning)\b/i.test(
      suffix,
    );
  const effect = /^\s+(?:means?|signals?|indicates?|requires?|triggers?)\b/i.test(suffix);
  return operation || effect;
}

function withoutHazardExamples(text: string): string {
  const quoted = text.replace(
    /`[^`\n]+`|"(?:\\.|[^"\\\n])*"|\u201C[^\u201D\n]*\u201D|(?<!\w)'(?:\\.|[^'\\\n])*'|\u2018[^\u2019\n]*\u2019/g,
    (quote, offset: number) => {
      const prefix =
        text
          .slice(0, offset)
          .split(/[;!?]|\.(?=\s|$)/)
          .at(-1) ?? '';
      const suffix = text.slice(offset + quote.length).split(/[;!?]|\.(?=\s|$)/)[0] ?? '';
      // Quoted content after a carrier is a sample unless grammar makes it an event to handle.
      if (
        !prefix.trim() ||
        operationalHazardQuote(prefix, suffix) ||
        messageDirection(prefix, suffix) === true
      )
        return quote;
      return ' '.repeat(quote.length);
    },
  );
  // Mask only the colon payload's clause; a later recovery instruction remains independent.
  return quoted.replace(
    /(^|[;.!?])([^;.!?]*?):\s+([^;.!?]*)/g,
    (clause, lead: string, head: string, payload: string) =>
      /\b(?:if|when|after|once|upon)\b[^,:]*$/i.test(head) || messageDirection(head, '') === true
        ? clause
        : `${lead}${head}: ${' '.repeat(payload.length)}`,
  );
}

/**
 * An event with no owner is about the runtime in an instruction estate. Explicit owners still matter:
 * equipment restarts, commercial rate limits, customer messages and course sessions are domain work,
 * not events that interrupt the assistant. Keep incoming notifications from helpers as runtime events.
 */
function runtimeHazard(id: (typeof HAZARDS)[number]['id'], text: string): boolean {
  const line = text.replace(/[`*]/g, '').replace(/[‘’]/g, "'");
  const eventLine = text.replace(/\*/g, '').replace(/[‘’]/g, "'");
  switch (id) {
    case 'compaction': {
      const runtime = line.replace(
        /\b(?:supplier|customer|client)(?:'s)?\s+(?:conversation|context)(?: window)? (?:is summari[sz]ed|fills? up|is full)\b/gi,
        '',
      );
      return HAZARDS.find((hazard) => hazard.id === id)?.pattern.test(runtime) ?? false;
    }
    case 'restart':
      return runtimeTransition(eventLine, RESTART_EVENT, true);
    case 'rate_wave':
      return runtimeRateLimit(eventLine);
    case 'nudge_storm':
      // A nudge the agent receives (repeated nudges, a hook nudges the agent), never the agent nudging a
      // value of the work ("nudge the price up").
      return [
        ...line.matchAll(
          /\bnudg(?:e|es|ed|ing)\b(\s+(?:up\s+|down\s+)?(?:the|a|an|this|that|these|those|its|their|our|your|my|it|them)\b(?:\s+(\w+))?)?/gi,
        ),
      ].some(
        (match) =>
          match[1] === undefined ||
          /^(?:agent|assistant|model|session|helper|subagent|claude|guard|hook)$/i.test(match[2] ?? ''),
      );
    case 'notification':
      return (
        !/\b(?:send|deliver|post|email)\b[^.;!?]*\bnotifications?\b/i.test(line) ||
        /\b(?:helper|subagent|worker|guard|hook)\b/i.test(line)
      );
    case 'session_boundary':
      // Resumption requires a named runtime participant: "resume" can also name a document. New-session forms
      // retain their existing behavior, independently of a resumption elsewhere on the same line.
      if (RESUMPTION_EVENT.test(line) && runtimeTransition(eventLine, RESUMPTION_EVENT, false)) return true;
      return (
        SESSION_START_EVENT.test(line) &&
        !/\bsession\s+(?:of|for|in)\s+(?:the\s+|a\s+)?(?:training|course|class|workshop|lesson)\b/i.test(line)
      );
    default:
      return true;
  }
}

/** The actor of an explicit call/use relationship, independent of the system's name. */
function dependencyActor(phrase: string): string | undefined {
  const relation =
    /\b(?:that|which)\s+(.+?)\s+(?:calls?|uses?|invokes?|quer(?:y|ies))\s*$|\b(?:called|used|invoked|queried)\s+by\s+(.+)$/i.exec(
      phrase.trim(),
    );
  return relation?.[1] ?? relation?.[2];
}

function runtimeDependency(phrase: string): boolean {
  const actor = dependencyActor(phrase);
  return actor !== undefined && runtimeParticipant(actor);
}

/** Possessors stay with runtime roles; dependencies require an explicit call/use relationship. */
function runtimeParticipant(phrase: string): boolean {
  if (runtimeDependency(phrase)) return true;
  const owner = phrase
    .trim()
    .replace(/^(?:(?:the|a|an|our|your|my|this|current|own|(?:agent|assistant|worker|subagent)'s)\s+)+/i, '');
  return /^(?:i|me|we|us|you|(?:agent|assistant|worker|subagent|session|process|runtime|machine|model|claude)(?:\s+(?:session|process|runtime))?)$/i.test(
    owner,
  );
}

/** A service can limit the agent's calls too; restarting a request is not restarting the runtime. */
function rateRecipient(phrase: string): boolean {
  return (
    runtimeParticipant(phrase) ||
    /^(?:(?:our|your|my|own|(?:the\s+)?(?:agent|assistant|worker|subagent)'s)\s+)+(?:outgoing\s+)?(?:calls|requests)$/i.test(
      phrase.trim(),
    )
  );
}

/** The local subject, without clause introducers, auxiliaries or adverbs of the event. */
function eventSubject(before: string): string {
  const clause =
    before.split(/[.;,:!?]|\b(?:if|when|after|before|once|unless|while|and|or|but|then)\b/i).at(-1) ?? '';
  return clause
    .trim()
    .replace(/^(?:on|upon|following|during|at|should|would|could|did|does)\s+/i, '')
    .replace(
      /\s+(?:(?:is|are|am|was|were|be|been|being|has|have|had|gets?|got|will|would|can|could|may|might|must|should|shall|\w+ly)\s*)+$/i,
      '',
    )
    .trim();
}

/** A direct object stops at a clause or preposition; temporal adjuncts do not name a target. */
function eventObject(after: string): string {
  const object = (
    after
      .trim()
      .replace(/^(?:\w+ly\s*)+/i, '')
      .split(
        /[.;,:!?]|\b(?:if|when|after|before|once|unless|while|and|or|but|then|to|from|by|on|at|for|during|where|with|in|inside|outside|without|through|under|over|around|near|beneath|beside|behind|beyond|within|along|across|towards?|onto|into|upon|until|since|amid|among|between|despite)\b/i,
      )[0] ?? ''
  ).trim();
  const temporal =
    /^(?:the\s+)?(?:this|next|last|following|previous)\s+(?:morning|afternoon|evening|night|day|week|month|year)$|^(?:today|tomorrow|yesterday|tonight|overnight|again|later|earlier)$/i;
  // An object pronoun is complete before any following time, manner, or place adjunct.
  const pronoun = /^(?:me|us|you|it|them|him|her)\b/i.exec(object);
  return temporal.test(object) ? '' : (pronoun?.[0] ?? object);
}

function unownedEvent(subject: string): boolean {
  return /^(?:(?:on|upon|following|during|a|an|the|each|every|any|repeated|multiple|several|many|few|one|two|three|four|five|six|seven|eight|nine|ten|\d+|wave|waves|of)\s*)*$/i.test(
    subject,
  );
}

/** A reported message keeps its receiver or issuer even when its event words are quoted. */
function messageDirection(before: string, after: string): boolean | undefined {
  const verbs = [
    ...before.matchAll(
      /\b(gets?|got|receives?|received|hits?|hit|encounters?|encountered|returns?|returned|responds?|responded|answers?|answered|replies|replied|tells?|told|asks?|asked|instructs?|instructed)\b/gi,
    ),
  ];
  const verb = verbs.at(-1);
  if (!verb) return undefined;
  if (/^(?:tell|told|ask|instruct)/i.test(verb[0]))
    return runtimeParticipant(eventObject(before.slice((verb.index ?? 0) + verb[0].length)));
  const actor = eventSubject(before.slice(0, verb.index));
  if (/^(?:get|got|receive|hit|encounter)/i.test(verb[0])) return rateRecipient(actor);
  const recipient = /^\s+(?:(?:is|was|gets?)\s+(?:returned|sent|shown)\s+)?(?:to|for)\s+(.+)/i.exec(after);
  if (recipient) return rateRecipient(eventObject(recipient[1] ?? ''));
  if (dependencyActor(actor) !== undefined) return runtimeDependency(actor);
  if (/^(?:our|my|your|we|i)\b/i.test(actor) || runtimeParticipant(actor)) return false;
  return undefined;
}

/**
 * Resolve an event inside a message against its own clause, while preserving explicit outer receivers
 * and issuers. Parenthetical illustrations are adjuncts, not direct objects of an adjacent event.
 * Descriptive quotations have already been removed by withoutHazardExamples.
 */
function eventContext(
  line: string,
  event: { 0: string; index?: number },
): { before: string; after: string } | undefined {
  const at = event.index ?? 0;
  let before = line.slice(0, at);
  let after = line.slice(at + event[0].length);
  const spans = line.matchAll(
    /`[^`\n]+`|"(?:\\.|[^"\\\n])*"|“[^”\n]*”|(?<!\w)'(?:\\.|[^'\\\n])*'|\([^()\n]*\)/g,
  );
  for (const span of spans) {
    const start = span.index ?? 0;
    if (start >= at || start + span[0].length <= at) continue;
    const outerBefore = line.slice(0, start);
    const outerAfter = line.slice(start + span[0].length);
    const direction = messageDirection(outerBefore, outerAfter);
    if (direction === false) return undefined;
    const body = span[0].slice(1, -1);
    const local = at - start - 1;
    const innerBefore = body.slice(0, local).replace(/["“”]/g, '');
    const innerAfter = body.slice(local + event[0].length).replace(/["“”]/g, '');
    const response = /\b(?:returns?|returned|responds?|responded|answers?|answered|replies|replied)\b/i.test(
      outerBefore,
    );
    if (unownedEvent(eventSubject(innerBefore))) {
      before = `${outerBefore}${innerBefore}`;
      after = response ? outerAfter : `${innerAfter}${outerAfter}`;
      // A quoted, unowned event in a reported message inherits its receiver, not the carrier noun.
      if (
        (direction === true || operationalHazardQuote(outerBefore, outerAfter)) &&
        !response &&
        !/^(?:429s?)$/i.test(body.trim())
      )
        before = innerBefore;
    } else if (
      !outerBefore.trim() ||
      direction !== undefined ||
      operationalHazardQuote(outerBefore, outerAfter)
    ) {
      before = innerBefore;
      after = innerAfter;
    }
    break;
  }
  // Parentheses are adjuncts unless they supply an event's explicit participant ("of the kiosk").
  const aside = /\((?!\s*of\b)[^()]*\)/gi;
  return { before: before.replace(aside, ' '), after: after.replace(aside, ' ') };
}

/** In a passive event the subject undergoes it; in an active transitive event the object does. */
function runtimeTransition(line: string, eventPattern: RegExp, allowUnowned: boolean): boolean {
  return [...line.matchAll(new RegExp(eventPattern.source, 'gi'))].some((event) => {
    const context = eventContext(line, event);
    if (!context) return false;
    const { before, after } = context;
    const subject = eventSubject(before);
    const passive =
      /ed$/i.test(event[0]) &&
      /\b(?:is|are|am|was|were|be|been|being|gets?|got)\b(?:\s+\w+ly)*\s*$/i.test(before);
    const complement = after.replace(/^\s*\(\s*of\s+([^)]*)\)/i, ' $1').replace(/^\s+of\s+/i, ' ');
    const candidate = eventObject(complement);
    // Only a directly attached noun phrase supplies a restart target. Unclear complements are
    // adjuncts: ownership falls back to the event's subject, never to a list of domain nouns.
    const nounPhrase =
      /^(?:(?:the|an?|this|that|these|those|my|your|our|its|their|his|her|own|some|each|every|any|all|both)\s+|(?:me|us|you|it|them|him|her)\b|[A-Z][\w'-]*\b)/.test(
        candidate,
      );
    const object = nounPhrase || runtimeParticipant(candidate) ? candidate : '';
    // With no actor, plural "restarts" names events, not an imperative acting on the next phrase.
    if (/^(?:restart|reboot)s$/i.test(event[0]) && unownedEvent(subject))
      return /^\s+of\s+/i.test(after) ? runtimeParticipant(object) : true;
    // In "a process restart invalidates state", process modifies the event noun, not its verb.
    const nominal =
      /^(?:restart|reboot)$/i.test(event[0]) &&
      /\b(?:agent|assistant|worker|subagent|session|process|runtime|machine|model|claude)\s*$/i.test(before);
    if (nominal && !/^\s+of\s+/i.test(after)) return runtimeParticipant(subject);
    if (!passive && object) {
      // A reflexive target inherits its actor's ownership, not a global meaning for "its process".
      const target = runtimeParticipant(subject)
        ? object.replace(/^(?:its|their)\s+own\s+/i, 'own ')
        : object;
      return runtimeParticipant(target);
    }
    return runtimeParticipant(subject) || (allowUnowned && unownedEvent(subject));
  });
}

/**
 * Limits are runtime hazards when the agent or a dependency receives them. A service reply needs an
 * explicit recipient, call relationship, or recovery instruction; describing a status is insufficient.
 */
function runtimeRateLimit(line: string): boolean {
  return [...line.matchAll(new RegExp(RATE_LIMIT_EVENT.source, 'gi'))].some((event) => {
    const context = eventContext(line, event);
    if (!context) return false;
    const { before, after } = context;
    const receipt =
      /\b(?:gets?|got|receives?|received|hits?|hit|encounters?|encountered)\s+(?:(?:an?|the|[\w-]+'s)\s+)*(?:HTTP(?:\s+status)?\s+|status(?:\s+code)?\s+)?$/i.exec(
        before,
      );
    if (receipt) return rateRecipient(eventSubject(before.slice(0, receipt.index)));
    const response =
      /\b(?:returns?|returned|responds?|responded|answers?|answered|replies|replied)\s+(?:with\s+)?(?:an?\s+)?(?:HTTP(?:\s+status)?\s+|status(?:\s+code)?\s+)?$/i.exec(
        before,
      );
    if (response) {
      const recipient = /^\s+(?:response\s+|status\s+|error\s+)?to\s+(.+)/i.exec(after);
      if (recipient) return rateRecipient(eventObject(recipient[1] ?? ''));
      const requester =
        /^\s+(?:when|if|whenever)\s+(.+?)\s+(?:sends?|makes?|exceeds?|requests?|crosses?|uses?)\b/i.exec(
          after,
        );
      if (requester) return rateRecipient(requester[1] ?? '');
      const source = eventSubject(before.slice(0, response.index));
      if (dependencyActor(source) !== undefined) return runtimeDependency(source);
      return (
        runtimeDependency(source) ||
        (!runtimeParticipant(source) &&
          !/^(?:our|my|your|we|i)\b/i.test(source) &&
          /\b(?:if|when|once)\b[^;.!?]*,\s*[a-z]+\b/i.test(line))
      );
    }
    // An active limiter names its recipient as the object; imposing a policy is not receiving one.
    const verb = /^throttl/i.test(event[0]) || /^rate[- ]limit/i.test(event[0]);
    const passive =
      /ed$/i.test(event[0]) &&
      /\b(?:is|are|am|was|were|be|been|being|gets?|got)\b(?:\s+\w+ly)*\s*$/i.test(before);
    const object = eventObject(after);
    const subject = eventSubject(before);
    if (verb && !passive && object && !unownedEvent(subject))
      return (!rateRecipient(subject) || runtimeDependency(subject)) && rateRecipient(object);
    if (verb && !passive && object && /^throttles?$/i.test(event[0])) return false;
    const scope = /^\s+(?:for|on|of)\s+(.+)/i.exec(after);
    if (scope) return rateRecipient(eventObject(scope[1] ?? ''));
    if (rateRecipient(subject)) return true;
    if (/^429/i.test(event[0])) {
      // A bare invoice number is not an HTTP event. Status/error/response forms name an event.
      return (
        /^(?:an?\s*)?(?:HTTP(?:\s+status)?|status(?:\s+code)?)?\s*$/i.test(subject) &&
        (/\bHTTP\b|\bstatus\b/i.test(before) || /^\s+(?:error|response|status)\b/i.test(after))
      );
    }
    return unownedEvent(subject);
  });
}

/**
 * The non-blank lines of a chunk, numbered as lines of its file. The reader and every code pass read each
 * chunk, so the lines are kept per chunk and source; a caller reads them and never changes them.
 */
const MASKED_PROSE = new WeakMap<EstateFile, string[]>();
const CHUNK_LINES = new WeakMap<
  ProseChunk,
  { source: EstateFile | undefined; lines: Array<{ line: number; text: string; quote: string }> }
>();
export function chunkLines(
  chunk: ProseChunk,
  source?: EstateFile,
): Array<{ line: number; text: string; quote: string }> {
  const kept = CHUNK_LINES.get(chunk);
  if (kept && kept.source === source) return kept.lines;
  const lines = maskedChunkLines(chunk, source);
  CHUNK_LINES.set(chunk, { source, lines });
  return lines;
}

function maskedChunkLines(
  chunk: ProseChunk,
  source?: EstateFile,
): Array<{ line: number; text: string; quote: string }> {
  let masked: string;
  if (source) {
    let lines = MASKED_PROSE.get(source);
    if (!lines) {
      const body = ['skill', 'skill_file', 'subagent'].includes(source.kind)
        ? readFrontmatter(source.text).bodyLine
        : 1;
      const original = source.text.split('\n');
      lines = blankFences(original.map((line, index) => (index < body - 1 ? '' : line)).join('\n')).split(
        '\n',
      );
      MASKED_PROSE.set(source, lines);
    }
    masked = lines.slice(chunk.startLine - 1, chunk.endLine).join('\n');
  } else masked = blankFences(chunk.text);
  const original = chunk.text.split('\n');
  return linesOf(masked)
    .filter((line) => line.text !== '')
    .map((line) => ({
      line: chunk.startLine + line.line - 1,
      text: line.text,
      quote: original[line.line - 1]?.trim() ?? line.text,
    }));
}

/** `Bash` for `Bash(git status)`. */
export function toolBase(rule: string): string {
  return rule.replace(/\(.*$/, '').trim();
}

function firstLine(file: EstateFile): Located {
  const line = linesOf(file.text).find((entry) => entry.text !== '' && !entry.text.startsWith('#!'));
  const chosen = line ?? linesOf(file.text).find((entry) => entry.text !== '');
  return {
    file: file.path,
    startLine: chosen?.line ?? 1,
    endLine: chosen?.line ?? 1,
    quote: chosen?.text ?? basename(file.path),
  };
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
