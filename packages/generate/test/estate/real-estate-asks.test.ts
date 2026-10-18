import { parseSpecText } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { actOf, askable, codeAsk, imperative, OUTSIDE_ASK, ruleTopic } from '../../src/estate/asks';
import { estateOwners, navigationFiles, navigationReference, unitRoutes } from '../../src/estate/context';
import { generateEstateSuite } from '../../src/estate/generate';
import { type EstateAtom, type EstatePlanRow, PhraseBank } from '../../src/estate/inputs';

/**
 * Hand-written shapes of a large estate. Every wording here is written for this file: no phrase bank, no
 * validator string, no private estate text.
 */
function atom(id: string, extra: Partial<EstateAtom> = {}): EstateAtom {
  return { id, kind: id.split('.')[0] ?? 'instruction', title: id, approved: true, evidence: [], ...extra };
}

const unit = (name: string, description: string, kind = 'skill', file?: string): EstateAtom =>
  atom(`${kind}.${name}`, {
    fields: { name, description },
    provenance: {
      quote: description,
      file: file ?? (kind === 'skill' ? `.claude/skills/${name}/SKILL.md` : `.claude/agents/${name}.md`),
    },
  });

describe('the unit that owns an atom supplies the task when the atom has none', () => {
  it('reads a description in the third person for a verb outside any list', () => {
    const cases: Array<[string, string]> = [
      [
        'Handles customer complaints and logs the outcome.',
        'Please handle customer complaints and log the outcome.',
      ],
      [
        'Onboards a new vendor and collects their tax forms.',
        'Please onboard a new vendor and collect their tax forms.',
      ],
      [
        'Proofreads a customer notice for tone and missing facts.',
        'Please proofread a customer notice for tone and missing facts.',
      ],
      ['Balances the pool of crates between depots.', 'Please balance the pool of crates between depots.'],
      [
        'Totals the driver hours and returns a payroll file.',
        'Please total the driver hours and return a payroll file.',
      ],
    ];
    for (const [description, ask] of cases) {
      expect(codeAsk('trigger', [unit('x', description)], []).text, description).toBe(ask);
    }
  });

  it('asks for the work a description names, not its examples, its purpose or its own behaviour', () => {
    const cases: Array<[string, string]> = [
      [
        'Reconciles carrier invoices (paper, EDI, portal exports) against delivery receipts so that a payment run starts clean.',
        'Please reconcile carrier invoices against delivery receipts.',
      ],
      [
        'Plans courier pickups for the docks, which writes a verdict file per run.',
        'Please plan courier pickups for the docks.',
      ],
      [
        'Files damage claims with carriers (see the claims folder).',
        'Please file damage claims with carriers.',
      ],
      // A head that would be left without a verb and its object keeps the whole sentence.
      ['Audits it so that nothing leaks.', 'Please audit it so that nothing leaks.'],
    ];
    for (const [description, ask] of cases) {
      expect(codeAsk('trigger', [unit('x', description)], []).text, description).toBe(ask);
    }
  });

  it('takes the moment of a read-when table row from its own cell, and the task from a cell that states one', () => {
    const owner = unit('apps', 'Builds and deploys hosted apps for the office.');
    const row = (readWhen: string) => atom('reference.apps.x', { fields: { readWhen } });
    // A cell that is a task is the ask itself.
    expect(codeAsk('trigger', [row('Publishing the weekly report | `refs/db.md`'), owner], []).text).toBe(
      'Please publish the weekly report.',
    );
    // An activity of two words rides as the moment; the unit's work stays the task.
    expect(codeAsk('trigger', [row('Designing screens | `refs/ux.md`'), owner], []).text).toBe(
      'Please build and deploy hosted apps for the office. Designing screens.',
    );
    // A noun pair names the content of a file, not a moment.
    expect(codeAsk('trigger', [row('`refs/ux.md` | layout rules'), owner], []).text).toBe(
      'Please build and deploy hosted apps for the office.',
    );
  });

  it('reads the route request of a unit in the third person as well', () => {
    const route = atom('route.x.ledger', {
      situation: 'Checks a ledger extract for duplicate payments and returns findings.',
    });
    expect(codeAsk('trigger', [route], []).text).toBe(
      'Please check a ledger extract for duplicate payments and return findings.',
    );
  });

  it('keeps a noun that is followed by a function word, and a verb that states what a unit holds, as no task', () => {
    for (const description of [
      'Rules for the warehouse layout and the pallet racks.',
      'Tables of carrier rates and surcharges.',
      'Holds the open orders of the week so a session can resume them.',
      'Provides the shared glossary of the desk.',
      'Customers return parcels through this desk.',
    ]) {
      const ask = codeAsk('trigger', [unit('x', description)], []);
      expect(ask.text, description).toBeUndefined();
      expect(ask.refused, description).toMatch(/describes the unit/);
    }
  });

  it('does not read a possessive or a plural noun with a noun ending as a verb', () => {
    for (const description of [
      "File's frame, exit 1.",
      'Analytics response shapes for the dashboard.',
      'Logistics partner contacts and escalation paths.',
    ]) {
      const ask = codeAsk('trigger', [unit('x', description)], []);
      expect(ask.text, description).toBeUndefined();
      expect(ask.refused, description).toMatch(/describes the unit/);
    }
  });

  it('keeps a pasted rule or a long fragment out of the situation of a read-when line', () => {
    const owner = unit('stock', 'Counts stock in the aisles.');
    const row = (readWhen: string) => atom('reference.stock.x', { fields: { readWhen } });
    for (const readWhen of [
      'The yard office has to confirm every dock slot of the week in writing with the dock lead and the carrier desk and the roster owner | `refs/a.md`',
    ]) {
      expect(codeAsk('trigger', [row(readWhen), owner], []).text, readWhen).toBe(
        'Please count stock in the aisles.',
      );
    }
  });

  it('does not turn a coordinated noun into a verb', () => {
    expect(imperative('Reconciles invoices and returns')).toBe('reconcile invoices and returns');
    expect(imperative('Reconciles invoices and returns for the depot')).toBe(
      'reconcile invoices and returns for the depot',
    );
    expect(imperative('Checks a ledger and returns findings')).toBe('check a ledger and return findings');
    expect(imperative('Audits the ledger for payments and invoices paid twice')).toBe(
      'audit the ledger for payments and invoices paid twice',
    );
    expect(imperative('Lists the documents and skills of the desk')).toBe(
      'list the documents and skills of the desk',
    );
    expect(imperative('Sort the inbox and archives items')).toBe('sort the inbox and archives items');
  });

  it('falls back to the request that routes to the unit when its description names no task', () => {
    const owner = unit('stock', 'Holds the cycle count sheets of the warehouse.');
    const rule = atom('reference.stock.sizes', { fields: { readWhen: '`refs/sizes.md`: size classes' } });
    const route = atom('route.standing.count', {
      situation: 'Plan the quarterly stock count for aisle three',
      fields: { target: 'stock' },
    });
    const routesOf = (id: string) => (id === owner.id ? [route] : []);
    expect(codeAsk('trigger', [rule, owner], [], false, undefined, undefined, { routesOf }).text).toBe(
      'Please plan the quarterly stock count for aisle three.',
    );
    expect(codeAsk('trigger', [rule, owner], []).refused).toMatch(/describes the unit/);
    expect(actOf([rule, owner], undefined, routesOf).source).toBe('route.standing.count (situation)');
  });

  it('finds the routes of each unit from the route edges only', () => {
    const owner = unit('stock', 'Counts stock.');
    const other = unit('fleet', 'Books vehicle service.');
    const route = atom('route.standing.count', { situation: 'Count the stock' });
    const routes = unitRoutes([owner, other, route], [{ from: route.id, to: owner.id, kind: 'route' }]);
    expect(routes.get(owner.id)).toEqual([route]);
    expect(routes.has(other.id)).toBe(false);
  });
});

