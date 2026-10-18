import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadSpecFile } from '@agent-nexus/driftbench-core';
import { loadEstateMap } from '@agent-nexus/driftbench-estate';
import { renderAsk } from '@agent-nexus/driftbench-generate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { FIXTURE, type SuiteSpec } from '../../src/ladders/estate/bank/fixture-suite';
import { type AskEnv, checkAsk, envOf, flat } from '../../src/ladders/estate/bank/task-check';
import { fieldsOf } from '../../src/ladders/estate/bank/task-span';

// The independent review's attack matrix, using the primary row atom rather than only the cited ask source.
// Every mutation re-renders the recorded pieces, including the two hazard asks in the committed suite.
type From = { form: string; field: string; frame: string; shape: string; context?: string; pieces: string[] };
type Meta = { atoms: string[]; testType: string; mode: string; from: From };
type Attack = { make: (spec: SuiteSpec, piece: string, quote: string) => string | undefined; ask?: boolean };
type Count = { tried: number; accepted: number };
const metaOf = (spec: SuiteSpec): Meta => spec.spec.metadata?.estate as Meta;
const whenOf = (spec: SuiteSpec): { user: string } =>
  (spec.spec.blocks[0] as { when: { user: string } }).when;
const words = (text: string): string[] => text.split(/\s+/).filter(Boolean);
let env: AskEnv;
let coded: SuiteSpec[];
const counts: Record<string, Count> = {};

beforeAll(async () => {
  const map = await loadEstateMap(join(FIXTURE, 'approved.yaml'));
  if (!map.ok) throw new Error('the committed fixture map does not load');
  env = envOf(
    map.map.atoms,
    parse(await readFile(join(FIXTURE, 'phrases.yaml'), 'utf8')),
    parse(await readFile(join(FIXTURE, 'sessions/index.yaml'), 'utf8')),
  );
  const entries = await readdir(join(FIXTURE, 'generated/specs'), { recursive: true, withFileTypes: true });
  coded = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.yaml')) continue;
    const path = join(entry.parentPath, entry.name);
    const loaded = await loadSpecFile(path);
    if (!loaded.ok) throw new Error(`the committed spec ${path} does not load`);
    const meta = loaded.spec.metadata?.estate as Meta;
    if (typeof meta.from?.form !== 'string') continue;
    coded.push({
      path,
      id: loaded.spec.id,
      atoms: meta.atoms,
      testType: meta.testType,
      mode: meta.mode,
      complete: true,
      spec: loaded.spec,
    });
  }
}, 300_000);

afterAll(async () => {
  const output = process.env.CODEX_FIX_742_REPORT;
  if (output) await writeFile(output, JSON.stringify(counts, null, 2));
});

const synonyms: Readonly<Record<string, string>> = {
  write: 'compose',
  report: 'describe',
  read: 'inspect',
  send: 'transmit',
  never: 'not',
  before: 'prior',
  file: 'document',
  supplier: 'vendor',
  invoice: 'bill',
  order: 'purchase',
  error: 'failure',
  missing: 'absent',
  ask: 'request',
  number: 'digit',
  use: 'employ',
  check: 'verify',
  request: 'appeal',
  tracking: 'tracing',
  code: 'identifier',
};

