import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadVariableStore,
  NONE,
  type VariableStore,
  validateVariableStore,
  variablesToSpaceMap,
} from '@agent-nexus/driftbench-space';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  loadProposal,
  Proposal,
  proposalToVariables,
  toSpaceMap,
  verifyVariableQuotes,
} from '../../src/extract';

const ACME_MAP = fileURLToPath(new URL('../../../../examples/acme/map/', import.meta.url));
const EXAMPLES = fileURLToPath(new URL('../../../../examples/variables/', import.meta.url));

async function proposalAt(path: string): Promise<Proposal> {
  const loaded = await loadProposal(path);
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
  return loaded.proposal;
}

function checked(store: VariableStore): VariableStore {
  const result = validateVariableStore(store);
  if (!result.ok) throw new Error(JSON.stringify(result.errors.slice(0, 3)));
  expect(result.warnings).toEqual([]);
  return result.store;
}

/** The dimensions and constraints of a proposal, rebuilt from its store: the inverse of the conversion. */
function proposalPartsOf(store: VariableStore) {
  const evidence = (provenance: VariableStore['constraints'][number]['provenance']) => {
    const [entry] = provenance ?? [];
    if (entry?.kind !== 'quote') throw new Error('expected a quote');
    return { source: entry.path, quote: entry.quote };
  };
  return {
    dimensions: store.variables.map((variable) => ({
      id: variable.id,
      title: variable.title,
      kind: variable.kind,
      role: variable.role,
      produced_by: variable.produced_by,
      approved: variable.approved,
      values: variable.values.map(({ provenance, ...value }) => ({
        ...value,
        evidence: evidence(provenance),
      })),
    })),
    constraints: store.constraints.map(({ provenance, ...constraint }) => ({
      ...constraint,
      evidence: evidence(provenance),
    })),
  };
}

describe('the approved Acme proposal becomes a store with nothing lost', () => {
  let approved: Proposal;
  let store: VariableStore;
  beforeAll(async () => {
    approved = await proposalAt(`${ACME_MAP}approved.yaml`);
    store = checked(proposalToVariables(approved));
  });

  it('keeps every dimension, value and constraint, and the inventory', () => {
    expect(store.variables).toHaveLength(approved.dimensions.length);
    expect(store.variables.flatMap((variable) => variable.values)).toHaveLength(
      approved.dimensions.reduce((sum, dimension) => sum + dimension.values.length, 0),
    );
    expect(store.constraints).toHaveLength(approved.constraints.length);
    expect(store.agent).toBe('acme');
    expect(store.inventory).toBe('../inventory.yaml');
  });

  it('keeps every field: the proposal comes back from the store as it was', () => {
    const parts = proposalPartsOf(store);
    expect(parts.dimensions).toEqual(approved.dimensions);
    expect(parts.constraints).toEqual(approved.constraints);
  });

  it('turns the evidence of each entry into a quote that is still in its source', async () => {
    const provenance = store.variables.flatMap((variable) =>
      variable.values.flatMap((value) => value.provenance ?? []),
    );
    expect(provenance.every((entry) => entry.kind === 'quote')).toBe(true);
    expect(await verifyVariableQuotes(store, dirname(`${ACME_MAP}approved.yaml`))).toEqual([]);
  });

  it('gives the axes the generator keeps today, the value none of the deviation axis aside', () => {
    const result = variablesToSpaceMap(store);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const today = toSpaceMap(approved, { approvedOnly: true, derive: false });
    const shape = (map: typeof today) =>
      map.dimensions.map((dimension) => [
        dimension.id,
        dimension.title,
        dimension.kind,
        dimension.values.filter((value) => value.id !== NONE).map((value) => [value.id, value.title]),
      ]);
    expect(shape(result.map)).toEqual(shape(today));
    expect(result.map.constraints).toEqual(today.constraints);
    expect(result.map.inventory).toBe(today.inventory);
  });
});

