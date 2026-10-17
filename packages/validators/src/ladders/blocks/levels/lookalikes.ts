import { between, pick, type RawSpec, type Rng, rngFor, run, SHOP } from '../harness';
import { type Action, type FileAction, plantedAgent, token } from '../kinds';
import type { BlocksProduct } from '../product';
import { type BankItem, fail, type ItemResult, PASS, type Tier } from '../types';

/**
 * Level 5, look-alike faults: two blocks fail with the same symptom (the same failing verdicts) for different
 * causes, and blame must tell them apart (docs/reference/blame.md, policy/blame:default, on feat/block-b4-report).
 * Each pair plants the evidence the documented rules read, and nothing else: a reply that claims a result the run
 * contradicts (I3_false_claim, the agent's), a failure whose stderr names an environment class (env_failure,
 * excluded), an honest failure no rule attributes (unassigned), a value altered from what the user gave (R2), a
 * value copied verbatim that a tool with no stated format refuses (R3), a value outside the tool's enum (R1). The
 * item runs both blocks in one spec under the code-agent-liability diagnostic and requires each root diagnosis to
 * name its planted rule, disposition and fix action.
 */

const ATTRIBUTE = 'packages/checks/src/blame/attribute.ts';
const EVIDENCE = 'packages/core/src/evidence/trace.ts';
const VALUE_EVIDENCE = 'packages/core/src/evidence/value.ts';

/** The blame a block must get: the policy item, its disposition and its fix action. */
type Blame = { item: string; disposition: string; fixAction: string };

const I3: Blame = { item: 'I3_false_claim', disposition: 'agent', fixAction: 'report_only_observed' };
const ENV: Blame = { item: 'env_failure', disposition: 'excluded', fixAction: 'fix_harness' };
const NONE: Blame = { item: 'unassigned', disposition: 'unassigned', fixAction: 'review' };
const R1: Blame = { item: 'R1', disposition: 'agent', fixAction: 'strengthen_rule' };
const R2: Blame = { item: 'R2', disposition: 'agent', fixAction: 'copy_given_values' };
const R3: Blame = { item: 'R3', disposition: 'shared', fixAction: 'state_contract' };
const R2B: Blame = { item: 'R2b', disposition: 'agent', fixAction: 'add_rule_or_model' };
const I1: Blame = { item: 'I1_protected_edit', disposition: 'agent', fixAction: 'protect_paths' };
/** The documented effect names no disposition: any is accepted. */
const CAUGHT: Blame = { item: 'core_rule_caught', disposition: '', fixAction: 'none_enforced' };
const UNDECIDED: Blame = {
  item: 'skill_not_loaded_undecided',
  disposition: 'shared',
  fixAction: 'rewrite_description',
};

/** A CODE symptom: what the block expects of its file, and the action that breaks it. */
type Symptom = {
  id: string;
  /** The file the block asks for, and the checks it declares on it. */
  file(rng: Rng, path: string): { file: FileAction; checks: Record<string, unknown>[] };
  /** The agent's broken action, from the passing file. */
  breaks(file: FileAction): Pick<Action, 'files' | 'commands'>;
  /** Expectations beyond the file's checks. */
  expect?(file: FileAction): Record<string, unknown>;
};

const okCommand = { command: 'python make.py', exitCode: 0 };

