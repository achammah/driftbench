import { parseSpecText } from '@agent-nexus/driftbench-core';
import { expect, it } from 'vitest';
import { generateEstateSuite } from '../../src/estate/generate';
import { APPROVED_PLAN, fixtureInputs, PLANNER_PATHS } from './support';

const GUARD = 'guard.settings.stop-guard-reply-length-py';
const APPROVED = [
  'List every skill in this workspace and what each one does in your reply.',
  'Walk me through every folder of this workspace and what it holds in a reply.',
];

it('asks the live positive tests of the reply-length guard with an approved request that leads to a long reply', async () => {
  const result = generateEstateSuite(await fixtureInputs(APPROVED_PLAN), { paths: PLANNER_PATHS });
  const own = result.specs.filter(
    (record) => record.testType === 'guard_positive' && record.mode === 'live' && record.atoms[0] === GUARD,
  );
  expect(own.length).toBeGreaterThan(0);
  for (const record of own) {
    expect(record.complete, record.id).toBe(true);
    const file = result.files.find((entry) => entry.path === record.path);
    const parsed = parseSpecText(file?.text ?? '', 'yaml', record.path);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    const when = parsed.spec.blocks[0]?.when as { user?: string } | undefined;
    const ask = String(when?.user);
    // Exact approved requests already name the reply and exclude the detail exception.
    expect(APPROVED, record.id).toContain(ask);
  }
}, 120_000);
