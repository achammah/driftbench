// The Given of a block for the live run: the earlier turns played by the deterministic Acme agent
// (teacher forcing), so every realisation of a block starts from the same, recorded history.
import { createHash } from 'node:crypto';
import type { Message, ResolvedGiven, WorldState } from '../../../../packages/core/src/index.ts';
import { createAcmeAgent } from '../../../../examples/acme/src/agent.ts';
import { type BlockDef, loadBlock, stimulusText } from './blocks.ts';

type AnyWorld = WorldState & { tools?: Record<string, unknown>; store?: Record<string, unknown> };

function merge(a: AnyWorld | undefined, b: AnyWorld | undefined): AnyWorld {
  return {
    ...(a ?? {}),
    ...(b ?? {}),
    ...(a?.tools || b?.tools ? { tools: { ...(a?.tools ?? {}), ...(b?.tools ?? {}) } } : {}),
    ...(a?.store || b?.store ? { store: { ...(a?.store ?? {}), ...(b?.store ?? {}) } } : {}),
  } as AnyWorld;
}

export type BlockGiven = {
  def: BlockDef;
  seed: string;
  given: ResolvedGiven;
  expect: unknown;
  /** The last assistant reply before the block: the turn a realisation answers. */
  lastReply: string;
};

export async function blockGiven(def: BlockDef): Promise<BlockGiven> {
  const { spec, block, seed } = await loadBlock(def);
  const agent = createAcmeAgent();
  const history: Message[] = [];
  let world = merge(undefined, spec.given?.world as AnyWorld | undefined);
  for (let j = 0; j < def.index; j++) {
    const earlier = spec.blocks[j];
    if (!earlier) throw new Error('missing block');
    world = merge(world, earlier.given?.world as AnyWorld | undefined);
    history.push({ role: 'user', content: stimulusText(earlier) });
    const observed = await agent.respond(structuredClone(history), world);
    history.push({
      role: 'assistant',
      content: observed.text,
      ...(observed.toolCalls.length > 0
        ? {
            tool_calls: observed.toolCalls.map((call, n) => ({
              id: call.id ?? `toolu_p${j}_${n}`,
              label: call.label,
              input: call.input as never,
              ...(call.error !== undefined ? { error: call.error } : { output: (call.output ?? null) as never }),
            })),
          }
        : {}),
    });
  }
  world = merge(world, block.given?.world as AnyWorld | undefined);
  const hash = createHash('sha256').update(JSON.stringify({ history, world })).digest('hex').slice(0, 16);
  const given: ResolvedGiven = {
    prefix: history,
    ledger: {},
    world,
    vars: {},
    target: { adapter: 'anthropic', agent: 'acme-live' },
    hash,
  };
  const lastReply = [...history].reverse().find((m) => m.role === 'assistant')?.content ?? '';
  return { def, seed, given, expect: block.expect, lastReply };
}
