import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { BankItem, Json, PointerAdapter, PointerIO, Probe } from './bank';
import { pointerBank, runItem } from './bank';
import { captureIO } from './bank/io';
import { leaksPrivateFragment, privateMarker } from './bank/privacy';
import { positionalCheats, reviewCheats } from './cheats';
import { pointerLadder } from './index';

const bank = pointerBank();
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const hidden = 1_000_000 + (Number.parseInt(head.slice(0, 8), 16) % 1_000_000_000);
const seeds = [...Array.from({ length: 20 }, (_, i) => i + 1), hidden];

/** A scripted transport stub, NOT a reference implementation and NOT reader evidence. */
function stub(
  item: BankItem,
  seed: number,
  mutate?: (response: Json, io: PointerIO, probe: Probe) => unknown,
): PointerAdapter {
  const probes = item.generate(seed).probes;
  let i = 0;
  return {
    async execute(request, io) {
      const p = probes[i++];
      if (!p || !io) throw new Error('missing scripted probe or IO');
      expect(request).toEqual(p.request);
      for (const effect of p.sampleEffects ?? []) {
        switch (effect.kind) {
          case 'key':
            io.readKey();
            break;
          case 'fetch':
            await io.fetch(request.input);
            break;
          case 'cache':
            io.readCassette();
            break;
          case 'write':
            io.writeCassette(effect.path, effect.value, effect.committed);
            break;
          case 'log':
            io.log(effect.value);
            break;
          case 'plan':
            io.plan(effect.value);
            break;
        }
      }
      const response = structuredClone(p.sample ?? p.expected);
      return mutate ? mutate(response, io, p) : response;
    },
  };
}

