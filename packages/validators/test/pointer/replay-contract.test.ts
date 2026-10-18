import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { pointerBank } from '../../src/ladders/pointer/bank';
import { clearSeedFreeCache, runItem } from '../../src/ladders/pointer/bank/run';
import {
  canonical,
  hash,
  loadFixture,
  makeFixture,
  perturb,
  requireFixtureLabels,
} from '../../src/ladders/pointer/kit/fixture';
import { fakeTransport } from '../../src/ladders/pointer/kit/transport';
import type { PointerSut } from '../../src/ladders/pointer/sut/port';
import { referenceSut } from './reference';

const base = referenceSut();
const fixtureItems = pointerBank().filter((item) => item.id.startsWith('replay.fixture-'));
const fields = [
  'part.messages',
  'part.state',
  'path',
  'window',
  'model',
  'promptVersion',
  'schemaVersion',
  'setHash',
  'labeler',
  'part.system',
  'part.questions',
  'cutDigest',
];
const changedPaths = (before: unknown, after: unknown, prefix = ''): string[] => {
  if (canonical(before) === canonical(after)) return [];
  if (before && after && typeof before === 'object' && typeof after === 'object')
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap((k) =>
      changedPaths(
        (before as Record<string, unknown>)[k],
        (after as Record<string, unknown>)[k],
        `${prefix}.${k}`,
      ),
    );
  return [prefix];
};

describe('committed replay oracles', () => {
  for (const arm of ['haiku', 'jev', 'jev-unit'] as const) {
    it(`${arm}: fixture is reproducible without running a reader, and every unit has its authored label`, async () => {
      const fixture = loadFixture(arm);
      expect(makeFixture(arm, fixture.documents, fixture.labelsYaml)).toEqual(fixture);
      fixture.rows.forEach((row, index) => {
        expect(row.key).toBe(hash(canonical(fixture.wires[index])));
      });
      const transport = fakeTransport({
        respond: () => {
          throw new Error('replay used transport');
        },
      });
      const result = await base.scan({
        files: fixture.files,
        labelsYaml: fixture.labelsYaml,
        model: { arm, transport },
        cassette: { mode: 'replay', text: fixture.cassette },
      });
      requireFixtureLabels(result, fixture);
      expect(transport.count).toBe(0);
      // Every position is independently protected, not merely one labelled live entry.
      for (let index = 0; index < fixture.expected.length; index++) {
        const bad = structuredClone(result);
        const expected = fixture.expected[index];
        const entry = bad.ledger?.entries.find(
          (e) => e.path === expected?.path && e.quote === expected.quote,
        );
        if (!entry || !expected) throw new Error('missing fixture unit');
        delete entry.labels[expected.set];
        expect(() => requireFixtureLabels(bad, fixture)).toThrow('positive witness');
        entry.labels[expected.set] = { label: 'none', source: 'mutant', setHash: '' };
        expect(() => requireFixtureLabels(bad, fixture)).toThrow('positive witness');
      }
    });
  }
  it('all twelve fixture IDs are positive controls followed by exactly one readable-field mutation', async () => {
    expect(fixtureItems).toHaveLength(12);
    for (const [index, item] of fixtureItems.entries()) {
      const requests: Array<string> = [];
      const sut: PointerSut = {
        ...base,
        scan: async (request) => {
          requests.push(request.cassette?.text ?? '');
          return base.scan(request);
        },
      };
      clearSeedFreeCache();
      const outcome = await runItem(item, 1, sut);
      expect(outcome, item.id).toMatchObject({ pass: true });
      expect(requests, item.id).toHaveLength(2);
      const a = (requests[0] ?? '')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      const b = (requests[1] ?? '')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      const paths = changedPaths(a, b);
      expect(paths, item.id).toHaveLength(1);
      expect(paths[0], item.id).toMatch(/\.readable\./);
      expect(paths[0], item.id).toContain(fields[index]);
    }
  });
  for (const item of fixtureItems) {
    it(`${item.id}: rejecting every replay cannot replace the positive control`, async () => {
      const mutant: PointerSut = {
        ...base,
        scan: async () => ({ ok: false, error: fields.join(', '), warnings: [], atoms: [], diagnostics: [] }),
      };
      clearSeedFreeCache();
      expect(await runItem(item, 1, mutant)).toMatchObject({ pass: false });
    });
    it(`${item.id}: accepting the altered field is rejected`, async () => {
      let call = 0;
      let original = '';
      const mutant: PointerSut = {
        ...base,
        scan: async (request) => {
          call++;
          if (call === 1) original = request.cassette?.text ?? '';
          return base.scan({ ...request, cassette: { mode: 'replay', text: original } });
        },
      };
      clearSeedFreeCache();
      expect(await runItem(item, 1, mutant)).toMatchObject({ pass: false });
    });
  }
  it('no replay item consumes a recording it produced', async () => {
    const before = process.env.DRIFTBENCH_POINTER_SUT;
    process.env.DRIFTBENCH_POINTER_SUT = fileURLToPath(new URL('./reference/index.ts', import.meta.url));
    try {
      const poisoned: PointerSut = {
        ...base,
        scan: async (request) => {
          const result = await base.scan(request);
          if (request.cassette?.mode === 'record' && result.cassette)
            result.cassette = result.cassette
              .trim()
              .split('\n')
              .map((line) => {
                const row = JSON.parse(line);
                row.key = hash(`never-replay-this-output:${row.key}`);
                return JSON.stringify(row);
              })
              .concat('')
              .join('\n');
          return result;
        },
      };
      for (const item of pointerBank().filter((i) => i.family === 'replay')) {
        clearSeedFreeCache();
        expect(await runItem(item, 1, poisoned), item.id).toMatchObject({ pass: true });
      }
    } finally {
      if (before === undefined) delete process.env.DRIFTBENCH_POINTER_SUT;
      else process.env.DRIFTBENCH_POINTER_SUT = before;
    }
  }, 60_000);
  it('perturb does not flip a key or change an answer', () => {
    const fixture = loadFixture('haiku');
    const changed = perturb(fixture, 'haiku', 1, 'model', 'other');
    const rows = changed.cassette
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(changedPaths(fixture.rows, rows)).toEqual(['.1.readable.model']);
  });
});

