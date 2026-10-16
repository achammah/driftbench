"""HF11 runner. Usage: python hf11/run.py OUTDIR [--pilot] [--blocks N].
Blocks: the H11 blocks that passed at least 13 of 16 H11 trials (H11 RESULTS per-block table), in order of
H11 pass count then id. Cells: terse-regular (en) and terse-regular-fr (fr); arms base, negate, drop;
5 trials. The en base cells are HF10's terse-regular trials 0 to 4 (same prompt, persona and seeds) and are
not re-run here."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from lib import runner

# H11 per-block pass count of 16 (O + G), descending, ties by id.
HF11_BLOCKS = [5440, 5795, 6798, 7279, 7321, 10341, 8032, 2062, 7860, 8196, 7077]
TRIALS = 5
ARMS = [("terse-regular-fr", "base"), ("terse-regular-fr", "negate"), ("terse-regular-fr", "drop"),
        ("terse-regular", "negate"), ("terse-regular", "drop")]
out, pilot = sys.argv[1], "--pilot" in sys.argv
nb = int(sys.argv[sys.argv.index("--blocks") + 1]) if "--blocks" in sys.argv else len(HF11_BLOCKS)
os.makedirs(out, exist_ok=True)
by_id = {b["convo_id"]: b for b in runner.h11_blocks()}
blocks = [by_id[i] for i in HF11_BLOCKS[:nb]]
if pilot:
    jobs = [(blocks[0], "terse-regular-fr", 0, "base"), (blocks[0], "terse-regular-fr", 0, "negate")]
    path = os.path.join(out, "hf11_pilot.jsonl")
else:
    jobs = [(b, p, t, rule) for t in range(TRIALS) for b in blocks for p, rule in ARMS]
    path = os.path.join(out, "hf11_runs.jsonl")
runner.run(jobs, path, "hf11-pilot" if pilot else "hf11", workers=int(os.environ.get("SIM_WORKERS", "8")))
