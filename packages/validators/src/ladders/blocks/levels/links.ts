import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import {
  between,
  list,
  load,
  loadIssues,
  observed,
  pick,
  type RawSpec,
  type Rng,
  rngFor,
  run,
  SHOP,
  scriptedAdapter,
  shuffled,
} from '../harness';
import { KINDS, plantedAgent, token } from '../kinds';
import { type BlocksProduct, need } from '../product';
import { type Recipe, recipe } from '../recipe';
import { type BankItem, expectAll, fail, PASS, type Tier } from '../types';

/**
 * Level 8: section links and localization (PRs 423, 429 and 433; docs/concepts/blast-radius.md, "Prompt sections
 * and block links", on those branches). A prompt's section registry names each section by a stable id with
 * the hash of its text; `radius sections check` exits 1 when the registry no longer describes the prompt, and
 * `radius sections reanchor` exits 1 when a section is stale, text changed outside every section, or sections
 * changed order. A block names the sections it tests in `metadata.links`, which stays out of the spec hash, and
 * a link to an unknown block is refused. `radius localize` ranks the local sections by Ochiai suspiciousness
 * from a stored campaign: the planted section (linked to exactly the failing blocks) ranks first, a refuted
 * link counts for nothing, and a failure inherited from an earlier failing block of the same run is dropped.
 */

const SECTIONS_CLI = 'packages/cli/src/commands/radius-sections.ts';
const SECTIONS = 'packages/core/src/radius/sections.ts';
const IDENTITY = 'packages/core/src/spec/identity.ts';
const LINKS = 'packages/core/src/radius/links.ts';
const LOCALIZE = 'packages/core/src/radius/localize.ts';

const TOPICS = [
  'Greeting',
  'Opening hours',
  'Rental terms',
  'Deposit',
  'Damage',
  'Helmets',
  'Returns',
  'Recap',
  'Payment',
  'Closing',
  'Insurance',
  'Group rides',
];

type Prompt = { text: string; titles: string[]; bodies: string[]; preamble: string };

/**
 * A markdown prompt of k sections with seeded titles and bodies. Past a dozen sections the titles are numbered
 * and each body hides its rule inside a table row and a list among filler (about 500 characters a section), so
 * 200 sections make a prompt of about 100,000 characters.
 */
function prompt(rng: Rng, k: number): Prompt {
  const titles =
    k <= TOPICS.length
      ? shuffled(rng, TOPICS).slice(0, k)
      : Array.from({ length: k }, (_, i) => `${pick(rng, TOPICS)} ${i + 1}`);
  const bodies = titles.map((title) => {
    const rule = `Rule for ${title.toLowerCase()}: say ${pick(rng, SHOP.bikes)} code ${between(rng, 100, 999)} when asked.`;
    if (k <= TOPICS.length) return rule;
    const rows = Array.from(
      { length: 4 },
      (_, r) =>
        `| ${pick(rng, SHOP.bikes)} | ${between(rng, 1, 90)} days | ${r === 2 ? rule : `note ${between(rng, 100, 999)}`} |`,
    );
    const bullets = Array.from(
      { length: 4 },
      () =>
        `- ${pick(rng, SHOP.customers)} prefers the ${pick(rng, SHOP.bikes)} on weekdays ${between(rng, 1, 7)}.`,
    );
    return [
      `Background for ${title.toLowerCase()}, kept short.`,
      '',
      '| Bike | Term | Note |',
      '|---|---|---|',
      ...rows,
      '',
      ...bullets,
    ].join('\n');
  });
  const preamble = 'You are the Larkspur Cycles rental assistant.';
  return { text: render(preamble, titles, bodies), titles, bodies, preamble };
}

function render(preamble: string, titles: readonly string[], bodies: readonly string[]): string {
  return `${preamble}\n\n${titles.map((title, i) => `## ${title}\n\n${bodies[i]}\n`).join('\n')}`;
}

