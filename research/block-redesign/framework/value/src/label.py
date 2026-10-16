"""HF5 reference labels: two blind labellers of two families label every H1 class run.

python label.py <model> [--ids id,id] [--limit N] [--batch name]

Each labeller sees one run: the tool definitions, the agent's system prompt, the conversation before the turn,
the customer's message, the agent's tool calls with their results, the reply, and the block's expectation.
It never sees an oracle verdict, the other labeller, or any classification table.
Output: data/labels-<model>.jsonl (resumable by run id).
"""

from __future__ import annotations

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor

from common import DATA, INPUTS, ROOT, append_jsonl, model_json, read_jsonl
from oracle import EXPECTS, SLOTS, load_runs

sys.path.insert(0, str(ROOT / "acme"))
from acme_live.tools import TOOL_DEFS  # noqa: E402

PROMPT = (ROOT / "acme" / "prompt" / "acme-sales.md").read_text()
WIRE_TO_LABEL = {"catalog_search": "catalog.search", "coverage_check": "coverage.check", "port_check": "port.check",
                 "order_create": "order.create", "notify_sales": "notify_sales"}

SYSTEM = """You label one test run of a customer-service AI agent, as an expert reviewer.

You get: the agent's tool definitions, the agent's system prompt, the conversation before this turn, the customer's new message, the tool calls the agent made in reply with what each tool returned, the agent's reply, and what the test expects from this turn (the expected tool calls and the values it checks, written as gold values). Tool names appear with a dot in the test (coverage.check) and with an underscore in the definitions (coverage_check); they are the same tools.

Decide whether this turn should PASS or FAIL the test in substance. Pick exactly one label:
- matches: the agent made the expected calls, and every checked value equals the gold value or meets the expectation as written.
- format_only: the only differences from the expectation are in how a value is written (spacing, punctuation, case, an abbreviation, a country code, a missing town, and similar), and the tool results in this run show that the tool that received the value treated it the same way it treats the gold value (it found the same record, or returned the same canonical value).
- undeclared_requirement: the only differences are in how a value is written; the tool that received the value accepted or stored it; the value names the same real-world thing as the gold value; and neither the tool definitions nor the system prompt told the agent to write it in the gold's format.
- real_error: an expected call is missing, extra or wrong (wrong tool, wrong order, a wrong argument that is not just a writing of the gold value), or a value names a different thing, or the tool that received the value behaved differently than it would with the gold value (for example it did not find the address or the customer that the gold value finds).

verdict is "pass" for matches, format_only and undeclared_requirement, and "fail" for real_error.
Judge only from the evidence shown. Answer JSON only:
{"label": "matches" | "format_only" | "undeclared_requirement" | "real_error", "verdict": "pass" | "fail", "reason": "<one or two sentences>"}"""


def _content_text(content) -> list[str]:
    if isinstance(content, str):
        return [content]
    out = []
    for b in content:
        if b.get("type") == "text":
            out.append(b["text"])
        elif b.get("type") == "tool_use":
            out.append(f"[tool call {WIRE_TO_LABEL.get(b['name'], b['name'])} input={json.dumps(b.get('input'))}]")
        elif b.get("type") == "tool_result":
            tag = "tool error" if b.get("is_error") else "tool result"
            out.append(f"[{tag}: {b.get('content')}]")
    return out


def render_history(history: list) -> str:
    lines = []
    for m in history:
        who = "Customer" if m["role"] == "user" else "Agent"
        for t in _content_text(m["content"]):
            if t.startswith("[tool result") or t.startswith("[tool error"):
                lines.append(f"  {t}")
            elif t.startswith("[tool call"):
                lines.append(f"Agent {t}")
            else:
                lines.append(f"{who}: {t}")
    return "\n".join(lines) if lines else "(none: this is the first message)"


def _assertion_text(a) -> str:
    if not isinstance(a, dict):
        return f"equal to {json.dumps(a)}"
    if "regex" in a:
        return f"matching the pattern /{a['regex']}/"
    if "contains" in a:
        return f"containing {json.dumps(a['contains'])}"
    if "one_of" in a:
        return f"one of {json.dumps(a['one_of'])}"
    if "absent" in a:
        return "absent (not given)"
    if "subset" in a:
        return "an object holding at least " + ", ".join(f"{k} = {json.dumps(v)}" for k, v in a["subset"].items())
    return json.dumps(a)


