import type { BankItem } from '../../blocks/types';
import { appliesItems } from './applies';
import { codeItems } from './code';
import { dataItems } from './data';
import { languageItems } from './language';
import { runtimeItems } from './runtime';
import { scoreItems } from './scores';
import { strictItems } from './strict';
import { textItems } from './text';
import { verdictItems } from './verdicts';

/**
 * The growth lane "checks" (a blind lane that wrote its items from docs/reference/checks.md alone and never read
 * the product): items on rules of the checks page that no earlier item tests. They join the blocks bank by one
 * registration line in `bank.ts`.
 */
export function growthChecksItems(): BankItem[] {
  return [
    ...verdictItems(),
    ...appliesItems(),
    ...runtimeItems(),
    ...textItems(),
    ...languageItems(),
    ...scoreItems(),
    ...dataItems(),
    ...strictItems(),
    ...codeItems(),
  ];
}
