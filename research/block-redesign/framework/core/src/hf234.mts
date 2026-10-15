// HF2 to HF4 on the 259 stored H1 runs. Run from the worktree root:
//   tsx --tsconfig research/block-redesign/framework/core/tsconfig.json research/block-redesign/framework/core/src/hf234.mts
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { tools as mainToolsCheck } from '../../../../../packages/checks/src/checks/tools.ts';
import { blockCacheKey } from '../../../../../packages/core/src/runner/cache.ts';
import { canonicalGiven, resolveGiven } from '../../../../../packages/core/src/runner/given.ts';
import { contentHash } from '../../../../../packages/core/src/spec/hash.ts';
import { loadSpecFile } from '../../../../../packages/core/src/spec/load.ts';
import { isZero } from '../../../../../packages/core/src/spec/semantics.ts';
import { LoadError, ObjectStore } from './objects.ts';
import { type Call, type Expect, failedGating, implRegistry, type Resolution, resolveScoring, score, type Verdict } from './rescore.ts';
import { ExtSpec, parseRaw, validateWith } from './spec-ext.ts';

const here = resolve(import.meta.dirname, '..');
const objects = resolve(here, 'objects');

// The ten H1 blocks: spec and 0-based block index, from research/block-phrasing src/blocks.ts at 58669be07.
const BLOCKS: Record<string, { spec: string; index: number }> = {
  B1: { spec: 'examples/acme/specs/conversations/new-customer-coverage.yaml', index: 1 },
  B2: { spec: 'examples/acme/specs/conversations/new-customer-coverage.yaml', index: 3 },
  B3: { spec: 'examples/acme/specs/conversations/number-porting.yaml', index: 1 },
  B4: { spec: 'examples/acme/specs/conversations/plan-upgrade.yaml', index: 1 },
  B5: { spec: 'examples/acme/specs/conversations/order-loose-confirmation.yaml', index: 0 },
  B6: { spec: 'examples/acme/specs/conversations/off-topic-return.yaml', index: 0 },
  B7: { spec: 'examples/acme/specs/conversations/tool-failure.yaml', index: 1 },
  B8: { spec: 'examples/acme/golden/specs/twise/gen-twise-023.yaml', index: 1 },
  B9: { spec: 'examples/acme/golden/specs/twise/gen-twise-066.yaml', index: 1 },
  B10: { spec: 'examples/acme/golden/specs/twise/gen-twise-018.yaml', index: 2 },
};

type Run = { id: string; block: string; text: string; calls: Call[]; exact: boolean; exactFailed: string[] };
const runs: Run[] = readFileSync(resolve(here, 'data/h1-runs-class.jsonl'), 'utf8')
  .split('\n')
  .filter((l) => l.trim() !== '')
  .map((l) => JSON.parse(l));

type AnySpec = { version?: string; target?: unknown; uses?: unknown; blocks: { expect?: Expect; uses?: unknown }[] };
const specs = new Map<string, AnySpec>();
for (const def of Object.values(BLOCKS)) {
  if (specs.has(def.spec)) continue;
  const loaded = await loadSpecFile(def.spec);
  if (!loaded.ok) throw new Error(`${def.spec}: ${JSON.stringify(loaded.errors)}`);
  specs.set(def.spec, loaded.spec as AnySpec);
}
const expectOf = (run: Run) => {
  const def = BLOCKS[run.block];
  if (!def) throw new Error(run.block);
  return ((specs.get(def.spec) as AnySpec).blocks[def.index]?.expect ?? {}) as Expect;
};

function storeWith(...files: string[]): ObjectStore {
  const store = new ObjectStore(implRegistry());
  store.addFolder(resolve(objects, 'shipped'), 'shipped');
  for (const file of files) store.add(parseYaml(readFileSync(resolve(objects, file), 'utf8')), 'project', file);
  return store;
}

