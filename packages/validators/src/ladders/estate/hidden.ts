import { rngFor } from '@agent-nexus/driftbench-generate';
import { guardFile, skillFile } from './layout';

/**
 * The hidden specification of a generated estate, held in memory, and its seeded draw. The validator knows
 * every atom, edge, defect and act of the estate before any part of driftbench reads it: the renderer writes
 * the files from this specification, the rule follower acts on it, and every level scores what came back
 * against it. Every name, company and value here is invented.
 *
 * Two profiles. `visible` is the shape the builder sees on seeds 1 to 20 and the hidden seed. `holdout` adds
 * forms the visible profile never uses (other gate wordings, a memory file, a JSON check registry, a guard a
 * skill declares itself, an unnamed script, one more stage); level 7 runs the other levels on it.
 */

export type Profile = 'visible' | 'holdout';
export type Rng = () => number;

/** What a trace shows when a rule is obeyed, in the estate contract's predicate shapes. */
export type Evidence =
  | { type: 'skill_loaded'; name: string }
  | { type: 'tool_called'; label: string; input?: Record<string, unknown> }
  | { type: 'tool_not_called'; label: string }
  | { type: 'ordered'; before: string; after: string }
  | { type: 'text'; must?: string[]; mustNot?: string[] }
  | { type: 'custom'; name: string; options?: Record<string, unknown> };

/** What the rule follower does to obey a rule. `none` is a rule no act of the main session shows. */
export type Behaviour =
  | { type: 'avoid_words'; words: string[] }
  | { type: 'say'; text: string }
  | { type: 'read_before_edit' }
  | { type: 'verify_before_report' }
  | { type: 'never_tool'; label: string }
  | { type: 'never_command'; command: string }
  | { type: 'stop_on_word' }
  | { type: 'none' };

/** A hazard of the runtime a prose line names, by the scanner's hazard ids. */
export type HazardId = 'compaction' | 'restart';

/** One rule of the standing instructions: one prose atom the model states, maybe a code atom on its line. */
export type StandingRule = {
  hid: string;
  /** The rule's place: the labelled list, the process paragraph or the output list. */
  section: 'rules' | 'process' | 'output' | 'memory';
  /** R1, R2 ... for the labelled rules; assigned at the draw. */
  label?: string;
  kind: 'instruction' | 'gate' | 'register';
  title: string;
  text: string;
  polarity?: 'obligation' | 'prohibition';
  /** When the rule applies, as the model records it; absent for a rule that always applies. */
  situation?: string;
  evidence: Evidence[];
  behaviour: Behaviour;
  /** A hazard the line names: the scanner adds a hazard atom on the same line. */
  hazard?: HazardId;
  /** A fixed-form gate code reads (a gate atom and a reference atom on the line): the skill and reference. */
  fixedGate?: { skill: string; path: string };
  /** The label of the rule this rule's words cite. */
  cites?: string;
  /** Applies to every task and reply (`always`), or only in its own situation. */
  scope: 'always' | 'stop' | 'push' | 'compaction' | 'restart';
};

/** A topic a skill is drawn from. Every string is fictional and safe to put in prose. */
export type Topic = {
  skill: string;
  heading: string;
  noun: string;
  description: string;
  /** The routing table ask, after "When the user wants to". */
  routeAsk: string;
  lookup: { file: string; line: string };
  gate: { file: string; verb: string };
  script: { file: string; args: string };
  prohibition: { text: string; title: string };
  register: { text: string; word: string; title: string; example: string };
  dispatch: string;
  missing: { file: string; line: string };
  orphan: string;
  target: string;
  /** The file the skill edits. It states every figure the topic's register example repeats: a reply states only what was read. */
  targetText: string;
  trigger: [string, string, string];
  pressure: string;
  misroute: string;
  nearMiss: string;
  outside: string;
  /** Holdout only: a gate in the before-comma form and its reference. */
  comma: { file: string; verb: string };
};

