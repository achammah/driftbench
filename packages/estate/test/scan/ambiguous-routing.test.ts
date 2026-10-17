import type { ModelPort } from '@agent-nexus/driftbench-generate';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';
import { routingKindDeclarations } from './routing-kinds-corpus';

const row = '| pier schedule mismatch | `cypress-check` |';
const table = `| A | B |\n|---|---|\n${row}\n| internal | \`quay-plan\` |`;
function answer(quote = row, target = 'cypress-check', targetKind = 'skill') {
  return {
    kind: 'route',
    title: 'Reconcile a dock schedule',
    quote,
    situation: 'reconcile the dock schedule',
    target,
    targetKind,
    evidence: [{ type: 'skill_loaded', name: target }],
  };
}
function recording(atom: ReturnType<typeof answer>, requests: string[]): ModelPort {
  return {
    family: 'routing-test',
    model: 'recorded',
    async complete(request) {
      requests.push(request.user);
      return JSON.stringify({ chunk: /^CHUNK: (.+)$/m.exec(request.user)?.[1], atoms: [atom] });
    },
  };
}
describe('ambiguous routing tables are deferred to the model', () => {
  it('emits no code route and records a review marker without a model', async () => {
    const root = await estate({ ...routingKindDeclarations, 'CLAUDE.md': table });
    const { map, raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.atoms.filter((atom) => atom.kind === 'route')).toEqual([]);
    expect(raw.notes).toContainEqual({
      file: 'CLAUDE.md',
      message: expect.stringContaining('Ambiguous routing table'),
    });
    expect(raw.prose[0]?.ambiguousRouting).toMatchObject([
      {
        startLine: 1,
        endLine: 4,
        targets: [
          { name: 'cypress-check', kind: 'skill' },
          { name: 'quay-plan', kind: 'skill' },
        ],
      },
    ]);
  });
  it('passes the marker to the model and accepts only an unapproved, grounded proposal', async () => {
    const requests: string[] = [];
    const root = await estate({ ...routingKindDeclarations, 'CLAUDE.md': table });
    const result = await scanEstate({
      root,
      reader: new ClaudeCodeReader(),
      now: NOW,
      port: recording(answer(), requests),
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain('AMBIGUOUS ROUTING');
    expect(result.refusals).toEqual([]);
    const routes = result.map.atoms.filter((atom) => atom.kind === 'route');
    expect(routes).toMatchObject([
      {
        producedBy: 'model',
        approved: false,
        fields: { target: 'cypress-check', targetKind: 'skill', via: 'model-table' },
        provenance: { quote: row, startLine: 3 },
      },
    ]);
    expect(result.map.edges.some((edge) => edge.kind === 'route' && edge.from === routes[0]?.id)).toBe(true);
  });
  it.each([
    ['unknown target', answer(row, 'nonexistent')],
    ['wrong target kind', answer(row, 'cypress-check', 'subagent')],
    ['outside the flagged span', answer('This paragraph is outside the routing table and gives no route.')],
  ])('rejects a model route with %s', async (_label, atom) => {
    const requests: string[] = [];
    const root = await estate({
      ...routingKindDeclarations,
      'CLAUDE.md': `${table}\n\nThis paragraph is outside the routing table and gives no route.`,
    });
    const result = await scanEstate({
      root,
      reader: new ClaudeCodeReader(),
      now: NOW,
      port: recording(atom, requests),
    });
    expect(result.map.atoms.filter((item) => item.kind === 'route')).toEqual([]);
    expect(result.refusals.length).toBeGreaterThan(0);
  });
  it('refuses a model route from an inventory that code did not flag', async () => {
    const inventoryRow = '| `cypress-check` | 48 MiB |';
    const requests: string[] = [];
    const root = await estate({
      ...routingKindDeclarations,
      'CLAUDE.md': `| Entry | Value |\n|---|---|\n${inventoryRow}`,
    });
    const result = await scanEstate({
      root,
      reader: new ClaudeCodeReader(),
      now: NOW,
      port: recording(answer(inventoryRow), requests),
    });
    expect(requests[0]).not.toContain('AMBIGUOUS ROUTING');
    expect(result.map.atoms.filter((atom) => atom.kind === 'route')).toEqual([]);
    expect(result.refusals.length).toBeGreaterThan(0);
  });
});

describe('target cells are not restricted to a directive word list', () => {
  it.each([
    ['run', 'Run `cypress-check`', ['cypress-check']],
    ['French action', 'Utiliser `cypress-check`', ['cypress-check']],
    ['German action', 'Aktivieren Sie `quay-plan`', ['quay-plan']],
    ['activate', 'Activate `cypress-check`', ['cypress-check']],
    ['apply', 'Apply the `cypress-check` skill', ['cypress-check']],
    ['hand off', 'Hand off to `ledger-reader`', ['ledger-reader']],
    ['annotation', '`cypress-check` — notify the depot afterwards', ['cypress-check']],
    [
      'several qualified targets',
      '`cypress-check` for seals; `quay-plan` for loading slots',
      ['cypress-check', 'quay-plan'],
    ],
    ['unlisted directive', 'Entrust this to `ledger-reader`', ['ledger-reader']],
    ['plain name', 'Load the cypress-check skill first.', ['cypress-check']],
    ['plain helper', 'Ask the ledger-reader agent', ['ledger-reader']],
  ])('reads %s', async (_label, target, expected) => {
    const root = await estate({
      ...routingKindDeclarations,
      'CLAUDE.md': `| Input | Chosen resource |\n|---|---|\n| Translate the revised crate labels | ${target} |`,
    });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(
      map.atoms
        .filter((atom) => atom.kind === 'route' && atom.fields?.via === 'table')
        .map((atom) => atom.fields?.target),
    ).toEqual(expected);
  });
});
