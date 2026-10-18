import { describe, expect, it } from 'vitest';
import { createPiiCheck, pii } from '../src/checks/pii';
import { defaultChecks } from '../src/defaults';
import { isValidIban, isValidNationalNumber, redact, scanPii } from '../src/support/pii';
import { acme } from './support/acme';
import { context, failing, observed, outcomes, run, verdict } from './support/context';
import {
  BELGIAN_MOBILE,
  BELGIAN_MOBILE_NATIONAL,
  makeIban,
  makeNationalNumber,
  PERSONAL_EMAIL,
} from './support/fixtures';

const coverage = acme('acme-new-customer-coverage');
const handover =
  'Done. A sales advisor will call you at +1 202 555 0131 about home internet at 88 Summit Avenue, Acmeville. Your reference is LEAD-10C86C.';
const recap =
  'Here is your order: Acme Mobile M, 40 GB for $25 a month, for Dana Brooks (dana.brooks@example.com), keeping +1 202 555 0150. Reply CONFIRM to place the order.';

describe('pii', () => {
  it('passes block 3 of acme-new-customer-coverage: a phone in the fictional 555 range is not personal data', async () => {
    const verdicts = await run(pii, context(coverage, 3, observed(handover)));
    expect(outcomes(verdicts)).toEqual({
      'pii.iban': 'pass',
      'pii.national_number': 'pass',
      'pii.phone': 'pass',
      'pii.email': 'pass',
    });
  });

  it('passes the acme-number-porting recap: an email at example.com is fictional', async () => {
    const verdicts = await run(pii, context(acme('acme-number-porting'), 3, observed(recap)));
    expect(failing(verdicts)).toEqual([]);
  });

  it('mutation: a Belgian mobile in the reply fails pii.phone, masked, with its offset', async () => {
    const leaked = handover.replace('+1 202 555 0131', BELGIAN_MOBILE);
    const verdicts = await run(pii, context(coverage, 3, observed(leaked)));
    expect(failing(verdicts)).toEqual(['pii.phone']);
    const phone = verdict(verdicts, 'pii.phone');
    expect(phone.evidence).toBe(
      `1 phone number in the visible text: ${redact(BELGIAN_MOBILE)} at offset ${leaked.indexOf(BELGIAN_MOBILE)}`,
    );
    expect(phone.evidence).not.toContain(BELGIAN_MOBILE);
  });

  it('mutation: an email outside the example domains fails pii.email', async () => {
    const leaked = recap.replace('dana.brooks@example.com', PERSONAL_EMAIL);
    const verdicts = await run(pii, context(acme('acme-number-porting'), 3, observed(leaked)));
    expect(failing(verdicts)).toEqual(['pii.email']);
    expect(verdict(verdicts, 'pii.email').evidence).not.toContain(PERSONAL_EMAIL);
  });

  it('mutation: an IBAN with a valid checksum, plain or in groups of four, fails pii.iban', async () => {
    const iban = makeIban('BE', '539007547034');
    expect(isValidIban(iban)).toBe(true);
    const grouped = iban.replace(/(.{4})/g, '$1 ').trim();
    for (const written of [iban, grouped]) {
      const verdicts = await run(pii, context(coverage, 3, observed(`${handover} Pay to ${written} today.`)));
      expect(failing(verdicts)).toEqual(['pii.iban']);
    }
    const typo = `${iban.slice(0, 2)}00${iban.slice(4)}`;
    expect(failing(await run(pii, context(coverage, 3, observed(`Pay to ${typo}.`))))).toEqual([]);
  });

  it('mutation: a national register number with a valid check fails pii.national_number', async () => {
    const number = makeNationalNumber('850730', '033');
    expect(isValidNationalNumber(number)).toBe(true);
    const verdicts = await run(pii, context(coverage, 3, observed(`Your file is ${number}.`)));
    expect(failing(verdicts)).toEqual(['pii.national_number']);
  });

  it('finds Belgian mobiles in national form and keeps findings in order of appearance', () => {
    const text = `Call ${BELGIAN_MOBILE_NATIONAL} or write ${PERSONAL_EMAIL}.`;
    expect(scanPii(text).map((finding) => [finding.kind, finding.offset])).toEqual([
      ['phone', 5],
      ['email', text.indexOf(PERSONAL_EMAIL)],
    ]);
  });

  it('does not apply to a block with no visible text', () => {
    expect(pii.applies(context(coverage, 3, observed('')))).toBe(false);
  });
});

