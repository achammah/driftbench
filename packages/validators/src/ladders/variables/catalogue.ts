/** Writes validators/variables/CATALOGUE.md: `pnpm tsx packages/validators/src/ladders/variables/catalogue.ts > validators/variables/CATALOGUE.md`. */
import { readFileSync } from 'node:fs';
import {
  ASSUMPTIONS,
  CLAUSES,
  COMPONENTS,
  FAMILIES,
  FAMILY_LEVEL,
  LEVELS,
  STEMS,
  type StemDef,
  type Tier,
} from './bank/manifest/index';

/** One item of the bank as the manifest lists it. */
export type ItemRef = { id: string; stem: StemDef; key: string; tier: Tier };

export function itemsOf(stems: readonly StemDef[] = STEMS): ItemRef[] {
  return stems.flatMap((stem) =>
    stem.variants.map(([key, tier]) => ({ id: `${stem.id}.${key}`, stem, key, tier })),
  );
}

const TIERS: Tier[] = [1, 2, 3, 4, 5];

function table(header: string[], rows: string[][]): string {
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n');
}

/** The catalogue as markdown: summary, assumptions, interface, stems with generator, oracle and cause, item index. */
export function renderCatalogue(interfaceText: string, stems: readonly StemDef[] = STEMS): string {
  const items = itemsOf(stems);
  const causeOf = (i: ItemRef) => i.stem.variantCauses?.[i.key] ?? i.stem.cause;
  const causes = [...new Set(items.map(causeOf))];
  // Preserve existing catalogue codes when labels merge; new variant causes get new codes.
  const causeNo = new Map<string, number>();
  stems.forEach((stem, i) => {
    if (!causeNo.has(stem.cause)) causeNo.set(stem.cause, i + 1);
  });
  let nextCause = stems.length + 1;
  for (const cause of causes) if (!causeNo.has(cause)) causeNo.set(cause, nextCause++);
  const out: string[] = [];
  out.push('# Variables validator bank: catalogue');
  out.push('');
  out.push(
    `Written blind, from the specification alone, then bound to the variable store format of PR 706 (docs/variables.md) and the lead's rulings of 2026-10-17. ${items.length} items in ${stems.length} stems and ${FAMILIES.length} families, ${causes.length} candidate cause labels (not a verified distinct-fix count), seven levels. An item is a stem plus a variant: its id is the stem id, a dot and the variant key. A stem is one capability the variable store or the planner must have; its variants differ in input shape, size or wording and carry their own tier. Every item takes its input from a seed (the visible seeds 1 to 20 and the hidden seed draw other inputs). The validator calls no model.`,
  );
  out.push('');
  out.push('## 1. Counts');
  out.push('');
  const fam = (f: string) => items.filter((i) => i.stem.family === f);
  out.push(
    table(
      ['Family', 'Level', 'Stems', 'Items', ...TIERS.map((t) => `T${t}`), 'Causes'],
      [
        ...FAMILIES.map((f) => [
          f,
          FAMILY_LEVEL[f],
          String(stems.filter((s) => s.family === f).length),
          String(fam(f).length),
          ...TIERS.map((t) => String(fam(f).filter((i) => i.tier === t).length)),
          String(new Set(fam(f).map(causeOf)).size),
        ]),
        [
          '**all**',
          '',
          String(stems.length),
          String(items.length),
          ...TIERS.map((t) => String(items.filter((i) => i.tier === t).length)),
          String(causes.length),
        ],
      ],
    ),
  );
  out.push('');
  out.push(
    'Contract check (docs/validators.md 12.1): at least 300 items, no family under 20, every tier present.',
  );
  out.push('');
  out.push(
    table(
      ['Level', 'Name', 'Families', 'Items'],
      LEVELS.map((l, i) => [
        String(i + 1),
        l,
        FAMILIES.filter((f) => FAMILY_LEVEL[f] === l).join(', '),
        String(items.filter((it) => FAMILY_LEVEL[it.stem.family] === l).length),
      ]),
    ),
  );
  out.push('');
  out.push(
    'Tiers: 1 the plain case with one capability and a small clean input; 2 ordinary variation (other wording, arity or size); 3 realistic combinations and required details (reasons, provenance, ordering); 4 hostile or boundary inputs, differentials against brute force, statistics; 5 adversarial inputs aimed at a likely shortcut, scale at ten or a hundred times, the strictest statistical regimes.',
  );
  out.push('');
  out.push('## 2. Contract decisions and adapter mappings');
  out.push('');
  out.push(
    'The product rules are stated in docs/variables.md, Programmatic readers and planning. The IDs below retain traceability to the original bank assumptions; they no longer substitute for a product contract.',
  );
  out.push('');
  for (const [id, text] of Object.entries(ASSUMPTIONS)) out.push(`* **${id}.** ${text}`);
  out.push('');
  out.push('## 3. Clauses of the specification the stems cite');
  out.push('');
  for (const [id, text] of Object.entries(CLAUSES)) out.push(`* **${id}.** ${text}`);
  out.push('');
  out.push('## 4. The interface the bank defines (bound to docs/variables.md)');
  out.push('');
  out.push(
    'Items talk to the implementation through `VariablesImpl` (four functions on plain JSON data). The store they read projects shared fields of the variable store format: the three provenance kinds with their fields, relative weights, approval flags and boundaries. `adapter.ts` maps the real code to it and provides nothing today, because the readers that fill a store, the planner and the counter are not built yet (docs/variables.md Status): every item fails with the name of the function it needs, and that is the roadmap. When they land, only `adapter.ts` changes. Shared projected fields are checked by `bank/format.ts`; this is not a full file-format validator. Missing provenance is permitted there; `build()` separately enforces the source-reader provenance obligation (R1).',
  );
  out.push('');
  out.push('```ts');
  out.push(interfaceText.trim());
  out.push('```');
  out.push('');
  out.push('## 5. Stems');
  out.push('');
  out.push(
    'Each stem: its component (the one place the fix goes), the clauses it serves, how its input is built (generator), how the answer is known without the component (oracle), and the one change that makes it pass (cause). Items are listed with their tier.',
  );
  for (const f of FAMILIES) {
    out.push('');
    out.push(`### Family ${f} (level ${FAMILY_LEVEL[f]}): ${fam(f).length} items`);
    for (const s of stems.filter((x) => x.family === f)) {
      out.push('');
      out.push(`#### \`${s.id}\``);
      out.push('');
      out.push(
        `* Component: \`${s.component}\` (${COMPONENTS[s.component as keyof typeof COMPONENTS]}). Serves: ${s.need}.${s.assumption ? ` Assumes: ${s.assumption.join(', ')}.` : ''}`,
      );
      out.push(`* Generator: ${s.generator}`);
      out.push(`* Oracle: ${s.oracle}`);
      out.push(`* Candidate cause C${causeNo.get(s.cause)}: ${s.cause}.`);
      for (const [key, cause] of Object.entries(s.variantCauses ?? {}))
        out.push(`* Variant ${key}: candidate cause C${causeNo.get(cause)}: ${cause}.`);
      out.push(`* Items: ${s.variants.map(([k, t]) => `\`${s.id}.${k}\` (T${t})`).join(', ')}`);
    }
  }
  out.push('');
  out.push('## 6. Item index');
  out.push('');
  out.push(
    table(
      ['Item', 'Family', 'Level', 'Tier', 'Cause'],
      items.map((i) => [
        `\`${i.id}\``,
        i.stem.family,
        FAMILY_LEVEL[i.stem.family],
        String(i.tier),
        `C${causeNo.get(causeOf(i))}`,
      ]),
    ),
  );
  out.push('');
  out.push('## 7. Causes');
  out.push('');
  out.push(
    'These labels are hypotheses about repairs, not evidence of independent fixes. The independent cause audit in audit.md is pending; differently worded labels may share one repair. Known duplicate quote causes are merged and the empty-variable cleanup is separated by variant.',
  );
  out.push('');
  out.push(
    table(
      ['Cause', 'The change', 'Stems', 'Items'],
      causes.map((c) => [
        `C${causeNo.get(c)}`,
        c,
        String(new Set(items.filter((i) => causeOf(i) === c).map((i) => i.stem.id)).size),
        String(items.filter((it) => causeOf(it) === c).length),
      ]),
    ),
  );
  out.push('');
  return out.join('\n');
}

if (process.argv[1]?.endsWith('catalogue.ts')) {
  const interfaceText = readFileSync(new URL('./interface.ts', import.meta.url), 'utf8');
  process.stdout.write(renderCatalogue(interfaceText));
}
