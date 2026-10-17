import { rm } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';
import { ACTS, actPositives, controls, EVENTS, type GateLine, positives } from './gate-events-corpus';

// Read-before rules written with events instead of acts after "before" ("any export", "the second
// render", "your first action"), emphasis words, a capitalised BEFORE and coordinated reads. The
// sentences are crossed from hand-written shapes; the controls use the same words in other senses.
async function gates(lines: string[]) {
  const root = await estate({
    'CLAUDE.md': `${lines.join('\n')}\n`,
    'guide.md': '# Guide\n',
    'rules.md': '# Rules\n',
    'docs/field notes.md': '# Notes\n',
  });
  try {
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    // One gate holds every file the sentence names: the first and the ones that join it.
    return map.atoms.flatMap((atom) =>
      atom.kind === 'gate'
        ? [String(atom.fields?.first), ...((atom.fields?.also as string[] | undefined) ?? [])].map(
            (first) => ({
              quote: atom.provenance.quote,
              first,
            }),
          )
        : [],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function measure(expected: GateLine[], found: Array<{ quote: string; first: string }>, noise: Set<string>) {
  const wanted = new Map(expected.map((entry) => [entry.line, entry.reads]));
  let truePositive = 0;
  let falsePositive = 0;
  for (const gate of found) {
    if (wanted.get(gate.quote)?.includes(gate.first)) truePositive++;
    else falsePositive++;
    if (noise.has(gate.quote)) noise.delete(gate.quote);
  }
  const total = expected.reduce((sum, entry) => sum + entry.reads.length, 0);
  return { expected: total, found: found.length, truePositive, falsePositive };
}

it('reads events after before and prior to, with emphasis and coordinated reads', async () => {
  const wanted = positives();
  const controlLines = controls([...EVENTS.slice(0, 4), ...ACTS]);
  const found = await gates([...wanted.map((entry) => entry.line), ...controlLines]);
  const result = measure(wanted, found, new Set());
  const missed = wanted.filter(
    (entry) =>
      !entry.reads.every((read) => found.some((gate) => gate.quote === entry.line && gate.first === read)),
  );
  const controlHits = found.filter((gate) => controlLines.includes(gate.quote));
  console.log(
    JSON.stringify({
      events: {
        ...result,
        recall: (result.truePositive / result.expected).toFixed(3),
        precision: (result.truePositive / Math.max(1, result.found)).toFixed(3),
        controls: controlLines.length,
        controlHits: controlHits.length,
        missedLines: missed.length,
      },
    }),
  );
  if (process.env.GATE_EVENTS_LIST) {
    for (const entry of missed.slice(0, 80)) console.log(`MISS ${entry.line}`);
    for (const gate of controlHits) console.log(`CONTROL-HIT ${gate.quote} -> ${gate.first}`);
  }
  expect(controlHits).toEqual([]);
  expect(result.falsePositive).toBe(0);
  expect(result.truePositive).toBe(result.expected);
});

it('keeps reading the acts the gate reader handled, with the same shapes', async () => {
  const wanted = actPositives();
  const found = await gates(wanted.map((entry) => entry.line));
  const result = measure(wanted, found, new Set());
  console.log(JSON.stringify({ acts: { ...result } }));
  if (process.env.GATE_EVENTS_LIST)
    for (const entry of wanted)
      if (
        !entry.reads.every((read) => found.some((gate) => gate.quote === entry.line && gate.first === read))
      )
        console.log(`MISS ${entry.line}`);
  expect(result.falsePositive).toBe(0);
  expect(result.truePositive).toBe(result.expected);
});

it.each([
  ['Before any connect: Read `auth-flows.md`', ['auth-flows.md']],
  ['Before the second query: Read `query.md` FULLY', ['query.md']],
  ['Read `notes.md` BEFORE your first action, and with it `more.md`', ['notes.md', 'more.md']],
  ['Before anything else, read `guide.md`.', ['guide.md']],
  ['Before doing anything else: read `guide.md`.', ['guide.md']],
  ['Before your very first tool call, read `guide.md`.', ['guide.md']],
  ['Before the agent’s first action, read `guide.md`.', ['guide.md']],
  ['First, read `guide.md`, then edit the index.', ['guide.md']],
  ['Until you have read `guide.md`, do not edit the index.', ['guide.md']],
  ['Until `guide.md` is loaded, never edit the index.', ['guide.md']],
  ['Read `guide.md` and `rules.md` FULLY before each deploy.', ['guide.md', 'rules.md']],
  ['Whenever you start a release, read `guide.md` first.', ['guide.md']],
])('reads the order in: %s', async (line, reads) => {
  const found = await gates([line]);
  expect(found.map((gate) => gate.first).sort()).toEqual([...reads].sort());
});
