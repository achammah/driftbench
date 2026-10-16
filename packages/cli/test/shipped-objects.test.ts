import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

it('a cold CLI registers shipped objects before spec validation or linting', async () => {
  // No import of checks in this test: another command must not accidentally prime the registry.
  vi.resetModules();
  const { main } = await import('../src/main');
  const cwd = await mkdtemp(join(tmpdir(), 'driftbench-shipped-'));
  try {
    for (const [name, use] of [
      ['good', 'blame: default, placement: default'],
      ['bad', 'blame: nope'],
    ]) {
      await writeFile(
        join(cwd, `${name}.yaml`),
        `id: ${name}\nuses: { ${use} }\nblocks:\n  - user: hello\n    expect: { must: [hello] }\n`,
      );
    }
    let output = '';
    const io = {
      cwd,
      out: (text: string) => {
        output += text;
      },
      err: (text: string) => {
        output += text;
      },
    };
    expect(await main(['spec', 'validate', 'good.yaml'], io), output).toBe(0);
    expect(await main(['spec', 'lint', 'good.yaml'], io), output).toBe(0);
    output = '';
    expect(await main(['spec', 'validate', 'bad.yaml'], io)).toBe(1);
    expect(output).toContain('OBJECT_UNKNOWN');
    expect(output).toContain('policy/blame');
    expect(output).toContain('nope');
    expect(output).toMatch(/known[^\n]*default/i);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
