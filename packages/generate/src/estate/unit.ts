import { z } from 'zod';
import type { EstateAtom, EstatePlanRow } from './inputs';

/**
 * A unit test of the estate: a guard or a script run directly, with no model in the loop, by
 * `driftbench estate unit` on an estate root (the original or a mutant copy). The generator writes one per
 * guard and test type (guard_positive, guard_negative, guard_hostile, guard_speed) and one per script row
 * (script_fixture), as JSON in `unit/<test type>/<id>.json`.
 *
 * A guard test holds hook payloads in the runtime's input shape, built by code from the map: the event and
 * the matcher of the guard, and the material of the rules it enforces (the commands, paths and phrases their
 * quotes hold). The generator knows no verdict: `estate unit --record` runs every case on the original estate
 * and writes what the guard decided into the test (the oracle), and a run on a mutant compares with it.
 *
 * - guard_positive: payloads the rules forbid. Recorded allowed with nothing printed, a case is inert (it
 *   cannot show the guard at work) and is reported, never asserted.
 * - guard_negative: neutral payloads. The guard lets them through on the original.
 * - guard_hostile: the forbidden material in forms that slip past a naive match (spacing, case, quoting,
 *   a chained command). Recorded allowed, a case is a weakness of the guard, reported.
 * - guard_speed: a spread of at most five positive payloads, timed against the guard's declared timeout (60 s by default).
 * - script_fixture: the fixtures the estate declares for the script, run as declared; with none declared,
 *   minimal fixtures from how the estate says to run the script (no argument, then its documented command
 *   lines), their outcomes recorded like a guard's.
 */

export const UNIT_DIR = 'unit';
export const UNIT_TEST_TYPES: ReadonlySet<string> = new Set([
  'guard_positive',
  'guard_negative',
  'guard_hostile',
  'guard_speed',
  'script_fixture',
]);

/** What a run of a guard decided, as the runtime reads it. */
export const UnitDecision = z.enum(['allow', 'deny', 'ask', 'error']);
export type UnitDecision = z.infer<typeof UnitDecision>;

/** The recorded outcome of a case on the original estate: the oracle a mutant run compares with. */
export const UnitOutcome = z.strictObject({
  decision: UnitDecision,
  exitCode: z.number().int(),
  /** The message the runtime would show (stderr on exit 2, the reason of a JSON decision), when stable. */
  message: z.string().optional(),
  /** What the guard printed on stdout (context it adds, a JSON decision), when stable. */
  output: z.string().optional(),
});
export type UnitOutcome = z.infer<typeof UnitOutcome>;

export const GuardCase = z.strictObject({
  id: z.string().min(1),
  /** The hook payload, in the runtime's input shape, without the session fields the runner adds. */
  payload: z.record(z.string(), z.unknown()),
  /** The material the case carries, for the report. */
  material: z.string(),
  expected: UnitOutcome.optional(),
  /** Set by --record: the case cannot show the guard at work (positive) or slips past it (hostile). */
  inert: z.boolean().optional(),
  /** Recorded with an outcome that varied across the record runs: reported, never compared. */
  flaky: z.boolean().optional(),
});
export type GuardCase = z.infer<typeof GuardCase>;

export const UnitTest = z.strictObject({
  id: z.string().min(1),
  planRow: z.string().min(1),
  testType: z.enum([
    'guard_positive',
    'guard_negative',
    'guard_hostile',
    'guard_speed',
    'script_fixture',
    'contract_alone',
  ]),
  atom: z.string().min(1),
  title: z.string().min(1),
  mapHash: z.string().min(1),
  target: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('guard'),
      name: z.string().min(1),
      event: z.string().min(1),
      matcher: z.string().optional(),
      command: z.string().min(1),
      /** The guard's declared timeout, in seconds. */
      timeout: z.number().positive().optional(),
      /** A catalogue check this hook runs: the test sends the check's trigger, and looks for its id. */
      check: z.string().optional(),
    }),
    z.strictObject({ kind: z.literal('script'), path: z.string().min(1), skill: z.string().optional() }),
    /** A helper run alone on a task, by the executor the estate declares for it: its agent file is the prompt. */
    z.strictObject({ kind: z.literal('subagent'), name: z.string().min(1), file: z.string().min(1) }),
  ]),
  cases: z.array(GuardCase).default([]),
  /** The map hash of the estate --record ran on; absent until then. */
  recordedOn: z.string().optional(),
  /** guard_speed: the most a run may take, in milliseconds. */
  budgetMs: z.number().int().positive().optional(),
});
export type UnitTest = z.infer<typeof UnitTest>;

