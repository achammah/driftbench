import { describe, expect, it } from 'vitest';
import {
  buildLabelling,
  Cassette,
  DEFAULT_FAIL_AT,
  DEFAULT_LABELER_SPECS,
  DEFAULT_PASS_AT,
  margin,
  type Opinion,
  parseLabelerSpec,
  pointerScan,
  renderLedger,
  singleLabelling,
  stackedLabelling,
} from '../../src/pointer';
import { load, plantedDense, plantedYesNo } from './support';

// An invented harbour office: nothing here names a real estate.
const SETS = `labels:
  - set: duty
    description: What the harbour notes ask of a skipper.
    labels:
      - name: order
        description: A unit that tells the skipper what to do.
        atom: { kind: instruction, polarity: obligation }
      - name: remark
        description: A unit that only says how the quay is.
      - name: pair
        description: A unit that sets one act before another.
        target: required
        atom: { kind: gate }
`;
const [DUTY] = load(SETS);
if (!DUTY) throw new Error('no set');

describe('a labeler spec', () => {
  it('reads a class, a client and a model', () => {
    expect(parseLabelerSpec('system1:jev')).toEqual({ ok: true, spec: { cls: 'system1', client: 'jev' } });
    expect(parseLabelerSpec('system2:anthropic:claude-haiku-5-5')).toEqual({
      ok: true,
      spec: { cls: 'system2', client: 'anthropic', model: 'claude-haiku-5-5' },
    });
    expect(parseLabelerSpec('system1:openai-decisions:decide-1')).toMatchObject({
      ok: true,
      spec: { client: 'openai-decisions', model: 'decide-1' },
    });
  });

  it('reads an address and a path, which hold colons', () => {
    expect(parseLabelerSpec('system2:http:https://labels.example.test:8443/label')).toEqual({
      ok: true,
      spec: { cls: 'system2', client: 'http', target: 'https://labels.example.test:8443/label' },
    });
    expect(parseLabelerSpec('system1:module:./labeler.mjs')).toEqual({
      ok: true,
      spec: { cls: 'system1', client: 'module', target: './labeler.mjs' },
    });
  });

  it('refuses a missing class, a client of the other class, a bad address and a missing path', () => {
    expect(parseLabelerSpec('jev')).toMatchObject({ ok: false });
    expect(parseLabelerSpec('system2:jev')).toMatchObject({
      ok: false,
      message: expect.stringContaining('the clients of system2 are anthropic, http, module'),
    });
    expect(parseLabelerSpec('system1:anthropic')).toMatchObject({ ok: false });
    expect(parseLabelerSpec('system2:http:ftp://x')).toMatchObject({ ok: false });
    expect(parseLabelerSpec('system1:module:')).toMatchObject({ ok: false });
  });

  it('names the default stack by class', () => {
    expect(DEFAULT_LABELER_SPECS).toEqual(['system1:jev', 'system2:anthropic']);
  });
});

