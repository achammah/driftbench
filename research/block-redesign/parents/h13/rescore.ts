// Recomputes every score from the stored turns (no model call). Writes results/arms-scored.jsonl.
// One rule differs from plan.json, see PREREG Deviations 3: for planted negatives, `forbidden` is empty (the child block already
// counts all five tools at 0; the stem may call tools).
import { readFileSync, writeFileSync } from 'node:fs';
import { scoreBlock } from './live';

const HERE = new URL('.', import.meta.url).pathname;
const plan = new Map<string, any>(JSON.parse(readFileSync(`${HERE}plan.json`, 'utf8')).items.map((i: any) => [i.id, i]));
const out: string[] = [];
for (const line of readFileSync(`${HERE}results/arms.jsonl`, 'utf8').split('\n').filter(Boolean)) {
  const a = JSON.parse(line);
  const item = plan.get(a.item);
  const forbidden = item.type === 'plant_neg' ? [] : item.forbidden;
  const offset = a.arm === 'ISO' ? 0 : item.stem.length;
  a.stem_score = a.arm === 'ISO' ? [] : item.stem.map((b: any, i: number) => scoreBlock(b.expect, forbidden, a.turns[i]));
  a.child_score = item.child.map((b: any, i: number) => scoreBlock(b.expect, forbidden, a.turns[offset + i]));
  out.push(JSON.stringify(a));
}
writeFileSync(`${HERE}results/arms-scored.jsonl`, `${out.join('\n')}\n`);
console.log('rescored', out.length, 'arms');