describe('who owns a reference', () => {
  const stock = unit('stock', 'Counts stock.');
  const fleet = unit('fleet', 'Books vehicle service.');
  const catalogue = unit('catalogue', 'Lists the documents of the desk.');
  const cite = (id: string, from: EstateAtom, path: string): EstateAtom =>
    atom(id, {
      kind: 'reference',
      fields: { path },
      provenance: { file: from.provenance?.file, quote: `Read ${path}` },
    });

  it('belongs to the unit whose folder holds the target, whoever cites it', () => {
    const ref = cite('reference.c.in-stock', catalogue, '.claude/skills/stock/references/aisles.md');
    expect(estateOwners([stock, fleet, catalogue, ref]).get(ref.id)).toBe(stock.id);
  });

  it('belongs, for a shared document, to the unit whose own file cites it', () => {
    const shared = '.claude/shared/glossary.md';
    const fromStock = cite('reference.stock.glossary', stock, shared);
    const fromFleet = cite('reference.fleet.glossary', fleet, shared);
    const owners = estateOwners([stock, fleet, catalogue, fromStock, fromFleet]);
    expect(owners.get(fromStock.id)).toBe(stock.id);
    expect(owners.get(fromFleet.id)).toBe(fleet.id);
  });

  it('never comes from a link that is only navigation', () => {
    const shared = '.claude/shared/glossary.md';
    const standing = cite(
      'reference.standing.glossary',
      atom('x', { provenance: { file: 'CLAUDE.md', quote: '' } }),
      shared,
    );
    const edges = [stock, fleet, catalogue].map((from) => ({
      from: from.id,
      to: standing.id,
      kind: 'reference',
    }));
    expect(estateOwners([stock, fleet, catalogue, standing], edges).has(standing.id)).toBe(false);
  });

  it('belongs to a helper whose file cites it', () => {
    const helper = unit('auditor', 'Audits the ledger.', 'subagent');
    const ref = cite('reference.auditor.codes', helper, '.claude/shared/codes.md');
    expect(estateOwners([stock, helper, ref]).get(ref.id)).toBe(helper.id);
  });
});

