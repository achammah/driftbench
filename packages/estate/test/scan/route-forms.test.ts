import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, readTables, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

const skill = '.claude/skills/parcel-plan/SKILL.md';
const declaration = '---\nname: parcel-plan\ndescription: Plan parcel pickups.\n---\n';

describe('routing follows the role of the source text', () => {
  it.each([
    [
      'linked definition',
      '| When | Load |\n|---|---|\n| arrange a pickup | [parcel-plan](.claude/skills/parcel-plan/SKILL.md) |',
      3,
    ],
    ['slash command', '| When | Load |\n|---|---|\n| arrange a pickup | `/parcel-plan` |', 3],
    ['skill column first', '| Skill | Use when |\n|---|---|\n| `parcel-plan` | arrange a pickup |', 3],
    ['without outer pipes', 'When | Load\n---|---\narrange a pickup | `parcel-plan`', 3],
    ['list directive', '## Routing\n\n- To arrange a pickup: load `parcel-plan`.', 3],
    [
      'sentence directive',
      '## Routing\n\nWhen the user wants to arrange a pickup, load the `parcel-plan` skill.',
      3,
    ],
    ['task header', '| Task | Skill |\n|---|---|\n| arrange a pickup | `parcel-plan` |', 3],
    [
      'explicit action with a subject header',
      '| Subject | Load |\n|---|---|\n| arrange a pickup | `parcel-plan` |',
      3,
    ],
    [
      'condition header in the second column',
      '| Skill | If the user asks to |\n|---|---|\n| parcel-plan | arrange a pickup |',
      3,
    ],
    [
      'heading and use condition',
      '## Skills\n\n### `parcel-plan`\n\nUse it when the user wants to arrange a pickup.',
      3,
    ],
  ])('reads %s with the source line and ask', async (_label, text, line) => {
    const root = await estate({ [skill]: declaration, 'CLAUDE.md': `${text}\n` });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    const routes = map.atoms.filter((atom) => atom.kind === 'route' && atom.provenance.file === 'CLAUDE.md');
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({
      fields: { target: 'parcel-plan', targetKind: 'skill', ask: 'arrange a pickup' },
      provenance: { startLine: line, quote: text.split('\n')[Number(line) - 1] },
      evidence: [{ type: 'skill_loaded', name: 'parcel-plan' }],
    });
    expect(map.atoms.filter((atom) => atom.kind === 'reference')).toEqual([]);
  });

  it('ignores names in owner and notes columns', async () => {
    const root = await estate({
      [skill]: declaration,
      'CLAUDE.md': [
        '| Owner | Skill they maintain |',
        '|---|---|',
        '| Avery | `parcel-plan` |',
        '',
        '| When | Load | Notes |',
        '|---|---|---|',
        '| schedule a meeting | no skill | `parcel-plan` is maintained separately |',
      ].join('\n'),
    });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.atoms.filter((atom) => atom.kind === 'route' && atom.provenance.file === 'CLAUDE.md')).toEqual(
      [],
    );
  });

  it.each([
    ['ownership without a routing header', '| Custodian | Library |\n|---|---|\n| Morgan | `parcel-plan` |'],
    [
      'a repeated publication category',
      '| Publication | Package |\n|---|---|\n| Dispatch handbook | `parcel-plan` |\n| Dispatch handbook | `parcel-plan` |',
    ],
    [
      'a non-action column beside a request',
      '| Request | Who wrote it |\n|---|---|\n| arrange a pickup | Morgan |',
    ],
    [
      'a non-action column beside a load',
      '| Who wrote it | Skill you load |\n|---|---|\n| `parcel-plan` | nothing |',
    ],
  ])('ignores %s', async (_label, text) => {
    const root = await estate({ [skill]: declaration, 'CLAUDE.md': text });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.atoms.filter((atom) => atom.kind === 'route' && atom.provenance.file === 'CLAUDE.md')).toEqual(
      [],
    );
  });

  it('defers indistinguishable resource and author columns instead of guessing from their headers', async () => {
    const root = await estate({
      [skill]: declaration,
      '.claude/skills/receipt-check/SKILL.md':
        '---\nname: receipt-check\ndescription: Check receipts.\n---\n',
      'CLAUDE.md':
        '| Request | Skill you load | Who wrote it |\n|---|---|---|\n| arrange a pickup | `parcel-plan` | `receipt-check` |',
    });
    const { map, raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.atoms.filter((atom) => atom.kind === 'route' && atom.provenance.file === 'CLAUDE.md')).toEqual(
      [],
    );
    expect(raw.notes.some((note) => note.message.startsWith('Ambiguous routing table'))).toBe(true);
  });

  it('keeps an ordinary read of a skill definition as a reference', async () => {
    const root = await estate({
      [skill]: declaration,
      'CLAUDE.md': `Read [the definition](${skill}) before editing it.\n`,
    });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.atoms.filter((atom) => atom.kind === 'reference')).toMatchObject([
      { fields: { path: skill } },
    ]);
  });

  it('rejects a skill heading without a condition and a negated prose directive', async () => {
    const root = await estate({
      [skill]: declaration,
      'CLAUDE.md':
        '## Skills\n### `parcel-plan`\nA historical note.\n\nTo arrange a pickup: never load `parcel-plan`.\n',
    });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.atoms.filter((atom) => atom.kind === 'route' && atom.provenance.file === 'CLAUDE.md')).toEqual(
      [],
    );
  });

  it('reads escaped pipes as cell contents and preserves the source quote', () => {
    const row = '  arrange a pickup \\| a dropoff | `parcel-plan`';
    expect(readTables(`  When | Load\n  :---|---:\n${row}\n`)).toEqual([
      {
        header: ['When', 'Load'],
        headerLine: 1,
        rows: [{ line: 3, text: row, cells: ['arrange a pickup | a dropoff', '`parcel-plan`'] }],
      },
    ]);
  });
});
