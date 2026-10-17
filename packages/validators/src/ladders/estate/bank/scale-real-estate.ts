import { rngFor } from '@agent-nexus/driftbench-generate';
import { ANCHOR, ROOT, SETTINGS, STANDING } from '../layout';

/**
 * A real-size estate: the shape of a large working coding-agent estate, planted from counts. At scale 1 it holds
 * about 6,900 files of which 766 are markdown, some 10.7 MB of prose, a standing file of 148 KB with its rules
 * deep inside, 64 skills, 34 helper agents, 113 hook scripts run
 * through one dispatcher, a hook registry of 419 KB, and the documents an estate keeps that are not rules:
 * changelogs, history logs, templates, examples and fixtures. Every planted rule, gate, cross-reference and
 * guard is recorded in the truth the oracle reads. Names and wording come from the seed; no real estate is read.
 *
 * The prose is filler with none of the words that make a rule (must, never, always, only when, before, first,
 * requires), so a reader that finds a rule in it finds a false one.
 */

export type RealOptions = {
  /** 1 is the real size. Smaller values keep the shape in fewer files, for tests of the generator itself. */
  scale?: number;
};

export type PlantedRule = {
  file: string;
  line: number;
  /** must, never, always or only-when */
  form: string;
  text: string;
  /** The words of the sentence the oracle looks for in a found atom's quote. */
  core: string;
};
export type PlantedGate = {
  file: string;
  line: number;
  form: string;
  text: string;
  core: string;
  gated: string;
};
export type PlantedGuard = { name: string; script: string; description: string };
export type RealTruth = {
  files: number;
  markdown: number;
  bytes: number;
  proseBytes: number;
  standingBytes: number;
  skills: Array<{ name: string; file: string; references: string[]; crossRefs: string[] }>;
  helpers: Array<{ name: string; file: string }>;
  rules: PlantedRule[];
  gates: PlantedGate[];
  guards: PlantedGuard[];
  /** Documents that are not rules: nothing in them is a live reference or a live rule. */
  nonNormative: string[];
  /** The atoms the structure alone plants: skills, routes, references, gates, guards and helpers. */
  structuralAtoms: number;
  /** Files the index document cites: references that belong to no skill. */
  indexed: number;
  /** Real defects in normative files: a skill step that cites a file the estate does not hold. */
  defects: Array<{ file: string; path: string }>;
  /**
   * The lines of normative markdown that state something to do (a rule, a gate, a step, a citation): a rule or gate
   * atom anywhere else sits on filler, which is rule-free by construction, and is false.
   */
  legit: Record<string, number[]>;
  /** The user-level skill layer planted in the home folder (see RealHome). */
  user: { found: string[]; trash: string[]; linkedToProject: string[] };
};

/**
 * The user-level skill layer, `$HOME/.claude/skills`, as a large working estate holds it: real folders, symbolic links
 * to folders elsewhere, many symbolic links into the project's own skills (the same skill reached twice), a container
 * folder of synced skills one level deeper, and a trash folder. `links` target either a file of `files` (by path from
 * the home folder) or a skill of the project (`project:<skill folder from the root>`).
 */
export type RealHome = { files: Record<string, string>; links: Array<{ path: string; target: string }> };

const SUBJECTS = [
  'depot',
  'dispatcher',
  'carrier',
  'warehouse',
  'ledger',
  'roster',
  'tariff',
  'voucher',
  'manifest',
  'harbour',
  'pallet',
  'invoice',
  'supplier',
  'courier',
  'inventory',
  'counter',
];
const VERBS = [
  'keeps',
  'files',
  'tracks',
  'stores',
  'lists',
  'groups',
  'counts',
  'sorts',
  'prints',
  'shares',
];
const OBJECTS = [
  'a record of each crate that passes the north gate',
  'the totals of the week in a short table',
  'a copy of the notes the team wrote on the shift',
  'the list of open items with their owners',
  'an index of the files kept in the shared folder',
  'the figures that were agreed in the last review',
  'a summary of the messages that arrived overnight',
  'the names of the people who signed the page',
];
const TAILS = [
  'and the page is reviewed each month.',
  'and the figures are rounded to whole units.',
  'in the order the entries were written.',
  'so the whole team can find them again.',
  'with the date of the entry beside it.',
  'and older pages are moved to the archive.',
];

type Rng = () => number;
const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length)] as T;

/** A sentence with no rule word in it. */
function sentence(rng: Rng): string {
  return `The ${pick(rng, SUBJECTS)} ${pick(rng, VERBS)} ${pick(rng, OBJECTS)} ${pick(rng, TAILS)}`;
}

