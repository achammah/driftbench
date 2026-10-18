import type { Sources, StoreDoc, VariablesImpl } from '../../src/ladders/variables/interface';

/** Small quote-only witness. Does not implement conversations, conditions, planning or the full bank. */
export type FoldStep = 'unicode' | 'invisibles' | 'quotes' | 'markdown' | 'whitespace';
export function folded(text: string, skip?: FoldStep): string {
  let result = '';
  const singles = new Set(['‘', '’', '‛', '′']);
  const doubles = new Set(['“', '”', '‟', '″']);
  const ignored = /[\u200B-\u200F\u2060\uFEFF\u00AD\u202A-\u202E]/u;
  for (const character of skip === 'unicode' ? text : text.normalize('NFC')) {
    if (skip === 'invisibles' || !ignored.test(character))
      result +=
        skip === 'quotes'
          ? character
          : singles.has(character)
            ? "'"
            : doubles.has(character)
              ? '"'
              : character;
  }
  if (skip !== 'markdown') result = result.replace(/\\([!-/:-@[-`{-~])/g, '$1');
  return skip === 'whitespace' ? result : result.split(/\s+/u).filter(Boolean).join(' ');
}

export function quoteReader(normalize = folded): VariablesImpl['buildStore'] {
  return (sources: Sources): StoreDoc => {
    const store: StoreDoc = { variables: [], impossible: [], rules: [], refused: [] };
    const files = sources.estate?.files ?? {};
    const normalizedFiles = new Map<string, string>();
    for (const rule of sources.estate?.rules ?? []) {
      const ids: string[] = [];
      for (const tool of rule.tools) {
        const id = `${tool.tool}.${tool.field}`;
        const values = tool.values.flatMap((value) => {
          const needle = normalize(value.quote);
          const file = files[tool.source];
          if (file !== undefined && !normalizedFiles.has(tool.source))
            normalizedFiles.set(tool.source, normalize(file));
          if (
            !needle ||
            files[tool.source] === undefined ||
            !normalizedFiles.get(tool.source)?.includes(needle)
          ) {
            store.refused.push({ what: value.id, reason: 'quote absent from supplied source' });
            return [];
          }
          return [
            { id: value.id, provenance: [{ kind: 'quote' as const, path: tool.source, quote: value.quote }] },
          ];
        });
        if (values.length) {
          store.variables.push({ id, values });
          ids.push(id);
        }
      }
      store.rules.push({ id: rule.id, variables: ids });
    }
    return store;
  };
}
