import { chunkLines, guardName, registryRowOf, toolBase } from '../scan/code';
import type { EstateFile, RawEstate } from '../scan/reader';
import { labelOfLine, linesOf, plain } from '../scan/text';
import type { Atom, Edge } from '../schema';
import { dispatchesHelper } from './dispatch';

/**
 * The estate graph: the edges of the design between atoms. A node is an atom id; an event a guard runs on
 * is a node of its own, named `event.<name>`, since no file states an event as an atom.
 *
 *   route      a route atom to the skill or helper it loads
 *   reference  a skill or helper to a reference atom in a file it owns: its own file and, for a skill, the
 *              files of its folder that its citations lead to. Never to what a shared file cites in turn.
 *   script     a skill to a script it ships
 *   dispatch   a skill or helper to a helper its body names
 *   enforces   a guard to a rule it checks
 *   event      a guard to the event it runs on
 *   allows     a skill or helper to a tool or skill it may use
 *   next       a stage to the stage that follows it
 *   cites      a rule to a rule its words name by label
 *
 * How `enforces` is decided, by code, in this order (the method is recorded on the guard atom):
 *   1. registry: a check registry row names the guard's script and lists rule labels (R5) or quoted
 *      passages; a rule is enforced when its line carries the label or its quote holds the passage.
 *   2. id: the guard's own source says `Enforces: R3, R5` (or `enforces R3`), or cites a rule as `R#3`
 *      anywhere in its text; same label match (a rule labelled `R#3` has the label R3).
 *   3. quote: a string in the guard's source of at least 16 characters equals a rule's quote, or one holds
 *      the other, compared without markup, case or final punctuation.
 * Only instruction, gate and register atoms are enforced. `enforcement` on each rule lists its guards.
 */

/** The folder a unit owns, with its closing slash: a skill's folder. A helper is one file and owns none. */
export function ownFolder(unit: Atom): string | undefined {
  const folder = unit.kind === 'skill' ? unit.fields?.folder : undefined;
  return typeof folder === 'string' && folder !== '' ? `${folder.replace(/\/+$/, '')}/` : undefined;
}

export const EVENT_PREFIX = 'event.';
const RULE_KINDS = new Set(['instruction', 'gate', 'register']);
const MIN_LITERAL = 16;

export type EnforceMethod = 'registry' | 'id' | 'quote';

export type Graph = {
  edges: Edge[];
  /** For each guard atom, the rules it enforces and how that was decided. */
  enforces: Map<string, Array<{ atom: string; by: EnforceMethod }>>;
};

/** The label a rule carries (R5), read from the line its quote starts on. */
export function labelOf(atom: Atom, files: ReadonlyMap<string, EstateFile>): string | undefined {
  const text = files.get(atom.provenance.file)?.text;
  if (text === undefined) return undefined;
  return labelOfLine(text.split('\n')[atom.provenance.startLine - 1] ?? '');
}

