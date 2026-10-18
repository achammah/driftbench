import { expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate } from '../support';

it('finishes a large scan of punctuation-heavy prose and retains valid rules after it', async () => {
  let state = 987654321;
  const symbols = [
    '(',
    ')',
    '[',
    ']',
    '{',
    '}',
    '.',
    '*',
    '+',
    '?',
    '^',
    '$',
    '|',
    '\\',
    '"',
    "'",
    '😀',
    '東京',
    'مرحبا',
    '`x+y`',
  ];
  const lines = [
    '# Rules',
    '',
    "Every command's failure (exit code + stderr) reaches you.",
    'Every run (exit 1) is logged.',
  ];
  for (let index = 0; index < 4000; index++) {
    let payload = '';
    for (let count = 0; count < 32; count++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      payload += symbols[state % symbols.length];
    }
    lines.push(`Every entry (${payload}) must retain its source.`, '');
  }
  // Reset Markdown quoting/fence state in a new file, so fuzz payloads cannot consume this rule.
  const root = await estate({
    'CLAUDE.md': lines.join('\n'),
    '.claude/skills/verify/SKILL.md': '---\nname: verify\n---\nThe helper must verify the manifest.\n',
  });
  const result = await scanEstate({ root, reader: new ClaudeCodeReader() });
  expect(
    result.map.atoms.some(
      (atom) => atom.provenance.quote === "Every command's failure (exit code + stderr) reaches you.",
    ),
  ).toBe(true);
  expect(result.map.atoms.some((atom) => atom.provenance.quote === 'Every run (exit 1) is logged.')).toBe(
    true,
  );
  expect(
    result.map.atoms.some((atom) => atom.provenance.quote === 'The helper must verify the manifest.'),
  ).toBe(true);
  expect(result.map.hash).toBeTruthy();
}, 60_000);