const SYMPTOMS: Symptom[] = [
  {
    id: 'missing-file',
    file: (rng, path) => ({
      file: {
        path: `${path}.csv`,
        format: 'csv',
        data: [
          ['bike', 'days'],
          [pick(rng, SHOP.bikes), 4],
        ],
      },
      checks: [{ rows: { min: 1 } }],
    }),
    breaks: () => ({ files: [], commands: [okCommand] }),
  },
  {
    id: 'wrong-cell',
    file: (rng, path) => {
      const days = between(rng, 2, 30);
      return {
        file: {
          path: `${path}.xlsx`,
          format: 'xlsx',
          data: {
            sheets: [
              {
                name: 'Rentals',
                rows: [
                  ['Bike', 'Days'],
                  ['Fern 3', days],
                ],
              },
            ],
          },
        },
        checks: [{ value: { sheet: 'Rentals', cell: 'B2', equals: days } }],
      };
    },
    breaks: (file) => {
      const data = structuredClone(file.data) as { sheets: { rows: unknown[][] }[] };
      const row = data.sheets[0]?.rows[1] as unknown[];
      row[1] = (row[1] as number) + 1;
      return { files: [{ ...file, data }], commands: [okCommand] };
    },
  },
  {
    id: 'missing-sheet',
    file: (_rng, path) => ({
      file: {
        path: `${path}.xlsx`,
        format: 'xlsx',
        data: {
          sheets: [
            { name: 'North', rows: [['Bike'], ['Fern 3']] },
            { name: 'South', rows: [['Bike'], ['Moss Cargo']] },
          ],
        },
      },
      checks: [{ sheets: ['North', 'South'] }],
    }),
    breaks: (file) => ({
      files: [{ ...file, data: { sheets: [(file.data as { sheets: unknown[] }).sheets[0]] } }],
      commands: [okCommand],
    }),
  },
  {
    id: 'page-count',
    file: (rng, path) => {
      const pages = between(rng, 2, 5);
      return {
        file: {
          path: `${path}.pdf`,
          format: 'pdf',
          data: { pages: Array.from({ length: pages }, (_, i) => `Page ${i + 1}`) },
        },
        checks: [{ page_count: pages }],
      };
    },
    breaks: (file) => ({
      files: [{ ...file, data: { pages: (file.data as { pages: string[] }).pages.slice(1) } }],
      commands: [okCommand],
    }),
  },
  {
    id: 'json-field',
    file: (rng, path) => {
      const days = between(rng, 2, 30);
      return {
        file: { path: `${path}.json`, format: 'json', data: { bike: 'Fern 3', days } },
        checks: [{ value: { path: 'days', equals: days } }],
      };
    },
    breaks: (file) => ({ files: [{ ...file, data: { bike: 'Fern 3' } }], commands: [okCommand] }),
  },
  {
    id: 'docx-text',
    file: (rng, path) => {
      const bike = pick(rng, SHOP.bikes);
      return {
        file: {
          path: `${path}.docx`,
          format: 'docx',
          data: { paragraphs: ['Rental note', `${bike} is booked.`] },
        },
        checks: [{ contains: `${bike} is booked` }],
      };
    },
    breaks: (file) => ({
      files: [{ ...file, data: { paragraphs: ['Rental note'] } }],
      commands: [okCommand],
    }),
  },
  {
    id: 'csv-column',
    file: (rng, path) => ({
      file: {
        path: `${path}.csv`,
        format: 'csv',
        data: [
          ['bike', 'days'],
          [pick(rng, SHOP.bikes), 4],
        ],
      },
      checks: [{ header: ['bike', 'days'] }],
    }),
    breaks: (file) => ({
      files: [{ ...file, data: [['bike', 'nights'], ...(file.data as unknown[][]).slice(1)] }],
      commands: [okCommand],
    }),
  },
  {
    id: 'extra-file',
    file: (rng, path) => ({
      file: {
        path: `${path}.csv`,
        format: 'csv',
        data: [
          ['bike', 'days'],
          [pick(rng, SHOP.bikes), 4],
        ],
      },
      checks: [{ rows: { min: 1 } }],
    }),
    breaks: (file) => ({
      files: [file, { path: `${file.path}.tmp`, format: 'txt', data: 'scratch' }],
      commands: [okCommand],
    }),
    expect: (file) => ({ workspace: { created: [file.path], others_untouched: true } }),
  },
  {
    id: 'wrong-path',
    file: (rng, path) => ({
      file: {
        path: `${path}.csv`,
        format: 'csv',
        data: [
          ['bike', 'days'],
          [pick(rng, SHOP.bikes), 4],
        ],
      },
      checks: [{ rows: { min: 1 } }],
    }),
    breaks: (file) => ({
      files: [{ ...file, path: file.path.replace('out/', 'tmp/') }],
      commands: [okCommand],
    }),
  },
];

