import { describe, expect, it } from 'vitest';
import type { EstateAtom, EstatePlanRow } from '../../src/estate/inputs';
import { compilePredicate } from '../../src/estate/predicates';
import { recoveryAction } from '../../src/estate/recovery';
import { anchorPair, pathsOf, stageModel, thenOf } from '../../src/estate/then';
import { materialOf, unitTestOf } from '../../src/estate/unit';

const atom = (patch: Partial<EstateAtom> = {}): EstateAtom => ({
  id: 'rule.garden',
  kind: 'instruction',
  title: 'Garden rule',
  approved: true,
  evidence: [],
  ...patch,
});
const context = {
  stages: stageModel([]),
  skills: new Set<string>(),
  customChecks: new Set(['hazard_recovery', 'max_words']),
};
const guard = atom({
  id: 'guard.garden',
  kind: 'guard',
  fields: {
    name: 'garden.sh',
    command: 'garden.sh',
    event: 'PreToolUse',
    matcher: 'Bash',
    enforces: [{ atom: 'rule.garden', by: 'id' }],
  },
});
const row: EstatePlanRow = {
  id: 'row.garden',
  atomIds: [guard.id],
  cell: {},
  testType: 'guard_positive',
  mode: 'unit',
  status: 'approved',
};

function unit(rule: EstateAtom) {
  return unitTestOf(row, guard, new Map([[rule.id, rule]]), 'garden', 'unit.garden');
}

