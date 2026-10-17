import { describe, expect, it } from 'vitest';
import { validateSpec } from '../src/index';

/**
 * REGEX_INVALID wherever a spec writes a pattern that checks will compile:
 * packages/cli/help/authoring-spec-check.md: "a pattern in `must`, `must_not`, a `regex` assertion or a
 * `knowledge_retention` `ask` does not compile"; docs/reference/checks.md "Assertions on values": "Patterns
 * compile as JavaScript regular expressions with the `m` flag"; and `expect.regex` is "a list of regular
 * expressions the visible text must match".
 */
const BAD = '(unclosed';
const OK = '^ok$';

const errors = (raw: unknown) => {
  const result = validateSpec({ id: 'x', ...(raw as object) });
  return result.ok ? [] : result.errors.map((issue) => `${issue.code}@${issue.path}`);
};

const jsonPaths = (assert: unknown) => ({ json: { paths: [{ path: 'a', assert }] } });

describe('the loader refuses a pattern that does not compile, in every place a spec writes one', () => {
  it.each([
    [
      'the expect.regex list',
      { blocks: [{ user: 'hi', expect: { regex: [OK, BAD] } }] },
      'blocks.0.expect.regex.1',
    ],
    [
      'a json path regex',
      { blocks: [{ user: 'hi', expect: jsonPaths({ regex: BAD }) }] },
      'blocks.0.expect.json.paths.0.assert.regex',
    ],
    [
      'the expect.regex list of a perturbation',
      {
        blocks: [{ user: 'hi' }],
        perturbations: [
          { id: 'p', class: 'D1_off_topic', inject_at: 0, user: 'hm', expect: { regex: [BAD] } },
        ],
      },
      'perturbations.0.expect.regex.0',
    ],
    [
      'a json path regex of a perturbation',
      {
        blocks: [{ user: 'hi' }],
        perturbations: [
          { id: 'p', class: 'D1_off_topic', inject_at: 0, user: 'hm', expect: jsonPaths({ regex: BAD }) },
        ],
      },
      'perturbations.0.expect.json.paths.0.assert.regex',
    ],
  ])('%s', (_name, raw, path) => {
    expect(errors(raw)).toEqual([`REGEX_INVALID@${path}`]);
  });

  it.each([
    ['the expect.regex list', { blocks: [{ user: 'hi', expect: { regex: [OK, '\\d+'] } }] }],
    ['a json path regex', { blocks: [{ user: 'hi', expect: jsonPaths({ regex: OK }) }] }],
    [
      'a perturbation',
      {
        blocks: [{ user: 'hi' }],
        perturbations: [
          { id: 'p', class: 'D1_off_topic', inject_at: 0, user: 'hm', expect: { regex: [OK] } },
        ],
      },
    ],
  ])('accepts a pattern that compiles: %s', (_name, raw) => {
    expect(errors(raw)).toEqual([]);
  });

  it('keeps refusing the places it already read: must, must_not, a tool input regex, an end state regex', () => {
    expect(errors({ blocks: [{ user: 'hi', expect: { must: [BAD] } }] })).toEqual([
      'REGEX_INVALID@blocks.0.expect.must.0',
    ]);
    expect(errors({ blocks: [{ user: 'hi', expect: { must_not: [BAD] } }] })).toEqual([
      'REGEX_INVALID@blocks.0.expect.must_not.0',
    ]);
    expect(
      errors({ blocks: [{ user: 'hi', expect: { tools: [{ label: 't', input: { a: { regex: BAD } } }] } }] }),
    ).toEqual(['REGEX_INVALID@blocks.0.expect.tools.0.input.a.regex']);
    expect(
      errors({ blocks: [{ user: 'hi' }], end_state: { source: 'tool:t', expect: { a: { regex: BAD } } } }),
    ).toEqual(['REGEX_INVALID@end_state.expect.a.regex']);
  });
});