describe('D13: the owner allow-list', () => {
  const OTHER_EMAIL = ['sam.rivera', 'mailhost.dev'].join('@');
  const text = `Sent from ${PERSONAL_EMAIL} to ${OTHER_EMAIL}, call ${BELGIAN_MOBILE}.`;

  it('is empty by default: the owner address still fails', async () => {
    const verdicts = await run(pii, context(coverage, 3, observed(text)));
    expect(failing(verdicts)).toEqual(['pii.phone', 'pii.email']);
  });

  it('leaves out exactly the owner values, and still flags a third party at the same domain', async () => {
    const check = createPiiCheck({ owner: [PERSONAL_EMAIL.toUpperCase(), BELGIAN_MOBILE.replace(/ /g, '')] });
    const verdicts = await run(check, context(coverage, 3, observed(text)));
    expect(failing(verdicts)).toEqual(['pii.email']);
    const email = verdict(verdicts, 'pii.email');
    expect(email?.evidence).toContain('1 email address in the visible text');
    expect(email?.evidence).toContain('1 owner email address left out');
    expect(email?.evidence).not.toContain(PERSONAL_EMAIL);
    expect(verdict(verdicts, 'pii.phone')?.evidence).toBe(
      'no phone number in the visible text; 1 owner phone number left out',
    );
  });

  it('never matches a domain or a part of a value', async () => {
    const check = createPiiCheck({ owner: ['mailhost.dev', '@mailhost.dev', 'lee.morgan', '470'] });
    const verdicts = await run(check, context(coverage, 3, observed(text)));
    expect(failing(verdicts)).toEqual(['pii.phone', 'pii.email']);
  });

  it('defaultChecks passes the owner list to the pii check', async () => {
    const check = defaultChecks({ piiOwner: [PERSONAL_EMAIL] }).find((entry) => entry.name === 'pii');
    const verdicts = await run(
      check as typeof pii,
      context(coverage, 3, observed(`Write to ${PERSONAL_EMAIL}.`)),
    );
    expect(failing(verdicts)).toEqual([]);
  });
});

describe('the reserved-domain exclusion is an option, on by default', () => {
  it('excludes example.org addresses by default, and finds them when the option is off', async () => {
    const { scanPii } = await import('../src/support/pii');
    expect(scanPii('mail marie@example.org now')).toEqual([]);
    expect(scanPii('mail marie@example.org now', { reservedDomains: 'include' }).map((f) => f.kind)).toEqual([
      'email',
    ]);
  });

  it('keeps reserved domains excluded by default and counts them when the check is told to include them', async () => {
    const text = 'Please write to marie@example.org today.';
    const byDefault = await run(createPiiCheck(), context(coverage, 3, observed(text)));
    expect(failing(byDefault)).toEqual([]);
    const included = await run(
      createPiiCheck({ reservedDomains: 'include' }),
      context(coverage, 3, observed(text)),
    );
    expect(failing(included)).toEqual(['pii.email']);
  });
});

describe('the personal-data scan grows linearly', () => {
  it('scans a long run of address characters in time proportional to its length', async () => {
    const { scanPii } = await import('../src/support/pii');
    const start = performance.now();
    expect(scanPii('a'.repeat(40000))).toEqual([]);
    expect(performance.now() - start).toBeLessThan(200);
    expect(scanPii(`${'a.b'.repeat(5000)} x@y.fr`).map((f) => f.value)).toEqual(['x@y.fr']);
    expect(scanPii('mail anna.k@mail.be now').map((f) => f.value)).toEqual(['anna.k@mail.be']);
  });
});
