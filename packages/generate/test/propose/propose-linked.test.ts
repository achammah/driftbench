import { describe, expect, it } from 'vitest';
import { parseProposals } from '../../src/index';

/** Fictional data only. A proposal hash is the spec identity hash: links in a proposal never move it. */
const BASE = `id: acme-hours
kind: conversation
target: { adapter: function, agent: acme-sales }
blocks:
  - id: ask
    user: When do you open on Saturday?
    expect:
      must: ["nine"]
`;
const LINKS = `metadata:
  links:
    - block: ask
      to: { kind: prompt_section, prompt: acme-sales, section: hours }
      status: declared
`;

describe('parseProposals on a linked proposal', () => {
  it('hashes a proposal with links like the same proposal without them', () => {
    const [plain] = parseProposals(BASE);
    const [linked] = parseProposals(`${BASE}${LINKS}`);
    if (!plain?.ok || !linked?.ok) throw new Error('a proposal did not parse');
    expect(linked.spec.metadata?.links).toHaveLength(1);
    expect(plain.spec.metadata?.links).toBeUndefined();
    expect(linked.hash).toBe(plain.hash);
    // The hash still follows the rest of the spec.
    const [edited] = parseProposals(`${BASE.replace('nine', 'ten')}${LINKS}`);
    if (!edited?.ok) throw new Error('the edited proposal did not parse');
    expect(edited.hash).not.toBe(plain.hash);
  });
});
