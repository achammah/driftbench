import { describe, expect, it } from 'vitest';
import {
  createLabellerReplay,
  type LabellerAnswer,
  type LabellerRequest,
  type LabelSet,
  labellerRequestKey,
  labelSetHash,
  scoreLabeller,
} from '../src/labeller';

const labels: LabelSet = {
  name: 'fictional parcels',
  labels: [
    { name: 'amber', description: 'The parcel has a triangular seal.' },
    { name: 'azure', description: 'The parcel has a circular seal.' },
  ],
};
const request: LabellerRequest = { text: 'Parcel Tavi has a triangular seal.', labelSet: labels };

describe('labeller agreement', () => {
  it('counts correct labels, raw agreement, coverage and nominal Cohen kappa', () => {
    expect(
      scoreLabeller(['amber', 'amber', 'azure', 'azure'], ['amber', 'azure', 'azure', 'azure'], labels),
    ).toEqual({ total: 4, correct: 3, agreement: 0.75, kappa: 0.5, abstentions: 0, invalid: 0, coverage: 1 });
  });

  it('uses both empirical marginals, including skewed labels', () => {
    const score = scoreLabeller(
      ['amber', 'amber', 'amber', 'azure', 'none'],
      ['amber', 'amber', 'azure', 'azure', 'none'],
      labels,
    );
    // po = 4/5; pe = (3*2 + 1*2 + 1*1)/25 = 9/25.
    expect(score.agreement).toBe(0.8);
    expect(score.kappa).toBeCloseTo(11 / 16, 12);
  });

  it('includes abstentions in the denominator and never rewards them', () => {
    expect(scoreLabeller(['amber', 'azure', 'none'], ['amber', null, null], labels)).toEqual({
      total: 3,
      correct: 1,
      agreement: 1 / 3,
      kappa: 0.25,
      abstentions: 2,
      invalid: 0,
      coverage: 1 / 3,
    });
    const all = scoreLabeller(['amber', 'azure', 'none'], [null, null, null], labels);
    expect(all).toMatchObject({ correct: 0, agreement: 0, kappa: 0, abstentions: 3, coverage: 0 });
  });

  it('distinguishes the none label from abstention and accepts an explicit none definition', () => {
    expect(scoreLabeller(['none', 'amber'], ['none', null], labels)).toMatchObject({
      correct: 1,
      agreement: 0.5,
      abstentions: 1,
      invalid: 0,
    });
    const explicit = { ...labels, labels: [...labels.labels, { name: 'none', description: 'No seal.' }] };
    expect(scoreLabeller(['none'], ['none'], explicit).kappa).toBe(1);
  });

  it('counts invalid strings without trimming, case folding, or coercion', () => {
    const bad = ['', 'unknown', 'Amber', ' amber', 'none ', undefined, {}, 1] as unknown as LabellerAnswer[];
    expect(
      scoreLabeller(
        bad.map(() => 'amber'),
        bad,
        labels,
      ),
    ).toEqual({
      total: 8,
      correct: 0,
      agreement: 0,
      kappa: 0,
      abstentions: 0,
      invalid: 8,
      coverage: 0,
    });
  });

  it('does not reserve a string label for missing or invalid answers', () => {
    const hostile: LabelSet = {
      name: 'sentinel-like names',
      labels: ['__abstain__', '__invalid__', 'null', '-1', 'constructor', '__proto__'].map((name) => ({
        name,
        description: name,
      })),
    };
    const gold = hostile.labels.map(({ name }) => name);
    expect(scoreLabeller(gold, gold, hostile).kappa).toBe(1);
    expect(
      scoreLabeller(
        gold,
        gold.map(() => null),
        hostile,
      ),
    ).toMatchObject({ correct: 0, kappa: 0 });
    expect(
      scoreLabeller(
        gold,
        gold.map(() => ''),
        hostile,
      ),
    ).toMatchObject({ correct: 0, kappa: 0 });
  });

  it('defines degenerate perfect agreement and preserves negative kappa', () => {
    expect(scoreLabeller(['amber'], ['amber'], labels).kappa).toBe(1);
    expect(scoreLabeller(['amber', 'amber'], ['amber', 'amber'], labels).kappa).toBe(1);
    expect(scoreLabeller(['amber', 'azure'], ['azure', 'amber'], labels).kappa).toBe(-1);
    expect(scoreLabeller(['amber', 'azure'], ['amber', 'amber'], labels).kappa).toBe(0);
  });

  it('rejects empty, unequal, unknown and missing gold observations', () => {
    expect(() => scoreLabeller([], [], labels)).toThrow();
    expect(() => scoreLabeller(['amber'], [], labels)).toThrow();
    expect(() => scoreLabeller(['unknown'], ['amber'], labels)).toThrow();
    expect(() => scoreLabeller([null] as unknown as string[], [null], labels)).toThrow();
    expect(() => scoreLabeller(new Array<string>(1), [null], labels)).toThrow();
  });

  it('matches a direct contingency-table oracle for every three-observation answer vector', () => {
    const gold = ['amber', 'azure', 'none'];
    const candidates: LabellerAnswer[] = ['amber', 'azure', 'none', null, ''];
    for (const a of candidates)
      for (const b of candidates)
        for (const c of candidates) {
          const answers = [a, b, c];
          const po = gold.filter((label, i) => label === answers[i]).length / 3;
          const pe =
            gold.reduce((sum, label) => sum + answers.filter((answer) => answer === label).length, 0) / 9;
          const score = scoreLabeller(gold, answers, labels);
          expect(score.agreement).toBe(po);
          expect(score.kappa).toBeCloseTo((po - pe) / (1 - pe), 12);
        }
  });
});