type Registry = {
  prompt_id: string;
  version: string;
  sections: { id: string; title?: string; scope?: string }[];
};

async function initRegistry(
  product: BlocksProduct,
  dir: string,
  p: Prompt,
  promptId: string,
): Promise<{ registry: Registry; path: string; promptPath: string; code: number; text: string }> {
  const promptPath = join(dir, `${promptId}.md`);
  writeFileSync(promptPath, p.text);
  const path = join(dir, `${promptId}.sections.yaml`);
  const result = await product.cli(
    ['radius', 'sections', 'init', promptPath, '--id', promptId, '--prompt-version', 'v1', '--out', path],
    dir,
  );
  let registry: Registry = { prompt_id: promptId, version: 'v1', sections: [] };
  try {
    registry = parse(readFileSync(path, 'utf8')) as Registry;
  } catch {
    // No registry was written: the item fails on the exit code below.
  }
  return { registry, path, promptPath, code: result.code, text: `${result.out}\n${result.err}` };
}

type Edit = {
  id: string;
  tier: Tier;
  exit: number;
  change(p: Prompt, rng: Rng): { text: string; stale?: number };
};

const EDITS: Edit[] = [
  { id: 'unchanged', tier: 1, exit: 0, change: (p) => ({ text: p.text }) },
  {
    id: 'edit-inside',
    tier: 2,
    exit: 1,
    change: (p, rng) => {
      const j = between(rng, 0, p.titles.length - 1);
      const bodies = p.bodies.map((body, i) =>
        i === j ? body.replace('when asked', 'whenever asked') : body,
      );
      return { text: render(p.preamble, p.titles, bodies), stale: j };
    },
  },
  {
    id: 'reordered',
    tier: 3,
    exit: 1,
    change: (p) => {
      const order = [...p.titles.keys()].reverse();
      return {
        text: render(
          p.preamble,
          order.map((i) => p.titles[i] as string),
          order.map((i) => p.bodies[i] as string),
        ),
      };
    },
  },
  {
    id: 'edit-outside',
    tier: 3,
    exit: 1,
    change: (p) => ({ text: render(`${p.preamble} Be brief.`, p.titles, p.bodies) }),
  },
];

function sectionItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const k of [3, 6, 10, 200]) {
    items.push({
      id: `links/sections/init-and-check/${k}`,
      family: 'links-sections',
      tier: 1,
      level: 6,
      component: SECTIONS_CLI,
      title: `radius sections init on a prompt of ${k} headed sections writes a registry of ${k} sections, and check on the same prompt exits 0`,
      cause:
        'radius sections init writes one registry section per heading, and check accepts the prompt it came from.',
      check: async ({ seed, scratch, product }) => {
        const rng = rngFor(seed, `init-${k}`);
        const dir = join(scratch, `sections-init-${k}-${seed}`);
        mkdirSync(dir, { recursive: true });
        const p = prompt(rng, k);
        const init = await initRegistry(product, dir, p, `larkspur-${k}`);
        if (init.code !== 0) return fail(`init exited ${init.code}: ${init.text.trim().slice(0, 200)}`);
        const titled = p.titles.filter((title) =>
          init.registry.sections.some((section) => section.title === title),
        );
        if (titled.length !== k)
          return fail(
            `the registry names ${titled.length} of the ${k} headings: ${list(init.registry.sections.map((s) => s.title ?? s.id))}`,
          );
        const check = await product.cli(
          ['radius', 'sections', 'check', init.path, '--prompt', init.promptPath],
          dir,
        );
        return check.code === 0
          ? PASS
          : fail(
              `check on the prompt init read exited ${check.code}: ${(check.out + check.err).trim().slice(0, 200)}`,
            );
      },
    });
    for (const edit of EDITS) {
      for (const command of ['check', 'reanchor'] as const) {
        if (command === 'check' && edit.id !== 'edit-inside' && edit.id !== 'unchanged') continue;
        const id = `links/sections/${command}/${edit.id}/${k}`;
        items.push({
          id,
          family: 'links-sections',
          tier: Math.min(5, edit.tier + (k >= 10 ? 1 : 0)) as Tier,
          level: 6,
          component: command === 'reanchor' ? SECTIONS : SECTIONS_CLI,
          title: `radius sections ${command} on the next prompt of ${k} sections (${edit.id.replace(/-/g, ' ')}) exits ${edit.exit}${edit.id === 'edit-inside' && command === 'reanchor' ? ' and writes a prompt_section change for exactly the edited section' : ''}`,
          cause:
            edit.id === 'edit-inside'
              ? 'A section is placed only where its text hashes as before: an edit inside it makes it stale.'
              : edit.id === 'unchanged'
                ? `radius sections ${command} keeps every section of an unchanged prompt.`
                : `radius sections reanchor reports ${edit.id === 'reordered' ? 'sections that changed order' : 'text changed outside every section'}.`,
          check: async ({ seed, scratch, product }) => {
            const rng = rngFor(seed, id);
            const dir = join(scratch, `${id.replace(/\//g, '-')}-${seed}`);
            mkdirSync(dir, { recursive: true });
            const p = prompt(rng, k);
            const promptId = `larkspur-${k}`;
            const init = await initRegistry(product, dir, p, promptId);
            if (init.code !== 0) return fail(`init exited ${init.code}: ${init.text.trim().slice(0, 200)}`);
            const next = edit.change(p, rng);
            const nextPath = join(dir, `${promptId}-v2.md`);
            writeFileSync(nextPath, next.text);
            if (command === 'check') {
              const result = await product.cli(
                ['radius', 'sections', 'check', init.path, '--prompt', nextPath],
                dir,
              );
              return result.code === edit.exit
                ? PASS
                : fail(`check exited ${result.code}, expected ${edit.exit}`);
            }
            const manifest = join(dir, 'change.yaml');
            const result = await product.cli(
              [
                'radius',
                'sections',
                'reanchor',
                init.path,
                '--prompt',
                init.promptPath,
                nextPath,
                '--to-version',
                'v2',
                '--out',
                join(dir, 'v2.sections.yaml'),
                '--change-out',
                manifest,
              ],
              dir,
            );
            if (result.code !== edit.exit)
              return fail(
                `reanchor exited ${result.code}, expected ${edit.exit}: ${(result.out + result.err).trim().slice(0, 200)}`,
              );
            if (next.stale === undefined) return PASS;
            const title = p.titles[next.stale] as string;
            const section = init.registry.sections.find(
              (each) => each.title === title || each.id === title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            );
            if (!section) return fail(`the registry has no section for the heading ${title}`);
            let changes: { kind: string; id: string }[] = [];
            try {
              changes =
                (parse(readFileSync(manifest, 'utf8')) as { changes?: { kind: string; id: string }[] })
                  .changes ?? [];
            } catch {
              return fail('reanchor wrote no change manifest');
            }
            const sectionChanges = changes
              .filter((change) => change.kind === 'prompt_section')
              .map((change) => change.id);
            const want = `${promptId}#${section.id}`;
            return sectionChanges.length === 1 && sectionChanges[0] === want
              ? PASS
              : fail(`the manifest names ${list(sectionChanges)}, expected exactly ${want}`);
          },
        });
      }
    }
  }
  return items;
}