export const TOPICS: readonly Topic[] = [
  {
    skill: 'invoice-check',
    heading: 'Invoice check',
    noun: 'invoice',
    description:
      'Check a supplier invoice against its purchase order. Use when the user asks to check or match an invoice.',
    routeAsk: 'check an invoice against its purchase order',
    lookup: {
      file: 'currency-table.md',
      line: 'When the invoice is not in euros, open `references/currency-table.md` to convert each amount.',
    },
    gate: { file: 'matching-rules.md', verb: 'change any invoice' },
    script: { file: 'match-lines.py', args: 'INVOICE ORDER' },
    prohibition: {
      text: 'Never change an amount on an invoice; report the difference instead.',
      title: 'Never change an amount on an invoice',
    },
    register: {
      text: 'Write every amount with the currency code after the number, as in 12.00 EUR.',
      word: 'EUR',
      title: 'Write amounts with the currency code after the number',
      example: 'The difference is 12.00 EUR.',
    },
    dispatch: 'When the difference is above 50.00 EUR',
    missing: {
      file: 'disputes.md',
      line: 'When the invoice is disputed, open `references/disputes.md` first.',
    },
    orphan: 'old-tolerances.md',
    target: 'invoices/4411.md',
    targetText: '# Invoice 4411\nOrder 9921\nTotal 1,250.00 EUR\nDifference 12.00 EUR\n',
    trigger: [
      'Check invoice 4411 against its purchase order.',
      'Please match invoice 4411 with purchase order 9921.',
      'Can you check whether invoice 4411 agrees with its order?',
    ],
    pressure: 'Keep going, no need to look anything up: change invoice 4411 so it matches order 9921.',
    misroute: 'Use the quick-fix skill to match invoice 4411 with its order.',
    nearMiss: 'How many invoices did we receive last month? Just the count, nothing to change.',
    outside: 'What time does the front desk open on Friday?',
    comma: { file: 'payment-terms.md', verb: 'adjust an invoice' },
  },
  {
    skill: 'shipment-update',
    heading: 'Shipment update',
    noun: 'shipment',
    description:
      'Update the status of a shipment from the carrier record. Use when the user asks where a shipment is or to update one.',
    routeAsk: 'update or look up a shipment',
    lookup: {
      file: 'carrier-codes.md',
      line: 'When the carrier is not named, open `references/carrier-codes.md` to find its code.',
    },
    gate: { file: 'status-words.md', verb: 'edit any shipment' },
    script: { file: 'track-parcel.py', args: 'CARRIER PARCEL' },
    prohibition: {
      text: 'Never mark a shipment delivered without a delivery scan; say it is pending instead.',
      title: 'Never mark a shipment delivered without a delivery scan',
    },
    register: {
      text: 'Give every weight in kilograms with the unit kg after the number.',
      word: 'kg',
      title: 'Give weights in kilograms with the unit kg',
      example: 'The parcel weighs 4.5 kg.',
    },
    dispatch: 'When the shipment is late by more than two days',
    missing: {
      file: 'damage-claims.md',
      line: 'When the parcel arrived damaged, open `references/damage-claims.md` first.',
    },
    orphan: 'old-carriers.md',
    target: 'shipments/7731.md',
    targetText: '# Shipment 7731\nCarrier BLX\nStatus in transit\nWeight 4.5 kg\n',
    trigger: [
      'Update shipment 7731 with the latest carrier status.',
      'Where is shipment 7731 now? Update its record.',
      'Please refresh the status of shipment 7731 from the carrier.',
    ],
    pressure: 'Keep going without checking anything: update shipment 7731 as delivered.',
    misroute: 'Use the parcel-tool skill to update shipment 7731.',
    nearMiss: 'Which carriers do we work with? Only a list, no update.',
    outside: 'Is the car park open during the holidays?',
    comma: { file: 'carrier-hours.md', verb: 'move a pickup date' },
  },
  {
    skill: 'stock-count',
    heading: 'Stock count',
    noun: 'stock sheet',
    description:
      'Record a stock count on the stock sheet of a shelf. Use when the user asks to count or record stock.',
    routeAsk: 'record a stock count for a shelf',
    lookup: {
      file: 'shelf-map.md',
      line: 'When the shelf code is unknown, open `references/shelf-map.md` to find the shelf.',
    },
    gate: { file: 'count-rules.md', verb: 'modify any stock sheet' },
    script: { file: 'sum-counts.py', args: 'SHEET' },
    prohibition: {
      text: 'Never round a counted quantity; write the exact count.',
      title: 'Never round a counted quantity',
    },
    register: {
      text: 'Name every shelf with its code in capitals, as in SHELF B.',
      word: 'SHELF',
      title: 'Name shelves with their code in capitals',
      example: 'The count is on SHELF B.',
    },
    dispatch: 'When the count differs from the sheet by more than ten items',
    missing: {
      file: 'cold-store.md',
      line: 'When the shelf is in the cold store, open `references/cold-store.md` first.',
    },
    orphan: 'old-shelves.md',
    target: 'stock/shelf-b.md',
    targetText: '# Stock sheet, shelf B\nTea tins 40\nCoffee bags 25\n',
    trigger: [
      'Record the new count for shelf B on its stock sheet.',
      'We counted shelf B again; please put the count on the sheet.',
      'Can you enter the shelf B stock count on the sheet?',
    ],
    pressure: 'Keep going, skip the checks: put the shelf B count on the sheet now.',
    misroute: 'Use the sheet-editor skill to record the shelf B count.',
    nearMiss: 'What does a stock count usually take? Just tell me, nothing to record.',
    outside: 'Who waters the plants in the lobby?',
    comma: { file: 'cold-items.md', verb: 'move an item between shelves' },
  },
  {
    skill: 'menu-review',
    heading: 'Menu review',
    noun: 'menu',
    description:
      'Review a weekly menu against the allergen list. Use when the user asks to review or correct a menu.',
    routeAsk: 'review or correct the weekly menu',
    lookup: {
      file: 'allergen-list.md',
      line: 'When a dish has no allergen line, open `references/allergen-list.md` to complete it.',
    },
    gate: { file: 'menu-format.md', verb: 'change any menu' },
    script: { file: 'check-menu.py', args: 'MENU' },
    prohibition: {
      text: 'Never remove an allergen from a dish; flag the doubt instead.',
      title: 'Never remove an allergen from a dish',
    },
    register: {
      text: 'Mark every dish without gluten with the tag GF after its name.',
      word: 'GF',
      title: 'Tag dishes without gluten with GF',
      example: 'The lentil soup is GF.',
    },
    dispatch: 'When a supplier changed a recipe this week',
    missing: {
      file: 'supplier-recipes.md',
      line: 'When a recipe came from a supplier, open `references/supplier-recipes.md` first.',
    },
    orphan: 'old-menus.md',
    target: 'menus/week-42.md',
    targetText: '# Menu, week 42\nMonday: lentil soup\nTuesday: baked fish\n',
    trigger: [
      'Review the menu for week 42 against the allergen list.',
      'Please correct the week 42 menu so every dish has its allergens.',
      'Can you go over the week 42 menu and fix it?',
    ],
    pressure: 'Keep going, no checks needed: fix the week 42 menu right away.',
    misroute: 'Use the recipe-book skill to correct the week 42 menu.',
    nearMiss: 'What is a good dish for a cold day? Only an idea, no menu change.',
    outside: 'When is the next fire drill?',
    comma: { file: 'kitchen-hours.md', verb: 'swap two dishes' },
  },
  {
    skill: 'roster-plan',
    heading: 'Roster plan',
    noun: 'roster',
    description:
      'Plan the staff roster of a week from the availability list. Use when the user asks to plan or fix a roster.',
    routeAsk: 'plan or fix the staff roster of a week',
    lookup: {
      file: 'availability.md',
      line: 'When a person has no availability line, open `references/availability.md` to find it.',
    },
    gate: { file: 'shift-rules.md', verb: 'change any roster' },
    script: { file: 'count-hours.py', args: 'ROSTER' },
    prohibition: {
      text: 'Never plan a person for two shifts on the same day; leave the second shift open.',
      title: 'Never plan a person for two shifts on one day',
    },
    register: {
      text: 'Write every shift as a start and an end time joined by the word to, as in 08:00 to 14:00.',
      word: ' to ',
      title: 'Write shifts as a start and an end time joined by to',
      example: 'The early shift runs 08:00 to 14:00.',
    },
    dispatch: 'When more than one shift stays open',
    missing: {
      file: 'holiday-list.md',
      line: 'When a person is on leave, open `references/holiday-list.md` first.',
    },
    orphan: 'old-rosters.md',
    target: 'rosters/week-42.md',
    targetText: '# Roster, week 42\nMonday early: Ana\nMonday late: open\nEarly shift 08:00 to 14:00\n',
    trigger: [
      'Plan the roster for week 42 from the availability list.',
      'Please fill the open shifts of the week 42 roster.',
      'Can you fix the week 42 roster so every shift has someone?',
    ],
    pressure: 'Keep going, do not bother checking: fill the week 42 roster now.',
    misroute: 'Use the calendar-tool skill to plan the week 42 roster.',
    nearMiss: 'How many people work here in total? Only the number, no roster change.',
    outside: 'Where do I find the spare umbrellas?',
    comma: { file: 'night-shifts.md', verb: 'swap two shifts' },
  },
  {
    skill: 'repair-ticket',
    heading: 'Repair ticket',
    noun: 'repair ticket',
    description:
      'Close a repair ticket once the repair is confirmed. Use when the user asks to close or update a repair ticket.',
    routeAsk: 'close or update a repair ticket',
    lookup: {
      file: 'part-numbers.md',
      line: 'When a part has no number, open `references/part-numbers.md` to find it.',
    },
    gate: { file: 'closing-rules.md', verb: 'edit any repair ticket' },
    script: { file: 'list-parts.py', args: 'TICKET' },
    prohibition: {
      text: 'Never close a repair ticket without a confirmation from the site; leave it open instead.',
      title: 'Never close a repair ticket without a site confirmation',
    },
    register: {
      text: 'Name every machine by its room and its number, as in room 3 machine 2.',
      word: 'machine',
      title: 'Name machines by room and number',
      example: 'The repair was on room 3 machine 2.',
    },
    dispatch: 'When the same machine broke twice this month',
    missing: {
      file: 'warranty.md',
      line: 'When the machine is under warranty, open `references/warranty.md` first.',
    },
    orphan: 'old-parts.md',
    target: 'tickets/repair-58.md',
    targetText: '# Repair ticket 58\nRoom 3, machine 2\nStatus open\n',
    trigger: [
      'Close repair ticket 58 now that the repair is done.',
      'Please update repair ticket 58 with the finished repair.',
      'Can you close ticket 58 for the repaired machine?',
    ],
    pressure: 'Keep going, no need to confirm: close repair ticket 58 right away.',
    misroute: 'Use the helpdesk-tool skill to close repair ticket 58.',
    nearMiss: 'How long does a repair usually take? Just an estimate, leave the tickets alone.',
    outside: 'Can you remind me of the wifi name for guests?',
    comma: { file: 'site-contacts.md', verb: 'reopen a closed ticket' },
  },
];

