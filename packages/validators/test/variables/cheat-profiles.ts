import type { VariablesImpl } from '../../src/ladders/variables/interface';
import { variablesImpl as empty } from './constant-empty';
import { folded, quoteReader } from './quote-reference';

export const CHEATS = [
  'empty',
  'raw-quotes',
  'accept-any-quote',
  'fold-case',
  'drop-provenance',
  'drop-good-siblings',
  'retain-empty-variable',
] as const;
export type Cheat = (typeof CHEATS)[number];

export function implementation(name: Cheat): Partial<VariablesImpl> {
  if (name === 'empty') return empty;
  const reader = quoteReader(
    name === 'raw-quotes'
      ? (text) => text
      : name === 'accept-any-quote'
        ? () => 'anything'
        : name === 'fold-case'
          ? (text) => folded(text).toLowerCase()
          : folded,
  );
  return {
    buildStore(sources) {
      const store = reader(sources);
      if (name === 'drop-provenance')
        for (const variable of store.variables) for (const value of variable.values) delete value.provenance;
      if (name === 'drop-good-siblings' && store.refused.length) store.variables = [];
      if (name === 'retain-empty-variable' && store.refused.length && !store.variables.length)
        store.variables.push({ id: 'empty', values: [] });
      return store;
    },
  };
}

// The parent comparison sets the profile before starting any child. Children load the same implementation.
export const variablesImpl = implementation((process.env.ASTRA_BANKS_CHEAT ?? 'empty') as Cheat);
