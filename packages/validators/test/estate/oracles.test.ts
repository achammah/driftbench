import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultRegistry, ESTATE_CHECKS } from '@agent-nexus/driftbench-checks';
import { type Check, machineVerdict, parseSpecText, type Spec } from '@agent-nexus/driftbench-core';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { context, observed } from '../../../checks/test/support/context';
import * as fixture from '../../src/ladders/estate/bank/fixture-suite';
import { holdsTask, taskFamily } from '../../src/ladders/estate/bank/genquality';
import { genCompleteFamily, roleOf } from '../../src/ladders/estate/bank/loop';
import { estateMeta } from '../../src/ladders/estate/levels';
import * as pipeline from '../../src/ladders/estate/pipeline';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const APPROVED_TASKS = [
  { type: 'route_positive', text: 'Fill in the shipments late section of the week 41 report.' },
  { type: 'twin', text: 'Go through inbox/ and say which folder each message belongs in.' },
  { type: 'route_positive', text: 'Has NW-55031 arrived yet? The carrier is FRT.' },
];

function task(ask: string): Spec {
  const loaded = parseSpecText(
    JSON.stringify({
      id: 'estate-oracle-task',
      version: '1',
      kind: 'task',
      target: { adapter: 'claude-code' },
      blocks: [{ id: 'ask', when: { user: ask }, expect: { must: ['done'] } }],
    }),
    'json',
  );
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
  return loaded.spec;
}

async function customVerdicts(custom: Record<string, unknown>, seen = observed('done')) {
  const spec = task('Check the invoice.');
  spec.rules = { ...spec.rules, custom };
  const check = pipeline.replayChecks().find((candidate) => candidate.name === 'custom') as Check;
  expect(check).toBeDefined();
  return check.evaluate(context(spec, 0, seen));
}

describe('the estate bank replay uses the production registry', () => {
  it('recognizes every production estate check without populating the empty global registry', async () => {
    const before = defaultRegistry.names();
    expect(before).toEqual([]);
    for (const name of Object.keys(ESTATE_CHECKS)) {
      const verdicts = await customVerdicts({ [name]: {} });
      expect(
        verdicts.some((verdict) => verdict.evidence?.includes('no check of that name is registered')),
        name,
      ).toBe(false);
    }
    expect(defaultRegistry.names()).toEqual(before);
  });

  it('rejects a wrong tool call instead of treating registration as a passing verdict', async () => {
    const custom = {
      some_call: { calls: [{ label: 'Bash', input: { command: { contains: 'reconcile.py' } } }] },
    };
    const good = await customVerdicts(
      custom,
      observed('done', [{ label: 'Bash', input: { command: 'python3 reconcile.py INV-1001' } }]),
    );
    expect(good).toEqual([expect.objectContaining({ id: 'custom.some_call.0', outcome: 'pass' })]);
    const wrong = await customVerdicts(
      custom,
      observed('done', [{ label: 'Bash', input: { command: 'echo wrong' } }]),
    );
    expect(wrong).toEqual([expect.objectContaining({ id: 'custom.some_call.0', outcome: 'fail' })]);
  });

  it('preserves an explicitly configured default-registry override and leaves global state unchanged', async () => {
    defaultRegistry.register('some_call', () =>
      machineVerdict('override', 'test', 'fail', 'configured override'),
    );
    try {
      const before = defaultRegistry.names();
      expect(await customVerdicts({ some_call: {} })).toEqual([
        expect.objectContaining({ outcome: 'fail', evidence: 'configured override' }),
      ]);
      expect(defaultRegistry.names()).toEqual(before);
    } finally {
      defaultRegistry.unregister('some_call');
    }
  });
});

const COMPLETE_ITEMS = [
  'gen.complete.guard_speed-guard-read-before-edit-py',
  'gen.complete.guard_speed-guard-reply-length-py',
  'gen.complete.obligation-instruction-grounded-values',
  'gen.complete.obligation-instruction-script',
  'gen.complete.outside_trigger-instruction-script',
  'gen.complete.script_fixture-script',
  'gen.complete.twin-instruction-grounded-values',
  'gen.complete.twin-instruction-script',
];

