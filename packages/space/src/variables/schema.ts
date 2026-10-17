import { z } from 'zod';
import { DimensionKind, SpaceId } from '../schema';

/**
 * The variable store: one catalogue of the variables a situation varies on, shared by the prompt-agent map and
 * the estate map. A variable has values; a value, a boundary and an impossible combination each keep where they
 * come from (a quote of the agent's own files, the counts of past conversations, or the owner's words). The
 * space map is a view of it: the approved axes, with their values, weights and constraints.
 */

/** The longest quote or statement a provenance entry holds. It names a passage, not a file. */
export const MAX_PROVENANCE_TEXT = 1000;

const NOT_RELATIVE =
  'expected a relative path with forward slashes: no leading /, no ~, no scheme or drive letter such as file: or C:';

/** A path inside a repository or an estate: relative, written with forward slashes. */
export const SourcePath = z
  .string()
  .min(1)
  .refine(
    (path) =>
      !path.startsWith('/') &&
      !path.startsWith('~') &&
      !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(path) &&
      !path.includes('\\'),
    { error: NOT_RELATIVE },
  )
  .describe('A path relative to the folder of the store file, written with forward slashes.');

/** The identity of a prose atom: 10 characters of the base32 alphabet, written in lower case. */
export const LedgerId = z
  .string()
  .regex(/^[a-z2-7]{10}$/, { error: 'expected a ledger id: 10 characters, a to z and 2 to 7' })
  .describe('The ledger id of a prose atom: 10 base32 characters, a to z and 2 to 7.');

const blank = (text: string) => text.trim() === '';

export const QuoteProvenance = z
  .strictObject({
    kind: z.literal('quote').describe('The entry stands on text copied from a file.'),
    path: SourcePath.describe('The file the quote is copied from, relative to the folder of the store file.'),
    quote: z
      .string()
      .max(MAX_PROVENANCE_TEXT, { error: `a quote is at most ${MAX_PROVENANCE_TEXT} characters` })
      .refine((quote) => !blank(quote), { error: 'the quote is missing: copy the source text' })
      .describe('Text copied word for word from the file: it justifies the entry.'),
    ledger: LedgerId.optional().describe('The ledger id of the prose atom the quote belongs to.'),
  })
  .describe("A quote of the agent's own files.");
export type QuoteProvenance = z.infer<typeof QuoteProvenance>;

export const ConversationsProvenance = z
  .strictObject({
    kind: z.literal('conversations').describe('The entry stands on counts from past conversations.'),
    count: z
      .number()
      .int()
      .min(0)
      .describe('How many of the conversations show the value. Counts only: no text and no id is kept.'),
    total: z.number().int().min(1).describe('How many conversations were read.'),
    set_hash: z
      .string()
      .regex(/^[0-9a-f]{64}$/, { error: 'expected a SHA-256: 64 lowercase hexadecimal characters' })
      .describe('A SHA-256 of the private set of conversations. The set itself never enters the store.'),
  })
  .refine((entry) => entry.count <= entry.total, { path: ['count'], error: 'count is at most total' })
  .describe(
    'How often past conversations show a value. The conversations stay private; only counts are kept.',
  );
export type ConversationsProvenance = z.infer<typeof ConversationsProvenance>;

export const OwnerProvenance = z
  .strictObject({
    kind: z.literal('owner').describe('The entry stands on what the owner said.'),
    words: z
      .string()
      .max(MAX_PROVENANCE_TEXT, { error: `the owner's words are at most ${MAX_PROVENANCE_TEXT} characters` })
      .refine((words) => !blank(words), { error: "the owner's words are missing" })
      .describe('What the owner said, in their own words.'),
    date: z.iso.date().describe('The day the owner said it, as YYYY-MM-DD.'),
  })
  .describe('What the owner said, and when.');
export type OwnerProvenance = z.infer<typeof OwnerProvenance>;

export const VariableProvenance = z
  .discriminatedUnion('kind', [QuoteProvenance, ConversationsProvenance, OwnerProvenance])
  .describe("Where an entry comes from: a quote, the counts of past conversations, or the owner's words.");
export type VariableProvenance = z.infer<typeof VariableProvenance>;

const Provenance = z
  .array(VariableProvenance)
  .optional()
  .describe(
    'Where the entry comes from: any number of quotes, conversation counts and owner statements. A converted space map has none.',
  );

export const VariableRole = z
  .enum(['axis', 'detail'])
  .describe(
    'axis: a dimension of the space map, crossed with the other axes. detail: varied inside a cell, as boundary values.',
  );
export type VariableRole = z.infer<typeof VariableRole>;

export const VariableOrigin = z
  .enum(['code', 'model', 'owner'])
  .describe('Who wrote the entry: code reading structure, a model reading prose, or the owner.');
export type VariableOrigin = z.infer<typeof VariableOrigin>;

const When = z
  .record(SpaceId, z.array(SpaceId).min(1))
  .describe('The values the entry applies to, per variable: { coverage_result: [fiber, 5g-only] }.');

