import { describe, expect, it } from 'vitest';
import { completionComponents } from '../../src/ladders/estate/completion';
import { completionContract, rereadOf } from '../../src/ladders/estate/completion-contract';
import type { EstateRun, GeneratedSpec } from '../../src/ladders/estate/pipeline';

const provenance = { file: 'POLICY.md', quote: 'Re-read this file and `decoy.md`.' };

describe('completion recovery evidence', () => {
  it('does not infer recovery paths from English words or quoted paths', () => {
    expect(rereadOf({ provenance })).toEqual([]);
  });

  it('uses the declared recovery paths even when the prose names a different act', () => {
    expect(rereadOf({ provenance, fields: { recovery: { reread: ['declared.md'] } } })).toEqual([
      'declared.md',
    ]);
  });
});

function contract(fields: Record<string, unknown>) {
  const atom = {
    id: 'hazard.fixture',
    kind: 'hazard',
    provenance,
    fields: { hazard: 'compaction', ...fields },
    evidence: [{ type: 'custom', name: 'hazard_recovery', options: { hazard: 'compaction' } }],
  };
  const run = {
    plan: { plan: { rows: [{ id: 'row.fixture', atomIds: [atom.id] }] } },
    scanned: { map: { atoms: [atom] } },
    situations: [],
  } as unknown as EstateRun;
  const source = {
    record: { row: 'row.fixture', testType: 'hazard_recovery' },
    loaded: { spec: { blocks: [{ when: { user: 'Continue the fixture.' } }] } },
  } as unknown as GeneratedSpec;
  return completionContract(run, source);
}

describe('completion recovery source gaps', () => {
  it('fails closed when only prose suggests recovery work', () => {
    const gaps = completionComponents(contract({})).gaps;
    expect(gaps).toContain('0.custom.hazard_recovery.unsupported-option:missing_source_recovery_evidence');
  });

  it('does not drop invalid entries beside valid recovery evidence', () => {
    const gaps = completionComponents(contract({ recovery: { reread: ['declared.md', null] } })).gaps;
    expect(gaps).toContain('0.custom.hazard_recovery.unsupported-option:invalid_source_recovery_evidence');
  });

  it('restores the declared reread independently of the emitted assertion', () => {
    const spec = contract({ recovery: { reread: ['declared.md'] } });
    expect(spec.rules?.custom?.hazard_recovery).toEqual({
      hazard: 'compaction',
      block: 0,
      reread: ['declared.md'],
    });
    expect(completionComponents(spec).gaps).toEqual([]);
  });
});
