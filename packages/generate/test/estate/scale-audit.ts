/**
 * Model-free, non-bank scale measurement. Run with:
 * node --import tsx packages/generate/test/estate/scale-audit.ts /absolute/output.json
 * Compare the same file on the baseline and changed framework; do not change this estate between runs.
 */
import { writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { parseSpecText } from '@agent-nexus/driftbench-core';
import { buildPlan, ClaudeCodeReader, scanEstate } from '@agent-nexus/driftbench-estate';
import { estate, NOW } from '../../../estate/test/support';
import { generateEstateSuite } from '../../src/estate/generate';
import { PhraseBank } from '../../src/estate/inputs';
import { editorialEstate } from './scale-situations';

const output = process.argv[2];
if (!output || !isAbsolute(output)) throw new Error('Supply an absolute JSON output path.');
const root = await estate(editorialEstate());
const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
const plan = buildPlan(map).plan;
for (const row of plan.rows) row.status = 'approved';
const suite = generateEstateSuite(
  {
    map,
    plan,
    bank: PhraseBank.parse({ version: 1, estate: 'editorial', mapHash: map.hash }),
  },
  { paths: { map: 'map.yaml', plan: 'plan.yaml', phrases: 'phrases.yaml' } },
);
const byPath = new Map(suite.specs.map((spec) => [spec.path, spec]));
const asks = suite.files
  .filter((file) => file.path.endsWith('.yaml'))
  .map((file) => {
    const parsed = parseSpecText(file.text, 'yaml', file.path);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    const record = byPath.get(file.path);
    if (!record) throw new Error('No spec record.');
    const when = parsed.spec.blocks[0]?.when;
    return { ...record, text: when && 'user' in when ? when.user : '' };
  });
const complete = asks.filter((ask) => ask.complete);
const primary = complete.filter(
  (ask) => ask.testType === 'ordered_pair' && ask.row.startsWith('ordered_pair.'),
);
const metrics = (rows: typeof asks) => ({
  tests: rows.length,
  distinctAsks: new Set(rows.map((row) => row.text)).size,
  distinctAsksPer100: rows.length ? (new Set(rows.map((row) => row.text)).size * 100) / rows.length : 0,
});
const result = {
  root,
  skills: 24,
  gates: map.atoms.filter((atom) => atom.kind === 'gate').length,
  sourceRows: plan.rows.length,
  summary: suite.report.summary,
  completeShare: suite.report.summary.complete / suite.report.summary.specs,
  asks: metrics(complete),
  primaryGates: metrics(primary),
  sample: primary.filter((_, i) => i % 23 === 0).slice(0, 12),
  report: suite.report,
};
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ ...result, report: undefined, sample: undefined }));
