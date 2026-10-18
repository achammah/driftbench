import type { IOSetup, IOTrace, PointerIO, SampleEffect } from './io';

/** Bank-owned integration boundary. No reader implementation is imported. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Tier = 1 | 2 | 3 | 4 | 5;
export type Operation =
  | 'cut'
  | 'fingerprint'
  | 'ledger'
  | 'reanchor'
  | 'group'
  | 'labels'
  | 'replay'
  | 'privacy'
  | 'links'
  | 'radius';
export type Request = { operation: Operation; input: Json };

/**
 * Translate this bank's observations to the public reader port. Each call is isolated;
 * histories belong in input, never in shared adapter state. Return observed values only.
 * Do not import the bank/oracles or infer answers from fixture names. See CONTRACT.md.
 */
export interface PointerAdapter {
  execute(request: Request, io?: PointerIO): unknown | Promise<unknown>;
}

export type Probe = {
  request: Request;
  /** Exact planted observable, never passed to the adapter. */
  expected: Json;
  /** Optional projection for unspecified hash bytes, ordering, or raw span witnesses. */
  observe?: (actual: unknown, effects: IOTrace) => unknown;
  /** Harness-only transport fixture; absent from the request. */
  setup?: IOSetup;
  sampleEffects?: SampleEffect[];
  /** Only the harness tests use this representative raw response. It is not a reader. */
  sample?: Json;
};

export type Plant = { probes: Probe[]; budgetMs?: number; budgetBytes?: number };
export type BankItem = {
  id: string;
  family: string;
  tier: Tier;
  level: number;
  component: string;
  title: string;
  cause: string;
  /** Design section supporting the oracle; never an implementation citation. */
  design: string;
  generate(seed: number): Plant;
};

/** Seeded fictional identifiers, not a word list or a label classifier. */
export function token(seed: number, salt = 0): string {
  let n = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  n = Math.imul(n ^ (n >>> 16), 0x85ebca6b) >>> 0;
  return `v${n.toString(36)}`;
}

export function probe(operation: Operation, input: Json, expected: Json): Probe {
  return { request: { operation, input }, expected };
}
