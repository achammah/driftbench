import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { drawEstate, renderEstate } from '../../src/ladders/estate/index';

/** The stop-word guard the generator renders must agree with the phrases the bank asks, whatever their letter case. */
const NUDGE = 'the user asked to stop';

function nudges(script: string, prompt: string): boolean {
  const run = spawnSync('sh', ['-c', script], {
    input: `${JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt })}\n`,
    encoding: 'utf8',
  });
  return run.status === 0 && run.stderr.includes(NUDGE);
}

describe('the rendered stop-word guard', { timeout: 60_000 }, () => {
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 1001];
  const scripts = seeds.flatMap((seed) => {
    const estate = drawEstate(seed);
    const files = renderEstate(estate).files;
    const path = Object.keys(files).find((name) => name.endsWith('stop-word.sh'));
    return path ? [{ seed, script: files[path] as string }] : [];
  });

  it('is planted on the seeds under test', () => {
    expect(scripts.length).toBeGreaterThan(0);
  });

  it.each(['Stop all work now.', 'stop', 'STOP right there', 'Please Stop.', 'stopping is fine'])(
    'nudges on a prompt with the word in any case: %s',
    (prompt) => {
      for (const { seed, script } of scripts) expect(nudges(script, prompt), `seed ${seed}`).toBe(true);
    },
  );

  it.each(['Can we pause the planning until Monday?', 'Go on with the report.', 'What is a layover?'])(
    'stays silent on a prompt without the word: %s',
    (prompt) => {
      for (const { seed, script } of scripts) expect(nudges(script, prompt), `seed ${seed}`).toBe(false);
    },
  );

  it('a guard that matches only lowercase fails the hand-written bank phrase', () => {
    const lowercaseOnly =
      '#!/bin/sh\ninput=$(cat)\ncase "$input" in\n  *stop*) echo "the user asked to stop" >&2 ;;\nesac\nexit 0\n';
    expect(nudges(lowercaseOnly, 'Stop all work now.')).toBe(false);
    expect(nudges(lowercaseOnly, 'stop')).toBe(true);
  });
});
