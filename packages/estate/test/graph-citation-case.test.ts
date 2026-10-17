import { expect, it } from 'vitest';
import { AtomBuilder, buildGraph, ClaudeCodeReader } from '../src/index';
import { estate } from './support';

it.each(['follow r1', 'follow r#1', 'follow aB1', 'follow aB#1', 'record parcel r#1'])(
  'connects a rule citation irrespective of case: %s',
  async (citation) => {
    const definition = citation.includes('aB') ? 'AB1' : 'R1';
    const quotes = ['Never discard a parcel.', `Always ${citation} before dispatch.`];
    const root = await estate({ 'CLAUDE.md': `- **${definition}.** ${quotes[0]}\n- **R2.** ${quotes[1]}\n` });
    const raw = await new ClaudeCodeReader().read(root);
    const builder = new AtomBuilder(new Map(raw.files.map((file) => [file.path, file])));
    quotes.forEach((quote, i) => {
      builder.add({
        kind: 'instruction',
        title: `Fictional parcel rule ${i}`,
        at: { file: 'CLAUDE.md', startLine: i + 1, endLine: i + 1, quote },
        evidence: [{ type: 'custom', name: 'parcel-rule' }],
      });
    });
    expect(buildGraph(builder.atoms, raw).edges).toContainEqual({
      from: builder.atoms[1]?.id,
      to: builder.atoms[0]?.id,
      kind: 'cites',
    });
  },
);