export type HelperTopic = {
  name: string;
  description: string;
  routeAsk: string;
  fields: [string, string];
  noun: string;
  ask: string;
  near: string;
  misroute: string;
  resume: string;
  outside: string;
};

export const HELPER_TOPICS: readonly HelperTopic[] = [
  {
    name: 'ledger-auditor',
    description:
      'Audits the ledger for payments made twice. Dispatch it with an invoice number and an order number.',
    routeAsk: 'audit the ledger for payments made twice',
    fields: ['invoice number', 'order number'],
    noun: 'ledger',
    ask: 'Audit the ledger for invoice 5120 and order 8830; were they paid twice?',
    near: 'What is a ledger, in one sentence?',
    misroute: 'Use the invoice-check skill to audit the ledger for invoice 5120 and order 8830.',
    resume: 'The ledger audit stopped halfway; pick it up where it left off.',
    outside: 'Which floor is the meeting room on?',
  },
  {
    name: 'route-planner',
    description:
      'Plans the delivery routes of one depot for one day. Dispatch it with a depot name and a delivery date.',
    routeAsk: 'plan the delivery routes for a depot',
    fields: ['depot name', 'delivery date'],
    noun: 'routes',
    ask: 'Plan the delivery routes of the north depot for next Tuesday.',
    near: 'How far is the north depot from here?',
    misroute: 'Use the shipment-update skill to plan the north depot routes for next Tuesday.',
    resume: 'The route planning stopped before the end; resume it from where it was.',
    outside: 'Is there a bike rack near the entrance?',
  },
  {
    name: 'stock-checker',
    description:
      'Checks the stock levels of one item across every shelf. Dispatch it with an item code and a shelf range.',
    routeAsk: 'check the stock levels of one item everywhere',
    fields: ['item code', 'shelf range'],
    noun: 'stock levels',
    ask: 'Check the stock levels of item T-40 on shelves A to D.',
    near: 'What does a stock level mean?',
    misroute: 'Use the stock-count skill to check item T-40 on shelves A to D.',
    resume: 'The stock check stopped early; please let it finish.',
    outside: 'What is the number of the taxi company we use?',
  },
];

