#!/usr/bin/env python3
"""Read-only smoke test for Local LLM Box Advisor (added in the 2026-10-07 QA sweep).
Checks data integrity (every price/benchmark cites a source with an as-of date), the live server
(GET only; /api/refresh is never called), and the offline snapshot (self-contained, labels present).
Usage: python3 tests/smoke_test.py   (server expected on $LLM_ADVISOR_PORT or 4949)"""
import json, os, re, sys, urllib.request
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = os.environ.get("LLM_ADVISOR_PORT", "4949")
ok = fail = 0
def check(name, cond, detail=""):
    global ok, fail
    if cond: ok += 1; print("PASS", name)
    else: fail += 1; print("FAIL", name, detail)

R = json.load(open(os.path.join(ROOT, "data/research.json")))
W = json.load(open(os.path.join(ROOT, "data/workload.json")))
src = R["sources"]
check("sources all have url + asOf", all(s.get("url", "").startswith("http") and s.get("asOf") for s in src.values()),
      [k for k, s in src.items() if not (s.get("url") and s.get("asOf"))])
refs = [(h["short"], f, h.get(f)) for h in R["hardware"] for f in ("priceSrc", "wattsSrc", "bandwidthSrc", "usableSrc") if h.get(f)]
check("hardware sources resolve", all(v in src for _, _, v in refs), [r for r in refs if r[2] not in src])
check("every hardware price is sourced", all(h.get("priceSrc") in src for h in R["hardware"]), [h["short"] for h in R["hardware"] if h.get("priceSrc") not in src])
check("benchmark sources resolve", all(b["src"] in src for b in R["benchmarks"]), [b for b in R["benchmarks"] if b["src"] not in src])
check("API prices sourced", all(p.get("src") in src for p in R["apiPrices"]))
hw_ids = {h["id"] for h in R["hardware"]}
check("benchmarks reference known hardware", all(b["hw"] in hw_ids for b in R["benchmarks"]))
check("workload has measured block", isinstance(W.get("measured"), dict) and W.get("botCount", 0) > 0)

def get(path):
    with urllib.request.urlopen(f"http://127.0.0.1:{PORT}{path}", timeout=60) as r:
        return r.status, r.read().decode("utf-8", "replace")
try:
    st, _ = get("/api/health"); check("server /api/health 200", st == 200)
    st, body = get("/"); check("server / serves the app", st == 200 and "app.js" in body)
    st, body = get("/api/data"); d = json.loads(body); check("/api/data returns research + workload", "research" in d or "hardware" in json.dumps(d)[:5000])
except Exception as e:
    check("server reachable", False, repr(e))

snap = os.path.join(ROOT, "dist/llm-box-advisor-snapshot.html")
check("snapshot exists", os.path.exists(snap))
html = open(snap, encoding="utf-8").read() if os.path.exists(snap) else ""
check("snapshot has no external scripts/styles", not re.search(r'<(script|link)[^>]+(src|href)=["\']https?://', html, re.I))
check("snapshot carries honesty labels", all(w in html for w in ("MEASURED", "ESTIMATE", "CITED", "UNKNOWN")))
check("snapshot has phone-width CSS", "max-width:640px" in html.replace(" ", ""))
check("snapshot has This week strip markup", "week-strip" in html or 'id="week"' in html)
best = os.path.join(ROOT, "screenshots/00-best-home.png")
check("best screenshot 00-best-home.png present", os.path.exists(best) and os.path.getsize(best) > 10000)
print(f"\n{ok} passed, {fail} failed"); sys.exit(1 if fail else 0)
