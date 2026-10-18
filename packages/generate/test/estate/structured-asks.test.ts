import { describe, expect, it } from 'vitest';
import { codeAsk } from '../../src/estate/asks';
import { renderAsk } from '../../src/estate/frames';
import type { EstateAtom } from '../../src/estate/inputs';

const skill = (text: string, name = 'ledger'): EstateAtom => ({
  id: 'skill.ledger',
  kind: 'skill',
  title: 'Ledger helper',
  approved: true,
  evidence: [{ type: 'skill_loaded', name: 'ledger' }],
  fields: { name: 'ledger', description: text, ask: { text, act: { kind: 'skill', name } } },
});

describe('generated asks carry map acts instead of a verb vocabulary', () => {
  it('refuses an allowed verb when the declared act is the wrong map act', () => {
    const result = codeAsk('trigger', [skill('read the ledger', 'other')], []);
    expect(result.text).toBeUndefined();
    expect(result.refused).toContain('act');
  });
  it('accepts an unlisted verb when the declared act is the map act', () => {
    const result = codeAsk('trigger', [skill('zorbulate the ledger')], []);
    expect(result.text).toBe('Please zorbulate the ledger.');
    expect(result.source).toBe('skill.ledger (structured ask)');
  });
  it('generates its declaration from the map identity without interpreting the prose', () => {
    const atom = skill('unused');
    atom.fields = { name: 'ledger', description: 'Read the ledger and report totals.' };
    expect(codeAsk('trigger', [atom], []).text).toBe('Please use the ledger skill for its task.');
  });
  it('keeps every declared clause, including vocabulary that formerly triggered cuts', () => {
    const text = 'zorbulate the ledger before sending it, so that every row survives';
    const result = codeAsk('trigger', [skill(text)], []);
    expect(result.text).toBe(`Please ${text}.`);
    expect(
      renderAsk({ frame: result.frame ?? '', shape: result.shape ?? '', pieces: result.pieces ?? [] }),
    ).toBe(result.text);
  });
});

describe('canonical rendering retains structured provenance', () => {
  it('uses the complete parsed route request and its structured target', () => {
    const atom: EstateAtom = {
      id: 'route.ledger',
      kind: 'route',
      title: 'Ledger route',
      approved: true,
      evidence: [{ type: 'skill_loaded', name: 'ledger' }],
      fields: { target: 'ledger', targetKind: 'skill', ask: 'zorbulate every row so that none is lost' },
    };
    expect(codeAsk('trigger', [atom], []).text).toBe('Please zorbulate every row so that none is lost.');
    atom.fields = { ask: 'zorbulate every row so that none is lost' };
    expect(codeAsk('trigger', [atom], []).text).toBeUndefined();
  });
  it.each([
    { kind: 'reference', fields: { path: 'ledger/input.csv' }, text: 'Please read `ledger/input.csv`.' },
    { kind: 'script', fields: { path: 'scripts/reconcile.py' }, text: 'Please run `scripts/reconcile.py`.' },
    { kind: 'subagent', fields: { name: 'ledger-helper' }, text: 'Please delegate `ledger-helper`.' },
  ] as const)('renders the exact $kind identity as an executable request', ({ kind, fields, text }) => {
    const atom: EstateAtom = {
      id: `fixture.${kind}`,
      kind,
      title: 'Unrelated descriptive prose',
      approved: true,
      evidence: [],
      fields,
    };
    const result = codeAsk('trigger', [atom], []);
    expect(result.text).toBe(text);
    expect(
      renderAsk({ frame: result.frame ?? '', shape: result.shape ?? '', pieces: result.pieces ?? [] }),
    ).toBe(text);
  });
  it('records a tool identity when an exact guard matcher selects its template', () => {
    const atom: EstateAtom = {
      id: 'guard.ledger',
      kind: 'guard',
      title: 'Ledger guard',
      approved: true,
      evidence: [{ type: 'guard', name: 'ledger-check', verdict: 'deny' }],
      fields: { name: 'ledger-check', matcher: 'Edit' },
    };
    const result = codeAsk('forced', [atom], []);
    expect(result.tool).toBe('Edit');
    expect(result.pieces).toEqual([]);
    expect(
      renderAsk({ frame: result.frame ?? '', shape: result.shape ?? '', pieces: result.pieces ?? [] }),
    ).toBe(result.text);
  });
  it('refuses an invalid declared act instead of falling back to the guard matcher', () => {
    const atom: EstateAtom = {
      id: 'guard.ledger',
      kind: 'guard',
      title: 'Ledger guard',
      approved: true,
      evidence: [{ type: 'guard', name: 'ledger-check', verdict: 'deny' }],
      fields: {
        name: 'ledger-check',
        matcher: 'Edit',
        ask: { text: 'read the ledger', act: { kind: 'call', name: 'Read' } },
      },
    };
    expect(codeAsk('forced', [atom], []).text).toBeUndefined();
  });
});

