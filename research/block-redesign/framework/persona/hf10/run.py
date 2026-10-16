"""HF10 runner. Usage: python hf10/run.py OUTDIR [--pilot]. 20 blocks x 4 persona ids x 8 trials, base prompt."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from lib import runner

PERSONAS = ["terse-regular", "chatty-newcomer", "persistent-skeptic", "terse-regular-aa"]
out, pilot = sys.argv[1], "--pilot" in sys.argv
os.makedirs(out, exist_ok=True)
blocks = runner.h11_blocks()
if pilot:
    jobs = [(b, p, 0, "base") for b in blocks[:2] for p in PERSONAS]
    path = os.path.join(out, "hf10_pilot.jsonl")
else:
    jobs = [(b, p, t, "base") for t in range(8) for b in blocks for p in PERSONAS]
    path = os.path.join(out, "hf10_runs.jsonl")
runner.run(jobs, path, "hf10-pilot" if pilot else "hf10", workers=int(os.environ.get("SIM_WORKERS", "8")))