/** A cause of a CODE symptom: how the reply and the commands read, and the blame the documented rules give. */
type Cause = {
  id: string;
  blame: Blame;
  reply(path: string): string;
  commands?: { command: string; exitCode: number }[];
  stderr?: string;
  runtime?: Action['runtime'];
  /** Files of the seeded workspace the agent rewrites or deletes, and the paths the block protects. */
  edits?: FileAction[];
  deletes?: string[];
  protects?: string[];
  /** The block's file is written right: the block fails on its skill expectation alone. */
  keepsFile?: boolean;
  /** The skill the block expects, `count` times when set, and how many times the agent loads it. */
  skill?: { count?: number; loads: number };
};

const CAUSES: Record<string, Cause> = {
  claim: { id: 'claim', blame: I3, reply: (path) => `Saved ${path}, done.` },
  'guard-caught': {
    id: 'guard-caught',
    blame: CAUGHT,
    reply: () => 'The check stopped me once, then I went on as it asked.',
    runtime: [
      { type: 'guard', name: 'read-before-edit', verdict: 'deny' },
      { type: 'guard', name: 'read-before-edit', verdict: 'pass' },
    ],
  },
  'protected-edit': {
    id: 'protected-edit',
    blame: I1,
    reply: () => 'I adjusted the input data so the numbers come out.',
    edits: [{ path: 'data/rentals.csv', format: 'txt', data: 'bike,days\nFern 3,40\n' }],
    protects: ['data/rentals.csv'],
  },
  'protected-delete': {
    id: 'protected-delete',
    blame: I1,
    reply: () => 'I removed the input file that was in the way.',
    deletes: ['data/rentals.csv'],
    protects: ['data/*.csv'],
  },
  honest: { id: 'honest', blame: NONE, reply: () => 'I could not get the numbers right, please check.' },
  timeout: {
    id: 'timeout',
    blame: ENV,
    reply: () => 'The build stopped early.',
    commands: [{ command: 'python make.py', exitCode: 1 }],
    stderr: 'error: ETIMEDOUT while fetching rates',
  },
  network: {
    id: 'network',
    blame: ENV,
    reply: () => 'The build stopped early.',
    commands: [{ command: 'python make.py', exitCode: 1 }],
    stderr: 'error: Could not resolve host: rates.larkspur.example',
  },
  package: {
    id: 'package',
    blame: ENV,
    reply: () => 'The build stopped early.',
    commands: [{ command: 'pip install larkspur-rates', exitCode: 1 }],
    stderr: 'ERROR: No matching distribution found for larkspur-rates',
  },
  sandbox: {
    id: 'sandbox',
    blame: ENV,
    reply: () => 'The build stopped early.',
    commands: [{ command: 'python make.py', exitCode: 1 }],
    stderr: 'PermissionError: [Errno 1] Operation not permitted',
  },
};

const SKILL_CAUSES: Record<string, Cause> = {
  unloaded: {
    id: 'unloaded',
    blame: UNDECIDED,
    reply: () => 'The file is written.',
    keepsFile: true,
    skill: { loads: 0 },
  },
  once: {
    id: 'once',
    blame: NONE,
    reply: () => 'The file is written.',
    keepsFile: true,
    skill: { count: 2, loads: 1 },
  },
  timeout: { ...(CAUSES.timeout as Cause), keepsFile: true, skill: { loads: 0 } },
  network: { ...(CAUSES.network as Cause), keepsFile: true, skill: { loads: 0 } },
  protected: {
    ...(CAUSES['protected-edit'] as Cause),
    id: 'protected',
    keepsFile: true,
    skill: { loads: 0 },
  },
};

/** Skill pairs: two code blocks fail the same skill expectation, for causes the policy order separates. */
const SKILL_PAIRS: { a: string; b: string; tier: Tier; cause: string }[] = [
  {
    a: 'unloaded',
    b: 'once',
    tier: 4,
    cause:
      'Blame names skill_not_loaded_undecided when the skill a failing check is about never loaded and nothing says whether its description covers the ask; a skill loaded, fewer times than expected, is no load failure and stays unassigned.',
  },
  ...['timeout', 'network'].map((b) => ({
    a: 'unloaded',
    b,
    tier: 4 as Tier,
    cause:
      'Blame names env_failure before any skill item for a failed command with an environment error, and skill_not_loaded_undecided for a skill that never loaded.',
  })),
  {
    a: 'protected',
    b: 'unloaded',
    tier: 5,
    cause:
      'Blame names I1_protected_edit before any skill item, and skill_not_loaded_undecided for a skill that never loaded with nothing else to blame.',
  },
];

