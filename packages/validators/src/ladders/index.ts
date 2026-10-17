import type { Ladder } from '../ladder';
import { estateLadder } from './estate/index';
import { generatorLadder } from './generator/index';
import { judgesLadderV2 } from './judges/v2/index';
import { judgesLadderV3 } from './judges/v3/index';
import { mapLadder } from './map';
import { statsLadder } from './stats';
import { systemLadder } from './system';

/** Every registered validator, by component. CI runs each of them; the file is protected on executor branches. */
export function registeredLadders(): Record<string, Ladder> {
  return {
    estate: estateLadder(),
    generator: generatorLadder(),
    judges: judgesLadderV2(),
    map: mapLadder(),
    stats: statsLadder(),
    system: systemLadder(),
  };
}

/** Explicit opt-in versions. Defaults (including the version-2 judges floor) remain unchanged. */
export function registeredLadderVersions(): Record<string, Record<number, Ladder>> {
  const defaults = registeredLadders();
  const versions = Object.fromEntries(
    Object.entries(defaults).map(([name, ladder]) => [name, { [ladder.version ?? 1]: ladder }]),
  );
  versions.judges = { ...versions.judges, 3: judgesLadderV3() };
  return versions;
}
