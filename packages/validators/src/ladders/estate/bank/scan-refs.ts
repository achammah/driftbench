import { ROOT, STANDING, skillFile } from '../layout';
import { type BodyLine, namesFor, plantSkill, rule, writeSettings } from './common';
import { type Family, itemsOf, type Tier } from './frame';
import type { Check, FileWriter, PlantedEstate } from './planted';
import { PlantedEstate as Estate } from './planted';

/**
 * scan.reference-prose: rules written in the reference files a skill names, not in the skill's own body. The
 * agent reads them when the skill tells it to, so they bind as much as the body does. The oracle: each rule of
 * a named reference is an atom on its line; a reference no line names gives none; a reference named twice
 * gives its atoms once; code reads a reference's own gates, hazards and references; a long reference reaches
 * the splitter in chunks of at most 40,000 characters, and its rules are still found.
 */

const COMPONENT = 'packages/estate/src/scan/claude-code.ts';
const FAMILY = 'scan.reference-prose';
export const MAX_CHUNK = 40_000;

type Context = { estate: PlantedEstate; seed: number; owner: string; noun: string; verb: string };
type Shape = {
  key: string;
  tier: Tier;
  title: string;
  /** Where the reference is, from the skill folder, and how the body names it. */
  file: string;
  mention?: (file: string) => string;
  /** Writes the reference; plants its atoms. */
  write(writer: FileWriter, context: Context): void;
  /** No line names the reference: it gives no atom. */
  unnamed?: boolean;
  checks?: (context: Context, path: string) => Check[];
  crlf?: boolean;
};

function filler(writer: FileWriter, count: number, width = 70): void {
  for (let index = 0; index < count; index += 1) {
    const text = `Entry ${index + 1} of the notes records who looked at the file and what they saw there.`;
    writer.line(text.length > width ? text : text.padEnd(width, '.'));
  }
}

function fill(writer: FileWriter, characters: number): void {
  let written = 0;
  let index = 0;
  while (written < characters) {
    index += 1;
    const text = `Entry ${index} of the notes records who looked at the file and what they saw there on that day.`;
    writer.line(text);
    written += text.length + 1;
  }
}

function plantRule(
  writer: FileWriter,
  context: Context,
  tag: string,
  kind: 'instruction' | 'register' | 'gate' = 'instruction',
) {
  const texts = {
    instruction: `Never ${context.verb} a ${context.noun} that another person holds, note ${tag}.`,
    register: `Write the ${context.noun} number in capitals in every reply, note ${tag}.`,
    gate: `Ask the owner first, then ${context.verb} the ${context.noun}, note ${tag}.`,
  };
  const planted = rule(`${context.owner}:${tag}`, texts[kind], kind);
  writer.line(planted.text, planted.atoms, planted.prose);
}