/** Bound generated boundary payloads so an untrusted declaration cannot exhaust memory. */
export const MAX_BOUNDARY_CHARACTERS = 1_000_000;

/** Events whose payload names a tool. */
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PermissionRequest']);
const NEUTRAL: Record<string, string> = {
  Bash: 'ls',
  Read: 'README.md',
  Edit: 'notes.md',
  Write: 'notes.md',
  MultiEdit: 'notes.md',
  WebFetch: 'https://example.invalid/',
  Grep: 'TODO',
  Glob: '*.md',
};

/** The tools a matcher names: `Edit|Write` gives two; an empty or `*` matcher gives Bash. */
export function matcherTools(matcher: string | undefined): string[] {
  if (matcher === undefined || matcher.trim() === '' || matcher.trim() === '*') return ['Bash'];
  const tools = matcher
    .split('|')
    .map((part) => part.replace(/[()^$\\]/g, '').trim())
    .filter((part) => /^[A-Za-z][\w.:-]*$/.test(part));
  return tools.length > 0 ? tools : ['Bash'];
}

/** Words and marks that make a clause forbid what it names. */
const FORBIDS =
  /\b(never|no|not|don't|do not|must not|mustn't|forbid|forbidden|banned|refuse[sd]?|block(?:s|ed)?|den(?:y|ies|ied)|avoid|stop)\b|✗|\bWRONG\b/i;

/**
 * The material of a rule quote: the backticked spans and quoted phrases of the clauses that forbid them
 * ("Never use `sed -i`", "✗ `2>/dev/null`"), never a name or path the rule only mentions. A quote with no
 * span at all is its own material.
 */
export function materialOf(quote: string): string[] {
  const spans: string[] = [];
  const masked = quote.replace(
    /`([^`]+)`|"([^"]{3,})"/g,
    (_, code: string | undefined, phrase: string | undefined) => {
      spans.push(code ?? phrase ?? '');
      return `\uE000${spans.length - 1}\uE000`;
    },
  );
  if (spans.length === 0) return [quote.trim()];
  const found: string[] = [];
  for (const clause of masked.split(/(?<=[.!?])\s+|\n|;|·|(?=✓)/)) {
    if (!FORBIDS.test(clause.replace(/\uE000\d+\uE000/g, ' '))) continue;
    for (const match of clause.matchAll(/\uE000(\d+)\uE000/g)) {
      const span = spans[Number(match[1])] ?? '';
      if (span.trim() !== '') found.push(span);
    }
  }
  return [...new Set(found)];
}

/** Words and marks that make a clause show the right way to act: its spans are the form the rule asks for. */
const OBLIGES = /\b(always|must|should|as in|e\.g\.|for example)\b|✓|\bRIGHT\b/i;

/** The shell command of an act on a path, by the verb a rule names it with. */
const ACT_COMMANDS: Record<string, string> = {
  delete: 'rm',
  remove: 'rm',
  erase: 'rm',
  move: 'mv',
  rename: 'mv',
  copy: 'cp',
  read: 'cat',
  open: 'cat',
  list: 'ls',
};

/** One clause of a rule quote: whether it forbids or asks for a form, its act verb and its spans. */
type Clause = { forbids: boolean; obliges: boolean; act?: string; spans: string[] };

/** The clauses of a rule quote, split as `materialOf` splits them, with the spans each holds. */
export function clausesOf(quote: string): Clause[] {
  const spans: string[] = [];
  const masked = quote.replace(
    /`([^`]+)`|"([^"]{3,})"/g,
    (_, code: string | undefined, phrase: string | undefined) => {
      spans.push(code ?? phrase ?? '');
      return `${spans.length - 1}`;
    },
  );
  return masked.split(/(?<=[.!?])\s+|\n|;|·|(?=✓)/).map((clause) => {
    const words = clause.replace(/\d+/g, ' ');
    const act = words
      .toLowerCase()
      .split(/[^a-z]+/)
      .find((word) => ACT_COMMANDS[word] !== undefined);
    return {
      forbids: FORBIDS.test(words),
      obliges: OBLIGES.test(words),
      ...(act !== undefined ? { act } : {}),
      spans: [...clause.matchAll(/(\d+)/g)]
        .map((match) => spans[Number(match[1])] ?? '')
        .filter((span) => span.trim() !== ''),
    };
  });
}