function multisetDiff(a: string[], b: string[]): number {
  const count = new Map<string, number>();
  for (const x of a) count.set(x, (count.get(x) ?? 0) + 1);
  for (const x of b) count.set(x, (count.get(x) ?? 0) - 1);
  return [...count.values()].reduce((s, v) => s + Math.abs(v), 0);
}

// ---------------- HF2 ----------------
const shipped = storeWith();
const baseline: Resolution = resolveScoring(shipped, {});
const baseVerdicts = runs.map((run) => score(expectOf(run), run.calls, baseline));

/** Main's own tools check through the stored oracle's shape (gating failures plus `<label>.count0`). */
function mainReference(expect: Expect, calls: Call[]): string[] {
  const failed: string[] = [];
  const ctx = { expect: { tools: expect.tools ?? [], tool_order: expect.tool_order }, observed: { toolCalls: calls } };
  if (mainToolsCheck.applies(ctx as never)) {
    for (const v of mainToolsCheck.evaluate(ctx as never) as Verdict[]) {
      if (v.gating === false) continue;
      if (v.outcome !== 'pass') failed.push(v.id);
    }
  }
  for (const tool of expect.tools ?? []) {
    if (isZero(tool.count as never) && calls.some((c) => c.label === tool.label)) failed.push(`${tool.label}.count0`);
  }
  return failed;
}

const hf2Rows = runs.map((run, i) => {
  const mine = failedGating(baseVerdicts[i] as Verdict[]);
  const ref = mainReference(expectOf(run), run.calls);
  return {
    id: run.id,
    block: run.block,
    storedPass: run.exact,
    rescoredPass: mine.length === 0,
    stored: run.exactFailed,
    rescored: mine,
    mainCheck: ref,
    verdictDiff: multisetDiff(run.exactFailed, mine),
    refVsStored: multisetDiff(run.exactFailed, ref),
    refVsMine: multisetDiff(ref, mine),
  };
});
const hf2 = {
  runs: runs.length,
  storedPasses: runs.filter((r) => r.exact).length,
  rescoredPasses: hf2Rows.filter((r) => r.rescoredPass).length,
  changedVerdicts: hf2Rows.reduce((s, r) => s + r.verdictDiff, 0),
  runsPassChanged: hf2Rows.filter((r) => r.storedPass !== r.rescoredPass).length,
  runsWithAnyDiff: hf2Rows.filter((r) => r.verdictDiff > 0).length,
  gatingVerdictsRescored: baseVerdicts.flat().filter((v) => v.gating !== false).length,
  allVerdictsRescored: baseVerdicts.flat().length,
  reference: {
    mainCheckVsStored: hf2Rows.reduce((s, r) => s + r.refVsStored, 0),
    mainCheckVsPrototype: hf2Rows.reduce((s, r) => s + r.refVsMine, 0),
  },
};

// ---------------- HF3 ----------------
const OVERRIDES = [
  { name: 'O1', file: 'overrides/O1.yaml', kind: 'policy/value-check', id: 'o1', item: 'rung4_exact', uses: { value_check: 'o1' } },
  { name: 'O2', file: 'overrides/O2.yaml', kind: 'policy/value-check', id: 'o2', item: 'rung4_exact', uses: { value_check: 'o2' } },
  { name: 'O3', file: 'overrides/O3.yaml', kind: 'check-set', id: 'o3', item: 'tools.order', uses: { check_set: 'o3' } },
  { name: 'O4', file: 'overrides/O4.yaml', kind: 'check-set', id: 'o4', item: 'tools.count', uses: { check_set: 'o4' } },
  { name: 'O5', file: 'overrides/O5.yaml', kind: 'check-set', id: 'o5', item: 'forbidden.count0', uses: { check_set: 'o5' } },
  { name: 'O6', file: 'overrides/O6.yaml', kind: 'check-set', id: 'o6', item: 'tools.argument_accuracy', uses: { check_set: 'o6' } },
  { name: 'O7', file: 'overrides/O7.yaml', kind: 'check-set', id: 'o7', item: 'tools.input_closed', uses: { check_set: 'o7' } },
];
const kindOf = (ref: string | undefined) => (ref ?? '').split(':')[0];
const missingBy = (vs: Verdict[]) =>
  vs.filter((v) => !v.by || !v.by.object || !v.by.item || !v.by.impl || !v.by.layer).length;

