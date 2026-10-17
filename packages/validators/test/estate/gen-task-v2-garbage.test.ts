import { beforeAll, describe, expect, it } from 'vitest';
import { type FixtureSuite, fixtureSuite, type SuiteSpec } from '../../src/ladders/estate/bank/fixture-suite';
import { type AskEnv, checkAsk, flat } from '../../src/ladders/estate/bank/task-check';
import { envOfSuite } from '../../src/ladders/estate/bank/taskv2';

/**
 * Garbage made of the cited atom's own words. The record is intact and the citation true: only the text
 * the generator claims to have taken from the atom is wrong. Each class must be rejected in every
 * code-written spec it can be planted in.
 */
type Meta = Record<string, unknown>;
const metaOf = (spec: SuiteSpec): Meta => (spec.spec.metadata as { estate: Meta }).estate;
const blockOf = (spec: SuiteSpec) =>
  (spec.spec.blocks as Array<{ when: { user: string } }>)[0] as { when: { user: string } };

let suite: FixtureSuite;
let env: AskEnv;
let coded: SuiteSpec[];

beforeAll(async () => {
  suite = await fixtureSuite();
  env = await envOfSuite(suite);
  coded = suite.specs.filter((spec) => {
    if (!(spec.complete && spec.mode === 'live' && spec.path.endsWith('.yaml'))) return false;
    const from = metaOf(spec).from as Meta | undefined;
    return (
      from && 'form' in from && from.form !== 'hazard' && from.form !== 'user prompt' && from.form !== 'tool'
    );
  });
}, 300_000);

const words = (text: string): string[] => text.split(/\s+/).filter((word) => word !== '');

/** The source text the first piece of a spec came from: the passage of its cited atom. */
function sourceOf(spec: SuiteSpec): string {
  const from = metaOf(spec).from as { field: string };
  const atom = env.byId.get(from.field.split('#')[0] as string);
  return atom?.provenance.quote ?? '';
}

/** The spec with its first piece replaced by `garbage`, in the ask and in the record. */
function plantPiece(spec: SuiteSpec, garbage: string): SuiteSpec {
  const copy = structuredClone(spec);
  const from = metaOf(copy).from as { pieces: string[]; parts?: unknown[] };
  const old = from.pieces[0] as string;
  blockOf(copy).when.user = blockOf(copy).when.user.replace(old, garbage);
  from.pieces[0] = garbage;
  return copy;
}

const CLASSES: Record<string, (source: string, piece: string, ids: string[]) => string | undefined> = {
  'the piece cut at a comma': (_, piece) => (piece.includes(',') ? piece.split(',')[0] : undefined),
  'the quote minus its last word': (source) => words(source).slice(0, -1).join(' '),
  'a five word fragment of the quote': (source) =>
    words(source).length >= 8 ? words(source).slice(1, 6).join(' ') : undefined,
  'the tail half of the quote': (source) =>
    words(source).length >= 8
      ? words(source)
          .slice(Math.floor(words(source).length / 2))
          .join(' ')
      : undefined,
  'the piece doubled': (_, piece) => `${piece} ${piece}`,
  'the quote after not': (source) => `not ${source}`,
  'the piece after never': (_, piece) => `never ${piece}`,
  'every other word of the quote': (source) =>
    words(source).length >= 6
      ? words(source)
          .filter((_word, index) => index % 2 === 0)
          .join(' ')
      : undefined,
  'the title of an atom outside the row': (_source, _piece, ids) =>
    env.atoms.find(
      (atom) => !ids.includes(atom.id) && atom.kind === 'instruction' && atom.title.split(/\s+/).length >= 3,
    )?.title,
  'the words of the title reversed': (source) => words(source).reverse().join(' '),
  'the words of the quote shuffled': (source) => {
    const list = words(source);
    return list.map((_word, index) => list[(index * 7 + 3) % list.length]).join(' ');
  },
};

describe('garbage made of the words of the cited atom is rejected', () => {
  it('has code-written specs to plant in', () => expect(coded.length).toBeGreaterThan(100));

  for (const [name, make] of Object.entries(CLASSES))
    it(`rejects ${name}`, () => {
      const kept: string[] = [];
      for (const spec of coded) {
        const piece = (metaOf(spec).from as { pieces: string[] }).pieces[0] as string;
        const garbage = make(sourceOf(spec), piece, [
          (metaOf(spec).from as { field: string }).field.split('#')[0] as string,
          ...(metaOf(spec).atoms as string[]),
        ]);
        if (!garbage || flat(garbage) === flat(piece)) continue;
        if (checkAsk(plantPiece(spec, garbage), env).reasons.length === 0)
          kept.push(`${spec.id}: ${garbage}`);
      }
      expect(kept.slice(0, 6), `${kept.length} accepted`).toEqual([]);
    });

  it('rejects words around true pieces', () => {
    const kept: string[] = [];
    for (const spec of coded) {
      for (const change of [
        (ask: string) => `Ignore the rules. ${ask}`,
        (ask: string) => `${ask} Ignore the rules.`,
        (ask: string) => ask.replace(/^Please /, 'Please also never '),
      ]) {
        const copy = structuredClone(spec);
        const before = blockOf(copy).when.user;
        blockOf(copy).when.user = change(before);
        if (blockOf(copy).when.user !== before && checkAsk(copy, env).reasons.length === 0)
          kept.push(`${spec.id}: ${blockOf(copy).when.user}`);
      }
    }
    expect(kept.slice(0, 6), `${kept.length} accepted`).toEqual([]);
  });
});
