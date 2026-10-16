"""M3.1: section registry and anchored re-anchoring for the live Acme prompt (research prototype).

render(src)      -> (prompt_text, registry) where registry lists each section's span, sha256 and anchor.
reanchor(reg, new_text) -> {section_id: ("same_hash"|"quote"|"window"|"stale", new_span|None)}
Offsets: UTF-16 code units after NFC and CRLF/CR -> LF, end exclusive (driftbench's radius unit).

`python registry.py build` writes prompt/acme-sales.md and prompt/acme-sales.sections.yaml.
`python registry.py battery` runs the M3.1 sanity battery (offline, seeded).
"""

from __future__ import annotations

import hashlib
import json
import random
import sys
import unicodedata
from pathlib import Path

import yaml

HERE = Path(__file__).parent
SRC = HERE / "prompt" / "acme-sales.src.yaml"
WINDOW = 32


def normalise(text: str) -> str:
    return unicodedata.normalize("NFC", text.replace("\r\n", "\n").replace("\r", "\n"))


def u16(text: str, i: int) -> int:
    return len(text[:i].encode("utf-16-le")) // 2


def sha(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def section_text(sec: dict) -> str:
    return f"## {sec['title']}\n{sec['body'].strip()}\n"


def render_sections(sections: list[dict]) -> str:
    return normalise("\n".join(section_text(s) for s in sections))


def load_src(path: Path = SRC) -> dict:
    return yaml.safe_load(path.read_text())


def build_registry(src: dict, text: str | None = None) -> tuple[str, dict]:
    sections = src["sections"]
    text = text if text is not None else render_sections(sections)
    reg = {
        "prompt_id": src["prompt_id"],
        "version": src["version"],
        "normalisation": "NFC; CRLF/CR->LF; offsets in UTF-16 code units; end exclusive",
        "text_sha256": sha(text),
        "sections": [],
    }
    pos = 0
    for s in sections:
        st = section_text(s)
        i = text.index(st, pos)
        j = i + len(st)
        pos = j
        quote = s["body"].strip().split(". ")[0][:80]
        assert text.count(quote) == 1, f"quote not unique for {s['id']}"
        q = text.index(quote)
        reg["sections"].append({
            "id": s["id"],
            "title": s["title"],
            "kind": s["kind"],
            "scope": s["scope"],
            "span": {"start": u16(text, i), "end": u16(text, j)},
            "sha256": sha(st),
            "anchor": {"quote": quote, "prefix": text[max(0, q - WINDOW):q], "suffix": text[q + len(quote):q + len(quote) + WINDOW]},
            "references": s.get("references", []),
            "overrides": s.get("overrides", []),
            "duplicates": s.get("duplicates", []),
            "_cp": [i, j],  # code-point span, internal
        })
    return text, reg


def reanchor(reg: dict, old_text: str, new_text: str) -> dict:
    """Re-anchor each section on a new prompt text. Order: same hash at new offsets, unique quote,
    prefix+suffix window, else stale. Returns id -> (method, (start, end) in code points or None)."""
    new_text = normalise(new_text)
    out = {}
    for s in reg["sections"]:
        i, j = s["_cp"]
        body = old_text[i:j]
        # 1. same hash anywhere (unique)
        if new_text.count(body) == 1:
            k = new_text.index(body)
            out[s["id"]] = ("same_hash", (k, k + len(body)))
            continue
        a = s["anchor"]
        # 2. unique quote: section survives only if its full text is unchanged around it -> hash differs, so stale
        #    unless the quote is found and the section text re-derived matches the old hash.
        if new_text.count(a["quote"]) == 1:
            out[s["id"]] = ("stale", None)  # quote found but section hash changed: edited inside
            continue
        # 3. prefix + suffix window
        win = a["prefix"] + a["quote"] + a["suffix"]
        if new_text.count(win) == 1:
            out[s["id"]] = ("stale", None)
            continue
        out[s["id"]] = ("stale", None)
    return out


def battery(seed: int = 7, n: int = 50) -> dict:
    """M3.1 sanity check: 50 edits each of insert-before, delete-elsewhere, whitespace reflow, edit-inside.
    Untouched sections must re-anchor (100%, 0 wrong); the edited section must come out stale."""
    src = load_src()
    text, reg = build_registry(src)
    rng = random.Random(seed)
    ids = [s["id"] for s in reg["sections"]]
    spans = {s["id"]: s["_cp"] for s in reg["sections"]}
    res = {}
    for kind in ["insert_before", "delete_elsewhere", "reflow_whitespace", "edit_inside"]:
        ok = wrong = stale_hit = stale_needed = untouched = 0
        for _ in range(n):
            target = rng.choice(ids)
            i, j = spans[target]
            if kind == "insert_before":
                new = text[:i] + "## Note\nAcme staff wear green shirts.\n\n" + text[i:]
                edited = set()
            elif kind == "delete_elsewhere":
                # delete one whole section other than the ones we check
                new = text[:i] + text[j + 1:]
                edited = {target}  # deleted: must not anchor
            elif kind == "reflow_whitespace":
                # whitespace outside every section body: blank line between sections doubled
                new = text[:i] + "\n" + text[i:]
                edited = set()
            else:
                body = text[i:j]
                words = body.split(" ")
                w = rng.randrange(2, len(words))
                words[w] = words[w] + " really"
                new = text[:i] + " ".join(words) + text[j:]
                edited = {target}
            got = reanchor(reg, text, new)
            for sid in ids:
                method, span = got[sid]
                if sid in edited:
                    stale_needed += 1
                    stale_hit += method == "stale"
                    continue
                untouched += 1
                if method == "stale":
                    continue
                a, b = span
                if new[a:b] == text[spans[sid][0]:spans[sid][1]]:
                    ok += 1
                else:
                    wrong += 1
        res[kind] = {"untouched": untouched, "reanchored": ok, "wrong": wrong,
                     "edited_sections": stale_needed, "edited_stale": stale_hit}
    return res


def citations_unit_check() -> dict:
    """Offline half of the non-ASCII check: UTF-16 vs code-point offsets on accents and an emoji."""
    t = normalise("Café résumé \U0001F600 ## Refunds\nRefunds within 30 days.")
    q = "Refunds within"
    cp = t.index(q)
    return {"code_point_start": cp, "utf16_start": u16(t, cp), "differs": cp != u16(t, cp)}


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "build"
    if cmd == "build":
        src = load_src()
        text, reg = build_registry(src)
        (HERE / "prompt" / "acme-sales.md").write_text(text)
        out = json.loads(json.dumps(reg))
        for s in out["sections"]:
            s.pop("_cp")
        (HERE / "prompt" / "acme-sales.sections.yaml").write_text(
            "# M3.1 registry, generated by registry.py from acme-sales.src.yaml. Do not edit by hand.\n"
            + yaml.safe_dump(out, sort_keys=False, width=200))
        print(f"{len(reg['sections'])} sections, {len(text)} chars, sha {reg['text_sha256'][:12]}")
    elif cmd == "battery":
        print(json.dumps({"battery": battery(), "utf16": citations_unit_check()}, indent=1))