let verdictsWithoutBy = missingBy(baseVerdicts.flat());
let verdictsScored = baseVerdicts.flat().length;
const hf3Overrides = OVERRIDES.map((o) => {
  const resolution = resolveScoring(storeWith(o.file), o.uses);
  let targeted = 0;
  let untargeted = 0;
  let untargetedGating = 0;
  let stampOnly = 0;
  const changes: unknown[] = [];
  runs.forEach((run, i) => {
    const before = new Map((baseVerdicts[i] as Verdict[]).map((v) => [v.id, v]));
    const afterList = score(expectOf(run), run.calls, resolution);
    verdictsWithoutBy += missingBy(afterList);
    verdictsScored += afterList.length;
    const after = new Map(afterList.map((v) => [v.id, v]));
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      const b = before.get(id);
      const a = after.get(id);
      const changed = !a || !b || a.outcome !== b.outcome || a.score !== b.score;
      if (!changed) {
        if (a?.by?.object !== b?.by?.object) stampOnly++;
        continue;
      }
      const names = (v: Verdict | undefined) => v?.by && kindOf(v.by.object) === o.kind && v.by.item === o.item;
      const isTargeted = names(a) || names(b);
      if (isTargeted) targeted++;
      else {
        untargeted++;
        if ((a ?? b)?.gating !== false) untargetedGating++;
      }
      changes.push({ run: run.id, id, before: b ? { outcome: b.outcome, score: b.score, by: b.by } : null, after: a ? { outcome: a.outcome, score: a.score, by: a.by } : null, targeted: isTargeted });
    }
  });
  return { name: o.name, item: `${o.kind}#${o.item}`, ref: (o.kind === 'check-set' ? resolution.checkSet : resolution.valueCheck).ref, targeted, untargeted, untargetedGating, stampOnly, changes };
});

const UNKNOWN = [
  { name: 'U1', file: 'unknown/U1.yaml', kind: 'policy/value-check', id: 'u1', unknown: 'rung5_judge' },
  { name: 'U2', file: 'unknown/U2.yaml', kind: 'check-set', id: 'u2', unknown: 'tools.ordr' },
  { name: 'U3', file: 'unknown/U3.yaml', kind: 'check-set', id: 'u3', unknown: 'R3' },
  { name: 'U4', file: 'unknown/U4.yaml', kind: 'check-set', id: 'u4', unknown: 'tools.coverage' },
  { name: 'U5', file: 'unknown/U5.yaml', kind: 'check-set', id: 'u5', unknown: 'Tools.order' },
  { name: 'U6', file: 'unknown/U6.yaml', kind: 'policy/value-check', id: 'u6', unknown: 'rung4_Exact' },
  { name: 'U7', file: 'unknown/U7.yaml', kind: 'check-set', id: 'u7', unknown: 'rung4_exact' },
  { name: 'U8', file: 'unknown/U8.yaml', kind: 'policy/value-check', id: 'u8', unknown: 'rung2b_declared' },
];
const parentItems: Record<string, string[]> = {
  'check-set': [...baseline.checkSet.items.keys()],
  'policy/value-check': [...baseline.valueCheck.items.keys()],
};
const hf3Unknown = UNKNOWN.map((u) => {
  try {
    storeWith(u.file).resolve(u.kind, u.id);
    return { name: u.name, refused: false, accepted: true, message: null };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const ok = cause instanceof LoadError && message.includes(u.unknown) && (parentItems[u.kind] ?? []).every((id) => message.includes(id));
    return { name: u.name, refused: ok, accepted: !ok, message };
  }
});
const negativeControl = [...OVERRIDES.map((o) => ({ file: o.file, kind: o.kind, id: o.id })), { file: 'overrides/ADD.yaml', kind: 'check-set', id: 'add' }].map((o) => {
  try {
    const r = storeWith(o.file).resolve(o.kind, o.id);
    return { file: o.file, loads: true, ref: r.ref };
  } catch (cause) {
    return { file: o.file, loads: false, message: String(cause) };
  }
});
const hf3 = {
  untargetedVerdictChanges: hf3Overrides.reduce((s, o) => s + o.untargeted, 0),
  untargetedGatingChanges: hf3Overrides.reduce((s, o) => s + o.untargetedGating, 0),
  targetedVerdictChanges: hf3Overrides.reduce((s, o) => s + o.targeted, 0),
  verdictsWithoutBy,
  verdictsScored,
  unknownItemOverridesAccepted: hf3Unknown.filter((u) => u.accepted).length,
  unknownPlanted: hf3Unknown.length,
  perOverride: hf3Overrides.map(({ changes: _c, ...rest }) => rest),
  unknown: hf3Unknown,
  negativeControl,
};

