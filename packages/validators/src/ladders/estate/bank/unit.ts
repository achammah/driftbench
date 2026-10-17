import { chmod, cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEstateMap } from '@agent-nexus/driftbench-estate';
import { cli } from './bench';
import { FIXTURE, fixtureSuite, type SuiteSpec } from './fixture-suite';
import { type Family, type ItemResult, itemsOf, type Tier } from './frame';

/**
 * unit.runner: the offline unit runner of docs/estate.md section 6 ("guards replayed with synthetic events;
 * scripts on fixtures"), on the Northwind fixture's generated unit specs. The command is
 * `driftbench estate unit <specs...> --estate <root> --json`, as docs/estate.md section 6 and
 * docs/reference/cli.md write it (frozen: a change needs an audit finding). For every guard of the fixture, the unit specs naming
 * it pass on the fixture, and turn red when its script is replaced by one that allows everything, or by one
 * that blocks everything; a guard whose message changes, or that runs past its timeout, turns a spec red; a
 * script run on its fixture passes, and turns red when the script fails. Seed-free, judged once.
 */

const COMPONENT = 'packages/cli/src/commands/estate-unit.ts';

type Guard = { script: string; event: string; message?: string; timeout?: number };

const GUARDS: Guard[] = [
  {
    script: '.claude/guards/block-force-push.sh',
    event: 'PreToolUse',
    message: 'Never run git push --force on any branch.',
  },
  { script: '.claude/guards/read-before-edit.py', event: 'PreToolUse', timeout: 5 },
  {
    script: '.claude/guards/ledger-guard.py',
    event: 'PostToolUse',
    message: 'never delete a file under ledger/',
  },
  { script: '.claude/guards/stop-word.sh', event: 'UserPromptSubmit' },
  {
    script: '.claude/guards/reply-length.py',
    event: 'Stop',
    message: 'Keep every reply under 1,200 characters',
  },
  { script: '.claude/skills/shipment-tracker/scripts/check-carrier.sh', event: 'PreToolUse' },
];
/** The helpers a subagent-alone unit spec runs with its agent file as the system prompt (docs/estate.md 6). */
const HELPERS = ['inbox-triager', 'ledger-auditor', 'route-planner'];
const SCRIPTS = [
  '.claude/skills/invoice-reconcile/scripts/reconcile.py',
  '.claude/skills/shipment-tracker/scripts/track.sh',
];

const ALLOW_ALL = '#!/bin/sh\ncat > /dev/null\nexit 0\n';
const BLOCK_ALL = '#!/bin/sh\ncat > /dev/null\necho "blocked by a broken guard" >&2\nexit 2\n';
const SLOW = '#!/bin/sh\ncat > /dev/null\nsleep 7\nexit 0\n';
const FAILING = '#!/bin/sh\necho "the script broke" >&2\nexit 1\n';

type Variant =
  | 'green'
  | 'allow-all'
  | 'block-all'
  | 'message'
  | 'timeout'
  | 'script-green'
  | 'script-broken'
  | 'helper-green'
  | 'helper-broken'
  | 'report-message'
  | 'report-time';
type Cell = { key: string; tier: Tier; title: string; cause: string; target: string; variant: Variant };

const base = (path: string) => path.split('/').pop() as string;
const eventCause = (event: string) =>
  `run guard unit specs on synthetic ${event} hook payloads and judge the decision`;

