import { expect, it } from 'vitest';
import { ClaudeCodeReader, quoteAtSpan, scanEstate } from '../../src/index';
import { estate } from '../support';

/** A deterministic generator: the same file on every run, no seed bank. */
function random(seed: number) {
  let state = seed >>> 0;
  return (below: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % below;
  };
}

const pieces = [
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  '(?<=',
  '[a-',
  '\\',
  '\\\\',
  '\\b',
  '.*',
  '+?',
  '^',
  '$',
  '|',
  '*',
  '?',
  '/',
  '"',
  "'",
  '“',
  '”',
  '‘',
  '’',
  '`',
  '``',
  '```',
  '~~~',
  '<!--',
  '-->',
  '<',
  '>',
  '&nbsp;',
  '&#0;',
  '%s',
  '${x}',
  '😀',
  '👩‍👩‍👧',
  '東京',
  '日本語の文',
  'مرحبا بالعالم',
  'שלום',
  'Привет',
  'नमस्ते',
  'ñandú',
  'é',
  '‏',
  '\u0000',
  '\ud800',
  '`x+y`',
  '`a|b`',
  '[link](http://x)',
  '**bold**',
  '_it_',
  '1.',
  '- ',
  '> ',
  '#',
  '| a | b |',
];
const stems = [
  'Every entry {} must retain its source.',
  'Never {} publish credentials.',
  'Always {} verify the receipt.',
  'Do not {} overwrite the agreement.',
  'Before {} publishing, verify the result.',
  'Only when {} approved, publish the result.',
  'Every run {} is logged.',
  'At most {} two questions per reply.',
  'Each helper {} records its findings.',
  'The note {} says: {} never do this.',
  'Note: {} {} {}',
];

/** Pieces that open or close Markdown block state (fences, comments): left out where a rule must survive. */
const blockState = /^(?:<!--|-->|```|~~~)$/;

function fuzzLines(count: number, allowed: readonly string[], seed: number): string[] {
  const next = random(seed);
  const lines: string[] = [];
  for (let index = 0; index < count; index++) {
    const sentence = (stems[next(stems.length)] as string).replace(/\{\}/g, () => {
      let payload = '';
      for (let times = next(9); times >= 0; times--) payload += allowed[next(allowed.length)];
      return payload;
    });
    // Mix hard breaks, soft wraps, list items, quotes and blank lines.
    const shape = next(6);
    lines.push(
      shape === 0
        ? `- ${sentence}`
        : shape === 1
          ? `> ${sentence}`
          : shape === 2
            ? `${sentence}\r`
            : sentence,
    );
    if (next(3) === 0) lines.push('');
  }
  return lines;
}

const sentinels = [
  'The assistant must validate the manifest.',
  'Never disclose private credentials.',
  'Every command’s failure (exit code + stderr) reaches you.',
  'Every run (exit 1) is logged.',
];

it('finishes punctuation-heavy files of mixed scripts, keeps every quote at its lines and the rules around them', async () => {
  const safe = fuzzLines(
    9000,
    pieces.filter((piece) => !blockState.test(piece)),
    20260216,
  );
  const middle = Math.floor(safe.length / 2);
  const sentinelFile = [
    '## Rules',
    '',
    sentinels[0],
    '',
    ...safe.slice(0, middle),
    '',
    '## Rules',
    '',
    sentinels[1],
    '',
    ...safe.slice(middle),
    '',
    '## Rules',
    '',
    sentinels[2],
    '',
    sentinels[3],
    '',
  ].join('\n');
  // Unclosed fences and comments legitimately hide the rest of their file: this file only has to be survived.
  const hostile = fuzzLines(9000, pieces, 977).join('\n');
  const root = await estate({
    'CLAUDE.md': sentinelFile,
    '.claude/skills/check/SKILL.md': `---\nname: check\n---\n${hostile}`,
    '.claude/agents/helper.md': `---\nname: helper\n---\n${sentinelFile}`,
  });
  const started = process.cpuUsage();
  const result = await scanEstate({ root, reader: new ClaudeCodeReader() });
  const used = process.cpuUsage(started);
  // Processor time, so a loaded host cannot fail a test that measures the product's own work.
  const elapsed = (used.user + used.system) / 1000;
  console.log(`FUZZ_CPU_MS ${Math.round(elapsed)}`);
  expect(result.map.hash).toBeTruthy();
  expect(elapsed).toBeLessThan(30_000);
  // A clause the scan cannot place is counted, with its reason, and never ends the scan.
  const skipped = result.raw.notes.filter((note) => note.message.startsWith('Prose candidate skipped'));
  expect(skipped.filter((note) => !note.message.endsWith('the quote cannot be found at its lines'))).toEqual(
    [],
  );
  for (const file of ['CLAUDE.md', '.claude/agents/helper.md'])
    expect(
      sentinels.map((rule) =>
        result.map.atoms.some((atom) => atom.provenance.file === file && atom.provenance.quote === rule),
      ),
    ).toEqual(sentinels.map(() => true));
  const texts = new Map(result.raw.files.map((file) => [file.path, file.text]));
  const misplaced = result.map.atoms.filter(
    (atom) =>
      atom.fields?.candidate === true && !quoteAtSpan(texts.get(atom.provenance.file) ?? '', atom.provenance),
  );
  expect(misplaced.map((atom) => atom.provenance)).toEqual([]);
}, 180_000);