def render_expect(block: str) -> str:
    e = EXPECTS[block]
    golds = {(lab, f): g for lab, f, _p, g in SLOTS[block]}
    lines = []
    for t in e["tools"]:
        c = t.get("count")
        if c == 0:
            lines.append(f"- {t['label']} must not be called.")
            continue
        parts = [f"- {t['label']} called exactly {c} time{'s' if c != 1 else ''}"]
        ins = []
        for f, a in (t.get("input") or {}).items():
            s = f"{f} {_assertion_text(a)}"
            if (t["label"], f) in golds and isinstance(a, dict) and ("regex" in a or "subset" in a):
                s += f" (gold value: {json.dumps(golds[(t['label'], f)])})"
            ins.append(s)
        if ins:
            parts.append(" with " + "; ".join(ins))
        lines.append("".join(parts) + ".")
    if e["tool_order"] == "in_order":
        lines.append("- The expected calls happen in this order (other calls may come between them).")
    return "\n".join(lines)


def render_run(run: dict, job: dict) -> str:
    calls = "\n".join(
        f"- {c['label']} input={json.dumps(c['input'])} -> " + (f"returned {json.dumps(c['output'])}" if "output" in c else f"error: {c.get('error')}")
        for c in run["calls"]) or "(no tool call)"
    forced = ""
    if job.get("overrides"):
        forced = "\nNote: in this test some tool results are fixed by the test setup: " + json.dumps(job["overrides"]) + "\n"
    return (
        "## Tool definitions\n" + json.dumps(TOOL_DEFS, indent=1) + "\n\n"
        "## The agent's system prompt\n" + PROMPT + "\n\n"
        "## Conversation before this turn\n" + render_history(job["history"]) + "\n\n"
        "## The customer's new message\n" + run["text"] + "\n\n"
        "## The agent's tool calls in this turn\n" + calls + "\n" + forced + "\n"
        "## The agent's reply\n" + run["reply"] + "\n\n"
        "## What the test expects from this turn\n" + render_expect(run["block"]) + "\n"
    )


def label_one(model: str, batch: str, run: dict, job: dict) -> dict:
    try:
        v = model_json(batch, model, SYSTEM, render_run(run, job), 5101)
        lab = v.get("label")
        if lab not in ("matches", "format_only", "undeclared_requirement", "real_error"):
            return {"id": run["id"], "error": f"bad label {lab!r}", "raw": v}
        return {"id": run["id"], "label": lab, "verdict": "fail" if lab == "real_error" else "pass",
                "said_verdict": v.get("verdict"), "reason": v.get("reason")}
    except Exception as e:  # noqa: BLE001  transport or parse failure after retries: recorded, rerun later
        return {"id": run["id"], "error": f"{type(e).__name__}: {e}"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("model")
    ap.add_argument("--ids")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--batch", default="hf5-labels")
    ap.add_argument("--workers", type=int, default=6)
    a = ap.parse_args()
    runs = load_runs()
    jobs = {j["id"]: j for j in read_jsonl(INPUTS / "jobs-class.jsonl")}
    out = DATA / f"labels-{a.model}.jsonl"
    done = {r["id"] for r in read_jsonl(out) if "label" in r}
    todo = [r for r in runs if r["id"] not in done]
    if a.ids:
        want = set(a.ids.split(","))
        todo = [r for r in todo if r["id"] in want]
    if a.limit:
        todo = todo[: a.limit]
    print(f"{len(runs)} runs, {len(done)} labelled, {len(todo)} to label", flush=True)

    def go(r):
        res = label_one(a.model, a.batch, r, jobs[r["id"]])
        append_jsonl(out if "label" in res else DATA / f"labels-{a.model}.errors.jsonl", res)
        return res

    with ThreadPoolExecutor(max_workers=a.workers) as pool:
        res = list(pool.map(go, todo))
    print(f"labelled {sum('label' in r for r in res)}, errors {sum('error' in r for r in res)}", flush=True)


if __name__ == "__main__":
    main()