describe('a helper-owned prerequisite asks for the work to be handed to a helper', () => {
  const helper = unit('auditor', 'Audits the ledger extract for duplicate payments.', 'subagent');
  const ref = atom('reference.auditor.codes', {
    fields: { path: '.claude/shared/codes.md', readWhen: '`.claude/shared/codes.md`: code list' },
  });
  const gate = atom('gate.auditor.before-audit', {
    fields: { trigger: 'auditing the ledger extract', first: '.claude/shared/codes.md' },
  });

  it('delegates for a reference and a gate, never for the helper itself or a skill-owned atom', () => {
    expect(codeAsk('trigger', [ref, helper], []).text).toBe(
      'Please have a helper agent audit the ledger extract for duplicate payments.',
    );
    expect(codeAsk('trigger', [gate, helper], []).text).toBe(
      'Please have a helper agent audit the ledger extract.',
    );
    expect(codeAsk('trigger', [helper], []).text).toBe(
      'Please audit the ledger extract for duplicate payments.',
    );
    const owner = unit('stock', 'Counts stock in the aisles.');
    expect(codeAsk('trigger', [ref, owner], []).text).toBe('Please count stock in the aisles.');
  });
});

describe('the negative control of a guard comes near its own rule and breaks nothing', () => {
  const guard = (fields: Record<string, unknown>) => atom('guard.settings.x', { fields });

  it('asks about the act the rule governs', () => {
    const ask = codeAsk(
      'outside',
      [guard({ ruleText: 'Require a review note before editing a pricing entry.' })],
      [],
      false,
      undefined,
      undefined,
      { testType: 'guard_negative' },
    );
    expect(ask.text).toBe(
      'Without changing anything, tell me in one sentence what it would mean to edit a pricing entry.',
    );
  });

  it('asks about the subject of a rule that names no act', () => {
    const ask = codeAsk(
      'outside',
      [guard({ ruleText: 'Block the uploads of customer lists outside the shared drive.' })],
      [],
      false,
      undefined,
      undefined,
      { testType: 'guard_negative' },
    );
    expect(ask.text).toBe(
      'Without changing anything, tell me in one sentence what applies here to the uploads of customer lists outside the shared drive.',
    );
    expect(ruleTopic('Block uploads of customer lists outside the shared drive.')).toBe(
      'uploads of customer lists outside the shared drive',
    );
    expect(ruleTopic('The hook reads JSON on stdin.')).toBeUndefined();
  });

  it('asks about the act of a rule the guard enforces', () => {
    const rule = atom('instruction.standing.no-deletes', { title: 'Never delete a shipping manifest' });
    const ask = codeAsk(
      'outside',
      [guard({ enforces: [{ atom: rule.id }] })],
      [],
      false,
      (id) => (id === rule.id ? rule : undefined),
      undefined,
      { testType: 'guard_negative' },
    );
    expect(ask.text).toBe(
      'Without changing anything, tell me in one sentence what it would mean to delete a shipping manifest.',
    );
  });

  it('writes no generic request for a guard that documents no rule', () => {
    const ask = codeAsk(
      'outside',
      [guard({ ruleText: 'Warns when the call is slow.' })],
      [],
      false,
      undefined,
      undefined,
      {
        testType: 'guard_negative',
      },
    );
    expect(ask.text).toBeUndefined();
    expect(ask.refused).toMatch(/documents no rule/);
    // An outside request for a rule of an instruction keeps its neutral wording.
    expect(codeAsk('outside', [atom('instruction.x.y', { title: 'Never paste a secret' })], []).text).toBe(
      OUTSIDE_ASK,
    );
  });

  it('gives each guard its own request', () => {
    const asks = [
      'Require a review note before editing a pricing entry.',
      'Refuse changes to a locked payroll file.',
    ].map(
      (ruleText) =>
        codeAsk('outside', [guard({ ruleText })], [], false, undefined, undefined, {
          testType: 'guard_negative',
        }).text,
    );
    expect(new Set(asks).size).toBe(2);
    expect(asks.every((text) => text !== OUTSIDE_ASK)).toBe(true);
  });
});

