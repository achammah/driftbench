import { describe, expect, it } from 'vitest';
import { gateFiles } from '../../src/gate';
import { candidate, gate, makeSpec, OPTIONS, orderBlock } from './support';

/** Fictional data only. The holdout seal hashes a spec by its identity: links never move the sealed hash. */
const STAGES = ['start', 'ordered'];
const link = {
  block: 'order',
  to: { kind: 'prompt_section', prompt: 'shop-prompt', section: 'ordering' },
  status: 'declared',
  created_by: 'author',
};

async function sealHash(links: unknown[] | undefined): Promise<{ hash: string; written: string }> {
  const spec = makeSpec({
    id: 'order',
    stages: STAGES,
    blocks: [orderBlock('order')],
    ...(links === undefined ? {} : { metadata: { links } }),
  });
  const result = await gate([spec], { options: { holdoutShare: 1 } });
  const files = gateFiles(result, [candidate(spec)], {
    source: 'candidates',
    references: ['function:shop'],
    options: { ...OPTIONS, holdoutShare: 1 },
  });
  const seal = JSON.parse(files.find((file) => file.path === 'holdout/seal.json')?.text ?? '{}');
  const written = files.find((file) => file.path === 'holdout/order.yaml')?.text ?? '';
  return { hash: seal.specs[0].hash, written };
}

describe('the holdout seal of a linked spec', () => {
  it('seals a spec with links under the hash of the same spec without them', async () => {
    const plain = await sealHash(undefined);
    const linked = await sealHash([link]);
    expect(linked.written).toContain('shop-prompt');
    expect(plain.written).not.toContain('shop-prompt');
    expect(linked.hash).toMatch(/^[0-9a-f]{12}$/);
    expect(linked.hash).toBe(plain.hash);
    // The hash still reads the rest of the spec.
    const other = await sealHash([{ ...link, status: 'verified' }]);
    expect(other.hash).toBe(plain.hash);
  });
});
