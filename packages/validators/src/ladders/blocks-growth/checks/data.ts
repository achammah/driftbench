import { between, rngFor } from '../../blocks/harness';
import { need } from '../../blocks/product';
import {
  type BankItem,
  type Call,
  exec,
  expectNone,
  expectPass,
  expectV,
  type ItemContext,
  idsAt,
  type Probe,
  type Row,
  type Tier,
  tok,
  variants,
  verdict,
  withDefaults,
} from './kit';
import { brokenIban, dottedNational, grouped4, iban, nationalNumber } from './oracle';

/**
 * gr-data: personal data, cards, custom checks and the assertion forms of docs/reference/checks.md ("Personal
 * data", "Cards", "Custom checks", "Assertions on values"). The personal data is built by the rule of the page
 * (an IBAN whose checksum holds, a register number whose check holds, a phone in the forms the page names) from
 * seeded digits: no real person, account or number.
 */

const FAMILY = 'gr-data';
const CHECKS = 'packages/checks';
const P = 'gr.checks.data';

const digits = (ctx: ItemContext, tag: string, n: number): string => {
  const rng = rngFor(ctx.seed, tag);
  return Array.from({ length: n }, () => between(rng, 0, 9)).join('');
};

/** A reply that holds `text`, expected to be flagged or not by the pii verdict `id`. */
async function piiCases(
  ctx: ItemContext,
  tag: string,
  id: string,
  cases: [string, 'pass' | 'fail'][],
  options?: Record<string, unknown>,
): Promise<(string | undefined)[]> {
  const rec = await exec(
    ctx,
    tag,
    cases.map(([text]) => ({ text })),
    options ? { checks: withDefaults(options) } : {},
  );
  return cases.map(([text, want], i) => {
    const found = expectV(rec, i, id, want, true);
    return found && `reply "${text.slice(0, 60)}": ${found}`;
  });
}

function ibanItems(): BankItem[] {
  const de = (ctx: ItemContext, tag: string, slot = 'de') => iban('DE', digits(ctx, `${tag}:${slot}`, 18));
  const nl = (ctx: ItemContext, tag: string) => iban('NL', `TEST${digits(ctx, `${tag}:nl`, 10)}`);
  return variants(FAMILY, `${P}.iban`, CHECKS, 'pii-iban-checksum', [
    [
      'a-valid-checksum-is-found',
      3,
      'an IBAN whose checksum holds is a finding; the same IBAN with a broken checksum is not',
      async (ctx) => {
        const tag = `${P}.iban.valid`;
        const valid = de(ctx, tag);
        return piiCases(ctx, tag, 'pii.iban', [
          [`Please pay to ${valid} today.`, 'fail'],
          [`Please pay to ${brokenIban(valid)} today.`, 'pass'],
          ['Please pay today.', 'pass'],
        ]);
      },
    ],
    [
      'written-in-groups',
      3,
      'an IBAN written in groups of four is found as the same IBAN',
      async (ctx) => {
        const tag = `${P}.iban.groups`;
        const valid = de(ctx, tag);
        return piiCases(ctx, tag, 'pii.iban', [
          [`Account: ${grouped4(valid)}.`, 'fail'],
          [`Account: ${grouped4(brokenIban(valid))}.`, 'pass'],
        ]);
      },
    ],
    [
      'another-country',
      4,
      'the checksum is the IBAN checksum, whatever the country: a valid Dutch IBAN is found, a broken one is not',
      async (ctx) => {
        const tag = `${P}.iban.country`;
        const valid = nl(ctx, tag);
        return piiCases(ctx, tag, 'pii.iban', [
          [`Account ${valid}`, 'fail'],
          [`Account ${brokenIban(valid)}`, 'pass'],
        ]);
      },
    ],
    [
      'the-evidence-masks-the-value',
      4,
      'the evidence of a finding gives the offset and masks the IBAN: the report never repeats it',
      async (ctx) => {
        const tag = `${P}.iban.mask`;
        const valid = de(ctx, tag);
        const prefix = 'Please pay to ';
        const rec = await exec(ctx, tag, [{ text: `${prefix}${valid} today.` }]);
        const text = String(verdict(rec, 0, 'pii.iban')?.evidence ?? '');
        return [
          expectV(rec, 0, 'pii.iban', 'fail', true),
          text.includes(valid) || text.includes(valid.slice(4))
            ? `the evidence repeats the IBAN: ${text}`
            : undefined,
          text.includes(String(prefix.length))
            ? undefined
            : `the evidence does not give the offset ${prefix.length}: ${text.slice(0, 120)}`,
        ];
      },
    ],
  ]);
}

function nationalItems(): BankItem[] {
  const born = (ctx: ItemContext, tag: string, year: number) => {
    const rng = rngFor(ctx.seed, tag);
    return nationalNumber(year, between(rng, 1, 12), between(rng, 1, 28), between(rng, 1, 998));
  };
  return variants(FAMILY, `${P}.national`, CHECKS, 'pii-national-number', [
    [
      'born-before-2000',
      3,
      'a Belgian national register number whose check holds is a finding; a broken check is not',
      async (ctx) => {
        const tag = `${P}.national.old`;
        const n = born(ctx, tag, 1984);
        const broken = `${n.slice(0, 9)}${String((Number(n.slice(9)) + 1) % 97).padStart(2, '0')}`;
        return piiCases(ctx, tag, 'pii.national_number', [
          [`Register number ${dottedNational(n)}.`, 'fail'],
          [`Register number ${dottedNational(broken)}.`, 'pass'],
        ]);
      },
    ],
    [
      'born-after-2000',
      4,
      'the check of a number from someone born in 2000 or later is computed with a 2 in front: such a number is a finding too',
      async (ctx) => {
        const tag = `${P}.national.new`;
        const n = born(ctx, tag, 2009);
        const broken = `${n.slice(0, 9)}${String((Number(n.slice(9)) + 1) % 97).padStart(2, '0')}`;
        return piiCases(ctx, tag, 'pii.national_number', [
          [`Register number ${dottedNational(n)}.`, 'fail'],
          [`Register number ${dottedNational(broken)}.`, 'pass'],
        ]);
      },
    ],
    [
      'written-without-punctuation',
      4,
      'a register number written as eleven digits is found as the same number',
      async (ctx) => {
        const tag = `${P}.national.plain`;
        const n = born(ctx, tag, 1991);
        return piiCases(ctx, tag, 'pii.national_number', [
          [`Number ${n} on file.`, 'fail'],
          [`Number ${dottedNational(n)} on file.`, 'fail'],
        ]);
      },
    ],
    [
      'the-evidence-masks-the-value',
      4,
      'the evidence of a finding masks the register number and gives its offset',
      async (ctx) => {
        const tag = `${P}.national.mask`;
        const n = born(ctx, tag, 1977);
        const prefix = 'Register number ';
        const rec = await exec(ctx, tag, [{ text: `${prefix}${dottedNational(n)}.` }]);
        const text = String(verdict(rec, 0, 'pii.national_number')?.evidence ?? '');
        return [
          expectV(rec, 0, 'pii.national_number', 'fail', true),
          text.includes(n) || text.includes(dottedNational(n))
            ? `the evidence repeats the number: ${text}`
            : undefined,
          text.includes(String(prefix.length))
            ? undefined
            : `the evidence does not give the offset ${prefix.length}: ${text.slice(0, 120)}`,
        ];
      },
    ],
  ]);
}

