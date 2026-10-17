import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { list, pick, type Rng, rngFor, SHOP } from '../harness';
import { token } from '../kinds';
import { type BlocksProduct, need } from '../product';
import { type BankItem, fail, PASS, type Tier } from '../types';

/**
 * Hostile and degenerate inputs (family F4 of the v3 partition) for the section registry of level 6: what
 * `radius sections init` makes of markdown a real prompt holds. The documented rule: init writes one section per
 * markdown heading of level 1 to `--level`, from the heading to the next one, its title the heading text, its id
 * the slugged title with `_2`, `_3` for repeats (packages/cli/help/authoring-prompt-sections.md, "driftbench radius
 * sections init"; docs/concepts/blast-radius.md, "Prompt sections and block links"), and the registry it writes is
 * one `check` accepts: every id used once ("driftbench radius sections check", exit 2 on an id used twice). A
 * markdown heading is a CommonMark heading: an ATX line of 1 to 6 `#` indented by at most three spaces, whose
 * closing `#` sequence is not part of the text, or a setext underline of `=` (level 1) or `-` (level 2); a line
 * inside a fenced code block is code, never a heading. Every item writes the prompt in a fresh folder that holds
 * only that prompt, runs init and check through the command line, and reads the registry init wrote; titles and
 * file names are seeded tokens, and what the item expects stays in memory.
 */

const SECTIONS = 'packages/core/src/radius/sections.ts';

/** The CPU budget of one init, in milliseconds, best of three: the budget level 6 holds for a 100,000-character prompt. */
export const HOSTILE_INIT_CPU_MS = 1500;

type Registry = { sections?: { id?: string; title?: string }[] };

/** A seeded title: a capitalised neutral word, so its slug is the word in lower case. */
function title(seed: number, tag: string): string {
  const word = token(seed, tag, 7);
  return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}

/** A body sentence of the fictional shop, different for each section. */
function body(rng: Rng, index: number): string {
  return `Offer the ${pick(rng, SHOP.bikes)} to ${pick(rng, SHOP.customers)}, rule ${index + 1}.`;
}

type Case = {
  /** The prompt text. */
  text: string;
  /** The section titles init must write, in order. */
  titles: string[];
  /** Init options after the prompt path. */
  args?: string[];
  /** Why these are the sections: the markdown rule the item holds. */
  rule: string;
};

type Init = { code: number; out: string; registry?: Registry; check?: { code: number; out: string } };

/** Runs init, then check on the registry init wrote, in a folder that holds only the prompt. */
async function initAndCheck(
  product: BlocksProduct,
  dir: string,
  seed: number,
  tag: string,
  c: Case,
): Promise<Init> {
  mkdirSync(dir, { recursive: true });
  const name = token(seed, `${tag}#file`);
  const promptPath = join(dir, `${name}.md`);
  writeFileSync(promptPath, c.text);
  const registryPath = join(dir, `${name}.sections.yaml`);
  const init = await product.cli(
    [
      'radius',
      'sections',
      'init',
      promptPath,
      '--id',
      name,
      '--prompt-version',
      'v1',
      '--out',
      registryPath,
      ...(c.args ?? []),
    ],
    dir,
  );
  const out = `${init.out}\n${init.err}`.trim();
  if (init.code !== 0) return { code: init.code, out };
  let registry: Registry | undefined;
  try {
    registry = parse(readFileSync(registryPath, 'utf8')) as Registry;
  } catch {
    return { code: init.code, out };
  }
  const check = await product.cli(['radius', 'sections', 'check', registryPath, '--prompt', promptPath], dir);
  return {
    code: init.code,
    out,
    registry,
    check: { code: check.code, out: `${check.out}\n${check.err}`.trim() },
  };
}

/** Compares what init wrote with the sections the markdown rule gives. */
function judge(c: Case, result: Init): ReturnType<typeof fail> | typeof PASS {
  if (result.code !== 0)
    return fail(
      `init should write a registry of the sections ${list(c.titles)} (${c.rule}); it exited ${result.code}: ${result.out.slice(0, 160)}`,
    );
  if (!result.registry) return fail('init exited 0 and wrote no registry the item can read');
  const sections = result.registry.sections ?? [];
  const titles = sections.map((section) => section.title ?? '');
  if (titles.join('\u0000') !== c.titles.join('\u0000'))
    return fail(
      `init should write the sections ${list(c.titles)}, in that order (${c.rule}); it wrote ${list(titles)}`,
    );
  const ids = sections.map((section) => section.id ?? '');
  const twice = ids.filter((id, at) => ids.indexOf(id) !== at);
  if (twice.length > 0)
    return fail(
      `init should give each section its own id, the slug with _2, _3 for repeats; it gave ${list([...new Set(twice)])} to two sections (ids ${list(ids)})`,
    );
  if (result.check?.code !== 0)
    return fail(
      `check should accept the registry init just wrote for this prompt; it exited ${result.check?.code}: ${result.check?.out.slice(0, 160)}`,
    );
  return PASS;
}