export function buildGraph(atoms: readonly Atom[], raw: RawEstate): Graph {
  const files = new Map(raw.files.map((file) => [file.path, file]));
  const edges: Edge[] = [];
  const add = (from: string, to: string, kind: Edge['kind']) => {
    if (from !== to) edges.push({ from, to, kind });
  };
  const byKind = (kind: Atom['kind']) => atoms.filter((atom) => atom.kind === kind);
  const unitOfName = new Map<string, Atom>();
  for (const atom of [...byKind('skill'), ...byKind('subagent')]) {
    const name = atom.fields?.name;
    if (typeof name === 'string') unitOfName.set(`${atom.kind}:${name}`, atom);
  }
  /** The skill or helper whose file an atom sits in. */
  const unitOfFile = new Map<string, Atom>();
  for (const atom of [...byKind('skill'), ...byKind('subagent')]) unitOfFile.set(atom.provenance.file, atom);

  for (const route of byKind('route')) {
    const target = unitOfName.get(`${route.fields?.targetKind}:${route.fields?.target}`);
    if (target) add(route.id, target.id, 'route');
  }

  // A unit stores one reference edge for each citation in a file it owns: its definition file, and the files
  // of its own folder that those citations lead to (a skill folder holds the skill's bundled files). A file
  // outside the folder, shared by other units, is read by whoever cites it and owned by none: the edges never
  // carry what a cited file cites in turn. What a unit reaches is computed when asked (`reach.ts`), so a
  // document cited by every unit costs one edge for each citation, not one for each of its own citations.
  const referencesByFile = new Map<string, Atom[]>();
  for (const reference of byKind('reference')) {
    const file = reference.provenance.file;
    const references = referencesByFile.get(file) ?? [];
    references.push(reference);
    referencesByFile.set(file, references);
  }
  for (const unit of unitOfFile.values()) {
    const own = ownFolder(unit);
    const pending = [unit.provenance.file];
    const visited = new Set<string>();
    for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
      if (visited.has(file)) continue;
      visited.add(file);
      for (const reference of referencesByFile.get(file) ?? []) {
        add(unit.id, reference.id, 'reference');
        const target = reference.fields?.path;
        if (typeof target === 'string' && own !== undefined && target.startsWith(own) && files.has(target))
          pending.push(target);
      }
    }
  }

  for (const script of byKind('script')) {
    const unit = unitOfName.get(`skill:${script.fields?.skill}`);
    if (unit) add(unit.id, script.id, 'script');
  }

  const helpers = byKind('subagent');
  for (const chunk of raw.prose) {
    const unit = unitOfFile.get(chunk.file);
    if (!unit) continue;
    const visible = chunkLines(chunk, files.get(chunk.file))
      .map((line) => line.text)
      .join('\n');
    for (const helper of helpers) {
      const name = String(helper.fields?.name ?? '');
      if (dispatchesHelper(visible, name)) add(unit.id, helper.id, 'dispatch');
    }
  }

  const tools = byKind('tool');
  const toolOf = (name: string): Atom | undefined =>
    tools.find(
      (tool) =>
        tool.fields?.tool === name && tool.fields?.pattern === undefined && tool.fields?.effect !== 'deny',
    ) ?? tools.find((tool) => tool.fields?.tool === name);
  for (const unit of [...byKind('skill'), ...byKind('subagent')]) {
    const declared = Array.isArray(unit.fields?.tools) ? (unit.fields.tools as string[]) : [];
    for (const name of new Set(declared.map(toolBase))) {
      const tool = toolOf(name);
      if (tool) add(unit.id, tool.id, 'allows');
    }
    const skills = Array.isArray(unit.fields?.skills) ? (unit.fields.skills as string[]) : [];
    for (const name of skills) {
      const skill = unitOfName.get(`skill:${name}`);
      if (skill) add(unit.id, skill.id, 'allows');
    }
  }

  const stages = byKind('stage');
  for (const stage of stages) {
    const next = Array.isArray(stage.fields?.next) ? (stage.fields.next as string[]) : [];
    for (const id of next) {
      const target = stages.find((candidate) => candidate.fields?.id === id);
      if (target) add(stage.id, target.id, 'next');
    }
  }

  const rules = atoms.filter((atom) => RULE_KINDS.has(atom.kind));
  const labels = new Map(rules.map((rule) => [rule.id, labelOf(rule, files)]));
  const withLabel = (label: string) =>
    rules.filter((rule) => labels.get(rule.id) === label.replace('#', '').toUpperCase());
  for (const rule of rules) {
    const own = labels.get(rule.id);
    const quote = rule.provenance.quote;
    for (const match of quote.matchAll(/\b([A-Z]{1,3})#?(\d{1,3})\b/gi)) {
      const label = `${match[1]}${match[2]}`.toUpperCase();
      if (label === own) continue;
      if (
        !match[0].includes('#') &&
        designates(quote.slice(0, match.index), quote.slice(match.index + match[0].length))
      )
        continue;
      for (const cited of withLabel(label)) add(rule.id, cited.id, 'cites');
    }
  }

  const enforces = new Map<string, Array<{ atom: string; by: EnforceMethod }>>();
  for (const guard of byKind('guard')) {
    const found: Array<{ atom: string; by: EnforceMethod }> = [];
    const take = (atom: Atom, by: EnforceMethod) => {
      if (!found.some((entry) => entry.atom === atom.id)) found.push({ atom: atom.id, by });
    };
    add(guard.id, `${EVENT_PREFIX}${guard.fields?.event}`, 'event');
    const decl = raw.guards.find((candidate) => guardName(candidate) === guard.fields?.name);
    const row = decl ? registryRowOf(decl, raw.registry) : undefined;
    for (const entry of row?.enforces ?? []) {
      if ('id' in entry) for (const rule of withLabel(entry.id)) take(rule, 'registry');
      else for (const rule of rules) if (holds(rule.provenance.quote, entry.quote)) take(rule, 'registry');
    }
    const script = typeof guard.fields?.script === 'string' ? files.get(guard.fields.script) : undefined;
    if (script) {
      for (const label of [...declaredLabels(script.text), ...citedLabels(script.text)]) {
        for (const rule of withLabel(label)) take(rule, 'id');
      }
      for (const literal of literals(script.text)) {
        for (const rule of rules) if (repeats(rule.provenance.quote, literal)) take(rule, 'quote');
      }
    }
    for (const entry of found) add(guard.id, entry.atom, 'enforces');
    enforces.set(guard.id, found);
  }

  return { edges: sortEdges(edges), enforces };
}