/** Links stay out of the spec hash; a link to an unknown block is refused. */
function hashItems(): BankItem[] {
  const items: BankItem[] = [];
  const variants = [
    {
      id: 'one-declared',
      tier: 1,
      links: (n: number, rng: Rng) => [link(`b${between(rng, 0, n - 1)}`, 'intro', 'declared')],
    },
    {
      id: 'every-block',
      tier: 2,
      links: (n: number) => Array.from({ length: n }, (_, i) => link(`b${i}`, `s${i}`, 'declared')),
    },
    {
      id: 'all-statuses',
      tier: 2,
      links: (n: number) =>
        ['declared', 'attributed', 'verified', 'refuted', 'stale'].map((status, i) =>
          link(`b${i % n}`, `s${i}`, status),
        ),
    },
    { id: 'by-index', tier: 3, links: (n: number) => [link(n - 1, 'recap', 'declared')] },
    {
      id: 'whole-spec',
      tier: 3,
      links: () => [
        { to: { kind: 'prompt_section', prompt: 'larkspur', section: 'tone' }, status: 'declared' },
      ],
    },
    {
      id: 'spec-clause',
      tier: 3,
      links: (n: number, rng: Rng) => [
        {
          block: `b${between(rng, 0, n - 1)}`,
          to: { kind: 'spec_clause', spec: 'rental-policy', clause: `R-${between(rng, 1, 9)}.2` },
          status: 'declared',
        },
      ],
    },
    {
      id: 'source-turn',
      tier: 4,
      links: (n: number, rng: Rng) => [
        {
          block: `b${between(rng, 0, n - 1)}`,
          to: {
            kind: 'source_turn',
            conversation: `conv-${between(rng, 100, 999)}`,
            turn: between(rng, 0, 9),
          },
          relation: 'derived_from',
          status: 'attributed',
        },
      ],
    },
  ];
  for (const kind of KINDS)
    for (const variant of variants) {
      for (const compare of ['none-vs-links', 'promoted'] as const) {
        // One fix (links out of the identity): at most 24 items, so it never stands for more than its share.
        if (kind === 'code' && compare === 'promoted' && variants.indexOf(variant) < 2) continue;
        const id = `links/hash/${kind}/${variant.id}/${compare}`;
        items.push({
          id,
          family: 'links-hash',
          tier: Math.min(5, variant.tier + (kind === 'code' ? 1 : 0)) as Tier,
          level: 6,
          component: IDENTITY,
          title: `${compare === 'promoted' ? 'promoting every link of a spec to verified' : 'adding links to a spec'} of a ${kind} agent (${variant.id.replace(/-/g, ' ')}) changes neither the spec hash nor a Given hash`,
          cause: 'metadata.links stays out of the spec hash and the run identity.',
          check: async ({ seed, scratch, product }) => {
            const rng = rngFor(seed, id);
            const n = between(rng, 3, kind === 'code' ? 3 : 5);
            const planted =
              kind === 'code'
                ? recipe(
                    seed,
                    id,
                    'code',
                    Array.from({ length: n }, () => ({ fate: 'pass' as const })),
                  )
                : undefined;
            const base = planted
              ? { ...planted.raw, blocks: planted.raw.blocks.map((block, i) => ({ ...block, id: `b${i}` })) }
              : baseSpec(seed, id, n);
            const linked = variant.links(n, rng);
            const left: RawSpec = compare === 'promoted' ? { ...base, metadata: { links: linked } } : base;
            const right: RawSpec = {
              ...base,
              metadata: {
                links:
                  compare === 'promoted' ? linked.map((each) => ({ ...each, status: 'verified' })) : linked,
              },
            };
            const agent = () =>
              planted
                ? plantedAgent(product, 'code', planted.actions, { scratch }).adapter
                : scriptedAdapter(product, () => observed('Noted, it is free.'));
            const a = await run(product, left, agent());
            const b = await run(product, right, agent());
            return expectAll([
              [
                a.specHash === b.specHash,
                `the spec hash moved from ${a.specHash.slice(0, 12)} to ${b.specHash.slice(0, 12)}`,
              ],
              [
                a.blocks.map((x) => x.givenHash).join() === b.blocks.map((x) => x.givenHash).join(),
                'a Given hash moved',
              ],
            ]);
          },
        });
      }
    }
  for (const position of ['first', 'last', 'beyond']) {
    for (const form of ['id', 'index']) {
      const id = `links/hash/unknown-block/${position}/${form}`;
      items.push({
        id,
        family: 'links-hash',
        tier: 2,
        level: 6,
        component: LINKS,
        title: `a link to a block the spec does not hold (${form} ${position}) is refused with LINK_BLOCK_UNKNOWN, and the same link to a real block loads`,
        cause: 'spec validate refuses a link to a block the spec does not hold (LINK_BLOCK_UNKNOWN).',
        check: async ({ seed, product }) => {
          const rng = rngFor(seed, id);
          const n = between(rng, 2, 5);
          const base = baseSpec(seed, id, n);
          const target = position === 'first' ? 0 : position === 'last' ? n - 1 : n;
          const missing = form === 'id' ? `b${target}-gone` : n + between(rng, 0, 3);
          const real = form === 'id' ? `b${target === n ? n - 1 : target}` : Math.min(target, n - 1);
          const refused = loadIssues(product, {
            ...base,
            metadata: { links: [link(missing, 'intro', 'declared')] },
          });
          const accepted = loadIssues(product, {
            ...base,
            metadata: { links: [link(real, 'intro', 'declared')] },
          });
          return expectAll([
            [
              !refused.ok && refused.codes.includes('LINK_BLOCK_UNKNOWN'),
              `a link to ${missing} gave ${refused.ok ? 'ok' : list(refused.codes)}`,
            ],
            [accepted.ok, `a link to ${real} is refused: ${list(accepted.codes)}`],
          ]);
        },
      });
    }
  }
  return items;
}

