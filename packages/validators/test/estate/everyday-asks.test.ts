import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSpecText, type Spec } from '@agent-nexus/driftbench-core';
import { describe, expect, it, vi } from 'vitest';
import * as fixture from '../../src/ladders/estate/bank/fixture-suite';
import { holdsTask, taskFamily } from '../../src/ladders/estate/bank/genquality';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

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

describe('gen.task judges every test type with the one clause predicate, so no verb list decides', {
  timeout: 120_000,
}, () => {
  // Everyday verbs, none held in a list: the verdict comes from the clause, so it is the same for a read_when spec
  // as for any other type.
  const VERBS = [
    'edit',
    'open',
    'delete',
    'rename',
    'move',
    'copy',
    'save',
    'update',
    'modify',
    'replace',
    'fix',
    'create',
    'write',
    'append',
    'remove',
    'overwrite',
    'revise',
    'format',
    'merge',
    'split',
    'sort',
    'review',
    'upload',
    'download',
    'archive',
    'translate',
    'summarise',
    'attach',
    'proofread',
    'redact',
  ];
  const planted = async (type: string, ask: string) => {
    const suite: fixture.FixtureSuite = {
      work: ROOT,
      map: join(fixture.FIXTURE, 'approved.yaml'),
      specs: [
        { path: 'p.yaml', id: 'p', atoms: [], testType: type, mode: 'task', complete: true, spec: task(ask) },
      ],
      natives: [],
      report: {},
    };
    const mock = vi.spyOn(fixture, 'fixtureSuite').mockResolvedValue(suite);
    try {
      return (await taskFamily().evaluate(1)).get(`gen.task.${type}`) as { pass: boolean };
    } finally {
      mock.mockRestore();
    }
  };

  it.each(VERBS)(
    'accepts "Please %s any invoice file." as a read_when ask and as an obligation ask',
    async (verb) => {
      const ask = `Please ${verb} any invoice file.`;
      expect(holdsTask(ask)).toBe(true);
      expect((await planted('read_when', ask)).pass).toBe(true);
      expect((await planted('obligation', ask)).pass).toBe(true);
    },
  );

  it('keeps the rejections for a read_when spec: a label, a statement, a rule restated', async () => {
    expect((await planted('read_when', 'Invoice 4411')).pass).toBe(false);
    expect((await planted('read_when', 'Supplier orders arrive late.')).pass).toBe(false);
    expect((await planted('read_when', 'Please read a file before you edit it.')).pass).toBe(false);
  });
});

describe('gen.task: the asks of the generated suite and the prompt-guard exception', {
  timeout: 120_000,
}, () => {
  it.each([
    'Please edit any invoice file.',
    'Please commit to git.',
    'Please paste a credential into a reply.',
    'Please help me with a delivery, a tracking number or a late shipment.',
    'Stop, that is enough for now.',
    'stop',
  ])('accepts the real ask: %s', (ask) => expect(holdsTask(ask)).toBe(true));

  const planted = async (type: string, ask: string, atoms: string[]) => {
    const suite: fixture.FixtureSuite = {
      work: ROOT,
      map: join(fixture.FIXTURE, 'approved.yaml'),
      specs: [
        { path: 'p.yaml', id: 'p', atoms, testType: type, mode: 'task', complete: true, spec: task(ask) },
      ],
      natives: [],
      report: {},
    };
    const mock = vi.spyOn(fixture, 'fixtureSuite').mockResolvedValue(suite);
    try {
      return (await taskFamily().evaluate(1)).get(`gen.task.${type}`) as { pass: boolean };
    } finally {
      mock.mockRestore();
    }
  };
  const STOP_GUARD = 'guard.settings.userpromptsubmit-guard-stop-word-sh';
  const FORCE_GUARD = 'guard.settings.pretooluse-bash-guard-block-force-push';

  it('tests a guard that watches the prompt with its own trigger, even a bare word', async () => {
    for (const ask of ['Stop, that is enough for now.', 'stop', 'Stop.'])
      expect((await planted('guard_positive', ask, [STOP_GUARD])).pass, ask).toBe(true);
  });

  it('holds a guard on a tool event to a task that names the act it guards', async () => {
    expect((await planted('guard_positive', 'stop', [FORCE_GUARD])).pass).toBe(false);
    expect(
      (await planted('guard_positive', 'Please force push the fix branch to origin.', [FORCE_GUARD])).pass,
    ).toBe(true);
  });
});