/**
 * The acts that break an obligation a command line shows ("Always pass the carrier code, as in
 * `./track.sh NWX 123`"): the command line with each of its arguments left out in turn. A span of one word
 * shows no arguments and gives none.
 */
export function brokenForms(example: string): string[] {
  const tokens = example.trim().split(/\s+/);
  if (tokens.length < 2) return [];
  return tokens.slice(1).map((_, index) => tokens.filter((__, at) => at !== index + 1).join(' '));
}

/**
 * A path a Bash guard watches is no command: the act the rule forbids on it is. `ledger/` in "never delete a
 * file under `ledger/`" gives `rm ledger/`. A span that already reads as a command line, or a clause with no
 * act verb, is sent as it is.
 */
function bashForm(span: string, act: string | undefined): string {
  const command = act === undefined ? undefined : ACT_COMMANDS[act];
  const path = /^[\w.~/-]+$/.test(span) && (span.includes('/') || /\.[A-Za-z0-9]+$/.test(span));
  if (command === undefined || !path) return span;
  return command === 'mv' || command === 'cp'
    ? `${command} ${span} ${span.replace(/\/$/, '')}.bak`
    : `${command} ${span}`;
}

/** The tool input a tool takes, carrying one piece of material. */
export function toolInput(tool: string, material: string): Record<string, unknown> {
  const looksLikePath = /^[\w./~-]+\.[A-Za-z0-9]+$/.test(material) || material.includes('/');
  switch (tool) {
    case 'Bash':
      return { command: material, description: 'unit test' };
    case 'Read':
      return { file_path: material };
    case 'Edit':
    case 'MultiEdit':
      return looksLikePath
        ? { file_path: material, old_string: 'a', new_string: 'b' }
        : { file_path: 'notes.md', old_string: 'a', new_string: material };
    case 'Write':
      return looksLikePath
        ? { file_path: material, content: 'x' }
        : { file_path: 'notes.md', content: material };
    case 'WebFetch':
      return { url: /^https?:/.test(material) ? material : 'https://example.invalid/', prompt: material };
    default:
      return { input: material };
  }
}

/** A hook payload for an event, a tool and a piece of material (the session fields come from the runner). */
export function payloadOf(
  event: string,
  tool: string | undefined,
  material: string,
): Record<string, unknown> {
  if (TOOL_EVENTS.has(event) && tool !== undefined) {
    const payload: Record<string, unknown> = { tool_name: tool, tool_input: toolInput(tool, material) };
    if (event === 'PostToolUse') payload.tool_response = { stdout: '', stderr: '', interrupted: false };
    return payload;
  }
  if (event === 'UserPromptSubmit') return { prompt: material };
  // Stop and the other events: the material is the last reply, which the runner writes into the transcript.
  return { stop_hook_active: false, last_reply: material };
}

/** A speed test times this many positive payloads: latency needs a spread, not every payload. */
export const SPEED_CASES = 5;

/** At most `count` cases, evenly spread from the first to the last, numbered again from case-01. */
function spreadOf(cases: GuardCase[], count: number): GuardCase[] {
  if (cases.length <= count) return cases;
  const picked = Array.from(
    { length: count },
    (_, index) => cases[Math.round((index * (cases.length - 1)) / (count - 1))] as GuardCase,
  );
  return picked.map((entry, index) => ({ ...entry, id: `case-${String(index + 1).padStart(2, '0')}` }));
}

/** Hostile forms of forbidden material: spacing, case, quoting and a chained command. */
export function hostileForms(material: string): string[] {
  const forms = [
    material.replace(/ /g, '  '),
    material.toUpperCase() === material ? material.toLowerCase() : material.toUpperCase(),
    material.includes(' ') ? material.replace(/ /, " '' ") : `${material} `,
    `echo ok && ${material}`,
  ];
  return [...new Set(forms)].filter((form) => form !== material);
}

