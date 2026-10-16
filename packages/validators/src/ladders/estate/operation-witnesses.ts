import vocabulary from '../../../fixtures/estate/operation-vocabulary.json';

export type OperationWitness = {
  id: string;
  label: string;
  input: Record<string, unknown>;
  class?: string;
  /** Removal/overwrite command detection is deliberately delegated to the diff when present. */
  needsNoDiff?: boolean;
};

/** The generated vocabulary is independent of product mutations. The test-side AST
 * extractor verifies its source hash and branch witnesses; the bank needs no compiler. */
export function operationWitnesses(): {
  harmful: OperationWitness[];
  benign: OperationWitness[];
  gaps: string[];
} {
  const harmful: OperationWitness[] = [];
  const benign: OperationWitness[] = [];
  const gaps: string[] = [...vocabulary.gaps];
  const title = (word: string) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`;
  const forms = (word: string) => [word, word.toUpperCase(), `fixture.${word}`, `fixture${title(word)}`];
  const nearWords = (word: string) =>
    [...new Set([`${word}extra`, `extra${word}`, word.slice(0, -1), word.slice(1)])].filter(Boolean);
  const readWords = new Set(vocabulary.readWords);
  const destructiveWords = new Set(vocabulary.toolWords.flatMap((entry) => entry.words));
  const orderVerbs = new Set(vocabulary.orderVerbs);
  const orderNouns = new Set(vocabulary.orderNouns);
  // This frozen vocabulary recognizer certifies controls independently of the product.
  // Read qualifiers are excluded here so they cannot mask an accidental alias match.
  const harmlessLabel = (label: string) => {
    const words = label
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    return (
      !words.some((word) => readWords.has(word) || destructiveWords.has(word)) &&
      !(words.some((word) => orderNouns.has(word)) && words.some((word) => orderVerbs.has(word)))
    );
  };
  const addHarmlessLabel = (id: string, label: string) => {
    if (harmlessLabel(label)) benign.push({ id, label, input: {} });
  };
  const commandRules = vocabulary.commandRules.map((rule) => ({
    ...rule,
    regex: new RegExp(rule.source, rule.flags),
  }));
  const harmlessCommand = (command: string, hasDiff: boolean) =>
    commandRules.every((rule) => {
      if (hasDiff && rule.needsNoDiff) return true;
      rule.regex.lastIndex = 0;
      return !rule.regex.test(command);
    });
  for (const entry of vocabulary.toolWords)
    for (const word of entry.words) {
      for (const [form, label] of forms(word).entries())
        harmful.push({ id: `tool.${entry.class}.${word}.${form}`, label, input: {}, class: entry.class });
      for (const near of nearWords(word)) addHarmlessLabel(`tool-near.${entry.class}.${word}.${near}`, near);
    }
  for (const verb of vocabulary.orderVerbs) addHarmlessLabel(`order-verb.${verb}`, verb);
  for (const noun of vocabulary.orderNouns) addHarmlessLabel(`order-noun.${noun}`, noun);
  for (const verb of vocabulary.orderVerbs)
    for (const noun of vocabulary.orderNouns) {
      for (const label of [`${verb}.${noun}`, `${noun}.${verb}`, `${verb}${title(noun)}`])
        harmful.push({
          id: `order.${verb}.${noun}.${label}`,
          label,
          input: {},
          class: vocabulary.orderClass,
        });
      for (const near of nearWords(verb))
        for (const label of [`${near}.${noun}`, `${noun}.${near}`, `${near}${title(noun)}`])
          addHarmlessLabel(`order-verb-near.${verb}.${noun}.${label}`, label);
      for (const near of nearWords(noun))
        for (const label of [`${verb}.${near}`, `${near}.${verb}`, `${verb}${title(near)}`])
          addHarmlessLabel(`order-noun-near.${verb}.${noun}.${label}`, label);
    }
  const representative = vocabulary.toolWords[0]?.words[0];
  if (representative)
    for (const read of vocabulary.readWords) {
      for (const label of [
        `${read}.${representative}`,
        `${representative}.${read}`,
        `${read}${title(representative)}`,
        `${representative}${title(read)}`,
      ])
        benign.push({ id: `read.${read}.${label}`, label, input: {} });
      for (const near of [`${read}extra`, `extra${read}`, read.slice(0, -1)])
        if (near !== '' && !vocabulary.readWords.includes(near))
          harmful.push({
            id: `read-near.${read}.${near}`,
            label: `${near}.${representative}`,
            input: {},
            class: vocabulary.toolWords[0]?.class,
          });
    }
  for (const [index, rule] of vocabulary.commandRules.entries())
    for (const [branch, command] of rule.witnesses.entries()) {
      harmful.push({
        id: `command.${index}.${branch}`,
        label: 'Bash',
        input: { command },
        class: rule.class,
        needsNoDiff: rule.needsNoDiff,
      });
      benign.push({
        id: `command-nonstring.${index}.${branch}`,
        label: 'Bash',
        input: { command: [command] },
        needsNoDiff: rule.needsNoDiff,
      });
      if (rule.needsNoDiff && harmlessCommand(command, true))
        benign.push({
          id: `command-with-diff.${index}.${branch}`,
          label: 'Bash',
          input: { command },
          needsNoDiff: false,
        });
      for (const [variant, altered] of [...new Set([command.toUpperCase(), command.toLowerCase()])].entries())
        if (harmlessCommand(altered, false))
          benign.push({
            id: `command-case.${index}.${branch}.${variant}`,
            label: 'Bash',
            input: { command: altered },
            needsNoDiff: true,
          });
    }
  const safeCommands = ['fixture', 'fixture command'].filter((command) => harmlessCommand(command, false));
  if (safeCommands.length === 0) gaps.push('command-controls:no-command-outside-source-regexes');
  for (const [index, command] of safeCommands.entries())
    benign.push({ id: `command-safe.${index}`, label: 'Bash', input: { command }, needsNoDiff: true });
  return { harmful, benign, gaps };
}
