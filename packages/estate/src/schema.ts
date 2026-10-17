import { z } from 'zod';

/**
 * The estate contract (design note of 2026-10-11, "Testing a code-interpreter agent: the estate design").
 * An estate is everything that specifies a code-interpreter agent's behaviour: standing instructions, skills,
 * subagents, guards, tools, settings, stages, output rules, the runtime's hazards and the estate's own invariants.
 * Each place that specifies behaviour is an atom with a quote and a hash. Atoms and edges form the estate graph.
 * A plan is derived from the approved map by code; tests are generated from the plan. Nothing here names a runtime:
 * Claude Code and Nexus are adapters that read their own files into these shapes.
 */

export const AtomKind = z.enum([
  'instruction',
  'gate',
  'route',
  'skill',
  'reference',
  'script',
  'subagent',
  'guard',
  'tool',
  'setting',
  'stage',
  'register',
  'hazard',
  'invariant',
]);
export type AtomKind = z.infer<typeof AtomKind>;

/** Where an atom comes from: the file, the line span, the exact quote and its hash. */
export const Provenance = z.strictObject({
  file: z.string().min(1).describe('Path relative to the estate root'),
  startLine: z.number().int().min(1).describe('First line of the quote in the file, counted from 1.'),
  endLine: z.number().int().min(1).describe('Last line of the quote in the file, counted from 1.'),
  quote: z.string().min(1).describe('The exact text the atom is read from'),
  hash: z
    .string()
    .min(1)
    .describe('SHA-256 of the quote, the file and the span; a change here is a changed atom'),
});
export type Provenance = z.infer<typeof Provenance>;

/** What a trace shows when the atom is obeyed. Every form maps to an existing check of the checks package. */
export const EvidencePredicate = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('skill_loaded').describe('This form holds when the named skill loads in the block.'),
    name: z.string().min(1).describe('The skill name the trace records on its load.'),
    min: z.number().int().min(1).optional().describe('The fewest loads that count; defaults to 1.'),
  }),
  z.strictObject({
    type: z
      .literal('skill_not_loaded')
      .describe('This form holds when the named skill never loads in the block.'),
    name: z.string().min(1).describe('The skill name that must not load.'),
  }),
  z.strictObject({
    type: z
      .literal('guard')
      .describe('This form holds when the named guard records a decision in the trace.'),
    name: z
      .string()
      .min(1)
      .describe('The guard name its decision records carry, such as its script file name.'),
    verdict: z.string().min(1).optional().describe('Without it, any verdict counts, as in the guards check'),
    min: z.number().int().min(0).optional().describe('The fewest decisions that count; defaults to 1.'),
  }),
  z.strictObject({
    type: z.literal('tool_called').describe('This form holds when the agent calls the tool.'),
    label: z.string().min(1).describe('The tool label as the trace records it, such as Read or Bash.'),
    input: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Input fields one call must match; without it, any call of the tool counts.'),
    min: z.number().int().min(1).optional().describe('The fewest matching calls that count; defaults to 1.'),
  }),
  z.strictObject({
    type: z.literal('tool_not_called').describe('This form holds when the agent never calls the tool.'),
    label: z.string().min(1).describe('The tool label that must not appear in the trace.'),
    input: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Only forbid calls matching these input assertions; without it, forbid every call.'),
  }),
  z.strictObject({
    type: z.literal('reference_not_read').describe('No successful read of this path or glob in the block.'),
    path: z.string().min(1).describe('The path or glob of the reference that must not be read.'),
  }),
  z.strictObject({
    type: z.literal('subagent_not_dispatched').describe('No dispatch of this helper in the block.'),
    name: z.string().min(1).describe('The name of the helper that must not be dispatched.'),
  }),
  z.strictObject({
    type: z.literal('guard_not_fired').describe('No firing of this guard in the block.'),
    name: z.string().min(1).describe('The name of the guard that must not fire.'),
    verdict: z
      .string()
      .min(1)
      .optional()
      .describe('Only forbid this verdict; without it, forbid every firing.'),
  }),
  z.strictObject({
    type: z.literal('stage_not_reached').describe('This stage never appears in the block.'),
    name: z.string().min(1).describe('The name of the stage that must not be reached.'),
  }),
  z.strictObject({
    type: z
      .literal('artifact_not_created')
      .describe('The workspace diff lists no creation of this path or glob.'),
    path: z.string().min(1).describe('The path or glob that must not be created.'),
  }),
  z.strictObject({
    type: z
      .literal('file_not_written')
      .describe('The workspace diff lists no creation or change of this path or glob.'),
    path: z.string().min(1).describe('The path or glob that must not be created or changed.'),
  }),
  z.strictObject({
    type: z
      .literal('ordered')
      .describe('This form holds when the before act comes earlier than the after act.'),
    before: z.string().min(1).describe('A tool label, a skill name or a stage name'),
    after: z.string().min(1).describe('A tool label, a skill name or a stage name that must come second.'),
  }),
  z.strictObject({
    type: z.literal('stage_reached').describe('This form holds when the run reaches the named stage.'),
    name: z.string().min(1).describe('The stage name from the step list of the estate.'),
  }),
  z.strictObject({
    type: z.literal('workspace').describe('This form holds when the workspace changes as listed.'),
    created: z.array(z.string()).optional().describe('Paths the run creates in the workspace.'),
    changed: z.array(z.string()).optional().describe('Paths the run changes in the workspace.'),
    deleted: z.array(z.string()).optional().describe('Paths the run deletes from the workspace.'),
    othersUntouched: z.boolean().optional().describe('When true, every path not listed stays untouched.'),
  }),
  z.strictObject({
    type: z.literal('artifact').describe('This form holds when the run produces a file at the path.'),
    path: z.string().min(1).describe('Workspace path of the produced file.'),
    kind: z
      .string()
      .optional()
      .describe(
        'File kind: xlsx, docx, pptx, pdf, csv, json, text or code; the generator drops any other value.',
      ),
  }),
  z.strictObject({
    type: z
      .literal('text')
      .describe('This form holds when the reply text meets its word and language rules.'),
    must: z.array(z.string()).optional().describe('Literal words the reply must contain.'),
    mustNot: z.array(z.string()).optional().describe('Literal words the reply must not contain.'),
    lang: z.string().optional().describe('Language tag the reply is written in, such as EN.'),
  }),
  z.strictObject({
    type: z
      .literal('static')
      .describe('This form holds when a property of the estate files holds, with no run.'),
    check: z.string().min(1).describe('A property of the estate files, no run'),
  }),
  z.strictObject({
    type: z
      .literal('custom')
      .describe('This form names a check that decides the evidence, run by code or judged.'),
    name: z.string().min(1).describe('The check name, such as ordered, max_words or grounded_values.'),
    options: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Options passed to the named check, such as a word limit.'),
  }),
]);
export type EvidencePredicate = z.infer<typeof EvidencePredicate>;

