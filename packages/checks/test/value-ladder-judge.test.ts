import { describe, expect, it } from 'vitest';
import { createToolsCheck } from '../src/checks/tools';
import {
  fieldDescription,
  readFirstVote,
  recordedJudgeModel,
  type SameReferentJudge,
  sideBySideVote,
} from '../src/value-check/judge';
import { DEFAULT_VALUE_POLICY, runLadder } from '../src/value-check/ladder';
import { acme } from './support/acme';
import { context, observed, run, verdict } from './support/context';
import { ACME_LIVE_TOOLS, JUDGE_CALLS, readJson, readJsonl, recordedJudge } from './support/h1';

/**
 * HF7 as a regression test: the read-first judge of rung 3 replays its 3,072 recorded calls (two models, both
 * designs, both orders, three repeats) and reproduces every stored judgment, so the product code is the
 * experiment's code. No call reaches a model.
 */

type Item = {
  id: string;
  field: 'phone' | 'email' | 'address';
  gold: string;
  candidate: string;
  truth: string;
  subtype: string;
};
type Judgment = {
  model: string;
  design: 'sbs' | 'read_first';
  item: string;
  order: 1 | 2;
  repeat: number;
  same: boolean;
  compared?: boolean;
  readings?: [string | null, string | null];
};

/** The field descriptions of the item bank, word for word (research src/hf7_items.py FIELDS). */
const FIELDS: Record<Item['field'], string> = {
  phone:
    "customer.phone of notify_sales: the customer's phone number, stored on a sales lead so a human advisor can call them back. No format is stated.",
  email:
    "customer.email of notify_sales: the customer's email address, stored on a sales lead so a human advisor can write to them. No format is stated.",
  address:
    "address of a sales lead: the customer's street address, stored so a human advisor knows where the service is wanted. No format is stated.",
};

const items = readJson<Item[]>('hf7_items.json');
const judgments = readJsonl<Judgment>('hf7_judgments.jsonl');
const complete = recordedJudgeModel(JUDGE_CALLS);
const judgeOf = (model: string): SameReferentJudge => ({ model, complete });

async function replay(row: Judgment): Promise<Judgment> {
  const item = items.find((entry) => entry.id === row.item) as Item;
  const field = FIELDS[item.field];
  const judge = judgeOf(row.model);
  if (row.design === 'sbs') {
    return {
      ...row,
      same: await sideBySideVote(judge, field, item.gold, item.candidate, row.order, row.repeat),
    };
  }
  const vote = await readFirstVote(judge, field, item.gold, item.candidate, row.order, row.repeat);
  return { ...row, same: vote.same, compared: vote.compared, readings: vote.readings };
}

/** False acceptances on near misses and true acceptances on positives, over one model and design. */
function rates(rows: Judgment[]) {
  const truth = new Map(items.map((item) => [item.id, item.truth]));
  const negatives = rows.filter((row) => truth.get(row.item) === 'different');
  const positives = rows.filter((row) => truth.get(row.item) === 'same');
  return {
    falseAcceptance: `${negatives.filter((row) => row.same).length}/${negatives.length}`,
    trueAcceptance: `${positives.filter((row) => row.same).length}/${positives.length}`,
  };
}

describe('HF7: the read-first judge replays its recorded calls', { timeout: 60_000 }, () => {
  it('reproduces every one of the 3,072 stored judgments, readings included', async () => {
    expect(judgments).toHaveLength(3072);
    const differ: string[] = [];
    for (const row of judgments) {
      const again = await replay(row);
      if (JSON.stringify(again) !== JSON.stringify(row))
        differ.push(`${row.model} ${row.design} ${row.item}`);
    }
    expect(differ).toEqual([]);
  });

  it('gives the HF7 rates: read first accepts 1 of 432 near misses on gpt-6-luna, side by side 7', async () => {
    const of = (model: string, design: Judgment['design']) =>
      rates(judgments.filter((row) => row.model === model && row.design === design));
    expect(of('gpt-6-luna', 'read_first')).toEqual({ falseAcceptance: '1/432', trueAcceptance: '334/336' });
    expect(of('gpt-6-luna', 'sbs')).toEqual({ falseAcceptance: '7/432', trueAcceptance: '336/336' });
    expect(of('gemini-3.6-flash', 'read_first')).toEqual({
      falseAcceptance: '0/432',
      trueAcceptance: '336/336',
    });
  });

  it('never accepts a contentless value: 0 of 432 judgments, 108 per model and design', () => {
    const contentless = new Set(
      items.filter((item) => item.subtype === 'contentless').map((item) => item.id),
    );
    const rows = judgments.filter((row) => contentless.has(row.item));
    expect(rows).toHaveLength(18 * 2 * 3 * 2 * 2);
    expect(rows.filter((row) => row.same)).toHaveLength(0);
  });
});

