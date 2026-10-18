import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  loadVariableStore,
  type VariableStore,
  variableProvenance,
  variablesToSpaceMap,
} from '@agent-nexus/driftbench-space';
import { beforeAll, describe, expect, it } from 'vitest';

const FOLDER = fileURLToPath(new URL('../../../examples/variables/', import.meta.url));

type Example = { name: string; store: VariableStore; warnings: string[] };
const examples: Example[] = [];

beforeAll(async () => {
  for (const name of ['acme', 'northwind', 'tidewater']) {
    const result = await loadVariableStore(`${FOLDER}${name}.yaml`);
    if (!result.ok) throw new Error(`${name}: ${JSON.stringify(result.errors)}`);
    examples.push({ name, store: result.store, warnings: result.warnings.map((warning) => warning.path) });
  }
});

const named = (name: string): Example => {
  const found = examples.find((example) => example.name === name);
  if (!found) throw new Error(`no example ${name}`);
  return found;
};

describe('the three worked examples', () => {
  it('load: an agent of each kind, a prompt, an estate and a prompt with one tab per channel', () => {
    expect(examples.map((example) => [example.name, example.store.agent])).toEqual([
      ['acme', 'acme'],
      ['northwind', 'northwind'],
      ['tidewater', 'tidewater'],
    ]);
  });

  it('name a source for every value, boundary and constraint, but the 12 values of the fixed estate axes', () => {
    expect(named('acme').warnings).toEqual([]);
    expect(named('tidewater').warnings).toEqual([]);
    const northwind = named('northwind').warnings;
    expect(northwind).toHaveLength(12);
    expect(northwind.every((path) => /^variables\.[34]\.values\.\d$/.test(path))).toBe(true);
  });

  it('use the three kinds of provenance, and give some quotes a ledger id', () => {
    const entries = examples.flatMap((example) =>
      variableProvenance(example.store).map((item) => item.entry),
    );
    expect(new Set(entries.map((entry) => entry.kind))).toEqual(new Set(['quote', 'conversations', 'owner']));
    const ledgers = entries.flatMap((entry) =>
      entry.kind === 'quote' && entry.ledger ? [entry.ledger] : [],
    );
    expect(ledgers.length).toBeGreaterThan(10);
  });

  it('use every kind of author, both roles, an unapproved value and weights', () => {
    const variables = examples.flatMap((example) => example.store.variables);
    const values = variables.flatMap((variable) => variable.values);
    const constraints = examples.flatMap((example) => example.store.constraints);
    const authors = [...variables, ...values, ...constraints].map((entry) => entry.produced_by);
    expect(new Set(authors.filter((author) => author !== undefined))).toEqual(
      new Set(['code', 'model', 'owner']),
    );
    expect(new Set(variables.map((variable) => variable.role))).toEqual(new Set(['axis', 'detail']));
    expect(values.filter((value) => value.approved === false).map((value) => value.id)).toEqual([
      'other_language',
    ]);
    expect(values.some((value) => value.weight !== undefined)).toBe(true);
  });

  it('draw boundaries with every comparison but lt, and one with no number', () => {
    const boundaries = examples.flatMap((example) =>
      example.store.variables.flatMap((variable) => variable.boundaries ?? []),
    );
    expect(new Set(boundaries.map((boundary) => boundary.comparison))).toEqual(
      new Set(['gt', 'ge', 'le', undefined]),
    );
    expect(boundaries.filter((boundary) => boundary.limit === undefined)).toHaveLength(1);
  });

  it('keep the weights of a variable as shares that sum to 1', () => {
    for (const example of examples) {
      for (const variable of example.store.variables) {
        const weights = variable.values.flatMap((value) =>
          value.weight === undefined ? [] : [value.weight],
        );
        if (weights.length > 0) expect(weights.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 10);
      }
    }
  });

  it('keep counts that agree with the weight they support', () => {
    for (const example of examples) {
      for (const variable of example.store.variables) {
        for (const value of variable.values) {
          for (const entry of value.provenance ?? []) {
            if (entry.kind !== 'conversations') continue;
            expect(value.weight).toBeCloseTo(entry.count / entry.total, 10);
          }
        }
      }
    }
  });

  it('become a space map of their approved axes', () => {
    const axes = examples.map((example) => {
      const result = variablesToSpaceMap(example.store);
      if (!result.ok) throw new Error(`${example.name}: ${JSON.stringify(result.errors)}`);
      return [example.name, result.map.dimensions.map((dimension) => dimension.id)];
    });
    expect(axes).toEqual([
      ['acme', ['behaviour', 'channel', 'user_type', 'coverage_result']],
      ['northwind', ['session_state', 'estate_hazard']],
      ['tidewater', ['channel', 'follow_up', 'customer_language']],
    ]);
  });

  it('keep the invented prompt of the third example beside it', async () => {
    const prompt = await readFile(`${FOLDER}tidewater-prompt.md`, 'utf8');
    expect(prompt).toContain('Everything in this prompt is invented for testing.');
  });
});

describe('variableProvenance', () => {
  it('lists the entries in file order, each with its own path', () => {
    const paths = variableProvenance(named('tidewater').store).map((item) => item.path);
    expect(paths.slice(0, 3)).toEqual([
      'variables.0.values.0.provenance.0',
      'variables.0.values.0.provenance.1',
      'variables.0.values.1.provenance.0',
    ]);
    expect(paths.at(-1)).toBe('constraints.1.provenance.0');
    expect(new Set(paths).size).toBe(paths.length);
  });
});
