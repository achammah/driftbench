import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  escapePointerToken,
  pointerOfPath,
  resolveStructure,
  StructureProvenance,
  type VariableStore,
  validateVariableStore,
  variableProvenance,
} from '../src/index';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const HASH = 'a'.repeat(64);

describe('structure provenance: a place in a JSON or YAML file, or a range of lines of a script', () => {
  it('accepts a JSON pointer with the hash of the value it names, or a line range with the hash of the lines', () => {
    for (const entry of [
      { kind: 'structure', path: '.claude/settings.json', pointer: '/permissions/deny/0', hash: HASH },
      { kind: 'structure', path: '.claude/settings.json', pointer: '', hash: HASH },
      { kind: 'structure', path: 'guards/lock.sh', lines: { start: 2, end: 2 }, hash: HASH },
      { kind: 'structure', path: 'guards/lock.sh', lines: { start: 2, end: 9 }, hash: HASH },
    ]) {
      expect(StructureProvenance.safeParse(entry).success, JSON.stringify(entry)).toBe(true);
    }
  });

  it.each([
    ['both a pointer and lines', { pointer: '/a', lines: { start: 1, end: 1 } }],
    ['neither a pointer nor lines', {}],
    ['a pointer that does not start with /', { pointer: 'permissions/deny' }],
    ['a pointer with a bad escape', { pointer: '/a~2b' }],
    ['a line range that starts at 0', { lines: { start: 0, end: 1 } }],
    ['a line range that ends before it starts', { lines: { start: 4, end: 3 } }],
    ['a line range with a fraction', { lines: { start: 1.5, end: 2 } }],
    ['an unknown key (no quote text is kept)', { pointer: '/a', quote: 'text' }],
  ])('refuses %s', (_name, extra) => {
    const entry = { kind: 'structure', path: 'a.json', hash: HASH, ...extra };
    expect(StructureProvenance.safeParse(entry).success).toBe(false);
  });

  it.each([
    ['a hash that is not 64 lowercase hexadecimal characters', { hash: 'ABC' }],
    ['no hash', { hash: undefined }],
    ['an absolute path', { path: '/etc/settings.json' }],
    ['a path with a backslash', { path: 'a\\b.json' }],
  ])('refuses %s', (_name, over) => {
    const entry = { kind: 'structure', path: 'a.json', pointer: '/a', hash: HASH, ...over };
    expect(StructureProvenance.safeParse(entry).success).toBe(false);
  });

  it('is a provenance a store may carry on a value, a boundary and a constraint, and variableProvenance lists it', () => {
    const entry = { kind: 'structure', path: 'a.json', pointer: '/limits/0', hash: HASH } as const;
    const store = {
      format: 1,
      agent: 'demo',
      version: '1',
      prior: { kind: 'declared' },
      variables: [
        {
          id: 'v',
          title: 'V',
          kind: 'data',
          role: 'detail',
          approved: true,
          values: [
            { id: 'low', title: 'Low', provenance: [entry] },
            { id: 'high', title: 'High', provenance: [entry] },
          ],
          boundaries: [{ holds: 'high', fails: 'low', edge: 'high', provenance: [entry] }],
        },
      ],
      constraints: [],
    } satisfies Partial<VariableStore>;
    const loaded = validateVariableStore(store);
    expect(loaded.ok, JSON.stringify(loaded.ok ? [] : loaded.errors)).toBe(true);
    if (loaded.ok) {
      expect(loaded.warnings).toEqual([]);
      expect(variableProvenance(loaded.store).map((e) => `${e.path} ${e.entry.kind}`)).toEqual([
        'variables.0.values.0.provenance.0 structure',
        'variables.0.values.1.provenance.0 structure',
        'variables.0.boundaries.0.provenance.0 structure',
      ]);
    }
  });
});

describe('JSON pointers', () => {
  it('writes a path of keys and indexes as a pointer, escaping ~ and /', () => {
    expect(pointerOfPath([])).toBe('');
    expect(pointerOfPath(['hooks', 'PreToolUse', 0, 'hooks', 1])).toBe('/hooks/PreToolUse/0/hooks/1');
    expect(pointerOfPath(['a/b', 'c~d', ''])).toBe('/a~1b/c~0d/');
    expect(escapePointerToken('x~/y')).toBe('x~0~1y');
  });
});