// ---------------- HF4 ----------------
class CountingAdapter {
  opens = 0;
  sends = 0;
  closes = 0;
  constructor(private readonly byText: Map<string, Call[]>) {}
  open(): object {
    this.opens++;
    return {};
  }
  send(_session: object, stimulus: { user: string }): { toolCalls: Call[] } {
    this.sends++;
    return { toolCalls: this.byText.get(stimulus.user) ?? [] };
  }
  close(): void {
    this.closes++;
  }
  get calls(): number {
    return this.opens + this.sends + this.closes;
  }
}

/** Main's cache-key rule (`runSpec`: contentHash of the spec without version), or the variant that also leaves out `uses`. */
function specHashFor(spec: AnySpec, stripUses: boolean): string {
  const { version: _v, ...unlabelled } = spec;
  if (!stripUses) return contentHash(unlabelled);
  const { uses: _u, ...rest } = unlabelled;
  return contentHash({ ...rest, blocks: rest.blocks.map(({ uses: _b, ...block }) => block) });
}

function agentKey(run: Run, spec: AnySpec, agentObjects: string | undefined, stripUses = false): string {
  const def = BLOCKS[run.block] as { index: number };
  const target = (spec.target ?? { adapter: 'stand-in' }) as never;
  const canonical = canonicalGiven(spec as never, def.index);
  const given = resolveGiven(canonical.state, canonical.prefix, target);
  return blockCacheKey({
    specHash: specHashFor(spec, stripUses),
    repeat: 0,
    position: def.index,
    given,
    stimulus: { user: run.text },
    target,
    adapter: 'stand-in',
    adapterVersion: '0',
    ...(agentObjects === undefined ? {} : { agentObjects }),
  } as never);
}

const shippedProfile = shipped.resolve('run-profile', 'default');
/** The agent-facing objects' hash joins the key only when one differs from the shipped default. */
function agentObjectsOf(store: ObjectStore, uses: { run_profile?: string }): string | undefined {
  const profile = store.resolve('run-profile', uses.run_profile ?? 'default');
  return profile.ref === shippedProfile.ref ? undefined : contentHash([profile.ref]);
}

const storedKeys = runs.map((run) => agentKey(run, specs.get((BLOCKS[run.block] as { spec: string }).spec) as AnySpec, undefined));

