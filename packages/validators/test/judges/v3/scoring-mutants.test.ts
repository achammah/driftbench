import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { LabellerRequest, LabelSet } from '@agent-nexus/driftbench-judges';
import * as judges from '@agent-nexus/driftbench-judges';
import ts from 'typescript';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { labellerBank } from '../../../src/ladders/judges/v3/bank';

/**
 * Independent section-12.7 audit. Production files never change: transpile an
 * in-memory source copy, replace one expression, and inject its real exports.
 * Edge witnesses prove activation separately from bank-item losses. A unit
 * witness alone never counts as a bank kill.
 */
type Subject = Pick<
  typeof judges,
  'scoreLabeller' | 'labelSetHash' | 'labellerRequestKey' | 'createLabellerReplay'
>;
type Mutation = {
  name: string;
  from: string;
  to: string;
  witness: (subject: Subject) => void | Promise<void>;
};
const SET: LabelSet = {
  name: 'synthetic',
  labels: [
    { name: 'a', description: 'First category.' },
    { name: 'b', description: 'Second category.' },
  ],
};
const REQUEST: LabellerRequest = { text: 'sample', context: 'context', labelSet: SET };
const scorer =
  (gold: string[], answers: (string | null)[], expected: Partial<ReturnType<Subject['scoreLabeller']>>) =>
  (subject: Subject) => {
    const actual = subject.scoreLabeller(gold, answers, SET);
    for (const [key, value] of Object.entries(expected)) {
      expect(actual[key as keyof typeof actual], key).toBeCloseTo(value, 12);
    }
  };
const changedKey =
  (change: (request: LabellerRequest) => LabellerRequest, nextId = 'reader') =>
  async (subject: Subject) => {
    const next = change(structuredClone(REQUEST));
    expect(subject.labellerRequestKey(next, nextId)).not.toBe(subject.labellerRequestKey(REQUEST, 'reader'));
    const replay = subject.createLabellerReplay(
      [{ request: REQUEST, labellerId: 'reader', answer: 'a' }],
      nextId,
    );
    await expect(async () => replay.label(next)).rejects.toThrow();
  };

