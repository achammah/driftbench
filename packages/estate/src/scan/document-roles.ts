import { posix } from 'node:path';
import type { DocumentInfo, DocumentRole } from '../schema';
import type { EstateFile, RawEstate } from './reader';
import { blankFences, readFrontmatter } from './text';

/** Structural roles describe authority, independently of a runtime's file kind or owning skill. */
const NAVIGATION_FOLDERS: ReadonlyArray<[RegExp, DocumentRole]> = [
  [/^(?:archives?|attic)$/i, 'archive'],
  [/^(?:fixtures?|__fixtures__)$/i, 'fixture'],
  [/^(?:examples?|samples?|demos?)$/i, 'example'],
  [/^templates?$/i, 'template'],
];
const DATE = /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/;
const DATED_ENTRY = /^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)/;
function datedEntry(line: string): boolean {
  return DATED_ENTRY.test(line) && DATE.test(line);
}
const PLACEHOLDER = /\{\{[^{}\n]+\}\}|<\/?[a-z][\w.-]*(?:\s+[a-z][\w.-]*)?>/i;
const HEADING_ROLE: ReadonlyArray<[RegExp, DocumentRole]> = [
  [/^(?:change\s?log|release notes?)(?:\b|$)/i, 'changelog'],
  [/^(?:history|revision history|change history|audit log)(?:\s*[:(].*)?$/i, 'history'],
  [/^(?:journal|diary|work log|session log)(?:\b|$)/i, 'journal'],
  [/^(?:examples?|samples?|demonstrations?)(?:\b|$)/i, 'example'],
  [
    /^(?:anti-?patterns?|counter-?examples?|(?:wrong|bad|incorrect)\s+(?:examples?|patterns?|usage|practices?))(?:\b|$)/i,
    'example',
  ],
  [/^(?:templates?|skeletons?)(?:\b|$)/i, 'template'],
];
function headingRole(title: string): DocumentRole | undefined {
  return HEADING_ROLE.find(([pattern]) => pattern.test(title))?.[1];
}

/**
 * A counter-example is shown so that it is not followed. A marker (a cross, or a label such as wrong, bad or
 * incorrect) opens it only where a line or a list item or a table cell begins; the same words inside a
 * sentence ("if the total is wrong: read ...") or a multiplication sign between numbers are ordinary text. A
 * check mark or a label such as right, good or correct closes it on the same line.
 */
const WRONG_MARK = String.raw`(?:[✗✘❌]|×|\b(?:wrong|bad|incorrect|anti-?pattern|counter-?example)\b\s*[:：])`;
const RIGHT_MARK = String.raw`(?:[✓✔✅]|\b(?:right|good|correct|fixed|better)\b\s*[:：])`;
/** What may precede a marker at the start of a line: a quote, a list bullet or number, a table cell, bold. */
const LEAD = String.raw`\s*(?:>\s*)*(?:[-*+]\s+|\d+[.)]\s+)?(?:\|\s*)?(?:\*\*|__)?`;
const WRONG_AT_START = new RegExp(`^(${LEAD})${WRONG_MARK}`, 'iu');
/** A line holding only the marker: the counter-example is the block that follows. */
const WRONG_STANDALONE = new RegExp(String.raw`^${LEAD}${WRONG_MARK}(?:\*\*|__)?\s*$`, 'iu');

/** Classify before reading declarations. One incidental date or placeholder never changes authority. */
export function classifyDocument(file: Pick<EstateFile, 'path' | 'text'>, unitFolder?: string): DocumentInfo {
  const folders = posix.dirname(file.path).split('/');
  let folderPath = '';
  for (const folder of folders) {
    folderPath = folderPath ? `${folderPath}/${folder}` : folder;
    if (folderPath === unitFolder) continue;
    const role = NAVIGATION_FOLDERS.find(([pattern]) => pattern.test(folder))?.[1];
    if (role) return { path: file.path, role, reasons: [`navigation folder: ${folder}`] };
  }
  const markdown = /\.(?:md|markdown|txt)$/i.test(file.path);
  if (!markdown) return { path: file.path, role: 'normative', reasons: ['runtime structure or executable'] };
  const bodyLine = readFrontmatter(file.text).bodyLine;
  const lines = file.text.split('\n');
  const visible = blankFences(
    lines.map((line, index) => (index < bodyLine - 1 ? '' : line)).join('\n'),
  ).split('\n');
  const first = visible.find((line) => line.trim() !== '')?.trim() ?? '';
  const title = /^#\s+(.+?)\s*#*\s*$/.exec(first)?.[1];
  const titledRole = title ? headingRole(title) : undefined;
  const dates = visible.filter((line) => DATE.test(line)).length;
  const appendOnly = /\bappend[- ]only\s+(?:log|journal|history|record)\b/i.test(visible.join('\n'));
  if (
    titledRole &&
    (titledRole === 'example' ||
      (titledRole === 'template' && PLACEHOLDER.test(file.text)) ||
      (['history', 'changelog', 'journal'].includes(titledRole) && (dates > 0 || appendOnly)))
  )
    return {
      path: file.path,
      role: titledRole,
      reasons: [`document heading: ${title}`, ...(dates ? ['dated entries'] : [])],
    };

  // A fill-in document can have an arbitrary title. Repeated value slots, rather than variable
  // paths inside directives, establish a template without borrowing authority from its name.
  const content = visible.filter((line) => line.trim() && !/^\s*#/.test(line));
  const slots = visible.filter((line) =>
    /^\s*(?:#{1,6}\s+|[-*+]\s+)?(?:[\w -]+:\s*)?(?:\{\{[^{}]+\}\}|<[a-z][\w.-]*>)\s*$/i.test(line),
  );
  if (slots.length >= 2 && slots.length * 2 >= content.length)
    return { path: file.path, role: 'template', reasons: ['repeated placeholder value slots'] };

  // Repeated date headings establish an entry list even when a log uses an arbitrary title.
  const datedEntries = visible.filter(datedEntry).length;
  // A live definition can contain its own history section; that section is handled below.
  const firstEntry = visible.findIndex(datedEntry);
  const firstContent = visible.findIndex((line) => line.trim() !== '');
  const beforeEntries = visible
    .slice(0, firstEntry)
    .filter((line, index) => line.trim() && !(index === firstContent && /^#\s+/.test(line)));
  if (datedEntries >= 2 && beforeEntries.length === 0)
    return { path: file.path, role: 'history', reasons: ['document consists of dated entries'] };
  if (
    appendOnly &&
    dates >= 2 &&
    firstEntry >= 0 &&
    beforeEntries.every((line) => /\bappend[- ]only\s+(?:log|journal|history|record)\b/i.test(line))
  )
    return { path: file.path, role: 'history', reasons: ['append-only dated log'] };

  const sections: NonNullable<DocumentInfo['sections']> = [];
  let active: { startLine: number; depth: number; role: DocumentRole } | undefined;
  for (let index = bodyLine - 1; index < visible.length; index++) {
    const line = visible[index] ?? '';
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      const depth = heading[1]?.length ?? 1;
      if (active && depth <= active.depth) {
        sections.push({ startLine: active.startLine, endLine: index, role: active.role });
        active = undefined;
      }
      const role = headingRole(heading[2] ?? '');
      if (
        !active &&
        index !== firstContent &&
        role &&
        (role !== 'template' || PLACEHOLDER.test(lines.slice(index + 1).join('\n')))
      )
        active = { startLine: index + 1, depth, role };
    }
    // An explicit illustrative line is local: never suppress neighbouring operational text.
    if (
      !active &&
      !line.includes(';') &&
      (/^\s*(?:>\s*)?(?:[-*+]\s+)?(?:for example\b|e\.g\.(?:[\s,:]|$)|example\s*:)/i.test(line) ||
        WRONG_STANDALONE.test(line))
    ) {
      const endLine =
        /^\s*(?:for example|e\.g\.|example)\s*[:,]?\s*$/i.test(line) || WRONG_STANDALONE.test(line)
          ? exampleBlockEnd(lines, index)
          : index + 1;
      sections.push({ startLine: index + 1, endLine, role: 'example' });
      index = endLine - 1;
    }
  }
  if (active) sections.push({ startLine: active.startLine, endLine: lines.length, role: active.role });
  return {
    path: file.path,
    role: 'normative',
    reasons: ['live document; no whole-document navigation structure'],
    ...(sections.length ? { sections } : {}),
  };
}

/** The paragraph or quoted/fenced block belonging to a standalone example introducer. */
function exampleBlockEnd(lines: readonly string[], start: number): number {
  let first = start + 1;
  while (first < lines.length && lines[first]?.trim() === '') first++;
  const opening = lines[first] ?? '';
  if (/^#{1,6}\s/.test(opening)) return start + 1;
  const fence = /^\s*(`{3,}|~{3,})/.exec(opening)?.[1];
  if (fence) {
    const closing = new RegExp(`^\\s*${fence[0]}{${fence.length},}\\s*$`);
    for (let index = first + 1; index < lines.length; index++)
      if (closing.test(lines[index] ?? '')) return index + 1;
    return lines.length;
  }
  const quoted = /^\s*>/.test(opening);
  let end = first;
  while (end < lines.length && lines[end]?.trim() && !/^#{1,6}\s/.test(lines[end] ?? '')) {
    if (quoted && !/^\s*>/.test(lines[end] ?? '')) break;
    end++;
  }
  return Math.max(start + 1, end);
}

export function documentInfo(file: EstateFile): DocumentInfo {
  return file.document ?? classifyDocument(file);
}
export function isNormative(file: EstateFile): boolean {
  return documentInfo(file).role === 'normative';
}

/** The live declared unit (skill) whose folder holds a path: the unit that owns the file. */
export function owningUnit(raw: Pick<RawEstate, 'skills'>, path: string): string | undefined {
  const roots = new Set(raw.skills.map((skill) => posix.normalize(skill.folder)));
  let folder = posix.dirname(path);
  while (folder !== posix.dirname(folder)) {
    if (roots.has(folder)) return folder;
    folder = posix.dirname(folder);
  }
  return undefined;
}

const LOADED_BY_PLACE: ReadonlySet<EstateFile['kind']> = new Set([
  'standing',
  'memory',
  'settings',
  'skill',
  'subagent',
  'registry',
]);

/** Records and stores: nothing is expected to load them, so being named by no live document is no defect. */
const UNLOADED_BY_DESIGN: ReadonlySet<DocumentRole> = new Set([
  'changelog',
  'history',
  'journal',
  'archive',
  'fixture',
]);
/**
 * Whether being unnamed or unreachable is expected. A role never hides a defect that a live owner makes:
 * a template or an example exists to be read when a live document sends the reader to it, and any file
 * inside the folder of a live skill is that skill's material, so it stays a finding when nothing names it.
 * A file the runtime loads by its place (standing instructions, memory, settings, a skill or helper
 * definition, the check registry) is never exempt: a document's own role cannot hide it. Only a record or
 * store outside every live unit is exempt.
 */
export function unloadedByDesign(raw: Pick<RawEstate, 'skills'>, file: EstateFile): boolean {
  // The runtime loads these kinds by their place: what a document says about itself cannot exempt them.
  if (LOADED_BY_PLACE.has(file.kind)) return false;
  return UNLOADED_BY_DESIGN.has(documentInfo(file).role) && owningUnit(raw, file.path) === undefined;
}

/** Inclusive line intervals for live text; original text and provenance offsets remain untouched. */
export function normativeRanges(
  file: EstateFile,
  startLine: number,
  endLine: number,
): Array<{ startLine: number; endLine: number }> {
  const info = documentInfo(file);
  if (info.role !== 'normative') return [];
  const ranges: Array<{ startLine: number; endLine: number }> = [];
  let start = startLine;
  for (const section of info.sections ?? []) {
    if (section.endLine < start || section.startLine > endLine) continue;
    if (section.startLine > start) ranges.push({ startLine: start, endLine: section.startLine - 1 });
    start = Math.max(start, section.endLine + 1);
  }
  if (start <= endLine) ranges.push({ startLine: start, endLine });
  return ranges;
}

/** A counter-example that opens a line is blanked up to its right marker, or to the end of the line. */
function maskCounterExamples(line: string): string {
  const opaque = line.replace(/`[^`]*`/g, (part) => ' '.repeat(part.length));
  const found = WRONG_AT_START.exec(opaque);
  if (!found) return line;
  const start = found[1]?.length ?? 0;
  const right = new RegExp(RIGHT_MARK, 'iu').exec(opaque.slice(found[0].length));
  const end = right ? found[0].length + right.index : line.length;
  return line.slice(0, start) + ' '.repeat(end - start) + line.slice(end);
}

/** An illustrative prefix ends at an unquoted semicolon; the independent live clause stays visible. */
export function maskIllustrativePrefixes(text: string): string {
  return text
    .split('\n')
    .map((line) => maskCounterExamples(line))
    .map((line) => {
      if (!/^\s*(?:[-*+]\s+)?(?:for example\b|e\.g\.(?:[\s,:]|$)|example\s*:)/i.test(line)) return line;
      const opaque = line.replace(/`[^`]*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, (part) =>
        ' '.repeat(part.length),
      );
      const end = opaque.indexOf(';');
      return end < 0 ? line : ' '.repeat(end + 1) + line.slice(end + 1);
    })
    .join('\n');
}

/** Apply the same authority boundary to readers of any runtime, including supplied raw estates. */
export function normativeEstate(raw: RawEstate): RawEstate {
  const unitOf = (path: string) => owningUnit(raw, path);
  const files = new Map(
    raw.files.map((file) => {
      file.document ??= classifyDocument(file, unitOf(file.path));
      return [file.path, file] as const;
    }),
  );
  const live = (path: string, line?: number) => {
    const file = files.get(path);
    if (!file) return true;
    if (!isNormative(file)) return false;
    return (
      line === undefined ||
      !(documentInfo(file).sections ?? []).some(
        (section) => line >= section.startLine && line <= section.endLine,
      )
    );
  };
  const prose = raw.prose.flatMap((chunk) => {
    const file = files.get(chunk.file);
    if (!file) return [chunk];
    const ranges = normativeRanges(file, chunk.startLine, chunk.endLine);
    const text = maskIllustrativePrefixes(chunk.text);
    if (
      ranges.length === 1 &&
      ranges[0]?.startLine === chunk.startLine &&
      ranges[0].endLine === chunk.endLine
    )
      return text === chunk.text ? [chunk] : [{ ...chunk, text }];
    return ranges
      .map((range) => ({
        ...chunk,
        id: `${chunk.id}@${range.startLine}`,
        ...range,
        text: text
          .split('\n')
          .slice(range.startLine - chunk.startLine, range.endLine - chunk.startLine + 1)
          .join('\n'),
      }))
      .filter((chunk) => chunk.text.trim() !== '');
  });
  return {
    ...raw,
    prose,
    skills: raw.skills.filter((declaration) => live(declaration.file)),
    subagents: raw.subagents.filter((declaration) => live(declaration.file)),
    guards: raw.guards.filter((declaration) => live(declaration.at.file, declaration.at.startLine)),
    permissions: raw.permissions.filter((declaration) => live(declaration.at.file, declaration.at.startLine)),
    settings: raw.settings.filter((declaration) => live(declaration.at.file, declaration.at.startLine)),
    registry: raw.registry.filter((declaration) => live(declaration.at.file, declaration.at.startLine)),
    steps: raw.steps.filter((declaration) => live(declaration.at.file, declaration.at.startLine)),
  };
}
