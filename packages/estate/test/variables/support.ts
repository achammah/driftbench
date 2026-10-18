import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Atom, EstateMap } from '../../src/schema';

/** Invented: a boat hall with a keeper, keys and moorings. Nothing here comes from a real estate. */
export const HALL: Record<string, string> = {
  'CLAUDE.md': [
    '# Boat hall',
    '',
    '- Name the keeper of every boat before it leaves the hall.',
    '- Warn the keeper when a mooring is overdue, and offer a reminder.',
    '',
    'Never hand out a key without a signature. Lock the hall when the last boat is out.',
    '',
  ].join('\n'),
  '.claude/settings.json': [
    '{',
    '  "model": "boat-1",',
    '  "hooks": {',
    '    "PreToolUse": [',
    '      {',
    '        "matcher": "Bash",',
    '        "hooks": [',
    '          { "type": "command", "command": "sh .claude/guards/lock.sh", "timeout": 5 }',
    '        ]',
    '      }',
    '    ]',
    '  },',
    '  "permissions": {',
    '    "allow": ["Read", "Bash(sh scripts/*)"],',
    '    "deny": ["Bash(rm *)"]',
    '  }',
    '}',
    '',
  ].join('\n'),
  '.claude/guards/lock.sh': [
    '#!/bin/sh',
    '# Lock the hall when the last boat is out.',
    'if [ "$LAST_BOAT" = "out" ]; then',
    '  echo locked',
    'fi',
    '',
  ].join('\n'),
  '.claude/steps.yaml': ['steps:', '  - plan', '  - do', '  - verify', ''].join('\n'),
};

export async function hallFolder(files: Record<string, string> = HALL): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'driftbench-variables-'));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

/** The 1-based line span of the first line of `file` that holds `quote` (the quote may span lines). */
export function spanOf(file: string, quote: string, files: Record<string, string> = HALL) {
  const text = files[file] as string;
  const first = quote.split('\n')[0] as string;
  const lines = text.split('\n');
  const startLine = lines.findIndex((line) => line.includes(first)) + 1;
  if (startLine === 0) throw new Error(`no line of ${file} holds ${first}`);
  return { startLine, endLine: startLine + quote.split('\n').length - 1 };
}

let serial = 0;

/** An atom as the estate map holds it, placed on the lines of `file` that hold `quote`. */
export function atom(over: {
  kind?: Atom['kind'];
  file?: string;
  quote: string;
  title?: string;
  role?: Atom['role'];
  approved?: boolean;
  producedBy?: Atom['producedBy'];
  situation?: string;
  fields?: Record<string, unknown>;
  span?: { startLine: number; endLine: number };
  files?: Record<string, string>;
}): Atom {
  serial += 1;
  const file = over.file ?? 'CLAUDE.md';
  const span = over.span ?? spanOf(file, over.quote, over.files);
  return {
    id: `${over.kind ?? 'instruction'}.hall.atom-${serial}`,
    kind: over.kind ?? 'instruction',
    title: over.title ?? `Atom ${serial}`,
    provenance: { file, ...span, quote: over.quote, hash: `hash-${serial}` },
    producedBy: over.producedBy ?? 'model',
    role: over.role ?? 'axis',
    approved: over.approved ?? true,
    ...(over.situation === undefined ? {} : { situation: over.situation }),
    evidence: [{ type: 'text', must: ['x'] }],
    enforcement: [],
    ...(over.fields === undefined ? {} : { fields: over.fields }),
  } as Atom;
}

export function mapOf(atoms: Atom[]): EstateMap {
  return {
    version: 1,
    runtime: 'claude-code',
    root: '.',
    readAt: '2026-10-18T00:00:00.000Z',
    atoms,
    edges: [],
    hash: 'f'.repeat(64),
  } as unknown as EstateMap;
}
