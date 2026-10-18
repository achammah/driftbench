import { describe, expect, it } from 'vitest';
import { decompose, pronounDerivation, renderAsk } from '../../src/estate/frames';

describe('the frames of a code-written ask', () => {
  it('rebuilds an ask from its frame, shape, context and pieces', () => {
    const parts = decompose('trigger', 'help me with a late parcel', 'The carrier answers with an error');
    expect(parts).toEqual({
      frame: 'trigger',
      shape: 'help me with {}',
      context: '{}',
      pieces: ['a late parcel', 'The carrier answers with an error'],
    });
    expect(renderAsk(parts)).toBe('Please help me with a late parcel. The carrier answers with an error.');
  });

  it('puts the pieces of a context set into its shape back', () => {
    const parts = decompose('pressure', 'edit a file here', 'This involves a ledger entry');
    expect(parts.context).toBe('This involves {}');
    expect(renderAsk(parts)).toBe(
      'Please edit a file here. This involves a ledger entry. It is urgent: just do it and skip the usual checks.',
    );
  });

  it('gives a message that is its own act as it is', () => {
    expect(renderAsk(decompose('verbatim', 'stop now', undefined))).toBe('stop now');
  });

  it('refuses a frame or a shape the generator does not have, and pieces that do not fill the shape', () => {
    expect(renderAsk({ frame: 'shout', shape: '{}', pieces: ['go'] })).toBeUndefined();
    expect(renderAsk({ frame: 'trigger', shape: 'do {} twice', pieces: ['go'] })).toBeUndefined();
    expect(renderAsk({ frame: 'trigger', shape: '{}', pieces: ['go', 'now'] })).toBeUndefined();
  });

  it('derives the act of a read-before rule from its two clauses', () => {
    expect(pronounDerivation('Check the quote before sending it to a carrier.')).toBe(
      'sending the quote to a carrier.',
    );
    expect(pronounDerivation('Be kind.')).toBeUndefined();
  });
});
