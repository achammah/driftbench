import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEstateMap } from '@agent-nexus/driftbench-estate';
import { jsonOut, REPO } from './bench';
import { FIXTURE, fixtureSuite } from './fixture-suite';
import { type Family, type ItemResult, itemsOf, type Tier } from './frame';

/**
 * estate.stats: the coverage lines of docs/estate.md section 7 ("Not built yet: coverage lines per atom kind:
 * atoms with an approved test over atoms; atoms enforced by a guard over atoms"), on the Northwind fixture.
 * The command and its JSON are written in docs/estate.md section 7, "The coverage command: `estate stats`",
 * and docs/reference/cli.md (frozen: a change needs an audit finding). The oracle
 * counts from the approved map and the generated suite: atoms of the kind; those named by a complete spec;
 * those whose enforcement lists a guard. Seed-free, judged once.
 */

const COMPONENT = 'packages/cli/src/commands/estate-stats.ts';

const KINDS: Array<[string, Tier]> = [
  ['instruction', 2],
  ['gate', 2],
  ['reference', 2],
  ['route', 1],
  ['skill', 1],
  ['script', 2],
  ['subagent', 2],
  ['guard', 2],
  ['tool', 2],
  ['register', 2],
  ['stage', 2],
  ['hazard', 3],
  ['setting', 3],
  ['invariant', 3],
];

type Line = 'tested' | 'enforced';
type Truth = Record<string, { atoms: number; tested: number; enforced: number }>;
type Reported = Record<string, { atoms?: number; tested?: number; enforced?: number }>;

const CAUSES: Record<Line, string> = {
  tested: 'report per atom kind the atoms with an approved test over the atoms',
  enforced: 'report per atom kind the atoms enforced by a guard over the atoms',
};

/** The guards the fixture's decision logs hold (docs/estate.md section 7, drift). */
const DRIFT_GUARDS = ['block-force-push.sh', 'read-before-edit.py', 'reply-length.py', 'stop-word.sh'];

type Seen = {
  skills: Set<string>;
  guards: Set<string>;
  reads: Set<string>;
  helpers: Set<string>;
  blocks: number;
};

/** Reach over the fixture's recorded sessions: the kinds whose moment a session shows. */
const REACH: Array<[string, Tier, (fields: Record<string, unknown>, seen: Seen) => boolean]> = [
  ['skill', 3, (fields, seen) => seen.skills.has(String(fields.name ?? ''))],
  ['guard', 3, (fields, seen) => seen.guards.has(String(fields.name ?? ''))],
  [
    'reference',
    3,
    (fields, seen) => [...seen.reads].some((read) => read.endsWith(`/${String(fields.path ?? '')}`)),
  ],
  ['subagent', 3, (fields, seen) => seen.helpers.has(String(fields.name ?? ''))],
];

/** What each recorded session shows, read by the validator from its transcript and its guard decision log. */
function sessionsSeen(folder: string): Seen[] {
  const names = readdirSync(folder).filter(
    (name) => name.endsWith('.jsonl') && !/\.(decisions|steps)\.jsonl$/.test(name),
  );
  return names.map((name) => {
    const seen: Seen = {
      skills: new Set(),
      guards: new Set(),
      reads: new Set(),
      helpers: new Set(),
      blocks: 0,
    };
    for (const line of readFileSync(join(folder, name), 'utf8').split('\n')) {
      if (line.trim() === '') continue;
      const record = JSON.parse(line) as { type?: string; message?: { content?: unknown } };
      const content = record.message?.content;
      if (record.type === 'user' && typeof content === 'string') seen.blocks += 1;
      const blocks = Array.isArray(content)
        ? (content as Array<{ type?: string; name?: string; input?: Record<string, unknown> }>)
        : [];
      for (const block of blocks) {
        if (block.type !== 'tool_use') continue;
        if (block.name === 'Skill') seen.skills.add(String(block.input?.skill ?? ''));
        if (block.name === 'Read') seen.reads.add(String(block.input?.file_path ?? ''));
        if (block.name === 'Agent' || block.name === 'Task')
          seen.helpers.add(String(block.input?.subagent_type ?? ''));
      }
    }
    const decisions = join(folder, name.replace(/\.jsonl$/, '.decisions.jsonl'));
    let log = '';
    try {
      log = readFileSync(decisions, 'utf8');
    } catch {
      log = '';
    }
    for (const line of log.split('\n').filter((entry) => entry.trim() !== '')) {
      seen.guards.add(String((JSON.parse(line) as { check?: string }).check ?? ''));
    }
    return seen;
  });
}

