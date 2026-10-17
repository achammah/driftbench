import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { CustomCheckFunction } from '@agent-nexus/driftbench-checks';
import type {
  AgentAdapter,
  Embedder,
  ImplDef,
  KindDef,
  ObjectRegistry,
  TargetRef,
} from '@agent-nexus/driftbench-core';
import type { JudgeClient } from '@agent-nexus/driftbench-judges';
import type { Io } from './io';

/**
 * Plugins: modules of the team's own code that the CLI loads before it runs a command. A plugin registers
 * adapters (so a target such as `http:my-bot` reaches the team's agent), custom checks (the names a spec
 * lists under `rules.custom`), pairwise judges (the names `compare --pairwise-judge` takes), embedders
 * (the names `--embedder` takes), and the parts of the rules framework: object kinds, rule and diagnostic
 * step implementations (named `plugin:<name>` by an item), evidence names, prompt templates, and objects of
 * its own, which users reference by id. A plugin never replaces what driftbench ships or another plugin
 * registered: to change a shipped object, a plugin ships an object that extends it.
 *
 * The CLI loads a plugin from two places only: the `plugins` list of the project config (`driftbench.yaml`
 * in the working folder, or the file `--config` names) and the `--plugin <module>` flag. It never loads one
 * from a spec file. A plugin is code and runs with the rights of the person who runs the CLI: list only
 * modules you trust, as you would a test file.
 *
 * With no plugin, nothing here runs and every command behaves as before.
 */

/** What lives as long as one campaign: a temporary folder for sandboxes, removed when the campaign closes. */
export type PluginScope = { tempDir(): Promise<string> };

/** Makes the adapter of one target. Undefined when the plugin has none for this agent name. */
export type PluginAdapterFactory = (
  target: TargetRef,
  scope?: PluginScope,
) => AgentAdapter | undefined | Promise<AgentAdapter | undefined>;

/** What a plugin registers with. */
export type PluginApi = {
  /** The working folder of the CLI run. */
  readonly cwd: string;
  /** The adapter of every target `<name>:<agent>`, such as `http:my-bot` for the name `http`. */
  adapter(name: string, factory: PluginAdapterFactory): void;
  /** A custom check, run on every block of a spec that lists `name` under `rules.custom`. */
  check(name: string, check: CustomCheckFunction): void;
  /** A judge that `compare --pairwise-judge <name>` uses. */
  pairwiseJudge(name: string, factory: () => JudgeClient): void;
  /** An embedder the similarity check scores with when a run passes `--embedder <name>`. */
  embedder(name: string, factory: () => Embedder | Promise<Embedder>): void;
  /** A new object kind, such as `policy/routing`. A kind driftbench or another plugin has is refused. */
  kind(name: string, def: PluginKind): void;
  /** The implementation of a rule of `kind`, which an item names as `plugin:<name>`. */
  rule(kind: string, name: string, impl: PluginImpl): void;
  /** A new evidence name a rule of `kind` may read in its `when`, and the function that computes it. */
  evidence(kind: string, name: string, compute: PluginFunction): void;
  /** A step a diagnostic object's `steps` may name as `plugin:<name>`. */
  diagnosticStep(name: string, step: PluginFunction | PluginImpl): void;
  /** A prompt template with its named parts and the parser of its answers, referenced by its id. */
  promptTemplate(id: string, parts: Readonly<Record<string, string>>, contract: PluginFunction): void;
  /** An object file of the plugin's own, read from a path relative to the plugin's folder. */
  object(path: string): void;
};

/** A function a plugin gives the framework: an implementation, an evidence computation, a parser. */
// biome-ignore lint/suspicious/noExplicitAny: the framework calls it with arguments of the kind's choosing.
export type PluginFunction = (...args: any[]) => unknown;

/** An implementation: the schema its item's params must pass (zod's, or one with `safeParse`), and its code. */
export type PluginImpl = { params?: ImplDef['params']; run: PluginFunction; summary?: string };