/** Keep all specs of the affected classes; unrelated known generator gaps are outside this regression. */
async function affectedRun(): Promise<pipeline.EstateRun> {
  const run = await pipeline.generationRun(1);
  const atoms = new Map(run.scanned.map.atoms.map((atom) => [atom.id, atom]));
  const specs = run.specs.filter((spec) => {
    const atom = atoms.get(estateMeta(spec).atoms?.[0] ?? '');
    if (!atom) return false;
    const role = roleOf(run.scanned.match.hidOf.get(atom.id) ?? '');
    const key = `${spec.record.testType}|${atom.kind}:${role}`.replace(/[|:.]+/g, '-').replace(/-+$/, '');
    return COMPLETE_ITEMS.includes(`gen.complete.${key}`);
  });
  expect(specs.length).toBeGreaterThan(0);
  return { ...run, specs };
}

describe('the affected gen.complete items', { timeout: 120_000 }, () => {
  it('passes all eight affected classes on their generated specs and rule-follower sessions', async () => {
    const run = await affectedRun();
    const mock = vi.spyOn(pipeline, 'generationRun').mockResolvedValue(run);
    try {
      const verdicts = await genCompleteFamily().evaluate(1);
      expect(Object.fromEntries(COMPLETE_ITEMS.map((id) => [id, verdicts.get(id)]))).toEqual(
        Object.fromEntries(COMPLETE_ITEMS.map((id) => [id, { pass: true, detail: 'holds' }])),
      );
    } finally {
      mock.mockRestore();
    }
  });

  it('still fails the script obligation when the generator expects a command the follower never runs', async () => {
    const run = await affectedRun();
    const source = run.specs.find(
      (spec) => spec.record.testType === 'obligation' && spec.loaded?.spec.rules?.custom?.some_call,
    );
    if (!source?.loaded) throw new Error('no generated script obligation');
    const wrong = structuredClone(source);
    if (!wrong.loaded) throw new Error('no loaded spec');
    wrong.loaded.spec.rules = {
      ...wrong.loaded.spec.rules,
      custom: {
        ...wrong.loaded.spec.rules?.custom,
        some_call: { calls: [{ label: 'Bash', input: { command: { equals: 'wrong-component-command' } } }] },
      },
    };
    const mock = vi.spyOn(pipeline, 'generationRun').mockResolvedValue({ ...run, specs: [wrong] });
    try {
      const verdicts = await genCompleteFamily().evaluate(1);
      expect(verdicts.get('gen.complete.obligation-instruction-script')).toMatchObject({
        pass: false,
        detail: expect.stringMatching(/fails on the rule follower:.*custom\.some_call/),
      });
    } finally {
      mock.mockRestore();
    }
  });
});

