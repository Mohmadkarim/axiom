#!/usr/bin/env python3
"""Run JavaScript inside the Axiom simulator build (DEBUG) and print the result.
   python3 tools/simjs.py serve            # start the relay (keep running)
   python3 tools/simjs.py 'return document.title'"""
import sys, json, threading, time, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 8799
state = {"cmd": "", "result": None}
lock = threading.Lock()

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, body=b""):
        self.send_response(code); self.send_header("Content-Type", "text/plain"); self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        with lock:
            if self.path == "/cmd":
                c = state["cmd"]; state["cmd"] = ""; return self._send(200, c.encode())
            if self.path == "/take":
                r = state["result"]; state["result"] = None
                return self._send(200 if r is not None else 204, (r or "").encode())
        self._send(404)
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0))).decode()
        with lock:
            if self.path == "/result": state["result"] = body
            elif self.path == "/submit": state["cmd"] = body; state["result"] = None
        self._send(200)

if sys.argv[1:] == ["serve"]:
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
else:
    code = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read()
    urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{PORT}/submit", data=code.encode(), method="POST"))
    for _ in range(150):
        time.sleep(0.2)
        r = urllib.request.urlopen(f"http://127.0.0.1:{PORT}/take")
        if r.status == 200:
            out = r.read().decode()
            try: print(json.dumps(json.loads(json.loads(out) if out.startswith('"') else out), indent=1)[:20000])
            except Exception: print(out[:20000])
            sys.exit(0)
    print("timeout: is the simulator app (Debug build) running?"); sys.exit(1)