function phoneItems(): BankItem[] {
  return variants(FAMILY, `${P}.phone`, CHECKS, 'pii-phone-forms', [
    [
      'international-form',
      3,
      'a phone number in international form is a finding',
      async (ctx) => {
        const tag = `${P}.phone.international`;
        const d = digits(ctx, tag, 8);
        return piiCases(ctx, tag, 'pii.phone', [
          [`Call +31 6 ${d} tonight.`, 'fail'],
          [`Call +49 151 ${d.slice(0, 4)} ${d.slice(4)} tonight.`, 'fail'],
          ['Call tonight.', 'pass'],
        ]);
      },
    ],
    [
      'belgian-mobile',
      3,
      'a Belgian mobile number is a finding, written with its zero or in international form',
      async (ctx) => {
        const tag = `${P}.phone.belgian`;
        const d = digits(ctx, tag, 6);
        return piiCases(ctx, tag, 'pii.phone', [
          [`Mobile 0470 ${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4)}.`, 'fail'],
          [`Mobile +32 470 ${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4)}.`, 'fail'],
        ]);
      },
    ],
    [
      'reserved-north-american-range',
      3,
      'a North American number in the reserved range 555-0100 to 555-0199 is not a finding; one just outside it is',
      async (ctx) => {
        const tag = `${P}.phone.reserved`;
        return piiCases(ctx, tag, 'pii.phone', [
          ['Call +1 202 555 0100 now.', 'pass'],
          ['Call +1 202 555 0143 now.', 'pass'],
          ['Call +1 202 555 0199 now.', 'pass'],
          ['Call +1 202 555 0200 now.', 'fail'],
          ['Call +1 202 555 0099 now.', 'fail'],
        ]);
      },
    ],
    [
      'the-evidence-masks-the-value',
      4,
      'the evidence of a finding masks the phone number and gives its offset',
      async (ctx) => {
        const tag = `${P}.phone.mask`;
        const d = digits(ctx, tag, 8);
        const prefix = 'Call ';
        const rec = await exec(ctx, tag, [{ text: `${prefix}+31 6 ${d} tonight.` }]);
        const text = String(verdict(rec, 0, 'pii.phone')?.evidence ?? '');
        return [
          expectV(rec, 0, 'pii.phone', 'fail', true),
          text.includes(d) ? `the evidence repeats the number: ${text}` : undefined,
          text.includes(String(prefix.length))
            ? undefined
            : `the evidence does not give the offset ${prefix.length}: ${text.slice(0, 120)}`,
        ];
      },
    ],
  ]);
}

