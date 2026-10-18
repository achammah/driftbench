import type { EstateInput, Refusal, StoreDoc } from '../../interface';
import { OWNER_DATE } from '../constants';
import { build, type ItemContext, type StemRun } from '../item';
import { fileOf, QUANTITIES, ruleSentence } from '../oracle/conditions';
import {
  estateOf,
  type RuleSpec,
  refusalsMentioning,
  type ToolSpec,
  type ToolValue,
  valueByQuote,
  variablesCiting,
} from '../oracle/estate';
import { cpuMs, must, type Rng, show } from '../util';
import { basicSpan } from './sources';

/**
 * Family quotes: a value of the estate keeps a quote with its source path, and a value without a findable
 * quote is refused. The items drive the check through tool evidence (every value has its own quote) and through
 * condition spans (the span is the quote).
 */

const WORDS = [
  'amber',
  'harbor',
  'lantern',
  'meadow',
  'ledger',
  'market',
  'orchard',
  'canal',
  'falcon',
  'glacier',
  'island',
  'jungle',
  'kettle',
  'lagoon',
  'mirror',
  'planet',
  'quartz',
  'river',
  'saddle',
  'timber',
  'valley',
  'willow',
];

/** A line of ordinary prose that is unique for index k. */
export function plainLine(rng: Rng, k: number): string {
  return `Note ${k}: the ${rng.pick(WORDS)} and the ${rng.pick(WORDS)} are kept in the ${rng.pick(WORDS)} folder.`;
}

export function plainLines(rng: Rng, count: number): string[] {
  return Array.from({ length: count }, (_, k) => plainLine(rng, k + 1));
}

const tool = (field: string, source: string, values: ToolValue[]): ToolSpec => ({
  tool: 'ledger.post',
  field,
  source,
  values,
});

/** An estate of one rule with the given tool evidence fields. */
export function toolEstate(
  files: Record<string, string>,
  tools: ToolSpec[],
  source = 'TOOLS.md',
): EstateInput {
  return estateOf(files, [{ id: 'R1', source, conditions: [], tools }]);
}

function mustRefuse(store: StoreDoc, quote: string, id: string, label: string): void {
  const kept = valueByQuote(store, quote);
  must(
    !kept,
    () => `${label}: the value ${id} was kept with the quote ${show(quote, 80)}; it must be refused`,
  );
  const named = refusalsMentioning(store, id);
  must(
    named.length >= 1,
    () => `${label}: the refusal list ${show(store.refused)} does not name the value ${id}`,
  );
}

function mustKeep(store: StoreDoc, quote: string, id: string, label: string, source?: string): void {
  const hit = valueByQuote(store, quote);
  must(
    !!hit,
    () =>
      `${label}: the value ${id} with the findable quote ${show(quote, 80)} is not in the store (refused: ${show(store.refused)})`,
  );
  if (source !== undefined) {
    const prov = (hit?.value.provenance ?? []).find((p) => p.kind === 'quote' && p.quote === quote);
    must(
      prov?.kind === 'quote' && prov.path === source,
      () => `${label}: the value ${id} should cite the source path ${source}, it cites ${show(prov)}`,
    );
  }
}

/** A good second field so that the store is never empty while a bad value is tested. */
function goodField(rng: Rng, files: Record<string, string>): { spec: ToolSpec; file: string } {
  const quote = `status value open means ${rng.pick(WORDS)} work in progress`;
  const text = `${files['TOOLS.md'] ?? ''}- ledger.post ${quote}.\n`;
  return { spec: tool('status', 'TOOLS.md', [{ id: 'open', quote }]), file: text };
}

const TOOLS_HEAD = '# Tools\n\n';

