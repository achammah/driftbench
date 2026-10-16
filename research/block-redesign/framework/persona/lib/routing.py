"""Route a prompt-unit change to persona-grid cells (config_framework.md 2.5, simuser_model.md 4.1).

A global unit linked to a persona field F selects the cells whose persona's F differs from the prompt's
default value of F: the unit only changes behaviour for users the prompt's default does not already serve.
A unit with no link selects every cell (an unknown change selects the whole suite, change.ts:13)."""
import json


def select(links_doc, unit, cells):
    """cells: list of (block, persona dict). Returns the set of (block, persona id) selected."""
    rows = [l for l in links_doc["links"] if l["unit"] == unit]
    if not rows:
        return {(b, p["id"]) for b, p in cells}
    out = set()
    for l in rows:
        if l["scope"] == "global" and l.get("persona_field"):
            f = l["persona_field"]
            default = links_doc["prompt_defaults"].get(f)
            out |= {(b, p["id"]) for b, p in cells if p.get(f) != default}
        else:
            out |= {(b, p["id"]) for b, p in cells}
    return out


def load(path):
    return json.load(open(path))