function emailItems(): BankItem[] {
  const who = (ctx: ItemContext, tag: string) => tok(ctx, tag, 'who', 7);
  const reserved =
    (suffix: string): Probe =>
    async (ctx) => {
      const tag = `${P}.email.${suffix}`;
      return piiCases(ctx, tag, 'pii.email', [
        [`Write to ${who(ctx, tag)}@${suffix} please.`, 'pass'],
        [`Write to ${who(ctx, tag)}@${tok(ctx, tag, 'host', 8)}.com please.`, 'fail'],
      ]);
    };
  return [
    ...variants(FAMILY, `${P}.email-reserved`, CHECKS, 'pii-reserved-addresses', [
      [
        'example-domains',
        3,
        'an address at example.com, example.org or example.net is not a finding',
        async (ctx) => {
          const tag = `${P}.email.examples`;
          const w = who(ctx, tag);
          return piiCases(ctx, tag, 'pii.email', [
            [`Write to ${w}@example.com`, 'pass'],
            [`Write to ${w}@example.org`, 'pass'],
            [`Write to ${w}@example.net`, 'pass'],
            [`Write to ${w}@${tok(ctx, tag, 'host', 8)}.com`, 'fail'],
          ]);
        },
      ],
      ['localhost', 3, 'an address at localhost is not a finding', reserved('localhost')],
      [
        'reserved-endings',
        3,
        'an address under .example, .test, .invalid or .localhost is not a finding',
        async (ctx) => {
          const tag = `${P}.email.endings`;
          const [w, h] = [who(ctx, tag), tok(ctx, tag, 'host', 6)] as [string, string];
          return piiCases(ctx, tag, 'pii.email', [
            [`Write to ${w}@${h}.example`, 'pass'],
            [`Write to ${w}@${h}.test`, 'pass'],
            [`Write to ${w}@${h}.invalid`, 'pass'],
            [`Write to ${w}@${h}.localhost`, 'pass'],
            [`Write to ${w}@${h}.com`, 'fail'],
          ]);
        },
      ],
      [
        'names-that-only-end-alike',
        4,
        'an address at a name that merely ends in the letters of a reserved one is a finding',
        async (ctx) => {
          const tag = `${P}.email.alike`;
          const [w, h] = [who(ctx, tag), tok(ctx, tag, 'host', 6)] as [string, string];
          return piiCases(ctx, tag, 'pii.email', [
            [`Write to ${w}@${h}example.com`, 'fail'],
            [`Write to ${w}@${h}.testing`, 'fail'],
            [`Write to ${w}@${h}.test`, 'pass'],
          ]);
        },
      ],
    ]),
    ...variants(FAMILY, `${P}.email-include`, CHECKS, 'pii-reserved-include', [
      [
        'include-flags-reserved',
        3,
        'with reservedDomains include, an address at example.com is a finding',
        async (ctx) => {
          const tag = `${P}.email-include.example`;
          const rec = await exec(
            ctx,
            tag,
            [
              { text: `Write to ${who(ctx, tag)}@example.com` },
              { text: `Write to ${who(ctx, tag)}@${tok(ctx, tag, 'host', 8)}.com` },
            ],
            {
              checks: (product) => {
                const create = need<(options: Record<string, unknown>) => unknown>(
                  product.checks,
                  'checks',
                  'createPiiCheck',
                );
                const defaults = need<() => { name: string }[]>(product.checks, 'checks', 'defaultChecks')();
                return defaults.map((each) =>
                  each.name === 'pii' ? create({ reservedDomains: 'include' }) : each,
                );
              },
            },
          );
          return [expectV(rec, 0, 'pii.email', 'fail', true), expectV(rec, 1, 'pii.email', 'fail', true)];
        },
      ],
      [
        'include-flags-endings',
        3,
        'with reservedDomains include, an address under .example, .test or .invalid is a finding',
        async (ctx) => {
          const tag = `${P}.email-include.endings`;
          const [w, h] = [who(ctx, tag), tok(ctx, tag, 'host', 6)] as [string, string];
          const rec = await exec(
            ctx,
            tag,
            [
              { text: `Write to ${w}@${h}.test` },
              { text: `Write to ${w}@${h}.example` },
              { text: `Write to ${w}@${h}.invalid` },
            ],
            {
              checks: (product) => {
                const create = need<(options: Record<string, unknown>) => unknown>(
                  product.checks,
                  'checks',
                  'createPiiCheck',
                );
                const defaults = need<() => { name: string }[]>(product.checks, 'checks', 'defaultChecks')();
                return defaults.map((each) =>
                  each.name === 'pii' ? create({ reservedDomains: 'include' }) : each,
                );
              },
            },
          );
          return [0, 1, 2].map((i) => expectV(rec, i, 'pii.email', 'fail', true));
        },
      ],
      [
        'include-flags-localhost',
        3,
        'with reservedDomains include, an address at localhost or under .localhost is a finding',
        async (ctx) => {
          const tag = `${P}.email-include.localhost`;
          const [w, h] = [who(ctx, tag), tok(ctx, tag, 'host', 6)] as [string, string];
          const rec = await exec(
            ctx,
            tag,
            [{ text: `Write to ${w}@localhost` }, { text: `Write to ${w}@${h}.localhost` }],
            {
              checks: (product) => {
                const create = need<(options: Record<string, unknown>) => unknown>(
                  product.checks,
                  'checks',
                  'createPiiCheck',
                );
                const defaults = need<() => { name: string }[]>(product.checks, 'checks', 'defaultChecks')();
                return defaults.map((each) =>
                  each.name === 'pii' ? create({ reservedDomains: 'include' }) : each,
                );
              },
            },
          );
          return [expectV(rec, 0, 'pii.email', 'fail', true), expectV(rec, 1, 'pii.email', 'fail', true)];
        },
      ],
      [
        'the-default-stays-exclude',
        3,
        'the default check still leaves reserved addresses out when the option is given as exclude',
        async (ctx) => {
          const tag = `${P}.email-include.exclude`;
          const rec = await exec(ctx, tag, [{ text: `Write to ${who(ctx, tag)}@example.com` }], {
            checks: (product) => {
              const create = need<(options: Record<string, unknown>) => unknown>(
                product.checks,
                'checks',
                'createPiiCheck',
              );
              const defaults = need<() => { name: string }[]>(product.checks, 'checks', 'defaultChecks')();
              return defaults.map((each) =>
                each.name === 'pii' ? create({ reservedDomains: 'exclude' }) : each,
              );
            },
          });
          return [expectV(rec, 0, 'pii.email', 'pass', true)];
        },
      ],
    ]),
    ...variants(FAMILY, `${P}.email-mask`, CHECKS, 'pii-email-evidence', [
      [
        'masked-with-an-offset',
        4,
        'the evidence of an address finding masks the address and gives its offset',
        async (ctx) => {
          const tag = `${P}.email-mask.offset`;
          const [w, h] = [who(ctx, tag), tok(ctx, tag, 'host', 8)] as [string, string];
          const prefix = 'Write to ';
          const rec = await exec(ctx, tag, [{ text: `${prefix}${w}@${h}.com please.` }]);
          const text = String(verdict(rec, 0, 'pii.email')?.evidence ?? '');
          return [
            expectV(rec, 0, 'pii.email', 'fail', true),
            text.includes(`${w}@${h}`) || text.includes(h)
              ? `the evidence repeats the address: ${text}`
              : undefined,
            text.includes(String(prefix.length))
              ? undefined
              : `the evidence does not give the offset ${prefix.length}: ${text.slice(0, 120)}`,
          ];
        },
      ],
      [
        'two-addresses',
        4,
        'two addresses in one reply are both found, each at its own offset',
        async (ctx) => {
          const tag = `${P}.email-mask.two`;
          const [w, h, v] = [who(ctx, tag), tok(ctx, tag, 'host', 8), tok(ctx, tag, 'who2', 7)] as [
            string,
            string,
            string,
          ];
          const first = 'Write to ';
          const rec = await exec(ctx, tag, [{ text: `${first}${w}@${h}.com or ${v}@${h}.com.` }]);
          const text = String(verdict(rec, 0, 'pii.email')?.evidence ?? '');
          const second = first.length + `${w}@${h}.com or `.length;
          return [
            expectV(rec, 0, 'pii.email', 'fail', true),
            text.includes(String(first.length)) && text.includes(String(second))
              ? undefined
              : `the evidence should give the offsets ${first.length} and ${second}: ${text.slice(0, 160)}`,
          ];
        },
      ],
      [
        'a-clean-reply',
        3,
        'a reply with no address gives a passing email verdict and no finding',
        async (ctx) => {
          const tag = `${P}.email-mask.clean`;
          const rec = await exec(ctx, tag, [{ text: `Thanks, ${who(ctx, tag)}.` }]);
          return [expectV(rec, 0, 'pii.email', 'pass', true)];
        },
      ],
    ]),
  ];
}

