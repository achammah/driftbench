import { type LoadResult, parseSpecText } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';

const PDF_HEAD = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x00, 0xff, 0xfe]);
const BOM_CSV = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('plan,price\nS,15\n')]);

function loaded(text: string): Extract<LoadResult, { ok: true }> {
  const result = parseSpecText(text, 'yaml', 'binary-seed.yaml');
  if (!result.ok) throw new Error(result.errors.map((issue) => `${issue.code} ${issue.message}`).join('; '));
  return result;
}

function task(workspace: string, blockGiven = ''): string {
  return `
id: binary-seed
kind: task
given:
  world:
    workspace:
${workspace}
blocks:
  - id: build
    when:
      user: Read the planted files.
${blockGiven}
    expect:
      workspace:
        others_untouched: true
`;
}

describe('workspace.binary in a Given', () => {
  it('is accepted next to files and kept as written', () => {
    const text = task(`      files:
        notes.txt: hello
      binary:
        in/report.pdf: ${PDF_HEAD.toString('base64')}
        in/plans.csv: ${BOM_CSV.toString('base64')}`);
    const workspace = loaded(text).spec.given?.world?.workspace;
    expect(workspace?.binary).toEqual({
      'in/report.pdf': PDF_HEAD.toString('base64'),
      'in/plans.csv': BOM_CSV.toString('base64'),
    });
    expect(workspace?.files).toEqual({ 'notes.txt': 'hello' });
  });

  it('is accepted in the Given of a block', () => {
    const text = task(
      '      files:\n        a.txt: x',
      `    given:
      world:
        workspace:
          binary:
            b.bin: ${PDF_HEAD.toString('base64')}`,
    );
    expect(loaded(text).spec.blocks[0]?.given?.world?.workspace?.binary).toEqual({
      'b.bin': PDF_HEAD.toString('base64'),
    });
  });

  it('refuses a value that is not base64', () => {
    const result = parseSpecText(task('      binary:\n        in/x.bin: "not base64!"'), 'yaml', 'x.yaml');
    expect(result.ok).toBe(false);
  });
});
