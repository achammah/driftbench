import { describe, expect, it } from 'vitest';
import { pointerBank } from '../../src/ladders/pointer/bank';
import { clearSeedFreeCache, runItem } from '../../src/ladders/pointer/bank/run';
import type { LedgerEntry, PointerSut, ScanRequest } from '../../src/ladders/pointer/sut/port';
import { referenceSut } from './reference';

const reference = referenceSut();
async function run(id: string, sut = reference, seed = 1) {
  const item = pointerBank().find((candidate) => candidate.id === id);
  if (!item) throw new Error(`missing item ${id}`);
  clearSeedFreeCache();
  return runItem(item, seed, sut);
}
const alteredPrompt = (vary: boolean): PointerSut => ({
  ...reference,
  scan: (request: ScanRequest) => {
    const model = request.model;
    if (!model) return reference.scan(request);
    return reference.scan({
      ...request,
      model: {
        ...model,
        transport: (call) => {
          const body = JSON.parse(call.body);
          const suffix = vary
            ? call.body.includes('alpha-set')
              ? ' Alpha branch.'
              : ' Omega branch.'
            : ' This prompt describes email.';
          if (vary) body.messages[0].content += suffix;
          else body.system += suffix;
          return model.transport({ ...call, body: JSON.stringify(body) });
        },
      },
    });
  },
});

describe('reviewed product contract boundaries', () => {
  it('accepts established lowercase sentence boundaries and rejects merging them', async () => {
    const id = 'cutting.sentences-lowercase-start-merges';
    expect(await run(id)).toMatchObject({ pass: true });
    const merged: PointerSut = {
      ...reference,
      cut: async (file) => {
        const result = await reference.cut(file);
        const first = result.units[0];
        const last = result.units.at(-1);
        if (!first || !last) return result;
        return {
          ...result,
          units: [{ ...first, end: last.end, text: file.text.slice(first.start, last.end) }],
        };
      },
    };
    expect(await run(id, merged)).toMatchObject({ pass: false });
  });

  it('allows invariant template vocabulary, while rejecting set-dependent template behavior', async () => {
    const id = 'labels.prompt-generic-template';
    expect(await run(id, alteredPrompt(false))).toMatchObject({ pass: true });
    expect(await run(id, alteredPrompt(true))).toMatchObject({ pass: false });
  });

  it('checks weighted context in addition to text similarity on independent edits', async () => {
    const id = 're-anchoring.reword-sweep-monotone';
    for (const seed of [1, 2, 11]) expect(await run(id, reference, seed)).toMatchObject({ pass: true });
    for (const matchContext of [true, false]) {
      const contextMutant: PointerSut = {
        ...reference,
        scan: async (request) => {
          if (!request.previousLedger) return reference.scan(request);
          const ledger = JSON.parse(request.previousLedger) as { entries: LedgerEntry[] };
          for (const entry of ledger.entries) {
            const file = request.files.find((candidate) => candidate.path === entry.path);
            if (!file) continue;
            const cut = await reference.cut(file);
            const unit = cut.units.find((candidate) => candidate.start === entry.hint?.start);
            if (!unit) continue;
            // Force either perfect or absent context without changing the old quote/text score.
            entry.prefix = matchContext
              ? file.text.slice(Math.max(0, unit.start - 24), unit.start)
              : '!'.repeat(24);
            entry.suffix = matchContext ? file.text.slice(unit.end, unit.end + 24) : '!'.repeat(24);
            entry.sectionPath = matchContext ? unit.path : ['ignored-context'];
          }
          return reference.scan({ ...request, previousLedger: JSON.stringify(ledger) });
        },
      };
      expect(await run(id, contextMutant), `context forced ${matchContext}`).toMatchObject({ pass: false });
    }
  });
});
