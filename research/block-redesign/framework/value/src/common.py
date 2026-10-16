"""Shared paths, the usage log, the spend guard and the two non-Anthropic model clients.

Keys are read inside the process from ~/.nexus-secrets and never printed or written.
Every paid call appends one row to data/usage.jsonl; LEDGER.md is computed from it (ledger.py).
"""

from __future__ import annotations

import json
import random
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DATA = ROOT / "data"
INPUTS = ROOT / "inputs"
USAGE = DATA / "usage.jsonl"
CAP = 12.0
STOP_AT = 10.8  # 90% of the lane cap

# USD per million tokens. OpenAI: developers.openai.com/api/docs/pricing, read 2026-10-15 (standard, short context).
# Google: ai.google.dev/gemini-api/docs/pricing, read 2026-10-15 (standard paid tier; output includes thinking).
# Anthropic: platform.claude.com/docs/en/about-claude/pricing (as acme_live/agent.py), cache write 1.25x input.
PRICES = {
    "gpt-6-luna": {"in": 0.10, "cached": 0.01, "out": 0.50},
    "gpt-6.1-sol": {"in": 2.00, "cached": 0.10, "out": 10.00},
    "gemini-3.6-flash": {"in": 0.75, "cached": 0.075, "out": 3.75},
    "claude-haiku-5-5": {"in": 0.10, "cached": 0.01, "out": 0.50, "cw": 0.125},
}

_lock = threading.Lock()


def usd(model: str, inp: int, cached: int, out: int, cw: int = 0) -> float:
    p = PRICES[model]
    return ((inp - cached - cw) * p["in"] + cached * p["cached"] + out * p["out"] + cw * p.get("cw", p["in"])) / 1e6


def spent() -> float:
    if not USAGE.exists():
        return 0.0
    return sum(json.loads(l)["usd"] for l in USAGE.read_text().splitlines() if l.strip())


class BudgetStop(SystemExit):
    pass


def guard() -> None:
    with _lock:
        if spent() >= STOP_AT:
            raise BudgetStop(f"lane stop line reached ({STOP_AT} USD)")


def record(batch: str, model: str, inp: int, cached: int, out: int, cw: int = 0) -> float:
    cost = usd(model, inp, cached, out, cw)
    row = {"batch": batch, "model": model, "input": inp, "cachedInput": cached, "cacheWrite": cw, "output": out, "usd": cost, "t": time.time()}
    with _lock:
        DATA.mkdir(parents=True, exist_ok=True)
        with USAGE.open("a") as f:
            f.write(json.dumps(row) + "\n")
    return cost


def _key(name: str) -> str:
    return (Path.home() / ".nexus-secrets" / name).read_text().strip()


def _post(url: str, headers: dict, body: dict, timeout: int = 120) -> tuple[int, dict]:
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={**headers, "Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:  # noqa: BLE001
            return e.code, {"error": {"message": f"HTTP {e.code}"}}
    except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
        return 599, {"error": {"message": f"{type(e).__name__}: {e}"}}


def openai_json(batch: str, model: str, system: str, user: str, seed: int, effort: str = "low") -> dict:
    """One chat-completions call answering a JSON object. Usage is recorded whatever the outcome."""
    guard()
    for attempt in range(1, 6):
        status, body = _post(
            "https://api.openai.com/v1/chat/completions",
            {"Authorization": f"Bearer {_key('openai.key')}"},
            {"model": model, "seed": seed, "reasoning_effort": effort, "response_format": {"type": "json_object"},
             "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]},
        )
        u = body.get("usage")
        if u:
            record(batch, model, u["prompt_tokens"], (u.get("prompt_tokens_details") or {}).get("cached_tokens", 0) or 0, u["completion_tokens"])
        if status == 200 and body.get("choices"):
            text = body["choices"][0]["message"]["content"]
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                if attempt < 3:
                    continue
                raise RuntimeError(f"openai non-JSON: {text[:200]}")
        if status in (429, 500, 502, 503, 504, 599) and attempt < 5:
            time.sleep(2 * attempt + random.random())
            continue
        raise RuntimeError(f"openai {status}: {(body.get('error') or {}).get('message', 'no choice')}")
    raise RuntimeError("openai: retries exhausted")


def gemini_json(batch: str, model: str, system: str, user: str, seed: int, thinking: str = "low") -> dict:
    """One generateContent call answering a JSON object. Usage is recorded whatever the outcome."""
    guard()
    for attempt in range(1, 6):
        status, body = _post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
            {"x-goog-api-key": _key("gemini-driftbench.key")},
            {"systemInstruction": {"parts": [{"text": system}]},
             "contents": [{"role": "user", "parts": [{"text": user}]}],
             "generationConfig": {"responseMimeType": "application/json", "seed": seed,
                                  "thinkingConfig": {"thinkingLevel": thinking}}},
        )
        u = body.get("usageMetadata")
        if u:
            out = (u.get("candidatesTokenCount", 0) or 0) + (u.get("thoughtsTokenCount", 0) or 0)
            record(batch, model, u.get("promptTokenCount", 0) or 0, u.get("cachedContentTokenCount", 0) or 0, out)
        if status == 200 and body.get("candidates"):
            parts = (body["candidates"][0].get("content") or {}).get("parts") or []
            text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                if attempt < 3:
                    continue
                raise RuntimeError(f"gemini non-JSON: {text[:200]}")
        if status in (429, 500, 502, 503, 504, 599) and attempt < 5:
            time.sleep(3 * attempt + random.random())
            continue
        raise RuntimeError(f"gemini {status}: {(body.get('error') or {}).get('message', 'no candidate')}")
    raise RuntimeError("gemini: retries exhausted")


def model_json(batch: str, model: str, system: str, user: str, seed: int) -> dict:
    if model.startswith("gemini"):
        return gemini_json(batch, model, system, user, seed)
    return openai_json(batch, model, system, user, seed)


def read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(l) for l in path.read_text().splitlines() if l.strip()]


def append_jsonl(path: Path, row: dict) -> None:
    with _lock:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a") as f:
            f.write(json.dumps(row) + "\n")
