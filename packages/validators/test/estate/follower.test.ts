import { mapSession, parseJsonl } from '@agent-nexus/driftbench-adapters';
import { ESTATE_CHECKS } from '@agent-nexus/driftbench-checks';
import type { CheckContext, Observed } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import type { HiddenSkill, Topic } from '../../src/ladders/estate/hidden';
import { drawEstate, follow, type HiddenEstate, situationsOf } from '../../src/ladders/estate/index';
import { STANDING } from '../../src/ladders/estate/layout';
import { fileHid } from '../../src/ladders/estate/render';

/** An estate of seed 1 with its situations, and the follower's session for one ask, mapped. */
function setup(seed = 1) {
  const estate = drawEstate(seed);
  const situations = situationsOf(estate);
  const session = (asks: string[], mutant?: string) => {
    const raw = follow(estate, situations, asks, mutant ? { mutant } : {});
    return {
      raw,
      mapped: mapSession({
        transcript: parseJsonl(raw.transcript),
        decisions: parseJsonl(raw.decisions),
        steps: parseJsonl(raw.steps),
      }),
    };
  };
  const ask = (id: string) => {
    const situation = situations.find((candidate) => candidate.id === id);
    if (!situation) throw new Error(`no situation ${id}`);
    return situation.phrases[0] as string;
  };
  return { estate, situations, session, ask };
}

function labels(observed: { toolCalls: Array<{ label: string }> }): string[] {
  return observed.toolCalls.map((call) => call.label);
}

function firstSkill(estate: HiddenEstate) {
  return [...estate.skills].sort((a, b) =>
    a.topic.skill < b.topic.skill ? -1 : 1,
  )[0] as HiddenEstate['skills'][0];
}

