import { type BankItem, type Json, type Probe, probe, type Tier, token } from './types.js';

/** Read this together with the bank-owned adapter contract, not as a reader API. */
export const structureContractNotes = `
cut input: {file,source}. Raw observation: {units:[{container,text,span:[start,end],path:[],yamlPath?}]}.
Units are source-ordered. text MUST be source.slice(start,end), using UTF-16 indices.
The bank projects away unspecified boundary whitespace and container markers; it checks the raw
source-slice equality before projecting. Heading paths are arrays of heading text. Frontmatter
units have container frontmatter and yamlPath as a dot-separated YAML path. A fence/comment has
container fence/comment. This is adapter vocabulary, not an assertion about implementation types.
group action windows returns {windows:[{selectable:[numbers],contextOnly:[numbers]}]} for the
small files here, all unambiguously below the design's token limit. headings are context, not an
extra selectable pseudo-unit. action carry returns {carried:[{n,set,label}],dirty:[{n,set}]}.
action questions returns {batches:[{keys:[u<number>__<label>]}]} in unit/label input order;
action dense returns {accepted:boolean,labels:[{n,label}],unlabeled:[numbers]}.
Request numbers and labels are inputs; expected observations remain outside requests.
Scale budgets are validator policy, not a claimed production SLA or heap measurement.
The 64 MiB bound measures serialized output only. The timer bounds each item to 10 seconds.
`;

type Unit = { container: string; text: string; path: string[]; yamlPath?: string };
type Fixture = { source: string; units: Unit[] };
type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected an observation object');
  }
  return value as RecordValue;
}

function canonicalText(container: string, text: string): string {
  let result = text.trim();
  if (container === 'heading') result = result.replace(/^#{1,6}\s+/, '').replace(/\s+#+$/, '');
  if (container === 'list_item') result = result.replace(/^(?:[-+*]|\d+[.)])\s+/, '');
  if (container === 'blockquote') result = result.replace(/^> ?/gm, '');
  return result;
}

function cutProbe(fixture: Fixture, file: string): Probe {
  let cursor = 0;
  const units = fixture.units.map((unit) => {
    const start = fixture.source.indexOf(unit.text, cursor);
    if (start < 0) throw new Error(`Plant text absent: ${unit.text}`);
    cursor = start + unit.text.length;
    return { ...unit, span: [start, cursor] };
  });
  return {
    request: { operation: 'cut', input: { file, source: fixture.source } },
    expected: fixture.units.map((unit) => ({
      ...unit,
      text: canonicalText(unit.container, unit.text),
    })) as Json,
    sample: { units } as Json,
    observe(actual) {
      const raw = record(actual).units;
      if (!Array.isArray(raw)) throw new Error('Missing units');
      let end = 0;
      return raw.map((value) => {
        const unit = record(value);
        const span = unit.span;
        if (
          !Array.isArray(span) ||
          span.length !== 2 ||
          !Number.isInteger(span[0]) ||
          !Number.isInteger(span[1]) ||
          span[0] < end ||
          span[1] < span[0] ||
          span[1] > fixture.source.length
        ) {
          throw new Error('Invalid, unordered or overlapping UTF-16 spans');
        }
        end = span[1];
        if (unit.text !== fixture.source.slice(span[0], span[1])) {
          throw new Error('Unit is not a verbatim source slice');
        }
        if (typeof unit.container !== 'string' || typeof unit.text !== 'string') {
          throw new Error('Missing container or source text');
        }
        const result: RecordValue = {
          container: unit.container,
          text: canonicalText(unit.container, unit.text),
          path: unit.path,
        };
        if (unit.yamlPath !== undefined) result.yamlPath = unit.yamlPath;
        return result;
      });
    },
  };
}

function unit(container: string, text: string, path: string[] = [], yamlPath?: string): Unit {
  return { container, text, path, ...(yamlPath === undefined ? {} : { yamlPath }) };
}

type Shape = {
  name: string;
  cause: string;
  tier: Tier;
  make(t: string, count: number): Fixture;
};

