import { rm } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

// The same rule written inside list items, bold, emphasis, table cells and rule labels, with remarks after
// it. Hand-written fictional wording; each core must give one gate in every setting, or none in every one.
async function gateQuotes(lines: string[], extra: Record<string, string> = {}) {
  const root = await estate({
    'CLAUDE.md': `${lines.join('\n\n')}\n`,
    'refs/choice-guide.md': '# Guide\n',
    ...extra,
  });
  try {
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    return map.atoms.filter((atom) => atom.kind === 'gate');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const wrappers: Array<(core: string) => string> = [
  (c) => `${c}.`,
  (c) => `- ${c}.`,
  (c) => `1. ${c}.`,
  (c) => `- [ ] ${c}.`,
  (c) => `> ${c}.`,
  (c) => `**${c}.**`,
  (c) => `_${c}._`,
  (c) => `- **R12.** ${c}.`,
  (c) => `**R12 — Foundation.** ${c}.`,
  (c) => `R12 (CRITICAL). ${c}.`,
  (c) => `!! ${c} !!`,
  (c) => `${c} — never skip this.`,
  (c) => `${c}, then run the check.`,
  (c) => `${c}; skipping it breaks the build.`,
  (c) => `${c} (see R#5 and the table below).`,
  (c) => `${c}: the rules differ per region.`,
  (c) => `${c}, never from memory.`,
  (c) => `Fan-out commit: ${c}.`,
  (c) => `| Check | ${c} |`,
];

const required = [
  'Read `refs/choice-guide.md` before committing ANY base',
  'Read refs/choice-guide.md before committing ANY base',
  'Read **refs/choice-guide.md** before committing ANY base',
  'Read Plan C before publishing',
  'Read **Plan C** before publishing',
  'Read Gate 0.5 before publishing',
  'Read Step 4 before publishing',
  'Read P3 before publishing',
  'Read Appendix B before publishing',
  'Read the current queue state before every send',
  'Read the live queue state before every send',
  'Read the ONE guide that OWNS that kind of change before editing',
  'Read the one guide which covers that kind of change before editing',
];

describe('a rule keeps its gate in any setting', () => {
  it('gives one gate per setting for every required wording', async () => {
    const lines = required.flatMap((core) => wrappers.map((wrap) => wrap(core)));
    const gates = await gateQuotes(lines);
    const missing = lines.filter(
      (line) => !gates.some((gate) => line.includes(gate.provenance.quote.replace(/^[-*>\d.\s[\]x]+/, ''))),
    );
    expect(missing).toEqual([]);
  });
});

describe('reading back one’s own writing is no read of a document', () => {
  const own = [
    'Read the sentence back before writing the next one',
    'Read your reply back before sending it',
    'Read your own draft before sending it',
    'Read the paragraph aloud before publishing',
    'Read it back before you edit the index',
  ];
  it('gives no gate in any setting', async () => {
    const lines = own.flatMap((core) => wrappers.map((wrap) => wrap(core)));
    expect(await gateQuotes(lines)).toEqual([]);
  });
});

describe('a bare SKILL.md means the skill the rule stands in', () => {
  it('resolves past a sample skill kept below the references folder', async () => {
    const skill = (name: string) => `---\nname: ${name}\ndescription: ${name}\n---\n`;
    const root = await estate({
      '.claude/skills/alpha/SKILL.md': `${skill('alpha')}Read SKILL.md before copying.\n`,
      '.claude/skills/alpha/references/sample/SKILL.md': `${skill('sample')}Sample.\n`,
      '.claude/skills/alpha/references/notes.md': 'Read SKILL.md before copying the template.\n',
    });
    try {
      const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
      const paths = map.atoms.filter((atom) => atom.kind === 'gate').map((atom) => atom.fields?.path);
      expect(paths).toEqual(['.claude/skills/alpha/SKILL.md', '.claude/skills/alpha/SKILL.md']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