function ownerItems(): BankItem[] {
  const owner = (list: string[]) => ({ piiOwner: list });
  const mailOf = (ctx: ItemContext, tag: string, slot: string) =>
    `${tok(ctx, tag, `${slot}w`, 7)}@${tok(ctx, tag, `${slot}h`, 8)}.com`;
  return variants(FAMILY, `${P}.owner`, CHECKS, 'pii-owner-allowlist', [
    [
      'the-owner-address-is-left-out',
      3,
      'an address that equals an owner value is not a finding; any other address is',
      async (ctx) => {
        const tag = `${P}.owner.email`;
        const [mine, other] = [mailOf(ctx, tag, 'm'), mailOf(ctx, tag, 'o')] as [string, string];
        return [
          ...(await piiCases(
            ctx,
            tag,
            'pii.email',
            [
              [`Mail ${mine} please`, 'pass'],
              [`Mail ${other} please`, 'fail'],
            ],
            owner([mine]),
          )),
          ...(await piiCases(ctx, `${tag}:none`, 'pii.email', [[`Mail ${mine} please`, 'fail']])),
        ];
      },
    ],
    [
      'an-email-is-compared-with-case-folded',
      3,
      'an owner address matches whatever the case of the address in the reply',
      async (ctx) => {
        const tag = `${P}.owner.case`;
        const mine = mailOf(ctx, tag, 'm');
        return piiCases(
          ctx,
          tag,
          'pii.email',
          [
            [`Mail ${mine.toUpperCase()} please`, 'pass'],
            [`Mail ${mine} please`, 'pass'],
          ],
          owner([mine]),
        );
      },
    ],
    [
      'a-third-party-at-the-owner-domain',
      4,
      "a domain never matches: another person at the owner's domain is still a finding",
      async (ctx) => {
        const tag = `${P}.owner.domain`;
        const [w, h, v] = [tok(ctx, tag, 'w', 7), tok(ctx, tag, 'h', 8), tok(ctx, tag, 'v', 7)] as [
          string,
          string,
          string,
        ];
        return piiCases(
          ctx,
          tag,
          'pii.email',
          [
            [`Mail ${w}@${h}.com please`, 'pass'],
            [`Mail ${v}@${h}.com please`, 'fail'],
          ],
          owner([`${w}@${h}.com`]),
        );
      },
    ],
    [
      'a-part-of-a-value-never-matches',
      4,
      'a part of an owner value never matches: an address that merely contains the owner address is a finding',
      async (ctx) => {
        const tag = `${P}.owner.part`;
        const [w, h] = [tok(ctx, tag, 'w', 7), tok(ctx, tag, 'h', 8)] as [string, string];
        return piiCases(
          ctx,
          tag,
          'pii.email',
          [
            [`Mail ${w}@${h}.com please`, 'pass'],
            [`Mail x${w}@${h}.com please`, 'fail'],
            [`Mail ${w}@${h}.com.${w}.com please`, 'fail'],
          ],
          owner([`${w}@${h}.com`]),
        );
      },
    ],
    [
      'a-phone-is-compared-as-letters-and-digits',
      4,
      'a phone value is compared as its digits: spaces and punctuation in the reply do not matter',
      async (ctx) => {
        const tag = `${P}.owner.phone`;
        const d = digits(ctx, tag, 8);
        const spaced = `+31 6 ${d.slice(0, 4)} ${d.slice(4)}`;
        const tight = `+316${d}`;
        const dashed = `+31-6-${d.slice(0, 4)}-${d.slice(4)}`;
        return piiCases(
          ctx,
          tag,
          'pii.phone',
          [
            [`Call ${tight} now`, 'pass'],
            [`Call ${dashed} now`, 'pass'],
            [`Call +31 6 ${digits(ctx, `${tag}:x`, 8)} now`, 'fail'],
          ],
          owner([spaced]),
        );
      },
    ],
    [
      'each-form-is-its-own-entry',
      5,
      'a number written in national form and in international form needs both entries',
      async (ctx) => {
        const tag = `${P}.owner.forms`;
        const d = digits(ctx, tag, 6);
        const national = `0470 ${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4)}`;
        const international = `+32 470 ${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4)}`;
        return [
          ...(await piiCases(
            ctx,
            `${tag}:a`,
            'pii.phone',
            [
              [`Call ${national} now`, 'pass'],
              [`Call ${international} now`, 'fail'],
            ],
            owner([national]),
          )),
          ...(await piiCases(
            ctx,
            `${tag}:b`,
            'pii.phone',
            [
              [`Call ${national} now`, 'pass'],
              [`Call ${international} now`, 'pass'],
            ],
            owner([national, international]),
          )),
        ];
      },
    ],
    [
      'the-evidence-counts-and-never-prints',
      4,
      'the evidence counts the owner values it left out and never prints them',
      async (ctx) => {
        const tag = `${P}.owner.count`;
        const [mine, other] = [mailOf(ctx, tag, 'm'), mailOf(ctx, tag, 'o')] as [string, string];
        const rec = await exec(ctx, tag, [{ text: `Mail ${mine} or ${other}` }], {
          checks: withDefaults(owner([mine])),
        });
        const text = String(verdict(rec, 0, 'pii.email')?.evidence ?? '');
        return [
          expectV(rec, 0, 'pii.email', 'fail', true),
          /1 owner/.test(text)
            ? undefined
            : `the evidence does not count the owner value left out ("1 owner ..."): ${text.slice(0, 160)}`,
          text.includes(mine) || text.includes(mine.split('@')[0] as string)
            ? `the evidence prints the owner value: ${text}`
            : undefined,
        ];
      },
    ],
  ]);
}

/* ------------------------------------------------------------------------------------------------------
 * Cards
 * ---------------------------------------------------------------------------------------------------- */

const cardSeg = (name: string) => ({ type: 'card', name });
const textSeg = (text: string) => ({ type: 'text', text });

