import { spawnSync } from 'node:child_process';
import type { HiddenEstate, HiddenGuard, HiddenSkill } from './hidden';
import { STANDING, STEPS } from './layout';
import { fileHid, HELPER_TOOLS, renderEstate, skillPath, skillTools, workFolder } from './render';
import type { HiddenSituation } from './situations';

/**
 * The rule follower for estates: a scripted agent, written from the hidden estate, that answers asks and
 * writes what a runtime records of a session: the transcript, the guard decision log and the step feed, in
 * the session format the runtime's adapter reads (the layout module names the runtime). It
 * obeys every atom of the situation an ask belongs to: it loads the skill the route names, reads each
 * reference (a gate's reference before the edit the gate guards), runs the skill's script, dispatches the
 * helper with the brief fields, reads a file before editing it, walks the step list in order, keeps the
 * output rules in its reply, and the guards it runs into give the verdicts the estate declares. A call an ask
 * rule covers is denied for permission, as in a headless run where no one can answer: the session keeps a
 * `permission_denied` record and an error result, and the call never runs.
 *
 * A session opens with the init record a runtime writes: the tools it offers, which are its standard tools
 * less every tool a bare deny rule of the settings names (a rule with a pattern, as in `Bash(rm -rf:*)`,
 * keeps the tool offered). Deleting a deny rule offers the tool again.
 *
 * An agent mutant is the follower with one atom deleted: every act that atom asks for is dropped (an act
 * several atoms ask for is dropped with any of them), an order the atom imposes is reversed, and what the
 * atom forbids happens. The follower knows the asks of its situations and nothing of any test.
 */

const BASE = Date.parse('2026-10-12T09:00:00.000Z');
const BLOCK_MS = 600_000;
const SESSION = '00000000-0000-4000-8000-00000000e57a';

/** The tools a runtime offers before any setting denies one. */
const RUNTIME_TOOLS = [
  'Agent',
  'Bash',
  'Edit',
  'Glob',
  'Grep',
  'Read',
  'Skill',
  'Write',
  'WebFetch',
  'WebSearch',
];

type Call = {
  label: string;
  input: Record<string, unknown>;
  result: string;
  error?: boolean;
  structured?: Record<string, unknown>;
};

type Step = { call: Call } | { stage: string } | { event: 'compaction' };

export type FollowerSession = { transcript: string; decisions: string; steps: string };

export type FollowerOptions = {
  /** The hidden id of the atom the follower ignores: an agent mutant. */
  mutant?: string;
  /** Runtime events supplied by the stimulus, never by the expected checks. */
  events?: readonly (string | undefined)[];
};

