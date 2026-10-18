import { type ChangeManifest, type PromptAnchor, promptChangeManifest } from '@agent-nexus/driftbench-core';
import { type EstateMap, quoteAtSpan } from '@agent-nexus/driftbench-estate';

/** Estate provenance is checked before its exact, overlapping quotes become one conservative anchor. */
export function estatePromptManifest(
  map: EstateMap,
  source: string,
  before: string,
  after: string,
  versions: { from: string; to: string },
): ChangeManifest {
  // Use the same representation as promptChangeManifest; never widen quotes to their source lines.
  const normalize = (text: string) => text.replace(/\r\n?/g, '\n').normalize('NFC');
  const text = normalize(before);
  const whole = (reason: string): ChangeManifest => ({
    ...versions,
    changes: [{ kind: 'prompt', global: true, note: `${reason}; whole suite` }],
  });
  const located: { start: number; end: number; id: string; approved: boolean }[] = [];
  for (const atom of map.atoms) {
    if (atom.provenance.file !== source) continue;
    if (!quoteAtSpan(before, atom.provenance)) return whole(`stale quote at its source span: ${atom.id}`);
    const quote = normalize(atom.provenance.quote);
    const start = text.indexOf(quote);
    if (start < 0) return whole(`stale exact quote in old text: ${atom.id}`);
    if (text.indexOf(quote, start + 1) >= 0) return whole(`ambiguous quote in old text: ${atom.id}`);
    const startLine = text.slice(0, start).split('\n').length;
    const endLine = text.slice(0, start + quote.length - 1).split('\n').length;
    if (startLine < atom.provenance.startLine || endLine > atom.provenance.endLine)
      return whole(`stale exact quote at its source span: ${atom.id}`);
    located.push({ start, end: start + quote.length, id: atom.id, approved: atom.approved });
  }
  located.sort((a, b) => a.start - b.start || a.end - b.end);
  const groups: { start: number; end: number; ids: string[]; approved: boolean }[] = [];
  for (const atom of located) {
    const last = groups.at(-1);
    if (last && atom.start < last.end) {
      last.end = Math.max(last.end, atom.end);
      last.ids.push(atom.id);
      last.approved &&= atom.approved;
    } else {
      groups.push({ start: atom.start, end: atom.end, ids: [atom.id], approved: atom.approved });
    }
  }
  const anchors: PromptAnchor[] = groups.map((group) => ({
    entry: `atoms[${group.ids.join(', ')}]`,
    source,
    quote: text.slice(group.start, group.end),
    // An unapproved overlapping atom cannot disappear behind an approved one.
    changes: group.approved ? group.ids.map((id) => ({ kind: 'prompt', id })) : [],
  }));
  return promptChangeManifest(before, after, anchors, versions);
}