/**
 * The unit test of a helper run alone (`contract_alone`): one case holding the task the row asks and the workspace
 * files its situation seeds. `estate unit --record` runs the helper once per record run on the original estate and
 * writes what it answered into the case; a later run, on a copy whose agent file lost its body or was changed, must
 * answer the same.
 */
export function helperUnitTestOf(
  atom: EstateAtom,
  run: { task: string; files: Record<string, string> },
  mapHash: string,
  id: string,
  row: Pick<EstatePlanRow, 'id'>,
): UnitTest | string {
  const name = atom.fields?.name;
  const file = atom.provenance?.file;
  if (typeof name !== 'string' || typeof file !== 'string')
    return `${atom.id} names no helper with an agent file`;
  if (run.task.trim() === '') return `${atom.id} has no task to run the helper on`;
  return {
    id,
    planRow: row.id,
    testType: 'contract_alone',
    atom: atom.id,
    title: atom.title,
    mapHash,
    target: { kind: 'subagent', name, file },
    cases: [{ id: 'case-01', payload: { task: run.task, files: run.files }, material: run.task }],
  };
}

/** The unit test of a row, or the reason it has none. */
export function unitTestOf(
  row: EstatePlanRow,
  atom: EstateAtom,
  atoms: ReadonlyMap<string, EstateAtom>,
  mapHash: string,
  id: string,
): UnitTest | string {
  const testType = row.testType as UnitTest['testType'];
  const base = { id, planRow: row.id, testType, atom: atom.id, title: atom.title, mapHash };
  if (testType === 'script_fixture') {
    const path = atom.fields?.path;
    if (typeof path !== 'string' || path === '') return `${atom.id} names no script path`;
    const skill = atom.fields?.skill;
    return {
      ...base,
      target: { kind: 'script', path, ...(typeof skill === 'string' ? { skill } : {}) },
      cases: scriptCases(atom.provenance?.quote ?? '', path),
    };
  }
  const fields = atom.fields ?? {};
  // A catalogue check is run by a hook, not by a command of its own: it is tested by sending its trigger to
  // that hook. Without a trigger or a host hook it is a counted gap, not a test.
  if (fields.scope === 'catalogue') return checkTestOf(row, atom, atoms, base);
  const built = guardRunOf(testType, atom, atoms);
  return typeof built === 'string' ? built : { ...base, ...built };
}

/**
 * The run a unit-mode spec carries in `metadata.estate.unit`, so `estate unit` can run the spec with no model
 * and judge its own Then: the guard with the payloads its test type sends, the script with its minimal
 * fixtures, or the helper whose agent file the runtime would serve.
 */
export const SpecUnit = z.strictObject({
  target: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('guard'),
      name: z.string().min(1),
      event: z.string().min(1),
      matcher: z.string().optional(),
      command: z.string().min(1),
      timeout: z.number().positive().optional(),
      /** The verdict the estate declares for the guard (deny, warn, nudge, ...), when it declares one. */
      verdict: z.string().optional(),
    }),
    z.strictObject({ kind: z.literal('script'), path: z.string().min(1), skill: z.string().optional() }),
    z.strictObject({ kind: z.literal('subagent'), name: z.string().min(1), file: z.string().min(1) }),
  ]),
  cases: z.array(GuardCase).default([]),
  /** The most a guard run may take, in milliseconds: its declared timeout (60 s by default). */
  budgetMs: z.number().int().positive().optional(),
});
export type SpecUnit = z.infer<typeof SpecUnit>;

/** The test types a unit-mode spec runs with: the payloads each sends. */
const SPEC_CASES: Record<string, UnitTest['testType']> = {
  guard_positive: 'guard_positive',
  guard_register: 'guard_positive',
  guard_speed: 'guard_speed',
  guard_negative: 'guard_negative',
  guard_hostile: 'guard_hostile',
};

