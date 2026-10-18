import { rm } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

// Handwritten editorial instructions: every expected target is part of the input,
// not a validator bank, marker or estate-specific naming convention.
const required = [
  'Before editing the index, read policy.md.',
  'Read policy.md before editing the index.',
  'Editing the index requires policy.md loaded.',
  'Editing the index requires reading policy.md.',
  'To edit the index, read policy.md first.',
  'For editing the index, read policy.md first.',
  'When editing the index, read policy.md first.',
  'If editing the index, read policy.md first.',
  'Read policy.md first when editing the index.',
  'Read policy.md first before editing the index.',
  'Never edit the index until policy.md is loaded.',
  'Do not edit the index until policy.md has been read.',
  'Before editing the index, policy.md must be loaded.',
  'Before editing the index, policy.md must be read.',
  'Before editing the index read policy.md.',
  'If no correction is pending, editing the index requires policy.md loaded.',
  'Editing the index requires that policy.md be loaded.',
  'Editing the index requires you to read policy.md.',
  'Read policy.md first, then edit the index.',
  'Editing the index? Read policy.md first.',
  'Never edit the index without reading policy.md.',
  'Edit the index only after reading policy.md.',
  'Note: before editing the index, read policy.md.',
  'Before editing the index: read policy.md.',
];
const decoys = [
  'Editing the index does not require policy.md loaded.',
  'Editing the index never requires reading policy.md.',
  'If editing the index requires policy.md loaded, report the dependency.',
  'The example says "Editing the index requires policy.md loaded."',
  'Optionally, read policy.md first when editing the index.',
  'Do not read policy.md first when editing the index.',
  'If you read policy.md first when editing the index, report it.',
  'Never read policy.md until editing the index.',
  'Before editing the index, do not read policy.md.',
  'Before editing the index, policy.md need not be loaded.',
  'Before editing the index, policy.md may be loaded.',
  'Before editing the index, check whether policy.md is loaded.',
  'Read it first when editing the index.',
  'Read policy.md first.',
  'Before lunch, read policy.md.',
  'The sample is `Before editing the index read policy.md`.',
];

it('measures prerequisite recall and precision across standing, skill, helper and reference prose', async () => {
  const files: Record<string, string> = { 'policy.md': '# Editorial policy\n' };
  const sources: Array<[string, string]> = [
    ['CLAUDE.md', '# Instructions\n'],
    ['.claude/skills/editor/SKILL.md', '---\nname: editor\ndescription: Edit an index\n---\n'],
    ['.claude/agents/copyist.md', '---\nname: copyist\ndescription: Edit an index\n---\n'],
    ['.claude/skills/editor/references/guide.md', '# Guide\n'],
  ];
  for (const [path, prefix] of sources) files[path] = prefix + [...required, ...decoys].join('\n');
  const root = await estate(files);
  try {
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    const gates = map.atoms.filter((atom) => atom.kind === 'gate');
    const truePositive = gates.filter((atom) => required.includes(atom.provenance.quote)).length;
    const falsePositive = gates.filter((atom) => !required.includes(atom.provenance.quote)).length;
    console.log(
      JSON.stringify({
        gates: {
          found: gates.length,
          truePositive,
          falsePositive,
          expected: required.length * sources.length,
        },
      }),
    );
    expect(falsePositive).toBe(0);
    expect(truePositive).toBe(required.length * sources.length);
    for (const atom of gates) {
      expect(atom.fields?.path).toBe('policy.md');
      expect(atom.evidence).toContainEqual({ type: 'ordered', before: 'Read', after: 'Edit' });
      if (atom.provenance.quote.startsWith('If no'))
        expect(atom.situation).toContain('If no correction is pending');
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('recognizes declared skill prerequisites without treating unknown names as shell commands', async () => {
  const root = await estate({
    'CLAUDE.md': [
      'Editing an index requires editor loaded.',
      'Never edit an index until editor is loaded.',
      'Before editing an index, editor must be loaded.',
      'Editing an index requires it loaded.',
      'Editing an index requires unknown loaded.',
      '',
    ].join('\n'),
    '.claude/skills/editor/SKILL.md': '---\nname: editor\ndescription: Edit an index\n---\n',
  });
  try {
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    const gates = map.atoms.filter((atom) => atom.kind === 'gate');
    expect(gates).toHaveLength(3);
    for (const gate of gates) {
      expect(gate.evidence).toContainEqual({ type: 'skill_loaded', name: 'editor' });
      expect(gate.evidence).toContainEqual({ type: 'ordered', before: 'skill:editor', after: 'Edit' });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it.each(['configure the editor', 'review the citations', 'validate the index', 'archive the article'])(
  'uses action grammar for %s',
  async (action) => {
    const root = await estate({
      'CLAUDE.md': `Before you ${action}, read policy.md.\n`,
      'policy.md': '# Editorial policy\n',
    });
    try {
      const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
      expect(map.atoms.filter((atom) => atom.kind === 'gate')).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

it('binds read-first instructions to their nearest action heading and ends scope at the next heading', async () => {
  const text = [
    '# Edit the index',
    'Read policy.md first.',
    '',
    '## Background',
    'Read policy.md first.',
    '',
    '## Write an announcement',
    'Never read policy.md first.',
    'Read delivery.md first.',
  ].join('\n');
  const root = await estate({ 'CLAUDE.md': text, 'policy.md': '# Policy\n', 'delivery.md': '# Delivery\n' });
  try {
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    const gates = map.atoms.filter((atom) => atom.kind === 'gate');
    expect(gates.map((gate) => gate.fields?.first)).toEqual(['policy.md', 'delivery.md']);
    expect(gates[0]?.provenance).toMatchObject({
      startLine: 1,
      endLine: 2,
      quote: '# Edit the index\nRead policy.md first.',
    });
    expect(gates[1]?.evidence[0]).toEqual({ type: 'ordered', before: 'Read', after: 'Write' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('keeps negation and optionality inside the action separate from the prerequisite', async () => {
  const root = await estate({
    'CLAUDE.md': [
      'Editing optional metadata requires policy.md loaded.',
      'If no records exist, editing optional metadata requires policy.md loaded.',
      'Before editing no entries read policy.md.',
      'Editing the index never requires policy.md loaded.',
      '',
    ].join('\n'),
    'policy.md': '# Policy\n',
  });
  try {
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.atoms.filter((atom) => atom.kind === 'gate')).toHaveLength(3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it.each([
  '!! Before editing the index read policy.md !!',
  '‼ Editing the index requires policy.md loaded ‼',
  '!! When editing the index, read policy.md first !!',
])('treats attention punctuation as decoration: %s', async (rule) => {
  const root = await estate({ 'CLAUDE.md': rule, 'policy.md': '# Policy\n' });
  try {
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    const gates = map.atoms.filter((atom) => atom.kind === 'gate');
    expect(gates).toHaveLength(1);
    expect(gates[0]?.fields?.path).toBe('policy.md');
    expect(gates[0]?.provenance.quote).toBe(rule);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