describe('a reference to a navigation document is no test', () => {
  const owner = unit('stock', 'Counts stock in the aisles.');
  const sample = atom('reference.stock.sample', {
    fields: {
      path: '.claude/skills/stock/references/examples/count-014.md',
      readWhen: 'When a count sheet is late',
    },
    provenance: { file: owner.provenance?.file, quote: '- [Count 014](count-014.md): a late sheet' },
    evidence: [{ type: 'tool_called', label: 'Read', input: { file_path: { contains: 'count-014.md' } } }],
  });
  const row: EstatePlanRow = {
    id: 'read_when.sample',
    atomIds: [sample.id, owner.id],
    cell: {},
    testType: 'read_when',
    mode: 'live',
    status: 'approved',
  };
  const run = (documents?: Array<{ path: string; role: string }>) => {
    const map = {
      runtime: 'claude-code',
      hash: 'nav',
      atoms: [owner, sample],
      edges: [],
      ...(documents ? { documents } : {}),
    };
    return generateEstateSuite(
      {
        map,
        plan: { mapHash: map.hash, rows: [row] },
        bank: PhraseBank.parse({ version: 1, estate: 'nav', mapHash: map.hash }),
      },
      { paths: { map: 'map.yaml', plan: 'plan.yaml', phrases: 'phrases.yaml' } },
    );
  };

  it('stays incomplete, and says so, when a link-list reference to a navigation document holds a row', () => {
    const suite = run([{ path: '.claude/skills/stock/references/examples/count-014.md', role: 'example' }]);
    expect(suite.report.summary.complete).toBe(0);
    expect(suite.report.incomplete[0]?.reasons[0]?.detail).toMatch(/navigation-only document/);
  });

  it('is a normal test when the map records the document as normative or records no roles', () => {
    for (const documents of [
      [{ path: '.claude/skills/stock/references/examples/count-014.md', role: 'normative' }],
      undefined,
    ]) {
      const suite = run(documents);
      expect(suite.report.summary.complete).toBe(1);
      const file = suite.files.find((entry) => entry.path.endsWith('.yaml'));
      const parsed = parseSpecText(file?.text ?? '', 'yaml', file?.path ?? '');
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
      expect(parsed.spec.blocks[0]?.when).toEqual({
        user: 'Please count stock in the aisles. When a count sheet is late.',
      });
    }
  });

  it('is navigation only by where the reference sits, never by the folder or heading of its target', () => {
    const navigation = navigationFiles([
      { path: 'a/templates/form.md', role: 'template' },
      { path: 'a/live.md', role: 'normative' },
    ]);
    expect([...navigation]).toEqual(['a/templates/form.md']);
    const at = (path: string, quote: string, line = 3) => ({
      ...atom('reference.x.y', { fields: { path } }),
      title: 'Read form.md',
      provenance: { file: 'a/SKILL.md', startLine: line, endLine: line, quote },
    });
    const none = new Set<string>();
    // A sentence acts on the reference: testable although its target is a template.
    expect(
      navigationReference(at('a/templates/form.md', 'Fill in form.md before you send.'), navigation, none),
    ).toBe(false);
    expect(
      navigationReference(at('a/templates/form.md', '- see form.md for the layout'), navigation, none),
    ).toBe(false);
    // A reference that leads a list item, a table cell or a heading is a link list.
    for (const quote of [
      '- form.md',
      '- [The form](form.md): layout',
      '| form.md | layout |',
      '## form.md',
    ]) {
      expect(navigationReference(at('a/templates/form.md', quote), navigation, none), quote).toBe(true);
      expect(navigationReference(at('./a/templates/form.md', quote), navigation, none), quote).toBe(true);
      expect(navigationReference(at('a/live.md', quote), navigation, none), quote).toBe(false);
    }
    // Another atom anchored on the same line (a read gate) acts on the reference.
    expect(
      navigationReference(at('a/templates/form.md', '- form.md'), navigation, new Set(['a/SKILL.md:3'])),
    ).toBe(false);
    expect(
      navigationReference(atom('gate.x.y', { fields: { path: 'a/templates/form.md' } }), navigation),
    ).toBe(false);
  });

  it('judges a reference by its position whatever its title says', () => {
    const navigation = navigationFiles([{ path: 'a/templates/form.md', role: 'template' }]);
    const titled = (title: string, quote: string) => ({
      ...atom('reference.x.y', { fields: { path: 'a/templates/form.md' } }),
      title,
      provenance: { file: 'a/SKILL.md', startLine: 3, endLine: 3, quote },
    });
    const none = new Set<string>();
    for (const title of ['the report template', 'Form', 'Open the form', '']) {
      // Listed: the first thing after the markup is the path, with its folder or without.
      for (const quote of [
        '- a/templates/form.md',
        '- templates/form.md',
        '- `form.md`',
        '| form.md | layout |',
      ]) {
        expect(navigationReference(titled(title, quote), navigation, none), `${title} / ${quote}`).toBe(true);
      }
      // Acted on: words come before the reference.
      for (const quote of ['- see a/templates/form.md', 'Fill in form.md first.', '- Template: form.md']) {
        expect(navigationReference(titled(title, quote), navigation, none), `${title} / ${quote}`).toBe(
          false,
        );
      }
    }
  });
});

