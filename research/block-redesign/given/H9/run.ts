/**
 * H9: seeded defects in 20 clean recorded specs (Part A), then `requires: auto` over every example spec
 * (Part B). Offline: the deterministic Acme agent and the sandbox seeding code only. Run from the repo root:
 *   npx tsx research/block-redesign/given/H9/run.ts
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assistantMessage,
  canonicalGiven,
  canonicalJson,
  enterBlock,
  findSpecFiles,
  initialGiven,
  lintSpec,
  loadSpecFile,
  type Message,
  type Spec,
  stimulusMessages,
} from '@agent-nexus/driftbench-core';
import { localProvider } from '@agent-nexus/driftbench-sandbox';
import { createAcmeAgent } from '../../../../examples/acme/src/index';
import {
  capability,
  chain,
  type Finding,
  historyMatchesWorld,
  norm,
  type ResearchGiven,
  stateKnown,
  summaryPresent,
  toolHistoryPaired,
  toolKnown,
  valueInMessage,
  workspaceResolves,
} from '../verifier/checks';
import { PROFILES, runTargetOf } from '../verifier/targets';

const OUT = 'research/block-redesign/given/H9';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(rng: () => number, list: readonly T[]): T => list[Math.floor(rng() * list.length)] as T;

type Loaded = { path: string; spec: Spec };

async function loadAll(): Promise<{ loaded: Loaded[]; files: number }> {
  const files = await findSpecFiles(['examples']);
  const loaded: Loaded[] = [];
  for (const path of files) {
    const result = await loadSpecFile(path);
    if (result.ok) loaded.push({ path, spec: result.spec });
  }
  return { loaded, files: files.length };
}

/** Every check that applies to one block's Given, for its run target. */
function checkGiven(spec: Spec, target: string | undefined, given: ResearchGiven, block: number): Finding[] {
  const findings: Finding[] = [];
  findings.push(...toolHistoryPaired(given, block));
  findings.push(...valueInMessage(given, block));
  const profile = target ? PROFILES[target] : undefined;
  if (profile) {
    const labels: { label: string; where: string }[] = [];
    for (const message of given.prefix ?? []) for (const call of message.tool_calls ?? []) labels.push({ label: call.label, where: 'prefix' });
    for (const label of Object.keys(given.world?.tools ?? {})) labels.push({ label, where: 'world.tools' });
    for (const tool of spec.blocks[block]?.expect?.tools ?? []) labels.push({ label: tool.label, where: `blocks.${block}.expect.tools` });
    findings.push(...toolKnown(profile, labels, block));
    findings.push(...historyMatchesWorld(profile, given, block));
    findings.push(...capability(profile, given, block));
  }
  return findings;
}

// ---------------------------------------------------------------- Part A

type Clean = { path: string; spec: Spec; k: number; given: ResearchGiven };