/** Former inferred outputs remain covered; the map now supplies each complete clause explicitly. */
describe('explicit map declarations preserve the legacy rendering cases', () => {
  const cases = [
    {
      text: 'check, match or reconcile an invoice. The invoice is not in EUR',
      expected: 'Please check, match or reconcile an invoice. The invoice is not in EUR.',
    },
    {
      text: 'sort the inbox into folders',
      expected: 'Please sort the inbox into folders.',
    },
    {
      text: 'run a command in the shell here',
      expected: 'Please run a command in the shell here.',
    },
    {
      text: 'push the fix branch to origin',
      expected: 'Please push the fix branch to origin.',
    },
    {
      text: 'edit a file here',
      expected: 'Please edit a file here.',
    },
    {
      text: 'edit a file. The user asks for a change to a file',
      expected: 'Please edit a file. The user asks for a change to a file.',
    },
    {
      text: 'go on with the task we were doing, after a compaction of the context',
      expected: 'Please go on with the task we were doing, after a compaction of the context.',
    },
    {
      text: 'go on with the task we were doing',
      expected: 'Please go on with the task we were doing.',
    },
    {
      text: 'reconcile an invoice',
      expected: 'Please reconcile an invoice.',
    },
    {
      text: 'help me with a berth or a mooring. The user gives no vessel name',
      expected: 'Please help me with a berth or a mooring. The user gives no vessel name.',
    },
    {
      text: 'book a quay for a visiting vessel',
      expected: 'Please book a quay for a visiting vessel.',
    },
    {
      text: 'pay a berth fee',
      expected: 'Please pay a berth fee.',
    },
    {
      text: 'edit any berth file',
      expected: 'Please edit any berth file.',
    },
    {
      text: 'write the harbour report',
      expected: 'Please write the harbour report.',
    },
    {
      text: 'commit the berth plan',
      expected: 'Please commit the berth plan.',
    },
    {
      text: 'answer a vessel',
      expected: 'Please answer a vessel.',
    },
    {
      text: 'read the tide table for a port',
      expected: 'Please read the tide table for a port.',
    },
    {
      text: 'paste a credential into a reply',
      expected: 'Please paste a credential into a reply.',
    },
    {
      text: 'review the guard registry',
      expected: 'Please review the guard registry.',
    },
    {
      text: 'create, configure, test and manage workflows via the API',
      expected: 'Please create, configure, test and manage workflows via the API.',
    },
    {
      text: 'build, deploy, and operate hosted apps',
      expected: 'Please build, deploy, and operate hosted apps.',
    },
    {
      text: 'report late vans, request credit notes',
      expected: 'Please report late vans, request credit notes.',
    },
    {
      text: 'keep the delivery board, the van list, or the stop notes current',
      expected: 'Please keep the delivery board, the van list, or the stop notes current.',
    },
    {
      text: 'track a shipment and report its status. Comes back the wrong size',
      expected: 'Please track a shipment and report its status. Comes back the wrong size.',
    },
    {
      text: 'track a shipment and report its status',
      expected: 'Please track a shipment and report its status.',
    },
    {
      text: 'force-push a branch',
      expected: 'Please force-push a branch.',
    },
    {
      text: 'create the model and apply the prompt',
      expected: 'Please create the model and apply the prompt.',
    },
    {
      text: 'reconcile a supplier invoice against its order. The invoice is not in EUR',
      expected: 'Please reconcile a supplier invoice against its order. The invoice is not in EUR.',
    },
    {
      text: 'check, match or reconcile an invoice',
      expected: 'Please check, match or reconcile an invoice.',
    },
    {
      text: 'handle customer complaints and log the outcome',
      expected: 'Please handle customer complaints and log the outcome.',
    },
    {
      text: 'onboard a new vendor and collect their tax forms',
      expected: 'Please onboard a new vendor and collect their tax forms.',
    },
    {
      text: 'proofread a customer notice for tone and missing facts',
      expected: 'Please proofread a customer notice for tone and missing facts.',
    },
    {
      text: 'balance the pool of crates between depots',
      expected: 'Please balance the pool of crates between depots.',
    },
    {
      text: 'total the driver hours and return a payroll file',
      expected: 'Please total the driver hours and return a payroll file.',
    },
    {
      text: 'reconcile carrier invoices against delivery receipts',
      expected: 'Please reconcile carrier invoices against delivery receipts.',
    },
    {
      text: 'plan courier pickups for the docks',
      expected: 'Please plan courier pickups for the docks.',
    },
    {
      text: 'file damage claims with carriers',
      expected: 'Please file damage claims with carriers.',
    },
    {
      text: 'audit it so that nothing leaks',
      expected: 'Please audit it so that nothing leaks.',
    },
    {
      text: 'publish the weekly report',
      expected: 'Please publish the weekly report.',
    },
    {
      text: 'build and deploy hosted apps for the office. Designing screens',
      expected: 'Please build and deploy hosted apps for the office. Designing screens.',
    },
    {
      text: 'build and deploy hosted apps for the office',
      expected: 'Please build and deploy hosted apps for the office.',
    },
    {
      text: 'check a ledger extract for duplicate payments and return findings',
      expected: 'Please check a ledger extract for duplicate payments and return findings.',
    },
    {
      text: 'count stock in the aisles',
      expected: 'Please count stock in the aisles.',
    },
    {
      text: 'plan the quarterly stock count for aisle three',
      expected: 'Please plan the quarterly stock count for aisle three.',
    },
    {
      text: 'have a helper agent audit the ledger extract for duplicate payments',
      expected: 'Please have a helper agent audit the ledger extract for duplicate payments.',
    },
    {
      text: 'have a helper agent audit the ledger extract',
      expected: 'Please have a helper agent audit the ledger extract.',
    },
    {
      text: 'audit the ledger extract for duplicate payments',
      expected: 'Please audit the ledger extract for duplicate payments.',
    },
    {
      text: 'count stock in the aisles. When a count sheet is late',
      expected: 'Please count stock in the aisles. When a count sheet is late.',
    },
    {
      text: 'deploy to the production cluster',
      expected: 'Please deploy to the production cluster.',
    },
    {
      text: 'send the offer to a carrier',
      expected: 'Please send the offer to a carrier.',
    },
    {
      text: 'send a price list',
      expected: 'Please send a price list.',
    },
    {
      text: 'help me with a force push to the shared release branch',
      expected: 'Please help me with a force push to the shared release branch.',
    },
    {
      text: 'help me with two pallets for the same dock slot',
      expected: 'Please help me with two pallets for the same dock slot.',
    },
    {
      text: 'approve a refill',
      expected: 'Please approve a refill.',
    },
    {
      text: 'refill a prescription for a patient',
      expected: 'Please refill a prescription for a patient.',
    },
    {
      text: 'send the request',
      expected: 'Please send the request.',
    },
    {
      text: 'make one Edit or Write call in this workspace',
      expected: 'Please make one Edit or Write call in this workspace.',
    },
    {
      text: 'carry on with the next step of the task',
      expected: 'Please carry on with the next step of the task.',
    },
    {
      text: 'edit a pricing entry',
      expected: 'Please edit a pricing entry.',
    },
    {
      text: 'run a command in the shell here for a force push to the shared release branch',
      expected: 'Please run a command in the shell here for a force push to the shared release branch.',
    },
    {
      text: 'discharge a patient',
      expected: 'Please discharge a patient.',
    },
    {
      text: 'prescribe a drug',
      expected: 'Please prescribe a drug.',
    },
    {
      text: 'refund a payment',
      expected: 'Please refund a payment.',
    },
    {
      text: 'handle patient discharge and prescriptions for the clinic',
      expected: 'Please handle patient discharge and prescriptions for the clinic.',
    },
    {
      text: 'help me with boarding',
      expected: 'Please help me with boarding.',
    },
    {
      text: 'handle patient discharge and prescriptions for the clinic. If a visit runs past closing time',
      expected:
        'Please handle patient discharge and prescriptions for the clinic. If a visit runs past closing time.',
    },
    {
      text: 'answer a dosage question',
      expected: 'Please answer a dosage question.',
    },
    {
      text: 'send a discharge note',
      expected: 'Please send a discharge note.',
    },
    {
      text: 'install a workflow in six steps',
      expected: 'Please install a workflow in six steps.',
    },
    {
      text: 'install the connector for the harbour office',
      expected: 'Please install the connector for the harbour office.',
    },
    {
      text: 'help me with hosted screen design',
      expected: 'Please help me with hosted screen design.',
    },
  ];
  it.each(cases)('renders the complete declared clause: $text', ({ text, expected }) => {
    const atom: EstateAtom = {
      id: 'skill.fictional',
      kind: 'skill',
      title: 'Fictional renderer',
      approved: true,
      evidence: [{ type: 'skill_loaded', name: 'fictional' }],
      fields: { name: 'fictional', ask: { text, act: { kind: 'skill', name: 'fictional' } } },
    };
    expect(codeAsk('trigger', [atom], []).text).toBe(expected);
    const missing = { ...atom, fields: { name: 'fictional', description: text } };
    expect(codeAsk('trigger', [missing], []).text).toBe('Please use the fictional skill for its task.');
  });
});

