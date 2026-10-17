import { rm } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, lintEstate, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

// A guard source may declare its verdict on a line of its own ("Verdict: deny"), like "Enforces: R3".
// The registry row wins when there is one; the declaration is used only without a row, and it never
// makes a missing registry row acceptable. Fictional guards.
const SETTINGS = JSON.stringify({
  hooks: {
    Stop: [{ hooks: [{ type: 'command', command: 'python3 "$CLAUDE_PROJECT_DIR"/.claude/guards/tone.py' }] }],
  },
});
const REGISTRY =
  '| Id | Guard | Event | Enforces | Verdict |\n|---|---|---|---|---|\n| G1 | tone.py | Stop | R1 | warn |\n';

async function scan(files: Record<string, string>) {
  const root = await estate({ 'CLAUDE.md': '# Rules\n', '.claude/settings.json': SETTINGS, ...files });
  try {
    const { map, raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    const guard = map.atoms.find((atom) => atom.kind === 'guard');
    return {
      evidence: guard?.evidence,
      fields: guard?.fields,
      findings: lintEstate(map, raw).findings,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const SCRIPT = (verdict: string) =>
  `"""Checks the tone of a reply.\n\nVerdict: ${verdict}\n"""\nprint("ok")\n`;

describe('a guard source declares its verdict', () => {
  it.each(['deny', 'block', 'warn', 'nudge', 'DENY'])(
    'reads Verdict: %s when there is no registry row',
    async (verdict) => {
      const found = await scan({ '.claude/guards/tone.py': SCRIPT(verdict) });
      expect(found.evidence).toEqual([{ type: 'guard', name: 'tone.py', verdict: verdict.toLowerCase() }]);
      expect(found.fields?.verdictFrom).toBe('source');
    },
  );

  it('reads the declaration from a comment', async () => {
    const found = await scan({ '.claude/guards/tone.py': '# Verdict: deny\nprint("ok")\n' });
    expect(found.evidence).toEqual([{ type: 'guard', name: 'tone.py', verdict: 'deny' }]);
  });

  it('ignores a verdict that is not on a line of its own', async () => {
    const found = await scan({
      '.claude/guards/tone.py': 'print("Verdict: deny")\n# the Verdict: deny rule is old\n',
    });
    expect(found.evidence).toEqual([{ type: 'guard', name: 'tone.py' }]);
  });

  it('lets the registry row win over the source', async () => {
    const found = await scan({
      '.claude/guards/tone.py': SCRIPT('deny'),
      '.claude/guards/CHECK-REGISTRY.md': REGISTRY,
    });
    expect(found.evidence).toEqual([{ type: 'guard', name: 'tone.py', verdict: 'warn' }]);
    expect(found.fields?.verdictFrom).toBeUndefined();
  });

  it('still flags the missing registry row', async () => {
    // A registry exists and lists another guard only: tone.py has no row, whatever its source declares.
    const found = await scan({
      '.claude/guards/tone.py': SCRIPT('deny'),
      '.claude/guards/CHECK-REGISTRY.md': REGISTRY.replace('tone.py', 'other.py'),
    });
    expect(found.evidence).toEqual([{ type: 'guard', name: 'tone.py', verdict: 'deny' }]);
    expect(found.findings.some((finding) => finding.code === 'REGISTRY_ROW')).toBe(true);
  });
});