describe('blind pointer bank harness', () => {
  it('has 340 unique items, at least 30 per requested family, every tier and level, causes and citations', () => {
    expect(bank).toHaveLength(340);
    expect(new Set(bank.map((i) => i.id)).size).toBe(340);
    const families = [
      'cutting',
      'ids',
      're-anchoring',
      'grouping',
      'labels',
      'replay',
      'privacy',
      'links',
      'radius',
      'scale',
      'adversarial',
    ];
    for (const family of families)
      expect(bank.filter((i) => i.family === family)).toHaveLength(family === 'labels' ? 40 : 30);
    for (const n of [1, 2, 3, 4, 5]) {
      expect(bank.some((i) => i.tier === n)).toBe(true);
      expect(bank.some((i) => i.level === n)).toBe(true);
    }
    expect([1, 2, 3, 4, 5].map((n) => bank.filter((i) => i.tier === n).length)).toEqual([62, 62, 72, 72, 72]);
    for (const item of bank) {
      expect(item.cause.length).toBeGreaterThan(5);
      expect(item.design.length).toBeGreaterThan(0);
    }
    expect(pointerLadder({ execute: () => null })).toBeDefined();
  });

  it('has deterministic plants and hidden-seed input variation', () => {
    for (const item of bank) {
      const a = item.generate(1).probes;
      const b = item.generate(1).probes;
      expect(a.map((p) => ({ request: p.request, expected: p.expected }))).toEqual(
        b.map((p) => ({ request: p.request, expected: p.expected })),
      );
      expect(
        isDeepStrictEqual(
          a.map((p) => p.request),
          item.generate(hidden).probes.map((p) => p.request),
        ),
        item.id,
      ).toBe(false);
      expect(new Set(a.map((p) => JSON.stringify(p.expected))).size, item.id).toBeGreaterThan(1);
    }
  });

  it('runs all items through the scripted stub on 1..20 and commit-derived hidden seed', async () => {
    for (const seed of seeds)
      for (const item of bank) {
        expect(await runItem(item, seed, stub(item, seed)), `${item.id} seed=${seed}`).toMatchObject({
          pass: true,
        });
      }
  }, 120_000);

  it('empty, constant and echo implementations score ZERO on every seed', async () => {
    const totals = { empty: 0, constant: 0, echo: 0 };
    for (const seed of seeds)
      for (const item of bank) {
        const first = item.generate(seed).probes[0];
        // Stronger than a universal canned object: constant receives the first correct raw answer of EACH item.
        const value = structuredClone(first?.sample ?? first?.expected);
        const cheats: Record<keyof typeof totals, PointerAdapter> = {
          empty: { execute: () => undefined },
          constant: { execute: () => value },
          echo: { execute: (r) => r.input },
        };
        for (const name of ['empty', 'constant', 'echo'] as const)
          totals[name] += Number((await runItem(item, seed, cheats[name])).pass);
      }
    expect(totals).toEqual({ empty: 0, constant: 0, echo: 0 });
  }, 120_000);

  it('rejects a corrupted response for every item', async () => {
    for (const item of bank) {
      const honest = stub(item, 3);
      let n = 0;
      const corrupt: PointerAdapter = {
        execute: (r, io) => (n++ === 0 ? { corrupted: true } : honest.execute(r, io)),
      };
      expect((await runItem(item, 3, corrupt)).pass, item.id).toBe(false);
    }
  });

  it('does not reveal source text or thrown secrets in feedback', async () => {
    const item = bank.find((i) => i.family === 'privacy');
    if (!item) throw new Error('privacy family absent');
    const outcome = await runItem(item, 1, {
      execute: () => {
        throw new Error('FICTIONAL_SECRET_LEAK');
      },
    });
    expect(outcome.pass).toBe(false);
    expect(outcome.detail).not.toContain('FICTIONAL_SECRET_LEAK');
  });

  it('rejects all four independent review cheats on EVERY seed, not just their intersection', async () => {
    for (const seed of seeds) {
      const totals = { firstUnit: 0, textHash: 0, copying: 0, leakyCopy: 0 };
      for (const item of bank)
        for (const name of Object.keys(reviewCheats) as (keyof typeof reviewCheats)[])
          totals[name] += Number((await runItem(item, seed, reviewCheats[name])).pass);
      expect(totals, `review cheats seed=${seed}`).toEqual({
        firstUnit: 0,
        textHash: 0,
        copying: 0,
        leakyCopy: 0,
      });
    }
  }, 120_000);

  it('index, line and offset identity cheats score ZERO on EVERY seed', async () => {
    for (const seed of seeds) {
      const totals = { byIndex: 0, byLine: 0, byOffset: 0 };
      for (const item of bank)
        for (const name of Object.keys(positionalCheats) as (keyof typeof positionalCheats)[])
          totals[name] += Number((await runItem(item, seed, positionalCheats[name])).pass);
      expect(totals, `positional cheats seed=${seed}`).toEqual({ byIndex: 0, byLine: 0, byOffset: 0 });
    }
  }, 120_000);

  it('positional cheats execute valid snapshots and demonstrate the fingerprint and reorder faults', async () => {
    const scan = (texts: string[]) => {
      let start = 0;
      return {
        estateKey: 'fictional-coordinate-estate',
        files: [
          {
            path: 'fictional.md',
            source: texts.join('\n\n'),
            units: texts.map((text, index) => {
              const unit = {
                text,
                container: 'sentence',
                labels: { demo: 'kept' },
                linked: false,
                line: index * 2 + 1,
                hint: { start, end: start + text.length },
              };
              start += text.length + 2;
              return unit;
            }),
          },
        ],
      };
    };
    type Snapshots = { entries: { id: string; quote: string; status: string }[] }[];
    for (const cheat of Object.values(positionalCheats)) {
      const fresh = (await cheat.execute({
        operation: 'ledger',
        input: {
          independent: true,
          scans: [scan(['Fictional amber parcel.']), scan(['Fictional azure parcel.'])],
        },
      })) as Snapshots;
      expect(fresh).toHaveLength(2);
      expect(fresh[0]?.entries[0]?.id).toMatch(/^[a-z2-7]{10}$/);
      expect(fresh[0]?.entries[0]?.id).toBe(fresh[1]?.entries[0]?.id);
      expect(fresh[0]?.entries[0]?.quote).not.toBe(fresh[1]?.entries[0]?.quote);
      const reordered = (await cheat.execute({
        operation: 'ledger',
        input: {
          independent: false,
          scans: [
            scan(['Fictional amber parcel.', 'Fictional azure parcel.']),
            scan(['Fictional azure parcel.', 'Fictional amber parcel.']),
          ],
        },
      })) as Snapshots;
      const before = reordered[0]?.entries.find((entry) => entry.quote === 'Fictional amber parcel.');
      const after = reordered[1]?.entries.find((entry) => entry.quote === 'Fictional amber parcel.');
      expect(before?.status).toBe('live');
      expect(after?.status).toBe('live');
      expect(before?.id).not.toBe(after?.id);
    }
  });

  it('position-changing histories defeat each coordinate cheat independently of the fresh-mint probe', async () => {
    for (const seed of seeds)
      for (const item of bank.filter((item) => item.component === 'pointer.ledger')) {
        const history = item.generate(seed).probes[3];
        if (!history?.observe) throw new Error('history observation absent');
        for (const [name, cheat] of Object.entries(positionalCheats)) {
          const actual = await cheat.execute(structuredClone(history.request));
          const observation = history.observe(actual, captureIO().snapshot());
          expect(observation, `${item.id} ${name} seed=${seed}`).not.toEqual(history.expected);
        }
      }
  });

  it('ledger witnesses change real positions while preserving the planted survivor identity', () => {
    type Unit = { text: string; line: number; hint: { start: number; end: number } };
    type File = { path: string; source: string; units: Unit[] };
    type Input = { independent: boolean; scans: { estateKey: string; files: File[] }[] };
    for (const seed of seeds)
      for (const item of bank.filter((item) => item.component === 'pointer.ledger')) {
        const probes = item.generate(seed).probes;
        for (const probe of probes) {
          const input = probe.request.input as unknown as Input;
          for (const scan of input.scans)
            for (const file of scan.files)
              for (const unit of file.units) {
                expect(file.source.slice(unit.hint.start, unit.hint.end)).toBe(unit.text);
                expect(file.source.slice(0, unit.hint.start).split('\n').length).toBe(unit.line);
              }
        }
        const fresh = probes[2]?.request.input as unknown as Input;
        expect(fresh.independent).toBe(true);
        const left = fresh.scans[0];
        const right = fresh.scans[1];
        if (!left || !right) throw new Error('fresh mint snapshots absent');
        expect(left.estateKey).toBe(right.estateKey);
        for (const [f, file] of left.files.entries()) {
          for (const [u, unit] of file.units.entries()) {
            const counterpart = right.files[f]?.units[u];
            expect(right.files[f]?.path).toBe(file.path);
            expect(counterpart?.hint).toEqual(unit.hint);
            expect(counterpart?.line).toBe(unit.line);
            expect(counterpart?.text).not.toBe(unit.text);
          }
        }
        const historyProbe = probes[3];
        const history = historyProbe?.request.input as unknown as Input;
        const quote = history.scans[0]?.files[0]?.units[1]?.text;
        if (!quote || !historyProbe) throw new Error('position witness absent');
        const positions = history.scans.map((scan) => {
          let index = 0;
          for (const file of scan.files)
            for (const unit of file.units) {
              if (unit.text === quote) return { index, line: unit.line, start: unit.hint.start };
              index++;
            }
          throw new Error('surviving unit absent');
        });
        expect(positions[1]?.index).toBe((positions[0]?.index ?? 0) + 1);
        expect(positions[2]).toEqual(positions[0]);
        expect(history.scans[3]?.files.map((f) => f.path)).toEqual(
          history.scans[2]?.files.map((f) => f.path).reverse(),
        );
        expect(positions[3]?.index).not.toBe(positions[2]?.index);
        expect(positions[4]?.index).toBe(positions[3]?.index);
        expect(positions[4]?.line).not.toBe(positions[3]?.line);
        expect(positions[5]?.index).toBe(positions[4]?.index);
        expect(positions[5]?.line).toBe(positions[4]?.line);
        expect(positions[5]?.start).not.toBe(positions[4]?.start);
        expect(positions[6]?.index).not.toBe(positions[5]?.index);
        const snapshots = historyProbe.sample as { entries: { id: string; quote: string }[] }[];
        const ids = snapshots.map((snapshot) => snapshot.entries.find((entry) => entry.quote === quote)?.id);
        expect(ids.every((id) => typeof id === 'string')).toBe(true);
        expect(new Set(ids).size).toBe(1);
      }
  });

  it('rejects privacy effect spoofing even with the exact planted labels and public plan', async () => {
    for (const item of bank.filter((i) => i.family === 'privacy')) {
      const probes = item.generate(1).probes;
      let n = 0;
      const fake: PointerAdapter = {
        execute: () => {
          const p = probes[n++];
          return { ...(p?.sample as object), ...(p?.expected as object) };
        },
      };
      expect((await runItem(item, 1, fake)).pass, item.id).toBe(false);
    }
  });

  it('detects every marker character and every split, including escaped values and object keys', () => {
    for (const seed of seeds) {
      const marker = privateMarker(seed, 0);
      expect(leaksPrivateFragment({ labels: 'class-public', characters: 12 }, [marker])).toBe(false);
      for (let i = 0; i < marker.length; i++) {
        const fragment = marker[i] as string;
        expect(leaksPrivateFragment([fragment], [marker])).toBe(true);
        expect(leaksPrivateFragment({ [fragment]: 'value' }, [marker])).toBe(true);
        expect(leaksPrivateFragment(`\\u${fragment.charCodeAt(0).toString(16)}`, [marker])).toBe(true);
        if (i > 0) expect(leaksPrivateFragment([marker.slice(0, i), marker.slice(i)], [marker])).toBe(true);
      }
    }
  });

  it('rejects split or single-character leaks with otherwise valid privacy effects on all placements and modes', async () => {
    for (const item of bank.filter((i) => i.family === 'privacy')) {
      for (let split = 1; split < 12; split++) {
        const leak = stub(item, 1, (response, io, p) => {
          if (!p.setup) throw new Error('missing private fixture');
          // The key is test-only; CI adapters do not read it. Logs otherwise have no exact-content oracle.
          io.log([p.setup.key.slice(0, split), p.setup.key.slice(split)]);
          return response;
        });
        expect((await runItem(item, 1, leak)).pass, `${item.id} split=${split}`).toBe(false);
      }
      for (let character = 0; character < 12; character++) {
        const leak = stub(item, 1, (response, io, p) => {
          const input = p.request.input as { source: string };
          const markers = [...input.source].filter(
            (c) => c.charCodeAt(0) >= 0xe000 && c.charCodeAt(0) <= 0xf8ff,
          );
          const fragment = markers[character] as string;
          io.log(fragment);
          return response;
        });
        expect((await runItem(item, 1, leak)).pass, `${item.id} character=${character}`).toBe(false);
      }
      const returnedLeak = stub(item, 1, (response, _io, p) => ({
        ...(response as object),
        extra: [p.setup?.key.slice(0, 1)],
      }));
      expect((await runItem(item, 1, returnedLeak)).pass, item.id).toBe(false);
    }
  });

  it('rejects text-only identities even when path, quote and status are otherwise correct', async () => {
    for (const item of bank.filter((i) => i.component === 'pointer.ledger')) {
      const textIds = stub(item, 2, (response) => {
        const snapshots = response as { entries: { id: string; quote: string }[] }[];
        for (const snapshot of snapshots)
          for (const entry of snapshot.entries)
            entry.id = Array.from(
              createHash('sha256').update(entry.quote).digest().subarray(0, 10),
              (byte) => 'abcdefghijklmnopqrstuvwxyz234567'[byte & 31],
            ).join('');
        return response;
      });
      expect((await runItem(item, 2, textIds)).pass, item.id).toBe(false);
    }
  });

  it('checks ledger quotes and deleted status instead of discarding them during projection', async () => {
    for (const item of bank.filter((i) => i.component === 'pointer.ledger')) {
      for (const field of ['quote', 'status'] as const) {
        const corrupt = stub(item, 2, (response) => {
          const snapshots = response as { entries: { quote: string; status: string }[] }[];
          for (const snapshot of snapshots) {
            if (field === 'quote')
              for (const entry of snapshot.entries) entry.quote = 'wrong fictional quote';
            else for (const entry of snapshot.entries) if (entry.status === 'deleted') entry.status = 'live';
          }
          return response;
        });
        expect((await runItem(item, 2, corrupt)).pass, `${item.id} ${field}`).toBe(false);
      }
    }
  });

  it('rejects off-by-one UTF-16 spans even with correct displayed text', async () => {
    for (const item of bank.filter((i) => i.family === 'cutting')) {
      const first = item.generate(2).probes[0];
      if (!first) throw new Error('missing cut probe');
      const response = structuredClone(first.sample) as { units: { span: number[] }[] };
      const unit = response.units[0];
      if (!unit) throw new Error('missing planted unit');
      unit.span[1] = (unit.span[1] ?? 0) - 1;
      expect((await runItem(item, 2, { execute: () => response })).pass, item.id).toBe(false);
    }
  });
});
