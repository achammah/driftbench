import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { faultClass } from '../../../validators/src/ladders/generator/faults';
import { createFollower } from '../../../validators/src/ladders/generator/follower';
import { hiddenSpec } from '../../../validators/src/ladders/generator/hidden';
import { followerAdapter, generateFrom, runContext } from '../../../validators/src/ladders/generator/measure';
import { renderMap } from '../../../validators/src/ladders/generator/render';
import { blockOutcome, runOnce } from '../../src/gate/agents';

// Seed 13 holds the behaviour "Look up the record with lookup_record before stating its status". Its rendered
// map states no tool for a behaviour; the test adds what its prompt says: the behaviour runs lookup_record,
// at any stage, without moving the conversation.
const SEED = 13;

/** Seed 13's rendered map with a `uses_tool` for every behaviour that runs a read tool, at every stage. */
function linkedMap() {
  const hidden = hiddenSpec(SEED);
  const running = hidden.behaviours.filter(
    (behaviour) => behaviour.tool && !hidden.tools.find((tool) => tool.name === behaviour.tool)?.sideEffect,
  );
  // This positive fixture approves a reachable owner for otherwise unowned read behaviours.
  for (const behaviour of running) {
    if (hidden.flows.some((flow) => flow.behaviours.includes(behaviour.id))) continue;
    const owner = hidden.flows.find(
      (flow) =>
        hidden.paths.some((path) => path.flow === flow.id) &&
        hidden.uses.some((use) => use.flow === flow.id && use.tool === behaviour.tool),
    );
    if (!owner) throw new Error(`no reachable fixture flow calls ${behaviour.tool}`);
    owner.behaviours.push(behaviour.id);
  }
  const rendered = renderMap(hidden);
  const map = parse(rendered.map) as { relations: Array<Record<string, unknown>> };
  for (const behaviour of running) {
    const quote = `${behaviour.title}.`;
    rendered.prompt += `\n${quote}\n`;
    for (const stage of hidden.stages)
      map.relations.push({
        kind: 'uses_tool',
        subject: { dimension: 'behaviour', value: behaviour.id },
        tool: behaviour.tool,
        stage: stage.id,
        to: stage.id,
        evidence: { source: './prompt.md', quote },
        produced_by: 'code',
        approved: true,
      });
  }
  rendered.map = stringify(map);
  return { hidden, rendered, running };
}

describe('a behaviour phrase whose behaviour runs a read tool', () => {
  it('runs the tool and reads the facts its reply states, so a flipped fact fails the turn', async () => {
    const { hidden, rendered, running } = linkedMap();
    expect(running.length).toBeGreaterThan(0);
    for (const behaviour of running)
      expect(
        hidden.flows.some(
          (flow) =>
            flow.behaviours.includes(behaviour.id) && hidden.paths.some((path) => path.flow === flow.id),
        ),
        `${behaviour.id} has an approved owning path in this positive fixture`,
      ).toBe(true);
    const generated = await generateFrom(hidden, rendered, SEED, {}, { once: true });
    if (!generated.prepared) throw new Error(JSON.stringify(generated.refused));
    const titles = new Map(
      hidden.phrases
        .filter((phrase) => phrase.intent.kind === 'behaviour')
        .map((phrase) => [phrase.text, phrase.intent.kind === 'behaviour' ? phrase.intent.behaviour : '']),
    );
    const flip = faultClass('X2.fact-flip');
    if (!flip) throw new Error('no X2.fact-flip class');
    const flipped = createFollower(
      hidden,
      flip.mutation(hidden, () => true),
    );
    let checked = 0;
    for (const { spec } of generated.complete) {
      const userOf = (at: number) => {
        const when = spec.blocks[at]?.when;
        return when && 'user' in when ? when.user : undefined;
      };
      const behaviourAt = (at: number) => running.find((entry) => entry.id === titles.get(userOf(at) ?? ''));
      const index = spec.blocks.findIndex((_, at) => behaviourAt(at) !== undefined);
      if (index < 0) continue;
      const block = spec.blocks[index];
      const behaviour = behaviourAt(index);
      checked += 1;
      expect(
        block?.expect?.tools?.some((call) => call.label === behaviour?.tool && call.count === 1),
        `${spec.id} runs ${behaviour?.tool}`,
      ).toBe(true);
      expect(block?.expect?.must?.length ?? 0, `${spec.id} reads the facts`).toBeGreaterThan(0);
      const honest = await runOnce(spec, followerAdapter(createFollower(hidden)), 0, runContext());
      for (let at = 0; at <= index; at += 1)
        expect(blockOutcome(honest, at), `${spec.id} block ${at}`).toBe('pass');
      const lying = await runOnce(spec, followerAdapter(flipped), 0, runContext());
      expect(blockOutcome(lying, index), `${spec.id} with flipped facts`).toBe('fail');
    }
    expect(checked).toBeGreaterThan(0);
  }, 300_000);
});

describe('a behaviour call the map states', () => {
  it('is never made on a move: every spec without that behaviour phrase is the spec the map without it gives', async () => {
    const { hidden, rendered, running } = linkedMap();
    const linked = await generateFrom(hidden, rendered, SEED, {}, { once: true });
    const plain = await generateFrom(hidden, renderMap(hidden), SEED, {}, { once: true });
    if (!linked.prepared || !plain.prepared) throw new Error('the fictional map failed to load');
    const phrases = new Set(
      hidden.phrases
        .filter(
          (phrase) =>
            phrase.intent.kind === 'behaviour' &&
            running.some(
              (behaviour) => phrase.intent.kind === 'behaviour' && behaviour.id === phrase.intent.behaviour,
            ),
        )
        .map((phrase) => phrase.text),
    );
    const says = (spec: (typeof linked.complete)[number]['spec']) =>
      spec.blocks.some((block) => 'user' in block.when && phrases.has(block.when.user));
    const strip = (spec: object, hash: string) => JSON.stringify(spec).split(hash).join('HASH');
    const before = new Map(
      plain.complete.map(({ spec }) => [spec.id, strip(spec, plain.prepared?.hash ?? '')]),
    );
    let compared = 0;
    for (const { spec } of linked.complete) {
      if (says(spec)) continue;
      compared += 1;
      expect(strip(spec, linked.prepared.hash), spec.id).toBe(before.get(spec.id));
    }
    expect(compared).toBeGreaterThan(100);
  }, 300_000);
});