/** True when two passages say the same words, or one holds the other, compared without markup. */
function holds(quote: string, passage: string): boolean {
  const a = plain(quote);
  const b = plain(passage);
  if (b.length < MIN_LITERAL || a.length < MIN_LITERAL) return a === b && a !== '';
  return a.includes(b) || b.includes(a);
}

/** A clause that sets when a rule applies: from its lead word to the next comma, colon or semicolon. */
const CONDITION = /\b(?:when|whenever|if|unless|once|after|before|until|while|as soon as|in case)\b[^,:;]*/g;

/**
 * Whether a string of a guard's source repeats a rule. A registry row declares what it enforces, so any
 * passage it quotes counts (`holds`); a string in the source is only circumstantial, so a part of the rule
 * counts only when it reaches past the rule's condition. A message that quotes the condition alone ("the user
 * asks to stop" of "When the user asks to stop, stop all work") repeats when the rule applies, not the rule.
 */
function repeats(quote: string, literal: string): boolean {
  if (!holds(quote, literal)) return false;
  const rule = plain(quote);
  const part = plain(literal);
  const at = rule.indexOf(part);
  if (part.length >= rule.length || at < 0) return true;
  for (const condition of rule.matchAll(CONDITION)) {
    const start = condition.index ?? 0;
    if (at >= start && at + part.length <= start + condition[0].length) return false;
  }
  return true;
}

/** Identifier-bearing entity classes, independent of a particular estate's subject domain. */
const ENTITY_DESIGNATORS = new Set([
  // Publications, records and their addressable parts.
  'agreement',
  'appendix',
  'article',
  'attachment',
  'bulletin',
  'chapter',
  'column',
  'contract',
  'declaration',
  'diagram',
  'document',
  'edition',
  'entry',
  'equation',
  'exhibit',
  'field',
  'figure',
  'form',
  'letter',
  'line',
  'memo',
  'page',
  'paragraph',
  'plate',
  'plot',
  'publication',
  'record',
  'report',
  'revision',
  'section',
  'table',
  'version',
  'volume',
  // Transactions, credentials and administrative records.
  'account',
  'application',
  'badge',
  'bill',
  'booking',
  'case',
  'certificate',
  'claim',
  'credential',
  'credit',
  'debit',
  'invoice',
  'license',
  'order',
  'passport',
  'payment',
  'permit',
  'purchase',
  'receipt',
  'refund',
  'registration',
  'reservation',
  'ticket',
  'transaction',
  'voucher',
  'warrant',
  // Physical locations and storage positions.
  'address',
  'aisle',
  'apartment',
  'bay',
  'booth',
  'building',
  'cabin',
  'cell',
  'counter',
  'desk',
  'dock',
  'door',
  'floor',
  'hall',
  'hangar',
  'locker',
  'office',
  'platform',
  'port',
  'rack',
  'room',
  'row',
  'seat',
  'shelf',
  'site',
  'stall',
  'station',
  'terminal',
  'warehouse',
  'zone',
  // Inventory, logistics and transport units.
  'aircraft',
  'asset',
  'batch',
  'box',
  'bus',
  'carriage',
  'carton',
  'compartment',
  'component',
  'consignment',
  'container',
  'device',
  'flight',
  'item',
  'label',
  'lot',
  'model',
  'module',
  'package',
  'pallet',
  'parcel',
  'product',
  'route',
  'shipment',
  'train',
  'trip',
  'truck',
  'unit',
  'vehicle',
  'vessel',
  // Addressable software and data entities.
  'branch',
  'build',
  'checkpoint',
  'dataset',
  'job',
  'node',
  'project',
  'queue',
  'release',
  'repository',
  'tab',
  'widget',
]);
const ENTITY_PLURALS: Record<string, string> = { appendices: 'appendix', entries: 'entry', shelves: 'shelf' };

