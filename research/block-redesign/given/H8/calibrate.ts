/**
 * Calibrates the builder's characters-per-token ratio with count_tokens (free), then checks context_size,
 * context_position and filler_clean on seeds 0 to 2 of every block, size and depth.
 *   npx tsx research/block-redesign/given/H8/calibrate.ts [ratio perMessage]
 */
import { writeFileSync } from 'node:fs';
import Anthropic from '../../../../node_modules/.pnpm/@anthropic-ai+sdk@0.133.0_zod@4.6.5/node_modules/@anthropic-ai/sdk/index.mjs';
import { acmeTools, AGENT_MODEL, anthropicKey, SYSTEM_PROMPT } from '../agent/acme-live';
import { toAnthropic, WireNames } from '../m42/compile';
import { BLOCKS, DEPTHS, SIZES } from './blocks';
import { build, setPerMessage, setRatio } from './context';

const client = new Anthropic({ apiKey: anthropicKey() });
const names = new WireNames();
const tools = acmeTools().map((t) => ({ name: names.wire(t.name), description: t.description, input_schema: t.inputSchema as never }));

async function count(messages: ReturnType<typeof build>['prefix']) {
  const { messages: wire } = toAnthropic(messages, names);
  for (let attempt = 1; ; attempt++) {
    try {
      return (await client.messages.countTokens({ model: AGENT_MODEL, system: SYSTEM_PROMPT, tools, messages: wire as never })).input_tokens;
    } catch (error) {
      if (attempt >= 5) throw error;
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
}

if (process.argv[2]) {
  setRatio(Number(process.argv[2]));
  setPerMessage(Number(process.argv[3] ?? 4));
}
const rows = [];
for (const block of BLOCKS) {
  for (const size of SIZES) {
    for (const depth of [...DEPTHS, 'control' as const]) {
      for (const seed of [0, 1, 2]) {
        if (!process.argv[2] && (seed > 0 || depth !== 0.5)) continue; // first pass: one point per size
        const built = build(block, size, depth, seed);
        const tokens = await count([...built.prefix, built.ask]);
        const chars = [...built.prefix, built.ask].reduce((s, m) => s + m.content.length, 0);
        rows.push({ block: block.id, size, depth, seed, tokens, chars, messages: built.prefix.length + 1, err: (tokens - size) / size, depthActual: built.depthActual, clean: built.clean });
      }
    }
  }
}
writeFileSync(`research/block-redesign/given/H8/calibration${process.argv[2] ? '-check' : ''}.json`, `${JSON.stringify(rows, null, 1)}\n`);
// Fit tokens - BASE = chars / r + m * messages, by least squares on the rows.
const xs = rows.map((r) => [r.chars, r.messages]);
const ys = rows.map((r) => r.tokens - 1172 + 3);
let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
xs.forEach(([c, m], i) => { a11 += c! * c!; a12 += c! * m!; a22 += m! * m!; b1 += c! * ys[i]!; b2 += m! * ys[i]!; });
const det = a11 * a22 - a12 * a12;
const inv = (a22 * b1 - a12 * b2) / det;
const per = (a11 * b2 - a12 * b1) / det;
console.log({ n: rows.length, ratio: 1 / inv, perMessage: per, maxAbsErr: Math.max(...rows.map((r) => Math.abs(r.err))), within5: rows.filter((r) => Math.abs(r.err) <= 0.05).length, depthOff: rows.filter((r) => r.depthActual !== null && Math.abs(r.depthActual - (r.depth as number)) > 0.02).length, unclean: rows.filter((r) => !r.clean).length });