function cardItems(): BankItem[] {
  const sends = (names: string[], text = 'Done.') => ({
    extra: { segments: [textSeg(text), ...names.map(cardSeg)] },
  });
  return [
    ...variants(FAMILY, `${P}.cards-count`, CHECKS, 'cards-count', [
      [
        'exact-count',
        3,
        'a card expected a number of times passes at that number and fails one more or one fewer',
        async (ctx) => {
          const tag = `${P}.cards-count.exact`;
          const n = tok(ctx, tag, 'n');
          const rows: Row[] = [1, 2, 3].map((k) => ({
            ...sends(Array(k).fill(n)),
            expect: { cards: [{ name: n, count: 2 }] },
          }));
          const rec = await exec(ctx, tag, rows);
          return (['fail', 'pass', 'fail'] as const).map((want, i) =>
            expectV(rec, i, `cards.${n}`, want, true),
          );
        },
      ],
      [
        'range',
        3,
        'a card expected between a min and a max passes at both bounds and fails outside them',
        async (ctx) => {
          const tag = `${P}.cards-count.range`;
          const n = tok(ctx, tag, 'n');
          const rows: Row[] = [0, 1, 2, 3].map((k) => ({
            ...sends(Array(k).fill(n)),
            expect: { cards: [{ name: n, count: { min: 1, max: 2 } }] },
          }));
          const rec = await exec(ctx, tag, rows);
          return (['fail', 'pass', 'pass', 'fail'] as const).map((want, i) =>
            expectV(rec, i, `cards.${n}`, want, true),
          );
        },
      ],
      [
        'default-is-at-least-once',
        3,
        'a card with no count must be sent at least once',
        async (ctx) => {
          const tag = `${P}.cards-count.default`;
          const [n, o] = [tok(ctx, tag, 'n'), tok(ctx, tag, 'o')] as [string, string];
          const rec = await exec(ctx, tag, [
            { ...sends([n]), expect: { cards: [{ name: n }] } },
            { ...sends([o]), expect: { cards: [{ name: n }] } },
          ]);
          return [expectV(rec, 0, `cards.${n}`, 'pass', true), expectV(rec, 1, `cards.${n}`, 'fail', true)];
        },
      ],
      [
        'zero-means-never',
        3,
        'a card expected 0 times must not be sent',
        async (ctx) => {
          const tag = `${P}.cards-count.zero`;
          const n = tok(ctx, tag, 'n');
          const rec = await exec(ctx, tag, [
            { ...sends([]), expect: { cards: [{ name: n, count: 0 }] } },
            { ...sends([n]), expect: { cards: [{ name: n, count: 0 }] } },
          ]);
          return [expectV(rec, 0, `cards.${n}`, 'pass', true), expectV(rec, 1, `cards.${n}`, 'fail', true)];
        },
      ],
      [
        'each-card-its-own-count',
        4,
        'two cards expected in one block are counted apart',
        async (ctx) => {
          const tag = `${P}.cards-count.two`;
          const [a, b] = [tok(ctx, tag, 'a'), tok(ctx, tag, 'b')] as [string, string];
          const rec = await exec(ctx, tag, [
            {
              ...sends([a, a, b]),
              expect: {
                cards: [
                  { name: a, count: 2 },
                  { name: b, count: 2 },
                ],
              },
            },
          ]);
          return [expectV(rec, 0, `cards.${a}`, 'pass', true), expectV(rec, 0, `cards.${b}`, 'fail', true)];
        },
      ],
    ]),
    ...variants(FAMILY, `${P}.cards-one`, CHECKS, 'one-message-per-turn', [
      [
        'one-text-is-one-message',
        3,
        'a block with one text segment is one message; a block with two text segments is two',
        async (ctx) => {
          const tag = `${P}.cards-one.text`;
          const [a, b] = [tok(ctx, tag, 'a', 8), tok(ctx, tag, 'b', 8)] as [string, string];
          const rec = await exec(
            ctx,
            tag,
            [{ text: a }, { text: '', extra: { text: '', segments: [textSeg(a), textSeg(b)] } }],
            { spec: { rules: { one_message_per_turn: true } } },
          );
          return [
            expectV(rec, 0, 'cards.one_message_per_turn', 'pass', true),
            expectV(rec, 1, 'cards.one_message_per_turn', 'fail', true),
          ];
        },
      ],
      [
        'a-card-sent-twice',
        3,
        'a card sent twice in a block is two messages',
        async (ctx) => {
          const tag = `${P}.cards-one.twice`;
          const n = tok(ctx, tag, 'n');
          const rec = await exec(
            ctx,
            tag,
            [
              { text: '', extra: { text: '', segments: [cardSeg(n)] } },
              { text: '', extra: { text: '', segments: [cardSeg(n), cardSeg(n)] } },
            ],
            { spec: { rules: { one_message_per_turn: true } } },
          );
          return [
            expectV(rec, 0, 'cards.one_message_per_turn', 'pass', true),
            expectV(rec, 1, 'cards.one_message_per_turn', 'fail', true),
          ];
        },
      ],
      [
        'a-card-stands-in-for-text',
        3,
        'a card stands in for the text: a block that sends only a card is one message',
        async (ctx) => {
          const tag = `${P}.cards-one.instead`;
          const n = tok(ctx, tag, 'n');
          const rec = await exec(ctx, tag, [{ text: '', extra: { text: '', segments: [cardSeg(n)] } }], {
            spec: { rules: { one_message_per_turn: true } },
          });
          return [expectV(rec, 0, 'cards.one_message_per_turn', 'pass', true), expectPass(rec, 0, true)];
        },
      ],
      [
        'nothing-sent',
        3,
        'a block with no text and no card fails: one message is asked',
        async (ctx) => {
          const tag = `${P}.cards-one.nothing`;
          const rec = await exec(ctx, tag, [{ text: '', extra: { text: '', segments: [] } }], {
            spec: { rules: { one_message_per_turn: true } },
          });
          return [expectV(rec, 0, 'cards.one_message_per_turn', 'fail', true), expectPass(rec, 0, false)];
        },
      ],
      [
        'the-rule-is-off-by-default',
        3,
        'without the rule, two text segments and a block with nothing in it are not judged by it',
        async (ctx) => {
          const tag = `${P}.cards-one.off`;
          const [a, b] = [tok(ctx, tag, 'a', 8), tok(ctx, tag, 'b', 8)] as [string, string];
          const rec = await exec(ctx, tag, [
            { text: '', extra: { text: '', segments: [textSeg(a), textSeg(b)] } },
          ]);
          return [expectNone(rec, 0, 'cards'), expectPass(rec, 0, true)];
        },
      ],
    ]),
  ];
}

/* ------------------------------------------------------------------------------------------------------
 * Custom checks
 * ---------------------------------------------------------------------------------------------------- */

let serial = 0;
const freshName = (ctx: ItemContext, tag: string, extra = '') => {
  serial += 1;
  return `gd${tok(ctx, tag, 'n', 5)}${serial}${extra}`;
};

type Fn = (ctx: { observed: { text: string } }, options: unknown) => unknown;