/** The session the follower records for a list of asks, one user turn per ask. */
export function follow(
  estate: HiddenEstate,
  situations: readonly HiddenSituation[],
  asks: readonly string[],
  options: FollowerOptions = {},
): FollowerSession {
  const cwd = workFolder(estate);
  const records: unknown[] = [];
  const decisions: unknown[] = [];
  const steps: unknown[] = [];
  const cut = (hid: string) => options.mutant === hid;
  let uuid = 0;
  let parent: string | null = null;
  /** Skills loaded so far in the session: a guard a skill declares runs only once its skill is loaded. */
  const loaded = new Set<string>();
  const id = () => {
    uuid += 1;
    return `follower-${String(uuid).padStart(4, '0')}`;
  };
  const denied = estate.permissions.deny.filter((rule) => !rule.includes('(') && !cut(`tool:deny:${rule}`));
  // A call an ask rule covers needs the owner, and a headless run cannot ask: the runtime denies it. The runtime
  // enforces the rule, so with it deleted the call is still denied unless an allow rule covers it or the mode
  // skips approvals; only then does the ask rule's mutant change the session.
  const runsUnasked = (call: Call) =>
    estate.permissions.defaultMode === 'bypassPermissions' ||
    estate.permissions.allow.some((rule) => permissionCovers(rule, call));
  const deniedFor = (call: Call) => {
    const asked = estate.permissions.ask.filter((rule) => permissionCovers(rule, call));
    if (asked.length === 0) return false;
    return asked.some((rule) => !cut(`tool:ask:${rule}`)) || !runsUnasked(call);
  };
  records.push({
    parentUuid: null,
    isSidechain: false,
    userType: 'external',
    cwd,
    sessionId: SESSION,
    version: '2.0.0',
    type: 'system',
    subtype: 'init',
    uuid: 'follower-init',
    timestamp: new Date(BASE).toISOString(),
    tools: RUNTIME_TOOLS.filter((tool) => !denied.includes(tool)),
  });
  asks.forEach((ask, blockIndex) => {
    const situation = situations.find((candidate) => candidate.phrases.includes(ask));
    let clock = BASE + blockIndex * BLOCK_MS;
    const at = (ms: number) => new Date(ms).toISOString();
    const tick = () => {
      clock += 1000;
      return at(clock);
    };
    const record = (type: string, message: unknown, extra: Record<string, unknown> = {}) => {
      const uid = id();
      records.push({
        parentUuid: parent,
        isSidechain: false,
        userType: 'external',
        cwd,
        sessionId: SESSION,
        version: '2.0.0',
        type,
        uuid: uid,
        timestamp: tick(),
        message,
        ...extra,
      });
      parent = uid;
    };
    const reads = new Set<string>();
    const guardRow = (guard: HiddenGuard, payload: Record<string, unknown>, ms: number) => {
      if (cut(guard.hid)) return;
      const result = executeGuard(estate, guard, payload);
      const verdict = result.exitCode === 2 ? 'deny' : result.stderr.trim() ? guard.verdict : 'allow';
      decisions.push({
        at: at(ms),
        event: guard.event,
        check: guard.name,
        verdict,
        session: SESSION,
        ...result,
      });
    };

    record('user', { role: 'user', content: ask });
    // A bare-tool denial removes the offered tool; a command restriction does not remove Bash.
    const offered = new Set([
      'Skill',
      'Agent',
      ...HELPER_TOOLS,
      'Edit',
      'Write',
      'Bash',
      'WebFetch',
      'WebSearch',
      ...estate.permissions.allow.map((rule) => rule.split('(')[0] as string),
      ...estate.skills.flatMap((skill) => skillTools(skill).map((rule) => rule.split('(')[0] as string)),
    ]);
    // The agent mutant that deletes the deny rule offers the tool again.
    for (const denied of estate.permissions.deny)
      if (!denied.includes('(') && !cut(`tool:deny:${denied}`)) offered.delete(denied);
    record('system', {}, { subtype: 'init', tools: [...offered].sort() });
    const suppliedEvent = options.events?.[blockIndex];
    const event = suppliedEvent === 'compaction_mid_task' ? 'compaction' : suppliedEvent;
    const promptAt = clock + 100;
    const plan = situation
      ? stepsFor(estate, situation, cwd, cut)
      : { steps: [], reply: chatReply(estate, cut) };
    if (event === 'compaction') {
      const recovery: Step[] = estate.rules.some((rule) => rule.hazard === 'compaction' && !cut(rule.hid))
        ? [{ call: read(cwd, STANDING) }]
        : [];
      plan.steps.unshift({ call: read(cwd, STANDING) }, { event: 'compaction' }, ...recovery);
    }
    for (const guard of estate.guards.filter((candidate) => candidate.event === 'UserPromptSubmit')) {
      guardRow(guard, { prompt: ask }, promptAt);
    }
    let call = 0;
    for (const step of plan.steps) {
      if ('event' in step) {
        record(
          'system',
          {},
          { subtype: 'compact_boundary', compactMetadata: { trigger: 'manual', preTokens: 100 } },
        );
        continue;
      }
      if ('stage' in step) {
        steps.push({ at: at(clock + 500), step: step.stage });
        continue;
      }
      call += 1;
      const useId = `toolu_follower_${blockIndex}_${call}`;
      record('assistant', {
        id: `msg_follower_${blockIndex}_${call}`,
        type: 'message',
        role: 'assistant',
        model: 'rule-follower',
        content: [{ type: 'tool_use', id: useId, name: step.call.label, input: step.call.input }],
        usage: { input_tokens: 10, output_tokens: 5 },
      });
      const callAt = clock;
      if (step.call.label === 'Skill' && typeof step.call.input.skill === 'string')
        loaded.add(step.call.input.skill);
      for (const guard of estate.guards.filter((candidate) => candidate.event === 'PreToolUse')) {
        if (!matches(guard.matcher, step.call.label)) continue;
        const scoped = guard.scope === 'estate' || loaded.has(guard.scope);
        if (!scoped) continue;
        guardRow(
          guard,
          { tool_name: step.call.label, tool_input: step.call.input, reads: [...reads] },
          callAt + 250,
        );
      }
      const done = deniedFor(step.call) ? refused(step.call) : step.call;
      if (done !== step.call) {
        record(
          'system',
          {},
          {
            subtype: 'permission_denied',
            tool_name: step.call.label,
            tool_use_id: useId,
            message: done.result,
          },
        );
      }
      if (done.label === 'Read' && !done.error) reads.add(String(done.input.file_path));
      record(
        'user',
        {
          role: 'user',
          content: [
            {
              tool_use_id: useId,
              type: 'tool_result',
              content: done.result,
              ...(done.error ? { is_error: true } : {}),
            },
          ],
        },
        done.structured ? { toolUseResult: done.structured } : {},
      );
    }
    record('assistant', {
      id: `msg_follower_${blockIndex}_reply`,
      type: 'message',
      role: 'assistant',
      model: 'rule-follower',
      content: [{ type: 'text', text: plan.reply }],
      usage: { input_tokens: 10, output_tokens: 20 },
    });
    for (const guard of estate.guards.filter((candidate) => candidate.event === 'Stop')) {
      guardRow(guard, { reply: plan.reply }, clock + 100);
    }
  });
  const jsonl = (rows: readonly unknown[]) => rows.map((row) => `${JSON.stringify(row)}\n`).join('');
  return { transcript: jsonl(records), decisions: jsonl(decisions), steps: jsonl(steps) };
}

