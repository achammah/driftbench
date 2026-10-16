import type { Built } from './generate-types';
import type { EstateAtom, EstatePlanRow } from './inputs';

/** Stable, exact semantics, not lexical similarity. Distinct checks, inputs and event cells never merge. */
export function equivalenceKey(built: Built, row: EstatePlanRow, head: EstateAtom | undefined): string {
  const { id: _id, title: _title, metadata: _metadata, tags: _tags, ...raw } = built.spec;
  // Criterion identifiers are generated from atom ids. Compare their full rubrics and flags, and
  // rename only the identifier/reference pair; never erase an assertion or normalize its prose.
  const criteria = raw.criteria as Array<Record<string, unknown>> | undefined;
  const names = new Map(criteria?.map((criterion, index) => [criterion.name, `criterion.${index}`]));
  const execution = {
    ...raw,
    ...(criteria
      ? { criteria: criteria.map((criterion) => ({ ...criterion, name: names.get(criterion.name) })) }
      : {}),
    blocks: (raw.blocks as Array<Record<string, unknown>>).map((block) => {
      const expect = block.expect as Record<string, unknown>;
      return {
        ...block,
        expect: {
          ...expect,
          ...(Array.isArray(expect.criteria)
            ? { criteria: expect.criteria.map((name) => names.get(name) ?? name) }
            : {}),
        },
      };
    }),
  };
  return JSON.stringify(
    stable({
      testType: row.testType,
      mode: row.mode,
      cell: Object.fromEntries(Object.entries(row.cell).filter(([key]) => !key.startsWith('atoms.'))),
      rule: head && {
        kind: head.kind,
        title: head.title,
        quote: head.provenance?.quote.replace(/\s+/g, ' ').trim(),
        situation: head.situation,
        evidence: head.evidence,
        fields: head.fields,
      },
      execution,
      // A journey is the ordered walk of its atoms: a different path never merges, even when each step
      // checks the same things, since the edge between two steps belongs to that path alone.
      path: row.testType === 'journey' ? row.atomIds : undefined,
      // Replay alignment and unit target identity are executable inputs, not incidental provenance.
      session: built.session,
      unit: (built.spec.metadata as { estate?: { unit?: unknown } })?.estate?.unit,
    }),
  );
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, stable(entry)]),
    );
  return value;
}
