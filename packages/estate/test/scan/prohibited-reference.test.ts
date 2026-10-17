import { expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

const prohibitions = [
  'You cannot read',
  'You are not allowed to read',
  'Never, ever read',
  'You must never read',
  'You should not ever read',
  'You may not read',
  'You are forbidden to read',
  'You are prohibited from reading',
  'Reading is forbidden for',
  'Do not open',
  'You must not load',
  'You are not permitted to open',
  'You are unable to read',
  'Avoid reading',
  'Refrain from reading',
  "Don't ever read",
  'You ought not to read',
  'Under no circumstances may you read',
  'Do not attempt to read',
];
it.each(prohibitions)('does not load or create a positive reference for: %s', async (wording) => {
  const root = await estate({
    'CLAUDE.md': `# Fictional parcel\n${wording} \`confidential.txt\`.\n`,
    'confidential.txt': 'FICTIONAL CONFIDENTIAL PARCEL CONTENT\n',
  });
  const { raw, map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
  expect(raw.files.map((file) => file.path)).not.toContain('confidential.txt');
  expect(raw.prose.map((chunk) => chunk.file)).not.toContain('confidential.txt');
  expect(map.atoms.filter((atom) => atom.kind === 'reference')).toEqual([]);
});

const requirements = [
  'Never proceed without reading',
  'Do not answer without opening',
  'You must not finish unless you have read',
  'Never run the check before you read',
];
it.each(requirements)('still reads and cites a file that a double negative requires: %s', async (wording) => {
  const root = await estate({
    'CLAUDE.md': `# Fictional parcel\n${wording} \`rules.txt\`.\n`,
    'rules.txt': 'FICTIONAL PARCEL RULES\n',
  });
  const { raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
  expect(raw.files.map((file) => file.path)).toContain('rules.txt');
});

const plainReads = [
  'Read',
  'Always read',
  'Please read',
  'Open',
  'You must read',
  'Before you start, read',
  'You should open',
  'First load',
  'When asked for a price, read',
  'Make sure you read',
];
it.each(plainReads)('reads and cites a file that a plain instruction requires: %s', async (wording) => {
  const root = await estate({
    'CLAUDE.md': `# Fictional parcel\n${wording} \`rules.txt\`.\n`,
    'rules.txt': 'FICTIONAL PARCEL RULES\n',
  });
  const { raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
  expect(raw.files.map((file) => file.path)).toContain('rules.txt');
});

it('keeps a reference that a skill reads under a never-without-reading gate', async () => {
  const root = await estate({
    'CLAUDE.md': '# Fictional parcel\n',
    '.claude/skills/shelf-check/SKILL.md':
      '---\nname: shelf-check\ndescription: Checks shelves.\n---\nNever mark a shelf as checked without reading `references/rules.md`.\n',
    '.claude/skills/shelf-check/references/rules.md': '# Rules\nCount every box.\n',
  });
  const { raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
  expect(raw.files.map((file) => file.path)).toContain('.claude/skills/shelf-check/references/rules.md');
});
