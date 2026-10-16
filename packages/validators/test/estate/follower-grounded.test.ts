import { describe, expect, it } from 'vitest';
import { estateRun, specVerdicts, TOPICS } from '../../src/ladders/estate/index';

/** Numbers, identifiers and times the way a reply states them. */
const figures = (text: string) => text.match(/\d+(?:[.,:]\d+)*/g) ?? [];

describe('the rule follower states only what it read', { timeout: 300_000 }, () => {
  it('plants every figure of a topic’s register example in the file the skill edits', () => {
    for (const topic of TOPICS) {
      if (!('targetText' in topic)) continue;
      const read = (topic as { targetText: string }).targetText;
      for (const figure of figures((topic as { register: { example: string } }).register.example))
        expect(read, `${(topic as { noun: string }).noun}: ${figure}`).toContain(figure);
    }
  });

  it.each([4, 6, 7, 1009])('keeps every grounded_values verdict green on seed %i', async (seed) => {
    const run = await estateRun(seed);
    const bad = (await specVerdicts(run)).filter((verdict) =>
      verdict.follower?.failing.some((line) => /grounded_values/.test(line)),
    );
    expect(bad.map((verdict) => verdict.spec.record.id)).toEqual([]);
  });
});
