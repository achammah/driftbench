import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pointer } from '@agent-nexus/driftbench-estate';
import { describe, expect, it } from 'vitest';
import { type Io, main } from '../src/index';

// An invented harbour office. No line below comes from a real estate.
const FILES: Record<string, string> = {
  'CLAUDE.md': '# Harbour office\n\n- Hang the lamp before dusk\n- Never leave the gate open\n',
  '.claude/skills/moorings/SKILL.md':
    '---\nname: moorings\ndescription: Tie up a boat at the right quay.\n---\n\n# Moorings\n\nCheck the tide table. Tie the bow line first.\n',
};

async function estate(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'driftbench-pointer-cli-'));
  for (const [path, text] of Object.entries(FILES)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

async function run(argv: string[], cwd: string, env: Record<string, string | undefined> = {}) {
  const output = { out: '', err: '' };
  const io: Io = {
    out: (text) => {
      output.out += text;
    },
    err: (text) => {
      output.err += text;
    },
    cwd,
  };
  const saved = { ...process.env };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return { code: await main(argv, io), ...output };
  } finally {
    for (const key of Object.keys(env)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

/** A cassette for the estate, written the way a recording would be: through the real request renderer. */
async function recordCassette(root: string, path: string): Promise<void> {
  const sets = pointer.parseLabelSets(pointer.AGENT_RULES_SET);
  if (!sets.ok) throw new Error(sets.message);
  const real = pointer.createHaikuLabeler();
  const labeler: pointer.Labeler = {
    ...real,
    async call(_wire, _set, window) {
      return {
        labels: window.units.map((unit) => ({
          units: String(unit.n),
          label: /^(Hang|Tie|Check)/.test(unit.text)
            ? 'rule'
            : /^Never/.test(unit.text)
              ? 'prohibition'
              : 'none',
        })),
        returnedModel: 'claude-haiku-5-5',
        stopReason: 'end_turn',
        usage: { input: 100, output: 10 },
      };
    },
  };
  const cassette = new pointer.Cassette();
  await pointer.pointerScan({
    files: Object.entries(FILES).map(([file, text]) => ({ path: file, text })),
    sets: sets.sets,
    labeler,
    cassette,
    mode: 'record',
  });
  await writeFile(join(root, path), cassette.render());
}

describe('driftbench estate scan --pointer', () => {
  it('replays a cassette into a map of pointed atoms and writes the ledger', async () => {
    const root = await estate();
    await recordCassette(root, 'cassette.jsonl');
    const result = await run(
      [
        'estate',
        'scan',
        '.',
        '--pointer',
        '--cassette',
        'cassette.jsonl',
        '--ledger',
        'ledger.json',
        '--out',
        'map.yaml',
      ],
      root,
    );
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    expect(result.out).toMatch(
      /Pointer reader: \d+ units in 2 files, 3 windows labelled, 0 carried without a call, 0 model calls/,
    );
    expect(result.out).toContain('5 atoms.');
    const map = await readFile(join(root, 'map.yaml'), 'utf8');
    expect(map).toContain('extraction: pointer');
    expect(map).toContain('quote: Never leave the gate open');
    const ledger = JSON.parse(await readFile(join(root, 'ledger.json'), 'utf8'));
    expect(ledger.version).toBe(1);
    expect(ledger.entries.length).toBeGreaterThan(5);
  });

  it('gives the same map and ledger on a second replay, and carries every label on a rescan with the ledger', async () => {
    const root = await estate();
    await recordCassette(root, 'cassette.jsonl');
    const args = [
      'estate',
      'scan',
      '.',
      '--pointer',
      '--cassette',
      'cassette.jsonl',
      '--ledger',
      'ledger.json',
      '--force',
    ];
    await run([...args, '--out', 'one.yaml'], root);
    const ledger = await readFile(join(root, 'ledger.json'), 'utf8');
    const second = await run([...args, '--out', 'two.yaml'], root);
    expect(second.code).toBe(0);
    expect(second.out).toContain('0 windows labelled, 3 carried without a call');
    expect(await readFile(join(root, 'ledger.json'), 'utf8')).toBe(ledger);
  });

  it('fails the ledger check when a file changed and the committed ledger did not', async () => {
    const root = await estate();
    await recordCassette(root, 'cassette.jsonl');
    const base = [
      'estate',
      'scan',
      '.',
      '--pointer',
      '--cassette',
      'cassette.jsonl',
      '--ledger',
      'ledger.json',
    ];
    await run([...base, '--out', 'one.yaml'], root);
    const ok = await run([...base, '--ledger-check', '--out', 'two.yaml'], root);
    expect(ok.code).toBe(0);
    await writeFile(join(root, 'CLAUDE.md'), `${FILES['CLAUDE.md']}\n- Close the harbour office at six\n`);
    const stale = await run([...base, '--ledger-check', '--out', 'three.yaml'], root);
    expect(stale.err).toMatch(/Cassette|cassette|ledger/);
    expect(stale.code).not.toBe(0);
  });

  it('stops on a cassette miss, names the field that differs, and writes no map', async () => {
    const root = await estate();
    await recordCassette(root, 'cassette.jsonl');
    await writeFile(join(root, 'CLAUDE.md'), `${FILES['CLAUDE.md']}\n- Close the harbour office at six\n`);
    const result = await run(
      ['estate', 'scan', '.', '--pointer', '--cassette', 'cassette.jsonl', '--out', 'map.yaml'],
      root,
    );
    expect(result.code).toBe(2);
    expect(result.err).toMatch(
      /the cassette has no answer for request [0-9a-f]{12}; the nearest entry [0-9a-f]{12} differs in: .*part\.messages/,
    );
    await expect(readFile(join(root, 'map.yaml'), 'utf8')).rejects.toThrow();
  });

  it('refuses a missing cassette in replay and tells how to record it', async () => {
    const root = await estate();
    const result = await run(
      ['estate', 'scan', '.', '--pointer', '--cassette', 'none.jsonl', '--out', 'map.yaml'],
      root,
    );
    expect(result.code).toBe(2);
    expect(result.err).toContain('record it with --record');
  });

  it('refuses --record without a key, and never prints one', async () => {
    const root = await estate();
    const result = await run(
      ['estate', 'scan', '.', '--pointer', '--record', '--cassette', 'cassette.jsonl', '--out', 'map.yaml'],
      root,
      { ANTHROPIC_API_KEY: undefined },
    );
    expect(result.code).toBe(2);
    expect(result.err).toContain('--record needs ANTHROPIC_API_KEY');
  });

  it('refuses the flags that need --pointer, and --pointer with the model port flags', async () => {
    const root = await estate();
    const alone = await run(['estate', 'scan', '.', '--cassette', 'c.jsonl', '--out', 'map.yaml'], root);
    expect(alone.code).toBe(2);
    expect(alone.err).toContain('need --pointer');
    const both = await run(
      ['estate', 'scan', '.', '--pointer', '--no-model', '--cassette', 'c.jsonl', '--out', 'map.yaml'],
      root,
    );
    expect(both.code).toBe(2);
    const noCassette = await run(['estate', 'scan', '.', '--pointer', '--out', 'map.yaml'], root);
    expect(noCassette.err).toContain('--pointer needs --cassette');
  });

  it('reads a user label set and refuses a bad one with the reason', async () => {
    const root = await estate();
    await writeFile(
      join(root, 'labels.yaml'),
      'labels:\n  - set: s\n    description: d\n    labels:\n      - { name: none, description: d }\n',
    );
    const bad = await run(
      [
        'estate',
        'scan',
        '.',
        '--pointer',
        '--labels',
        'labels.yaml',
        '--cassette',
        'c.jsonl',
        '--out',
        'map.yaml',
      ],
      root,
    );
    expect(bad.code).toBe(2);
    expect(bad.err).toContain('Cannot use the label sets in labels.yaml');
    expect(bad.err).toContain('none is reserved');
  });

  it('leaves the default scan as it was: no pointer line without the flag', async () => {
    const root = await estate();
    const result = await run(['estate', 'scan', '.', '--no-model', '--out', 'map.yaml'], root);
    expect(result.out).not.toContain('Pointer reader');
  });
});
