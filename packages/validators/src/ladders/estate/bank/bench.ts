import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type EstateMap, mutateEstate, readerFor, scanEstate } from '@agent-nexus/driftbench-estate';
import { PhraseBank } from '@agent-nexus/driftbench-generate';
import { stringify } from 'yaml';
import { findRoot } from '../../../root';
import { ROOT, RUNTIME, SETTINGS, STANDING, skillFile } from '../layout';
import { writeEstate } from '../pipeline';
import { namesFor, plantSkill, rule, writeSettings } from './common';
import { type Family, type ItemResult, itemsOf, type Tier } from './frame';
import { type Case, judgeCase, standardSkill } from './hostile';
import { BASE } from './planted';

/**
 * bench.defects: the defects a model-free bench run found on a real estate, turned into items on fictional
 * estates with exact oracles (docs/validators.md section 12.2, the parity and adversarial sources). Each item
 * names the defect it comes from:
 * - D2: the reference index offers files under folders the scan ignores (node_modules, test folders, trash);
 * - D5: a delete mutant of an atom quoted in a JSON file is refused, so guards and settings get no mutant;
 * - D6: `estate run --map <mutant>/map.yaml` pins only the mutant's hash and drops the original's;
 * - D7: generation refuses a phrase bank with no situation, so a model-free run gets no gap report;
 * - D9: a registry row naming its guard by the adapter's short name, and an id cell holding several ids;
 * - scale: a routing table longer than one prose chunk loses the rows past the chunk's end (283 of 5003 atoms
 *   at 5000 atoms, and 1132 lint findings on a clean estate).
 */

const CLAUDE_CODE = 'packages/estate/src/scan/claude-code.ts';
const CODE = 'packages/estate/src/scan/code.ts';
const MUTATE = 'packages/estate/src/mutants/mutate.ts';
const LIVE = 'packages/cli/src/commands/estate-live.ts';
const BANK_SCHEMA = 'packages/generate/src/estate/inputs.ts';

export const REPO = findRoot(fileURLToPath(new URL('.', import.meta.url)));

type Run = {
  key: string;
  tier: Tier;
  title: string;
  component: string;
  cause: string;
  run(seed: number): Promise<ItemResult>;
};

// D2 ----------------------------------------------------------------------------------------------------------

/** The metadata of an ignored-folder case: a bare file name whose other copy sits under a folder the scan ignores. */
function ignoredCopy(key: string, folder: string, tier: Tier): Omit<Case, 'plant'> {
  return {
    key: `ignored-${key}`,
    tier,
    title: `a bare file name whose other copy sits under ${folder}: one reference, no ambiguity (D2)`,
    component: CODE,
    cause: 'resolve named paths only among the files the scan does not ignore',
  };
}

/** The bare-name line goes in the skill body: plantSkill wrote it through standardSkill's body. */
function ignoredCases(): Case[] {
  const forms: Array<[string, string, Tier]> = [
    ['node-modules', 'node_modules', 2],
    ['hooks-tests', `${ROOT}/hooks/guards/tests`, 3],
    ['trash', '.trash', 2],
    ['synced', `${ROOT}/skills/synced`, 3],
    ['pycache', `${ROOT}/hooks/__pycache__`, 2],
    ['fixtures', 'tests/fixtures', 2],
  ];
  return forms.map(([key, folder, tier]) => {
    const base = ignoredCopy(key, folder, tier);
    return {
      ...base,
      plant: (e, s, o) => {
        const names = standardSkill(e, s, o, ['When unsure, open `guide.md`.']);
        const path = skillFile(names.skill, 'references/guide.md');
        e.raw(path, '# Guide\n', o);
        e.raw(`${folder}/${names.skill}-old/references/guide.md`, '# Old guide\n', o);
        // The bare name on line 10 of the definition names the skill's own copy.
        e.expect(o, {
          hid: `${o}:ref`,
          kind: 'reference',
          file: skillFile(names.skill, 'SKILL.md'),
          line: 10,
          key: path,
        });
        e.check(o, (scan) => {
          const problems: string[] = [];
          for (const atom of scan.map.atoms.filter((candidate) => candidate.kind === 'reference')) {
            if (JSON.stringify(atom.fields ?? {}).includes(folder))
              problems.push(`a reference names a file under ${folder}`);
          }
          const ambiguous = scan.lint.findings.filter((finding) => finding.code === 'AMBIGUOUS_REFERENCE');
          if (ambiguous.length > 0)
            problems.push(`the lint gave AMBIGUOUS_REFERENCE on ${ambiguous[0]?.subject}`);
          return problems.length > 0 ? problems.join('; ') : undefined;
        });
      },
    };
  });
}

