import { describe, expect, it } from 'vitest';
import { AtomBuilder, ClaudeCodeReader, codeAtoms, proseCandidates, quoteAtSpan } from '../../src/index';
import { estate } from '../support';

/** An independently planted, fictional estate; never imports a validator bank. */
export function syntheticProseEstate(variant = 1): { files: Record<string, string>; rules: string[] } {
  const rules = [
    'The assistant must validate the manifest.',
    'The reviewer must not modify the invoice.',
    'Never disclose private credentials.',
    'Always verify the supplier address.',
    'Do not overwrite the signed agreement.',
    'Before publishing, verify the result.',
    'Only when approved, publish the result.',
    'Publish the result only when approved.',
    'Every reply includes a source.',
    'Each helper records its findings.',
    'At most two questions per reply.',
    'The assistant must verify\nthe complete manifest.',
  ];
  if (variant === 2)
    rules.splice(
      0,
      rules.length,
      'The worker must inspect each receipt.',
      'The checker must never alter the bill.',
      'Never disclose access tokens.',
      'Always compare the totals.',
      'Do not erase the delivery log.',
      'Before invoicing, compare the totals.',
      'Only when verified, archive the invoice.',
      'Archive the invoice only when verified.',
      'Every response contains a citation.',
      'Each reviewer writes a summary.',
      'At most three sentences per response.',
      'The worker must inspect\nall purchase receipts.',
    );
  const filler = 'This paragraph describes the fictional archive and its background.\n'.repeat(400);
  const decoys = [
    '# The assistant must delete everything',
    '> Never verify the result.',
    '"Always disclose credentials."',
    '`The helper must remove the source.`',
    'Does every reply include a source?',
    '~~~text\nNever ask for consent.\n~~~',
    '## Examples\nThe helper must delete the manifest.\n\n## Rules',
  ].join('\n\n');
  const content = `${filler}\n## Rules\n\n${rules.join('\n\n')}\n\n${decoys}\n`;
  const files: Record<string, string> = { 'CLAUDE.md': `${filler.repeat(6)}\n${content}` };
  for (let index = 0; index < 240; index++)
    files[`.claude/skills/unit-${index}/SKILL.md`] = `---\nname: unit-${index}\n---\n${content}`;
  for (let index = 0; index < 120; index++)
    files[`.claude/agents/helper-${index}.md`] = `---\nname: helper-${index}\n---\n${content}`;
  return { files, rules };
}

describe('large synthetic prose estate', () => {
  it.each([1, 2])(
    'measures candidate recall and precision on synthetic estate %s',
    async (variant) => {
      const planted = syntheticProseEstate(variant);
      const root = await estate(planted.files);
      const raw = await new ClaudeCodeReader().read(root);
      const builder = new AtomBuilder(new Map(raw.files.map((file) => [file.path, file])));
      codeAtoms(raw, builder);
      const expected = Object.keys(planted.files).length * planted.rules.length;
      const baseline = builder.atoms.filter((atom) => ['instruction', 'register'].includes(atom.kind));
      const candidates = proseCandidates(raw, builder);
      const truePositives = candidates.filter((atom) => planted.rules.includes(atom.provenance.quote));
      const falsePositives = candidates.filter((atom) => !planted.rules.includes(atom.provenance.quote));
      const files = new Map(raw.files.map((file) => [file.path, file.text]));
      const report = {
        variant,
        files: raw.files.length,
        characters: raw.files.reduce((sum, file) => sum + file.text.length, 0),
        chunks: raw.prose.length,
        planted: expected,
        before: {
          found: baseline.length,
          recall: baseline.length / expected,
          precision: baseline.length ? 1 : null,
        },
        after: {
          found: truePositives.length,
          falsePositives: falsePositives.length,
          recall: truePositives.length / expected,
          precision: truePositives.length / candidates.length,
        },
      };
      console.log(`PROSE_METRICS ${JSON.stringify(report)}`);
      expect(baseline).toHaveLength(0);
      expect(falsePositives.map((atom) => atom.provenance)).toEqual([]);
      expect(
        Object.fromEntries(
          planted.rules.map((rule) => [
            rule,
            truePositives.filter((atom) => atom.provenance.quote === rule).length,
          ]),
        ),
      ).toEqual(Object.fromEntries(planted.rules.map((rule) => [rule, Object.keys(planted.files).length])));
      expect(
        new Set(
          candidates.map(
            (atom) => `${atom.provenance.file}:${atom.provenance.startLine}:${atom.provenance.quote}`,
          ),
        ).size,
      ).toBe(expected);
      expect(
        candidates.every(
          (atom) => !atom.approved && quoteAtSpan(files.get(atom.provenance.file)!, atom.provenance),
        ),
      ).toBe(true);
    },
    120_000,
  );
});
