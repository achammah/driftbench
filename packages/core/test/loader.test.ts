import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  canonicalJson,
  checkSpec,
  contentHash,
  findSpecFiles,
  type LoadResult,
  loadSpecFile,
  loadSpecs,
  parseCriterionRef,
  parseSpecText,
  validateSpec,
} from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';

const VALID = `
id: acme-upgrade
title: Existing customer asks for a faster plan
channel: chat
lang: EN
tier: core
covers: [B-001, B-002]
stages: [welcome, plan_choice, confirm, care_routing]
ledger_seed:
  customer: existing
criteria:
  - name: greets_once
    rubric: The reply greets the customer once and names the assistant.
    gating: true
  - name: plain_language
    rubric: The reply avoids internal jargon.
blocks:
  - user: Hi, I want a faster internet plan
    expect:
      stage: welcome
      tools:
        - label: lookup_plans
          count: 1
          input:
            speed: { regex: "^(fast|ultra)$" }
      must: ["Acme"]
      must_not: ["^#"]
      criteria: [greets_once@gating, plain_language]
  - id: pick
    user: The ultra one
    given:
      vars: { clock: "2026-10-11T10:00:00Z" }
    expect:
      stage: plan_choice
      ledger_add: { plan: ultra }
  - burst: ["Yes", "yes, go"]
    expect:
      stage: confirm
      guards:
        - { name: no_pii_out, verdict: pass }
      tools:
        - label: notify_sales
          count: { min: 1, max: 1 }
rules:
  max_calls: { notify_sales: 1, refund: 0 }
  lang_stable: true
end_state:
  source: tool:notify_sales
  mode: subset
  expect:
    plan: ultra
    email: { nonempty: true }
perturbations:
  - id: off-topic
    class: D1_off_topic
    inject_at: 1
    user: Is the shop open on Saturday?
    recovery: { within_blocks: 1, stage_after: welcome }
  - id: tool-down
    class: D8_tool_failure
    inject_at: 2
    world:
      tools:
        lookup_plans: { error: "timeout" }
`;

function ok(result: LoadResult) {
  if (!result.ok) throw new Error(`expected a valid spec, got ${JSON.stringify(result.errors, null, 2)}`);
  return result;
}

function codes(result: LoadResult): string[] {
  if (result.ok) throw new Error('expected an invalid spec');
  return result.errors.map((issue) => issue.code);
}

describe('parseSpecText', () => {
  it('accepts a full spec and normalises the authoring shorthand', () => {
    const { spec } = ok(parseSpecText(VALID, 'yaml'));
    expect(spec.kind).toBe('conversation');
    expect(spec.blocks[0]?.when).toEqual({ user: 'Hi, I want a faster internet plan' });
    expect(spec.blocks[2]?.when).toEqual({ burst: ['Yes', 'yes, go'] });
    expect(spec.given?.ledger).toEqual({ customer: 'existing' });
    expect(spec.perturbations).toHaveLength(2);
  });

  it('round-trips: YAML to spec to JSON to spec gives the same spec and hash', () => {
    const first = ok(parseSpecText(VALID, 'yaml'));
    const second = ok(parseSpecText(JSON.stringify(first.spec), 'json'));
    expect(second.spec).toEqual(first.spec);
    expect(second.hash).toBe(first.hash);
  });

  it('gives the same hash whatever the key order, and a different hash when content changes', () => {
    const a = ok(
      parseSpecText('id: x\nblocks:\n  - user: hi\n    expect: { must: [a], lang: EN }\n', 'yaml'),
    );
    const b = ok(
      parseSpecText('blocks:\n  - expect: { lang: EN, must: [a] }\n    user: hi\nid: x\n', 'yaml'),
    );
    const c = ok(
      parseSpecText('id: x\nblocks:\n  - user: hi!\n    expect: { must: [a], lang: EN }\n', 'yaml'),
    );
    expect(a.hash).toBe(b.hash);
    expect(a.hash).not.toBe(c.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{12}$/);
  });

  it('reports lint warnings on a valid spec', () => {
    const result = ok(
      parseSpecText(
        'id: x\nkind: task\nblocks:\n  - user: build it\nperturbations:\n  - id: p\n    class: D1_off_topic\n    inject_at: 0\n    user: hey\n',
        'yaml',
      ),
    );
    expect(result.warnings.map((issue) => issue.code).sort()).toEqual([
      'BLOCK_NO_EXPECTATION',
      'PERTURBATION_NO_RECOVERY',
      'TASK_WITHOUT_OUTCOME',
    ]);
  });

  it('warns when criteria are referenced without local definitions', () => {
    const result = ok(
      parseSpecText('id: x\nblocks:\n  - user: hi\n    expect: { criteria: [polite] }\n', 'yaml'),
    );
    expect(result.warnings.map((issue) => issue.code)).toEqual(['CRITERION_UNRESOLVED']);
  });
});

