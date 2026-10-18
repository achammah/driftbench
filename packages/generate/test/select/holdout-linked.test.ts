import { type Spec, validateSpec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { openBundle, type SealedBundle } from '../../src/select';

/** Fictional data only. A bundle sealed before a spec gained links still opens: links stay out of the seal. */
const PLAIN = {
  id: 'sealed-linked',
  version: '1',
  kind: 'conversation',
  title: 'A sealed conversation',
  blocks: [{ id: 'b1', when: { user: 'Hello' }, expect: { lang: 'EN' } }],
} as unknown as Spec;
const LINKED = {
  ...PLAIN,
  metadata: {
    links: [
      { block: 'b1', to: { kind: 'prompt_section', prompt: 'p', section: 'greeting' }, status: 'declared' },
    ],
    provenance: { entity: 'hand-written' },
  },
} as unknown as Spec;

function sealed(spec: unknown, hash: string): SealedBundle {
  return {
    sealed: true,
    note: 'n',
    source: 's',
    split: 'draw',
    seed: 1,
    share: 0.2,
    gate_seals: [],
    date: '2026-10-11',
    specs: [{ id: 'sealed-linked', path: 'conversations/sealed-linked.yaml', hash, spec }],
  };
}

describe('openBundle on a linked spec', () => {
  const hashOf = (spec: Spec): string => {
    const result = validateSpec(spec);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    return result.hash;
  };

  it('opens a linked spec against a hash sealed without its links, and the reverse', () => {
    const hash = hashOf(PLAIN);
    expect(hashOf(LINKED)).toBe(hash);
    expect(openBundle(sealed(LINKED, hash)).problems).toEqual([]);
    expect(openBundle(sealed(PLAIN, hash)).problems).toEqual([]);
    expect(openBundle(sealed(LINKED, hash)).specs.map((entry) => entry.id)).toEqual(['sealed-linked']);
    // A change to what the spec runs is still refused.
    const changed = { ...LINKED, title: 'Edited after the seal' } as unknown as Spec;
    expect(openBundle(sealed(changed, hash)).problems).toEqual([
      `sealed-linked: the content hash changed since it was sealed (${hash})`,
    ]);
  });
});
