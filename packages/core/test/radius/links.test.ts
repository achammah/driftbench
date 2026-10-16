import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { blockLinks, checkSpecLinks, registriesByPrompt, sectionLinkStatus } from '../../src/radius/links';
import { observationCompatibilityHash, prepareRejudge } from '../../src/radius/rejudge';
import type { SectionRegistry } from '../../src/radius/sections';
import { sectionsFromHeadings } from '../../src/radius/sections';
import { adapterProvenance, provenanceHash } from '../../src/runner/provenance';
import { runSpec } from '../../src/runner/run';
import type { BlockLink } from '../../src/schema/links';
import type { Spec } from '../../src/schema/spec';
import { contentHash } from '../../src/spec/hash';
import { specHash, specIdentity } from '../../src/spec/identity';
import { validateSpec } from '../../src/spec/load';
import { echoAdapter, specOf } from '../runner/support';

/** Fictional data only. */
const original = specOf({
  id: 'acme-refund',
  criteria: [{ name: 'tone', rubric: 'Polite.' }],
  blocks: [
    { id: 'ask', when: { user: 'Can I return my phone?' }, expect: { must: ['30 days'] } },
    { id: 'thanks', when: { user: 'Thanks.' }, expect: { criteria: ['tone'] } },
  ],
});
const declared: BlockLink = {
  block: 'ask',
  to: { kind: 'prompt_section', prompt: 'acme-sales', section: 'refunds' },
  status: 'declared',
  created_by: 'author',
};
const linked = (links: BlockLink[], over: Partial<Spec> = {}): Spec => ({
  ...original,
  ...over,
  metadata: { ...(over.metadata ?? original.metadata ?? {}), links },
});

describe('links stay out of the spec hash', () => {
  it('keeps the loaded hash when a spec gains, promotes or refutes a link', () => {
    const plain = validateSpec(original);
    const once = validateSpec(linked([declared]));
    const promoted = validateSpec(linked([{ ...declared, status: 'verified' }]));
    const refuted = validateSpec(linked([{ ...declared, status: 'refuted' }]));
    for (const result of [plain, once, promoted, refuted]) expect(result.ok).toBe(true);
    if (!plain.ok || !once.ok || !promoted.ok || !refuted.ok) return;
    expect(once.hash).toBe(plain.hash);
    expect(promoted.hash).toBe(plain.hash);
    expect(refuted.hash).toBe(plain.hash);
    // A spec with no links hashes as before this change: the identity is the spec itself.
    expect(plain.hash).toBe(contentHash(plain.spec));
    expect(specIdentity(plain.spec)).toBe(plain.spec);
  });

  it('keeps other metadata in the hash, provenance aside', () => {
    const withDepends = linked([declared], { metadata: { depends: { stages: ['refund'] } } });
    expect(specHash(withDepends)).toBe(
      contentHash({ ...original, metadata: { depends: { stages: ['refund'] } } }),
    );
    expect(
      specHash({ ...withDepends, metadata: { ...withDepends.metadata, provenance: { entity: 'x' } } }),
    ).toBe(specHash(withDepends));
    expect(specHash({ ...withDepends, metadata: { depends: { stages: ['other'] } } })).not.toBe(
      specHash(withDepends),
    );
  });

  it('records the same spec hash on a run, and rejudges a linked spec against an unlinked run', async () => {
    const target = { adapter: 'echo', variant: 'v1' };
    const options = {
      adapter: echoAdapter(),
      driver: createScriptedDriver(),
      checks: [],
      mode: 'F' as const,
      repeat: 0,
      target,
      recordProvenance: true,
      now: () => new Date('2026-10-13T00:00:00Z'),
    };
    const unlinkedRun = await runSpec(original, options);
    const linkedRun = await runSpec(linked([declared]), options);
    expect(linkedRun.specHash).toBe(unlinkedRun.specHash);
    expect(linkedRun.runId).toBe(unlinkedRun.runId);

    const stamp = { executionHash: 'runtime-context' };
    expect(observationCompatibilityHash(linked([declared]), stamp)).toBe(
      observationCompatibilityHash(original, stamp),
    );
    // The run was recorded before the link existed; the old spec now carries it. Rejudge still accepts.
    const prepared = prepareRejudge(
      linked([declared]),
      linked([{ ...declared, status: 'verified' }], {
        criteria: [{ name: 'tone', rubric: 'Polite and brief.' }],
      }),
      unlinkedRun,
      {
        baselineProvenance: {
          version: 2,
          adapters: [
            {
              ...adapterProvenance(echoAdapter(), target.adapter),
              targetHash: provenanceHash(target),
              agentVersionHash: provenanceHash('v1'),
            },
          ],
        },
        fromCampaign: 'acme-base',
        agentVersion: 'v1',
        criteria: ['tone'],
        now: new Date('2026-10-13T01:00:00Z'),
      },
    );
    expect(prepared.stamp.oldSpecHash).toBe(unlinkedRun.specHash);
  });
});