describe('labeller keys', () => {
  it('hashes normalized fields with SHA-256 independent of object property insertion order', () => {
    const reordered = {
      labels: labels.labels.map(({ name, description }) => ({ description, name })),
      name: labels.name,
    };
    expect(labelSetHash(labels)).toMatch(/^[a-f0-9]{64}$/);
    expect(labelSetHash(reordered)).toBe(labelSetHash(labels));
    expect(labellerRequestKey(request, 'script')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('separates label names, definitions, order, additions, removals and set identity', () => {
    const changes: LabelSet[] = [
      { ...labels, name: 'other set' },
      { ...labels, labels: [...labels.labels].reverse() },
      { ...labels, labels: labels.labels.slice(1) },
      { ...labels, labels: [...labels.labels, { name: 'violet', description: 'Square seal.' }] },
      { ...labels, labels: labels.labels.map((label, i) => (i ? label : { ...label, name: 'golden' })) },
      {
        ...labels,
        labels: labels.labels.map((label, i) => (i ? label : { ...label, description: 'Square seal.' })),
      },
    ];
    for (const labelSet of changes) {
      expect(labelSetHash(labelSet)).not.toBe(labelSetHash(labels));
      expect(labellerRequestKey({ ...request, labelSet }, 'script')).not.toBe(
        labellerRequestKey(request, 'script'),
      );
    }
  });

  it('includes complete text, context, identity, and distinguishes absent from empty context', () => {
    const key = labellerRequestKey(request, 'script');
    for (const other of [
      { ...request, text: `${request.text}\n` },
      { ...request, context: '' },
      { ...request, context: 'read the seal' },
      { ...request, text: `${'x'.repeat(100_000)}a` },
      { ...request, text: `${'x'.repeat(100_000)}b` },
    ])
      expect(labellerRequestKey(other, 'script')).not.toBe(key);
    expect(labellerRequestKey({ ...request, text: `${'x'.repeat(100_000)}a` }, 'script')).not.toBe(
      labellerRequestKey({ ...request, text: `${'x'.repeat(100_000)}b` }, 'script'),
    );
    expect(labellerRequestKey(request, 'other')).not.toBe(key);
    expect(labellerRequestKey({ ...request, context: undefined }, 'script')).toBe(key);
  });

  it('uses structured encoding rather than concatenating fields', () => {
    expect(labellerRequestKey({ ...request, text: 'a', context: 'b:c' }, 'script')).not.toBe(
      labellerRequestKey({ ...request, text: 'a:b', context: 'c' }, 'script'),
    );
  });

  it.each([
    { ...labels, labels: [] },
    { ...labels, labels: [{ name: '', description: 'x' }] },
    { ...labels, labels: [{ name: '  ', description: 'x' }] },
    { ...labels, labels: [labels.labels[0], labels.labels[0]] },
    { ...labels, labels: [{ name: 'amber', description: null }] },
  ])('rejects malformed label definitions %#', (set) => {
    expect(() => labelSetHash(set as LabelSet)).toThrow();
    expect(() => scoreLabeller(['amber'], ['amber'], set as LabelSet)).toThrow();
  });

  it('rejects invalid request fields without trusting JSON omission or coercion', () => {
    expect(() =>
      labellerRequestKey({ ...request, text: undefined } as unknown as LabellerRequest, 'script'),
    ).toThrow();
    expect(() =>
      labellerRequestKey({ ...request, context: null } as unknown as LabellerRequest, 'script'),
    ).toThrow();
    expect(() => labellerRequestKey(request, '')).toThrow();
  });
});

describe('labeller replay', () => {
  it('replays exact keys repeatedly, including none, abstain and invalid recorded strings', async () => {
    for (const answer of ['amber', 'none', null, ''] as const) {
      const replay = createLabellerReplay([{ request, labellerId: 'script', answer }], 'script');
      expect(replay.id).toBe('script');
      for (let i = 0; i < 5; i++) expect(await replay.label(structuredClone(request))).toBe(answer);
    }
  });

  it('throws on an unseen request or a changed label definition with no fallback', async () => {
    const replay = createLabellerReplay([{ request, labellerId: 'script', answer: 'amber' }], 'script');
    const changed = {
      ...labels,
      labels: labels.labels.map((label) => ({ ...label, description: `${label.description}!` })),
    };
    for (const other of [
      { ...request, text: 'another parcel' },
      { ...request, labelSet: changed },
      { ...request, context: 'new' },
    ]) {
      await expect(async () => replay.label(other)).rejects.toThrow(/recording|replay|key/i);
    }
    await expect(async () => createLabellerReplay([], 'script').label(request)).rejects.toThrow();
    await expect(async () =>
      createLabellerReplay([{ request, labellerId: 'other', answer: 'amber' }], 'script').label(request),
    ).rejects.toThrow();
  });

  it('accepts identical duplicate recordings but rejects conflicting same-key answers', async () => {
    const entry = { request, labellerId: 'script', answer: 'amber' };
    expect(await createLabellerReplay([entry, structuredClone(entry)], 'script').label(request)).toBe(
      'amber',
    );
    expect(() => createLabellerReplay([entry, { ...entry, answer: null }], 'script')).toThrow(/conflict/i);
    expect(() => createLabellerReplay([{ ...entry, answer: null }, entry], 'script')).toThrow(/conflict/i);
  });

  it('snapshots mutable recordings and exposes a stable replay identity', async () => {
    const entry = { request: structuredClone(request), labellerId: 'script', answer: 'amber' };
    const entries = [entry];
    const replay = createLabellerReplay(entries, 'script');
    entry.answer = 'azure';
    Object.assign(entry.request, { text: 'mutated' });
    entries.length = 0;
    expect(await replay.label(request)).toBe('amber');
    expect(Reflect.set(replay, 'id', 'other')).toBe(false);
    expect(replay.id).toBe('script');
  });

  it('rejects non-string non-null recorded answers before they can mutate on replay', () => {
    expect(() =>
      createLabellerReplay(
        [{ request, labellerId: 'script', answer: {} as unknown as LabellerAnswer }],
        'script',
      ),
    ).toThrow();
  });
});