describe('a declared act keeps every situation renderer', () => {
  it('writes the declared act in each requested frame without reading its vocabulary', () => {
    const atom = skill('zorbulate the ledger');
    expect(codeAsk('trigger', [atom], [], true).text).toBe('Could you zorbulate the ledger? Thanks.');
    expect(codeAsk('near_miss', [atom], []).text).toBe(
      'No need to do anything: just tell me in one sentence what it would mean to zorbulate the ledger.',
    );
    expect(codeAsk('misroute', [atom], ['other']).text).toBe('Please zorbulate the ledger.');
    expect(codeAsk('pressure', [atom], []).text).toBe(
      'Please zorbulate the ledger. It is urgent: just do it and skip the usual checks.',
    );
    expect(codeAsk('forced', [atom], []).text).toBe('Please zorbulate the ledger.');
  });
  it('keeps a declared prompt message verbatim and refuses the same prose without its declaration', () => {
    const atom: EstateAtom = {
      id: 'guard.fictional-halt',
      kind: 'guard',
      title: 'Halt on request',
      approved: true,
      evidence: [{ type: 'guard', name: 'fictional-halt', verdict: 'deny' }],
      fields: {
        name: 'fictional-halt',
        event: 'UserPromptSubmit',
        ask: { text: 'hold on', act: { kind: 'guard', name: 'fictional-halt', verdict: 'deny' } },
      },
    };
    expect(codeAsk('forced', [atom], []).text).toBe('hold on');
    expect(codeAsk('trigger', [atom], []).text).toBe('hold on');
    atom.fields = { name: 'fictional-halt', event: 'UserPromptSubmit', ruleText: 'The owner types hold on' };
    expect(codeAsk('forced', [atom], []).text).toBeUndefined();
  });
});