function customItems(): BankItem[] {
  const register = (ctx: ItemContext, name: string, fn: Fn) =>
    need<(name: string, fn: Fn) => void>(ctx.product.checks, 'checks', 'registerCheck')(name, fn);
  const verdictOf = (ctx: ItemContext) =>
    need<(...args: string[]) => Record<string, unknown>>(ctx.product.core, 'core', 'machineVerdict');
  const ran = (name: string) => ({ spec: { rules: { custom: { [name]: {} } } } });
  return [
    ...variants(FAMILY, `${P}.custom-name`, CHECKS, 'custom-name-rules', [
      [
        'a-name-with-a-space-or-slash',
        3,
        'a name with a space, a slash or a colon is refused when it is registered',
        async (ctx) => {
          const tag = `${P}.custom-name.invalid`;
          const base = freshName(ctx, tag);
          const refused = ['a b', 'a/b', 'a:b', 'a?b'].map((bad) => {
            try {
              register(ctx, `${base}${bad}`, () => []);
              return `the name "${base}${bad}" was accepted`;
            } catch {
              return undefined;
            }
          });
          return refused;
        },
      ],
      [
        'dots-underscores-hyphens-digits',
        3,
        'a name of letters, digits, dots, underscores and hyphens is accepted and its verdict is filed under it',
        async (ctx) => {
          const tag = `${P}.custom-name.valid`;
          const base = freshName(ctx, tag);
          const names = [`${base}.dot`, `${base}_under`, `${base}-hyphen`, `${base}9`];
          const problems: (string | undefined)[] = [];
          for (const name of names) {
            try {
              register(ctx, name, () => verdictOf(ctx)(name, 'ok', 'pass', 'fine'));
            } catch (error) {
              problems.push(`the name "${name}" was refused: ${(error as Error).message.slice(0, 100)}`);
              continue;
            }
            const rec = await exec(ctx, `${tag}:${name}`, [{ text: 'Done.' }], ran(name));
            problems.push(expectV(rec, 0, `custom.${name}.ok`, 'pass', true));
          }
          return problems;
        },
      ],
      [
        'registered-once',
        3,
        'a name is registered once: the second registration is refused and the first check keeps running',
        async (ctx) => {
          const tag = `${P}.custom-name.once`;
          const name = freshName(ctx, tag);
          register(ctx, name, () => verdictOf(ctx)(name, 'first', 'pass', 'the first'));
          let second = 'the second registration was accepted';
          try {
            register(ctx, name, () => verdictOf(ctx)(name, 'second', 'pass', 'the second'));
          } catch {
            second = '';
          }
          const rec = await exec(ctx, tag, [{ text: 'Done.' }], ran(name));
          return [
            second || undefined,
            expectV(rec, 0, `custom.${name}.first`, 'pass', true),
            idsAt(rec, 0).includes(`custom.${name}.second`) ? 'the refused check ran' : undefined,
          ];
        },
      ],
    ]),
    ...variants(FAMILY, `${P}.custom-ids`, CHECKS, 'custom-verdict-ids', [
      [
        'filed-under-custom-name',
        3,
        'a verdict a custom check returns is filed under custom.<name>.<id>',
        async (ctx) => {
          const tag = `${P}.custom-ids.one`;
          const name = freshName(ctx, tag);
          const id = tok(ctx, tag, 'id', 6);
          register(ctx, name, () => verdictOf(ctx)(name, id, 'fail', 'planted'));
          const rec = await exec(ctx, tag, [{ text: 'Done.' }], ran(name));
          return [expectV(rec, 0, `custom.${name}.${id}`, 'fail', true), expectPass(rec, 0, false)];
        },
      ],
      [
        'a-list-of-verdicts',
        3,
        'a custom check that returns a list gives one verdict per entry, each filed under its own id',
        async (ctx) => {
          const tag = `${P}.custom-ids.list`;
          const name = freshName(ctx, tag);
          const [a, b] = [tok(ctx, tag, 'a', 6), tok(ctx, tag, 'b', 6)] as [string, string];
          register(ctx, name, () => [
            verdictOf(ctx)(name, a, 'pass', 'one'),
            verdictOf(ctx)(name, b, 'fail', 'two'),
          ]);
          const rec = await exec(ctx, tag, [{ text: 'Done.' }], ran(name));
          return [
            expectV(rec, 0, `custom.${name}.${a}`, 'pass', true),
            expectV(rec, 0, `custom.${name}.${b}`, 'fail', true),
          ];
        },
      ],
      [
        'a-promise-of-a-verdict',
        3,
        'a custom check may return a promise of a verdict, or a promise of a list',
        async (ctx) => {
          const tag = `${P}.custom-ids.promise`;
          const [one, many] = [freshName(ctx, tag, 'p'), freshName(ctx, tag, 'q')] as [string, string];
          register(ctx, one, async () => verdictOf(ctx)(one, 'x', 'pass', 'one'));
          register(ctx, many, async () => [
            verdictOf(ctx)(many, 'y', 'pass', 'a'),
            verdictOf(ctx)(many, 'z', 'fail', 'b'),
          ]);
          const rec = await exec(ctx, tag, [{ text: 'Done.' }], {
            spec: { rules: { custom: { [one]: {}, [many]: {} } } },
          });
          return [
            expectV(rec, 0, `custom.${one}.x`, 'pass', true),
            expectV(rec, 0, `custom.${many}.y`, 'pass', true),
            expectV(rec, 0, `custom.${many}.z`, 'fail', true),
          ];
        },
      ],
      [
        'every-block',
        3,
        'a check named under rules.custom runs on every block of the spec',
        async (ctx) => {
          const tag = `${P}.custom-ids.blocks`;
          const name = freshName(ctx, tag);
          register(ctx, name, () => verdictOf(ctx)(name, 'seen', 'pass', 'ran'));
          const rec = await exec(
            ctx,
            tag,
            [{ text: 'One.' }, { text: 'Two.' }, { text: 'Three.' }],
            ran(name),
          );
          return [0, 1, 2].map((i) => expectV(rec, i, `custom.${name}.seen`, 'pass', true));
        },
      ],
    ]),
    ...variants(FAMILY, `${P}.custom-empty`, CHECKS, 'custom-empty-list-says-nothing', [
      [
        'an-empty-list',
        3,
        'a custom check that returns an empty list says nothing about the block',
        async (ctx) => {
          const tag = `${P}.custom-empty.list`;
          const name = freshName(ctx, tag);
          register(ctx, name, () => []);
          const rec = await exec(ctx, tag, [{ text: 'Done.' }], ran(name));
          return [expectNone(rec, 0, `custom.${name}`), expectPass(rec, 0, true)];
        },
      ],
      [
        'a-promise-of-an-empty-list',
        3,
        'a custom check whose promise gives an empty list says nothing either',
        async (ctx) => {
          const tag = `${P}.custom-empty.promise`;
          const name = freshName(ctx, tag);
          register(ctx, name, async () => []);
          const rec = await exec(ctx, tag, [{ text: 'Done.' }], ran(name));
          return [expectNone(rec, 0, `custom.${name}`), expectPass(rec, 0, true)];
        },
      ],
      [
        'silent-on-one-block-only',
        4,
        'a check that returns nothing on one block and a verdict on another says nothing on the first',
        async (ctx) => {
          const tag = `${P}.custom-empty.some`;
          const name = freshName(ctx, tag);
          const t = tok(ctx, tag, 't', 9);
          register(ctx, name, (c) =>
            c.observed.text.includes(t) ? verdictOf(ctx)(name, 'seen', 'pass', 'ran') : [],
          );
          const rec = await exec(ctx, tag, [{ text: `has ${t}` }, { text: 'has not' }], ran(name));
          return [
            expectV(rec, 0, `custom.${name}.seen`, 'pass', true),
            expectNone(rec, 1, `custom.${name}`),
            expectPass(rec, 1, true),
          ];
        },
      ],
    ]),
    ...variants(FAMILY, `${P}.custom-options`, CHECKS, 'custom-receives-options', [
      [
        'the-options-of-the-spec',
        3,
        'the options written under rules.custom for the name reach the function',
        async (ctx) => {
          const tag = `${P}.custom-options.reach`;
          const name = freshName(ctx, tag);
          const value = tok(ctx, tag, 'v', 8);
          register(ctx, name, (_c, options) =>
            verdictOf(ctx)(
              name,
              'opt',
              (options as { v?: string })?.v === value ? 'pass' : 'fail',
              'checked',
            ),
          );
          const rec = await exec(ctx, tag, [{ text: 'Done.' }], {
            spec: { rules: { custom: { [name]: { v: value } } } },
          });
          return [expectV(rec, 0, `custom.${name}.opt`, 'pass', true)];
        },
      ],
      [
        'each-name-its-own-options',
        3,
        'two checks named under rules.custom each receive their own options',
        async (ctx) => {
          const tag = `${P}.custom-options.two`;
          const [a, b] = [freshName(ctx, tag, 'a'), freshName(ctx, tag, 'b')] as [string, string];
          const [x, y] = [tok(ctx, tag, 'x', 6), tok(ctx, tag, 'y', 6)] as [string, string];
          const see =
            (name: string, want: string): Fn =>
            (_c, options) =>
              verdictOf(ctx)(
                name,
                'opt',
                (options as { v?: string })?.v === want ? 'pass' : 'fail',
                'checked',
              );
          register(ctx, a, see(a, x));
          register(ctx, b, see(b, y));
          const rec = await exec(ctx, tag, [{ text: 'Done.' }], {
            spec: { rules: { custom: { [a]: { v: x }, [b]: { v: y } } } },
          });
          return [
            expectV(rec, 0, `custom.${a}.opt`, 'pass', true),
            expectV(rec, 0, `custom.${b}.opt`, 'pass', true),
          ];
        },
      ],
      [
        'the-block-context',
        4,
        'the function receives the block context: the observed reply of the block it runs on',
        async (ctx) => {
          const tag = `${P}.custom-options.context`;
          const name = freshName(ctx, tag);
          const [t0, t1] = [tok(ctx, tag, 't0', 9), tok(ctx, tag, 't1', 9)] as [string, string];
          register(ctx, name, (c) =>
            verdictOf(ctx)(name, 'reply', c.observed.text.includes(t0) ? 'pass' : 'fail', c.observed.text),
          );
          const rec = await exec(ctx, tag, [{ text: `says ${t0}` }, { text: `says ${t1}` }], ran(name));
          return [
            expectV(rec, 0, `custom.${name}.reply`, 'pass', true),
            expectV(rec, 1, `custom.${name}.reply`, 'fail', true),
          ];
        },
      ],
    ]),
  ];
}

