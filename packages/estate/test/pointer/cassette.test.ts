import { describe, expect, it } from 'vitest';
import { Cassette, CassetteMiss, readableOf, type Wire, wireKey } from '../../src/pointer';

const WIRE: Wire = {
  labeler: 'planted',
  body: { model: 'm-1', system: 'Label the units.', user: 'SET a\n[1] Lock the door.', max_tokens: 100 },
};
const META = {
  path: 'hall.md',
  window: 'hall.md#1',
  promptVersion: 'p1',
  schemaVersion: 's1',
  set: 'a',
  setHash: 'h1',
  model: 'm-1',
  cutDigest: 'cd1',
};
const ANSWER = {
  labels: [{ units: '1', label: 'x' }],
  returnedModel: 'm-1',
  stopReason: 'end_turn',
  usage: { input: 10, output: 5 },
};

function recorded(): Cassette {
  const cassette = new Cassette();
  cassette.put(WIRE, readableOf(WIRE, META), ANSWER);
  return cassette;
}

describe('the cassette', () => {
  it('answers the request it recorded', () => {
    expect(recorded().get(WIRE, readableOf(WIRE, META)).answer).toEqual(ANSWER);
  });

  it('dumps the same bytes for the same content, and reads them back', () => {
    const text = recorded().render();
    expect(recorded().render()).toBe(text);
    expect(Cassette.parse(text).render()).toBe(text);
  });

  it('stores no text of the file, only the answer and the readable fields', () => {
    expect(recorded().render()).not.toContain('Lock the door');
  });

  it('misses on any one field of the request and names that field', () => {
    const cassette = recorded();
    const perturbed: Array<[string, Wire, Partial<typeof META>]> = [
      ['part.system', { ...WIRE, body: { ...WIRE.body, system: 'Label the units well.' } }, {}],
      ['part.user', { ...WIRE, body: { ...WIRE.body, user: 'SET a\n[1] Lock the gate.' } }, {}],
      ['part.model', { ...WIRE, body: { ...WIRE.body, model: 'm-2' } }, { model: 'm-2' }],
      ['part.max_tokens', { ...WIRE, body: { ...WIRE.body, max_tokens: 200 } }, {}],
      ['setHash', WIRE, { setHash: 'h2' }],
    ];
    for (const [field, wire, meta] of perturbed) {
      const readable = readableOf(wire, { ...META, ...meta });
      let miss: CassetteMiss | undefined;
      try {
        // The set hash is in the request in real use; here a changed hash alone is read through the key of a changed body.
        cassette.get(
          field === 'setHash' ? { ...WIRE, body: { ...WIRE.body, user: 'other' } } : wire,
          readable,
        );
      } catch (cause) {
        miss = cause as CassetteMiss;
      }
      expect(miss, field).toBeInstanceOf(CassetteMiss);
      expect(miss?.differs, field).toContain(field === 'setHash' ? 'setHash' : field);
    }
  });

  it('names no nearest entry for a file, window and set it has never seen', () => {
    const readable = readableOf(WIRE, { ...META, window: 'other.md#1', path: 'other.md' });
    expect(() => recorded().get({ ...WIRE, body: { ...WIRE.body, user: 'x' } }, readable)).toThrow(
      /no entry for the same file, window and set/,
    );
  });

  it('refuses a hit whose cut digest differs: the cutter changed under the same request', () => {
    const cassette = recorded();
    expect(() => cassette.get(WIRE, readableOf(WIRE, { ...META, cutDigest: 'cd2' }))).toThrow(
      /differs in: cutDigest/,
    );
  });

  it('keys the whole request, labeler id included', () => {
    expect(wireKey(WIRE)).not.toBe(wireKey({ ...WIRE, labeler: 'other' }));
    expect(wireKey({ labeler: 'a', body: { x: 1, y: 2 } })).toBe(
      wireKey({ labeler: 'a', body: { y: 2, x: 1 } }),
    );
  });

  it('refuses a file that is not JSON lines', () => {
    expect(() => Cassette.parse('not json\n')).toThrow(/line 1/);
    expect(() => Cassette.parse('{"a":1}\n')).toThrow(/not an entry/);
  });
});
