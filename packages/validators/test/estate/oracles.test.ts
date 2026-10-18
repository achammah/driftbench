import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultRegistry, ESTATE_CHECKS } from '@agent-nexus/driftbench-checks';
import { type Check, machineVerdict, parseSpecText, type Spec } from '@agent-nexus/driftbench-core';
import type { Atom } from '@agent-nexus/driftbench-estate';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { context, observed } from '../../../checks/test/support/context';
import * as fixture from '../../src/ladders/estate/bank/fixture-suite';
import { holdsTask, taskFamily } from '../../src/ladders/estate/bank/genquality';
import { genCompleteFamily, roleOf } from '../../src/ladders/estate/bank/loop';
import { actOfAtom } from '../../src/ladders/estate/bank/task-act';
import { type BankLike, envOf } from '../../src/ladders/estate/bank/task-check';
import * as traces from '../../src/ladders/estate/bank/task-trace';
import { estateMeta } from '../../src/ladders/estate/levels';
import * as pipeline from '../../src/ladders/estate/pipeline';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const APPROVED_TASKS = [
  {
    type: 'route_positive',
    text: 'Fill in the shipments late section of the week 41 report.',
    unit: 'skill.weekly-report.skill-weekly-report',
    call: { label: 'Skill', input: { skill: 'weekly-report' } },
  },
  {
    type: 'twin',
    text: 'Go through inbox/ and say which folder each message belongs in.',
    unit: 'subagent.inbox-triager.helper-inbox-triager',
    call: { label: 'Agent', input: { subagent_type: 'inbox-triager' } },
  },
  {
    type: 'route_positive',
    text: 'Has NW-55031 arrived yet? The carrier is FRT.',
    unit: 'skill.shipment-tracker.skill-shipment-tracker',
    call: { label: 'Skill', input: { skill: 'shipment-tracker' } },
  },
];

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing fictional test value');
  return value;
}

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

async function customVerdicts(custom: Record<string, unknown>, seen = observed('done')) {
  const spec = task('Check the invoice.');
  spec.rules = { ...spec.rules, custom };
  const check = pipeline.replayChecks().find((candidate) => candidate.name === 'custom') as Check;
  expect(check).toBeDefined();
  return check.evaluate(context(spec, 0, seen));
}

describe('the estate bank replay uses the production registry', () => {
  it('recognizes every production estate check without populating the empty global registry', async () => {
    const before = defaultRegistry.names();
    expect(before).toEqual([]);
    for (const name of Object.keys(ESTATE_CHECKS)) {
      const verdicts = await customVerdicts({ [name]: {} });
      expect(
        verdicts.some((verdict) => verdict.evidence?.includes('no check of that name is registered')),
        name,
      ).toBe(false);
    }
    expect(defaultRegistry.names()).toEqual(before);
  });

  it('rejects a wrong tool call instead of treating registration as a passing verdict', async () => {
    const custom = {
      some_call: { calls: [{ label: 'Bash', input: { command: { contains: 'reconcile.py' } } }] },
    };
    const good = await customVerdicts(
      custom,
      observed('done', [{ label: 'Bash', input: { command: 'python3 reconcile.py INV-1001' } }]),
    );
    expect(good).toEqual([expect.objectContaining({ id: 'custom.some_call.0', outcome: 'pass' })]);
    const wrong = await customVerdicts(
      custom,
      observed('done', [{ label: 'Bash', input: { command: 'echo wrong' } }]),
    );
    expect(wrong).toEqual([expect.objectContaining({ id: 'custom.some_call.0', outcome: 'fail' })]);
  });

  it('preserves an explicitly configured default-registry override and leaves global state unchanged', async () => {
    defaultRegistry.register('some_call', () =>
      machineVerdict('override', 'test', 'fail', 'configured override'),
    );
    try {
      const before = defaultRegistry.names();
      expect(await customVerdicts({ some_call: {} })).toEqual([
        expect.objectContaining({ outcome: 'fail', evidence: 'configured override' }),
      ]);
      expect(defaultRegistry.names()).toEqual(before);
    } finally {
      defaultRegistry.unregister('some_call');
    }
  });
});