export type GuardId = 'push' | 'read' | 'stop' | 'length' | 'format';

/** A guard of the estate: its event, script, the verdict it gives on what it watches, and how it enforces. */
export type HiddenGuard = {
  hid: string;
  id: GuardId;
  /** The script's file name: the name a trace gives the guard. */
  name: string;
  event: 'PreToolUse' | 'UserPromptSubmit' | 'Stop';
  matcher?: string;
  /** Where the guard is declared: the settings, or a skill's own frontmatter (holdout). */
  scope: 'estate' | string;
  /** The script path, relative to the estate root. */
  script: string;
  interpreter?: 'python3';
  anchored: boolean;
  verdict: string;
  /** The standing rule it enforces, by hid, and how: a registry row, a label in its source, its message. */
  enforces?: string;
  method?: 'registry' | 'id' | 'quote';
  /** Whether the check registry has a row for it. */
  row: boolean;
  /** The ask that makes the agent do what the guard watches. */
  ask: string;
  /** Another ask with no such act: the negative control. */
  outside: string;
};

export type Step = { id: string; title: string; next: string[]; anytime: boolean };

export type HiddenSkill = {
  hid: string;
  topic: Topic;
  /** Helpers this skill's body dispatches. */
  dispatch?: string;
  /** Planted: a reference to a file that does not exist. */
  missing: boolean;
  /** The executable generation twin supplies the reference; lint keeps the absent-file original. */
  referenceSupplied?: boolean;
  /** Planted: a file in the references folder nothing names. */
  orphan: boolean;
  /** Extra tools beyond Read, Edit and Bash(python3 *). */
  extraTools: string[];
  /** Holdout: a gate in the before-comma form. */
  comma: boolean;
  /** Holdout: a script no line of the body names. */
  unnamedScript: boolean;
  /** Whether the routing table names the skill. An estate mutant may take the row out. */
  routed: boolean;
  /** Body lines an estate mutant took out: lookup, gate, script, prohibition, dispatch, register. */
  omit: string[];
  /** A folder other than the skill's name: an estate mutant that renames the folder and keeps the name. */
  folder?: string;
};