/** Front door: run blocks 0..k-1 through the deterministic Acme agent and record the history as block k's prefix. */
async function recordClean(item: Loaded): Promise<{ clean?: Clean; reason?: string }> {
  const { spec } = item;
  const k = spec.blocks.length - 1;
  if (k < 1) return { reason: 'one block' };
  const agent = createAcmeAgent();
  let running = initialGiven(spec);
  const ledger: Record<string, unknown> = { ...(spec as { ledger_seed?: Record<string, unknown> }).ledger_seed, ...running.ledger };
  const messages: Message[] = [];
  const worlds: string[] = [];
  for (let j = 0; j < k; j++) {
    const block = spec.blocks[j]!;
    running = enterBlock(running, block.given);
    worlds.push(canonicalJson({ tools: running.world.tools ?? null, store: running.world.store ?? null }));
    if (block.given?.prefix) return { reason: 'authored prefix' };
    messages.push(...stimulusMessages(block.when));
    const observed = await agent.respond(messages, running.world);
    messages.push(assistantMessage(observed));
    Object.assign(ledger, block.given?.ledger, block.expect?.ledger_add);
  }
  running = enterBlock(running, spec.blocks[k]!.given);
  Object.assign(ledger, running.ledger, spec.blocks[k]!.given?.ledger);
  const worldK = canonicalJson({ tools: running.world.tools ?? null, store: running.world.store ?? null });
  if (worlds.some((world) => world !== worldK)) return { reason: 'world changes between blocks (amendment 1)' };
  const calls = messages.flatMap((message) => message.tool_calls ?? []).filter((call) => call.output !== undefined || call.error !== undefined);
  if (calls.length === 0) return { reason: 'no recorded tool call with a result' };
  const shared: NonNullable<ResearchGiven['shared']> = [];
  for (const [fact, value] of Object.entries(ledger)) {
    const index = messages.findIndex((message) => message.role === 'user' && norm(value) !== '' && norm(message.content).includes(norm(value)));
    if (index >= 0) shared.push({ fact, by: 'user', in: index });
  }
  if (shared.length === 0) return { reason: 'no ledger fact said in a user message' };
  const given: ResearchGiven = { prefix: messages, origin: 'recorded', ledger, shared, world: running.world, vars: running.vars };
  return { clean: { path: item.path, spec, k, given } };
}

const DEFECTS = [
  { id: 'dropped_tool_result', check: 'tool_history_paired', layer: '2' },
  { id: 'fact_not_in_message', check: 'value_in_message', layer: '4' },
  { id: 'flipped_world_row', check: 'history_matches_world', layer: '5' },
  { id: 'unknown_tool', check: 'tool_known', layer: '2' },
] as const;

function plant(clean: Clean, defect: (typeof DEFECTS)[number], seed: number): { given: ResearchGiven; note: string } {
  const rng = mulberry32(seed);
  const given = structuredClone(clean.given) as ResearchGiven;
  const recorded = (given.prefix ?? []).flatMap((message, m) => (message.tool_calls ?? []).map((call, c) => ({ m, c, call }))).filter(({ call }) => call.output !== undefined || call.error !== undefined);
  switch (defect.id) {
    case 'dropped_tool_result': {
      const { m, c, call } = pick(rng, recorded);
      const target = given.prefix![m]!.tool_calls![c]!;
      delete target.output;
      delete target.error;
      return { given, note: `prefix[${m}].tool_calls[${c}] ${call.label}: result removed` };
    }
    case 'fact_not_in_message': {
      const entry = pick(rng, given.shared!);
      const before = given.ledger![entry.fact];
      given.ledger![entry.fact] = `ZZ-${seed}`;
      return { given, note: `ledger.${entry.fact}: ${JSON.stringify(before)} -> ZZ-${seed}` };
    }
    case 'flipped_world_row': {
      const { call } = pick(rng, recorded);
      const forced = call.error !== undefined ? { result: { planted: seed } } : { error: `planted failure ${seed}` };
      given.world = { ...given.world, tools: { ...given.world?.tools, [call.label]: forced } };
      return { given, note: `world.tools.${call.label} forced to ${JSON.stringify(forced)}` };
    }
    case 'unknown_tool': {
      const { m, c, call } = pick(rng, recorded);
      given.prefix![m]!.tool_calls![c]!.label = `unknown_tool_${seed}`;
      return { given, note: `prefix[${m}].tool_calls[${c}] ${call.label} renamed unknown_tool_${seed}` };
    }
  }
}

