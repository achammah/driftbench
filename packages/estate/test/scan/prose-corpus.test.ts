import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AtomBuilder, ClaudeCodeReader, codeAtoms, proseCandidates } from '../../src/index';
import { estate } from '../support';
import { buildCorpus, type CorpusItem } from './prose-corpus';
import { buildHeldOutCorpus } from './prose-corpus-heldout';
import { buildStyleCorpus } from './prose-corpus-style';
import { buildTerseCorpus } from './prose-corpus-terse';

type Stat = { total: number; found: number; flagged: number };

/** Writes the corpus into an estate (every block in one file, the vendored ones in their own) and scans it. */
async function measure(items: CorpusItem[]): Promise<Record<string, Stat>> {
  const main: string[] = [];
  const spans: Array<{ item: CorpusItem; start: number; end: number }> = [];
  const extra: Record<string, string> = {};
  const push = (text: string) => main.push(...text.split('\n'));
  for (const [index, item] of items.entries()) {
    if (item.files) {
      Object.assign(extra, item.files);
      continue;
    }
    push('');
    push(`Filler paragraph ${index} describes how the team sorts its work.`);
    push('');
    const start = main.length + 1;
    push(item.text);
    spans.push({ item, start, end: main.length });
  }
  const root = await estate({
    'CLAUDE.md': `${main.join('\n')}\n`,
    '.claude/skills/ledger/SKILL.md': '---\nname: ledger\ndescription: Ledger work\n---\nSee references.\n',
    '.claude/skills/ledger/references/guide.md': '# Guide\n\nAlways close the stream.\n',
  });
  for (const [path, text] of Object.entries(extra)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  const raw = await new ClaudeCodeReader().read(root);
  const builder = new AtomBuilder(new Map(raw.files.map((file) => [file.path, file])));
  codeAtoms(raw, builder);
  const atoms = proseCandidates(raw, builder);
  const stats: Record<string, Stat> = {};
  const stat = (cls: string) => {
    stats[cls] ??= { total: 0, found: 0, flagged: 0 };
    return stats[cls] as Stat;
  };
  for (const { item, start, end } of spans) {
    const hits = atoms.filter(
      (atom) =>
        atom.provenance.file === 'CLAUDE.md' &&
        atom.provenance.startLine <= end &&
        start <= atom.provenance.endLine,
    );
    const entry = stat(item.cls);
    entry.total++;
    if (hits.length > 0) entry.found++;
    if (hits.some((atom) => atom.fields?.partial === true)) entry.flagged++;
  }
  for (const item of items) {
    if (!item.path) continue;
    const entry = stat(item.cls);
    entry.total++;
    if (atoms.some((atom) => atom.provenance.file === item.path)) entry.found++;
  }
  const control = stat('control');
  control.total = 1;
  control.found = atoms.some((atom) => atom.provenance.file.endsWith('references/guide.md')) ? 1 : 0;
  return stats;
}

const rulesClasses = [
  'code-span-rules',
  'terse-rule',
  'recovered',
  'imperative',
  'output-style',
  'only-when',
  'modal-never-before',
  'habit-in-rules-section',
];
/** Look-alikes the grammar must never propose, whatever the wording. */
const never = [
  'descriptive',
  'history',
  'hypothetical',
  'wrong-example',
  'structure',
  'vendored',
  'build-output',
  'two-word',
  'label-or-report',
  'anti-example',
  'placeholder',
  'checklist',
  'wrong-above',
  'capability',
  'title',
  'terse-description',
  'descriptive-statements',
  'trigger-idiom',
];

describe.each([
  ['the first corpus', buildCorpus, 0.95],
  ['the held-out corpus', buildHeldOutCorpus, 0.9],
  ['the style corpus', buildStyleCorpus, 0.95],
  ['the terse corpus', buildTerseCorpus, 0.95],
])('rule grammar on %s', (_name, build, floor) => {
  it('finds the rules, refuses the look-alikes and flags fragments', async () => {
    const stats = await measure(build());
    const rate = (classes: string[]) => {
      const rows = classes.map((cls) => stats[cls]).filter((row): row is Stat => !!row);
      return rows.reduce((sum, row) => sum + row.found, 0) / rows.reduce((sum, row) => sum + row.total, 0);
    };
    for (const cls of rulesClasses) {
      const row = stats[cls];
      if (row) expect(row.found / row.total, `recall of ${cls}`).toBeGreaterThanOrEqual(floor);
    }
    for (const cls of never) if (stats[cls]) expect(stats[cls].found, `false proposals in ${cls}`).toBe(0);
    // Other parties and speakers cannot always be told apart from the agent by structure alone.
    for (const cls of ['third-party', 'quote']) {
      const row = stats[cls];
      if (row) expect(row.found / row.total, `false proposals in ${cls}`).toBeLessThanOrEqual(0.35);
    }
    const fragment = stats.fragment;
    if (fragment) {
      expect(fragment.found).toBe(fragment.total);
      expect(fragment.flagged).toBe(fragment.total);
    }
    expect(stats.control?.found).toBe(1);
    expect(rate(rulesClasses)).toBeGreaterThanOrEqual(floor);
  }, 120_000);
});