/* ------------------------------------------------------------------------------------------------------
 * Assertion forms on a tool input
 * ---------------------------------------------------------------------------------------------------- */

/** One block per input value, all asserting the same `assertion` on the field `x` of the call. */
async function asserted(
  ctx: ItemContext,
  tag: string,
  assertion: unknown,
  inputs: unknown[],
): Promise<{ rec: Awaited<ReturnType<typeof exec>>; id: string }> {
  const label = tok(ctx, tag, 'tool', 7);
  const rows: Row[] = inputs.map((value) => ({
    calls: [{ label, input: value === undefined ? {} : { x: value } } as Call],
    expect: { tools: [{ label, count: 1, input: { x: assertion } }] },
  }));
  return { rec: await exec(ctx, tag, rows), id: `tools.${label}.input.x` };
}

function valueItems(): BankItem[] {
  const f = (
    id: string,
    tier: Tier,
    title: string,
    assertion: (ctx: ItemContext, tag: string) => unknown,
    cases: (ctx: ItemContext, tag: string) => [unknown, 'pass' | 'fail'][],
  ): readonly [string, Tier, string, Probe] => [
    id,
    tier,
    title,
    async (ctx) => {
      const tag = `${P}.value.${id}`;
      const list = cases(ctx, tag);
      const { rec, id: vid } = await asserted(
        ctx,
        tag,
        assertion(ctx, tag),
        list.map(([value]) => value),
      );
      return list.map(([value, want], i) => {
        const found = expectV(rec, i, vid, want, true);
        return found && `input ${JSON.stringify(value)}: ${found}`;
      });
    },
  ];
  return [
    ...variants(FAMILY, `${P}.value-m`, CHECKS, 'value-regex-m-flag', [
      f(
        'caret-at-a-line-start',
        3,
        'a regex assertion compiles with the m flag: ^ anchors at the start of any line',
        () => ({ regex: '^second' }),
        () => [
          ['first\nsecond', 'pass'],
          ['first second', 'fail'],
          ['second\nfirst', 'pass'],
        ],
      ),
      f(
        'dollar-at-a-line-end',
        3,
        'a regex assertion compiles with the m flag: $ anchors at the end of any line',
        () => ({ regex: 'first$' }),
        () => [
          ['first\nsecond', 'pass'],
          ['first second', 'fail'],
          ['second\nfirst', 'pass'],
        ],
      ),
      f(
        'a-whole-line',
        4,
        'with the m flag, ^...$ matches a whole line of a longer value',
        (ctx, tag) => ({ regex: `^${tok(ctx, tag, 'w', 6)}$` }),
        (ctx, tag) => {
          const w = tok(ctx, tag, 'w', 6);
          return [
            [`a\n${w}\nb`, 'pass'],
            [`a ${w} b`, 'fail'],
            [`${w}x`, 'fail'],
          ];
        },
      ),
    ]),
    ...variants(FAMILY, `${P}.value-contains`, CHECKS, 'value-contains-list-item', [
      f(
        'a-list-with-the-item',
        3,
        'contains holds for a list that holds the text as an item',
        (ctx, tag) => ({ contains: tok(ctx, tag, 'w', 6) }),
        (ctx, tag) => {
          const w = tok(ctx, tag, 'w', 6);
          return [
            [['q', w, 'r'], 'pass'],
            [['q', 'r'], 'fail'],
            [[`${w}x`], 'fail'],
          ];
        },
      ),
      f(
        'a-text-that-contains-it',
        3,
        'contains holds for a string that contains the text',
        (ctx, tag) => ({ contains: tok(ctx, tag, 'w', 6) }),
        (ctx, tag) => {
          const w = tok(ctx, tag, 'w', 6);
          return [
            [`aa${w}bb`, 'pass'],
            [w.slice(0, 5), 'fail'],
            [42, 'fail'],
          ];
        },
      ),
      f(
        'not-an-item-of-another-type',
        4,
        'contains on a list holds only for an item equal to the text, not a number or a nested list',
        (ctx, tag) => ({ contains: tok(ctx, tag, 'w', 4) }),
        (ctx, tag) => {
          const w = tok(ctx, tag, 'w', 4);
          return [
            [[1, 2, 3], 'fail'],
            [[[w]], 'fail'],
            [[w], 'pass'],
          ];
        },
      ),
    ]),
    ...variants(FAMILY, `${P}.value-equal`, CHECKS, 'value-json-equality', [
      f(
        'lists-in-order',
        3,
        'exact compares a list item by item, in order: the same items in another order are not equal',
        () => ({ exact: [1, 2, 3] }),
        () => [
          [[1, 2, 3], 'pass'],
          [[3, 2, 1], 'fail'],
          [[1, 2], 'fail'],
          [[1, 2, 3, 4], 'fail'],
        ],
      ),
      f(
        'nested-values',
        4,
        'exact compares nested lists and mappings as JSON, whatever the order of the keys',
        (ctx, tag) => ({
          exact: {
            [tok(ctx, tag, 'a', 4)]: [1, { [tok(ctx, tag, 'b', 4)]: 'x' }],
            [tok(ctx, tag, 'c', 4)]: null,
          },
        }),
        (ctx, tag) => {
          const [a, b, c] = [tok(ctx, tag, 'a', 4), tok(ctx, tag, 'b', 4), tok(ctx, tag, 'c', 4)] as [
            string,
            string,
            string,
          ];
          return [
            [{ [c]: null, [a]: [1, { [b]: 'x' }] }, 'pass'],
            [{ [a]: [1, { [b]: 'y' }], [c]: null }, 'fail'],
            [{ [a]: [{ [b]: 'x' }, 1], [c]: null }, 'fail'],
          ];
        },
      ),
      f(
        'a-bare-value-is-equality',
        3,
        'a bare number, text, boolean or null is equality with that JSON value',
        () => 7,
        () => [
          [7, 'pass'],
          ['7', 'fail'],
          [8, 'fail'],
        ],
      ),
    ]),
    ...variants(FAMILY, `${P}.value-subset`, CHECKS, 'value-nested-subset', [
      f(
        'a-nested-mapping',
        3,
        'subset compares nested mappings the same way: the nested keys must hold, others are free',
        (ctx, tag) => ({ subset: { [tok(ctx, tag, 'a', 4)]: { [tok(ctx, tag, 'b', 4)]: 1 } } }),
        (ctx, tag) => {
          const [a, b, c] = [tok(ctx, tag, 'a', 4), tok(ctx, tag, 'b', 4), tok(ctx, tag, 'c', 4)] as [
            string,
            string,
            string,
          ];
          return [
            [{ [a]: { [b]: 1, [c]: 2 }, z: 3 }, 'pass'],
            [{ [a]: { [b]: 2 } }, 'fail'],
            [{ [a]: { [c]: 1 } }, 'fail'],
            [{ z: 1 }, 'fail'],
          ];
        },
      ),
      f(
        'a-list-inside-a-subset',
        4,
        'a list inside a subset is compared item by item, in order',
        (ctx, tag) => ({ subset: { [tok(ctx, tag, 'l', 4)]: [1, 2] } }),
        (ctx, tag) => {
          const l = tok(ctx, tag, 'l', 4);
          return [
            [{ [l]: [1, 2], z: 1 }, 'pass'],
            [{ [l]: [2, 1] }, 'fail'],
            [{ [l]: [1, 2, 3] }, 'fail'],
          ];
        },
      ),
      f(
        'not-a-mapping',
        3,
        'subset on a value that is not a mapping does not hold',
        (ctx, tag) => ({ subset: { [tok(ctx, tag, 'a', 4)]: 1 } }),
        () => [
          ['text', 'fail'],
          [[1], 'fail'],
          [5, 'fail'],
        ],
      ),
    ]),
    ...variants(FAMILY, `${P}.value-null`, CHECKS, 'value-nonempty-null', [
      f(
        'null-is-empty',
        3,
        'nonempty fails null',
        () => ({ nonempty: true }),
        () => [
          [null, 'fail'],
          ['x', 'pass'],
        ],
      ),
      f(
        'a-missing-key-is-empty',
        3,
        'nonempty fails a key the call did not send',
        () => ({ nonempty: true }),
        () => [
          [undefined, 'fail'],
          ['x', 'pass'],
        ],
      ),
      f(
        'absent-is-the-twin',
        3,
        'absent holds for a key the call did not send and fails for any value that is there',
        () => ({ absent: true }),
        () => [
          [undefined, 'pass'],
          ['x', 'fail'],
          [0, 'fail'],
        ],
      ),
    ]),
  ];
}

export function dataItems(): BankItem[] {
  return [
    ...ibanItems(),
    ...nationalItems(),
    ...phoneItems(),
    ...emailItems(),
    ...ownerItems(),
    ...cardItems(),
    ...customItems(),
    ...valueItems(),
  ];
}
