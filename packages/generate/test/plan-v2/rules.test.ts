import { describe, expect, it } from 'vitest';
import { storeRules } from '../../src/plan-v2';
import { makeStore } from './helpers';

const variables = (extra: Parameters<typeof makeStore>[0] = []) => [
  { id: 'tide', values: ['ebb', 'flood', 'slack'] },
  { id: 'mist', values: ['clear', 'haze', 'fog'] },
  { id: 'vessel', values: ['ferry', 'trawler'] },
  { id: 'lamp', values: ['steady', 'flashing'] },
  ...extra,
];
const named = (rules: ReturnType<typeof storeRules>) => rules.map((rule) => rule.variables);

describe('the rules of a store', () => {
  it('reads a rule from a value that states where it applies: its variable and those it names', () => {
    const store = makeStore(
      variables().map((variable) =>
        variable.id === 'mist'
          ? {
              ...variable,
              values: [
                'clear',
                'haze',
                {
                  id: 'fog',
                  polarity: 'must' as const,
                  when: { tide: ['ebb'] },
                  unless: { lamp: ['steady'] },
                },
              ],
            }
          : variable,
      ),
    );
    expect(named(storeRules(store))).toEqual([['tide', 'mist', 'lamp']]);
  });

  it('reads a rule from a value that states only a limit: its own variable', () => {
    const store = makeStore(
      variables().map((variable) =>
        variable.id === 'lamp' ? { ...variable, values: ['steady', { id: 'flashing', limit: 3 }] } : variable,
      ),
    );
    expect(named(storeRules(store))).toEqual([['lamp']]);
  });

  it('groups the entries that quote one passage into one rule, by ledger id', () => {
    const store = makeStore(
      variables().map((variable) => {
        if (variable.id === 'tide')
          return {
            ...variable,
            values: [
              { id: 'ebb', quotes: [{ quote: 'Sound the horn at ebb tide.', ledger: 'aaaaaaaaaa' }] },
              'flood',
              'slack',
            ],
          };
        if (variable.id === 'vessel')
          return {
            ...variable,
            values: [
              { id: 'ferry', quotes: [{ quote: 'A ferry gets two blasts.', ledger: 'aaaaaaaaaa' }] },
              'trawler',
            ],
          };
        return variable;
      }),
    );
    expect(named(storeRules(store))).toEqual([['tide', 'vessel']]);
  });

  it('groups quotes of the same text in the same file when they carry no ledger id, and keeps other passages apart', () => {
    const store = makeStore(
      variables().map((variable) => {
        if (variable.id === 'tide')
          return {
            ...variable,
            values: [
              { id: 'ebb', quotes: [{ quote: 'Sound  the horn\nat ebb tide.' }] },
              { id: 'flood', quotes: [{ quote: 'Never sound the horn at flood.' }] },
              'slack',
            ],
          };
        if (variable.id === 'vessel')
          return {
            ...variable,
            values: [{ id: 'ferry', quotes: [{ quote: 'Sound the horn at ebb tide.' }] }, 'trawler'],
          };
        return variable;
      }),
    );
    expect(named(storeRules(store))).toEqual([['tide', 'vessel'], ['tide']]);
  });

  it('reads the variables of a constraint that quotes a passage into that rule', () => {
    const store = makeStore(variables(), [
      { forbid: { tide: 'slack', lamp: 'flashing' }, quotes: [{ quote: 'No flashing at slack water.' }] },
    ]);
    expect(named(storeRules(store))).toEqual([['tide', 'lamp']]);
  });

  it('reads a boundary that quotes a passage into that rule, with the values that quote it', () => {
    const store = makeStore([
      {
        id: 'depth',
        role: 'detail',
        values: ['under_two_m', 'exactly_two_m', 'over_two_m'],
        boundaries: [
          {
            holds: 'under_two_m',
            fails: 'over_two_m',
            edge: 'exactly_two_m',
            quotes: [{ quote: 'Keep the keel two metres clear.', ledger: 'bbbbbbbbbb' }],
          },
        ],
      },
      {
        id: 'vessel',
        values: [
          {
            id: 'ferry',
            quotes: [{ quote: 'Ferries keep the keel two metres clear.', ledger: 'bbbbbbbbbb' }],
          },
          'trawler',
        ],
      },
    ]);
    expect(named(storeRules(store))).toEqual([['depth', 'vessel']]);
  });

  it('merges a rule-valued entry into the passage it cites instead of making a second rule', () => {
    const store = makeStore(
      variables().map((variable) => {
        if (variable.id === 'mist')
          return {
            ...variable,
            values: [
              'clear',
              'haze',
              {
                id: 'fog',
                when: { tide: ['ebb'] },
                quotes: [{ quote: 'In fog at ebb tide, light the lamp.', ledger: 'cccccccccc' }],
              },
            ],
          };
        if (variable.id === 'lamp')
          return {
            ...variable,
            values: [
              { id: 'steady', quotes: [{ quote: 'Light the lamp.', ledger: 'cccccccccc' }] },
              'flashing',
            ],
          };
        return variable;
      }),
    );
    expect(named(storeRules(store))).toEqual([['tide', 'mist', 'lamp']]);
  });

  it('leaves out what a person has not approved, unless asked for', () => {
    const base = variables();
    const store = makeStore(
      base.map((variable) =>
        variable.id === 'mist'
          ? {
              ...variable,
              values: ['clear', 'haze', { id: 'fog', approved: false, when: { tide: ['ebb'] } }],
            }
          : variable,
      ),
    );
    expect(storeRules(store)).toEqual([]);
    expect(named(storeRules(store, { approvedOnly: false }))).toEqual([['tide', 'mist']]);
  });

  it('numbers the rules in the order the store first mentions them and gives each a label', () => {
    const store = makeStore(variables(), [
      {
        forbid: { tide: 'slack', lamp: 'flashing' },
        quotes: [{ quote: 'No flashing at slack water.', path: 'rules.md' }],
      },
    ]);
    const [rule] = storeRules(store);
    expect(rule).toMatchObject({ id: 'rule.1', label: 'rules.md: No flashing at slack water.' });
  });
});
