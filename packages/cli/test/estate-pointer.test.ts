import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pointer } from '@agent-nexus/driftbench-estate';
import type { FetchLike } from '@agent-nexus/driftbench-generate';
import { describe, expect, it } from 'vitest';
import { estateScanCommand } from '../src/commands/estate';
import { type Io, main } from '../src/index';

// An invented harbour office. No line below comes from a real estate.
const FILES: Record<string, string> = {
  'CLAUDE.md':
    '# Harbour office\n\n- Hang the lamp before dusk\n- Never leave the gate open\n- Close the gate at night\n',
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

function capture(cwd: string) {
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
  return { io, output };
}

async function run(argv: string[], cwd: string, env: Record<string, string | undefined> = {}) {
  const { io, output } = capture(cwd);
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

/** The text of the units in a request: the `[n] text` lines of its numbered window. */
function unitsOf(text: string): Array<[number, string]> {
  return [...text.matchAll(/^\[(\d+)\] (.*)$/gm)].map((match) => [Number(match[1]), match[2] ?? '']);
}

/**
 * The two services, as one fetch: the system 1 service is sure of an imperative line and sure of nothing
 * else, and the system 2 service calls a line with "Never" a prohibition and any other imperative a rule.
 */
const imperative = /^(Hang|Never|Tie|Check|Close)/;
const services: FetchLike = async (url, init) => {
  const body = JSON.parse(String(init.body)) as Record<string, unknown>;
  const json = (value: unknown) =>
    new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
  if (url.includes('systemone')) {
    const text = String((body.state as { text: string }).text);
    const lines = new Map(unitsOf(text));
    const answers: Record<string, { noul: number }> = {};
    for (const key of Object.keys(body.questions as object)) {
      const [, n, label] = /^u(\d+)__(.+)$/.exec(key) ?? [];
      const line = lines.get(Number(n)) ?? '';
      // Sure of a prohibition for "Never" and of a rule for a clear imperative, unsure of "Close", sure of
      // nothing for the rest.
      const wanted = line.startsWith('Never') ? 'prohibition' : 'rule';
      const p = label === wanted && imperative.test(line) ? (line.startsWith('Close') ? 0.4 : 0.9) : 0.02;
      answers[key] = { noul: p };
    }
    return json({ model: 'jev-fake', answers, usage: { input_tokens: 1000, output_tokens: 10 } });
  }
  const content = (body.messages as Array<{ content: string }>)[0]?.content ?? '';
  const labels = unitsOf(content).map(([n, line]) => ({
    units: String(n),
    label: /^Never/.test(line) ? 'prohibition' : imperative.test(line) ? 'rule' : 'none',
  }));
  return json({
    model: 'claude-haiku-5-5',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify({ labels }) }],
    usage: { input_tokens: 500, output_tokens: 50 },
  });
};

const KEYS = { JEV_API_KEY: 'jev-secret', JEV_ROUTE: 'typesafe', ANTHROPIC_API_KEY: 'anthropic-secret' };

/** Records the cassette of the default stack through the command, with the fake services. */
async function record(root: string, over: string[] = []) {
  const { io, output } = capture(root);
  const code = await estateScanCommand(
    '.',
    {
      out: 'recorded.yaml',
      pointer: true,
      cassette: 'cassette.jsonl',
      record: true,
      ledger: 'ledger.json',
      jobs: '3',
      ...(over.length ? { labeler: over } : {}),
    },
    io,
    { env: KEYS, fetch: services },
  );
  return { code, ...output };
}

