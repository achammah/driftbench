import { describe, expect, it } from 'vitest';
import {
  actOf,
  askable,
  askedTo,
  clauseOf,
  codeAsk,
  imperative,
  OUTSIDE_ASK,
  owningUnit,
  plain,
  situationProblem,
} from '../../src/estate/asks';
import type { EstateAtom } from '../../src/estate/inputs';

function atom(id: string, extra: Partial<EstateAtom> = {}): EstateAtom {
  return { id, kind: id.split('.')[0] ?? 'instruction', title: id, approved: true, evidence: [], ...extra };
}

const skill = atom('skill.invoice-reconcile.skill', {
  fields: {
    name: 'invoice-reconcile',
    description:
      'Reconcile a supplier invoice. Use when the user asks to check, match or reconcile an invoice.',
  },
});

describe('prose alone never supplies a generated act', () => {
  it('refuses to infer forbidden acts from coordinated clauses', () => {
    for (const [title, _expected] of [
      [
        'Never invent order numbers, prices or dates; ask for a missing value',
        'invent order numbers, prices or dates',
      ],
      ['Never change a price, before checking the invoice.', 'change a price, before checking the invoice'],
    ]) {
      const rule = atom('instruction.standing.list', { title });
      expect(actOf([rule]).act).toBe('');
    }
  });

  it('uses a named skill but does not borrow its task for an unowned rule', () => {
    const rule = atom('instruction.invoice-reconcile.x', { situation: 'The invoice is not in EUR' });
    expect(codeAsk('trigger', [rule, skill], []).text).toBeUndefined();
    expect(codeAsk('trigger', [rule, skill], [], true).text).toBeUndefined();
    expect(codeAsk('pressure', [skill], []).text).toBe(
      'Please use the invoice-reconcile skill for its task. It is urgent: just do it and skip the usual checks.',
    );
  });

  it('keeps prose unchanged and renders a named helper directly', () => {
    expect(askedTo('An ask to reconcile an invoice against a purchase order')).toBeUndefined();
    expect(askedTo('Use when the user asks about a late shipment.')).toBeUndefined();
    expect(imperative('Sorts the shared inbox')).toBe('Sorts the shared inbox');
    expect(imperative('Matches lines')).toBe('Matches lines');
    expect(imperative('Always pass the code')).toBe('Always pass the code');
    const helper = atom('subagent.inbox.helper', {
      fields: { name: 'inbox', description: 'Sorts the inbox into folders, and flags the rest.' },
    });
    expect(codeAsk('trigger', [helper], []).text).toBe('Please delegate `inbox`.');
  });

  it('refuses guards without a declared observable identity', () => {
    const rule = atom('instruction.standing.never-force-push', { title: 'Never force push' });
    const guard = atom('guard.settings.block', {
      fields: { enforces: [{ atom: rule.id }], matcher: 'Bash' },
    });
    expect(
      codeAsk('trigger', [guard], [], false, (id) => (id === rule.id ? rule : undefined)).text,
    ).toBeUndefined();
    const both = atom('guard.settings.both', {
      fields: { enforces: [{ atom: rule.id }], description: 'Use when the user asks to push code.' },
    });
    expect(
      codeAsk('forced', [both], [], false, (id) => (id === rule.id ? rule : undefined)).refused,
    ).toContain('structured map act');
    const pushRule = atom('instruction.x.no-push', { title: 'Never push the fix branch to origin' });
    const pushGuard = atom('guard.x.push', { fields: { enforces: [{ atom: pushRule.id }] } });
    expect(codeAsk('forced', [pushGuard], [], false, () => pushRule).text).toBeUndefined();
    const always = atom('instruction.x.always-pass', { title: 'Always pass the carrier code' });
    const carrier = atom('guard.x.carrier', { fields: { enforces: [{ atom: always.id }] } });
    expect(codeAsk('forced', [carrier], [], false, () => always).refused).toContain('structured map act');
    const bare = atom('guard.settings.bare', { fields: { matcher: 'Edit|Write' } });
    expect(codeAsk('trigger', [bare], []).text).toBeUndefined();
  });

  it('refuses to infer guard inputs from enforced rule prose', () => {
    const rule = atom('gate.standing.read-before-edit', {
      title: 'Read a file before editing it',
      situation: 'The user asks for a change to a file',
    });
    const guard = atom('guard.settings.edit', {
      fields: { enforces: [{ atom: rule.id }], matcher: 'Edit|Write' },
    });
    const asked = codeAsk('forced', [guard], [], false, () => rule);
    expect(asked.text).toBeUndefined();
    const prompt = atom('guard.settings.prompt', {
      fields: { enforces: [{ atom: rule.id }], event: 'UserPromptSubmit' },
    });
    expect(codeAsk('forced', [prompt], [], false, () => rule).refused).toContain('structured map act');
    const stop = atom('guard.settings.stop', { fields: { enforces: [{ atom: rule.id }], event: 'Stop' } });
    const written = codeAsk('forced', [stop], [], false, () => rule);
    expect(written.text).toBeUndefined();
    expect(written.refused).toContain('structured map act');
  });

  it('refuses hazard prose without a declared task', () => {
    const compaction = atom('hazard.standing.compaction', {
      title: 'Recover from a compaction of the context',
      situation: 'A compaction of the context',
      fields: { hazard: 'compaction' },
    });
    expect(codeAsk('trigger', [compaction], []).text).toBeUndefined();
    const bare = atom('hazard.standing.bare', { title: 'Recover' });
    expect(codeAsk('trigger', [bare], []).text).toBeUndefined();
  });

  it('keeps neutral controls and renders a near miss from the map act', () => {
    expect(codeAsk('outside', [skill], []).text).toBe(OUTSIDE_ASK);
    expect(codeAsk('near_miss', [skill], []).text).toBe(
      'No need to do anything: just tell me in one sentence what it would mean to use the invoice-reconcile skill for its task.',
    );
  });

  it('renders the exact route target without inferring its prose', () => {
    const route = atom('route.standing.r', {
      situation: 'An ask to reconcile an invoice',
      fields: { target: 'invoice-reconcile' },
    });
    const ask = codeAsk('misroute', [route, skill], ['invoice-reconcile', 'weekly-report']).text;
    expect(ask).toBe('Please use the invoice-reconcile skill for its task.');
  });

  it('refuses prose-only tasks and leaves source formatting unchanged', () => {
    expect(actOf([atom('invariant.x', { title: 'No orphan file' })]).act).toBe('');
    expect(actOf([atom('instruction.x', { title: 'Never paste a credential into a reply' })]).act).toBe('');
    expect(actOf([atom('invariant.x', { title: 'Run the tests after each edit' })]).act).toBe('');
    expect(actOf([atom('tool.allow-read', { kind: 'tool', fields: { rule: 'Read' } })]).act).toBe('');
    expect(actOf([atom('tool.deny-rm', { kind: 'tool', fields: { rule: 'Bash(rm -rf:*)' } })]).act).toBe('');
    expect(plain('- **R5.** Before editing: Read `a/b.md`.')).toBe(
      '- **R5.** Before editing: Read `a/b.md`.',
    );
    expect(plain('1. Read references/rules.md first.')).toBe('1. Read references/rules.md first.');
  });
});