describe('the estate rule follower', { timeout: 120_000 }, () => {
  it('obeys a skill task: loads, reads before it edits, runs the script, walks the steps, keeps the output rules', () => {
    const { estate, session, ask } = setup();
    const skill = firstSkill(estate);
    const { mapped } = session([ask(`${skill.topic.skill}-task`)]);
    expect(mapped.blocks).toHaveLength(1);
    const observed = mapped.blocks[0]?.observed;
    if (!observed) throw new Error('no block');
    expect(observed.runtime?.skills?.map((entry) => entry.name)).toEqual([skill.topic.skill]);
    const calls = labels(observed);
    expect(calls[0]).toBe('Skill');
    expect(calls.lastIndexOf('Read')).toBeLessThan(calls.indexOf('Edit'));
    expect(observed.workspaceDiff).toEqual({ created: [], changed: [skill.topic.target], deleted: [] });
    expect((observed.executions ?? []).map((run) => run.exitCode)).toEqual([0]);
    expect(observed.executions?.[0]?.command).toContain(skill.topic.script.file);
    expect(observed.runtime?.stages?.map((stage) => stage.name)).toEqual([
      'plan',
      'do',
      'note',
      'verify',
      'report',
    ]);
    expect(observed.text).toContain('Next:');
    expect(observed.text).toContain(skill.topic.register.word);
    expect(observed.text).not.toMatch(/obviously|simply/);
    expect(calls).not.toContain('WebFetch');
  });

  it('records a verdict for each guard its acts run into, allow when nothing is wrong', () => {
    const { estate, session, ask } = setup();
    const skill = firstSkill(estate);
    const { mapped } = session([ask(`${skill.topic.skill}-task`)]);
    const guards = mapped.blocks[0]?.observed.runtime?.guards ?? [];
    expect(guards.length).toBeGreaterThan(0);
    expect(new Set(guards.map((guard) => guard.verdict))).toEqual(new Set(['allow']));
  });

  it('gives a guard its declared verdict on the act it watches', () => {
    const { estate, session, ask } = setup();
    for (const guard of estate.guards) {
      const { mapped } = session([ask(`${guard.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-event`)]);
      const fired = mapped.blocks[0]?.observed.runtime?.guards ?? [];
      expect(fired, guard.name).toContainEqual(
        expect.objectContaining({ name: guard.name, verdict: guard.verdict }),
      );
    }
  });

  it('answers an ask outside every skill with no tool, no skill and no step', () => {
    const { estate, session, ask } = setup();
    const { mapped } = session([ask(`${firstSkill(estate).topic.skill}-near`)]);
    const observed = mapped.blocks[0]?.observed;
    expect(observed?.toolCalls).toEqual([]);
    expect(observed?.runtime?.skills).toEqual([]);
    expect(observed?.runtime?.stages).toEqual([]);
    expect(observed?.text).toContain('Next:');
  });

  it('writes one block per ask, in order', () => {
    const { estate, session, ask } = setup();
    const helper = estate.helpers[0];
    if (!helper) throw new Error('no helper');
    const { mapped } = session([ask(`${helper.topic.name}-task`), ask(`${helper.topic.name}-resume`)]);
    expect(mapped.blocks).toHaveLength(2);
    for (const block of mapped.blocks) {
      expect(
        block.observed.toolCalls.map((call) => (call.input as { subagent_type?: string }).subagent_type),
      ).toEqual([helper.topic.name]);
    }
  });

  it('dispatches the declaration owner for tool probes after helper renaming and reordering', () => {
    for (const seed of [1, 7, 19]) {
      const estate = drawEstate(seed);
      const names = new Map(
        [...estate.helpers].reverse().map((helper, index) => [helper.topic.name, `fixture-helper-${index}`]),
      );
      estate.helpers = [...estate.helpers].reverse().map((helper) => ({
        ...helper,
        topic: { ...helper.topic, name: names.get(helper.topic.name) as string },
      }));
      for (const skill of estate.skills)
        if (skill.dispatch) skill.dispatch = names.get(skill.dispatch) as string;
      const situations = situationsOf(estate);
      const probes = situations.filter((s) => s.act.type === 'tool' && s.act.helper);
      expect(probes.length).toBeGreaterThan(0);
      for (const probe of probes) {
        if (probe.act.type !== 'tool') throw new Error('not a tool situation');
        const act = probe.act;
        const owner = estate.helpers.find((helper) => helper.topic.name === act.helper);
        if (!owner) throw new Error('declaration owner missing');
        const raw = follow(estate, situations, [probe.phrases[0] as string]);
        const observed = mapSession({ transcript: parseJsonl(raw.transcript) }).blocks[0]?.observed;
        expect(observed?.runtime?.subagents?.map((agent) => agent.name)).toContain(owner.topic.name);
        const call = observed?.toolCalls.find((call) => call.label === 'Agent');
        if (!call) throw new Error('helper dispatch missing');
        for (const field of owner.topic.fields)
          expect((call.input as { prompt: string }).prompt).toContain(`${field}:`);
        expect(observed?.toolCalls.map((call) => call.label)).toContain(probe.act.rule);
      }
    }
  });

  it('drops what a deleted atom asks for: the skill load, a step, a guard, a word, the read before the edit', () => {
    const { estate, session, ask } = setup();
    const skill = firstSkill(estate);
    const task = [ask(`${skill.topic.skill}-task`)];
    const clean = session(task).mapped.blocks[0]?.observed;
    const without = (hid: string) => session(task, hid).mapped.blocks[0]?.observed;

    expect(without(skill.hid)?.runtime?.skills).toEqual([]);
    expect(without('stage:verify')?.runtime?.stages?.map((stage) => stage.name)).toEqual([
      'plan',
      'do',
      'note',
      'report',
    ]);
    expect(without('rule:verify-before-report')?.runtime?.stages?.map((stage) => stage.name)).toEqual([
      'plan',
      'do',
      'note',
      'report',
      'verify',
    ]);
    expect(without('rule:next-line')?.text).not.toContain('Next:');
    expect(without('rule:no-filler-words')?.text).toContain('simply');
    expect(labels(without('rule:no-webfetch') ?? { toolCalls: [] })).toContain('WebFetch');
    const reordered = labels(without('rule:read-before-edit') ?? { toolCalls: [] });
    expect(reordered.indexOf('Edit')).toBeLessThan(reordered.lastIndexOf('Read'));
    const guard = estate.guards[0];
    if (!guard) throw new Error('no guard');
    expect(without(guard.hid)?.runtime?.guards?.map((entry) => entry.name)).not.toContain(guard.name);
    expect(clean?.runtime?.guards?.map((entry) => entry.name).length).toBeGreaterThan(
      without(guard.hid)?.runtime?.guards?.length ?? 0,
    );
  });
});

