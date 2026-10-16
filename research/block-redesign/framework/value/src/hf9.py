"""HF9: apply the fix each diagnosis names, to a copy of the Acme tool or prompt, and rerun.

python hf9.py run <arm> <set> [--limit N]     arms: base1 base2 desc resolve prompt; sets: target_a target_b controls
python hf9.py score

The agent is the shared live Acme agent (acme/acme_live, copied unchanged from research/block-phrasing),
claude-haiku-5-5, effort low, max_tokens 2048, at most 6 model calls per turn, system prompt cached. Each job
replays an H1 class realisation: the same teacher-forced history, customer text and forced tool results.
"""

from __future__ import annotations

import argparse
import copy
import json
import re
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from common import DATA, INPUTS, ROOT, append_jsonl, guard, read_jsonl, record

sys.path.insert(0, str(ROOT / "acme"))
from acme_live import tools as T  # noqa: E402
from oracle import exact_oracle  # noqa: E402

PROMPT_PATH = ROOT / "acme" / "prompt" / "acme-sales.md"
BASE_PROMPT = PROMPT_PATH.read_text()
LINE41_OLD = "If coverage_check returns found false, say you cannot find that address in the coverage map and ask for the street number, street name and town, for example 14 Harbor Road, Acmeville."
LINE41_NEW = "If coverage_check returns found false, say you cannot find that address in the coverage map and ask for the street number and street name, for example 14 Harbor Road."
DESC_OLD = "Check whether Acme home internet reaches a street address."
DESC_NEW = "Check whether Acme home internet reaches a street address. Give the street type in full, for example Road, not Rd."
ABBREV = {"rd": "road", "ln": "lane", "ave": "avenue", "av": "avenue", "st": "street", "wy": "way"}

assert LINE41_OLD in BASE_PROMPT
assert any(t["name"] == "coverage_check" and t["description"].startswith(DESC_OLD) for t in T.TOOL_DEFS)


def coverage_check_resolving(inp, data):
    """The resolver fix: expand street-type abbreviations, then the unchanged coverage_check."""
    if isinstance(inp, dict) and isinstance(inp.get("address"), str):
        words = re.split(r"(\W+)", inp["address"])
        inp = {**inp, "address": "".join(ABBREVIATIONS_SUB(w) for w in words)}
    return T.coverage_check(inp, data)


def ABBREVIATIONS_SUB(w: str) -> str:  # noqa: N802
    return ABBREV.get(w.lower(), w)


def arm_config(arm: str):
    tool_defs = copy.deepcopy(T.TOOL_DEFS)
    impl = dict(T.IMPL)
    prompt = BASE_PROMPT
    if arm == "desc":
        for t in tool_defs:
            if t["name"] == "coverage_check":
                t["description"] = t["description"].replace(DESC_OLD, DESC_NEW)
    elif arm == "resolve":
        impl["coverage_check"] = coverage_check_resolving
    elif arm == "prompt":
        prompt = BASE_PROMPT.replace(LINE41_OLD, LINE41_NEW)
    elif arm not in ("base1", "base2"):
        raise ValueError(arm)
    return tool_defs, impl, prompt


def call_tool(impl, name, inp, overrides):
    ov = (overrides or {}).get(name)
    if ov and "error" in ov:
        return False, ov["error"]
    if ov and "result" in ov:
        return True, ov["result"]
    if name not in impl:
        return False, f"unknown tool: {name}"
    try:
        return True, impl[name](inp, copy.deepcopy(T.SEED))
    except T.InvalidInput as e:
        return False, str(e)


class Agent:
    """acme_live.agent.AcmeLive.respond, with the tool definitions, tool code and prompt passed in."""

    def __init__(self, arm: str):
        import anthropic
        self.tool_defs, self.impl, self.system_text = arm_config(arm)
        self.client = anthropic.Anthropic(api_key=(Path.home() / ".nexus-secrets" / "anthropic-driftbench.key").read_text().strip(), max_retries=6)

    def respond(self, history, user_text, overrides, batch):
        messages = list(history) + [{"role": "user", "content": user_text}]
        calls, texts, stop = [], [], None
        for _ in range(6):
            guard()
            resp = self.client.messages.create(
                model="claude-haiku-5-5", max_tokens=2048,
                system=[{"type": "text", "text": self.system_text, "cache_control": {"type": "ephemeral"}}],
                tools=self.tool_defs, messages=messages, output_config={"effort": "low"},
            )
            u = resp.usage
            cr, cw = u.cache_read_input_tokens or 0, u.cache_creation_input_tokens or 0
            record(batch, "claude-haiku-5-5", (u.input_tokens or 0) + cr + cw, cr, u.output_tokens or 0, cw)
            stop = resp.stop_reason
            messages.append({"role": "assistant", "content": [b.model_dump(exclude_none=True) for b in resp.content]})
            results = []
            for b in resp.content:
                if b.type == "text":
                    texts.append(b.text)
                elif b.type == "tool_use":
                    ok, out = call_tool(self.impl, b.name, dict(b.input), overrides)
                    calls.append({"name": b.name, "input": dict(b.input), "ok": ok, "output" if ok else "error": out})
                    results.append({"type": "tool_result", "tool_use_id": b.id, "content": json.dumps(out) if ok else str(out), **({} if ok else {"is_error": True})})
            if not results:
                break
            messages.append({"role": "user", "content": results})
        return {"text": "\n".join(texts).strip(), "calls": calls, "stop": stop}


