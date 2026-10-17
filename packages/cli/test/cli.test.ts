import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Io, main, VERSION } from '../src/index';

async function run(argv: string[], cwd: string) {
  let out = '';
  let err = '';
  const io: Io = {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    cwd,
  };
  const code = await main(argv, io);
  return { code, out, err };
}

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'driftbench-cli-'));
  await writeFile(join(dir, 'good.yaml'), 'id: good\nblocks:\n  - user: hi\n    expect: { must: [hello] }\n');
  await writeFile(join(dir, 'advice.yaml'), 'id: advice\nblocks:\n  - user: hi\n');
  await writeFile(join(dir, 'bad.yaml'), 'id: bad\nblocks:\n  - expect: { must: [a] }\n');
  return dir;
}

describe('driftbench spec validate', () => {
  it('exits 0 when every spec is valid and names each one', async () => {
    const dir = await fixture();
    const { code, out } = await run(['spec', 'validate', 'good.yaml', 'advice.yaml'], dir);
    expect(code).toBe(0);
    expect(out).toContain('✓ good.yaml  good · 1 block · hash ');
    expect(out).toContain('Checked 2 specs: 2 valid, 0 invalid, 1 warning.');
  });

  it('exits 1 and prints the path and code of every error', async () => {
    const dir = await fixture();
    const { code, out } = await run(['spec', 'validate', dir], dir);
    expect(code).toBe(1);
    expect(out).toContain('✗ bad.yaml');
    expect(out).toContain('blocks.0  BLOCK_STIMULUS_MISSING');
    expect(out).toContain('Checked 3 specs: 2 valid, 1 invalid');
  });

  it('prints one JSON document with --json', async () => {
    const dir = await fixture();
    const { code, out } = await run(['spec', 'validate', '--json', 'bad.yaml'], dir);
    expect(code).toBe(1);
    const parsed = JSON.parse(out) as Array<{ ok: boolean; errors: Array<{ code: string }> }>;
    expect(parsed[0]?.errors[0]?.code).toBe('BLOCK_STIMULUS_MISSING');
  });

  it('exits 1 when nothing is found', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-empty-'));
    const { code, out } = await run(['spec', 'validate', dir], dir);
    expect(code).toBe(1);
    expect(out).toContain('No spec files found.');
  });
});

describe('driftbench spec lint', () => {
  it('prints warnings and passes without --strict', async () => {
    const dir = await fixture();
    const { code, out } = await run(['spec', 'lint', 'advice.yaml'], dir);
    expect(code).toBe(0);
    expect(out).toContain('! blocks.0  BLOCK_NO_EXPECTATION');
  });

  it('fails on warnings with --strict', async () => {
    const dir = await fixture();
    const { code } = await run(['spec', 'lint', '--strict', 'advice.yaml'], dir);
    expect(code).toBe(1);
  });

  it('warns on a Given error, and on a missing summary only with --summaries', async () => {
    const dir = await fixture();
    await writeFile(
      join(dir, 'given.yaml'),
      [
        'id: given',
        'given: { vars: { session_state: resumed } }',
        'blocks:',
        '  - user: hi',
        '    given:',
        '      prefix:',
        "        - { role: assistant, content: 'x', tool_calls: [ { label: lookup, input: {} } ] }",
        '    expect: { must: [hello] }',
        '',
      ].join('\n'),
    );
    const plain = await run(['spec', 'lint', '--strict', 'given.yaml'], dir);
    expect(plain.code).toBe(1);
    expect(plain.out).toContain(
      '! blocks.0.given.prefix.0.tool_calls.0  GIVEN_UNMET  tool_history_paired: expected lookup carries an output or an error; got a call with no result',
    );
    expect(plain.out).not.toContain('GIVEN_SUMMARY_MISSING');
    const asked = await run(['spec', 'lint', '--summaries', 'given.yaml'], dir);
    expect(asked.code).toBe(0);
    expect(asked.out).toContain('! given.vars.session_state  GIVEN_SUMMARY_MISSING  summary_present');
  });
});

describe('the command line itself', () => {
  it('prints the version from package.json', async () => {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string;
    };
    expect(VERSION).toBe(pkg.version);
    const { code, out } = await run(['--version'], tmpdir());
    expect(code).toBe(0);
    expect(out.trim()).toBe(VERSION);
  });

  it('exits 2 on a usage error', async () => {
    const { code, err } = await run(['spec', 'validate'], tmpdir());
    expect(code).toBe(2);
    expect(err).toContain('missing required argument');
  });
});