function rejudge(store: ObjectStore, uses: Record<string, string>, specOf: (run: Run) => AnySpec, stripUses = false) {
  const adapter = new CountingAdapter(new Map(runs.map((r) => [r.text, r.calls])));
  const resolution = resolveScoring(store, uses);
  const agentObjects = agentObjectsOf(store, uses);
  let reused = 0;
  let rerun = 0;
  const verdicts = runs.map((run, i) => {
    const key = agentKey(run, specOf(run), agentObjects, stripUses);
    let calls: Call[];
    if (key === storedKeys[i]) {
      reused++;
      calls = run.calls;
    } else {
      rerun++;
      const session = adapter.open();
      calls = adapter.send(session, { user: run.text }).toolCalls;
      adapter.close();
    }
    return score(expectOf(run), calls, resolution);
  });
  const changed = verdicts.reduce((s, vs, i) => s + multisetDiff(failedGating(baseVerdicts[i] as Verdict[]), failedGating(vs)), 0);
  const restamped = verdicts.flat().filter((v) => v.by?.object === resolution.valueCheck.ref && resolution.valueCheck.id !== 'default').length;
  return { adapterCalls: adapter.calls, opens: adapter.opens, sends: adapter.sends, closes: adapter.closes, reused, rerun, changedGatingVerdicts: changed, verdictsStampedByNewObject: restamped };
}

const mainSpec = (run: Run) => specs.get((BLOCKS[run.block] as { spec: string }).spec) as AnySpec;
// P2: the same O1 change written at the spec layer: `uses` on each of the six specs.
const specsWithUses = new Map<string, AnySpec>();
for (const path of specs.keys()) {
  const parsed = parseRaw(readFileSync(path, 'utf8'), path);
  if (!parsed.ok) throw new Error(path);
  const result = validateWith(ExtSpec, { ...(parsed.raw as object), uses: { value_check: 'o1' } }, path);
  if (!result.ok) throw new Error(`${path}: ${JSON.stringify(result.errors)}`);
  specsWithUses.set(path, result.spec as AnySpec);
}
const usesSpec = (run: Run) => specsWithUses.get((BLOCKS[run.block] as { spec: string }).spec) as AnySpec;

const hf4 = {
  scoringOnlyProjectLayer: rejudge(storeWith('overrides/O1.yaml'), { value_check: 'o1' }, mainSpec),
  controlP1AgentFacing: rejudge(storeWith('overrides/P1-run-profile.yaml'), { run_profile: 'p1' }, mainSpec),
  probeP2SpecLayerMainKeyRule: rejudge(storeWith('overrides/O1.yaml'), { value_check: 'o1' }, usesSpec, false),
  probeP2SpecLayerKeyWithoutUses: rejudge(storeWith('overrides/O1.yaml'), { value_check: 'o1' }, usesSpec, true),
  baselineNoChange: rejudge(shipped, {}, mainSpec),
};

const verdicts = {
  HF1: JSON.parse(readFileSync(resolve(here, 'results-hf1.json'), 'utf8')).summary.verdict,
  HF2: hf2.changedVerdicts === 0 ? 'SUPPORTED' : 'FALSIFIED',
  HF3:
    hf3.untargetedVerdictChanges > 0 || hf3.verdictsWithoutBy > 0 || hf3.unknownItemOverridesAccepted > 0
      ? 'FALSIFIED'
      : hf3.targetedVerdictChanges > 0
        ? 'SUPPORTED'
        : 'INCONCLUSIVE',
  HF4: hf4.scoringOnlyProjectLayer.adapterCalls === 0 ? 'SUPPORTED' : 'FALSIFIED',
};
const out = {
  base: '6a6f88ecd905aa9740c251254ad447ba9a109559',
  prereg: '5c8cb667fbf5bd5136cfd0e3097e0a452af7c154',
  verdicts,
  hf1: { summary: JSON.parse(readFileSync(resolve(here, 'results-hf1.json'), 'utf8')).summary, perSpec: 'results-hf1.json' },
  hf2,
  hf3,
  hf4,
  perRun: { hf2: hf2Rows, hf3Changes: Object.fromEntries(hf3Overrides.map((o) => [o.name, o.changes])) },
};
writeFileSync(resolve(here, 'results.json'), `${JSON.stringify(out, null, 1)}\n`);
console.log(JSON.stringify({ verdicts, hf2, hf3: { ...hf3, unknown: hf3.unknown.map((u) => ({ name: u.name, refused: u.refused, message: u.message })) }, hf4 }, null, 1));
