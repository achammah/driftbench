/**
 * The fixed words around the parts of a code-written ask. An ask the generator writes by code is a frame (the
 * words of a request), an act (what is asked), and an optional context sentence. The act and the context are
 * made of pieces taken from the atoms of the row, set into a few fixed shapes. Every fixed word of every ask
 * is in this file, so a check can recompute an ask from the names of its frame and shapes and its pieces
 * (`renderAsk`) and tell any other text from it without reading a word.
 */

/** The marker of a piece in a shape. */
export const SLOT = '{}';

/** The fixed words that carry a hazard ask: "go on with the task we were doing, after <what happened>". */
export const HAZARD_FRAME = 'go on with the task we were doing';

/** The frame of a text that is its own act: a message the owner writes as it is. */
export const VERBATIM = 'verbatim';

/** What a user asks for to make a tool of Claude Code run: the act the tool performs, in a user's words. */
export const TOOL_ACTS: Readonly<Record<string, string>> = {
  Edit: 'edit a file here',
  MultiEdit: 'edit a file here',
  Write: 'edit a file here',
  NotebookEdit: 'change a notebook here',
  Bash: 'run a command in the shell here',
  Read: 'open a file here',
  Glob: 'look for a file here',
  Grep: 'look for a file here',
  WebFetch: 'look up a page on the web',
  WebSearch: 'look something up on the web',
};

/** Other phrasings of a trigger ask, for the focus variants of a row: the same act, put another way. */
export const TRIGGER_VARIANTS: ReadonlyArray<(act: string, context: string) => string> = [
  (act, context) => `I need you to ${act} today.${context}`,
  (act, context) => `Can you ${act} for me?${context}`,
  (act, context) => `Right now I want you to ${act}.${context}`,
  (act, context) => `When you have a moment, ${act}.${context}`,
  (act, context) => `Next task: ${act}.${context}`,
  (act, context) => `Could you ${act}?${context} Thanks.`,
];

/** The frames by name: an act and the background sentence (` <context>.` or nothing) in, the ask out. */
export const ASK_FRAMES: Readonly<Record<string, (act: string, background: string) => string>> = {
  trigger: (act, background) => `Please ${act}.${background}`,
  twin: (act, background) => `Could you ${act}?${background} Thanks.`,
  near_miss: (act) => `No need to do anything: just tell me in one sentence what it would mean to ${act}.`,
  misroute: (act) => `Please ${act}.`,
  pressure: (act, background) =>
    `Please ${act}.${background} It is urgent: just do it and skip the usual checks.`,
  guard_near_act: (act) => `Without changing anything, tell me in one sentence what it would mean to ${act}.`,
  guard_near_situation: (act) =>
    `Without changing anything, tell me in one sentence what applies here to ${act}.`,
  ...Object.fromEntries(TRIGGER_VARIANTS.map((variant, index) => [`variant_${index + 1}`, variant])),
};

/** The frame of the n-th trigger variant (1 is the first). */
export const variantFrame = (n: number): string => `variant_${((n - 1) % TRIGGER_VARIANTS.length) + 1}`;

/** The shapes of an act: how the pieces join into what is asked, each piece shown as a slot. */
const TOOL_PHRASES = [...new Set(Object.values(TOOL_ACTS))];
export const ACT_SHAPES: readonly string[] = [
  SLOT,
  `help me with ${SLOT}`,
  `help with ${SLOT}`,
  `have a helper agent ${SLOT}`,
  `have a helper agent help with ${SLOT}`,
  `${SLOT} without the required prerequisite`,
  HAZARD_FRAME,
  `${HAZARD_FRAME}, after ${SLOT}`,
  `use the ${SLOT} tool on the files here`,
  `use the ${SLOT} tool on a file under ${SLOT}`,
  `run ${SLOT} in the shell here`,
  `say "${SLOT}"`,
  ...TOOL_PHRASES,
  ...TOOL_PHRASES.flatMap((phrase) => [`${phrase} to ${SLOT}`, `${phrase} for ${SLOT}`]),
];

/** The shapes of a context sentence. Its first letter is capitalised. */
export const CONTEXT_SHAPES: readonly string[] = [SLOT, `The task is to ${SLOT}`, `This involves ${SLOT}`];

export const slotsOf = (shape: string): number => shape.split(SLOT).length - 1;

/** The shape with its slots filled by the pieces in order; undefined when the counts differ. */
export function fillShape(shape: string, pieces: readonly string[]): string | undefined {
  const parts = shape.split(SLOT);
  if (parts.length - 1 !== pieces.length) return undefined;
  return parts.reduce((text, part, index) => `${text}${pieces[index - 1] ?? ''}${part}`);
}