function skillPairItems(): BankItem[] {
  const symptoms = ['missing-file', 'wrong-cell', 'page-count', 'json-field', 'docx-text', 'csv-column'];
  return SKILL_PAIRS.flatMap((pair) =>
    symptoms.map((symptomId) => {
      const symptom = SYMPTOMS.find((each) => each.id === symptomId) as Symptom;
      const a = SKILL_CAUSES[pair.a] as Cause;
      const b = SKILL_CAUSES[pair.b] as Cause;
      const id = `diagnostics/lookalike/code-skill/${symptomId}/${pair.a}-vs-${pair.b}`;
      return {
        id,
        family: 'diagnostics-lookalike-skill',
        tier: pair.tier,
        level: 5,
        component: 'packages/core/src/evidence/rule.ts',
        title: `two code blocks write their ${symptomId.replace(/-/g, ' ')} file right and fail the same skill expectation, one as ${pair.a}, one as ${pair.b}: blame names ${a.blame.item} and ${b.blame.item}`,
        cause: pair.cause,
        check: async ({ seed, scratch, product }) => planted(product, seed, scratch, id, symptom, [a, b]),
      };
    }),
  );
}

/** The pairs: a symptom with two causes the policy must separate. */
const PAIRS: { symptom: string; a: string; b: string; tier: Tier }[] = [
  ...[
    'missing-file',
    'wrong-cell',
    'missing-sheet',
    'page-count',
    'json-field',
    'docx-text',
    'csv-column',
  ].map((symptom) => ({ symptom, a: 'claim', b: 'honest', tier: 2 as Tier })),
  ...['timeout', 'network', 'package', 'sandbox'].map((b) => ({
    symptom: 'missing-file',
    a: 'claim',
    b,
    tier: 3 as Tier,
  })),
  ...['timeout', 'network', 'package', 'sandbox'].map((b) => ({
    symptom: 'wrong-cell',
    a: 'claim',
    b,
    tier: 4 as Tier,
  })),
  ...['timeout', 'sandbox'].map((b) => ({ symptom: 'page-count', a: 'honest', b, tier: 4 as Tier })),
  ...['network', 'package'].map((b) => ({ symptom: 'json-field', a: 'honest', b, tier: 4 as Tier })),
  ...['timeout', 'sandbox'].map((b) => ({ symptom: 'missing-sheet', a: 'claim', b, tier: 4 as Tier })),
  ...['network', 'package'].map((b) => ({ symptom: 'docx-text', a: 'claim', b, tier: 4 as Tier })),
  ...['timeout', 'network'].map((b) => ({ symptom: 'csv-column', a: 'honest', b, tier: 5 as Tier })),
  ...['extra-file', 'wrong-path'].map((symptom) => ({ symptom, a: 'claim', b: 'honest', tier: 3 as Tier })),
  // Integrity first: a changed or deleted protected file is the agent's fault before any claim or honest failure.
  ...[
    'missing-file',
    'wrong-cell',
    'missing-sheet',
    'page-count',
    'json-field',
    'docx-text',
    'csv-column',
  ].map((symptom) => ({ symptom, a: 'protected-edit', b: 'honest', tier: 4 as Tier })),
  ...['missing-file', 'wrong-cell', 'json-field', 'csv-column'].map((symptom) => ({
    symptom,
    a: 'protected-edit',
    b: 'claim',
    tier: 5 as Tier,
  })),
  ...[
    'missing-file',
    'wrong-cell',
    'missing-sheet',
    'page-count',
    'json-field',
    'docx-text',
    'csv-column',
  ].map((symptom) => ({ symptom, a: 'guard-caught', b: 'honest', tier: 4 as Tier })),
  ...['missing-file', 'wrong-cell', 'docx-text', 'page-count'].map((symptom) => ({
    symptom,
    a: 'protected-delete',
    b: 'honest',
    tier: 5 as Tier,
  })),
];

type Diagnosis = {
  verdictRef?: string;
  rule?: string;
  disposition?: string;
  fixAction?: string;
  inherits?: string;
};

