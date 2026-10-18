import type { StemDef } from './types';

/**
 * Family weights: weights recovered from conversations drawn from a planted known mix lie inside a 95 percent
 * interval (clause P11), and the owner's declared weights are kept (clause P2). The coverage items draw many
 * replicate samples from the planted share and count how often the reported interval holds it; each threshold is
 * set from the exact coverage of the Wilson interval at that design, minus 0.03, minus 5.5 binomial standard
 * deviations, so a correct interval fails on under one seed in 10 million. Level constraints.
 */
export const WEIGHTS: readonly StemDef[] = [
  {
    id: 'weights.relative-frequency',
    family: 'weights',
    component: 'store/weights',
    need: 'P2',
    generator:
      'Sessions drawn from a planted mix on 1 to 10 variables of a base store built from tool evidence; the counts are known.',
    oracle:
      "Each value's weight is within 1 / (of + 2) of seen / of, where of counts the sessions that observe its variable (so smoothing is allowed, a wrong denominator is not).",
    cause: "a value's weight is its share of the sessions that observe its variable",
    variants: [
      ['single-variable', 1],
      ['five-values-skewed', 2],
      ['ten-variables', 2],
      ['thousand-sessions', 3],
    ],
  },
  {
    id: 'weights.complete-and-relative',
    family: 'weights',
    component: 'store/weights',
    need: 'P2',
    generator:
      'Sessions on a variable whose values are all seen, one value never seen, and one value added by the sessions.',
    oracle:
      "Every value of the variable has a weight (the format: all values or none), the weights are not all 0, the shares weight over total weight add up to 1, and each share agrees with the value's conversations count over total within 1 over (total + 2).",
    cause: 'a variable seen in conversations weighs every one of its values, in proportion to the counts',
    assumption: ['A5'],
    variants: [
      ['all-seen', 2],
      ['unseen-value', 3],
      ['new-value', 3],
    ],
  },
  {
    id: 'weights.interval-holds-estimate',
    family: 'weights',
    component: 'store/weights',
    need: 'P11',
    generator:
      'weightInterval(count, total) for (7, 50), (25, 50), (1, 50), (49, 50), (333, 1000); for (0, 1) and (1, 1); for (20, 20), (0, 20), (1000, 1000).',
    oracle: 'For every call, 0 <= lower <= count / total <= upper <= 1 and all are finite.',
    cause: 'the weight interval is clamped to 0..1 and holds the weight',
    variants: [
      ['ordinary', 2],
      ['one-session', 3],
      ['all-same', 3],
    ],
  },
  {
    id: 'weights.interval-coverage',
    family: 'weights',
    component: 'store/weights',
    need: 'P11',
    generator:
      'Replicate draws (400 to 600 per design) of the count of n sessions that show a value of planted share p, then weightInterval(count, n): (p, n) = (0.5, 100), (0.5, 20), (0.1, 50), (0.02, 100), (0.02, 1000), (0.005, 500), (0.95, 40), (0.998, 300).',
    oracle:
      'The count of replicates whose interval holds p is at least the threshold set from the exact Wilson coverage at (p, n) minus 0.03 minus 5.5 standard deviations.',
    cause:
      'the weight interval formula keeps rare shares covered (a score or exact interval, not the normal approximation)',
    variants: [
      ['half-n100', 3],
      ['half-n20', 4],
      ['tenth-n50', 4],
      ['two-percent-n100', 5],
      ['two-percent-n1000', 4],
      ['half-percent-n500', 5],
      ['ninety-five-n40', 4],
      ['near-one-n300', 5],
    ],
  },
  {
    id: 'weights.interval-width',
    family: 'weights',
    component: 'store/weights',
    need: 'P11',
    generator:
      'weightInterval at counts that match the share exactly: 50 of 100, 100 of 1000, 6 of 30; and 18 of 60 against 180 of 600.',
    oracle:
      'The width is at most 1.5 times the Wilson width and at least 0.6 times it; ten times the sessions narrow it by a factor between 2.2 and 4.5.',
    cause: 'the weight interval is computed from the counts, so it narrows as sessions grow',
    variants: [
      ['n100', 3],
      ['n1000', 3],
      ['n30', 4],
      ['tenfold-sessions-shrinks', 4],
    ],
  },
  {
    id: 'weights.interval-level',
    family: 'weights',
    component: 'store/weights',
    need: 'P11',
    generator: 'weightInterval(200, 400) and weightInterval(200, 2000).',
    oracle: 'The half-width is within 15 percent of the 95 percent Wilson half-width.',
    cause: 'the weight interval uses the 95 percent critical value 1.96',
    variants: [
      ['n400-half', 3],
      ['n2000-tenth', 3],
    ],
  },
  {
    id: 'weights.zero-count',
    family: 'weights',
    component: 'store/weights',
    need: 'P11',
    generator:
      'A value of the store that no session shows, among 20, 60 or 1,000 sessions, alone or beside seen values.',
    oracle:
      "Its share of the variable's weight is at most 1 / (n + 2); its conversations entry reads 0 of n; weightInterval(0, n) has a lower bound of 0 and an upper bound above 0.",
    cause: 'a value never seen keeps a share near 0 and an interval from 0 to a bound above 0',
    variants: [
      ['n20', 2],
      ['n1000', 3],
      ['among-seen', 3],
    ],
  },
  {
    id: 'weights.all-sessions-one-value',
    family: 'weights',
    component: 'store/weights',
    need: 'P11',
    generator: '10 or 1,000 sessions that all show the same value.',
    oracle:
      'Its share is at least 1 - 1 / (n + 2); weightInterval(n, n) has an upper bound of 1 and a lower bound below 1.',
    cause: 'a value seen in every session has an upper bound of 1 and a lower bound below 1',
    variants: [
      ['n10', 2],
      ['n1000', 3],
    ],
  },
  {
    id: 'weights.no-observation',
    family: 'weights',
    component: 'store/weights',
    need: 'H7',
    generator:
      'No session at all, sessions that never observe one variable, and owner weights on every value of a variable no session shows.',
    oracle:
      'No weight is NaN, infinite or negative; a variable no session observes has no weight or equal weights; owner weights stay as declared; weightInterval(0, 1) is a finite interval with width inside 0 to 1.',
    cause: 'a variable with no observation gets no NaN weight and no made-up weights',
    variants: [
      ['no-sessions', 2],
      ['unobserved-variable', 3],
      ['owner-only', 3],
    ],
  },
  {
    id: 'weights.recovered-mix',
    family: 'weights',
    component: 'store/weights',
    need: 'P11',
    generator:
      '400 replicate draws of n sessions from a planted mix of 4 values, of 12 skewed values, and of 15 sessions.',
    oracle:
      'The mean weight of each value over the replicates is within 5.5 standard errors (plus 0.003) of the planted share.',
    cause: 'weights are not biased away from the planted mix',
    variants: [
      ['four-values', 3],
      ['twelve-skewed', 4],
      ['small-n', 4],
    ],
  },
  {
    id: 'weights.owner-kept-exactly',
    family: 'weights',
    component: 'store/owner',
    need: 'P2',
    generator:
      'Owner weights for every value of a variable: (0.25, 0.5, 0.25), three thirds (1/3), (1e-9, 0.5, 0.5), and (60, 15, 25), a relative scale.',
    oracle: 'Each stored weight equals the declared one exactly (weights are relative, so 60 is valid).',
    cause: 'an owner weight is stored exactly as declared',
    variants: [
      ['quarter', 2],
      ['third', 3],
      ['tiny', 4],
      ['percent-scale', 3],
    ],
  },
  {
    id: 'weights.owner-invalid-refused',
    family: 'weights',
    component: 'store/owner',
    need: 'M1',
    generator: 'Owner weights -0.1, null, NaN, Infinity and the string "0.5".',
    oracle: 'The weight is not stored and the refusal list names it with a reason.',
    cause: 'an owner weight that is not a finite number from 0 up is refused with a reason',
    variants: [
      ['negative', 3],
      ['null', 3],
      ['nan', 4],
      ['infinity', 4],
      ['string', 4],
    ],
  },
];