/** A new object kind: one line for listings, whether a change reruns the agent, and its own top-level fields. */
export type PluginKind = {
  summary: string;
  agentFacing?: boolean;
  itemsKey?: string;
  fields?: KindDef['fields'];
};

/** A prompt template a plugin registered: its parts, its parser and the fingerprint of its parts. */
export type PluginPromptTemplate = {
  id: string;
  parts: Readonly<Record<string, string>>;
  contract: PluginFunction;
  fingerprint: string;
  owner: string;
};

/** A plugin: a function that registers adapters, checks and judges. A plugin module exports it as default. */
export type DriftbenchPlugin = (api: PluginApi) => void | Promise<void>;

/** Returns the plugin unchanged; it gives a plugin module the types of `PluginApi`. */
export function definePlugin(plugin: DriftbenchPlugin): DriftbenchPlugin {
  return plugin;
}

let adapters = new Map<string, { factory: PluginAdapterFactory; owner: string }>();
let judges = new Map<string, { factory: () => JudgeClient; owner: string }>();
let embedders = new Map<string, { factory: () => Embedder | Promise<Embedder>; owner: string }>();
/** Checks a plugin named, not yet in the registry of the checks package, which loads only when one exists. */
let pendingChecks = new Map<string, { check: CustomCheckFunction; owner: string }>();
/** The registry of the checks package, once a plugin check made it load. */
let checkRegistry:
  | {
      register(name: string, check: CustomCheckFunction): unknown;
      unregister(name: string): boolean;
      get(name: string): CustomCheckFunction | undefined;
    }
  | undefined;
/** The checks the plugins of this run added to that registry, each with the plugin that added it. */
let checks = new Map<string, string>();

/** One registration a plugin made with the rules framework, applied once the plugin function returns. */
type ObjectRegistration =
  | { what: 'kind'; name: string; def: PluginKind }
  | { what: 'impl'; kind: string; name: string; impl: PluginImpl; label: 'rule' | 'diagnostic step' }
  | { what: 'kind-check'; kind: string; label: string }
  | { what: 'object'; path: string };

/** The framework registrations of the plugin running now, in call order. */
let pendingObjects: ObjectRegistration[] = [];
/** The owner of every framework name the plugins of this run registered: `kind:<name>`, `plugin:<name>`, ... */
let objectOwners = new Map<string, string>();
/** The evidence names the plugins of this run added, by `<kind> <name>`. */
let evidence = new Map<string, { compute: PluginFunction; owner: string }>();
/** The prompt templates the plugins of this run added, by id. */
let templates = new Map<string, PluginPromptTemplate>();
/** What the object registry held before the first framework registration of this run, to put back after it. */
let objectsBefore:
  | { registry: ObjectRegistry; snapshot: ReturnType<ObjectRegistry['snapshot']>; clear: () => void }
  | undefined;

/** The judge names `compare --pairwise-judge` already knows; a plugin judge takes another name. */
const BUILTIN_JUDGES = ['openai', 'anthropic', 'google'];

/** A registration a plugin may not make. Its message is the whole line the user reads. */
class PluginRefusal extends Error {}

const NEVER_REPLACES = 'A plugin never replaces a check: give it another name.';

/**
 * Forgets every adapter, judge and check the plugins registered in the current scope. A
 * plugin only ever adds a check under a free name, so removing what the plugins added leaves the registry of
 * the checks package exactly as it was before them.
 */
export function resetPlugins(): void {
  adapters.clear();
  judges.clear();
  embedders.clear();
  for (const name of checks.keys()) checkRegistry?.unregister(name);
  checks.clear();
  pendingChecks.clear();
  pendingObjects = [];
  objectOwners.clear();
  evidence.clear();
  templates.clear();
  if (objectsBefore !== undefined) {
    objectsBefore.registry.restore(objectsBefore.snapshot);
    objectsBefore.clear();
    objectsBefore = undefined;
  }
}