const INVALID: Array<{ name: string; text: string; code: string; path?: string }> = [
  { name: 'YAML syntax', text: 'id: x\nblocks: [\n', code: 'SPEC_PARSE' },
  { name: 'top level is a list', text: '- id: x\n', code: 'SPEC_NOT_OBJECT' },
  { name: 'missing id', text: 'blocks:\n  - user: hi\n', code: 'SCHEMA_INVALID_TYPE', path: 'id' },
  { name: 'empty blocks', text: 'id: x\nblocks: []\n', code: 'SCHEMA_TOO_SMALL', path: 'blocks' },
  {
    name: 'block without a stimulus',
    text: 'id: x\nblocks:\n  - expect: { must: [a] }\n',
    code: 'BLOCK_STIMULUS_MISSING',
    path: 'blocks.0',
  },
  {
    name: 'block with user and when',
    text: 'id: x\nblocks:\n  - user: hi\n    when: { user: hi }\n',
    code: 'BLOCK_STIMULUS_AMBIGUOUS',
    path: 'blocks.0',
  },
  {
    name: 'misspelt key',
    text: 'id: x\nblocks:\n  - user: hi\n    expect: { mustnot: [a] }\n',
    code: 'SCHEMA_UNRECOGNIZED_KEYS',
    path: 'blocks.0.expect',
  },
  {
    name: 'tool without a label',
    text: 'id: x\nblocks:\n  - user: hi\n    expect: { tools: [{ count: 1 }] }\n',
    code: 'SCHEMA_INVALID_TYPE',
    path: 'blocks.0.expect.tools.0.label',
  },
  {
    name: 'invalid regular expression',
    text: 'id: x\nblocks:\n  - user: hi\n    expect: { must: ["(unclosed"] }\n',
    code: 'REGEX_INVALID',
    path: 'blocks.0.expect.must.0',
  },
  {
    name: 'invalid regular expression in the regex list',
    text: 'id: x\nblocks:\n  - user: hi\n    expect: { regex: ["ok", "(unclosed"] }\n',
    code: 'REGEX_INVALID',
    path: 'blocks.0.expect.regex.1',
  },
  {
    name: 'invalid regular expression in a json path assertion',
    text: 'id: x\nblocks:\n  - user: hi\n    expect: { json: { paths: [{ path: a, assert: { regex: "(unclosed" } }] } }\n',
    code: 'REGEX_INVALID',
    path: 'blocks.0.expect.json.paths.0.assert.regex',
  },
  {
    name: 'invalid regular expression in a perturbation expectation',
    text: 'id: x\nblocks:\n  - user: hi\nperturbations:\n  - id: p\n    class: D1_off_topic\n    inject_at: 0\n    user: hello\n    expect: { regex: ["(unclosed"] }\n',
    code: 'REGEX_INVALID',
    path: 'perturbations.0.expect.regex.0',
  },
  {
    name: 'malformed criterion reference',
    text: 'id: x\nblocks:\n  - user: hi\n    expect: { criteria: ["polite@gate"] }\n',
    code: 'CRITERION_REF_INVALID',
  },
  {
    name: 'undefined criterion',
    text: 'id: x\ncriteria: [{ name: polite, rubric: r }]\nblocks:\n  - user: hi\n    expect: { criteria: [kind] }\n',
    code: 'CRITERION_UNDEFINED',
  },
  {
    name: 'perturbation past the end',
    text: 'id: x\nblocks:\n  - user: hi\nperturbations:\n  - { id: p, class: D1_off_topic, inject_at: 5, user: hey }\n',
    code: 'PERTURBATION_OUT_OF_RANGE',
    path: 'perturbations.0.inject_at',
  },
  {
    name: 'perturbation with nothing to inject',
    text: 'id: x\nblocks:\n  - user: hi\nperturbations:\n  - { id: p, class: D2_goal_shift, inject_at: 0 }\n',
    code: 'PERTURBATION_EMPTY',
  },
  {
    name: 'unknown deviation class',
    text: 'id: x\nblocks:\n  - user: hi\nperturbations:\n  - { id: p, class: D11_chaos, inject_at: 0, user: hey }\n',
    code: 'SCHEMA_INVALID_VALUE',
    path: 'perturbations.0.class',
  },
  {
    name: 'duplicate block ids',
    text: 'id: x\nblocks:\n  - { id: a, user: hi }\n  - { id: a, user: hi }\n',
    code: 'DUPLICATE_BLOCK_ID',
    path: 'blocks.1.id',
  },
  {
    name: 'count zero with input assertions',
    text: 'id: x\nblocks:\n  - user: hi\n    expect: { tools: [{ label: t, count: 0, input: { a: 1 } }] }\n',
    code: 'TOOL_COUNT_CONTRADICTION',
  },
  {
    name: 'count range upside down',
    text: 'id: x\nblocks:\n  - user: hi\n    expect: { tools: [{ label: t, count: { min: 3, max: 1 } }] }\n',
    code: 'COUNT_RANGE_INVALID',
  },
  {
    name: 'negative count',
    text: 'id: x\nblocks:\n  - user: hi\n    expect: { tools: [{ label: t, count: -1 }] }\n',
    code: 'SCHEMA_TOO_SMALL',
    path: 'blocks.0.expect.tools.0.count',
  },
  {
    name: 'same pattern in must and must_not',
    text: 'id: x\nblocks:\n  - user: hi\n    expect: { must: [a], must_not: [a] }\n',
    code: 'MUST_CONFLICT',
  },
  {
    name: 'stage outside the catalogue',
    text: 'id: x\nstages: [a]\nblocks:\n  - user: hi\n    expect: { stage: b }\n',
    code: 'STAGE_UNKNOWN',
    path: 'blocks.0.expect.stage',
  },
  {
    name: 'forbidden tool expected',
    text: 'id: x\nrules: { forbidden_tools: [refund] }\nblocks:\n  - user: hi\n    expect: { tools: [{ label: refund }] }\n',
    code: 'TOOL_FORBIDDEN_EXPECTED',
  },
  {
    name: 'both ledger_seed and given.ledger',
    text: 'id: x\nledger_seed: { a: 1 }\ngiven: { ledger: { a: 2 } }\nblocks:\n  - user: hi\n',
    code: 'SPEC_ALIAS_CONFLICT',
  },
  {
    name: 'guard without a name',
    text: 'id: x\nblocks:\n  - user: hi\n    expect: { guards: [{ verdict: pass }] }\n',
    code: 'SCHEMA_INVALID_TYPE',
    path: 'blocks.0.expect.guards.0.name',
  },
  {
    name: 'guard count range upside down',
    text: 'id: x\nblocks:\n  - user: hi\n    expect: { guards: [{ name: g, count: { min: 2, max: 1 } }] }\n',
    code: 'COUNT_RANGE_INVALID',
  },
  {
    name: 'the old step key is refused',
    text: 'id: x\nblocks:\n  - user: hi\n    expect: { step: welcome }\n',
    code: 'SCHEMA_UNRECOGNIZED_KEYS',
    path: 'blocks.0.expect',
  },
  {
    name: 'the old steps catalogue is refused',
    text: 'id: x\nsteps: [a]\nblocks:\n  - user: hi\n',
    code: 'SCHEMA_UNRECOGNIZED_KEYS',
    path: '',
  },
  {
    name: 'end state that is neither none nor a mapping',
    text: 'id: x\nend_state: maybe\nblocks:\n  - user: hi\n',
    code: 'SCHEMA_INVALID_UNION',
    path: 'end_state',
  },
];

