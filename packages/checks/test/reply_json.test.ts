import { describe, expect, it } from 'vitest';
import { replyJson } from '../src/checks/reply_json';
import { acme } from './support/acme';
import { context, failing, observed, outcomes, run, verdict } from './support/context';

const coverage = acme('acme-new-customer-coverage');
const reply = (text: string, json: Record<string, unknown>) =>
  context(coverage, 1, observed(text), { expect: { json } as never });

describe('json', () => {
  it('passes a reply that is valid JSON with a path that equals its value', async () => {
    const verdicts = await run(
      replyJson,
      reply('{"plan":"mobile","price":35}', { paths: [{ path: 'price', assert: 35 }] }),
    );
    expect(outcomes(verdicts)).toEqual({ 'json.valid': 'pass', 'json.path.0': 'pass' });
    expect(verdict(verdicts, 'json.valid').evidence).toBe('the reply is valid JSON');
  });

  it('fails a reply that is not JSON, and fails each path it cannot read', async () => {
    const verdicts = await run(
      replyJson,
      reply('Your price is 35.', { paths: [{ path: 'price', assert: 35 }] }),
    );
    expect(failing(verdicts)).toEqual(['json.valid', 'json.path.0']);
    expect(verdict(verdicts, 'json.valid').evidence).toMatch(/^the reply is not valid JSON: /);
  });

  it('reads JSON inside a single Markdown code fence', async () => {
    const verdicts = await run(replyJson, reply('```json\n{"plan":"mobile"}\n```', {}));
    expect(outcomes(verdicts)).toEqual({ 'json.valid': 'pass' });
  });

  it('checks a JSON Schema and names the missing key', async () => {
    const schema = { type: 'object', required: ['plan'], properties: { plan: { type: 'string' } } };
    const verdicts = await run(replyJson, reply('{"price":35}', { schema }));
    expect(outcomes(verdicts)).toEqual({ 'json.valid': 'pass', 'json.schema': 'fail' });
    expect(verdict(verdicts, 'json.schema').evidence).toContain('plan');
  });

  it('checks a path that contains a text', async () => {
    const pass = await run(
      replyJson,
      reply('{"note":"Fiber available"}', { paths: [{ path: 'note', assert: { contains: 'Fiber' } }] }),
    );
    const fail = await run(
      replyJson,
      reply('{"note":"5G only"}', { paths: [{ path: 'note', assert: { contains: 'Fiber' } }] }),
    );
    expect(outcomes(pass)['json.path.0']).toBe('pass');
    expect(failing(fail)).toEqual(['json.path.0']);
  });

  it('reads a numeric index in a path', async () => {
    const verdicts = await run(
      replyJson,
      reply('{"plans":[{"name":"Mobile L"}]}', { paths: [{ path: 'plans.0.name', assert: 'Mobile L' }] }),
    );
    expect(outcomes(verdicts)['json.path.0']).toBe('pass');
  });

  it('checks the strict schema on the JSON value found in prose', async () => {
    const schema = {
      type: 'object',
      required: ['plan'],
      properties: { plan: { type: 'string' } },
      additionalProperties: false,
    };
    const pass = await run(replyJson, reply('Here: {"plan":"mobile"}', { embedded: true, schema }));
    const fail = await run(replyJson, reply('Here: {"plan":"mobile","extra":1}', { embedded: true, schema }));
    expect(outcomes(pass)).toEqual({ 'json.valid': 'pass', 'json.schema': 'pass' });
    expect(outcomes(fail)).toEqual({ 'json.valid': 'pass', 'json.schema': 'fail' });
  });

  it('gives no verdict when the block declares no json', async () => {
    expect(await run(replyJson, context(coverage, 1, observed('{}')))).toEqual([]);
  });

  it('mutation: a price of 36 fails the same path that 35 passes', async () => {
    const passing = await run(replyJson, reply('{"price":35}', { paths: [{ path: 'price', assert: 35 }] }));
    const failed = await run(replyJson, reply('{"price":36}', { paths: [{ path: 'price', assert: 35 }] }));
    expect(outcomes(passing)['json.path.0']).toBe('pass');
    expect(failing(failed)).toEqual(['json.path.0']);
  });
});