describe('driftbench estate scan --pointer', () => {
  it('records the default stack with the two services, then replays it with no key', async () => {
    const root = await estate();
    const recorded = await record(root);
    expect(recorded.err).toBe('');
    expect(recorded.code).toBe(0);
    // The plan comes before the first request, then the counts, the classes that decided and the tokens.
    expect(recorded.out).toMatch(/Pointer plan: 9 units in 2 files, 0 already labelled by the ledger\./);
    expect(recorded.out).toMatch(
      /system 1 jev jev-latest: 3 requests, 0 in the cassette, \d+ characters to send\./,
    );
    expect(recorded.out).toMatch(/system 2 anthropic claude-haiku-5-5: 3 requests, 0 in the cassette/);
    expect(recorded.out).toContain(
      'Pointer reader: system 1 jev jev-latest then system 2 anthropic claude-haiku-5-5',
    );
    expect(recorded.out).toMatch(
      /Units: 9 in 2 files; 0 kept from the ledger, 9 labelled by this run \(\d+ by system 1, \d+ by system 2\)/,
    );
    expect(recorded.out).toContain('Tokens, system 1 jev jev-latest: 3000 in, 30 out, 3 requests sent.');
    expect(recorded.out).toContain(
      'Tokens, system 2 anthropic claude-haiku-5-5: 1500 in, 150 out, 3 requests sent.',
    );
    const cassette = pointer.Cassette.parse(await readFile(join(root, 'cassette.jsonl'), 'utf8'));
    expect(cassette.entries.size).toBe(6);
    // The file on disk is the sorted one, whatever the order the answers arrived in.
    expect(await readFile(join(root, 'cassette.jsonl'), 'utf8')).toBe(cassette.render());

    const replay = await run(
      ['estate', 'scan', '.', '--pointer', '--cassette', 'cassette.jsonl', '--out', 'replayed.yaml'],
      root,
      { JEV_API_KEY: undefined, ANTHROPIC_API_KEY: undefined },
    );
    expect(replay.err).toBe('');
    expect(replay.code).toBe(0);
    expect(replay.out).toContain('0 sent, 0 recorded.');
    expect(await readFile(join(root, 'replayed.yaml'), 'utf8')).toContain('extraction: pointer');
  });

  it('builds atoms from the labels the classes decided, quoting the file', async () => {
    const root = await estate();
    await record(root);
    const map = await readFile(join(root, 'recorded.yaml'), 'utf8');
    expect(map).toContain('quote: Hang the lamp before dusk');
    expect(map).toContain('quote: Never leave the gate open');
    // "Close" is inside system 1's band, so system 2 decided it.
    expect(map).toContain('quote: Close the gate at night');
    expect(map).toContain('polarity: prohibition');
    const ledger = JSON.parse(await readFile(join(root, 'ledger.json'), 'utf8'));
    const close = ledger.entries.find((entry: { quote: string }) => entry.quote.startsWith('Close'));
    expect(close.labels['agent-rules']).toMatchObject({ label: 'rule', by: 'system2' });
    const never = ledger.entries.find((entry: { quote: string }) => entry.quote.startsWith('Never'));
    expect(never.labels['agent-rules']).toMatchObject({ by: 'system1' });
  });

  it('runs one class alone, and the stack from the same cassette', async () => {
    const root = await estate();
    await record(root);
    const alone = await run(
      [
        'estate',
        'scan',
        '.',
        '--pointer',
        '--cassette',
        'cassette.jsonl',
        '--labeler',
        'system2:anthropic',
        '--out',
        'two.yaml',
      ],
      root,
    );
    expect(alone.code).toBe(0);
    expect(alone.out).toContain('Pointer reader: system 2 anthropic claude-haiku-5-5.');
    expect(alone.out).toMatch(/0 by system 1, \d+ by system 2/);
  });

  it('keeps every label of the ledger on a rescan and asks for none', async () => {
    const root = await estate();
    await record(root);
    const again = await run(
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
        'again.yaml',
        '--force',
      ],
      root,
    );
    expect(again.code).toBe(0);
    expect(again.out).toMatch(/Units: 9 in 2 files; 9 kept from the ledger, 0 labelled by this run/);
    expect(again.out).toContain('Requests: 0 answered, 0 sent, 0 recorded.');
  });

  it('re-labels the units when the bounds change, from the same cassette', async () => {
    const root = await estate();
    await record(root);
    const wide = await run(
      [
        'estate',
        'scan',
        '.',
        '--pointer',
        '--cassette',
        'cassette.jsonl',
        '--ledger',
        'ledger.json',
        '--labeler-pass-at',
        '1',
        '--labeler-fail-at',
        '0',
        '--out',
        'wide.yaml',
        '--force',
      ],
      root,
    );
    expect(wide.code).toBe(0);
    expect(wide.out).toMatch(
      /0 kept from the ledger, 9 labelled by this run \(0 by system 1, 9 by system 2\)/,
    );
  });

  it('fails the ledger check when a file changed and the committed ledger did not', async () => {
    const root = await estate();
    await record(root);
    const base = [
      'estate',
      'scan',
      '.',
      '--pointer',
      '--cassette',
      'cassette.jsonl',
      '--ledger',
      'ledger.json',
      '--ledger-check',
      '--force',
    ];
    expect((await run([...base, '--out', 'one.yaml'], root)).code).toBe(0);
    await writeFile(join(root, 'CLAUDE.md'), `${FILES['CLAUDE.md']}\n- Close the harbour office at six\n`);
    const stale = await run([...base, '--out', 'two.yaml'], root);
    expect(stale.code).not.toBe(0);
  });

  it('stops on a cassette miss, names the field that differs, and writes no map', async () => {
    const root = await estate();
    await record(root);
    await writeFile(join(root, 'CLAUDE.md'), `${FILES['CLAUDE.md']}\n- Close the harbour office at six\n`);
    const result = await run(
      ['estate', 'scan', '.', '--pointer', '--cassette', 'cassette.jsonl', '--out', 'missed.yaml'],
      root,
    );
    expect(result.code).toBe(2);
    expect(result.err).toMatch(
      /the cassette has no answer for request [0-9a-f]{12}; the nearest entry [0-9a-f]{12} differs in: .*part\./,
    );
    await expect(readFile(join(root, 'missed.yaml'), 'utf8')).rejects.toThrow();
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

  it('refuses --record without the keys of the labelers, naming the variables, and never prints one', async () => {
    const root = await estate();
    const args = [
      'estate',
      'scan',
      '.',
      '--pointer',
      '--record',
      '--cassette',
      'cassette.jsonl',
      '--out',
      'map.yaml',
    ];
    const none = await run(args, root, {
      JEV_API_KEY: undefined,
      JEV_ROUTE: undefined,
      JEV_URL: undefined,
      ANTHROPIC_API_KEY: undefined,
    });
    expect(none.code).toBe(2);
    expect(none.err).toContain('JEV_API_KEY and JEV_URL (or JEV_ROUTE)');
    const one = await run(args, root, {
      JEV_API_KEY: 'jev-secret',
      JEV_ROUTE: 'typesafe',
      ANTHROPIC_API_KEY: undefined,
    });
    expect(one.code).toBe(2);
    expect(one.err).toContain('ANTHROPIC_API_KEY');
    expect(one.err + one.out).not.toContain('secret');
  });

  it('refuses the flags that need --pointer, and --pointer with the model port flags', async () => {
    const root = await estate();
    const alone = await run(['estate', 'scan', '.', '--cassette', 'c.jsonl', '--out', 'map.yaml'], root);
    expect(alone.code).toBe(2);
    expect(alone.err).toContain('need --pointer');
    const labeler = await run(['estate', 'scan', '.', '--labeler', 'system1:jev', '--out', 'map.yaml'], root);
    expect(labeler.err).toContain('need --pointer');
    const both = await run(
      ['estate', 'scan', '.', '--pointer', '--no-model', '--cassette', 'c.jsonl', '--out', 'map.yaml'],
      root,
    );
    expect(both.code).toBe(2);
    const noCassette = await run(['estate', 'scan', '.', '--pointer', '--out', 'map.yaml'], root);
    expect(noCassette.err).toContain('--pointer needs --cassette');
  });

  it('refuses a bad labeler, a bad number and a stack of one class twice', async () => {
    const root = await estate();
    const base = ['estate', 'scan', '.', '--pointer', '--cassette', 'c.jsonl', '--out', 'map.yaml'];
    const bad = await run([...base, '--labeler', 'haiku'], root);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain('starts with system1 or system2');
    expect((await run([...base, '--labeler', 'system2:jev'], root)).err).toContain(
      'the clients of system2 are',
    );
    expect((await run([...base, '--labeler-pass-at', '2'], root)).err).toContain(
      '--labeler-pass-at is a number from 0 to 1',
    );
    expect((await run([...base, '--labeler-threshold', 'high'], root)).err).toContain('--labeler-threshold');
    expect((await run([...base, '--jobs', '0'], root)).err).toContain(
      '--jobs is a whole number from 1 to 64',
    );
    expect(
      (await run([...base, '--labeler', 'system1:jev', '--labeler', 'system1:jev-unit'], root)).err,
    ).toContain('at most one labeler per class');
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

  it('runs a user labeler from a module, recorded and replayed like the built-in ones', async () => {
    const root = await estate();
    await writeFile(
      join(root, 'house.mjs'),
      `export default {
        id: 'house',
        cls: 'system2',
        label: (request) => ({ labels: request.window.units.map((unit) => ({ units: String(unit.n), label: /^Never/.test(unit.text) ? 'prohibition' : 'none' })) }),
      };`,
    );
    const { io, output } = capture(root);
    const recorded = await estateScanCommand(
      '.',
      {
        out: 'house.yaml',
        pointer: true,
        cassette: 'house.jsonl',
        record: true,
        labeler: ['system2:module:./house.mjs'],
      },
      io,
      { env: {} },
    );
    expect(output.err).toBe('');
    expect(recorded).toBe(0);
    expect(output.out).toContain('Pointer reader: system 2 module:house house.');
    const replay = await run(
      [
        'estate',
        'scan',
        '.',
        '--pointer',
        '--cassette',
        'house.jsonl',
        '--labeler',
        'system2:module:./house.mjs',
        '--out',
        'house2.yaml',
      ],
      root,
    );
    expect(replay.code).toBe(0);
    expect(await readFile(join(root, 'house2.yaml'), 'utf8')).toContain('quote: Never leave the gate open');
  });

  it('leaves the default scan as it was: no pointer line without the flag', async () => {
    const root = await estate();
    const result = await run(['estate', 'scan', '.', '--no-model', '--out', 'map.yaml'], root);
    expect(result.out).not.toContain('Pointer reader');
  });
});
