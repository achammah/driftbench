import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

const skills = {
  '.claude/skills/ship/SKILL.md': '---\nname: ship\ndescription: Ship an order.\n---\n',
  '.claude/skills/shipping/SKILL.md': '---\nname: shipping\ndescription: Dispatch a parcel.\n---\n',
  '.claude/agents/auditor.md': '---\nname: auditor\ndescription: Audit an invoice.\n---\n',
};
describe('routing cells name a declared skill or helper', () => {
  it.each(['ship', '**ship**', '`ship`'])('reads %s as the exact target', async (cell) => {
    const root = await estate({
      ...skills,
      'CLAUDE.md': `| When | Load |\n|---|---|\n| send an order | ${cell} |\n`,
    });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.atoms.filter((a) => a.kind === 'route' && a.fields?.via === 'table')).toMatchObject([
      {
        fields: { target: 'ship', targetKind: 'skill', ask: 'send an order' },
        evidence: [{ type: 'skill_loaded', name: 'ship' }],
      },
    ]);
  });
  it('reads a helper name in the target cell with its dispatch evidence', async () => {
    const root = await estate({
      ...skills,
      'CLAUDE.md': '| When | Load |\n|---|---|\n| check an invoice | the auditor agent |\n',
    });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.atoms.filter((a) => a.kind === 'route' && a.fields?.via === 'table')).toMatchObject([
      {
        fields: { target: 'auditor', targetKind: 'subagent', ask: 'check an invoice' },
        evidence: [{ type: 'tool_called', input: { subagent_type: 'auditor' } }],
      },
    ]);
  });
  it('does not mistake a prefix, a prose mention or an undeclared name for a plain target', async () => {
    const root = await estate({
      ...skills,
      'CLAUDE.md':
        '| When | Load |\n|---|---|\n| send an order | shipping |\n| amend an order | shipment |\n| reschedule an order | discuss ship with a colleague |\n',
    });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(
      map.atoms.filter((a) => a.kind === 'route' && a.fields?.via === 'table').map((a) => a.fields?.target),
    ).toEqual(['shipping']);
  });
  it('uses the explicit agent target when a skill and helper share a name', async () => {
    const root = await estate({
      ...skills,
      '.claude/skills/auditor/SKILL.md': '---\nname: auditor\ndescription: Review an invoice.\n---\n',
      'CLAUDE.md': '| When | Load |\n|---|---|\n| check an invoice | the auditor agent |\n',
    });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.atoms.filter((a) => a.kind === 'route' && a.fields?.via === 'table')).toMatchObject([
      {
        fields: { target: 'auditor', targetKind: 'subagent' },
        evidence: [{ type: 'tool_called', input: { subagent_type: 'auditor' } }],
      },
    ]);
  });
});
