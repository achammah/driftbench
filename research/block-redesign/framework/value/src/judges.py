"""Two same-referent judge designs (value_equivalence.md section 3, rung 3), on any non-Anthropic model.

side_by_side: one call sees the field, the reference (gold) value and the candidate value, and answers same or not.
read_first: each value is read ALONE first (one call per value, never seeing the other); code compares the two
readings; only when the readings differ does a second call compare the two readings (not the raw values).

Every call is cached in data/judge_cache.jsonl by (design, model, kind, inputs, repeat), so a rerun reuses it.
"""

from __future__ import annotations

import hashlib
import json
import threading

from common import DATA, append_jsonl, model_json, read_jsonl

CACHE_PATH = DATA / "judge_cache.jsonl"
_cache: dict[str, dict] | None = None
_lock = threading.Lock()
_key_locks: dict[str, threading.Lock] = {}

SBS_SYSTEM = (
    "You check whether a candidate value names the same real-world thing as a reference value, for one field of a "
    "record. Differences in writing only (spacing, punctuation, case, a country code, a common abbreviation) do not "
    "change the thing named. A different digit, letter, number or person does. A value with no content (empty, a "
    "placeholder, the field's name, a stray word) names nothing and is never the same. "
    'Answer JSON only: {"same": true or false, "why": "<at most 15 words>"}'
)

READ_SYSTEM = (
    "You read one value written into one field of a record and say what it refers to, in the field's terms. "
    "You see this value only. Write the thing it names in the most standard complete written form for that kind "
    "of field, with no comment. If the value has no content (empty, a placeholder such as N/A or unknown, the "
    "field's name, punctuation, a stray phrase), say so. "
    'Answer JSON only: {"has_content": true or false, "reading": "<the standard form>" or null}'
)

CMP_SYSTEM = (
    "Two readings of values written into the same field are given. Each reading says what one value refers to. "
    "Decide whether both readings name the same real-world thing. Different wording of the same thing is the same; "
    "a different digit, letter, number or person is not. "
    'Answer JSON only: {"same": true or false, "why": "<at most 15 words>"}'
)


def _load() -> dict:
    global _cache
    if _cache is None:
        _cache = {r["key"]: r["value"] for r in read_jsonl(CACHE_PATH)}
    return _cache


def _cached(key_parts: dict, batch: str, model: str, system: str, user: str, seed: int) -> dict:
    key = hashlib.sha256(json.dumps(key_parts, sort_keys=True).encode()).hexdigest()
    cache = _load()
    with _lock:
        if key in cache:
            return cache[key]
        key_lock = _key_locks.setdefault(key, threading.Lock())
    with key_lock:  # one call per key, even when two threads ask for it at once
        with _lock:
            if key in cache:
                return cache[key]
        value = model_json(batch, model, system, user, seed)
        append_jsonl(CACHE_PATH, {"key": key, "parts": key_parts, "value": value})
        with _lock:
            cache[key] = value
    return value


def side_by_side(batch: str, model: str, field_desc: str, gold: str, cand: str, order: int, repeat: int) -> bool:
    first, second = (("Reference value", gold), ("Candidate value", cand)) if order == 1 else (("Candidate value", cand), ("Reference value", gold))
    user = f"Field: {field_desc}\n{first[0]}: {json.dumps(first[1])}\n{second[0]}: {json.dumps(second[1])}\nDoes the candidate name the same thing as the reference?"
    v = _cached({"d": "sbs", "m": model, "f": field_desc, "g": gold, "c": cand, "o": order, "r": repeat},
                batch, model, SBS_SYSTEM, user, 7100 + repeat)
    return bool(v.get("same")) is True


def read_value(batch: str, model: str, field_desc: str, value: str, repeat: int) -> dict:
    user = f"Field: {field_desc}\nValue: {json.dumps(value)}"
    return _cached({"d": "read", "m": model, "f": field_desc, "v": value, "r": repeat}, batch, model, READ_SYSTEM, user, 7200 + repeat)


def _canon(s) -> str:
    return " ".join(str(s).lower().split()).strip(" .,;")


def read_first(batch: str, model: str, field_desc: str, gold: str, cand: str, order: int, repeat: int) -> dict:
    """Returns {same: bool, compared: bool, readings: [...]}. `order` only matters for the compare call."""
    rg = read_value(batch, model, field_desc, gold, repeat)
    rc = read_value(batch, model, field_desc, cand, repeat)
    if not rg.get("has_content") or not rc.get("has_content") or not rg.get("reading") or not rc.get("reading"):
        return {"same": False, "compared": False, "readings": [rg, rc]}
    if _canon(rg["reading"]) == _canon(rc["reading"]):
        return {"same": True, "compared": False, "readings": [rg, rc]}
    a, b = (rg["reading"], rc["reading"]) if order == 1 else (rc["reading"], rg["reading"])
    user = f"Field: {field_desc}\nReading 1: {json.dumps(a)}\nReading 2: {json.dumps(b)}\nDo both readings name the same thing?"
    v = _cached({"d": "cmp", "m": model, "f": field_desc, "a": a, "b": b, "r": repeat}, batch, model, CMP_SYSTEM, user, 7300 + repeat)
    return {"same": bool(v.get("same")) is True, "compared": True, "readings": [rg, rc]}