/** The unit run of a unit-mode spec, or the reason it has none. */
export function specUnitOf(
  row: Pick<EstatePlanRow, 'testType'>,
  atoms: readonly EstateAtom[],
  all: ReadonlyMap<string, EstateAtom>,
): SpecUnit | string {
  const head = atoms[0];
  if (!head) return 'the row names no atom';
  if (row.testType === 'script_fixture') {
    const path = head.fields?.path;
    if (typeof path !== 'string' || path === '') return `${head.id} names no script path`;
    const skill = head.fields?.skill;
    return {
      target: { kind: 'script', path, ...(typeof skill === 'string' ? { skill } : {}) },
      cases: scriptCases(head.provenance?.quote ?? '', path),
    };
  }
  if (row.testType === 'contract_alone') {
    const helper = atoms.find((atom) => atom.kind === 'subagent');
    const name = helper?.fields?.name;
    const file = helper?.provenance?.file;
    if (typeof name !== 'string' || typeof file !== 'string')
      return 'the row names no helper with an agent file';
    return { target: { kind: 'subagent', name, file }, cases: [] };
  }
  const testType = SPEC_CASES[row.testType];
  if (testType === undefined) return `${row.testType} has no unit run`;
  if (head.fields?.scope === 'catalogue') return `${head.id} is a check its host hook runs`;
  const built = guardRunOf(testType, head, all, true);
  if (typeof built === 'string') return built;
  const declared = head.evidence.find((entry) => entry.type === 'guard')?.verdict;
  const target = built.target;
  if (target.kind !== 'guard') return `${head.id} is no guard`;
  const { check: _check, ...guard } = target;
  return {
    target: { ...guard, ...(declared !== undefined ? { verdict: declared } : {}) },
    cases: built.cases,
    budgetMs: Math.round((guard.timeout ?? 60) * 1000),
  };
}

/**
 * The target and the cases of a guard for a test type. `withPlain` puts the forbidden material itself before
 * its hostile forms, so a hostile run also shows the guard catching the plain act.
 */