def job_sets() -> dict[str, list[tuple[dict, int]]]:
    jobs = read_jsonl(INPUTS / "jobs-class.jsonl")
    target_a = [(j, k) for j in jobs if j["block"] in ("B1", "B5", "B8") for k in range(3)]
    target_b = [(j, k) for j in jobs if j["block"] in ("B5", "B6") and "acmeville" not in j["text"].lower() for k in range(6)]
    controls = [(j, 0) for j in jobs if j["block"] in ("B2", "B3", "B4", "B7", "B9", "B10")]
    return {"target_a": target_a, "target_b": target_b, "controls": controls}


ARMS_FOR = {"target_a": ["base1", "desc", "resolve"], "target_b": ["base1", "prompt"], "controls": ["base1", "base2", "desc", "resolve", "prompt"]}


def run(arm: str, set_name: str, limit: int | None, workers: int = 8) -> None:
    out = DATA / "hf9" / f"results-{set_name}-{arm}.jsonl"
    done = {r["id"] for r in read_jsonl(out)}
    todo = [(j, k) for j, k in job_sets()[set_name] if f"{j['id']}|{k}" not in done]
    if limit:
        todo = todo[:limit]
    print(f"{set_name}/{arm}: {len(done)} done, {len(todo)} to run", flush=True)
    agent = Agent(arm)

    def go(jk):
        j, k = jk
        rid = f"{j['id']}|{k}"
        try:
            t = agent.respond(j["history"], j["text"], j["overrides"] or None, f"hf9-{set_name}-{arm}")
            append_jsonl(out, {"id": rid, "job": j["id"], "block": j["block"], "k": k, **t})
        except SystemExit:
            raise
        except Exception as e:  # noqa: BLE001  transport failure after retries: recorded, not counted, rerun
            append_jsonl(out.with_suffix(".errors.jsonl"), {"id": rid, "error": f"{type(e).__name__}: {e}"})

    with ThreadPoolExecutor(max_workers=workers) as pool:
        list(pool.map(go, todo))


LABELS = {"catalog_search": "catalog.search", "coverage_check": "coverage.check", "port_check": "port.check", "order_create": "order.create", "notify_sales": "notify_sales"}


def scored(set_name: str, arm: str) -> dict[str, dict]:
    out = {}
    for r in read_jsonl(DATA / "hf9" / f"results-{set_name}-{arm}.jsonl"):
        calls = [{"label": LABELS.get(c["name"], c["name"]), "input": c["input"], **({"output": c["output"]} if c["ok"] else {"error": c.get("error")})} for c in r["calls"]]
        failed = exact_oracle(r["block"], calls)
        cov = [c for c in calls if c["label"] == "coverage.check"]
        r3 = bool(failed) and any(isinstance(c.get("output"), dict) and c["output"].get("found") is False for c in cov)
        r6 = bool(failed) and not cov and "town" in r["text"].lower()
        out[r["id"]] = {"block": r["block"], "pass": not failed, "failed": failed, "r3": r3, "r6": r6,
                        "first_address": (cov[0]["input"].get("address") if cov and isinstance(cov[0]["input"], dict) else None)}
    return out


def rate(d: dict, key: str) -> tuple[int, int]:
    return sum(v[key] for v in d.values()), len(d)


def score() -> dict:
    res: dict = {}
    a = {arm: scored("target_a", arm) for arm in ARMS_FOR["target_a"]}
    base_r3, n_base = rate(a["base1"], "r3")
    res["a"] = {arm: {"r3": rate(d, "r3")[0], "n": len(d), "fail": sum(not v["pass"] for v in d.values()),
                      "per_block": {b: sum(v["r3"] for v in d.values() if v["block"] == b) for b in ("B1", "B5", "B8")}}
                for arm, d in a.items()}
    for arm in ("desc", "resolve"):
        r3, n = rate(a[arm], "r3")
        res["a"][arm]["removal"] = (1 - (r3 / n) / (base_r3 / n_base)) if base_r3 and n else None
    b = {arm: scored("target_b", arm) for arm in ARMS_FOR["target_b"]}
    b6, nb = rate(b["base1"], "r6")
    p6, np_ = rate(b["prompt"], "r6")
    res["b"] = {"base1": {"r6": b6, "n": nb}, "prompt": {"r6": p6, "n": np_},
                "removal": (1 - (p6 / np_) / (b6 / nb)) if b6 and np_ else None,
                "inconclusive": b6 < 5}
    c = {arm: scored("controls", arm) for arm in ARMS_FOR["controls"]}
    common = set.intersection(*(set(d) for d in c.values()))
    flips = sum(c["base1"][i]["pass"] != c["base2"][i]["pass"] for i in common)
    f = flips / len(common) if common else None
    fr = {arm: sum(not c[arm][i]["pass"] for i in common) / len(common) for arm in c} if common else {}
    res["controls"] = {"n": len(common), "rerun_flips": flips, "rerun_flip_rate": f, "fail_rate": fr,
                       "worsening": {arm: fr[arm] - fr["base1"] for arm in ("base2", "desc", "resolve", "prompt")} if common else {},
                       "per_block_fail": {arm: dict(Counter(c[arm][i]["block"] for i in common if not c[arm][i]["pass"])) for arm in c}}
    return res


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd")
    ap.add_argument("arm", nargs="?")
    ap.add_argument("set", nargs="?")
    ap.add_argument("--limit", type=int)
    a = ap.parse_args()
    if a.cmd == "run":
        run(a.arm, a.set, a.limit)
    elif a.cmd == "score":
        print(json.dumps(score(), indent=1))
    elif a.cmd == "sizes":
        print({k: len(v) for k, v in job_sets().items()})