const ATTACKS: Record<string, Attack> = {
  'quote minus last word': { make: (_spec, _piece, quote) => words(quote).slice(0, -1).join(' ') },
  '5-word quote fragment': {
    make: (_spec, _piece, quote) =>
      words(quote).length >= 8 ? words(quote).slice(1, 6).join(' ') : undefined,
  },
  '5-word pool fragment': {
    make: (spec) => {
      const atom = env.byId.get(metaOf(spec).atoms[0] as string);
      if (!atom) throw new Error(`no primary atom for ${spec.id}`);
      return words(
        [
          atom.title,
          atom.situation,
          atom.provenance.quote,
          ...Object.values(atom.fields ?? {}).filter((value) => typeof value === 'string'),
        ]
          .filter(Boolean)
          .join(' '),
      )
        .slice(1, 6)
        .join(' ');
    },
  },
  'every other word': {
    make: (_spec, _piece, quote) =>
      words(quote)
        .filter((_word, index) => index % 2 === 0)
        .join(' '),
  },
  'tail half': {
    make: (_spec, _piece, quote) =>
      words(quote)
        .slice(Math.floor(words(quote).length / 2))
        .join(' '),
  },
  'head half': {
    make: (_spec, _piece, quote) =>
      words(quote)
        .slice(0, Math.ceil(words(quote).length / 2))
        .join(' '),
  },
  'piece minus last word': { make: (_spec, piece) => words(piece).slice(0, -1).join(' ') },
  'piece doubled': { make: (_spec, piece) => `${piece} ${piece}` },
  'not quote': { make: (_spec, _piece, quote) => `not ${quote}` },
  'never quote': { make: (_spec, _piece, quote) => `never ${quote}` },
  'never piece': { make: (_spec, piece) => `never ${piece}` },
  'reversed title': {
    make: (spec) =>
      words(env.byId.get(metaOf(spec).atoms[0] as string)?.title ?? '')
        .reverse()
        .join(' '),
  },
  'middle banana': {
    make: (_spec, _piece, quote) => {
      const list = words(quote);
      list[Math.floor(list.length / 2)] = 'banana';
      return list.join(' ');
    },
  },
  'word shuffle': {
    make: (_spec, _piece, quote) => {
      const list = words(quote);
      return [
        ...list.filter((_word, index) => index % 2),
        ...list.filter((_word, index) => !(index % 2)),
      ].join(' ');
    },
  },
  'sorted words': { make: (_spec, _piece, quote) => words(quote).sort().join(' ') },
  'random pool words': {
    make: (_spec, _piece, quote) => {
      const list = words(quote);
      let state = 1234567;
      return list
        .map(() => {
          state = (state * 1664525 + 1013904223) >>> 0;
          return list[state % list.length];
        })
        .join(' ');
    },
  },
  'reversed words': { make: (_spec, _piece, quote) => words(quote).reverse().join(' ') },
  'off-topic': { make: () => 'Polish the invisible banana beside a purple galaxy' },
  'wrong atom title': {
    make: (spec) =>
      env.atoms.find(
        (atom) =>
          !metaOf(spec).atoms.includes(atom.id) &&
          atom.id !== metaOf(spec).from.field.split('#')[0] &&
          atom.kind === 'instruction',
      )?.title,
  },
  'wrong atom clause': {
    make: (spec) => {
      const ids = new Set([...metaOf(spec).atoms, metaOf(spec).from.field.split('#')[0]]);
      return env.atoms
        .filter((atom) => !ids.has(atom.id))
        .flatMap(fieldsOf)
        .map((field) => field.tokens.join(' '))
        .find((text) => words(text).length >= 5 && !/[.,;:!?]/.test(text));
    },
  },
  'one synonym': {
    make: (_spec, piece) => {
      const list = words(piece);
      const index = list.findIndex((word) => synonyms[word.toLowerCase()]);
      if (index < 0) return undefined;
      list[index] = synonyms[(list[index] as string).toLowerCase()] as string;
      return list.join(' ');
    },
  },
  'cut at comma': {
    make: (_spec, piece) => (piece.includes(',') ? piece.slice(0, piece.indexOf(',')).trim() : undefined),
  },
  'garbage before piece': { make: (_spec, piece) => `Banana purple elephant, ${piece}` },
  'garbage after piece': { make: (_spec, piece) => `${piece} Then sing a song about the weather in space` },
  'garbage before ask': { make: (spec) => `Banana purple elephant, ${whenOf(spec).user}`, ask: true },
  'garbage after ask': {
    make: (spec) => `${whenOf(spec).user} Then sing a song about the weather in space.`,
    ask: true,
  },
};

describe('the independent primary-row attack classes', () => {
  it('accepts every committed code-written ask, including both hazards', () => {
    expect(coded).toHaveLength(467);
    expect(coded.filter((spec) => metaOf(spec).from.form === 'hazard')).toHaveLength(2);
    const rejected = coded.filter((spec) => checkAsk(spec, env).reasons.length > 0).map((spec) => spec.id);
    counts.real = { tried: coded.length, accepted: coded.length - rejected.length };
    expect(rejected).toEqual([]);
  });

  for (const [name, attack] of Object.entries(ATTACKS))
    it(`rejects ${name}`, () => {
      const count = { tried: 0, accepted: 0 };
      const survivors: string[] = [];
      for (const spec of coded) {
        const from = metaOf(spec).from;
        const piece = from.pieces[0];
        if (piece === undefined) throw new Error(`no piece in ${spec.id}`);
        const quote = env.byId.get(metaOf(spec).atoms[0] as string)?.provenance.quote ?? '';
        const value = attack.make(spec, piece, quote);
        if (!value || (!attack.ask && flat(value) === flat(piece))) continue;
        const copy = structuredClone(spec);
        if (attack.ask) whenOf(copy).user = value;
        else {
          metaOf(copy).from.pieces[0] = value;
          const rebuilt = renderAsk(metaOf(copy).from);
          if (rebuilt === undefined) throw new Error(`no render for ${copy.id}`);
          whenOf(copy).user = rebuilt;
        }
        count.tried += 1;
        if (checkAsk(copy, env).reasons.length === 0) {
          count.accepted += 1;
          survivors.push(`${spec.id}: ${value}`);
        }
      }
      counts[name] = count;
      expect(count.tried).toBeGreaterThan(0);
      expect(survivors, `${count.accepted} of ${count.tried} accepted`).toEqual([]);
    });
});