/** A skill task whose gate reference is also named by a standing line: one file, several atoms ask to read it. */
function sharedGateReads() {
  const found: Array<{ seed: number; estate: HiddenEstate; skill: HiddenEstate['skills'][0]; path: string }> =
    [];
  for (let seed = 1; seed <= 8; seed += 1) {
    const estate = drawEstate(seed);
    for (const rule of estate.rules) {
      const skill = estate.skills.find((candidate) => candidate.topic.skill === rule.fixedGate?.skill);
      if (skill && rule.fixedGate) found.push({ seed, estate, skill, path: rule.fixedGate.path });
    }
  }
  return found;
}

describe('an act several atoms ask for, in the rule follower', { timeout: 120_000 }, () => {
  const readsOf = (observed: { toolCalls: Array<{ label: string; input?: unknown }> } | undefined) =>
    (observed?.toolCalls ?? []).map((call) => ({
      label: call.label,
      file: (call.input as { file_path?: string } | undefined)?.file_path ?? '',
    }));

  it('reads a file once when a skill gate and a standing line both ask for it', () => {
    const found = sharedGateReads();
    expect(found.length).toBeGreaterThan(0);
    for (const { seed, estate, skill, path } of found) {
      const { session, ask } = setup(seed);
      const calls = readsOf(session([ask(`${skill.topic.skill}-task`)]).mapped.blocks[0]?.observed);
      const reads = calls.filter((call) => call.label === 'Read' && call.file.endsWith(path));
      expect(reads, `seed ${seed} ${path}`).toHaveLength(1);
      expect(estate.rules.some((rule) => rule.fixedGate?.path === path)).toBe(true);
    }
  });

  it('drops the read with the skill reference atom or with the standing reference atom that asks for it', () => {
    for (const { seed, skill, path } of sharedGateReads()) {
      const { session, ask } = setup(seed);
      const task = [ask(`${skill.topic.skill}-task`)];
      for (const hid of [
        fileHid('ref', skill, `references/${skill.topic.gate.file}`),
        `ref:${STANDING}:${path}`,
      ]) {
        const calls = readsOf(session(task, hid).mapped.blocks[0]?.observed);
        expect(
          calls.filter((call) => call.label === 'Read' && call.file.endsWith(path)),
          `seed ${seed} without ${hid}`,
        ).toEqual([]);
      }
    }
  });

  it('reads the file after the edit when any gate atom that orders it is the mutant, still once', () => {
    for (const { seed, estate, skill, path } of sharedGateReads()) {
      const { session, ask } = setup(seed);
      const task = [ask(`${skill.topic.skill}-task`)];
      const gates = [
        `gate:${skill.topic.skill}`,
        ...estate.rules.filter((rule) => rule.fixedGate?.path === path).map((rule) => rule.hid),
      ];
      for (const hid of gates) {
        const calls = readsOf(session(task, hid).mapped.blocks[0]?.observed);
        const edit = calls.findIndex((call) => call.label === 'Edit');
        const gateReads = calls
          .map((call, index) => ({ ...call, index }))
          .filter((call) => call.label === 'Read' && call.file.endsWith(path));
        expect(
          gateReads.map((call) => call.index > edit),
          `seed ${seed} without ${hid}`,
        ).toEqual([true]);
      }
    }
  });
});

describe('the tools the rule follower records as offered', { timeout: 120_000 }, () => {
  const offeredOf = (estate: HiddenEstate, mutant?: string) => {
    const situations = situationsOf(estate);
    const phrase = situations.find((candidate) => candidate.use === 'trigger')?.phrases[0] as string;
    const raw = follow(estate, situations, [phrase], mutant ? { mutant } : {});
    return mapSession({
      transcript: parseJsonl(raw.transcript),
      decisions: parseJsonl(raw.decisions),
      steps: parseJsonl(raw.steps),
    }).blocks[0]?.observed.runtime?.offered;
  };

  it('opens the session with the runtime tools less every tool a bare deny rule names', () => {
    for (let seed = 1; seed <= 8; seed += 1) {
      const estate = drawEstate(seed);
      estate.permissions.deny.push('WebSearch', 'Write(*.lock)');
      const offered = offeredOf(estate);
      expect(offered, `seed ${seed}`).toBeDefined();
      for (const rule of estate.permissions.deny.filter((candidate) => !candidate.includes('('))) {
        expect(offered, `seed ${seed} ${rule}`).not.toContain(rule);
      }
      // A rule with a pattern keeps the tool offered; the tools the follower itself uses stay offered.
      expect(offered).toEqual(expect.arrayContaining(['Read', 'Edit', 'Bash', 'Skill', 'Agent', 'Write']));
    }
  });

  it('offers the tool again when the deny rule that names it is the mutant, and only that tool', () => {
    for (let seed = 1; seed <= 8; seed += 1) {
      const estate = drawEstate(seed);
      estate.permissions.deny.push('WebSearch');
      const clean = offeredOf(estate) ?? [];
      for (const rule of ['WebFetch', 'WebSearch']) {
        const offered = offeredOf(estate, `tool:deny:${rule}`) ?? [];
        expect(offered, `seed ${seed} without ${rule}`).toContain(rule);
        expect(offered.filter((tool) => !clean.includes(tool))).toEqual([rule]);
      }
      expect(offeredOf(estate, 'rule:no-webfetch')).toEqual(clean);
    }
  });
});