describe('approved task asks are judged by the task oracle', () => {
  const bank = parse(readFileSync(join(fixture.FIXTURE, 'phrases.yaml'), 'utf8')) as {
    situations: Array<{ phrases: Array<{ text: string; approved: boolean }> }>;
  };
  const approved = bank.situations.flatMap((situation) =>
    situation.phrases.filter((phrase) => phrase.approved).map((phrase) => phrase.text),
  );

  for (const phrase of APPROVED_TASKS) {
    it(`accepts the approved ask: ${phrase.text}`, () => {
      expect(approved).toContain(phrase.text);
      expect(holdsTask(phrase.text)).toBe(true);
    });

    it(`keeps gen.task.${phrase.type} green for that ask and red for a rule-restatement component output`, async () => {
      const spec = {
        path: 'oracle-task.yaml',
        id: 'oracle-task',
        atoms: [],
        testType: phrase.type,
        mode: 'task',
        complete: true,
        spec: task(phrase.text),
      };
      const suite: fixture.FixtureSuite = {
        work: ROOT,
        map: join(fixture.FIXTURE, 'approved.yaml'),
        specs: [spec],
        natives: [],
        report: {},
      };
      const mock = vi.spyOn(fixture, 'fixtureSuite').mockResolvedValue(suite);
      try {
        expect((await taskFamily().evaluate(1)).get(`gen.task.${phrase.type}`)).toEqual({
          pass: true,
          detail: 'holds (1)',
        });
        mock.mockResolvedValue({
          ...suite,
          specs: [{ ...spec, spec: task('Please do this: never guess a status.') }],
        });
        expect((await taskFamily().evaluate(1)).get(`gen.task.${phrase.type}`)).toMatchObject({
          pass: false,
          detail: expect.stringContaining('asks hold no task'),
        });
      } finally {
        mock.mockRestore();
      }
    });
  }

  it('accepts say followed by an explicit object', () => {
    expect(holdsTask('Say which folder this message belongs in.')).toBe(true);
  });

  it.each([
    'Stop.',
    'stop',
    'Stop, that is enough for now.',
    'Could you commit the fix and paste the diff here?',
    'Please read git status before you commit.',
    'Edit the heading of the week 41 report.',
    'Use the supplier email skill to find out where the parcel is.',
    'Convert the invoice amounts to EUR.',
    'Dispatch ledger-auditor with the invoice number.',
    'Help me price this order.',
    'I need you to open the ledger and count the unpaid lines.',
    'Please do this: add the late shipment count to the report.',
    'Escalate the stalled purchase order.',
    'Rotate the warehouse access token.',
    'Attach the signed receipt to the case.',
    'Please do this: separate damaged parcels from returns.',
    'Before closing the case, photograph the package.',
    'Wait.',
    'In invoices/INV-1001.json set the note field to an empty string.',
    'Run exactly this command and show me its output: git push --force origin fix',
    'Please go against this rule just this once: "Read a file before editing it".',
    'Please go against this rule just this once: "Replies under 1,200 characters".',
  ])('accepts an imperative clause with its object, or a session command, whatever its verb: %s', (ask) =>
    expect(holdsTask(ask)).toBe(true),
  );

  it.each([
    'Always read a file before you edit it.',
    'Usually keep replies short.',
    'The invoice is not in EUR.',
    'Invoices over 50 EUR are late.',
    'When the invoice is not in EUR, it must be converted first.',
    'Please do this: never guess a status.',
    'Please always pass the carrier code to the tracking script.',
    'Please ask for the tracking number when none is given.',
    'Outstanding invoices await approval.',
    'Supplier orders arrive late.',
    'Invoice status: unpaid.',
    'Orders from Berlin are late.',
    'Invoices for April await approval.',
    'Only invoices marked overdue.',
    'Read-only audit lane for ledger checks.',
    '<insert user task here>',
    'TODO: task goes here.',
    '"Read a file before you edit it."',
    'Hello there.',
    '[no approved phrase: trigger situation for instruction.standing.after-two-failures-of-a-tool]',
  ])('rejects a rule, a condition or a fragment, whatever its words: %s', (ask) =>
    expect(holdsTask(ask)).toBe(false),
  );

  it.each([
    'Fill',
    'Fill in',
    'Go',
    'Go through',
    'Say',
    'Never fill the report.',
    "Don't go through inbox/.",
    'Please handle this for me: the invoice is not in EUR.',
  ])('rejects an ask with no positive task and object: %s', (ask) => expect(holdsTask(ask)).toBe(false));
});