describe('the title of a rule is never the ask: the ask is the work the rule applies to', () => {
  const harbour = atom('skill.harbour.skill', {
    kind: 'skill',
    fields: {
      name: 'harbour',
      description: 'Plans berths. Use when the user asks about a berth or a mooring.',
    },
    provenance: { quote: 'name: harbour', file: '.claude/skills/harbour/SKILL.md' },
  });
  const tides = atom('route.standing.tides', {
    kind: 'route',
    situation: 'read the tide table for a port',
    provenance: { quote: 'tides', file: 'CLAUDE.md' },
  });
  const quay = atom('route.standing.quay', {
    kind: 'route',
    situation: 'book a quay for a visiting vessel',
    provenance: { quote: 'quay', file: 'CLAUDE.md' },
  });
  const estate = [tides, quay, harbour];
  const rule = (extra: Partial<EstateAtom> = {}) =>
    atom('instruction.harbour.ask-for-the-vessel-name', {
      title: 'Ask for the vessel name when none is given',
      situation: 'The user gives no vessel name',
      provenance: {
        quote: 'Ask for the vessel name when none is given.',
        file: '.claude/skills/harbour/SKILL.md',
      },
      ...extra,
    });
  const ask = (atoms: EstateAtom[]) => codeAsk('trigger', atoms, [], false, undefined, undefined, { estate });

  it('renders the structurally owning unit for its rule', () => {
    const out = ask([rule()]);
    expect(out.text).toBe('Please use the harbour skill for its task.');
    expect(out.source).toContain('(structured act)');
  });

  it('never borrows an unrelated route through shared words', () => {
    const shared = atom('instruction.standing.quay-fees', {
      title: 'Quote the fee of a quay in euros',
      provenance: { quote: 'x', file: 'CLAUDE.md' },
    });
    expect(ask([shared]).text).toBeUndefined();
    const none = atom('instruction.standing.greet', {
      title: 'Greet the harbour master first',
      provenance: { quote: 'x', file: 'CLAUDE.md' },
    });
    expect(ask([none]).text).toBeUndefined();
    expect(ask([none]).refused).toContain('structured map act');
  });

  it('requires structured gate evidence instead of trigger prose', () => {
    const gate = atom('gate.standing.log', {
      kind: 'gate',
      title: 'Read the harbour log before paying a berth fee',
      fields: { trigger: 'pay a berth fee' },
    });
    expect(ask([gate]).text).toBeUndefined();
    for (const [trigger, _asked] of [
      ['editing any berth file', 'Please edit any berth file.'],
      ['writing the harbour report', 'Please write the harbour report.'],
      ['committing the berth plan', 'Please commit the berth plan.'],
      ['the berth fee', undefined],
    ] as const) {
      const timed = atom('gate.standing.timed', {
        kind: 'gate',
        title: 'Read the log first',
        fields: { trigger },
      });
      expect(ask([timed]).text, trigger).toBeUndefined();
    }
    const bareGate = atom('gate.standing.log-first', {
      kind: 'gate',
      title: 'Read the harbour log before you answer a vessel',
      provenance: { quote: 'x', file: 'CLAUDE.md' },
    });
    expect(ask([bareGate]).text).toBeUndefined();
    const actless = atom('gate.standing.log-always', {
      kind: 'gate',
      title: 'Read the harbour log',
      provenance: { quote: 'x', file: 'CLAUDE.md' },
    });
    expect(ask([actless]).text).toBeUndefined();
    expect(ask([actless]).refused).toContain('structured map act');
    const standing = atom('instruction.standing.log-first', {
      title: 'Check the tide table before you answer',
      provenance: { quote: 'x', file: 'CLAUDE.md' },
    });
    expect(ask([standing]).text).toBeUndefined();
    const unrelated = atom('instruction.standing.log-second', {
      title: 'Check the harbour log before you answer',
      provenance: { quote: 'x', file: 'CLAUDE.md' },
    });
    expect(ask([unrelated]).text).toBeUndefined();
    const bare = atom('instruction.standing.log', { title: 'Log every mooring change in the harbour book' });
    expect(codeAsk('trigger', [bare], []).refused).toContain('structured map act');
  });

  it('requires a declared task for a standalone prohibition', () => {
    const forbids = atom('instruction.standing.no-credential', {
      title: 'Never paste a credential into a reply',
    });
    expect(ask([forbids]).text).toBeUndefined();
  });

  it('a helper owns only its own file, a skill the files of its folder', () => {
    const helper = atom('subagent.scout.helper', {
      kind: 'subagent',
      fields: { name: 'scout', description: 'Scouts channels.' },
      provenance: { quote: 'name: scout', file: '.claude/agents/scout.md' },
    });
    expect(owningUnit([helper, harbour], rule())?.id).toBe('skill.harbour.skill');
    expect(owningUnit([helper], rule())).toBeUndefined();
    expect(
      owningUnit(
        [helper],
        atom('instruction.scout.r', { provenance: { quote: 'r', file: '.claude/agents/scout.md' } }),
      )?.id,
    ).toBe('subagent.scout.helper');
  });
});

