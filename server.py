#!/usr/bin/env python3
"""Local LLM Box Advisor: tiny stdlib server (default port 4949). Serves web/ and the data JSON."""
import http.server
import json
import os
import socketserver
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("LLM_ADVISOR_PORT", "4949"))


def bundle():
    wl = os.path.join(HERE, "data", "workload.json")
    if not os.path.exists(wl):
        subprocess.run([sys.executable, os.path.join(HERE, "analyze.py")], check=False)
    return {"workload": json.load(open(wl)), "research": json.load(open(os.path.join(HERE, "data", "research.json")))}


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=os.path.join(HERE, "web"), **k)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.log_date_time_string(), fmt % args))

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/api/health"):
            return self._json({"ok": True, "app": "llm-box-advisor"})
        if self.path.startswith("/api/data"):
            return self._json(bundle())
        if self.path.startswith("/api/refresh"):
            subprocess.run([sys.executable, os.path.join(HERE, "analyze.py")], check=False)
            return self._json(bundle())
        return super().do_GET()


class S(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    print(f"Local LLM Box Advisor on http://127.0.0.1:{PORT}")
    S(("127.0.0.1", PORT), H).serve_forever()