/** The root diagnoses of a block: one per failing verdict that inherits no fault from another. */
function roots(
  block: { verdicts: { id: string; gating: boolean; outcome: string }[] } & { diagnoses?: Diagnosis[] },
): Diagnosis[] {
  return (block.diagnoses ?? []).filter((one) => one.inherits === undefined);
}

function blamed(
  blockId: string,
  block: Parameters<typeof roots>[0] | undefined,
  want: Blame,
  why: string,
): ItemResult | undefined {
  if (!block) return fail(`${blockId} should be in the run`);
  const failing = block.verdicts.filter((v) => v.gating && v.outcome !== 'pass');
  if (failing.length === 0) return fail(`${blockId} should fail (its planted fault: ${why}); it passed`);
  const found = roots(block);
  if (found.length === 0)
    return fail(`${blockId} should be blamed on ${want.item} (${why}); it has no diagnosis`);
  for (const one of found) {
    const item = (one.rule ?? '').split('#')[1];
    if (
      item !== want.item ||
      (want.disposition !== '' && one.disposition !== want.disposition) ||
      one.fixAction !== want.fixAction
    )
      return fail(
        `${blockId} should be blamed on ${want.item} (${want.disposition}, fix ${want.fixAction}): ${why}; got ${item} (${one.disposition}, fix ${one.fixAction}) on ${one.verdictRef}`,
      );
  }
  return undefined;
}

function codePairItems(): BankItem[] {
  return PAIRS.map((pair) => {
    const symptom = SYMPTOMS.find((each) => each.id === pair.symptom) as Symptom;
    const a = CAUSES[pair.a] as Cause;
    const b = CAUSES[pair.b] as Cause;
    const id = `diagnostics/lookalike/code/${pair.symptom}/${pair.a}-vs-${pair.b}`;
    return {
      id,
      family: 'diagnostics-lookalike',
      tier: pair.tier,
      level: 5,
      component: b.blame.item === 'env_failure' || a.blame.item === 'env_failure' ? EVIDENCE : ATTRIBUTE,
      title: `two code blocks fail the same way (${pair.symptom.replace(/-/g, ' ')}), one ${
        a.id === 'claim'
          ? 'behind a reply that claims success'
          : a.id.startsWith('protected')
            ? `after it ${a.id === 'protected-edit' ? 'changed' : 'deleted'} a protected input`
            : a.id === 'guard-caught'
              ? 'after a guard denied its act and it complied'
              : 'with an honest reply'
      }, one ${b.id === 'honest' ? 'with an honest reply' : b.id === 'claim' ? 'behind a reply that claims success' : `with a ${b.id} error`}: blame names ${a.blame.item} for the first and ${b.blame.item} for the second`,
      cause:
        a.blame === I1
          ? 'Blame names I1_protected_edit, before any other item, when a gating verdict fails and the net diff changed or deleted a path of expect.protected.'
          : a.blame === CAUGHT
            ? 'Blame names core_rule_caught when an enforcing guard denied the act and later allowed it, the agent having complied.'
            : b.id === 'honest'
              ? 'Blame names I3_false_claim when the reply claims done while the artifact check fails, and leaves an honest failure unassigned.'
              : `Blame names env_failure for a command that failed with a ${b.id} error, never the agent.`,
      check: async ({ seed, scratch, product }) => planted(product, seed, scratch, id, symptom, [a, b]),
    };
  });
}