/**
 * A hand-written estate, drawn by no seed: one pottery skill, no helper and no guard, a step list with a step
 * allowed at any point, and permission rules of each effect.
 */
function potteryEstate() {
  const topic: Topic = {
    skill: 'kiln-log',
    heading: 'Kiln log',
    noun: 'firing',
    description: 'Log a kiln firing. Use when the user asks to log a firing.',
    routeAsk: 'log a kiln firing',
    lookup: { file: 'cones.md', line: 'Look up the cone in the cone table.' },
    gate: { file: 'kiln-safety.md', verb: 'log' },
    script: { file: 'tally.py', args: '--kiln 2' },
    prohibition: { text: 'Never delete a firing record.', title: 'Never delete a firing record' },
    register: { text: 'Name the cone.', word: 'cone', title: 'Name the cone', example: 'The cone was six.' },
    dispatch: '',
    missing: { file: 'glazes.md', line: 'See the glaze list.' },
    orphan: 'old-kilns.md',
    target: 'logs/firings.md',
    targetText: '# Firings\nopen\n',
    trigger: ['Log the firing of kiln two.', 'Record last night firing.', 'Add the kiln two firing.'],
    pressure: 'Log the firing now, no time for checks.',
    misroute: 'Use the glaze tool to log the firing.',
    nearMiss: 'What is a kiln firing?',
    outside: 'What time does the studio open?',
    comma: { file: 'cooling.md', verb: 'open' },
  };
  const skill: HiddenSkill = {
    hid: 'skill:kiln-log',
    topic,
    missing: false,
    orphan: false,
    extraTools: [],
    comma: false,
    unnamedScript: false,
    routed: true,
    omit: [],
  };
  const estate: HiddenEstate = {
    seed: 0,
    profile: 'visible',
    company: 'Pinecone Pottery',
    slug: 'pinecone',
    business: 'pottery studio',
    rules: [],
    skills: [skill],
    helpers: [],
    guards: [],
    steps: [
      { id: 'plan', title: 'Say what you will do', next: ['do'], anytime: false },
      { id: 'do', title: 'Do the work', next: ['report'], anytime: false },
      { id: 'report', title: 'Say what changed', next: [], anytime: false },
      { id: 'sweep', title: 'Sweep the bench', next: [], anytime: true },
    ],
    permissions: {
      defaultMode: 'default',
      allow: ['Read', 'Bash(make glaze:*)'],
      deny: [],
      ask: ['Bash(git tag:*)'],
    },
    settings: { model: 'sonnet', env: [] },
    registry: { format: 'md' },
    defects: [],
  };
  return { estate, topic };
}

/** The follower's block for one ask of the estate, mapped, with or without a mutant. */
function blockOf(estate: HiddenEstate, ask: string, mutant?: string): Observed {
  const raw = follow(estate, situationsOf(estate), [ask], mutant ? { mutant } : {});
  const observed = mapSession({
    transcript: parseJsonl(raw.transcript),
    decisions: parseJsonl(raw.decisions),
    steps: parseJsonl(raw.steps),
  }).blocks[0]?.observed;
  if (!observed) throw new Error('no block');
  return observed;
}

