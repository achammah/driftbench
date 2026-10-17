import { rm } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader } from '../../src/index';
import { estate } from '../support';

async function readDocument(text: string, extension = 'json') {
  const root = await estate({ [`.claude/routines.${extension}`]: text });
  try {
    const raw = await new ClaudeCodeReader().read(root);
    for (const step of raw.steps) {
      expect(step.at.quote).toBe(text.split('\n')[step.at.startLine - 1]?.trim());
    }
    return raw;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function read(value: unknown) {
  return (await readDocument(JSON.stringify(value, null, 2))).steps;
}

describe('step container normalization', () => {
  it('qualifies repeated identifiers in named process arrays and retains their own declaration lines', async () => {
    const steps = await read({
      processes: [
        {
          name: 'intake',
          steps: [
            { id: 'start', next: ['finish'] },
            { id: 'finish', next: [] },
          ],
        },
        {
          name: 'review',
          steps: [
            { id: 'start', next: ['finish'] },
            { id: 'finish', next: [] },
          ],
        },
      ],
    });
    expect(steps.map(({ id, next }) => ({ id, next }))).toEqual([
      { id: 'intake/start', next: ['intake/finish'] },
      { id: 'intake/finish', next: [] },
      { id: 'review/start', next: ['review/finish'] },
      { id: 'review/finish', next: [] },
    ]);
    expect(steps[2]?.at.startLine).toBeGreaterThan(steps[1]?.at.startLine ?? 0);
  });

  it('reads keyed steps on the key declaration and preserves explicit terminal nodes', async () => {
    const steps = await read({
      steps: { collect: { title: 'Collect records', next: 'check' }, check: { next: [] } },
    });
    expect(steps.map(({ id, next, title }) => ({ id, next, title }))).toEqual([
      { id: 'collect', next: ['check'], title: 'Collect records' },
      { id: 'check', next: [], title: undefined },
    ]);
    expect(steps[0]?.at.quote).toBe('"collect": {');
  });

  it('reads nested workflow steps without treating their wrapper as a process name', async () => {
    const steps = await read({
      workflow: {
        description: 'Fictional review process',
        steps: [
          { id: 'collect', next: ['review'] },
          { id: 'review', next: [] },
        ],
      },
    });
    expect(steps.map(({ id, next, process }) => ({ id, next, process }))).toEqual([
      { id: 'collect', next: ['review'], process: undefined },
      { id: 'review', next: [], process: undefined },
    ]);
  });

  it('does not mistake a process name for a step name when both match', async () => {
    const steps = await read({ processes: [{ name: 'review', steps: [{ name: 'review', next: [] }] }] });
    expect(steps.map((step) => step.id)).toEqual(['review/review']);
    expect(steps[0]?.at.startLine).toBe(7);
  });
  it('reads bare and quoted YAML step-map keys in a fictional warehouse workflow', async () => {
    const text = [
      'workflow:',
      '  steps:',
      '    collect:',
      '      title: Collect fictional parcels',
      '      next: [quality review]',
      '    "quality review":',
      `      next: ["packer's check"]`,
      "    'packer''s check':",
      '      next: [send]',
      '    delivery_slot:',
      '      id: send',
      '      next: []',
    ].join('\n');
    const { steps } = await readDocument(text, 'yaml');
    expect(steps.map(({ id, next }) => [id, next])).toEqual([
      ['collect', ['quality review']],
      ['quality review', ["packer's check"]],
      ["packer's check", ['send']],
      ['send', []],
    ]);
    expect(steps.map((step) => step.at.startLine)).toEqual([3, 6, 8, 11]);
    expect(steps[3]?.at.quote).toBe('id: send');
  });

  it('uses an explicit identifier over its JSON storage key and anchors the identifier field', async () => {
    const { steps } = await readDocument(
      JSON.stringify(
        {
          steps: {
            storage_one: { id: 'receive', next: ['inspect'] },
            storage_two: { name: 'inspect', next: [] },
          },
        },
        null,
        2,
      ),
    );
    expect(steps.map(({ id, next }) => [id, next])).toEqual([
      ['receive', ['inspect']],
      ['inspect', []],
    ]);
    expect(steps.map((step) => step.at.quote)).toEqual(['"id": "receive",', '"name": "inspect",']);
  });

  it('excludes wrong-shaped step containers and malformed keyed identifiers', async () => {
    for (const steps of [
      { count: 3, enabled: true, description: 'Take ordinary steps', array: [] },
      [null, false, 3, { description: 'This is metadata' }],
      { broken_id: { id: false }, empty_name: { name: '' } },
    ]) {
      const raw = await readDocument(JSON.stringify({ workflow: { steps } }));
      expect(raw.steps).toEqual([]);
      expect(raw.files[0]?.kind).toBe('other');
    }
    const stages = await read({ steps: { count: 3, real: { next: [] }, invalid: { id: 23 } } });
    expect(stages.map((step) => step.id)).toEqual(['real']);
  });
  it('does not instantiate JSON Schema property descriptions as workflow stages', async () => {
    for (const items of [{}, { type: 'object', properties: { id: { type: 'string' } } }]) {
      const raw = await readDocument(JSON.stringify({ properties: { steps: { type: 'array', items } } }));
      expect(raw.steps).toEqual([]);
      expect(raw.files[0]?.kind).toBe('other');
    }
    const stages = await read({ steps: { items: {}, properties: {} } });
    expect(stages.map((step) => step.id)).toEqual(['items', 'properties']);
  });
  it('retains valid empty array and map step containers as step-list files', async () => {
    for (const steps of [[], {}]) {
      const raw = await readDocument(JSON.stringify({ steps }));
      expect(raw.steps).toEqual([]);
      expect(raw.files[0]?.kind).toBe('step_list');
    }
  });

  it('reads YAML process sequence entries when steps is their first mapping field', async () => {
    const text = [
      'processes:',
      '  - steps:',
      '      - id: collect',
      '        next: [archive]',
      '      - id: archive',
      '        next: []',
      '    name: intake',
    ].join('\n');
    const raw = await readDocument(text, 'yaml');
    expect(raw.steps.map(({ id, next, at }) => [id, next, at.startLine])).toEqual([
      ['intake/collect', ['intake/archive'], 3],
      ['intake/archive', [], 5],
    ]);
    expect(raw.steps.map((step) => step.at.quote)).toEqual(['- id: collect', '- id: archive']);
  });
});