type Variant = { id: string; tier: Tier; make(seed: number, rng: Rng): Case };

type Cause = { id: string; cause: string; title: string; variants: Variant[] };

/** `## T` lines and their bodies. */
const atx = (rng: Rng, titles: readonly string[], marks = '##') =>
  titles.map((t, i) => `${marks} ${t}\n\n${body(rng, i)}\n`).join('\n');

const CAUSES: Cause[] = [
  {
    id: 'repeat-ids',
    cause:
      'radius sections init gives every section an id no other section holds: a repeat suffix never takes the slug of another heading.',
    title:
      'init on headings whose repeat suffix equals the slug of another heading writes one id per section',
    variants: [
      {
        id: 'twice-then-two',
        tier: 2,
        make: (seed, rng) => {
          const t = title(seed, 'repeat-a');
          const titles = [t, t, `${t} 2`];
          return {
            text: atx(rng, titles),
            titles,
            rule: 'two headings share a title, a third is that title and 2',
          };
        },
      },
      {
        id: 'two-then-twice',
        tier: 3,
        make: (seed, rng) => {
          const t = title(seed, 'repeat-b');
          const titles = [`${t} 2`, t, t];
          return {
            text: atx(rng, titles),
            titles,
            rule: 'a heading is a title and 2, two later headings share the title',
          };
        },
      },
      {
        id: 'three-then-three',
        tier: 3,
        make: (seed, rng) => {
          const t = title(seed, 'repeat-c');
          const titles = [t, t, t, `${t} 3`];
          return {
            text: atx(rng, titles),
            titles,
            rule: 'three headings share a title, a fourth is that title and 3',
          };
        },
      },
      {
        id: 'level-one',
        tier: 4,
        make: (seed, rng) => {
          const t = title(seed, 'repeat-d');
          const u = title(seed, 'repeat-d2');
          const titles = [u, t, t, `${t}_2`];
          return {
            text: atx(rng, titles, '#'),
            titles,
            rule: 'level 1 headings: two share a title, another is that title with _2 written out',
          };
        },
      },
    ],
  },
  {
    id: 'fenced-code',
    cause: 'radius sections init reads a line inside a fenced code block as code: it never starts a section.',
    title: 'init on a prompt with a fenced code block writes no section for the # lines inside it',
    variants: [
      {
        id: 'backticks-comment',
        tier: 2,
        make: (seed, rng) => {
          const [a, b] = [title(seed, 'fence-a'), title(seed, 'fence-a2')];
          const text = `## ${a}\n\nRun this first:\n\n\`\`\`sh\n# ${token(seed, 'fence-a3')} the tool\n${token(seed, 'fence-a4')} --check\n\`\`\`\n\n${body(rng, 0)}\n\n## ${b}\n\n${body(rng, 1)}\n`;
          return { text, titles: [a, b], rule: 'a # comment inside a ``` fence is code' };
        },
      },
      {
        id: 'backticks-heading-line',
        tier: 3,
        make: (seed, rng) => {
          const [a, b] = [title(seed, 'fence-b'), title(seed, 'fence-b2')];
          const text = `## ${a}\n\nThe reply looks like this:\n\n\`\`\`markdown\n## ${title(seed, 'fence-b3')}\nFern 3 is free.\n\`\`\`\n\n## ${b}\n\n${body(rng, 1)}\n`;
          return { text, titles: [a, b], rule: 'a ## line inside a ``` fence is code' };
        },
      },
      {
        id: 'tildes',
        tier: 3,
        make: (seed, rng) => {
          const [a, b] = [title(seed, 'fence-c'), title(seed, 'fence-c2')];
          const text = `## ${a}\n\n~~~\n# ${token(seed, 'fence-c3')}\n## ${token(seed, 'fence-c4')}\n~~~\n\n${body(rng, 0)}\n\n## ${b}\n\n${body(rng, 1)}\n`;
          return { text, titles: [a, b], rule: 'lines inside a ~~~ fence are code' };
        },
      },
      {
        id: 'long-fence',
        tier: 4,
        make: (seed, rng) => {
          const [a, b] = [title(seed, 'fence-d'), title(seed, 'fence-d2')];
          const text = `## ${a}\n\n\`\`\`\`text\n\`\`\`\n## ${token(seed, 'fence-d3')}\n\`\`\`\n\`\`\`\`\n\n${body(rng, 0)}\n\n## ${b}\n\n${body(rng, 1)}\n`;
          return {
            text,
            titles: [a, b],
            rule: 'a ```` fence closes only on ```` or longer, so the ## line between its two ``` lines is code',
          };
        },
      },
      {
        id: 'after-fence',
        tier: 2,
        make: (seed, rng) => {
          const [a, b, c] = [title(seed, 'fence-e'), title(seed, 'fence-e2'), title(seed, 'fence-e3')];
          const text = `## ${a}\n\n\`\`\`\n# ${token(seed, 'fence-e4')}\n\`\`\`\n## ${b}\n\n${body(rng, 0)}\n\n## ${c}\n\n${body(rng, 1)}\n`;
          return {
            text,
            titles: [a, b, c],
            rule: 'the # line inside the fence is code, and the ## line right after the closing fence is a heading',
          };
        },
      },
    ],
  },
  {
    id: 'setext',
    cause:
      'radius sections init reads a setext heading (a line of = or - under text) as a heading of level 1 or 2.',
    title:
      'init on a prompt with setext headings writes one section per setext heading of level 1 to --level',
    variants: [
      {
        id: 'equals',
        tier: 2,
        make: (seed, rng) => {
          const [a, b] = [title(seed, 'setext-a'), title(seed, 'setext-a2')];
          const text = `${a}\n${'='.repeat(a.length)}\n\n${body(rng, 0)}\n\n${b}\n${'='.repeat(3)}\n\n${body(rng, 1)}\n`;
          return { text, titles: [a, b], rule: 'a line of = under text is a level 1 heading' };
        },
      },
      {
        id: 'dashes',
        tier: 3,
        make: (seed, rng) => {
          const [a, b, c] = [title(seed, 'setext-b'), title(seed, 'setext-b2'), title(seed, 'setext-b3')];
          const text = `## ${a}\n\n${body(rng, 0)}\n\n${b}\n${'-'.repeat(b.length)}\n\n${body(rng, 1)}\n\n---\n\n## ${c}\n\n${body(rng, 2)}\n`;
          return {
            text,
            titles: [a, b, c],
            rule: 'a line of - right under text is a level 2 heading; a --- after a blank line is a thematic break, no heading',
          };
        },
      },
      {
        id: 'level-one-only',
        tier: 4,
        make: (seed, rng) => {
          const [a, b, c] = [title(seed, 'setext-c'), title(seed, 'setext-c2'), title(seed, 'setext-c3')];
          const text = `${a}\n${'='.repeat(a.length)}\n\n${body(rng, 0)}\n\n${b}\n${'-'.repeat(b.length)}\n\n${body(rng, 1)}\n\n${c}\n${'='.repeat(c.length)}\n\n${body(rng, 2)}\n`;
          return {
            text,
            titles: [a, c],
            args: ['--level', '1'],
            rule: 'with --level 1, the = headings start sections and the - heading (level 2) does not',
          };
        },
      },
    ],
  },
  {
    id: 'indented-atx',
    cause:
      'radius sections init reads an ATX heading indented by one to three spaces as a heading; four spaces is code.',
    title:
      'init on headings indented by up to three spaces writes a section for each, and none for a line indented four',
    variants: [1, 2, 3].map((spaces) => ({
      id: `spaces-${spaces}`,
      tier: (spaces === 3 ? 3 : 2) as Tier,
      make: (seed: number, rng: Rng) => {
        const [a, b] = [title(seed, `indent-${spaces}`), title(seed, `indent-${spaces}b`)];
        const code = token(seed, `indent-${spaces}c`);
        const text = `## ${a}\n\n${body(rng, 0)}\n\n${' '.repeat(spaces)}## ${b}\n\n${body(rng, 1)}\n\n    ## ${code}\n`;
        return {
          text,
          titles: [a, b],
          rule: `a ## line indented by ${spaces} space${spaces === 1 ? '' : 's'} is a heading; indented by four it is an indented code block`,
        };
      },
    })),
  },
  {
    id: 'closing-hashes',
    cause: "radius sections init leaves an ATX heading's closing # sequence out of the section title.",
    title: 'init on headings with a closing # sequence writes titles without it',
    variants: [
      {
        id: 'two',
        tier: 2,
        make: (seed, rng) => {
          const [a, b] = [title(seed, 'close-a'), title(seed, 'close-a2')];
          const text = `## ${a} ##\n\n${body(rng, 0)}\n\n## ${b}\n\n${body(rng, 1)}\n`;
          return {
            text,
            titles: [a, b],
            rule: 'the closing ## of "## T ##" is not part of the heading text',
          };
        },
      },
      {
        id: 'longer',
        tier: 3,
        make: (seed, rng) => {
          const [a, b] = [title(seed, 'close-b'), title(seed, 'close-b2')];
          const text = `# ${a} #####\n\n${body(rng, 0)}\n\n# ${b} #\n\n${body(rng, 1)}\n`;
          return {
            text,
            titles: [a, b],
            rule: 'a closing sequence of any number of # after a space is not part of the heading text',
          };
        },
      },
      {
        id: 'hash-in-word',
        tier: 4,
        make: (seed, rng) => {
          const [a, b] = [title(seed, 'close-c'), title(seed, 'close-c2')];
          const tail = token(seed, 'close-c3');
          const text = `## ${a} #${tail}\n\n${body(rng, 0)}\n\n## ${b} ###   \n\n${body(rng, 1)}\n`;
          return {
            text,
            titles: [`${a} #${tail}`, b],
            rule: 'a # with no space before it is text; a closing ### followed by spaces is a closing sequence',
          };
        },
      },
    ],
  },
];