/** A guard's matcher as the runtime reads it: alternatives of tool labels. */
function matches(matcher: string | undefined, label: string): boolean {
  if (matcher === undefined || matcher === '') return true;
  return matcher.split('|').includes(label);
}

/** Execute the rendered guard itself. Cache identical pure payloads, not expected verdicts. */
const scripts = new WeakMap<HiddenEstate, Record<string, string>>();
const guardResults = new Map<string, { stdout: string; stderr: string; exitCode: number; outcome: string }>();
function executeGuard(estate: HiddenEstate, guard: HiddenGuard, payload: Record<string, unknown>) {
  let files = scripts.get(estate);
  if (!files) {
    files = renderEstate(estate).files;
    scripts.set(estate, files);
  }
  const script = files[guard.script];
  if (script === undefined) throw new Error(`No rendered guard script: ${guard.script}`);
  const input = JSON.stringify(payload);
  const key = JSON.stringify([script, input]);
  let result = guardResults.get(key);
  if (!result) {
    const run = spawnSync(guard.interpreter ?? 'sh', ['-c', script], {
      input,
      encoding: 'utf8',
      timeout: 30_000,
    });
    if (run.error || run.status === null)
      throw new Error(`Guard failed: ${run.error?.message ?? run.stderr}`);
    result = { stdout: run.stdout, stderr: run.stderr, exitCode: run.status, outcome: 'completed' };
    guardResults.set(key, result);
  }
  return result;
}

/** A call an ask rule covers, in a run where no one can answer: denied for permission, never run. */
function refused(call: Call): Call {
  return {
    label: call.label,
    input: call.input,
    result: `Permission to use ${call.label} has been denied.`,
    error: true,
  };
}

