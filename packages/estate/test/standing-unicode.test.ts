import { rm } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, lintEstate, scanEstate } from '../src/index';
import { measureInvariants } from '../src/scan/invariants';
import { estate, NOW } from './support';

describe('standing size counts Unicode characters', () => {
  it('counts supplementary code points once while preserving combining marks as characters', async () => {
    const text = 'a📦e\u0301\n';
    const root = await estate({ 'CLAUDE.md': text });
    try {
      const raw = await new ClaudeCodeReader().read(root);
      expect(measureInvariants(raw, [], 5).standingCharacters).toBe(5);
      const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
      expect(
        map.atoms.find((a) => a.kind === 'invariant' && a.fields?.check === 'standing_size')?.fields
          ?.characters,
      ).toBe(5);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('applies the same exact boundary across standing and memory documents', async () => {
    const root = await estate({
      'CLAUDE.md': '# Shipping 📦\n',
      '.claude/memory/locale.md': 'Reply in français.\n',
      '.claude/skills/dispatch/SKILL.md': '---\nname: dispatch\ndescription: Arrange delivery.\n---\n📦📦📦',
    });
    try {
      const { map, raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
      const characters = 32;
      expect(measureInvariants(raw, [], characters).standingCharacters).toBe(characters);
      expect(lintEstate(map, raw, { ceiling: characters }).counts.OVERSIZE).toBe(0);
      expect(lintEstate(map, raw, { ceiling: characters - 1 }).counts.OVERSIZE).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