/** A section body of one line said again and again: the degenerate case of an anchor search. */
const SAME_LINES: Variant[] = [
  {
    id: 'one-sentence',
    tier: 4,
    make: (seed, rng) => {
      const [a, b] = [title(seed, 'same-a'), title(seed, 'same-a2')];
      const line = `Quote the ${pick(rng, SHOP.bikes)} day rate first. `;
      const text = `## ${a}\n\n${line.repeat(Math.ceil(30_000 / line.length))}\n\n## ${b}\n\n${body(rng, 1)}\n`;
      return {
        text,
        titles: [a, b],
        rule: 'a section whose body is one sentence said again, about 30,000 characters',
      };
    },
  },
  {
    id: 'one-word',
    tier: 5,
    make: (seed, rng) => {
      const [a, b] = [title(seed, 'same-b'), title(seed, 'same-b2')];
      const word = `${token(seed, 'same-b3', 4)} `;
      const text = `## ${a}\n\n${body(rng, 0)}\n\n## ${b}\n\n${word.repeat(Math.ceil(12_000 / word.length))}\n`;
      return {
        text,
        titles: [a, b],
        rule: 'a section whose body is one word said again, about 12,000 characters',
      };
    },
  },
];

/**
 * The CPU time of a call, user plus system, in milliseconds: the best of `tries` runs. A first run over
 * `budget` ends the tries, so a product over the budget costs the bank one run, not three.
 */