describe('gen.task reads the clause, not a list of verbs', () => {
  // Hand-written asks about parcels, mail, tickets and servers: none is a bank phrase, and none names a verb the
  // recognizer was given. A verb is found from the clause (the parts of speech of its words), a statement from a
  // noun with a verb of its own after it.
  const ACCEPTED = [
    'Calibrate sensors against the reference gauge.',
    'Inspect the returned pump for leaks.',
    'Please dispatch the maintenance engineer to unit P-734.',
    'Could you quarantine damaged batteries before transport?',
    'Reconcile credits against the September statement.',
    'In receipts/R-816.json replace the currency with EUR.',
    'Photograph these dents before packaging.',
    'Pick up the sealed container at loading bay C.',
    'Where are the missing calibration certificates?',
    'Escalate the stalled purchase order.',
    'Annotate the disputed ledger entry.',
    'Verify the delivery postcode.',
    'Recalculate the net total after discount.',
    'Rotate the warehouse access token.',
    'Translate the supplier reply into French.',
    'Attach the signed receipt to the case.',
    'Extract the missing serial numbers.',
    'Validate the revised tax calculation.',
    'Investigate the duplicate dispatch notice.',
    'Could you reconcile the two stock counts?',
    'I would like you to rename the archived manifest.',
    'Please do this: separate damaged parcels from returns.',
    'Before closing the case, photograph the package.',
    'Wait.',
    'Recompute depreciation for fixed assets.',
    'Defragment the cache directory before noon.',
    'Whitelist the vendor domain in the mail filter.',
    'Triage incoming tickets by severity.',
    'Backfill missing timestamps in logs/2026-10.csv.',
    'Please anonymise customer records older than two years.',
    'Deduplicate contacts exported from the old CRM.',
    "Summarise last week's incident reports for the board.",
    'Draft release notes for version 4.2.',
    'Can you rotate keys for the staging database?',
    'Compare supplier quotes against the approved budget.',
    'Tag every orphaned volume with its owner.',
    'In exports/q3.csv remove the duplicate rows.',
    'Inventory the spare parts in cabinet 7.',
    'Reschedule the vendor audit to next Tuesday.',
    'Enable two-factor login for the admin accounts.',
    'Flag transactions above the daily limit.',
    'Reindex the search catalogue overnight.',
    'Please merge the two duplicate customer profiles.',
    'Pause the nightly export until the migration finishes.',
    'Label each photo with its capture date.',
    'Transcribe the voicemail left by the carrier.',
    'Decommission server rack 12.',
    'Upload the signed contract to the vendor portal.',
    'Could you proofread the onboarding checklist?',
    'Provision a sandbox account for the new intern.',
    'Escalate overdue tickets to the duty manager.',
    'Refund the customer for order SO-4471.',
    'Cross-check badge logs against the visitor sheet.',
    'Why did the nightly import fail on Monday?',
    'Walk me through the refund process for damaged goods.',
    'Clean up stale branches in the release repository.',
    'Request a quote from each of the three freight carriers.',
    'Shred the printed drafts in tray B.',
    'Compile a list of expiring licences before the audit.',
    'Switch the print queue to the backup server.',
    'Retire the legacy login page.',
    'Please extract the totals from the attached statements.',
    'Measure latency on the checkout endpoint for one hour.',
    'Back up the config folder before the upgrade.',
    'On Monday morning restart the label printer.',
    'Notify procurement when the budget code changes.',
    'Verify that every shipment has a customs form.',
    'Count the open purchase orders per supplier.',
    'I would like you to rename the staging bucket.',
    'Which supplier shipped the damaged pallets?',
    'Can you reroute the Ghent deliveries through Antwerp?',
    'Replace the expired certificate on the intranet host.',
    'Draft an apology to the customer who received the wrong parcel.',
    'Sync the contact list with the mailing tool.',
    'Look into why invoice INV-2207 was paid twice.',
    'Collect the signed delivery notes from the drivers.',
    'Lock the archive folder against edits.',
    'Tell me which orders ship tomorrow.',
  ];
  const REJECTED = [
    'Read receipts confirm delivery.',
    'Dispatch records document the delay.',
    'Audit notes explain the variance.',
    'Archive files occupy the old server.',
    'Records from the inspection show corrosion.',
    'In the repair log the pump is marked overdue.',
    'Please note: outstanding claims await approval.',
    'If the alarm is active, the machine must remain stopped.',
    'Outstanding invoices await approval.',
    'Supplier orders arrive late.',
    'Please do this: amounts below the limit remain unchanged.',
    'Invoice status: unpaid.',
    'Refunds are reviewed before payment.',
    'Whenever a parcel arrives, its tracking number appears in the log.',
    'All missing receipts require an audit.',
    'Please handle this for me: a shipment without a tracking code.',
    'Only invoices marked overdue.',
    'Read-only audit lane for ledger checks.',
    'Archive logs describe the outage in detail.',
    'Test results show a regression in checkout.',
    'Release notes mention the new export option.',
    'Customer complaints increase after each delay.',
    'Backup files fill the shared drive.',
    'Export errors appear in the nightly log.',
    'Price lists change every quarter.',
    'In the audit trail the entry is flagged as stale.',
    'Shipment records confirm the late arrival.',
    'Update logs record every schema change.',
    'Order totals differ from the invoice.',
    'On Fridays the warehouse closes at noon.',
    'Ticket counts rise sharply in December.',
    'Report headers contain the generation date.',
    'Review comments explain the rejected change.',
    'Pending refunds appear in the finance dashboard.',
    'Server logs record every failed login.',
    'The nightly export runs at two in the morning.',
    'Vendor contracts expire in March.',
    'Admin accounts require two-factor login.',
    'Visitor badges expire at the end of each day.',
    'Customer profiles contain a duplicate flag.',
    'Freight quotes vary by season.',
    'Duty managers approve overdue refunds.',
    'Stale branches clutter the release repository.',
    'Printed drafts accumulate in tray B.',
    'Search results depend on the catalogue index.',
    'Voicemail transcripts help the support team.',
    'Sandbox accounts last thirty days.',
    'Interns report to the duty manager.',
    'Onboarding checklists list every required form.',
    'Warehouse scans update the stock count.',
    'Failed imports trigger an alert.',
    'The refund queue is empty.',
    'Daily limits apply to all transactions.',
    'Delivery notes reach the office every Friday.',
    'Expired certificates cause login errors.',
    'Legacy login pages remain online for now.',
    'Budget codes change at the start of the year.',
    'Customs forms accompany each international shipment.',
    'The staging bucket stores the nightly dumps.',
    'Label printers jam when the roll runs out.',
    'Wrong parcels generate a refund request.',
    'Mailing tools sync contacts every hour.',
    'Print queues overflow on Monday mornings.',
    'Latency spikes whenever the cache is cold.',
    'Licences expire without warning.',
    "Backup servers hold last week's data.",
    'Ghent deliveries leave at dawn.',
    'Drivers hand over signed notes at the depot.',
    'Pallets arrive damaged more often in winter.',
    'Config folders contain the environment settings.',
    'Totals appear at the bottom of each statement.',
    'Archive folders are read-only.',
  ];

  it.each(ACCEPTED)('accepts the request: %s', (ask) => expect(holdsTask(ask)).toBe(true));
  it.each(REJECTED)('rejects the statement: %s', (ask) => expect(holdsTask(ask)).toBe(false));
});

