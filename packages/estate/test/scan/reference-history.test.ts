import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';
import { HISTORY_CASES } from './history-corpus';

describe('file history follows each occurrence and its grammatical role', () => {
  it.each(HISTORY_CASES)('$kind: $text', async ({ text, paths }) => {
    const root = await estate({ 'CLAUDE.md': text });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    const found = new Set(
      map.atoms.filter((atom) => atom.kind === 'reference').map((atom) => atom.fields?.path),
    );
    expect([...found].sort()).toEqual([...paths].sort());
  });
});