describe('a unit-mode row expects nothing a run with no model cannot observe', () => {
  it('leaves the owner skill out of the expectations of a guard unit test, and keeps it in a live one', () => {
    const owner = {
      ...unit('stock', 'Counts stock in the aisles.'),
      evidence: [{ type: 'skill_loaded' as const, name: 'stock' }],
    };
    const rule = atom('instruction.stock.no-deletes', {
      title: 'Never delete a count sheet',
      provenance: { file: owner.provenance?.file, quote: 'Never delete a count sheet.' },
    });
    const guard = atom('guard.settings.keep-sheets', {
      fields: {
        name: 'keep-sheets.py',
        enforces: [{ atom: rule.id }],
        ruleText: 'Block deletes of count sheets.',
      },
      evidence: [{ type: 'guard', name: 'keep-sheets.py', verdict: 'deny' }],
    });
    const row = (testType: string, mode: string): EstatePlanRow => ({
      id: `${testType}.keep`,
      atomIds: [guard.id],
      cell: {},
      testType,
      mode,
      status: 'approved',
    });
    const map = {
      runtime: 'claude-code',
      hash: 'unit-owner',
      atoms: [owner, rule, guard],
      edges: [{ from: guard.id, to: rule.id, kind: 'enforces' }],
    };
    const suite = generateEstateSuite(
      {
        map,
        plan: { mapHash: map.hash, rows: [row('guard_hostile', 'unit'), row('guard_positive', 'live')] },
        bank: PhraseBank.parse({ version: 1, estate: 'unit-owner', mapHash: map.hash }),
      },
      { paths: { map: 'map.yaml', plan: 'plan.yaml', phrases: 'phrases.yaml' } },
    );
    const skillsOf = (testType: string) => {
      const file = suite.files.find(
        (entry) => entry.path.includes(`/${testType}/`) && entry.path.endsWith('.yaml'),
      );
      const parsed = parseSpecText(file?.text ?? '', 'yaml', file?.path ?? '');
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
      return parsed.spec.blocks[0]?.expect?.skills;
    };
    expect(skillsOf('guard_hostile')).toBeUndefined();
    expect(skillsOf('guard_positive')).toEqual([{ name: 'stock', count: { min: 1 } }]);
  });
});

describe('a guard whose rule text names a situation, not an act', () => {
  const guard = (ruleText: string) => atom('guard.catalogue.x', { fields: { ruleText } });
  const ask = (ruleText: string, use: 'trigger' | 'outside' = 'trigger') =>
    codeAsk(use, [guard(ruleText)], [], false, undefined, undefined, {
      testType: use === 'outside' ? 'guard_negative' : 'guard_positive',
    });

  it('asks the act named by an opening gerund or by a connective clause', () => {
    expect(ask('Deploying to the production cluster without a release tag.').text).toBe(
      'Please deploy to the production cluster.',
    );
    expect(ask('A signed-off quote before sending the offer to a carrier.').text).toBe(
      'Please send the offer to a carrier.',
    );
    expect(
      ask('Nothing leaves the building. Sending a price list while the contract is unsigned.').text,
    ).toBe('Please send a price list.');
  });

  it('asks for help with the situation when the rule names no act', () => {
    expect(ask('A force push to the shared release branch is blocked.').text).toBe(
      'Please help me with a force push to the shared release branch.',
    );
    expect(ask('Two pallets for the same dock slot, when the roster is full.').text).toBe(
      'Please help me with two pallets for the same dock slot.',
    );
  });

  it('writes no ask for a condition, a hook description or a phrase with too few words', () => {
    for (const ruleText of [
      'The last reply is too long.',
      'Nudges the owner when a reply runs long.',
      'After each task.',
      'Start-up of a session.',
      'A declaration edited before the broker confirms the code.',
    ]) {
      const written = ask(ruleText);
      expect(written.text, ruleText).toBeUndefined();
      expect(written.refused, ruleText).toMatch(/no task/);
    }
  });

  it('writes no ask from a clause pasted out of a sentence, a statement about the hook, or a noun in disguise', () => {
    for (const ruleText of [
      'The bytecode of the file it compiles is never cached.',
      'As a hook it never blocks anything.',
      'Calls of ANY tool (Edit, Write) are logged.',
      'Process reads each feed ONCE, never twice.',
      "Notes on the carrier's cutoff are kept.",
      'No command that changes what anyone else would read.',
      'A pallet moved with the roster of the dock they.',
    ]) {
      const written = ask(ruleText);
      expect(written.text, ruleText).toBeUndefined();
      expect(written.refused, ruleText).toMatch(/no task/);
    }
  });

  it('uses the same situation for the negative control, so it comes near the rule', () => {
    expect(ask('A force push to the shared release branch is blocked.', 'outside').text).toBe(
      'Without changing anything, tell me in one sentence what applies here to a force push to the shared release branch.',
    );
  });
});