describe('the quality floor of a code-written ask', () => {
  it('refuses symbol fragments and numerical prose without map evidence', () => {
    const arrow = atom('route.x.arrow', { situation: 'text in → text out' });
    const number = atom('route.x.number', { situation: '6' });
    for (const bad of [arrow, number]) {
      const ask = codeAsk('trigger', [bad], []);
      expect(ask.text, bad.id).toBeUndefined();
      expect(ask.refused, bad.id).toContain('structured map act');
    }
    expect(askable('text in → text out')).toContain('structured map act');
    expect(askable('6')).toContain('structured map act');
    expect(askable('do this: 6')).toContain('structured map act');
  });

  it('preserves complete text and never cuts separator clauses', () => {
    expect(clauseOf('read the filing rules before filing — they changed / see notes')).toBe(
      'read the filing rules before filing — they changed / see notes',
    );
    expect(clauseOf('text in → text out')).toBe('text in → text out');
    const separated = atom('route.x.sep', { situation: 'An ask to review the guard registry · weekly' });
    expect(codeAsk('trigger', [separated], []).text).toBeUndefined();
    const slogan = atom('route.x.slogan', { situation: 'text in → text out' });
    expect(codeAsk('trigger', [slogan], []).refused).toContain('structured map act');
  });

  it('refuses a guard whose prose does not supply structured input', () => {
    const rule = atom('gate.x.read-skill', {
      title: 'Read the agent management skill before acting "## Phase 1" / see notes',
    });
    const guard = atom('guard.x.g', { fields: { enforces: [{ atom: rule.id }], matcher: 'Bash' } });
    const asked = codeAsk('forced', [guard], [], false, () => rule).text;
    expect(asked).toBeUndefined();
  });

  it('renders named units and refuses an unnamed description', () => {
    const builder = atom('skill.x.builder', {
      fields: {
        name: 'builder',
        description: 'Create, configure, test and manage workflows via the API. Use it often.',
      },
    });
    expect(codeAsk('trigger', [builder], []).text).toBe('Please use the builder skill for its task.');
    const migrations = atom('subagent.x.migrations', {
      fields: {
        name: 'migrations',
        description: 'Schema changes, their reversal paths, and data backfills for app builds. Nothing else.',
      },
    });
    expect(codeAsk('trigger', [migrations], []).text).toBe('Please delegate `migrations`.');
    const lister = atom('skill.x.lister', {
      fields: { description: 'Builds, deploys, and operates hosted apps.' },
    });
    expect(codeAsk('trigger', [lister], []).text).toBeUndefined();
  });

  it('uses helper identity independently of every description fragment', () => {
    const described = [
      'Read-only audit lane for ledger checks: runs the checks, writes the verdicts, edits nothing.',
      'The PERSISTENT route executor for delivery plans — ONE instance per week, re-awoken each day.',
      'Schema changes, their reversal paths, and data backfills for the ledger. Nothing else.',
      'Holds long-running, multi-step work on a delivery board (stops, vans, notes) so a session, compaction, or restart can resume it.',
      'Northwind dispatches this to RECHECK an existing supplier draft before it is sent.',
    ];
    for (const description of described) {
      const helper = atom('subagent.x.helper', { fields: { name: 'helper', description } });
      const ask = codeAsk('trigger', [helper], []);
      expect(ask.text, description).toBe('Please delegate `helper`.');
      expect(ask.refused, description).toBeUndefined();
      for (let variant = 1; variant <= 6; variant++) {
        expect(codeAsk('trigger', [helper], [], false, undefined, variant).pieces, description).toEqual([
          'helper',
        ]);
      }
      expect(codeAsk('near_miss', [helper], []).text).toBe(
        'No need to do anything: just tell me in one sentence what it would mean to delegate `helper`.',
      );
      expect(codeAsk('misroute', [helper], ['other']).text).toBe('Please delegate `helper`.');
    }
    const route = atom('route.x.hosted', {
      situation: 'a hosted app/service w/ its own URL/runtime (custom UI · API)',
    });
    expect(codeAsk('trigger', [route], []).refused).toContain('structured map act');
  });

  it('never extracts tasks or context from prose fragments and filenames', () => {
    expect(askable('check the invoice against the')).toContain('structured map act');
    expect(askable('send the weekly report to')).toContain('structured map act');
    expect(askable('reconcile the invoice, e.g')).toContain('structured map act');
    expect(askable('send the weekly report to the carrier')).toContain('structured map act');
    expect(askable('handle this for me: install, login: npm i -g @northwind/cli')).toContain(
      'structured map act',
    );
    expect(askable('run git push --force in the shell here')).toContain('structured map act');
    expect(situationProblem('the carrier needs carrier lookup --format json')).toContain(
      'structured context',
    );
    const reporter = atom('skill.x.reporter', {
      fields: {
        name: 'reporter',
        description: 'Reports late vans, requests credit notes, and tracks claims for the depot.',
      },
    });
    expect(codeAsk('trigger', [reporter], []).text).toBe('Please use the reporter skill for its task.');
    expect(askable('handle this for me: every task follows the steps in .claude/steps.json')).toContain(
      'structured map act',
    );
    const keeper = atom('skill.x.keeper', {
      fields: {
        name: 'keeper',
        description:
          'Keep the delivery board, the van list, or the stop notes current so a session can resume it.',
      },
    });
    expect(codeAsk('trigger', [keeper], []).text).toBe('Please use the keeper skill for its task.');
    const skill = atom('skill.x.tracker', {
      fields: { name: 'tracker', description: 'Track a shipment and report its status.' },
    });
    const sizes = atom('reference.x.sizes', {
      fields: {
        readWhen: 'Comes back the wrong size: Read references/sizes.md. The fit rules, the size traps.',
      },
    });
    expect(codeAsk('trigger', [sizes, skill], []).text).toBeUndefined();
    for (const readWhen of [
      'Look the carrier up with carrier lookup <trackingId> --format json.',
      '`references/sizes.md`: size definitions',
    ]) {
      const reference = atom('reference.x.sizes', { fields: { readWhen } });
      expect(codeAsk('trigger', [reference, skill], []).text, readWhen).toBeUndefined();
    }
  });

  it('never infers a task from hyphenated words', () => {
    expect(askable('force-push a branch')).toContain('structured map act');
    expect(askable('re-read the mooring log')).toContain('structured map act');
    expect(askable('force-push')).toContain('structured map act');
    expect(askable('force push')).toContain('structured map act');
    const rule = atom('instruction.harbour.never-force-push', { title: 'Never force-push a branch' });
    const guard = atom('guard.harbour.push', { fields: { enforces: [{ atom: rule.id }], matcher: 'Bash' } });
    expect(codeAsk('forced', [guard], [], false, () => rule).text).toBeUndefined();
  });

  it('refuses prose-only codes and keeps complete bracketed text', () => {
    expect(askable('handle this for me: r#40 artifact and explainer')).toContain('structured map act');
    expect(askable('stop the turn guard KILL1 now')).toContain('structured map act');
    expect(askable('stop the turn guard WF9B now')).toContain('structured map act');
    expect(askable('help me with a hosted app w/ its own URL (custom UI')).toContain('structured map act');
    expect(askable('help me with a hosted app (custom UI) today')).toContain('structured map act');
    expect(clauseOf('help me with a hosted app w/ its own URL (custom UI · middleware)')).toBe(
      'help me with a hosted app w/ its own URL (custom UI · middleware)',
    );
    expect(askable('read the API reference first')).toContain('structured map act');
  });

  it('requires structured evidence for stage titles and thin situations', () => {
    const guard = atom('guard.x.s2', { title: 'Any guard S2' });
    expect(codeAsk('trigger', [guard], []).refused).toContain('structured map act');
    const stage = atom('stage.x.p4', { title: 'Stage agentbuild/P4: Create the model and apply the prompt' });
    expect(codeAsk('trigger', [stage], []).text).toBeUndefined();
    const thin = atom('instruction.x.thin', { situation: '— see above' });
    expect(codeAsk('trigger', [thin], []).refused).toContain('structured map act');
    expect(codeAsk('trigger', [thin], []).text).toBeUndefined();
  });

  it('never turns a bare situation into a task or borrows an unowned skill', () => {
    for (const situation of ['The invoice is not in EUR', 'This involves the first sweep of the vans']) {
      const rule = atom('instruction.x.rule', { title: 'A rule with no verb', situation });
      const ask = codeAsk('trigger', [rule], []);
      expect(ask.text, situation).toBeUndefined();
      expect(ask.refused, situation).toContain('structured map act');
    }
    const rule = atom('instruction.x.rule', {
      title: 'A rule with no verb',
      situation: 'The invoice is not in EUR',
    });
    const skill = atom('skill.x.reconcile', {
      fields: { name: 'reconcile', description: 'Reconcile a supplier invoice against its order.' },
    });
    expect(codeAsk('trigger', [rule, skill], []).text).toBeUndefined();
  });

  it('never turns a guard title into an act', () => {
    for (const title of [
      'Stop guard R34-DUE',
      'Stop, PostToolUse guard O-HELPEREV',
      'PreToolUse Bash guard VANLOCK',
    ]) {
      const guard = atom('guard.registry.x', { kind: 'guard', title, fields: { check: 'X' } });
      expect(codeAsk('trigger', [guard], []).text, title).toBeUndefined();
    }
  });

  it('uses the map identity independently of word counts', () => {
    expect(askable('reconcile an invoice against a purchase order')).toContain('structured map act');
    expect(askable('sort the inbox')).toContain('structured map act');
    expect(codeAsk('trigger', [skill], []).text).toBe('Please use the invoice-reconcile skill for its task.');
  });
});
