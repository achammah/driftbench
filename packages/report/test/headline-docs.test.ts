import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { suiteHeadline } from '../src/headline';
import { headlineText } from '../src/text';
import { run } from './support';

const doc = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

/** The headline line the docs print for the example suite, from the numbers the docs give for its runs. */
describe('the suite headline example of the docs', () => {
  const statistics = doc('docs/concepts/statistics.md');
  // "For six goldens where 5 of 5, 5 of 5, 4 of 5, 0 of 5, 2 of 5 and 2 of 2 runs pass:"
  const sentence = /For \w+ goldens where ([^:]+) runs pass:/.exec(statistics)?.[1] ?? '';
  const counts = [...sentence.matchAll(/(\d+) of (\d+)/g)].map((m) => ({ k: Number(m[1]), n: Number(m[2]) }));
  const printed = /```text\n(Suite pass rate, mode F: [^\n]+)\n```/.exec(statistics)?.[1];

  it('describes the shipped root-family headline and distinguishes its all-pass target', () => {
    expect(statistics).not.toContain('The suite headline groups by golden today');
    expect(statistics).not.toContain('The parent link is not in the spec schema yet');
    expect(statistics).toContain('E[phi^m]');
    expect(doc('CHANGELOG.md')).not.toContain('the suite headline still groups by golden');
  });

  it('is read from the docs: six goldens with their runs', () => {
    expect(counts).toHaveLength(6);
    expect(printed).toBeDefined();
  });

  it('is the line the code prints for those runs, on the statistics page and in the CLI reference', () => {
    const runs = counts.flatMap(({ n, k }, golden) =>
      Array.from({ length: n }, (_, repeat) =>
        run({ specId: `g${golden}`, repeat, blocks: repeat < k ? [{}] : [{ pass: false }] }),
      ),
    );
    const headline = suiteHeadline(runs, (entry) => entry.specId);
    const line = headlineText('F', headline as NonNullable<typeof headline>);
    expect(printed).toBe(line);
    expect(doc('docs/reference/cli.md')).toContain(`\`${line}\``);
  });
});