async function partA(loaded: Loaded[]) {
  const withTarget = loaded.filter((item) => item.spec.target?.adapter === 'function' && item.spec.target.agent === 'acme-sales').sort((a, b) => a.path.localeCompare(b.path));
  const noTarget = loaded
    .filter((item) => !item.spec.target && /^examples\/acme\/(golden|gated|generated)\//.test(item.path))
    .sort((a, b) => a.path.localeCompare(b.path));
  const pool = [...withTarget, ...noTarget];
  const clean: Clean[] = [];
  const skipped: { path: string; reason: string }[] = [];
  for (const item of pool) {
    if (clean.length === 20) break;
    let result: Awaited<ReturnType<typeof recordClean>>;
    try {
      result = await recordClean(item);
    } catch (error) {
      result = { reason: `recording failed: ${(error as Error).message.slice(0, 120)}` };
    }
    if (result.clean) clean.push(result.clean);
    else skipped.push({ path: item.path, reason: result.reason ?? '' });
  }
  const cleanRows = clean.map((item) => {
    const findings = [...checkGiven(item.spec, 'function:acme-sales', item.given, item.k), ...chain(item.spec)].filter((f) => f.kind !== 'warning');
    return {
      path: item.path,
      k: item.k,
      prefix_messages: item.given.prefix!.length,
      recorded_calls: item.given.prefix!.flatMap((m) => m.tool_calls ?? []).length,
      shared: item.given.shared,
      flagged: findings.length > 0,
      findings,
    };
  });
  const defectRows = [];
  for (const [index, item] of clean.entries()) {
    for (const defect of DEFECTS) {
      const seed = 1000 + index;
      const { given, note } = plant(item, defect, seed);
      const findings = checkGiven(item.spec, 'function:acme-sales', given, item.k).filter((f) => f.kind !== 'warning');
      const hit = findings.some((f) => f.check === defect.check && f.layer.includes(defect.layer));
      defectRows.push({ path: item.path, seed, defect: defect.id, expected_check: defect.check, note, detected: hit, findings });
    }
  }
  return {
    pool_size: pool.length,
    clean_count: clean.length,
    skipped_before_twenty: skipped,
    clean: cleanRows,
    defects: defectRows,
    detection: { detected: defectRows.filter((row) => row.detected).length, total: defectRows.length },
    clean_flagged: cleanRows.filter((row) => row.flagged).length,
  };
}

// ---------------------------------------------------------------- Part B

function loadLibrary() {
  const raw = JSON.parse(readFileSync('examples/estates/fixture/live/states/library.json', 'utf8'));
  return { states: new Set(Object.keys(raw.states ?? {})), events: new Set(Object.keys(raw.events ?? {})) };
}

async function partB(loaded: Loaded[]) {
  const library = loadLibrary();
  const scratch = join(process.env.H9_SCRATCH ?? '/tmp', `h9-digest-${process.pid}`);
  mkdirSync(scratch, { recursive: true });
  const provider = localProvider({ dir: scratch });
  const digestCache = new Map<string, Finding | null>();
  const rows = [];
  let canonicalCalls = 0;
  let canonicalUnpaired = 0;
  const canonicalSpecs = new Set<string>();
  for (const { path, spec } of loaded) {
    const lintErrors = lintSpec(spec).filter((issue) => issue.level === 'error');
    const target = runTargetOf(spec, path);
    const findings: Finding[] = [...chain(spec)];
    const newKey: Finding[] = [];
    let running = initialGiven(spec);
    for (let b = 0; b < spec.blocks.length; b++) {
      running = enterBlock(running, spec.blocks[b]!.given);
      const given: ResearchGiven = { prefix: spec.blocks[b]!.given?.prefix, ledger: running.ledger, world: running.world, vars: running.vars };
      findings.push(...checkGiven(spec, target, given, b));
      findings.push(...stateKnown(library, given, b));
      findings.push(...workspaceResolves(given, b, process.cwd()));
      newKey.push(...summaryPresent(given, b));
      const files = running.world.workspace?.files;
      if (files && Object.keys(files).length > 0) {
        const key = canonicalJson(running.world.workspace);
        if (!digestCache.has(key)) digestCache.set(key, await workspaceDigest(provider, running.world.workspace!));
        const finding = digestCache.get(key);
        if (finding) findings.push({ ...finding, block: b });
      }
      // The teacher-forced gap: tool calls the canonical prefix records with no result.
      const canonical = canonicalGiven(spec, b);
      for (const message of canonical.prefix) {
        for (const call of message.tool_calls ?? []) {
          canonicalCalls++;
          if (call.output === undefined && call.error === undefined) {
            canonicalUnpaired++;
            canonicalSpecs.add(path);
          }
        }
      }
    }
    const notRun = dedupe(findings.filter((f) => f.kind !== 'warning'));
    rows.push({ path, target: target ?? 'unresolved', passes_today: lintErrors.length === 0, lint_errors: lintErrors.length, blocks: spec.blocks.length, not_run: notRun, new_key_summary: dedupe(newKey) });
  }
  rmSync(scratch, { recursive: true, force: true });
  return { rows, canonical: { calls: canonicalCalls, without_result: canonicalUnpaired, specs_with_gap: canonicalSpecs.size } };
}

function dedupe(findings: Finding[]): Finding[] {
  const seen = new Map<string, Finding>();
  for (const f of findings) {
    const key = `${f.check}|${f.expected}|${f.got}`;
    if (!seen.has(key)) seen.set(key, f);
  }
  return [...seen.values()];
}

/** Dynamic, setup only: seed the files into a fresh folder and read every one back. */
async function workspaceDigest(provider: ReturnType<typeof localProvider>, workspace: NonNullable<ResearchGiven['world']>['workspace'] & object): Promise<Finding | null> {
  const sandbox = await provider.create();
  try {
    await sandbox.seed(workspace);
    const listed = new Set(await sandbox.listFiles());
    const mismatches: string[] = [];
    for (const [file, content] of Object.entries(workspace.files ?? {})) {
      if (!listed.has(file.replace(/^\.\//, ''))) {
        mismatches.push(`${file} not listed`);
        continue;
      }
      const back = Buffer.from(await sandbox.readFile(file)).toString('utf8');
      if (back !== content) mismatches.push(`${file} differs`);
    }
    if (workspace.from === undefined) {
      const declared = new Set(Object.keys(workspace.files ?? {}).map((f) => f.replace(/^\.\//, '')));
      for (const file of listed) if (!declared.has(file)) mismatches.push(`${file} appeared`);
    }
    if (mismatches.length === 0) return null;
    return { kind: 'setup_failed', layer: '5 world', check: 'workspace_digest', block: null, expected: 'the seeded folder reads back as declared', got: mismatches.slice(0, 5).join('; ') };
  } catch (error) {
    return { kind: 'setup_failed', layer: '5 world', check: 'workspace_digest', block: null, expected: 'the workspace seeds', got: (error as Error).message.slice(0, 200) };
  } finally {
    await sandbox.destroy();
  }
}

// ---------------------------------------------------------------- main

const { loaded, files } = await loadAll();
const a = await partA(loaded);
console.log(`Part A: clean ${a.clean_count}, pool ${a.pool_size}, detection ${a.detection.detected}/${a.detection.total}, clean flagged ${a.clean_flagged}`);
const b = await partB(loaded);
const passing = b.rows.filter((row) => row.passes_today);
const byClass: Record<string, number> = {};
for (const row of passing) for (const f of row.not_run) byClass[`${f.kind} | ${f.check} | ${row.target}`] = (byClass[`${f.kind} | ${f.check} | ${row.target}`] ?? 0) + 1;
const summary = {
  files,
  loaded: loaded.length,
  passes_today: passing.length,
  specs_with_not_run: passing.filter((row) => row.not_run.length > 0).length,
  specs_with_summary_flag: passing.filter((row) => row.new_key_summary.length > 0).length,
  target_unresolved: b.rows.filter((row) => row.target === 'unresolved').length,
  by_class: byClass,
  canonical: b.canonical,
};
console.log(JSON.stringify(summary, null, 2));
writeFileSync(`${OUT}/results.json`, `${JSON.stringify({ generated: new Date().toISOString(), commit: process.env.H9_COMMIT ?? null, part_a: a, part_b: { summary, rows: b.rows.filter((row) => row.not_run.length > 0 || row.new_key_summary.length > 0 || !row.passes_today) } }, null, 1)}\n`);
