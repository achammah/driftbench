import {
  createLabellerReplay,
  type LabellerRequest,
  type LabelSet,
  labellerRequestKey,
  labelSetHash,
  scoreLabeller,
} from '@agent-nexus/driftbench-judges';
import { describe, expect, it } from 'vitest';

// Blind contract tests: no implementation, validator bank, or builder handoff
// was read. The fractions below are derived directly from contingency counts.
const SET: LabelSet = {
  name: 'synthetic-choice',
  labels: [
    { name: 'a', description: 'First synthetic category.' },
    { name: 'b', description: 'Second synthetic category.' },
    { name: 'none', description: 'No category applies; this is a real label.' },
  ],
};

function request(): LabellerRequest {
  return {
    text: 'Synthetic sample without any hidden label.',
    labelSet: structuredClone(SET),
    context: 'Synthetic context.',
  };
}

describe('blind adversarial labeller scoring', () => {
  it('keeps abstentions in the denominator and chance marginals', () => {
    const score = scoreLabeller(['a', 'b', 'a', 'b'], ['a', 'b', null, null], SET);
    expect(score).toMatchObject({
      total: 4,
      correct: 2,
      agreement: 0.5,
      abstentions: 2,
      invalid: 0,
      coverage: 0.5,
    });
    // p_o = 1/2; p_e = (2*1 + 2*1)/16 = 1/4.
    expect(score.kappa).toBeCloseTo(1 / 3, 12);
  });

  it('counts empty and unsupported answers as invalid disagreements', () => {
    const score = scoreLabeller(['a', 'b', 'a', 'b'], ['a', 'b', '', 'outside'], SET);
    expect(score).toMatchObject({
      total: 4,
      correct: 2,
      agreement: 0.5,
      abstentions: 0,
      invalid: 2,
      coverage: 0.5,
    });
    expect(score.kappa).toBeCloseTo(1 / 3, 12);
  });

  it('does not turn null into the legitimate none label', () => {
    const score = scoreLabeller(['none', 'none', 'a', 'b'], [null, 'none', 'a', 'b'], SET);
    expect(score).toMatchObject({
      total: 4,
      correct: 3,
      agreement: 0.75,
      abstentions: 1,
      invalid: 0,
      coverage: 0.75,
    });
    // p_e = (2*1 + 1*1 + 1*1)/16 = 1/4.
    expect(score.kappa).toBeCloseTo(2 / 3, 12);
  });

  it('returns zero agreement, coverage, and kappa when every answer abstains', () => {
    expect(scoreLabeller(['a', 'a', 'b'], [null, null, null], SET)).toMatchObject({
      total: 3,
      correct: 0,
      agreement: 0,
      kappa: 0,
      abstentions: 3,
      invalid: 0,
      coverage: 0,
    });
  });

  it('does not drop an entirely invalid run', () => {
    expect(scoreLabeller(['a', 'a', 'b'], ['', 'outside', ' '], SET)).toMatchObject({
      total: 3,
      correct: 0,
      agreement: 0,
      kappa: 0,
      abstentions: 0,
      invalid: 3,
      coverage: 0,
    });
  });

  it('does not trim or case-fold an unsupported answer into a label', () => {
    const score = scoreLabeller(['a', 'a', 'a'], [' a', 'a ', 'A'], SET);
    expect(score).toMatchObject({ correct: 0, invalid: 3, coverage: 0, kappa: 0 });
  });

  it('rejects empty gold instead of reporting vacuous perfection', () => {
    expect(() => scoreLabeller([], [], SET)).toThrow();
  });

  it('rejects a truncated answer array', () => {
    expect(() => scoreLabeller(['a', 'b'], ['a'], SET)).toThrow();
  });

  it('rejects surplus answers instead of silently zipping', () => {
    expect(() => scoreLabeller(['a'], ['a', 'b'], SET)).toThrow();
  });

  it('rejects unsupported gold even if the answer repeats it', () => {
    expect(() => scoreLabeller(['outside'], ['outside'], SET)).toThrow();
  });

  it('rejects empty label names instead of making an empty answer valid', () => {
    const set: LabelSet = { name: 'empty-name', labels: [{ name: '', description: 'Malformed category.' }] };
    expect(() => scoreLabeller([''], [''], set)).toThrow();
    expect(() => labelSetHash(set)).toThrow();
  });

  it('rejects duplicate label names with conflicting descriptions', () => {
    const set: LabelSet = {
      name: 'duplicates',
      labels: [
        { name: 'a', description: 'First meaning.' },
        { name: 'a', description: 'Conflicting meaning.' },
      ],
    };
    expect(() => scoreLabeller(['a'], ['a'], set)).toThrow();
    expect(() => labelSetHash(set)).toThrow();
  });

  it('rejects a set without categories', () => {
    const set: LabelSet = { name: 'empty', labels: [] };
    expect(() => scoreLabeller(['a'], ['a'], set)).toThrow();
    expect(() => labelSetHash(set)).toThrow();
  });

  it('uses the declared perfect single-class kappa convention', () => {
    expect(scoreLabeller(['a', 'a', 'a'], ['a', 'a', 'a'], SET)).toMatchObject({
      total: 3,
      correct: 3,
      agreement: 1,
      kappa: 1,
      coverage: 1,
    });
  });

  it('does not assign perfect kappa to a partially answered single-class run', () => {
    expect(scoreLabeller(['a', 'a'], ['a', null], SET)).toMatchObject({ agreement: 0.5, kappa: 0 });
  });

  it('exposes a majority-only predictor despite ninety percent raw agreement', () => {
    const gold = [...Array<string>(9).fill('a'), 'b'];
    const score = scoreLabeller(gold, Array<string>(10).fill('a'), SET);
    expect(score.agreement).toBe(0.9);
    expect(score.kappa).toBeCloseTo(0, 12);
  });

  it('uses both imbalanced marginals rather than a uniform chance baseline', () => {
    const gold = [...Array<string>(9).fill('a'), 'b'];
    const answers = [...Array<string>(8).fill('a'), 'b', 'b'];
    const score = scoreLabeller(gold, answers, SET);
    expect(score.agreement).toBe(0.9);
    // p_e = (9*8 + 1*2)/100 = 74/100; k = 16/26.
    expect(score.kappa).toBeCloseTo(8 / 13, 12);
  });

  it('keeps an abstention in an imbalanced chance calculation', () => {
    const score = scoreLabeller(['a', 'a', 'a', 'b'], ['a', 'a', null, 'b'], SET);
    // p_e = (3*2 + 1*1)/16 = 7/16; k = (12-7)/(16-7).
    expect(score.agreement).toBe(0.75);
    expect(score.kappa).toBeCloseTo(5 / 9, 12);
  });

  it('preserves negative kappa under complete binary reversal', () => {
    expect(scoreLabeller(['a', 'b', 'a', 'b'], ['b', 'a', 'b', 'a'], SET)).toMatchObject({
      agreement: 0,
      kappa: -1,
      coverage: 1,
    });
  });

  it('computes the multiclass cyclic-disagreement fraction', () => {
    const score = scoreLabeller(['a', 'b', 'none'], ['b', 'none', 'a'], SET);
    // p_e = 3/9; k = (0 - 1/3)/(1 - 1/3).
    expect(score.kappa).toBeCloseTo(-0.5, 12);
  });

  it('is invariant to joint row permutation but not independently sorted answers', () => {
    const score = scoreLabeller(['a', 'a', 'b', 'b'], ['a', 'b', 'a', null], SET);
    expect(scoreLabeller(['b', 'a', 'b', 'a'], ['a', 'a', null, 'b'], SET)).toEqual(score);
    expect(score.correct).toBe(1);
    expect(score.kappa).toBeCloseTo(-0.2, 12);
  });

  it.each(['__abstain__', '__invalid__', 'null', 'undefined', '__proto__', 'constructor'])(
    'keeps a real label named %s separate from missing-answer sentinels and object internals',
    (name) => {
      const set: LabelSet = {
        name: 'sentinel-probe',
        labels: [{ name, description: 'A legitimate synthetic category.' }],
      };
      expect(scoreLabeller([name], [name], set)).toMatchObject({ correct: 1, kappa: 1, coverage: 1 });
      expect(scoreLabeller([name], [null], set)).toMatchObject({
        correct: 0,
        kappa: 0,
        abstentions: 1,
        coverage: 0,
      });
      expect(scoreLabeller([name], ['outside'], set)).toMatchObject({
        correct: 0,
        kappa: 0,
        invalid: 1,
        coverage: 0,
      });
    },
  );

  it('keeps canonically equivalent Unicode labels distinct', () => {
    const composed = '\u00e9';
    const decomposed = 'e\u0301';
    const set: LabelSet = {
      name: 'unicode',
      labels: [
        { name: composed, description: 'Composed token.' },
        { name: decomposed, description: 'Decomposed token.' },
      ],
    };
    expect(scoreLabeller([composed, decomposed], [decomposed, composed], set)).toMatchObject({
      correct: 0,
      kappa: -1,
      invalid: 0,
      coverage: 1,
    });
  });
});