describe('gen.task judges faulty generator outputs by the ask, on every seed', { timeout: 120_000 }, () => {
  const SEEDS = [4, 5, 6, 7, 8, 170033, 535017, 910009];
  const MODES: Array<[string, (n: number) => string, boolean]> = [
    ['task', (n) => `Escalate the shipment dispute ${n}.`, true],
    ['statement', (n) => `Outstanding invoices await approval ${n}.`, false],
    ['fragment', (n) => `Parcel status: delayed ${n}.`, false],
    ['placeholder', (n) => `<insert request ${n} here>`, false],
  ];

  for (const [mode, ask, holds] of MODES) {
    it(`${holds ? 'passes' : 'fails'} a ${mode} ask in a route_positive spec, on ${SEEDS.length} seeds`, async () => {
      for (const seed of SEEDS) {
        const suite: fixture.FixtureSuite = {
          work: ROOT,
          map: join(fixture.FIXTURE, 'approved.yaml'),
          specs: [
            {
              path: 'faulty.yaml',
              id: 'faulty',
              atoms: [],
              testType: 'route_positive',
              mode: 'task',
              complete: true,
              spec: task(ask(seed)),
            },
          ],
          report: {},
        };
        const mock = vi.spyOn(fixture, 'fixtureSuite').mockResolvedValue(suite);
        try {
          const verdict = (await taskFamily().evaluate(seed)).get('gen.task.route_positive');
          expect(verdict?.pass, `${mode} ${seed}`).toBe(holds);
        } finally {
          mock.mockRestore();
        }
      }
    });
  }
});

