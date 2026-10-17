import { ROOT, STANDING } from '../layout';

/**
 * A shared-index estate (the index lives with the memory files, a kind the reader reads): the shape that turned a reference graph into hundreds of thousands of edges. Every skill
 * and every helper (57 at full size) cites one shared index document, the index cites thousands of files, and a few
 * of those cite further documents that nothing else names. Every citation is planted, so the files each unit reaches
 * by following citations are known exactly. Names come from the seed; the files hold no prose that reads as a rule.
 *
 * Beside the plain entries the estate holds the shapes a graph walk gets wrong: a chain two and three documents deep,
 * a cycle of two documents, a document that cites itself, a document two entries cite (fan-in), a citation of a file
 * the estate does not hold, a relative form of a citation, a document one file cites twice, a unit that cites a file
 * the index also cites (mixed owners), and two documents nothing names (the orphans).
 */

export type SharedOptions = { scale?: number };

/** What a planted file is, for the item that is about that shape alone. */
export type ShapeClass =
  | 'index'
  | 'entry'
  | 'chain-two'
  | 'chain-three'
  | 'own'
  | 'cycle'
  | 'self'
  | 'fan-in'
  | 'relative'
  | 'duplicate'
  | 'orphan';

export type SharedTruth = {
  files: string[];
  /** Skills and helpers: the file of each, and the files its own citations name directly. */
  units: Array<{ name: string; file: string; direct: string[] }>;
  /** Every file a document names, by the citing file. */
  cites: Record<string, string[]>;
  /** The files a unit reaches by following citations (its own file excluded), exactly. */
  closure: Record<string, string[]>;
  /** Citations planted in unit files: the stored edges a unit may have, no more. */
  unitCitations: number;
  indexEntries: number;
  /** What each planted file is: the shape a miss or a surplus is about. */
  classes: Record<string, ShapeClass>;
  /** Citation lines planted in every file, a citation repeated in one file counted each time. */
  citations: number;
  /** Files nothing names: the only orphans of the estate. */
  orphans: string[];
  /** The citation of a file the estate does not hold: the citing file, and the path as written. */
  missing: { from: string; written: string };
  /** The unit that cites a file the index also cites, and that file. */
  mixed: { unit: string; file: string };
  /** The documents whose own citations the scan could drop: the two that cite each other, the one that cites itself,
   * and the file that cites one document twice. */
  citing: {
    cycle: [string, string];
    self: string;
    twice: { from: string; doc: string };
  };
};

const WORDS = ['ledger', 'depot', 'pallet', 'tariff', 'roster', 'carrier', 'invoice', 'permit', 'manifest'];

