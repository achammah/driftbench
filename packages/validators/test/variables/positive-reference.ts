import { createHash } from 'node:crypto';
import type {
  Group,
  Plan,
  Row,
  Sources,
  StoreDoc,
  VariablesImpl,
} from '../../src/ladders/variables/interface';

/**
 * Deliberately small test witness for the newly guarded items, not an implementation of the whole bank.
 * It enumerates small spaces independently of the bank oracle. The large binary fixture uses a bit-column
 * covering array: all-zero/all-one rows cover equal pairs; differing column bits cover unequal pairs.
 * Source construction only supports the tool fields and numeric triples used by these regression items.
 * IDs are checked against the product grammar; Unicode titles remain valid metadata.
 */
const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const key = (row: Row) => JSON.stringify(Object.entries(row).sort(([a], [b]) => order(a, b)));

function valid(store: StoreDoc, row: Row): boolean {
  return !store.impossible.some(({ a, b }) => row[a.variable] === a.value && row[b.variable] === b.value);
}

function allRows(store: StoreDoc): Row[] {
  const vars = [...store.variables].sort((a, b) => order(a.id, b.id));
  if (vars.length > 20) {
    if (vars.some((v) => v.values.length !== 2) || store.impossible.length > 0)
      throw new Error('the test witness only supports large unconstrained binary spaces');
    const row = (pick: (i: number) => number): Row =>
      Object.fromEntries(vars.map((v, i) => [v.id, v.values[pick(i)]?.id as string]));
    const rows = [row(() => 0), row(() => 1)];
    for (let bit = 1; bit < vars.length; bit *= 2) {
      rows.push(
        row((i) => (i & bit ? 1 : 0)),
        row((i) => (i & bit ? 0 : 1)),
      );
    }
    return rows;
  }
  const out: Row[] = [];
  const walk = (i: number, row: Row): void => {
    if (i === vars.length) {
      out.push(row);
      return;
    }
    const v = vars[i];
    if (!v) return;
    for (const value of v.values) {
      const next = { ...row, [v.id]: value.id };
      if (valid(store, next)) walk(i + 1, next);
    }
  };
  walk(0, {});
  return out;
}

function weight(store: StoreDoc, row: Row): number {
  return Object.entries(row)
    .sort(([a], [b]) => order(a, b))
    .reduce((product, [id, value]) => {
      const variable = store.variables.find((v) => v.id === id);
      if (!variable) throw new Error(`unknown variable ${id}`);
      const weights = variable.values.map((v) => v.weight ?? 1);
      return (
        product *
        ((weights[variable.values.findIndex((v) => v.id === value)] as number) /
          weights.reduce((a, b) => a + b, 0))
      );
    }, 1);
}

function subsets(ids: string[], n: number): string[][] {
  if (n === 0) return [[]];
  return ids.flatMap((id, i) => subsets(ids.slice(i + 1), n - 1).map((tail) => [id, ...tail]));
}

function tuples(rows: Row[], groups: Group[]): Map<string, Row> {
  const out = new Map<string, Row>();
  for (const group of groups) {
    for (const ids of subsets(
      [...group.variables].sort(order),
      Math.min(group.strength, group.variables.length),
    )) {
      for (const row of rows) {
        if (ids.every((id) => row[id] !== undefined)) {
          const tuple = Object.fromEntries(ids.map((id) => [id, row[id] as string]));
          out.set(key(tuple), tuple);
        }
      }
    }
  }
  return out;
}

function buildStore(sources: Sources): StoreDoc {
  const store: StoreDoc = { variables: [], impossible: [], rules: [], refused: [] };
  for (const rule of sources.estate?.rules ?? []) {
    const ids: string[] = [];
    for (const { text } of rule.conditions) {
      const id = `condition_${createHash('sha256').update(text).digest('hex').slice(0, 12)}`;
      ids.push(id);
      store.variables.push({
        id,
        values: ['below', 'edge', 'above'].map((value) => ({
          id: value,
          provenance: [{ kind: 'quote', path: rule.source, quote: text }],
        })),
      });
    }
    for (const tool of rule.tools) {
      const id = `${tool.tool}.${tool.field}`;
      ids.push(id);
      store.variables.push({
        id,
        values: tool.values.map((v) => ({
          id: v.id,
          provenance: [{ kind: 'quote', path: tool.source, quote: v.quote }],
        })),
      });
    }
    store.rules.push({ id: rule.id, variables: ids });
  }
  return store;
}

export const variablesImpl: VariablesImpl = {
  buildStore,
  plan(store, options) {
    for (const variable of store.variables) {
      for (const id of [variable.id, ...variable.values.map((value) => value.id)]) {
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) throw new RangeError('invalid store ID');
      }
    }
    const seeds = options.seeds ?? [];
    const seeded = new Set(seeds.map(key));
    const rows = allRows(store)
      .filter((row) => !seeded.has(key(row)))
      .map((values) => ({ values, weight: weight(store, values) }))
      .sort((a, b) => b.weight - a.weight || order(key(a.values), key(b.values)));
    const plan: Plan = {
      rows: [
        ...seeds.map((values, i) => ({
          id: `seed${i}`,
          kind: 'seed' as const,
          values: JSON.parse(JSON.stringify(values)) as Row,
          weight: weight(store, values),
        })),
        ...rows.map((row, i) => ({ id: `new${i}`, kind: 'new' as const, ...row })),
      ],
    };
    if (options.budget !== undefined) plan.rows = plan.rows.slice(0, Math.max(options.budget, seeds.length));
    return plan;
  },
  coverage(store, rows, groups, options) {
    const allowed = tuples(allRows(store), groups);
    const held = tuples(rows, groups);
    const covered = [...allowed.keys()].filter((id) => held.has(id)).length;
    return {
      allowed: allowed.size,
      covered,
      uncovered: [...allowed]
        .filter(([id]) => !held.has(id))
        .slice(0, options?.uncovered ?? 0)
        .map(([, row]) => row),
    };
  },
  weightInterval(count, total) {
    // Wilson's score interval, computed independently of the production bank's statistics helper.
    const z = 1.959963984540054;
    const p = count / total;
    const centre = (p + z ** 2 / (2 * total)) / (1 + z ** 2 / total);
    const radius = (z * Math.sqrt((p * (1 - p)) / total + z ** 2 / (4 * total ** 2))) / (1 + z ** 2 / total);
    return [Math.max(0, centre - radius), Math.min(1, centre + radius)];
  },
};