async function cpuBest<T>(
  tries: number,
  budget: number,
  call: () => Promise<T>,
): Promise<{ ms: number; result: T }> {
  let best = Number.POSITIVE_INFINITY;
  let result: T | undefined;
  for (let i = 0; i < tries; i += 1) {
    const start = process.cpuUsage();
    result = await call();
    const used = process.cpuUsage(start);
    best = Math.min(best, (used.user + used.system) / 1000);
    if (best > budget) break;
  }
  return { ms: best, result: result as T };
}

/** The F4 items of level 6: one per variant of each markdown rule, then the repeated-line bodies. */
export function hostileItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const cause of CAUSES) {
    for (const variant of cause.variants) {
      const id = `hostile/sections/${cause.id}/${variant.id}`;
      items.push({
        id,
        family: 'hostile',
        tier: variant.tier,
        level: 6,
        component: SECTIONS,
        title: `${cause.title} (${variant.id.replace(/-/g, ' ')})`,
        cause: cause.cause,
        check: async ({ seed, scratch, product }) => {
          need(product.core, 'core', 'sectionsFromHeadings');
          const c = variant.make(seed, rngFor(seed, id));
          const dir = join(scratch, `f4-${token(seed, id)}`);
          return judge(c, await initAndCheck(product, dir, seed, id, c));
        },
      });
    }
  }
  for (const variant of SAME_LINES) {
    const id = `hostile/sections/same-lines/${variant.id}`;
    items.push({
      id,
      family: 'hostile',
      tier: variant.tier,
      level: 6,
      component: SECTIONS,
      title: `init on a section whose body repeats ${variant.id === 'one-word' ? 'one word' : 'one sentence'} (about ${variant.id === 'one-word' ? '12,000' : '30,000'} characters) writes its registry within ${HOSTILE_INIT_CPU_MS} ms of CPU, best of 3`,
      cause:
        'radius sections init finds a unique anchor quote in time linear in the section: a body that repeats one line costs no more than any other text.',
      check: async ({ seed, scratch, product }) => {
        need(product.core, 'core', 'sectionsFromHeadings');
        const c = variant.make(seed, rngFor(seed, id));
        let round = 0;
        const { ms, result } = await cpuBest(3, HOSTILE_INIT_CPU_MS, () => {
          round += 1;
          return initAndCheck(product, join(scratch, `f4-${token(seed, id)}-${round}`), seed, id, c);
        });
        const verdict = judge(c, result);
        if (!verdict.pass) return verdict;
        return ms <= HOSTILE_INIT_CPU_MS
          ? PASS
          : fail(
              `init and check should take at most ${HOSTILE_INIT_CPU_MS} ms of CPU on ${c.text.length} characters, the budget of a 100,000-character prompt (${c.rule}); they took ${ms.toFixed(0)} ms, best of 3`,
            );
      },
    });
  }
  return items;
}
