import { z } from 'zod';

/**
 * The object model of the rules framework. Every tailorable rule set (a policy, a check set, a diagnostic, a
 * persona) is an object: a kind, an id, an optional parent it `extends`, and items, each one addressable rule.
 * A user never edits a shipped object: they write one that extends it and lists item operations. Every key
 * below is optional or required as written, and none carries a default value, so an absent key never enters a
 * hash: a spec without `uses` hashes and caches exactly as before.
 */

/** Where an object or an item operation comes from, weakest first. A stronger layer wins. */
export const Layer = z.enum(['shipped', 'project', 'suite', 'spec', 'block', 'cli']);
export type Layer = z.infer<typeof Layer>;

/** The layers in precedence order, weakest first. */
export const LAYERS: readonly Layer[] = Layer.options;

/** An object kind: `policy/blame`, `check-set`, `diagnostic`. Lower case, one optional `/` group. */
export const ObjectKind = z
  .string()
  .regex(/^[a-z][a-z0-9-]*(\/[a-z][a-z0-9-]*)?$/, 'expected a kind such as policy/blame or check-set');
export type ObjectKind = z.infer<typeof ObjectKind>;

/** An object id, unique within its kind and its layer: `default`, `acme`, `judge/default`. */
export const ObjectId = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/,
    'expected an id of letters, digits, dots, underscores, hyphens and / groups',
  );
export type ObjectId = z.infer<typeof ObjectId>;

/** An item id, stable within its object; a verdict cites it: `R3`, `rung4_exact`, `tools`. */
export const ItemId = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
    'expected an item id of letters, digits, dots, underscores and hyphens',
  );
export type ItemId = z.infer<typeof ItemId>;

/** The implementation an item names: a builtin of a driftbench package, or one a plugin registered. */
export const ImplRef = z.string().regex(/^(builtin|plugin):\S+$/, 'expected builtin:<name> or plugin:<name>');
export type ImplRef = z.infer<typeof ImplRef>;

/** A map of named values: an item's condition, its effect or its parameters. */
const Fields = z.record(z.string(), z.unknown());

/**
 * Where an item applies: a scope, never a link. With it, the item fires only when the evidence names one of its
 * skills, one of its tools (the label of the failing call) or a unit matching one of its unit patterns (`*` matches
 * any run of characters, such as `R#41/*`); the scope is checked before `when`. Absent: everywhere.
 */
export const AppliesTo = z
  .strictObject({
    skills: z.array(z.string().min(1)).optional().describe('Skill names the evidence must name one of.'),
    tools: z.array(z.string().min(1)).optional().describe('Tool labels the failing call must have one of.'),
    units: z
      .array(z.string().min(1))
      .optional()
      .describe('Unit patterns, such as R#41/*, a unit must match one of.'),
  })
  .describe('Where an item applies: skills, tools or unit patterns. Absent means everywhere.');
export type AppliesTo = z.infer<typeof AppliesTo>;

/** One rule, as a root object defines it: a title and an implementation, with its condition and parameters. */
export const Item = z
  .strictObject({
    id: ItemId.describe('The item id, unique in the object.'),
    title: z.string().min(1).describe('What the rule does, in one line.'),
    enabled: z
      .boolean()
      .optional()
      .describe('false keeps the item in the object but out of every run. Absent means true.'),
    when: Fields.optional().describe('The condition, over named evidence, under which the rule fires.'),
    effect: Fields.optional().describe('What the rule does when it fires.'),
    params: Fields.optional().describe("Typed parameters, checked against the implementation's schema."),
    impl: ImplRef.describe('The implementation: builtin:<name> or plugin:<name>.'),
    cites: z.string().optional().describe('A source for the reader.'),
    applies_to: AppliesTo.optional().describe('Where the rule applies; absent means everywhere.'),
  })
  .describe('One rule of a root object.');
export type Item = z.infer<typeof Item>;

/**
 * One operation on an item of the parent, in an object that `extends` another. With the id of a parent item it
 * sets the fields it names (params merge: maps merge, lists replace, `+key` appends, `-key` removes). With
 * `add: true` it adds a new item and needs title, when, effect and impl. `before` or `after` moves the item.
 */