const SHAPES: Shape[] = [
  {
    key: 'short',
    tier: 2,
    title: 'a short reference with one rule',
    file: 'references/notes.md',
    write: (w, c) => {
      w.line('# Notes');
      plantRule(w, c, 'a');
    },
  },
  {
    key: 'deep',
    tier: 3,
    title: 'a rule three hundred lines down',
    file: 'references/notes.md',
    write: (w, c) => {
      w.line('# Notes');
      filler(w, 300);
      plantRule(w, c, 'a');
    },
  },
  {
    key: 'large',
    tier: 3,
    title: 'a reference of 60,000 characters',
    file: 'references/notes.md',
    write: (w, c) => {
      w.line('# Notes');
      fill(w, 30_000);
      plantRule(w, c, 'a');
      fill(w, 30_000);
      plantRule(w, c, 'b');
    },
  },
  {
    key: 'huge-chunked',
    tier: 5,
    title: 'a reference of 250,000 characters, sent in chunks of at most 40,000',
    file: 'references/notes.md',
    write: (w, c) => {
      w.line('# Notes');
      for (const tag of ['a', 'b', 'c', 'd', 'e']) {
        fill(w, 50_000);
        plantRule(w, c, tag);
      }
    },
    checks: (_c, path) => [
      (scan) => {
        const sent = scan.requests.filter((request) => request.file === path);
        if (sent.length === 0) return 'the reference never reached the splitter';
        const over = sent.filter((request) => request.characters > MAX_CHUNK);
        return over.length === 0
          ? undefined
          : `${over.length} chunks over ${MAX_CHUNK} characters (largest ${Math.max(...over.map((r) => r.characters))})`;
      },
    ],
  },
  {
    key: 'nested-folder',
    tier: 3,
    title: 'a reference in a nested folder',
    file: 'references/deep/notes.md',
    write: (w, c) => {
      w.line('# Notes');
      plantRule(w, c, 'a');
    },
  },
  {
    key: 'text-file',
    tier: 3,
    title: 'a plain text reference',
    file: 'references/notes.txt',
    write: (w, c) => {
      w.line('NOTES');
      plantRule(w, c, 'a');
    },
  },
  {
    key: 'named-by-link',
    tier: 2,
    title: 'a reference named by a markdown link',
    file: 'references/notes.md',
    mention: (f) => `When unsure, see [the notes](${f}) first.`,
    write: (w, c) => {
      w.line('# Notes');
      plantRule(w, c, 'a');
    },
  },
  {
    key: 'rule-in-table',
    tier: 3,
    title: 'a rule written as a table row',
    file: 'references/notes.md',
    write: (w, c) => {
      w.line('| Case | Rule |');
      w.line('|---|---|');
      const text = `Never ${c.verb} a ${c.noun} that another person holds.`;
      const planted = rule(`${c.owner}:a`, text);
      w.line(`| held | ${text} |`, planted.atoms, planted.prose);
    },
  },
  {
    key: 'after-code-fence',
    tier: 3,
    title: 'a rule after a code fence whose example reads like a rule',
    file: 'references/notes.md',
    write: (w, c) => {
      w.line('# Notes');
      w.line('```text');
      w.line(`Example only: never ${c.verb} anything.`);
      w.line('```');
      plantRule(w, c, 'a');
    },
  },
  {
    key: 'front-matter',
    tier: 3,
    title: 'a reference with its own frontmatter',
    file: 'references/notes.md',
    write: (w, c) => {
      w.line('---');
      w.line('title: Notes');
      w.line('---');
      plantRule(w, c, 'a');
    },
  },
  {
    key: 'unicode',
    tier: 2,
    title: 'a reference in accented text',
    file: 'references/notes.md',
    write: (w, c) => {
      w.line('# Remarques générales');
      plantRule(w, c, 'a');
    },
  },
  {
    key: 'register-rule',
    tier: 2,
    title: 'an output rule in a reference',
    file: 'references/notes.md',
    write: (w, c) => {
      w.line('# Notes');
      plantRule(w, c, 'a', 'register');
    },
  },
  {
    key: 'gate-rule',
    tier: 2,
    title: 'an order rule in a reference',
    file: 'references/notes.md',
    write: (w, c) => {
      w.line('# Notes');
      plantRule(w, c, 'a', 'gate');
    },
  },
  {
    key: 'twelve-rules',
    tier: 3,
    title: 'twelve rules spread over five thousand characters',
    file: 'references/notes.md',
    write: (w, c) => {
      w.line('# Notes');
      for (let index = 0; index < 12; index += 1) {
        filler(w, 5);
        plantRule(w, c, `r${index}`);
      }
    },
  },
  {
    key: 'crlf',
    tier: 3,
    title: 'a reference with carriage-return line endings',
    file: 'references/notes.md',
    crlf: true,
    write: (w, c) => {
      w.line('# Notes');
      plantRule(w, c, 'a');
    },
  },
  {
    key: 'fixed-gate-inside',
    tier: 4,
    title: 'a reference holding a fixed-form gate to another file',
    file: 'references/notes.md',
    write: (w, c) => {
      w.line('# Notes');
      const full = w.path.replace(/notes\.md$/, 'forms.md');
      c.estate.raw(full, '# Forms\n', c.owner);
      w.line(`Before editing any ${c.noun} form: Read \`forms.md\`.`, [
        { hid: `${c.owner}:gate`, kind: 'gate' },
        { hid: `${c.owner}:inner-ref`, kind: 'reference', key: full },
      ]);
    },
  },
  {
    key: 'hazard-inside',
    tier: 4,
    title: 'a reference naming a runtime hazard',
    file: 'references/notes.md',
    write: (w, c) => {
      w.line('# Notes');
      const planted = rule(
        `${c.owner}:a`,
        `After a compaction, read this file again before you ${c.verb} anything.`,
      );
      w.line(
        planted.text,
        [...(planted.atoms ?? []), { hid: `${c.owner}:hazard`, kind: 'hazard', key: 'compaction' }],
        planted.prose,
      );
    },
  },
  {
    key: 'chained',
    tier: 4,
    title: 'a reference naming a second reference with its own rule',
    file: 'references/notes.md',
    write: (w, c) => {
      w.line('# Notes');
      const second = w.path.replace(/notes\.md$/, 'more.md');
      w.line('When the case is unusual, open `more.md` as well.', [
        { hid: `${c.owner}:inner-ref`, kind: 'reference', key: second },
      ]);
      plantRule(w, c, 'a');
      const more = c.estate.file(second, c.owner);
      more.line('# More');
      plantRule(more, c, 'b');
      c.estate.check(c.owner, referenceReachCheck(`${c.owner}:skill`, `${c.owner}:inner-ref`));
    },
  },
  {
    key: 'unnamed',
    tier: 1,
    title: 'a reference no line names: no atom',
    file: 'references/stray.md',
    unnamed: true,
    write: (w, c) => {
      w.line('# Stray');
      w.line(`Never ${c.verb} a ${c.noun} on a holiday.`);
    },
  },
  {
    key: 'data-file',
    tier: 2,
    title: 'a data file a skill names: no prose atom',
    file: 'references/codes.json',
    write: (w) => {
      w.line('{ "codes": ["A", "B"] }');
    },
  },
  {
    key: 'outside-skill',
    tier: 3,
    title: 'a reference outside any skill, named by the standing instructions',
    file: '',
    write: () => {},
  },
  {
    key: 'named-twice',
    tier: 4,
    title: 'one reference named by two skills: its atoms once',
    file: 'references/notes.md',
    write: (w, c) => {
      w.line('# Notes');
      plantRule(w, c, 'a');
    },
  },
];

