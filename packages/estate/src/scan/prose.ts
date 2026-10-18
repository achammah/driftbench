import { readFile } from 'node:fs/promises';
import {
  foldQuote,
  MAX_MODEL_QUOTE,
  MIN_MODEL_QUOTE,
  ModelError,
  type ModelPort,
  type ModelRequest,
  retryNote,
  shortQuote,
} from '@agent-nexus/driftbench-generate';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { type Atom, EvidencePredicate, ReplyActDeclaration } from '../schema';
import type { AtomBuilder } from './code';
import { type ProseCache, proseCacheKey } from './prose-cache';
import type { ProseChunk, RawEstate } from './reader';
import { type Located, locateQuote, quoteAtSpan } from './text';

/**
 * The model half of the scan, and its only job: split the prose of an estate (standing instructions, memory,
 * the bodies of skills and helper agents) into instruction, gate and register atoms, and resolve only routing tables code explicitly marks as ambiguous. One call per chunk,
 * a strict JSON answer, every atom quoted from the chunk. Code finds each quote in the file, checks it at
 * its span with the extractor's quote check, and refuses an atom it cannot place, with the reason. Structure code decides stays with code. Ambiguous routing tables are the explicit exception; the model may decline them or propose an unapproved route.
 */

export const PROSE_KINDS = ['instruction', 'gate', 'register', 'route', 'stage', 'hazard'] as const;

export const PROSE_SYSTEM_PROMPT = `You split the written instructions of an AI agent into atoms. An atom is one place where the text says what the agent must do, with the exact words that say it. Code later turns approved atoms into tests, and a person approves every atom first. You never write tests or verdicts.

Kinds:
- instruction: a rule, an obligation or a prohibition, with the situation it applies in.
- gate: an order between two acts: before X, do Y.
- register: a rule on the reply itself: its language, length, format, words or tone.
- stage and hazard: enrichment only. Supply replyAct and ask for an existing code-derived stage or hazard with the exact same source quote and line span. Never invent a stage or hazard atom.
- route: only for a table explicitly flagged AMBIGUOUS ROUTING below. Decide whether it actually maps a request to a declared skill/helper. An inventory gives no route. If uncertain, omit it. A route must name target and targetKind from the flagged candidates and give its request in situation.

Rules:
1. Quote, never invent. Every atom has "quote", text copied character for character from the chunk, between ${MIN_MODEL_QUOTE} and ${MAX_MODEL_QUOTE} characters. Code searches the quote in the file and refuses an atom whose quote it cannot find inside the chunk. Never paraphrase inside a quote, never join two passages.
2. One atom per rule. A line that holds two rules gives two atoms, each quoting its own words.
3. Skip what code reads: frontmatter, decided tables, lists of links, and a line that only names a file to read. Review only the explicitly flagged ambiguous routing tables; never infer a route from an unflagged table.
4. "evidence" lists what a trace shows when the rule is obeyed, as typed predicates: {"type": "tool_called", "label": "<tool>", "input": {...}}, {"type": "tool_not_called", "label": "<tool>"}, {"type": "skill_loaded", "name": "<skill>"}, {"type": "ordered", "before": "<tool, skill or stage>", "after": "<tool, skill or stage>"}, {"type": "stage_reached", "name": "<stage>"}, {"type": "workspace", "changed": ["<path>"], "othersUntouched": true}, {"type": "text", "must": ["..."], "mustNot": ["..."], "lang": "<tag>"}, {"type": "custom", "name": "<check>", "options": {...}}. At least one per atom.
5. For an instruction, register rule, gate, stage or hazard whose task requires a reply, supply "replyAct": {"id": "answer|clarify|refuse|report|draft|acknowledge", "evidence": {"type": "text_segment", "part": "reply|draft"}} with one exact ID and part, not the alternatives shown here. Choose the act from the quoted requirement: answer supplies requested information; clarify asks for missing information; refuse declines the requested act; report states a result or status; draft composes material for review; acknowledge confirms receipt or an instruction. Do not infer semantics from a word dictionary. Do not invent an act when the source does not support one. Supply "ask": {"text": "<complete task request>", "context": "<optional complete condition>"} with replyAct; the request exercises the quoted requirement without replacing it. Omit context when unnecessary. Missing declarations and requests stay missing; code never fills them from a title or quote. These declarations are proposals requiring owner approval, not observed proof. A reporting adapter or declared judge separately records the actual act bound to its text segment.
6. Answer with one JSON object and nothing else: no prose, no code fence. Use only these keys:
{"chunk": "<the chunk id you were given>", "atoms": [{"kind": "instruction", "title": "<the rule in plain words>", "quote": "<verbatim text>", "situation": "<when it applies; leave out when always>", "polarity": "obligation", "evidence": [ ... ], "replyAct": {"id": "clarify", "evidence": {"type": "text_segment", "part": "reply"}}, "ask": {"text": "<complete task request>"}}]}
"replyAct" and "ask" are optional when unsupported; if ask is supplied, replyAct is required. "polarity" is obligation or prohibition, for instructions only. For route atoms also include "target": "<declared name>" and "targetKind": "skill" or "subagent". Other kinds do not need these fields.`;

