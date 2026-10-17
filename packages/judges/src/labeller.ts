import { createHash } from 'node:crypto';

/** One nominal class. Names are compared exactly; descriptions participate in replay identity. */
export interface LabelDefinition {
  readonly name: string;
  readonly description: string;
}

export interface LabelSet {
  readonly name: string;
  readonly labels: readonly LabelDefinition[];
}

export interface LabellerRequest {
  readonly text: string;
  readonly labelSet: LabelSet;
  readonly context?: string;
}

/** `none` is a valid class; only null abstains. Other strings can be recorded but score invalid. */
export type LabellerAnswer = string | null;

export interface Labeller {
  readonly id: string;
  label(request: LabellerRequest): Promise<LabellerAnswer> | LabellerAnswer;
}

export interface LabellerScore {
  readonly total: number;
  readonly correct: number;
  readonly agreement: number;
  readonly kappa: number;
  readonly abstentions: number;
  readonly invalid: number;
  /** Valid class answers / all observations, including the implicit `none` class. */
  readonly coverage: number;
}

export interface LabellerReplayEntry {
  readonly request: LabellerRequest;
  readonly labellerId: string;
  readonly answer: LabellerAnswer;
}

function requireName(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${field} must be a nonblank string`);
  }
}

function labelNames(set: LabelSet): Set<string> {
  requireName(set.name, 'label set name');
  if (!Array.isArray(set.labels)) throw new TypeError('label set labels must be an array');
  if (set.labels.length === 0) throw new RangeError('label set must contain at least one label');
  const names = new Set<string>();
  for (const label of set.labels) {
    requireName(label?.name, 'label name');
    if (typeof label.description !== 'string') {
      throw new TypeError('label description must be a string');
    }
    if (names.has(label.name)) throw new TypeError(`duplicate label name: ${label.name}`);
    names.add(label.name);
  }
  // A set can explicitly describe `none`; otherwise it remains an implicit valid class.
  names.add('none');
  return names;
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** Order is significant because it is part of what the labeller sees. No text is normalized. */
export function labelSetHash(set: LabelSet): string {
  labelNames(set);
  return digest([
    'labeller-label-set-v1',
    set.name,
    set.labels.map(({ name, description }) => [name, description]),
  ]);
}

/** Full text, optional context, labeller identity and complete label-set content bind an answer. */
export function labellerRequestKey(request: LabellerRequest, labellerId: string): string {
  requireName(labellerId, 'labeller id');
  if (typeof request.text !== 'string') throw new TypeError('labeller text must be a string');
  if (request.context !== undefined && typeof request.context !== 'string') {
    throw new TypeError('labeller context must be a string when present');
  }
  return digest([
    'labeller-request-v1',
    labellerId,
    request.text,
    request.context ?? null,
    labelSetHash(request.labelSet),
  ]);
}

/**
 * Nominal Cohen kappa over every observation, including abstentions and invalid predictions.
 * Abstain and invalid are prediction-only categories with zero gold marginal. No label string
 * represents either category, so a real label can never collide with an internal sentinel.
 * Empty data and invalid gold throw. Perfect single-class agreement has finite kappa 1;
 * all abstentions or invalid predictions have agreement, coverage and kappa 0.
 */
export function scoreLabeller(
  gold: readonly string[],
  answers: readonly LabellerAnswer[],
  labelSet: LabelSet,
): LabellerScore {
  const names = labelNames(labelSet);
  if (!Array.isArray(gold) || !Array.isArray(answers)) {
    throw new TypeError('gold and answers must be arrays');
  }
  const total = gold.length;
  if (total === 0 || total !== answers.length) {
    throw new RangeError('gold and answers must have the same nonzero length');
  }
  const goldCounts = new Map<string, number>();
  const answerCounts = new Map<string, number>();
  let correct = 0;
  let abstentions = 0;
  let invalid = 0;
  for (let i = 0; i < total; i++) {
    const expected = gold[i];
    if (typeof expected !== 'string' || !names.has(expected)) {
      throw new TypeError(`invalid gold label at observation ${i}`);
    }
    goldCounts.set(expected, (goldCounts.get(expected) ?? 0) + 1);
    const answer = answers[i];
    if (answer === null) abstentions++;
    else if (typeof answer !== 'string' || !names.has(answer)) invalid++;
    else {
      answerCounts.set(answer, (answerCounts.get(answer) ?? 0) + 1);
      if (answer === expected) correct++;
    }
  }
  let chanceCount = 0;
  for (const [name, count] of goldCounts) chanceCount += count * (answerCounts.get(name) ?? 0);
  // Multiply (po - pe) / (1 - pe) by total² to avoid subtracting rounded proportions.
  const denominator = total * total - chanceCount;
  const kappa =
    denominator === 0 ? (correct === total ? 1 : 0) : (correct * total - chanceCount) / denominator;
  return {
    total,
    correct,
    agreement: correct / total,
    kappa,
    abstentions,
    invalid,
    coverage: (total - abstentions - invalid) / total,
  };
}

/**
 * Snapshots exact recordings into a deterministic, immutable player. A miss throws; there is
 * no live fallback. Repeated keys must agree, including when one recorded answer is null.
 */
export function createLabellerReplay(entries: readonly LabellerReplayEntry[], id: string): Labeller {
  requireName(id, 'labeller id');
  if (!Array.isArray(entries)) throw new TypeError('replay entries must be an array');
  const byKey = new Map<string, LabellerAnswer>();
  for (const entry of entries) {
    if (entry.answer !== null && typeof entry.answer !== 'string') {
      throw new TypeError('recorded labeller answer must be a string or null');
    }
    const key = labellerRequestKey(entry.request, entry.labellerId);
    if (byKey.has(key) && byKey.get(key) !== entry.answer) {
      throw new Error(`conflicting labeller recordings for key ${key}`);
    }
    byKey.set(key, entry.answer);
  }
  return Object.freeze({
    id,
    label(request: LabellerRequest): LabellerAnswer {
      const key = labellerRequestKey(request, id);
      if (!byKey.has(key)) throw new Error(`no labeller recording for ${id}, key ${key}`);
      return byKey.get(key) as LabellerAnswer;
    },
  });
}
