/**
 * Model-free measurement on the fictional real-shape estate (see real-shape-estate.ts). Run with:
 * node --import tsx packages/generate/test/estate/real-shape-audit.ts /absolute/output.json [--no-documents]
 * The same input is used before and after a change. `--no-documents` leaves the document roles out of the
 * map, as a map of the older format would be. No model, no phrase bank, no paid call.
 */
import { writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { parseSpecText } from '@agent-nexus/driftbench-core';
import { buildPlan, ClaudeCodeReader, scanEstate } from '@agent-nexus/driftbench-estate';
import { estate, NOW } from '../../../estate/test/support';
import { generateEstateSuite } from '../../src/estate/generate';
import { PhraseBank } from '../../src/estate/inputs';
import { navigationPaths, realShapeEstate } from './real-shape-estate';

const output = process.argv[2];
if (!output || !isAbsolute(output)) throw new Error('Supply an absolute JSON output path.');
const withDocuments = !process.argv.includes('--no-documents');
const files = realShapeEstate();
const root = await estate(files);
const scanned = (await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW })).map;
const map = withDocuments
  ? Object.assign(scanned, {
      documents: navigationPaths(files).map(({ path, role }) => ({ path, role, reasons: ['audit input'] })),
    })
  : scanned;
const plan = buildPlan(map).plan;
for (const row of plan.rows) row.status = 'approved';
const suite = generateEstateSuite(
  { map, plan, bank: PhraseBank.parse({ version: 1, estate: 'logistics', mapHash: map.hash }) },
  { paths: { map: 'map.yaml', plan: 'plan.yaml', phrases: 'phrases.yaml' } },
);
const byPath = new Map(suite.specs.map((spec) => [spec.path, spec]));
const specs = suite.files
  .filter((file) => file.path.endsWith('.yaml'))
  .map((file) => {
    const parsed = parseSpecText(file.text, 'yaml', file.path);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    const record = byPath.get(file.path);
    if (!record) throw new Error('No spec record.');
    const when = parsed.spec.blocks[0]?.when;
    return { ...record, text: when && 'user' in when ? when.user : '' };
  });
const complete = specs.filter((spec) => spec.complete);
const asked = complete.filter((spec) => spec.ask !== 'none');
const distinct = (rows: typeof specs) => new Set(rows.map((row) => row.text)).size;
const per100 = (rows: typeof specs) => (rows.length ? (distinct(rows) * 100) / rows.length : 0);
const types = [...new Set(specs.map((spec) => spec.testType))].sort();
const byType = Object.fromEntries(
  types.map((type) => {
    const own = specs.filter((spec) => spec.testType === type);
    const done = own.filter((spec) => spec.complete && spec.ask !== 'none');
    return [
      type,
      {
        specs: own.length,
        complete: own.filter((spec) => spec.complete).length,
        distinctAsksPer100: per100(done),
      },
    ];
  }),
);
const frequency = new Map<string, number>();
for (const spec of asked) frequency.set(spec.text, (frequency.get(spec.text) ?? 0) + 1);
const reasons = new Map<string, number>();
for (const entry of suite.report.incomplete ?? [])
  for (const reason of entry.reasons) {
    const key = `${reason.marker}: ${reason.detail
      .replace(/\(.*?\)/g, '()')
      .replace(/"[^"]*"/g, '""')
      .slice(0, 90)}`;
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }
// A deterministic sample: every Kth plan row of the test types whose asks come from a unit's words.
const sampled = ['read_when', 'guard_negative', 'ordered_pair', 'dispatch'].flatMap((type) => {
  const own = specs.filter((spec) => spec.testType === type);
  const step = Math.max(1, Math.floor(own.length / 10));
  return own.filter((_, index) => index % step === 0).slice(0, 10);
});
const result = {
  withDocuments,
  specs: specs.length,
  complete: complete.length,
  completeShare: complete.length / specs.length,
  askedComplete: asked.length,
  distinctAsks: distinct(asked),
  distinctAsksPer100: per100(asked),
  byType,
  topAsks: [...frequency.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
  topReasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
  gates: map.atoms.filter((atom) => atom.kind === 'gate').length,
  skills: map.atoms.filter((atom) => atom.kind === 'skill').length,
  helpers: map.atoms.filter((atom) => atom.kind === 'subagent').length,
  guards: map.atoms.filter((atom) => atom.kind === 'guard').length,
  references: map.atoms.filter((atom) => atom.kind === 'reference').length,
  rows: Object.fromEntries(
    specs
      .filter((spec) => spec.mode !== 'replay')
      .map((spec) => [spec.row, { type: spec.testType, complete: spec.complete, ask: spec.text }]),
  ),
  sample: sampled.map((spec) => ({
    type: spec.testType,
    row: spec.row,
    complete: spec.complete,
    ask: spec.text,
    atoms: spec.atoms,
    markers: spec.markers,
  })),
};
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ ...result, sample: undefined, rows: undefined }, null, 1));