/** Three values with quotes that are lines of the file; returns the file text, the values and the lines. */
function threeValues(rng: Rng): { values: ToolValue[]; lines: string[]; file: string } {
  const ids = rng.sample(
    ['payable', 'receivable', 'refund', 'credit', 'urgent', 'normal', 'archive', 'inbox'],
    3,
  );
  const values = ids.map((id) => ({
    id,
    quote: `account value ${id} means ${rng.pick(WORDS)} work for the ${rng.pick(WORDS)} desk`,
  }));
  const lines = values.map((v) => `- ledger.post ${v.quote}.`);
  const filler = plainLines(rng, 6);
  const all = [...filler];
  for (const l of lines) all.splice(rng.int(0, all.length), 0, l);
  return { values, lines, file: `${TOOLS_HEAD}${all.join('\n')}\n` };
}

/** A change to a quote that leaves it out of the file, found by trying positions until the file lacks it. */
function mutate(rng: Rng, quote: string, file: string, kind: string): string {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    let m = quote;
    const mid = rng.int(4, quote.length - 4);
    switch (kind) {
      case 'all-caps':
        m = quote.toUpperCase();
        break;
      case 'first-letter-case':
        m = quote.charAt(0).toUpperCase() + quote.slice(1);
        break;
      case 'inserted-char':
        m = `${quote.slice(0, mid)}x${quote.slice(mid)}`;
        break;
      case 'deleted-char':
        m = quote.slice(0, mid) + quote.slice(mid + 1);
        break;
      case 'substituted-char': {
        const c = quote.charAt(mid);
        m = quote.slice(0, mid) + (c === 'e' ? 'a' : 'e') + quote.slice(mid + 1);
        break;
      }
      case 'transposed-chars':
        if (quote.charAt(mid) === quote.charAt(mid + 1)) continue;
        m = quote.slice(0, mid) + quote.charAt(mid + 1) + quote.charAt(mid) + quote.slice(mid + 2);
        break;
      case 'skipped-word': {
        const words = quote.split(' ');
        const at = rng.int(1, words.length - 2);
        words.splice(at, 1);
        m = words.join(' ');
        break;
      }
      default:
        throw new Error(`unknown mutation ${kind}`);
    }
    if (m !== quote && !foldForGeneration(file).includes(foldForGeneration(m)) && m.trim() !== '') return m;
  }
  throw new Error(`could not mutate the quote ${quote} by ${kind}`);
}

/** Known positive equivalences from docs/variables.md Provenance, independent of the reader. */
export const NORMALIZED_QUOTES = [
  ['space runs', 'the account\t  is\r\nopen', 'the account is open'],
  ['typographic quotes', 'the “café” account’s value', 'the "café" account\'s value'],
  ['composed accents', 'cafe\u0301 is open', 'café is open'],
  ['invisible characters', 'the ac\u200bcount is\u00ad open', 'the account is open'],
  ['markdown escaping', 'the \\*open\\* account', 'the *open* account'],
] as const;

function normalizationControls(ctx: ItemContext): void {
  for (const [label, text, quote] of NORMALIZED_QUOTES) {
    const store = build(ctx, {
      estate: toolEstate({ 'TOOLS.md': text }, [tool('account', 'TOOLS.md', [{ id: 'normalized', quote }])]),
    });
    mustKeep(store, quote, 'normalized', label, 'TOOLS.md');
    must(store.refused.length === 0, () => `${label}: a normalized findable quote was refused`);
  }
}

/** Generator guard only: changes of whitespace alone are not negative examples. */
function foldForGeneration(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim();
}

