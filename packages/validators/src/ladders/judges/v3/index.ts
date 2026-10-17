import { bankMeasure, defineLadder, type Ladder } from '../../../ladder';
import {
  LABELLER_TIER_BARS,
  type LabellerBankItem,
  type LabellerFactory,
  labellerBank,
  runLabellerItem,
} from './bank';

export * from './bank';
export * from './fixtures';

export type JudgesV3Options = { bank?: LabellerBankItem[]; labellerFactory?: LabellerFactory };

/** Additive opt-in version: the default version-2 judge bank is unchanged. */
export function judgesLadderV3(options: JudgesV3Options = {}): Ladder {
  const bank = options.bank ?? labellerBank();
  return defineLadder({
    component: 'judges',
    version: 3,
    levels: ([1, 2, 3, 4, 5] as const).map((tier) => {
      const own = bank.filter((item) => item.tier === tier);
      const bars = LABELLER_TIER_BARS[tier];
      return {
        id: `labellers-tier-${tier}`,
        name: `labeller tier ${tier}: agreement, robustness and recording integrity`,
        metric: `items passing raw agreement >= ${bars.agreement}, Cohen kappa >= ${bars.kappa} and their pair relations / ${own.length} items`,
        threshold: 1,
        async compute({ seed }) {
          const results = [];
          for (const item of own) {
            const result = await runLabellerItem(item, seed, options.labellerFactory);
            results.push({
              id: item.id,
              family: item.family,
              tier,
              component: item.component,
              cause: item.cause,
              pass: result.pass,
              detail: result.detail,
            });
          }
          return bankMeasure(results, 'packages/judges/src/labeller.ts');
        },
      };
    }),
  });
}