describe('the Acme proposal nobody approved', () => {
  let proposed: Proposal;
  let store: VariableStore;
  beforeAll(async () => {
    proposed = await proposalAt(`${ACME_MAP}proposal.yaml`);
    store = checked(proposalToVariables(proposed));
  });

  it('keeps its flags: nothing is approved, so the space map has no axis', () => {
    expect(store.variables.every((variable) => !variable.approved)).toBe(true);
    expect(store.constraints.every((constraint) => !constraint.approved)).toBe(true);
    const result = variablesToSpaceMap(store);
    expect(!result.ok && result.errors.map((issue) => `${issue.code} ${issue.path}`)).toEqual([
      'SCHEMA_TOO_SMALL dimensions',
    ]);
  });

  it('gives all the axes with approvedOnly off, as the proposal does', () => {
    const result = variablesToSpaceMap(store, { approvedOnly: false });
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const today = toSpaceMap(proposed, { derive: false });
    expect(result.map.dimensions.map((dimension) => dimension.id)).toEqual(
      today.dimensions.map((dimension) => dimension.id),
    );
  });

  it('is lossless too', () => {
    const parts = proposalPartsOf(store);
    expect(parts.dimensions).toEqual(proposed.dimensions);
    expect(parts.constraints).toEqual(proposed.constraints);
  });
});

describe('a proposal that uses every field of a value', () => {
  const quote = (text: string) => ({ source: 'prompt.md', quote: text });
  const proposal = Proposal.parse({
    version: 1,
    agent: 'zed',
    produced_by: { family: 'code', model: 'code', at: '2026-10-17T10:00:00.000Z' },
    sources: [{ kind: 'prompt', path: 'prompt.md' }],
    dimensions: [
      {
        id: 'rule',
        title: 'Rules',
        kind: 'behaviour',
        role: 'axis',
        produced_by: 'model',
        approved: false,
        values: [
          {
            id: 'R1',
            title: 'Confirm before sending',
            evidence: quote('Confirm before sending.'),
            polarity: 'must',
            when: { channel: ['chat'] },
            unless: { channel: ['voice'] },
            limit: 2,
            within: { minutes: 10 },
            priority: 'first',
            weight: 0.4,
            required: true,
            produced_by: 'model',
            approved: true,
          },
          {
            id: 'R2',
            title: 'Never guess',
            evidence: quote('Never guess.'),
            weight: 0.6,
            produced_by: 'code',
          },
        ],
      },
      {
        id: 'channel',
        title: 'Channel',
        kind: 'channel',
        role: 'axis',
        produced_by: 'code',
        approved: true,
        values: [
          { id: 'chat', title: 'Chat', evidence: quote('Chat only.'), produced_by: 'code' },
          { id: 'voice', title: 'Voice', evidence: quote('Voice too.'), produced_by: 'code' },
        ],
      },
    ],
    constraints: [
      {
        forbid: { rule: 'R1', channel: 'voice' },
        reason: 'R1 is for chat.',
        evidence: quote('Chat only.'),
        produced_by: 'model',
        approved: false,
      },
    ],
    phrases: [],
  });
  const store = checked(proposalToVariables(proposal));

  it('keeps the rule fields, the weight, the flags and who wrote each entry', () => {
    const rule = store.variables[0]?.values[0];
    expect(rule).toMatchObject({
      polarity: 'must',
      when: { channel: ['chat'] },
      unless: { channel: ['voice'] },
      limit: 2,
      within: { minutes: 10 },
      priority: 'first',
      weight: 0.4,
      required: true,
      produced_by: 'model',
      approved: true,
    });
    expect(store.variables[0]?.values[1]).not.toHaveProperty('approved');
    expect(store.variables[0]?.approved).toBe(false);
    expect(store.constraints[0]?.approved).toBe(false);
    expect(proposalPartsOf(store).dimensions).toEqual(proposal.dimensions);
    expect(proposalPartsOf(store).constraints).toEqual(proposal.constraints);
  });

  it('leaves out a value whose own flag is false and a variable nobody approved, as the proposal does', () => {
    const result = variablesToSpaceMap(store);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    // The flag of the rule dimension is false, but R1 carries its own true: R1 stays, R2 goes.
    expect(result.map.dimensions.map((d) => [d.id, d.values.map((value) => value.id)])).toEqual([
      ['rule', ['R1']],
      ['channel', ['chat', 'voice']],
    ]);
    expect(result.map.constraints).toEqual([]);
    const today = toSpaceMap(proposal, { approvedOnly: true, derive: false });
    expect(today.dimensions.map((d) => [d.id, d.values.map((value) => value.id)])).toEqual([
      ['rule', ['R1']],
      ['channel', ['chat', 'voice']],
    ]);
  });
});

