import { symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { ClaudeCodeReader, scanEstate } from '@agent-nexus/driftbench-estate';
import { expect, it } from 'vitest';
import { estate, NOW } from '../../estate/test/support';
import { driftOf } from '../src/commands/estate-live';

it('counts a standing file linked from outside the estate as absent when checking drift', async () => {
  const text = '# Fictional parcels\nAlways weigh a parcel before dispatch.\n';
  const root = await estate({ 'CLAUDE.md': text });
  const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
  const linked = await estate({});
  const outside = await estate({ 'CLAUDE.md': text });
  await symlink(join(outside, 'CLAUDE.md'), join(linked, 'CLAUDE.md'));
  expect(await driftOf(root, map)).toEqual([]);
  expect((await driftOf(linked, map)).length).toBeGreaterThan(0);
});
