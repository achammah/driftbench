/**
 * M4.3, research prototype: the context budget builder. Length by the amount of filler (RULER), position by
 * the insertion point of the fact (Lost in the Middle, NoLiMa), filler filtered for competing values.
 */
import { readFileSync } from 'node:fs';
import type { Message } from '@agent-nexus/driftbench-core';
import type { H8Block } from './blocks';

const BANK: { user: string; assistant: string }[] = JSON.parse(readFileSync('research/block-redesign/given/H8/filler.json', 'utf8'));

/** Input tokens of the system prompt and tools with a one-word message (count_tokens, 2026-10-15). */
export const BASE_TOKENS = 1172;
/** Characters per token of the filler, calibrated with count_tokens by `calibrate.ts`; set before the pilot. */
export let CHARS_PER_TOKEN = 3.55;
export function setRatio(value: number) {
  CHARS_PER_TOKEN = value;
}
/** Tokens a message adds beyond its characters (role markers), calibrated with the ratio. */
export let PER_MESSAGE = 4;
export function setPerMessage(value: number) {
  PER_MESSAGE = value;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const estimate = (messages: readonly Message[]) => messages.reduce((sum, m) => sum + m.content.length / CHARS_PER_TOKEN + PER_MESSAGE, 0);

export type Built = { prefix: Message[]; ask: Message; pairs: number; depthActual: number | null; estimatedTokens: number; clean: boolean };

/** The history before the final message: filler pairs, the fact pair after round(d x N) of them (or none for the control). */
export function build(block: H8Block, size: number, depth: number | 'control', seed: number): Built {
  const rng = mulberry32(10_000 + seed);
  const order = BANK.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const ask: Message = { role: 'user', content: block.ask };
  const factPair: Message[] = [{ role: 'user', content: block.fact }, { role: 'assistant', content: block.ack }];
  const budget = size - BASE_TOKENS - estimate([ask]) - estimate(factPair);
  const filler: Message[][] = [];
  let used = 0;
  for (let k = 0; ; k++) {
    const pair = BANK[order[k % order.length]!]!;
    const messages: Message[] = [{ role: 'user', content: pair.user }, { role: 'assistant', content: pair.assistant }];
    const cost = estimate(messages);
    if (used + cost > budget) break;
    filler.push(messages);
    used += cost;
  }
  if (depth === 'control') {
    // Length-matched: one more filler pair takes the fact pair's place.
    const pair = BANK[order[filler.length % order.length]!]!;
    filler.push([{ role: 'user', content: pair.user }, { role: 'assistant', content: pair.assistant }]);
  }
  const n = filler.length;
  const at = depth === 'control' ? -1 : Math.round(depth * n);
  const prefix: Message[] = [];
  let before = 0;
  for (let i = 0; i <= n; i++) {
    if (i === at) {
      before = prefix.reduce((s, m) => s + m.content.length, 0);
      prefix.push(...factPair);
    }
    if (i < n) prefix.push(...filler[i]!);
  }
  const total = prefix.reduce((s, m) => s + m.content.length, 0);
  const depthActual = at < 0 ? null : before / Math.max(1, total - factPair.reduce((s, m) => s + m.content.length, 0));
  // filler_clean: no fact value and no competing pattern in the filler.
  const fillerText = filler.flat().map((m) => m.content).join('\n');
  const clean = !/AC-\d|555|\$?\d+ ?(dollars|USD)/i.test(fillerText) && !block.values.some((v) => fillerText.toLowerCase().includes(v.trim().toLowerCase()));
  return { prefix, ask, pairs: n, depthActual, estimatedTokens: Math.round(BASE_TOKENS + estimate([...prefix, ask])), clean };
}