const askOf = (estate: HiddenEstate, hid: string) => {
  const situation = situationsOf(estate).find(
    (candidate) => candidate.atoms.includes(hid) && candidate.act.type === 'tool',
  );
  if (!situation) throw new Error(`no permission situation lists ${hid}`);
  return situation.phrases[0] as string;
};

async function permissionOutcome(observed: Observed, effect: string, rule: string) {
  const ctx = { blockIndex: 0, observed, history: [] } as unknown as CheckContext;
  const out = await ESTATE_CHECKS.permission?.(ctx, { effect, rule });
  return (Array.isArray(out) ? out : [out]).map((verdict) => verdict?.outcome);
}

describe('the steps and permissions of a hand-written estate, in the rule follower', () => {
  it('reaches a step allowed at any point once, before the closing stage, and drops it in its mutant', () => {
    const { estate, topic } = potteryEstate();
    const stages = (mutant?: string) =>
      blockOf(estate, topic.trigger[0], mutant).runtime?.stages?.map((stage) => stage.name);
    expect(stages()).toEqual(['plan', 'do', 'sweep', 'report']);
    expect(stages('stage:sweep')).toEqual(['plan', 'do', 'report']);
  });

  it('has a call an ask rule covers denied for permission, as a headless run records it', async () => {
    const { estate } = potteryEstate();
    const raw = follow(estate, situationsOf(estate), [askOf(estate, 'tool:ask:Bash(git tag:*)')]);
    expect(raw.transcript).toContain('"subtype":"permission_denied"');
    expect(raw.transcript).not.toContain('permission_request');
    expect(raw.transcript).not.toContain('permission_decision');
    const observed = blockOf(estate, askOf(estate, 'tool:ask:Bash(git tag:*)'));
    const tag = observed.toolCalls.filter((call) =>
      String((call.input as { command?: unknown }).command).startsWith('git tag'),
    );
    expect(tag.map((call) => call.error)).toEqual(['Permission to use Bash has been denied.']);
    expect(await permissionOutcome(observed, 'ask', 'Bash(git tag:*)')).toEqual(['pass']);
  });

  it('keeps the session of an ask rule mutant unchanged unless the rest of the settings let the call run', () => {
    const { estate } = potteryEstate();
    const hid = 'tool:ask:Bash(git tag:*)';
    const session = (target: HiddenEstate, mutant?: string) =>
      follow(target, situationsOf(target), [askOf(target, hid)], mutant ? { mutant } : {});
    // The runtime enforces the ask rule: with it deleted, the headless run still denies the call.
    expect(session(estate, hid)).toEqual(session(estate));
    // An allow rule that covers the call, or the bypass mode, lets it run once the ask rule is gone.
    for (const permissions of [
      { ...estate.permissions, allow: [...estate.permissions.allow, 'Bash(git:*)'] },
      { ...estate.permissions, defaultMode: 'bypassPermissions' },
    ]) {
      const open = { ...estate, permissions };
      expect(session(open, hid)).not.toEqual(session(open));
    }
  });

  it('exercises a declared tool in the unit that declares it first, and none a bare rule names', () => {
    const { estate } = potteryEstate();
    const kiln = estate.skills[0] as HiddenSkill;
    const glaze: HiddenSkill = {
      ...kiln,
      hid: 'skill:glaze-mix',
      topic: {
        ...kiln.topic,
        skill: 'glaze-mix',
        trigger: ['Mix the blue glaze batch.', 'Make a batch of blue glaze.', 'Prepare the blue glaze.'],
        pressure: 'Mix the glaze now, skip the checks.',
        misroute: 'Use the kiln tool to mix the glaze.',
        nearMiss: 'What is a glaze?',
        outside: 'Who sweeps the studio on Fridays?',
      },
    };
    const both: HiddenEstate = { ...estate, skills: [kiln, glaze] };
    const probes = situationsOf(both).flatMap((situation) =>
      situation.act.type === 'tool' && situation.act.effect === 'declared'
        ? [`${situation.atoms[0]} ${situation.act.skill ?? situation.act.helper}`]
        : [],
    );
    // Both skills declare Read, Edit and Bash(python3 *): glaze-mix, first by name, declares Edit and Bash; Read
    // is named bare by an allow rule, so no unit declares it.
    expect(probes).toEqual(['tool:declared:Edit glaze-mix', 'tool:declared:Bash glaze-mix']);
  });
});
