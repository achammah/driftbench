import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Observed } from '@agent-nexus/driftbench-core';
import type { Atom } from '@agent-nexus/driftbench-estate';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { stringify } from 'yaml';
import { type FixtureSuite, fixtureSuite, type SuiteSpec } from '../../src/ladders/estate/bank/fixture-suite';
import { actOfAtom } from '../../src/ladders/estate/bank/task-act';
import { type AskEnv, checkAsk, checkTrace, envOf } from '../../src/ladders/estate/bank/task-check';
import * as fakeTrace from '../../src/ladders/estate/bank/task-trace';
import { envOfSuite, judgeSpecs, TASK_TYPES, taskFamilyV2 } from '../../src/ladders/estate/bank/taskv2';
import { estateRun } from '../../src/ladders/estate/pipeline';

/**
 * gen.task reads ids, structure and the trace of the fake agent, never the words of an ask. The planted asks
 * below are hand-written and fictional; none is a phrase of a bank. A planted spec is a real spec of the suite
 * with the ask, the record or the source changed, so each test names the one thing it breaks.
 */

type Meta = Record<string, unknown>;
const metaOf = (spec: SuiteSpec): Meta => (spec.spec.metadata as { estate: Meta }).estate;
const blockOf = (spec: SuiteSpec) =>
  (spec.spec.blocks as Array<{ when: { user: string } }>)[0] as { when: { user: string } };
const askOf = (spec: SuiteSpec): string => blockOf(spec).when.user;

let suite: FixtureSuite;
let env: AskEnv;
let live: SuiteSpec[];
let work: string;
let declaredCode: SuiteSpec[];

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), 'astra-askwords-task-v2-'));
  suite = await fixtureSuite();
  env = await envOfSuite(suite);
  live = suite.specs.filter((spec) => spec.complete && spec.mode === 'live' && spec.path.endsWith('.yaml'));
  const sourceAtoms: Atom[] = [
    {
      id: 'skill.fixture.chart',
      kind: 'skill',
      fields: { name: 'chart-clerk' },
      title: 'berthify the fictional chart',
    },
    {
      id: 'reference.fixture.manifest',
      kind: 'reference',
      fields: { path: 'fixture-manifest.md' },
      title: 'manifestify the fictional ledger',
    },
    {
      id: 'subagent.fixture.harbour',
      kind: 'subagent',
      fields: { name: 'harbour-clerk' },
      title: 'quayscope the fictional harbour',
    },
  ].map((entry) => ({
    ...entry,
    approved: true,
    producedBy: 'code',
    role: 'axis',
    enforcement: [],
    evidence: [],
    provenance: { file: `${entry.id}.md`, startLine: 1, endLine: 1, quote: entry.title, hash: entry.id },
  })) as Atom[];
  for (const atom of sourceAtoms)
    atom.fields = { ...atom.fields, ask: { text: atom.title, act: actOfAtom(atom, sourceAtoms) } };
  env = envOf([...env.atoms, ...sourceAtoms], env.bank, env.sessions);
  const base = live[0];
  if (!base) throw new Error('fixture has no complete live spec');
  declaredCode = [];
  for (const atom of sourceAtoms) {
    const spec = await plant(
      base,
      atom.id,
      {
        unit: atom.id,
        ask: `Please ${atom.title}.`,
        meta: {
          from: {
            form: 'structured ask',
            field: `${atom.id}#structured ask`,
            fp: atom.provenance.hash,
            frame: 'trigger',
            shape: '{}',
            pieces: [atom.title],
          },
        },
      },
      env,
    );
    spec.testType = 'obligation';
    expect(checkAsk(spec, env).reasons, atom.id).toEqual([]);
    declaredCode.push(spec);
  }
  live.push(...declaredCode);
}, 300_000);

