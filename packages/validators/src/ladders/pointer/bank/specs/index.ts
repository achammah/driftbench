import { adversarial } from './adversarial';
import { cutting } from './cutting';
import { grouping } from './grouping';
import { ids } from './ids';
import { labels } from './labels';
import { links } from './links';
import { privacy } from './privacy';
import { radius } from './radius';
import { reanchoring } from './reanchoring';
import { replay } from './replay';
import { scale } from './scale';
import type { FamilySpec } from './types';

export const FAMILIES: FamilySpec[] = [
  cutting,
  ids,
  reanchoring,
  grouping,
  labels,
  replay,
  privacy,
  links,
  radius,
  scale,
  adversarial,
];
