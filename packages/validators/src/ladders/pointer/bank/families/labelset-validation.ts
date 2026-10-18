import { distinctSentences } from '../../kit/anchor-world';
import { compose } from '../../kit/compose';
import { constant } from '../../kit/labellers';
import { requireSourceWitness } from '../../kit/positive';
import { RULES_YAML } from '../../kit/sets';
import { Prose } from '../../kit/words';
import { fail, type ItemContext, pass } from '../types';

const label = (name: string, extra = '') =>
  `      - name: ${name}\n        description: A unit named ${name}.\n${extra}`;
const set = (name: string, labels: string) =>
  `  - set: ${name}\n    description: A set.\n    labels:\n${labels}`;
export const validationCases = [
  {
    key: 'duplicate-set',
    cause: 'unique-set-names',
    yaml: `labels:\n${set('dup', label('a'))}${set('dup', label('b'))}`,
    name: 'dup',
  },
  {
    key: 'reserved-none',
    cause: 'none-reserved',
    yaml: `labels:\n${set('s1', label('none'))}`,
    name: 'none',
  },
  {
    key: 'duplicate-label',
    cause: 'unique-label-names',
    yaml: `labels:\n${set('s2', label('twice') + label('twice'))}`,
    name: 'twice',
  },
  {
    key: 'label-identifier',
    cause: 'label-identifier',
    yaml: `labels:\n${set('s3', label('bad name'))}`,
    name: 'bad name',
  },
  {
    key: 'target-value',
    cause: 'target-required-only',
    yaml: `labels:\n${set('s4', label('odd', '        target: optional\n'))}`,
    name: 'odd',
  },
];
export async function validateSetCases(ctx: ItemContext, cases = validationCases) {
  const texts = distinctSentences(new Prose(ctx.seed, ctx.id), 4);
  const files = [
    {
      path: 'doc.md',
      text: compose(texts.map((text) => ({ kind: 'paragraph' as const, sentences: [text] }))).text,
    },
  ];
  const good = await ctx.sut.scan({ files, labelsYaml: RULES_YAML, labeler: constant('rule') });
  requireSourceWitness(good, files);
  if (
    !texts.every((text) =>
      good.ledger.entries.some(
        (entry) => entry.quote === text && entry.labels['agent-rules']?.label === 'rule',
      ),
    )
  )
    return fail('positive witness: the valid set did not retain its planted rule');
  for (const value of cases) {
    const result = await ctx.sut.scan({ files, labelsYaml: value.yaml, labeler: constant('none') });
    if (result.ok) return fail(`the set with "${value.name}" was accepted`);
    if (!result.error?.includes(value.name))
      return fail(`the refusal does not name "${value.name}": ${result.error}`);
  }
  return pass(`${cases.length} malformed sets refused after a valid labelled scan`);
}
export const validationRuns = Object.fromEntries(
  validationCases.map((value) => [
    `set-validation-${value.key}`,
    (ctx: ItemContext) => validateSetCases(ctx, [value]),
  ]),
);
