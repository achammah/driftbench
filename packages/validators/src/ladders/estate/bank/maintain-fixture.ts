import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type EstateMap, loadEstateMap } from '@agent-nexus/driftbench-estate';
import { cli, jsonOut, REPO } from './bench';
import { FIXTURE, fixtureSuite } from './fixture-suite';
import { type Family, type ItemResult, itemsOf, type Tier } from './frame';

/**
 * maintain.fixture: maintenance on real diffs of the Northwind fixture (docs/estate.md section 8). Each item
 * is one version of the fixture: an edit of its structure (settings, hooks, frontmatter, the step list, a
 * helper), or the fixture's two committed versions. Both versions are scanned with the recorded answers,
 * diffed, and `estate impact` runs over the fixture's generated suite. The oracle, written without the
 * component: an atom of the old map changed when its quote, white space folded, no longer stands in its file
 * of the new version. Impact must touch (retire, regenerate or re-approve) exactly the specs that name a
 * changed atom: none for a pure reformat or reorder, all of them for a removal. A change whose meaning sits on
 * another line than the atom's quote (a hook's matcher) has no quote oracle and is left out. Seed-free, judged once.
 */

const IMPACT = 'packages/estate/src/maintain/impact.ts';
const DIFF = 'packages/estate/src/maintain/diff.ts';

type Edit = {
  key: string;
  tier: Tier;
  title: string;
  cause: string;
  component?: string;
  apply(root: string): Promise<void>;
};

async function edit(root: string, file: string, change: (text: string) => string): Promise<void> {
  const path = join(root, file);
  const before = await readFile(path, 'utf8');
  const after = change(before);
  if (after === before) throw new Error(`the edit of ${file} changed nothing`);
  await writeFile(path, after);
}

const SETTINGS = '.claude/settings.json';
// biome-ignore lint/suspicious/noExplicitAny: the settings JSON is edited in place, key by key
type Json = Record<string, any>;
const json = (root: string, change: (value: Json) => void, indent = 2) =>
  edit(root, SETTINGS, (text) => {
    const value = JSON.parse(text) as Json;
    change(value);
    return `${JSON.stringify(value, null, indent)}\n`;
  });

const RETIRE = 'retire, regenerate or re-approve exactly the specs of the atoms that changed';
const UNTOUCHED = 'touch no spec when no atom changed its words';

