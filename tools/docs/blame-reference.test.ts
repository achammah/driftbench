import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BLAME_OUT, renderBlameReference, run } from './blame-reference';

describe('docs/reference/blame.md', () => {
  it('is current with the code', () => {
    expect(readFileSync(BLAME_OUT, 'utf8')).toBe(renderBlameReference());
  });

  it('lists every evidence name with its cost class', () => {
    const page = renderBlameReference();
    for (const name of ['source', 'ref_read', 'guard_caught', 'recurrence_homes', 'hint_pass']) {
      expect(page).toContain(`| \`${name}\` |`);
    }
    expect(page).toMatch(/\| `hint_pass` \| run \|/);
  });

  it('refuses an unknown argument', () => {
    const err: string[] = [];
    expect(run(['--write'], { out: () => undefined, err: (text) => err.push(text) })).toBe(2);
    expect(err[0]).toMatch(/unknown argument --write/);
  });
});