/** Opens an isolated run and returns its cleanup, preserving any caller-owned registrations. */
export function beginPluginRun(): () => void {
  const previous = {
    adapters,
    judges,
    embedders,
    pendingChecks,
    checks,
    pendingObjects,
    objectOwners,
    evidence,
    templates,
    objectsBefore,
  };
  adapters = new Map();
  judges = new Map();
  embedders = new Map();
  pendingChecks = new Map();
  checks = new Map();
  pendingObjects = [];
  objectOwners = new Map();
  evidence = new Map();
  templates = new Map();
  objectsBefore = undefined;
  return () => {
    resetPlugins();
    ({
      adapters,
      judges,
      embedders,
      pendingChecks,
      checks,
      pendingObjects,
      objectOwners,
      evidence,
      templates,
      objectsBefore,
    } = previous);
  };
}

function refuseDuplicate(kind: string, name: string, owner: string, earlier: string | undefined): void {
  if (earlier !== undefined) {
    throw new PluginRefusal(
      `The plugin ${owner} registers the ${kind} ${name}, which the plugin ${earlier} already registered. A plugin never replaces ${kind === 'adapter' ? 'an' : 'a'} ${kind}: give it another name.`,
    );
  }
}

/** The adapter a plugin registered for the target, or undefined. */
export async function pluginAdapter(
  target: TargetRef,
  scope?: PluginScope,
): Promise<AgentAdapter | undefined> {
  const factory = adapters.get(target.adapter)?.factory;
  return factory === undefined ? undefined : factory(target, scope);
}

/** The adapter names the plugins registered, sorted. */
export function pluginAdapterNames(): string[] {
  return [...adapters.keys()].sort();
}

/** The pairwise judge a plugin registered under the name, or undefined. */
export function pluginPairwiseJudge(name: string): JudgeClient | undefined {
  return judges.get(name)?.factory();
}

/** The embedder a plugin registered under the name, made now, or undefined. */
export async function pluginEmbedder(name: string): Promise<Embedder | undefined> {
  const factory = embedders.get(name)?.factory;
  return factory === undefined ? undefined : factory();
}

/** The function a plugin registered for the evidence name of a kind, or undefined. */
export function pluginEvidence(kind: string, name: string): PluginFunction | undefined {
  return evidence.get(`${kind} ${name}`)?.compute;
}

/** The evidence names the plugins registered for a kind, sorted. */
export function pluginEvidenceNames(kind: string): string[] {
  return [...evidence.keys()]
    .filter((key) => key.startsWith(`${kind} `))
    .map((key) => key.slice(kind.length + 1))
    .sort();
}

/** The prompt template a plugin registered under the id, or undefined. */
export function pluginPromptTemplate(id: string): PluginPromptTemplate | undefined {
  return templates.get(id);
}

const NAME = /^[a-z0-9][a-z0-9._-]*$/;
/** A framework name a plugin registers: lower case, digits, `.`, `_`, `-`, and `/` between parts. */
const FRAMEWORK_NAME = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/;
const NEVER_REPLACES_SHIPPED =
  'A plugin never replaces what driftbench ships or another plugin registered: give it another name, or ship an object that extends it.';

function frameworkName(what: string, name: string): void {
  if (typeof name !== 'string' || !FRAMEWORK_NAME.test(name)) {
    throw new Error(
      `the ${what} name ${JSON.stringify(name)} is not a plain name: lower case letters, digits, ., _, - and / between parts`,
    );
  }
}

/** Claims a framework name for the plugin; a name the plugins of this run already hold is refused. */
function claim(key: string, label: string, owner: string): void {
  const earlier = objectOwners.get(key);
  if (earlier !== undefined) {
    throw new PluginRefusal(
      `The plugin ${owner} registers the ${label}, which the plugin ${earlier} already registered. ${NEVER_REPLACES_SHIPPED}`,
    );
  }
  objectOwners.set(key, owner);
}