afterAll(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

/** A copy of a real spec with another ask, record or source; the file is written so the fake can run it. */
async function plant(
  base: SuiteSpec,
  name: string,
  change: { ask?: string; unit?: string; meta?: Meta },
  where: AskEnv = env,
): Promise<SuiteSpec> {
  const spec = structuredClone(base.spec) as SuiteSpec['spec'];
  const meta = (spec.metadata as { estate: Meta }).estate;
  if (change.unit) {
    const atom = where.byId.get(change.unit);
    if (!atom) throw new Error(`no atom ${change.unit}`);
    meta.atoms = [change.unit];
    meta.link = { span: atom.id, fp: atom.provenance.hash, relation: 'exercises', createdBy: 'generator' };
    meta.act = actOfAtom(atom, where.atoms);
  }
  Object.assign(meta, change.meta ?? {});
  const block = blockOf({ ...base, spec });
  if (change.ask !== undefined) block.when.user = change.ask;
  const dir = join(work, 'planted');
  await mkdir(dir, { recursive: true });
  const id = `planted.${name}`;
  spec.id = id;
  const text = stringify(spec);
  const path = join(dir, `${name}.yaml`);
  await writeFile(path, text);
  return { ...base, id, path, atoms: change.unit ? [change.unit] : base.atoms, spec };
}

/** The test bank with one more situation: what a person approved for the planted unit. */
function withPhrase(unit: string, phrase: string, id: string): AskEnv {
  const bank = structuredClone(env.bank) as typeof env.bank & { situations: Array<Record<string, unknown>> };
  bank.situations.push({ id, atoms: [unit], phrases: [{ text: phrase, approved: true }] });
  return envOf(env.atoms, bank, env.sessions);
}

describe('the Northwind suite', () => {
  it('classifies every item from the complete static and actual-fake evidence inventory', async () => {
    const family = taskFamilyV2();
    const originalObserve = fakeTrace.observeOnFake;
    const seen = new Map<string, Observed>();
    const observe = vi.spyOn(fakeTrace, 'observeOnFake').mockImplementation(async (paths) => {
      const result = await originalObserve(paths);
      for (const [id, trace] of result) seen.set(id, trace);
      return result;
    });
    try {
      const results = await family.evaluate(1);
      expect(results.size).toBe(TASK_TYPES.length);
      expect([...results.keys()]).toEqual(family.items.map((item) => item.id));
      for (const type of TASK_TYPES) {
        const own = suite.specs.filter((spec) => spec.complete && spec.testType === type);
        const failed = own.filter((spec) => {
          const checked = checkAsk(spec, env);
          return (
            checked.reasons.length > 0 ||
            (checked.trace !== undefined && checkTrace(checked.trace, seen.get(spec.id)) !== undefined)
          );
        });
        const result = results.get(`gen.task.v2.${type}`);
        expect(result?.pass, type).toBe(own.length > 0 && failed.length === 0);
        if (own.length === 0) expect(result?.detail).toBe(`no complete ${type} spec`);
        else if (failed.length > 0)
          expect(result?.detail).toContain(`${failed.length} of ${own.length} asks hold no task`);
        else expect(result?.detail).toBe(`holds (${own.length})`);
      }
    } finally {
      observe.mockRestore();
    }
  }, 600_000);

  it('retains linked source and act checks on every complete spec, including every declared fixture source', () => {
    const asked = suite.specs.filter((spec) => spec.complete && spec.path.endsWith('.yaml'));
    expect(asked.length).toBeGreaterThan(0);
    for (const spec of asked) {
      const meta = metaOf(spec);
      expect(meta.link, spec.id).toBeDefined();
      expect(meta.from, spec.id).toBeDefined();
      expect(meta.act, spec.id).toBeDefined();
      // Legacy fixture failures are enumerated by the inventory above, never called green by assumption.
      const checked = checkAsk(spec, env);
      if (checked.reasons.length === 0) expect(checked.trace, spec.id).toBeDefined();
      else expect(checked.trace, spec.id).toBeUndefined();
    }
    expect(declaredCode).toHaveLength(3);
    for (const spec of declaredCode) expect(checkAsk(spec, env).reasons, spec.id).toEqual([]);
  });
});

describe('an explicit ask is held to the trace of the fake', () => {
  let base: SuiteSpec;
  beforeAll(() => {
    const found = live.find((spec) =>
      JSON.stringify(spec.spec.given ?? {}).includes('invoices/INV-1001.json'),
    );
    if (!found) throw new Error('no base spec with the world');
    base = found;
  });

  const GOOD: Array<[string, string, string]> = [
    ['read', 'reference.standing.read-claude-memory-memory-md', 'Read `.claude/memory/MEMORY.md`.'],
    [
      'script',
      'script.shipment-tracker.script-scripts-track-sh',
      'Execute `.claude/skills/shipment-tracker/scripts/track.sh NW-55012 DPX`.',
    ],
    ['helper', 'subagent.inbox-triager.helper-inbox-triager', 'Delegate `inbox-triager`.'],
  ];

  it('accepts a request that names its act in a code span and makes the fake do it', async () => {
    const bank = structuredClone(env.bank) as typeof env.bank & {
      situations: Array<Record<string, unknown>>;
    };
    for (const [name, unit, ask] of GOOD)
      bank.situations.push({
        id: `planted-${name}`,
        atoms: [unit],
        phrases: [{ text: ask, approved: true }],
      });
    const where = envOf(env.atoms, bank, env.sessions);
    const specs: SuiteSpec[] = [];
    for (const [name, unit, ask] of GOOD)
      specs.push(
        await plant(base, name, { unit, ask, meta: { from: { bank: `planted-${name}`, phrase: 0 } } }, where),
      );
    for (const verdict of await judgeSpecs(specs, where)) expect(verdict.reasons, verdict.id).toEqual([]);
  }, 300_000);

  it('rejects an ask that names another act than the unit makes', async () => {
    const wrong = await plant(
      base,
      'wrong-act',
      {
        unit: 'guard.settings.pretooluse-bash-guard-block-force-push',
        ask: 'Run `git status`.',
        meta: { from: { form: 'rule', field: 'guard.settings.pretooluse-bash-guard-block-force-push#rule' } },
      },
      env,
    );
    const [verdict] = await judgeSpecs([wrong], env);
    expect(verdict?.reasons.join(' ')).toContain('no target of the act');
  }, 300_000);

  it('rejects an explicit ask whose act the trace does not show', async () => {
    // The helper is named in a code span, but the ask does not make the fake dispatch it: the span is a path.
    const lost = await plant(
      base,
      'not-shown',
      { unit: 'subagent.route-planner.helper-route-planner', ask: 'Please note `route-planner` for later.' },
      env,
    );
    const phrased = withPhrase(
      'subagent.route-planner.helper-route-planner',
      'Please note `route-planner` for later.',
      'planted-note',
    );
    const spec = { ...lost, spec: structuredClone(lost.spec) };
    (spec.spec.metadata as { estate: Meta }).estate.from = { bank: 'planted-note', phrase: 0 };
    const [verdict] = await judgeSpecs([spec], phrased);
    expect(verdict?.reasons.join(' ')).toContain('does not show the act');
  }, 300_000);
});

describe('an ask with no source, a wrong record or a restated rule is rejected', () => {
  const base = () => {
    const found = declaredCode[0];
    if (!found) throw new Error('no code-written spec');
    return found;
  };

  it('has no source', async () => {
    const spec = await plant(base(), 'no-source', { meta: { from: undefined } });
    expect(checkAsk(spec, env).reasons.join(' ')).toContain('names no source');
  });

  it('cites an atom the map does not hold, or a stale fingerprint', async () => {
    const real = base();
    const from = metaOf(real).from as Meta;
    const gone = await plant(real, 'gone', { meta: { from: { ...from, field: 'skill.gone.x#title' } } });
    expect(checkAsk(gone, env).reasons.join(' ')).toContain('does not hold');
    const stale = await plant(real, 'stale', { meta: { from: { ...from, fp: '0'.repeat(64) } } });
    expect(checkAsk(stale, env).reasons.join(' ')).toContain('fingerprint');
  });

  it('names a form the generator does not have', async () => {
    const real = base();
    const spec = await plant(real, 'form', {
      meta: { from: { ...(metaOf(real).from as Meta), form: 'invented' } },
    });
    expect(checkAsk(spec, env).reasons.join(' ')).toContain('no form of the generator');
  });

  it('links another unit than the row tests, or writes another act', async () => {
    const real = base();
    const link = { ...(metaOf(real).link as Meta), span: 'skill.invoice-reconcile.skill-invoice-reconcile' };
    const other = await plant(real, 'other-link', { meta: { link } });
    expect(checkAsk(other, env).reasons).toContain(
      `the link names ${link.span}, the row tests ${real.atoms[0]}`,
    );
    const act = await plant(real, 'lower-act', { meta: { act: { kind: 'reply' } } });
    const expected = actOfAtom(env.byId.get(String((metaOf(real).link as Meta).span)) as never, env.atoms);
    if (expected.kind !== 'reply') expect(checkAsk(act, env).reasons.join(' ')).toContain('the spec says');
  });

  it('is a phrase of another unit than the row tests', async () => {
    const bankSpec = live.find((spec) => metaOf(spec).from && 'bank' in (metaOf(spec).from as Meta));
    if (!bankSpec) throw new Error('no bank spec');
    const own = metaOf(bankSpec).from as { bank: string };
    const decoy = env.bank.situations.find(
      (situation) =>
        situation.id !== own.bank &&
        !situation.atoms.some((id) => (metaOf(bankSpec).atoms as string[]).includes(id)) &&
        situation.phrases.some((phrase) => phrase.approved !== false),
    );
    expect(decoy).toBeDefined();
    const text = decoy?.phrases.find((phrase) => phrase.approved !== false)?.text ?? '';
    const index = decoy?.phrases.findIndex((phrase) => phrase.text === text) ?? 0;
    const swapped = await plant(bankSpec, 'decoy', {
      ask: text,
      meta: { from: { bank: decoy?.id, phrase: index } },
    });
    expect(checkAsk(swapped, env).reasons.join(' ')).toContain('lists none of the atoms of the row');
    const edited = await plant(bankSpec, 'edited', { ask: `${askOf(bankSpec)} Thanks.` });
    expect(checkAsk(edited, env).reasons.join(' ')).toContain('not an approved phrase');
  });

  it('restates a rule of the estate, even as an approved phrase', async () => {
    const rule = env.atoms.find((atom) => atom.id === 'gate.standing.never-report-done-before-verify-passed');
    expect(rule).toBeDefined();
    const real = base();
    const unit = (metaOf(real).atoms as string[])[0] as string;
    const ask = `Please do this: ${rule?.title.toLowerCase()}.`;
    const where = withPhrase(unit, ask, 'planted-restated');
    const spec = await plant(real, 'restated', {
      ask,
      meta: { from: { bank: 'planted-restated', phrase: 0 } },
    });
    expect(checkAsk(spec, where).reasons.join(' ')).toContain('restates the rule');
    // Words of the rule in another order, with the negation dropped, are not a restatement.
    const other = withPhrase(unit, 'Please report the result of the check.', 'planted-act');
    const act = await plant(real, 'act', {
      ask: 'Please report the result of the check.',
      meta: { from: { bank: 'planted-act', phrase: 0 } },
    });
    expect(checkAsk(act, other).reasons.join(' ')).not.toContain('restates the rule');
  });
});

describe('asks planted in real specs', () => {
  const corpus = JSON.parse(
    readFileSync(new URL('./fixtures/planted-asks.json', import.meta.url), 'utf8'),
  ) as { classes: Record<string, string[]> };
  const asks = Object.entries(corpus.classes).flatMap(([cls, list]) => list.map((ask) => ({ cls, ask })));

  it('plants 161 asks', () => {
    expect(asks.length).toBe(161);
  });

  it('rejects each one planted in a spec that carries no source', async () => {
    const bases = live.filter((spec) => metaOf(spec).from);
    for (const [index, { ask }] of asks.entries()) {
      const spec = await plant(bases[index % bases.length] as SuiteSpec, `nosrc-${index}`, {
        ask,
        meta: { from: undefined },
      });
      expect(checkAsk(spec, env).reasons.length, ask).toBeGreaterThan(0);
    }
  }, 600_000);

  it('rejects each one planted in a code-written spec whose record is intact', async () => {
    const bases = live.filter((spec) => {
      const from = metaOf(spec).from as Meta | undefined;
      return from && 'form' in from && checkAsk(spec, env).reasons.length === 0;
    });
    expect(bases).toEqual(expect.arrayContaining(declaredCode));
    const kept: string[] = [];
    for (const [index, { ask }] of asks.entries()) {
      const spec = await plant(bases[index % bases.length] as SuiteSpec, `intact-${index}`, { ask });
      if (checkAsk(spec, env).reasons.length === 0) kept.push(ask);
    }
    expect(kept).toEqual([]);
  }, 600_000);

  it('rejects each one written by a generator that records the planted text as its piece', async () => {
    // The record is intact and its citation true; the piece the generator claims is not made of the cited atom.
    const bases = live.filter((spec) => {
      const from = metaOf(spec).from as Meta | undefined;
      return (
        from &&
        'form' in from &&
        from.form !== 'hazard' &&
        from.frame !== 'verbatim' &&
        checkAsk(spec, env).reasons.length === 0
      );
    });
    expect(bases).toEqual(expect.arrayContaining(declaredCode));
    const kept: string[] = [];
    for (const [index, { ask }] of asks.entries()) {
      const piece = ask.replace(/[.!?]+$/, '');
      const spec = await plant(bases[index % bases.length] as SuiteSpec, `piece-${index}`, {
        ask: `Please ${piece}.`,
      });
      Object.assign(metaOf(spec).from as Meta, {
        frame: 'trigger',
        shape: '{}',
        pieces: [piece],
        context: undefined,
      });
      if (checkAsk(spec, env).reasons.length === 0) kept.push(ask);
    }
    expect(kept).toEqual([]);
  }, 600_000);

  it('rejects every planted piece against every valid code host, with no accepted-fragment allowance', () => {
    const hosts = live.filter((spec) => {
      const from = metaOf(spec).from as Meta | undefined;
      return (
        from &&
        'form' in from &&
        from.form !== 'hazard' &&
        from.frame !== 'verbatim' &&
        checkAsk(spec, env).reasons.length === 0
      );
    });
    expect(hosts).toEqual(expect.arrayContaining(declaredCode));
    const accepted: Array<{ ask: string; host: string }> = [];
    for (const { ask } of asks) {
      const piece = ask.replace(/[.!?]+$/, '');
      for (const host of hosts) {
        const planted = structuredClone(host);
        blockOf(planted).when.user = `Please ${piece}.`;
        Object.assign(metaOf(planted).from as Meta, {
          frame: 'trigger',
          shape: '{}',
          pieces: [piece],
          context: undefined,
        });
        if (checkAsk(planted, env).reasons.length === 0) accepted.push({ ask, host: host.id });
      }
    }
    expect(accepted).toEqual([]);
  }, 600_000);

  it('rejects each one planted in a spec whose ask came from a bank', async () => {
    const bases = live.filter((spec) => {
      const from = metaOf(spec).from as Meta | undefined;
      return from && 'bank' in from;
    });
    expect(bases.length).toBeGreaterThan(50);
    const kept: string[] = [];
    for (const [index, { ask }] of asks.entries()) {
      const spec = await plant(bases[index % bases.length] as SuiteSpec, `bank-${index}`, { ask });
      if (checkAsk(spec, env).reasons.length === 0) kept.push(ask);
    }
    expect(kept).toEqual([]);
  }, 600_000);
});

describe('asks of a drawn estate are held to the phrase of their unit', () => {
  it.each([1, 2, 3])(
    'seed %i: every bank ask is the phrase of a situation that lists its unit',
    async (seed) => {
      const run = await estateRun(seed);
      const drawn = envOf(run.scanned.map.atoms, run.bank, run.sessions);
      const specs: SuiteSpec[] = run.specs
        .filter((entry) => entry.record.complete && entry.loaded)
        .map((entry) => ({
          id: entry.record.id,
          path: entry.record.path,
          atoms: entry.record.atoms,
          testType: entry.record.testType,
          mode: entry.record.mode,
          complete: true,
          spec: (entry.loaded as { spec: SuiteSpec['spec'] }).spec,
        }));
      const banked = specs.filter((spec) => {
        const from = metaOf(spec).from as Meta | undefined;
        return from && 'bank' in from;
      });
      expect(banked.length).toBeGreaterThan(20);
      for (const spec of banked) expect(checkAsk(spec, drawn).reasons, spec.id).toEqual([]);
      // A phrase planted for another unit is a decoy by construction: the same spec with it must fail.
      let tried = 0;
      for (const spec of banked) {
        const own = metaOf(spec).from as { bank: string };
        const rowAtoms = metaOf(spec).atoms as string[];
        const decoy = drawn.bank.situations.find(
          (situation) =>
            situation.id !== own.bank &&
            !situation.atoms.some((id) => rowAtoms.includes(id)) &&
            situation.phrases.length > 0,
        );
        if (!decoy) continue;
        const swapped = structuredClone(spec);
        blockOf(swapped).when.user = decoy.phrases[0]?.text ?? '';
        (metaOf(swapped).from as Meta).bank = decoy.id;
        (metaOf(swapped).from as Meta).phrase = 0;
        expect(checkAsk(swapped, drawn).reasons.length, spec.id).toBeGreaterThan(0);
        tried += 1;
        if (tried >= 40) break;
      }
      expect(tried).toBeGreaterThan(10);
    },
    600_000,
  );
});
