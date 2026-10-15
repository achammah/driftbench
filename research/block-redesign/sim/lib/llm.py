"""Model clients with usage capture. Keys are read from the environment only, never printed or stored."""
import json, os, time, threading

# USD per 1M tokens, read 2026-10-14 (LEDGER.md header names the sources).
PRICES = {
    "claude-haiku-5-5": {"in": 0.10, "cache_read": 0.01, "cache_write": 0.125, "out": 0.50},
    "gpt-5.4-nano": {"in": 0.20, "cache_read": 0.02, "out": 1.25},
    "gemini-3.5-flash-lite": {"in": 0.30, "out": 2.50},
    "text-embedding-3-small": {"in": 0.02, "out": 0.0},
}

_lock = threading.Lock()
USAGE_LOG = os.environ.get("SIM_USAGE_LOG")  # jsonl path, one row per call


def record(model, tag, inp=0, out=0, cache_read=0, cache_write=0):
    p = PRICES[model]
    usd = (inp * p["in"] + out * p["out"] + cache_read * p.get("cache_read", p["in"])
           + cache_write * p.get("cache_write", p["in"])) / 1e6
    row = {"t": time.time(), "model": model, "tag": tag, "in": inp, "out": out,
           "cache_read": cache_read, "cache_write": cache_write, "usd": usd}
    if USAGE_LOG:
        with _lock, open(USAGE_LOG, "a") as f:
            f.write(json.dumps(row) + "\n")
    return usd


def retry(fn, tries=4):
    for i in range(tries):
        try:
            return fn()
        except Exception as e:  # provider errors: back off and retry, then raise
            if i == tries - 1:
                raise
            time.sleep(2 * (2 ** i))


_clients = {}


def anthropic_client():
    if "a" not in _clients:
        import anthropic
        _clients["a"] = anthropic.Anthropic(max_retries=3)
    return _clients["a"]


def openai_client():
    if "o" not in _clients:
        import openai
        _clients["o"] = openai.OpenAI(max_retries=3)
    return _clients["o"]


def gemini_client():
    if "g" not in _clients:
        from google import genai
        _clients["g"] = genai.Client()
    return _clients["g"]


OPENAI_SMALL = "gpt-5.4-nano"
GEMINI_SMALL = "gemini-3.5-flash-lite"


def chat(family, system, messages, tag, json_mode=False, max_tokens=2000):
    """One completion from a simulator-family model.
    messages: list of {"role": "user"|"assistant", "content": str}. Returns text."""
    if family == "O":
        def call():
            kw = dict(model=OPENAI_SMALL, messages=[{"role": "system", "content": system}] + messages,
                      max_completion_tokens=max_tokens, reasoning_effort=OPENAI_EFFORT)
            if json_mode:
                kw["response_format"] = {"type": "json_object"}
            return openai_client().chat.completions.create(**kw)
        r = retry(call)
        u = r.usage
        cached = getattr(getattr(u, "prompt_tokens_details", None), "cached_tokens", 0) or 0
        record(OPENAI_SMALL, tag, inp=u.prompt_tokens - cached, out=u.completion_tokens, cache_read=cached)
        return r.choices[0].message.content or ""
    if family == "G":
        from google.genai import types
        contents = [types.Content(role="user" if m["role"] == "user" else "model",
                                  parts=[types.Part(text=m["content"])]) for m in messages]
        cfg = types.GenerateContentConfig(system_instruction=system, temperature=1.0,
                                          max_output_tokens=max_tokens,
                                          thinking_config=types.ThinkingConfig(thinking_level=GEMINI_THINKING),
                                          response_mime_type="application/json" if json_mode else None)
        r = retry(lambda: gemini_client().models.generate_content(model=GEMINI_SMALL, contents=contents, config=cfg))
        u = r.usage_metadata
        out = (u.candidates_token_count or 0) + (u.thoughts_token_count or 0)
        record(GEMINI_SMALL, tag, inp=u.prompt_token_count or 0, out=out)
        return r.text or ""
    raise ValueError(family)


OPENAI_EFFORT = os.environ.get("SIM_OPENAI_EFFORT", "none")
GEMINI_THINKING = os.environ.get("SIM_GEMINI_THINKING", "minimal")


def embed(texts, tag):
    out = []
    for i in range(0, len(texts), 256):
        chunk = texts[i:i + 256]
        r = retry(lambda: openai_client().embeddings.create(model="text-embedding-3-small", input=chunk))
        record("text-embedding-3-small", tag, inp=r.usage.prompt_tokens)
        out.extend(d.embedding for d in r.data)
    return out


def usage_total(path):
    tot = {}
    if not os.path.exists(path):
        return tot
    for line in open(path):
        r = json.loads(line)
        t = tot.setdefault(r["model"], {"calls": 0, "in": 0, "out": 0, "cache_read": 0, "cache_write": 0, "usd": 0.0})
        t["calls"] += 1
        for k in ("in", "out", "cache_read", "cache_write", "usd"):
            t[k] += r[k]
    return tot