/** The fingerprint of a template's parts: the content hash of their canonical JSON, as an object's hash is. */
async function fingerprint(parts: Readonly<Record<string, string>>): Promise<string> {
  const { contentHash } = await import('@agent-nexus/driftbench-core');
  return contentHash(parts);
}

function apiFor(cwd: string, owner: string, folder: string): PluginApi {
  return {
    cwd,
    adapter(name, factory) {
      if (!NAME.test(name))
        throw new Error(`the adapter name ${JSON.stringify(name)} is not a target prefix`);
      if (typeof factory !== 'function') throw new Error(`the adapter ${name} needs a factory function`);
      refuseDuplicate('adapter', name, owner, adapters.get(name)?.owner);
      adapters.set(name, { factory, owner });
    },
    check(name, check) {
      const earlier = pendingChecks.get(name)?.owner ?? checks.get(name);
      refuseDuplicate('check', name, owner, earlier);
      pendingChecks.set(name, { check, owner });
    },
    pairwiseJudge(name, factory) {
      if (BUILTIN_JUDGES.includes(name)) {
        throw new Error(
          `the judge name ${name} is built in (${BUILTIN_JUDGES.join(', ')}): a plugin judge needs another name`,
        );
      }
      if (typeof factory !== 'function') throw new Error(`the judge ${name} needs a factory function`);
      refuseDuplicate('judge', name, owner, judges.get(name)?.owner);
      judges.set(name, { factory, owner });
    },
    embedder(name, factory) {
      if (!NAME.test(name)) throw new Error(`the embedder name ${JSON.stringify(name)} is not a plain name`);
      if (typeof factory !== 'function') throw new Error(`the embedder ${name} needs a factory function`);
      refuseDuplicate('embedder', name, owner, embedders.get(name)?.owner);
      embedders.set(name, { factory, owner });
    },
    kind(name, def) {
      frameworkName('kind', name);
      if (typeof def?.summary !== 'string' || def.summary === '') {
        throw new Error(`the kind ${name} needs a summary: one line for listings`);
      }
      claim(`kind ${name}`, `object kind ${name}`, owner);
      pendingObjects.push({ what: 'kind', name, def });
    },
    rule(kind, name, impl) {
      frameworkName('rule', name);
      if (typeof impl?.run !== 'function') throw new Error(`the rule ${name} needs a run function`);
      claim(`impl plugin:${name}`, `implementation plugin:${name}`, owner);
      pendingObjects.push({ what: 'impl', kind, name, impl, label: 'rule' });
    },
    evidence(kind, name, compute) {
      frameworkName('evidence', name);
      if (typeof compute !== 'function')
        throw new Error(`the evidence ${name} needs a function that computes it`);
      claim(`evidence ${kind} ${name}`, `evidence ${name} of ${kind}`, owner);
      evidence.set(`${kind} ${name}`, { compute, owner });
      pendingObjects.push({ what: 'kind-check', kind, label: `the evidence ${name}` });
    },
    diagnosticStep(name, step) {
      frameworkName('diagnostic step', name);
      const impl = typeof step === 'function' ? { run: step } : step;
      if (typeof impl?.run !== 'function')
        throw new Error(`the diagnostic step ${name} needs a run function`);
      claim(`impl plugin:${name}`, `implementation plugin:${name}`, owner);
      pendingObjects.push({ what: 'impl', kind: 'diagnostic', name, impl, label: 'diagnostic step' });
    },
    promptTemplate(id, parts, contract) {
      frameworkName('prompt template', id);
      if (
        parts === null ||
        typeof parts !== 'object' ||
        Object.values(parts).some((part) => typeof part !== 'string')
      ) {
        throw new Error(`the prompt template ${id} needs its parts as a map of named texts`);
      }
      if (typeof contract !== 'function')
        throw new Error(`the prompt template ${id} needs the parser of its answers`);
      claim(`template ${id}`, `prompt template ${id}`, owner);
      templates.set(id, { id, parts: { ...parts }, contract, fingerprint: '', owner });
    },
    object(path) {
      if (typeof path !== 'string' || path === '') throw new Error('object takes the path of an object file');
      pendingObjects.push({ what: 'object', path: resolve(folder, path) });
    },
  };
}