/** Permission patterns use the same documented glob/prefix syntax as the rendered settings. */
function permissionCovers(rule: string, call: Call): boolean {
  const parts = /^([^()]+)(?:\((.*)\))?$/.exec(rule);
  if (parts?.[1] !== call.label) return false;
  const pattern = parts[2];
  if (!pattern) return true;
  const value = String(call.input.command ?? call.input.file_path ?? call.input.url ?? '');
  const prefix = pattern.endsWith(':*') ? pattern.slice(0, -2) : undefined;
  if (prefix !== undefined) return value === prefix || value.startsWith(`${prefix} `);
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${source}$`).test(value);
}

type Cut = (hid: string) => boolean;

function words(estate: HiddenEstate, cut: Cut, lines: string[]): string {
  const out = [...lines];
  if (cut('rule:no-filler-words') && estate.rules.some((rule) => rule.hid === 'rule:no-filler-words')) {
    out.push('This was simply routine work.');
  }
  if (!cut('rule:next-line')) out.push('Next: nothing else is open on my side.');
  return out.join('\n');
}

function chatReply(estate: HiddenEstate, cut: Cut): string {
  return words(estate, cut, ['That is outside the work I do here; please ask the front desk.']);
}

function read(cwd: string, path: string, exists = true): Call {
  return exists
    ? {
        label: 'Read',
        input: { file_path: `${cwd}/${path}` },
        result: `# ${path}\nThe file reads as expected.\n`,
      }
    : { label: 'Read', input: { file_path: `${cwd}/${path}` }, result: 'File does not exist.', error: true };
}

function edit(cwd: string, path: string, blocked = false): Call {
  return {
    label: 'Edit',
    input: { file_path: `${cwd}/${path}`, old_string: 'open', new_string: 'done' },
    result: blocked ? 'blocked: the file was not read' : 'The file has been updated.',
    ...(blocked ? { error: true } : {}),
  };
}

function bash(command: string, exit = 0, output = 'summary: ok'): Call {
  return {
    label: 'Bash',
    input: { command, description: 'Run a command' },
    result: exit === 0 ? output : `Exit code ${exit}\n${output}`,
    ...(exit === 0 ? {} : { error: true }),
    structured: { stdout: exit === 0 ? output : '', stderr: exit === 0 ? '' : output, exitCode: exit },
  };
}

function dispatch(name: string, fields: readonly string[], values: readonly string[]): Call {
  const brief = fields.map((field, index) => `${field}: ${values[index] ?? 'unknown'}`).join('; ');
  return {
    label: 'Agent',
    input: {
      subagent_type: name,
      description: `Brief for ${name}`,
      prompt: `${brief}. Answer with one JSON object.`,
    },
    result: '{"status": "done", "findings": []}',
  };
}

/**
 * The walk through the step list: `plan`, the opening work, `do`, the work, then the stages after `do` in
 * the list's order. The mutant of a stage drops it; the mutant of the verify-before-report rule reports first.
 */
function walkOf(estate: HiddenEstate, cut: Cut): (opening: Step[], work: Step[]) => Step[] {
  const flow = estate.steps.filter((step) => !step.anytime).map((step) => step.id);
  let after = flow.filter((id) => id !== 'plan' && id !== 'do');
  if (cut('rule:verify-before-report')) {
    after = [...after.filter((id) => id === 'report'), ...after.filter((id) => id !== 'report')];
  }
  const stage = (id: string): Step[] =>
    estate.steps.some((step) => step.id === id) && !cut(`stage:${id}`) ? [{ stage: id }] : [];
  const anytime = estate.steps.filter((step) => step.anytime).flatMap((step) => stage(step.id));
  return (opening, work) => [
    ...stage('plan'),
    ...opening,
    ...stage('do'),
    ...work,
    ...anytime,
    ...after.flatMap(stage),
  ];
}

