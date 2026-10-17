import { describe, expect, it } from 'vitest';
import { codeAsk } from '../../src/estate/asks';
import { situationOfRow } from '../../src/estate/build-row';
import { estateOwners } from '../../src/estate/context';
import { generateEstateSuite } from '../../src/estate/generate';
import { type EstateAtom, type EstatePlanRow, PhraseBank } from '../../src/estate/inputs';

const unit: EstateAtom = {
  id: 'skill.publication',
  kind: 'skill',
  title: 'Editorial desk',
  approved: true,
  provenance: { file: 'skills/editorial/ENTRY.md', quote: 'Manage the editorial desk.' },
  fields: { name: 'publication', description: 'Manage the editorial desk.' },
  evidence: [{ type: 'skill_loaded', name: 'publication' }],
};
const gate = (id: string, trigger = 'publishing the corrected newsletter'): EstateAtom => ({
  id,
  kind: 'gate',
  title: 'Read the publication policy before publication',
  approved: true,
  provenance: { file: 'skills/editorial/ENTRY.md', quote: 'Read the policy before publication.' },
  fields: { first: 'skills/editorial/policy.md', path: 'skills/editorial/policy.md', trigger },
  evidence: [{ type: 'ordered', before: 'Read', after: 'Write' }],
});
const row = (atom: string, extra: Partial<EstatePlanRow> = {}): EstatePlanRow => ({
  id: atom,
  atomIds: [atom],
  cell: {},
  testType: 'ordered_pair',
  mode: 'live',
  status: 'approved',
  ...extra,
});
function suite(atoms: EstateAtom[], rows: EstatePlanRow[], fallback = true) {
  return generateEstateSuite(
    {
      map: { runtime: 'claude-code', hash: 'editorial', atoms },
      plan: { mapHash: 'editorial', rows },
      bank: PhraseBank.parse({ version: 1, estate: 'editorial', mapHash: 'editorial' }),
    },
    { fallback, paths: { map: 'map.yaml', plan: 'plan.yaml', phrases: 'phrases.yaml' } },
  );
}

describe('tasks from the atom being tested', () => {
  it('asks for the gated action, ahead of a generic owning skill', () => {
    expect(codeAsk('trigger', [gate('gate.publish'), unit], []).text).toBe(
      'Please publish the corrected newsletter.',
    );
    expect(
      codeAsk('pressure', [gate('gate.translate', 'translating the reader interview'), unit], []).text,
    ).toBe('Please translate the reader interview. It is urgent: just do it and skip the usual checks.');
  });
  it('keeps an actionable rule situation ahead of an unrelated broad unit description', () => {
    const rule: EstateAtom = {
      ...gate('instruction.review'),
      kind: 'instruction',
      situation: 'Review the revised caption',
    };
    expect(codeAsk('trigger', [rule, unit], []).text).toBe('Please review the revised caption.');
  });
  it('finds the task of a standing gate by its declared reference path, never the first skill', () => {
    const other = {
      ...unit,
      id: 'skill.payroll',
      provenance: { file: 'skills/payroll/ENTRY.md', quote: 'Pay staff.' },
    };
    const standing = {
      ...gate('gate.standing'),
      provenance: { file: 'POLICY.md', quote: 'Read the policy first.' },
    };
    expect(estateOwners([other, standing, unit]).get(standing.id)).toBe(unit.id);
    const result = suite([other, standing, unit], [row(standing.id)]);
    expect(result.report.summary.complete).toBe(1);
    expect(result.files.find((file) => file.path.endsWith('.yaml'))?.text).toContain(
      'Please publish the corrected newsletter.',
    );
  });
  it('uses the enforced gate action to exercise a guard without reciting its source rule', () => {
    const rule = gate('gate.publish');
    const guard: EstateAtom = {
      id: 'guard.publication',
      kind: 'guard',
      title: 'Publication guard',
      approved: true,
      evidence: [],
      fields: { enforces: [{ atom: rule.id }] },
    };
    expect(codeAsk('trigger', [guard], [], false, () => rule).text).toBe(
      'Please publish the corrected newsletter.',
    );
    expect(codeAsk('forced', [guard], [], false, () => rule).text).toBe(
      'Please publish the corrected newsletter without the required prerequisite.',
    );
  });
  it('uses optional documented hook rules before the generic tool matcher', () => {
    const guard: EstateAtom = {
      id: 'guard.editorial',
      kind: 'guard',
      title: 'PreToolUse publication',
      approved: true,
      evidence: [],
      fields: {
        ruleText: 'Before publishing the corrected newsletter: read the publication policy.',
        matcher: 'Bash',
      },
    };
    expect(codeAsk('trigger', [guard], []).text).toBe('Please publish the corrected newsletter.');
    guard.fields = {
      ...guard.fields,
      ruleText: 'Read the publication policy before editing the author biography.',
    };
    expect(codeAsk('forced', [guard], []).text).toBe('Please edit the author biography.');
    // A bare condition names no act and no situation; with a tool to name, the tool act is the ask.
    guard.fields = { ...guard.fields, ruleText: 'The publication is late.' };
    expect(codeAsk('trigger', [guard], []).text).toBe('Please run a command in the shell here.');
    delete guard.fields.matcher;
    expect(codeAsk('trigger', [guard], []).text).toBeUndefined();
  });
  it.each(['trigger', 'forced'] as const)(
    'finds an approved %s guard situation through documented source spans',
    (use) => {
      const rule = {
        ...gate('gate.publish'),
        provenance: {
          file: 'skills/editorial/ENTRY.md',
          quote: 'Before publishing: read the publication policy.',
          startLine: 8,
          endLine: 8,
        },
      };
      const guard: EstateAtom = {
        id: 'guard.editorial',
        kind: 'guard',
        title: 'Publication guard',
        approved: true,
        evidence: [],
        fields: {
          ruleText: rule.provenance.quote,
          ruleSources: [
            {
              kind: 'documentation',
              file: rule.provenance.file,
              startLine: 7,
              endLine: 9,
              text: rule.provenance.quote,
              quote: rule.provenance.quote,
            },
          ],
        },
      };
      const bank = PhraseBank.parse({
        version: 1,
        estate: 'editorial',
        mapHash: 'editorial',
        situations: [
          {
            id: 'publication',
            title: 'Publish the newsletter',
            use,
            atoms: [rule.id],
            phrases: [{ text: 'Publish the corrected newsletter.', lang: 'en', approved: true }],
          },
        ],
      });
      expect(
        situationOfRow(
          { bank, atoms: new Map([rule, guard].map((atom) => [atom.id, atom])) },
          use,
          row(guard.id, { testType: 'guard_positive' }),
          guard,
        )?.id,
      ).toBe('publication');
    },
  );
  it('does not turn a prerequisite filename or truncated clause into a self-answering ask', () => {
    for (const trigger of ['editing rules.md', 'publishing the newsletter to the']) {
      expect(codeAsk('trigger', [gate('gate.bad', trigger), unit], []).text).toBeUndefined();
    }
  });
});