describe('link validation', () => {
  it('rejects a malformed link at its path', () => {
    const result = validateSpec(linked([{ ...declared, status: 'trusted' } as unknown as BlockLink]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((issue) => issue.path)).toContain('metadata.links.0.status');
  });

  it('rejects a link to a block the spec does not have', () => {
    const result = validateSpec(
      linked([
        { ...declared, block: 'missing' },
        { ...declared, block: 7 },
      ]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.filter((issue) => issue.code === 'LINK_BLOCK_UNKNOWN').map((i) => i.path)).toEqual(
        ['metadata.links.0.block', 'metadata.links.1.block'],
      );
    }
  });

  it('names the links of each block: by id, by index, or for every block', () => {
    const spec = linked([
      declared,
      { ...declared, block: 1, to: { ...declared.to, section: 'closing' } as BlockLink['to'] },
      { ...declared, block: undefined, to: { ...declared.to, section: 'tone' } as BlockLink['to'] },
    ]);
    const sections = (index: number) =>
      blockLinks(spec, index).map((link) => (link.to.kind === 'prompt_section' ? link.to.section : ''));
    expect(sections(0)).toEqual(['refunds', 'tone']);
    expect(sections(1)).toEqual(['closing', 'tone']);
  });

  it('checks link targets and stale sections against the registries', () => {
    const built = sectionsFromHeadings('## Refunds\nRefunds within 30 days.\n## Tone\nBe kind.\n', {
      promptId: 'acme-sales',
      version: 'v2',
    });
    if (!built.ok) throw new Error(built.errors.join('\n'));
    const registry: SectionRegistry = {
      ...built.registry,
      sections: built.registry.sections.map((section) =>
        section.id === 'tone' ? { ...section, stale: true } : section,
      ),
    };
    const byPrompt = registriesByPrompt([registry]);
    if (!byPrompt.ok) throw new Error(byPrompt.errors.join('\n'));
    const spec = linked([
      declared,
      { ...declared, to: { kind: 'prompt_section', prompt: 'acme-sales', section: 'nope' } },
      { ...declared, to: { kind: 'prompt_section', prompt: 'acme-sales', section: 'tone' } },
      { ...declared, to: { kind: 'prompt_section', prompt: 'other', section: 'x' } },
      { ...declared, status: 'stale' },
    ]);
    const issues = checkSpecLinks(spec, byPrompt.byPrompt);
    expect(issues.map((issue) => [issue.level, issue.code, issue.path])).toEqual([
      ['error', 'LINK_TARGET_UNKNOWN', 'metadata.links.1.to'],
      ['warning', 'LINK_STALE', 'metadata.links.2.to'],
      ['warning', 'LINK_TARGET_UNKNOWN', 'metadata.links.3.to'],
      ['warning', 'LINK_STALE', 'metadata.links.4.status'],
    ]);
    const links = spec.metadata?.links as BlockLink[];
    expect(links.map((link) => sectionLinkStatus(link, byPrompt.byPrompt))).toEqual([
      'declared',
      'stale',
      'stale',
      'unknown-prompt',
      'stale',
    ]);
    expect(registriesByPrompt([registry, registry]).ok).toBe(false);
  });
});
