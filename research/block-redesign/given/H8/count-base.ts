import { anthropicKey, AGENT_MODEL, SYSTEM_PROMPT, acmeTools } from '../agent/acme-live';
import Anthropic from '../../../../node_modules/.pnpm/@anthropic-ai+sdk@0.133.0_zod@4.6.5/node_modules/@anthropic-ai/sdk/index.mjs';
const client = new Anthropic({ apiKey: anthropicKey() });
const tools = acmeTools().map((t) => ({ name: t.name.replace('.', '_'), description: t.description, input_schema: t.inputSchema as never }));
const msg = [{ role: 'user' as const, content: 'Hi' }];
const a = await client.messages.countTokens({ model: AGENT_MODEL, system: SYSTEM_PROMPT, tools, messages: msg });
const b = await client.messages.countTokens({ model: AGENT_MODEL, messages: msg });
const c = await client.messages.countTokens({ model: AGENT_MODEL, messages: [{ role: 'user', content: 'The grass is green. The sky is blue. '.repeat(200) }] });
console.log({ withSystemTools: a.input_tokens, bare: b.input_tokens, repeated7200chars: c.input_tokens });