describe('rung 3 runs only with a configured, calibrated judge', { timeout: 60_000 }, () => {
  const coverage = acme('acme-new-customer-coverage');
  const spec = { ...coverage, metadata: { ...coverage.metadata, tool_schemas: ACME_LIVE_TOOLS } };
  /** B7 of the stored runs: the agent added +1 to the number the user typed, so no source holds its value. */
  const call = {
    label: 'notify_sales',
    input: {
      reason: 'callback',
      customer: { phone: '+1 202 555 0188' },
      summary: 'New customer at 88 Summit Avenue, Acmeville wants fiber.',
    },
  };
  const expectation = {
    tools: [{ label: 'notify_sales', count: 1, input: { customer: { subset: { phone: '+12025550188' } } } }],
  };
  const judged = async (judge?: SameReferentJudge) =>
    verdict(
      await run(
        createToolsCheck(judge === undefined ? {} : { services: { judge } }),
        context(spec, 3, observed('Done.', [call]), {
          expect: expectation,
          stimulus: { user: '202 555 0188' },
        }),
      ),
      'tools.notify_sales.input.customer',
    );

  it('decides a stored value with the recorded gpt-6-luna judge: 6 of 6 votes say the same number', async () => {
    const field = await judged(recordedJudge());
    expect(field.outcome).toBe('pass');
    expect(field.evidence).toContain('customer.phone rung3_same_referent: 6 of 6 votes say');
  });

  it('without a judge the value falls back to the exact compare, with the reason', async () => {
    const field = await judged();
    expect(field.outcome).toBe('fail');
    expect(field.evidence).toContain(
      'customer.phone exact_fallback: no decider configured for notify_sales.customer.phone',
    );
    expect(field.evidence).toContain('rung3_same_referent: no same-referent judge is configured');
  });

  it('refuses a judge with no calibration, and one whose false acceptance is above the policy', async () => {
    const bare = { ...recordedJudge(), calibration: undefined };
    const unmeasured = await judged(bare);
    expect(unmeasured.outcome).toBe('fail');
    expect(unmeasured.evidence).toContain('carries no calibration against labels');
    const lenient = {
      ...recordedJudge(),
      calibration: { falseAcceptance: 0.05, source: 'a lenient judge, 1 near miss in 20 accepted' },
    };
    const field = await judged(lenient);
    expect(field.outcome).toBe('fail');
    expect(field.evidence).toContain("above the policy's 0.02");
  });

  it('reads the field from the tool definition, word for word as the recorded calls', () => {
    expect(fieldDescription('notify_sales', 'customer.phone', ACME_LIVE_TOOLS.notify_sales)).toBe(
      'customer.phone of the tool notify_sales: Hand a lead to a human sales advisor. reason is one of callback, no_coverage, tool_failure, order_failed. customer holds name, email and/or phone (a phone or an email is required). summary is one or two sentences. The tool stores this value as given.',
    );
  });

  it('a judge that cannot answer leaves the value inconclusive, naming the failure', async () => {
    const result = await runLadder(
      { tool: 'notify_sales', field: 'customer.phone', gold: '+12025550188', value: '+1 202 555 0118' },
      DEFAULT_VALUE_POLICY,
      { judge: recordedJudge() },
    );
    expect(result.outcome).toBe('inconclusive');
    expect(result.evidence).toContain('could not answer: no recorded judge call');
  });
});