const COMPLETE_ITEMS = [
  'gen.complete.guard_speed-guard-read-before-edit-py',
  'gen.complete.guard_speed-guard-reply-length-py',
  'gen.complete.obligation-instruction-grounded-values',
  'gen.complete.obligation-instruction-script',
  'gen.complete.outside_trigger-instruction-script',
  'gen.complete.script_fixture-script',
  'gen.complete.twin-instruction-grounded-values',
  'gen.complete.twin-instruction-script',
];

/** Keep all specs of the affected classes; unrelated known generator gaps are outside this regression. */
async function affectedRun(): Promise<pipeline.EstateRun> {
  const run = await pipeline.generationRun(1);
  const atoms = new Map(run.scanned.map.atoms.map((atom) => [atom.id, atom]));
  const specs = run.specs.filter((spec) => {
    const atom = atoms.get(estateMeta(spec).atoms?.[0] ?? '');
    if (!atom) return false;
    const role = roleOf(run.scanned.match.hidOf.get(atom.id) ?? '');
    const key = `${spec.record.testType}|${atom.kind}:${role}`.replace(/[|:.]+/g, '-').replace(/-+$/, '');
    return COMPLETE_ITEMS.includes(`gen.complete.${key}`);
  });
  expect(specs.length).toBeGreaterThan(0);
  return { ...run, specs };
}

describe('the affected gen.complete items', { timeout: 120_000 }, () => {
  it('passes all eight affected classes on their generated specs and rule-follower sessions', async () => {
    const run = await affectedRun();
    const mock = vi.spyOn(pipeline, 'generationRun').mockResolvedValue(run);
    try {
      const verdicts = await genCompleteFamily().evaluate(1);
      expect(Object.fromEntries(COMPLETE_ITEMS.map((id) => [id, verdicts.get(id)]))).toEqual(
        Object.fromEntries(COMPLETE_ITEMS.map((id) => [id, { pass: true, detail: 'holds' }])),
      );
    } finally {
      mock.mockRestore();
    }
  });

  it('still fails the script obligation when the generator expects a command the follower never runs', async () => {
    const run = await affectedRun();
    const source = run.specs.find(
      (spec) => spec.record.testType === 'obligation' && spec.loaded?.spec.rules?.custom?.some_call,
    );
    if (!source?.loaded) throw new Error('no generated script obligation');
    const wrong = structuredClone(source);
    if (!wrong.loaded) throw new Error('no loaded spec');
    wrong.loaded.spec.rules = {
      ...wrong.loaded.spec.rules,
      custom: {
        ...wrong.loaded.spec.rules?.custom,
        some_call: { calls: [{ label: 'Bash', input: { command: { equals: 'wrong-component-command' } } }] },
      },
    };
    const mock = vi.spyOn(pipeline, 'generationRun').mockResolvedValue({ ...run, specs: [wrong] });
    try {
      const verdicts = await genCompleteFamily().evaluate(1);
      expect(verdicts.get('gen.complete.obligation-instruction-script')).toMatchObject({
        pass: false,
        detail: expect.stringContaining('fails on the rule follower:'),
      });
      expect(verdicts.get('gen.complete.obligation-instruction-script')?.detail).toContain(
        'custom.some_call',
      );
    } finally {
      mock.mockRestore();
    }
  });
});

