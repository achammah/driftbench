/**
 * A hand-written corpus of rule wordings and look-alikes in a fictional parcel depot, built from templates
 * and vocabulary so that no sentence is tuned to one input. It never reads a validator bank. Each item is a
 * block of markdown: positive when a reviewer would call it a rule that addresses the agent.
 */
export type CorpusItem = {
  cls: string;
  text: string;
  positive: boolean;
  /** Where the block lives, when not the main instruction file. */
  path?: string;
  /** Extra files the item needs beside it, by path. */
  files?: Record<string, string>;
  /** A proposal for this item is expected, but only as an unresolved fragment. */
  partial?: boolean;
};

const verbs: Array<[string, string, string, string]> = [
  // base, third person, gerund, past participle
  ['confirm', 'confirms', 'confirming', 'confirmed'],
  ['record', 'records', 'recording', 'recorded'],
  ['log', 'logs', 'logging', 'logged'],
  ['archive', 'archives', 'archiving', 'archived'],
  ['tag', 'tags', 'tagging', 'tagged'],
  ['weigh', 'weighs', 'weighing', 'weighed'],
  ['label', 'labels', 'labelling', 'labelled'],
  ['photograph', 'photographs', 'photographing', 'photographed'],
  ['escalate', 'escalates', 'escalating', 'escalated'],
  ['forward', 'forwards', 'forwarding', 'forwarded'],
  ['notify', 'notifies', 'notifying', 'notified'],
  ['verify', 'verifies', 'verifying', 'verified'],
  ['attach', 'attaches', 'attaching', 'attached'],
  ['route', 'routes', 'routing', 'routed'],
  ['flag', 'flags', 'flagging', 'flagged'],
  ['close', 'closes', 'closing', 'closed'],
];
const objects = [
  'the manifest',
  'the invoice',
  'the tracking number',
  'the customer note',
  'the depot ticket',
  'the pallet label',
  'the return slip',
  'the shipment photo',
  'the refund request',
  'the delivery window',
  'the carrier name',
  'the dock schedule',
];
const conditions = [
  'the customer asks',
  'a manager approves',
  'the carrier confirms',
  'two attempts have failed',
  'the depot is open',
  'the ticket is assigned',
];
const outputs = ['replies', 'responses', 'answers', 'summaries', 'messages', 'reports'];
const languages = ['French', 'Dutch', 'plain English', 'the customer’s language'];
const months = ['March', 'April', 'June', 'September'];