/** What the follower does on an ask of a situation, and its reply. */
function stepsFor(
  estate: HiddenEstate,
  situation: HiddenSituation,
  cwd: string,
  cut: Cut,
): { steps: Step[]; reply: string } {
  const act = situation.act;
  const walk = walkOf(estate, cut);
  const forbidden = (): Step[] =>
    cut('rule:no-webfetch') || cut('tool:deny:WebFetch')
      ? [{ call: { label: 'WebFetch', input: { url: 'https://example.com/rates' }, result: 'fetched' } }]
      : [];

  switch (act.type) {
    case 'tool': {
      const match = /^([^()]+)(?:\((.*)\))?$/.exec(act.rule);
      const label = match?.[1] ?? act.rule;
      const pattern = match?.[2];
      const value = (pattern ?? '').replace(/:\*$/, ' fixture').replace(/\*/g, 'fixture');
      const calls: Step[] = [];
      if (act.skill)
        calls.push({
          call: { label: 'Skill', input: { skill: act.skill }, result: `Launching skill: ${act.skill}` },
        });
      const helper = estate.helpers.find((candidate) => candidate.topic.name === act.helper);
      if (helper) calls.push({ call: dispatch(helper.topic.name, helper.topic.fields, ['5120', '8830']) });
      if (label === 'Edit' || label === 'Write') calls.push({ call: read(cwd, 'notes/probe.md') });
      const call =
        label === 'Bash'
          ? bash(value || 'printf fixture')
          : label === 'Read'
            ? read(cwd, value || STEPS)
            : label === 'Edit' || label === 'Write'
              ? edit(cwd, 'notes/probe.md')
              : {
                  label,
                  input: { pattern: value || 'fixture', path: `${cwd}/notes` },
                  result: 'fixture match',
                };
      calls.push({ call });
      return { steps: calls, reply: words(estate, cut, ['The local permission probe is complete.']) };
    }
    case 'chat':
      return { steps: [], reply: chatReply(estate, cut) };
    case 'stop':
      return { steps: [], reply: words(estate, cut, ['Stopped: all work is on hold until you say go.']) };
    case 'push': {
      const force = cut('rule:no-force-push');
      return {
        steps: walk(
          [],
          [{ call: bash(force ? 'git push --force origin release' : 'git push origin release') }],
        ),
        reply: words(estate, cut, ['The release branch is pushed.']),
      };
    }
    case 'helper':
    case 'resume': {
      const helper = estate.helpers.find((candidate) => candidate.topic.name === act.helper);
      if (!helper) return { steps: [], reply: chatReply(estate, cut) };
      const routes = [helper.hid, `route:desc:${helper.topic.name}`, `route:table:${helper.topic.name}`];
      const work: Step[] = routes.some(cut)
        ? []
        : [{ call: dispatch(helper.topic.name, helper.topic.fields, ['5120', '8830']) }];
      return {
        steps: walk([], [...work, ...forbidden()]),
        reply: words(estate, cut, [`The ${helper.topic.noun} work is done and nothing was found twice.`]),
      };
    }
    case 'guard': {
      const guard = estate.guards.find((candidate) => candidate.name === act.guard) as HiddenGuard;
      if (guard.id === 'push') {
        return {
          steps: [{ call: bash('git push --force origin release', 2, 'blocked: forced push') }],
          reply: words(estate, cut, ['The forced push was blocked by a guard; nothing was pushed.']),
        };
      }
      if (guard.id === 'read') {
        return {
          steps: [{ call: edit(cwd, 'notes/todo.md', true) }],
          reply: words(estate, cut, ['The edit was blocked because the file was not read first.']),
        };
      }
      if (guard.id === 'format') {
        const skill = estate.skills.find((candidate) => candidate.topic.skill === guard.scope) as HiddenSkill;
        const script = skillPath(skill, `scripts/${skill.topic.script.file}`);
        return {
          steps: [
            {
              call: {
                label: 'Skill',
                input: { skill: skill.topic.skill },
                result: `Launching skill: ${skill.topic.skill}`,
              },
            },
            { call: bash(`python3 ${script}`, 2, 'blocked: the script needs its arguments') },
          ],
          reply: words(estate, cut, ['The script was blocked: it needs its arguments.']),
        };
      }
      const long = Array.from(
        { length: 30 },
        (_, index) => `Rule ${index + 1} of the output keeps every answer short and plain for the team.`,
      );
      return { steps: [], reply: words(estate, cut, ['Here is every rule in full.', ...long]) };
    }
    case 'task':
      return taskSteps(estate, act.skill, cwd, cut, walk, forbidden);
  }
}