describe('building a labelling', () => {
  const env = {};
  const specs = (texts: readonly string[]) =>
    texts.map((text) => {
      const parsed = parseLabelerSpec(text);
      if (!parsed.ok) throw new Error(parsed.message);
      return parsed.spec;
    });

  it('builds the default stack for a replay with no key', async () => {
    const built = await buildLabelling(specs(DEFAULT_LABELER_SPECS), { env, record: false, cwd: '.' });
    if (!built.ok) throw new Error(built.message);
    expect(built.labelling.members.map((member) => [member.cls, member.id])).toEqual([
      ['system1', 'jev'],
      ['system2', 'anthropic'],
    ]);
    expect(built.labelling.members.every((member) => member.call === undefined)).toBe(true);
    expect(built.labelling.describe).toContain('system 1 jev');
    expect(built.labelling.describe).toContain(`pass at ${DEFAULT_PASS_AT}, fail at ${DEFAULT_FAIL_AT}`);
  });

  it('puts system 1 first, whatever the order of the specs', async () => {
    const built = await buildLabelling(specs(['system2:anthropic', 'system1:jev']), {
      env,
      record: false,
      cwd: '.',
    });
    if (!built.ok) throw new Error(built.message);
    expect(built.labelling.members.map((member) => member.cls)).toEqual(['system1', 'system2']);
  });

  it('asks for the keys of the labelers that cannot call, naming the variables', async () => {
    const built = await buildLabelling(specs(DEFAULT_LABELER_SPECS), { env, record: true, cwd: '.' });
    expect(built).toEqual({
      ok: false,
      message: expect.stringContaining('JEV_API_KEY and JEV_URL (or JEV_ROUTE)'),
    });
    const second = await buildLabelling(specs(DEFAULT_LABELER_SPECS), {
      env: { JEV_API_KEY: 'k', JEV_ROUTE: 'typesafe' },
      record: true,
      cwd: '.',
    });
    expect(second).toEqual({ ok: false, message: expect.stringContaining('ANTHROPIC_API_KEY') });
    const third = await buildLabelling(specs(DEFAULT_LABELER_SPECS), {
      env: { JEV_API_KEY: 'k', JEV_ROUTE: 'typesafe', ANTHROPIC_API_KEY: 'k2' },
      record: true,
      cwd: '.',
    });
    expect(third.ok).toBe(true);
  });

  it('never carries a key into the description or the hash', async () => {
    const built = await buildLabelling(specs(DEFAULT_LABELER_SPECS), {
      env: { JEV_API_KEY: 'jev-secret', JEV_ROUTE: 'typesafe', ANTHROPIC_API_KEY: 'anthropic-secret' },
      record: true,
      cwd: '.',
    });
    if (!built.ok) throw new Error(built.message);
    const text = JSON.stringify([built.labelling.describe, built.labelling.hash, built.labelling.members]);
    expect(text).not.toContain('secret');
  });

  it('refuses two labelers of one class, no labeler, and bounds that are not 0 to 1 with fail-at under pass-at', async () => {
    const two = await buildLabelling(specs(['system1:jev', 'system1:jev-unit']), {
      env,
      record: false,
      cwd: '.',
    });
    expect(two).toMatchObject({ ok: false });
    expect(await buildLabelling([], { env, record: false, cwd: '.' })).toMatchObject({ ok: false });
    const message = 'the bounds are numbers from 0 to 1, with fail-at under pass-at';
    const wide = await buildLabelling(specs(DEFAULT_LABELER_SPECS), {
      env,
      record: false,
      cwd: '.',
      passAt: 2,
    });
    expect(wide).toMatchObject({ ok: false, message });
    const crossed = await buildLabelling(specs(DEFAULT_LABELER_SPECS), {
      env,
      record: false,
      cwd: '.',
      passAt: 0.3,
      failAt: 0.3,
    });
    expect(crossed).toMatchObject({ ok: false, message });
  });

  it('needs a model for the OpenAI Decisions labeler, from the spec or the environment', async () => {
    const none = await buildLabelling(specs(['system1:openai-decisions']), { env, record: false, cwd: '.' });
    expect(none).toMatchObject({ ok: false, message: expect.stringContaining('OPENAI_DECISIONS_MODEL') });
    const fromEnv = await buildLabelling(specs(['system1:openai-decisions']), {
      env: { OPENAI_DECISIONS_MODEL: 'decide-1' },
      record: false,
      cwd: '.',
    });
    expect(fromEnv.ok).toBe(true);
  });

  it('changes the hash with the bounds, the threshold and the clients, and with nothing else', async () => {
    const hash = async (
      texts: readonly string[],
      over: { passAt?: number; failAt?: number; threshold?: number } = {},
    ) => {
      const built = await buildLabelling(specs(texts), { env, record: false, cwd: '.', ...over });
      if (!built.ok) throw new Error(built.message);
      return built.labelling.hash;
    };
    const base = await hash(DEFAULT_LABELER_SPECS);
    expect(await hash(DEFAULT_LABELER_SPECS)).toBe(base);
    expect(await hash(DEFAULT_LABELER_SPECS, { passAt: 0.8 })).not.toBe(base);
    expect(await hash(DEFAULT_LABELER_SPECS, { failAt: 0.2 })).not.toBe(base);
    expect(await hash(DEFAULT_LABELER_SPECS, { threshold: 0.5 })).not.toBe(base);
    expect(await hash(['system2:anthropic'])).not.toBe(base);
    expect(await hash(['system2:anthropic:claude-opus-5-5'])).not.toBe(await hash(['system2:anthropic']));
  });
});