const EDITS: Edit[] = [
  {
    key: 'remove-allow',
    tier: 1,
    title: 'an allow rule removed',
    cause: RETIRE,
    apply: (r) => json(r, (v) => v.permissions.allow.splice(v.permissions.allow.indexOf('Glob'), 1)),
  },
  {
    key: 'change-allow',
    tier: 2,
    title: 'an allow rule narrowed',
    cause: RETIRE,
    apply: (r) =>
      json(r, (v) => {
        v.permissions.allow[v.permissions.allow.indexOf('Bash(python3 *)')] = 'Bash(python3 scripts/*)';
      }),
  },
  {
    key: 'add-allow',
    tier: 1,
    title: 'an allow rule added',
    cause: UNTOUCHED,
    apply: (r) => json(r, (v) => v.permissions.allow.push('Bash(ls)')),
  },
  {
    key: 'remove-deny',
    tier: 1,
    title: 'a deny rule removed',
    cause: RETIRE,
    apply: (r) => json(r, (v) => v.permissions.deny.splice(v.permissions.deny.indexOf('WebFetch'), 1)),
  },
  {
    key: 'remove-ask',
    tier: 2,
    title: 'an ask rule removed',
    cause: RETIRE,
    apply: (r) =>
      json(r, (v) => {
        v.permissions.ask = [];
      }),
  },
  {
    key: 'reorder-allow',
    tier: 2,
    title: 'the allow rules reordered',
    cause: UNTOUCHED,
    apply: (r) => json(r, (v) => v.permissions.allow.reverse()),
  },
  {
    key: 'reformat-settings',
    tier: 2,
    title: 'the settings reformatted with four spaces',
    cause: UNTOUCHED,
    apply: (r) => json(r, () => {}, 4),
  },
  {
    key: 'change-env',
    tier: 2,
    title: 'an env value changed',
    cause: RETIRE,
    apply: (r) =>
      json(r, (v) => {
        v.env.NORTHWIND_REGION = 'eu-north';
      }),
  },
  {
    key: 'remove-env',
    tier: 2,
    title: 'an env key removed',
    cause: RETIRE,
    apply: (r) =>
      json(r, (v) => {
        delete v.env.NORTHWIND_LEDGER_DIR;
      }),
  },
  {
    key: 'remove-stop-hook',
    tier: 2,
    title: 'the Stop hook removed',
    cause: RETIRE,
    apply: (r) =>
      json(r, (v) => {
        delete v.hooks.Stop;
      }),
  },

  {
    key: 'rename-guard-script',
    tier: 3,
    title: 'a guard script renamed in its hook',
    cause: RETIRE,
    apply: async (r) => {
      await cp(join(r, '.claude/guards/stop-word.sh'), join(r, '.claude/guards/halt-word.sh'));
      await rm(join(r, '.claude/guards/stop-word.sh'));
      await edit(r, SETTINGS, (text) => text.replace('stop-word.sh', 'halt-word.sh'));
    },
  },
  {
    key: 'skill-description',
    tier: 2,
    title: "a skill's description reworded",
    cause: RETIRE,
    apply: (r) =>
      edit(r, '.claude/skills/weekly-report/SKILL.md', (text) =>
        text.replace(
          /^description: (.*)$/m,
          (_l, d: string) => `description: ${d.replace(/report/, 'summary')}`,
        ),
      ),
  },
  {
    key: 'skill-allowed-tools',
    tier: 3,
    title: "a skill's allowed tools narrowed",
    cause: RETIRE,
    apply: (r) =>
      edit(r, '.claude/skills/weekly-report/SKILL.md', (text) =>
        text.replace('allowed-tools: Read, Write, Bash(python3 *)', 'allowed-tools: Read, Write'),
      ),
  },
  {
    key: 'helper-description',
    tier: 2,
    title: "a helper's description reworded",
    cause: RETIRE,
    apply: (r) =>
      edit(r, '.claude/agents/route-planner.md', (text) =>
        text.replace("tomorrow's delivery routes", "the next day's delivery routes"),
      ),
  },
  {
    key: 'helper-tools',
    tier: 3,
    title: "a helper's tools narrowed",
    cause: RETIRE,
    apply: (r) =>
      edit(r, '.claude/agents/ledger-auditor.md', (text) =>
        text.replace('tools: Read, Grep, Glob', 'tools: Read, Grep'),
      ),
  },
  {
    key: 'remove-stage',
    tier: 2,
    title: 'the anytime stage removed',
    cause: RETIRE,
    apply: (r) => edit(r, '.claude/steps.json', (text) => text.replace(/,\n\s*\{ "id": "note"[^\n]*\}/, '')),
  },
  {
    key: 'add-stage',
    tier: 2,
    title: 'a stage added at the end',
    cause: UNTOUCHED,
    apply: (r) =>
      edit(r, '.claude/steps.json', (text) =>
        text.replace(
          /("anytime": true \})/,
          '$1,\n    { "id": "archive", "title": "Archive the task", "next": [] }',
        ),
      ),
  },
  {
    key: 'stage-title',
    tier: 3,
    title: "a stage's title reworded",
    cause: RETIRE,
    apply: (r) => edit(r, '.claude/steps.json', (text) => text.replace('Make the change', 'Make the edit')),
  },
  {
    key: 'guard-source',
    tier: 3,
    title: "a guard script's source changed, its hook kept",
    cause: UNTOUCHED,
    apply: (r) =>
      edit(r, '.claude/guards/reply-length.py', (text) => `${text}\n# A comment added by the maintainer.\n`),
  },
];

/** The fixture's committed versions: the first commit of the estate and the current tree. */
const GIT_PAIR = {
  from: '72cb5be6',
  title: 'the two committed versions of the fixture (72cb5be6 to the current tree)',
};

const fold = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Scans a version with recorded answers, or its structure only when it has none. */
async function scan(root: string, answers: string | undefined, out: string): Promise<EstateMap | undefined> {
  cli([
    'estate',
    'scan',
    root,
    ...(answers ? ['--replay', answers] : ['--no-model']),
    '--out',
    out,
    '--force',
  ]);
  const loaded = await loadEstateMap(out);
  return loaded.ok ? loaded.map : undefined;
}

async function changedAtoms(old: EstateMap, root: string): Promise<Set<string>> {
  const changed = new Set<string>();
  const texts = new Map<string, string>();
  for (const atom of old.atoms) {
    const file = atom.provenance.file;
    if (!texts.has(file)) texts.set(file, fold(await readFile(join(root, file), 'utf8').catch(() => '')));
    if (!(texts.get(file) as string).includes(fold(atom.provenance.quote))) changed.add(atom.id);
  }
  return changed;
}

async function copyFixture(to: string): Promise<void> {
  for (const name of ['CLAUDE.md', '.claude'])
    await cp(join(FIXTURE, name), join(to, name), { recursive: true });
}

