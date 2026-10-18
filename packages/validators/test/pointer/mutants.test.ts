import { describe, expect, it } from 'vitest';
import type { CutResult, Labeler, PointerSut, ScanRequest } from '../../src/ladders/pointer/sut/port';
import { tally } from './helpers';
import { referenceSut } from './reference/index';

/** A reader with one planted bug: the bank must lose items for it. */
const ref = referenceSut();
const mutant = (name: string, patch: Partial<PointerSut>): PointerSut => ({ ...ref, name, ...patch });
const cutWith = (f: (r: CutResult) => CutResult) => async (file: { path: string; text: string }) =>
  f(await ref.cut(file));

const cheater: Labeler = (request) => ({
  labels: request.window.units
    .filter((u) => u.mode === 'label')
    .map((u) => ({ units: u.n, label: u.n % 2 === 0 ? 'rule' : 'none' })),
});

describe('planted readers lose items', { timeout: 600_000 }, () => {
  it('a cut that drops the last unit of a file loses cutting items', async () => {
    const out = await tally(
      mutant('drops-last', { cut: cutWith((r) => ({ ...r, units: r.units.slice(0, -1) })) }),
      (i) => i.family === 'cutting',
    );
    expect(out.failed.length).toBeGreaterThan(out.total * 0.8);
  });

  it('a cut whose spans are off by one loses cutting items', async () => {
    const out = await tally(
      mutant('shifted', {
        cut: cutWith((r) => ({ ...r, units: r.units.map((u) => ({ ...u, start: u.start + 1 })) })),
      }),
      (i) => i.family === 'cutting',
    );
    expect(out.failed.length).toBeGreaterThan(out.total * 0.8);
  });

  it('a cut that keeps no heading path loses cutting items', async () => {
    const out = await tally(
      mutant('flat', { cut: cutWith((r) => ({ ...r, units: r.units.map((u) => ({ ...u, path: [] })) })) }),
      (i) => i.family === 'cutting',
    );
    expect(out.failed.length).toBeGreaterThan(5);
  });

  it('a scan that forgets the previous ledger loses re-anchoring and id items', async () => {
    const forgets = mutant('forgets-previous', {
      scan: (request: ScanRequest) => ref.scan({ ...request, previousLedger: undefined }),
    });
    const out = await tally(forgets, (i) => i.family === 're-anchoring' || i.family === 'ids');
    expect(out.failed.length).toBeGreaterThan(out.total * 0.4);
  });

  it('a scan that reports no events loses re-anchoring items', async () => {
    const quiet = mutant('quiet', {
      scan: async (request: ScanRequest) => {
        const out = await ref.scan(request);
        return { ...out, events: {}, eventCounts: {} };
      },
    });
    const out = await tally(quiet, (i) => i.family === 're-anchoring');
    expect(out.failed.length).toBeGreaterThan(out.total * 0.3);
  });

  it('a scan that replaces planted decisions with alternating labels loses the decoy items', async () => {
    const surface = mutant('surface-labeller', {
      scan: (request: ScanRequest) =>
        request.labeler ? ref.scan({ ...request, labeler: cheater }) : ref.scan(request),
    });
    const out = await tally(
      surface,
      (i) => i.family === 'adversarial' && /decoy|deontic|without|example|fences/.test(i.id),
    );
    expect(out.failed.length).toBeGreaterThanOrEqual(5);
  });

  it('a scan that keeps no labels loses label items', async () => {
    const blind = mutant('blind', {
      scan: (request: ScanRequest) =>
        request.labeler ? ref.scan({ ...request, labeler: () => ({ labels: [] }) }) : ref.scan(request),
    });
    const out = await tally(blind, (i) => i.family === 'labels' || i.family === 'grouping');
    expect(out.failed.length).toBeGreaterThan(out.total * 0.3);
  });
});
