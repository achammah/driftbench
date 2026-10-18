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

describe('map identities supply acts without interpreting legacy prose', () => {
  it('renders each named skill independently of verb morphology', () => {
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
    for (const [description, _ask] of cases) {
      expect(codeAsk('trigger', [unit('x', description)], []).text, description).toBe(
        'Please use the x skill for its task.',
      );
    }
  });

  it('renders map identity independently of examples and purpose clauses', () => {
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
      ['Audits it so that nothing leaks.', 'Please audit it so that nothing leaks.'],
    ];
    for (const [description, _ask] of cases) {
      expect(codeAsk('trigger', [unit('x', description)], []).text, description).toBe(
        'Please use the x skill for its task.',
      );
    }
  });

  it('requires a reference path instead of reading table-cell prose', () => {
    const owner = unit('apps', 'Builds and deploys hosted apps for the office.');
    const row = (readWhen: string) => atom('reference.apps.x', { fields: { readWhen } });
    expect(
      codeAsk('trigger', [row('Publishing the weekly report | `refs/db.md`'), owner], []).text,
    ).toBeUndefined();
    expect(codeAsk('trigger', [row('Designing screens | `refs/ux.md`'), owner], []).text).toBeUndefined();
    expect(codeAsk('trigger', [row('`refs/ux.md` | layout rules'), owner], []).text).toBeUndefined();
  });

  it('requires a route target instead of inferring it from prose', () => {
    const route = atom('route.x.ledger', {
      situation: 'Checks a ledger extract for duplicate payments and returns findings.',
    });
    expect(codeAsk('trigger', [route], []).text).toBeUndefined();
  });

  it('uses skill identity without interpreting noun or stative descriptions', () => {
    for (const description of [
      'Rules for the warehouse layout and the pallet racks.',
      'Tables of carrier rates and surcharges.',
      'Holds the open orders of the week so a session can resume them.',
      'Provides the shared glossary of the desk.',
      'Customers return parcels through this desk.',
    ]) {
      const ask = codeAsk('trigger', [unit('x', description)], []);
      expect(ask.text, description).toBe('Please use the x skill for its task.');
      expect(ask.refused, description).toBeUndefined();
    }
  });

  it('uses skill identity without interpreting possessives or plural nouns', () => {
    for (const description of [
      "File's frame, exit 1.",
      'Analytics response shapes for the dashboard.',
      'Logistics partner contacts and escalation paths.',
    ]) {
      const ask = codeAsk('trigger', [unit('x', description)], []);
      expect(ask.text, description).toBe('Please use the x skill for its task.');
      expect(ask.refused, description).toBeUndefined();
    }
  });

  it('refuses references with no structured target despite long source prose', () => {
    const owner = unit('stock', 'Counts stock in the aisles.');
    const row = (readWhen: string) => atom('reference.stock.x', { fields: { readWhen } });
    for (const readWhen of [
      'The yard office has to confirm every dock slot of the week in writing with the dock lead and the carrier desk and the roster owner | `refs/a.md`',
    ]) {
      expect(codeAsk('trigger', [row(readWhen), owner], []).text, readWhen).toBeUndefined();
    }
  });

  it('leaves coordinated words unchanged', () => {
    expect(imperative('Reconciles invoices and returns')).toBe('Reconciles invoices and returns');
    expect(imperative('Reconciles invoices and returns for the depot')).toBe(
      'Reconciles invoices and returns for the depot',
    );
    expect(imperative('Checks a ledger and returns findings')).toBe('Checks a ledger and returns findings');
    expect(imperative('Audits the ledger for payments and invoices paid twice')).toBe(
      'Audits the ledger for payments and invoices paid twice',
    );
    expect(imperative('Lists the documents and skills of the desk')).toBe(
      'Lists the documents and skills of the desk',
    );
    expect(imperative('Sort the inbox and archives items')).toBe('Sort the inbox and archives items');
  });

  it('does not replace a missing reference target with a nearby route', () => {
    const owner = unit('stock', 'Holds the cycle count sheets of the warehouse.');
    const rule = atom('reference.stock.sizes', { fields: { readWhen: '`refs/sizes.md`: size classes' } });
    const route = atom('route.standing.count', {
      situation: 'Plan the quarterly stock count for aisle three',
      fields: { target: 'stock' },
    });
    const routesOf = (id: string) => (id === owner.id ? [route] : []);
    expect(
      codeAsk('trigger', [rule, owner], [], false, undefined, undefined, { routesOf }).text,
    ).toBeUndefined();
    expect(codeAsk('trigger', [rule, owner], []).refused).toContain('structured map act');
    expect(actOf([rule, owner], undefined, routesOf).source).toContain('(structured ask)');
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

describe('prerequisites and helpers retain their distinct map act kinds', () => {
  const helper = unit('auditor', 'Audits the ledger extract for duplicate payments.', 'subagent');
  const ref = atom('reference.auditor.codes', {
    fields: { path: '.claude/shared/codes.md', readWhen: '`.claude/shared/codes.md`: code list' },
  });
  const gate = atom('gate.auditor.before-audit', {
    fields: { trigger: 'auditing the ledger extract', first: '.claude/shared/codes.md' },
  });

  it('renders reference targets and helper identities while refusing an unstructured gate', () => {
    expect(codeAsk('trigger', [ref, helper], []).text).toBe('Please read `.claude/shared/codes.md`.');
    expect(codeAsk('trigger', [gate, helper], []).text).toBeUndefined();
    expect(codeAsk('trigger', [helper], []).text).toBe('Please delegate `auditor`.');
    const owner = unit('stock', 'Counts stock in the aisles.');
    expect(codeAsk('trigger', [ref, owner], []).text).toBe('Please read `.claude/shared/codes.md`.');
  });
});

describe('the negative control of a guard comes near its own rule and breaks nothing', () => {
  const guard = (fields: Record<string, unknown>) => atom('guard.settings.x', { fields });

  it('requires a structured negative-control act instead of extracting guard prose', () => {
    const ask = codeAsk(
      'outside',
      [guard({ ruleText: 'Require a review note before editing a pricing entry.' })],
      [],
      false,
      undefined,
      undefined,
      { testType: 'guard_negative' },
    );
    expect(ask.text).toBeUndefined();
  });

  it('refuses to infer a negative control from a rule subject', () => {
    const ask = codeAsk(
      'outside',
      [guard({ ruleText: 'Block the uploads of customer lists outside the shared drive.' })],
      [],
      false,
      undefined,
      undefined,
      { testType: 'guard_negative' },
    );
    expect(ask.text).toBeUndefined();
    expect(ruleTopic('Block uploads of customer lists outside the shared drive.')).toBeUndefined();
    expect(ruleTopic('The hook reads JSON on stdin.')).toBeUndefined();
  });

  it('refuses to infer a negative control from an enforced prohibition', () => {
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
    expect(ask.text).toBeUndefined();
  });

  it('writes no generic request for a guard with missing input evidence', () => {
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
    expect(ask.refused).toContain('structured map act');
    expect(codeAsk('outside', [atom('instruction.x.y', { title: 'Never paste a secret' })], []).text).toBe(
      OUTSIDE_ASK,
    );
  });

  it('reports each missing guard input independently', () => {
    const asks = [
      'Require a review note before editing a pricing entry.',
      'Refuse changes to a locked payroll file.',
    ].map(
      (ruleText) =>
        codeAsk('outside', [guard({ ruleText })], [], false, undefined, undefined, {
          testType: 'guard_negative',
        }).text,
    );
    expect(asks).toEqual([undefined, undefined]);
    expect(asks.every((text) => text !== OUTSIDE_ASK)).toBe(true);
  });
});

describe('a reference to a navigation document is no test', () => {
  const owner = unit('stock', 'Counts stock in the aisles.');
  const sample = atom('reference.stock.sample', {
    fields: {
      path: '.claude/skills/stock/references/examples/count-014.md',
      ask: {
        text: 'count stock in the aisles',
        context: 'When a count sheet is late',
        act: { kind: 'read', target: '.claude/skills/stock/references/examples/count-014.md' },
      },
      readWhen: 'When a count sheet is late',
    },
    provenance: { file: owner.provenance?.file, quote: 'See count-014.md' },
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

  it('stays incomplete, and says so, when an older plan still holds the row', () => {
    const suite = run([{ path: '.claude/skills/stock/references/examples/count-014.md', role: 'example' }]);
    expect(suite.report.summary.complete).toBe(0);
    expect(suite.report.incomplete[0]?.reasons[0]?.detail).toContain('navigation-only document');
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

  it('is told apart by the document the reference targets, and only a non-normative role counts', () => {
    const navigation = navigationFiles([
      { path: 'a/template.md', role: 'template' },
      { path: 'a/live.md', role: 'normative' },
    ]);
    expect([...navigation]).toEqual(['a/template.md']);
    const at = (path: string) => atom('reference.x.y', { fields: { path } });
    expect(navigationReference(at('a/template.md'), navigation)).toBe(true);
    expect(navigationReference(at('./a/template.md'), navigation)).toBe(true);
    expect(navigationReference(at('a/live.md'), navigation)).toBe(false);
    expect(navigationReference(atom('gate.x.y', { fields: { path: 'a/template.md' } }), navigation)).toBe(
      false,
    );
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
        ask: {
          text: 'delete a count sheet',
          act: { kind: 'guard', name: 'keep-sheets.py', verdict: 'deny' },
        },
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

  it('never infers guard input from gerunds or connective clauses', () => {
    expect(ask('Deploying to the production cluster without a release tag.').text).toBeUndefined();
    expect(ask('A signed-off quote before sending the offer to a carrier.').text).toBeUndefined();
    expect(
      ask('Nothing leaves the building. Sending a price list while the contract is unsigned.').text,
    ).toBeUndefined();
  });

  it('never substitutes help with a situation for a declared act', () => {
    expect(ask('A force push to the shared release branch is blocked.').text).toBeUndefined();
    expect(ask('Two pallets for the same dock slot, when the roster is full.').text).toBeUndefined();
  });

  it('writes no ask for a condition or hook description without input evidence', () => {
    for (const ruleText of [
      'The last reply is too long.',
      'Nudges the owner when a reply runs long.',
      'After each task.',
      'Start-up of a session.',
      'A declaration edited before the broker confirms the code.',
    ]) {
      const written = ask(ruleText);
      expect(written.text, ruleText).toBeUndefined();
      expect(written.refused, ruleText).toContain('structured map act');
    }
  });

  it('writes no ask from source fragments or statements about the hook', () => {
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
      expect(written.refused, ruleText).toContain('structured map act');
    }
  });

  it('requires structured evidence for negative controls too', () => {
    expect(ask('A force push to the shared release branch is blocked.', 'outside').text).toBeUndefined();
  });
});

describe('follow-ups of the review', () => {
  it('never cuts an act from a before clause', () => {
    const guard = atom('guard.catalogue.refill', {
      fields: { ruleText: 'Before approving a refill, have the pharmacist agent check the dose.' },
    });
    expect(codeAsk('trigger', [guard], []).text).toBeUndefined();
  });

  it('uses named skill identity independently of article and verb morphology', () => {
    expect(askable('refill a prescription')).toContain('structured map act');
    expect(askable('refill')).toContain('structured map act');
    expect(codeAsk('trigger', [unit('x', 'Refill a prescription for a patient.')], []).text).toBe(
      'Please use the x skill for its task.',
    );
    for (const description of [
      'Rules for a patient.',
      'Then the pharmacist signs.',
      'Only the owner decides.',
    ]) {
      expect(codeAsk('trigger', [unit('x', description)], []).text, description).toBe(
        'Please use the x skill for its task.',
      );
    }
  });

  it('never extracts a task from hook implementation prose', () => {
    const guard = atom('guard.catalogue.tracker', {
      fields: {
        ruleText:
          'Reads the tool call as JSON on stdin; exits 2 with a message to block it.\nA call to the tracker needs a carrier code before sending the request.',
      },
    });
    expect(codeAsk('trigger', [guard], []).text).toBeUndefined();
    const onlyMechanics = atom('guard.catalogue.plumbing', {
      fields: { ruleText: 'Reads the tool call as JSON on stdin; exits 2 with a message to block it.' },
    });
    expect(codeAsk('trigger', [onlyMechanics], []).text).toBeUndefined();
  });

  it('leaves third-person prose unchanged', () => {
    expect(imperative('Approves a refill, then has the pharmacist agent verify the dose')).toBe(
      'Approves a refill, then has the pharmacist agent verify the dose',
    );
  });

  it('uses a fixed neutral message only for tests that execute the guard directly', () => {
    const guard = atom('guard.settings.x', {
      fields: { matcher: 'Edit|Write', ruleText: 'Require a review note before editing a pricing entry.' },
    });
    for (const testType of ['guard_hostile', 'guard_speed', 'guard_register']) {
      const written = codeAsk('trigger', [guard], [], false, undefined, undefined, { testType });
      expect(written.text, testType).toBe('Please carry on with the next step of the task.');
      expect(written.source).toBe('neutral');
    }
    const bare = atom('guard.settings.y', { fields: { ruleText: 'Block uploads of customer lists.' } });
    expect(
      codeAsk('trigger', [bare], [], false, undefined, undefined, { testType: 'guard_hostile' }).text,
    ).toBe('Please carry on with the next step of the task.');
    expect(
      codeAsk('trigger', [guard], [], false, undefined, undefined, { testType: 'guard_positive' }).text,
    ).toBeUndefined();
  });
});

describe('guard identity and input evidence are required independently of prose shape', () => {
  const guard = (fields: Record<string, unknown>) => atom('guard.catalogue.x', { fields });
  const ask = (fields: Record<string, unknown>, testType = 'guard_positive') =>
    codeAsk('trigger', [guard(fields)], [], false, undefined, undefined, { testType }).text;

  it('refuses tool matchers without observable guard identity', () => {
    for (const ruleText of [
      'The source bytes read now.',
      'Enforcing: waits a backoff.',
      'Calls of ANY tool (Edit, Write) are logged.',
      'As a hook it never blocks anything.',
      'Process reads each feed ONCE.',
    ]) {
      expect(ask({ ruleText, matcher: 'Bash' }), ruleText).toBeUndefined();
    }
  });

  it('never joins an inferred rule situation to a tool request', () => {
    expect(
      ask({ ruleText: 'A force push to the shared release branch is blocked.', matcher: 'Bash' }),
    ).toBeUndefined();
  });

  it('never treats strict-looking prose as structured input', () => {
    expect(
      ask({ ruleText: 'A signed quote before sending the offer to a carrier.', matcher: 'Bash' }),
    ).toBeUndefined();
  });

  it('writes no ask for a guard without input evidence', () => {
    expect(ask({ ruleText: 'The source bytes read now.', event: 'UserPromptSubmit' })).toBeUndefined();
    expect(ask({ ruleText: 'Enforcing: waits a backoff.' })).toBeUndefined();
  });

  it('never uses descriptions of the hook as input', () => {
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

  it('never extracts gate actions from subject or auxiliary prose', () => {
    for (const [trigger, _ask] of [
      ['you discharge a patient', 'Please discharge a patient.'],
      ['the agent must prescribe a drug', 'Please prescribe a drug.'],
      ['you need to refund a payment', 'Please refund a payment.'],
    ]) {
      expect(codeAsk('trigger', [gate(trigger as string), clinic], []).text, trigger).toBeUndefined();
    }
    expect(codeAsk('trigger', [gate('you are about to refund a payment'), clinic], []).text).toBeUndefined();
    expect(codeAsk('trigger', [gate('you were away'), clinic], []).text).toBeUndefined();
  });

  it('never generates malformed context from an undeclared gate', () => {
    const rule = atom('gate.clinic.y', {
      situation: 'Before you discharge a patient',
      fields: { trigger: 'you discharge a patient', readWhen: 'x' },
    });
    expect(codeAsk('trigger', [rule, clinic], []).text).toBeUndefined();
  });

  it('never pastes imperative rules or their conditions into requests', () => {
    expect(ask('End every reply with the clinic phone line.', 'Stop')).toBeUndefined();
    expect(ask('Nudges when a reply lacks the phone line', 'Stop')).toBeUndefined();
    expect(
      codeAsk('trigger', [guard({ ruleText: 'Ask before an Edit of a policy file.', matcher: 'Edit' })], [])
        .text,
    ).toBeUndefined();
    expect(
      codeAsk(
        'trigger',
        [guard({ ruleText: 'Add a reminder when the owner types stop.', event: 'UserPromptSubmit' })],
        [],
      ).text,
    ).toBeUndefined();
  });

  it('requires reference targets rather than inferring conditional topics', () => {
    const reference = atom('reference.clinic.boarding', {
      fields: { readWhen: 'When the owner asks about boarding, read refs/boarding.md' },
    });
    expect(codeAsk('trigger', [reference, clinic], []).text).toBeUndefined();
    const quiet = atom('reference.clinic.hours', {
      fields: { readWhen: 'If a visit runs past closing time, read refs/hours.md' },
    });
    expect(codeAsk('trigger', [quiet, clinic], []).text).toBeUndefined();
  });

  it('requires structured actions for every prohibition kind', () => {
    for (const kind of ['instruction', 'gate']) {
      const rule = atom(`${kind}.clinic.dosage`, {
        title: 'Never answer a dosage question without reading refs/dosage.md',
      });
      expect(codeAsk('trigger', [rule, clinic], []).text, kind).toBeUndefined();
    }
  });
});

function ask(ruleText: string, event: string): string | undefined {
  const guard = atom('guard.catalogue.reply', { fields: { ruleText, event } });
  return codeAsk('trigger', [guard], []).text;
}

describe('Stop guards without structured input remain unresolved', () => {
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

  it('never treats a rule exception as the guarded act', () => {
    for (const ruleText of [
      'Keep every reply short unless the user asks for detail.',
      'Keep every note short unless the nurse asks for the full chart.',
    ]) {
      const written = codeAsk('trigger', [stop(ruleText)], []);
      expect(written.text, ruleText).toBeUndefined();
      expect(written.refused, ruleText).toContain('structured map act');
    }
  });

  it('needs input evidence whether a rule is direct or enforced', () => {
    const written = codeAsk('forced', [stop('Judges the length of each note.', 'yes')], [], false, lookup);
    expect(written.text).toBeUndefined();
    expect(written.refused).toContain('structured map act');
  });

  it('never turns strict-looking Stop-rule prose into a request', () => {
    expect(
      codeAsk('trigger', [stop('Sending a discharge note while the chart is unsigned.')], []).text,
    ).toBeUndefined();
  });
});

describe('descriptions never override declared map identities', () => {
  const ask = (description: string) => codeAsk('trigger', [unit('x', description)], []);

  it('uses named skills independently of headings and description lists', () => {
    for (const description of [
      'Install workflow 6 steps. Use when building a workflow.',
      'Plan import is ONE atomic write.',
      'Manages workspaces: mount, list, create.',
      'Review the 3 stages and the checklist.',
    ]) {
      const written = ask(description);
      expect(written.text, description).toBe('Please use the x skill for its task.');
      expect(written.refused, description).toBeUndefined();
    }
  });

  it('never scans later description sentences for a request', () => {
    expect(ask('Plan import is ONE atomic write. Files damage claims with carriers.').text).toBe(
      'Please use the x skill for its task.',
    );
    expect(ask('Install workflow 6 steps. Use when building a workflow.').text).toBe(
      'Please use the x skill for its task.',
    );
  });

  it('uses map identity independently of spelled counts and objects', () => {
    expect(ask('Install a workflow in six steps.').text).toBe('Please use the x skill for its task.');
    expect(ask('Install the connector for the harbour office.').text).toBe(
      'Please use the x skill for its task.',
    );
  });

  it('refuses a route with no target instead of borrowing a unit', () => {
    const route = atom('route.standing.install', { situation: 'Install workflow 6 steps' });
    expect(codeAsk('trigger', [route], []).refused).toContain('structured map act');
  });

  it('never adds inferred objects or implementation prose to an unidentified guard', () => {
    const named = atom('guard.settings.push', {
      fields: { matcher: 'Bash', ruleText: 'A force push to the shared release branch is blocked.' },
    });
    expect(codeAsk('trigger', [named], []).text).toBeUndefined();
    const mechanics = atom('guard.settings.plumbing', {
      fields: { matcher: 'Bash', ruleText: 'Reads the tool call as JSON on stdin; exits 2 to block it.' },
    });
    expect(codeAsk('trigger', [mechanics], []).text).toBeUndefined();
  });
});

describe('prompt guards require declared input messages', () => {
  const rule = (situation: string) =>
    atom('instruction.clinic.halt', { title: 'Halt on request', situation });
  const guard = atom('guard.catalogue.halt', {
    fields: { event: 'UserPromptSubmit', enforces: [{ atom: 'instruction.clinic.halt' }] },
  });
  const askFor = (situation: string, use: 'trigger' | 'forced' = 'forced') =>
    codeAsk(use, [guard], [], false, (id) =>
      id === 'instruction.clinic.halt' ? rule(situation) : undefined,
    );

  it('requires an explicit prompt payload instead of extracting reported speech', () => {
    expect(askFor('The owner types stop').text).toBeUndefined();
    expect(askFor('The user says "hold on"', 'trigger').text).toBeUndefined();
  });

  it('writes no prompt payload when structured input is absent', () => {
    for (const situation of [
      'The owner is away',
      'The user says what they want after the nurse has checked in with the pharmacist',
      'A late shipment',
    ]) {
      expect(askFor(situation).text, situation).toBeUndefined();
    }
  });
});

describe('reference targets and unit identities are structural evidence', () => {
  const owner = unit('apps', 'Builds and deploys hosted apps for the office.');
  const row = (readWhen: string) => atom('reference.apps.x', { fields: { readWhen } });

  it('requires a reference target instead of inferring read-topic prose', () => {
    expect(
      codeAsk('trigger', [row('Read `refs/ux.md` for hosted screen design'), owner], []).text,
    ).toBeUndefined();
    for (const line of [
      'Read `refs/ux.md` for it',
      'Read `refs/ux.md` for design',
      'Read `refs/ux.md` for what you must never skip',
    ]) {
      expect(codeAsk('trigger', [row(line), owner], []).text, line).toBeUndefined();
    }
  });

  it('uses the declared unit identity independently of description shape', () => {
    for (const [description, _fault] of [
      ['Install workflow 6 steps.', 'a heading with a count'],
      ['Manages workspaces: mount, list, create.', 'a list after a colon'],
      ['Plan import is ONE atomic write.', 'a statement'],
    ] as const) {
      const written = codeAsk('trigger', [unit('x', description)], []);
      expect(written.text, description).toBe('Please use the x skill for its task.');
    }
  });
});
