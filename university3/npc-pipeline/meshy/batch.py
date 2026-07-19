#!/usr/bin/env python
"""Meshy batch photo -> GLB pipeline (no rigging; up to the textured GLB asset).

Input: a root dir that is EITHER
  - a single photoset (contains image files) -> 1 GLB, OR
  - a parent of subfolders, each subfolder = one photoset -> 1 GLB each.

Per photoset:
  1 image        -> POST /openapi/v1/image-to-3d        (solo)
  2..MULTI_MAX   -> POST /openapi/v1/multi-image-to-3d
  > MULTI_MAX    -> auto-pick MULTI_MAX evenly-spread angles (API hard cap = 4), logged

Max polycount (should_remesh=False), PBR + HD 4K texture, GLB+FBX. Polls to completion.

Usage: batch.py <root_dir> [pose_mode]   # pose_mode: "" | t-pose | a-pose  (default from CONFIG)
"""
import base64, json, os, sys, time, mimetypes, glob
import requests
from PIL import Image, ImageOps

# ---------------- CONFIG (locked defaults) ----------------
POSE_MODE        = "t-pose"    # "" = keep captured pose, or "t-pose"/"a-pose"
AI_MODEL         = "meshy-6"
ENABLE_PBR       = True        # metallic/roughness/normal (+emission on meshy-6)
HD_TEXTURE       = True        # 4K base color (API max; no 8K available)
IMAGE_ENHANCEMENT= True        # keep Meshy input optimization ON
REMOVE_LIGHTING  = True        # keep de-lighting ON (cleaner base color)
SHOULD_REMESH    = False       # False => keep MAX raw polycount (no decimation)
TARGET_FORMATS   = ["glb"]     # quick win: GLB only (fewer formats => faster completion)
IMG_MAX_PX       = 2048        # downscale cap for base64 upload
MULTI_MAX        = 4           # Meshy multi-image hard cap
CLOSEUP_FRAC     = 0.22        # face taller than this fraction of frame => tight close-up (dropped)
# REVERTED to solo + no pre-processing: one clean front photo -> Meshy defaults gave the
# cleanest, lightest result. Multi-image fusion was the source of the darkening/artifacts;
# all the enhancement/normalization/texture_prompt existed only to fight that. Off by default.
N_IMAGES         = 1           # 1 = solo (best result). Raise to 2-4 for multi-image (360 coverage, but riskier texture).
ENHANCE_INPUTS   = False       # no local enhancement — solo needs none
ENHANCE_ON_WHITE = True
TEXTURE_PROMPT   = ""          # no color anchor — Meshy defaults are cleaner on a single photo
POLL_SECS        = 3           # quick win: detect completion sooner
# ----------------------------------------------------------