/**
 * Applies the framework registrations of one plugin to the object registry of the core package, in call order.
 * A kind, an implementation or an object the registry already holds is refused: the registry keeps what it
 * had. Every object is resolved at once, so a plugin object that names an unknown item, kind or
 * implementation stops the run here, never a later command.
 */
async function registerPendingObjects(owner: string): Promise<void> {
  const pending = pendingObjects;
  pendingObjects = [];
  for (const template of templates.values()) {
    if (template.fingerprint === '') template.fingerprint = await fingerprint(template.parts);
  }
  if (pending.length === 0) return;
  const core = await import('@agent-nexus/driftbench-core');
  const registry = core.objectRegistry;
  objectsBefore ??= { registry, snapshot: registry.snapshot(), clear: core.clearObjectContexts };
  const added: Array<{ kind: string; id: string }> = [];
  for (const entry of pending) {
    if (entry.what === 'kind') {
      if (registry.kind(entry.name) !== undefined) {
        throw new PluginRefusal(
          `The plugin ${owner} registers the object kind ${entry.name}, which driftbench already has. ${NEVER_REPLACES_SHIPPED}`,
        );
      }
      registry.registerKind({
        kind: entry.name,
        summary: entry.def.summary,
        agentFacing: entry.def.agentFacing ?? false,
        ...(entry.def.itemsKey === undefined ? {} : { itemsKey: entry.def.itemsKey }),
        ...(entry.def.fields === undefined ? {} : { fields: entry.def.fields }),
      });
    } else if (entry.what === 'kind-check') {
      if (registry.kind(entry.kind) === undefined) {
        throw new PluginRefusal(
          `The plugin ${owner} registers ${entry.label} for the kind ${entry.kind}, which no one registered.`,
        );
      }
    } else if (entry.what === 'impl') {
      if (registry.kind(entry.kind) === undefined) {
        throw new PluginRefusal(
          `The plugin ${owner} registers the ${entry.label} ${entry.name} for the kind ${entry.kind}, which no one registered.`,
        );
      }
      const name = `plugin:${entry.name}`;
      if (registry.impl(name) !== undefined) {
        throw new PluginRefusal(
          `The plugin ${owner} registers the implementation ${name}, which is already registered. ${NEVER_REPLACES_SHIPPED}`,
        );
      }
      // `run` rides on the implementation for the engine that calls it; the resolver reads `params` only.
      registry.registerImpl(name, {
        params: entry.impl.params ?? ANY_PARAMS,
        ...(entry.impl.summary === undefined ? {} : { summary: entry.impl.summary }),
        run: entry.impl.run,
      } as ImplDef);
    } else {
      let raw: unknown;
      try {
        raw = core.parseObjectText(readFileSync(entry.path, 'utf8'), entry.path).raw;
      } catch (cause) {
        throw new PluginRefusal(
          `The plugin ${owner} gives the object ${entry.path}, which does not load: ${reason(cause)}`,
        );
      }
      const head = (raw ?? {}) as { kind?: unknown; id?: unknown };
      const key = `${String(head.kind)}:${String(head.id)}`;
      const held = registry.shipped().some(({ raw: other }) => {
        const known = (other ?? {}) as { kind?: unknown; id?: unknown };
        return `${String(known.kind)}:${String(known.id)}` === key;
      });
      if (held) {
        throw new PluginRefusal(
          `The plugin ${owner} gives the object ${key}, which driftbench or another plugin already ships. ${NEVER_REPLACES_SHIPPED}`,
        );
      }
      claim(`object ${key}`, `object ${key}`, owner);
      registry.registerShipped(raw, entry.path);
      added.push({ kind: String(head.kind), id: String(head.id) });
    }
  }
  core.clearObjectContexts();
  const store = new core.ObjectStore(registry);
  for (const { kind, id } of added) {
    try {
      store.resolve(kind, id);
    } catch (cause) {
      throw new PluginRefusal(
        `The plugin ${owner} gives the object ${kind}:${id}, which does not resolve: ${reason(cause)}`,
      );
    }
  }
}

