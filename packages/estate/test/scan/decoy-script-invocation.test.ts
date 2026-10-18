import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

const skill = '.claude/skills/count/SKILL.md';
const script = '.claude/skills/count/scripts/count.py';
async function scripts(lines: string[]) {
  const root = await estate({
    [skill]: ['---', 'name: count', '---', ...lines].join('\n'),
    [script]: '#!/usr/bin/env python3\nprint(1)\n',
  });
  const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
  return map.atoms.filter((atom) => atom.kind === 'script');
}

describe('script provenance follows an invocation', () => {
  it('passes an obsolete mention and anchors the actual instruction', async () => {
    const quote = 'Run `python3 scripts/count.py ITEM` and retain the result.';
    const found = await scripts(['The old count.py was slow.', quote]);
    expect(found).toHaveLength(1);
    expect(found[0]?.provenance).toMatchObject({ file: skill, startLine: 5, quote });
    expect(found[0]?.fields?.named).toBe(true);
  });
  it.each([
    'The utility `count.py` used to exist.',
    'Never run `python3 scripts/count.py`.',
    'Run `python3 scripts/recount.py`.',
  ])('keeps the discovered script when no instruction invokes it: %s', async (line) => {
    const found = await scripts([line]);
    expect(found).toHaveLength(1);
    expect(found[0]?.provenance.file).toBe(script);
    expect(found[0]?.fields?.named).toBe(false);
  });
  it.each([
    'Run another.py, then document count.py.',
    'Run `python3 scripts/another.py count.py`.',
    'Run `scripts/another.py count.py`.',
    'count.py was used by a retired process.',
  ])('does not bind an invocation to an incidental filename: %s', async (line) => {
    const found = await scripts([line]);
    expect(found[0]?.fields?.named).toBe(false);
    expect(found[0]?.provenance.file).toBe(script);
  });
  it('finds the actual invocation in a later clause', async () => {
    const quote = 'Run another.py, then execute `python3 -u scripts/count.py ITEM`.';
    const found = await scripts([quote]);
    expect(found[0]?.fields?.named).toBe(true);
    expect(found[0]?.provenance).toMatchObject({ file: skill, quote });
  });
  it('does not confuse inline interpreter text with a script file', async () => {
    const found = await scripts(['Run `python3 -c count.py`.']);
    expect(found[0]?.fields?.named).toBe(false);
  });
  it('preserves an argument instruction with a concrete command example', async () => {
    const quote = 'Always pass the identifier to count.py, as in `./scripts/count.py ITEM`.';
    const found = await scripts([quote]);
    expect(found[0]?.provenance).toMatchObject({ file: skill, quote });
    expect(found[0]?.fields?.named).toBe(true);
  });

  it.each([
    'Close the day with [the closer](scripts/count.py).',
    'Run `bash scripts/other.sh` first and `python3 scripts/count.py` last.',
    'Use `scripts/count.py` to tally the boxes.',
  ])('anchors a link to the script and a coordinated command: %s', async (quote) => {
    const root = await estate({
      [skill]: ['---', 'name: count', '---', quote].join('\n'),
      [script]: '#!/usr/bin/env python3\nprint(1)\n',
      '.claude/skills/count/scripts/other.sh': '#!/bin/sh\n',
    });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    const found = map.atoms.find((atom) => atom.kind === 'script' && atom.fields?.path === script);
    expect(found?.provenance).toMatchObject({ file: skill, quote });
  });
  it('anchors no script on a link the line forbids', async () => {
    const found = await scripts(['Never use [the old counter](scripts/count.py).']);
    expect(found[0]?.provenance.file).toBe(script);
  });
});
