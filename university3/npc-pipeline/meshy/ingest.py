#!/usr/bin/env python
"""Library entrypoint for the photo -> T-pose GLB ingestion pipeline.
Wraps batch.py's pieces (select -> enhance -> submit -> poll -> download) into a
single callable so the game's 'Add NPC' feature can invoke it in-process.

    from ingest import generate
    result = generate(["a.jpg","b.jpg", ...], name="grunt_01")
    # result -> {"status":"SUCCEEDED","glb":"/…/grunt_01.glb","textures":{...},"credits":30,...}

Pass a mutable `status` dict to watch progress live (the HTTP server does this).
"""
import os, time, requests
from batch import (select, submit as _submit, download as _download,
                   BASE, HDRS, CACHE, N_IMAGES, ENHANCE_INPUTS, POLL_SECS)
from enhance_photo import enhance_file


def generate(image_paths, name, status=None, enhance=None):
    """Run the full pipeline on a list of image paths. Blocks until the model is
    ready (~5 min). `status` (dict) is updated in place for live progress."""
    st = status if status is not None else {}
    if enhance is None:
        enhance = ENHANCE_INPUTS
    st.update(name=name, stage="select", progress=0, error=None)

    used = select(list(image_paths), N_IMAGES)
    st.update(selected=[os.path.basename(p) for p in used])

    if enhance:
        st.update(stage="enhance")
        ed = os.path.join(CACHE, name + "_enh"); os.makedirs(ed, exist_ok=True)
        used = [enhance_file(f, os.path.join(ed, "enh_" + os.path.basename(f))) for f in used]

    st.update(stage="generating")
    ep, tid = _submit(used)
    st.update(task_id=tid)

    url = f"{ep}/{tid}"
    while True:
        time.sleep(POLL_SECS)
        t = requests.get(url, headers=HDRS, timeout=60).json()
        st.update(status=t.get("status"), progress=t.get("progress"))
        if t.get("status") in ("SUCCEEDED", "FAILED", "CANCELED"):
            break
    if t.get("status") != "SUCCEEDED":
        st.update(stage="error", error=t.get("task_error") or t.get("status"))
        raise RuntimeError(st["error"])

    outdir, saved = _download(name, t)
    glb = saved.get("glb")
    st.update(stage="done", status="SUCCEEDED",
              glb=glb[0] if glb else None,
              glb_mb=round(glb[1] / 1e6, 2) if glb else None,
              outdir=outdir, credits=t.get("consumed_credits"))
    return st


if __name__ == "__main__":
    import sys, json, glob
    root = sys.argv[1]
    name = sys.argv[2] if len(sys.argv) > 2 else "npc"
    imgs = [f for f in sorted(glob.glob(os.path.join(root, "*")))
            if f.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))]
    print(json.dumps(generate(imgs, name), indent=2, default=str))
