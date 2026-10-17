import {
  between,
  list,
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
import { token } from '../kinds';
import { type BlocksProduct, need } from '../product';
import { type BankItem, expectAll, fail, type ItemResult, PASS, type Tier } from '../types';

/**
 * Cross-capability combinations (family F7 of the v3 partition): each item holds two documented behaviours at
 * once, so a product that builds each capability alone and never their meeting point fails it.
 *
 * Personas x parents: a simulated user playing a persona drives a spec with parent links.
 * - docs/simulated-user.md (main): "A simulated user plays a person with a persona and a goal, block by block";
 *   "It reveals a fact ... only once the agent has asked for it ... a fact reaches the model only after an agent
 *   reply matches one of the fact's ask patterns ... and an answer that holds such a fact fails the run."
 * - docs/concepts/given-when-then.md, "Parent blocks" (feat/block-parents): "Once a spec declares a parent
 *   link, its blocks form a forest in every mode: each root starts at the spec defaults, and a child inherits
 *   only its ancestors"; "World and variables are copied, so siblings cannot change each other's start."
 * Together: the user a block's turn is written by sees the conversation of that block's own branch (its
 * ancestors' turns and the agent's replies to them), a fact the agent asked for in another branch is not yet
 * asked in this one, and giving it there fails the run.
 *
 * Two branches each ask for one fact (an email, a phone number), so whichever the runner plays first, the other
 * comes after an ask it must not see: the items hold whatever order the runner picks.
 *
 * Heads (keep rule 6, one head per pair, merging the two owning heads when they differ):
 * - personas x parents: train/sol-f7-personas-parents, feat/block-parents (PR 562) merged with main (main owns
 *   the simulated user); the merge is clean. CI run 39001372611 at ab4cb3912: all 27 items fail on seeds 1 to 3
 *   and hidden, each for its own cause.
 * - parents x objects, parents x values: dropped; feat/block-parents and feat/block-b4-report conflict in
 *   packages/core/src/runner/run.ts, so no merged head can be measured without editing the product.
 * - parents x radius in T: dropped; all 18 candidates pass on PR 562 (forest roots, mode T block subsets).
 * - objects x blame: no item; on B4 merged with F3 every probed composition (spec and block overrides, stamp
 *   layers, cache replay, OBJECT_* refusals) behaves as documented.
 * - values x radius: no item; no document joins the two.
 *
 * The persona's model is a fixture port: it records what it is shown and answers with the block's marker,
 * which it reads from the hint the driver gives it. Every id, marker and spec id is a token; which block asks
 * for which fact, and what each block should see, stays in the item.
 */

const RUNNER = 'packages/core/src/runner/run.ts';
const SIMULATED = 'packages/users/src/simulated.ts';

/** The indices above `at`, oldest first. */
function lineage(parents: readonly number[], at: number): number[] {
  const out: number[] = [];
  for (let p = parents[at] ?? -1; p >= 0; p = parents[p] ?? -1) out.unshift(p);
  return out;
}

type Order = 'in-order' | 'interleaved' | 'reversed' | 'shuffled';

type Shape = {
  id: string;
  tier: number;
  /** The forest by parent index, and the two blocks of separate branches whose replies ask: email, phone. */
  draw(rng: Rng): { parents: number[]; askers: [number, number] };
  orders: readonly Order[];
};

const SHAPES: Shape[] = [
  {
    // Tree A (0, 1) whose root asks for the email; tree B (2, 3) whose root asks for the phone.
    id: 'two-roots',
    tier: 2,
    draw: () => ({ parents: [-1, 0, -1, 2], askers: [0, 2] }),
    orders: ['in-order', 'interleaved', 'reversed'],
  },
  {
    // One root and three children; two children ask, each with a child of its own.
    id: 'star',
    tier: 3,
    draw: () => ({ parents: [-1, 0, 0, 0, 1, 2], askers: [1, 2] }),
    orders: ['in-order', 'shuffled'],
  },
  {
    // A chain 0, 1, 2 and a branch 3, 4 off the root; the middle block and the branch ask.
    id: 'chain-and-branch',
    tier: 3,
    draw: () => ({ parents: [-1, 0, 1, 0, 3], askers: [1, 3] }),
    orders: ['in-order', 'reversed'],
  },
  {
    id: 'random-forest',
    tier: 4,
    draw: (rng) => {
      // A random tree, then a second root with a child: a block of the tree that has a child asks, the second root asks.
      const n = between(rng, 4, 6);
      const parents = Array.from({ length: n }, (_, i) => (i === 0 ? -1 : between(rng, 0, i - 1)));
      const withChild = parents.flatMap((_, i) => (parents.includes(i) ? [i] : []));
      parents.push(-1, n);
      return { parents, askers: [pick(rng, withChild), n] };
    },
    orders: ['in-order', 'shuffled'],
  },
];

type View = 'conversation' | 'facts' | 'leak';

const BRANCH_HISTORY =
  "In a parent-linked spec a user driver reads the history of the block's own ancestors only, so a fact the agent asked for in another branch is not given.";

const VIEWS: { id: View; tier: number; cause: string; component: string }[] = [
  {
    id: 'conversation',
    tier: 1,
    cause:
      "The simulated user shows its model the conversation of the block's own ancestors in a parent-linked spec: their turns and the agent's replies, nothing of another branch.",
    component: SIMULATED,
  },
  { id: 'facts', tier: 1, cause: BRANCH_HISTORY, component: RUNNER },
  { id: 'leak', tier: 2, cause: BRANCH_HISTORY, component: RUNNER },
];

const FACTS = ['email', 'phone'] as const;

type Scenario = {
  parents: number[];
  askers: [number, number];
  ids: string[];
  markers: string[];
  raw: RawSpec;
  replies: string[];
  values: Record<(typeof FACTS)[number], string>;
};

function scenario(seed: number, tag: string, shape: Shape, order: Order): Scenario {
  const rng = rngFor(seed, tag);
  const { parents, askers } = shape.draw(rng);
  const keys = [...parents.keys()];
  const written =
    order === 'in-order'
      ? keys
      : order === 'reversed'
        ? [...keys].reverse()
        : order === 'interleaved'
          ? [0, 2, 1, 3]
          : shuffled(rng, keys);
  const ids = keys.map((i) => token(seed, `${tag}#id#${i}`));
  const markers = keys.map((i) => token(seed, `${tag}#marker#${i}`, 8));
  const codes = keys.map(
    (i) => `${token(seed, `${tag}#code#${i}`, 4).toUpperCase()}-${between(rng, 10, 99)}`,
  );
  const [first = 'ilse', last = 'varga'] = pick(rng, SHOP.customers).toLowerCase().split(' ');
  const values = { email: `${first}.${last}@example.com`, phone: `+1 202 555 0${between(rng, 100, 199)}` };
  // Only the askers' replies match an ask pattern; every other reply says nothing of either fact.
  const replies = keys.map((i) =>
    i === askers[0]
      ? `Larkspur Cycles, hold ${codes[i]}. What is your email address?`
      : i === askers[1]
        ? `Larkspur Cycles, hold ${codes[i]}. What is your phone number?`
        : `Larkspur Cycles, hold ${codes[i]}. Which bike would you like?`,
  );
  const raw: RawSpec = {
    id: `spec-${token(seed, `${tag}#spec`)}`,
    channel: 'chat',
    blocks: written.map((i) => ({
      id: ids[i],
      ...((parents[i] ?? -1) >= 0 ? { parent: ids[parents[i] as number] } : {}),
      user: `${markers[i]} I would like the ${pick(rng, SHOP.bikes)} for day ${between(rng, 1, 28)}.`,
      expect: { must: [codes[i] as string] },
    })),
  };
  return { parents, askers, ids, markers, raw, replies, values };
}

type Request = { user: string; system: string };

/** The marker the driver's hint names: the block whose turn the user writes now. */
function hintOf(user: string): string | undefined {
  const line = user.split('\n').find((each) => each.includes('in your own words:'));
  return line?.split('in your own words:')[1]?.trim().split(/\s+/)[0];
}

const ANSWER = 'Yes please, that one.';

/**
 * The persona's fixture port: records every request, answers with the marker of the block it is asked for,
 * and at block `leak.at` gives the fact `leak.value`.
 */
function personaPort(markers: readonly string[], leak?: { at: number; value: string }) {
  const requests: Request[] = [];
  return {
    requests,
    port: {
      family: 'fixture',
      model: 'fixture-persona',
      complete: async (request: Request) => {
        // The documented call passes system, user and maxTokens: anything else is refused, without echoing it.
        if (Object.keys(request).some((key) => !['system', 'user', 'maxTokens'].includes(key)))
          throw new Error('the persona fixture was called with an argument the port contract does not have');
        requests.push({ user: request.user, system: request.system });
        const at = markers.indexOf(hintOf(request.user) ?? '');
        if (at < 0) throw new Error('the persona fixture was asked for no block of the spec');
        return `${markers[at]} ${ANSWER}${at === leak?.at ? ` You can reach me at ${leak.value}.` : ''}`;
      },
    },
  };
}

async function play(product: BlocksProduct, s: Scenario, leak?: { at: number; value: string }) {
  const createSimulatedUser = need<(options: Record<string, unknown>) => unknown>(
    product.users,
    'users',
    'createSimulatedUser',
  );
  const { requests, port } = personaPort(s.markers, leak);
  const driver = createSimulatedUser({
    persona: 'A calm customer of Larkspur Cycles who writes short messages.',
    goal: 'Rent a bike for one day.',
    facts: { ...s.values },
    revealWhenAsked: { email: ['e-?mail'], phone: ['phone'] },
    stopToken: '###FINISHED###',
    port,
    agentFamily: 'none',
    judgeFamilies: [],
  });
  const adapter = scriptedAdapter(product, (turn) => {
    const at = s.markers.findIndex((marker) => turn.user.includes(marker));
    if (at < 0) throw new Error('the scripted agent has no reply for this turn');
    return observed(s.replies[at] as string);
  });
  const record = await run(product, s.raw, adapter, { driver });
  return { record, requests };
}

/** What the driver showed its model when it wrote the block of `marker`: the conversation and the facts. */
function shown(requests: readonly Request[], marker: string) {
  const request = requests.find((each) => hintOf(each.user) === marker);
  if (!request) return undefined;
  const lines = (text: string | undefined) =>
    (text ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
  const conversation = lines(
    (request.user.split('The conversation so far:')[1] ?? '').split('Facts you may give now')[0],
  );
  const facts = lines(
    (request.user.split('because the assistant asked for them:')[1] ?? '').split('\n\n')[0],
  );
  return { conversation, facts };
}

function judgeViews(view: View, s: Scenario, played: Awaited<ReturnType<typeof play>>): ItemResult {
  const { record, requests } = played;
  if (record.status !== 'completed')
    return fail(
      `the run should complete: no fact is given early; it ${record.status}: ${String(record.error ?? '').slice(0, 160)}`,
    );
  for (const [i, marker] of s.markers.entries()) {
    const seen = shown(requests, marker);
    if (!seen) return fail(`${s.ids[i]} should be written by the simulated user; it never was`);
    const above = lineage(s.parents, i);
    const names = (blocks: readonly number[]) => list(blocks.map((a) => s.ids[a])) || 'none';
    if (view === 'conversation') {
      const want =
        above.length === 0
          ? ['(nothing yet: you write first)']
          : above.flatMap((a) => [`Customer: ${s.markers[a]} ${ANSWER}`, `Assistant: ${s.replies[a]}`]);
      if (seen.conversation.join('\n') !== want.join('\n'))
        return fail(
          `the user writing ${s.ids[i]} should be shown ${above.length === 0 ? 'no earlier turn: the block is a root, which starts at the spec defaults' : `the turns of its ancestors ${names(above)} only`}; it was shown ${seen.conversation.length} lines: ${list(
            seen.conversation.map((line) => line.slice(0, 48)),
            4,
          )}`,
        );
      continue;
    }
    for (const [f, fact] of FACTS.entries()) {
      const asker = s.askers[f] as number;
      const asked = above.includes(asker);
      const offered = seen.facts.some((line) => line.includes(s.values[fact]));
      if (offered !== asked)
        return fail(
          asked
            ? `the user writing ${s.ids[i]} should be offered the ${fact}: its ancestor ${s.ids[asker]} asked for it; it was not`
            : `the user writing ${s.ids[i]} should not be offered the ${fact}: only ${s.ids[asker]}, outside its branch (ancestors ${names(above)}), asked for it; it was offered`,
        );
    }
  }
  return PASS;
}

async function judgeLeak(product: BlocksProduct, seed: number, id: string, s: Scenario): Promise<ItemResult> {
  // The fact whose ask the runner plays first; a block outside its branch that runs after that ask gives it.
  const order = (await play(product, s)).record.blocks.map((block) => s.ids.indexOf(block.blockId ?? ''));
  const f = order.indexOf(s.askers[0]) <= order.indexOf(s.askers[1]) ? 0 : 1;
  const fact = FACTS[f] as (typeof FACTS)[number];
  const asker = s.askers[f] as number;
  const blocks = [...s.parents.keys()];
  const related = (i: number) =>
    i === asker || lineage(s.parents, i).includes(asker) || lineage(s.parents, asker).includes(i);
  const later = blocks.filter((i) => !related(i) && order.indexOf(i) > order.indexOf(asker));
  const under = blocks.filter((i) => lineage(s.parents, i).includes(asker));
  if (later.length === 0 || under.length === 0)
    return fail(
      `the run should play a block outside ${s.ids[asker]}'s branch after it, and the forest should hold a block under it; got ${later.length} and ${under.length}`,
    );
  const rng = rngFor(seed, `${id}#leak`);
  const at = pick(rng, later);
  const twin = pick(rng, under);
  const leaked = await play(product, s, { at, value: s.values[fact] });
  const allowed = await play(product, s, { at: twin, value: s.values[fact] });
  return expectAll([
    [
      leaked.record.status === 'failed' && /before the agent asked/.test(String(leaked.record.error ?? '')),
      `the run should fail when the user gives the ${fact} at ${s.ids[at]}: no reply of its branch (ancestors ${list(lineage(s.parents, at).map((a) => s.ids[a])) || 'none'}) asked for it, only ${s.ids[asker]} in another branch; the run ${leaked.record.status}${leaked.record.error ? `: ${String(leaked.record.error).slice(0, 120)}` : ''}`,
    ],
    [
      allowed.record.status === 'completed',
      `the run should complete when the user gives the ${fact} at ${s.ids[twin]}, under ${s.ids[asker]} that asked for it; it ${allowed.record.status}: ${String(allowed.record.error ?? '').slice(0, 120)}`,
    ],
  ]);
}

function personaParentItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const shape of SHAPES) {
    for (const order of shape.orders) {
      for (const view of VIEWS) {
        const id = `cross/personas-parents/${shape.id}/${order}/${view.id}`;
        const forest = `a ${shape.id.replace(/-/g, ' ')} forest written ${order}`;
        items.push({
          id,
          family: 'cross-personas-parents',
          tier: Math.min(5, shape.tier + view.tier + (order === 'in-order' ? 0 : 1) - 1) as Tier,
          level: 2,
          component: view.component,
          title:
            view.id === 'conversation'
              ? `a simulated user driving ${forest} writes each block from that block's own branch: a root from no earlier turn, a child from its ancestors' turns and replies only`
              : view.id === 'facts'
                ? `a simulated user driving ${forest}, where two branches each ask for a fact, is offered a fact for a block only when an ancestor's reply asked for it, never because another branch did`
                : `a simulated user driving ${forest} that gives a fact in a branch where the agent never asked for it fails the run; giving it under the branch that asked does not`,
          cause: view.cause,
          check: async ({ seed, product }) => {
            const s = scenario(seed, id, shape, order);
            return view.id === 'leak'
              ? judgeLeak(product, seed, id, s)
              : judgeViews(view.id, s, await play(product, s));
          },
        });
      }
    }
  }
  return items;
}

/** Family F7 of the blocks bank: cross-capability combinations. */
export function crossItems(): BankItem[] {
  return personaParentItems();
}
