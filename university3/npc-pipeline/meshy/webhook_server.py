#!/usr/bin/env python
"""Meshy webhook receiver. Meshy POSTs the full task object here on each status
change. On SUCCEEDED we download the GLB + texture maps. Runs on localhost;
exposed to the internet via a cloudflared quick-tunnel (HTTPS required by Meshy)."""
import json, os, sys, time, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "out")
EVENTS = os.path.join(OUT, "events.jsonl")
os.makedirs(OUT, exist_ok=True)
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8787


def _dl(url, path):
    try:
        urllib.request.urlretrieve(url, path)
        return os.path.getsize(path)
    except Exception as e:
        print(f"  [dl-fail] {path}: {e}", flush=True)
        return -1


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):  # quiet default logging
        pass

    def do_GET(self):  # health check for the tunnel
        self.send_response(200); self.end_headers(); self.wfile.write(b"ok")

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(n)
        self.send_response(200); self.end_headers(); self.wfile.write(b"ok")  # ack fast (<400)
        try:
            task = json.loads(raw)
        except Exception:
            print("[webhook] non-JSON body", flush=True); return
        with open(EVENTS, "a") as f:
            f.write(json.dumps({"t": time.time(), "task": task}) + "\n")
        tid = task.get("id", "?"); st = task.get("status"); pr = task.get("progress")
        print(f"[webhook] task={tid} status={st} progress={pr}", flush=True)
        if st == "SUCCEEDED":
            base = os.path.join(OUT, tid)
            urls = task.get("model_urls", {}) or {}
            if urls.get("glb"):
                sz = _dl(urls["glb"], base + ".glb")
                print(f"[webhook] downloaded GLB -> {base}.glb ({sz/1e6:.2f} MB)", flush=True)
            tex = task.get("texture_urls", []) or []
            for i, t in enumerate(tex):
                for k, u in (t or {}).items():
                    if isinstance(u, str) and u.startswith("http"):
                        _dl(u, f"{base}_tex{i}_{k}.png")
            open(base + ".task.json", "w").write(json.dumps(task, indent=2))
            print(f"[webhook] DONE {tid}", flush=True)


if __name__ == "__main__":
    print(f"[webhook] listening on :{PORT}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()