export function referenceProseFamily(): Family {
  const items = itemsOf(
    FAMILY,
    1,
    COMPONENT,
    SHAPES.map(({ key, tier, title }) => ({ key, tier, title: `the scan reads the rules of ${title}` })),
  );
  return {
    id: FAMILY,
    level: 1,
    component: COMPONENT,
    items,
    async evaluate(seed) {
      const estate = new Estate();
      const standing = estate.file(STANDING, 'base');
      standing.line('# Planted estate');
      standing.line('');
      writeSettings(estate);
      for (const shape of SHAPES) {
        const owner = `${FAMILY}.${shape.key}`;
        const names = namesFor(seed, owner);
        const context: Context = { estate, seed, owner, noun: names.noun, verb: names.verb };
        if (shape.key === 'outside-skill') {
          const path = `${ROOT}/docs/${names.skill}.md`;
          standing.owner = owner;
          standing.line(`When a policy question comes up, read the policy in \`${path}\`.`, [
            { hid: `${owner}:ref`, kind: 'reference', key: path },
          ]);
          standing.owner = 'base';
          const writer = estate.file(path, owner);
          writer.line('# Policy');
          plantRule(writer, context, 'a');
          continue;
        }
        const path = skillFile(names.skill, shape.file);
        const writer = estate.file(path, owner);
        if (shape.crlf) writer.eol = '\r\n';
        const body: BodyLine[] = shape.unnamed
          ? [rule(`${owner}:body`, `Always name the ${names.noun} in the first line.`)]
          : [
              {
                text: shape.mention
                  ? shape.mention(shape.file)
                  : `When unsure, open \`${shape.file}\` first.`,
                atoms: [{ hid: `${owner}:ref`, kind: 'reference', key: path }],
              },
            ];
        plantSkill(estate, owner, names.skill, `${capital(names.title)} for the team.`, body);
        if (!shape.unnamed) estate.edge(owner, `${owner}:skill`, `${owner}:ref`, 'reference');
        shape.write(writer, context);
        for (const check of shape.checks?.(context, path) ?? []) estate.check(owner, check);
        if (shape.key === 'named-twice') {
          const second = namesFor(seed, `${owner}-second`).skill;
          plantSkill(
            estate,
            owner,
            second,
            `${capital(names.title)} for the second team.`,
            [
              {
                text: `When unsure, open \`../${names.skill}/${shape.file}\` first.`,
                atoms: [{ hid: `${owner}:ref2`, kind: 'reference', key: path }],
              },
            ],
            { id: `${owner}:second` },
          );
        }
      }
      const scan = await estate.scan();
      return estate.judge(
        scan,
        items.map((item) => item.id),
      );
    },
  };
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A behavioural reach assertion over direct citations, independent of graph closure storage. */
export function referenceReachCheck(from: string, to: string): Check {
  return (scan) => {
    const source = scan.map.atoms.find((atom) => atom.id === scan.idOf.get(from));
    const target = scan.map.atoms.find((atom) => atom.id === scan.idOf.get(to) && atom.kind === 'reference');
    if (!source || !target) return 'reference is not reachable: source or target atom is missing';
    const inFile = new Map<string, typeof scan.map.atoms>();
    for (const atom of scan.map.atoms) {
      if (atom.kind !== 'reference') continue;
      const list = inFile.get(atom.provenance.file);
      if (list) list.push(atom);
      else inFile.set(atom.provenance.file, [atom]);
    }
    const todo = [source.provenance.file];
    const visited = new Set<string>();
    for (let head = 0; head < todo.length; head++) {
      const file = todo[head] as string;
      if (visited.has(file)) continue;
      visited.add(file);
      for (const citation of inFile.get(file) ?? []) {
        if (citation.id === target.id) return undefined;
        if (typeof citation.fields?.path === 'string') todo.push(citation.fields.path);
      }
    }
    return 'reference is not reachable through the owner’s direct citation paths';
  };
}