/** The request for one chunk. The first line names the chunk, so a recorded answer can be matched to it. */
export function proseRequest(chunk: ProseChunk, maxTokens?: number): ModelRequest {
  const user = [
    `CHUNK: ${chunk.id}`,
    '',
    `File ${chunk.file}, lines ${chunk.startLine} to ${chunk.endLine}. Split it into instruction, gate and register atoms.`,
    '',
    ...(chunk.ambiguousRouting?.length
      ? [
          'AMBIGUOUS ROUTING: code emitted no route for these tables. Resolve their intent from the source; do not guess.',
          ...chunk.ambiguousRouting.map(
            (table) =>
              `Table lines ${table.startLine}-${table.endLine}; declared candidates: ${JSON.stringify(table.targets)}.`,
          ),
          '',
        ]
      : []),
    '<<<CHUNK',
    chunk.text.trimEnd(),
    'CHUNK>>>',
  ].join('\n');
  return maxTokens === undefined
    ? { system: PROSE_SYSTEM_PROMPT, user }
    : { system: PROSE_SYSTEM_PROMPT, user, maxTokens };
}

/** The chunk a request is for, read from its first line. */
export function chunkOf(user: string): string | undefined {
  return /^CHUNK: (.+)$/m.exec(user.split('\n')[0] ?? '')?.[1]?.trim();
}

const Envelope = z.strictObject({ chunk: z.string(), atoms: z.array(z.unknown()) });
export type ProseAnswer = z.infer<typeof Envelope>;

const AnswerAtom = z.strictObject({
  kind: z.enum(PROSE_KINDS),
  title: z.string({ error: 'the title is missing' }).min(1),
  quote: z.string({ error: 'the quote is missing: every atom quotes the words that state it' }),
  situation: z.string().min(1).optional(),
  polarity: z.enum(['obligation', 'prohibition']).optional(),
  replyAct: ReplyActDeclaration.optional(),
  ask: z
    .strictObject({ text: z.string().trim().min(1), context: z.string().trim().min(1).optional() })
    .optional(),
  line: z.number().int().min(1).optional(),
  evidence: z.array(EvidencePredicate).min(1, { error: 'evidence is empty: name what a trace shows' }),
  target: z.string().min(1).optional(),
  targetKind: z.enum(['skill', 'subagent']).optional(),
});

