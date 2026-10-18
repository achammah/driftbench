import { rm } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { buildPlan, ClaudeCodeReader, planJourneys, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

const files = {
  'CLAUDE.md': '# Harbour office\n',
  '.claude/skills/berths/SKILL.md': [
    '---',
    'name: berths',
    'description: Assigns ships to berths for the harbour office.',
    '---',
    '# Berths',
    'Read references/tide-limits.md when assigning a deep-draught ship.',
    'Read references/samples/berth-plan-001.md for a finished plan.',
    'Read references/blank-form.md for the empty form.',
    '',
  ].join('\n'),
  '.claude/skills/berths/references/tide-limits.md': '# Tide limits\nDraught limits per tide.\n',
  '.claude/skills/berths/references/samples/berth-plan-001.md': '# Sample plan\nA finished plan.\n',
  '.claude/skills/berths/references/blank-form.md': '# Form\nShip: {{ship}}\nBerth: {{berth}}\n',
};

async function scanned(documents?: Array<{ path: string; role: string }>) {
  const root = await estate(files);
  try {
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    return documents ? { ...map, documents: documents as never } : map;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const roles = [
  { path: '.claude/skills/berths/references/samples/berth-plan-001.md', role: 'example' },
  { path: '.claude/skills/berths/references/blank-form.md', role: 'template' },
  { path: '.claude/skills/berths/references/tide-limits.md', role: 'normative' },
];

it('tests a reference an instruction acts on whatever its target folder, and skips one only listed in an index', async () => {
  const root = await estate({
    ...files,
    '.claude/skills/berths/SKILL.md': [
      '---',
      'name: berths',
      'description: Assigns ships to berths for the harbour office.',
      '---',
      '# Berths',
      'Read references/tide-limits.md when assigning a deep-draught ship.',
      'Read references/samples/berth-plan-001.md for a finished plan.',
      '',
      '## Index',
      '- [Blank form](references/blank-form.md): the empty form',
      '',
    ].join('\n'),
  });
  try {
    const { map: scan } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    const map = { ...scan, documents: roles as never };
    const references = map.atoms.filter((atom) => atom.kind === 'reference');
    expect(references).toHaveLength(3);
    const { plan, details } = buildPlan(map);
    const tested = new Set(
      plan.rows.filter((row) => row.testType === 'read_when').map((row) => row.atomIds[0]),
    );
    const byPath = (path: string) => references.find((atom) => atom.fields?.path === path)?.id;
    // The sample sits in a samples folder, yet a sentence orders its read: it is tested.
    expect(tested.has(byPath(roles[0]?.path ?? ''))).toBe(true);
    expect(tested.has(byPath(roles[2]?.path ?? ''))).toBe(true);
    // The form is only linked from an index: a place to look, never a rule.
    expect(tested.has(byPath(roles[1]?.path ?? ''))).toBe(false);
    expect(details.notes.some((note) => /1 reference to documents.*navigation only/.test(note))).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

it('does not hide a reference because its target folder is named like a template or an example', async () => {
  const root = await estate({
    'CLAUDE.md': '# Harbour office\n',
    '.claude/skills/berths/SKILL.md': [
      '---',
      'name: berths',
      'description: Assigns ships to berths for the harbour office.',
      '---',
      '# Berths',
      'Read templates/arrival.md and fill it in for each ship.',
      '',
    ].join('\n'),
    '.claude/skills/berths/templates/arrival.md': '# Arrival\nShip: {{ship}}\n',
  });
  try {
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.documents?.find((document) => document.path.endsWith('arrival.md'))?.role).toBe('template');
    const reference = map.atoms.find((atom) => atom.kind === 'reference');
    expect(
      buildPlan(map).plan.rows.some(
        (row) => row.testType === 'read_when' && row.atomIds[0] === reference?.id,
      ),
    ).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

it('keeps every reference test when the map records no document roles, guessing nothing from names', async () => {
  // A fresh scan records the roles it finds, so the map is given none, as an older map would have it.
  const map = await scanned([]);
  const { plan, details } = buildPlan(map);
  expect(plan.rows.filter((row) => row.testType === 'read_when')).toHaveLength(3);
  expect(details.notes.some((note) => /navigation only/.test(note))).toBe(false);
}, 30_000);

it('keeps a prerequisite to read a template: only a read-when reference is a place to look', async () => {
  const root = await estate({
    ...files,
    '.claude/skills/berths/SKILL.md': [
      '---',
      'name: berths',
      'description: Assigns ships to berths for the harbour office.',
      '---',
      '# Berths',
      'Before assigning a berth: Read references/blank-form.md.',
      '',
    ].join('\n'),
  });
  try {
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    const withRoles = { ...map, documents: roles as never };
    const gate = withRoles.atoms.find((atom) => atom.kind === 'gate');
    expect(gate).toBeDefined();
    const { plan } = buildPlan(withRoles);
    expect(plan.rows.some((row) => row.testType === 'ordered_pair' && row.atomIds[0] === gate?.id)).toBe(
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

it('walks no journey into a document outside the estate, and still tests the read itself', async () => {
  const root = await estate({
    'CLAUDE.md': '# Harbour office\n',
    '.claude/skills/berths/SKILL.md': [
      '---',
      'name: berths',
      'description: Assigns ships to berths for the harbour office.',
      '---',
      '# Berths',
      'Read references/tide-limits.md when assigning a deep-draught ship.',
      '',
    ].join('\n'),
    '.claude/skills/berths/references/tide-limits.md': '# Tide limits\nDraught limits per tide.\n',
  });
  try {
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    const reference = map.atoms.find((atom) => atom.kind === 'reference');
    expect(reference).toBeDefined();
    const external = {
      ...map,
      atoms: map.atoms.map((atom) =>
        atom.id === reference?.id ? { ...atom, fields: { ...atom.fields, external: true } } : atom,
      ),
    };
    const inside = planJourneys(map);
    const outside = planJourneys(external);
    expect(inside.edges.some((edge) => edge.to === reference?.id)).toBe(true);
    expect(outside.edges.some((edge) => edge.to === reference?.id)).toBe(false);
    expect(outside.journeys.flatMap((journey) => journey.atomIds)).not.toContain(reference?.id);
    expect(buildPlan(external).plan.rows.some((row) => row.testType === 'read_when')).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
