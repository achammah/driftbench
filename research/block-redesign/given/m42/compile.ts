/**
 * M4.2, research prototype: one neutral tool history (driftbench `Message[]`, calls as `{id, label, input,
 * output | error}`) rendered to three provider wires, and parsed back.
 *
 * - Anthropic Messages: an assistant message of `tool_use` blocks, then a user message whose `tool_result`
 *   blocks come first, then the assistant's text as its own assistant message.
 * - OpenAI Responses: `function_call` items (`call_id`, `arguments` as a JSON string) and
 *   `function_call_output` items, around plain role messages.
 * - OpenAI Chat Completions: an assistant message with `tool_calls`, then one `role: tool` message per call.
 *
 * Outputs travel as JSON text (`JSON.stringify`, strings included) so parse-back is exact; an error travels
 * as `{"error": "..."}` with `is_error` on Anthropic. Labels map to wire names by replacing characters the
 * wires refuse with `_`; the map is kept so parse-back restores the label.
 */
import type { Message } from '@agent-nexus/driftbench-core';

type Call = NonNullable<Message['tool_calls']>[number];

export type IdPolicy = 'keep' | 'rekey';

export class WireNames {
  private readonly toLabel = new Map<string, string>();
  wire(label: string): string {
    const name = label.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
    const known = this.toLabel.get(name);
    if (known !== undefined && known !== label) throw new Error(`two labels map to wire name ${name}`);
    this.toLabel.set(name, label);
    return name;
  }
  label(name: string): string {
    return this.toLabel.get(name) ?? name;
  }
}

/** Static pairing problems of the neutral form: a call with no result, or an id used twice. */
export function pairingProblems(history: readonly Message[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  history.forEach((message, m) => {
    (message.tool_calls ?? []).forEach((call, c) => {
      if (call.output === undefined && call.error === undefined) problems.push(`[${m}].tool_calls[${c}] ${call.label}: no result`);
      if (call.id !== undefined) {
        if (ids.has(call.id)) problems.push(`[${m}].tool_calls[${c}] ${call.label}: id ${call.id} used before`);
        ids.add(call.id);
      }
    });
  });
  return problems;
}

/** The ids the wire receives: the recorded ones (`keep`), or fresh unique ones (`rekey`). */
function idsOf(history: readonly Message[], policy: IdPolicy, prefix: string): string[][] {
  let n = 0;
  return history.map((message) =>
    (message.tool_calls ?? []).map((call) => {
      n++;
      if (policy === 'keep' && call.id !== undefined) return call.id.replace(/[^a-zA-Z0-9_-]/g, '_');
      return `${prefix}${String(n).padStart(4, '0')}`;
    }),
  );
}

const resultText = (call: Call): string => JSON.stringify(call.error !== undefined ? { error: call.error } : (call.output ?? null));

// ------------------------------------------------------------------ Anthropic

export type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };
export type AnthropicMsg = { role: 'user' | 'assistant'; content: AnthropicBlock[] };

export function toAnthropic(history: readonly Message[], names: WireNames, policy: IdPolicy = 'keep'): { system: string[]; messages: AnthropicMsg[] } {
  const ids = idsOf(history, policy, 'toolu_r');
  const system: string[] = [];
  const messages: AnthropicMsg[] = [];
  const push = (role: 'user' | 'assistant', blocks: AnthropicBlock[]) => {
    if (blocks.length === 0) return;
    const last = messages.at(-1);
    if (last?.role === role) {
      // A user message keeps its tool_result blocks first.
      if (role === 'user' && blocks.some((b) => b.type === 'tool_result')) last.content.unshift(...blocks);
      else last.content.push(...blocks);
    } else messages.push({ role, content: [...blocks] });
  };
  history.forEach((message, m) => {
    if (message.role === 'system') {
      if (message.content !== '') system.push(message.content);
      return;
    }
    if (message.role === 'user' || message.role === 'tool') {
      if (message.content !== '') push('user', [{ type: 'text', text: message.content }]);
      return;
    }
    const calls = message.tool_calls ?? [];
    if (calls.length > 0) {
      push('assistant', calls.map((call, c) => ({ type: 'tool_use', id: ids[m]![c]!, name: names.wire(call.label), input: call.input ?? {} })));
      push('user', calls.map((call, c) => ({ type: 'tool_result', tool_use_id: ids[m]![c]!, content: resultText(call), ...(call.error !== undefined ? { is_error: true } : {}) })));
    }
    if (message.content !== '') push('assistant', [{ type: 'text', text: message.content }]);
  });
  return { system, messages };
}

