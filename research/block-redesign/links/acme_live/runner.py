"""Runs the live Acme suite on a prompt variant through the Anthropic Messages API (research stand-in).

python -m acme_live.runner --variant <id> --prompt <file> --reps N [--convs id,id] [--workers 8]
Appends one JSON line per (variant, rep, conversation) to data/runs/<variant>.jsonl.
The key is read from ~/.nexus-secrets/anthropic-driftbench.key inside the process, never printed.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import anthropic
import yaml

from .tools import TOOL_DEFS, call_tool

HERE = Path(__file__).resolve().parent.parent
MODEL = "claude-haiku-5-5"
EFFORT = "low"
MAX_TOKENS = 2048
MAX_STEPS = 6
# USD per million tokens, claude-haiku-5-5 (skill table cached 2026-10-06): input 0.10, output 0.50;
# cache write 1.25x input, cache read 0.1x input.
PRICE = {"in": 0.10, "out": 0.50, "cw": 0.125, "cr": 0.01}

_lock = threading.Lock()


def load_suite(path: Path | None = None) -> dict:
    return yaml.safe_load((path or HERE / "suite" / "suite.yaml").read_text())


def client() -> anthropic.Anthropic:
    key = (Path.home() / ".nexus-secrets" / "anthropic-driftbench.key").read_text().strip()
    return anthropic.Anthropic(api_key=key, max_retries=6)


def usd(u: dict) -> float:
    return (u["in"] * PRICE["in"] + u["out"] * PRICE["out"] + u["cw"] * PRICE["cw"] + u["cr"] * PRICE["cr"]) / 1e6


def _match_val(want, got) -> bool:
    if isinstance(want, dict) and "re" in want:
        return isinstance(got, str) and re.search(want["re"], got, re.I) is not None
    if isinstance(want, dict) and want.get("absent"):
        return got is None
    return got == want


def check_block(checks: list, calls: list, text: str) -> list[str]:
    """Returns the list of failed check descriptions (empty = pass)."""
    failed = []
    names = [c["name"] for c in calls]
    for ch in checks:
        if "called" in ch:
            spec = ch["called"]
            hits = [c for c in calls if c["name"] == spec["tool"]]
            lo, hi = spec.get("min", 1), spec.get("max", 99)
            if not (lo <= len(hits) <= hi):
                failed.append(f"called {spec['tool']} count {len(hits)} not in [{lo},{hi}]")
                continue
            if "input" in spec and hits:
                ok = any(all(_match_val(v, h["input"].get(k)) for k, v in spec["input"].items()) for h in hits)
                if not ok:
                    failed.append(f"called {spec['tool']} input mismatch")
        elif "not_called" in ch:
            if ch["not_called"] in names:
                failed.append(f"not_called {ch['not_called']}")
        elif "before" in ch:
            a, b = ch["before"]
            if a not in names:
                failed.append(f"before: {a} never called")
            elif b in names and names.index(b) < names.index(a):
                failed.append(f"before: {b} before {a}")
        elif "must" in ch:
            for rx in ch["must"]:
                if not re.search(rx, text, re.I):
                    failed.append(f"must /{rx}/")
        elif "must_not" in ch:
            for rx in ch["must_not"]:
                if re.search(rx, text, re.I):
                    failed.append(f"must_not /{rx}/")
    return failed


def run_conversation(cl, system_text: str, conv: dict) -> dict:
    messages: list = []
    overrides = conv.get("overrides", {})
    usage = {"in": 0, "out": 0, "cw": 0, "cr": 0, "calls": 0}
    blocks = []
    for blk in conv["blocks"]:
        messages.append({"role": "user", "content": blk["user"]})
        calls, texts, stop = [], [], None
        for _step in range(MAX_STEPS):
            resp = cl.messages.create(
                model=MODEL,
                max_tokens=MAX_TOKENS,
                system=[{"type": "text", "text": system_text, "cache_control": {"type": "ephemeral"}}],
                tools=TOOL_DEFS,
                messages=messages,
                output_config={"effort": EFFORT},
            )
            u = resp.usage
            usage["in"] += u.input_tokens or 0
            usage["out"] += u.output_tokens or 0
            usage["cw"] += u.cache_creation_input_tokens or 0
            usage["cr"] += u.cache_read_input_tokens or 0
            usage["calls"] += 1
            stop = resp.stop_reason
            content = [b.model_dump(exclude_none=True) for b in resp.content]
            messages.append({"role": "assistant", "content": content})
            results = []
            for b in resp.content:
                if b.type == "text":
                    texts.append(b.text)
                elif b.type == "tool_use":
                    ok, out = call_tool(b.name, dict(b.input), overrides)
                    calls.append({"name": b.name, "input": dict(b.input), "ok": ok})
                    results.append({"type": "tool_result", "tool_use_id": b.id,
                                    "content": json.dumps(out) if ok else str(out), **({} if ok else {"is_error": True})})
            if not results:
                break
            messages.append({"role": "user", "content": results})
        text = "\n".join(texts).strip()
        failed = check_block(blk["checks"], calls, text)
        blocks.append({"block": blk["id"], "pass": not failed, "failed": failed, "calls": calls, "text": text, "stop": stop})
    return {"blocks": blocks, "usage": usage, "usd": usd(usage)}


def run_variant(variant: str, system_text: str, reps: int, convs: list[str] | None, workers: int,
                out_dir: Path | None = None, rep_offset: int = 0, tag: str = "") -> float:
    suite = load_suite()
    cl = client()
    out_dir = out_dir or HERE / "data" / "runs"
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{variant}.jsonl"
    jobs = [(r, c) for r in range(rep_offset, rep_offset + reps) for c in suite["conversations"] if not convs or c["id"] in convs]
    total = 0.0

    def job(r, c):
        t0 = time.time()
        for attempt in range(3):
            try:
                res = run_conversation(cl, system_text, c)
                break
            except (anthropic.APIStatusError, anthropic.APIConnectionError) as e:  # after the SDK's own retries
                if attempt == 2:
                    code = getattr(e, "status_code", "connection")
                    return {"variant": variant, "rep": r, "conv": c["id"], "error": f"{code}: {str(e)[:300]}"}
                time.sleep(10 * (attempt + 1))
        res.update({"variant": variant, "rep": r, "conv": c["id"], "secs": round(time.time() - t0, 1),
                    "model": MODEL, "effort": EFFORT, "tag": tag})
        return res

    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(job, r, c) for r, c in jobs]
        for f in as_completed(futs):
            rec = f.result()
            total += rec.get("usd", 0.0)
            with _lock, out.open("a") as fh:
                fh.write(json.dumps(rec) + "\n")
    return total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--variant", required=True)
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--reps", type=int, default=1)
    ap.add_argument("--rep-offset", type=int, default=0)
    ap.add_argument("--convs", default="")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--tag", default="")
    a = ap.parse_args()
    text = Path(a.prompt).read_text()
    spent = run_variant(a.variant, text, a.reps, [c for c in a.convs.split(",") if c], a.workers, rep_offset=a.rep_offset, tag=a.tag)
    print(f"{a.variant}: spent ${spent:.4f}")


if __name__ == "__main__":
    sys.exit(main())
