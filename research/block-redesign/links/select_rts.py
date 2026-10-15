"""M3.5: section-level regression test selection (rule D2 of deep_3), research prototype.

selected(changed_sections) -> set of block ids. Global change selects every block; otherwise the reverse
closure over `references` and `overrides` edges, then every block with a declared link into it. A block
with no link record is always selected.
"""

from __future__ import annotations

from pathlib import Path

import yaml

HERE = Path(__file__).parent


def load_registry():
    return yaml.safe_load((HERE / "prompt" / "acme-sales.sections.yaml").read_text())


def closure(changed: set, reg: dict) -> set:
    """changed plus every section that references or overrides a member, transitively."""
    out = set(changed)
    grew = True
    while grew:
        grew = False
        for s in reg["sections"]:
            if s["id"] in out:
                continue
            if set(s.get("references", [])) & out or set(s.get("overrides", [])) & out:
                out.add(s["id"])
                grew = True
    return out


def selected(changed: set, reg: dict, suite: dict) -> set:
    scope = {s["id"]: s["scope"] for s in reg["sections"]}
    blocks = [b for c in suite["conversations"] for b in c["blocks"]]
    if any(scope[s] == "global" for s in changed):
        return {b["id"] for b in blocks}
    cl = closure(changed, reg)
    return {b["id"] for b in blocks if "links" not in b or set(b["links"]) & cl}
