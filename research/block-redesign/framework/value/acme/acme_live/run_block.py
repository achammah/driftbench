"""Run one block (a list of customer turns) on the live Acme agent and print the observed turns as JSON.

python -m acme_live.run_block --turns "Hi, I need more data" "It's sam.rivera@example.com" \
    [--prompt prompt/acme-sales.md] [--overrides '{"coverage_check": {"error": "503"}}'] [--out run.json]

Stdin mode for the repo's process adapter or any wrapper: `python -m acme_live.run_block --stdin`
reads {"messages": [{"role": "user"|"assistant", "content": str}, ...], "overrides": {...}?, "prompt": path?}
and answers the LAST user message, replaying earlier assistant text as plain history (no tool replay).
It prints {"text", "calls", "usage", "usd", "model"}.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .agent import AcmeLive


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--turns", nargs="*", default=[])
    ap.add_argument("--prompt")
    ap.add_argument("--overrides", default="{}")
    ap.add_argument("--stdin", action="store_true")
    ap.add_argument("--out")
    a = ap.parse_args()
    if a.stdin:
        req = json.load(sys.stdin)
        agent = AcmeLive(Path(req["prompt"]).read_text() if req.get("prompt") else None)
        msgs = req["messages"]
        history = [{"role": m["role"], "content": m["content"]} for m in msgs[:-1]]
        t = agent.respond(history, msgs[-1]["content"], req.get("overrides"))
        print(json.dumps({k: t[k] for k in ("text", "calls", "usage", "usd", "model")}))
        return
    agent = AcmeLive(Path(a.prompt).read_text() if a.prompt else None)
    history, turns, total = [], [], 0.0
    for user in a.turns:
        t = agent.respond(history, user, json.loads(a.overrides))
        history = t["history"]
        total += t["usd"]
        turns.append({"user": user, "text": t["text"], "calls": t["calls"], "usage": t["usage"]})
    out = {"model": agent.model, "effort": agent.effort, "turns": turns, "usd": total}
    s = json.dumps(out, indent=1)
    if a.out:
        Path(a.out).write_text(s)
    print(s)


if __name__ == "__main__":
    main()
