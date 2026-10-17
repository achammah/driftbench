import type { CheckContext, Spec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { hazardRecovery } from '../src/checks/estate';
import { type Call, context, observed } from './support/context';

const spec = {
  id: 'archive-recovery',
  blocks: [{ when: { user: 'Continue.' }, expect: {} }],
} as unknown as Spec;
function ctx(
  calls: Call[],
  markers: Array<{ kind: string; afterToolCalls: number }> = [],
  history: Call[] = [],
): CheckContext {
  return context(spec, 0, observed('Continuing.', calls, { raw: { markers } }), {
    history: history.length
      ? ([{ index: 0, observed: observed('', history) }] as unknown as CheckContext['history'])
      : [],
  });
}
async function outcomes(c: CheckContext, options: unknown) {
  const result = await hazardRecovery(c, options);
  return Object.fromEntries((Array.isArray(result) ? result : [result]).map((v) => [v.id, v.outcome]));
}

describe('hazard recovery actions use the event and real request identity', () => {
  it('uses the latest event, never an earlier recovery before the second compaction', async () => {
    expect(
      await outcomes(
        ctx(
          [{ label: 'Read', input: { file_path: '/work/POLICY.md' } }],
          [
            { kind: 'compaction', afterToolCalls: 0 },
            { kind: 'compaction', afterToolCalls: 1 },
          ],
        ),
        { hazard: 'compaction', reread: ['POLICY.md'] },
      ),
    ).toMatchObject({ 'hazard_recovery.reread.0': 'fail' });
  });
  it('does not accept a failed read as restored context', async () => {
    expect(
      await outcomes(
        ctx([{ label: 'Read', input: { file_path: '/work/notes/state.md' }, error: 'file absent' }]),
        { hazard: 'restart', reread: ['notes/state.md'] },
      ),
    ).toMatchObject({ 'hazard_recovery.reread.0': 'fail' });
  });
  it('requires a concrete command after the marker, with the declared count', async () => {
    const calls = [{ label: 'Bash', input: { command: 'node tools/check.mjs' } }];
    const options = {
      hazard: 'notification',
      calls: [{ label: 'Bash', input: { command: { contains: 'tools/check.mjs' } }, count: { min: 2 } }],
    };
    expect(await outcomes(ctx(calls), options)).toMatchObject({ 'hazard_recovery.call.0': 'fail' });
    expect(await outcomes(ctx([...calls, ...calls]), options)).toMatchObject({
      'hazard_recovery.call.0': 'pass',
    });
    expect(
      await outcomes(ctx([...calls, ...calls], [{ kind: 'notification', afterToolCalls: 2 }]), options),
    ).toMatchObject({ 'hazard_recovery.call.0': 'fail' });
  });
  it('compares the full failed tool input, preserving nested values and ignoring JSON key order', async () => {
    const failed = [
      { label: 'Fetch', input: { url: 'https://example.invalid/a', params: { b: 2, a: 1 } }, error: '429' },
    ];
    expect(
      await outcomes(
        ctx(
          [{ label: 'Fetch', input: { params: { a: 1, b: 2 }, url: 'https://example.invalid/a' } }],
          [],
          failed,
        ),
        { hazard: 'rate_wave', retry: true },
      ),
    ).toMatchObject({ 'hazard_recovery.retry': 'pass' });
    expect(
      await outcomes(
        ctx(
          [{ label: 'Fetch', input: { params: { a: 1, b: 3 }, url: 'https://example.invalid/a' } }],
          [],
          failed,
        ),
        { hazard: 'rate_wave', retry: true },
      ),
    ).toMatchObject({ 'hazard_recovery.retry': 'fail' });
    expect(
      await outcomes(ctx([{ label: 'OtherFetch', input: failed[0]?.input }], [], failed), {
        hazard: 'rate_wave',
        retry: true,
      }),
    ).toMatchObject({ 'hazard_recovery.retry': 'fail' });
  });
  it('keeps a provider transport retry inconclusive when no failed tool request is observed', async () => {
    expect(
      await outcomes(ctx([{ label: 'Fetch', input: { url: 'https://example.invalid/a' } }]), {
        hazard: 'rate_wave',
        retry: true,
      }),
    ).toMatchObject({ 'hazard_recovery.retry': 'inconclusive' });
  });
});