describe('invalid specs are refused with a named error', () => {
  for (const { name, text, code, path } of INVALID) {
    it(name, () => {
      const result = parseSpecText(text, 'yaml');
      expect(codes(result)).toContain(code);
      if (path !== undefined && !result.ok) {
        expect(result.errors.find((issue) => issue.code === code)?.path).toBe(path);
      }
    });
  }

  it('does not repeat a normalisation error as a schema error on the same block', () => {
    const result = parseSpecText('id: x\nblocks:\n  - expect: { must: [a] }\n', 'yaml');
    expect(codes(result)).toEqual(['BLOCK_STIMULUS_MISSING']);
  });

  it('explains a malformed stimulus in plain words', () => {
    const result = parseSpecText('id: x\nblocks:\n  - when: { usr: hi }\n', 'yaml');
    if (result.ok) throw new Error('expected an invalid spec');
    expect(result.errors[0]?.message).toBe('expected exactly one of: user, burst, injection');
  });
});

describe('criterion references', () => {
  it('parses names with and without @gating', () => {
    expect(parseCriterionRef('greets_once@gating')).toEqual({ name: 'greets_once', gating: true });
    expect(parseCriterionRef('plain-language')).toEqual({ name: 'plain-language', gating: false });
    expect(parseCriterionRef('@gating')).toBeUndefined();
  });
});

