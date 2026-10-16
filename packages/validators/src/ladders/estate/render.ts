import type { AtomKind, EstateRecording } from '@agent-nexus/driftbench-estate';
import {
  type Evidence,
  type HiddenEstate,
  type HiddenGuard,
  type HiddenHelper,
  type HiddenSkill,
  LENGTH_RULE,
  type StandingRule,
} from './hidden';
import {
  ANCHOR,
  ANCHOR_BARE,
  helperFile,
  MEMORY,
  REGISTRY_JSON,
  REGISTRY_MD,
  SETTINGS,
  STANDING,
  STEPS,
  skillFile,
} from './layout';

export { RUNTIME } from './layout';

/**
 * The renderer: the hidden estate written as files in the runtime layout the estate scanner reads, with the
 * truth attached as it is written. Every line that states an atom records the atom's hidden id, kind, line
 * and key; every edge of the design is listed by hidden ids; the planted defects become the lint findings
 * the estate must give; and the prose atoms become the recorded model answers the scan replays (the
 * validator holds no model: the recording is what a correct splitter answers, so the scan's code path from
 * an answer to an atom is what is measured).
 *
 * The paths come from `layout.ts`, the validator's runtime adapter.
 */

/** What the model is recorded to answer for one prose atom. */
export type ProseEntry = {
  kind: 'instruction' | 'gate' | 'register';
  title: string;
  quote: string;
  situation?: string;
  polarity?: 'obligation' | 'prohibition';
  evidence: Evidence[];
  line: number;
};

/** One atom the estate states: its hidden id, kind, file, first line and the key code reads it by. */
export type ExpectedAtom = {
  hid: string;
  kind: AtomKind;
  file: string;
  line: number;
  /** The kind's key: a skill or helper name, a route target, a path, a guard name, a rule, a setting key, a
   * stage id, a hazard, an invariant check; empty for a prose rule. */
  key: string;
};

/** An edge of the design between hidden ids; `event.<name>` for a guard's event. */
export type ExpectedEdge = { from: string; to: string; kind: string };

/** A lint finding the planted defects must give; `atom` names a subject that is an atom's id. */
export type ExpectedFinding = { code: string; subject: string; atom?: string; defect: string };

export type Rendered = {
  files: Record<string, string>;
  atoms: ExpectedAtom[];
  edges: ExpectedEdge[];
  findings: ExpectedFinding[];
  recording: EstateRecording;
  /** Paths of the prose chunks, so the recording has an answer for each. */
  chunks: string[];
};

type Pending = { hid: string; kind: AtomKind; key?: string };

/** A file written line by line, each line with the atoms it states. */
class Writer {
  readonly lines: string[] = [];
  readonly atoms: ExpectedAtom[] = [];
  readonly prose: ProseEntry[] = [];
  constructor(readonly path: string) {}

  /** Adds a line; returns its number. */
  line(text: string, atoms: Pending[] = [], prose?: Omit<ProseEntry, 'line'>): number {
    this.lines.push(text);
    const number = this.lines.length;
    for (const atom of atoms) {
      this.atoms.push({ hid: atom.hid, kind: atom.kind, file: this.path, line: number, key: atom.key ?? '' });
    }
    if (prose) this.prose.push({ ...prose, line: number });
    return number;
  }

  text(): string {
    return `${this.lines.join('\n')}\n`;
  }
}

function proseOf(
  rule: Pick<StandingRule, 'kind' | 'title' | 'text' | 'polarity' | 'evidence'>,
  situation?: string,
) {
  return {
    kind: rule.kind,
    title: rule.title,
    quote: rule.text,
    ...(situation ? { situation } : {}),
    ...(rule.polarity ? { polarity: rule.polarity } : {}),
    evidence: rule.evidence,
  };
}

/** The atoms a standing rule's line states: its prose atom, and the code atoms of a fixed gate or a hazard. */
function standingAtoms(rule: StandingRule): Pending[] {
  const atoms: Pending[] = [{ hid: rule.hid, kind: rule.kind }];
  if (rule.fixedGate) {
    atoms.push({
      hid: `ref:${STANDING}:${rule.fixedGate.path}`,
      kind: 'reference',
      key: rule.fixedGate.path,
    });
  }
  if (rule.hazard) atoms.push({ hid: `hazard:${rule.hid}`, kind: 'hazard', key: rule.hazard });
  return atoms;
}

