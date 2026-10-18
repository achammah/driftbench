import type { ItemContext } from '../bank/types';
import { Problem } from '../bank/types';
import type { LedgerView, Link, LinksApi, PointerSut, ScanResult } from '../sut/port';
import {
  cloneWorld,
  distinctSentences,
  filesOf,
  type RenderOptions,
  type World,
  worldOf,
} from './anchor-world';
import { build, liveByText, scanOk } from './estate';
import { constant } from './labellers';
import { Prose } from './words';

/** A world of rules (units labelled `rule`, so each has an atom mapping) and blocks that link to them. */
export type LinkWorld = {
  w: World;
  render: RenderOptions;
  first: ScanResult & { ledger: LedgerView };
  links: Link[];
  /** For each rule text, the owners that link to it. */
  owners: Map<string, string[]>;
  rules: string[];
  api: LinksApi;
};

export function linksApi(sut: PointerSut): LinksApi {
  if (!sut.links)
    throw new Problem('the binding of the reader offers no links api: layer C is not reachable');
  return sut.links;
}

export async function scanRules(
  sut: PointerSut,
  w: World,
  render: RenderOptions,
  previous?: string,
): Promise<ScanResult & { ledger: LedgerView }> {
  return scanOk(sut, {
    files: build(filesOf(w, render)).files,
    labeler: constant('rule'),
    ...(previous ? { previousLedger: previous } : {}),
  });
}

export async function linkWorld(
  ctx: ItemContext,
  options: {
    files?: number;
    per?: number;
    blocks?: number;
    perBlock?: number;
    noLinks?: number;
    mustLink?: number[];
    heading?: boolean;
    render?: RenderOptions;
    prose?: Prose;
  } = {},
): Promise<LinkWorld> {
  const p = options.prose ?? new Prose(ctx.seed, ctx.id);
  const w = worldOf(p, { files: options.files ?? 3, perFile: options.per ?? 8 });
  const render: RenderOptions = { heading: options.heading ?? true, ...(options.render ?? {}) };
  const first = await scanRules(ctx.sut, w, render);
  const api = linksApi(ctx.sut);
  const rules = w.texts.flat();
  const rng = p.random;
  const blocks = options.blocks ?? 12;
  const links: Link[] = [];
  const owners = new Map<string, string[]>();
  for (let b = 0; b < blocks; b += 1) {
    const owner = `block-${String(b + 1).padStart(3, '0')}`;
    const k = b < (options.noLinks ?? 0) ? 0 : 1 + Math.floor(rng() * (options.perBlock ?? 3));
    const picked = new Set<number>();
    while (picked.size < Math.min(k, rules.length)) picked.add(Math.floor(rng() * rules.length));
    for (const i of picked) {
      const text = rules[i] as string;
      const entry = liveByText(first.ledger, text);
      if (!entry) throw new Problem(`the first scan has no entry for ${text.slice(0, 30)}`);
      links.push(api.create(first.ledger, owner, entry.id, 'verifies', 'verified'));
      owners.set(text, [...(owners.get(text) ?? []), owner]);
    }
  }
  for (const i of options.mustLink ?? []) {
    const text = rules[i] as string;
    if ((owners.get(text) ?? []).length > 0) continue;
    const entry = liveByText(first.ledger, text);
    if (!entry) throw new Problem(`the first scan has no entry for ${text.slice(0, 30)}`);
    const owner = `block-must-${i}`;
    links.push(api.create(first.ledger, owner, entry.id, 'verifies', 'verified'));
    owners.set(text, [owner]);
  }
  return { w, render, first, links, owners, rules, api };
}

export const ownersOf = (lw: LinkWorld, texts: string[]): string[] =>
  [...new Set(texts.flatMap((t) => lw.owners.get(t) ?? []))].sort();

export { cloneWorld, distinctSentences };