describe('json path that reads nothing', () => {
  const asserts: [string, unknown][] = [
    ['a boolean', true],
    ['a number', 7],
    ['a text', 'x'],
    ['null', null],
    ['an exact', { exact: 1 }],
  ];
  for (const [name, assert] of asserts) {
    it(`fails ${name} assertion without throwing`, async () => {
      const verdicts = await run(
        replyJson,
        reply('{"a":1}', { paths: [{ path: 'missing', assert }] as never }),
      );
      expect(outcomes(verdicts)).toEqual({ 'json.valid': 'pass', 'json.path.0': 'fail' });
    });
  }
  it('passes an absent assertion, through a scalar and past an array end', async () => {
    const verdicts = await run(
      replyJson,
      reply('{"a":1,"l":[1]}', {
        paths: [
          { path: 'a.b', assert: { absent: true } },
          { path: 'l.3', assert: { absent: true } },
        ] as never,
      }),
    );
    expect(outcomes(verdicts)).toEqual({
      'json.valid': 'pass',
      'json.path.0': 'pass',
      'json.path.1': 'pass',
    });
  });
});

describe('json embedded mode', () => {
  const embedded = (text: string, json: Record<string, unknown> = {}) =>
    reply(text, { embedded: true, ...json });

  it('finds a JSON object inside prose and reads its path', async () => {
    const verdicts = await run(
      replyJson,
      embedded('Here you go: {"plan":"mobile","price":35}. Thanks.', {
        paths: [{ path: 'price', assert: 35 }],
      }),
    );
    expect(outcomes(verdicts)).toEqual({ 'json.valid': 'pass', 'json.path.0': 'pass' });
    expect(verdict(verdicts, 'json.valid').evidence).toBe('a JSON value was found in the reply');
  });

  it('is strict by default: the same prose is not JSON', async () => {
    const verdicts = await run(replyJson, reply('Here you go: {"plan":"mobile"}. Thanks.', {}));
    expect(outcomes(verdicts)).toEqual({ 'json.valid': 'fail' });
  });

  it('reads the first JSON value when there are two, and both are found', async () => {
    const verdicts = await run(
      replyJson,
      embedded('{"a":1} and then {"b":2}', { paths: [{ path: 'a', assert: 1 }] }),
    );
    expect(outcomes(verdicts)).toEqual({ 'json.valid': 'pass', 'json.path.0': 'pass' });
  });

  it('finds a top-level array inside prose', async () => {
    const verdicts = await run(
      replyJson,
      embedded('Values: [1,2,3] done', { paths: [{ path: '2', assert: 3 }] }),
    );
    expect(outcomes(verdicts)).toEqual({ 'json.valid': 'pass', 'json.path.0': 'pass' });
  });

  it('reads a nested value through objects and arrays', async () => {
    const verdicts = await run(
      replyJson,
      embedded('Result: {"nested":{"x":[1,{"y":2}]}}', { paths: [{ path: 'nested.x.1.y', assert: 2 }] }),
    );
    expect(outcomes(verdicts)['json.path.0']).toBe('pass');
  });

  it('keeps the strict reading: a reply that is a bare number is JSON in embedded mode too', async () => {
    const verdicts = await run(replyJson, embedded('42', {}));
    expect(outcomes(verdicts)).toEqual({ 'json.valid': 'pass' });
  });

  it('does not read braces that are not JSON as JSON', async () => {
    const verdicts = await run(replyJson, embedded('The price is {35} euros.', {}));
    expect(outcomes(verdicts)).toEqual({ 'json.valid': 'fail' });
    expect(verdict(verdicts, 'json.valid').evidence).toBe('the reply has no JSON value');
  });

  it('mutation: embedded mode off fails the object that embedded mode finds', async () => {
    const on = await run(replyJson, embedded('Here: {"x":1}', {}));
    const off = await run(replyJson, reply('Here: {"x":1}', {}));
    expect(outcomes(on)).toEqual({ 'json.valid': 'pass' });
    expect(outcomes(off)).toEqual({ 'json.valid': 'fail' });
  });
});
