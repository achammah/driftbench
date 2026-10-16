import { readFileSync } from 'node:fs';
import { objectRegistry, parseObjectText } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { initializeShippedObjects } from '../../src';

initializeShippedObjects();

describe('shipped blame data', () => {
  it.each(['policy/blame', 'policy/placement'])(
    '%s registers TS data identical to the reviewed rules',
    (kind) => {
      const source = new URL(`../../objects/${kind}/default.yaml`, import.meta.url);
      const expected = parseObjectText(readFileSync(source, 'utf8'), source.pathname).raw;
      const entry = objectRegistry.shipped().find((one) => (one.raw as { kind: string }).kind === kind);
      expect(entry?.raw).toEqual(expected);
      expect(entry?.path).toBe(`@agent-nexus/driftbench-checks ${kind}:default`);
    },
  );
});