function guardRunOf(
  testType: UnitTest['testType'],
  atom: EstateAtom,
  atoms: ReadonlyMap<string, EstateAtom>,
  withPlain = false,
): Pick<UnitTest, 'target' | 'cases' | 'budgetMs'> | string {
  const fields = atom.fields ?? {};
  const name = fields.name;
  const event = fields.event;
  const command = fields.command;
  if (typeof name !== 'string' || typeof event !== 'string' || typeof command !== 'string') {
    return `${atom.id} is no guard with a name, an event and a command`;
  }
  const matcher = typeof fields.matcher === 'string' ? fields.matcher : undefined;
  const timeout = typeof fields.timeout === 'number' ? fields.timeout : undefined;
  const target = {
    kind: 'guard' as const,
    name,
    event,
    command,
    ...(matcher !== undefined ? { matcher } : {}),
    ...(timeout !== undefined ? { timeout } : {}),
  };
  const tools = TOOL_EVENTS.has(event) ? matcherTools(matcher) : [undefined];
  // A rule linked by a registry row or an id the guard cites is what the guard checks; a rule linked only
  // because the guard's source repeats some of its words is a weaker link, used when there is no other.
  const links = Array.isArray(fields.enforces)
    ? (fields.enforces as Array<{ atom?: unknown; by?: unknown }>).flatMap((entry) =>
        typeof entry.atom === 'string' ? [{ atom: entry.atom, by: entry.by }] : [],
      )
    : [];
  const strong = links.filter((link) => link.by === 'registry' || link.by === 'id');
  const enforced = (strong.length > 0 ? strong : links).map((link) => link.atom);
  // A rule the guard cites (registry or id) gives every concrete span of its source lines; a rule linked by
  // a repeated quote gives only the spans its words forbid. A rule with no span gives its sentence, which
  // only a text event (a prompt, a reply) can carry: a tool never gets a sentence as its input.
  const cites = strong.length > 0;
  let replyLimit: number | undefined;
  if (!TOOL_EVENTS.has(event)) {
    for (const ruleId of enforced) {
      const constraint = atoms
        .get(ruleId)
        ?.evidence.find((entry) => entry.type === 'custom' && entry.name === 'max_characters');
      const max = constraint?.type === 'custom' ? constraint.options?.max : undefined;
      if (
        max !== undefined &&
        (typeof max !== 'number' || !Number.isSafeInteger(max) || max < 0 || max >= MAX_BOUNDARY_CHARACTERS)
      )
        return `${atom.id} declares a reply boundary outside the supported payload size`;
      if (typeof max === 'number') replyLimit = Math.min(replyLimit ?? max, max);
    }
  }
  const textEvent = !TOOL_EVENTS.has(event);
  // Material: what the rule forbids. A cited rule's spans in the clauses that forbid them, each with the act
  // its clause names; a cited rule that only shows the right form (an obligation) gives that form as allowed
  // material and the form with each argument left out as forbidden; a cited rule with neither gives every span
  // of its source lines.
  type Piece = { text: string; act?: string };
  const allowed: string[] = [];
  const pieces = enforced.flatMap((ruleId): Piece[] => {
    const rule = atoms.get(ruleId);
    const quote = rule?.provenance?.quote ?? '';
    // A declared numeric output constraint supplies its boundary independently of the hook source.
    const bound = textEvent
      ? rule?.evidence.find((entry) => entry.type === 'custom' && entry.name === 'max_characters')
      : undefined;
    const max = bound?.type === 'custom' ? bound.options?.max : undefined;
    if (typeof max === 'number' && Number.isSafeInteger(max) && max >= 0 && max < MAX_BOUNDARY_CHARACTERS) {
      return [{ text: 'x'.repeat(max + 1) }];
    }
    if (cites) {
      const clauses = clausesOf(quote);
      const forbidden = clauses
        .filter((clause) => clause.forbids)
        .flatMap((clause) =>
          clause.spans.map((text) => ({ text, ...(clause.act !== undefined ? { act: clause.act } : {}) })),
        );
      if (forbidden.length > 0) return forbidden;
      const shown = clauses.filter((clause) => clause.obliges).flatMap((clause) => clause.spans);
      const broken = shown.flatMap(brokenForms);
      if (broken.length > 0) {
        allowed.push(...shown);
        return broken.map((text) => ({ text }));
      }
      const lineSpans = Array.isArray(rule?.fields?.spans)
        ? (rule.fields.spans as unknown[]).filter((item): item is string => typeof item === 'string')
        : [];
      const quoteSpans = [...quote.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? '');
      const spans = [...lineSpans, ...quoteSpans];
      if (spans.length > 0) return spans.map((text) => ({ text }));
    } else {
      const spans = materialOf(quote).filter((item) => item !== quote.trim());
      if (spans.length > 0) return spans.map((text) => ({ text }));
    }
    return textEvent && quote.trim() !== '' ? materialOf(quote).map((text) => ({ text })) : [];
  });
  const formOf = (tool: string | undefined, piece: Piece) =>
    tool === 'Bash' ? bashForm(piece.text, piece.act) : piece.text;
  const cases: GuardCase[] = [];
  const seen = new Set<string>();
  const add = (tool: string | undefined, text: string, allowEmpty = false) => {
    if ((!allowEmpty && text.trim() === '') || seen.has(`${tool}\u0000${text}`)) return;
    seen.add(`${tool}\u0000${text}`);
    cases.push({
      id: `case-${String(cases.length + 1).padStart(2, '0')}`,
      payload: payloadOf(event, tool, text),
      material: text,
    });
  };
  if (testType === 'guard_negative') {
    for (const tool of tools) {
      add(
        tool,
        tool === undefined ? 'Done.'.slice(0, replyLimit) : (NEUTRAL[tool] ?? 'hello'),
        replyLimit === 0,
      );
      // The right form an obligation shows is let through as well.
      for (const text of allowed) add(tool, text);
    }
  } else {
    if (pieces.length === 0) return `${atom.id} enforces no rule whose quote gives material for a payload`;
    for (const tool of tools) {
      for (const piece of pieces) {
        const text = formOf(tool, piece);
        if (testType === 'guard_hostile') {
          if (withPlain) add(tool, text);
          for (const form of hostileForms(text)) add(tool, form);
        } else add(tool, text);
      }
    }
  }
  return {
    target,
    cases: testType === 'guard_speed' ? spreadOf(cases, SPEED_CASES) : cases,
    ...(testType === 'guard_speed' ? { budgetMs: Math.round((timeout ?? 60) * 1000) } : {}),
  };
}

/** Reasons a catalogue check gets no unit test; the report counts them as gaps. */
export const CHECK_GAP = {
  trigger: 'needs a trigger: the map holds no material that sets the check off',
  host: 'needs a host: no configured hook on its event names the check',
} as const;