describe('a stack decides as a cascade', () => {
  const first = plantedYesNo(() => ({}), [], { threshold: 0.4 });
  const second = plantedDense(() => []);
  const stack = stackedLabelling(first, second, { passAt: 0.6, failAt: 0.2 });

  const one = (label: string, p: Record<string, number>): Opinion => ({
    label,
    probabilities: p,
    source: 'aaaaaaaaaaaa',
  });
  const two = (label: string, target?: number): Opinion => ({
    label,
    ...(target === undefined ? {} : { target }),
    source: 'bbbbbbbbbbbb',
  });

  it('lets system 1 decide a unit it is sure of, whatever system 2 says', () => {
    // Sure of a label: 0.6 and above, with these bounds.
    expect(stack.decide([one('order', { order: 0.9, remark: 0.1 }), two('remark')], DUTY)).toMatchObject({
      label: 'order',
      by: 'system1',
    });
    expect(stack.decide([one('remark', { order: 0.1, remark: 0.6 }), two('order')], DUTY)).toMatchObject({
      label: 'remark',
      by: 'system1',
    });
    // Sure of no label: every probability under 0.2.
    expect(stack.decide([one('none', { order: 0.1, remark: 0.05 }), two('order')], DUTY)).toMatchObject({
      label: 'none',
      by: 'system1',
    });
  });

  it('hands a unit to system 2 when system 1 is between the bounds', () => {
    expect(stack.decide([one('order', { order: 0.45, remark: 0.1 }), two('remark')], DUTY)).toMatchObject({
      label: 'remark',
      by: 'system2',
    });
    expect(stack.decide([one('none', { order: 0.3, remark: 0.1 }), two('order')], DUTY)).toMatchObject({
      label: 'order',
      by: 'system2',
    });
    // Between the bounds, 0.2 included and 0.6 excluded: 0.2 goes to system 2, 0.6 is sure.
    expect(stack.decide([one('none', { order: 0.2, remark: 0 }), two('order')], DUTY)?.by).toBe('system2');
    expect(stack.decide([one('order', { order: 0.6, remark: 0 }), two('none')], DUTY)?.by).toBe('system1');
  });

  it('leaves a label that asks for a target to system 2, which alone can name the other end', () => {
    // System 1 was never asked about `pair`, so a sure `none` from it proves nothing about that label.
    const decision = stack.decide([one('none', { order: 0.01, remark: 0.01 }), two('pair', 7)], DUTY);
    expect(decision).toMatchObject({ label: 'pair', target: 7, by: 'system2' });
  });

  it('falls back to the one labeler that has an opinion', () => {
    expect(stack.decide([undefined, two('order')], DUTY)).toMatchObject({
      label: 'order',
      by: 'system2',
      fallback: true,
    });
    expect(stack.decide([one('order', { order: 0.5, remark: 0 }), undefined], DUTY)).toMatchObject({
      label: 'order',
      by: 'system1',
      fallback: true,
    });
    // A unit both labelers read is no fallback.
    expect(
      stack.decide([one('order', { order: 0.95, remark: 0 }), two('none')], DUTY)?.fallback,
    ).toBeUndefined();
    expect(stack.decide([undefined, undefined], DUTY)).toBeUndefined();
  });

  it('lists the cassette keys the label comes from', () => {
    expect(stack.decide([one('order', { order: 0.45, remark: 0 }), two('order')], DUTY)?.sources).toEqual([
      'aaaaaaaaaaaa',
      'bbbbbbbbbbbb',
    ]);
  });

  it('decides as the one labeler does when there is one', () => {
    const alone = singleLabelling(second);
    expect(alone.decide([two('order')], DUTY)).toMatchObject({ label: 'order', by: 'system2' });
    expect(alone.decide([undefined], DUTY)).toBeUndefined();
  });
});