describe('estate generation reads declared evidence instead of English vocabulary', () => {
  it('does not classify quoted material by forbidden or permitted wording', () => {
    expect(materialOf('Never read `one.md`. Always open `two.md`.')).toEqual(['one.md', 'two.md']);
    expect(materialOf('Unlisted `one.md`. Unlisted `two.md`.')).toEqual(['one.md', 'two.md']);
  });
  it('fails a quote-only guard fixture closed despite a recognized prohibition verb', () => {
    expect(unit(atom({ provenance: { quote: 'Never remove `garden/`.' } }))).toContain(
      'structured unit payload',
    );
  });
  it('builds exact guard input from map evidence even when the quote uses an unknown verb', () => {
    const built = unit(
      atom({
        provenance: { quote: 'Zorble the garden.' },
        evidence: [
          { type: 'tool_not_called', label: 'Bash', input: { command: { equals: 'rm garden/a.txt' } } },
        ],
      }),
    );
    expect(typeof built).toBe('object');
    if (typeof built === 'string') throw new Error(built);
    expect(built.cases[0]?.payload).toMatchObject({
      tool_name: 'Bash',
      tool_input: { command: 'rm garden/a.txt' },
    });
  });
  it('uses an approved reverse guard ID relation without relying on its quote-derived link', () => {
    const textGuard = atom({
      ...guard,
      fields: {
        ...guard.fields,
        event: 'Stop',
        enforces: [{ atom: 'rule.garden', by: 'quote' }],
      },
    });
    const rule = atom({
      enforcement: [textGuard.id],
      evidence: [{ type: 'custom', name: 'max_characters', options: { max: 1200 } }],
    });
    const built = unitTestOf(row, textGuard, new Map([[rule.id, rule]]), 'garden', 'unit.garden');
    if (typeof built === 'string') throw new Error(built);
    expect(built.cases[0]?.material).toHaveLength(1201);
    const unapproved = { ...rule, approved: false };
    expect(unitTestOf(row, textGuard, new Map([[rule.id, unapproved]]), 'garden', 'unit.garden')).toContain(
      'structured unit payload evidence',
    );
  });
  it('does not silently omit an enforced rule missing payload evidence', () => {
    const two = atom({
      ...guard,
      fields: {
        ...guard.fields,
        enforces: [
          { atom: 'rule.garden', by: 'id' },
          { atom: 'rule.missing', by: 'id' },
        ],
      },
    });
    const rule = atom({
      fields: { unitCases: [{ effect: 'forbid', material: 'rm garden/a.txt', tool: 'Bash' }] },
    });
    expect(unitTestOf(row, two, new Map([[rule.id, rule]]), 'garden', 'unit.garden')).toContain(
      'rule.missing',
    );
  });
  it('uses declared recovery actions and leaves an imperative quote without evidence unresolved', () => {
    expect(recoveryAction(atom({ provenance: { quote: 'Re-read `garden.md` and retry.' } }))).toEqual({
      reread: [],
      calls: [],
      retry: false,
      unpathed: [],
    });
    expect(
      recoveryAction(atom({ fields: { recovery: { reread: ['garden.md'], retry: true } } })),
    ).toMatchObject({
      reread: ['garden.md'],
      retry: true,
    });
  });
  it('reports missing recovery evidence even when a judge is available', () => {
    const rule = atom({
      provenance: { quote: 'Re-read `garden.md` and retry.' },
      evidence: [{ type: 'custom', name: 'hazard_recovery' }],
    });
    expect(thenOf([rule], 'positive', { ...context, judge: true }).gaps[0]?.detail).toContain('declared');
  });
  it('requires structured ordering anchors and preserves the complete declared command', () => {
    expect(anchorPair('Read', 'Write', context, {}, 'Read a file before you edit it.')).toContain('declared');
    expect(anchorPair('Read', 'Write', context, { order: { key: 'file_path' } })).toEqual({
      before: 'Read',
      after: 'Write',
      key: 'file_path',
    });
    expect(
      anchorPair('Bash', 'Bash', context, { order: { before: 'git status', after: 'git commit --dry-run' } }),
    ).toEqual({ before: 'Bash~git status', after: 'Bash~git commit --dry-run' });
  });
  it('takes paths from fields and evidence rather than an extension dictionary', () => {
    expect(
      pathsOf(
        atom({ provenance: { quote: 'Read `inferred.md`.' }, fields: { path: 'garden.weirdextension' } }),
      ),
    ).toEqual(['garden.weirdextension']);
  });
  it('requires an explicit max_words scope instead of finding draft in the rule text', () => {
    const rule = atom({
      title: 'Limit the draft',
      evidence: [{ type: 'custom', name: 'max_words', options: { max: 2 } }],
    });
    expect(thenOf([rule], 'positive', context).gaps[0]?.detail).toContain('explicit part');
    rule.evidence = [{ type: 'custom', name: 'max_words', options: { max: 2, part: 'draft' } }];
    expect(thenOf([rule], 'positive', context).custom.max_words).toEqual({ max: 2, part: 'draft', block: 0 });
  });
  it('retains machine-format secret and currency checks', () => {
    for (const name of ['no_secret_in_reply', 'currency_after_amount']) {
      expect(compilePredicate(name)?.mustNot).toHaveLength(1);
      expect(
        thenOf([atom({ kind: 'register', evidence: [{ type: 'custom', name }] })], 'positive', {
          ...context,
          judge: true,
        }).gaps,
      ).toEqual([]);
    }
  });
  it('derives command guard payloads from typed prohibition evidence', () => {
    const built = unit(
      atom({
        evidence: [{ type: 'custom', name: 'command_not_run', options: { contains: 'git push --force' } }],
      }),
    );
    if (typeof built === 'string') throw new Error(built);
    expect(built.cases.map((entry) => entry.payload.tool_input)).toEqual([
      { command: 'git push --force', description: 'unit test' },
    ]);
  });
  it('derives command obligation mutants only when the declared assertion rejects them', () => {
    const built = unit(
      atom({
        fields: { spans: ['./track.sh ABC 123'] },
        evidence: [
          { type: 'tool_called', label: 'Bash', input: { command: { regex: 'track\\.sh [A-Z]{3} ' } } },
        ],
      }),
    );
    if (typeof built === 'string') throw new Error(built);
    expect(built.cases.map((entry) => entry.material)).toEqual(['./track.sh 123', './track.sh ABC']);
  });
  it('derives recovery from typed evidence on the same source span without reading its quote', () => {
    const provenance = { file: 'garden.md', startLine: 3, endLine: 3, quote: 'Zorble.' };
    const hazard = atom({ id: 'hazard.garden', kind: 'hazard', provenance });
    const instruction = atom({
      provenance,
      evidence: [
        { type: 'tool_called', label: 'Read', input: { file_path: { contains: 'notes/garden.md' } } },
      ],
    });
    expect(recoveryAction(hazard, new Map([[instruction.id, instruction]])).reread).toEqual([
      'notes/garden.md',
    ]);
  });
});