/**
 * A known entity noun identifies its adjacent bare label. Clear verb contexts (a pronoun/modal before
 * it, or a simple plural subject) retain the citation; lexical noun/verb ambiguity is not a reason to
 * drop an edge. At clause start, a finite predicate after the label establishes an entity subject.
 */
function designates(before: string, after: string): boolean {
  const tail = before.replace(/[*_`]/g, '');
  const match = /\b([A-Za-z]+)\s+$/.exec(tail);
  if (!match?.[1]) return false;
  const word = match[1].toLowerCase();
  const singulars = [
    word,
    ENTITY_PLURALS[word] ?? '',
    word.replace(/s$/, ''),
    word.replace(/es$/, ''),
    word.replace(/ies$/, 'y'),
  ];
  if (!singulars.some((noun) => ENTITY_DESIGNATORS.has(noun))) return false;
  const prefix =
    tail
      .slice(0, match.index)
      .split(/[.;!?:]/)
      .at(-1)
      ?.trim() ?? '';
  if (!prefix) return /^\s*[*_`]*\s*(?:is|are|was|were|has|have|had|must|should|will|can)\b/i.test(after);
  if (
    /\b(?:i|you|we|they|he|she|it|who|do|does|did|can|could|may|might|must|shall|should|will|would|to|not|please|always|never|then)\s*$/i.test(
      prefix,
    )
  )
    return false;
  if (/^(?:(?:all|both|some|the|our|your|their|these|those|when|if)\s+)*[A-Za-z]+s$/i.test(prefix))
    return false;
  const simpleSubject = /^(?:(?:the|a|an|our|your|their|each|every|this|that)\s+)?[A-Za-z]+$/i.test(prefix);
  if (
    simpleSubject &&
    !/^(?:a|an|the|this|that|these|those|each|every|any|some|all|both|no|its|our|your|their|his|her|my)$/i.test(
      prefix,
    ) &&
    (!ENTITY_DESIGNATORS.has(word) || /\b(?:people|staff|personnel|police|children|men|women)$/i.test(prefix))
  )
    return false;
  return true;
}

/** Labels a guard source declares: `Enforces: R3, R5` in a comment or a docstring. */
export function declaredLabels(text: string): string[] {
  const found: string[] = [];
  for (const line of linesOf(text)) {
    const match = /\benforces?\b\s*:?\s*([A-Z]{1,3}#?\d{1,3}(?:\s*(?:,|and)\s*[A-Z]{1,3}#?\d{1,3})*)/i.exec(
      line.raw,
    );
    if (!match?.[1]) continue;
    for (const label of match[1].matchAll(/[A-Z]{1,3}#?\d{1,3}/gi))
      found.push(label[0].replace('#', '').toUpperCase());
  }
  return found;
}

/** Rule ids a guard source cites in the `R#23` form, anywhere in its text, as labels (`R23`). */
export function citedLabels(text: string): string[] {
  return [
    ...new Set(
      [...text.matchAll(/\b([A-Z]{1,3})#(\d{1,3})\b/gi)].map((match) =>
        `${match[1]}${match[2]}`.toUpperCase(),
      ),
    ),
  ];
}

/** String literals of a source, at least 16 characters long. */
export function literals(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/"((?:[^"\\\n]|\\.){16,})"|'((?:[^'\\\n]|\\.){16,})'/g)) {
    const value = match[1] ?? match[2];
    if (value !== undefined) found.push(value);
  }
  return found;
}

export function sortEdges(edges: readonly Edge[]): Edge[] {
  const seen = new Set<string>();
  const unique: Edge[] = [];
  for (const edge of edges) {
    const key = `${edge.from}\u0000${edge.kind}\u0000${edge.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(edge);
  }
  return unique.sort((a, b) => compare(a.from, b.from) || compare(a.kind, b.kind) || compare(a.to, b.to));
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