describe('a stack in a scan', () => {
  const NOTES = [
    '# Quay',
    '',
    '- Coil the ropes on the red post',
    '- Name the skipper of every boat',
    '- Hang the lamp before dusk',
    '- The tide runs fast here',
    '- Lock the gate at night',
    '',
  ].join('\n');
  const setsText = SETS.replace(/ {6}- name: pair[\s\S]*$/, '');

  // System 1 is sure about three units, unsure about the rest; system 2 labels everything an order.
  const chances = (unit: { text: string }): Record<string, number> => {
    if (unit.text.startsWith('Coil')) return { order: 0.95, remark: 0.02 };
    if (unit.text.startsWith('Name')) return { order: 0.02, remark: 0.01 };
    if (unit.text.startsWith('The tide')) return { order: 0.1, remark: 0.9 };
    return { order: 0.4, remark: 0.3 };
  };
  const files = [{ path: 'quay.md', text: NOTES }];

  async function run(jobs: number) {
    const log: string[] = [];
    const cassette = new Cassette();
    const result = await pointerScan({
      files,
      sets: load(setsText),
      labelling: stackedLabelling(
        plantedYesNo(chances, log),
        plantedDense(
          (window) => window.units.map((unit) => ({ units: String(unit.n), label: 'order' })),
          log,
          { id: 'planted-d' },
        ),
        { passAt: 0.6, failAt: 0.2 },
      ),
      cassette,
      mode: 'record',
      jobs,
    });
    return { result, cassette, log };
  }

  it('labels each unit by the class that is sure, and system 2 for the rest', async () => {
    const { result } = await run(1);
    const byText = (prefix: string) => {
      const hit = result.labelled.find((item) => item.unit.text.startsWith(prefix));
      return hit ? [hit.label, hit.by] : undefined;
    };
    expect(byText('Coil')).toEqual(['order', 'system1']);
    // Sure of no label: no atom, but the ledger records who decided.
    expect(byText('Name')).toBeUndefined();
    const name = result.ledger.entries.find((entry) => entry.quote.startsWith('Name'));
    expect(name?.labels.duty).toMatchObject({ label: 'none', by: 'system1' });
    expect(byText('The tide')).toEqual(['remark', 'system1']);
    expect(byText('Hang')).toEqual(['order', 'system2']);
    expect(byText('Lock')).toEqual(['order', 'system2']);
    expect(result.decidedBy.system1).toBe(3);
    expect(result.decidedBy.system2).toBe(3);
    expect(result.unlabeled).toBe(0);
  });

  it('asks each labeler once per window and records the cassette keys of both', async () => {
    const { result, cassette, log } = await run(1);
    expect(log.sort()).toEqual(['quay.md#1:duty', 'quay.md#1:duty']);
    expect(cassette.entries.size).toBe(2);
    const hang = result.ledger.entries.find((entry) => entry.quote.startsWith('Hang'));
    const keys = [...cassette.entries.keys()].map((key) => key.slice(0, 12)).sort();
    expect(hang?.labels.duty?.source.replace('cassette:', '').split('+').sort()).toEqual(keys);
    expect(result.usage.map((entry) => [entry.cls, entry.calls])).toEqual([
      ['system1', 1],
      ['system2', 1],
    ]);
  });

  it('replays to the same ledger from the cassette, with both labelers able to call nothing', async () => {
    const { result, cassette } = await run(1);
    const replay = await pointerScan({
      files,
      sets: load(setsText),
      labelling: stackedLabelling(
        { ...plantedYesNo(chances), call: undefined },
        { ...plantedDense(() => [], [], { id: 'planted-d' }), call: undefined },
        { passAt: 0.6, failAt: 0.2 },
      ),
      cassette: Cassette.parse(cassette.render()),
      mode: 'replay',
    });
    expect(replay.calls).toBe(0);
    expect(renderLedger(replay.ledger)).toBe(renderLedger(result.ledger));
  });

  it('gives the same ledger with one request in flight and with four', async () => {
    const serial = await run(1);
    const parallel = await run(4);
    expect(renderLedger(parallel.result.ledger)).toBe(renderLedger(serial.result.ledger));
    expect(parallel.cassette.render()).toBe(serial.cassette.render());
  });

  it('re-labels a unit when the bounds change, from the same cassette', async () => {
    const { result, cassette } = await run(1);
    const stackWith = (bounds: { passAt: number; failAt: number }) =>
      stackedLabelling(
        { ...plantedYesNo(chances), call: undefined },
        { ...plantedDense(() => [], [], { id: 'planted-d' }), call: undefined },
        bounds,
      );
    const wide = await pointerScan({
      files,
      sets: load(setsText),
      labelling: stackWith({ passAt: 1, failAt: 0 }),
      cassette: Cassette.parse(cassette.render()),
      mode: 'replay',
      previous: result.ledger,
    });
    // With a pass-at of 1 and a fail-at of 0 no probability is sure: system 2 decides every unit, and the ledger label is replaced.
    expect(wide.carried).toBe(0);
    expect(wide.decidedBy).toEqual({ system1: 0, system2: 6 });
    expect(wide.labelled.every((item) => item.label === 'order' && item.by === 'system2')).toBe(true);
  });
});