const mutations: Mutation[] = [
  {
    name: 'Cohen kappa replaced by raw agreement',
    from: 'denominator === 0 ? (correct === total ? 1 : 0) : (correct * total - chanceCount) / denominator',
    to: 'correct / total',
    witness: scorer(['a', 'a', 'a', 'b'], ['a', 'a', 'b', 'b'], { agreement: 0.75, kappa: 0.5 }),
  },
  {
    name: 'chance denominator uses n instead of n squared',
    from: 'const denominator = total * total - chanceCount;',
    to: 'const denominator = total - chanceCount;',
    witness: scorer(['a', 'a', 'b', 'b'], ['a', 'a', 'b', 'b'], { kappa: 1 }),
  },
  {
    name: 'chance uses gold marginal twice',
    from: 'chanceCount += count * (answerCounts.get(name) ?? 0)',
    to: 'chanceCount += count * (goldCounts.get(name) ?? 0)',
    witness: scorer(['a', 'a', 'a', 'b'], ['a', 'a', 'b', 'b'], { kappa: 0.5 }),
  },
  {
    name: 'chance denominator excludes abstentions',
    from: 'const denominator = total * total - chanceCount;',
    to: 'const denominator = (total - abstentions) ** 2 - chanceCount;',
    witness: scorer(['a', 'b', 'a', 'b'], ['a', 'b', null, null], { kappa: 1 / 3 }),
  },
  {
    name: 'raw agreement denominator excludes abstentions',
    from: 'agreement: correct / total,',
    to: 'agreement: correct / (total - abstentions),',
    witness: scorer(['a', 'b', 'a', 'b'], ['a', 'b', null, null], { agreement: 0.5 }),
  },
  {
    name: 'abstentions count as agreement',
    from: 'if (answer === null) abstentions++;',
    to: 'if (answer === null) { abstentions++; correct++; }',
    witness: scorer(['a', 'b'], ['a', null], { correct: 1, agreement: 0.5 }),
  },
  {
    name: 'none observations excluded',
    from: 'const names = labelNames(labelSet);',
    to: "answers = answers.filter((_, i) => gold[i] !== 'none'); gold = gold.filter((value) => value !== 'none'); const names = labelNames(labelSet);",
    witness: scorer(['a', 'none', 'b'], ['a', 'none', 'b'], { total: 3, correct: 3 }),
  },
  {
    name: 'invalid answer count omitted',
    from: "else if (typeof answer !== 'string' || !names.has(answer)) invalid++;",
    to: "else if (typeof answer !== 'string' || !names.has(answer)) void 0;",
    witness: scorer(['a', 'b'], ['a', 'outside'], { invalid: 1, coverage: 0.5 }),
  },
  {
    name: 'invalid answers counted as abstentions',
    from: "else if (typeof answer !== 'string' || !names.has(answer)) invalid++;",
    to: "else if (typeof answer !== 'string' || !names.has(answer)) abstentions++;",
    witness: scorer(['a', 'b'], ['a', 'outside'], { invalid: 1, abstentions: 0 }),
  },
  {
    name: 'invalid answers count as covered',
    from: 'coverage: (total - abstentions - invalid) / total,',
    to: 'coverage: (total - abstentions) / total,',
    witness: scorer(['a', 'b'], ['a', 'outside'], { coverage: 0.5 }),
  },
  {
    name: 'negative kappa clamped to zero',
    from: '    kappa,',
    to: '    kappa: Math.max(0, kappa),',
    witness: scorer(['a', 'b'], ['b', 'a'], { kappa: -1 }),
  },
  {
    name: 'perfect single-class kappa becomes zero',
    from: 'denominator === 0 ? (correct === total ? 1 : 0)',
    to: 'denominator === 0 ? 0',
    witness: scorer(['a', 'a'], ['a', 'a'], { kappa: 1 }),
  },
  {
    name: 'cache and replay key omit text',
    from: '    request.text,',
    to: '    null,',
    witness: changedKey((request) => ({ ...request, text: 'changed' })),
  },
  {
    name: 'cache and replay key omit context',
    from: '    request.context ?? null,',
    to: '    null,',
    witness: changedKey((request) => ({ ...request, context: 'changed' })),
  },
  {
    name: 'cache and replay key omit labeller identity',
    from: '    labellerId,',
    to: '    null,',
    witness: changedKey((request) => request, 'other-reader'),
  },
  {
    name: 'label hash and replay omit label names',
    from: 'set.labels.map(({ name, description }) => [name, description])',
    to: 'set.labels.map(({ description }) => [description])',
    witness: changedKey((request) => ({
      ...request,
      labelSet: {
        ...request.labelSet,
        labels: request.labelSet.labels.map((label, i) => (i === 0 ? { ...label, name: 'changed' } : label)),
      },
    })),
  },
  {
    name: 'label hash and replay omit definitions',
    from: 'set.labels.map(({ name, description }) => [name, description])',
    to: 'set.labels.map(({ name }) => [name])',
    witness: changedKey((request) => ({
      ...request,
      labelSet: {
        ...request.labelSet,
        labels: request.labelSet.labels.map((label, i) =>
          i === 0 ? { ...label, description: 'changed' } : label,
        ),
      },
    })),
  },
  {
    name: 'label hash and replay discard label order',
    from: 'set.labels.map(({ name, description }) => [name, description])',
    to: '[...set.labels].sort((a, b) => a.name.localeCompare(b.name)).map(({ name, description }) => [name, description])',
    witness: changedKey((request) => ({
      ...request,
      labelSet: { ...request.labelSet, labels: [...request.labelSet.labels].reverse() },
    })),
  },
  {
    name: 'label hash and replay omit set name',
    from: '    set.name,',
    to: '    null,',
    witness: changedKey((request) => ({ ...request, labelSet: { ...request.labelSet, name: 'changed' } })),
  },
  {
    name: 'replay miss falls back to none',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Exact source anchor preserves template placeholders.
    from: 'if (!byKey.has(key)) throw new Error(`no labeller recording for ${id}, key ${key}`);',
    to: "if (!byKey.has(key)) return 'none';",
    witness: async (subject) => {
      const replay = subject.createLabellerReplay([], 'reader');
      await expect(async () => replay.label(REQUEST)).rejects.toThrow();
    },
  },
];

const sourcePath = fileURLToPath(new URL('../../../../judges/src/labeller.ts', import.meta.url));
const source = readFileSync(sourcePath, 'utf8');
const bankSource = readFileSync(new URL('../../../src/ladders/judges/v3/bank.ts', import.meta.url), 'utf8');
const require = createRequire(import.meta.url);
function isolatedCopy(text: string): Subject {
  const compiled = ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
    reportDiagnostics: true,
  });
  expect(compiled.diagnostics?.filter((d) => d.category === ts.DiagnosticCategory.Error)).toEqual([]);
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled.outputText)(require, module, module.exports);
  return module.exports as Subject;
}