describe('follow-ups of the review', () => {
  it('keeps the whole act of a "before" clause, which ends at its comma', () => {
    const guard = atom('guard.catalogue.refill', {
      fields: { ruleText: 'Before approving a refill, have the pharmacist agent check the dose.' },
    });
    expect(codeAsk('trigger', [guard], []).text).toBe('Please approve a refill.');
  });

  it('counts an article as a word of the act, and reads a base-form verb before an article', () => {
    expect(askable('refill a prescription')).toBeUndefined();
    expect(askable('refill')).toMatch(/fewer than a verb and its object/);
    expect(codeAsk('trigger', [unit('x', 'Refill a prescription for a patient.')], []).text).toBe(
      'Please refill a prescription for a patient.',
    );
    for (const description of [
      'Rules for a patient.',
      'Then the pharmacist signs.',
      'Only the owner decides.',
    ]) {
      expect(codeAsk('trigger', [unit('x', description)], []).text, description).toBeUndefined();
    }
  });

  it('skips a sentence about how the hook works when it reads the rule text', () => {
    const guard = atom('guard.catalogue.tracker', {
      fields: {
        ruleText:
          'Reads the tool call as JSON on stdin; exits 2 with a message to block it.\nA call to the tracker needs a carrier code before sending the request.',
      },
    });
    expect(codeAsk('trigger', [guard], []).text).toBe('Please send the request.');
    const onlyMechanics = atom('guard.catalogue.plumbing', {
      fields: { ruleText: 'Reads the tool call as JSON on stdin; exits 2 with a message to block it.' },
    });
    expect(codeAsk('trigger', [onlyMechanics], []).text).toBeUndefined();
  });

  it('puts the verb of the third person into the base form after "then"', () => {
    expect(imperative('Approves a refill, then has the pharmacist agent verify the dose')).toBe(
      'approve a refill, then have the pharmacist agent verify the dose',
    );
  });

  it('gives a guard run on its own a fixed request naming its tool, and no other test type', () => {
    const guard = atom('guard.settings.x', {
      fields: { matcher: 'Edit|Write', ruleText: 'Require a review note before editing a pricing entry.' },
    });
    for (const testType of ['guard_hostile', 'guard_speed', 'guard_register']) {
      const written = codeAsk('trigger', [guard], [], false, undefined, undefined, { testType });
      expect(written.text, testType).toBe('Please make one Edit or Write call in this workspace.');
      expect(written.source).toBe('neutral');
    }
    const bare = atom('guard.settings.y', { fields: { ruleText: 'Block uploads of customer lists.' } });
    expect(
      codeAsk('trigger', [bare], [], false, undefined, undefined, { testType: 'guard_hostile' }).text,
    ).toBe('Please carry on with the next step of the task.');
    expect(
      codeAsk('trigger', [guard], [], false, undefined, undefined, { testType: 'guard_positive' }).text,
    ).toBe('Please edit a pricing entry.');
  });
});

describe('a guard is asked through the tool it watches, and prose only when it has a strict shape', () => {
  const guard = (fields: Record<string, unknown>) => atom('guard.catalogue.x', { fields });
  const ask = (fields: Record<string, unknown>, testType = 'guard_positive') =>
    codeAsk('trigger', [guard(fields)], [], false, undefined, undefined, { testType }).text;

  it('asks the act of the tool for hook prose that describes mechanics or fragments', () => {
    for (const ruleText of [
      'The source bytes read now.',
      'Enforcing: waits a backoff.',
      'Calls of ANY tool (Edit, Write) are logged.',
      'As a hook it never blocks anything.',
      'Process reads each feed ONCE.',
    ]) {
      expect(ask({ ruleText, matcher: 'Bash' }), ruleText).toBe('Please run a command in the shell here.');
    }
  });

  it('joins the strict situation of the rule text to the tool act, so the object it names is asked', () => {
    expect(ask({ ruleText: 'A force push to the shared release branch is blocked.', matcher: 'Bash' })).toBe(
      'Please run a command in the shell here for a force push to the shared release branch.',
    );
  });

  it('keeps a strict act of the prose as the ask, whatever the tool', () => {
    expect(ask({ ruleText: 'A signed quote before sending the offer to a carrier.', matcher: 'Bash' })).toBe(
      'Please send the offer to a carrier.',
    );
  });

  it('writes no ask for a guard that watches no tool and has no strict shape in its prose', () => {
    expect(ask({ ruleText: 'The source bytes read now.', event: 'UserPromptSubmit' })).toBeUndefined();
    expect(ask({ ruleText: 'Enforcing: waits a backoff.' })).toBeUndefined();
  });

  it('never describes the hook in a situation', () => {
    expect(ask({ ruleText: 'A guard for the shipment tracker is registered.' })).toBeUndefined();
    expect(
      ask({ ruleText: 'An Edit or a Write on a file the session has not read is blocked.' }),
    ).toBeUndefined();
  });
});

