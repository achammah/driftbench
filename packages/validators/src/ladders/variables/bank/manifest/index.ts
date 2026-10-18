import { BOUNDARIES } from './boundaries';
import { BUDGET } from './budget';
import { COUNTER } from './counter';
import { DETERMINISM } from './determinism';
import { IMPOSSIBLE } from './impossible';
import { QUOTES } from './quotes';
import { SCALE } from './scale';
import { SEEDS } from './seeds';
import { SOURCES } from './sources';
import { STRENGTH } from './strength';
import type { StemDef } from './types';
import { VALUES } from './values';
import { WEIGHTS } from './weights';

export * from './types';

/** Every stem of the bank, in family order. */
export const STEMS: readonly StemDef[] = [
  ...SOURCES,
  ...QUOTES,
  ...VALUES,
  ...BOUNDARIES,
  ...IMPOSSIBLE,
  ...WEIGHTS,
  ...COUNTER,
  ...STRENGTH,
  ...SEEDS,
  ...BUDGET,
  ...DETERMINISM,
  ...SCALE,
];
