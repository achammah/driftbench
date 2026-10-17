import { FakeModelPort } from '@agent-nexus/driftbench-generate';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { answer, estate, NOW } from '../support';
import { CITATIONS, ENTITY_LABELS, REPLACEMENTS } from './citation-corpus';

describe('citations and entity identifiers', () => {
  it.each([
    ...CITATIONS.map((text) => ({ text, cites: true })),
    ...ENTITY_LABELS.map((text) => ({ text, cites: false })),
  ])('$text (cites=$cites)', async ({ text, cites }) => {
    const rules = ['Read the source before editing.', text];
    const root = await estate({
      'CLAUDE.md': rules.map((rule, index) => `- **R${index + 1}.** ${rule}`).join('\n'),
    });
    const port = new FakeModelPort([
      answer(
        'CLAUDE.md',
        rules.map((quote, index) => ({
          kind: 'instruction',
          title: `Rule ${index + 1}`,
          quote,
          evidence: [{ type: 'custom', name: `r${index + 1}` }],
        })),
      ),
    ]);
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), port, now: NOW });
    expect(map.edges.filter((edge) => edge.kind === 'cites')).toHaveLength(cites ? 1 : 0);
  });
});

describe('exact filenames in replacement notes', () => {
  it.each(REPLACEMENTS)('$text', async ({ text, current }) => {
    const root = await estate({ 'CLAUDE.md': text });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.atoms.filter((atom) => atom.kind === 'reference').map((atom) => atom.fields?.path)).toEqual([
      current,
    ]);
  });
});