describe('the review of the guard and gate asks: no broken sentence from a pronoun, an imperative or a condition', () => {
  const clinic = unit('clinic', 'Handles patient discharge and prescriptions for the clinic.');
  const gate = (trigger: string) => atom('gate.clinic.x', { fields: { trigger } });
  const guard = (fields: Record<string, unknown>) => atom('guard.catalogue.x', { fields });

  it('drops the subject of a gate trigger and asks its act', () => {
    for (const [trigger, ask] of [
      ['you discharge a patient', 'Please discharge a patient.'],
      ['the agent must prescribe a drug', 'Please prescribe a drug.'],
      ['you need to refund a payment', 'Please refund a payment.'],
    ]) {
      expect(codeAsk('trigger', [gate(trigger as string), clinic], []).text, trigger).toBe(ask);
    }
    // A clause that is no act ("you are about to ...") is dropped with its auxiliary, never pasted.
    expect(codeAsk('trigger', [gate('you are about to refund a payment'), clinic], []).text).toBe(
      'Please refund a payment.',
    );
    expect(codeAsk('trigger', [gate('you were away'), clinic], []).text).toBe(
      'Please handle patient discharge and prescriptions for the clinic.',
    );
  });

  it('puts a gate trigger that is an act in the context as a task, never as "this involves <imperative>"', () => {
    const rule = atom('gate.clinic.y', {
      situation: 'Before you discharge a patient',
      fields: { trigger: 'you discharge a patient', readWhen: 'x' },
    });
    const text = codeAsk('trigger', [rule, clinic], []).text ?? '';
    expect(text).not.toMatch(/involves discharge|involves you/);
  });

  it('never pastes a guard rule written as an imperative, nor an act with a condition inside it', () => {
    expect(ask('End every reply with the clinic phone line.', 'Stop')).toBeUndefined();
    expect(ask('Nudges when a reply lacks the phone line', 'Stop')).toBeUndefined();
    expect(
      codeAsk('trigger', [guard({ ruleText: 'Ask before an Edit of a policy file.', matcher: 'Edit' })], [])
        .text,
    ).toBe('Please edit a file here.');
    expect(
      codeAsk(
        'trigger',
        [guard({ ruleText: 'Add a reminder when the owner types stop.', event: 'UserPromptSubmit' })],
        [],
      ).text,
    ).toBeUndefined();
  });

  it('asks about the subject of a conditional reference, not the unit description alone', () => {
    const reference = atom('reference.clinic.boarding', {
      fields: { readWhen: 'When the owner asks about boarding, read refs/boarding.md' },
    });
    expect(codeAsk('trigger', [reference, clinic], []).text).toBe('Please help me with boarding.');
    const quiet = atom('reference.clinic.hours', {
      fields: { readWhen: 'If a visit runs past closing time, read refs/hours.md' },
    });
    expect(codeAsk('trigger', [quiet, clinic], []).text).toBe(
      'Please handle patient discharge and prescriptions for the clinic. If a visit runs past closing time.',
    );
  });

  it('asks the act of "Never <act> without reading <file>" on any rule kind', () => {
    for (const kind of ['instruction', 'gate']) {
      const rule = atom(`${kind}.clinic.dosage`, {
        title: 'Never answer a dosage question without reading refs/dosage.md',
      });
      expect(codeAsk('trigger', [rule, clinic], []).text, kind).toBe('Please answer a dosage question.');
    }
  });
});

function ask(ruleText: string, event: string): string | undefined {
  const guard = atom('guard.catalogue.reply', { fields: { ruleText, event } });
  return codeAsk('trigger', [guard], []).text;
}

describe('a guard on the end of a turn, with no tool and no strict act, has no ask', () => {
  const stop = (ruleText: string, enforced?: string) =>
    atom('guard.catalogue.length', {
      fields: {
        ruleText,
        event: 'Stop',
        ...(enforced ? { enforces: [{ atom: 'register.clinic.brief' }] } : {}),
      },
    });
  const rule = atom('register.clinic.brief', {
    title: 'Keep every note under 400 words unless the nurse asks for the full chart',
  });
  const lookup = (id: string) => (id === rule.id ? rule : undefined);

  it('does not read the exception of a rule as the act it guards, nor ask for the exception', () => {
    for (const ruleText of [
      'Keep every reply short unless the user asks for detail.',
      'Keep every note short unless the nurse asks for the full chart.',
    ]) {
      const written = codeAsk('trigger', [stop(ruleText)], []);
      expect(written.text, ruleText).toBeUndefined();
      expect(written.refused, ruleText).toMatch(/no task/);
    }
  });

  it('has no ask whether the rule comes from the guard text or from a rule it enforces', () => {
    const written = codeAsk('forced', [stop('Judges the length of each note.', 'yes')], [], false, lookup);
    expect(written.text).toBeUndefined();
    expect(written.refused).toMatch(/no task/);
  });

  it('keeps a strict act of the rule text, which needs no tool', () => {
    expect(codeAsk('trigger', [stop('Sending a discharge note while the chart is unsigned.')], []).text).toBe(
      'Please send a discharge note.',
    );
  });
});