/** Reads an answer: JSON (optionally in one code fence), the strict envelope and the right chunk. */
export function parseProseAnswer(
  chunk: string,
  text: string,
): { ok: true; answer: ProseAnswer } | { ok: false; reason: string } {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, reason: 'the answer is empty' };
  const body = /^```[A-Za-z]*\s*\n([\s\S]*?)\n?```$/.exec(trimmed)?.[1] ?? trimmed;
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch (cause) {
    return {
      ok: false,
      reason: `the answer is not JSON (${cause instanceof Error ? cause.message : cause})`,
    };
  }
  const parsed = Envelope.safeParse(value);
  if (!parsed.success)
    return { ok: false, reason: `the answer does not have the agreed shape: ${issue(parsed.error)}` };
  if (parsed.data.chunk !== chunk) {
    return { ok: false, reason: `the answer is for the chunk "${parsed.data.chunk}", not "${chunk}"` };
  }
  return { ok: true, answer: parsed.data };
}

/** An atom the scan refused, with the reason. Refusals are listed, never dropped silently. */
export type ProseRefusal = { chunk: string; entry: string; reason: string };

/**
 * Checks each atom of a readable answer on its own and adds the good ones, unapproved. An atom is refused
 * when its shape is wrong, its quote is too short or too long, or the quote is not inside the chunk's lines;
 * an atom whose kind and span repeat an atom already read is skipped as a duplicate.
 */