function link(block: string | number, section: string, status: string) {
  return { block, to: { kind: 'prompt_section', prompt: 'larkspur', section }, status, created_by: 'author' };
}

function baseSpec(seed: number, tag: string, n: number): RawSpec {
  const rng = rngFor(seed, `${tag}#base`);
  return {
    id: `spec-${token(seed, `${tag}#spec`)}`,
    channel: 'chat',
    blocks: Array.from({ length: n }, (_, i) => ({
      id: `b${i}`,
      user: `[${token(seed, tag)}:${i}] Is the ${pick(rng, SHOP.bikes)} free?`,
      expect: { must: ['free'] },
    })),
  };
}

type Ranked = { section: string; score: number; best: number; worst: number };

/**
 * A stored campaign over specs whose blocks link to sections: the planted section is linked to exactly the
 * blocks that fail, the other local sections to passing blocks (and, by case, to failing blocks through a
 * refuted link, or to failures inherited from an earlier failing block).
 */
function localizeItems(): BankItem[] {
  const items: BankItem[] = [];
  const cases = [
    { id: 'clean', tier: 2 },
    { id: 'refuted-decoy', tier: 4 },
    { id: 'inherited-decoy', tier: 5 },
    { id: 'nothing-failed', tier: 2 },
  ] as const;
  for (const kind of KINDS)
    for (const localizeCase of cases) {
      for (const k of kind === 'code' ? [4, 6] : [4, 6, 9]) {
        for (const specs of kind === 'code' ? [2] : [2, 4]) {
          const id = `links/localize/${kind}/${localizeCase.id}/${k}/${specs}`;
          items.push({
            id,
            family: 'links-localize',
            tier: Math.min(5, localizeCase.tier + (specs === 4 ? 1 : 0) - (k === 4 ? 1 : 0)) as Tier,
            level: 6,
            component: LOCALIZE,
            title: `radius localize over ${specs} stored specs of a ${kind} agent and ${k} sections (${localizeCase.id.replace(/-/g, ' ')}) ${localizeCase.id === 'nothing-failed' ? 'exits 1' : 'ranks the planted section first and exits 0'}`,
            cause:
              localizeCase.id === 'refuted-decoy'
                ? 'radius localize leaves refuted links out of the Ochiai counts.'
                : localizeCase.id === 'inherited-decoy'
                  ? 'radius localize drops a failure inherited from an earlier failing block of the same run (H5).'
                  : localizeCase.id === 'nothing-failed'
                    ? 'radius localize exits 1 when nothing failed outside inherited failures.'
                    : 'radius localize ranks local sections by Ochiai over the linked blocks of the stored runs.',
            check: async ({ seed, scratch, product }) => {
              const rng = rngFor(seed, id);
              const dir = join(scratch, `${id.replace(/\//g, '-')}-${seed}`);
              mkdirSync(dir, { recursive: true });
              const p = prompt(rng, k);
              const promptId = 'larkspur';
              const init = await initRegistry(product, dir, p, promptId);
              if (init.code !== 0) return fail(`init exited ${init.code}: ${init.text.trim().slice(0, 200)}`);
              // init marks every section global; the author marks the headed ones local, as the command's note asks.
              const marked = {
                ...init.registry,
                sections: init.registry.sections.map((section) =>
                  p.titles.includes(section.title ?? '') ? { ...section, scope: 'local' } : section,
                ),
              };
              writeFileSync(init.path, stringify(marked));
              const local = marked.sections
                .filter((section) => section.scope === 'local')
                .map((section) => section.id);
              if (local.length < 3) return fail(`the registry holds ${local.length} local sections`);
              const [planted, decoy, ...rest] = shuffled(rng, local) as [string, string, ...string[]];
              const raws: RawSpec[] = [];
              const fates: boolean[][] = [];
              const recipes: Recipe[] = [];
              for (let s = 0; s < specs; s += 1) {
                const n = between(rng, 3, 4);
                const failAt = localizeCase.id === 'nothing-failed' ? -1 : between(rng, 0, n - 2);
                const failing = Array.from(
                  { length: n },
                  (_, i) =>
                    i === failAt || (localizeCase.id === 'inherited-decoy' && failAt >= 0 && i > failAt),
                );
                const plantedRecipe =
                  kind === 'code'
                    ? recipe(
                        seed,
                        `${id}#${s}`,
                        'code',
                        failing.map((f) => ({ fate: f ? ('fail' as const) : ('pass' as const) })),
                      )
                    : undefined;
                if (plantedRecipe) recipes.push(plantedRecipe);
                const blocks = plantedRecipe
                  ? plantedRecipe.raw.blocks.map((block, i) => ({ ...block, id: `b${i}` }))
                  : Array.from({ length: n }, (_, i) => ({
                      id: `b${i}`,
                      user: `[${token(seed, id)}:${s}:${i}] Question ${i}.`,
                      expect: { must: [`ok-${s}-${i}`] },
                    }));
                const links: Record<string, unknown>[] = [];
                blocks.forEach((_, i) => {
                  const section = i === failAt ? planted : pick(rng, rest.length > 0 ? rest : [decoy]);
                  links.push({
                    block: `b${i}`,
                    to: { kind: 'prompt_section', prompt: promptId, section },
                    status: 'declared',
                  });
                });
                if (localizeCase.id === 'refuted-decoy' && failAt >= 0)
                  links.push({
                    block: `b${failAt}`,
                    to: { kind: 'prompt_section', prompt: promptId, section: decoy },
                    status: 'refuted',
                  });
                if (localizeCase.id === 'inherited-decoy' && failAt >= 0)
                  links.push({
                    block: `b${n - 1}`,
                    to: { kind: 'prompt_section', prompt: promptId, section: decoy },
                    status: 'declared',
                  });
                raws.push(
                  plantedRecipe
                    ? {
                        ...plantedRecipe.raw,
                        id: `spec-${token(seed, `${id}#${s}`)}`,
                        metadata: { links },
                        blocks,
                      }
                    : {
                        id: `spec-${token(seed, `${id}#${s}`)}`,
                        channel: 'chat',
                        metadata: { links },
                        blocks,
                      },
                );
                // The planted block fails; in the inherited case every block after it fails too, as a chain would.
                fates.push(
                  blocks.map(
                    (_, i) =>
                      i === failAt || (localizeCase.id === 'inherited-decoy' && failAt >= 0 && i > failAt),
                  ),
                );
              }
              const storePath = join(dir, 'store.db');
              const openStore = need<
                (path: string) => Record<string, (...args: unknown[]) => Promise<unknown>>
              >(product.store, 'store', 'openStore');
              const store = openStore(storePath);
              try {
                const validateSpec = need<
                  (raw: unknown, path: string) => { spec: { id: string }; hash: string }
                >(product.core, 'core', 'validateSpec');
                const pins = [];
                for (const raw of raws) {
                  load(product, raw);
                  const loaded = validateSpec(raw, 'blocks-localize');
                  await (store.putSpec as (spec: unknown) => Promise<void>)(loaded);
                  pins.push({ id: loaded.spec.id, hash: loaded.hash });
                  writeFileSync(join(dir, `${raw.id}.yaml`), stringify(raw));
                }
                await (store.putCampaign as (campaign: unknown) => Promise<void>)({
                  campaignId: 'c-localize',
                  specs: pins,
                  targets: [{ adapter: kind === 'code' ? 'process' : 'function' }],
                  modes: ['F'],
                  repeats: { T: 0, F: 1, P: 0 },
                  budgetUsd: 1,
                  judge: { mode: 'system1', judges: [] },
                  createdAt: '2026-10-16T00:00:00.000Z',
                });
                for (const [s, raw] of raws.entries()) {
                  const plantedRecipe = recipes[s];
                  if (plantedRecipe) {
                    await run(
                      product,
                      raw,
                      plantedAgent(product, 'code', plantedRecipe.actions, { scratch }).adapter,
                      { store, campaignId: 'c-localize' },
                    );
                    continue;
                  }
                  const failing = fates[s] as boolean[];
                  const behave = (turn: { user: string }) => {
                    const i = Number(/:(\d+)\] Question/.exec(turn.user)?.[1] ?? 0);
                    return observed(failing[i] ? 'Sorry.' : `Answer ok-${s}-${i}.`);
                  };
                  await run(product, raw, scriptedAdapter(product, behave), {
                    store,
                    campaignId: 'c-localize',
                  });
                }
              } finally {
                await (store.close as () => Promise<void>)();
              }
              const result = await product.cli(
                [
                  'radius',
                  'localize',
                  ...raws.map((raw) => join(dir, `${raw.id}.yaml`)),
                  '--store',
                  storePath,
                  '--campaign',
                  'c-localize',
                  '--sections',
                  init.path,
                  '--json',
                ],
                dir,
              );
              if (localizeCase.id === 'nothing-failed')
                return result.code === 1
                  ? PASS
                  : fail(`localize exited ${result.code} with nothing failed, expected 1`);
              if (result.code !== 0)
                return fail(
                  `localize exited ${result.code}: ${(result.out + result.err).trim().slice(0, 240)}`,
                );
              let ranked: Ranked[] = [];
              try {
                const json = JSON.parse(result.out) as {
                  localization?: { sections?: Ranked[] };
                  sections?: Ranked[];
                };
                ranked = json.localization?.sections ?? json.sections ?? [];
              } catch {
                return fail(`localize --json printed no JSON: ${result.out.slice(0, 160)}`);
              }
              const top = ranked[0];
              const decoyRank = ranked.find((each) => each.section === decoy);
              return expectAll([
                [
                  top?.section === planted && top.best === 1 && top.worst === 1,
                  `the first section is ${top?.section} (rank ${top?.best} to ${top?.worst}), expected ${planted} alone`,
                ],
                [
                  decoyRank === undefined || decoyRank.score < (top?.score ?? 0),
                  `the decoy ${decoy} scores ${decoyRank?.score}, as high as the planted section`,
                ],
              ]);
            },
          });
        }
      }
    }
  return items;
}

