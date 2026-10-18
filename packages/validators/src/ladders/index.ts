import type { Ladder } from '../ladder';
import { estateLadder } from './estate/index';
import { generatorLadder } from './generator/index';
import { judgesLadderV2 } from './judges/v2/index';
import { mapLadder } from './map';
import { statsLadder } from './stats';
import { systemLadder } from './system';
import { variablesLadder } from './variables';

/** Every registered validator, by component. CI runs each of them; the file is protected on executor branches. */
export function registeredLadders(): Record<string, Ladder> {
  return {
    estate: estateLadder(),
    generator: generatorLadder(),
    judges: judgesLadderV2(),
    map: mapLadder(),
    stats: statsLadder(),
    system: systemLadder(),
    variables: variablesLadder(),
  };
}