const cuttingShapes: Shape[] = [
  {
    name: 'sentence-boundaries',
    cause: 'segment prose and map sentence indices back',
    tier: 1,
    make(t, count) {
      const texts = Array.from({ length: count }, (_, i) => `Parcel ${t}${i} rests here.`);
      return { source: texts.join(' '), units: texts.map((s) => unit('sentence', s)) };
    },
  },
  {
    name: 'inline-code-mask',
    cause: 'mask inline code before sentence segmentation',
    tier: 2,
    make(t, count) {
      const texts = Array.from({ length: count }, (_, i) => `Copy \`x.${t}${i}.y\` exactly.`);
      return { source: texts.join(' '), units: texts.map((s) => unit('sentence', s)) };
    },
  },
  {
    name: 'url-mask',
    cause: 'mask URLs before sentence segmentation',
    tier: 2,
    make(t, count) {
      const texts = Array.from({ length: count }, (_, i) => `Open https://${t}.invalid/a.${i}.b now.`);
      return { source: texts.join(' '), units: texts.map((s) => unit('sentence', s)) };
    },
  },
  {
    name: 'link-destination-mask',
    cause: 'mask link destinations without losing source bytes',
    tier: 3,
    make(t, count) {
      const texts = Array.from(
        { length: count },
        (_, i) => `Read [entry ${i}](https://${t}.invalid/a.b) now.`,
      );
      return { source: texts.join(' '), units: texts.map((s) => unit('sentence', s)) };
    },
  },
  {
    name: 'list-items',
    cause: 'cut structural list items rather than their sentences',
    tier: 1,
    make(t, count) {
      const texts = Array.from({ length: count }, (_, i) => `- Parcel ${t}${i}. Seal it.`);
      return { source: texts.join('\n'), units: texts.map((s) => unit('list_item', s)) };
    },
  },
  {
    name: 'wrapped-items',
    cause: 'keep wrapped list lines in one unit',
    tier: 3,
    make(t, count) {
      const texts = Array.from({ length: count }, (_, i) => `- Carry ${t}${i}\n  across the room`);
      return { source: texts.join('\n'), units: texts.map((s) => unit('list_item', s)) };
    },
  },
  {
    name: 'nested-items',
    cause: 'cut nested list items without overlapping parent spans',
    tier: 4,
    make(t, count) {
      const texts = ['- Outer container', ...Array.from({ length: count }, (_, i) => `  - Inner ${t}${i}`)];
      return { source: texts.join('\n'), units: texts.map((s) => unit('list_item', s.trimStart())) };
    },
  },
  {
    name: 'table-cells',
    cause: 'cut each GFM cell without its pipe separators',
    tier: 2,
    make(t, count) {
      const rows = Array.from({ length: count }, (_, i) => [t + i, `slot${i}`]);
      return {
        source: `| Key | Place |\n| --- | --- |\n${rows.map((row) => `| ${row.join(' | ')} |`).join('\n')}`,
        units: ['Key', 'Place', ...rows.flat()].map((s) => unit('table_cell', s)),
      };
    },
  },
  {
    name: 'blockquote-paragraphs',
    cause: 'cut blockquote paragraphs without sentence splitting',
    tier: 3,
    make(t, count) {
      const texts = Array.from({ length: count }, (_, i) => `Parcel ${t}${i} waits. It remains here.`);
      return {
        source: texts.map((s) => `> ${s}`).join('\n>\n'),
        units: texts.map((s) => unit('blockquote', s)),
      };
    },
  },
  {
    name: 'fence-opacity',
    cause: 'keep fenced code opaque regardless of embedded markdown',
    tier: 1,
    make(t, count) {
      const texts = Array.from({ length: count }, (_, i) => `\`\`\`text\n# ${t}${i}\n- pretend item\n\`\`\``);
      return { source: texts.join('\n\n'), units: texts.map((s) => unit('fence', s)) };
    },
  },
  {
    name: 'comment-opacity',
    cause: 'keep HTML comments opaque regardless of embedded instructions',
    tier: 4,
    make(t, count) {
      const texts = Array.from(
        { length: count },
        (_, i) => `<!-- ${t}${i}\n# Not a heading\n- Not an item\n-->`,
      );
      return { source: texts.join('\n\n'), units: texts.map((s) => unit('comment', s)) };
    },
  },
  {
    name: 'yaml-string-paths',
    cause: 'emit YAML string values and their paths but not structure keys',
    tier: 4,
    make(t, count) {
      const texts = Array.from({ length: count }, (_, i) => `${t}${i}`);
      return {
        source: `---\nmeta:\n${texts.map((s, i) => `  slot${i}: ${s}`).join('\n')}\ncount: 7\nactive: true\n---`,
        units: texts.map((s, i) => unit('frontmatter', s, [], `meta.slot${i}`)),
      };
    },
  },
  {
    name: 'heading-ancestry',
    cause: 'reset heading ancestry when a sibling heading begins',
    tier: 5,
    make(t, count) {
      const texts = Array.from({ length: count }, (_, i) => `Branch ${t}${i}`);
      const units = [unit('heading', '# Root')];
      for (const text of texts)
        units.push(
          unit('heading', `## ${text}`, ['Root']),
          unit('sentence', 'Parcel rests.', ['Root', text]),
        );
      return { source: `# Root\n\n${texts.map((s) => `## ${s}\n\nParcel rests.`).join('\n\n')}`, units };
    },
  },
  {
    name: 'html-inner-markdown',
    cause: 'parse markdown inside tag-only HTML wrappers',
    tier: 5,
    make(t, count) {
      const texts = Array.from({ length: count }, (_, i) => `- Inner ${t}${i}`);
      return {
        source: `<role>\n\n${texts.join('\n')}\n\n</role>`,
        units: texts.map((s) => unit('list_item', s)),
      };
    },
  },
  {
    name: 'utf16-source-slices',
    cause: 'preserve UTF-16 offsets for astral and combining characters',
    tier: 5,
    make(t, count) {
      const texts = Array.from({ length: count }, (_, i) => `Parcel 🪐${t}${i} carries e\u0301.`);
      return { source: texts.join('\n\n'), units: texts.map((s) => unit('sentence', s)) };
    },
  },
];

function contextualize(fixture: Fixture, context: number): Fixture {
  if (context === 0) return fixture;
  // Frontmatter must stay at the start. BOM still tests base-offset restoration there.
  if (fixture.units.some((u) => u.container === 'frontmatter' || u.container === 'heading')) {
    return { source: `\ufeff${fixture.source}`, units: fixture.units };
  }
  return {
    source: `\ufeff# Context 🪐\n\n${fixture.source}`,
    units: [
      unit('heading', '# Context 🪐'),
      ...fixture.units.map((u) => ({ ...u, path: ['Context 🪐', ...u.path] })),
    ],
  };
}

function cuttingItems(): BankItem[] {
  return cuttingShapes.flatMap((shape) =>
    [0, 1].map(
      (context): BankItem => ({
        id: `cutting/${shape.name}/${context === 0 ? 'bare' : 'bom-context'}`,
        family: 'cutting',
        tier: shape.tier,
        level: shape.tier,
        component: 'pointer.cutter',
        title: `${shape.name} with ${context === 0 ? 'bare source' : 'BOM and heading context'}`,
        cause: shape.cause,
        design: '2: cutting; 10a: HTML recursion findings',
        generate(seed) {
          const t = token(seed, context);
          return { probes: [2, 3].map((n) => cutProbe(contextualize(shape.make(t, n), context), `${t}.md`)) };
        },
      }),
    ),
  );
}

function windowUnits(t: string, count: number, start: number): Json[] {
  return Array.from({ length: count }, (_, i) => ({
    n: start + i,
    text: `Parcel ${t}${i}.`,
    path: [t],
    opaque: false,
  }));
}

function groupingProbe(kind: number, variant: number, seed: number, second: boolean): Probe {
  const t = token(seed, variant);
  const start = 7 + variant * 100;
  const count = (second ? 3 : 2) + variant;
  const ns = Array.from({ length: count }, (_, i) => start + i);
  const units = windowUnits(t, count, start).map((value, i) => ({
    ...(value as Record<string, Json>),
    text:
      variant === 1 ? `Parcel 🪐${t}${i}.` : variant === 2 ? `Copy \`x.${t}${i}.y\`.` : `Parcel ${t}${i}.`,
    path: variant === 0 ? [t] : variant === 1 ? [t, 'Inner'] : [t, i % 2 === 0 ? 'Left' : 'Right'],
  }));
  if (kind === 0) {
    return probe(
      'group',
      { action: 'windows', file: `${t}.md`, units },
      {
        windows: [{ selectable: ns, contextOnly: [] }],
      },
    );
  }
  if (kind === 1) {
    const headings = units.map((u, i) => ({ ...(u as Record<string, Json>), path: [t, `branch${i}`] }));
    return probe(
      'group',
      { action: 'windows', file: `${t}.md`, units: headings },
      {
        windows: [{ selectable: ns, contextOnly: [] }],
      },
    );
  }
  if (kind >= 2 && kind <= 4) {
    const labels: Record<string, string> =
      variant === 1 ? { hue: 'blue', tone: 'quiet' } : { hue: variant === 2 ? 'none' : 'blue' };
    const sets = Object.keys(labels);
    const previous = ns.map((n) => ({ n, fp: `${t}-fp-${n}`, ctxFp: `${t}-ctx-${n}`, labels }));
    const changed = (second ? ns[ns.length - 1] : ns[0]) ?? start;
    const current = previous.map((u) => ({
      ...u,
      ...(u.n === changed && kind === 3 ? { fp: `${u.fp}-edit` } : {}),
      ...(u.n === changed && kind === 4 ? { ctxFp: `${u.ctxFp}-edit` } : {}),
    }));
    return probe(
      'group',
      { action: 'carry', previous, current, sets },
      {
        carried: ns
          .filter((n) => kind === 2 || n !== changed)
          .flatMap((n) => sets.map((set) => ({ n, set, label: labels[set] as string }))),
        dirty: kind === 2 ? [] : sets.map((set) => ({ n: changed, set })),
      },
    );
  }
  if (kind === 5 || kind === 6 || kind === 7) {
    const labelCount = variant + 2;
    const labels = Array.from({ length: labelCount }, (_, i) => ({ name: `hue${i}` }));
    if (kind === 7) labels.push({ name: 'targeted', target: 'required' } as { name: string });
    const size =
      kind === 5 ? (second ? Math.floor(250 / labelCount) + 1 : Math.floor(250 / labelCount)) : count;
    const questionUnits = windowUnits(t, size, start);
    const eligible = labels.filter((l) => l.name !== 'targeted');
    const perBatch = kind === 6 ? 1 : Math.floor(250 / eligible.length);
    const batches: Json[] = [];
    for (let offset = 0; offset < size; offset += perBatch) {
      const keys = questionUnits
        .slice(offset, offset + perBatch)
        .flatMap((u) => eligible.map((l) => `u${(u as Record<string, Json>).n}__${l.name}`));
      batches.push({ keys });
    }
    const excluded: Json[] =
      variant === 0
        ? []
        : [
            {
              n: start - 1,
              text: `Neighbour ${t}.`,
              ...(variant === 1 ? { contextOnly: true } : { opaque: true }),
            },
          ];
    return probe(
      'group',
      {
        action: 'questions',
        state: kind === 6 ? 'unit' : 'window',
        units: [...excluded, ...questionUnits],
        set: { name: 'hue', labels },
      },
      { batches },
    );
  }
  if (kind === 8) {
    return probe(
      'group',
      {
        action: 'dense',
        window: { id: t, units },
        set: { name: 'hue', labels: [{ name: 'blue' }] },
        answer: {
          window: t,
          set: 'hue',
          labels: [{ units: `${start}-${start + count - 1}`, label: 'blue' }],
        },
      },
      { accepted: true, labels: ns.map((n) => ({ n, label: 'blue' })), unlabeled: [] },
    );
  }
  const neighbor = start - 1;
  return probe(
    'group',
    {
      action: 'dense',
      window: { id: t, units: [{ n: neighbor, text: `Old ${t}.`, contextOnly: true }, ...units] },
      set: { name: 'hue', labels: [{ name: 'blue' }] },
      answer: { window: t, set: 'hue', labels: [{ units: String(start), label: 'blue' }] },
    },
    { accepted: true, labels: [{ n: start, label: 'blue' }], unlabeled: ns.slice(1) },
  );
}

const groupingDefinitions: [string, string, Tier][] = [
  ['small-window', 'keep a fitting file in a single window', 1],
  ['heading-runs', 'do not split a fitting file merely because its heading changes', 2],
  ['unchanged-carry', 'carry labels only from matching text and context fingerprints', 1],
  ['text-dirty', 'invalidate a carried label when the unit fingerprint changes', 3],
  ['context-dirty', 'invalidate a carried label when context changes', 4],
  ['question-cap', 'split system-1 batches at the unit-times-label question cap', 4],
  ['unit-state', 'emit one system-1 request per unit in unit-state mode', 2],
  ['target-exclusion', 'exclude target-required labels from system-1 questions', 5],
  ['dense-ranges', 'expand dense answer ranges exactly once per selectable unit', 3],
  ['context-not-gap', 'exclude context-only neighbours from unlabeled gaps', 5],
];

function groupingItems(): BankItem[] {
  return groupingDefinitions.flatMap(([name, cause, tier], kind) =>
    [0, 1, 2].map(
      (variant): BankItem => ({
        id: `grouping/${name}/interaction-${variant + 1}`,
        family: 'grouping',
        tier,
        level: tier,
        component: kind < 5 ? 'pointer.windows' : 'pointer.labeler-port',
        title: `${name}, ${['plain', 'nested Unicode / context neighbour / multiple sets', 'inline code / opaque neighbour / carried none'][variant]} interaction`,
        cause,
        design: '3: window, system-1 implementations, dense answers; 5: windows and carry-forward',
        generate(seed) {
          return { probes: [false, true].map((second) => groupingProbe(kind, variant, seed, second)) };
        },
      }),
    ),
  );
}

function scaleItems(): BankItem[] {
  const selected = [0, 1, 4, 5, 7, 9, 10, 11, 12, 14];
  return selected.flatMap((shapeIndex, index) =>
    [1, 10, 100].map((factor): BankItem => {
      const shape = cuttingShapes[shapeIndex];
      if (!shape) throw new Error('Unknown scale shape');
      const tier = (factor === 1 ? 3 : factor === 10 ? 4 : 5) as Tier;
      return {
        id: `scale/${shape.name}/${factor}x`,
        family: 'scale',
        tier,
        level: tier,
        component: 'pointer.cutter',
        title: `${shape.name} at ${factor} times the base input`,
        cause: shape.cause,
        design: '2: cutting; validators 12.2: scale and hostile 100k-character inputs',
        generate(seed) {
          // The long opaque body crosses 100k at the largest size without inventing sentence rules.
          const t = token(seed, index);
          const base = index === 5 ? 120 : 10;
          const probes = [base * factor, base * factor + 1].map((count) => {
            const fixture = shape.make(t, count);
            if (index === 5 && factor === 100 && fixture.source.length < 100_000) {
              throw new Error('Scale plant failed to reach 100k characters');
            }
            return cutProbe(fixture, `${t}.md`);
          });
          return { probes, budgetMs: 10_000, budgetBytes: 64 * 1024 * 1024 };
        },
      };
    }),
  );
}

export function structureItems(): BankItem[] {
  return [...cuttingItems(), ...groupingItems(), ...scaleItems()];
}
