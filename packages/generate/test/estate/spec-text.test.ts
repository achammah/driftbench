import { checkSpec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { generateEstateSuite } from '../../src/estate/generate';
import { APPROVED_PLAN, fixtureInputs, PLANNER_PATHS } from './support';

describe('the text of a generated spec', () => {
  it('is the library rendering of the spec it holds, and the spec holds up when read back', async () => {
    const input = await fixtureInputs(APPROVED_PLAN);
    const suite = generateEstateSuite(input, { seed: 1, paths: PLANNER_PATHS });
    const yaml = suite.files.filter((file) => file.path.endsWith('.yaml'));
    expect(yaml.length).toBeGreaterThan(50);
    for (const file of yaml) {
      const body = file.text
        .split('\n')
        .filter((line) => !line.startsWith('# '))
        .join('\n');
      const value = parse(body);
      expect(body, file.path).toBe(stringify(value, { lineWidth: 0, aliasDuplicateObjects: false }));
      const loaded = checkSpec(value, file.path);
      expect(loaded.ok, file.path).toBe(true);
    }
    expect(suite.report.invalid).toEqual([]);
  }, 120_000);
});
