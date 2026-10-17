import type { BankItem } from '../../blocks/types';
import { campaignItems } from './campaign';
import { compoundingItems } from './compounding';
import { driftItems } from './drift';
import { endStateItems } from './endstate';
import { givenItems } from './given';
import { ledgerItems } from './ledger';
import { lifecycleItems } from './lifecycle';
import { modesItems } from './modes';
import { moreItems } from './more';
import { outcomeItems } from './outcome';
import { recoveryItems } from './recovery';
import { stageItems } from './stage';
import { successionItems } from './succession';

/**
 * The growth bank for the run lane (written from the documentation alone, by a lane that never read the product):
 * drift classes, the ledger check, the stage classifier, the succession metrics, outcomes, run events and retries,
 * end-state diffs, campaigns and recovery. It joins the blocks bank by one registration line in `bank.ts`.
 */
export function growthRunItems(): BankItem[] {
  return [
    ...driftItems(),
    ...ledgerItems(),
    ...stageItems(),
    ...successionItems(),
    ...outcomeItems(),
    ...lifecycleItems(),
    ...endStateItems(),
    ...campaignItems(),
    ...recoveryItems(),
    ...modesItems(),
    ...compoundingItems(),
    ...givenItems(),
    ...moreItems(),
  ];
}
