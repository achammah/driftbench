import { defaultChecks } from '@agent-nexus/driftbench-checks';
import type { Spec } from '@agent-nexus/driftbench-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadRedteamPack, type RedteamPack, runAttack } from '../src/index';
import { acmeSales, acmeSpec, PACK_DIR } from './support';

/** Fictional data only. An attack recording is tied to the spec identity: links never break a replay. */
let pack: RedteamPack;
beforeAll(async () => {
  pack = await loadRedteamPack(PACK_DIR);
});

const withLinks = (spec: Spec): Spec => ({
  ...spec,
  metadata: {
    ...(spec.metadata ?? {}),
    links: [
      {
        block: 0,
        to: { kind: 'prompt_section', prompt: 'acme-sales', section: 'confirmation' },
        status: 'declared',
      },
    ],
    provenance: { entity: 'hand-written' },
  },
});

describe('attack replay on a linked spec', { timeout: 60_000 }, () => {
  it('replays a recording made on the plain spec against the same spec with links, and back', async () => {
    const plain = await acmeSpec('conversations/order-loose-confirmation.yaml');
    const linked = withLinks(plain);
    const first = await runAttack({
      spec: plain,
      adapter: acmeSales(),
      checks: defaultChecks(),
      pack,
      rounds: 2,
      seed: 7,
    });
    const onLinked = await runAttack({
      spec: linked,
      adapter: acmeSales(),
      checks: defaultChecks(),
      replay: first.recording,
    });
    expect(onLinked.recording.specHash).toBe(first.recording.specHash);
    expect(onLinked.rounds.map((round) => [round.class, round.injectAt])).toEqual(
      first.rounds.map((round) => [round.class, round.injectAt]),
    );
    const again = await runAttack({
      spec: plain,
      adapter: acmeSales(),
      checks: defaultChecks(),
      replay: onLinked.recording,
    });
    expect(again.recording.specHash).toBe(first.recording.specHash);
  });
});
