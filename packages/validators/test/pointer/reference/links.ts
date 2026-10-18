import type { LedgerView, Link, LinkState, LinksApi } from '../../../src/ladders/pointer/sut/port';

const REASONS = new Set(['cosmetic', 'semantic-still-covered', 'test-updated']);

const indexes = new WeakMap<LedgerView, Map<string, LedgerView['entries'][number]>>();

function entryOf(view: LedgerView, id: string) {
  let index = indexes.get(view);
  if (!index) {
    index = new Map(view.entries.map((e) => [e.id, e]));
    indexes.set(view, index);
  }
  return index.get(id);
}

function stateOf(previous: LedgerView | null, current: LedgerView, link: Link): LinkState {
  const entry = entryOf(current, link.span);
  if (!entry) return 'suspect';
  if (entry.status === 'ambiguous') return 'ambiguous';
  if (entry.status !== 'live') return 'suspect';
  if (entry.fp !== link.fp) return 'suspect';
  const before = previous ? entryOf(previous, link.span) : undefined;
  if (before && before.status === 'live') {
    if (
      before.ctxFp !== entry.ctxFp ||
      JSON.stringify(before.sectionPath) !== JSON.stringify(entry.sectionPath)
    ) {
      return 'advisory';
    }
  }
  return 'ok';
}

export const referenceLinks: LinksApi = {
  create(ledger, owner, span, relation, createdBy = 'proposed') {
    const entry = entryOf(ledger, span);
    return { owner, span, fp: entry?.fp ?? '', relation, createdBy, accepted: true };
  },
  classify(previous, current, links) {
    return links.map((link) => stateOf(previous, current, link));
  },
  clear(link, reason, current) {
    if (!REASONS.has(reason))
      return {
        ok: false,
        error: `the reason ${JSON.stringify(reason)} is not one of cosmetic, semantic-still-covered, test-updated`,
      };
    const entry = entryOf(current, link.span);
    if (entry?.status !== 'live')
      return { ok: false, error: 'the span is not live: nothing to clear against' };
    return { ok: true, link: { ...link, fp: entry.fp, reason, accepted: true } };
  },
  verify(link, evidence) {
    return evidence.flipped ? { ...link, createdBy: 'verified' } : { ...link };
  },
  coverage(current, mappedLabels, links) {
    const mapped = new Set(mappedLabels);
    const verified = new Set(links.filter((l) => l.createdBy === 'verified').map((l) => l.span));
    const spans = current.entries.filter(
      (e) => e.status === 'live' && Object.values(e.labels).some((l) => mapped.has(l.label)),
    );
    const uncovered = spans
      .filter((e) => !verified.has(e.id))
      .map((e) => e.id)
      .sort();
    return { uncovered, covered: spans.length - uncovered.length };
  },
  blast(previous, current, links) {
    const states = links.map((l) => stateOf(previous, current, l));
    const rerun = new Set<string>();
    const advisory = new Set<string>();
    const editedSections: string[] = [];
    links.forEach((link, i) => {
      if (states[i] === 'suspect' || states[i] === 'ambiguous') {
        rerun.add(link.owner);
        const entry = entryOf(current, link.span);
        const before = previous ? entryOf(previous, link.span) : undefined;
        const where = entry?.status === 'live' ? entry : before;
        if (where) editedSections.push(`${where.path}|${JSON.stringify(where.sectionPath)}`);
      } else if (states[i] === 'advisory') {
        advisory.add(link.owner);
      }
    });
    // spans that changed without a link to say so also name their section
    if (previous) {
      for (const entry of current.entries) {
        if (entry.status !== 'live') continue;
        const before = entryOf(previous, entry.id);
        if (before && before.fp !== entry.fp)
          editedSections.push(`${entry.path}|${JSON.stringify(entry.sectionPath)}`);
      }
      for (const before of previous.entries) {
        if (before.status !== 'live') continue;
        const now = entryOf(current, before.id);
        if (now?.status !== 'live')
          editedSections.push(`${before.path}|${JSON.stringify(before.sectionPath)}`);
      }
    }
    const sections = new Set(editedSections);
    links.forEach((link) => {
      const entry = entryOf(current, link.span);
      if (entry?.status === 'live' && sections.has(`${entry.path}|${JSON.stringify(entry.sectionPath)}`)) {
        advisory.add(link.owner);
      }
    });
    return { rerun: [...rerun].sort(), advisory: [...advisory].sort() };
  },
};
