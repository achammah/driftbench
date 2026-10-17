import type { HiddenEstate, HiddenGuard, HiddenSkill } from './hidden';
import { STANDING } from './layout';
import { fileHid, skillPath, workFolder } from './render';
import type { HiddenSituation } from './situations';

/**
 * The rule follower for estates: a scripted agent, written from the hidden estate, that answers asks and
 * writes what a runtime records of a session: the transcript, the guard decision log and the step feed, in
 * the session format the runtime's adapter reads (the layout module names the runtime). It
 * obeys every atom of the situation an ask belongs to: it loads the skill the route names, reads each
 * reference (a gate's reference before the edit the gate guards), runs the skill's script, dispatches the
 * helper with the brief fields, reads a file before editing it, walks the step list in order, keeps the
 * output rules in its reply, and the guards it runs into give the verdicts the estate declares.
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

type Step = { call: Call } | { stage: string };

export type FollowerSession = { transcript: string; decisions: string; steps: string };

export type FollowerOptions = {
  /** The hidden id of the atom the follower ignores: an agent mutant. */
  mutant?: string;
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
    const guardRow = (guard: HiddenGuard, verdict: string, ms: number) => {
      if (cut(guard.hid)) return;
      decisions.push({ at: at(ms), event: guard.event, check: guard.name, verdict, session: SESSION });
    };

    record('user', { role: 'user', content: ask });
    const promptAt = clock + 100;
    const plan = situation
      ? stepsFor(estate, situation, cwd, cut)
      : { steps: [], reply: chatReply(estate, cut) };
    for (const guard of estate.guards.filter((candidate) => candidate.event === 'UserPromptSubmit')) {
      const watched = situation?.act.type === 'stop' && guard.id === 'stop';
      guardRow(guard, watched ? guard.verdict : 'allow', promptAt);
    }
    let call = 0;
    for (const step of plan.steps) {
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
        guardRow(guard, violates(guard, step.call) ? guard.verdict : 'allow', callAt + 250);
      }
      record(
        'user',
        {
          role: 'user',
          content: [
            {
              tool_use_id: useId,
              type: 'tool_result',
              content: step.call.result,
              ...(step.call.error ? { is_error: true } : {}),
            },
          ],
        },
        step.call.structured ? { toolUseResult: step.call.structured } : {},
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
      const watched = situation?.act.type === 'guard' && situation.act.guard === guard.name;
      guardRow(guard, watched ? guard.verdict : 'allow', clock + 100);
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

/** Whether a call is the act a guard watches for, so it gives its declared verdict. */
function violates(guard: HiddenGuard, call: Call): boolean {
  const command = typeof call.input.command === 'string' ? call.input.command : '';
  switch (guard.id) {
    case 'push':
      return command.includes('push --force');
    case 'format':
      return command.startsWith('python3 ') && command.trim().split(/\s+/).length === 2;
    case 'read':
      return call.label === 'Edit' && call.error === true;
    default:
      return false;
  }
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
  const stage = (id: string): Step[] => (flow.includes(id) && !cut(`stage:${id}`) ? [{ stage: id }] : []);
  return (opening, work) => [...stage('plan'), ...opening, ...stage('do'), ...work, ...after.flatMap(stage)];
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
  if (skill.missing) asks(ref(topic.missing.file), false, refHid(topic.missing.file));
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
