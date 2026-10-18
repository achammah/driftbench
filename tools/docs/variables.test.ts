import { readFile } from 'node:fs/promises';
import {
  ConversationsProvenance,
  OwnerProvenance,
  QuoteProvenance,
  Variable,
  VariableBoundary,
  VariableConstraint,
  VariablePrior,
  VariableStore,
  VariableStoreIssueCodes,
  VariableValue,
} from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import { DOCS } from './check-links';

/** The variable store page says what the loader reports and what every field holds. */
describe('the variable store page', () => {
  const page = readFile(`${DOCS}/variables.md`, 'utf8');

  it('lists every issue code of the store', async () => {
    const text = await page;
    expect(VariableStoreIssueCodes.filter((code) => !text.includes(`| \`${code}\` |`))).toEqual([]);
  });

  it('names every field of the store, in a table row or in a snippet', async () => {
    const text = await page;
    const schemas = {
      VariableStore,
      Variable,
      VariableValue,
      VariableBoundary,
      VariableConstraint,
      VariablePrior,
      QuoteProvenance,
      ConversationsProvenance,
      OwnerProvenance,
    };
    const missing = Object.entries(schemas).flatMap(([name, schema]) =>
      Object.keys(schema.shape)
        .filter((field) => !text.includes(`\`${field}\``))
        .map((field) => `${name}.${field}`),
    );
    expect(missing).toEqual([]);
  });

  it('links the three worked examples and their folder', async () => {
    const text = await page;
    for (const name of ['acme', 'northwind', 'tidewater']) {
      expect(text).toContain(`(../examples/variables/${name}.yaml)`);
    }
    expect(text).toContain('(../examples/variables/README.md)');
  });
});
