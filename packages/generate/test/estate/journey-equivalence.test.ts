import { expect, it } from 'vitest';
import { generateEstateSuite } from '../../src/estate/generate';
import { type EstateAtom, type EstatePlanRow, PhraseBank } from '../../src/estate/inputs';

const unit: EstateAtom = {
  id: 'skill.desk.skill-desk',
  kind: 'skill',
  title: 'Skill desk',
  approved: true,
  fields: { name: 'desk', description: 'Run the weekly desk review for the harbour office.' },
  provenance: { file: '.claude/skills/desk/SKILL.md', quote: 'Run the weekly desk review.' },
  evidence: [{ type: 'skill_loaded', name: 'desk' }],
};
const step = (name: string): EstateAtom => ({
  id: `reference.desk.${name}`,
  kind: 'reference',
  title: `Read ${name}`,
  approved: true,
  fields: { path: `.claude/skills/desk/references/${name}.md`, exists: true },
  provenance: { file: '.claude/skills/desk/SKILL.md', quote: `Read ${name}.` },
  evidence: [],
});
const plan = step('plan');
const run = step('do');
const verify = step('verify');
const report = step('report');

const journey = (id: string, path: EstateAtom[]): EstatePlanRow => ({
  id,
  atomIds: path.map((atom) => atom.id),
  cell: {},
  testType: 'journey',
  mode: 'live',
  status: 'approved',
});

function generate(rows: EstatePlanRow[]) {
  const map = {
    runtime: 'claude-code',
    hash: 'journeys',
    atoms: [unit, plan, run, verify, report],
    edges: [],
  };
  return generateEstateSuite(
    {
      map,
      plan: { mapHash: map.hash, rows },
      bank: PhraseBank.parse({ version: 1, estate: 'journeys', mapHash: map.hash }),
    },
    { paths: { map: 'map.yaml', plan: 'plan.yaml', phrases: 'phrases.yaml' } },
  );
}

it('never folds two journeys that walk different paths, so every walked edge keeps its spec', () => {
  const suite = generate([
    journey('journey.02', [plan, run, verify, report]),
    journey('journey.10', [plan, run, verify, run]),
  ]);
  expect(suite.specs.map((spec) => spec.row).sort()).toEqual(['journey.02', 'journey.10']);
  expect(suite.report.equivalence.collapsed).toBe(0);
});

it('still folds two journeys that walk the same path', () => {
  const suite = generate([
    journey('journey.02', [plan, run, verify, report]),
    journey('journey.03', [plan, run, verify, report]),
  ]);
  expect(suite.report.equivalence.collapsed).toBe(1);
});
