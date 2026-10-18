import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

const units = {
  '.claude/skills/tide-chart/SKILL.md': '---\nname: tide-chart\n---\n',
  '.claude/skills/dock-roster/SKILL.md': '---\nname: dock-roster\n---\n',
};

async function routes(standing: string) {
  const root = await estate({ ...units, 'CLAUDE.md': standing });
  const { map, raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
  return {
    routes: map.atoms.filter((atom) => atom.kind === 'route'),
    asks: map.atoms.filter((atom) => atom.kind === 'route').map((atom) => String(atom.fields?.ask)),
    ambiguous: raw.notes.filter((note) => note.message.includes('Ambiguous routing table')),
  };
}

describe('a route comes only from a cell that states when to use the unit', () => {
  it('reads the column that says when to use it and not the column that says what it cannot do', async () => {
    const result = await routes(
      [
        '| Skill | Use it when | It cannot do |',
        '|---|---|---|',
        '| `tide-chart` | The user wants the high tide hours of a harbour | Book a berth or take a payment |',
        '| `dock-roster` | The user asks who works the night shift | Change a contract or approve leave |',
        '',
      ].join('\n'),
    );
    expect(result.asks).toEqual([
      'The user wants the high tide hours of a harbour',
      'The user asks who works the night shift',
    ]);
    expect(result.ambiguous).toEqual([]);
  });

  it('reads the limit column wherever the table puts it', async () => {
    const result = await routes(
      [
        '| What it does not handle | Skill | When to load |',
        '|---|---|---|',
        '| Booking a berth for a ship | `tide-chart` | The user wants the high tide hours of a harbour |',
        '| Approving leave for a worker | `dock-roster` | The user asks who works the night shift |',
        '',
      ].join('\n'),
    );
    expect(result.asks).toEqual([
      'The user wants the high tide hours of a harbour',
      'The user asks who works the night shift',
    ]);
  });

  it('finds no route in a table that only states limits', async () => {
    const result = await routes(
      [
        '| Skill | Never use it for |',
        '|---|---|',
        '| `tide-chart` | Booking a berth for a ship |',
        '| `dock-roster` | Approving leave for a worker |',
        '',
      ].join('\n'),
    );
    expect(result.routes).toEqual([]);
    expect(result.ambiguous).toEqual([]);
  });

  it('drops a row whose own cell states a limit and keeps the rows that state when', async () => {
    const result = await routes(
      [
        '| Request | Skill |',
        '|---|---|',
        '| The user wants the high tide hours of a harbour | `tide-chart` |',
        '| Cannot book a berth for a ship | `tide-chart` |',
        '| The user asks who works the night shift | `dock-roster` |',
        '',
      ].join('\n'),
    );
    expect(result.asks).toEqual([
      'The user wants the high tide hours of a harbour',
      'The user asks who works the night shift',
    ]);
  });

  it('keeps a request that mentions a negation inside the situation it describes', async () => {
    const result = await routes(
      [
        '| Request | Skill |',
        '|---|---|',
        '| The user asks about a tide that has not come in | `tide-chart` |',
        '| The user asks who works the night shift | `dock-roster` |',
        '',
      ].join('\n'),
    );
    expect(result.asks).toEqual([
      'The user asks about a tide that has not come in',
      'The user asks who works the night shift',
    ]);
  });
});

describe('a prohibition addressed to the agent is a rule a table may bind to a unit', () => {
  it('keeps a row that opens with an imperative negation', async () => {
    const result = await routes(
      [
        '| Instruction | Binding |',
        '|---|---|',
        '| Do not share the harbour master key | `tide-chart` |',
        '| Never move the night shift without a note | `dock-roster` |',
        '',
      ].join('\n'),
    );
    expect(result.asks).toEqual([
      'Do not share the harbour master key',
      'Never move the night shift without a note',
    ]);
  });
});