describe('hashing', () => {
  it('ignores key order and undefined values', () => {
    expect(canonicalJson({ b: 1, a: { d: undefined, c: [2, 1] } })).toBe('{"a":{"c":[2,1]},"b":1}');
    expect(contentHash({ a: 1, b: 2 })).toBe(contentHash({ b: 2, a: 1 }));
  });
});

describe('files and folders', () => {
  it('finds yaml, yml and .spec.json files, skips other files, hidden folders and node_modules', async () => {
    const root = await mkdtemp(join(tmpdir(), 'driftbench-'));
    await mkdir(join(root, 'nested'));
    await mkdir(join(root, 'node_modules'));
    await mkdir(join(root, '.hidden'));
    const spec = stringify({ id: 'x', blocks: [{ user: 'hi', expect: { must: ['a'] } }] });
    await writeFile(join(root, 'a.yaml'), spec);
    await writeFile(join(root, 'nested', 'b.yml'), spec.replace('id: x', 'id: y'));
    await writeFile(
      join(root, 'nested', 'c.spec.json'),
      JSON.stringify({ id: 'z', blocks: [{ user: 'hi' }] }),
    );
    await writeFile(join(root, 'nested', 'notes.json'), '{}');
    await writeFile(join(root, 'node_modules', 'd.yaml'), spec);
    await writeFile(join(root, '.hidden', 'e.yaml'), spec);

    const files = await findSpecFiles([root]);
    expect(files.map((file) => file.slice(root.length + 1))).toEqual([
      'a.yaml',
      'nested/b.yml',
      'nested/c.spec.json',
    ]);

    const results = await loadSpecs([root]);
    expect(results.map((result) => result.ok)).toEqual([true, true, true]);
  });

  it('reports a missing file as an invalid spec, not a crash', async () => {
    const [result] = await loadSpecs(['/definitely/not/here.yaml']);
    expect(result && codes(result)).toEqual(['SPEC_PARSE']);
  });
});

describe('a relative workspace folder', () => {
  const SPEC = [
    'id: seeded-task',
    'version: "1"',
    'kind: task',
    'title: A task that starts from a folder beside it',
    'tier: handwritten',
    'target: { adapter: process, agent: ops }',
    'workspace_seed: { from: ./.seed-seeded-task }',
    'blocks:',
    '  - id: b',
    '    user: Do the task.',
    '    expect: { execution: { ran_code: true } }',
    '',
  ].join('\n');

  it('is read from the folder of the spec file when written ./<path>, wherever the file sits', async () => {
    for (const name of ['one', 'two']) {
      const dir = join(await mkdtemp(join(tmpdir(), 'driftbench-seed-')), name);
      await mkdir(dir);
      await writeFile(join(dir, 'task.yaml'), SPEC);
      const loaded = await loadSpecFile(join(dir, 'task.yaml'));
      if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
      expect(loaded.spec.given?.world?.workspace?.from).toBe(join(dir, '.seed-seeded-task'));
      // The hash is the one of the spec as resolved, which the store checks.
      expect(loaded.hash).toBe(contentHash(loaded.spec));
    }
  });

  it('leaves any other relative path as written: it is read from the folder the run starts in', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-seed-'));
    await writeFile(join(dir, 'task.yaml'), SPEC.replace('./.seed-seeded-task', 'examples/seeds/task'));
    const loaded = await loadSpecFile(join(dir, 'task.yaml'));
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
    expect(loaded.spec.given?.world?.workspace?.from).toBe('examples/seeds/task');
  });

  it('stays as written when the text is parsed with no file', () => {
    const parsed = parseSpecText(SPEC, 'yaml');
    if (!parsed.ok) throw new Error('invalid');
    expect(parsed.spec.given?.world?.workspace?.from).toBe('./.seed-seeded-task');
  });
});

it('offers the same normalization, errors and warnings when the caller does not need a hash', () => {
  for (const raw of [
    parse(VALID),
    null,
    { id: 'invalid', blocks: [] },
    { id: 'semantic', stages: ['start'], blocks: [{ user: 'hi', expect: { stage: 'other' } }] },
    { id: 'warning', blocks: [{ user: 'hi', expect: { criteria: ['not-defined'] } }] },
  ]) {
    const loaded = validateSpec(raw, 'same.yaml');
    const checked = checkSpec(raw, 'same.yaml');
    if (loaded.ok) {
      const { hash, ...withoutHash } = loaded;
      expect(checked).toEqual(withoutHash);
      expect(hash).toBe(contentHash(loaded.spec));
    } else expect(checked).toEqual(loaded);
  }
});
