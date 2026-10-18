import type { Ladder } from '../../ladder';
import { pointerBankLadder } from './bank/index';

/** The pointer validator: does the pointer reader cut, anchor, label, replay, link and scale as its design says. */
export function pointerLadder(): Ladder {
  return pointerBankLadder();
}