const CELLS: Cell[] = [
  ...GUARDS.flatMap((guard): Cell[] => [
    {
      key: `green-${base(guard.script)}`,
      tier: 2,
      title: `the unit specs of ${base(guard.script)} pass on the fixture`,
      cause: eventCause(guard.event),
      target: guard.script,
      variant: 'green',
    },
    {
      key: `allow-all-${base(guard.script)}`,
      tier: 3,
      title: `a unit spec of ${base(guard.script)} turns red when the guard allows everything`,
      cause: eventCause(guard.event),
      target: guard.script,
      variant: 'allow-all',
    },
    {
      key: `block-all-${base(guard.script)}`,
      tier: 3,
      title: `a unit spec of ${base(guard.script)} turns red when the guard blocks everything`,
      cause: eventCause(guard.event),
      target: guard.script,
      variant: 'block-all',
    },
  ]),
  ...GUARDS.filter((guard) => guard.message).map(
    (guard): Cell => ({
      key: `message-${base(guard.script)}`,
      tier: 4,
      title: `a unit spec of ${base(guard.script)} turns red when its message changes`,
      cause: 'judge the message a guard gives in a unit run',
      target: guard.script,
      variant: 'message',
    }),
  ),
  ...GUARDS.filter((guard) => guard.timeout).map(
    (guard): Cell => ({
      key: `timeout-${base(guard.script)}`,
      tier: 4,
      title: `a unit spec of ${base(guard.script)} turns red when the guard runs past its timeout`,
      cause: 'time a guard in a unit run against its declared timeout',
      target: guard.script,
      variant: 'timeout',
    }),
  ),
  ...GUARDS.filter((guard) => guard.message).map(
    (guard): Cell => ({
      key: `report-message-${base(guard.script)}`,
      tier: 3,
      title: `estate unit reports the message ${base(guard.script)} gives when it blocks`,
      cause: 'report the message of every guard run',
      target: guard.script,
      variant: 'report-message',
    }),
  ),
  ...GUARDS.map(
    (guard): Cell => ({
      key: `report-time-${base(guard.script)}`,
      tier: 3,
      title: `estate unit reports the running time of every run of ${base(guard.script)}${guard.timeout ? ', under its timeout' : ''}`,
      cause: 'report the running time of every guard run against its timeout',
      target: guard.script,
      variant: 'report-time',
    }),
  ),
  ...HELPERS.flatMap((helper): Cell[] => [
    {
      key: `helper-green-${helper}`,
      tier: 3,
      title: `the subagent-alone specs of ${helper} pass on the fixture`,
      cause: 'run a subagent alone with its agent file as the system prompt',
      target: `.claude/agents/${helper}.md`,
      variant: 'helper-green',
    },
    {
      key: `helper-broken-${helper}`,
      tier: 4,
      title: `a subagent-alone spec of ${helper} turns red when its agent file loses its body`,
      cause: 'run a subagent alone with its agent file as the system prompt',
      target: `.claude/agents/${helper}.md`,
      variant: 'helper-broken',
    },
  ]),
  ...SCRIPTS.flatMap((script): Cell[] => [
    {
      key: `script-green-${base(script)}`,
      tier: 2,
      title: `the fixture specs of ${base(script)} pass on the fixture`,
      cause: 'run a script on its declared inputs and check its outputs',
      target: script,
      variant: 'script-green',
    },
    {
      key: `script-broken-${base(script)}`,
      tier: 3,
      title: `a fixture spec of ${base(script)} turns red when the script fails`,
      cause: 'run a script on its declared inputs and check its outputs',
      target: script,
      variant: 'script-broken',
    },
  ]),
];

/** One guard run as `estate unit` reports it (docs/estate.md section 6). */
type Reported = { guard?: string; event?: string; decision?: string; message?: string; ms?: number };

/**
 * A kill is a spec that passes on the original estate and fails on the variant. A spec already red on the
 * original is an invalid test, never a kill: the variant did not turn it red.
 */
export function killVerdict(
  specs: readonly { id: string }[],
  original: ReadonlyMap<string, boolean>,
  variant: ReadonlyMap<string, boolean>,
  name: string,
): { valid: number; killed: boolean; detail: string } {
  const valid = specs.filter((spec) => original.get(spec.id) === true);
  const killed = valid.some((spec) => variant.get(spec.id) === false);
  return {
    valid: valid.length,
    killed,
    detail:
      valid.length === 0
        ? `invalid tests: none of the ${specs.length} unit specs passes on the original estate, so a red spec on the ${name} variant proves nothing`
        : killed
          ? 'holds'
          : `the ${valid.length} unit specs green on the original stay green on the ${name} variant`,
  };
}

