import { expect, it } from 'vitest';
import { buildPlan, ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

it('keeps the declared owner on both contract and target-only covering rows', async () => {
  const root = await estate({
    'CLAUDE.md': 'Before editing the reader interview: Read .claude/skills/editorial/references/policy.md.\n',
    '.claude/skills/payroll/SKILL.md':
      '---\nname: payroll\ndescription: Calculate the staff payroll.\n---\n# Payroll\n',
    '.claude/skills/editorial/SKILL.md':
      '---\nname: editorial\ndescription: Edit a reader interview for publication.\n---\n# Interviews\nRead references/policy.md\n',
    '.claude/skills/editorial/references/policy.md':
      '# Publication\nBefore publishing the reader interview: Read style.md.\n',
    '.claude/skills/editorial/references/style.md': '# Editorial style\n',
  });
  const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
  const plan = buildPlan(map).plan;
  const skill = map.atoms.find((atom) => atom.kind === 'skill' && atom.fields?.name === 'editorial');
  const gates = map.atoms.filter((atom) => atom.kind === 'gate');
  expect(gates).toHaveLength(2);
  if (!skill) throw new Error('missing editorial skill');
  for (const gate of gates) {
    const rows = plan.rows.filter((row) => row.atomIds[0] === gate.id);
    expect(rows.some((row) => row.id.startsWith('ordered_pair.'))).toBe(true);
    expect(rows.some((row) => row.id.startsWith('pairwise.'))).toBe(true);
    // The standing gate is owned by the skill whose folder holds its file; the skill joins the row only when the gate
    // is written in the skill's own files.
    const held = gate.provenance.file.startsWith('.claude/skills/editorial/');
    for (const row of rows) expect(row.atomIds).toEqual(held ? [gate.id, skill.id] : [gate.id]);
  }
}, 30_000);