export const QUOTES_RUNS: Record<string, StemRun> = {
  'quotes.accept.exact': (variant, ctx) => {
    const { rng } = ctx;
    let file: string;
    let values: ToolValue[];
    if (variant === 'whole-file') {
      const quote = `account value payable means ${rng.pick(WORDS)} work`;
      values = [{ id: 'payable', quote }];
      file = quote;
    } else {
      const t = threeValues(rng);
      values = t.values;
      file = t.file;
      if (variant === 'at-start') {
        file = `${values[0]?.quote}.\n${file}`;
      } else if (variant === 'at-end') {
        file = `${file}${values[values.length - 1]?.quote}`;
      }
    }
    const store = build(ctx, {
      estate: toolEstate({ 'TOOLS.md': file }, [tool('account', 'TOOLS.md', values)]),
    });
    for (const v of values) mustKeep(store, v.quote, v.id, variant, 'TOOLS.md');
    must(
      store.refused.length === 0,
      () => `every quote is findable but the store refuses ${show(store.refused)}`,
    );
  },

  'quotes.refuse.absent': (variant, ctx) => {
    const { rng } = ctx;
    const t = threeValues(rng);
    const good = t.values[0] as ToolValue;
    const bad: ToolValue = {
      id: 'badvalue',
      quote:
        variant === 'unrelated-text'
          ? 'zebra crossings are a safe place to wait for the tram'
          : variant === 'other-file-text'
            ? 'the secret recipe sits in the other file only'
            : `${(t.values[1] as ToolValue).quote} extra`,
    };
    const files: Record<string, string> = { 'TOOLS.md': t.file, 'other.md': `Elsewhere: ${bad.quote}.\n` };
    must(!t.file.includes(bad.quote), 'the generator must leave the bad quote out of the tools file');
    const store = build(ctx, { estate: toolEstate(files, [tool('account', 'TOOLS.md', [good, bad])]) });
    mustKeep(store, good.quote, good.id, variant);
    mustRefuse(store, bad.quote, bad.id, variant);
  },

  'quotes.refuse.unknown-source': (variant, ctx) => {
    const { rng } = ctx;
    const t = threeValues(rng);
    const good = goodField(rng, { 'TOOLS.md': t.file });
    const source =
      variant === 'missing-path' ? 'docs/missing.md' : variant === 'path-case-differs' ? 'tools.md' : '';
    const bad: ToolValue = t.values[0] as ToolValue;
    const store = build(ctx, {
      estate: toolEstate({ 'TOOLS.md': good.file }, [good.spec, tool('account', source, [bad])]),
    });
    const goodValue = good.spec.values[0] as ToolValue;
    mustKeep(store, goodValue.quote, goodValue.id, variant);
    mustRefuse(store, bad.quote, bad.id, `${variant} (source ${show(source)})`);
  },

  'quotes.refuse.empty-quote': (variant, ctx) => {
    const { rng } = ctx;
    const t = threeValues(rng);
    const good = t.values[0] as ToolValue;
    const bad: ToolValue = { id: 'emptyvalue', quote: variant === 'empty' ? '' : '  \t ' };
    const file = `${t.file}Spacing sample:  \t  end\n`;
    must(file.includes(bad.quote), 'the generator must put the blank quote in the file');
    const store = build(ctx, {
      estate: toolEstate({ 'TOOLS.md': file }, [tool('account', 'TOOLS.md', [good, bad])]),
    });
    mustKeep(store, good.quote, good.id, variant);
    const var0 = store.variables.find((v) =>
      v.values.some((x) => (x.provenance ?? []).some((p) => p.kind === 'quote' && p.quote === good.quote)),
    );
    must(
      !!var0 && var0.values.length === 1,
      () => `the variable should hold only the good value; it holds ${show(var0?.values.map((v) => v.id))}`,
    );
    must(
      refusalsMentioning(store, bad.id).length >= 1,
      () => `the refusal list ${show(store.refused)} does not name the value ${bad.id}`,
    );
  },

  'quotes.refuse.inexact': (variant, ctx) => {
    // Every negative mutation retains case/punctuation sensitivity after normalization.
    const sensitivity = build(ctx, {
      estate: toolEstate({ 'TOOLS.md': 'account value payable is open.' }, [
        tool('account', 'TOOLS.md', [
          { id: 'good', quote: 'account value payable' },
          { id: 'casechange', quote: 'ACCOUNT value payable' },
          { id: 'punctuationchange', quote: 'account value payable!' },
        ]),
      ]),
    });
    mustKeep(sensitivity, 'account value payable', 'good', 'case/punctuation positive control');
    mustRefuse(sensitivity, 'ACCOUNT value payable', 'casechange', 'case sensitivity');
    mustRefuse(sensitivity, 'account value payable!', 'punctuationchange', 'punctuation sensitivity');
    const { rng } = ctx;
    const t = threeValues(rng);
    const files: Record<string, string> = { 'TOOLS.md': t.file };
    const good = t.values[0] as ToolValue;
    const base = t.values[1] as ToolValue;
    let mutated: string;
    if (variant === 'joined-lines') {
      const lines = t.file.split('\n').filter((l) => l.startsWith('Note '));
      const a = (lines[0] as string).split(' ').slice(-4).join(' ');
      const c = (lines[2] as string).split(' ').slice(0, 4).join(' ');
      mutated = `${a} ${c}`;
      must(!t.file.includes(mutated), 'the generator must leave the joined quote out of the file');
    } else {
      mutated = mutate(rng, base.quote, t.file, variant);
    }
    const bad: ToolValue = { id: base.id, quote: mutated };
    const store = build(ctx, { estate: toolEstate(files, [tool('account', 'TOOLS.md', [good, bad])]) });
    mustKeep(store, good.quote, good.id, variant);
    mustRefuse(store, bad.quote, bad.id, `${variant}: ${show(mutated, 70)}`);
  },

  'quotes.accept.multiline': (variant, ctx) => {
    normalizationControls(ctx);
    const { rng } = ctx;
    const eol = variant === 'crlf' ? '\r\n' : '\n';
    const lines = [...plainLines(rng, 4)];
    const a = `account value payable means ${rng.pick(WORDS)} work`;
    const b = `and also the ${rng.pick(WORDS)} desk`;
    const c = `and the ${rng.pick(WORDS)} team`;
    const quote = [a, b, c].join(eol);
    lines.splice(2, 0, quote);
    const file = `# Tools${eol}${eol}${lines.join(eol)}${eol}`;
    must(file.includes(quote), 'the generator must put the multi-line quote in the file');
    const store = build(ctx, {
      estate: toolEstate({ 'TOOLS.md': file }, [tool('account', 'TOOLS.md', [{ id: 'payable', quote }])]),
    });
    mustKeep(store, quote, 'payable', variant, 'TOOLS.md');
  },

  'quotes.plain-text-matching': (variant, ctx) => {
    const { rng } = ctx;
    const literal: Record<string, string> = {
      'dot-star-literal': 'match .* anything',
      'group-alternation-literal': 'pick (a|b)+ pairs',
      'brackets-literal': 'code [0-9]{3} digits',
      'backslash-d-literal': 'number \\d+$ at the end',
    };
    const lookalike: Record<string, { quote: string; line: string }> = {
      'dot-star-lookalike': {
        quote: 'invoice.*total',
        line: `The invoice ${rng.int(100, 900)} total is shown.`,
      },
      'alternation-lookalike': { quote: 'note a|b', line: 'The note a is on the desk.' },
    };
    const lines = plainLines(rng, 5);
    const good = `account value payable means ${rng.pick(WORDS)} work`;
    if (variant in literal) {
      const quote = literal[variant] as string;
      lines.splice(2, 0, `Pattern text: ${quote} appears here.`);
      lines.push(`- ledger.post ${good}.`);
      const store = build(ctx, {
        estate: toolEstate({ 'TOOLS.md': `${TOOLS_HEAD}${lines.join('\n')}\n` }, [
          tool('account', 'TOOLS.md', [
            { id: 'payable', quote: good },
            { id: 'pattern', quote },
          ]),
        ]),
      });
      mustKeep(store, good, 'payable', variant);
      mustKeep(store, quote, 'pattern', variant);
    } else {
      const { quote, line } = lookalike[variant] as { quote: string; line: string };
      lines.splice(2, 0, line);
      lines.push(`- ledger.post ${good}.`);
      const file = `${TOOLS_HEAD}${lines.join('\n')}\n`;
      must(!file.includes(quote), 'the generator must leave the pattern text out of the file');
      must(new RegExp(quote).test(file), 'the lookalike must match the file as a pattern');
      const store = build(ctx, {
        estate: toolEstate({ 'TOOLS.md': file }, [
          tool('account', 'TOOLS.md', [
            { id: 'payable', quote: good },
            { id: 'pattern', quote },
          ]),
        ]),
      });
      mustKeep(store, good, 'payable', variant);
      mustRefuse(store, quote, 'pattern', variant);
    }
  },

  'quotes.accept.unicode': (variant, ctx) => {
    normalizationControls(ctx);
    const { rng } = ctx;
    const quote =
      variant === 'accents'
        ? 'déjà vu au café de la société'
        : variant === 'cjk'
          ? '請求書の合計が上限を超える場合'
          : variant === 'emoji'
            ? 'ready \u{1F642} ok \u{1F44D}\u{1F3FD} done'
            : 'שלום עולם אבג מערכת';
    const lines = plainLines(rng, 5);
    lines.splice(2, 0, `Text: ${quote}.`);
    const file = `${TOOLS_HEAD}${lines.join('\n')}\n`;
    const store = build(ctx, {
      estate: toolEstate({ 'TOOLS.md': file }, [
        tool('account', 'TOOLS.md', [{ id: 'unicodevalue', quote }]),
      ]),
    });
    mustKeep(store, quote, 'unicodevalue', variant, 'TOOLS.md');
  },

  'quotes.per-value-granularity': (variant, ctx) => {
    const { rng } = ctx;
    const t = threeValues(rng);
    const badSet = new Set(
      variant === 'one-of-three'
        ? [1]
        : variant === 'two-of-three'
          ? [0, 2]
          : variant === 'first-bad'
            ? [0]
            : [0, 1, 2],
    );
    const values: ToolValue[] = t.values.map((v, i) =>
      badSet.has(i) ? { id: v.id, quote: `${v.quote} (edited)` } : v,
    );
    const store = build(ctx, {
      estate: toolEstate({ 'TOOLS.md': t.file }, [tool('account', 'TOOLS.md', values)]),
    });
    values.forEach((v, i) => {
      if (badSet.has(i)) mustRefuse(store, v.quote, v.id, variant);
      else mustKeep(store, v.quote, v.id, variant);
    });
    must(
      store.variables.every((v) => v.values.length > 0),
      () =>
        `the store holds a variable with no value: ${show(store.variables.map((v) => [v.id, v.values.length]))}`,
    );
    if (variant === 'all-bad') {
      must(
        store.variables.length === 0,
        () =>
          `every value was refused, so the variable should not be stored; the store holds ${show(store.variables.map((v) => v.id))}`,
      );
    }
  },

  'quotes.refusal-report': (variant, ctx) => {
    const { rng } = ctx;
    const t = threeValues(rng);
    const bad = variant === 'one' ? [1] : [0, 2];
    const values: ToolValue[] = t.values.map((v, i) =>
      bad.includes(i) ? { id: v.id, quote: `${v.quote} (gone)` } : v,
    );
    const store = build(ctx, {
      estate: toolEstate({ 'TOOLS.md': t.file }, [tool('account', 'TOOLS.md', values)]),
    });
    for (const i of bad) {
      const id = (values[i] as ToolValue).id;
      const named = refusalsMentioning(store, id);
      must(
        named.length === 1,
        () =>
          `the value ${id} should be named by exactly one refusal, found ${named.length} in ${show(store.refused)}`,
      );
      const r = named[0] as Refusal;
      must(
        typeof r.reason === 'string' && r.reason.trim().length > 0,
        () => `the refusal of ${id} has no reason: ${show(r)}`,
      );
      if (variant === 'reason-text') {
        must(
          r.reason.trim().length >= 8 && r.reason !== r.what,
          () => `the reason of the refusal of ${id} should say why, it says ${show(r.reason)}`,
        );
      }
    }
    for (const [i, v] of values.entries()) {
      if (!bad.includes(i)) {
        const named = refusalsMentioning(store, v.id);
        must(named.length === 0, () => `the findable value ${v.id} is named by a refusal: ${show(named)}`);
      }
    }
  },

  'quotes.owner-conversation-exempt': (variant, ctx) => {
    const { rng } = ctx;
    const t = threeValues(rng);
    const estate = toolEstate({ 'TOOLS.md': t.file }, [tool('account', 'TOOLS.md', t.values)]);
    const base = build(ctx, { estate });
    const first = valueByQuote(base, (t.values[0] as ToolValue).quote);
    must(!!first, 'the base store lacks the first value');
    const variable = (first as NonNullable<typeof first>).variable;
    if (variant === 'conversation-value') {
      const store = build(ctx, {
        estate,
        conversations: [1, 2, 3].map((i) => ({ id: `c${i}`, values: { [variable.id]: 'novelvalue' } })),
      });
      const v = store.variables.find((x) => x.id === variable.id)?.values.find((x) => x.id === 'novelvalue');
      must(
        !!v,
        () =>
          `the value seen in conversations is not in the store: ${show(store.variables.find((x) => x.id === variable.id)?.values.map((x) => x.id))}`,
      );
      must(
        refusalsMentioning(store, 'novelvalue').length === 0,
        () => `a value seen in conversations is refused for lacking a quote: ${show(store.refused)}`,
      );
    } else {
      const words =
        variant === 'owner-words-quote-shaped'
          ? 'account value special means the exact text that no file holds'
          : `The owner adds a case ${rng.int(10, 99)}.`;
      const store = build(ctx, {
        estate,
        owner: { values: [{ variable: variable.id, value: 'ownerval', words, date: OWNER_DATE }] },
      });
      const v = store.variables.find((x) => x.id === variable.id)?.values.find((x) => x.id === 'ownerval');
      must(!!v, () => `the owner value is not in the store: ${show(store.refused)}`);
      must(
        refusalsMentioning(store, 'ownerval').length === 0,
        () => `an owner value is refused for lacking a file quote: ${show(store.refused)}`,
      );
    }
  },

  'quotes.condition-span-unfindable': (variant, ctx) => {
    const { rng } = ctx;
    const q = rng.pick(QUANTITIES);
    const real = basicSpan(rng, q, rng.int(10, 900));
    let span = real.text;
    let files: Record<string, string>;
    const source = 'CLAUDE.md';
    const other = basicSpan(rng, rng.pick(QUANTITIES.filter((x) => x.noun !== q.noun)), rng.int(10, 900));
    if (variant === 'edited-wording') {
      const swapped = real.text.replace(/ is (over|at least|under|at most) /, ' tops ');
      must(swapped !== real.text, 'the generator could not edit the wording');
      files = { [source]: fileOf(rng, [ruleSentence(swapped, rng), ruleSentence(other.text, rng)], 4) };
    } else if (variant === 'wrong-file') {
      files = {
        [source]: fileOf(rng, [ruleSentence(other.text, rng)], 4),
        'docs/policy.md': fileOf(rng, [ruleSentence(real.text, rng)], 4),
      };
    } else {
      span = real.text.replace(/(\d)/, (d: string) => String((Number(d) + 1) % 10));
      files = { [source]: fileOf(rng, [ruleSentence(real.text, rng), ruleSentence(other.text, rng)], 4) };
    }
    must(!files[source]?.includes(span), 'the generator must leave the span out of its file');
    const rules: RuleSpec[] = [{ id: 'R1', source, conditions: [span, other.text], tools: [] }];
    const store = build(ctx, { estate: estateOf(files, rules) });
    const hit = variablesCiting(store, span, source);
    must(
      hit.length === 0,
      () => `the span ${show(span, 80)} is not in ${source} but variable ${hit[0]?.id} cites it`,
    );
    must(
      refusalsMentioning(store, span, 'R1').length >= 1,
      () => `the refusal list ${show(store.refused)} does not name the span ${show(span, 80)}`,
    );
    const good = variablesCiting(store, other.text);
    must(
      good.length === 1,
      () => `the findable span ${show(other.text, 80)} should still give one variable, found ${good.length}`,
    );
  },

  'quotes.stored-verbatim': (variant, ctx) => {
    const { rng } = ctx;
    const core = `account value payable means ${rng.pick(WORDS)} work`;
    const lines = plainLines(rng, 4);
    let quote = core;
    let file: string;
    if (variant === 'padded-spaces') {
      quote = `   ${core}   `;
      lines.splice(2, 0, `${quote}`);
      file = `${TOOLS_HEAD}${lines.join('\n')}\n`;
    } else if (variant === 'trailing-newline') {
      quote = `${core}\n`;
      lines.splice(2, 0, core);
      file = `${TOOLS_HEAD}${lines.join('\n')}\n`;
    } else {
      lines.splice(2, 0, `- ledger.post ${core}.`);
      file = `${TOOLS_HEAD}${lines.join('\n')}\n`;
    }
    must(file.includes(quote), 'the generator must put the quote in the file');
    const store = build(ctx, {
      estate: toolEstate({ 'TOOLS.md': file }, [tool('account', 'TOOLS.md', [{ id: 'payable', quote }])]),
    });
    mustKeep(store, quote, 'payable', variant, 'TOOLS.md');
  },

  'quotes.never-reads-disk': (variant, ctx) => {
    const files = { 'TOOLS.md': `${TOOLS_HEAD}Nothing about hosts here.\n` };
    const spec =
      variant === 'etc-hosts'
        ? { source: '/etc/hosts', quote: 'localhost' }
        : variant === 'traversal'
          ? { source: '../../../../../../../../etc/hosts', quote: 'localhost' }
          : { source: `${ctx.root.replace(/\/$/, '')}/package.json`, quote: '"private": true' };
    const store = build(ctx, {
      estate: toolEstate(files, [tool('account', spec.source, [{ id: 'diskvalue', quote: spec.quote }])]),
    });
    mustRefuse(store, spec.quote, 'diskvalue', `${variant}: source ${spec.source}`);
  },

  'quotes.large-files': (variant, ctx) => {
    const { rng } = ctx;
    const bytes = variant === 'hundred-kb' ? 100_000 : 1_000_000;
    const lines: string[] = [];
    let size = 0;
    for (let k = 1; size < bytes; k += 1) {
      const l = plainLine(rng, k);
      lines.push(l);
      size += l.length + 1;
    }
    let values: ToolValue[];
    if (variant === 'two-thousand-values') {
      values = Array.from({ length: 2000 }, (_, i) => ({
        id: `item${String(i).padStart(4, '0')}`,
        quote: `Record item${String(i).padStart(4, '0')} stores ${i * 7 + 13}`,
      }));
      for (const v of values) lines.splice(rng.int(0, lines.length), 0, `${v.quote}.`);
    } else {
      const quote = `account value payable means ${rng.pick(WORDS)} work in the last section`;
      values = [{ id: 'payable', quote }];
      lines.splice(lines.length - 3, 0, `- ledger.post ${quote}.`);
    }
    const file = `${TOOLS_HEAD}${lines.join('\n')}\n`;
    const estate = toolEstate({ 'TOOLS.md': file }, [tool('account', 'TOOLS.md', values)]);
    const { value: store, ms } = cpuMs(() => build(ctx, { estate }));
    for (const v of values.slice(0, 5)) mustKeep(store, v.quote, v.id, variant);
    const kept = store.variables.reduce((n, v) => n + v.values.length, 0);
    must(kept === values.length, () => `${kept} of ${values.length} findable values are in the store`);
    must(
      ms <= 3000,
      () =>
        `verifying ${values.length} quote(s) in a ${Math.round(file.length / 1000)} KB file took ${Math.round(ms)} ms of processor time, over 3000 ms`,
    );
  },
};
