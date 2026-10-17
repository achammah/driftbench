import { validateSpec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';

// Fictional data only. A bookkeeping agent that reads a workbook the workspace starts with.
const target = { adapter: 'process', agent: 'acme-books' };
const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff]).toString('base64');

function load(workspace: Record<string, unknown>, where: 'spec' | 'block' = 'spec') {
  const given = { world: { workspace } };
  return validateSpec({
    id: 'binary',
    target,
    ...(where === 'spec' ? { given } : {}),
    blocks: [{ user: 'Sum the sheet.', ...(where === 'block' ? { given } : {}), expect: { must: ['42'] } }],
  });
}

describe('workspace.binary', () => {
  it('loads base64 content in the spec Given and in a block Given', () => {
    expect(load({ binary: { 'books.xlsx': bytes } }).ok).toBe(true);
    expect(load({ binary: { 'books.xlsx': bytes } }, 'block').ok).toBe(true);
  });

  it('refuses an entry that is not base64', () => {
    const loaded = load({ binary: { 'books.xlsx': 'not base64 !!' } });
    expect(loaded.ok).toBe(false);
  });

  it('refuses a path in both files and binary with WORKSPACE_PATH_TWICE', () => {
    for (const where of ['spec', 'block'] as const) {
      const loaded = load({ files: { 'books.csv': 'a,b' }, binary: { 'books.csv': bytes } }, where);
      expect(loaded.ok).toBe(false);
      if (!loaded.ok) expect(loaded.errors.map((issue) => issue.code)).toContain('WORKSPACE_PATH_TWICE');
    }
  });

  it('accepts different paths in files and binary', () => {
    expect(load({ files: { 'a.csv': 'a,b' }, binary: { 'b.xlsx': bytes } }).ok).toBe(true);
  });
});
