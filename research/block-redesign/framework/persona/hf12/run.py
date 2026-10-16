"""HF12 scorer (offline). Usage: python hf12/run.py OUT.json"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import loader

cases = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "cases.json")))
rows = []
for c in cases:
    r = loader.load(c)
    got = []
    if r["load_error"]:
        got.append({"type": "load_error", "class": r["load_error"]["class"]})
    got += [{k: n[k] for k in ("type", "block", "persona", "kind", "requirement")} for n in r["not_run"]]
    key = lambda e: json.dumps(e, sort_keys=True)
    exp = sorted(map(key, c["expect"]))
    obs = sorted(map(key, got))
    if c["planted"]:
        outcome = "caught" if obs == exp else ("wrong_reason" if obs else "missed")
    else:
        outcome = "false_refusal" if obs else "clean_ok"
    rows.append({"id": c["id"], "planted": c["planted"], "class": c["class"], "outcome": outcome,
                 "expected": c["expect"], "got": got,
                 "message": (r["load_error"] or {}).get("message")})
planted = [r for r in rows if r["planted"]]
clean = [r for r in rows if not r["planted"]]
by_class = {}
for r in planted:
    d = by_class.setdefault(r["class"], {"n": 0, "caught": 0})
    d["n"] += 1
    d["caught"] += r["outcome"] == "caught"
caught = sum(r["outcome"] == "caught" for r in planted)
false_ref = sum(r["outcome"] == "false_refusal" for r in clean)
res = {"planted": len(planted), "caught": caught, "clean": len(clean), "false_refusals": false_ref,
       "by_class": by_class, "verdict": "SUPPORTED" if caught == len(planted) == 30 and false_ref == 0 and len(clean) == 30 else "FALSIFIED",
       "cases": rows}
json.dump(res, open(sys.argv[1], "w"), indent=1)
print(json.dumps({k: v for k, v in res.items() if k != "cases"}, indent=1))
for r in rows:
    if r["outcome"] not in ("caught", "clean_ok"):
        print(r["id"], r["outcome"], "expected", r["expected"], "got", r["got"], r["message"])