export const Atom = z.strictObject({
  id: z.string().min(1).describe('Stable id: kind, file and a slug of the quote'),
  kind: AtomKind.describe('The kind of place the atom comes from, which sets its mandatory test types.'),
  title: z.string().min(1).describe('One line in plain words'),
  provenance: Provenance.describe('Where the atom is read from: file, line span, quote and hash.'),
  producedBy: z
    .enum(['code', 'model'])
    .describe(
      'Code when read from file structure and approved as read; model when split from prose by a model.',
    ),
  role: z
    .enum(['axis', 'detail'])
    .default('axis')
    .describe('Axis puts the atom in the space map as a target; detail keeps it for the generator only.'),
  approved: z
    .boolean()
    .default(false)
    .describe('Whether the atom is approved; only approved atoms enter the space map and the plan.'),
  situation: z.string().optional().describe('When the atom applies, in words; empty means always'),
  evidence: z
    .array(EvidencePredicate)
    .min(1)
    .describe('What a trace shows when the atom is obeyed, as at least one typed predicate.'),
  enforcement: z
    .array(z.string())
    .default([])
    .describe('Ids of guards or tests that already check it; empty means trusted'),
  fields: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Kind-specific structure read by code: a guard event, a tool schema, a brief field list'),
});
export type Atom = z.infer<typeof Atom>;

export const EdgeKind = z.enum([
  'route',
  'reference',
  'script',
  'dispatch',
  'enforces',
  'event',
  'allows',
  'next',
  'cites',
]);
export const Edge = z.strictObject({
  from: z.string().min(1).describe('Id of the atom the edge starts at.'),
  to: z.string().min(1).describe('Id of the atom the edge ends at, or an event node on an event edge.'),
  kind: EdgeKind.describe('The relation the edge states, such as route, reference or dispatch.'),
});
export type Edge = z.infer<typeof Edge>;

/** Authority is independent of runtime file kind and atom axis/detail role. */
export const DocumentRole = z.enum([
  'normative',
  'changelog',
  'history',
  'template',
  'example',
  'journal',
  'fixture',
  'archive',
]);
export type DocumentRole = z.infer<typeof DocumentRole>;
export const DocumentInfo = z.strictObject({
  path: z.string().min(1).describe('Path of the document, relative to the estate root.'),
  role: DocumentRole.describe(
    'The authority of the document as a whole, from its folder, headings and entries.',
  ),
  reasons: z
    .array(z.string().min(1))
    .min(1)
    .describe('What the classification read: the folder, the heading or the entries that gave the role.'),
  sections: z
    .array(
      z.strictObject({
        startLine: z.number().int().min(1).describe('First line of the section, counted from 1.'),
        endLine: z.number().int().min(1).describe('Last line of the section, counted from 1.'),
        role: DocumentRole.describe('The role of this section, which differs from the role of the document.'),
      }),
    )
    .optional()
    .describe('Spans of a live document that carry a non-normative role, such as an example or a history.'),
});
export type DocumentInfo = z.infer<typeof DocumentInfo>;

