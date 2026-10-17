import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Plan, PlanDetails } from '@agent-nexus/driftbench-estate';
import { describe, expect, it } from 'vitest';
import { CONSOLE_LIST_LINES, planReport } from '../src/commands/estate-plan';
import { type Io, main } from '../src/index';

async function run(argv: string[], cwd: string) {
  const output = { out: '', err: '' };
  const io: Io = {
    out: (text) => {
      output.out += text;
    },
    err: (text) => {
      output.err += text;
    },
    cwd,
  };
  const code = await main(argv, io);
  return { code, ...output };
}

const lineCount = (text: string) => text.split('\n').length;

function details(counts: { edges: number; adjusted: number; notes: number }): PlanDetails {
  return {
    t: 2,
    k: 3,
    seed: 1,
    rows: { total: 10, contract: 4, journey: 3, pairwise: 3 },
    gridCells: 100,
    tuples: { allowed: 5, covered: 5 },
    noContract: [],
    unapproved: 0,
    uncoveredEdges: Array.from({ length: counts.edges }, (_, n) => ({
      from: `route.a${n}`,
      kind: 'route',
      to: `skill.b${n}`,
      reason: 'no journey',
    })),
    droppedConstraints: 0,
    adjusted: Array.from({ length: counts.adjusted }, (_, n) => ({
      row: `row-${n}`,
      reason: 'a value left out',
    })),
    notes: Array.from({ length: counts.notes }, (_, n) => `note ${n}`),
  };
}

const plan = {
  summary: {
    cells: 5,
    coveringArraySize: 3,
    perKind: { route: 4 },
    perTestType: { journey: 3 },
    unenforcedAtoms: [],
    cellsWithoutPhrase: 5,
    edgesWithoutJourney: 0,
  },
} as unknown as Plan;

describe('the plan command prints a summary, whatever the size of the estate', () => {
  it('prints the first lines of each list, then counts the rest and names the summary file', () => {
    const out = planReport(
      plan,
      details({ edges: 5000, adjusted: 300, notes: 80 }),
      'plan.yaml',
      'plan.summary.json',
    );
    expect(lineCount(out)).toBeLessThan(60);
    expect(out).toContain('route.a0 route skill.b0: no journey');
    expect(out).toContain(`route.a${CONSOLE_LIST_LINES - 1} route`);
    expect(out).not.toContain(`route.a${CONSOLE_LIST_LINES} route`);
    expect(out).toContain(
      `and ${5000 - CONSOLE_LIST_LINES} more, all in plan.summary.json under "uncoveredEdges".`,
    );
    expect(out).toContain(`and ${300 - CONSOLE_LIST_LINES} more, all in plan.summary.json under "adjusted".`);
    expect(out).toContain(`and ${80 - CONSOLE_LIST_LINES} more, all in plan.summary.json under "notes".`);
  });

  it('prints a short list whole, with no line about the rest', () => {
    const out = planReport(
      plan,
      details({ edges: 4, adjusted: 2, notes: 1 }),
      'plan.yaml',
      'plan.summary.json',
    );
    expect(out).toContain('route.a3 route skill.b3: no journey');
    expect(out).toContain('Row row-1: a value left out.');
    expect(out).toContain('  note 0');
    expect(out).not.toContain(' more, all in ');
  });

  it('keeps every item in the summary file of a real run on an estate with many skills', async () => {
    const root = await mkdtemp(join(tmpdir(), 'driftbench-plan-console-'));
    const put = async (path: string, text: string) => {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text);
    };
    await put('CLAUDE.md', '# Standing\n\nAnswer in plain words.\n');
    for (let n = 0; n < 40; n += 1) {
      await put(
        `.claude/skills/chore-${n}/SKILL.md`,
        `---\nname: chore-${n}\ndescription: Sort out chore number ${n}. Use when the owner asks for chore ${n}.\n---\n\n# Chore ${n}\n`,
      );
    }
    const scanned = await run(['estate', 'scan', root, '--no-model', '--out', join(root, 'map.yaml')], root);
    expect(scanned.code).toBe(0);
    const planned = await run(
      ['estate', 'plan', join(root, 'map.yaml'), '--out', join(root, 'plan.yaml')],
      root,
    );
    expect(planned.code).toBe(0);
    expect(lineCount(planned.out)).toBeLessThanOrEqual(200);
    const summary = JSON.parse(await readFile(join(root, 'plan.summary.json'), 'utf8'));
    expect(summary.uncoveredEdges.length).toBeGreaterThan(CONSOLE_LIST_LINES);
    expect(planned.out).toContain(`and ${summary.uncoveredEdges.length - CONSOLE_LIST_LINES} more, all in `);
  }, 120_000);
});