BASE = "https://api.meshy.ai/openapi/v1"
_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def _load_key():
    k = os.environ.get("MESHY_API_KEY")
    if k: return k
    for _e in (os.path.join(_BASE, ".env"), os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")):
        if os.path.isfile(_e):
            for _l in open(_e):
                if _l.strip().startswith("MESHY_API_KEY") and "=" in _l:
                    return _l.split("=", 1)[1].strip()
    raise SystemExit("MESHY_API_KEY not set. `export MESHY_API_KEY=...` or copy .env.example to .env.")
KEY = _load_key()
HDRS = {"Authorization": f"Bearer {KEY}"}
OUTROOT = os.environ.get("NPC_OUT") or os.path.join(_BASE, "out"); os.makedirs(OUTROOT, exist_ok=True)
CACHE = os.path.join(OUTROOT, "_prep"); os.makedirs(CACHE, exist_ok=True)
IMG_EXT = (".jpg", ".jpeg", ".png", ".webp")
if len(sys.argv) > 2:
    POSE_MODE = sys.argv[2]


def data_uri(path):
    """Downscale + return base64 data URI (jpeg)."""
    im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    im.thumbnail((IMG_MAX_PX, IMG_MAX_PX), Image.LANCZOS)
    cp = os.path.join(CACHE, os.path.basename(path) + ".jpg")
    im.save(cp, quality=90)
    b64 = base64.b64encode(open(cp, "rb").read()).decode()
    return f"data:image/jpeg;base64,{b64}"


def _even(files, k):
    if len(files) <= k:
        return list(files)
    return [files[round(i * (len(files) - 1) / (k - 1))] for i in range(k)]


def select(files, k=N_IMAGES):
    """SOLO (k=1, default): pick the single most-frontal, non-close-up photo.
    MULTI (k>1): drop tight close-ups, guarantee one back view, spread the rest.
    Falls back to first/even-spread if mediapipe is unavailable."""
    if len(files) <= 1:
        return list(files)
    try:
        import cv2, mediapipe as mp
        fd = mp.solutions.face_detection.FaceDetection(model_selection=1, min_detection_confidence=0.3)
        rows = []
        for f in files:
            im = cv2.imread(f)
            if im is None:
                rows.append((f, 0.0, False, 0.0)); continue
            r = fd.process(cv2.cvtColor(im, cv2.COLOR_BGR2RGB))
            if not r.detections:
                rows.append((f, 0.0, False, 0.0)); continue           # no face => back
            d = r.detections[0]; frac = d.location_data.relative_bounding_box.height
            kp = d.location_data.relative_keypoints                    # 0 R-eye,1 L-eye,2 nose
            er, el, nose = kp[0].x, kp[1].x, kp[2].x; eye_d = abs(el - er) + 1e-6
            frontal = max(0.0, 1 - min(abs(nose - (er + el) / 2) / eye_d * 2, 1)) * min(eye_d / 0.10, 1)
            rows.append((f, frac, True, frontal))
    except Exception as e:
        print(f"    [select] mediapipe unavailable ({e}); using first {k}", flush=True)
        return list(files)[:k] if k <= 1 else _even(list(files), k)
    dropped = [os.path.basename(r[0]) for r in rows if r[1] > CLOSEUP_FRAC]
    if dropped:
        print(f"    [select] dropped close-ups: {dropped}", flush=True)
    body = [r for r in rows if r[1] <= CLOSEUP_FRAC] or rows
    if k <= 1:                                                          # SOLO: most frontal
        best = max(body, key=lambda r: r[3])
        print(f"    [select] solo front: {os.path.basename(best[0])}", flush=True)
        return [best[0]]
    if len(body) <= k:
        return [r[0] for r in body]
    backs = [r for r in body if not r[2]]
    faces = [r for r in body if r[2]]
    chosen = [backs[0][0]] if backs else []
    chosen += _even([r[0] for r in faces], k - len(chosen))
    return list(dict.fromkeys(chosen))[:k]


def normalize_set(files, out_dir):
    """Subject-masked exposure/white-balance normalization: rembg each person,
    Reinhard-match every subject's LAB stats to the brightest subject in the set,
    composite on white. Removes handheld exposure/WB variance that drifts Meshy's
    texture. Falls back to originals on any failure."""
    try:
        import cv2, numpy as np
        from rembg import remove, new_session
        sess = new_session("u2net")
        data = []
        for f in files:
            rgba = np.array(remove(Image.open(f).convert("RGB"), session=sess).convert("RGBA"))
            rgb, mask = rgba[..., :3], rgba[..., 3] > 128
            if mask.sum() < 1000:
                return list(files)
            lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
            sub = lab[mask]
            data.append([f, rgb, mask, lab, sub.mean(0), sub.std(0) + 1e-6])
        ref = max(data, key=lambda d: d[4][0])          # brightest subject = reference
        rmean, rstd = ref[4], ref[5]
        os.makedirs(out_dir, exist_ok=True)
        outs = []
        for f, rgb, mask, lab, m, s in data:
            out = lab.copy()
            for c in range(3):
                out[..., c] = (lab[..., c] - m[c]) / s[c] * rstd[c] + rmean[c]
            rgb2 = cv2.cvtColor(np.clip(out, 0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB)
            comp = np.where(mask[..., None], rgb2, np.uint8(255))
            p = os.path.join(out_dir, "norm_" + os.path.basename(f))
            Image.fromarray(comp).save(p, quality=93); outs.append(p)
        print(f"    [normalize] matched {len(outs)} subjects to brightest exposure", flush=True)
        return outs
    except Exception as e:
        print(f"    [normalize] skipped ({e})", flush=True)
        return list(files)


def submit(images):
    common = dict(ai_model=AI_MODEL, should_texture=True, enable_pbr=ENABLE_PBR,
                  hd_texture=HD_TEXTURE, image_enhancement=IMAGE_ENHANCEMENT,
                  remove_lighting=REMOVE_LIGHTING, should_remesh=SHOULD_REMESH,
                  target_formats=TARGET_FORMATS)
    if POSE_MODE:
        common["pose_mode"] = POSE_MODE
    if TEXTURE_PROMPT:
        common["texture_prompt"] = TEXTURE_PROMPT
    if len(images) == 1:
        ep = f"{BASE}/image-to-3d"
        body = {"image_url": data_uri(images[0]), **common}
    else:
        ep = f"{BASE}/multi-image-to-3d"
        body = {"image_urls": [data_uri(p) for p in images], **common}
    r = requests.post(ep, headers={**HDRS, "Content-Type": "application/json"}, json=body, timeout=180)
    if r.status_code >= 300:
        raise RuntimeError(f"submit {r.status_code}: {r.text[:400]}")
    return ep, r.json()["result"]


def poll(ep, tid):
    url = f"{ep}/{tid}"; last = None; t0 = time.time()
    while True:
        time.sleep(POLL_SECS)
        t = requests.get(url, headers=HDRS, timeout=60).json()
        st, pr = t.get("status"), t.get("progress")
        if (st, pr) != last:
            print(f"    [{st} {pr}%] {time.time()-t0:.0f}s", flush=True); last = (st, pr)
        if st in ("SUCCEEDED", "FAILED", "CANCELED"):
            return t


def download(name, t):
    outdir = os.path.join(OUTROOT, name); os.makedirs(outdir, exist_ok=True)
    import urllib.request
    glb = (t.get("model_urls") or {}).get("glb")
    saved = {}
    if glb:
        p = os.path.join(outdir, name + ".glb"); urllib.request.urlretrieve(glb, p)
        saved["glb"] = (p, os.path.getsize(p))
    for i, tex in enumerate(t.get("texture_urls") or []):
        for k, u in (tex or {}).items():
            if isinstance(u, str) and u.startswith("http"):
                urllib.request.urlretrieve(u, os.path.join(outdir, f"{name}_{k}.png"))
    open(os.path.join(outdir, name + ".task.json"), "w").write(json.dumps(t, indent=2))
    return outdir, saved


def photosets(root):
    subs = sorted(d for d in glob.glob(os.path.join(root, "*")) if os.path.isdir(d))
    sets = []
    for d in subs:
        imgs = sorted(f for f in glob.glob(os.path.join(d, "*")) if f.lower().endswith(IMG_EXT))
        if imgs:
            sets.append((os.path.basename(d), imgs))
    if not sets:  # root itself is a single photoset
        imgs = sorted(f for f in glob.glob(os.path.join(root, "*")) if f.lower().endswith(IMG_EXT))
        if imgs:
            sets.append((os.path.basename(root.rstrip("/")), imgs))
    return sets


def main():
    root = sys.argv[1]
    sets = photosets(root)
    if not sets:
        print("No photosets found under", root); sys.exit(1)
    print(f"=== {len(sets)} photoset(s) | pose={POSE_MODE or 'original'} remesh={SHOULD_REMESH} pbr={ENABLE_PBR} hd={HD_TEXTURE} ===")
    total_credits = 0
    for name, imgs in sets:
        used = select(imgs, N_IMAGES)
        mode = "solo" if len(used) == 1 else f"multi({len(used)})"
        note = f"  [picked {len(used)}/{len(imgs)}, API cap {MULTI_MAX}]" if len(imgs) > MULTI_MAX else ""
        print(f"\n[{name}] {mode} <- {[os.path.basename(x) for x in used]}{note}", flush=True)
        if ENHANCE_INPUTS:
            from enhance_photo import enhance_file
            ed = os.path.join(CACHE, name + "_enh"); os.makedirs(ed, exist_ok=True)
            used = [enhance_file(f, os.path.join(ed, "enh_" + os.path.basename(f)), on_white=ENHANCE_ON_WHITE) for f in used]
            print(f"    [enhance] de-shadow + CLAHE + WB + saturation on {len(used)} img(s)", flush=True)
        try:
            ep, tid = submit(used)
            print(f"  task={tid}", flush=True)
            t = poll(ep, tid)
            if t.get("status") != "SUCCEEDED":
                print(f"  FAILED: {t.get('task_error')}"); continue
            outdir, saved = download(name, t)
            cr = t.get("consumed_credits", 0); total_credits += cr
            g = saved.get("glb")
            print(f"  OK: {g[1]/1e6:.1f}MB GLB, {cr} credits -> {outdir}", flush=True)
        except Exception as e:
            print(f"  ERROR: {e}", flush=True)
    print(f"\n=== batch done. total credits: {total_credits} ===")


if __name__ == "__main__":
    main()
