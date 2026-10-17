import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildPlan,
  diffEstateMaps,
  type EstateMap,
  estateImpact,
  lintEstate,
  readerFor,
  scanEstate,
} from '@agent-nexus/driftbench-estate';
import { generateEstateSuite, type PhraseBank } from '@agent-nexus/driftbench-generate';
import { RUNTIME } from '../layout';
import { writeEstate } from '../pipeline';
import { cli } from './bench';
import { realEstate } from './scale-real-estate';
import { lintFacts, planConsole, readFacts } from './scale-real-facts';
import { plantHome, userSkillsFolder } from './scale-real-home';

/**
 * Runs the whole estate loop once on a real-size estate and prints one JSON line: the time each stage takes (the
 * stage's own work: planting the estate on disk and reading the map back are outside it), what each produced, and
 * the facts of the map against the planted truth. The parent kills it at its budget.
 * Usage: scale-real-worker <seed> <scale>.
 */

const NOW = () => new Date('2026-10-11T00:00:00.000Z');

async function main(): Promise<void> {
  const [seedText, scaleText] = process.argv.slice(2);
  const seed = Number(seedText);
  const scale = Number(scaleText);
  const planted = realEstate(seed, { scale });
  const root = await writeEstate(planted.files);
  // The platform's home is a fresh empty folder, so nothing of the machine's own home is ever read; the
  // user-level skill layer is opt-in: the reader is told its folder, as a user passing --user-skills would.
  const empty = await mkdtemp(join(tmpdir(), 'scale-real-home-'));
  process.env.HOME = empty;
  const home = await plantHome(planted.home, root);
  const reader = readerFor(RUNTIME, { userSkills: userSkillsFolder(home) });
  if (!reader) throw new Error('no reader');
  try {
    let started = Date.now();
    const result = await scanEstate({ root, reader, now: NOW });
    const scanMs = Date.now() - started;
    const map: EstateMap = {
      ...result.map,
      atoms: result.map.atoms.map((atom) => ({ ...atom, approved: true })),
    };
    const out: Record<string, unknown> = {
      seed,
      scale,
      files: planted.truth.files,
      markdown: planted.truth.markdown,
      bytes: planted.truth.bytes,
      proseBytes: planted.truth.proseBytes,
      standingBytes: planted.truth.standingBytes,
      structuralAtoms: planted.truth.structuralAtoms,
      scanMs,
      atoms: map.atoms.length,
      edges: map.edges.length,
      facts: readFacts(map, planted.truth),
      userLayerSkills: map.atoms
        .filter((atom) => atom.kind === 'skill' && atom.provenance.file.startsWith('~/'))
        .map((atom) => String(atom.fields?.name))
        .sort(),
    };

    started = Date.now();
    const lint = lintEstate(map, result.raw);
    out.lintMs = Date.now() - started;
    const facts = lintFacts(lint.findings, planted.truth);
    out.lintOnDocuments = facts.onDocuments;
    out.lintDefects = facts.defects;
    out.lintFindings = facts.total;
    out.lintFalse = facts.falseLive;

    started = Date.now();
    const built = buildPlan(map);
    out.planMs = Date.now() - started;
    out.rows = built.plan.rows.length;
    // What the plan command prints, counted from its real output: the estate is scanned and planned by the command.
    const work = await mkdtemp(join(tmpdir(), 'scale-real-cli-'));
    try {
      const scanned = cli(['estate', 'scan', root, '--no-model', '--out', join(work, 'map.yaml')]);
      const planOut = cli(['estate', 'plan', join(work, 'map.yaml'), '--out', join(work, 'plan.yaml')]);
      out.planConsoleLines = planConsole({
        scanCode: scanned.code,
        planCode: planOut.code,
        planWritten: existsSync(join(work, 'plan.yaml')),
        summaryWritten: existsSync(join(work, 'plan.summary.json')),
        out: planOut.out,
      });
    } finally {
      await rm(work, { recursive: true, force: true });
    }

    const bank: PhraseBank = {
      version: 1,
      estate: 'scale-real',
      mapHash: map.hash,
      workspaces: [],
      situations: [],
      deviations: [],
    };
    started = Date.now();
    const suite = generateEstateSuite(
      {
        map: { runtime: map.runtime, hash: map.hash, atoms: map.atoms },
        plan: {
          mapHash: built.plan.mapHash,
          rows: built.plan.rows.map((row) => ({ ...row, status: 'approved' as const })),
        },
        bank,
      },
      { seed, paths: { map: 'map.yaml', plan: 'plan.yaml', phrases: 'phrases.yaml' } },
    );
    out.generateMs = Date.now() - started;
    out.specs = suite.specs.length;
    const texts = new Map(suite.files.map((file) => [file.path, file.text]));
    const gateTests = suite.specs.filter(
      (spec) => spec.complete && (spec.testType === 'ordered_pair' || spec.testType === 'read_when'),
    );
    // The ask of a spec is its first `user:` line.
    const asks = new Set(
      gateTests.map((spec) => /^\s+user:\s*(.*)$/m.exec(texts.get(spec.path) ?? '')?.[1] ?? ''),
    );
    out.gateTests = { complete: gateTests.length, distinctAsks: asks.size };

    // Maintenance: one citation leaves the estate; exactly the tests of the atoms that left retire.
    const first = planted.truth.skills[0];
    if (first) {
      const changed = { ...planted.files };
      changed[first.file] = (changed[first.file] ?? '')
        .split('\n')
        .filter((line) => !line.includes(first.references[0] as string))
        .join('\n');
      const root2 = await writeEstate(changed);
      try {
        const second = await scanEstate({ root: root2, reader, now: NOW });
        const tests = map.atoms.map((atom, index) => ({
          id: `t${index}`,
          path: `t${index}.yaml`,
          file: `t${index}.yaml`,
          atoms: [atom.id],
        }));
        started = Date.now();
        const diff = diffEstateMaps(map, second.map);
        const impact = estateImpact(diff, tests);
        out.impactMs = Date.now() - started;
        out.removed = diff.atoms.removed.length;
        out.retired = impact.retire.length;
      } finally {
        await rm(root2, { recursive: true, force: true });
      }
    }
    process.stdout.write(`${JSON.stringify(out)}\n`);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
    await rm(empty, { recursive: true, force: true });
  }
}

main().catch((cause) => {
  process.stdout.write(
    `${JSON.stringify({ error: cause instanceof Error ? cause.message : String(cause) })}\n`,
  );
  process.exitCode = 1;
});