describe('resolveStructure: the hash of the place a provenance entry names', () => {
  const JSON_TEXT = JSON.stringify({
    permissions: { deny: ['Bash(rm *)', 'Bash(git push*)'], allow: ['Read'] },
    'a/b': { 'c~d': 7 },
    list: [{ n: 1 }, { n: 2 }],
  });

  it('hashes the canonical JSON of the value: keys sorted, no white space, so formatting and key order do not matter', () => {
    const resolved = resolveStructure(JSON_TEXT, { pointer: '/permissions' });
    expect(resolved).toEqual({
      ok: true,
      hash: sha('{"allow":["Read"],"deny":["Bash(rm *)","Bash(git push*)"]}'),
    });
    const reformatted =
      '{\n  "list": [],\n  "permissions": {\n    "allow": ["Read"],\n    "deny": ["Bash(rm *)", "Bash(git push*)"]\n  }\n}\n';
    expect(resolveStructure(reformatted, { pointer: '/permissions' })).toEqual(resolved);
  });

  it('resolves array indexes, escaped keys, the whole document, and a YAML file', () => {
    expect(resolveStructure(JSON_TEXT, { pointer: '/permissions/deny/1' })).toEqual({
      ok: true,
      hash: sha('"Bash(git push*)"'),
    });
    expect(resolveStructure(JSON_TEXT, { pointer: '/a~1b/c~0d' })).toEqual({ ok: true, hash: sha('7') });
    // ~01 is the two characters ~1, not a slash: ~1 is decoded before ~0.
    expect(resolveStructure('{"x~1y": 5, "x/y": 6}', { pointer: '/x~01y' })).toEqual({
      ok: true,
      hash: sha('5'),
    });
    expect(resolveStructure('{"x~1y": 5, "x/y": 6}', { pointer: '/x~1y' })).toEqual({
      ok: true,
      hash: sha('6'),
    });
    expect(resolveStructure(JSON_TEXT, { pointer: '/list/1' })).toEqual({ ok: true, hash: sha('{"n":2}') });
    expect(resolveStructure('a: 1\nb:\n  - x\n  - y\n', { pointer: '/b/1' })).toEqual({
      ok: true,
      hash: sha('"y"'),
    });
    expect(resolveStructure('{"k": 1}', { pointer: '' })).toEqual({ ok: true, hash: sha('{"k":1}') });
  });

  it.each([
    ['a key that is not there', '/permissions/ask'],
    ['an index past the end', '/permissions/deny/2'],
    ['an index that is not a number', '/permissions/deny/first'],
    ['an index with a leading zero', '/permissions/deny/01'],
    ['a step into a string', '/permissions/deny/0/x'],
    ['a key of an array', '/list/n'],
  ])('does not resolve %s', (_name, pointer) => {
    const resolved = resolveStructure(JSON_TEXT, { pointer });
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.message).toContain(pointer);
  });

  it('does not resolve a pointer in text that is not JSON or YAML', () => {
    const resolved = resolveStructure('{"a": [1, 2', { pointer: '/a' });
    expect(resolved.ok).toBe(false);
  });

  it('hashes a range of lines exactly, with line breaks as \\n, and does not resolve a range past the end', () => {
    const script = '#!/bin/sh\n# Lock the hall.\nif [ -z "$X" ]; then\n  echo locked\nfi\n';
    expect(resolveStructure(script, { lines: { start: 2, end: 2 } })).toEqual({
      ok: true,
      hash: sha('# Lock the hall.'),
    });
    expect(resolveStructure(script, { lines: { start: 3, end: 5 } })).toEqual({
      ok: true,
      hash: sha('if [ -z "$X" ]; then\n  echo locked\nfi'),
    });
    expect(resolveStructure(script.replace(/\n/g, '\r\n'), { lines: { start: 3, end: 5 } })).toEqual({
      ok: true,
      hash: sha('if [ -z "$X" ]; then\n  echo locked\nfi'),
    });
    for (const lines of [
      { start: 6, end: 6 },
      { start: 4, end: 9 },
    ]) {
      const resolved = resolveStructure(script, { lines });
      expect(resolved.ok, JSON.stringify(lines)).toBe(false);
    }
  });
});