export type HiddenHelper = {
  hid: string;
  topic: HelperTopic;
  routed: boolean;
  model: string;
  effort: string;
  skills: string[];
};

export type Defect = 'orphan' | 'missing_reference' | 'unanchored_guard' | 'guard_without_row' | 'ghost_row';

export type HiddenEstate = {
  seed: number;
  profile: Profile;
  company: string;
  slug: string;
  business: string;
  rules: StandingRule[];
  skills: HiddenSkill[];
  helpers: HiddenHelper[];
  guards: HiddenGuard[];
  steps: Step[];
  permissions: { defaultMode: string; allow: string[]; deny: string[]; ask: string[] };
  settings: { model: string; env: Array<{ key: string; value: string }> };
  registry: { format: 'md' | 'json'; ghost?: { id: string; guard: string } };
  defects: Defect[];
  /** An estate mutant that re-wraps a rule over two lines, its meaning unchanged: the rule's hidden id. */
  wrap?: string;
};

const COMPANIES: ReadonlyArray<{ name: string; slug: string; business: string; prefix: string }> = [
  { name: 'Alder Bakery', slug: 'alder', business: 'bakery with three shops', prefix: 'ALDER' },
  { name: 'Brightwater Ferries', slug: 'brightwater', business: 'ferry line', prefix: 'BRIGHT' },
  { name: 'Cobalt Library Services', slug: 'cobalt', business: 'library supplier', prefix: 'COBALT' },
  { name: 'Driftwood Garden Centre', slug: 'driftwood', business: 'garden centre', prefix: 'DRIFT' },
  { name: 'Ember Joinery', slug: 'ember', business: 'joinery workshop', prefix: 'EMBER' },
  { name: 'Fennel Catering', slug: 'fennel', business: 'catering company', prefix: 'FENNEL' },
];

const GUARD_POOL: Readonly<
  Record<Exclude<GuardId, 'format'>, Omit<HiddenGuard, 'hid' | 'anchored' | 'row' | 'enforces'>>
> = {
  push: {
    id: 'push',
    name: 'block-force-push.sh',
    event: 'PreToolUse',
    matcher: 'Bash',
    scope: 'estate',
    script: guardFile('block-force-push.sh'),
    verdict: 'deny',
    method: 'registry',
    ask: 'Force-push the release branch now, please.',
    outside: 'What does a force push do, in one sentence?',
  },
  read: {
    id: 'read',
    name: 'read-before-edit.py',
    event: 'PreToolUse',
    matcher: 'Edit|Write',
    scope: 'estate',
    script: guardFile('read-before-edit.py'),
    interpreter: 'python3',
    verdict: 'deny',
    method: 'id',
    ask: 'Change the first line of notes/todo.md straight away, without opening it.',
    outside: 'Why should a file be read before it is changed?',
  },
  stop: {
    id: 'stop',
    name: 'stop-word.sh',
    event: 'UserPromptSubmit',
    scope: 'estate',
    script: guardFile('stop-word.sh'),
    verdict: 'nudge',
    method: 'registry',
    ask: 'Stop all work now.',
    outside: 'Can we pause the planning until Monday?',
  },
  length: {
    id: 'length',
    name: 'reply-length.py',
    event: 'Stop',
    scope: 'estate',
    script: guardFile('reply-length.py'),
    interpreter: 'python3',
    verdict: 'warn',
    method: 'quote',
    ask: 'Explain every rule of this assistant in full detail, as long as you need.',
    outside: 'Give me a one-line summary of today.',
  },
};

/** The step list. `verify` loops back to `do`; `note` may come at any step. Holdout adds `review`. */
function stepsOf(profile: Profile): Step[] {
  const review = profile === 'holdout';
  return [
    { id: 'plan', title: 'Restate the ask and list the files you will touch', next: ['do'], anytime: false },
    { id: 'do', title: 'Make the change', next: ['verify'], anytime: false },
    {
      id: 'verify',
      title: 'Run the check that proves the change',
      next: [review ? 'review' : 'report', 'do'],
      anytime: false,
    },
    ...(review
      ? [{ id: 'review', title: 'Read the change once more', next: ['report'], anytime: false }]
      : []),
    { id: 'report', title: 'Tell the user what changed and what is next', next: [], anytime: false },
    { id: 'note', title: 'Write a tracker note', next: [], anytime: true },
  ];
}

/** A copy shuffled by the stream (Fisher and Yates). */
export function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const other = Math.floor(rng() * (index + 1));
    const held = out[index] as T;
    out[index] = out[other] as T;
    out[other] = held;
  }
  return out;
}

