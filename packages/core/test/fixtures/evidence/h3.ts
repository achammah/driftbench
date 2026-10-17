import { readFileSync } from 'node:fs';
import type { evidence } from '../../../src';
import type { Verdict } from '../../../src/schema/run';

/**
 * The 182 H3 exact-match failures (fw-value HF8), as evidence inputs. `h3-runs.json` is built by `build_h3.py`
 * from the research branch; its sha256 is pinned in the test so a silent change fails.
 */

export type H3Block = {
  spec: string;
  index: number;
  tools: string[];
  toolOrder?: string | null;
  slot: { tool: string; field: string; path: string[]; gold: string };
  links: evidence.RuleLink[];
  stated: evidence.StatedRule[];
};

export type H3Run = {
  id: string;
  block: string;
  hand: { class: string; prov: string; result: string; next: string; fault: string };
  user: string;
  calls: Array<{ label: string; input: unknown; output?: unknown; error?: string }>;
  reply: string;
  failing: string[];
  values: evidence.ValueFact[];
  reading: evidence.ReplyReading;
};

export type H3 = { source: string; blocks: Record<string, H3Block>; runs: H3Run[] };

export const H3_PATH = new URL('./h3-runs.json', import.meta.url);
export const H3_SHA256 = '2e1a1e64012ab605d80f8fa0b11acd17a2723802ec5ddbb4fcb3cc6f01079baf';

export function loadH3(): H3 {
  return JSON.parse(readFileSync(H3_PATH, 'utf8')) as H3;
}

function verdictOf(id: string, outcome: Verdict['outcome']): Verdict {
  return { id, kind: 'machine', name: 'tools', gating: true, outcome, evidence: id };
}

/** The slot field's verdict id: `tools.<tool>.input.<field>`. */
export function slotVerdict(block: H3Block): string {
  return `tools.${block.slot.tool}.input.${block.slot.field}`;
}

/** The evidence input for one verdict of a run: the slot verdict carries the value facts. */
export function h3Input(h3: H3, run: H3Run, verdictId: string): evidence.EvidenceInput {
  const block = h3.blocks[run.block] as H3Block;
  const verdicts = run.failing.map((id) => verdictOf(id, 'fail'));
  const verdict = verdicts.find((one) => one.id === verdictId) ?? verdictOf(verdictId, 'pass');
  return {
    block: {
      observed: {
        segments: [],
        text: run.reply,
        toolCalls: run.calls.map((call) => ({ ...call })),
        cost: {},
        latencyMs: 0,
      },
      verdicts,
    },
    verdict,
    user: run.user,
    expect: { tools: block.tools },
    ...(verdictId === slotVerdict(block) ? { values: run.values } : {}),
    links: block.links,
    stated: block.stated,
    reply: run.reading,
  };
}
