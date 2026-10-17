import { ROOT, STANDING } from '../layout';

/**
 * A shared-index estate (the index lives with the memory files, a kind the reader reads): the shape that turned a reference graph into hundreds of thousands of edges. Every skill
 * and every helper (57 at full size) cites one shared index document, the index cites thousands of files, and a few
 * of those cite further documents that nothing else names. Every citation is planted, so the files each unit reaches
 * by following citations are known exactly. Names come from the seed; the files hold no prose that reads as a rule.
 */

export type SharedOptions = { scale?: number };

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
  const put = (path: string, text: string, names: string[] = []) => {
    files[path] = text;
    if (names.length > 0) cites[path] = names;
  };
  const word = (n: number) => WORDS[(n + seed) % WORDS.length] as string;

  const INDEX = `${ROOT}/memory/INDEX.md`;
  const entryPath = (n: number) => `${ROOT}/memory/entries/e-${n}.md`;
  const longForm = (n: number) => `${ROOT}/memory/extra/long-${n}.md`;
  const appendix = (n: number) => `${ROOT}/memory/extra/appendix-${n}.md`;

  // The leaves: entries, and the documents some of them cite in turn (a chain two deep that nothing else names).
  for (let n = 0; n < entries; n += 1) {
    if (n < chains) {
      put(
        entryPath(n),
        `# Entry ${n}\n\nRead \`${longForm(n)}\` for the long form of this ${word(n)} entry.\n`,
        [longForm(n)],
      );
      put(
        longForm(n),
        `# Long form ${n}\n\nOpen \`${appendix(n)}\` for the annex of this ${word(n)} entry.\n`,
        [appendix(n)],
      );
      put(appendix(n), `# Appendix ${n}\n\nThe figures of this ${word(n)} entry.\n`);
    } else put(entryPath(n), `# Entry ${n}\n\nThe ${word(n)} figures of record ${n}.\n`);
  }
  const indexNames = Array.from({ length: entries }, (_, n) => entryPath(n));
  put(
    INDEX,
    ['# Index', '', ...indexNames.map((path) => `- Read \`${path}\` when you need that record.`), ''].join(
      '\n',
    ),
    indexNames,
  );

  const units: SharedTruth['units'] = [];
  const closure: Record<string, string[]> = {};
  const reached = (start: string[]): string[] => {
    const seen = new Set<string>();
    const queue = [...start];
    while (queue.length > 0) {
      const path = queue.pop() as string;
      if (seen.has(path)) continue;
      seen.add(path);
      queue.push(...(cites[path] ?? []));
    }
    return [...seen].sort();
  };
  const routes: string[] = [];
  for (let index = 0; index < skills; index += 1) {
    const name = `${word(index)}-${index}`;
    const own = `${ROOT}/skills/${name}/references/own.md`;
    const file = `${ROOT}/skills/${name}/SKILL.md`;
    put(own, `# Own reference ${index}\n\nThe ${word(index)} cases of skill ${index}.\n`);
    const direct = [INDEX, own];
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
    },
  };
}
