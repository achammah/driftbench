/**
 * Generates the H8 filler bank once with OpenAI gpt-6-luna, then filters it (PREREG "Builder").
 *   npx tsx research/block-redesign/given/H8/filler-gen.ts
 * Writes H8/filler-raw.json and H8/filler.json.
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BLOCKS } from './blocks';

const DIR = 'research/block-redesign/given';
const key = readFileSync(join(homedir(), '.nexus-secrets', 'openai.key'), 'utf8').trim();
const TOPICS = [
  'how eSIMs work in general', 'tips to improve home wifi coverage', 'what a mesh router does', 'how voicemail works', 'what roaming means in general',
  'how to keep a phone battery healthy', 'how to back up photos on a phone', 'what fiber internet is compared to cable', 'what 5G home internet is', 'how to spot a phishing text message',
  'how to set up a guest wifi network', 'what latency means for video calls', 'how to choose a phone case', 'what a SIM lock is in general', 'how to reset a router safely',
  'how parental controls work on home internet', 'what data saver modes do', 'how wifi calling works', 'how to clean a phone screen', 'what bandwidth means',
];

async function batch(topic: string, attempt = 1): Promise<{ user: string; assistant: string }[]> {
  const prompt = `Write 25 short, distinct exchanges between a customer and a friendly telecom sales assistant chatting about: ${topic}.
Each exchange: "user" is one casual question or remark (one sentence); "assistant" is a general, helpful answer (two or three sentences).
Strict rules: no digits or numbers written as words, no prices, no dates or times, no names of people, companies, brands, carriers, streets, towns or countries, no account details, no phone numbers, no email addresses, no plan names. Keep it generic.
Return only a JSON array of objects with keys "user" and "assistant".`;
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-6-luna', input: prompt, reasoning: { effort: 'none' }, max_output_tokens: 6000 }),
  });
  const json = (await response.json()) as Record<string, any>;
  const usage = json.usage ?? {};
  appendFileSync(`${DIR}/calls.jsonl`, `${JSON.stringify({ run: `h8-filler:${topic}`, model: 'gpt-6-luna', request_id: response.headers.get('x-request-id'), input_tokens: usage.input_tokens ?? 0, output_tokens: usage.output_tokens ?? 0, provider: 'openai', status: response.status })}\n`);
  const text: string = (json.output ?? []).flatMap((item: any) => item.content ?? []).map((c: any) => c.text ?? '').join('');
  try {
    const start = text.indexOf('[');
    return JSON.parse(text.slice(start, text.lastIndexOf(']') + 1));
  } catch {
    if (attempt < 3) return batch(topic, attempt + 1);
    return [];
  }
}

const raw = (await Promise.all(TOPICS.map((t) => batch(t)))).flat();
writeFileSync(`${DIR}/H8/filler-raw.json`, `${JSON.stringify(raw, null, 1)}\n`);
const banned = /\d|@|\b(street|road|lane|avenue|way|court|drive|gardens|account|budget|address|phone number|carrier|dollars?|usd|bluefin|wren|acme)\b/i;
const values = BLOCKS.flatMap((b) => b.values.map((v) => v.trim().toLowerCase()));
const seen = new Set<string>();
const clean = raw.filter((pair) => {
  if (typeof pair?.user !== 'string' || typeof pair?.assistant !== 'string') return false;
  const both = `${pair.user} ${pair.assistant}`;
  if (banned.test(both)) return false;
  if (values.some((v) => both.toLowerCase().includes(v))) return false;
  if (seen.has(pair.user)) return false;
  seen.add(pair.user);
  return true;
});
writeFileSync(`${DIR}/H8/filler.json`, `${JSON.stringify(clean, null, 1)}\n`);
console.log({ raw: raw.length, clean: clean.length });
