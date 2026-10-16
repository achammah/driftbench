"""HF9 secondary analyses. Both are outside every verdict and were added after the data (RESULTS.md, Deviations).

python hf9_secondary.py      prints both and writes data/hf9_controls_ladder.json

1. secondary_controls_ladder: the 150 control jobs scored with the value-check ladder (ladder.py) instead of the
   exact oracle. The rung 3 judge answers come from data/judge_cache.jsonl; a missing answer stops the script
   (it makes no model call).
2. secondary_b_no_call_any_wording: in target B, the failing runs that make no coverage.check call at all,
   whatever the reply says, against the registered measure (no call and the reply asks for the town).

analyse.py hf9 adds both to results.json under HF9.
"""

from __future__ import annotations

import json
from collections import Counter

import judges
from common import DATA, read_jsonl
from hf9 import ARMS_FOR, LABELS
from oracle import exact_oracle


def _refuse(*_args, **_kwargs):
    raise RuntimeError("judge cache miss: this analysis makes no model call")


judges.model_json = _refuse  # the committed cache holds every answer; a miss is an error, never a paid call
import ladder  # noqa: E402  (after the patch: ladder imports the judge lazily)


def runs(set_name: str, arm: str) -> dict[str, dict]:
    out = {}
    for r in read_jsonl(DATA / "hf9" / f"results-{set_name}-{arm}.jsonl"):
        calls = [{"label": LABELS.get(c["name"], c["name"]), "input": c["input"],
                  **({"output": c["output"]} if c["ok"] else {"error": c.get("error")})} for c in r["calls"]]
        out[r["id"]] = {"block": r["block"], "calls": calls}
    return out


def no_call_any_wording() -> dict:
    res = {}
    for arm in ARMS_FOR["target_b"]:
        d = runs("target_b", arm)
        none = sum(1 for v in d.values() if exact_oracle(v["block"], v["calls"]) and not any(c["label"] == "coverage.check" for c in v["calls"]))
        res[arm] = {"no_coverage_call": none, "n": len(d)}
    base, prompt = res["base1"], res["prompt"]
    res["removal_no_call"] = (1 - (prompt["no_coverage_call"] / prompt["n"]) / (base["no_coverage_call"] / base["n"])) if base["no_coverage_call"] else None
    return res


def controls_ladder() -> dict:
    arms = {arm: runs("controls", arm) for arm in ARMS_FOR["controls"]}
    common = sorted(set.intersection(*(set(d) for d in arms.values())))
    scores = {arm: {i: ladder.score(arms[arm][i]) for i in common} for arm in arms}
    fail = {arm: sum(not s["pass"] for s in scores[arm].values()) for arm in arms}
    flips = sum(scores["base1"][i]["pass"] != scores["base2"][i]["pass"] for i in common)
    rate = {arm: fail[arm] / len(common) for arm in arms}
    return {
        "n": len(common),
        "rerun_flips_ladder": flips,
        "rerun_flip_rate_ladder": flips / len(common),
        "fail_rate_ladder": rate,
        "inconclusive": {arm: sum(any(f.get("settles") == "inconclusive" for f in s["fields"]) for s in scores[arm].values()) for arm in arms},
        "fail_by_block": {arm: dict(Counter(arms[arm][i]["block"] for i in common if not scores[arm][i]["pass"])) for arm in arms},
        "worsening_ladder": {arm: rate[arm] - rate["base1"] for arm in arms},
    }


def secondary() -> dict:
    return {"secondary_b_no_call_any_wording": no_call_any_wording(), "secondary_controls_ladder": controls_ladder()}


if __name__ == "__main__":
    out = secondary()
    (DATA / "hf9_controls_ladder.json").write_text(json.dumps(out["secondary_controls_ladder"], indent=1) + "\n")
    print(json.dumps(out, indent=1))
