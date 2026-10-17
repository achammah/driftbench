import { readFileSync, writeFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { type FixtureSuite, fixtureSuite, type SuiteSpec } from '../../src/ladders/estate/bank/fixture-suite';
import { holdsTask, taskFamily } from '../../src/ladders/estate/bank/genquality';
import { type AskEnv, checkAsk } from '../../src/ladders/estate/bank/task-check';
import { envOfSuite, taskFamilyV2 } from '../../src/ladders/estate/bank/taskv2';

// TEMPORARY: removed in the commit that deletes version 1. Measures v1 and v2 side by side (V_OUT=<file> writes the numbers).
type Meta = Record<string, unknown>;
const metaOf = (spec: SuiteSpec): Meta => (spec.spec.metadata as { estate: Meta }).estate;
const blockOf = (spec: SuiteSpec) =>
  (spec.spec.blocks as Array<{ when: { user: string } }>)[0] as { when: { user: string } };
const OUT = process.env.V_OUT;

let suite: FixtureSuite;
let env: AskEnv;
beforeAll(async () => {
  suite = await fixtureSuite();
  env = await envOfSuite(suite);
}, 300_000);

it('measures', async () => {
  const report: Record<string, unknown> = {};
  const v1 = await taskFamily().evaluate(1);
  const v2 = await taskFamilyV2().evaluate(1);
  report.suiteV1 = Object.fromEntries([...v1].map(([id, r]) => [id, r.pass ? 'pass' : r.detail]));
  report.suiteV2 = Object.fromEntries([...v2].map(([id, r]) => [id, r.pass ? 'pass' : r.detail]));
  const corpus = JSON.parse(
    readFileSync(new URL('./fixtures/planted-asks.json', import.meta.url), 'utf8'),
  ) as { classes: Record<string, string[]> };
  const asks = Object.entries(corpus.classes).flatMap(([cls, list]) => list.map((ask) => ({ cls, ask })));
  const live = suite.specs.filter((s) => s.complete && s.mode === 'live' && s.path.endsWith('.yaml'));
  const coded = live.filter((s) => 'form' in ((metaOf(s).from as Meta | undefined) ?? {}));
  const banked = live.filter((s) => 'bank' in ((metaOf(s).from as Meta | undefined) ?? {}));
  const withAsk = (base: SuiteSpec, ask: string, from?: Meta) => {
    const spec = structuredClone(base);
    blockOf(spec).when.user = ask;
    if (from) Object.assign(metaOf(spec).from as Meta, from);
    return spec;
  };
  const byClass: Record<string, Record<string, number>> = {};
  const bump = (cls: string, key: string) => {
    byClass[cls] ??= {};
    byClass[cls][key] = (byClass[cls][key] ?? 0) + 1;
  };
  let adversarial = 0;
  report.acceptedAsks = [] as string[];
  for (const [index, { cls, ask }] of asks.entries()) {
    bump(cls, 'n');
    if (!holdsTask(ask)) bump(cls, 'v1Rejects');
    const nosrc = withAsk(live[index % live.length] as SuiteSpec, ask);
    delete (metaOf(nosrc) as Meta).from;
    if (checkAsk(nosrc, env).reasons.length > 0) bump(cls, 'v2F1');
    if (checkAsk(withAsk(coded[index % coded.length] as SuiteSpec, ask), env).reasons.length > 0)
      bump(cls, 'v2F2');
    if (checkAsk(withAsk(banked[index % banked.length] as SuiteSpec, ask), env).reasons.length > 0)
      bump(cls, 'v2F2bank');
    const piece = ask.replace(/[.!?]+$/, '');
    const f3 = coded.filter((b) => {
      const form = String((metaOf(b).from as Meta).form);
      return form !== 'hazard' && form !== 'user prompt';
    });
    const first = withAsk(f3[index % f3.length] as SuiteSpec, `Please ${piece}.`, { pieces: [piece] });
    if (checkAsk(first, env).reasons.length > 0) bump(cls, 'v2F3');
    // Adversarial: the best of every coded spec as a host for the garbage piece.
    const accepted = f3.some(
      (b) => checkAsk(withAsk(b, `Please ${piece}.`, { pieces: [piece] }), env).reasons.length === 0,
    );
    if (accepted) {
      adversarial += 1;
      (report.acceptedAsks as string[] | undefined)?.push(ask);
    }
  }
  report.corpus = byClass;
  report.adversarialAccepted = adversarial;
  report.coded = coded.length;
  if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2));
  const total = (key: string) => Object.values(byClass).reduce((sum, row) => sum + (row[key] ?? 0), 0);
  // Version 1 fails six items of the suite and accepts 39 of the 161 planted asks; version 2 passes the suite
  // and rejects all 161 in each of three plants (no source, text replaced, garbage recorded as the piece).
  expect([...v1.values()].filter((entry) => !entry.pass).length).toBe(6);
  expect([...v2.values()].filter((entry) => !entry.pass).length).toBe(0);
  expect(total('n')).toBe(161);
  expect(total('v1Rejects')).toBe(122);
  for (const key of ['v2F1', 'v2F2', 'v2F2bank', 'v2F3']) expect(total(key), key).toBe(161);
  // A garbage piece that is a fragment of the estate's own text ties to it: the four the best host accepts.
  expect(adversarial).toBeLessThanOrEqual(4);
}, 900_000);