async function planted(
  product: BlocksProduct,
  seed: number,
  scratch: string,
  id: string,
  symptom: Symptom,
  causes: Cause[],
): Promise<ItemResult> {
  const rng = rngFor(seed, id);
  const actions = new Map<string, Action>();
  const blocks: Record<string, unknown>[] = [];
  const ids: string[] = [];
  for (const [index, cause] of causes.entries()) {
    const marker = token(seed, `${id}#marker#${index}`, 8);
    const blockId = token(seed, `${id}#block#${index}`);
    ids.push(blockId);
    const { file, checks } = symptom.file(rng, `out/${token(seed, `${id}#file#${index}`)}`);
    const broken = cause.keepsFile ? { files: [file], commands: [okCommand] } : symptom.breaks(file);
    const skill = `s${token(seed, `${id}#skill#${index}`)}`;
    const runtime = [
      ...(cause.runtime ?? []),
      ...Array.from({ length: cause.skill?.loads ?? 0 }, () => ({ type: 'skill' as const, name: skill })),
      // The runtime reports a skills list: another skill loaded, so the expected one is absent, not unobserved.
      ...(cause.skill ? [{ type: 'skill' as const, name: `o${token(seed, `${id}#other#${index}`)}` }] : []),
    ];
    actions.set(marker, {
      reply: cause.reply(file.path),
      files: [...(broken.files ?? []), ...(cause.edits ?? [])],
      ...(cause.deletes ? { deletes: cause.deletes } : {}),
      ...(runtime.length > 0 ? { runtime } : {}),
      commands: cause.commands ?? broken.commands ?? [],
      ...(cause.stderr ? { stderr: cause.stderr } : {}),
    });
    blocks.push({
      id: blockId,
      user: `${marker} Write ${file.path} from data/rentals.csv.`,
      expect: {
        artifacts: [{ path: file.path, kind: file.format, checks }],
        ...(symptom.expect?.(file) ?? {}),
        ...(cause.protects ? { protected: cause.protects } : {}),
        ...(cause.skill
          ? {
              skills: [
                { name: skill, ...(cause.skill.count === undefined ? {} : { count: cause.skill.count }) },
              ],
            }
          : {}),
      },
    });
  }
  const raw: RawSpec = {
    id: `spec-${token(seed, `${id}#spec`)}`,
    kind: 'task',
    uses: { diagnostics: ['code-agent-liability'] },
    workspace_seed: { files: { 'data/rentals.csv': 'bike,days\nFern 3,4\n' } },
    blocks,
  };
  const agent = plantedAgent(product, 'code', actions, { scratch });
  const record = await run(product, raw, agent.adapter);
  for (const [index, cause] of causes.entries()) {
    const block = record.blocks.find((each) => each.blockId === ids[index]) as
      | Parameters<typeof roots>[0]
      | undefined;
    const why =
      cause.id === 'unloaded'
        ? 'the skill it was asked to use never loaded'
        : cause.id === 'once'
          ? 'it loaded the skill once where twice was expected'
          : cause.id === 'claim'
            ? 'its reply claims the file is saved'
            : cause.id.startsWith('protected')
              ? 'it changed or deleted a file the block protects'
              : cause.id === 'guard-caught'
                ? 'a guard denied its act, then allowed it once it complied'
                : cause.id === 'honest'
                  ? 'its reply admits the failure and no environment error shows'
                  : `its command failed with a ${cause.id} error and the reply claims nothing`;
    const problem = blamed(ids[index] as string, block, cause.blame, why);
    if (problem) return problem;
  }
  return PASS;
}

/** NORMAL pairs: a tool input value fails for two causes the provenance rules separate. */
const NORMAL_PAIRS: { id: string; tier: Tier; a: NormalCause; b: NormalCause }[] = [];

type NormalCause = {
  id: string;
  blame: Blame;
  why: string;
  /** The user's words, the value the agent wrote, and the tool's answer, from the gold value. */
  build(
    gold: string,
    rng: Rng,
  ): { user: string; value: string; error?: string; schema?: Record<string, unknown> };
};

const ALTERED: NormalCause = {
  id: 'altered',
  blame: R2,
  why: 'the agent changed the value the user gave',
  build: (gold) => ({
    user: `My email is ${gold}.`,
    value: `${gold}x`,
    error: 'no customer with that email',
  }),
};
const VERBATIM: NormalCause = {
  id: 'verbatim',
  blame: R3,
  why: "the agent copied the user's value verbatim and the tool, with no stated format, refused it",
  build: (gold) => ({
    user: `My email is ${gold.toUpperCase()}.`,
    value: gold.toUpperCase(),
    error: 'no customer with that email',
  }),
};
const ENUM: NormalCause = {
  id: 'enum',
  blame: R1,
  why: 'the agent wrote a value outside the enum the tool schema states',
  build: (gold) => ({
    user: `Book plan ${gold}.`,
    value: gold.toUpperCase(),
    schema: { type: 'object', properties: { email: { type: 'string', enum: [gold, `${gold}.alt`] } } },
  }),
};

const DERIVED: NormalCause = {
  id: 'derived',
  blame: R2B,
  why: 'the agent built the value itself, from nothing the user or a file gave, and it differs from gold',
  build: (gold) => ({
    user: 'Find the booking I made last week, please.',
    value: `${gold.split('@')[0]}-guess`,
    error: 'no booking with that reference',
  }),
};

NORMAL_PAIRS.push(
  { id: 'altered-vs-derived', tier: 5, a: ALTERED, b: DERIVED },
  { id: 'derived-vs-verbatim', tier: 5, a: DERIVED, b: VERBATIM },
  { id: 'altered-vs-verbatim', tier: 4, a: ALTERED, b: VERBATIM },
  { id: 'enum-vs-verbatim', tier: 5, a: ENUM, b: VERBATIM },
  { id: 'altered-vs-enum', tier: 5, a: ALTERED, b: ENUM },
);

function normalPairItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const pair of NORMAL_PAIRS) {
    for (const variant of ['email', 'code', 'name']) {
      const id = `diagnostics/lookalike/normal/${pair.id}/${variant}`;
      items.push({
        id,
        family: 'diagnostics-lookalike',
        tier: pair.tier,
        level: 5,
        component: VALUE_EVIDENCE,
        title: `two tool inputs fail the same value check (${variant}), one because ${pair.a.why}, one because ${pair.b.why}: blame names ${pair.a.blame.item} and ${pair.b.blame.item}`,
        cause: `Blame reads the value's source and change, and the tool's contract, from the run's value facts: it separates ${pair.a.id} (${pair.a.blame.item}) from ${pair.b.id} (${pair.b.blame.item}).`,
        check: async ({ seed, scratch, product }) => {
          const rng = rngFor(seed, id);
          const actions = new Map<string, Action>();
          const blocks: Record<string, unknown>[] = [];
          const ids: string[] = [];
          const schemas: Record<string, unknown> = {};
          for (const [index, cause] of [pair.a, pair.b].entries()) {
            const gold =
              variant === 'email'
                ? `${token(seed, `${id}#who#${index}`)}@larkspur.example`
                : variant === 'code'
                  ? `lk-${token(seed, `${id}#c#${index}`)}`
                  : `${pick(rng, SHOP.customers).toLowerCase().replace(' ', '.')}`;
            const built = cause.build(gold, rng);
            const marker = token(seed, `${id}#marker#${index}`, 8);
            const blockId = token(seed, `${id}#block#${index}`);
            ids.push(blockId);
            const tool = `customer.find${index}`;
            if (built.schema) schemas[tool] = built.schema;
            actions.set(marker, {
              reply: 'Let me look that up.',
              calls: [
                {
                  label: tool,
                  input: { email: built.value },
                  ...(built.error ? { error: built.error } : { output: { found: false } }),
                },
              ],
            });
            blocks.push({
              id: blockId,
              user: `${marker} ${built.user}`,
              expect: { tools: [{ label: tool, count: 1, input: { email: gold } }] },
            });
          }
          const raw: RawSpec = {
            id: `spec-${token(seed, `${id}#spec`)}`,
            channel: 'chat',
            uses: { diagnostics: ['code-agent-liability'] },
            ...(Object.keys(schemas).length > 0 ? { metadata: { tool_schemas: schemas } } : {}),
            blocks,
          };
          const agent = plantedAgent(product, 'normal', actions, { scratch });
          const record = await run(product, raw, agent.adapter);
          for (const [index, cause] of [pair.a, pair.b].entries()) {
            const block = record.blocks.find((each) => each.blockId === ids[index]) as
              | Parameters<typeof roots>[0]
              | undefined;
            const problem = blamed(ids[index] as string, block, cause.blame, cause.why);
            if (problem) return problem;
          }
          return PASS;
        },
      });
    }
  }
  return items;
}

/** The look-alike pairs of level 5. */
export function lookalikeItems(): BankItem[] {
  return [...codePairItems(), ...skillPairItems(), ...normalPairItems()];
}

export const LOOKALIKE_PAIRS = (): string[] => [
  ...PAIRS.map((p) => `${p.symptom}:${p.a}-vs-${p.b}`),
  ...NORMAL_PAIRS.map((p) => p.id),
];
