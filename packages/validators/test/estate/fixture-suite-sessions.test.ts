import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { FIXTURE, fixtureSuite } from '../../src/ladders/estate/bank/fixture-suite';

describe('the fixture suite is generated with the recorded sessions beside the map', {
  timeout: 300_000,
}, () => {
  it('holds the session index of the fixture beside its map', async () => {
    const suite = await fixtureSuite();
    expect(existsSync(join(suite.work, 'sessions', 'index.yaml'))).toBe(true);
  });

  it('is generated with every session of the fixture index: the report counts them', async () => {
    const suite = await fixtureSuite();
    const index = parse(await readFile(join(FIXTURE, 'sessions', 'index.yaml'), 'utf8')) as {
      sessions: unknown[];
    };
    const report = JSON.parse(
      await readFile(join(suite.work, 'suite', 'estate-generate-report.json'), 'utf8'),
    ) as { sessions?: { sessions?: number } | null };
    expect(index.sessions.length).toBeGreaterThan(0);
    expect(report.sessions?.sessions).toBe(index.sessions.length);
  });
});