const bank = labellerBank();
const seed = 71;
const observations: {
  name: string;
  edgeKilled: boolean;
  called: number;
  lost: string[];
  firstDetail?: string;
}[] = [];
const baseline = new Map<string, boolean>();
afterEach(() => vi.restoreAllMocks());

beforeAll(async () => {
  expect(mutations).toHaveLength(20);
  const pristine = isolatedCopy(source);
  for (const mutation of mutations) await mutation.witness(pristine);
  for (const item of bank) {
    const result = await item.run(seed);
    expect(result.pass, `${item.id}: ${result.detail}`).toBe(true);
    baseline.set(item.id, result.pass);
  }
}, 60_000);

afterAll(() => {
  const killed = observations.filter((row) => row.edgeKilled && row.called > 0 && row.lost.length > 0).length;
  writeFileSync(
    '/tmp/astra-judges-mutants.md',
    [
      '# Independent planted-bug audit',
      '',
      `| Check | Verdict | Note |`,
      `|---|---|---|`,
      `| planted bugs | ${killed === 20 && baseline.size === bank.length ? 'pass' : 'fail'} | ${killed}/20 bank kills; ${baseline.size}/${bank.length} baseline items pass at seed ${seed}. |`,
      '',
      `Production source SHA-256: ${createHash('sha256').update(source).digest('hex')}.`,
      `Bank source SHA-256: ${createHash('sha256').update(bankSource).digest('hex')}.`,
      `Measured: ${new Date().toISOString()}.`,
      '',
      'Method: one exact source mutation per isolated in-memory implementation; no production writes. All four public exports are injected into the actual bank with spies. Each independent edge witness first passes on the unchanged compiled copy, then must fail on the mutant. Calls and bank-item losses are measured separately.',
      '',
      '| Mutation | Edge witness killed | Calls through injected exports | Bank items lost | First lost item |',
      '|---|---|---:|---:|---|',
      ...observations.map(
        (row) =>
          `| ${row.name} | ${row.edgeKilled} | ${row.called} | ${row.lost.length} | ${row.lost[0] ?? 'SURVIVED'} |`,
      ),
      '',
      ...observations.filter((row) => row.firstDetail).map((row) => `- ${row.name}: ${row.firstDetail}`),
      '',
      'Command: `/private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad/slots/run.sh pnpm exec vitest run packages/validators/test/judges/v3/scoring-mutants.test.ts --maxWorkers=2 --reporter=verbose`.',
      '',
      'Scope: deterministic labellerBank at the reported seed and the explicit edge witnesses; no live models, private data, word lists, or commits. This is not the full four-part hardness audit.',
    ].join('\n'),
  );
});

describe('independent source-copy scoring and replay mutants', () => {
  it.each(mutations)(
    '$name loses a real bank item and its independent edge witness',
    async (mutation) => {
      expect(source.split(mutation.from).length - 1, 'exactly one mutation site').toBe(1);
      const changed = source.replace(mutation.from, mutation.to);
      expect(changed).not.toBe(source);
      const mutant = isolatedCopy(changed);
      let edgeKilled = false;
      try {
        await mutation.witness(mutant);
      } catch {
        edgeKilled = true;
      }
      const row: (typeof observations)[number] = { name: mutation.name, edgeKilled, called: 0, lost: [] };
      observations.push(row);
      for (const key of [
        'scoreLabeller',
        'labelSetHash',
        'labellerRequestKey',
        'createLabellerReplay',
      ] as const) {
        // The runtime wrapper preserves each concrete function's argument list.
        const implementation = mutant[key] as (...args: unknown[]) => unknown;
        vi.spyOn(judges, key).mockImplementation(((...args: unknown[]) => {
          row.called += 1;
          return implementation(...args);
        }) as never);
      }
      for (const item of bank) {
        const result = await item.run(seed);
        if (baseline.get(item.id) && !result.pass) {
          row.lost.push(item.id);
          row.firstDetail ??= result.detail;
        }
      }
      expect(row.edgeKilled, 'mutation must alter its independent edge witness').toBe(true);
      expect(row.called, 'bank must call the injected implementation').toBeGreaterThan(0);
      expect(row.lost, `SURVIVOR: ${mutation.name}; unit kills are not bank kills`).not.toEqual([]);
    },
    60_000,
  );
});