export const EstateMap = z.strictObject({
  version: z.literal(1).describe('Map format version, always 1.'),
  runtime: z.string().min(1).describe('The adapter that read the estate: claude-code, nexus, ...'),
  root: z
    .string()
    .min(1)
    .describe('The estate root, as given; never an absolute private path in a committed file'),
  readAt: z.string().min(1).describe('ISO time the scan read the estate.'),
  documents: z
    .array(DocumentInfo)
    .optional()
    .describe('Document authority and non-normative line spans; absent in older maps.'),
  atoms: z.array(Atom).describe('Every atom the scan read from the estate.'),
  edges: z.array(Edge).describe('The edges of the estate graph, decided by code.'),
  space: z.string().optional().describe('Path of the exported space map of the situation axes'),
  ignore: z
    .array(z.string().min(1))
    .optional()
    .describe('Globs the scan skipped beside the runtime defaults; lint reads the estate with them again'),
  userSkills: z
    .literal(true)
    .optional()
    .describe(
      'true when the scan read a user-level skill layer; lint then needs the folder to read it again',
    ),
  followedLinks: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Links, relative to the estate root, that the scan read through to a real path outside the root',
    ),
  producedBy: z
    .strictObject({
      family: z.string().min(1).describe('The model family that split the prose, `code` when no model ran'),
      model: z
        .string()
        .min(1)
        .describe('The model that split the prose, or unknown when the model port names none.'),
      at: z.iso.datetime().describe('ISO time of the scan, the same as readAt.'),
    })
    .optional()
    .describe('Who proposed the model atoms; code atoms say producedBy: code on the atom itself'),
  hash: z.string().min(1).describe('SHA-256 over the sorted atom hashes and edges'),
});
export type EstateMap = z.infer<typeof EstateMap>;

export const TestType = z.enum([
  'obligation',
  'outside_trigger',
  'twin',
  'ordered_pair',
  'skip_pressure',
  'route_positive',
  'route_near_miss',
  'misroute',
  'read_when',
  'script_fixture',
  'dispatch',
  'contract_alone',
  'stop_resume',
  'guard_positive',
  'guard_negative',
  'guard_hostile',
  'guard_speed',
  'guard_register',
  'tool_boundary',
  'tool_denied',
  'tool_deferred',
  'stage_order',
  'stage_skip',
  'stage_anytime',
  'register_sample',
  'hazard_recovery',
  'invariant',
  'setting',
  'journey',
]);
export type TestType = z.infer<typeof TestType>;

export const RunMode = z.enum(['replay', 'unit', 'live']);

export const PlanRow = z.strictObject({
  id: z
    .string()
    .min(1)
    .describe('Row id: test type and atom id for a contract row, journey.N or pairwise.N otherwise.'),
  atomIds: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      'Atoms the row exercises: the atom under test, then its skill or helper; a journey lists its path in order.',
    ),
  cell: z.record(z.string(), z.string()).describe('Dimension id to value id on the situation axes'),
  testType: TestType.describe('The test type the row asks for.'),
  mode: RunMode.describe('How the row runs: replay, unit or live, set by its test type.'),
  status: z
    .enum(['proposed', 'approved', 'struck'])
    .default('proposed')
    .describe('Proposed until a person approves or strikes the row; generate skips struck rows.'),
  weight: z
    .number()
    .nonnegative()
    .default(1)
    .describe('The share of the run budget the row gets, edited by hand.'),
  note: z.string().optional().describe('What the row checks, in plain words.'),
});
export type PlanRow = z.infer<typeof PlanRow>;

export const Plan = z.strictObject({
  version: z.literal(1).describe('Plan format version, always 1.'),
  mapHash: z.string().min(1).describe('Hash of the approved map the plan was derived from.'),
  spaceHash: z.string().optional().describe('Content hash of the space map the plan used.'),
  rows: z.array(PlanRow).describe('The rows from the contract, the journeys and the pairwise cells.'),
  summary: z
    .strictObject({
      cells: z
        .number()
        .int()
        .min(0)
        .describe('Distinct pairs of the atoms of a row and its situation values.'),
      coveringArraySize: z.number().int().min(0).describe('Rows of the pairwise covering array.'),
      perKind: z
        .record(z.string(), z.number().int().min(0))
        .describe('Contract rows per atom kind, a row counted once for each kind it names.'),
      perTestType: z
        .record(z.string(), z.number().int().min(0))
        .describe('Rows per test type across contract, journey and pairwise rows.'),
      unenforcedAtoms: z
        .array(z.string())
        .describe('Ids of approved instruction, gate and register atoms that no guard enforces.'),
      cellsWithoutPhrase: z
        .number()
        .int()
        .min(0)
        .describe('Cells with no approved phrase; the plan reads no phrase bank, so it equals cells.'),
      edgesWithoutJourney: z.number().int().min(0).describe('Journey edges that no journey takes.'),
    })
    .describe('Counts and lists that describe the plan.'),
});
export type Plan = z.infer<typeof Plan>;
