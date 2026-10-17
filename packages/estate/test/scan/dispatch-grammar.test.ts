import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';
import { grammarCases } from './dispatch-grammar-corpus';

describe('helper objects and recipients by grammatical kind', () => {
  it.each(grammarCases)('%s: %s => %s', async (_kind, sentence, expected) => {
    const root = await estate({
      '.claude/skills/reconcile/SKILL.md': `---\nname: reconcile\ndescription: Reconcile records.\n---\n${sentence}\n`,
      '.claude/agents/auditor.md': '---\nname: auditor\ndescription: Review records.\n---\n',
    });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.edges.some((edge) => edge.kind === 'dispatch')).toBe(expected);
  });
});