describe('approved task asks are judged by their map act and trace', () => {
  const bank = parse(readFileSync(join(fixture.FIXTURE, 'phrases.yaml'), 'utf8')) as BankLike;
  const map = parse(readFileSync(join(fixture.FIXTURE, 'approved.yaml'), 'utf8')) as { atoms: Atom[] };
  const env = envOf(map.atoms, bank, { sessions: [] });
  const approved = bank.situations.flatMap((situation) =>
    situation.phrases.filter((phrase) => phrase.approved).map((phrase) => phrase.text),
  );
  function declared(phrase: (typeof APPROVED_TASKS)[number]): fixture.SuiteSpec {
    const unit = env.byId.get(phrase.unit);
    const situation = bank.situations.find(
      (entry) =>
        entry.atoms.includes(phrase.unit) && entry.phrases.some((entry) => entry.text === phrase.text),
    );
    if (!unit || !situation) throw new Error(`missing declared fixture source: ${phrase.unit}`);
    const spec = task(phrase.text);
    spec.metadata = {
      estate: {
        atoms: [unit.id],
        link: { span: unit.id, fp: unit.provenance.hash, relation: 'exercises', createdBy: 'generator' },
        act: actOfAtom(unit, map.atoms),
        from: {
          bank: situation.id,
          phrase: situation.phrases.findIndex((entry) => entry.text === phrase.text),
        },
      },
    };
    return {
      path: 'oracle-task.yaml',
      id: spec.id,
      atoms: [unit.id],
      testType: phrase.type,
      mode: 'live',
      complete: true,
      spec,
    };
  }

  for (const phrase of APPROVED_TASKS) {
    it(`requires the declared act for the approved ask: ${phrase.text}`, () => {
      const spec = declared(phrase);
      expect(approved).toContain(phrase.text);
      expect(holdsTask(spec, env, observed('done', [phrase.call]))).toBe(true);
      expect(
        holdsTask(spec, env, observed('done', [{ label: 'Bash', input: { command: 'echo wrong' } }])),
      ).toBe(false);
      expect(holdsTask(spec, env)).toBe(false);
    });

    it(`keeps gen.task.${phrase.type} green for its trace and rejects replaced asks and wrong acts`, async () => {
      const spec = declared(phrase);
      const suite: fixture.FixtureSuite = {
        work: ROOT,
        map: join(fixture.FIXTURE, 'approved.yaml'),
        specs: [spec],
        natives: [],
        report: {},
      };
      const mock = vi.spyOn(fixture, 'fixtureSuite').mockResolvedValue(suite);
      const trace = vi
        .spyOn(traces, 'observeOnFake')
        .mockResolvedValue(new Map([[spec.id, observed('done', [phrase.call])]]));
      try {
        expect((await taskFamily().evaluate(1)).get(`gen.task.${phrase.type}`)).toEqual({
          pass: true,
          detail: 'holds (1)',
        });
        trace.mockResolvedValue(
          new Map([[spec.id, observed('done', [{ label: 'Bash', input: { command: 'echo wrong' } }])]]),
        );
        expect((await taskFamily().evaluate(1)).get(`gen.task.${phrase.type}`)).toMatchObject({
          pass: false,
          detail: expect.stringContaining('does not show the act'),
        });
        trace.mockResolvedValue(new Map([[spec.id, observed('done', [phrase.call])]]));
        const replaced = structuredClone(spec);
        required(replaced.spec.blocks[0]).when = { user: 'Please do this: never guess a status.' };
        mock.mockResolvedValue({ ...suite, specs: [replaced] });
        expect((await taskFamily().evaluate(1)).get(`gen.task.${phrase.type}`)).toMatchObject({
          pass: false,
          detail: expect.stringContaining('asks hold no task'),
        });
      } finally {
        trace.mockRestore();
        mock.mockRestore();
      }
    });
  }

  it.each(['Say which folder this message belongs in.', 'Berthify the fictional inbox.'])(
    'accepts a declared ask only when its recorded act agrees: %s',
    (ask) => {
      const base = required(APPROVED_TASKS[1]);
      const spec = declared(base);
      required(spec.spec.blocks[0]).when = { user: ask };
      const local = envOf(
        map.atoms,
        { situations: [{ id: 'new-verb', atoms: spec.atoms, phrases: [{ text: ask, approved: true }] }] },
        { sessions: [] },
      );
      (spec.spec.metadata as { estate: Record<string, unknown> }).estate.from = {
        bank: 'new-verb',
        phrase: 0,
      };
      expect(holdsTask(spec, local, observed('done', [base.call]))).toBe(true);
      expect(holdsTask(spec, local, observed('done'))).toBe(false);
    },
  );

  it.each([
    'Fill',
    'Fill in',
    'Go',
    'Go through',
    'Say',
    'Never fill the report.',
    "Don't go through inbox/.",
    'Please handle this for me: the invoice is not in EUR.',
  ])('rejects an undeclared replacement even with the original correct trace: %s', (ask) => {
    const phrase = required(APPROVED_TASKS[0]);
    const spec = declared(phrase);
    required(spec.spec.blocks[0]).when = { user: ask };
    expect(holdsTask(spec, env, observed('done', [phrase.call]))).toBe(false);
  });
});
