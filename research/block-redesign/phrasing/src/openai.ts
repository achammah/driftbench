// A minimal OpenAI chat-completions client for the realiser, the gate's judges and the audit labeller.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { guard, record } from './usage.ts';

export const GEN_MODEL = 'gpt-6-luna';
export const AUDIT_MODEL = 'gpt-6.1-sol';

let key: string | undefined;
function apiKey(): string {
  key ??= readFileSync(resolve(homedir(), '.nexus-secrets/openai.key'), 'utf8').trim();
  return key;
}

export async function chatJson<T>(
  batch: string,
  model: string,
  system: string,
  user: string,
  seed: number,
  effort: 'low' | 'medium' | 'high' = 'low',
): Promise<T> {
  guard();
  for (let attempt = 1; ; attempt++) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        seed,
        reasoning_effort: effort,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    const body = (await response.json()) as {
      error?: { message: string };
      choices?: { message: { content: string } }[];
      usage?: { prompt_tokens: number; completion_tokens: number; prompt_tokens_details?: { cached_tokens?: number } };
    };
    if (body.usage) {
      record(batch, model, body.usage.prompt_tokens, body.usage.prompt_tokens_details?.cached_tokens ?? 0, body.usage.completion_tokens);
    }
    if (!response.ok || !body.choices?.[0]) {
      if (attempt < 4 && (response.status === 429 || response.status >= 500)) {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }
      throw new Error(`openai ${response.status}: ${body.error?.message ?? 'no choice'}`);
    }
    const text = body.choices[0].message.content;
    try {
      return JSON.parse(text) as T;
    } catch {
      if (attempt < 3) continue;
      throw new Error(`openai answered non-JSON: ${text.slice(0, 200)}`);
    }
  }
}
