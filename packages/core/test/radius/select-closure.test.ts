import { describe, expect, it } from 'vitest';
import type { ChangeManifest } from '../../src/radius/change';
import type { SectionRegistry } from '../../src/radius/sections';
import { sectionSelection } from '../../src/radius/select';
import type { BlockLink } from '../../src/schema/links';
import type { Spec } from '../../src/schema/spec';

/** Fictional data only. Hand-written registries: the closure of a change through overrides and duplicates. */
const registryOf = (
  edges: Record<string, Partial<SectionRegistry['sections'][number]>>,
): SectionRegistry => ({
  prompt_id: 'p',
  version: 'v1',
  text_sha256: '0'.repeat(64),
  sections: ['rules', 'exception', 'policy_a', 'policy_b', 'recap'].map((id, index) => ({
    id,
    scope: 'local' as const,
    span: { start: index * 10, end: index * 10 + 9 },
    sha256: '0'.repeat(64),
    anchor: { quote: id },
    ...(edges[id] ?? {}),
  })),
});
const link = (block: string, section: string): BlockLink => ({
  block,
  to: { kind: 'prompt_section', prompt: 'p', section },
  status: 'declared',
});
/** One block per spec, linked to one section: no forward closure between them. */
const specs = (linked: Record<string, string>) =>
  Object.entries(linked).map(([id, section]) => ({
    hash: id,
    spec: {
      id,
      kind: 'conversation',
      blocks: [{ id, when: { user: '.' } }],
      metadata: { links: [link(id, section)] },
    } as Spec,
  }));
const change = (id: string): ChangeManifest => ({
  from: 'v1',
  to: 'v2',
  changes: [{ kind: 'prompt_section', id }],
});
const states = (selection: ReturnType<typeof sectionSelection>) =>
  Object.fromEntries(selection.specs.map((spec) => [spec.specId, spec.blocks[0]?.state]));

describe('the closure of a section change', () => {
  it('adds a section that overrides the changed one, and the blocks linked to it', () => {
    const registry = registryOf({ exception: { overrides: ['rules'] } });
    const selection = sectionSelection(
      specs({ on_rules: 'rules', on_exception: 'exception', on_recap: 'recap' }),
      change('p#rules'),
      [registry],
    );
    expect(selection.all).toBeNull();
    expect([...selection.closure].sort()).toEqual(['p#exception', 'p#rules']);
    expect(states(selection)).toEqual({ on_rules: 'direct', on_exception: 'direct', on_recap: 'out' });
  });

  it('adds the duplicates a changed section lists, and what refers to them', () => {
    const registry = registryOf({
      policy_a: { duplicates: ['policy_b'] },
      rules: { references: ['policy_b'] },
    });
    const selection = sectionSelection(
      specs({ on_a: 'policy_a', on_b: 'policy_b', on_rules: 'rules', on_recap: 'recap' }),
      change('p#policy_a'),
      [registry],
    );
    // policy_a lists policy_b as its duplicate; rules refers to policy_b, so the closure reaches it too.
    expect([...selection.closure].sort()).toEqual(['p#policy_a', 'p#policy_b', 'p#rules']);
    expect(states(selection)).toEqual({
      on_a: 'direct',
      on_b: 'direct',
      on_rules: 'direct',
      on_recap: 'out',
    });
  });
});
