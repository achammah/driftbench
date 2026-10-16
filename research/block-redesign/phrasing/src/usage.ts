// Paid-call accounting: every call appends its provider usage to data/usage.jsonl with its batch name.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** USD per million tokens. Sources and dates are in LEDGER.md. */
export const PRICES: Record<string, { input: number; cachedInput: number; output: number }> = {
  'gpt-6-luna': { input: 0.1, cachedInput: 0.01, output: 0.5 },
  'gpt-6.1-sol': { input: 2.0, cachedInput: 0.1, output: 10.0 },
  'claude-haiku-5-5': { input: 0.1, cachedInput: 0.01, output: 0.5 },
};

export const USAGE_FILE = resolve(import.meta.dirname, '../data/usage.jsonl');
export const LANE_CAP = 40;
export const STOP_AT = 36;

export type UsageRow = { batch: string; model: string; input: number; cachedInput: number; output: number; usd: number };

export function usd(model: string, input: number, cachedInput: number, output: number): number {
  const p = PRICES[model];
  if (!p) throw new Error(`no price for ${model}`);
  return ((input - cachedInput) * p.input + cachedInput * p.cachedInput + output * p.output) / 1e6;
}

export function record(batch: string, model: string, input: number, cachedInput: number, output: number): number {
  const cost = usd(model, input, cachedInput, output);
  const row: UsageRow = { batch, model, input, cachedInput, output, usd: cost };
  appendFileSync(USAGE_FILE, `${JSON.stringify(row)}\n`);
  return cost;
}

export function spent(): number {
  if (!existsSync(USAGE_FILE)) return 0;
  return readFileSync(USAGE_FILE, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .reduce((sum, line) => sum + (JSON.parse(line) as UsageRow).usd, 0);
}

/** Refuses to start a paid call once the lane has spent 90% of its cap. */
export function guard(): void {
  const total = spent();
  if (total >= STOP_AT) throw new Error(`lane spend ${total.toFixed(2)} USD reached the stop line ${STOP_AT}`);
}