describe('verifyVariableQuotes', () => {
  async function folder(files: Record<string, string>): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-quotes-'));
    for (const [name, text] of Object.entries(files)) {
      await mkdir(dirname(join(dir, name)), { recursive: true });
      await writeFile(join(dir, name), text);
    }
    return dir;
  }

  const storeWith = (...provenance: unknown[]): VariableStore =>
    checked({
      format: 1,
      agent: 'demo',
      version: '1',
      prior: { kind: 'declared' },
      variables: [
        {
          id: 'v',
          title: 'V',
          kind: 'data',
          role: 'axis',
          approved: true,
          values: provenance.map((entry, index) => ({
            id: `x${index}`,
            title: `X${index}`,
            provenance: [entry as never],
          })),
        },
      ],
      constraints: [],
    });

  it('finds a quote word for word, across lines and with typographic marks, and ignores the other kinds', async () => {
    const dir = await folder({
      'a.md': 'Keep each reply short:\n   at most four sentences.\n\nIt’s “plain” text.',
    });
    const store = storeWith(
      { kind: 'quote', path: 'a.md', quote: 'Keep each reply short: at most four sentences.' },
      { kind: 'quote', path: 'a.md', quote: 'It\'s "plain" text.' },
      { kind: 'owner', words: 'Not in any file.', date: '2026-10-15' },
      { kind: 'conversations', count: 1, total: 2, set_hash: 'b'.repeat(64) },
    );
    expect(await verifyVariableQuotes(store, dir)).toEqual([]);
  });

  it('names a quote the file does not hold, at its path, and one that differs by a word or by case', async () => {
    const dir = await folder({ 'a.md': 'Keep each reply short.' });
    const store = storeWith(
      { kind: 'quote', path: 'a.md', quote: 'Keep each reply short.' },
      { kind: 'quote', path: 'a.md', quote: 'Keep each reply brief.' },
      { kind: 'quote', path: 'a.md', quote: 'keep each reply short.' },
    );
    const issues = await verifyVariableQuotes(store, dir);
    expect(issues.map((issue) => `${issue.code} ${issue.path}`)).toEqual([
      'VARIABLES_QUOTE_NOT_FOUND variables.0.values.1.provenance.0.quote',
      'VARIABLES_QUOTE_NOT_FOUND variables.0.values.2.provenance.0.quote',
    ]);
  });

  it('names a file it cannot read once, and does not call its quotes missing', async () => {
    const dir = await folder({});
    const store = storeWith(
      { kind: 'quote', path: 'gone.md', quote: 'One.' },
      { kind: 'quote', path: 'gone.md', quote: 'Two.' },
    );
    const issues = await verifyVariableQuotes(store, dir);
    expect(issues.map((issue) => `${issue.code} ${issue.path}`)).toEqual([
      'VARIABLES_SOURCE_UNREADABLE variables.0.values.0.provenance.0.path',
    ]);
  });
});

describe('the quotes of the worked examples', () => {
  for (const name of ['acme', 'northwind', 'tidewater']) {
    it(`are all in the files ${name}.yaml names`, async () => {
      const result = await loadVariableStore(`${EXAMPLES}${name}.yaml`);
      if (!result.ok) throw new Error(JSON.stringify(result.errors));
      expect(await verifyVariableQuotes(result.store, EXAMPLES)).toEqual([]);
    });
  }
});
