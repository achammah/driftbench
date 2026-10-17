import type { BankItem } from '../blocks/types';
import { checkItems } from './checks';
import { ladderItems } from './ladder';
import { limitItems } from './limits';
import { loaderItems } from './loader';
import { perturbedItems } from './perturbed';
import { runItems } from './run';

/**
 * The breaker bank of the blocks validator (breaker-items.md, written from the docs alone by a lane that never read
 * the runner, the spec loader or an adapter): 177 items in five families, each aimed at the shortcut a first
 * implementation of the block framework takes. They join the blocks bank by one registration line in `bank.ts`.
 */
export function breakerItems(): BankItem[] {
  return [
    ...runItems(),
    ...perturbedItems(),
    ...limitItems(),
    ...checkItems(),
    ...loaderItems(),
    ...ladderItems(),
  ];
}