function taskSteps(
  estate: HiddenEstate,
  name: string,
  cwd: string,
  cut: Cut,
  walk: (opening: Step[], work: Step[]) => Step[],
  forbidden: () => Step[],
): { steps: Step[]; reply: string } {
  const skill = estate.skills.find((candidate) => candidate.topic.skill === name) as HiddenSkill;
  const topic = skill.topic;
  const ref = (file: string) => skillPath(skill, `references/${file}`);
  const refHid = (file: string) => fileHid('ref', skill, `references/${file}`);
  const opening: Step[] = [];
  const doing: Step[] = [];
  const late: Step[] = [];

  if (![skill.hid, `route:desc:${name}`, `route:table:${name}`].some(cut)) {
    opening.push({
      call: { label: 'Skill', input: { skill: name }, result: `Launching skill: ${name}` },
    });
  }
  if (!cut(`ref:${STANDING}:${STEPS}`)) opening.push({ call: read(cwd, STEPS) });
  // One read per file. A file several atoms ask for (the lookup, the skill's gate reference and a standing line
  // naming the same path) is one act: dropped with any reference atom that asks for it, read after the edit it
  // guards when any gate atom that orders it is the mutant.
  const reads = new Map<string, { path: string; exists: boolean; refs: string[]; gates: string[] }>();
  const asks = (path: string, exists: boolean, refAtom: string, gate?: string) => {
    const key = `${exists}:${path}`;
    const act = reads.get(key) ?? { path, exists, refs: [], gates: [] };
    act.refs.push(refAtom);
    if (gate !== undefined) act.gates.push(gate);
    reads.set(key, act);
  };
  asks(ref(topic.lookup.file), true, refHid(topic.lookup.file));
  if (skill.missing)
    asks(ref(topic.missing.file), skill.referenceSupplied === true, refHid(topic.missing.file));
  // Gate reads: before the edit, or after it when the gate is the mutant.
  asks(ref(topic.gate.file), true, refHid(topic.gate.file), `gate:${name}`);
  if (skill.comma) asks(ref(topic.comma.file), true, refHid(topic.comma.file), `gate:${name}:comma`);
  for (const rule of estate.rules.filter((candidate) => candidate.fixedGate?.skill === name)) {
    const path = rule.fixedGate?.path as string;
    asks(path, true, `ref:${STANDING}:${path}`, rule.hid);
  }
  for (const act of reads.values()) {
    if (act.refs.some(cut)) continue;
    (act.gates.some(cut) ? late : opening).push({ call: read(cwd, act.path, act.exists) });
  }
  const script = skillPath(skill, `scripts/${topic.script.file}`);
  if (!cut(fileHid('script', skill, `scripts/${topic.script.file}`)) && !cut(`rule:${name}:script`)) {
    doing.push({ call: bash(`python3 ${script} ${topic.script.args}`) });
  }
  if (skill.dispatch && !cut(`rule:${name}:dispatch`)) {
    const helper = estate.helpers.find((candidate) => candidate.topic.name === skill.dispatch);
    if (helper && !cut(helper.hid)) {
      doing.push({ call: dispatch(helper.topic.name, helper.topic.fields, ['4411', '9921']) });
    }
  }
  doing.push(...forbidden());
  const readTarget: Step = { call: read(cwd, topic.target) };
  const readFirst = !cut('rule:read-before-edit');
  if (readFirst) doing.push(readTarget);
  doing.push({ call: edit(cwd, topic.target) });
  if (!readFirst) doing.push(readTarget);
  doing.push(...late);

  const reply = [`The ${topic.noun} work is done and the file is updated.`];
  if (!cut(`rule:${name}:register`)) reply.push(topic.register.example);
  return { steps: walk(opening, doing), reply: words(estate, cut, reply) };
}