/** Level 8 of the blocks bank. */
export function linkItems(): BankItem[] {
  return [...hashItems(), ...sectionItems(), ...scaleItems(), ...localizeItems()];
}

/** The CPU time of a call, user plus system, in milliseconds: the best of `tries` runs. */
export async function cpuBest<T>(tries: number, call: () => Promise<T>): Promise<{ ms: number; result: T }> {
  let best = Number.POSITIVE_INFINITY;
  let result: T | undefined;
  for (let i = 0; i < tries; i += 1) {
    const start = process.cpuUsage();
    result = await call();
    const used = process.cpuUsage(start);
    best = Math.min(best, (used.user + used.system) / 1000);
  }
  return { ms: best, result: result as T };
}

/** CPU budgets of the section commands on a prompt of k sections, in milliseconds, best of 3. */
export const SECTION_CPU_MS = { init: 1500, check: 1500, reanchor: 3000 } as const;

/** Real size: section commands on prompts of 50 to 200 sections (about 100,000 characters) within a CPU budget. */
function scaleItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const k of [50, 100, 200]) {
    for (const command of ['init', 'check', 'reanchor'] as const) {
      const id = `links/scale/${command}/${k}`;
      items.push({
        id,
        family: 'links-sections',
        tier: (k === 200 ? 4 : 3) as Tier,
        level: 6,
        component: command === 'reanchor' ? SECTIONS : SECTIONS_CLI,
        title: `radius sections ${command} on a prompt of ${k} sections (${k === 200 ? 'about 100,000 characters' : `about ${k * 500} characters`}, rules in tables and lists) succeeds within ${SECTION_CPU_MS[command]} ms of CPU, best of 3`,
        cause: `radius sections ${command} stays linear in the prompt size: ${SECTION_CPU_MS[command]} ms of CPU at 200 sections.`,
        check: async ({ seed, scratch, product }) => {
          const rng = rngFor(seed, id);
          const dir = join(scratch, `scale-${token(seed, id)}`);
          mkdirSync(dir, { recursive: true });
          const p = prompt(rng, k);
          const init = await initRegistry(product, dir, p, `larkspur-${k}`);
          if (init.code !== 0) return fail(`init should exit 0 on ${k} sections; got ${init.code}`);
          if (init.registry.sections.length < k)
            return fail(
              `the registry should hold the ${k} sections; it holds ${init.registry.sections.length}`,
            );
          const next = join(dir, 'next.md');
          writeFileSync(next, p.text);
          const args =
            command === 'init'
              ? [
                  'radius',
                  'sections',
                  'init',
                  init.promptPath,
                  '--id',
                  `larkspur-${k}`,
                  '--prompt-version',
                  'v1',
                  '--out',
                  join(dir, 'again.yaml'),
                ]
              : command === 'check'
                ? ['radius', 'sections', 'check', init.path, '--prompt', init.promptPath]
                : [
                    'radius',
                    'sections',
                    'reanchor',
                    init.path,
                    '--prompt',
                    init.promptPath,
                    next,
                    '--to-version',
                    'v2',
                    '--out',
                    join(dir, 'v2.yaml'),
                  ];
          const { ms, result } = await cpuBest(3, () => product.cli(args, dir));
          return expectAll([
            [
              result.code === 0,
              `${command} should exit 0 on an unchanged ${k}-section prompt; got ${result.code}: ${(result.out + result.err).trim().slice(0, 160)}`,
            ],
            [
              ms <= SECTION_CPU_MS[command],
              `${command} on ${k} sections should take at most ${SECTION_CPU_MS[command]} ms of CPU; it took ${ms.toFixed(0)} ms (best of 3)`,
            ],
          ]);
        },
      });
    }
  }
  return items;
}
