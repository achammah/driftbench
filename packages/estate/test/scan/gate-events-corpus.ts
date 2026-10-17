// Hand-written sentence shapes for read-before rules. Each shape is crossed with events and files that
// are not taken from any validator bank. A positive names the reads its sentence requires; a control must
// give no gate.
export type GateLine = { line: string; reads: string[] };

/** Things a read can come before: quantified events, ordinal events and the agent's own first action. */
export const EVENTS = [
  'any export',
  'each rollout',
  'every migration',
  'another sync',
  'all uploads',
  'the first import',
  'the second render',
  'the 3rd upload',
  'the next merge',
  'the last step',
  'your first action',
  'your next reply',
];

/** Acts the reader already handled: they must stay gates. */
export const ACTS = ['editing the index', 'you run the migration', 'sending a reply', 'committing'];

const FILES = ['`guide.md`', 'rules.md', '`docs/field notes.md`'];
const name = (file: string) => file.replace(/`/g, '');

type Shape = (event: string, a: string, b: string, c: string) => { line: string; count: 1 | 2 | 3 };

const shapes: Shape[] = [
  (e, a) => ({ line: `Before ${e}: Read ${a}`, count: 1 }),
  (e, a) => ({ line: `Before ${e}: Read ${a} FULLY`, count: 1 }),
  (e, a) => ({ line: `Before ${e}, read ${a}.`, count: 1 }),
  (e, a) => ({ line: `Before ${e} read ${a}.`, count: 1 }),
  (e, a) => ({ line: `Prior to ${e}, read ${a}.`, count: 1 }),
  (e, a) => ({ line: `Prior to ${e}: read ${a} FULLY.`, count: 1 }),
  (e, a) => ({ line: `Read ${a} before ${e}.`, count: 1 }),
  (e, a) => ({ line: `Read ${a} BEFORE ${e}.`, count: 1 }),
  (e, a) => ({ line: `Read ${a} FULLY before ${e}.`, count: 1 }),
  (e, a) => ({ line: `Read FULLY ${a} before ${e}.`, count: 1 }),
  (e, a) => ({ line: `Read ${a} first, before ${e}.`, count: 1 }),
  (e, a) => ({ line: `Read ${a} FIRST before ${e}.`, count: 1 }),
  (e, a) => ({ line: `Read ${a} prior to ${e}.`, count: 1 }),
  (e, a) => ({ line: `!! Before ${e}: Read ${a} !!`, count: 1 }),
  (e, a) => ({ line: `Always read ${a} before ${e}.`, count: 1 }),
  (e, a) => ({ line: `You must read ${a} before ${e}.`, count: 1 }),
  (e, a) => ({ line: `Please read ${a} FIRST, before ${e}.`, count: 1 }),
  (e, a) => ({ line: `**Before ${e}**: read ${a}.`, count: 1 }),
  (e, a) => ({ line: `R12. Before ${e}: Read ${a}.`, count: 1 }),
  (e, a) => ({ line: `If the ask touches billing, read ${a} before ${e}.`, count: 1 }),
  (e, a, b) => ({ line: `Read ${a} BEFORE ${e}, and with it ${b}.`, count: 2 }),
  (e, a, b) => ({ line: `Read ${a} and ${b} before ${e}.`, count: 2 }),
  (e, a, b, c) => ({ line: `Read ${a}, ${b} and ${c} before ${e}.`, count: 3 }),
  (e, a, b) => ({ line: `Before ${e}: Read ${a} plus ${b}.`, count: 2 }),
  (e, a, b) => ({ line: `Before ${e}, read both ${a} and ${b}.`, count: 2 }),
  (e, a, b) => ({ line: `Read ${a} before ${e}; plus ${b}.`, count: 2 }),
  (e, a, b) => ({ line: `Read ${a} before ${e}, together with ${b}.`, count: 2 }),
  (e, a, b) => ({ line: `Read ${a} before ${e}, as well as ${b}.`, count: 2 }),
  (e, a, b) => ({ line: `Read ${a} before ${e}, along with ${b}.`, count: 2 }),
];

/** The positive lines: every shape crossed with every event, files rotated so the reads vary. */
export function positives(events: readonly string[] = EVENTS): GateLine[] {
  const lines: GateLine[] = [];
  const seen = new Set<string>();
  events.forEach((event, e) => {
    shapes.forEach((shape, s) => {
      const files = [0, 1, 2].map((offset) => FILES[(e + s + offset) % FILES.length] ?? '');
      const [a = '', b = '', c = ''] = files;
      const { line, count } = shape(event, a, b, c);
      if (seen.has(line)) return;
      seen.add(line);
      lines.push({ line, reads: files.slice(0, count).map(name) });
    });
  });
  return lines;
}

/** Sentences the same words can form that give no ordering rule. */
const controlShapes: Array<(event: string, a: string) => string> = [
  (e, a) => `Do not read ${a} before ${e}.`,
  (e, a) => `Never read ${a} before ${e}.`,
  (e, a) => `Before ${e}, do not read ${a}.`,
  (e, a) => `Before ${e}: never read ${a}.`,
  (e, a) => `Optionally, read ${a} before ${e}.`,
  (e, a) => `If you read ${a} before ${e}, report it.`,
  (e, a) => `You need not read ${a} before ${e}.`,
  (e, a) => `Should the agent read ${a} before ${e}?`,
  (e, a) => `Why read ${a} before ${e}?`,
  (e, a) => `For example: Before ${e}, read ${a}.`,
  (e, a) => `For example, before ${e} read ${a}.`,
  (e, a) => `e.g. read ${a} before ${e}.`,
  (e, a) => `The sample is \`Before ${e} read ${a}\`.`,
  (e, a) => `The note says "Read ${a} before ${e}."`,
  (e, a) => `2025-11-03: Before ${e}, read ${a}.`,
  (e, a) => `2025-11-03 Read ${a} before ${e}.`,
  (e, a) => `Previously the estate said to read ${a} before ${e}.`,
  (e, a) => `We used to read ${a} before ${e}.`,
  (e, a) => `Added: read ${a} before ${e} (added 2026-01-12).`,
  (e, a) => `Changed: the agent no longer reads ${a} before ${e}.`,
  (e, a) => `The day before ${e}, read ${a}.`,
  (e, a) => `Two hours before ${e}, read ${a}.`,
  (e, a) => `Same as before: read ${a}. (${e})`,
  (_e, a) => `Read ${a} as before.`,
  (_e, a) => `Read ${a} the day before.`,
  (_e, a) => `Read ${a} before that change.`,
  (_e, a) => `Read ${a} before lunch.`,
  (_e, a) => `Read ${a} before 9 in the morning.`,
  (_e, a) => `Read ${a} before the audit last year.`,
  (_e, a) => `Read ${a} before this release.`,
  (e, a) => `${a} was read before ${e}.`,
];

export function controls(events: readonly string[] = EVENTS.slice(0, 5)): string[] {
  const lines = new Set<string>();
  events.forEach((event, e) => {
    controlShapes.forEach((shape, s) => {
      lines.add(shape(event, FILES[(e + s) % FILES.length] ?? ''));
    });
  });
  return [...lines];
}

/** The acts handled before: every shape with an act in place of an event stays a gate. */
export function actPositives(): GateLine[] {
  const lines: GateLine[] = [];
  ACTS.forEach((act, e) => {
    for (const [s, shape] of shapes.entries()) {
      const files = [0, 1, 2].map((offset) => FILES[(e + s + offset) % FILES.length] ?? '');
      const [a = '', b = '', c = ''] = files;
      const { line, count } = shape(act, a, b, c);
      lines.push({ line, reads: files.slice(0, count).map(name) });
    }
  });
  return lines;
}
