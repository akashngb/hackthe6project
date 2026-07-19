#!/usr/bin/env python
"""Local HTTP service wrapping the photo -> T-pose GLB pipeline, for the game's
'Add NPC' feature. Upload photos -> poll -> download GLB. CORS-enabled so a
browser (PlayCanvas) can call it directly.

Run:  python server.py [port]     (default 8799)

  POST /npc/generate   multipart: name=<str>, images=<file>... (1-N photos)
                       -> {job_id, status:"queued"}
  GET  /npc/status/<job_id>   -> {stage, status, progress, selected, download_url?, error?}
  GET  /npc/download/<job_id> -> the .glb (model/gltf-binary)
  GET  /npc/textures/<job_id>/<map>  -> a PBR map png (base_color|normal|roughness|metallic)
  GET  /health         -> {ok:true, credits:<balance>}
  GET  /               -> a tiny built-in upload tester
"""
import os, sys, uuid, threading, glob
import requests
from flask import Flask, request, jsonify, send_file, Response, send_from_directory
from werkzeug.utils import secure_filename
from ingest import generate
from batch import KEY

app = Flask(__name__)
_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JOBDIR = os.path.join(_BASE, "out", "jobs_api")
DEMO_DIR = os.environ.get("NPC_DEMO") or os.path.join(_BASE, "demo")
os.makedirs(JOBDIR, exist_ok=True)
JOBS = {}   # job_id -> live status dict


@app.after_request
def _cors(r):
    r.headers["Access-Control-Allow-Origin"] = "*"
    r.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    r.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return r


def _worker(job_id, paths, name):
    try:
        generate(paths, name, status=JOBS[job_id])
    except Exception as e:
        JOBS[job_id].update(stage="error", error=str(e))


@app.route("/npc/generate", methods=["POST", "OPTIONS"])
def gen():
    if request.method == "OPTIONS":
        return ("", 204)
    name = secure_filename(request.form.get("name") or ("npc_" + uuid.uuid4().hex[:8]))
    files = request.files.getlist("images")
    if not files:
        return jsonify(error="no images uploaded (field name 'images')"), 400
    jd = os.path.join(JOBDIR, name); os.makedirs(jd, exist_ok=True)
    paths = []
    for f in files:
        p = os.path.join(jd, secure_filename(f.filename or f"img{len(paths)}.jpg"))
        f.save(p); paths.append(p)
    job_id = uuid.uuid4().hex
    JOBS[job_id] = {"stage": "queued", "progress": 0, "name": name, "n_images": len(paths)}
    threading.Thread(target=_worker, args=(job_id, paths, name), daemon=True).start()
    return jsonify(job_id=job_id, status="queued", n_images=len(paths))


@app.get("/npc/status/<job_id>")
def status(job_id):
    s = JOBS.get(job_id)
    if not s:
        return jsonify(error="unknown job"), 404
    out = {k: v for k, v in s.items() if k not in ("glb", "outdir")}
    if s.get("glb"):
        out["download_url"] = f"/npc/download/{job_id}"
        out["texture_maps"] = sorted(
            os.path.basename(p).split(s["name"] + "_")[-1].replace(".png", "")
            for p in glob.glob(os.path.join(s["outdir"], s["name"] + "_*.png")))
    return jsonify(out)


@app.get("/npc/download/<job_id>")
def download_glb(job_id):
    s = JOBS.get(job_id)
    if not s or not s.get("glb"):
        return jsonify(error="not ready"), 404
    return send_file(s["glb"], mimetype="model/gltf-binary",
                     as_attachment=True, download_name=s["name"] + ".glb")


@app.get("/npc/textures/<job_id>/<mapname>")
def texture(job_id, mapname):
    s = JOBS.get(job_id)
    if not s or not s.get("outdir"):
        return jsonify(error="not ready"), 404
    p = os.path.join(s["outdir"], f"{s['name']}_{secure_filename(mapname)}.png")
    if not os.path.exists(p):
        return jsonify(error="no such map"), 404
    return send_file(p, mimetype="image/png")


@app.get("/health")
def health():
    try:
        bal = requests.get("https://api.meshy.ai/openapi/v1/balance",
                           headers={"Authorization": f"Bearer {KEY}"}, timeout=15).json()
        return jsonify(ok=True, credits=bal.get("balance"), jobs=len(JOBS))
    except Exception as e:
        return jsonify(ok=False, error=str(e)), 502


@app.get("/")
def game():
    return send_from_directory(DEMO_DIR, "index.html")


@app.get("/<path:fn>")
def demo_static(fn):
    """Serve the browser demo's files (app.js, style.css, lib/*, assets/*).
    Registered API routes (/npc/*, /health, /tester) take precedence."""
    full = os.path.join(DEMO_DIR, fn)
    if os.path.isfile(full):
        return send_from_directory(DEMO_DIR, fn)
    return jsonify(error="not found"), 404


@app.get("/tester")
def tester():
    return Response("""<!doctype html><meta charset=utf-8><title>Add NPC</title>
<body style="font:15px system-ui;max-width:640px;margin:40px auto;padding:0 16px">
<h2>Add NPC — photo → T-pose GLB</h2>
<form id=f><input name=name placeholder="npc name" value="grunt_01"><br><br>
<input type=file name=images multiple accept="image/*"><br><br>
<button>Generate</button></form>
<pre id=o style="background:#111;color:#0f0;padding:12px;border-radius:8px;white-space:pre-wrap"></pre>
<script>
const o=document.getElementById('o');
f.onsubmit=async e=>{e.preventDefault();
 const r=await fetch('/npc/generate',{method:'POST',body:new FormData(f)});
 const {job_id}=await r.json(); o.textContent='job '+job_id+'\\n';
 const t=setInterval(async()=>{const s=await(await fetch('/npc/status/'+job_id)).json();
  o.textContent='job '+job_id+'\\n'+JSON.stringify(s,null,2);
  if(s.download_url){clearInterval(t);o.textContent+='\\n\\nGLB: '+location.origin+s.download_url;}
  if(s.stage==='error')clearInterval(t);},4000);};
</script></body>""", mimetype="text/html")


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8799
    print(f"[server] Add-NPC service on http://0.0.0.0:{port}  (POST /npc/generate)")
    app.run(host="0.0.0.0", port=port, threaded=True)