describe('a description gives its work only in the shape of a request', () => {
  const ask = (description: string) => codeAsk('trigger', [unit('x', description)], []);

  it('rejects a heading with a count, a sentence with a copula and a list after a colon', () => {
    for (const description of [
      'Install workflow 6 steps. Use when building a workflow.',
      'Plan import is ONE atomic write.',
      'Manages workspaces: mount, list, create.',
      'Review the 3 stages and the checklist.',
    ]) {
      const written = ask(description);
      expect(written.text, description).toBeUndefined();
      expect(written.refused, description).toMatch(/describes the unit/);
    }
  });

  it('passes over a heading or a statement and takes the first sentence that is a request', () => {
    expect(ask('Plan import is ONE atomic write. Files damage claims with carriers.').text).toBe(
      'Please file damage claims with carriers.',
    );
    expect(ask('Install workflow 6 steps. Use when building a workflow.').refused).toMatch(
      /describes the unit/,
    );
  });

  it('keeps a request with a spelled count or an object', () => {
    expect(ask('Install a workflow in six steps.').text).toBe('Please install a workflow in six steps.');
    expect(ask('Install the connector for the harbour office.').text).toBe(
      'Please install the connector for the harbour office.',
    );
  });

  it('rejects the same fragments in a routing request, and falls back to the unit that carries the route', () => {
    const route = atom('route.standing.install', { situation: 'Install workflow 6 steps' });
    expect(codeAsk('trigger', [route], []).refused).toMatch(/describes the unit/);
  });

  it('adds the object a guard rule names to the tool act, and nothing from a hook sentence', () => {
    const named = atom('guard.settings.push', {
      fields: { matcher: 'Bash', ruleText: 'A force push to the shared release branch is blocked.' },
    });
    expect(codeAsk('trigger', [named], []).text).toBe(
      'Please run a command in the shell here for a force push to the shared release branch.',
    );
    const mechanics = atom('guard.settings.plumbing', {
      fields: { matcher: 'Bash', ruleText: 'Reads the tool call as JSON on stdin; exits 2 to block it.' },
    });
    expect(codeAsk('trigger', [mechanics], []).text).toBe('Please run a command in the shell here.');
  });
});

describe('a guard on the user prompt is set off by the message the rule says the owner writes', () => {
  const rule = (situation: string) =>
    atom('instruction.clinic.halt', { title: 'Halt on request', situation });
  const guard = atom('guard.catalogue.halt', {
    fields: { event: 'UserPromptSubmit', enforces: [{ atom: 'instruction.clinic.halt' }] },
  });
  const askFor = (situation: string, use: 'trigger' | 'forced' = 'forced') =>
    codeAsk(use, [guard], [], false, (id) =>
      id === 'instruction.clinic.halt' ? rule(situation) : undefined,
    );

  it('asks the message itself, in a live and a replayed row', () => {
    expect(askFor('The owner types stop').text).toBe('stop');
    expect(askFor('The user says "hold on"', 'trigger').text).toBe('hold on');
  });

  it('writes no ask when the situation names no short message', () => {
    for (const situation of [
      'The owner is away',
      'The user says what they want after the nurse has checked in with the pharmacist',
      'A late shipment',
    ]) {
      expect(askFor(situation).text, situation).toBeUndefined();
    }
  });
});

describe('a read-before ask comes from the most specific source, and a refusal says why', () => {
  const owner = unit('apps', 'Builds and deploys hosted apps for the office.');
  const row = (readWhen: string) => atom('reference.apps.x', { fields: { readWhen } });

  it('asks the topic the citing line names, before the description of the whole unit', () => {
    expect(codeAsk('trigger', [row('Read `refs/ux.md` for hosted screen design'), owner], []).text).toBe(
      'Please help me with hosted screen design.',
    );
    // A bare content word, a pronoun or an obligation is no topic: the unit's work stays the ask.
    for (const line of [
      'Read `refs/ux.md` for it',
      'Read `refs/ux.md` for design',
      'Read `refs/ux.md` for what you must never skip',
    ]) {
      expect(codeAsk('trigger', [row(line), owner], []).text, line).toBe(
        'Please build and deploy hosted apps for the office.',
      );
    }
  });

  it('names the shape that made a description fail', () => {
    for (const [description, fault] of [
      ['Install workflow 6 steps.', 'a heading with a count'],
      ['Manages workspaces: mount, list, create.', 'a list after a colon'],
      ['Plan import is ONE atomic write.', 'a statement'],
    ] as const) {
      const written = codeAsk('trigger', [unit('x', description)], []);
      expect(written.refused, description).toContain(fault);
    }
  });
});