/** The params schema of an implementation that declares none: any params, unchecked. */
const ANY_PARAMS = {
  safeParse: (value: unknown) => ({ success: true, data: value }),
} as unknown as ImplDef['params'];

/**
 * Puts the checks the plugins named into the registry of the checks package. A name that registry already
 * holds, from the caller or from any other module, is refused: the registry keeps what it had.
 */
async function registerPendingChecks(): Promise<void> {
  if (pendingChecks.size === 0) return;
  checkRegistry ??= (await import('@agent-nexus/driftbench-checks')).defaultRegistry;
  try {
    for (const [name, { check, owner }] of pendingChecks) {
      if (checkRegistry.get(name) !== undefined) {
        throw new PluginRefusal(
          `The plugin ${owner} registers the check ${name}, which is already registered outside the plugins of this run. ${NEVER_REPLACES}`,
        );
      }
      checkRegistry.register(name, check);
      checks.set(name, owner);
    }
  } finally {
    pendingChecks.clear();
  }
}

/** Runs one plugin and registers its checks. The reason of a failure as one line, or undefined. */
async function runPlugin(
  plugin: DriftbenchPlugin,
  cwd: string,
  owner: string,
  folder = cwd,
): Promise<string | undefined> {
  try {
    await plugin(apiFor(cwd, owner, folder));
    await registerPendingChecks();
    await registerPendingObjects(owner);
    return undefined;
  } catch (cause) {
    pendingChecks.clear();
    pendingObjects = [];
    return cause instanceof PluginRefusal ? cause.message : `The plugin ${owner} failed: ${reason(cause)}`;
  }
}

/** Runs plugins given in code, in order. Returns the reason of the first failure, for exit 2. */
export async function applyPlugins(
  plugins: readonly DriftbenchPlugin[],
  cwd: string,
): Promise<string | undefined> {
  for (const [index, plugin] of plugins.entries()) {
    const failure = await runPlugin(plugin, cwd, `given in code (${index + 1})`);
    if (failure !== undefined) return failure;
  }
  return undefined;
}

/** One plugin to load: the module as written, and the folder a relative path starts from. */
export type PluginSource = { module: string; from: string };

/**
 * Loads each module and runs the plugin it exports (its default export, or the export named `plugin`).
 * Returns the reason of the first failure, for exit 2; undefined when all loaded.
 */
export async function loadPlugins(
  sources: readonly PluginSource[],
  cwd: string,
): Promise<string | undefined> {
  const seen = new Set<string>();
  for (const source of sources) {
    // A module named twice, in the config and by the flag, is one plugin: it runs once.
    const where = locate(source);
    if (seen.has(where)) continue;
    seen.add(where);
    let loaded: Record<string, unknown>;
    try {
      loaded = (await import(where)) as Record<string, unknown>;
    } catch (cause) {
      return `Cannot load the plugin ${source.module}: ${reason(cause)}`;
    }
    const plugin = typeof loaded.default === 'function' ? loaded.default : loaded.plugin;
    if (typeof plugin !== 'function') {
      return `The plugin ${source.module} exports no function: export it as default, (api) => { ... }`;
    }
    const folder = where.startsWith('file:') ? dirname(fileURLToPath(where)) : cwd;
    const failure = await runPlugin(plugin as DriftbenchPlugin, cwd, source.module, folder);
    if (failure !== undefined) return failure;
  }
  return undefined;
}

/** A file (a path relative to `from`, or absolute) as a file URL; else a package name resolved from `from`. */
function locate(source: PluginSource): string {
  const { module, from } = source;
  const path = resolve(from, module);
  if (module.startsWith('.') || isAbsolute(module) || existsSync(path)) return pathToFileURL(path).href;
  try {
    return pathToFileURL(createRequire(join(from, 'driftbench-plugin.js')).resolve(module)).href;
  } catch {
    return module;
  }
}