describe('blind adversarial label identity and replay', () => {
  it('is stable under cloning and object property insertion order', () => {
    const original = request();
    const reordered: LabellerRequest = {
      context: original.context,
      labelSet: {
        labels: original.labelSet.labels.map(({ name, description }) => ({ description, name })),
        name: original.labelSet.name,
      },
      text: original.text,
    };
    expect(labelSetHash(structuredClone(SET))).toBe(labelSetHash(SET));
    expect(labellerRequestKey(reordered, 'reader')).toBe(labellerRequestKey(original, 'reader'));
  });

  it('hashes label descriptions, names, set names, and label order', () => {
    const variants: LabelSet[] = [
      { ...SET, name: `${SET.name}-other` },
      { ...SET, labels: SET.labels.map((label, i) => (i === 0 ? { ...label, name: 'different' } : label)) },
      {
        ...SET,
        labels: SET.labels.map((label, i) =>
          i === 0 ? { ...label, description: 'Changed meaning.' } : label,
        ),
      },
      { ...SET, labels: [...SET.labels].reverse() },
    ];
    const base = labelSetHash(SET);
    expect(new Set([base, ...variants.map(labelSetHash)]).size).toBe(5);
    const original = request();
    const key = labellerRequestKey(original, 'reader');
    for (const labelSet of variants)
      expect(labellerRequestKey({ ...original, labelSet }, 'reader')).not.toBe(key);
  });

  it('keys text, context, and labeller identity independently', () => {
    const original = request();
    const keys = [
      labellerRequestKey(original, 'reader'),
      labellerRequestKey({ ...original, text: `${original.text}!` }, 'reader'),
      labellerRequestKey({ ...original, context: 'Other context.' }, 'reader'),
      labellerRequestKey(original, 'other-reader'),
    ];
    expect(new Set(keys).size).toBe(4);
  });

  it('does not collapse Unicode normalization or whitespace in request text', () => {
    const original = request();
    const keys = ['\u00e9', 'e\u0301', '\u00e9 ', ' \u00e9'].map((text) =>
      labellerRequestKey({ ...original, text }, 'reader'),
    );
    expect(new Set(keys).size).toBe(4);
  });

  it('cannot collide by shifting delimiters between request fields', () => {
    const original = request();
    const keys = [
      labellerRequestKey({ ...original, text: 'x|y', context: 'z' }, 'reader'),
      labellerRequestKey({ ...original, text: 'x', context: 'y|z' }, 'reader'),
      labellerRequestKey({ ...original, text: 'x\u0000y', context: 'z' }, 'reader'),
      labellerRequestKey({ ...original, text: 'x', context: 'y\u0000z' }, 'reader'),
    ];
    expect(new Set(keys).size).toBe(4);
  });

  it('replays a recorded null separately from a recorded none label', async () => {
    const one = request();
    const two = { ...request(), text: 'Another synthetic sample.' };
    const replay = createLabellerReplay(
      [
        { request: one, labellerId: 'reader', answer: null },
        { request: two, labellerId: 'reader', answer: 'none' },
      ],
      'reader',
    );
    expect(await replay.label(structuredClone(one))).toBeNull();
    expect(await replay.label(structuredClone(two))).toBe('none');
  });

  it('does not let another labeller overwrite the same request recording', async () => {
    const original = request();
    const replay = createLabellerReplay(
      [
        { request: original, labellerId: 'reader', answer: 'a' },
        { request: original, labellerId: 'other-reader', answer: 'b' },
      ],
      'reader',
    );
    expect(await replay.label(original)).toBe('a');
  });

  it('snapshots replay keys before caller-owned nested inputs mutate', async () => {
    const source = request();
    const original = {
      text: source.text,
      context: source.context,
      labelSet: {
        name: source.labelSet.name,
        labels: source.labelSet.labels.map((label) => ({ ...label })),
      },
    };
    const snapshot = structuredClone(original);
    const replay = createLabellerReplay([{ request: original, labellerId: 'reader', answer: 'a' }], 'reader');
    original.text = 'Changed after construction.';
    original.context = 'Changed after construction.';
    const firstLabel = original.labelSet.labels[0];
    if (!firstLabel) throw new Error('missing test label');
    firstLabel.description = 'Changed after construction.';
    expect(await replay.label(snapshot)).toBe('a');
    await expect(async () => replay.label(original)).rejects.toThrow();
  });

  it('refuses to use a recording with the same text but different context', async () => {
    const original = request();
    const replay = createLabellerReplay([{ request: original, labellerId: 'reader', answer: 'a' }], 'reader');
    await expect(async () => replay.label({ ...original, context: 'Unrecorded context.' })).rejects.toThrow();
  });
});
