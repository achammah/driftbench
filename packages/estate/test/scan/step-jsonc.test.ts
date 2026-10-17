import { rm } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader } from '../../src/index';
import { estate } from '../support';

async function read(text: string, suffix = 'jsonc') {
  const root = await estate({ [`.claude/routines.${suffix}`]: text });
  try {
    return await new ClaudeCodeReader().read(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('JSON step syntax with comments and trailing commas', () => {
  it('ignores line and block comments while locating declarations on original source lines', async () => {
    const text = [
      '// "id": "start" is documentation, not a declaration.',
      '{',
      '  "steps": [',
      '    /* "id": "start" */',
      '    { "id": "start", "next": ["end"] },',
      '    { "id": "end", "next": [] } // terminal',
      '  ]',
      '}',
    ].join('\n');
    const raw = await read(text);
    expect(raw.steps.map(({ id, next, at }) => [id, next, at.startLine])).toEqual([
      ['start', ['end'], 5],
      ['end', [], 6],
    ]);
    expect(raw.steps[1]?.at.quote).toBe('{ "id": "end", "next": [] } // terminal');
  });

  it('permits trailing object and array commas in JSON files', async () => {
    const raw = await read(
      '{ "steps": [{ "id": "start", "next": ["end",], }, { "id": "end", "next": [], },], }',
      'json',
    );
    expect(raw.steps.map(({ id, next }) => [id, next])).toEqual([
      ['start', ['end']],
      ['end', []],
    ]);
  });

  it('preserves comment markers, escaped quotes, Unicode and comma-close sequences inside strings', async () => {
    const title = '📦 https://fictional.invalid/a // text /* literal */ ,} ",]"';
    const text = `// Comment\n${JSON.stringify({ steps: [{ id: 'start', title, next: [] }] }, null, 2)}`;
    const raw = await read(text);
    expect(raw.steps).toHaveLength(1);
    expect(raw.steps[0]?.title).toBe(title);
    expect(raw.steps[0]?.at.startLine).toBe(5);
  });

  it('does not turn malformed JSON into a valid step file', async () => {
    for (const text of ['{"steps":[{"id":"start"}], broken}', '{"steps":[]} /* unterminated']) {
      const raw = await read(text);
      expect(raw.steps).toEqual([]);
    }
  });
  it('retains every declaration and successor through a long commented fictional inspection process', async () => {
    const count = 137;
    const lines = ['// Fictional inspection workflow', '{', '  "steps": ['];
    for (let index = 0; index < count; index++) {
      const id = `inspection-${index}`;
      const next = index + 1 < count ? [`inspection-${index + 1}`] : [];
      lines.push(`    // "id": "${id}" describes the next declaration.`);
      lines.push(`    ${JSON.stringify({ id, next })},`);
    }
    lines.push('  ],', '}');
    const raw = await read(lines.join('\n'));
    expect(raw.steps).toHaveLength(count);
    raw.steps.forEach((step, index) => {
      expect(step.id).toBe(`inspection-${index}`);
      expect(step.next).toEqual(index + 1 < count ? [`inspection-${index + 1}`] : []);
      expect(step.at.startLine).toBe(5 + index * 2);
      expect(step.at.quote).toBe(lines[4 + index * 2]?.trim());
    });
  });
});