export function acceptProse(
  chunk: ProseChunk,
  answer: ProseAnswer,
  fileText: string,
  builder: AtomBuilder,
): { accepted: Atom[]; refusals: ProseRefusal[]; duplicates: string[] } {
  const accepted: Atom[] = [];
  const refusals: ProseRefusal[] = [];
  const duplicates: string[] = [];
  answer.atoms.forEach((raw, index) => {
    const label = `atom #${index + 1}`;
    const parsed = AnswerAtom.safeParse(raw);
    if (!parsed.success) {
      refusals.push({ chunk: chunk.id, entry: label, reason: issue(parsed.error) });
      return;
    }
    const atom = parsed.data;
    if (
      (atom.ask !== undefined && atom.replyAct === undefined) ||
      (atom.kind === 'route' && (atom.ask !== undefined || atom.replyAct !== undefined))
    ) {
      refusals.push({
        chunk: chunk.id,
        entry: label,
        reason:
          'ask: a reply request requires a declared replyAct on an instruction, register, gate, stage or hazard',
      });
      return;
    }
    const named = `${label} (${atom.kind}: ${shortQuote(atom.title, 50)})`;
    const folded = foldQuote(atom.quote);
    if (folded === '') {
      refusals.push({ chunk: chunk.id, entry: named, reason: 'the quote is missing' });
      return;
    }
    if (folded.length < MIN_MODEL_QUOTE) {
      refusals.push({ chunk: chunk.id, entry: named, reason: 'the quote is too short to place the atom' });
      return;
    }
    if (atom.quote.length > MAX_MODEL_QUOTE) {
      refusals.push({
        chunk: chunk.id,
        entry: named,
        reason: `the quote is longer than ${MAX_MODEL_QUOTE} characters: quote the rule, not the file`,
      });
      return;
    }
    const span = locateQuote(fileText, atom.quote, {
      fromLine: chunk.startLine,
      toLine: chunk.endLine,
      ...(atom.line !== undefined ? { nearLine: atom.line } : {}),
    });
    if (!span) {
      const elsewhere = locateQuote(fileText, atom.quote);
      refusals.push({
        chunk: chunk.id,
        entry: named,
        reason: elsewhere
          ? `the quote is in ${chunk.file} at line ${elsewhere.startLine}, outside the chunk (lines ${chunk.startLine} to ${chunk.endLine})`
          : `the quote is not in ${chunk.file}: "${shortQuote(atom.quote, 60)}"`,
      });
      return;
    }
    const routeTable =
      atom.kind === 'route'
        ? chunk.ambiguousRouting?.find(
            (table) =>
              table.startLine <= span.startLine &&
              table.endLine >= span.endLine &&
              table.targets.some((target) => target.name === atom.target && target.kind === atom.targetKind),
          )
        : undefined;
    if (atom.kind === 'route' && (!routeTable || !atom.situation)) {
      refusals.push({
        chunk: chunk.id,
        entry: named,
        reason:
          'kind: a model route must resolve a flagged ambiguous table, name one of its declared targets and give the request in situation',
      });
      return;
    }
    const at: Located = { file: chunk.file, ...span, quote: atom.quote };
    if (!quoteAtSpan(fileText, at)) {
      refusals.push({
        chunk: chunk.id,
        entry: named,
        reason: `the quote is not at lines ${span.startLine} to ${span.endLine}`,
      });
      return;
    }
    const exact = builder
      .atomsOf(at.file)
      .find(
        (other) =>
          other.kind === atom.kind &&
          other.provenance.file === at.file &&
          other.provenance.startLine === at.startLine &&
          other.provenance.endLine === at.endLine &&
          other.provenance.quote === at.quote &&
          !other.fields?.candidate,
      );
    const ask =
      atom.ask && atom.replyAct
        ? { ...atom.ask, act: { kind: 'reply' as const, name: atom.replyAct.id } }
        : undefined;
    if (
      exact &&
      exact.producedBy === 'code' &&
      exact.replyAct === undefined &&
      exact.fields?.ask === undefined &&
      atom.replyAct &&
      ask
    ) {
      exact.replyAct = atom.replyAct;
      exact.fields = { ...exact.fields, ask };
      exact.producedBy = 'model';
      exact.approved = false;
      accepted.push(exact);
      return;
    }
    const same =
      exact ??
      builder
        .atomsOf(at.file)
        .find(
          (other) =>
            other.kind === atom.kind &&
            other.provenance.file === at.file &&
            other.provenance.startLine <= at.endLine &&
            at.startLine <= other.provenance.endLine &&
            !other.fields?.candidate &&
            (other.producedBy === 'code' || foldQuote(other.provenance.quote) === folded),
        );
    if (same) {
      duplicates.push(`${chunk.id}: ${named} repeats ${same.id}`);
      return;
    }
    if (atom.kind === 'stage' || atom.kind === 'hazard') {
      refusals.push({
        chunk: chunk.id,
        entry: named,
        reason:
          'kind: stage and hazard proposals may only enrich an exact existing code atom with replyAct and ask',
      });
      return;
    }
    accepted.push(
      builder.add({
        kind: atom.kind,
        title: atom.title,
        at,
        evidence: routeTable
          ? [
              atom.targetKind === 'skill'
                ? { type: 'skill_loaded', name: atom.target as string }
                : { type: 'tool_called', label: routeTable.dispatch, input: { subagent_type: atom.target } },
            ]
          : atom.evidence,
        producedBy: 'model',
        ...(atom.replyAct ? { replyAct: atom.replyAct } : {}),
        ...(atom.situation ? { situation: atom.situation } : {}),
        ...(routeTable
          ? {
              fields: {
                target: atom.target,
                targetKind: atom.targetKind,
                ask: atom.situation,
                via: 'model-table',
              },
            }
          : atom.polarity || ask
            ? { fields: { ...(atom.polarity ? { polarity: atom.polarity } : {}), ...(ask ? { ask } : {}) } }
            : {}),
      }),
    );
  });
  return { accepted, refusals, duplicates };
}

export type ChunkRun = {
  chunk: string;
  calls: number;
  status: 'done' | 'failed';
  accepted: number;
  cached?: boolean;
  error?: string;
  excerpt?: string;
};

