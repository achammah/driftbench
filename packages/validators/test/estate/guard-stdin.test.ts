import { describe, expect, it } from 'vitest';
import { runGuardScript } from '../../src/ladders/estate/follower';
import { drawEstate } from '../../src/ladders/estate/hidden';
import { renderEstate } from '../../src/ladders/estate/render';

// Invented scripts. A guard may exit without reading its payload; the run must still succeed, every time.
const LARGE = JSON.stringify({ tool_input: { command: 'x'.repeat(300_000) } });

describe('a guard script runs whether or not it reads its payload', () => {
  it('does not fail with EPIPE when the script exits without reading a large payload', () => {
    for (let run = 0; run < 25; run++) {
      const result = runGuardScript('sh', 'exit 0', LARGE);
      expect(result.error, `run ${run}`).toBeUndefined();
      expect(result.status, `run ${run}`).toBe(0);
    }
  });

  it('hands the payload to a script that reads it, and returns its exit code and output', () => {
    const result = runGuardScript('sh', 'cat; echo; echo seen >&2; exit 2', '{"a":1}');
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('{"a":1}\n');
    expect(result.stderr).toBe('seen\n');
  });

  it('keeps the whole payload when it is large', () => {
    const result = runGuardScript('sh', 'wc -c', LARGE);
    expect(Number(result.stdout.trim())).toBe(LARGE.length);
  });

  it('runs the generated holdout guard that never reads its payload (the cause of the CI EPIPE)', () => {
    const estate = drawEstate(1, 'holdout');
    const files = renderEstate(estate).files;
    const ignoring = estate.guards
      .filter((guard) => (guard.interpreter ?? 'sh') === 'sh')
      .map((guard) => files[guard.script])
      .filter((script): script is string => script !== undefined && !script.includes('cat'));
    expect(ignoring.length).toBeGreaterThan(0);
    for (const script of ignoring)
      for (let run = 0; run < 25; run++) {
        const result = runGuardScript('sh', script, LARGE);
        expect(result.error, `run ${run}`).toBeUndefined();
        expect(result.status, `run ${run}`).toBe(0);
      }
  });
});
