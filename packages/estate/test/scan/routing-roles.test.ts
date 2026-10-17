import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';
import { routingKindDeclarations, routingKinds, routingKindTables } from './routing-kinds-corpus';

describe('routing is decided by table kinds and cell content', () => {
  it('covers independent route and inventory kinds', () => {
    expect(routingKinds.filter((test) => test.outcome === 'route').length).toBeGreaterThanOrEqual(10);
    expect(routingKinds.filter((test) => test.outcome === 'inventory').length).toBeGreaterThanOrEqual(10);
  });
  it.each(routingKindTables)('$name', async ({ table, rows, outcome }) => {
    const root = await estate({ ...routingKindDeclarations, 'CLAUDE.md': table });
    const { map, raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    const routes = map.atoms.filter((atom) => atom.kind === 'route' && atom.fields?.via === 'table');
    expect(routes.map((atom) => [atom.fields?.ask, atom.fields?.target])).toEqual(
      outcome === 'route'
        ? rows.map(([ask, cell]) => [
            ask
              .replace(/[`*]/g, '')
              .replace(/[.!]+$/, '')
              .trim(),
            /`([^`]+)`/.exec(cell)?.[1],
          ])
        : [],
    );
    expect(raw.notes.some((note) => note.message.startsWith('Ambiguous routing table'))).toBe(
      outcome === 'ambiguous',
    );
    for (const atom of routes)
      expect(table.split('\n')[atom.provenance.startLine - 1]).toBe(atom.provenance.quote);
  });
  it.each(routingKindTables)('header-label invariance: $name', async ({ table, rows, outcome }) => {
    const text = table.replace(/^[^\n]+/, '| λ | Ω |');
    const root = await estate({ ...routingKindDeclarations, 'CLAUDE.md': text });
    const { map, raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.atoms.filter((atom) => atom.kind === 'route' && atom.fields?.via === 'table')).toHaveLength(
      outcome === 'route' ? rows.length : 0,
    );
    expect(raw.notes.some((note) => note.message.startsWith('Ambiguous routing table'))).toBe(
      outcome === 'ambiguous',
    );
  });
});