/** Runs one chunk: a call, one retry after an unreadable answer, then acceptance atom by atom. */
export async function runChunk(
  chunk: ProseChunk,
  fileText: string,
  port: ModelPort,
  builder: AtomBuilder,
  maxTokens?: number,
  cache?: ProseCache,
): Promise<{ run: ChunkRun; refusals: ProseRefusal[]; duplicates: string[] }> {
  const key = proseCacheKey(chunk, port, maxTokens);
  const cached = await cache?.get(key);
  if (cached) {
    const atoms = cached.atoms.map((raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
      const atom = raw as Record<string, unknown>;
      return typeof atom.line === 'number' ? { ...atom, line: atom.line + chunk.startLine - 1 } : atom;
    });
    const result = acceptProse(chunk, { ...cached, chunk: chunk.id, atoms }, fileText, builder);
    return {
      run: { chunk: chunk.id, calls: 0, status: 'done', accepted: result.accepted.length, cached: true },
      refusals: result.refusals,
      duplicates: result.duplicates,
    };
  }
  const request = proseRequest(chunk, maxTokens);
  let reason = '';
  let excerpt = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const user = attempt === 1 ? request.user : `${request.user}\n\n${retryNote(reason)}`;
    let text: string;
    try {
      text = await port.complete({ ...request, user });
    } catch (cause) {
      const message = cause instanceof ModelError ? `${cause.code}: ${cause.message}` : String(cause);
      return {
        run: {
          chunk: chunk.id,
          calls: attempt,
          status: 'failed',
          accepted: 0,
          error: `the model call failed (${message})`,
        },
        refusals: [],
        duplicates: [],
      };
    }
    const parsed = parseProseAnswer(chunk.id, text);
    if (parsed.ok) {
      const result = acceptProse(chunk, parsed.answer, fileText, builder);
      if (cache && result.refusals.length === 0) {
        // Keep the located occurrence, relative to content rather than absolute file lines.
        const atoms = parsed.answer.atoms.map((raw) => {
          const atom = AnswerAtom.parse(raw);
          const span = locateQuote(fileText, atom.quote, {
            fromLine: chunk.startLine,
            toLine: chunk.endLine,
            ...(atom.line !== undefined ? { nearLine: atom.line } : {}),
          });
          return span ? { ...atom, line: span.startLine - chunk.startLine + 1 } : atom;
        });
        await cache.put(key, { ...parsed.answer, atoms });
      }
      return {
        run: { chunk: chunk.id, calls: attempt, status: 'done', accepted: result.accepted.length },
        refusals: result.refusals,
        duplicates: result.duplicates,
      };
    }
    reason = parsed.reason;
    excerpt = shortQuote(text, 120);
  }
  return {
    run: {
      chunk: chunk.id,
      calls: 2,
      status: 'failed',
      accepted: 0,
      error: `the answer could not be read, twice: ${reason}`,
      excerpt,
    },
    refusals: [],
    duplicates: [],
  };
}

const RecordedAnswer = z.union([z.string().min(1), z.record(z.string(), z.unknown())]);

/**
 * Recorded answers, one per chunk id (the file path of the chunk), replayed instead of calling a model: the
 * same estate and the same recording give the same map. An answer is the raw text, or the JSON object
 * written as YAML; a list replays one answer per call, so an unreadable answer and its retry can both be
 * recorded.
 */
export const EstateRecording = z
  .strictObject({
    family: z.string().min(1),
    model: z.string().min(1),
    answers: z.record(z.string(), z.union([RecordedAnswer, z.array(RecordedAnswer).min(1)])),
  })
  .describe('Recorded answers for driftbench estate scan --replay.');
export type EstateRecording = z.infer<typeof EstateRecording>;

export async function loadEstateRecording(
  path: string,
): Promise<{ ok: true; recording: EstateRecording } | { ok: false; message: string }> {
  let raw: unknown;
  try {
    raw = parseYaml(await readFile(path, 'utf8'), { uniqueKeys: true });
  } catch (cause) {
    return {
      ok: false,
      message: cause instanceof Error ? (cause.message.split('\n')[0] ?? '') : String(cause),
    };
  }
  const parsed = EstateRecording.safeParse(raw);
  if (!parsed.success) return { ok: false, message: issue(parsed.error) };
  return { ok: true, recording: parsed.data };
}