// Names that fit several files (docs/estate.md section 1, "Names that fit several files") ---------------------

const AMBIGUOUS_CAUSE =
  'resolve a bare name from its own folder, then below it, then from the root; else list the candidates';

/** A skill whose line 10 names `name`; files planted at the given paths, owned by the item. */
function ambiguousCase(
  key: string,
  tier: Tier,
  title: string,
  name: string,
  files: (own: string, other: (index: number) => string) => string[],
  expected: ((own: string, other: (index: number) => string) => string) | 'ambiguous',
): Case {
  return {
    key: `name-${key}`,
    tier,
    title: `${title} (names that fit several files)`,
    component: CODE,
    cause: AMBIGUOUS_CAUSE,
    plant: (e, s, o) => {
      const names = namesFor(s, o);
      const own = (path: string) => skillFile(names.skill, path);
      const other = (index: number) => `${namesFor(s, `${o}:${index}`).skill}`;
      for (const path of files(own(''), other)) e.raw(path, '# Guide\n', o);
      if (expected === 'ambiguous') {
        // The naming line is the base's: its reference has no single key; the checks judge it.
        plantSkill(
          e,
          BASE,
          names.skill,
          'Checks things.',
          [{ text: 'Always name the record first.' }, { text: `When unsure, open \`${name}\`.` }],
          { id: o },
        );
        e.check(o, (scan) => {
          const atom = scan.map.atoms.find(
            (candidate) => candidate.kind === 'reference' && candidate.provenance.file === own('SKILL.md'),
          );
          const want = files(own(''), other)
            .filter((path) => !path.startsWith(own('')))
            .sort();
          const got = (atom?.fields?.candidates as string[] | undefined) ?? [];
          const problems: string[] = [];
          if (JSON.stringify([...got].sort()) !== JSON.stringify(want))
            problems.push(`candidates ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
          if (!scan.lint.findings.some((finding) => finding.code === 'AMBIGUOUS_REFERENCE'))
            problems.push('the lint gave no AMBIGUOUS_REFERENCE');
          return problems.length > 0 ? problems.join('; ') : undefined;
        });
        return;
      }
      standardSkill(e, s, o, [`When unsure, open \`${name}\`.`]);
      e.expect(o, {
        hid: `${o}:ref`,
        kind: 'reference',
        file: own('SKILL.md'),
        line: 10,
        key: expected(own(''), other),
      });
      e.check(o, (scan) =>
        scan.lint.findings.some((finding) => finding.code === 'AMBIGUOUS_REFERENCE')
          ? 'the lint gave AMBIGUOUS_REFERENCE on a name that resolves'
          : undefined,
      );
    },
  };
}

function ambiguousCases(): Case[] {
  const skillOf = (name: string, path: string) => skillFile(name, path);
  return [
    ambiguousCase(
      'own-folder',
      2,
      'a bare name its own skill holds resolves there, whatever other skills hold',
      'guide.md',
      (own, other) => [`${own}references/guide.md`, skillOf(other(1), 'references/guide.md')],
      (own) => `${own}references/guide.md`,
    ),
    ambiguousCase(
      'below-folder',
      3,
      'a bare name found below the naming folder resolves there',
      'guide.md',
      (own, other) => [`${own}references/deep/guide.md`, skillOf(other(1), 'references/guide.md')],
      (own) => `${own}references/deep/guide.md`,
    ),
    ambiguousCase(
      'root-file',
      3,
      'a bare name the estate root holds resolves there before another skill',
      'guide.md',
      (_own, other) => ['guide.md', skillOf(other(1), 'references/guide.md')],
      () => 'guide.md',
    ),
    ambiguousCase(
      'with-folder',
      2,
      'a name with a folder resolves from the naming folder, never ambiguous',
      'references/guide.md',
      (own, other) => [
        `${own}references/guide.md`,
        skillOf(other(1), 'references/guide.md'),
        skillOf(other(2), 'references/guide.md'),
      ],
      (own) => `${own}references/guide.md`,
    ),
    ambiguousCase(
      'two-elsewhere',
      4,
      'a bare name two other skills hold lists both candidates and is linted',
      'guide.md',
      (_own, other) => [skillOf(other(1), 'references/guide.md'), skillOf(other(2), 'references/guide.md')],
      'ambiguous',
    ),
  ];
}

// D9 ----------------------------------------------------------------------------------------------------------

function registryCase(
  key: string,
  tier: Tier,
  title: string,
  cause: string,
  table: (guard: string) => string[],
  expectIds: string[],
): Case {
  return {
    key,
    tier,
    title,
    component: CLAUDE_CODE,
    cause,
    plant: (e, s, o) => {
      const names = namesFor(s, o);
      const writer = e.file(STANDING, o);
      writer.line('# Planted estate');
      writer.line('');
      const planted = rule(`${o}:rule`, 'Never delete a record under the archive folder.');
      writer.line(`- **R1.** ${planted.text}`, planted.atoms, planted.prose);
      const stem = `${names.noun}-firewall`;
      const script = `${ROOT}/hooks/${stem}.py`;
      e.raw(script, 'import sys\nsys.exit(0)\n', o);
      writeSettings(e, [
        {
          owner: o,
          event: 'PreToolUse',
          matcher: 'Bash',
          command: `"$CLAUDE_PROJECT_DIR"/${script}`,
          atoms: [{ hid: `${o}:guard`, kind: 'guard', key: `${stem}.py` }],
        },
      ]);
      e.raw(`${ROOT}/hooks/CHECK-REGISTRY.md`, [...table('firewall'), ''].join('\n'), o);
      e.edge(o, `${o}:guard`, `${o}:rule`, 'enforces');
      e.check(o, (scan) => {
        const ids = scan.raw.registry.map((row) => row.id);
        const missing = expectIds.filter((id) => !ids.includes(id));
        const rowless = scan.lint.findings.filter((finding) => finding.code === 'REGISTRY_ROW');
        return (
          [
            ...(missing.length > 0
              ? [`registry ids ${JSON.stringify(ids)}, missing ${missing.join(', ')}`]
              : []),
            ...(rowless.length > 0 ? [`the lint gave REGISTRY_ROW on ${rowless[0]?.subject}`] : []),
          ].join('; ') || undefined
        );
      });
    },
  };
}

const ADAPTER_CAUSE = "match a registry row to the guard whose script is named after the row's adapter";
const IDS_CAUSE = 'split an id cell holding several backticked ids and trailing words into its ids';

function registryCases(): Case[] {
  return [
    registryCase(
      'adapter-short-name',
      3,
      "a registry row naming its guard by the adapter's short name enforces through that guard (D9)",
      ADAPTER_CAUSE,
      () => ['| Id | Adapter | Enforces |', '|---|---|---|', '| G1 | firewall | R1 |'],
      ['G1'],
    ),
    registryCase(
      'adapter-backticked',
      3,
      'a registry row naming the adapter in backticks enforces through its guard (D9)',
      ADAPTER_CAUSE,
      () => ['| Id | Adapter | Rules |', '|---|---|---|', '| G1 | `firewall` | R1 |'],
      ['G1'],
    ),
    registryCase(
      'ids-slash-trailing',
      4,
      'an id cell holding two backticked ids and trailing words names both checks (D9)',
      IDS_CAUSE,
      () => ['| Id | Adapter | Enforces |', '|---|---|---|', '| `G1` / `G2` hold | firewall | R1 |'],
      ['G1', 'G2'],
    ),
  ];
}

// Scale: a routing table longer than one prose chunk ----------------------------------------------------------

export function longTable(key: string, tier: Tier, rows: number, lintToo: boolean): Case {
  return {
    key,
    tier,
    title: `a routing table of ${rows} rows: every row a route${lintToo ? ', and no orphan skill' : ''} (scale)`,
    component: CODE,
    cause: 'read routing rows that continue past the end of a prose chunk',
    plant: (e, s, o) => {
      const writer = e.file(STANDING, o);
      writer.line('# Planted estate');
      writer.line('');
      writer.line('| When the user wants to | Load |');
      writer.line('|---|---|');
      for (let index = 0; index < rows; index += 1) {
        const name = `${namesFor(s, `${o}:${index}`).noun}-task-${index}`;
        // Each skill states its own atoms: the skill on its name line, the route on its description line.
        const skill = e.file(skillFile(name, 'SKILL.md'), o);
        skill.line('---');
        skill.line(`name: ${name}`, [{ hid: `${o}:skill${index}`, kind: 'skill', key: name }]);
        skill.line(`description: Handle task ${index}.`, [
          { hid: `${o}:desc${index}`, kind: 'route', key: name },
        ]);
        skill.lines_(['---', '', `# ${name}`]);
        e.edge(o, `${o}:desc${index}`, `${o}:skill${index}`, 'route');
        writer.line(`| handle task ${index} with the long wording of a real routing row | \`${name}\` |`, [
          { hid: `${o}:row${index}`, kind: 'route', key: name },
        ]);
      }
      e.check(o, (scan) => {
        const routes = scan.map.atoms.filter(
          (atom) => atom.kind === 'route' && atom.provenance.file === STANDING,
        );
        const problems: string[] = [];
        if (routes.length < rows) problems.push(`${routes.length} of ${rows} table rows read as routes`);
        if (lintToo) {
          const orphans = scan.lint.findings.filter((finding) => finding.code === 'ORPHAN');
          if (orphans.length > 0) problems.push(`the lint gave ${orphans.length} ORPHAN findings`);
        }
        return problems.length > 0 ? problems.join('; ') : undefined;
      });
    },
  };
}

// D5: delete mutants of atoms quoted in JSON ---------------------------------------------------------------

const silent = {
  family: 'bench',
  model: 'none',
  async complete(request: { user: string }) {
    return JSON.stringify({ chunk: /CHUNK: (\S+)/.exec(request.user)?.[1] ?? '', atoms: [] });
  },
};

async function scanFolder(root: string): Promise<EstateMap> {
  const reader = readerFor(RUNTIME);
  if (!reader) throw new Error(`no reader for ${RUNTIME}`);
  return (await scanEstate({ root, reader, port: silent, now: () => new Date('2026-10-11T00:00:00.000Z') }))
    .map;
}

function jsonEstate(seed: number): Record<string, string> {
  const names = namesFor(seed, 'bench.json');
  const guard = `${ROOT}/hooks/${names.noun}-guard.py`;
  const guard2 = `${ROOT}/hooks/${names.verb}-check.py`;
  return {
    [STANDING]: '# Planted estate\n\n- Never delete a record under the archive folder.\n',
    [guard]: 'import sys\nsys.exit(0)\n',
    [guard2]: 'import sys\nsys.exit(0)\n',
    [SETTINGS]: `${JSON.stringify(
      {
        permissions: { allow: ['Read', 'Edit'], deny: ['WebFetch'] },
        env: { BAKERY_MODE: 'quiet', FERRY_LIMIT: '3' },
        hooks: {
          PreToolUse: [
            {
              matcher: 'Bash',
              hooks: [
                { type: 'command', command: `"$CLAUDE_PROJECT_DIR"/${guard}` },
                { type: 'command', command: `"$CLAUDE_PROJECT_DIR"/${guard2}` },
              ],
            },
          ],
        },
      },
      null,
      2,
    )}\n`,
    [`${ROOT}/steps.json`]: `${JSON.stringify(
      {
        steps: [
          { id: 'plan', next: ['do'] },
          { id: 'do', next: ['check'] },
          { id: 'check', next: [] },
        ],
      },
      null,
      2,
    )}\n`,
  };
}

function deleteCase(
  key: string,
  tier: Tier,
  title: string,
  pick: (map: EstateMap) => string | undefined,
  cause: string,
): Run {
  return {
    key,
    tier,
    title,
    component: MUTATE,
    cause,
    async run(seed) {
      const root = await writeEstate(jsonEstate(seed));
      try {
        const map = await scanFolder(root);
        const id = pick(map);
        if (!id) return { pass: false, detail: 'the scan gave no atom of the kind the item deletes' };
        const atom = map.atoms.find((candidate) => candidate.id === id);
        const file = atom?.provenance.file ?? '';
        try {
          await mutateEstate({ root, map }, { delete: id });
        } catch (cause) {
          return {
            pass: false,
            detail: `the delete of ${id} was refused: ${cause instanceof Error ? cause.message : String(cause)}`,
          };
        }
        const text = await readFile(join(root, file), 'utf8');
        if (file.endsWith('.json')) {
          try {
            JSON.parse(text);
          } catch {
            return { pass: false, detail: `${file} is no longer JSON after the delete` };
          }
        }
        const after = await scanFolder(root);
        const left = after.atoms.filter((candidate) => candidate.kind === atom?.kind).length;
        const before = map.atoms.filter((candidate) => candidate.kind === atom?.kind).length;
        return left < before
          ? { pass: true, detail: 'holds' }
          : { pass: false, detail: `the mutant still holds ${left} ${atom?.kind} atoms, as the original` };
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  };
}

const JSON_DELETE = 'delete an atom quoted in a JSON object by removing its member, keeping the file JSON';

function mutateCases(): Run[] {
  const first =
    (kind: string, test: (map: EstateMap['atoms'][number]) => boolean = () => true) =>
    (map: EstateMap) =>
      map.atoms.find((atom) => atom.kind === kind && test(atom))?.id;
  return [
    deleteCase(
      'delete-settings-guard',
      3,
      'a guard declared in the settings hooks can be deleted (D5)',
      first('guard'),
      JSON_DELETE,
    ),
    deleteCase(
      'delete-env-setting',
      3,
      'a setting under env can be deleted (D5)',
      first('setting', (atom) => String(atom.fields?.key ?? '').startsWith('env')),
      JSON_DELETE,
    ),
    deleteCase(
      'delete-allow-rule',
      1,
      'an allow rule in the permissions list can be deleted (D5 control)',
      first('tool', (atom) => atom.fields?.effect === 'allow'),
      JSON_DELETE,
    ),
    deleteCase(
      'delete-deny-rule',
      2,
      'a deny rule in the permissions list can be deleted (D5)',
      first('tool', (atom) => atom.fields?.effect === 'deny'),
      JSON_DELETE,
    ),
    deleteCase(
      'delete-second-hook',
      4,
      'the second command of a hook entry holding two can be deleted (D5)',
      (map) => map.atoms.filter((atom) => atom.kind === 'guard')[1]?.id,
      JSON_DELETE,
    ),
    deleteCase(
      'delete-json-stage',
      3,
      'a stage of a JSON step list can be deleted (D5)',
      first('stage'),
      JSON_DELETE,
    ),
  ];
}

// D6 and D7: commands run through the CLI ----------------------------------------------------------------------

/** What a CLI child process printed: both streams apart, and joined as `out` for a message that shows both. */
export type CliResult = { code: number; out: string; stdout: string; stderr: string };

/** Runs the CLI as a child process from the repository root (the component as checked out). */
export function cli(args: string[], cwd = REPO): CliResult {
  const result = spawnSync('pnpm', ['-s', 'driftbench', ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 120_000,
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  return { code: result.status ?? -1, out: `${stdout}${stderr}`, stdout, stderr };
}

/**
 * The JSON a `--json` command printed: from the first `{` of its standard output. A warning on the error stream
 * (a Node notice, a package manager line) is diagnostics and never part of the document. Undefined when standard
 * output holds no object or it does not parse.
 */
export function jsonOut<T = unknown>(result: Pick<CliResult, 'stdout'>): T | undefined {
  const at = result.stdout.indexOf('{');
  if (at < 0) return undefined;
  try {
    return JSON.parse(result.stdout.slice(at)) as T;
  } catch {
    return undefined;
  }
}

function liveCases(): Run[] {
  const pinsOf = async (seed: number, withMap: boolean): Promise<ItemResult> => {
    const root = await writeEstate(jsonEstate(seed));
    const work = await mkdtemp(join(tmpdir(), 'bench-live-'));
    try {
      const map = join(work, 'map.yaml');
      const scanned = cli(['estate', 'scan', root, '--no-model', '--out', map]);
      if (scanned.code !== 0) return { pass: false, detail: `the scan exited ${scanned.code}` };
      const text = await readFile(map, 'utf8');
      const atom = /\n {2}- id: (tool\.settings\.allow-[\w-]+)/.exec(text)?.[1];
      if (!atom) return { pass: false, detail: 'no allow rule to delete' };
      const mutant = join(work, 'mutant');
      const made = cli(['estate', 'mutate', map, '--atom', atom, '--delete', '--to', mutant]);
      if (made.code !== 0) return { pass: false, detail: `mutate exited ${made.code}` };
      const original = JSON.parse(await readFile(join(mutant, 'mutant.json'), 'utf8')) as {
        originalMapHash?: string;
      };
      const specs = join(work, 'specs');
      await writeFile(join(work, 'placeholder'), '');
      await import('node:fs/promises').then((fs) => fs.mkdir(specs));
      await writeFile(
        join(specs, 'one.yaml'),
        stringify({
          id: 'bench.pin',
          version: '1',
          kind: 'task',
          title: 'A pin check',
          target: { adapter: 'claude-code' },
          blocks: [
            {
              id: 'ask',
              when: { user: 'Please check the archive.' },
              expect: { tools: [{ label: 'WebFetch', count: 0 }] },
            },
          ],
        }),
      );
      const ran = cli([
        'estate',
        'run',
        specs,
        '--runtime',
        'claude-code',
        '--estate',
        mutant,
        ...(withMap ? ['--map', join(mutant, 'map.yaml')] : []),
        '--store',
        join(work, 'runs.db'),
        '--command',
        join(REPO, 'examples/estates/fixture/live/fake/claude.mjs'),
        '--json',
      ]);
      const parsed = jsonOut<{ pins?: string[] }>(ran);
      if (!parsed) {
        return {
          pass: false,
          detail: `estate run printed no JSON (exit ${ran.code}): ${ran.out.slice(0, 160)}`,
        };
      }
      const pins = parsed.pins ?? [];
      return original.originalMapHash && pins.includes(original.originalMapHash)
        ? { pass: true, detail: 'holds' }
        : {
            pass: false,
            detail: `pins ${JSON.stringify(pins.map((pin) => pin.slice(0, 12)))} drop the original map hash`,
          };
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(work, { recursive: true, force: true });
    }
  };
  return [
    {
      key: 'run-mutant-with-map',
      tier: 3,
      title: "estate run with --map on a mutant folder keeps the original map's pin (D6)",
      component: LIVE,
      cause: "keep the original map's pin of a mutant folder when --map is given",
      run: (seed) => pinsOf(seed, true),
    },
    {
      key: 'run-mutant-without-map',
      tier: 1,
      title: "estate run on a mutant folder pins the original and the mutant's hash (D6 control)",
      component: LIVE,
      cause: "keep the original map's pin of a mutant folder when --map is given",
      run: (seed) => pinsOf(seed, false),
    },
  ];
}

function bankCases(): Run[] {
  return [
    {
      key: 'empty-bank-schema',
      tier: 2,
      title:
        'a phrase bank with no situation is a valid bank, so generation can report what each row needs (D7)',
      component: BANK_SCHEMA,
      cause: 'accept a phrase bank with no situation and report every row as needing a phrase',
      async run() {
        const parsed = PhraseBank.safeParse({
          version: 1,
          estate: 'bakery',
          mapHash: 'a'.repeat(64),
          workspaces: [],
          situations: [],
        });
        return parsed.success
          ? { pass: true, detail: 'holds' }
          : {
              pass: false,
              detail: `the bank is refused: ${parsed.error.issues[0]?.path.join('.')}: ${parsed.error.issues[0]?.message}`,
            };
      },
    },
  ];
}

// The family ----------------------------------------------------------------------------------------------------

export function benchFamily(): Family {
  const family = 'bench.defects';
  const cases: Case[] = [
    ...ignoredCases(),
    ...ambiguousCases(),
    ...registryCases(),
    longTable('long-routing-table', 3, 400, false),
    longTable('long-routing-table-lint', 3, 400, true),
  ];
  const runs: Run[] = [...mutateCases(), ...liveCases(), ...bankCases()];
  const items = itemsOf(family, 1, CODE, [
    ...cases.map(({ key, tier, title, component, cause }) => ({
      key,
      tier,
      title: `the estate loop handles ${title}`,
      ...(component ? { component } : {}),
      ...(cause ? { cause } : {}),
    })),
    ...runs.map(({ key, tier, title, component, cause }) => ({
      key,
      tier,
      title: `the estate loop handles ${title}`,
      component,
      cause,
    })),
  ]);
  return {
    id: family,
    level: 1,
    component: CODE,
    items,
    async evaluate(seed) {
      const out = new Map<string, ItemResult>();
      for (const item of cases) out.set(`${family}.${item.key}`, await judgeCase(seed, family, item));
      for (const item of runs) {
        try {
          out.set(`${family}.${item.key}`, await item.run(seed));
        } catch (cause) {
          out.set(`${family}.${item.key}`, {
            pass: false,
            detail: `the item threw: ${cause instanceof Error ? cause.message.slice(0, 160) : String(cause)}`,
          });
        }
      }
      return out;
    },
  };
}