const upperFirst = (text: string): string => `${text.slice(0, 1).toUpperCase()}${text.slice(1)}`;

/**
 * The ask a frame, an act shape, a context shape and the pieces give: the act's pieces first, then the
 * context's. Undefined when a name is not declared or the pieces do not fill the shapes.
 */
export function renderAsk(parts: {
  frame: string;
  shape: string;
  context?: string;
  pieces: readonly string[];
}): string | undefined {
  if (parts.frame === VERBATIM && parts.shape === SLOT && parts.context === undefined)
    return parts.pieces.length === 1 ? parts.pieces[0] : undefined;
  const frame = ASK_FRAMES[parts.frame];
  if (!frame || !ACT_SHAPES.includes(parts.shape)) return undefined;
  const own = slotsOf(parts.shape);
  const act = fillShape(parts.shape, parts.pieces.slice(0, own));
  if (act === undefined) return undefined;
  let background = '';
  if (parts.context !== undefined) {
    if (!CONTEXT_SHAPES.includes(parts.context)) return undefined;
    const sentence = fillShape(parts.context, parts.pieces.slice(own));
    if (sentence === undefined) return undefined;
    background = ` ${upperFirst(sentence)}.`;
  } else if (parts.pieces.length !== own) return undefined;
  return frame(act, background);
}

const quoted = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The shape an act or a context was set into and the pieces it holds: the shape with the most fixed characters
 * that fits wins, and a text that fits none is one piece of the bare shape.
 */
function split(text: string, shapes: readonly string[], fold: boolean): { shape: string; pieces: string[] } {
  let best: { shape: string; pieces: string[]; fixed: number } | undefined;
  for (const shape of shapes) {
    const parts = shape.split(SLOT);
    const found = new RegExp(`^${parts.map(quoted).join('(.+?)')}$`, fold ? 'is' : 's').exec(text);
    if (!found) continue;
    const fixed = parts.join('').length;
    if (!best || fixed > best.fixed) best = { shape, pieces: found.slice(1), fixed };
  }
  return best ? { shape: best.shape, pieces: best.pieces } : { shape: SLOT, pieces: [text] };
}

/** The decomposition of an ask the generator wrote: the names and the pieces `renderAsk` needs. */
export function decompose(frame: string, act: string, context: string | undefined) {
  if (frame === VERBATIM) return { frame, shape: SLOT, pieces: [act] };
  const inAct = split(act, ACT_SHAPES, false);
  if (context === undefined) return { frame, shape: inAct.shape, pieces: inAct.pieces };
  // The context sentence starts with a capital the shape does not have: its first letter is folded back.
  const inContext = split(context, CONTEXT_SHAPES, true);
  const pieces = [...inAct.pieces, ...inContext.pieces];
  return { frame, shape: inAct.shape, context: inContext.shape, pieces };
}

/**
 * The patterns of routing prose that name the asks a unit is for ("Use when the user asks to X", "An ask to X",
 * "asks about X"), each with the shape of the act it gives: the request is the captured clause, and a pattern
 * that names a topic gives "help me with <topic>". The generator and the checks of its asks read the same list.
 */
export const ASKED_PATTERNS: ReadonlyArray<{ pattern: RegExp; topic: boolean }> = [
  {
    pattern: /\buse (?:it )?when (?:the )?(?:user|owner|someone) (?:asks|wants) (?:you )?to ([^.;]+)/i,
    topic: false,
  },
  { pattern: /\buse (?:it )?when (?:the )?(?:user|owner|someone) asks (?:about|for) ([^.;]+)/i, topic: true },
  { pattern: /^an? (?:ask|request) to ([^.;]+)/i, topic: false },
  { pattern: /^an? (?:ask|request) (?:about|for) ([^.;]+)/i, topic: true },
];

/** The clauses of a text the generator takes as the asks it names. */
export function askedClauses(text: string): string[] {
  return ASKED_PATTERNS.flatMap(({ pattern }) => {
    const found = pattern.exec(text)?.[1]?.trim();
    return found ? [found] : [];
  });
}

/**
 * A read-before rule names the act it governs with a pronoun object: "Read a file before you edit it" governs
 * "editing a file". The text of the act, put together from the two clauses; undefined when the text has no such
 * rule. The generator and the checks of its asks read the same derivation.
 */
export function pronounDerivation(text: string): string | undefined {
  const found =
    /\b(?:read|load|check|review|consult)\s+(.+?)\s+before\s+([a-z]+ing)\s+(?:it|them|this|that)\b(.*)$/i.exec(
      text,
    );
  return found ? `${found[2]} ${found[1]}${found[3] ?? ''}` : undefined;
}