type Maker = (
  v: (typeof verbs)[number],
  o: string,
  w: (typeof verbs)[number],
  p: string,
  i: number,
) => string;
const cycle = (templates: Maker[], total: number): string[] =>
  Array.from({ length: total }, (_, index) => {
    const v = verbs[(index * 5 + 1) % verbs.length] as (typeof verbs)[number];
    const w = verbs[(index * 3 + 7) % verbs.length] as (typeof verbs)[number];
    const o = objects[(index * 7 + 2) % objects.length] as string;
    const p = objects[(index * 5 + 6) % objects.length] as string;
    return (templates[index % templates.length] as Maker)(v, o, w, p, index);
  });
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const imperatives: Maker[] = [
  (v, o) => `${capital(v[0])} ${o}.`,
  (v, o, w, p) => `${capital(v[0])} ${o} before you ${w[0]} ${p}.`,
  (_v, o) => `Keep ${o} short.`,
  (v, o) => `Remember to ${v[0]} ${o}.`,
  (v, o) => `Make sure ${o} is ${v[3]}.`,
  (v, o) => `Please ${v[0]} ${o}.`,
  (v, o) => `Ask before you ${v[0]} ${o}.`,
  (_v, o) => `Prefer short sentences when you describe ${o}.`,
  (_v, o) => `Avoid jargon in ${o}.`,
  (_v, o) => `Be concise when you quote ${o}.`,
  (v, o) => `Stop when ${o} is missing, then ${v[0]} it.`,
  (v, o) => `First ${v[0]} ${o}, then say so.`,
];
const outputStyle: Maker[] = [
  () => 'Answer in bullets.',
  (_v, _o, _w, _p, i) => `Reply in ${languages[i % languages.length]}.`,
  (_v, _o, _w, _p, i) => `Keep ${outputs[i % outputs.length]} under ${20 + i} words.`,
  (_v, _o, _w, _p, i) => `${capital(outputs[i % outputs.length] as string)} stay under ${30 + i} words.`,
  (_v, _o, _w, _p, i) => `${capital(outputs[i % outputs.length] as string)} use plain language.`,
  (_v, _o, _w, _p, i) => `Write ${outputs[i % outputs.length]} in the second person.`,
  (_v, _o, _w, _p, i) => `${capital(outputs[i % outputs.length] as string)} must end with a next step.`,
  (_v, _o, _w, _p, i) => `Limit ${outputs[i % outputs.length]} to ${2 + (i % 4)} sentences.`,
  (_v, _o, _w, _p, i) => `${capital(outputs[i % outputs.length] as string)} should cite their source.`,
  () => 'Each reply ends with a question.',
  () => 'Every response names the ticket it answers.',
  (_v, _o, _w, _p, i) => `Responses are limited to ${2 + (i % 5)} paragraphs.`,
];
const onlyWhen: Maker[] = [
  (v, o, _w, _p, i) => `Only ${v[0]} ${o} when ${conditions[i % conditions.length]}.`,
  (v, o, _w, _p, i) => `${capital(v[0])} ${o} only when ${conditions[i % conditions.length]}.`,
  (v, o, _w, _p, i) => `Only ${v[0]} ${o} if ${conditions[i % conditions.length]}.`,
  (v, o, _w, _p, i) => `Do not ${v[0]} ${o} unless ${conditions[i % conditions.length]}.`,
  (v, o, _w, _p, i) => `Never ${v[0]} ${o} until ${conditions[i % conditions.length]}.`,
  (v, o, _w, _p, i) => `Only when ${conditions[i % conditions.length]}, ${v[0]} ${o}.`,
  (v, o, _w, _p, i) => `You may ${v[0]} ${o} only after ${conditions[i % conditions.length]}.`,
  (v, o, _w, _p, i) => `${capital(v[0])} ${o} only after ${conditions[i % conditions.length]}.`,
  (v, o, _w, _p, i) => `${capital(v[0])} ${o} unless ${conditions[i % conditions.length]}.`,
  (v, o, _w, _p, i) => `Escalate only if ${conditions[i % conditions.length]}, and ${v[0]} ${o} first.`,
];
const normative: Maker[] = [
  (v, o) => `You must ${v[0]} ${o}.`,
  (v, o) => `The assistant must not ${v[0]} ${o}.`,
  (v, o) => `Never ${v[0]} ${o}.`,
  (v, o) => `Don’t ${v[0]} ${o}.`,
  (v, o) => `Do not ${v[0]} ${o}.`,
  (v, o, w, p) => `Before ${v[2]} ${o}, ${w[0]} ${p}.`,
  (v, o, w, p) => `${capital(v[0])} ${o} before ${w[2]} ${p}.`,
  (v, o) => `Always ${v[0]} ${o}.`,
  (v, o) => `${capital(o)} must be ${v[3]}.`,
  (v, o) => `The agent should ${v[0]} ${o}.`,
  (v, o) => `We never ${v[0]} ${o}.`,
  (v, o) => `You should always ${v[0]} ${o}.`,
  (v, o, _w, _p, i) => `If ${conditions[i % conditions.length]}, always ${v[0]} ${o}.`,
  (v, o, _w, _p, i) => `When ${conditions[i % conditions.length]}, never ${v[0]} ${o}.`,
  (_v, o) => `Summaries must include ${o}.`,
  (v, o) => `Tests must pass before you ${v[0]} ${o}.`,
  (v, o) => `The helper never ${v[1]} ${o} twice.`,
  (v, o) => `Every helper ${v[1]} ${o}.`,
  (v, o) => `The assistant always ${v[1]} ${o}.`,
  (v, o) => `You need to ${v[0]} ${o}.`,
  (v, o) => `Claude shall ${v[0]} ${o}.`,
];
/** A present passive or a plain statement of habit is a rule only inside a section that holds rules. */
const underRules: Maker[] = [
  (v, o) => `Every ticket is ${v[3]} by the end of the shift.`,
  (v, o) => `Each depot ${v[1]} ${o}.`,
  (v) => `Every parcel is ${v[3]} on arrival.`,
];

