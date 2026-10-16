"""Runs a job file on the shared live Acme agent, unchanged (research/block-redesign/shared/acme-live).

python run_shared.py <jobs.jsonl> <results.jsonl> <batch>

Resumable: a job whose id is already in the results file is never run again. Each result and its usage
row are appended as they land. Stops before a call once the lane total reaches 36 USD.
"""

from __future__ import annotations

import json
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent / "shared" / "acme-live"))
from acme_live.agent import AcmeLive  # noqa: E402

USAGE = HERE.parent / "data" / "usage.jsonl"
STOP_AT = 36.0
lock = threading.Lock()


def spent() -> float:
    if not USAGE.exists():
        return 0.0
    return sum(json.loads(l)["usd"] for l in USAGE.read_text().splitlines() if l.strip())


def main():
    jobs_path, results_path, batch = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
    jobs = [json.loads(l) for l in jobs_path.read_text().splitlines() if l.strip()]
    done = set()
    if results_path.exists():
        done = {json.loads(l)["id"] for l in results_path.read_text().splitlines() if l.strip()}
    todo = [j for j in jobs if j["id"] not in done]
    print(f"{len(jobs)} jobs, {len(done)} already done, {len(todo)} to run", flush=True)
    agent = AcmeLive()

    def run(job):
        with lock:
            if spent() >= STOP_AT:
                raise SystemExit("lane stop line reached")
        try:
            t = agent.respond(job["history"], job["text"], job["overrides"] or None)
            res = {"id": job["id"], "text": t["text"], "calls": t["calls"], "stop": t["stop"], "usage": t["usage"], "usd": t["usd"]}
        except Exception as e:  # a transport failure after the client's retries: recorded, not counted
            res = {"id": job["id"], "error": f"{type(e).__name__}: {e}"}
        with lock:
            if "usage" in res:
                u = res["usage"]
                row = {"batch": batch, "model": "claude-haiku-5-5", "input": u["in"] + u["cw"] + u["cr"],
                       "cachedInput": u["cr"], "output": u["out"], "usd": res["usd"]}
                with USAGE.open("a") as f:
                    f.write(json.dumps(row) + "\n")
            if "error" not in res:
                with results_path.open("a") as f:
                    f.write(json.dumps(res) + "\n")
            else:
                with results_path.with_suffix(".errors.jsonl").open("a") as f:
                    f.write(json.dumps(res) + "\n")

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(run, todo))
    print(f"done; lane total {spent():.4f} USD", flush=True)


if __name__ == "__main__":
    main()