async function judgeVersion(
  work: string,
  name: string,
  makeOld: (root: string) => Promise<string | undefined>,
  makeNew: (root: string) => Promise<string | undefined>,
  specsDir: string,
  specs: Array<{ id: string; atoms: string[] }>,
): Promise<ItemResult> {
  const oldRoot = join(work, `${name}-old`);
  const newRoot = join(work, `${name}-new`);
  await mkdir(oldRoot, { recursive: true });
  await mkdir(newRoot, { recursive: true });
  const oldAnswers = await makeOld(oldRoot);
  const newAnswers = await makeNew(newRoot);
  const oldMap = await scan(oldRoot, oldAnswers, join(work, `${name}-old.yaml`));
  const newMap = await scan(newRoot, newAnswers, join(work, `${name}-new.yaml`));
  if (!oldMap || !newMap) return { pass: false, detail: 'a version does not scan' };
  const changed = await changedAtoms(oldMap, newRoot);
  const diffed = cli([
    'estate',
    'diff',
    join(work, `${name}-old.yaml`),
    join(work, `${name}-new.yaml`),
    '--out',
    join(work, `${name}-diff.json`),
  ]);
  if (diffed.code > 1) return { pass: false, detail: `estate diff exited ${diffed.code}` };
  const impact = cli(['estate', 'impact', join(work, `${name}-diff.json`), '--tests', specsDir, '--json']);
  let touched: string[] = [];
  let retired: string[] = [];
  const value = jsonOut<Record<string, Array<{ test?: string }>>>(impact);
  if (!value) return { pass: false, detail: `estate impact printed no JSON (exit ${impact.code})` };
  const tests = (key: string) => (value[key] ?? []).flatMap((entry) => (entry.test ? [entry.test] : []));
  touched = [...new Set(['retire', 'regenerate', 'reapprove'].flatMap(tests))];
  retired = tests('retire');
  // Every spec of a changed atom is touched; no spec is retired when none of its atoms changed. A spec of an
  // unchanged atom may still be regenerated (an edge of its atom changed).
  const expected = specs
    .filter((spec) => spec.atoms.some((atom) => changed.has(atom)))
    .map((spec) => spec.id);
  const unchanged = new Set(
    specs.filter((spec) => !spec.atoms.some((atom) => changed.has(atom))).map((spec) => spec.id),
  );
  const missing = expected.filter((id) => !touched.includes(id));
  const extra = retired.filter((id) => unchanged.has(id));
  if (missing.length === 0 && extra.length === 0)
    return { pass: true, detail: `holds (${expected.length} specs, ${changed.size} atoms changed)` };
  return {
    pass: false,
    detail: [
      `${changed.size} atoms changed (${[...changed].slice(0, 2).join(', ')})`,
      ...(missing.length > 0
        ? [`${missing.length} specs of a changed atom left alone, such as ${missing[0]}`]
        : []),
      ...(extra.length > 0
        ? [`${extra.length} specs retired whose atoms did not change, such as ${extra[0]}`]
        : []),
    ].join('; '),
  };
}

export function maintainFixtureFamily(): Family {
  const family = 'maintain.fixture';
  const items = itemsOf(family, 6, IMPACT, [
    ...EDITS.map(({ key, tier, title, cause }) => ({
      key,
      tier,
      title: `impact touches exactly the specs of the changed atoms when ${title}`,
      cause,
    })),
    {
      key: 'git-versions',
      tier: 4,
      title: `impact touches exactly the specs of the changed atoms between ${GIT_PAIR.title}`,
      cause: RETIRE,
      component: DIFF,
    },
  ]);
  return {
    id: family,
    level: 6,
    component: IMPACT,
    items,
    seedFree: true,
    async evaluate() {
      const out = new Map<string, ItemResult>();
      const suite = await fixtureSuite();
      const specs = suite.specs.map((spec) => ({ id: spec.id, atoms: spec.atoms }));
      const work = await mkdtemp(join(tmpdir(), 'estate-maintain-fixture-'));
      const answers = join(FIXTURE, 'answers.yaml');
      try {
        for (const item of EDITS) {
          try {
            out.set(
              `${family}.${item.key}`,
              await judgeVersion(
                work,
                item.key,
                async (root) => {
                  await copyFixture(root);
                  return answers;
                },
                async (root) => {
                  await copyFixture(root);
                  await item.apply(root);
                  return answers;
                },
                join(suite.work, 'suite'),
                specs,
              ),
            );
          } catch (cause) {
            out.set(`${family}.${item.key}`, {
              pass: false,
              detail: `the item threw: ${cause instanceof Error ? cause.message : String(cause)}`,
            });
          }
        }
        try {
          out.set(
            `${family}.git-versions`,
            await judgeVersion(
              work,
              'git',
              async (root) => {
                const archive = join(work, 'old.tar');
                execFileSync('git', [
                  '-C',
                  REPO,
                  'archive',
                  '--output',
                  archive,
                  GIT_PAIR.from,
                  'examples/estates/fixture',
                ]);
                execFileSync('tar', ['-xf', archive, '-C', root]);
                // The first version has no recorded answers: both versions are read for their structure only.
                await moveUp(join(root, 'examples/estates/fixture'), root);
                return undefined;
              },
              async (root) => {
                await copyFixture(root);
                return undefined;
              },
              join(suite.work, 'suite'),
              specs,
            ),
          );
        } catch (cause) {
          out.set(`${family}.git-versions`, {
            pass: false,
            detail: `the item threw: ${cause instanceof Error ? cause.message : String(cause)}`,
          });
        }
      } finally {
        await rm(work, { recursive: true, force: true });
      }
      return out;
    },
  };
}

/** Moves an extracted fixture's estate files to the root. */
async function moveUp(base: string, root: string): Promise<string> {
  for (const name of ['CLAUDE.md', '.claude'])
    await cp(join(base, name), join(root, name), { recursive: true });
  return join(base, 'answers.yaml');
}
