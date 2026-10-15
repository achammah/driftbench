"""M3.4: section mutants and meaning-preserving controls for the live Acme prompt (research prototype).

python mutants.py generate   -> mutants/<section>__<op>.md (whole prompt) + mutants/manifest.json + mutants/gen-log.jsonl
Operators per section: drop, negate, rephrase; controls ctl_punct, ctl_synonym. Plus pair mutants
(two-section faults, see H7 PREREG amendment 1): pair__<a>__<b>.md, each section negated as in its single mutant.
LLM operators use the OpenAI model below; the key is read inside the process, never printed.
"""

from __future__ import annotations

import json
import random
import re
import sys
from pathlib import Path

import yaml

from registry import load_src, render_sections

HERE = Path(__file__).parent
OUT = HERE / "mutants"
GEN_MODEL = "gpt-6-luna"
SEED = 1234
# USD per million tokens for the generator, filled from the provider's published price at run time.
GEN_PRICE = {"in": 0.10, "out": 0.50}  # gpt-6-luna standard, read 2026-10-14

PROMPTS = {
    "negate": (
        "You edit one section of a customer-service agent's system prompt for a mutation test. "
        "Rewrite the section body so that it instructs the OPPOSITE of its main rule (for example, 'always do X' "
        "becomes 'never do X', 'only after Y' becomes 'without waiting for Y', a stated fact becomes a different fact). "
        "Keep the same length and style, plain text, no heading. Return only the new body."
    ),
    "rephrase": (
        "You edit one section of a customer-service agent's system prompt. Rewrite the section body in different "
        "words with exactly the same meaning and the same instructions. Keep every quoted string, tool name, "
        "parameter value, number, phone number and email exactly as written. Plain text, no heading. Return only the new body."
    ),
    "ctl_synonym": (
        "You edit one section of a customer-service agent's system prompt for a null control. Replace exactly two "
        "ordinary words with close synonyms and change nothing else. Do not touch quoted strings, tool names, "
        "parameter values, numbers, phone numbers or emails. Return only the full body with the two words replaced."
    ),
}

PROTECTED = re.compile(r'"[^"]*"|\b[a-z]+_[a-z_]+\b|\+?\d[\d ]*\d|\b\d+\b|[\w.]+@[\w.]+')


def protected_tokens(text: str) -> list[str]:
    return sorted(set(m.group(0).strip() for m in PROTECTED.finditer(text)))


def ctl_punct(body: str) -> str:
    inside = False
    for i, ch in enumerate(body):
        if ch == '"':
            inside = not inside
        elif ch == "," and not inside:
            return body[:i] + body[i + 1:]
    i = body.rindex(".")
    return body[:i] + ";" + body[i + 1:]


def gate(op: str, old: str, new: str) -> str | None:
    if new.strip() == old.strip() or not new.strip():
        return "unchanged or empty"
    if new.lstrip().startswith("#"):
        return "heading in body"
    if op in ("rephrase", "ctl_synonym", "ctl_punct"):
        missing = [t for t in protected_tokens(old) if t not in new]
        if missing:
            return f"lost protected tokens: {missing[:5]}"
    if op == "ctl_synonym":
        ow, nw = old.split(), new.split()
        if len(ow) != len(nw):
            return f"word count changed {len(ow)}->{len(nw)}"
        diff = sum(a != b for a, b in zip(ow, nw))
        if not 1 <= diff <= 3:
            return f"{diff} words differ"
    return None


def llm(client, op: str, title: str, body: str, seed: int) -> tuple[str, dict]:
    r = client.chat.completions.create(
        model=GEN_MODEL,
        seed=seed,
        messages=[{"role": "system", "content": PROMPTS[op]},
                  {"role": "user", "content": f"Section title: {title}\nSection body:\n{body}"}],
    )
    u = r.usage
    text = r.choices[0].message.content.strip()
    # The generator sometimes echoes the input labels; keep only the body (attempt 1 failed on this).
    text = re.sub(r"^Section title:.*\n", "", text)
    text = re.sub(r"^Section body:\s*\n?", "", text).strip()
    return text, {"in": u.prompt_tokens, "out": u.completion_tokens}


def variant_text(src: dict, changes: dict[str, str | None]) -> str:
    secs = []
    for s in src["sections"]:
        if s["id"] in changes:
            if changes[s["id"]] is None:
                continue
            s = dict(s, body=changes[s["id"]])
        secs.append(s)
    return render_sections(secs)


def generate():
    import openai
    key = (Path.home() / ".nexus-secrets" / "openai.key").read_text().strip()
    client = openai.OpenAI(api_key=key, max_retries=5)
    src = load_src()
    OUT.mkdir(exist_ok=True)
    log = (OUT / "gen-log.jsonl").open("a")
    manifest = {"generator": GEN_MODEL, "seed": SEED, "variants": []}
    usage = {"in": 0, "out": 0, "calls": 0}
    bodies = {}
    for s in src["sections"]:
        body = s["body"].strip()
        for op in ["drop", "negate", "rephrase", "ctl_punct", "ctl_synonym"]:
            new, tries = None, []
            if op == "drop":
                new = None
            elif op == "ctl_punct":
                new = ctl_punct(body)
                why = gate(op, body, new)
                tries.append({"seed": None, "gate": why})
                assert why is None, (s["id"], why)
            else:
                for t in range(3):
                    cand, u = llm(client, op, s["title"], body, SEED + t)
                    usage["in"] += u["in"]; usage["out"] += u["out"]; usage["calls"] += 1
                    why = gate(op, body, cand)
                    tries.append({"seed": SEED + t, "gate": why, "text": cand, "usage": u})
                    if why is None:
                        new = cand
                        break
                if new is None:
                    log.write(json.dumps({"section": s["id"], "op": op, "tries": tries, "accepted": False}) + "\n")
                    manifest["variants"].append({"id": f"{s['id']}__{op}", "section": s["id"], "op": op, "status": "gate_failed"})
                    continue
            vid = f"{s['id']}__{op}"
            text = variant_text(src, {s["id"]: new})
            (OUT / f"{vid}.md").write_text(text)
            bodies[vid] = new
            log.write(json.dumps({"section": s["id"], "op": op, "tries": tries, "accepted": True, "body": new}) + "\n")
            manifest["variants"].append({"id": vid, "sections": [s["id"]], "op": op,
                                         "control": op.startswith("ctl_"), "status": "ok"})
    # Pair mutants (amendment 1): 20 pairs of local sections, seeded draw, both sections negated.
    local = [s["id"] for s in src["sections"] if s["scope"] == "local"]
    rng = random.Random(20261014)
    pairs = set()
    while len(pairs) < 20:
        a, b = sorted(rng.sample(local, 2))
        if f"{a}__negate" in bodies and f"{b}__negate" in bodies:
            pairs.add((a, b))
    for a, b in sorted(pairs):
        vid = f"pair__{a}__{b}"
        (OUT / f"{vid}.md").write_text(variant_text(src, {a: bodies[f"{a}__negate"], b: bodies[f"{b}__negate"]}))
        manifest["variants"].append({"id": vid, "sections": [a, b], "op": "pair_negate", "control": False, "status": "ok"})
    usage["usd"] = (usage["in"] * GEN_PRICE["in"] + usage["out"] * GEN_PRICE["out"]) / 1e6
    manifest["usage"] = usage
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1))
    ok = sum(v["status"] == "ok" for v in manifest["variants"])
    print(f"{ok} variants ok of {len(manifest['variants'])}; generator usage {usage}")


if __name__ == "__main__":
    if sys.argv[1:] == ["generate"]:
        generate()
