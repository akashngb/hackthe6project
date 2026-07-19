import http.server, json, time, uuid
GLB = '/private/tmp/claude-501/-Users-larry-hackthe6project--claude-worktrees-university-hallway-walking-collision-ef254f/63d0550f-16ce-48c9-bf7b-e60eeb946264/scratchpad/webtest/friend-larry.glb'
JOBS = {}
class H(http.server.BaseHTTPRequestHandler):
    def _hdr(self, code, ctype='application/json'):
        self.send_response(code)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Content-Type', ctype)
        self.end_headers()
    def do_OPTIONS(self):
        self._hdr(200)
    def do_POST(self):
        if self.path == '/npc/generate':
            self.rfile.read(int(self.headers.get('Content-Length', 0)))
            jid = uuid.uuid4().hex[:8]
            JOBS[jid] = time.time()
            self._hdr(200)
            self.wfile.write(json.dumps({'job_id': jid, 'status': 'queued'}).encode())
        else:
            self._hdr(404)
    def do_GET(self):
        if self.path.startswith('/npc/status/'):
            jid = self.path.split('/')[-1]
            t = JOBS.get(jid)
            if t is None:
                self._hdr(404); self.wfile.write(b'{"error":"no job"}'); return
            el = time.time() - t
            if el > 12:
                self._hdr(200); self.wfile.write(json.dumps({'status': 'SUCCEEDED', 'download_url': f'/npc/download/{jid}'}).encode())
            else:
                self._hdr(200); self.wfile.write(json.dumps({'status': 'IN_PROGRESS', 'stage': 'meshing', 'progress': int(el/12*100)}).encode())
        elif self.path.startswith('/npc/download/'):
            self._hdr(200, 'model/gltf-binary')
            with open(GLB, 'rb') as f:
                self.wfile.write(f.read())
        elif self.path == '/health':
            self._hdr(200); self.wfile.write(b'{"ok":true,"credits":999}')
        else:
            self._hdr(404)
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(('127.0.0.1', 8799), H).serve_forever()
