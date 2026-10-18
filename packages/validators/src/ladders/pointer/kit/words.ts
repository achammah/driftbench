import { rngFor } from '@agent-nexus/driftbench-generate';

/** A seeded stream of numbers in [0, 1). */
export type Rng = () => number;

/**
 * Seeded fictional prose for the pointer bank. Sentences come from a wide vocabulary and several shapes, so two
 * sentences drawn apart share little text; their normalised Levenshtein similarity is measured, never assumed
 * (see `unrelated`). Every sentence starts with an upper-case letter and ends with a lower-case word of at least
 * four letters followed by a full stop: a reader that merges a sentence break after a short capitalised word
 * (a title such as `Dr.`) must find none in this prose.
 */

const split = (text: string) => text.trim().split(/\s+/);

const NOUNS = split(`
  ledger tray basket pallet crate shelf counter register drawer locker cabinet trolley scale hopper oven furnace
  kettle mixer whisk ladle sieve funnel jar flask carton parcel envelope voucher ticket badge stamp seal lantern
  compass anchor rope bucket barrel cask keg bottle cork tray panel hatch lever pulley gauge dial valve pipe
  boiler filter cushion blanket curtain mirror clock timer bell whistle magnet needle thread button zipper
  satchel wallet folder binder notebook diary journal atlas pamphlet poster banner ribbon garland wreath candle
  platter saucer goblet pitcher casserole skillet griddle colander grater peeler cleaver mallet chisel hammer
  wrench spanner pliers shovel trowel rake barrow ladder scaffold hinge latch bracket rivet gasket spindle
  loaf biscuit pastry muffin scone bagel brioche tart pudding custard compote marmalade chutney relish pickle
  orchard meadow harbour quarry tunnel bridge viaduct causeway lighthouse kiosk pavilion rotunda gallery atrium
`);
const ADJ = split(`
  copper wooden crooked narrow spare sealed bulky faded glossy brittle dusty sturdy hollow gilded woven rusty
  weathered tangled polished cracked sticky frozen sunlit shaded quiet crowded distant nearby ancient modern
  foldable stackable portable fragile heavy slender broad shallow curved angular striped speckled plain ornate
  unmarked labelled numbered colourful pale vivid mottled velvet leather linen paper tin iron marble ceramic
`);
const VERB_IMP = split(`
  weigh count label sort seal stack wrap check measure record file shelve fetch carry lift lower rinse dry
  polish sweep unlock secure fasten loosen tighten replace restock refill inspect photograph catalogue index
  bundle tie untie fold unfold press roll slice dice knead proof glaze dust sift pour stir taste sample
`);
const VERB_S = split(`
  waits rests hangs leans sits stays drifts rattles hums squeaks glows flickers tilts wobbles slides settles
  gathers scatters lingers returns arrives departs shifts vanishes reappears overflows empties fills
`);
const ADV = split(`
  quietly slowly carefully gently twice once daily weekly firmly lightly neatly evenly promptly patiently
  separately together early late first last thoroughly briefly steadily
`);
const PREP = split(`beside beneath behind above across along beyond within near under over against toward`);
const WHEN = split(
  `
  before the doors open|after the delivery arrives|once the kettle boils|while the oven cools|until the bell rings
  whenever the lantern flickers|as soon as the tray is empty|after the last customer leaves|before the shift ends
  when the barrel is full|once the ledger is signed|while the harbour is quiet
`
    .replace(/\n/g, ' ')
    .split('|')
    .map((s) => s.trim())
    .join('|'),
)
  .join(' ')
  .split('|');
const PLACES = split(`
  harbour orchard cellar attic pantry workshop gallery courtyard greenhouse stockroom loft annex vestibule landing
`);
const TAILS = split(`
  yesterday tomorrow tonight outside inside upstairs downstairs elsewhere overnight meanwhile afterwards
`);

const take = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)] as T;
const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const long = (rng: Rng, items: readonly string[]): string => {
  for (let tries = 0; tries < 20; tries += 1) {
    const word = take(rng, items);
    if (word.length >= 4) return word;
  }
  return 'quietly';
};

