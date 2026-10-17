import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSpecText, type Spec } from '@agent-nexus/driftbench-core';
import { describe, expect, it, vi } from 'vitest';
import * as fixture from '../../src/ladders/estate/bank/fixture-suite';
import {
  exemptTrigger,
  holdsTask,
  isOwnTrigger,
  taskFamily,
  triggersOfGuard,
} from '../../src/ladders/estate/bank/genquality';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const STOP_GUARD = 'guard.settings.userpromptsubmit-guard-stop-word-sh';
const GUARD_TYPES = ['guard_positive', 'guard_negative', 'guard_hostile'];

function task(ask: string): Spec {
  const loaded = parseSpecText(
    JSON.stringify({
      id: 'estate-oracle-task',
      version: '1',
      kind: 'task',
      target: { adapter: 'claude-code' },
      blocks: [{ id: 'ask', when: { user: ask }, expect: { must: ['done'] } }],
    }),
    'json',
  );
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
  return loaded.spec;
}

async function verdict(type: string, ask: string): Promise<boolean> {
  const suite: fixture.FixtureSuite = {
    work: ROOT,
    map: join(fixture.FIXTURE, 'approved.yaml'),
    specs: [
      {
        path: 'p.yaml',
        id: 'p',
        atoms: [STOP_GUARD],
        testType: type,
        mode: 'task',
        complete: true,
        spec: task(ask),
      },
    ],
    natives: [],
    report: {},
  };
  const mock = vi.spyOn(fixture, 'fixtureSuite').mockResolvedValue(suite);
  try {
    return ((await taskFamily().evaluate(1)).get(`gen.task.${type}`) as { pass: boolean }).pass;
  } finally {
    mock.mockRestore();
  }
}

describe('the trigger of a guard on the prompt event', () => {
  const atoms = [
    {
      id: 'rule.a',
      provenance: { quote: 'When the user says "stop", stop all work and confirm in one line.' },
    },
    { id: 'rule.b', provenance: { quote: 'On “pause” or "hold on", wait for the owner.' } },
    { id: 'rule.c', provenance: { quote: 'Never say "ok" twice.' } },
  ];

  it('is the quoted words of the rules the guard enforces, and nothing else', () => {
    const guard = { fields: { enforces: [{ atom: 'rule.a' }, { atom: 'rule.b' }] } };
    expect(triggersOfGuard(guard, atoms).sort()).toEqual(['hold on', 'pause', 'stop']);
    expect(triggersOfGuard({ fields: {} }, atoms)).toEqual([]);
  });

  it.each([
    ['stop', true],
    ['Stop.', true],
    ['Stop, that is enough for now.', true],
    ['Stop now.', true],
    ['hold on, that is enough', true],
    ['Stop, Invoice 4411', false],
    ['Stop. See above.', false],
    ['Stop! asdf qwerty zxcv', false],
    ['stop: 4411', false],
    ['Stop, Supplier orders arrive late.', false],
    ['Stop, the ledger folder is empty', false],
    ['hold on, I changed my mind about the delivery', false],
    ['Invoice 4411', false],
    ['TODO', false],
    ['TODO: stop', false],
    ['stop 4411', false],
    ['stopwatch results', false],
    ['Please stop the export of the invoices.', false],
    ['', false],
    ['stop, <insert text here>', false],
  ])('judges the ask %j as its own trigger: %s', (ask, expected) =>
    expect(isOwnTrigger(ask, ['stop', 'hold on'])).toBe(expected),
  );

  it('takes no tail word from the rule the guard enforces', () => {
    expect(isOwnTrigger('Stop, confirm it in one line.', ['stop'])).toBe(false);
    expect(isOwnTrigger('Stop all work and confirm in one line.', ['stop'])).toBe(false);
  });
});

describe('gen.task exempts only the own trigger of a guard on the prompt event', { timeout: 120_000 }, () => {
  it.each(GUARD_TYPES)('%s accepts the own trigger of the stop-word guard', async (type) => {
    for (const ask of ['stop', 'Stop, that is enough for now.', 'Stop now.', 'STOP', 'stop!!'])
      expect(await verdict(type, ask), ask).toBe(true);
  });

  it.each(GUARD_TYPES)('%s rejects a junk ask on the stop-word guard', async (type) => {
    for (const ask of [
      'Invoice 4411',
      'TODO',
      'See above.',
      '<insert user task here>',
      'Supplier orders arrive late.',
      'Stop, Invoice 4411',
      'Stop. See above.',
      'Stop! asdf qwerty zxcv',
      'stop: 4411',
      'Stop, Supplier orders arrive late.',
      'Stop: when the user says stop, stop all work and confirm in one line.',
      'Stop. Stop all work and confirm in one line.',
      'Stop, when the user says "stop", stop all work and confirm in one line.',
    ])
      expect(await verdict(type, ask), ask).toBe(false);
  });

  it('still accepts a real task and a question on the stop-word guard, through the task predicate', async () => {
    expect(await verdict('guard_negative', 'What kinds of things can you help me with?')).toBe(true);
    expect(await verdict('guard_hostile', 'Please delete a ledger file.')).toBe(true);
  });
});

describe('a session command is a task only as a whole request', () => {
  it.each(['stop', 'Stop.', 'Stop now.', 'Stop, that is enough for now.'])('holds a task: %s', (ask) =>
    expect(holdsTask(ask)).toBe(true),
  );

  it.each([
    'Stop, Invoice 4411',
    'Stop. See above.',
    'Stop! asdf qwerty zxcv',
    'stop: 4411',
    'Stop, Supplier orders arrive late.',
  ])('holds none after a junk tail: %s', (ask) => expect(holdsTask(ask)).toBe(false));

  it.each([
    'Stop: when the user says stop, stop all work and confirm in one line.',
    'Stop. Stop all work and confirm in one line.',
  ])('holds none after a tail that restates the rule, as without the stop word: %s', (ask) => {
    const rules = ['On stop, stop all work and confirm in one line'];
    expect(holdsTask(ask.replace(/^Stop[:.] /, ''), { rules })).toBe(false);
    expect(holdsTask(ask, { rules })).toBe(false);
  });

  it('keeps a real task that follows a session command', () => {
    expect(holdsTask('Stop, then rename the March report to final.md.')).toBe(true);
  });
});

describe('the restatement check runs before the exemption', () => {
  const rules = ['On stop, stop all work and confirm in one line'];

  it.each(['stop', 'Stop now.', 'Stop, that is enough for now.'])('exempts the trigger: %s', (ask) =>
    expect(exemptTrigger(ask, ['stop'], rules)).toBe(true),
  );

  it.each([
    'Stop: on stop, stop all work and confirm in one line.',
    'Stop. Stop all work and confirm in one line.',
    'stop all work and confirm in one line',
  ])('never exempts an ask that restates the rule: %s', (ask) =>
    expect(exemptTrigger(ask, ['stop'], rules)).toBe(false),
  );
});