describe('a stack that decides by margin', () => {
  const first = plantedYesNo(() => ({}), [], { threshold: 0.4 });
  const second = plantedDense(() => []);
  const stack = stackedLabelling(first, second, { passAt: 0.9, failAt: 0.1, marginCut: 0.65 });
  const one = (label: string, p: Record<string, number>): Opinion => ({
    label,
    probabilities: p,
    source: 'aaaaaaaaaaaa',
  });
  const two = (label: string): Opinion => ({ label, source: 'bbbbbbbbbbbb' });

  it('measures the margin over the labels and an implicit none, normalised', () => {
    // 0.9 + 0.05 asked, so none takes 0.05: the vector is 0.9, 0.05, 0.05.
    expect(margin({ order: 0.9, remark: 0.05 })).toEqual({ label: 'order', margin: expect.closeTo(0.85, 5) });
    // Nothing is likely: none leads with 0.96 against 0.02, a margin of 0.94.
    expect(margin({ order: 0.02, remark: 0.02 })).toEqual({ label: 'none', margin: expect.closeTo(0.94, 5) });
    // Two labels close together: a small margin.
    expect(margin({ order: 0.5, remark: 0.45 }).margin).toBeCloseTo(0.05, 5);
    // Both certain: the sum passes 1 and the vector is normalised.
    expect(margin({ order: 1, remark: 1 }).margin).toBe(0);
  });

  it('lets system 1 decide a clear unit, and system 2 every unit below the cut', () => {
    expect(stack.decide([one('order', { order: 0.9, remark: 0.05 }), two('remark')], DUTY)).toMatchObject({
      label: 'order',
      by: 'system1',
    });
    expect(stack.decide([one('none', { order: 0.5, remark: 0.45 }), two('remark')], DUTY)).toMatchObject({
      label: 'remark',
      by: 'system2',
    });
    // A unit nothing fits is clear: none, decided by system 1.
    expect(stack.decide([one('none', { order: 0.02, remark: 0.02 }), two('order')], DUTY)).toMatchObject({
      label: 'none',
      by: 'system1',
    });
  });

  it('is a labelling of its own: the cut is in the hash', () => {
    const other = stackedLabelling(first, second, { passAt: 0.9, failAt: 0.1, marginCut: 0.5 });
    const bounds = stackedLabelling(first, second, { passAt: 0.9, failAt: 0.1 });
    expect(new Set([stack.hash, other.hash, bounds.hash]).size).toBe(3);
    expect(stack.describe).toContain('margin cut 0.65');
  });
});