/** A port that answers each request with the next recorded answer for its chunk. */
export function estateRecordingPort(recording: EstateRecording): ModelPort {
  const queues = new Map<string, string[]>();
  for (const [chunk, recorded] of Object.entries(recording.answers)) {
    queues.set(
      chunk,
      (Array.isArray(recorded) ? recorded : [recorded]).map((answer) =>
        typeof answer === 'string' ? answer : JSON.stringify(answer, null, 2),
      ),
    );
  }
  return {
    family: recording.family,
    model: recording.model,
    async complete(request: ModelRequest): Promise<string> {
      const chunk = chunkOf(request.user);
      if (!chunk) throw new ModelError('bad_response', 'the request does not name a chunk');
      const next = queues.get(chunk)?.shift();
      if (next === undefined) {
        throw new ModelError('exhausted', `the recording holds no answer left for the chunk ${chunk}`);
      }
      return next;
    },
  };
}

function issue(error: z.ZodError): string {
  const first = error.issues[0];
  if (!first) return 'unknown problem';
  const message =
    first.code === 'unrecognized_keys'
      ? `unknown key${first.keys.length > 1 ? 's' : ''} ${first.keys.join(', ')}`
      : first.message.replace(/received undefined$/, 'missing');
  const path = first.path.map(String).join('.');
  return path ? `${path}: ${message}` : message;
}

/** Where a prose chunk comes from, by the kind of its file. */
export const PROSE_SOURCES = ['standing', 'memory', 'skill', 'reference', 'subagent', 'other'] as const;
export type ProseSource = (typeof PROSE_SOURCES)[number];

const SOURCE_NAMES: Record<ProseSource, string> = {
  standing: 'standing',
  memory: 'memory',
  skill: 'skill bodies',
  reference: 'skill files',
  subagent: 'helper bodies',
  other: 'other',
};

export type ProseInventory = {
  chunks: Array<{
    id: string;
    file: string;
    source: ProseSource;
    startLine: number;
    endLine: number;
    characters: number;
  }>;
  characters: number;
  bySource: Record<ProseSource, { chunks: number; characters: number }>;
};

/** The prose chunks of an estate with their sizes: what a model call would be given, chunk by chunk. */
export function proseInventory(raw: RawEstate): ProseInventory {
  const kinds = new Map(raw.files.map((file) => [file.path, file.kind]));
  const bySource = Object.fromEntries(
    PROSE_SOURCES.map((source) => [source, { chunks: 0, characters: 0 }]),
  ) as ProseInventory['bySource'];
  const chunks = raw.prose.map((chunk) => {
    const kind = kinds.get(chunk.file);
    const source: ProseSource =
      kind === 'standing' || kind === 'memory' || kind === 'skill' || kind === 'subagent'
        ? kind
        : kind === 'skill_file'
          ? 'reference'
          : 'other';
    const characters = chunk.text.length;
    bySource[source].chunks++;
    bySource[source].characters += characters;
    return {
      id: chunk.id,
      file: chunk.file,
      source,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      characters,
    };
  });
  return { chunks, characters: chunks.reduce((sum, chunk) => sum + chunk.characters, 0), bySource };
}

/**
 * The lines a scan prints about its prose: the count by source, and, when no model ran, every chunk left
 * unanswered with its size, so the owner sees what a model call would cost before funding it.
 */
export function proseInventoryLines(inventory: ProseInventory, answered: boolean): string[] {
  const { chunks, characters, bySource } = inventory;
  if (chunks.length === 0) return ['  Prose: none.'];
  const parts = PROSE_SOURCES.filter((source) => bySource[source].chunks > 0).map(
    (source) => `${SOURCE_NAMES[source]} ${bySource[source].chunks}`,
  );
  const lines = [
    `  Prose: ${chunks.length} ${chunks.length === 1 ? 'chunk' : 'chunks'}, ${characters} characters (${parts.join(', ')}).`,
  ];
  if (answered) return lines;
  lines.push(`  Unanswered prose chunks (no model call): ${chunks.length}, ${characters} characters.`);
  for (const chunk of chunks) lines.push(`    ${chunk.id}  ${chunk.characters} characters`);
  return lines;
}