export const ItemPatch = z
  .strictObject({
    id: ItemId.describe("The item to change, or with add: true the new item's id."),
    add: z.literal(true).optional().describe('Adds a new item. Needs title, when, effect and impl.'),
    title: z.string().min(1).optional().describe('A new title for the item.'),
    enabled: z.boolean().optional().describe('false disables the item, true enables it again.'),
    when: Fields.optional().describe('Condition fields to set; maps merge, lists replace.'),
    effect: Fields.optional().describe('Effect fields to set; maps merge, lists replace.'),
    params: Fields.optional().describe(
      'Params to set: maps merge, lists replace, +key appends, -key removes.',
    ),
    impl: ImplRef.optional().describe('Another implementation for the same rule.'),
    cites: z.string().optional().describe('A source for the reader.'),
    applies_to: AppliesTo.optional().describe('Where the rule applies: maps merge, lists replace.'),
    before: ItemId.optional().describe('Moves the item just before this one.'),
    after: ItemId.optional().describe('Moves the item just after this one.'),
  })
  .describe('An operation on one item of the parent object, or a new item with add: true.');
export type ItemPatch = z.infer<typeof ItemPatch>;

/** The header every object file carries, whatever its kind. */
export const Envelope = z.strictObject({
  kind: ObjectKind.describe('The kind: policy/value-check, policy/blame, check-set, diagnostic, ...'),
  id: ObjectId.describe('The id, unique within the kind and the layer.'),
  version: z
    .union([z.string(), z.number()])
    .optional()
    .describe('A free label. The content hash, not this label, is the identity.'),
  extends: ObjectId.nullable()
    .optional()
    .describe('The object of the same kind this one extends; null or absent for a root.'),
  description: z.string().optional().describe('What the object is for.'),
  params: Fields.optional().describe('Object-level parameters shared by the items.'),
  order: z
    .array(ItemId)
    .optional()
    .describe('The item order: every enabled item once. A file uses order or item moves, not both.'),
});
export type Envelope = z.infer<typeof Envelope>;

/**
 * An object file: the envelope and its items. A root object lists full items; an object that extends another
 * lists item operations. A kind may declare more top-level fields (a diagnostic's `scope` and `reads`); the
 * resolver checks them against the kind.
 */
export const ItemFile = Envelope.extend({
  items: z.array(ItemPatch).optional().describe('The items, or the operations on the parent items.'),
}).describe('One object file.');
export type ItemFile = z.infer<typeof ItemFile>;

/**
 * A reference from a spec or a block to an object of the kind its key names: an id, or an inline object that
 * extends one, written where it applies (the spec or the block layer).
 */
export const ObjectRef = z.union([
  ObjectId,
  z
    .strictObject({
      extends: ObjectId.describe('The object this inline one extends.'),
      items: z.array(ItemPatch).optional().describe('Operations on the parent items.'),
      order: z.array(ItemId).optional().describe('The item order.'),
      params: Fields.optional().describe('Object-level parameters.'),
    })
    .describe('An inline object that extends another, for one spec or one block.'),
]);
export type ObjectRef = z.infer<typeof ObjectRef>;

/**
 * The objects a spec or a block uses, by role. Every key is optional and has no default: a spec without `uses`
 * parses, hashes and caches exactly as before. A block's key replaces the spec's key of the same name. Every
 * kind `uses` names is scoring-only, so `uses` stays out of the block cache key and the re-judge compatibility
 * hash: changing it re-scores stored observations and never reruns the agent. An agent-facing kind (a persona,
 * a run profile) never gets a key here.
 */
export const Uses = z
  .strictObject({
    value_check: ObjectRef.optional().describe(
      'policy/value-check: how a value the agent wrote is compared.',
    ),
    blame: ObjectRef.optional().describe('policy/blame: who a failure is attributed to.'),
    placement: ObjectRef.optional().describe('policy/placement: where a fix goes.'),
    links: ObjectRef.optional().describe('policy/links: how blocks link to prompt units.'),
    selection: ObjectRef.optional().describe('policy/selection: which blocks a change selects.'),
    gating: ObjectRef.optional().describe('policy/gating: what not_run, blocked and inconclusive do to ci.'),
    stats: ObjectRef.optional().describe('policy/stats: which interval is the headline.'),
    check_set: ObjectRef.optional().describe('check-set: the machine checks and their order.'),
    judges: ObjectRef.optional().describe('judge-council: the judges, their mode and assignment.'),
    diagnostics: z.array(ObjectId).optional().describe('The diagnostic objects that run after the checks.'),
  })
  .describe('The objects this spec or block uses. Absent keys use the shipped defaults.');
export type Uses = z.infer<typeof Uses>;

/** The object kind each `uses` key refers to. */
export const USES_KINDS = {
  value_check: 'policy/value-check',
  blame: 'policy/blame',
  placement: 'policy/placement',
  links: 'policy/links',
  selection: 'policy/selection',
  gating: 'policy/gating',
  stats: 'policy/stats',
  check_set: 'check-set',
  judges: 'judge-council',
  diagnostics: 'diagnostic',
} as const satisfies Record<keyof Uses, string>;
