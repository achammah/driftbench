import { describe, expect, it } from 'vitest';
import { type Spec, validateSpec, verifyGiven } from '../src/index';

/** Fictional data only. */
function specOf(raw: unknown): Spec {
  const result = validateSpec(raw);
  if (!result.ok) throw new Error(`invalid test spec: ${JSON.stringify(result.errors)}`);
  return result.spec;
}

const checks = (spec: Spec) => verifyGiven(spec).map((found) => `${found.block}:${found.check}`);

describe('the Given verifier on blocks linked by parent: each block reads the Given of its ancestors', () => {
  it('does not give a second root the ledger or the prefix of the first tree', () => {
    const spec = specOf({
      id: 'two-roots',
      blocks: [
        {
          id: 'shop',
          user: 'I need a quote.',
          given: {
            ledger: { address: '12 Oak Street' },
            prefix: [{ role: 'user', content: 'I live at 12 Oak Street.' }],
          },
        },
        {
          id: 'repair',
          user: 'My chain is broken.',
          given: { shared: [{ fact: 'address', by: 'user', in: 0 }] },
        },
        { id: 'repair-ask', parent: 'repair', user: 'Please go on.' },
      ],
    });
    // The spec declares a parent link, so its blocks form a forest. The repair tree starts at the spec defaults: no ledger fact, no prefix.
    expect(checks(spec)).toEqual(['1:value_in_message']);
    expect(verifyGiven(spec)[0]?.got).toBe('the ledger holds no such fact');
  });

  it('gives a child the prefix and ledger of its parent, whatever block stands before it in the file', () => {
    const spec = specOf({
      id: 'child-after-other-tree',
      blocks: [
        {
          id: 'shop',
          user: 'I need a quote.',
          given: {
            ledger: { address: '12 Oak Street' },
            prefix: [{ role: 'user', content: 'I live at 12 Oak Street.' }],
          },
        },
        {
          id: 'repair',
          user: 'My chain is broken.',
          given: { prefix: [{ role: 'user', content: 'Nothing to say here.' }] },
        },
        {
          id: 'shop-ask',
          parent: 'shop',
          user: 'Please go on.',
          given: { shared: [{ fact: 'address', by: 'user', in: 0 }] },
        },
      ],
    });
    expect(checks(spec)).toEqual([]);
  });

  it('does not warn that a fact of another tree changed in this one', () => {
    const spec = specOf({
      id: 'chain-per-tree',
      blocks: [
        { id: 'a', user: 'One.', expect: { ledger_add: { plan: 'pro' } } },
        { id: 'b', user: 'Two.', expect: { ledger_add: { plan: 'basic' } } },
        { id: 'b1', parent: 'b', user: 'Three.', expect: { ledger_add: { plan: 'plus' } } },
      ],
    });
    // Only b1 follows a block that set plan (b): the warning is on b1, not on b.
    expect(checks(spec)).toEqual(['2:chain']);
  });

  it('checks a recorded call against the tools forced in its own tree only', () => {
    const call = { id: 'c1', label: 'lookup', input: {}, output: { plan: 'basic' } };
    const spec = specOf({
      id: 'world-per-tree',
      blocks: [
        { id: 'a', user: 'One.', given: { world: { tools: { lookup: { result: { plan: 'pro' } } } } } },
        {
          id: 'b',
          user: 'Two.',
          given: {
            prefix: [
              { role: 'user', content: 'hi' },
              { role: 'assistant', content: 'checking', tool_calls: [call] },
            ],
          },
        },
        { id: 'b1', parent: 'b', user: 'Three.' },
      ],
    });
    // b starts at the spec defaults, where lookup is not forced: its recorded call contradicts nothing.
    expect(checks(spec)).toEqual([]);
  });

  it('still catches the defect inside one tree, and leaves a flat spec as it was', () => {
    const call = { id: 'c1', label: 'lookup', input: {}, output: { plan: 'basic' } };
    const withPrefix = {
      prefix: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'checking', tool_calls: [call] },
      ],
    };
    const tree = specOf({
      id: 'world-in-tree',
      blocks: [
        { id: 'a', user: 'One.', given: { world: { tools: { lookup: { result: { plan: 'pro' } } } } } },
        { id: 'a1', parent: 'a', user: 'Two.', given: withPrefix },
      ],
    });
    expect(checks(tree)).toEqual(['1:history_matches_world']);
    const flat = specOf({
      id: 'world-flat',
      blocks: [
        { user: 'One.', given: { world: { tools: { lookup: { result: { plan: 'pro' } } } } } },
        { user: 'Two.', given: withPrefix },
      ],
    });
    expect(checks(flat)).toEqual(['1:history_matches_world']);
  });

  it('checks a long chain and a wide fan of readers in linear time: a situation is copied only by a block that writes while another holds it', () => {
    const chain = Array.from({ length: 3000 }, (_, n) => ({
      id: `c${n}`,
      ...(n === 0 ? {} : { parent: `c${n - 1}` }),
      user: `Step ${n}.`,
      expect: { ledger_add: { [`fact${n}`]: n } },
    }));
    const fan = Array.from({ length: 3000 }, (_, n) => ({
      id: `f${n}`,
      parent: 'c2999',
      user: `Branch ${n}.`,
    }));
    const spec = specOf({ id: 'long', blocks: [...chain, ...fan] });
    const started = Date.now();
    expect(checks(spec)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('keeps a sibling tree clean when one branch writes to a ledger they share', () => {
    const spec = specOf({
      id: 'shared-ledger',
      given: { ledger: { plan: 'pro' } },
      blocks: [
        { id: 'root', user: 'One.' },
        { id: 'left', parent: 'root', user: 'Two.', expect: { ledger_add: { plan: 'basic' } } },
        { id: 'right', parent: 'root', user: 'Three.', expect: { ledger_add: { plan: 'pro' } } },
        { id: 'right-child', parent: 'right', user: 'Four.', expect: { ledger_add: { plan: 'pro' } } },
      ],
    });
    // left changes plan to basic (a chain warning); right and its child still see pro.
    expect(checks(spec)).toEqual(['1:chain']);
  });
});