/** A pool of paragraphs, drawn from again and again to reach a size without a new string per paragraph. */
function paragraphPool(rng: Rng, size: number): string[] {
  return Array.from({ length: size }, () => {
    const count = 3 + Math.floor(rng() * 3);
    return Array.from({ length: count }, () => sentence(rng)).join(' ');
  });
}

/** Lines of filler to at least `bytes` characters. */
function filler(rng: Rng, pool: readonly string[], bytes: number): string[] {
  const lines: string[] = [];
  let size = 0;
  while (size < bytes) {
    const paragraph = pick(rng, pool);
    lines.push(paragraph, '');
    size += paragraph.length + 2;
  }
  return lines;
}

/** The markdown references each skill holds under the same names. */
const SHARED_MARKDOWN = [
  'overview',
  'rules',
  'examples-index',
  'glossary',
  'checklist',
  'limits',
  'contacts',
];

const NOUNS = [
  'crate',
  'parcel',
  'permit',
  'tariff',
  'badge',
  'ticket',
  'pallet',
  'roster',
  'refund',
  'quote',
];

export function realEstate(
  seed: number,
  options: RealOptions = {},
): { files: Record<string, string>; truth: RealTruth; home: RealHome } {
  const scale = options.scale ?? 1;
  const rng = rngFor(seed, 'bank-scale-real');
  const pool = paragraphPool(rng, 240);
  const files: Record<string, string> = {};
  const truth: RealTruth = {
    files: 0,
    markdown: 0,
    bytes: 0,
    proseBytes: 0,
    standingBytes: 0,
    skills: [],
    helpers: [],
    rules: [],
    gates: [],
    guards: [],
    nonNormative: [],
    structuralAtoms: 0,
    indexed: 0,
    defects: [],
    legit: {},
    user: { found: [], trash: [], linkedToProject: [] },
  };
  const count = (full: number, least = 1) => Math.max(least, Math.round(full * scale));
  const skillCount = count(64, 4);
  const helperCount = count(34, 2);
  const guardCount = count(113, 3);
  const dataFiles = Math.max(10, count(5900, 10) - count(64, 4) * count(53, 3));
  const dataPerSkill = count(53, 3);

  // The gate documents the standing file's gates point at.
  const gateDocs = ['tariff-rules', 'payroll-cutoffs', 'roster-limits'];
  for (const doc of gateDocs)
    files[`docs/gates/${doc}.md`] = ['# Gate', '', ...filler(rng, pool, 1500)].join('\n');

  // ---- Skills: all under .claude/skills, none nested (the real estate has none). -------------------------------------------------
  const skillNames: string[] = [];
  const folders: string[] = [];
  for (let index = 0; index < skillCount; index += 1) {
    const noun = pick(rng, NOUNS);
    const name = `${noun}-${index}`;
    skillNames.push(name);
    const folder = `${ROOT}/skills/${name}`;
    folders.push(folder);
    // Every skill holds references of the same names, as skills of an estate do: a reader that keys a reference by
    // its file name alone ties it to every skill.
    const references = [
      ...SHARED_MARKDOWN.map((file) => `references/${file}.md`),
      ...Array.from({ length: dataPerSkill }, (_, n) => `references/data-${n}.json`),
    ];
    const crossRefs: string[] = [];
    const body: string[] = [
      '---',
      `name: ${name}`,
      `description: Handle ${noun} work ${index}. Use when the user asks for ${noun} work ${index}.`,
      'allowed-tools: Read, Edit, Bash',
      '---',
      '',
      `# ${name}`,
      '',
      `1. Open \`${references[0]}\` when the case is new.`,
      `2. Read \`${references[1]}\` before you change any ${noun} ${index} record.`,
      `3. Run \`python3 scripts/run-${index}.py RECORD\` and show the summary.`,
      '',
      'References:',
      ...references.slice(2).map((reference) => `- \`${reference}\``),
    ];
    truth.structuralAtoms += 5 + 1;
    if (index > 0) {
      const crossPath = `${folders[index - 1]}/references/glossary.md`;
      body.push(`4. For the figures of the neighbouring work, see \`${crossPath}\`.`);
      crossRefs.push(crossPath);
    }
    // A real defect in a normative file: the last step cites a file the estate does not hold.
    if (index < count(5, 1)) {
      const missing = `${folder}/references/archived-${index}.md`;
      body.push(`5. For an old case, open \`${missing}\`.`);
      truth.defects.push({ file: `${folder}/SKILL.md`, path: missing });
    }
    // One rule of the skill, in prose.
    const must = `Each ${noun} entry must carry the number of the ${noun} work ${index}.`;
    body.push('', must);
    truth.rules.push({
      file: `${folder}/SKILL.md`,
      line: body.length,
      form: 'must',
      text: must,
      core: `entry must carry the number of the ${noun} work ${index}`,
    });
    truth.legit[`${folder}/SKILL.md`] = body.flatMap((line, at) =>
      /^\d\. |\bmust\b/.test(line) ? [at + 1] : [],
    );
    body.push('', ...filler(rng, pool, 1800));
    files[`${folder}/SKILL.md`] = body.join('\n');
    truth.skills.push({ name, file: `${folder}/SKILL.md`, references, crossRefs });
    references.forEach((reference, n) => {
      files[`${folder}/${reference}`] = reference.endsWith('.md')
        ? [`# Reference ${index}.${n}`, '', ...filler(rng, pool, 15000 + Math.floor(rng() * 10000))].join(
            '\n',
          )
        : JSON.stringify({ skill: index, part: n });
    });
    files[`${folder}/scripts/run-${index}.py`] = '#!/usr/bin/env python3\n"""Runs the work."""\n';
    // Non-normative documents inside a skill: a template with placeholders and a test fixture.
    files[`${folder}/templates/report.md`] = [
      '# Report template',
      '',
      `Open \`<skill>/references/<name>.md\` for the figures of \`${name}\`.`,
      `Never fill this template by hand; copy it from \`references/gone-${index}.md\`.`,
      '',
    ].join('\n');
    truth.nonNormative.push(`${folder}/templates/report.md`);
    files[`${folder}/tests/fixtures/case.md`] = [
      '# Fixture',
      '',
      `Read \`references/missing-fixture-${index}.md\` before you check this case.`,
      '',
    ].join('\n');
    truth.nonNormative.push(`${folder}/tests/fixtures/case.md`);
  }

  // ---- Helpers. ------------------------------------------------------------------------------------------
  for (let index = 0; index < helperCount; index += 1) {
    const name = `helper-${index}`;
    const path = `${ROOT}/agents/${name}.md`;
    const text = [
      '---',
      `name: ${name}`,
      `description: Checks one record at a time for the ${pick(rng, SUBJECTS)} team.`,
      'tools: Read',
      '---',
      '',
      ...filler(rng, pool, 600),
    ];
    const subject = pick(rng, NOUNS);
    const never = `Never answer a ${subject} message yourself in helper ${index}.`;
    text.push(never, '');
    truth.rules.push({
      file: path,
      line: text.length - 1,
      form: 'never',
      text: never,
      core: `answer a ${subject} message yourself in helper ${index}`,
    });
    truth.legit[path] = [text.length - 1];
    text.push(...filler(rng, pool, 900));
    files[path] = text.join('\n');
    truth.helpers.push({ name, file: path });
    truth.structuralAtoms += 1;
  }

  // ---- Hooks run through one dispatcher; a registry names each hook and the rule it enforces. -----------
  files[`${ROOT}/hooks/run.py`] = [
    '#!/usr/bin/env python3',
    '"""Usage: run.py <hook>. Runs the hook script hooks/<hook>.py."""',
    'import subprocess',
    'import sys',
    'from pathlib import Path',
    '',
    'hook = Path(__file__).resolve().parent / f"{sys.argv[1]}.py"',
    'raise SystemExit(subprocess.run([sys.executable, str(hook)]).returncode)',
    '',
  ].join('\n');
  // Each hook is registered on five events, as an estate does: 113 scripts give 565 guards.
  const hookEvents: Array<[string, string]> = [
    ['PreToolUse', 'Bash'],
    ['PreToolUse', 'Edit'],
    ['PreToolUse', 'Write'],
    ['PostToolUse', 'Bash'],
    ['Stop', ''],
  ];
  const hookEntries: Record<string, unknown[]> = {};
  const registryRows: string[] = [];
  for (let index = 0; index < guardCount; index += 1) {
    const hook = `check-${index}`;
    const description = `Blocks a ${pick(rng, NOUNS)} release number ${index} that has no ${pick(rng, SUBJECTS)} stamp`;
    files[`${ROOT}/hooks/${hook}.py`] = [
      '#!/usr/bin/env python3',
      `"""${description}."""`,
      'import sys',
      'sys.exit(0)',
      '',
    ].join('\n');
    for (const [event, matcher] of hookEvents) {
      const group = {
        ...(matcher ? { matcher } : {}),
        hooks: [{ type: 'command', command: `python3 ${ANCHOR}/${ROOT}/hooks/run.py ${hook}` }],
      };
      hookEntries[event] = [...(hookEntries[event] ?? []), group];
    }
    registryRows.push(`| W${index} | ${hook}.py | ${description} |`);
    truth.guards.push({ name: `${hook}.py`, script: `${ROOT}/hooks/${hook}.py`, description });
    truth.structuralAtoms += hookEvents.length;
  }
  files[SETTINGS] = JSON.stringify({ permissions: { allow: [], deny: [] }, hooks: hookEntries }, null, 2);
  files[`${ROOT}/hooks/CHECK-REGISTRY.md`] = [
    '# Check registry',
    '',
    '| Id | Guard | Enforces |',
    '|---|---|---|',
    ...registryRows,
    '',
    ...filler(rng, pool, Math.round(419_000 * scale)),
  ].join('\n');

  // ---- The standing file: 148 KB, rules deep inside. -----------------------------------------------------
  const standingBytes = Math.round(148_000 * scale);
  const standing: string[] = [
    '# Standing instructions',
    '',
    '| When the user wants to | Load |',
    '|---|---|',
  ];
  skillNames.forEach((name, index) => {
    standing.push(`| handle ${truth.skills[index]?.name.split('-')[0]} work ${index} | \`${name}\` |`);
    truth.structuralAtoms += 1;
  });
  standing.push('');
  const rules: Array<{ form: string; text: string; core: string }> = [
    {
      form: 'must',
      text: 'Every invoice must carry the cost centre of the buyer.',
      core: 'invoice must carry the cost centre of the buyer',
    },
    {
      form: 'never',
      text: 'Never release a shipment that has no customs form.',
      core: 'release a shipment that has no customs form',
    },
    {
      form: 'always',
      text: 'Always confirm the depot code by reading it back.',
      core: 'confirm the depot code by reading it back',
    },
    {
      form: 'only-when',
      text: 'Only when the carrier confirms the pickup may the dispatcher close the ticket.',
      core: 'carrier confirms the pickup may the dispatcher close the ticket',
    },
  ];
  const gates: Array<{ form: string; text: string; core: string; gated: string }> = [
    {
      form: 'before-read',
      text: 'Before you change any tariff, read `docs/gates/tariff-rules.md`.',
      core: 'docs/gates/tariff-rules.md',
      gated: 'tariff',
    },
    {
      form: 'read-first',
      text: 'Read `docs/gates/payroll-cutoffs.md` first when you edit payroll files.',
      core: 'docs/gates/payroll-cutoffs.md',
      gated: 'payroll',
    },
    {
      form: 'requires-loaded',
      text: 'Editing the roster requires `docs/gates/roster-limits.md` loaded.',
      core: 'docs/gates/roster-limits.md',
      gated: 'roster',
    },
  ];
  const planted: Array<{ form: string; text: string; core: string; gated?: string }> = [...rules, ...gates];
  // Spread the planted sentences through the file: a few percent in, the middle, and very near the end.
  const marks = planted.map((_, index) => 0.04 + (0.92 * index) / Math.max(1, planted.length - 1));
  let cursor = 0;
  planted.forEach((entry, index) => {
    const target = Math.round(standingBytes * (marks[index] as number));
    while (cursor < target) {
      const paragraph = pick(rng, pool);
      standing.push(paragraph, '');
      cursor += paragraph.length + 2;
    }
    standing.push(entry.text, '');
    cursor += entry.text.length + 2;
    const line = standing.length - 1;
    if (entry.gated !== undefined)
      truth.gates.push({
        file: STANDING,
        line,
        form: entry.form,
        text: entry.text,
        core: entry.core,
        gated: entry.gated,
      });
    else truth.rules.push({ file: STANDING, line, form: entry.form, text: entry.text, core: entry.core });
  });
  while (cursor < standingBytes) {
    const paragraph = pick(rng, pool);
    standing.push(paragraph, '');
    cursor += paragraph.length + 2;
  }
  files[STANDING] = standing.join('\n');
  truth.legit[STANDING] = [...truth.rules, ...truth.gates]
    .filter((r) => r.file === STANDING)
    .map((r) => r.line);

  // ---- Documents that are not rules. ----------------------------------------------------------------------
  files['CHANGELOG.md'] = [
    '# Changelog',
    '',
    ...Array.from({ length: count(80, 4) }, (_, n) => [
      `## 2025-${String((n % 12) + 1).padStart(2, '0')}-${String((n % 27) + 1).padStart(2, '0')}`,
      `- Removed \`references/retired-${n}.md\`; never edit the old table by hand.`,
      `- ${sentence(rng)}`,
      '',
    ]).flat(),
  ].join('\n');
  truth.nonNormative.push('CHANGELOG.md');
  for (let n = 0; n < count(20, 2); n += 1) {
    const path = `docs/history/log-${n}.md`;
    files[path] = [
      `# Journal ${n}`,
      '',
      `2025-03-${String((n % 27) + 1).padStart(2, '0')}: Read \`notes/old-${n}.md\` before the move; always keep a copy.`,
      '',
      ...filler(rng, pool, 12000),
    ].join('\n');
    truth.nonNormative.push(path);
  }
  for (let n = 0; n < count(10, 1); n += 1) {
    const path = `docs/examples/example-${n}.md`;
    files[path] = [
      `# Example ${n}`,
      '',
      '```',
      `Read \`references/example-${n}.md\` before you start. Never skip this step.`,
      '```',
      '',
      ...filler(rng, pool, 4000),
    ].join('\n');
    truth.nonNormative.push(path);
  }
  // Plain notes bring the markdown count and the prose to the size of the estate.
  const notes = count(766, 8) - Object.keys(files).filter((path) => path.endsWith('.md')).length - 1;
  for (let n = 0; n < notes; n += 1) {
    files[`docs/notes/note-${n}.md`] = [`# Note ${n}`, '', ...filler(rng, pool, 3500)].join('\n');
  }
  // Data: many small files that are not read as instructions.
  for (let n = 0; n < dataFiles; n += 1) {
    files[`data/part-${String(Math.floor(n / 200)).padStart(3, '0')}/item-${n}.json`] = JSON.stringify({
      id: n,
      label: sentence(rng).slice(0, 40),
    });
  }

  // An index that cites thousands of files the estate holds: references that belong to no skill, which a reader that
  // attaches every reference of the estate to every skill turns into hundreds of thousands of edges.
  const cited = [
    ...Array.from({ length: Math.max(0, notes) }, (_, n) => `docs/notes/note-${n}.md`),
    ...Array.from(
      { length: Math.min(dataFiles, count(3500, 5)) },
      (_, n) => `data/part-${String(Math.floor(n / 200)).padStart(3, '0')}/item-${n}.json`,
    ),
  ];
  files['docs/INDEX.md'] = [
    '# Index',
    '',
    ...cited.map((path) => `- \`${path}\`: kept for the record.`),
    '',
  ].join('\n');
  truth.indexed = cited.length;

  // ---- The user-level skill layer, in the home folder. ----------------------------------------------------------
  const home: RealHome = { files: {}, links: [] };
  const userSkill = (path: string, name: string) => {
    home.files[`${path}/SKILL.md`] = [
      '---',
      `name: ${name}`,
      `description: Handle the ${name} chores. Use when the user asks for the ${name} chores.`,
      '---',
      '',
      `# ${name}`,
      '',
    ].join('\n');
  };
  const layer = '.claude/skills';
  // Real folders of the layer.
  for (let n = 0; n < count(5, 1); n += 1) {
    userSkill(`${layer}/user-real-${n}`, `user-real-${n}`);
    truth.user.found.push(`user-real-${n}`);
  }
  // Links to folders elsewhere: their skills are the layer's own.
  for (let n = 0; n < count(5, 1); n += 1) {
    userSkill(`.claude/shared/user-linked-${n}`, `user-linked-${n}`);
    home.links.push({ path: `${layer}/user-linked-${n}`, target: `.claude/shared/user-linked-${n}` });
    truth.user.found.push(`user-linked-${n}`);
  }
  // Links into the project's own skills: the same skill reached twice, counted once.
  for (let n = 0; n < Math.min(count(26, 2), skillNames.length); n += 1) {
    home.links.push({ path: `${layer}/project-${n}`, target: `project:${folders[n]}` });
    truth.user.linkedToProject.push(skillNames[n] as string);
  }
  // A container of synced skills one level deeper is read; a trash folder is not.
  for (let n = 0; n < count(4, 1); n += 1) {
    userSkill(`${layer}/synced/user-synced-${n}`, `user-synced-${n}`);
    truth.user.found.push(`user-synced-${n}`);
  }
  for (let n = 0; n < count(3, 1); n += 1) {
    userSkill(`${layer}/.trash/user-trashed-${n}`, `user-trashed-${n}`);
    truth.user.trash.push(`user-trashed-${n}`);
  }

  truth.files = Object.keys(files).length;
  truth.markdown = Object.keys(files).filter((path) => path.endsWith('.md')).length;
  for (const [path, text] of Object.entries(files)) {
    truth.bytes += text.length;
    if (path.endsWith('.md')) truth.proseBytes += text.length;
  }
  truth.standingBytes = files[STANDING]?.length ?? 0;
  return { files, truth, home };
}