export const VariableValue = z
  .strictObject({
    id: SpaceId.describe('The value id, unique among the values of its variable.'),
    title: z.string().min(1).describe('What the value means, in plain words.'),
    weight: z
      .number()
      .min(0)
      .optional()
      .describe(
        'The share of users with this value, relative to the other values of the variable. Give it to every value of the variable or to none.',
      ),
    required: z
      .boolean()
      .optional()
      .describe(
        'True when a test plan must include the value. The required values of all axes combine into required cells.',
      ),
    approved: z
      .boolean()
      .optional()
      .describe('Overrides the flag of the variable for this value. Absent: the value inherits it.'),
    produced_by: VariableOrigin.optional(),
    provenance: Provenance,
    polarity: z
      .enum(['must', 'must_not'])
      .optional()
      .describe('Whether the agent must or must not do what a rule says.'),
    when: When.optional().describe('The cell a rule applies in.'),
    unless: When.optional().describe('The cell a rule does not hold in.'),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('The most times the action may happen in a conversation.'),
    within: z
      .strictObject({
        minutes: z.number().positive().describe('The number of minutes the action has to happen in.'),
      })
      .optional()
      .describe('The time within which the action happens.'),
    priority: z.literal('first').optional().describe('The rule comes first when rules collide.'),
  })
  .describe('One value of a variable.');
export type VariableValue = z.infer<typeof VariableValue>;

export const BoundaryComparison = z
  .enum(['lt', 'le', 'gt', 'ge'])
  .describe(
    'How the quantity is compared with the limit for the condition to hold: lt (under), le (at most), gt (more than), ge (at least).',
  );
export type BoundaryComparison = z.infer<typeof BoundaryComparison>;

export const VariableBoundary = z
  .strictObject({
    holds: SpaceId.describe('The value on the side where the condition holds.'),
    fails: SpaceId.describe(
      'The value on the side where the condition does not hold. Not the value of holds.',
    ),
    edge: SpaceId.describe(
      'The value at the limit itself. It is a third value, or the value of the side the limit falls on.',
    ),
    limit: z.number().optional().describe('The limit of the condition, such as 2 in "more than two days".'),
    comparison: BoundaryComparison.optional(),
    unit: z.string().min(1).optional().describe('The unit of the limit, such as days. Needs a limit.'),
    provenance: Provenance,
  })
  .superRefine((boundary, ctx) => {
    if ((boundary.limit === undefined) !== (boundary.comparison === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: [boundary.limit === undefined ? 'limit' : 'comparison'],
        message: 'limit and comparison go together: give both or neither',
      });
    }
    if (boundary.unit !== undefined && boundary.limit === undefined) {
      ctx.addIssue({ code: 'custom', path: ['unit'], message: 'a unit needs a limit' });
    }
  })
  .describe('The edge of a condition: its two sides and the value at the limit.');
export type VariableBoundary = z.infer<typeof VariableBoundary>;

export const Variable = z
  .strictObject({
    id: SpaceId.describe('The variable id. Constraints, conditions and boundaries name it.'),
    title: z.string().min(1).describe('What the variable varies on.'),
    kind: DimensionKind,
    role: VariableRole,
    approved: z.boolean().describe('The approval of the variable and of every value without its own flag.'),
    produced_by: VariableOrigin.optional(),
    provenance: Provenance,
    values: z
      .array(VariableValue)
      .min(1)
      .describe('The values, in the order reports list them. At least one.'),
    boundaries: z
      .array(VariableBoundary)
      .optional()
      .describe('The edges of the conditions that name this variable.'),
  })
  .describe('One variable a situation varies on, with its values.');
export type Variable = z.infer<typeof Variable>;

export const VariableConstraint = z
  .strictObject({
    forbid: z
      .record(z.string(), z.string())
      .describe(
        'A partial cell, as variable id to value id. Every cell holding all of these values is impossible. Two entries make a pair.',
      ),
    reason: z.string().min(1).describe('Why these values never occur together.'),
    approved: z.boolean().describe('False until a person approves the combination.'),
    produced_by: VariableOrigin.optional(),
    provenance: Provenance,
  })
  .describe('An impossible combination of values, with its reason.');
export type VariableConstraint = z.infer<typeof VariableConstraint>;

export const VariablePrior = z
  .strictObject({
    kind: z
      .enum(['declared', 'fitted'])
      .describe(
        'declared: the owner wrote the weights. fitted: they were fitted from consented conversations.',
      ),
    source: z
      .string()
      .min(1)
      .optional()
      .describe('Where the weights come from. Required for a fitted prior.'),
  })
  .describe('How the weights of the values were set.');
export type VariablePrior = z.infer<typeof VariablePrior>;

export const VariableStore = z
  .strictObject({
    format: z.literal(1).describe('The version of the file format, 1.'),
    agent: z.string().min(1).describe('The agent the store describes.'),
    version: z.string().min(1).describe('A label for this version of the store.'),
    inventory: z
      .string()
      .min(1)
      .optional()
      .describe(
        'The behaviour inventory, as a path relative to this file. Its required flow deviations become required cells.',
      ),
    prior: VariablePrior.default({ kind: 'declared' }),
    variables: z
      .array(Variable)
      .min(1)
      .describe('The variables, in the order reports list them. At least one.'),
    constraints: z
      .array(VariableConstraint)
      .default([])
      .describe('The impossible combinations. Absent or empty: every combination can occur.'),
  })
  .describe('The variables of a situation space, their values, and the combinations that cannot occur.');
export type VariableStore = z.infer<typeof VariableStore>;