function reason(cause: unknown): string {
  return cause instanceof Error ? (cause.message.split('\n')[0] ?? '') : String(cause);
}

/** The arguments without `--plugin <module>` and `--plugin=<module>`, and the modules they named. */
export function pluginArgs(argv: readonly string[]): { argv: string[]; modules: string[]; missing: boolean } {
  const rest: string[] = [];
  const modules: string[] = [];
  let missing = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] as string;
    if (arg === '--') {
      rest.push(...argv.slice(index));
      break;
    }
    if (arg === '--plugin') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('-')) missing = true;
      else modules.push(value);
      index++;
    } else if (arg.startsWith('--plugin=')) {
      const value = arg.slice('--plugin='.length);
      if (value === '') missing = true;
      else modules.push(value);
    } else {
      rest.push(arg);
    }
  }
  return { argv: rest, modules, missing };
}

/** The project config a run reads plugins from: the file `--config` names when it is a file, else `driftbench.yaml`. */
export function pluginConfigPath(argv: readonly string[], cwd: string): string | undefined {
  let named: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] as string;
    if (arg === '--') break;
    if (arg === '--config') named = argv[index + 1];
    else if (arg.startsWith('--config=')) named = arg.slice('--config='.length);
  }
  const path = resolve(cwd, named ?? 'driftbench.yaml');
  return existsSync(path) ? path : undefined;
}

export type PluginConfig = { ok: true; sources: PluginSource[] } | { ok: false; message: string };

/**
 * Reads the `plugins` list of a project config: module paths, relative to the config file, or package names.
 * A file that is not a YAML map gives no plugin here; the command that reads the config reports it.
 */
export async function readPluginConfig(path: string): Promise<PluginConfig> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return { ok: true, sources: [] };
  }
  const { isMap, isScalar, isSeq, parseDocument } = await import('yaml');
  const doc = parseDocument(text);
  const root = doc.contents;
  if (doc.errors.length > 0 || !isMap(root)) return { ok: true, sources: [] };
  const list = root.get('plugins', true);
  if (list === undefined || list === null) return { ok: true, sources: [] };
  const lineOf = (offset: number) => text.slice(0, offset).split('\n').length;
  const bad = (offset: number) => ({
    ok: false as const,
    message: `${path}:${lineOf(offset)}: plugins must be a list of module paths or package names`,
  });
  if (!isSeq(list)) return bad(list.range?.[0] ?? 0);
  const sources: PluginSource[] = [];
  for (const item of list.items) {
    const at = isScalar(item) || isMap(item) || isSeq(item) ? (item.range?.[0] ?? 0) : 0;
    if (!isScalar(item) || typeof item.value !== 'string' || item.value.trim() === '') return bad(at);
    sources.push({ module: item.value.trim(), from: dirname(path) });
  }
  return { ok: true, sources };
}

/**
 * Finds and loads the plugins of one CLI run. Returns the arguments without the `--plugin` flags, or the
 * message of a failure. Reads no file and imports nothing when no config exists and no flag is given.
 */
export async function pluginsFromRun(
  argv: readonly string[],
  io: Pick<Io, 'cwd'>,
): Promise<{ ok: true; argv: string[] } | { ok: false; message: string }> {
  const flags = pluginArgs(argv);
  if (flags.missing) return { ok: false, message: '--plugin takes a module path or a package name' };
  const sources: PluginSource[] = [];
  const config = pluginConfigPath(flags.argv, io.cwd);
  if (config !== undefined) {
    const read = await readPluginConfig(config);
    if (!read.ok) return read;
    sources.push(...read.sources);
  }
  sources.push(...flags.modules.map((module) => ({ module, from: io.cwd })));
  if (sources.length > 0) {
    const failure = await loadPlugins(sources, io.cwd);
    if (failure !== undefined) return { ok: false, message: failure };
  }
  return { ok: true, argv: flags.argv };
}
