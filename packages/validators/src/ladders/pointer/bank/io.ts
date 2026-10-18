import type { Json } from './types';

/** Fixture transport lives outside adapter input; it never reads a real key or network. */
export type IOSetup = { key: string; answer: Json; cached: Json | null };
export type Write = { path: string; value: Json; committed: boolean };
export type IOTrace = {
  keyReads: number;
  networkCalls: number;
  cacheReads: number;
  writes: Write[];
  logs: Json[];
  plans: Json[];
};
export interface PointerIO {
  readKey(): string;
  fetch(request: Json): Promise<Json>;
  readCassette(): Json | null;
  writeCassette(path: string, value: Json, committed: boolean): void;
  log(value: Json): void;
  plan(value: Json): void;
}

/** Frozen callbacks own all counters and sinks. No adapter can replace the trace. */
export function captureIO(setup?: IOSetup): { io: PointerIO; snapshot(): IOTrace } {
  const fixture = setup && structuredClone(setup);
  const trace: IOTrace = { keyReads: 0, networkCalls: 0, cacheReads: 0, writes: [], logs: [], plans: [] };
  function configured(): IOSetup {
    if (!fixture) throw new Error('transport fixture absent');
    return fixture;
  }
  const io: PointerIO = Object.freeze({
    readKey() {
      trace.keyReads++;
      return configured().key;
    },
    async fetch(_request: Json) {
      trace.networkCalls++;
      return structuredClone(configured().answer);
    },
    readCassette() {
      trace.cacheReads++;
      return structuredClone(configured().cached);
    },
    writeCassette(path: string, value: Json, committed: boolean) {
      trace.writes.push(structuredClone({ path, value, committed }));
    },
    log(value: Json) {
      trace.logs.push(structuredClone(value));
    },
    plan(value: Json) {
      trace.plans.push(structuredClone(value));
    },
  });
  return { io, snapshot: () => structuredClone(trace) };
}

/** Only a scripted positive TEST stub consumes these actions, never the adapter. */
export type SampleEffect =
  | { kind: 'key' | 'fetch' | 'cache' }
  | ({ kind: 'write' } & Write)
  | { kind: 'log' | 'plan'; value: Json };