/** Back from Anthropic messages to the neutral form. Ids come back as sent. */
export function fromAnthropic(messages: readonly AnthropicMsg[], names: WireNames): Message[] {
  const out: Message[] = [];
  const open = new Map<string, Call>();
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'text') {
        const last = out.at(-1);
        if (message.role === 'assistant' && last?.role === 'assistant' && last.content === '' && (last.tool_calls?.length ?? 0) > 0) last.content = block.text;
        else out.push({ role: message.role, content: block.text });
      } else if (block.type === 'tool_use') {
        const call: Call = { id: block.id, label: names.label(block.name), input: block.input as Call['input'] };
        open.set(block.id, call);
        const last = out.at(-1);
        if (last?.role === 'assistant' && last.content === '' && last.tool_calls) last.tool_calls.push(call);
        else out.push({ role: 'assistant', content: '', tool_calls: [call] });
      } else {
        const call = open.get(block.tool_use_id);
        if (!call) throw new Error(`tool_result for unknown id ${block.tool_use_id}`);
        const value = JSON.parse(block.content);
        if (block.is_error) call.error = (value as { error: string }).error;
        else call.output = value;
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ OpenAI Responses

export type ResponsesItem =
  | { role: 'user' | 'assistant' | 'system'; content: string }
  | { type: 'function_call'; call_id: string; name: string; arguments: string }
  | { type: 'function_call_output'; call_id: string; output: string };

export function toResponses(history: readonly Message[], names: WireNames, policy: IdPolicy = 'keep'): ResponsesItem[] {
  const ids = idsOf(history, policy, 'call_r');
  const items: ResponsesItem[] = [];
  history.forEach((message, m) => {
    if (message.role === 'tool') {
      items.push({ role: 'user', content: message.content });
      return;
    }
    if (message.role !== 'assistant') {
      items.push({ role: message.role, content: message.content });
      return;
    }
    (message.tool_calls ?? []).forEach((call, c) => {
      items.push({ type: 'function_call', call_id: ids[m]![c]!, name: names.wire(call.label), arguments: JSON.stringify(call.input ?? {}) });
      items.push({ type: 'function_call_output', call_id: ids[m]![c]!, output: resultText(call) });
    });
    if (message.content !== '') items.push({ role: 'assistant', content: message.content });
  });
  return items;
}

export function fromResponses(items: readonly ResponsesItem[], names: WireNames): Message[] {
  const out: Message[] = [];
  const open = new Map<string, Call>();
  for (const item of items) {
    if ('role' in item) {
      const last = out.at(-1);
      if (item.role === 'assistant' && last?.role === 'assistant' && last.content === '' && (last.tool_calls?.length ?? 0) > 0) last.content = item.content;
      else out.push({ role: item.role, content: item.content });
    } else if (item.type === 'function_call') {
      const call: Call = { id: item.call_id, label: names.label(item.name), input: JSON.parse(item.arguments) };
      open.set(item.call_id, call);
      const last = out.at(-1);
      if (last?.role === 'assistant' && last.content === '' && last.tool_calls) last.tool_calls.push(call);
      else out.push({ role: 'assistant', content: '', tool_calls: [call] });
    } else {
      const call = open.get(item.call_id);
      if (!call) throw new Error(`output for unknown call ${item.call_id}`);
      const value = JSON.parse(item.output);
      if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && typeof value.error === 'string') call.error = value.error;
      else call.output = value;
    }
  }
  return out;
}

// ------------------------------------------------------------------ OpenAI Chat Completions

export type ChatMsg =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export function toChat(history: readonly Message[], names: WireNames, policy: IdPolicy = 'keep'): ChatMsg[] {
  const ids = idsOf(history, policy, 'call_c');
  const out: ChatMsg[] = [];
  history.forEach((message, m) => {
    if (message.role === 'tool') {
      out.push({ role: 'user', content: message.content });
      return;
    }
    if (message.role !== 'assistant') {
      out.push({ role: message.role, content: message.content });
      return;
    }
    const calls = message.tool_calls ?? [];
    if (calls.length === 0) {
      out.push({ role: 'assistant', content: message.content });
      return;
    }
    out.push({ role: 'assistant', content: null, tool_calls: calls.map((call, c) => ({ id: ids[m]![c]!, type: 'function', function: { name: names.wire(call.label), arguments: JSON.stringify(call.input ?? {}) } })) });
    calls.forEach((call, c) => out.push({ role: 'tool', tool_call_id: ids[m]![c]!, content: resultText(call) }));
    if (message.content !== '') out.push({ role: 'assistant', content: message.content });
  });
  return out;
}

export function fromChat(messages: readonly ChatMsg[], names: WireNames): Message[] {
  const out: Message[] = [];
  const open = new Map<string, Call>();
  for (const message of messages) {
    if (message.role === 'tool') {
      const call = open.get(message.tool_call_id);
      if (!call) throw new Error(`tool message for unknown call ${message.tool_call_id}`);
      const value = JSON.parse(message.content);
      if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && typeof value.error === 'string') call.error = value.error;
      else call.output = value;
    } else if (message.role === 'assistant' && message.tool_calls) {
      const calls = message.tool_calls.map((tc): Call => {
        const call: Call = { id: tc.id, label: names.label(tc.function.name), input: JSON.parse(tc.function.arguments) };
        open.set(tc.id, call);
        return call;
      });
      out.push({ role: 'assistant', content: '', tool_calls: calls });
    } else if (message.role === 'assistant') {
      const last = out.at(-1);
      if (last?.role === 'assistant' && last.content === '' && (last.tool_calls?.length ?? 0) > 0) last.content = message.content ?? '';
      else out.push({ role: 'assistant', content: message.content ?? '' });
    } else out.push({ role: message.role, content: message.content });
  }
  return out;
}