export function sharedEstate(
  seed: number,
  options: SharedOptions = {},
): { files: Record<string, string>; truth: SharedTruth } {
  const scale = options.scale ?? 1;
  const count = (full: number, least: number) => Math.max(least, Math.round(full * scale));
  const skills = count(40, 3);
  const helpers = count(17, 2);
  const entries = count(3500, 20);
  const chains = count(30, 3);
  const files: Record<string, string> = {};
  const cites: Record<string, string[]> = {};
  const classes: Record<string, ShapeClass> = {};
  let citations = 0;
  const put = (path: string, text: string, names: string[] = [], kind?: ShapeClass) => {
    files[path] = text;
    if (names.length > 0) cites[path] = names;
    citations += names.length;
    if (kind) classes[path] = kind;
  };
  const word = (n: number) => WORDS[(n + seed) % WORDS.length] as string;

  const INDEX = `${ROOT}/memory/INDEX.md`;
  const entryPath = (n: number) => `${ROOT}/memory/entries/e-${n}.md`;
  const longForm = (n: number) => `${ROOT}/memory/extra/long-${n}.md`;
  const appendix = (n: number) => `${ROOT}/memory/extra/appendix-${n}.md`;
  const extra = (name: string) => `${ROOT}/memory/extra/${name}.md`;

  // The leaves: entries, and the documents some of them cite in turn (a chain two deep that nothing else names).
  // The entries from `chains` on carry the shapes, one each, in this order.
  const shapes = {
    cycle: chains,
    self: chains + 1,
    fanA: chains + 2,
    fanB: chains + 3,
    gone: chains + 4,
    relative: chains + 5,
    sibling: chains + 6,
    duplicate: chains + 7,
  };
  const cycleA = extra('cycle-a');
  const cycleB = extra('cycle-b');
  const selfDoc = extra('self');
  const annex = extra('annex');
  const goneDoc = extra('gone');
  const relDoc = extra('rel-a');
  const siblingDoc = `${ROOT}/memory/entries/sibling-b.md`;
  const dupDoc = extra('dup');
  const entryText = (n: number, lines: string[]) =>
    `# Entry ${n}\n\n${lines.join('\n')}\n\nThe ${word(n)} figures of record ${n}.\n`;

  for (let n = 0; n < entries; n += 1) {
    if (n < chains) {
      put(
        entryPath(n),
        `# Entry ${n}\n\nRead \`${longForm(n)}\` for the long form of this ${word(n)} entry.\n`,
        [longForm(n)],
        'entry',
      );
      put(
        longForm(n),
        `# Long form ${n}\n\nOpen \`${appendix(n)}\` for the annex of this ${word(n)} entry.\n`,
        [appendix(n)],
        'chain-two',
      );
      put(appendix(n), `# Appendix ${n}\n\nThe figures of this ${word(n)} entry.\n`, [], 'chain-three');
    } else if (n === shapes.cycle) {
      put(entryPath(n), entryText(n, [`Read \`${cycleA}\` for the loop of this entry.`]), [cycleA], 'entry');
    } else if (n === shapes.self) {
      put(
        entryPath(n),
        entryText(n, [`Read \`${selfDoc}\` for the note of this entry.`]),
        [selfDoc],
        'entry',
      );
    } else if (n === shapes.fanA || n === shapes.fanB) {
      put(entryPath(n), entryText(n, [`Read \`${annex}\` for the annex of this entry.`]), [annex], 'entry');
    } else if (n === shapes.gone) {
      put(
        entryPath(n),
        entryText(n, [`Read \`${goneDoc}\` for the archive of this entry.`]),
        [goneDoc],
        'entry',
      );
    } else if (n === shapes.relative) {
      put(
        entryPath(n),
        entryText(n, [`Read \`../extra/rel-a.md\` for the table of this entry.`]),
        [relDoc],
        'entry',
      );
    } else if (n === shapes.sibling) {
      put(entryPath(n), entryText(n, ['Read `./sibling-b.md` for the next record.']), [siblingDoc], 'entry');
    } else if (n === shapes.duplicate) {
      put(
        entryPath(n),
        entryText(n, [
          `Read \`${dupDoc}\` for the totals of this entry.`,
          `Read \`${dupDoc}\` again before you quote the totals.`,
        ]),
        [dupDoc, dupDoc],
        'entry',
      );
    } else put(entryPath(n), `# Entry ${n}\n\nThe ${word(n)} figures of record ${n}.\n`, [], 'entry');
  }
  put(cycleA, `# Cycle A\n\nThe ${word(1)} loop starts here; open \`${cycleB}\` next.\n`, [cycleB], 'cycle');
  put(
    cycleB,
    `# Cycle B\n\nThe ${word(1)} loop ends here; open \`${cycleA}\` to start again.\n`,
    [cycleA],
    'cycle',
  );
  put(selfDoc, `# Note\n\nSee \`${selfDoc}\` for the history of this note.\n`, [selfDoc], 'self');
  put(annex, `# Annex\n\nThe ${word(2)} tables shared by two entries.\n`, [], 'fan-in');
  put(relDoc, `# Table\n\nThe ${word(3)} rates, cited by a relative path.\n`, [], 'relative');
  put(siblingDoc, `# Next record\n\nThe ${word(4)} record next to its citing entry.\n`, [], 'relative');
  put(dupDoc, `# Totals\n\nThe ${word(5)} totals.\n`, [], 'duplicate');
  // Two reference files that sit in a skill's folder and that no file names (a memory file is loaded by place, so it
  // would never be an orphan).
  const orphans = [1, 2].map((n) => `${ROOT}/skills/${word(0)}-0/references/spare-${n}.md`);
  for (const path of orphans)
    put(path, `# Spare\n\nA ${word(6)} note that no document names.\n`, [], 'orphan');

  // The index cites every entry, and the plain documents the shapes reach are reached through their entries.
  const indexNames = Array.from({ length: entries }, (_, n) => entryPath(n));
  put(
    INDEX,
    ['# Index', '', ...indexNames.map((path) => `- Read \`${path}\` when you need that record.`), ''].join(
      '\n',
    ),
    indexNames,
    'index',
  );

  const units: SharedTruth['units'] = [];
  const closure: Record<string, string[]> = {};
  const reached = (start: string[]): string[] => {
    const seen = new Set<string>();
    const queue = [...start];
    while (queue.length > 0) {
      const path = queue.pop() as string;
      if (seen.has(path) || files[path] === undefined) continue;
      seen.add(path);
      queue.push(...(cites[path] ?? []));
    }
    return [...seen].sort();
  };
  const routes: string[] = [];
  const mixedFile = entryPath(0);
  for (let index = 0; index < skills; index += 1) {
    const name = `${word(index)}-${index}`;
    const own = `${ROOT}/skills/${name}/references/own.md`;
    const file = `${ROOT}/skills/${name}/SKILL.md`;
    put(own, `# Own reference ${index}\n\nThe ${word(index)} cases of skill ${index}.\n`, [], 'own');
    // The first skill also cites an entry the index cites: two owners for one citation.
    const direct = index === 0 ? [INDEX, own, mixedFile] : [INDEX, own];
    put(
      file,
      [
        '---',
        `name: ${name}`,
        `description: Handle ${word(index)} work ${index}. Use when the user asks for ${word(index)} work ${index}.`,
        'allowed-tools: Read',
        '---',
        '',
        `# ${name}`,
        '',
        `1. Open \`${INDEX}\` when the case is new.`,
        `2. Open \`references/own.md\` for the cases of skill ${index}.`,
        ...(index === 0 ? [`3. Open \`${mixedFile}\` for the first record.`] : []),
        '',
      ].join('\n'),
      direct,
    );
    units.push({ name, file, direct });
    routes.push(`| handle ${word(index)} work ${index} | \`${name}\` |`);
  }
  for (let index = 0; index < helpers; index += 1) {
    const name = `helper-${index}`;
    const file = `${ROOT}/agents/${name}.md`;
    const direct = [INDEX];
    put(
      file,
      [
        '---',
        `name: ${name}`,
        `description: Checks one ${word(index)} record at a time for team ${index}.`,
        'tools: Read',
        '---',
        '',
        `Open \`${INDEX}\` for the records you may check.`,
        '',
      ].join('\n'),
      direct,
    );
    units.push({ name, file, direct });
  }
  put(
    STANDING,
    ['# Standing instructions', '', '| When the user wants to | Load |', '|---|---|', ...routes, ''].join(
      '\n',
    ),
  );
  for (const unit of units) closure[unit.file] = reached(unit.direct).filter((path) => path !== unit.file);

  return {
    files,
    truth: {
      files: Object.keys(files).sort(),
      units,
      cites,
      closure,
      unitCitations: units.reduce((sum, unit) => sum + unit.direct.length, 0),
      indexEntries: entries,
      classes,
      citations,
      orphans,
      missing: { from: entryPath(shapes.gone), written: goneDoc },
      mixed: { unit: units[0]?.file ?? '', file: mixedFile },
      citing: {
        cycle: [cycleA, cycleB],
        self: selfDoc,
        twice: { from: entryPath(shapes.duplicate), doc: dupDoc },
      },
    },
  };
}