/** One fictional sentence, 55 to 150 characters, starting with a capital and ending `<word>.` with a word of 4 letters or more. */
export function sentence(rng: Rng): string {
  const n1 = take(rng, NOUNS);
  const n2 = take(rng, NOUNS);
  const n3 = take(rng, NOUNS);
  const a1 = take(rng, ADJ);
  const a2 = take(rng, ADJ);
  const shape = Math.floor(rng() * 9);
  let text: string;
  switch (shape) {
    case 0:
      text = `${cap(take(rng, VERB_IMP))} the ${a1} ${n1} ${take(rng, PREP)} the ${a2} ${n2} ${take(rng, WHEN)}`;
      break;
    case 1:
      text = `The ${a1} ${n1} ${take(rng, VERB_S)} ${take(rng, ADV)} ${take(rng, PREP)} the ${n2} of the ${take(rng, PLACES)}`;
      break;
    case 2:
      text = `Each ${n1} in the ${take(rng, PLACES)} is kept ${take(rng, PREP)} a ${a1} ${n2} ${take(rng, WHEN)}`;
      break;
    case 3:
      text = `If a ${a1} ${n1} ${take(rng, VERB_S)} ${take(rng, PREP)} the ${n2}, ${take(rng, VERB_IMP)} it ${long(rng, ADV)}`;
      break;
    case 4:
      text = `${cap(a1)} ${n1}s and ${a2} ${n2}s ${take(rng, VERB_S).replace(/s$/, '')} ${take(rng, PREP)} the ${n3} ${take(rng, TAILS)}`;
      break;
    case 5:
      text = `${cap(take(rng, VERB_IMP))} every ${n1} ${take(rng, ADV)}, then ${take(rng, VERB_IMP)} the ${a1} ${n2} ${take(rng, PREP)} the ${n3} ${long(rng, TAILS)}`;
      break;
    case 6:
      text = `A ${n1} from the ${take(rng, PLACES)} ${take(rng, VERB_S)} ${take(rng, ADV)} while the ${a1} ${n2} ${take(rng, VERB_S)} ${take(rng, PREP)} the ${n3}`;
      break;
    case 7:
      text = `Nothing in the ${take(rng, PLACES)} ${take(rng, VERB_S)} ${take(rng, PREP)} the ${a1} ${n1} unless the ${a2} ${n2} ${take(rng, VERB_S)} ${long(rng, TAILS)}`;
      break;
    default:
      text = `${cap(take(rng, VERB_IMP))} the ${n1} and the ${a1} ${n2} ${take(rng, ADV)}, because the ${n3} ${take(rng, VERB_S)} ${take(rng, WHEN)}`;
  }
  const words = text.split(' ');
  const lastWord = words[words.length - 1] ?? '';
  if (lastWord.length < 4 || /[^a-z]/.test(lastWord)) words.push(long(rng, TAILS));
  return `${words.join(' ').replace(/\s+/g, ' ')}.`;
}

/** A long sentence: two sentences joined by `, and`. Starts with a capital, ends with a word of 4 letters or more and a full stop. */
export function longMake(rng: Rng): string {
  const a = sentence(rng);
  const b = sentence(rng);
  return `${a.replace(/\.$/, '')}, and ${b.charAt(0).toLowerCase()}${b.slice(1)}`;
}

/** A short imperative, 4 to 8 words, still ending in a lower-case word of 4 letters or more. */
export function shortRule(rng: Rng): string {
  const verb = cap(take(rng, VERB_IMP));
  const noun = take(rng, NOUNS);
  const tail = rng() < 0.5 ? long(rng, ADV) : long(rng, TAILS);
  return rng() < 0.5 ? `${verb} each ${noun} ${tail}.` : `${verb} the ${take(rng, ADJ)} ${noun} ${tail}.`;
}

/** A heading text of 2 to 4 words, title case. */
export function headingText(rng: Rng): string {
  return `${cap(take(rng, ADJ))} ${take(rng, NOUNS)} ${take(rng, ['notes', 'steps', 'checks', 'duties', 'rounds'])}`;
}

/** A single lower-case word of at least four letters. */
export function word(rng: Rng): string {
  return long(rng, NOUNS);
}