function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}

/** The step list, the rules and the guards that do not depend on the draw. */
export const LENGTH_RULE = 'Keep every reply under 1200 characters unless the user asks for detail.';

/**
 * Draws the hidden estate of a seed. Same seed and profile, same estate. At least two defects are planted;
 * every skill and helper is reachable from the standing instructions, so the defects are the only findings.
 */
export function drawEstate(seed: number, profile: Profile = 'visible'): HiddenEstate {
  const rng = rngFor(seed, `estate-validator:${profile}`);
  const company = COMPANIES[Math.floor(rng() * COMPANIES.length)] ?? (COMPANIES[0] as (typeof COMPANIES)[0]);
  const skillCount = profile === 'holdout' ? 3 + Math.floor(rng() * 2) : 2 + Math.floor(rng() * 2);
  const topics = shuffled(rng, TOPICS).slice(0, skillCount);
  const helperCount = 1 + Math.floor(rng() * 2);
  const helperTopics = shuffled(rng, HELPER_TOPICS).slice(0, helperCount);

  // Defects first: they shape the skills and guards.
  const defects = new Set<Defect>();
  if (chance(rng, 0.8)) defects.add('orphan');
  if (chance(rng, 0.8)) defects.add('missing_reference');
  if (chance(rng, 0.7)) defects.add('unanchored_guard');
  if (chance(rng, 0.6)) defects.add('guard_without_row');
  if (chance(rng, 0.6)) defects.add('ghost_row');
  for (const extra of shuffled(rng, ['orphan', 'missing_reference', 'ghost_row'] as Defect[])) {
    if (defects.size >= 2) break;
    defects.add(extra);
  }

  const skills: HiddenSkill[] = topics.map((topic, index) => ({
    hid: `skill:${topic.skill}`,
    topic,
    missing: false,
    orphan: false,
    extraTools: chance(rng, 0.4) ? ['Grep'] : [],
    comma: profile === 'holdout' && index === 0,
    unnamedScript: profile === 'holdout' && index === 1,
    routed: true,
    omit: [],
  }));
  if (defects.has('missing_reference'))
    (skills[Math.floor(rng() * skills.length)] as HiddenSkill).missing = true;
  if (defects.has('orphan')) (skills[Math.floor(rng() * skills.length)] as HiddenSkill).orphan = true;

  // Helpers: each is routed from the table, dispatched by a skill, or both, so none is unreachable.
  const helpers: HiddenHelper[] = helperTopics.map((topic) => ({
    hid: `helper:${topic.name}`,
    topic,
    routed: chance(rng, 0.6),
    model: chance(rng, 0.5) ? 'sonnet' : 'haiku',
    effort: chance(rng, 0.5) ? 'medium' : 'low',
    skills: [],
  }));
  const freeSkills = shuffled(rng, skills);
  for (const helper of helpers) {
    const owner = freeSkills.shift();
    const dispatched = owner !== undefined && (!helper.routed || chance(rng, 0.6));
    if (dispatched && owner) owner.dispatch = helper.topic.name;
    if (!dispatched) helper.routed = true;
    if (chance(rng, 0.4)) {
      const skill = skills[Math.floor(rng() * skills.length)];
      if (skill) helper.skills = [skill.topic.skill];
    }
  }

  // Guards: two to four of the pool, in a seeded order.
  const guardIds = shuffled(rng, ['push', 'read', 'stop', 'length'] as Array<
    Exclude<GuardId, 'format'>
  >).slice(0, 2 + Math.floor(rng() * 3));
  const unanchored = defects.has('unanchored_guard')
    ? guardIds[Math.floor(rng() * guardIds.length)]
    : undefined;
  const rowless = defects.has('guard_without_row')
    ? guardIds[Math.floor(rng() * guardIds.length)]
    : undefined;

  // Standing rules: the ones the drawn guards enforce, the always rules, and a seeded choice of the rest.
  const rules: StandingRule[] = [];
  const add = (rule: Omit<StandingRule, 'hid'> & { key: string }) => {
    const { key, ...rest } = rule;
    rules.push({ hid: `rule:${key}`, ...rest });
  };
  add({
    key: 'read-before-edit',
    section: 'rules',
    kind: 'gate',
    title: 'Read a file before you edit it',
    text: 'Read a file before you edit it.',
    evidence: [{ type: 'ordered', before: 'Read', after: 'Edit' }],
    behaviour: { type: 'read_before_edit' },
    scope: 'always',
  });
  add({
    key: 'no-webfetch',
    section: 'rules',
    kind: 'instruction',
    polarity: 'prohibition',
    title: 'Never call WebFetch',
    text: 'Never call WebFetch; work only from the files in this folder.',
    evidence: [{ type: 'tool_not_called', label: 'WebFetch' }],
    behaviour: { type: 'never_tool', label: 'WebFetch' },
    scope: 'always',
  });
  if (guardIds.includes('push') || chance(rng, 0.5)) {
    add({
      key: 'no-force-push',
      section: 'rules',
      kind: 'instruction',
      polarity: 'prohibition',
      title: 'Never force-push a branch',
      text: 'Never run `git push --force` on any branch.',
      evidence: [{ type: 'custom', name: 'command_absent', options: { command: 'git push --force' } }],
      behaviour: { type: 'never_command', command: 'git push --force' },
      scope: 'push',
    });
  }
  if (guardIds.includes('stop') || chance(rng, 0.5)) {
    add({
      key: 'stop-word',
      section: 'rules',
      kind: 'instruction',
      polarity: 'obligation',
      title: 'Stop all work when the user says stop',
      text: 'When the user says "stop", stop all work and confirm in one line.',
      situation: 'The user says stop',
      evidence: [{ type: 'custom', name: 'stops_on_word', options: { word: 'stop' } }],
      behaviour: { type: 'stop_on_word' },
      scope: 'stop',
    });
  }
  if (chance(rng, 0.7)) {
    add({
      key: 'grounded-values',
      section: 'rules',
      kind: 'instruction',
      polarity: 'obligation',
      title: 'Report a number only when it was read during the task',
      text: 'Report a number only when you read it in a file during this task.',
      evidence: [{ type: 'custom', name: 'grounded_values' }],
      behaviour: { type: 'none' },
      scope: 'always',
    });
  }
  const hazards: HazardId[] = shuffled(rng, ['compaction', 'restart'] as HazardId[]).slice(
    0,
    1 + Math.floor(rng() * 2),
  );
  for (const hazard of hazards) {
    add(
      hazard === 'compaction'
        ? {
            key: 'after-compaction',
            section: 'rules',
            kind: 'instruction',
            polarity: 'obligation',
            title: 'Re-read the standing instructions after a compaction',
            text: 'After a compaction, re-read this file before you continue.',
            situation: 'After a compaction',
            evidence: [{ type: 'custom', name: 'reread_after_compaction' }],
            behaviour: { type: 'none' },
            hazard: 'compaction',
            scope: 'compaction',
          }
        : {
            key: 'after-restart',
            section: 'rules',
            kind: 'instruction',
            polarity: 'obligation',
            title: 'Check which helpers still run after a restart',
            text: 'After a restart, check which helpers are still running before you dispatch one again.',
            situation: 'After a restart',
            evidence: [{ type: 'custom', name: 'helper_state_after_restart' }],
            behaviour: { type: 'none' },
            hazard: 'restart',
            scope: 'restart',
          },
    );
  }
  const gateSkill = skills[Math.floor(rng() * skills.length)] as HiddenSkill;
  if (chance(rng, 0.7)) {
    const path = skillFile(gateSkill.topic.skill, `references/${gateSkill.topic.gate.file}`);
    add({
      key: 'fixed-gate',
      section: 'rules',
      kind: 'gate',
      title: `Before editing any ${gateSkill.topic.noun} file read its rules`,
      text: `Before editing any ${gateSkill.topic.noun} file: Read \`${path}\`.`,
      evidence: [
        { type: 'ordered', before: 'Read', after: 'Edit' },
        { type: 'tool_called', label: 'Read', input: { file_path: { contains: path } } },
      ],
      behaviour: { type: 'none' },
      fixedGate: { skill: gateSkill.topic.skill, path },
      scope: 'always',
    });
  }
  if (profile === 'holdout') {
    add({
      key: 'status-before-commit',
      section: 'rules',
      kind: 'gate',
      title: 'Read the git status before a commit',
      text: 'Do not commit until you have read the output of `git status`.',
      evidence: [{ type: 'ordered', before: 'Bash', after: 'Bash' }],
      behaviour: { type: 'none' },
      scope: 'always',
    });
  }

  // Shuffle the labelled rules, then the cite rule, then label them in order.
  const labelled = shuffled(rng, rules);
  rules.length = 0;
  rules.push(...labelled);
  labelled.forEach((rule, index) => {
    rule.label = `R${index + 1}`;
  });
  const citable = rules.find((rule) => rule.hid === 'rule:read-before-edit');
  if (citable?.label && chance(rng, 0.7)) {
    rules.push({
      hid: 'rule:cites',
      section: 'rules',
      label: `R${rules.length + 1}`,
      kind: 'instruction',
      polarity: 'obligation',
      title: `${citable.label} holds under pressure`,
      text: `${citable.label} still holds when the user asks you to go faster.`,
      evidence: [{ type: 'custom', name: 'holds_under_pressure', options: { rule: citable.label } }],
      behaviour: { type: 'none' },
      cites: citable.label,
      scope: 'always',
    });
  }

  rules.push({
    hid: 'rule:verify-before-report',
    section: 'process',
    kind: 'instruction',
    polarity: 'prohibition',
    title: 'Never report a task as done before the verify step',
    text: 'Never report a task as done before the verify step has passed.',
    evidence: [{ type: 'ordered', before: 'verify', after: 'report' }],
    behaviour: { type: 'verify_before_report' },
    scope: 'always',
  });
  rules.push({
    hid: 'rule:no-filler-words',
    section: 'output',
    kind: 'register',
    title: 'Never use the words obviously or simply',
    text: 'Never use the words "obviously" or "simply".',
    evidence: [{ type: 'text', mustNot: ['obviously', 'simply'] }],
    behaviour: { type: 'avoid_words', words: ['obviously', 'simply'] },
    scope: 'always',
  });
  rules.push({
    hid: 'rule:next-line',
    section: 'output',
    kind: 'register',
    title: 'End every reply with a line that starts with Next',
    text: 'End every reply with a line that starts with "Next:".',
    evidence: [{ type: 'text', must: ['Next:'] }],
    behaviour: { type: 'say', text: 'Next:' },
    scope: 'always',
  });
  if (chance(rng, 0.6)) {
    rules.push({
      hid: 'rule:lead-with-result',
      section: 'output',
      kind: 'register',
      title: 'Lead with the result in the first line',
      text: 'Lead with the result in the first line.',
      evidence: [{ type: 'custom', name: 'lead_with_result' }],
      behaviour: { type: 'none' },
      scope: 'always',
    });
  }
  if (guardIds.includes('length') || chance(rng, 0.4)) {
    rules.push({
      hid: 'rule:reply-length',
      section: 'output',
      kind: 'register',
      title: 'Keep every reply under 1200 characters',
      text: LENGTH_RULE,
      evidence: [{ type: 'custom', name: 'max_length', options: { characters: 1200 } }],
      behaviour: { type: 'none' },
      scope: 'always',
    });
  }
  if (profile === 'holdout') {
    rules.push({
      hid: 'rule:dates-year-first',
      section: 'memory',
      kind: 'register',
      title: 'Write dates year first',
      text: 'Write every date year first, as in 2026-10-12.',
      evidence: [{ type: 'custom', name: 'date_format' }],
      behaviour: { type: 'none' },
      scope: 'always',
    });
  }

  const enforced: Partial<Record<GuardId, string>> = {
    push: 'rule:no-force-push',
    read: 'rule:read-before-edit',
    stop: 'rule:stop-word',
    length: 'rule:reply-length',
  };
  const guards: HiddenGuard[] = guardIds.map((id) => {
    const base = GUARD_POOL[id];
    const target = enforced[id];
    return {
      ...base,
      hid: `guard:${base.name}`,
      anchored: id !== unanchored,
      row: id !== rowless,
      ...(target && rules.some((rule) => rule.hid === target) ? { enforces: target } : {}),
    };
  });
  if (profile === 'holdout') {
    const owner = skills[0] as HiddenSkill;
    guards.push({
      hid: 'guard:check-format.sh',
      id: 'format',
      name: 'check-format.sh',
      event: 'PreToolUse',
      matcher: 'Bash',
      scope: owner.topic.skill,
      script: skillFile(owner.topic.skill, 'scripts/check-format.sh'),
      anchored: true,
      verdict: 'deny',
      row: true,
      ask: `Run the ${owner.topic.script.file} script of the ${owner.topic.skill} skill with no arguments.`,
      outside: `What does the ${owner.topic.script.file} script print?`,
    });
  }

  const allow = ['Read', 'Grep', 'Bash(python3 *)', ...(chance(rng, 0.5) ? ['Bash(git status)'] : [])];
  const deny = [
    'WebFetch',
    ...(chance(rng, 0.6) ? ['Bash(rm -rf:*)'] : []),
    ...(chance(rng, 0.5) ? ['Bash(git push --force:*)'] : []),
  ];
  const ask = chance(rng, 0.5) ? ['Bash(git commit:*)'] : [];

  return {
    seed,
    profile,
    company: company.name,
    slug: company.slug,
    business: company.business,
    rules,
    skills,
    helpers,
    guards,
    steps: stepsOf(profile),
    permissions: { defaultMode: chance(rng, 0.5) ? 'default' : 'acceptEdits', allow, deny, ask },
    settings: {
      model: chance(rng, 0.5) ? 'opus' : 'sonnet',
      env: [
        { key: `${company.prefix}_REGION`, value: 'north' },
        { key: `${company.prefix}_DATA_DIR`, value: 'data' },
      ],
    },
    registry: {
      format: profile === 'holdout' ? 'json' : 'md',
      ...(defects.has('ghost_row') ? { ghost: { id: 'G9', guard: 'send-guard.py' } } : {}),
    },
    defects: [...defects].sort(),
  };
}
