#!/usr/bin/env python3
"""Write dist/llm-box-advisor-snapshot.html: one self-contained file (UI + data), opens offline with no server."""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    subprocess.run([sys.executable, os.path.join(HERE, "analyze.py")], check=True, stdout=subprocess.DEVNULL)
    data = {"workload": json.load(open(os.path.join(HERE, "data", "workload.json"))),
            "research": json.load(open(os.path.join(HERE, "data", "research.json")))}
    web = os.path.join(HERE, "web")
    html = open(os.path.join(web, "index.html")).read()
    css = open(os.path.join(web, "style.css")).read()
    js = open(os.path.join(web, "app.js")).read()
    blob = json.dumps(data, separators=(",", ":"), ensure_ascii=False).replace("</", "<\\/")
    html = html.replace('<link rel="stylesheet" href="style.css">', f"<style>{css}</style>")
    html = html.replace('<script src="app.js"></script>',
                        f"<script>window.LLM_ADVISOR_SNAPSHOT={blob};</script>\n<script>{js}</script>")
    html = html.replace("<title>Local LLM Box Advisor", "<title>Local LLM Box Advisor (offline snapshot)")
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "dist", "llm-box-advisor-snapshot.html")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, "w").write(html)
    print(f"wrote {out} ({os.path.getsize(out) // 1024} KB)")


if __name__ == "__main__":
    main()