/** The variants judged by a kill: a spec green on the original that turns red. */
const wantsOriginal = (cell: Cell): boolean =>
  !(cell.variant === 'green' || cell.variant === 'script-green' || cell.variant === 'helper-green');

function unitRun(
  estate: string,
  specs: readonly SuiteSpec[],
): { verdicts: Map<string, boolean>; guards: Reported[]; error?: string } {
  const result = cli(['estate', 'unit', ...specs.map((spec) => spec.path), '--estate', estate, '--json']);
  const at = result.out.indexOf('{');
  if (at < 0)
    return {
      verdicts: new Map(),
      guards: [],
      error: `estate unit printed no JSON (exit ${result.code}): ${result.out.trim().slice(0, 120)}`,
    };
  try {
    const json = JSON.parse(result.out.slice(at)) as {
      runs?: Array<{ spec: string; pass: boolean }>;
      guards?: Reported[];
    };
    return {
      verdicts: new Map((json.runs ?? []).map((run) => [run.spec, run.pass === true])),
      guards: json.guards ?? [],
    };
  } catch {
    return { verdicts: new Map(), guards: [], error: `estate unit printed no JSON (exit ${result.code})` };
  }
}

async function variantOf(work: string, cell: Cell, guard: Guard | undefined): Promise<string> {
  const root = join(work, cell.key);
  for (const name of ['CLAUDE.md', '.claude'])
    await cp(join(FIXTURE, name), join(root, name), { recursive: true });
  const path = join(root, cell.target);
  const write = async (text: string) => {
    await writeFile(path, text);
    await chmod(path, 0o755);
  };
  if (cell.variant === 'allow-all') await write(ALLOW_ALL);
  if (cell.variant === 'block-all') await write(BLOCK_ALL);
  if (cell.variant === 'timeout') await write(SLOW);
  if (cell.variant === 'script-broken') await write(FAILING);
  if (cell.variant === 'helper-broken') {
    const name = base(cell.target).replace(/\.md$/, '');
    await writeFile(path, `---\nname: ${name}\ndescription: A helper.\n---\n`);
  }
  if (cell.variant === 'message' && guard?.message) {
    await write(`#!/bin/sh\ninput=$(cat)\necho "a different message" >&2\nexit 2\n`);
  }
  return root;
}