const descriptive: Maker[] = [
  (v, o) => `Each depot ${v[1]} ${o} at the dock.`,
  () => 'Every courier carries a scanner.',
  () => 'Each shipment gets a tracking number.',
  (v) => `Every pallet is ${v[3]} at the dock.`,
  (v, o) => `The depot never ${v[1]} ${o} on Sundays.`,
  (_v, _o, _w, _p, i) => `Each warehouse has ${3 + i} docks.`,
  (v) => `Every parcel is ${v[3]} on arrival.`,
  (v, o) => `The archive always keeps ${o}.`,
  (_v, o) => `Each region uses its own copy of ${o}.`,
  (v, o) => `Every night the system ${v[1]} ${o}.`,
  (_v, o) => `Each carrier sends ${o} by email.`,
  (v) => `The scanner never ${v[1]} a damaged label.`,
];
const history: Maker[] = [
  (v, o, _w, _p, i) => `2026-0${1 + (i % 9)}-1${i % 9}: The assistant must now ${v[0]} ${o}.`,
  (v, o) => `Added: never ${v[0]} ${o}.`,
  (v, o, _w, _p, i) => `Changed in v${2 + (i % 5)}.1: do not ${v[0]} ${o}.`,
  (v, o) => `Previously the assistant never ${v[1]} ${o}.`,
  (v, o) => `We used to always ${v[0]} ${o}.`,
  (v, o, _w, _p, i) => `In ${months[i % months.length]} the team decided that agents must ${v[0]} ${o}.`,
  (v, o) => `The old rule was to always ${v[0]} ${o}.`,
  (v, o) => `Last sprint we agreed that you must ${v[0]} ${o}.`,
  (v, o) => `Fixed ${o}: the assistant no longer needs to ${v[0]} it.`,
  (v, o, _w, _p, i) => `- ${months[i % months.length]} ${1 + i}: Never ${v[0]} ${o} (added after the audit).`,
  (v, o) => `Removed the rule that said you must ${v[0]} ${o}.`,
  (v, o) => `Earlier versions of this guide told the assistant to ${v[0]} ${o}.`,
];
const thirdParty: Maker[] = [
  (v, o) => `Users must ${v[0]} ${o} before ordering.`,
  (v, o) => `Customers must ${v[0]} ${o} within a week.`,
  (v, o) => `Drivers must ${v[0]} ${o} at the dock.`,
  (v, o) => `Suppliers should ${v[0]} ${o}.`,
  (v, o) => `Their policy says never ${v[0]} ${o}.`,
  (v, o) => `The vendor requires that invoices must be ${v[3]}.`,
  (v, o) => `The contract says suppliers must ${v[0]} ${o}.`,
  (v, o) => `Maria says the vendor must ${v[0]} ${o}.`,
  (v, o) => `Visitors never ${v[0]} ${o}.`,
  (v, o) => `The client wants us to ${v[0]} ${o}, and they must sign.`,
  (v, o) => `Residents must ${v[0]} ${o} by Friday.`,
  (v, o) => `Our partner insists that carriers must ${v[0]} ${o}.`,
];
const hypotheticals: Maker[] = [
  (v, o) => `If you never ${v[0]} ${o}, the parcel is lost.`,
  (v, o) => `When you don’t ${v[0]} ${o}, delays follow.`,
  (v, o) => `If the agent never ${v[1]} ${o}, the run fails.`,
  (v, o) => `Because the assistant never ${v[1]} ${o}, errors repeat.`,
  (v, o) => `If nobody must ${v[0]} ${o}, nothing happens.`,
  (v, o) => `Should the agent never ${v[0]} ${o}, the queue grows.`,
  (v, o) => `A team that never ${v[1]} ${o} loses trust.`,
  (v, o) => `Whenever you don’t ${v[0]} ${o}, the next shift pays for it.`,
  (v, o) => `Once the assistant has to ${v[0]} ${o} twice, the cost doubles.`,
  (v, o) => `Even if the helper never ${v[1]} ${o}, the system continues.`,
];
const quotes: Maker[] = [
  (v, o) => `«Never ${v[0]} ${o}»`,
  (v, o) => `The note read «always ${v[0]} ${o}».`,
  (v, o) => `„Immer ${v[0]} ${o}“ stood on the wall.`,
  (v, o) => `User: Never ${v[0]} ${o}.`,
  (v, o) => `Customer: You must ${v[0]} ${o}!`,
  (v, o) => `> Do not ${v[0]} ${o}.`,
  (v, o) => `The sign says "do not ${v[0]} ${o}" in red letters.`,
  (v, o) => `He shouted ‘you must ${v[0]} ${o}’ twice.`,
  (v, o) => `Assistant: I will never ${v[0]} ${o}.`,
];
const wrongExamples: Maker[] = [
  (v, o) => `✗ Never ${v[0]} ${o}.`,
  (v, o) => `**Wrong:** Always skip ${o}.`,
  (v, o) => `Bad: ${capital(v[0])} ${o} after closing.`,
  (v, o) => `Incorrect: you must ${v[0]} ${o} twice.`,
  (v, o) => `❌ Do not ${v[0]} ${o}`,
  (v, o) => `- WRONG: ${capital(v[0])} ${o} without asking.`,
  (v, o) =>
    `## Anti-patterns\n\nAlways ${v[0]} ${o} twice.\n\nNever ask the customer.\n\n## Back to the notes`,
  (v, o) => `### Common mistakes (wrong)\n\n- You must ${v[0]} ${o} at night.\n\n### Next`,
];
const structuralDecoys: Maker[] = [
  (v, o) =>
    `## Examples\n\nThe assistant must ${v[0]} ${o}.\n\nNever answer the customer.\n\n## Back to the notes`,
  (v, o) => `### Sample answers\n\nAlways ${v[0]} ${o}.\n\n### Next`,
  (v, o) => `> The courier must ${v[0]} ${o}.`,
  (v, o) => `Must the courier ${v[0]} ${o}?`,
  (v, o) => `Should the assistant never ${v[0]} ${o}?`,
  (v, o) => `# Never ${v[0]} ${o}`,
  (v, o) => `Always ${v[0]} ${o}\n====================`,
  (v, o) => `\`\`\`text\nThe assistant must ${v[0]} ${o}.\nAlways overwrite the file.\n\`\`\``,
  (v, o) => `~~~\nNever ${v[0]} ${o}.\n~~~`,
  (v, o) => `Action | Meaning\n--- | ---\nNever ${v[0]} ${o} | Example only`,
  (v, o) => `The word must marks an obligation when ${o} is ${v[3]}.`,
  (v, o) => `<!-- Never ${v[0]} ${o}. -->`,
  (v, o) => `    Never ${v[0]} ${o}.`,
];
const twoWords: Maker[] = [
  (v) => `${capital(v[0])} it.`,
  (v) => `${capital(v[0])} tickets.`,
  (v) => `${capital(v[0])} them.`,
  (v) => `${capital(v[0])} parcels.`,
  (v) => `${capital(v[0])} this.`,
];
const fragments: Maker[] = [
  () => 'Do not write it.',
  () => 'Never skip them.',
  () => 'Always keep this.',
  (v) => `Don’t ${v[0]} those.`,
  () => 'You must not touch it.',
];