export function statsFamily(): Family {
  const family = 'estate.stats';
  const cells = KINDS.flatMap(([kind, tier]) =>
    (['tested', 'enforced'] as const).map((line) => ({ kind, line, tier })),
  );
  const items = itemsOf(family, 4, COMPONENT, [
    ...cells.map(({ kind, line, tier }) => ({
      key: `${line}-${kind}`,
      tier,
      title: `estate stats reports the ${kind} atoms ${line === 'tested' ? 'with an approved test' : 'enforced by a guard'}, over the ${kind} atoms`,
      cause: CAUSES[line],
    })),
    ...REACH.map(([kind, tier]) => ({
      key: `reach-${kind}`,
      tier,
      title: `estate stats reports, for every ${kind} atom, the recorded sessions that reached its moment`,
      cause: 'report reach per atom from the recorded sessions',
    })),
    ...DRIFT_GUARDS.map((guard) => ({
      key: `drift-${guard}`,
      tier: 3 as Tier,
      title: `estate stats reports the decisions and the denies of ${guard} in the recorded sessions`,
      cause: 'report the deny rate per guard from the decision logs',
    })),
    {
      key: 'decay-runs',
      tier: 3 as Tier,
      title: 'estate stats reports, for each block index, the recorded sessions that hold it',
      cause: 'report decay per block index from the recorded sessions',
    },
  ]);

  return {
    id: family,
    level: 4,
    component: COMPONENT,
    items,
    seedFree: true,
    async evaluate() {
      const out = new Map<string, ItemResult>();
      const suite = await fixtureSuite();
      const map = await loadEstateMap(join(FIXTURE, 'approved.yaml'));
      if (!map.ok) {
        for (const item of items) out.set(item.id, { pass: false, detail: 'the fixture map does not load' });
        return out;
      }
      const truth: Truth = {};
      for (const atom of map.map.atoms) {
        if (!atom.approved) continue;
        const entry = truth[atom.kind] ?? { atoms: 0, tested: 0, enforced: 0 };
        truth[atom.kind] = entry;
        entry.atoms += 1;
        if (suite.specs.some((spec) => spec.complete && spec.atoms.includes(atom.id))) entry.tested += 1;
        if ((atom.enforcement ?? []).length > 0) entry.enforced += 1;
      }
      const result = spawnSync(
        'pnpm',
        [
          '-s',
          'driftbench',
          'estate',
          'stats',
          '--map',
          suite.map,
          '--plan',
          join(suite.work, 'plan.yaml'),
          '--specs',
          join(suite.work, 'suite'),
          '--sessions',
          join(FIXTURE, 'sessions'),
          '--json',
        ],
        { cwd: REPO, encoding: 'utf8', timeout: 300_000 },
      );
      const text = `${result.stdout ?? ''}${result.stderr ?? ''}`;
      const json = jsonOut<{
        coverage?: { kinds?: Reported };
        reach?: Array<{ atom: string; reached?: number }>;
        decay?: Array<{ block: number; runs?: number }>;
        drift?: { guards?: Array<{ guard: string; decisions?: number; denies?: number }> };
      }>({ stdout: result.stdout ?? '' });
      const reported: Reported | undefined = json?.coverage?.kinds;
      const reach = json?.reach;
      const decay = json?.decay;
      const drift = json?.drift?.guards;
      const seen = sessionsSeen(join(FIXTURE, 'sessions'));
      const logs = readdirSync(join(FIXTURE, 'sessions'))
        .filter((name) => name.endsWith('.decisions.jsonl'))
        .flatMap((name) => readFileSync(join(FIXTURE, 'sessions', name), 'utf8').split('\n'))
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as { check?: string; verdict?: string });
      for (const guard of DRIFT_GUARDS) {
        const mine = logs.filter((entry) => entry.check === guard);
        const want = {
          decisions: mine.length,
          denies: mine.filter((entry) => entry.verdict === 'deny' || entry.verdict === 'block').length,
        };
        const got = drift?.find((entry) => entry.guard === guard);
        out.set(
          `${family}.drift-${guard}`,
          !drift
            ? { pass: false, detail: `estate stats printed no drift (exit ${result.status})` }
            : got?.decisions === want.decisions && got?.denies === want.denies
              ? { pass: true, detail: 'holds' }
              : {
                  pass: false,
                  detail: `reported ${got?.denies} denies of ${got?.decisions}, expected ${want.denies} of ${want.decisions}`,
                },
        );
      }
      for (const [kind, , reached] of REACH) {
        const id = `${family}.reach-${kind}`;
        if (!reach) {
          out.set(id, {
            pass: false,
            detail: `estate stats printed no reach (exit ${result.status}): ${text.trim().slice(0, 100)}`,
          });
          continue;
        }
        const wrong = map.map.atoms
          .filter((atom) => atom.approved && atom.kind === kind)
          .map(
            (atom) =>
              [atom.id, seen.filter((session) => reached(atom.fields ?? {}, session)).length] as const,
          )
          .filter(([atom, count]) => (reach?.find((entry) => entry.atom === atom)?.reached ?? -1) !== count);
        out.set(
          id,
          wrong.length === 0
            ? { pass: true, detail: 'holds' }
            : {
                pass: false,
                detail: `${wrong.length} ${kind} atoms with a wrong reach, such as ${wrong[0]?.[0]} (expected ${wrong[0]?.[1]})`,
              },
        );
      }
      {
        const most = Math.max(0, ...seen.map((session) => session.blocks));
        const wrong = Array.from({ length: most }, (_, block) => block).filter(
          (block) =>
            (decay?.find((entry) => entry.block === block)?.runs ?? -1) !==
            seen.filter((session) => session.blocks > block).length,
        );
        out.set(
          `${family}.decay-runs`,
          decay && wrong.length === 0
            ? { pass: true, detail: 'holds' }
            : {
                pass: false,
                detail: decay
                  ? `block ${wrong[0]} has the wrong number of runs`
                  : `estate stats printed no decay (exit ${result.status})`,
              },
        );
      }

      for (const { kind, line } of cells) {
        const id = `${family}.${line}-${kind}`;
        const want = truth[kind] ?? { atoms: 0, tested: 0, enforced: 0 };
        if (!reported) {
          out.set(id, {
            pass: false,
            detail: `estate stats printed no coverage (exit ${result.status}): ${text.trim().slice(0, 100)}`,
          });
          continue;
        }
        const got = reported[kind] ?? {};
        const ok = got.atoms === want.atoms && got[line] === want[line];
        out.set(
          id,
          ok
            ? { pass: true, detail: `holds (${want[line]} of ${want.atoms})` }
            : {
                pass: false,
                detail: `reported ${got[line]} of ${got.atoms}, expected ${want[line]} of ${want.atoms}`,
              },
        );
      }
      return out;
    },
  };
}
