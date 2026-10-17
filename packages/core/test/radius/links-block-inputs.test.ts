import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { sameBlockInputs } from '../../src/radius/block-inputs';
import { runSpec } from '../../src/runner/run';
import type { BlockLink } from '../../src/schema/links';
import type { Spec } from '../../src/schema/spec';
import { echoAdapter, specOf } from '../runner/support';

/** Fictional data only. The carry check (sameBlockInputs) reads a linked spec like the plain one. */
const target = { adapter: 'function', agent: 'acme-sales' };
const plain = specOf({
  id: 'acme-hours',
  target,
  blocks: [
    { id: 'ask', when: { user: 'When do you open?' }, expect: { must: ['ok'] } },
    { id: 'thanks', when: { user: 'Thanks.' }, expect: { must: ['ok'] } },
  ],
});
const link: BlockLink = {
  block: 'ask',
  to: { kind: 'prompt_section', prompt: 'acme-sales', section: 'hours' },
  status: 'declared',
  created_by: 'author',
};
const withLinks = (spec: Spec, links: BlockLink[]): Spec => ({
  ...spec,
  metadata: { ...(spec.metadata ?? {}), links, provenance: { entity: 'hand-written' } },
});

describe('carry on a linked spec', () => {
  for (const mode of ['F', 'T'] as const) {
    it(`mode ${mode}: a run recorded without links carries over a spec that gained links, and back`, async () => {
      const options = {
        adapter: echoAdapter(),
        driver: createScriptedDriver(),
        checks: [],
        mode,
        repeat: 0,
        target,
        recordProvenance: true,
      };
      const linked = withLinks(plain, [link]);
      const plainRun = await runSpec(plain, options);
      const linkedRun = await runSpec(linked, options);
      expect(plainRun.status).toBe('completed');
      expect(linkedRun.specHash).toBe(plainRun.specHash);
      expect(sameBlockInputs(plainRun, linked)).toBe(true);
      expect(sameBlockInputs(linkedRun, plain)).toBe(true);
      expect(sameBlockInputs(linkedRun, withLinks(plain, [{ ...link, status: 'refuted' }]))).toBe(true);
      // A change that is not metadata.links still moves the block inputs.
      const edited: Spec = {
        ...plain,
        blocks: [
          { ...(plain.blocks[0] as Spec['blocks'][number]), when: { user: 'When do you close?' } },
          ...plain.blocks.slice(1),
        ],
      };
      expect(sameBlockInputs(plainRun, withLinks(edited, [link]))).toBe(false);
    });
  }
});