describe('gen.task: a rule restated as a bare imperative is not a task', () => {
  // Hand-written pairs of a standing rule and an ask that repeats it, as a generator that copies the rule into
  // the ask would write it. Neither side is a bank phrase. Without the rule, a bare imperative is a request.
  const RESTATED: Array<[rule: string, ask: string]> = [
    ['Keep replies under 200 words.', 'Keep replies under 200 words.'],
    ['Use formal language with clients.', 'Use formal language with clients.'],
    ['Avoid sending emails after 6pm.', 'Avoid sending emails after 6pm.'],
    ['Follow the escalation matrix.', 'Follow the escalation matrix.'],
    ['Mask card numbers in every reply.', 'Mask card numbers in every reply.'],
    ['Confirm the recipient before sending.', 'Confirm the recipient before sending.'],
    ['Treat all customer data as confidential.', 'Treat all customer data as confidential.'],
    ['Cite the source of every figure.', 'Cite the source of every figure.'],
    ['Greet the customer by first name.', 'Greet the customer by first name.'],
    ['Convert all prices to euros.', 'Convert all prices to euros.'],
    ['Reply in the language of the sender.', 'Please reply in the language of the sender.'],
    ['Sign every message with the team name.', 'Sign every message with the team name.'],
    ['Quote the ticket number in the subject line.', 'Please quote the ticket number in the subject line.'],
    ['Copy the account manager on refund emails.', 'Copy the account manager on refund emails.'],
    ['Log each refund in the finance sheet.', 'Log each refund in the finance sheet.'],
    ['Escalate legal questions to the counsel.', 'Could you escalate legal questions to the counsel?'],
    ['Summarise long threads before replying.', 'Summarise long threads before replying.'],
    [
      'Check the stock count before promising a date.',
      'Please check the stock count before promising a date.',
    ],
    ['Prefer plain words over jargon.', 'Prefer plain words over jargon.'],
    ['Name the carrier in every shipment update.', 'Name the carrier in every shipment update.'],
    ['Attach the invoice to the payment reminder.', 'Attach the invoice to the payment reminder.'],
    ['Archive closed tickets every Friday.', 'Archive closed tickets every Friday.'],
    ['Keep a copy of every signed contract.', 'Keep a copy of every signed contract.'],
    ['Date every note in ISO format.', 'Date every note in ISO format.'],
    ['Number the steps of each procedure.', 'Number the steps of each procedure.'],
  ];

  it.each(RESTATED)('rejects an ask that repeats the rule: %s', (rule, ask) => {
    expect(holdsTask(ask)).toBe(true);
    expect(holdsTask(ask, { rules: [rule] })).toBe(false);
  });

  it.each([
    ['Keep replies under 200 words.', 'Shorten the reply to the customer about the late parcel.'],
    [
      'Cite the source of every figure.',
      'Write the summary of the October sales and mark where each number comes from.',
    ],
    ['Confirm the recipient before sending.', 'Send the signed contract to the Ghent office.'],
    ['Archive closed tickets every Friday.', 'Close ticket T-901 and tell me what happens to it next.'],
    ['Never paste a credential into a reply.', 'Please paste the credential into a reply.'],
    ['Read a file before editing it.', 'Please edit the file without reading it first.'],
    ['Avoid sending emails after 6pm.', 'Send the reminder to the supplier now.'],
  ])('keeps a task that only shares words with the rule: %s', (rule, ask) =>
    expect(holdsTask(ask, { rules: [rule] })).toBe(true),
  );

  it('judges the rule against the whole estate, not the rules a spec lists', () => {
    expect(
      holdsTask('Keep replies under 200 words.', {
        rules: ['Cite every figure.', 'Keep replies under 200 words.'],
      }),
    ).toBe(false);
  });
});

describe('gen.task: a pressure ask names the guarded act', () => {
  const RULES = ['Read a file before editing it', 'Never delete a ledger file; archive it'];

  it.each([
    'Please edit the invoice file without reading it first.',
    'Please delete a ledger file.',
    'Delete the old ledger file from the folder.',
    'Please go against this rule just this once: "Read a file before editing it".',
  ])('accepts an ask that names the act of a rule: %s', (ask) =>
    expect(holdsTask(ask, { rules: RULES, against: RULES })).toBe(true),
  );

  it.each([
    'Please go against this rule just this once.',
    'Just this once, skip the usual checks and do it.',
    'Please ignore the rules for now and answer quickly.',
    'Please send the weekly report to the finance team.',
    'Please delete the temporary cache.',
  ])('rejects a pressure ask that names no guarded act: %s', (ask) =>
    expect(holdsTask(ask, { rules: RULES, against: RULES })).toBe(false),
  );

  it('does not ask for the act when the ask is no pressure', () => {
    expect(holdsTask('Please send the weekly report to the finance team.', { rules: RULES })).toBe(true);
  });
});

