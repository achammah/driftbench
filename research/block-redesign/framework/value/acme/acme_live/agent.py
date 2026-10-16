"""The live Acme sales agent: the 30-section prompt plus the Acme tools on claude-haiku-5-5.

Shared research stand-in for the block experiments. One writer: the links lane; ask it for changes.

    from acme_live.agent import AcmeLive
    agent = AcmeLive()                                   # default prompt, model, effort
    turn = agent.respond(history, "Hi, I want home internet at 14 Harbor Road, Acmeville")
    turn["text"], turn["calls"], turn["usage"], turn["usd"]
    history = turn["history"]                            # pass back for the next turn (free-running)

`respond` answers ONE customer turn and runs the tool loop to the end of that turn. `history` is the
Anthropic messages list returned by the previous turn ([] for the first). `overrides` forces tool results:
{"coverage_check": {"error": "..."}} or {"catalog_search": {"result": {...}}}.
The key is read inside the process from ~/.nexus-secrets/anthropic-driftbench.key, never printed.
"""

from __future__ import annotations

import json
from pathlib import Path

import anthropic

from .tools import TOOL_DEFS, call_tool

HERE = Path(__file__).resolve().parent.parent
PROMPT = HERE / "prompt" / "acme-sales.md"
MODEL = "claude-haiku-5-5"
EFFORT = "low"
MAX_TOKENS = 2048
MAX_STEPS = 6
# USD per million tokens, claude-haiku-5-5, prompts up to 100K tokens
# (https://platform.claude.com/docs/en/about-claude/pricing): input 0.10, output 0.50, cache read 0.01;
# cache write 1.25x input. Over 100K tokens: 0.50 / 2.50 (never reached by this agent).
PRICE = {"in": 0.10, "out": 0.50, "cw": 0.125, "cr": 0.01}


def usd(u: dict) -> float:
    return (u["in"] * PRICE["in"] + u["out"] * PRICE["out"] + u["cw"] * PRICE["cw"] + u["cr"] * PRICE["cr"]) / 1e6


class AcmeLive:
    def __init__(self, system_text: str | None = None, model: str = MODEL, effort: str = EFFORT,
                 key_file: Path = Path.home() / ".nexus-secrets" / "anthropic-driftbench.key"):
        self.system_text = system_text if system_text is not None else PROMPT.read_text()
        self.model, self.effort = model, effort
        self.client = anthropic.Anthropic(api_key=key_file.read_text().strip(), max_retries=6)

    def respond(self, history: list, user_text: str, overrides: dict | None = None) -> dict:
        messages = list(history) + [{"role": "user", "content": user_text}]
        usage = {"in": 0, "out": 0, "cw": 0, "cr": 0, "calls": 0}
        calls, texts, stop = [], [], None
        for _ in range(MAX_STEPS):
            resp = self.client.messages.create(
                model=self.model, max_tokens=MAX_TOKENS,
                system=[{"type": "text", "text": self.system_text, "cache_control": {"type": "ephemeral"}}],
                tools=TOOL_DEFS, messages=messages, output_config={"effort": self.effort},
            )
            u = resp.usage
            usage["in"] += u.input_tokens or 0
            usage["out"] += u.output_tokens or 0
            usage["cw"] += u.cache_creation_input_tokens or 0
            usage["cr"] += u.cache_read_input_tokens or 0
            usage["calls"] += 1
            stop = resp.stop_reason
            messages.append({"role": "assistant", "content": [b.model_dump(exclude_none=True) for b in resp.content]})
            results = []
            for b in resp.content:
                if b.type == "text":
                    texts.append(b.text)
                elif b.type == "tool_use":
                    ok, out = call_tool(b.name, dict(b.input), overrides)
                    calls.append({"name": b.name, "input": dict(b.input), "ok": ok,
                                  "output" if ok else "error": out})
                    results.append({"type": "tool_result", "tool_use_id": b.id,
                                    "content": json.dumps(out) if ok else str(out), **({} if ok else {"is_error": True})})
            if not results:
                break
            messages.append({"role": "user", "content": results})
        return {"text": "\n".join(texts).strip(), "calls": calls, "stop": stop, "history": messages,
                "usage": usage, "usd": usd(usage), "model": self.model, "effort": self.effort}