/** The events and tools a check's event names: `PreToolUse (Bash)`, `Stop, PostToolUse`, `PreToolUse (Task/Agent)`. */
export function checkEvents(text: string): Array<{ event: string; tools: string[] }> {
  return text.split(',').flatMap((part) => {
    const match = /^\s*(\w+)\s*(?:\(([^)]*)\))?/.exec(part);
    if (!match?.[1]) return [];
    const tools = (match[2] ?? '')
      .split('/')
      .map((tool) => tool.trim())
      .filter((tool) => tool !== '');
    return [{ event: match[1], tools }];
  });
}

function checkTestOf(
  row: { testType: string },
  atom: EstateAtom,
  atoms: ReadonlyMap<string, EstateAtom>,
  base: Omit<UnitTest, 'target' | 'cases'>,
): UnitTest | string {
  const fields = atom.fields ?? {};
  if (row.testType !== 'guard_positive') {
    return `${atom.id} is a check its host hook runs; the host hook tests cover this test type`;
  }
  const trigger = Array.isArray(fields.trigger)
    ? (fields.trigger as unknown[]).filter((item): item is string => typeof item === 'string' && item !== '')
    : [];
  if (trigger.length === 0) return `${atom.id} ${CHECK_GAP.trigger}`;
  const host = fields.host;
  const check = typeof fields.check === 'string' ? fields.check : String(fields.name ?? atom.id);
  const wanted = checkEvents(String(fields.event ?? ''));
  for (const parent of atoms.values()) {
    const own = parent.fields ?? {};
    if (
      parent.kind !== 'guard' ||
      own.scope === 'catalogue' ||
      own.script !== host ||
      typeof host !== 'string'
    )
      continue;
    const name = own.name;
    const event = own.event;
    const command = own.command;
    if (typeof name !== 'string' || typeof event !== 'string' || typeof command !== 'string') continue;
    const matcher = typeof own.matcher === 'string' ? own.matcher : undefined;
    const hostTools: string[] = TOOL_EVENTS.has(event) ? matcherTools(matcher) : [];
    const fit = wanted.find((entry) => entry.event === event);
    if (!fit) continue;
    const tools: Array<string | undefined> = TOOL_EVENTS.has(event)
      ? fit.tools.length > 0
        ? fit.tools.filter((tool) => hostTools.includes(tool))
        : hostTools.slice(0, 1)
      : [undefined];
    if (tools.length === 0) continue;
    const tool = tools[0];
    const cases: GuardCase[] = trigger.map((text, index) => ({
      id: `case-${String(index + 1).padStart(2, '0')}`,
      payload: payloadOf(event, tool, text),
      material: text,
    }));
    const timeout = typeof own.timeout === 'number' ? own.timeout : undefined;
    return {
      ...base,
      target: {
        kind: 'guard' as const,
        name,
        event,
        command,
        ...(matcher !== undefined ? { matcher } : {}),
        ...(timeout !== undefined ? { timeout } : {}),
        check,
      },
      cases,
    };
  }
  return `${atom.id} ${CHECK_GAP.host}`;
}

/**
 * The minimal fixtures of a script with none declared, from how the estate says to run it: the script with
 * no argument (its usage path), then each command line the atom's quote writes for it, a `<placeholder>`
 * argument becoming an empty file of that name in the working folder. The outcomes are recorded on the
 * original by `estate unit --record`, like a guard's.
 */
export function scriptCases(quote: string, path: string): GuardCase[] {
  const name = path.split('/').pop() ?? path;
  const cases: GuardCase[] = [{ id: 'case-01', payload: { args: [] }, material: 'no argument' }];
  const seen = new Set<string>(['']);
  for (const match of quote.matchAll(/`([^`]+)`/g)) {
    const tokens = (match[1] ?? '').trim().split(/\s+/);
    const at = tokens.findIndex((token) => token.endsWith(name));
    if (at < 0) continue;
    const files: Record<string, string> = {};
    const args = tokens.slice(at + 1).map((token) => {
      const placeholder = /^<([^>]+)>$/.exec(token)?.[1];
      if (placeholder === undefined) return token;
      const file = placeholder.replace(/[^\w.-]+/g, '-');
      files[file] = '';
      return file;
    });
    const key = args.join(' ');
    if (seen.has(key)) continue;
    seen.add(key);
    cases.push({
      id: `case-${String(cases.length + 1).padStart(2, '0')}`,
      payload: { args, ...(Object.keys(files).length > 0 ? { files } : {}) },
      material: key,
    });
  }
  return cases;
}