/** The path a skill file names, relative to the root. */
export function skillPath(skill: HiddenSkill, relative: string): string {
  return skillFile(skill.folder ?? skill.topic.skill, relative);
}

/** The hidden id of a skill's reference or script: the skill's name and the file as its body names it, so a
 * renamed folder keeps it. */
export function fileHid(kind: 'ref' | 'script', skill: HiddenSkill, relative: string): string {
  return `${kind}:${skill.topic.skill}:${relative}`;
}

export function helperPath(helper: HiddenHelper): string {
  return helperFile(helper.topic.name);
}

/** The command a guard declaration runs. */
export function guardCommand(guard: HiddenGuard): string {
  if (guard.scope !== 'estate') return `${ANCHOR_BARE}/${guard.script}`;
  const path = guard.anchored ? `${ANCHOR}/${guard.script}` : guard.script;
  return guard.interpreter ? `${guard.interpreter} ${path}` : path;
}

/** The base name of a permission rule's tool (`Bash` for `Bash(git status)`) and its pattern. */
function ruleParts(rule: string): { tool: string; pattern?: string } {
  const match = /^([^(]+)(?:\((.*)\))?$/.exec(rule);
  const tool = (match?.[1] ?? rule).trim();
  return match?.[2] === undefined ? { tool } : { tool, pattern: match[2] };
}

/** The tools a skill declares. */
export function skillTools(skill: HiddenSkill): string[] {
  return ['Read', 'Edit', 'Bash(python3 *)', ...skill.extraTools];
}

export const HELPER_TOOLS = ['Read', 'Grep', 'Glob'] as const;

/** The workspace folder the rule follower works in. */
export function workFolder(estate: HiddenEstate): string {
  return `/work/${estate.slug}`;
}

/** Sorted the way the scanner walks folders: by name. */
function byName<T>(items: readonly T[], name: (item: T) => string): T[] {
  return [...items].sort((a, b) => (name(a) < name(b) ? -1 : name(a) > name(b) ? 1 : 0));
}

export function renderEstate(estate: HiddenEstate): Rendered {
  const files: Record<string, string> = {};
  const atoms: ExpectedAtom[] = [];
  const edges: ExpectedEdge[] = [];
  const findings: ExpectedFinding[] = [];
  const answers: Record<string, unknown> = {};
  const chunks: string[] = [];
  const write = (writer: Writer) => {
    files[writer.path] = writer.text();
    atoms.push(...writer.atoms);
  };
  const record = (writer: Writer) => {
    chunks.push(writer.path);
    answers[writer.path] = { chunk: writer.path, atoms: writer.prose };
  };
  const skills = byName(estate.skills, (skill) => skill.topic.skill);
  const helpers = byName(estate.helpers, (helper) => helper.topic.name);
  const settingsGuards = estate.guards.filter((guard) => guard.scope === 'estate');

  // The standing instructions.
  const standing = new Writer(STANDING);
  standing.line(`# ${estate.company} operations assistant`, [
    { hid: 'invariant:standing_size', kind: 'invariant', key: 'standing_size' },
    { hid: 'invariant:no_orphans', kind: 'invariant', key: 'no_orphans' },
  ]);
  standing.line('');
  standing.line(
    `You help the operations team of ${estate.company}, a fictional ${estate.business}, with its daily work.`,
  );
  standing.line('Everything in this estate is invented for testing.');
  standing.line('');
  standing.line('## Rules');
  standing.line('');
  for (const rule of estate.rules.filter((candidate) => candidate.section === 'rules')) {
    const line = `- **${rule.label}.** ${rule.text}`;
    if (estate.wrap === rule.hid) {
      // The same words over two lines: a change of layout, not of meaning.
      const cut = line.lastIndexOf(' ', Math.floor(line.length / 2) + 6);
      standing.line(line.slice(0, cut), standingAtoms(rule), proseOf(rule, ruleSituation(rule)));
      standing.line(`  ${line.slice(cut + 1)}`);
    } else standing.line(line, standingAtoms(rule), proseOf(rule, ruleSituation(rule)));
  }
  standing.line('');
  standing.line('## Routing');
  standing.line('');
  standing.line('| When the user wants to | Load |');
  standing.line('|---|---|');
  for (const skill of skills.filter((candidate) => candidate.routed)) {
    standing.line(`| ${skill.topic.routeAsk} | \`${skill.topic.skill}\` |`, [
      { hid: `route:table:${skill.topic.skill}`, kind: 'route', key: skill.topic.skill },
    ]);
    edges.push({ from: `route:table:${skill.topic.skill}`, to: skill.hid, kind: 'route' });
  }
  for (const helper of helpers.filter((candidate) => candidate.routed)) {
    standing.line(`| ${helper.topic.routeAsk} | the \`${helper.topic.name}\` agent |`, [
      { hid: `route:table:${helper.topic.name}`, kind: 'route', key: helper.topic.name },
    ]);
    edges.push({ from: `route:table:${helper.topic.name}`, to: helper.hid, kind: 'route' });
  }
  standing.line('');
  standing.line('## Process');
  standing.line('');
  standing.line(`Every task follows the step list in \`${STEPS}\`: plan, do, verify, report.`, [
    { hid: `ref:${STANDING}:${STEPS}`, kind: 'reference', key: STEPS },
  ]);
  for (const rule of estate.rules.filter((candidate) => candidate.section === 'process')) {
    standing.line(rule.text, standingAtoms(rule), proseOf(rule));
  }
  standing.line('A tracker note may be written at any step.');
  standing.line('');
  standing.line('## Output');
  standing.line('');
  for (const rule of estate.rules.filter((candidate) => candidate.section === 'output')) {
    standing.line(`- ${rule.text}`, standingAtoms(rule), proseOf(rule));
  }
  write(standing);
  record(standing);

  // Memory (holdout).
  const memoryRules = estate.rules.filter((rule) => rule.section === 'memory');
  if (memoryRules.length > 0) {
    const memory = new Writer(MEMORY);
    memory.line('# Memory');
    memory.line('');
    for (const rule of memoryRules) memory.line(`- ${rule.text}`, standingAtoms(rule), proseOf(rule));
    write(memory);
    record(memory);
  }

  // Cited rules.
  for (const rule of estate.rules) {
    if (!rule.cites) continue;
    const cited = estate.rules.find((candidate) => candidate.label === rule.cites);
    if (cited) edges.push({ from: rule.hid, to: cited.hid, kind: 'cites' });
  }

  // Settings: model, permissions, environment keys, guards.
  const settings = new Writer(SETTINGS);
  settings.line('{');
  settings.line(`  "model": ${JSON.stringify(estate.settings.model)},`, [
    { hid: 'setting:model', kind: 'setting', key: 'model' },
  ]);
  settings.line('  "permissions": {');
  settings.line(`    "defaultMode": ${JSON.stringify(estate.permissions.defaultMode)},`, [
    { hid: 'setting:permissions.defaultMode', kind: 'setting', key: 'permissions.defaultMode' },
  ]);
  const toolAtoms: Array<{ hid: string; tool: string; pattern?: string; effect: string }> = [];
  const effects = ['allow', 'deny', 'ask'] as const;
  effects.forEach((effect, index) => {
    const rules = estate.permissions[effect];
    const close = index === effects.length - 1 ? '' : ',';
    if (rules.length === 0) {
      settings.line(`    "${effect}": []${close}`);
      return;
    }
    settings.line(`    "${effect}": [`);
    rules.forEach((rule, position) => {
      const hid = `tool:${effect}:${rule}`;
      const parts = ruleParts(rule);
      toolAtoms.push({
        hid,
        tool: parts.tool,
        ...(parts.pattern !== undefined ? { pattern: parts.pattern } : {}),
        effect,
      });
      settings.line(`      ${JSON.stringify(rule)}${position === rules.length - 1 ? '' : ','}`, [
        { hid, kind: 'tool', key: rule },
      ]);
    });
    settings.line(`    ]${close}`);
  });
  settings.line('  },');
  settings.line('  "env": {');
  estate.settings.env.forEach((entry, index) => {
    settings.line(
      `    ${JSON.stringify(entry.key)}: ${JSON.stringify(entry.value)}${index === estate.settings.env.length - 1 ? '' : ','}`,
      [{ hid: `setting:env.${entry.key}`, kind: 'setting', key: `env.${entry.key}` }],
    );
  });
  settings.line(`  }${settingsGuards.length > 0 ? ',' : ''}`);
  if (settingsGuards.length > 0) {
    settings.line('  "hooks": {');
    const events = ['PreToolUse', 'UserPromptSubmit', 'Stop'].filter((event) =>
      settingsGuards.some((guard) => guard.event === event),
    );
    let firstGuard = true;
    events.forEach((event, eventIndex) => {
      settings.line(`    ${JSON.stringify(event)}: [`);
      const groups = settingsGuards.filter((guard) => guard.event === event);
      groups.forEach((guard, groupIndex) => {
        settings.line('      {');
        if (guard.matcher) settings.line(`        "matcher": ${JSON.stringify(guard.matcher)},`);
        settings.line('        "hooks": [');
        settings.line('          {');
        settings.line('            "type": "command",');
        const pending: Pending[] = [{ hid: guard.hid, kind: 'guard', key: guard.name }];
        if (firstGuard) {
          pending.push({
            hid: 'invariant:guard_paths_anchored',
            kind: 'invariant',
            key: 'guard_paths_anchored',
          });
          firstGuard = false;
        }
        settings.line(`            "command": ${JSON.stringify(guardCommand(guard))}`, pending);
        settings.line('          }');
        settings.line('        ]');
        settings.line(`      }${groupIndex === groups.length - 1 ? '' : ','}`);
      });
      settings.line(`    ]${eventIndex === events.length - 1 ? '' : ','}`);
    });
    settings.line('  }');
  }
  settings.line('}');

  // Declared tools: skills first, then helpers, each base once unless a bare permission rule names it.
  const bare = new Set(toolAtoms.filter((tool) => tool.pattern === undefined).map((tool) => tool.tool));
  const declaredAt = new Map<string, { file: string; line: number }>();
  const declare = (names: readonly string[], file: string, line: number) => {
    for (const name of names.map((item) => ruleParts(item).tool)) {
      if (bare.has(name)) continue;
      bare.add(name);
      declaredAt.set(name, { file, line });
      toolAtoms.push({ hid: `tool:declared:${name}`, tool: name, effect: 'declared' });
      atoms.push({ hid: `tool:declared:${name}`, kind: 'tool', file, line, key: name });
    }
  };
  const toolOf = (name: string) =>
    toolAtoms.find((tool) => tool.tool === name && tool.pattern === undefined && tool.effect !== 'deny') ??
    toolAtoms.find((tool) => tool.tool === name);

  // Skills.
  const skillWriters = new Map<string, Writer>();
  for (const skill of skills) {
    const topic = skill.topic;
    const writer = new Writer(skillPath(skill, 'SKILL.md'));
    skillWriters.set(topic.skill, writer);
    writer.line('---');
    writer.line(`name: ${topic.skill}`, [{ hid: skill.hid, kind: 'skill', key: topic.skill }]);
    writer.line(`description: ${topic.description}`, [
      { hid: `route:desc:${topic.skill}`, kind: 'route', key: topic.skill },
    ]);
    edges.push({ from: `route:desc:${topic.skill}`, to: skill.hid, kind: 'route' });
    const toolsLine = writer.line(`allowed-tools: ${skillTools(skill).join(', ')}`);
    const hook = estate.guards.find((guard) => guard.scope === topic.skill);
    if (hook) {
      writer.line('hooks:');
      writer.line(`  ${hook.event}:`);
      writer.line(`    - matcher: ${hook.matcher ?? ''}`);
      writer.line('      hooks:');
      writer.line('        - type: command');
      writer.line(`          command: "${guardCommand(hook)}"`, [
        { hid: hook.hid, kind: 'guard', key: hook.name },
      ]);
    }
    writer.line('---');
    writer.line('');
    writer.line(`# ${topic.heading}`);
    writer.line('');
    let item = 0;
    const next = () => {
      item += 1;
      return `${item}.`;
    };
    const ref = (file: string) => {
      const path = skillPath(skill, `references/${file}`);
      const hid = fileHid('ref', skill, `references/${file}`);
      edges.push({ from: skill.hid, to: hid, kind: 'reference' });
      return { hid, kind: 'reference' as const, key: path };
    };
    const keep = (part: string) => !skill.omit.includes(part);
    if (keep('lookup')) writer.line(`${next()} ${topic.lookup.line}`, [ref(topic.lookup.file)]);
    const gateText = `Read \`references/${topic.gate.file}\` before you ${topic.gate.verb}.`;
    if (keep('gate'))
      writer.line(
        `${next()} ${gateText}`,
        [{ hid: `gate:${topic.skill}`, kind: 'gate' }, ref(topic.gate.file)],
        {
          kind: 'gate',
          title: `Read the ${topic.gate.file.replace(/\.md$/, '').replace(/-/g, ' ')} before you ${topic.gate.verb}`,
          quote: gateText,
          evidence: [{ type: 'ordered', before: 'Read', after: 'Edit' }],
        },
      );
    if (skill.comma) {
      const commaText = `Before you ${topic.comma.verb}, read \`references/${topic.comma.file}\`.`;
      writer.line(
        `${next()} ${commaText}`,
        [{ hid: `gate:${topic.skill}:comma`, kind: 'gate' }, ref(topic.comma.file)],
        {
          kind: 'gate',
          title: `Read the ${topic.comma.file.replace(/\.md$/, '').replace(/-/g, ' ')} before you ${topic.comma.verb}`,
          quote: commaText,
          evidence: [{ type: 'ordered', before: 'Read', after: topic.comma.verb }],
        },
      );
    }
    const scriptPath = skillPath(skill, `scripts/${topic.script.file}`);
    const scriptText = `Run \`python3 scripts/${topic.script.file} ${topic.script.args}\` and show the summary it prints.`;
    if (keep('script'))
      writer.line(
        `${next()} ${scriptText}`,
        [
          { hid: fileHid('script', skill, `scripts/${topic.script.file}`), kind: 'script', key: scriptPath },
          { hid: `rule:${topic.skill}:script`, kind: 'instruction' },
        ],
        {
          kind: 'instruction',
          title: `Run the ${topic.script.file} script and show its summary`,
          quote: scriptText,
          polarity: 'obligation',
          evidence: [
            { type: 'tool_called', label: 'Bash', input: { command: { contains: topic.script.file } } },
          ],
        },
      );
    if (keep('script')) {
      edges.push({
        from: skill.hid,
        to: fileHid('script', skill, `scripts/${topic.script.file}`),
        kind: 'script',
      });
    }
    if (keep('prohibition'))
      writer.line(
        `${next()} ${topic.prohibition.text}`,
        [{ hid: `rule:${topic.skill}:prohibition`, kind: 'instruction' }],
        {
          kind: 'instruction',
          title: topic.prohibition.title,
          quote: topic.prohibition.text,
          polarity: 'prohibition',
          evidence: [{ type: 'custom', name: 'no_value_change', options: { skill: topic.skill } }],
        },
      );
    if (skill.dispatch && keep('dispatch')) {
      const helper = estate.helpers.find(
        (candidate) => candidate.topic.name === skill.dispatch,
      ) as HiddenHelper;
      const [first, second] = helper.topic.fields;
      const text = `${topic.dispatch}, dispatch the \`${helper.topic.name}\` agent with the ${first} and the ${second}.`;
      writer.line(`${next()} ${text}`, [{ hid: `rule:${topic.skill}:dispatch`, kind: 'instruction' }], {
        kind: 'instruction',
        title: `Dispatch ${helper.topic.name} with the ${first} and the ${second}`,
        quote: text,
        situation: topic.dispatch,
        polarity: 'obligation',
        evidence: [{ type: 'tool_called', label: 'Agent', input: { subagent_type: helper.topic.name } }],
      });
      edges.push({ from: skill.hid, to: helper.hid, kind: 'dispatch' });
    }
    if (keep('register'))
      writer.line(
        `${next()} ${topic.register.text}`,
        [{ hid: `rule:${topic.skill}:register`, kind: 'register' }],
        {
          kind: 'register',
          title: topic.register.title,
          quote: topic.register.text,
          evidence: [{ type: 'text', must: [topic.register.word] }],
        },
      );
    if (skill.missing) {
      const pending = ref(topic.missing.file);
      writer.line(`${next()} ${topic.missing.line}`, [pending]);
      if (skill.referenceSupplied) {
        files[skillPath(skill, `references/${topic.missing.file}`)] =
          `# ${topic.heading}: additional reference\nUse the supplied record and report unresolved differences.\n`;
      } else
        findings.push({
          code: 'MISSING_REFERENCE',
          subject: pending.hid,
          atom: pending.hid,
          defect: 'missing_reference',
        });
    }
    write(writer);
    record(writer);
    declare(skillTools(skill), writer.path, toolsLine);

    // The files beside the definition.
    if (keep('lookup')) {
      files[skillPath(skill, `references/${topic.lookup.file}`)] =
        `# ${topic.heading}: lookup\nOne line per case.\n`;
    }
    files[skillPath(skill, `references/${topic.gate.file}`)] =
      `# ${topic.heading}: rules\nRead before any change.\n`;
    if (skill.comma)
      files[skillPath(skill, `references/${topic.comma.file}`)] = `# ${topic.heading}: terms\n`;
    if (keep('script'))
      files[scriptPath] = [
        '#!/usr/bin/env python3',
        `"""Prints a summary line for the ${topic.heading} skill."""`,
        'import sys',
        '',
        'print("summary:", " ".join(sys.argv[1:]))',
        '',
      ].join('\n');
    if (skill.unnamedScript) {
      const path = skillPath(skill, 'scripts/shared-helpers.py');
      files[path] = ['#!/usr/bin/env python3', '"""Helpers shared by the scripts of this skill."""', ''].join(
        '\n',
      );
      const hid = fileHid('script', skill, 'scripts/shared-helpers.py');
      atoms.push({ hid, kind: 'script', file: path, line: 2, key: path });
      edges.push({ from: skill.hid, to: hid, kind: 'script' });
    }
    if (hook) {
      files[hook.script] = ['#!/bin/sh', '# Checks the arguments of a script call.', 'exit 0', ''].join('\n');
    }
    if (skill.orphan) {
      const path = skillPath(skill, `references/${topic.orphan}`);
      files[path] = '# Old notes\nKept from an earlier version.\n';
      findings.push({ code: 'ORPHAN', subject: path, defect: 'orphan' });
    }
  }

  // Helpers.
  for (const helper of helpers) {
    const topic = helper.topic;
    const writer = new Writer(helperPath(helper));
    writer.line('---');
    writer.line(`name: ${topic.name}`, [{ hid: helper.hid, kind: 'subagent', key: topic.name }]);
    writer.line(`description: ${topic.description}`, [
      { hid: `route:desc:${topic.name}`, kind: 'route', key: topic.name },
    ]);
    edges.push({ from: `route:desc:${topic.name}`, to: helper.hid, kind: 'route' });
    const toolsLine = writer.line(`tools: ${HELPER_TOOLS.join(', ')}`);
    writer.line(`model: ${helper.model}`);
    writer.line(`effort: ${helper.effort}`);
    if (helper.skills.length > 0) writer.line(`skills: ${helper.skills.join(', ')}`);
    writer.line('---');
    writer.line('');
    const readonly = 'You never edit a file: you read and you report.';
    writer.line(
      `You work on the ${topic.noun} of ${estate.company}. ${readonly}`,
      [{ hid: `rule:${topic.name}:readonly`, kind: 'instruction' }],
      {
        kind: 'instruction',
        title: 'The helper never edits a file',
        quote: readonly,
        polarity: 'prohibition',
        evidence: [{ type: 'custom', name: 'helper_read_only', options: { helper: topic.name } }],
      },
    );
    const brief = `Your brief gives the ${topic.fields[0]} and the ${topic.fields[1]}; when one is missing, answer with a blocked status and stop.`;
    writer.line(brief, [{ hid: `rule:${topic.name}:brief`, kind: 'instruction' }], {
      kind: 'instruction',
      title: `The brief gives the ${topic.fields[0]} and the ${topic.fields[1]}`,
      quote: brief,
      polarity: 'obligation',
      evidence: [{ type: 'custom', name: 'brief_fields', options: { fields: [...topic.fields] } }],
    });
    const json = 'Answer with one JSON object and nothing else.';
    writer.line(json, [{ hid: `rule:${topic.name}:json`, kind: 'register' }], {
      kind: 'register',
      title: 'Answer with one JSON object',
      quote: json,
      evidence: [{ type: 'custom', name: 'json_answer' }],
    });
    write(writer);
    record(writer);
    declare(HELPER_TOOLS, writer.path, toolsLine);
    for (const skill of helper.skills) {
      edges.push({ from: helper.hid, to: `skill:${skill}`, kind: 'allows' });
    }
  }

  // Allowed tools, now that every tool atom is known.
  for (const skill of skills) {
    for (const name of new Set(skillTools(skill).map((item) => ruleParts(item).tool))) {
      const tool = toolOf(name);
      if (tool) edges.push({ from: skill.hid, to: tool.hid, kind: 'allows' });
    }
  }
  for (const helper of helpers) {
    for (const name of HELPER_TOOLS) {
      const tool = toolOf(name);
      if (tool) edges.push({ from: helper.hid, to: tool.hid, kind: 'allows' });
    }
  }
  write(settings);

  // Guards: scripts, events, what each enforces.
  for (const guard of estate.guards) {
    edges.push({ from: guard.hid, to: `event.${guard.event}`, kind: 'event' });
    if (guard.scope === 'estate') files[guard.script] = guardScript(estate, guard);
    const rule = estate.rules.find((candidate) => candidate.hid === guard.enforces);
    if (rule && (guard.method !== 'registry' || guard.row)) {
      edges.push({ from: guard.hid, to: rule.hid, kind: 'enforces' });
    }
    if (!guard.anchored) {
      findings.push({ code: 'UNANCHORED_GUARD', subject: guardCommand(guard), defect: 'unanchored_guard' });
    }
    if (!guard.row) findings.push({ code: 'REGISTRY_ROW', subject: guard.name, defect: 'guard_without_row' });
  }
  if (estate.registry.ghost) {
    findings.push({ code: 'REGISTRY_GUARD', subject: estate.registry.ghost.id, defect: 'ghost_row' });
  }
  const registry = renderRegistry(estate);
  write(registry);

  // The step list.
  const steps = new Writer(STEPS);
  steps.line('{');
  steps.line('  "steps": [');
  estate.steps.forEach((step, index) => {
    const close = index === estate.steps.length - 1 ? '' : ',';
    const tail = step.anytime
      ? '"anytime": true'
      : `"next": [${step.next.map((id) => JSON.stringify(id)).join(', ')}]`;
    steps.line(
      `    { "id": ${JSON.stringify(step.id)}, "title": ${JSON.stringify(step.title)}, ${tail} }${close}`,
      [{ hid: `stage:${step.id}`, kind: 'stage', key: step.id }],
    );
    for (const next of step.next) edges.push({ from: `stage:${step.id}`, to: `stage:${next}`, kind: 'next' });
  });
  steps.line('  ]');
  steps.line('}');
  write(steps);

  return {
    files,
    atoms,
    edges,
    findings,
    recording: { family: 'recording', model: 'estate-validator-truth', answers } as EstateRecording,
    chunks,
  };
}

/** The situation the model records for a standing rule, when it has one. */
function ruleSituation(rule: StandingRule): string | undefined {
  return rule.situation ?? (rule.scope === 'always' ? undefined : rule.text.split(',')[0]);
}

function renderRegistry(estate: HiddenEstate): Writer {
  const rows = estate.guards
    .filter((guard) => guard.row)
    .map((guard, index) => ({ id: `G${index + 1}`, guard, enforces: registryEnforces(estate, guard) }));
  const ghost = estate.registry.ghost;
  if (estate.registry.format === 'json') {
    const writer = new Writer(REGISTRY_JSON);
    writer.line('{', [{ hid: 'invariant:registry_complete', kind: 'invariant', key: 'registry_complete' }]);
    writer.line('  "checks": [');
    const all = [
      ...rows.map((row) => ({
        id: row.id,
        guard: row.guard.name,
        event: row.guard.event,
        enforces: row.enforces.json,
        verdict: row.guard.verdict,
      })),
      ...(ghost
        ? [{ id: ghost.id, guard: ghost.guard, event: 'PreToolUse', enforces: [], verdict: 'deny' }]
        : []),
    ];
    all.forEach((row, index) => {
      writer.line(`    ${JSON.stringify(row)}${index === all.length - 1 ? '' : ','}`);
    });
    writer.line('  ]');
    writer.line('}');
    return writer;
  }
  const writer = new Writer(REGISTRY_MD);
  writer.line('# Check registry', [
    { hid: 'invariant:registry_complete', kind: 'invariant', key: 'registry_complete' },
  ]);
  writer.line('');
  writer.line(
    'One row per guard: the script, the event it runs on, the rules it enforces and the verdict it gives.',
  );
  writer.line('');
  writer.line('| Id | Guard | Event | Enforces | Verdict |');
  writer.line('|---|---|---|---|---|');
  for (const row of rows) {
    writer.line(
      `| ${row.id} | ${row.guard.name} | ${row.guard.event} | ${row.enforces.cell} | ${row.guard.verdict} |`,
    );
  }
  if (ghost) writer.line(`| ${ghost.id} | ${ghost.guard} | PreToolUse | none | deny |`);
  return writer;
}

/** What a registry row says a guard enforces: a label, or a quoted passage of the rule. */
function registryEnforces(estate: HiddenEstate, guard: HiddenGuard): { cell: string; json: string[] } {
  const rule = estate.rules.find((candidate) => candidate.hid === guard.enforces);
  if (!rule || guard.method !== 'registry') return { cell: 'none', json: [] };
  if (guard.id === 'stop') {
    const passage = 'stop all work and confirm in one line';
    return { cell: `"${passage}"`, json: [passage] };
  }
  return rule.label ? { cell: rule.label, json: [rule.label] } : { cell: 'none', json: [] };
}

/** A guard's script. Its string literals never hold a rule's words unless the guard enforces it by quote. */
function guardScript(estate: HiddenEstate, guard: HiddenGuard): string {
  const rule = estate.rules.find((candidate) => candidate.hid === guard.enforces);
  switch (guard.id) {
    case 'push':
      return [
        '#!/bin/sh',
        '# Blocks a forced push on any branch.',
        'input=$(cat)',
        'case "$input" in',
        '  *"push --force"*) echo "blocked: forced push" >&2; exit 2 ;;',
        'esac',
        'exit 0',
        '',
      ].join('\n');
    case 'read':
      return [
        '#!/usr/bin/env python3',
        `"""Blocks an edit of a file the session has not read.${rule?.label ? ` Enforces: ${rule.label}` : ''}"""`,
        'import json',
        'import sys',
        '',
        'event = json.load(sys.stdin)',
        'path = event.get("tool_input", {}).get("file_path", "")',
        'if path and path not in set(event.get("reads", [])):',
        '    print("blocked: the file was not read", file=sys.stderr)',
        '    sys.exit(2)',
        'sys.exit(0)',
        '',
      ].join('\n');
    case 'stop':
      return [
        '#!/bin/sh',
        '# Answers the stop word with a nudge, in any letter case.',
        'input=$(cat)',
        'case "$input" in',
        '  *[Ss][Tt][Oo][Pp]*) echo "the user asked to stop" >&2 ;;',
        'esac',
        'exit 0',
        '',
      ].join('\n');
    default:
      return [
        '#!/usr/bin/env python3',
        '"""Warns when a reply is longer than the output rules allow."""',
        'import json',
        'import sys',
        '',
        `RULE = ${JSON.stringify(rule ? LENGTH_RULE : 'The reply is long.')}`,
        'event = json.load(sys.stdin)',
        'if len(event.get("reply", "")) > 1200:',
        '    print(RULE, file=sys.stderr)',
        'sys.exit(0)',
        '',
      ].join('\n');
  }
}