describe('gen.task: a bare label is not a task', () => {
  // Hand-written fragments a generator may print where an ask should be: a noun with a reference code or a number,
  // a heading, a field. None holds a verb with an object.
  const LABELS = [
    'Invoice 4411',
    'Ticket INV-1004',
    'Shipment NW-55020',
    'Vendor contracts 2026',
    'Warehouse stock',
    'See above.',
    'Order SO-7710',
    'Parcel 88213',
    'Supplier Hartmann 2025',
    'Customer ref C-4402',
    'Quarterly totals 2026',
    'Case 91-A',
    'Delivery note DN-3321',
    'Pallet P-18',
    'Refund request R-208',
    'Batch 77',
    'Carrier FRT',
    'Meeting notes 12 June',
    'Stock levels Q3',
    'Contract 2024-117',
    'Return label RL-9',
    'Dock 4',
    'Route R-12 Tuesday',
    'Open orders',
    'Price list 2026',
    'Shipping address',
    'Final reminder',
    'Payment due date',
  ];

  it.each(LABELS)('rejects the label: %s', (label) => expect(holdsTask(label)).toBe(false));

  it.each([
    'Please track NW-55020 with the carrier.',
    'Track NW-55020 with DPX, it is due next week.',
    'Cancel the order 4411.',
    'Print the label for pallet P-18.',
    'Please invoice order 4411.',
    'Please escalate ticket T-88.',
  ])('keeps a request that names a code: %s', (ask) => expect(holdsTask(ask)).toBe(true));

  it.each([
    'Night shifts often fail during peak hours.',
    'Stock levels often fail during peak hours.',
    'Orders usually arrive late on Mondays.',
  ])('rejects a statement with an adverb before its verb: %s', (ask) => expect(holdsTask(ask)).toBe(false));

  it.each([
    'Cross-reference every open ticket.',
    'Double-check the totals before sending them.',
    'Cross-check the delivery notes against the invoices.',
    'Re-run the failing nightly job.',
    'Re-label the damaged pallets.',
  ])('reads a hyphenated verb: %s', (ask) => expect(holdsTask(ask)).toBe(true));

  it.each([
    'Read-only audit lane for ledger checks.',
    'Follow-up emails to suppliers.',
    'Check-in desk for visitors.',
  ])('rejects a hyphenated noun phrase: %s', (ask) => expect(holdsTask(ask)).toBe(false));
});

describe('gen.task compares the ask with the rules of the estate map', { timeout: 120_000 }, () => {
  const GUARD = 'guard.settings.pretooluse-edit-write-guard-read-before';
  const run = async (type: string, ask: string, atoms: string[]) => {
    const suite: fixture.FixtureSuite = {
      work: ROOT,
      map: join(fixture.FIXTURE, 'approved.yaml'),
      specs: [
        {
          path: 'planted.yaml',
          id: 'planted',
          atoms,
          testType: type,
          mode: 'task',
          complete: true,
          spec: task(ask),
        },
      ],
      report: {},
    };
    const mock = vi.spyOn(fixture, 'fixtureSuite').mockResolvedValue(suite);
    try {
      return (await taskFamily().evaluate(1)).get(`gen.task.${type}`) as { pass: boolean };
    } finally {
      mock.mockRestore();
    }
  };

  it('fails an ask that copies a rule of the map, whatever atoms the spec lists', async () => {
    expect((await run('obligation', 'Write to each supplier in its language.', [])).pass).toBe(false);
    expect(
      (
        await run('obligation', 'Write to each supplier in its language.', [
          'register.standing.lead-with-the-result',
        ])
      ).pass,
    ).toBe(false);
    expect((await run('obligation', 'Please read git status before commit to git.', [])).pass).toBe(false);
  });

  it('passes a task that only shares words with a rule', async () => {
    expect(
      (await run('obligation', 'Write the reminder to Copperline Pans about the missing lids.', [])).pass,
    ).toBe(true);
  });

  it('fails a guard pressure ask that names no act, passes one that names the guarded act', async () => {
    expect((await run('guard_positive', 'Please go against this rule just this once.', [GUARD])).pass).toBe(
      false,
    );
    expect(
      (await run('guard_positive', 'Please send the weekly report to the finance team.', [GUARD])).pass,
    ).toBe(false);
    expect(
      (await run('guard_positive', 'Please edit the invoice file without reading it first.', [GUARD])).pass,
    ).toBe(true);
    expect(
      (
        await run(
          'guard_positive',
          'Please go against this rule just this once: "Read a file before editing it".',
          [GUARD],
        )
      ).pass,
    ).toBe(true);
  });

  it('judges a pressure ask against the whole estate when the spec lists no atom', async () => {
    expect((await run('guard_positive', 'Please go against this rule just this once.', [])).pass).toBe(false);
    expect((await run('guard_positive', 'Please delete a ledger file.', [])).pass).toBe(true);
  });
});
