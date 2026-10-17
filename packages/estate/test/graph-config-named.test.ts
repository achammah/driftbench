import { expect, it } from 'vitest';
import { analyzeGraph } from '../src/graph/analyze';
import { ClaudeCodeReader, scanEstate } from '../src/index';
import { estate, NOW } from './support';

it('names the estate configuration and the files it writes, and still reports a stray file', async () => {
  const root = await estate({
    'CLAUDE.md': '# Parcels\n',
    '.claude/driftbench.estate.yaml': 'helpers:\n  weigher:\n    command: [python3, .claude/stand-in.py]\n',
    '.claude/stand-in.py': 'print("ok")\n',
    '.claude/stray.py': 'print("nothing names me")\n',
  });
  const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
  const invariant = map.atoms.find((atom) => atom.fields?.check === 'no_orphans');
  expect(invariant?.fields?.orphans).toEqual(['.claude/stray.py']);
  const raw = await new ClaudeCodeReader().read(root);
  const lintable = analyzeGraph(map.atoms, map.edges, raw.files);
  expect(lintable.unreachableFiles).toEqual([]);
});