export function unitFamily(): Family {
  const family = 'unit.runner';
  const items = itemsOf(
    family,
    4,
    COMPONENT,
    CELLS.map(({ key, tier, title, cause }) => ({ key, tier, title: `the unit runner: ${title}`, cause })),
  );
  return {
    id: family,
    level: 4,
    component: COMPONENT,
    items,
    seedFree: true,
    async evaluate() {
      const out = new Map<string, ItemResult>();
      const suite = await fixtureSuite();
      const map = await loadEstateMap(suite.map);
      const work = await mkdtemp(join(tmpdir(), 'estate-unit-'));
      try {
        // The native unit tests carry no outcome until one is recorded on the original estate (docs/estate.md
        // section 6): copy them, record, and check every variant against the recorded copies.
        const recorded = join(work, 'recorded');
        await mkdir(recorded, { recursive: true });
        const natives = suite.natives;
        const copies = new Map<string, SuiteSpec>();
        for (const spec of natives) {
          const path = join(recorded, `${spec.id}.json`);
          await cp(spec.path, path);
          copies.set(spec.id, { ...spec, path });
        }
        const recording = cli(['estate', 'unit', recorded, '--estate', FIXTURE, '--record', '--json']);
        const recordError =
          natives.length === 0
            ? 'the generated suite holds no native unit test'
            : recording.code > 1
              ? `estate unit --record exited ${recording.code}: ${recording.out.trim().slice(0, 140)}`
              : undefined;
        for (const cell of CELLS) {
          const guard = GUARDS.find((candidate) => candidate.script === cell.target);
          const atoms = map.ok
            ? map.map.atoms
                .filter(
                  (atom) =>
                    ((atom.kind === 'guard' || atom.kind === 'script') &&
                      String(atom.fields?.script ?? atom.fields?.path ?? '').endsWith(base(cell.target))) ||
                    (atom.kind === 'subagent' &&
                      `${String(atom.fields?.name ?? '')}.md` === base(cell.target)),
                )
                .map((atom) => atom.id)
            : [];
          const specs = natives
            .filter((spec) => spec.atoms.some((atom) => atoms.includes(atom)))
            .map((spec) => copies.get(spec.id) as SuiteSpec);
          if (recordError) {
            out.set(`${family}.${cell.key}`, { pass: false, detail: recordError });
            continue;
          }
          if (specs.length === 0) {
            out.set(`${family}.${cell.key}`, {
              pass: false,
              detail: `no unit spec names ${base(cell.target)}`,
            });
            continue;
          }
          const root = await variantOf(work, cell, guard);
          const { verdicts, guards, error } = unitRun(root, specs);
          if (error) {
            out.set(`${family}.${cell.key}`, { pass: false, detail: error });
            continue;
          }
          if (cell.variant === 'report-message' || cell.variant === 'report-time') {
            const runs = guards.filter((entry) => entry.guard === base(cell.target));
            const limit = (guard?.timeout ?? Number.POSITIVE_INFINITY) * 1000;
            const problem =
              runs.length === 0
                ? `no guard run of ${base(cell.target)} is reported`
                : cell.variant === 'report-message'
                  ? runs.some((entry) => String(entry.message ?? '').includes(guard?.message ?? '\u0000'))
                    ? undefined
                    : `no run of ${base(cell.target)} reports the message "${guard?.message}"`
                  : runs.every((entry) => typeof entry.ms === 'number' && entry.ms >= 0 && entry.ms <= limit)
                    ? undefined
                    : `a run of ${base(cell.target)} reports no time or a time over its timeout`;
            out.set(
              `${family}.${cell.key}`,
              problem ? { pass: false, detail: problem } : { pass: true, detail: 'holds' },
            );
            continue;
          }
          const green = specs.every((spec) => verdicts.get(spec.id) === true);
          // A kill is a spec that passes on the original estate and fails on the variant. A spec that is already
          // red on the original is an invalid test, never a kill: the variant did not turn it red.
          const original = wantsOriginal(cell) ? unitRun(FIXTURE, specs) : undefined;
          if (original?.error) {
            out.set(`${family}.${cell.key}`, { pass: false, detail: original.error });
            continue;
          }
          const kill = original ? killVerdict(specs, original.verdicts, verdicts, cell.variant) : undefined;
          if (kill && kill.valid === 0) {
            out.set(`${family}.${cell.key}`, { pass: false, detail: kill.detail });
            continue;
          }
          const red = kill?.killed === true;
          const stays = kill?.detail ?? '';
          const wantsGreen =
            cell.variant === 'green' || cell.variant === 'script-green' || cell.variant === 'helper-green';
          out.set(
            `${family}.${cell.key}`,
            wantsGreen
              ? green
                ? { pass: true, detail: 'holds' }
                : {
                    pass: false,
                    detail: `${specs.filter((spec) => verdicts.get(spec.id) !== true).length} of ${specs.length} unit specs fail on the fixture`,
                  }
              : red
                ? { pass: true, detail: 'holds' }
                : { pass: false, detail: stays },
          );
        }
      } finally {
        await rm(work, { recursive: true, force: true });
      }
      return out;
    },
  };
}