const items = (
  cls: string,
  texts: string[],
  positive: boolean,
  extra: Partial<CorpusItem> = {},
): CorpusItem[] => texts.map((text) => ({ cls, text, positive, ...extra }));

export function buildCorpus(perClass = 36): CorpusItem[] {
  const out: CorpusItem[] = [];
  out.push(...items('imperative', cycle(imperatives, perClass), true));
  out.push(...items('output-style', cycle(outputStyle, perClass), true));
  out.push(...items('only-when', cycle(onlyWhen, perClass), true));
  out.push(...items('modal-never-before', cycle(normative, perClass), true));
  out.push(
    ...cycle(underRules, 12).map(
      (text): CorpusItem => ({
        cls: 'habit-in-rules-section',
        text: `## Rules\n\n${text}\n\n## Background`,
        positive: true,
      }),
    ),
  );
  out.push(...items('fragment', cycle(fragments, 10), true, { partial: true }));
  out.push(...items('two-word', cycle(twoWords, 10), false));
  out.push(...items('descriptive', cycle(descriptive, perClass), false));
  out.push(...items('history', cycle(history, perClass), false));
  out.push(...items('third-party', cycle(thirdParty, perClass), false));
  out.push(...items('hypothetical', cycle(hypotheticals, perClass), false));
  out.push(...items('quote', cycle(quotes, perClass), false));
  out.push(...items('wrong-example', cycle(wrongExamples, perClass), false));
  out.push(...items('structure', cycle(structuralDecoys, perClass), false));
  // Third-party and generated documentation: structure, not a name list, marks it as someone else's.
  const vendorRules = 'Callers must pass a token. Never reuse a handle. Always close the stream.';
  out.push(
    {
      cls: 'vendored',
      positive: false,
      text: 'unused',
      path: '.claude/skills/depot/vendor/netlib/README.md',
      files: { '.claude/skills/depot/vendor/netlib/README.md': `# Netlib\n\n${vendorRules}\n` },
    },
    {
      cls: 'vendored',
      positive: false,
      text: 'unused',
      path: '.claude/skills/depot/third_party/clip/NOTES.md',
      files: { '.claude/skills/depot/third_party/clip/NOTES.md': `# Clip\n\n${vendorRules}\n` },
    },
    {
      cls: 'vendored',
      positive: false,
      text: 'unused',
      path: '.claude/skills/depot/types/index.d.ts',
      files: {
        '.claude/skills/depot/types/index.d.ts': `/**\n * Callers must pass a token.\n * Never reuse a handle.\n */\nexport declare function open(token: string): void;\n`,
      },
    },
    {
      cls: 'vendored',
      positive: false,
      text: 'unused',
      path: '.claude/skills/depot/lib/sdk/GUIDE.md',
      files: {
        '.claude/skills/depot/lib/sdk/package.json': '{"name":"sdk","version":"3.1.0"}\n',
        '.claude/skills/depot/lib/sdk/GUIDE.md': `# SDK guide\n\n${vendorRules}\n`,
      },
    },
    {
      cls: 'vendored',
      positive: false,
      text: 'unused',
      path: '.claude/skills/depot/api/client.md',
      files: {
        '.claude/skills/depot/api/client.md': `<!-- @generated by the schema tool; do not edit -->\n\n# Client\n\n${vendorRules}\n`,
      },
    },
  );
  // Documents a tool printed: a build-output folder, a run log, terminal escapes.
  const logLines = Array.from({ length: 30 }, (_, line) =>
    line % 6 === 5
      ? 'WARN: Never reuse a handle between runs.'
      : `10:11:${10 + line} step ${line} finished in ${line}ms.`,
  ).join('\n\n');
  const logPath = '.claude/skills/depot/references/run-log.md';
  out.push(
    {
      cls: 'build-output',
      positive: false,
      text: 'unused',
      path: '.claude/skills/depot/dist/report.md',
      files: { '.claude/skills/depot/dist/report.md': `# Report\n\n${vendorRules}\n` },
    },
    {
      cls: 'build-output',
      positive: false,
      text: 'unused',
      path: '.claude/skills/depot/coverage/summary.md',
      files: {
        '.claude/skills/depot/coverage/summary.md': `# Coverage\n\nNever skip a branch. ${vendorRules}\n`,
      },
    },
    {
      cls: 'build-output',
      positive: false,
      text: 'unused',
      path: logPath,
      files: { [logPath]: `# Run\n\n${logLines}\n` },
    },
    {
      cls: 'build-output',
      positive: false,
      text: 'unused',
      path: '.claude/skills/depot/references/colour.md',
      files: {
        '.claude/skills/depot/references/colour.md': `\u001b[31mError:\u001b[0m you must pass a token.\n`,
      },
    },
  );
  return out;
}
