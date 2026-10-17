import type { VariableStore } from '@agent-nexus/driftbench-space';
import { type View, type ViewOptions, viewOf } from './view';

/**
 * The rules of a store. A rule is a passage of the agent's own files, or a value that states where it applies.
 * The store never lists rules: they are read from what it keeps.
 *
 * - A passage is named by the ledger id of its quote, else by the file and the text of the quote with its white
 *   space folded. Every value, boundary and constraint that quotes it belongs to the rule; a constraint brings
 *   every variable it forbids.
 * - A value with `when` or `unless` brings the variables they name into the rule of the passages it quotes. With
 *   no quote of its own it is a rule by itself. A value with only a `polarity`, a `limit`, a `within` or a
 *   `priority` is a rule of its own variable.
 *
 * The variables of a rule are the planner's unit of strength: every triple of them is covered.
 */

export type StoreRule = {
  /** `rule.1`, `rule.2` ...: in the order the store first mentions the rules. */
  id: string;
  /** The passage the rule stands on, or the value that states it. */
  label: string;
  /** The ids of the variables the rule names, in the order of the store. */
  variables: string[];
};

const EXCERPT = 60;

const fold = (text: string) => text.replace(/\s+/g, ' ').trim();

type Quote = { path: string; quote: string; ledger?: string };

const quotesOf = (provenance: readonly { kind: string }[] | undefined): Quote[] =>
  (provenance ?? []).filter((entry): entry is Quote & { kind: 'quote' } => entry.kind === 'quote');

const passageKey = (quote: Quote) =>
  quote.ledger === undefined ? `quote:${quote.path}\n${fold(quote.quote)}` : `ledger:${quote.ledger}`;

const passageLabel = (quote: Quote) => {
  const text = fold(quote.quote);
  return `${quote.path}: ${text.length > EXCERPT ? `${text.slice(0, EXCERPT)}...` : text}`;
};

export type RuleOptions = ViewOptions;

export function storeRules(store: VariableStore, options: RuleOptions = {}): StoreRule[] {
  return rulesOfView(store, viewOf(store, options), options);
}

/** The rules over a view already built. */
export function rulesOfView(store: VariableStore, view: View, options: RuleOptions = {}): StoreRule[] {
  const approvedOnly = options.approvedOnly ?? true;
  const found = new Map<string, { label: string; variables: Set<string> }>();
  const add = (key: string, label: string, variables: Iterable<string>) => {
    let rule = found.get(key);
    if (!rule) {
      rule = { label, variables: new Set() };
      found.set(key, rule);
    }
    for (const variable of variables) if (view.variableIndex.has(variable)) rule.variables.add(variable);
  };
  for (const variable of store.variables) {
    if (!view.variableIndex.has(variable.id)) continue;
    const included = new Set(
      view.variables[view.variableIndex.get(variable.id) as number]?.values.map((v) => v.id),
    );
    for (const value of variable.values) {
      if (!included.has(value.id)) continue;
      const named = [...Object.keys(value.when ?? {}), ...Object.keys(value.unless ?? {})];
      const states =
        named.length > 0 ||
        value.polarity !== undefined ||
        value.limit !== undefined ||
        value.within !== undefined ||
        value.priority !== undefined;
      const quotes = quotesOf(value.provenance);
      for (const quote of quotes)
        add(passageKey(quote), passageLabel(quote), states ? [variable.id, ...named] : [variable.id]);
      if (states && quotes.length === 0)
        add(`value:${variable.id}.${value.id}`, `${variable.id}.${value.id}`, [variable.id, ...named]);
    }
    for (const boundary of variable.boundaries ?? [])
      for (const quote of quotesOf(boundary.provenance))
        add(passageKey(quote), passageLabel(quote), [variable.id]);
  }
  for (const constraint of store.constraints) {
    if (approvedOnly && !constraint.approved) continue;
    const forbidden = Object.entries(constraint.forbid);
    // A constraint that names a variable or a value outside the view is not part of it.
    if (
      !forbidden.every(([variable, value]) =>
        view.valueIndex[view.variableIndex.get(variable) ?? -1]?.has(value),
      )
    )
      continue;
    for (const quote of quotesOf(constraint.provenance))
      add(passageKey(quote), passageLabel(quote), Object.keys(constraint.forbid));
  }
  return [...found.values()].map((rule, at) => ({
    id: `rule.${at + 1}`,
    label: rule.label,
    variables: [...rule.variables].sort(
      (a, b) => (view.variableIndex.get(a) as number) - (view.variableIndex.get(b) as number),
    ),
  }));
}