/** Normalised Levenshtein similarity in [0, 1]: 1 minus the edit distance over the longer length. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  if (a.length < b.length) [a, b] = [b, a];
  const m = b.length;
  let previous = new Uint16Array(m + 1);
  let current = new Uint16Array(m + 1);
  for (let j = 0; j <= m; j += 1) previous[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= m; j += 1) {
      const sub = (previous[j - 1] as number) + (ca === b.charCodeAt(j - 1) ? 0 : 1);
      const del = (previous[j] as number) + 1;
      const ins = (current[j - 1] as number) + 1;
      current[j] = sub < del ? (sub < ins ? sub : ins) : del < ins ? del : ins;
    }
    const swap = previous;
    previous = current;
    current = swap;
  }
  return previous[m] as number;
}

type Grams = { map: Map<string, number>; total: number };

function gramsOf(s: string): Grams {
  const map = new Map<string, number>();
  let total = 0;
  for (let i = 0; i + 3 <= s.length; i += 1) {
    const g = s.slice(i, i + 3);
    map.set(g, (map.get(g) ?? 0) + 1);
    total += 1;
  }
  return { map, total };
}

function diceOf(a: Grams, b: Grams): number {
  if (a.total + b.total === 0) return 1;
  let shared = 0;
  for (const [g, n] of a.map) shared += Math.min(n, b.map.get(g) ?? 0);
  return (2 * shared) / (a.total + b.total);
}

/** Cheap rejection signal: Dice coefficient over character trigrams. */
export function dice(a: string, b: string): number {
  return diceOf(gramsOf(a), gramsOf(b));
}

/**
 * A pool of sentences drawn apart: each new sentence has trigram Dice under `limit` against the last `window`
 * sentences of the pool. Two sentences far apart in a long document may be alike; `unrelatedTo` is for the pairs
 * an item needs to be unrelated.
 */
export class Prose {
  private readonly rng: Rng;
  private readonly used: Array<{ text: string; grams: Grams }> = [];
  constructor(
    seed: number,
    label: string,
    private readonly limit = 0.45,
    private readonly window = 120,
  ) {
    this.rng = rngFor(seed, `prose:${label}`);
  }

  get random(): Rng {
    return this.rng;
  }

  private remember(text: string, grams: Grams): void {
    this.used.push({ text, grams });
  }

  /** The next sentence, unlike the recent sentences of this pool. */
  next(make: (rng: Rng) => string = sentence): string {
    for (let tries = 0; tries < 60; tries += 1) {
      const candidate = make(this.rng);
      const grams = gramsOf(candidate);
      const recent = this.used.slice(-this.window);
      if (recent.every((other) => diceOf(grams, other.grams) < this.limit)) {
        this.remember(candidate, grams);
        return candidate;
      }
    }
    const fallback = `${make(this.rng).replace(/\.$/, '')} ${this.used.length + 1}x${this.used.length + 7}z.`;
    this.remember(fallback, gramsOf(fallback));
    return fallback;
  }

  many(count: number, make?: (rng: Rng) => string): string[] {
    return Array.from({ length: count }, () => this.next(make));
  }

  /** A sentence whose Levenshtein similarity to every given text is under `limit`. */
  unrelatedTo(texts: readonly string[], limit = 0.3, make: (rng: Rng) => string = sentence): string {
    for (let tries = 0; tries < 400; tries += 1) {
      const candidate = this.next(make);
      if (texts.every((t) => similarity(candidate, t) < limit)) return candidate;
    }
    throw new Error('no sentence unrelated enough');
  }
}

/** Replaces `count` words of a sentence by other words, keeping its first letter and final full stop. */
export function rewordWords(rng: Rng, text: string, count: number): string {
  const words = text.replace(/\.$/, '').split(' ');
  const slots = words
    .map((w, i) => ({ w, i }))
    .filter(({ w, i }) => i > 0 && /^[a-z]+$/.test(w) && w.length >= 4);
  for (let n = 0; n < count && slots.length > 0; n += 1) {
    const at = Math.floor(rng() * slots.length);
    const slot = slots.splice(at, 1)[0];
    if (!slot) break;
    let replacement = take(rng, NOUNS);
    while (replacement === slot.w) replacement = take(rng, NOUNS);
    words[slot.i] = replacement;
  }
  return `${words.join(' ')}.`;
}

/** A sentence reworded until its similarity to the source falls in [low, high]; the source when none fits. */
export function rewordToSimilarity(rng: Rng, text: string, low: number, high: number): string {
  const body = text.replace(/\.$/, '').split(' ');
  const eligible = body
    .map((w, i) => ({ w, i }))
    .filter(({ w, i }) => i > 0 && /^[a-z]+$/.test(w) && w.length >= 4);
  let current = text;
  const order = eligible.map((_, i) => i).sort(() => rng() - 0.5);
  const words = [...body];
  for (const idx of order) {
    const slot = eligible[idx];
    if (!slot) continue;
    words[slot.i] =
      long(
        rng,
        NOUNS.filter((n) => n !== slot.w),
      ) + (rng() < 0.5 ? 'ish' : 'ery');
    current = `${words.join(' ')}.`;
    const s = similarity(text, current);
    if (s >= low && s <= high) return current;
    if (s < low) return current;
  }
  return current;
}