describe('other families use independent replay inputs', () => {
  for (const id of [
    'privacy.replay-makes-no-network',
    'privacy.estate-files-unchanged',
    'labels.jev-threshold-is-a-replay-setting',
  ]) {
    it(id, async () => {
      const item = pointerBank().find((i) => i.id === id);
      if (!item) throw new Error(`missing ${id}`);
      const before = process.env.DRIFTBENCH_POINTER_SUT;
      process.env.DRIFTBENCH_POINTER_SUT = fileURLToPath(new URL('./reference/index.ts', import.meta.url));
      try {
        clearSeedFreeCache();
        expect(await runItem(item, 1, base)).toMatchObject({ pass: true });
        const noLabels: PointerSut = {
          ...base,
          scan: async (req) => {
            const res = await base.scan(req);
            if (req.cassette?.mode === 'replay' && res.ledger)
              for (const entry of res.ledger.entries) entry.labels = {};
            return res;
          },
        };
        if (!id.includes('makes-no-network')) {
          clearSeedFreeCache();
          expect(await runItem(item, 1, noLabels)).toMatchObject({ pass: false });
        }
      } finally {
        if (before === undefined) delete process.env.DRIFTBENCH_POINTER_SUT;
        else process.env.DRIFTBENCH_POINTER_SUT = before;
      }
    }, 60_000);
  }
  it('scale crosses a cassette window boundary with authored headings and all labels', async () => {
    const { runScaleOp } = await import('../../src/ladders/pointer/kit/scale');
    const result = await runScaleOp({ op: 'replay', spec: { seed: 1, files: 2, perFile: 70 } }, base);
    expect(result.problems).toEqual([]);
    expect(result.live).toEqual([142, 142]);
    expect(result.extra).toMatchObject({ same: true, calls: 0, expectedLive: 142 });
    for (const brokenCall of [1, 2, 3]) {
      let calls = 0;
      const missingLabel: PointerSut = {
        ...base,
        scan: async (req) => {
          const res = await base.scan(req);
          if (++calls === brokenCall && res.ledger?.entries[0]) res.ledger.entries[0].labels = {};
          return res;
        },
      };
      await expect(
        runScaleOp({ op: 'replay', spec: { seed: 1, files: 2, perFile: 70 } }, missingLabel),
      ).rejects.toThrow(/positive witness/);
    }
  }, 60_000);
});
