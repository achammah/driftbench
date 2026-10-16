import { validateSpec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';

// Fictional data only. A code agent that reads a workbook and a CSV with a byte-order mark.
const target = { adapter: 'process', agent: 'acme-ops' };
const WORKBOOK = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0xfe, 0x80]).toString('base64');
const BOM_CSV = Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('plan_id,name\n')]).toString('base64');

function block(given?: Record<string, unknown>): Record<string, unknown> {
  return {
    user: 'Total the plans in sheet.xlsx.',
    ...(given ? { given } : {}),
    expect: { must: ['total'] },
  };
}

function load(spec: Record<string, unknown>) {
  const result = validateSpec({ id: 'binary', target, ...spec });
  const issues = result.ok ? [] : result.errors;
  return { result, codes: issues.map((issue) => `${issue.code} ${issue.path}`) };
}

describe('workspace.binary', () => {
  it('loads a binary workspace file at the top of the spec and in a block, bytes kept in base64', () => {
    const { result, codes } = load({
      given: { world: { workspace: { binary: { 'in/sheet.xlsx': WORKBOOK } } } },
      blocks: [
        block({ world: { workspace: { files: { 'a.txt': 'x' }, binary: { 'in/plans.csv': BOM_CSV } } } }),
      ],
    });
    expect(codes).toEqual([]);
    expect(result.ok && result.spec.given?.world?.workspace?.binary).toEqual({ 'in/sheet.xlsx': WORKBOOK });
    expect(result.ok && result.spec.blocks[0]?.given?.world?.workspace?.binary).toEqual({
      'in/plans.csv': BOM_CSV,
    });
  });

  it('reads workspace_seed with binary files as the top-level Given', () => {
    const { result, codes } = load({
      workspace_seed: { binary: { 'sheet.xlsx': WORKBOOK } },
      blocks: [block()],
    });
    expect(codes).toEqual([]);
    expect(result.ok && result.spec.given?.world?.workspace?.binary).toEqual({ 'sheet.xlsx': WORKBOOK });
  });

  it('accepts an empty file and refuses text that is not base64', () => {
    expect(
      load({ given: { world: { workspace: { binary: { 'empty.bin': '' } } } }, blocks: [block()] }).codes,
    ).toEqual([]);
    const { codes } = load({
      given: { world: { workspace: { binary: { 'bad.bin': 'not base64!' } } } },
      blocks: [block()],
    });
    expect(codes).toHaveLength(1);
    expect(codes[0]).toMatch(/^SCHEMA_.* given\.world\.workspace\.binary\.bad\.bin$/);
  });

  it('refuses a path in both files and binary, whatever the Given that writes it', () => {
    const both = { files: { 'in/sheet.xlsx': 'text' }, binary: { 'in/sheet.xlsx': WORKBOOK } };
    expect(load({ given: { world: { workspace: both } }, blocks: [block()] }).codes).toEqual([
      'WORKSPACE_PATH_TWICE given.world.workspace.binary.in/sheet.xlsx',
    ]);
    expect(load({ blocks: [block({ world: { workspace: both } })] }).codes).toEqual([
      'WORKSPACE_PATH_TWICE blocks.0.given.world.workspace.binary.in/sheet.xlsx',
    ]);
    expect(
      load({
        given: { world: { workspace: both } },
        blocks: [block({ world: { workspace: both } })],
      }).codes,
    ).toEqual([
      'WORKSPACE_PATH_TWICE given.world.workspace.binary.in/sheet.xlsx',
      'WORKSPACE_PATH_TWICE blocks.0.given.world.workspace.binary.in/sheet.xlsx',
    ]);
  });

  it('sees two spellings of one path as the same path, and a file in two Givens as fine', () => {
    const { codes } = load({
      given: { world: { workspace: { files: { 'in/sheet.xlsx': 'text' } } } },
      blocks: [block({ world: { workspace: { binary: { './in//sheet.xlsx': WORKBOOK } } } })],
    });
    expect(codes).toEqual([]);
    expect(
      load({
        blocks: [
          block({
            world: {
              workspace: {
                files: { 'in/a.txt': 'x', 'in/b.txt': 'y' },
                binary: { './in/../in/b.txt': WORKBOOK },
              },
            },
          }),
        ],
      }).codes,
    ).toEqual(['WORKSPACE_PATH_TWICE blocks.0.given.world.workspace.binary../in/../in/b.txt']);
  });
});
