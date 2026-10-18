import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { formatProblems } from '../../src/ladders/variables/bank/format';
import { contextFor, runItem, variablesBank } from '../../src/ladders/variables/bank/index';
import { build } from '../../src/ladders/variables/bank/item';
import type { StoreDoc } from '../../src/ladders/variables/interface';
import { variablesImpl } from './positive-reference';
import { type FoldStep, folded, quoteReader } from './quote-reference';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const MODULE = fileURLToPath(new URL('./positive-reference.ts', import.meta.url));
const bank = variablesBank();
const item = (id: string) => {
  const found = bank.find((entry) => entry.id === id);
  if (!found) throw new Error(id);
  return found;
};

it.each([undefined, []])(
  'permits omitted or empty provenance in the projected format but rejects it from a reader (%j)',
  (provenance) => {
    const store: StoreDoc = {
      variables: [{ id: 'x', values: [{ id: 'a', ...(provenance ? { provenance } : {}) }] }],
      impossible: [],
      rules: [],
      refused: [],
    };
    expect(formatProblems(store)).toEqual([]);
    const ctx = contextFor(bank[0] as ReturnType<typeof item>, 1, ROOT, { buildStore: () => store });
    expect(() => build(ctx, {})).toThrow(/source-reader output.*no provenance/);
  },
);

it('uses ASCII IDs and accented titles in the cross-process locale item', async () => {
  let sawAccent = false;
  const implementation = {
    ...variablesImpl,
    plan: (store: StoreDoc, options: Parameters<typeof variablesImpl.plan>[1]) => {
      sawAccent ||= store.variables.some((v) =>
        [...(v.title ?? '')].some((character) => character.charCodeAt(0) > 127),
      );
      return variablesImpl.plan(store, options);
    },
  };
  const outcome = await runItem(
    item('determinism.across-processes.accented-ids-sort'),
    1,
    ROOT,
    implementation,
    MODULE,
  );
  expect(outcome).toEqual({ pass: true, detail: 'ok' });
  expect(sawAccent).toBe(true);
}, 120_000);

const quoteItems = bank.filter(
  (entry) =>
    entry.family === 'quotes' &&
    !['quotes.owner-conversation-exempt', 'quotes.condition-span-unfindable'].includes(entry.stem),
);
it.each(quoteItems.map((entry) => [entry.id, entry] as const))(
  'accepts the quote-only witness: %s',
  async (_id, entry) => {
    expect(await runItem(entry, 1, ROOT, { buildStore: quoteReader() })).toEqual({
      pass: true,
      detail: 'ok',
    });
  },
);

it.each([
  'quotes.accept.multiline.lf',
  'quotes.accept.multiline.crlf',
  'quotes.accept.unicode.accents',
  'quotes.accept.unicode.cjk',
  'quotes.accept.unicode.emoji',
  'quotes.accept.unicode.rtl',
])('kills the raw-match mutant: %s', async (id) => {
  expect((await runItem(item(id), 1, ROOT, { buildStore: quoteReader((text) => text) })).pass).toBe(false);
});

it.each(['all-caps', 'first-letter-case'])('kills a case-folding mutant: %s', async (variant) => {
  expect(
    (
      await runItem(item(`quotes.refuse.inexact.${variant}`), 1, ROOT, {
        buildStore: quoteReader((text) => folded(text).toLowerCase()),
      })
    ).pass,
  ).toBe(false);
});

it('kills a punctuation-erasing mutant', async () => {
  expect(
    (
      await runItem(item('quotes.plain-text-matching.alternation-lookalike'), 1, ROOT, {
        buildStore: quoteReader((text) => folded(text).replace(/\|b/g, '')),
      })
    ).pass,
  ).toBe(false);
});

it('merges duplicate findability causes and separates empty-variable cleanup', () => {
  expect(item('quotes.refuse.absent.unrelated-text').cause).toBe(
    item('quotes.refuse.inexact.all-caps').cause,
  );
  expect(item('quotes.per-value-granularity.all-bad').cause).not.toBe(
    item('quotes.per-value-granularity.one-of-three').cause,
  );
});

it.each(['drop-good-siblings', 'retain-empty-variable'])(
  'kills the distinct granularity mutant: %s',
  async (mutation) => {
    const reader = quoteReader();
    const buildStore = (sources: Parameters<typeof reader>[0]) => {
      const store = reader(sources);
      if (mutation === 'drop-good-siblings' && store.refused.length) store.variables = [];
      if (mutation === 'retain-empty-variable' && store.refused.length && !store.variables.length)
        store.variables.push({ id: 'empty', values: [] });
      return store;
    };
    const id = mutation === 'drop-good-siblings' ? 'one-of-three' : 'all-bad';
    expect((await runItem(item(`quotes.per-value-granularity.${id}`), 1, ROOT, { buildStore })).pass).toBe(
      false,
    );
  },
);

const normalizedItems = bank.filter((entry) =>
  ['quotes.accept.multiline', 'quotes.accept.unicode'].includes(entry.stem),
);
const foldSteps: FoldStep[] = ['unicode', 'invisibles', 'quotes', 'markdown', 'whitespace'];
it.each(normalizedItems.flatMap((entry) => foldSteps.map((step) => [entry.id, step, entry] as const)))(
  'kills a single omitted normalization in %s: %s',
  async (_id, step, entry) => {
    expect(
      (await runItem(entry, 1, ROOT, { buildStore: quoteReader((text) => folded(text, step)) })).pass,
    ).toBe(false);
  },
);

it.each(
  bank
    .filter((entry) => entry.stem === 'quotes.refuse.inexact')
    .flatMap((entry) => ['case', 'punctuation'].map((mutation) => [entry.id, mutation, entry] as const)),
)('kills sensitivity relaxation in %s: %s', async (_id, mutation, entry) => {
  const normalize = (text: string) =>
    mutation === 'case' ? folded(text).toLowerCase() : folded(text).replace(/[!.]/g, '');
  expect((await runItem(entry, 1, ROOT, { buildStore: quoteReader(normalize) })).pass).toBe(false);
});
