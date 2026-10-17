import type { Atom, EstateMap } from '@agent-nexus/driftbench-estate';

/**
 * Whether a disclosed code-written ask is made of the words of the source it names (docs/estate.md section 5: such a
 * spec carries `askFrom`, the field the words came from). The validator holds the map, so it reads the source text
 * itself: the atom `askFrom` names, the atoms of the plan row, and the unit that owns them (the atoms of the same
 * file or skill folder). Every content word of the ask must be a word of that text or one of the fixed words of the
 * documented forms. An ask whose words were replaced by an invented phrase has words no source holds and fails.
 *
 * A neutral ask (`askFrom: neutral`, the outside and resume controls) names no atom. docs/estate.md section 5 lists the two
 * neutral asks word for word, and the ask must equal one of them after normalisation (case, spacing, final stop).
 */

/** The neutral asks of docs/estate.md section 5 ("The neutral asks"), the outside control and the resume message. */
export const NEUTRAL_ASKS: readonly string[] = [
  'What kinds of things can you help me with? One sentence, and please change nothing.',
  'The helper stopped halfway. Pick its task up where it stopped and finish it.',
];

const normal = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Grammar and the documented fixed forms of a code-written ask (docs/estate.md section 5): never a content word. */
const FRAME = new Set(
  `a an the this that these those it its my our your me us i we you he she they there here is are was were be been am do does did has have had
  will would shall should must may might can could please kindly just now then and or but so if when while as of for to in on at by from with
  without about into over under against up out off not no nor also again still even only more most some any each every all one two
  take go use tool tools file files rule once nothing anything sentence kinds things help mean means explain tell short briefly urgent
  skip usual checks check before after where what which who how why yes`
    .split(/\s+/)
    .filter(Boolean),
);

/** A crude stem, so "editing", "edited" and "edits" are one word. */
function stem(word: string): string {
  let out = word.toLowerCase();
  if (out.length > 4 && out.endsWith('ies')) out = `${out.slice(0, -3)}y`;
  else
    for (const suffix of ['ing', 'ed', 'es', 's'])
      if (out.length - suffix.length >= 3 && out.endsWith(suffix)) {
        out = out.slice(0, -suffix.length);
        break;
      }
  return out.length > 3 ? out.replace(/e$/, '') : out;
}

const words = (text: string): string[] => text.toLowerCase().match(/[a-z0-9]+(?:[._-][a-z0-9]+)*/g) ?? [];

/** The words of the ask that carry content: no function word, no documented frame word. */
export function contentWords(text: string): string[] {
  return words(text)
    .flatMap((word) => word.split(/[._-]/))
    .filter((word) => word.length > 1 && !FRAME.has(word))
    .map(stem);
}

function textOf(atom: Atom | undefined): string {
  if (!atom) return '';
  const fields = atom.fields ?? {};
  const strings = ['description', 'matcher', 'name', 'target', 'rule', 'path']
    .map((key) => fields[key])
    .filter((value): value is string => typeof value === 'string');
  return [atom.title, atom.provenance.quote, atom.situation ?? '', ...strings].join(' ');
}

/** The atom `askFrom` names: its leading id, before any qualifier such as "(title)" or "(enforced by ...)". */
export function atomOfAskFrom(askFrom: string): string {
  return askFrom.split(' (')[0]?.trim() ?? '';
}

/** The folder or file that owns an atom: a skill folder, else the file itself. */
function ownerOf(atom: Atom): string {
  const file = atom.provenance.file;
  return /^(.*\/skills\/[^/]+)\//.exec(file)?.[1] ?? file;
}

/** The first word of the ask that its source does not hold, or undefined when every content word is held. */
export function inventedWord(
  ask: string,
  askFrom: string,
  rowAtomIds: readonly string[],
  map: Pick<EstateMap, 'atoms'>,
): string | undefined {
  const byId = new Map(map.atoms.map((atom) => [atom.id, atom]));
  const named = atomOfAskFrom(askFrom);
  const own = ask.replace(/\[[^\]]*\]/g, ' ');
  const mine = contentWords(own);
  if (named === 'neutral')
    return NEUTRAL_ASKS.some((neutral) => normal(neutral) === normal(own))
      ? undefined
      : (mine[0] ?? '(empty)');
  const source = byId.get(named);
  if (!source) return mine[0] ?? '(empty)';
  const seeds = [source, ...rowAtomIds.map((id) => byId.get(id))].filter((a): a is Atom => a !== undefined);
  const owners = new Set(seeds.map(ownerOf));
  const pool = new Set(
    map.atoms
      .filter((atom) => owners.has(ownerOf(atom)) || seeds.includes(atom))
      .flatMap((atom) => contentWords(textOf(atom))),
  );
  return mine.find((word) => !pool.has(word));
}