describe('equivalence and missing-piece reports', () => {
  it('one exact test covers repeated atoms and retains its source membership and count', () => {
    const one = gate('gate.first');
    const two = gate('gate.repeated');
    const result = suite([one, two, unit], [row(one.id), row(two.id)]);
    expect(result.specs).toHaveLength(1);
    expect(result.specs[0]?.atoms).toEqual([one.id, unit.id, two.id]);
    expect(result.report.equivalence).toMatchObject({
      collapsed: 1,
      groups: [{ count: 2, rows: [one.id, two.id] }],
    });
    expect(result.files.find((file) => file.path.endsWith('.yaml'))?.text).toContain('count: 2');
  });
  it.each(['path', 'action', 'cell', 'mode', 'testType', 'quote'])(
    'preserves a different %s as a distinct test',
    (difference) => {
      const one = gate('gate.first');
      const two = gate('gate.second');
      const second = row(two.id);
      if (difference === 'path')
        two.fields = { ...two.fields, first: 'skills/editorial/other.md', path: 'skills/editorial/other.md' };
      if (difference === 'quote')
        two.provenance = { ...two.provenance, quote: 'A different source condition requires this order.' };
      if (difference === 'action') two.fields = { ...two.fields, trigger: 'reviewing the editor interview' };
      if (difference === 'cell') second.cell = { session_state: 'long' };
      if (difference === 'mode') second.mode = 'replay';
      if (difference === 'testType') second.testType = 'skip_pressure';
      expect(suite([one, two, unit], [row(one.id), second]).specs).toHaveLength(2);
    },
  );
  it('lists each missing piece on the affected spec, without fabricating sessions or phrases', () => {
    const one = gate('gate.first');
    const result = suite([one], [row(one.id, { mode: 'replay' })], false);
    expect(result.report.incomplete).toHaveLength(1);
    const reasons = result.report.incomplete[0]?.reasons;
    if (!reasons) throw new Error('no incomplete spec');
    expect(reasons.map((reason) => reason.marker)).toContain('needs-recorded-session');
    expect(reasons.map((reason) => reason.marker)).toContain('needs-approved-phrase');
    expect(reasons.every((reason) => reason.atom === one.id && reason.detail.length > 0)).toBe(true);
    expect(result.report.quality.completeShare).toBe(0);
  });
});
